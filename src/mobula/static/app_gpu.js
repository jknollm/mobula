export function createGpuRenderers(deps) {
const {
    state,
    colorForNorm,
    isValidRangeStats,
    minMax,
    resolveColorNormStats,
    volumeQualityConfig,
    clamp,
    activeColorMapIsCyclic,
    activeColorMapIsDiverging,
    isDerivedPolModeActive,
    volumeRenderModeInt,
    volumeTfModeInt,
  } = deps;

function isNumericArrayLike(values) {
  return Array.isArray(values) || ArrayBuffer.isView(values);
}

const GPU_VOLUME_MAX_STEPS = 192;
const GPU_VOLUME_ZOOM_MIN = 0.2;
const GPU_VOLUME_ZOOM_MAX = 8.0;

function compileWebGlShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "shader compile failed";
    gl.deleteShader(shader);
    throw new Error(log.trim());
  }
  return shader;
}

function createWebGlProgram(gl, vsSource, fsSource) {
  const vs = compileWebGlShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileWebGlShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "program link failed";
    gl.deleteProgram(program);
    throw new Error(log.trim());
  }
  return program;
}

function textureLayoutForCount(count, maxTextureSize) {
  const texW = Math.min(maxTextureSize, Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count)))));
  const texH = Math.ceil(Math.max(1, count) / texW);
  if (texH > maxTextureSize) return null;
  return { texW, texH };
}

function normalizeRgbRangeWindow(raw) {
  const out = { min: 0, max: 1 };
  if (raw && typeof raw === "object") {
    const minIn = Number.parseFloat(raw.min);
    const maxIn = Number.parseFloat(raw.max);
    if (Number.isFinite(minIn)) out.min = clamp(minIn / 100, 0, 1);
    if (Number.isFinite(maxIn)) out.max = clamp(maxIn / 100, 0, 1);
  }
  const minGap = 1.0e-3;
  if (out.max <= out.min + minGap) {
    out.max = clamp(out.min + minGap, minGap, 1);
    out.min = clamp(out.max - minGap, 0, 1 - minGap);
  }
  out.min = clamp(out.min, 0, 1 - minGap);
  out.max = clamp(out.max, out.min + minGap, 1);
  return out;
}

function applyRgbRangeWindow(rawStats, rangeWindow) {
  const minBase = Number.isFinite(rawStats?.min) ? rawStats.min : 0;
  const maxBase = Number.isFinite(rawStats?.max) ? rawStats.max : 1;
  const positiveRaw = Number.isFinite(rawStats?.maxPositive) ? rawStats.maxPositive : maxBase;
  const baseHi = Math.max(0, positiveRaw);
  if (!(baseHi > 0)) {
    const lo = Math.min(minBase, maxBase);
    const hi = Math.max(minBase, maxBase);
    return {
      min: lo,
      max: hi,
      minPositive: Math.max(0, Number.isFinite(rawStats?.minPositive) ? rawStats.minPositive : lo),
      maxPositive: Math.max(0, hi),
    };
  }
  const window = normalizeRgbRangeWindow(rangeWindow);
  let minV = baseHi * window.min;
  let maxV = baseHi * window.max;
  if (maxV <= minV) {
    const minGap = baseHi * 1.0e-3;
    maxV = Math.min(baseHi, minV + minGap);
    minV = Math.max(0, maxV - minGap);
  }
  return {
    min: minV,
    max: maxV,
    minPositive: Math.max(0, minV),
    maxPositive: Math.max(0, maxV),
  };
}

class GpuSphereRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      depth: false,
      stencil: false,
      desynchronized: true,
    });
    if (!this.gl) throw new Error("WebGL2 not supported");

    const gl = this.gl;
    this.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;

    const vs = `#version 300 es
      precision highp float;
      out vec2 v_uv;
      const vec2 POS[3] = vec2[3](
        vec2(-1.0, -1.0),
        vec2( 3.0, -1.0),
        vec2(-1.0,  3.0)
      );
      void main() {
        vec2 p = POS[gl_VertexID];
        v_uv = 0.5 * (p + 1.0);
        gl_Position = vec4(p, 0.0, 1.0);
      }
    `;

    const fsCommon = `
      precision highp float;
      precision highp int;
      precision highp sampler2D;
      precision highp usampler2D;

      in vec2 v_uv;

      uniform sampler2D u_values;
      uniform usampler2D u_ring_lut;
      uniform sampler2D u_cmap;

      uniform int u_values_w;
      uniform int u_lut_w;
      uniform int u_use_ring_lut;
      uniform int u_nside;
      uniform int u_npix;
      uniform int u_projection;
      uniform int u_flip_x;
      uniform float u_inside_scale;
      uniform int u_width;
      uniform int u_height;
      uniform vec3 u_inv_rot_row0;
      uniform vec3 u_inv_rot_row1;
      uniform vec3 u_inv_rot_row2;
      uniform float u_min_v;
      uniform float u_max_v;
      uniform float u_max_positive;
      uniform float u_min_positive;
      uniform int u_flux_scale;
      uniform int u_use_diverging;
      uniform int u_use_circular_bfield;

      const float PI = 3.14159265358979323846;
      const float SQRT2 = 1.4142135623730950488;
      const float SPHERE_OUTSIDE_RADIUS = 0.47;

      int positiveMod(int v, int d) {
        if (d <= 0) return 0;
        int m = v % d;
        return m < 0 ? m + d : m;
      }

      int clampInt(int v, int lo, int hi) {
        return min(max(v, lo), hi);
      }

      bool sphereCameraRay(float px, float py, out vec3 cam) {
        float w = float(u_width);
        float h = float(u_height);

        if (u_projection == 1) {
          float nx = px / max(1.0, w - 1.0);
          float ny = py / max(1.0, h - 1.0);
          float u = (nx - 0.5) / max(1.0e-6, u_inside_scale);
          if (u_flip_x == 1) u = -u;
          float v = (0.5 - ny) / max(1.0e-6, u_inside_scale);
          float inv = inversesqrt(1.0 + u * u + v * v);
          cam = vec3(inv, u * inv, v * inv);
          return true;
        }

        if (u_projection == 2) {
          float cx = 0.5 * (w - 1.0);
          float cy = 0.5 * (h - 1.0);
          float r = SPHERE_OUTSIDE_RADIUS * min(w, h);
          float y = (px - cx) / max(1.0e-6, r);
          if (u_flip_x == 1) y = -y;
          float z = (cy - py) / max(1.0e-6, r);
          float rr = y * y + z * z;
          if (rr > 1.0) return false;
          float x = sqrt(max(0.0, 1.0 - rr));
          cam = vec3(x, y, z);
          return true;
        }

        float xProj = (px / max(1.0, w - 1.0)) * (4.0 * SQRT2) - 2.0 * SQRT2;
        if (u_flip_x == 1) xProj = -xProj;
        float yProj = SQRT2 - (py / max(1.0, h - 1.0)) * (2.0 * SQRT2);
        float xn = xProj / (2.0 * SQRT2);
        float yn = yProj / SQRT2;
        if (xn * xn + yn * yn > 1.0) return false;
        float theta = asin(clamp(yProj / SQRT2, -1.0, 1.0));
        float ct = cos(theta);
        float lon = 0.0;
        if (abs(ct) > 1.0e-8) {
          lon = (PI * xProj) / (2.0 * SQRT2 * ct);
        }
        lon = clamp(lon, -PI, PI);
        float lat = asin(clamp((2.0 * theta + sin(2.0 * theta)) / PI, -1.0, 1.0));
        float cl = cos(lat);
        cam = vec3(cl * cos(lon), cl * sin(lon), sin(lat));
        return true;
      }

      int healpixVecToRingPix(float x, float y, float z) {
        int nside = u_nside;
        int npix = 12 * nside * nside;
        int ncap = 2 * nside * (nside - 1);
        float za = abs(z);
        float phi = atan(y, x);
        if (phi < 0.0) phi += 2.0 * PI;
        float tt = phi / (0.5 * PI);

        if (za <= (2.0 / 3.0)) {
          int jp = int(floor(float(nside) * (0.5 + tt - 0.75 * z)));
          int jm = int(floor(float(nside) * (0.5 + tt + 0.75 * z)));
          int ir = nside + 1 + jp - jm;
          int kshift = 1 - (ir & 1);
          int nl4 = 4 * nside;
          int ip = int(floor(0.5 * float(jp + jm - nside + kshift + 1))) + 1;
          ip = positiveMod(ip - 1, nl4) + 1;
          return clampInt(ncap + (ir - 1) * nl4 + ip - 1, 0, npix - 1);
        }

        float tp = tt - floor(tt);
        float tmp = float(nside) * sqrt(max(0.0, 3.0 * (1.0 - za)));
        int jp = int(floor(tp * tmp));
        int jm = int(floor((1.0 - tp) * tmp));
        int ir = jp + jm + 1;
        int nl4 = 4 * ir;
        int ip = int(floor(tt * float(ir))) + 1;
        ip = positiveMod(ip - 1, nl4) + 1;
        if (z >= 0.0) return clampInt(2 * ir * (ir - 1) + ip - 1, 0, npix - 1);
        return clampInt(npix - 2 * ir * (ir + 1) + ip - 1, 0, npix - 1);
      }

      int ringToDataIndex(int ring) {
        if (u_use_ring_lut != 1) return ring;
        int lx = ring % max(1, u_lut_w);
        int ly = ring / max(1, u_lut_w);
        uint mapped = texelFetch(u_ring_lut, ivec2(lx, ly), 0).r;
        return int(mapped);
      }

      int sphereDataIndex() {
        float px = gl_FragCoord.x - 0.5;
        float py = float(u_height) - gl_FragCoord.y - 0.5;
        vec3 cam;
        if (!sphereCameraRay(px, py, cam)) return -1;
        vec3 w = vec3(dot(u_inv_rot_row0, cam), dot(u_inv_rot_row1, cam), dot(u_inv_rot_row2, cam));
        int ring = healpixVecToRingPix(w.x, w.y, w.z);
        int idx = ringToDataIndex(ring);
        if (idx < 0 || idx >= u_npix) return -1;
        return idx;
      }

      float normalizeLinear(float sampleV) {
        if (u_use_circular_bfield == 1) {
          float a = mod(sampleV, 180.0);
          if (a < 0.0) a += 180.0;
          return a / 180.0;
        }
        if (u_use_diverging == 1) {
          float maxAbs = max(abs(u_min_v), abs(u_max_v));
          if (maxAbs > 0.0) return (sampleV + maxAbs) / (2.0 * maxAbs);
        }
        return (sampleV - u_min_v) / max(1.0e-9, u_max_v - u_min_v);
      }

      float normalizeSqrt(float sampleV) {
        if (u_use_circular_bfield == 1) return normalizeLinear(sampleV);
        if (u_use_diverging == 1) {
          float maxAbs = max(abs(u_min_v), abs(u_max_v));
          if (!(maxAbs > 0.0)) return 0.5;
          float maxAbsSqrt = sqrt(maxAbs);
          float transformed = sign(sampleV) * sqrt(abs(sampleV));
          return (transformed + maxAbsSqrt) / max(1.0e-9, 2.0 * maxAbsSqrt);
        }
        float t = clamp((sampleV - u_min_v) / max(1.0e-9, u_max_v - u_min_v), 0.0, 1.0);
        return sqrt(t);
      }

      float normalizeLog(float sampleV) {
        float lo = max(0.0, u_min_positive);
        if (sampleV < 0.0 && lo <= 0.0) return 0.0;
        float hi = max(lo, u_max_positive);
        if (!(hi > 0.0)) return 0.0;
        float loEff = lo > 0.0 ? min(lo, hi) : max(hi * 1.0e-6, 1.0e-30);
        if (!(hi > loEff)) return 0.0;
        float sampleClamped = clamp(sampleV, loEff, hi);
        float loL = log(loEff);
        float hiL = log(hi);
        float span = hiL - loL;
        if (!(span > 0.0)) return 0.0;
        return (log(sampleClamped) - loL) / span;
      }

      float sampleToNorm(float sampleV) {
        if (u_flux_scale == 1) return normalizeLog(sampleV);
        if (u_flux_scale == 2) return normalizeSqrt(sampleV);
        return normalizeLinear(sampleV);
      }
    `;

    const fsColor = `#version 300 es
      ${fsCommon}
      out vec4 outColor;
      void main() {
        int idx = sphereDataIndex();
        if (idx < 0) {
          outColor = vec4(0.0, 0.0, 0.0, 0.0);
          return;
        }
        int vx = idx % max(1, u_values_w);
        int vy = idx / max(1, u_values_w);
        float sampleV = texelFetch(u_values, ivec2(vx, vy), 0).r;
        if (isnan(sampleV) || isinf(sampleV)) {
          outColor = vec4(0.0);
          return;
        }
        float norm = sampleToNorm(sampleV);
        norm = clamp(norm, 0.0, 1.0);
        vec3 rgb = texture(u_cmap, vec2(norm, 0.5)).rgb;
        outColor = vec4(rgb, 1.0);
      }
    `;

    const fsColorRgb = `#version 300 es
      ${fsCommon}
      uniform float u_rgb_min_r;
      uniform float u_rgb_max_r;
      uniform float u_rgb_min_g;
      uniform float u_rgb_max_g;
      uniform float u_rgb_min_b;
      uniform float u_rgb_max_b;
      uniform float u_rgb_max_positive_r;
      uniform float u_rgb_max_positive_g;
      uniform float u_rgb_max_positive_b;
      uniform float u_rgb_min_positive_r;
      uniform float u_rgb_min_positive_g;
      uniform float u_rgb_min_positive_b;
      uniform float u_rgb_gain_r;
      uniform float u_rgb_gain_g;
      uniform float u_rgb_gain_b;

      out vec4 outColor;

      float normalizeRgbChannel(float sampleV, float minV, float maxV, float maxPositiveV, float minPositiveV) {
        if (u_flux_scale == 1) {
          if (sampleV < 0.0) return 0.0;
          float hi = max(0.0, maxPositiveV);
          if (!(hi > 0.0)) return 0.0;
          float lo = max(0.0, minPositiveV);
          if (!(lo > 0.0)) lo = max(hi * 1.0e-6, 1.0e-30);
          lo = min(lo, hi);
          if (!(hi > lo)) return 0.0;
          float sampleClamped = clamp(sampleV, lo, hi);
          return (log(sampleClamped) - log(lo)) / max(1.0e-9, log(hi) - log(lo));
        }
        float t = clamp((sampleV - minV) / max(1.0e-9, maxV - minV), 0.0, 1.0);
        if (u_flux_scale == 2) return sqrt(t);
        return t;
      }

      void main() {
        int idx = sphereDataIndex();
        if (idx < 0) {
          outColor = vec4(0.0, 0.0, 0.0, 0.0);
          return;
        }
        int vx = idx % max(1, u_values_w);
        int vy = idx / max(1, u_values_w);
        vec3 sampleV = texelFetch(u_values, ivec2(vx, vy), 0).rgb * vec3(u_rgb_gain_r, u_rgb_gain_g, u_rgb_gain_b);

        float nr = normalizeRgbChannel(sampleV.r, u_rgb_min_r, u_rgb_max_r, u_rgb_max_positive_r, u_rgb_min_positive_r);
        float ng = normalizeRgbChannel(sampleV.g, u_rgb_min_g, u_rgb_max_g, u_rgb_max_positive_g, u_rgb_min_positive_g);
        float nb = normalizeRgbChannel(sampleV.b, u_rgb_min_b, u_rgb_max_b, u_rgb_max_positive_b, u_rgb_min_positive_b);
        outColor = vec4(clamp(vec3(nr, ng, nb), 0.0, 1.0), 1.0);
      }
    `;

    const fsIndex = `#version 300 es
      ${fsCommon}
      out vec4 outColor;
      void main() {
        int idx = sphereDataIndex();
        if (idx < 0) {
          outColor = vec4(0.0);
          return;
        }
        uint v = uint(idx + 1);
        uvec4 bytes = uvec4(v & 255u, (v >> 8u) & 255u, (v >> 16u) & 255u, (v >> 24u) & 255u);
        outColor = vec4(bytes) / 255.0;
      }
    `;

    this.colorProgram = createWebGlProgram(gl, vs, fsColor);
    this.colorRgbProgram = createWebGlProgram(gl, vs, fsColorRgb);
    this.indexProgram = createWebGlProgram(gl, vs, fsIndex);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const commonUniforms = (program) => ({
      values: gl.getUniformLocation(program, "u_values"),
      ringLut: gl.getUniformLocation(program, "u_ring_lut"),
      valuesW: gl.getUniformLocation(program, "u_values_w"),
      lutW: gl.getUniformLocation(program, "u_lut_w"),
      useRingLut: gl.getUniformLocation(program, "u_use_ring_lut"),
      nside: gl.getUniformLocation(program, "u_nside"),
      npix: gl.getUniformLocation(program, "u_npix"),
      projection: gl.getUniformLocation(program, "u_projection"),
      flipX: gl.getUniformLocation(program, "u_flip_x"),
      insideScale: gl.getUniformLocation(program, "u_inside_scale"),
      width: gl.getUniformLocation(program, "u_width"),
      height: gl.getUniformLocation(program, "u_height"),
      invRotRow0: gl.getUniformLocation(program, "u_inv_rot_row0"),
      invRotRow1: gl.getUniformLocation(program, "u_inv_rot_row1"),
      invRotRow2: gl.getUniformLocation(program, "u_inv_rot_row2"),
      minV: gl.getUniformLocation(program, "u_min_v"),
      maxV: gl.getUniformLocation(program, "u_max_v"),
      maxPositive: gl.getUniformLocation(program, "u_max_positive"),
      minPositive: gl.getUniformLocation(program, "u_min_positive"),
      fluxScale: gl.getUniformLocation(program, "u_flux_scale"),
      useDiverging: gl.getUniformLocation(program, "u_use_diverging"),
      useCircularBfield: gl.getUniformLocation(program, "u_use_circular_bfield"),
      cmap: gl.getUniformLocation(program, "u_cmap"),
    });
    this.colorUniforms = commonUniforms(this.colorProgram);
    this.colorRgbUniforms = {
      ...commonUniforms(this.colorRgbProgram),
      rgbMinR: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_min_r"),
      rgbMaxR: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_max_r"),
      rgbMinG: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_min_g"),
      rgbMaxG: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_max_g"),
      rgbMinB: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_min_b"),
      rgbMaxB: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_max_b"),
      rgbMaxPositiveR: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_max_positive_r"),
      rgbMaxPositiveG: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_max_positive_g"),
      rgbMaxPositiveB: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_max_positive_b"),
      rgbMinPositiveR: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_min_positive_r"),
      rgbMinPositiveG: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_min_positive_g"),
      rgbMinPositiveB: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_min_positive_b"),
      rgbGainR: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_gain_r"),
      rgbGainG: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_gain_g"),
      rgbGainB: gl.getUniformLocation(this.colorRgbProgram, "u_rgb_gain_b"),
    };
    this.indexUniforms = commonUniforms(this.indexProgram);

    this.colorTexture = gl.createTexture();
    this.valueTextureCache = new WeakMap();
    this.rgbValueTextureCache = new WeakMap();
    this.ringLutTextureCache = new WeakMap();
    this.lastColorMap = "";

    this.emptyRingTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.emptyRingTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, 1, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, new Uint32Array([0]));

    this.idFramebuffer = gl.createFramebuffer();
    this.idTexture = null;
    this.idWidth = 0;
    this.idHeight = 0;
  }

  updateColorTexture() {
    const gl = this.gl;
    const cmap = state.colorMap || "viridis";
    if (this.lastColorMap === cmap) return;
    this.lastColorMap = cmap;

    const width = 256;
    const data = new Uint8Array(width * 3);
    for (let i = 0; i < width; i += 1) {
      const [r, g, b] = colorForNorm(i / (width - 1));
      data[i * 3 + 0] = r;
      data[i * 3 + 1] = g;
      data[i * 3 + 2] = b;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, width, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
  }

  valueTextureFor(values, npix) {
    const gl = this.gl;
    let rec = this.valueTextureCache.get(values);
    if (rec && rec.npix === npix) return rec;

    const layout = textureLayoutForCount(npix, this.maxTextureSize);
    if (!layout) throw new Error("sphere values exceed GPU texture limits");
    const src = values instanceof Float32Array ? values : Float32Array.from(values);
    const texData = new Float32Array(layout.texW * layout.texH);
    texData.set(src.subarray(0, npix), 0);

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, layout.texW, layout.texH, 0, gl.RED, gl.FLOAT, texData);

    rec = { texture, npix, texW: layout.texW, texH: layout.texH };
    this.valueTextureCache.set(values, rec);
    return rec;
  }

  valueTextureForRgb(values, npix) {
    const gl = this.gl;
    let rec = this.rgbValueTextureCache.get(values);
    if (rec && rec.npix === npix) return rec;

    const layout = textureLayoutForCount(npix, this.maxTextureSize);
    if (!layout) throw new Error("sphere multispectral values exceed GPU texture limits");
    const srcR = values.r instanceof Float32Array ? values.r : Float32Array.from(values.r);
    const srcG = values.g instanceof Float32Array ? values.g : Float32Array.from(values.g);
    const srcB = values.b instanceof Float32Array ? values.b : Float32Array.from(values.b);
    const texData = new Float32Array(layout.texW * layout.texH * 4);
    for (let i = 0; i < npix; i += 1) {
      const di = i * 4;
      texData[di + 0] = srcR[i];
      texData[di + 1] = srcG[i];
      texData[di + 2] = srcB[i];
      texData[di + 3] = 1;
    }

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, layout.texW, layout.texH, 0, gl.RGBA, gl.FLOAT, texData);

    rec = { texture, npix, texW: layout.texW, texH: layout.texH };
    this.rgbValueTextureCache.set(values, rec);
    return rec;
  }

  ringLutTextureFor(ringLut, npix) {
    if (!ringLut) return null;
    const gl = this.gl;
    let rec = this.ringLutTextureCache.get(ringLut);
    if (rec && rec.npix === npix) return rec;

    const layout = textureLayoutForCount(npix, this.maxTextureSize);
    if (!layout) throw new Error("sphere LUT exceeds GPU texture limits");
    const src = ringLut instanceof Uint32Array ? ringLut : Uint32Array.from(ringLut, (v) => (v < 0 ? 0 : v >>> 0));
    const texData = new Uint32Array(layout.texW * layout.texH);
    texData.set(src.subarray(0, npix), 0);

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, layout.texW, layout.texH, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, texData);

    rec = { texture, npix, texW: layout.texW, texH: layout.texH };
    this.ringLutTextureCache.set(ringLut, rec);
    return rec;
  }

  ensureIdTarget(width, height) {
    const gl = this.gl;
    if (this.idTexture && this.idWidth === width && this.idHeight === height) return;
    if (!this.idTexture) this.idTexture = gl.createTexture();
    this.idWidth = width;
    this.idHeight = height;

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.idTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.idFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.idTexture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("sphere index framebuffer incomplete");
    }
  }

  setCommonUniforms(uniforms, opts) {
    const gl = this.gl;
    gl.uniform1i(uniforms.values, 0);
    gl.uniform1i(uniforms.ringLut, 2);
    gl.uniform1i(uniforms.cmap, 1);
    gl.uniform1i(uniforms.valuesW, opts.valuesW);
    gl.uniform1i(uniforms.lutW, opts.lutW);
    gl.uniform1i(uniforms.useRingLut, opts.useRingLut);
    gl.uniform1i(uniforms.nside, opts.nside);
    gl.uniform1i(uniforms.npix, opts.npix);
    gl.uniform1i(uniforms.projection, opts.projection);
    gl.uniform1i(uniforms.flipX, opts.flipX ? 1 : 0);
    gl.uniform1f(uniforms.insideScale, opts.insideScale);
    gl.uniform1i(uniforms.width, opts.width);
    gl.uniform1i(uniforms.height, opts.height);
    gl.uniform3f(uniforms.invRotRow0, opts.invRot[0], opts.invRot[1], opts.invRot[2]);
    gl.uniform3f(uniforms.invRotRow1, opts.invRot[3], opts.invRot[4], opts.invRot[5]);
    gl.uniform3f(uniforms.invRotRow2, opts.invRot[6], opts.invRot[7], opts.invRot[8]);
    gl.uniform1f(uniforms.minV, opts.mmMin);
    gl.uniform1f(uniforms.maxV, opts.mmMax);
    gl.uniform1f(uniforms.maxPositive, opts.maxPositive);
    gl.uniform1f(uniforms.minPositive, opts.minPositive);
    gl.uniform1i(uniforms.fluxScale, opts.fluxScale);
    gl.uniform1i(uniforms.useDiverging, opts.useDiverging ? 1 : 0);
    gl.uniform1i(uniforms.useCircularBfield, opts.useCircularBfield ? 1 : 0);
  }

  setRgbUniforms(uniforms, rgbStats) {
    const gl = this.gl;
    const gainR = 1;
    const gainG = 1;
    const gainB = 1;
    gl.uniform1f(uniforms.rgbGainR, gainR);
    gl.uniform1f(uniforms.rgbGainG, gainG);
    gl.uniform1f(uniforms.rgbGainB, gainB);
    gl.uniform1f(uniforms.rgbMinR, rgbStats.minR * gainR);
    gl.uniform1f(uniforms.rgbMaxR, rgbStats.maxR * gainR);
    gl.uniform1f(uniforms.rgbMinG, rgbStats.minG * gainG);
    gl.uniform1f(uniforms.rgbMaxG, rgbStats.maxG * gainG);
    gl.uniform1f(uniforms.rgbMinB, rgbStats.minB * gainB);
    gl.uniform1f(uniforms.rgbMaxB, rgbStats.maxB * gainB);
    gl.uniform1f(uniforms.rgbMaxPositiveR, rgbStats.maxPositiveR * gainR);
    gl.uniform1f(uniforms.rgbMaxPositiveG, rgbStats.maxPositiveG * gainG);
    gl.uniform1f(uniforms.rgbMaxPositiveB, rgbStats.maxPositiveB * gainB);
    gl.uniform1f(uniforms.rgbMinPositiveR, rgbStats.minPositiveR * gainR);
    gl.uniform1f(uniforms.rgbMinPositiveG, rgbStats.minPositiveG * gainG);
    gl.uniform1f(uniforms.rgbMinPositiveB, rgbStats.minPositiveB * gainB);
  }

  render(params) {
    if (!params || !Number.isFinite(params.npix)) return null;
    const {
      values,
      rgbValues = null,
      npix,
      nside,
      projection,
      flipX = true,
      insideScale = 0.2,
      width,
      height,
      ordering,
      ringLut,
      rangeOverride = null,
      stats = null,
      includeIndexMap = true,
    } = params;
    const scalarMode = Boolean(values && Number.isFinite(values.length) && values.length >= npix);
    const multispectralMode = Boolean(
      rgbValues &&
      rgbValues.r &&
      rgbValues.g &&
      rgbValues.b &&
      Number.isFinite(rgbValues.r.length) &&
      Number.isFinite(rgbValues.g.length) &&
      Number.isFinite(rgbValues.b.length) &&
      rgbValues.r.length >= npix &&
      rgbValues.g.length >= npix &&
      rgbValues.b.length >= npix
    );
    if (!scalarMode && !multispectralMode) return null;
    if (npix < 1 || !Number.isFinite(nside) || nside < 1 || width < 1 || height < 1) return null;

    let mmMin = 0;
    let mmMax = 1;
    let minPositive = 0;
    let maxPositive = 1;
    let rgbStats = null;
    if (scalarMode) {
      const fixedStats =
        rangeOverride && isValidRangeStats(rangeOverride)
          ? rangeOverride
          : isValidRangeStats(state.fixedColorRange)
          ? state.fixedColorRange
          : null;
      const sourceStats = isValidRangeStats(stats) ? stats : null;
      const baseStats = fixedStats
        ? { min: fixedStats.min, max: fixedStats.max }
        : sourceStats
        ? { min: sourceStats.min, max: sourceStats.max }
        : minMax(values);
      const normalizedStats = resolveColorNormStats(baseStats);
      mmMin = Number.isFinite(normalizedStats.min) ? normalizedStats.min : 0;
      mmMax = Number.isFinite(normalizedStats.max) ? normalizedStats.max : 1;
      minPositive = Math.max(0, mmMin);
      maxPositive = Math.max(minPositive, mmMax);
    } else {
      rgbStats = {
        minR: 0,
        maxR: 1,
        minG: 0,
        maxG: 1,
        minB: 0,
        maxB: 1,
        minPositiveR: 0,
        maxPositiveR: 1,
        minPositiveG: 0,
        maxPositiveG: 1,
        minPositiveB: 0,
        maxPositiveB: 1,
      };
    }
    const useDiverging = activeColorMapIsDiverging() && mmMin < 0 && mmMax > 0;
    const useCircularBfield = activeColorMapIsCyclic() && isDerivedPolModeActive() && state.derivedPolMode === "bfield";
    const fluxScale = scalarMode ? (state.fluxScale === "log" ? 1 : state.fluxScale === "sqrt" ? 2 : 0) : 0;
    const projectionMode = projection === "inside" ? 1 : projection === "outside" ? 2 : 0;

    let invRot = null;
    if ((Array.isArray(state.sphereRotationMatrix) || ArrayBuffer.isView(state.sphereRotationMatrix)) && state.sphereRotationMatrix.length >= 9) {
      const m = state.sphereRotationMatrix;
      const out = [
        Number(m[0]),
        Number(m[3]),
        Number(m[6]),
        Number(m[1]),
        Number(m[4]),
        Number(m[7]),
        Number(m[2]),
        Number(m[5]),
        Number(m[8]),
      ];
      if (out.every(Number.isFinite)) {
        invRot = out;
      }
    }
    if (!invRot) {
      const yaw = state.sphereYaw || 0;
      const pitch = state.spherePitch || 0;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      invRot = [cp * cy, sy, -sp * cy, -cp * sy, cy, sp * sy, sp, 0, cp];
    }

    const gl = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    this.updateColorTexture();
    const valuesTex = scalarMode ? this.valueTextureFor(values, npix) : this.valueTextureForRgb(rgbValues, npix);
    const useRingLut = ordering === "nested" && ringLut && ringLut.length >= npix ? 1 : 0;
    const ringTex = useRingLut ? this.ringLutTextureFor(ringLut, npix) : null;

    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, valuesTex.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, ringTex ? ringTex.texture : this.emptyRingTexture);

    const uniformOpts = {
      valuesW: valuesTex.texW,
      lutW: ringTex ? ringTex.texW : 1,
      useRingLut,
      nside,
      npix,
      projection: projectionMode,
      flipX,
      insideScale: Math.max(0.05, Math.min(6.0, insideScale)),
      width,
      height,
      invRot,
      mmMin,
      mmMax,
      maxPositive,
      minPositive,
      fluxScale,
      useDiverging,
      useCircularBfield,
    };

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (scalarMode) {
      gl.useProgram(this.colorProgram);
      this.setCommonUniforms(this.colorUniforms, uniformOpts);
    } else {
      gl.useProgram(this.colorRgbProgram);
      this.setCommonUniforms(this.colorRgbUniforms, uniformOpts);
      this.setRgbUniforms(this.colorRgbUniforms, rgbStats);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    out.getContext("2d").drawImage(this.canvas, 0, 0);
    if (!includeIndexMap) {
      delete out.__healpixIndexMap;
      return out;
    }

    this.ensureIdTarget(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.idFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.indexProgram);
    this.setCommonUniforms(this.indexUniforms, uniformOpts);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const indexMap = new Int32Array(width * height);
    indexMap.fill(-1);
    for (let y = 0; y < height; y += 1) {
      const srcRow = height - 1 - y;
      const dstBase = y * width;
      const srcBase = srcRow * width;
      for (let x = 0; x < width; x += 1) {
        const si = (srcBase + x) * 4;
        const packed = (raw[si + 0] | (raw[si + 1] << 8) | (raw[si + 2] << 16) | (raw[si + 3] << 24)) >>> 0;
        if (packed > 0) indexMap[dstBase + x] = packed - 1;
      }
    }
    out.__healpixIndexMap = indexMap;
    return out;
  }
}

class GpuSliceRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      depth: false,
      stencil: false,
      desynchronized: true,
    });
    if (!this.gl) throw new Error("WebGL2 not supported");

    const gl = this.gl;
    const vs = `#version 300 es
      precision highp float;
      out vec2 v_uv;
      const vec2 POS[3] = vec2[3](
        vec2(-1.0, -1.0),
        vec2( 3.0, -1.0),
        vec2(-1.0,  3.0)
      );
      void main() {
        vec2 p = POS[gl_VertexID];
        v_uv = 0.5 * (p + 1.0);
        gl_Position = vec4(p, 0.0, 1.0);
      }
    `;
    const fs = `#version 300 es
      precision highp float;
      precision highp sampler2D;
      in vec2 v_uv;
      out vec4 outColor;

      uniform sampler2D u_values;
      uniform sampler2D u_cmap;
      uniform float u_min_v;
      uniform float u_max_v;
      uniform float u_max_positive;
      uniform float u_min_positive;
      uniform float u_max_abs;
      uniform int u_flux_scale;
      uniform int u_use_diverging;
      uniform int u_use_circular_bfield;

      float normalizeLinear(float sampleV) {
        if (u_use_circular_bfield == 1) {
          float a = mod(sampleV, 180.0);
          if (a < 0.0) a += 180.0;
          return a / 180.0;
        }
        if (u_use_diverging == 1) {
          float maxAbs = max(u_max_abs, 1.0e-9);
          return (sampleV + maxAbs) / (2.0 * maxAbs);
        }
        float span = max(u_max_v - u_min_v, 1.0e-6);
        return (sampleV - u_min_v) / span;
      }

      float normalizeSqrt(float sampleV) {
        if (u_use_circular_bfield == 1) return normalizeLinear(sampleV);
        if (u_use_diverging == 1) {
          float maxAbs = max(u_max_abs, 1.0e-9);
          float maxAbsSqrt = sqrt(maxAbs);
          float transformed = sign(sampleV) * sqrt(abs(sampleV));
          return (transformed + maxAbsSqrt) / max(1.0e-6, 2.0 * maxAbsSqrt);
        }
        float span = max(u_max_v - u_min_v, 1.0e-6);
        float t = clamp((sampleV - u_min_v) / span, 0.0, 1.0);
        return sqrt(t);
      }

      float sampleToNorm(float sampleV) {
        if (u_flux_scale == 1) {
          float lo = max(0.0, u_min_positive);
          if (sampleV < 0.0 && lo <= 0.0) sampleV = 0.0;
          float hi = max(lo, u_max_positive);
          if (!(hi > 0.0)) return 0.0;
          float loEff = lo > 0.0 ? min(lo, hi) : max(hi * 1.0e-6, 1.0e-30);
          if (!(hi > loEff)) return 0.0;
          float clampedV = clamp(sampleV, loEff, hi);
          float loL = log(loEff);
          float hiL = log(hi);
          return (log(clampedV) - loL) / max(1.0e-6, hiL - loL);
        }
        if (u_flux_scale == 2) return normalizeSqrt(sampleV);
        return normalizeLinear(sampleV);
      }

      void main() {
        float sampleV = texture(u_values, vec2(1.0 - v_uv.y, v_uv.x)).r;
        if (isnan(sampleV) || isinf(sampleV)) {
          outColor = vec4(0.0);
          return;
        }
        float norm = sampleToNorm(sampleV);
        norm = clamp(norm, 0.0, 1.0);
        vec3 rgb = texture(u_cmap, vec2(norm, 0.5)).rgb;
        outColor = vec4(rgb, 1.0);
      }
    `;

    this.program = createWebGlProgram(gl, vs, fs);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.uniforms = {
      values: gl.getUniformLocation(this.program, "u_values"),
      cmap: gl.getUniformLocation(this.program, "u_cmap"),
      minV: gl.getUniformLocation(this.program, "u_min_v"),
      maxV: gl.getUniformLocation(this.program, "u_max_v"),
      maxPositive: gl.getUniformLocation(this.program, "u_max_positive"),
      minPositive: gl.getUniformLocation(this.program, "u_min_positive"),
      maxAbs: gl.getUniformLocation(this.program, "u_max_abs"),
      fluxScale: gl.getUniformLocation(this.program, "u_flux_scale"),
      useDiverging: gl.getUniformLocation(this.program, "u_use_diverging"),
      useCircularBfield: gl.getUniformLocation(this.program, "u_use_circular_bfield"),
    };

    this.colorTexture = gl.createTexture();
    this.valueTextureCache = new WeakMap();
    this.lastColorMap = "";
  }

  updateColorTexture() {
    const gl = this.gl;
    const cmap = state.colorMap || "viridis";
    if (this.lastColorMap === cmap) return;
    this.lastColorMap = cmap;

    const width = 256;
    const data = new Uint8Array(width * 3);
    for (let i = 0; i < width; i += 1) {
      const [r, g, b] = colorForNorm(i / (width - 1));
      data[i * 3 + 0] = r;
      data[i * 3 + 1] = g;
      data[i * 3 + 2] = b;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, width, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
  }

  valueTextureFor(values, width, height) {
    const gl = this.gl;
    let rec = this.valueTextureCache.get(values);
    if (rec && rec.width === width && rec.height === height) {
      return rec.texture;
    }

    const texData = values instanceof Float32Array ? values : Float32Array.from(values);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Backend flattens 2D slices as [x, y] C-order (y-fastest). Upload as a
    // texture with swapped width/height so the source buffer can be reused as-is.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, height, width, 0, gl.RED, gl.FLOAT, texData);

    rec = { texture: tex, width, height };
    this.valueTextureCache.set(values, rec);
    return tex;
  }

  render(slice, rangeOverride = null) {
    if (!slice || !Array.isArray(slice.shape) || slice.shape.length !== 2 || !isNumericArrayLike(slice.values)) {
      return null;
    }
    const width = slice.shape[0];
    const height = slice.shape[1];
    const values = slice.values;
    if (width < 1 || height < 1 || values.length !== width * height) return null;

    const fixedStats =
      rangeOverride && isValidRangeStats(rangeOverride)
        ? rangeOverride
        : isValidRangeStats(state.fixedColorRange)
        ? state.fixedColorRange
        : null;
    const sliceStats = isValidRangeStats(slice.stats) ? slice.stats : null;
    const baseStats = fixedStats
      ? { min: fixedStats.min, max: fixedStats.max }
      : sliceStats
      ? { min: sliceStats.min, max: sliceStats.max }
      : minMax(values);
    const mm = resolveColorNormStats(baseStats);
    const minPositive = Math.max(0, mm.min);
    const maxPositive = Math.max(minPositive, mm.max);
    const maxAbs = Math.max(Math.abs(mm.min), Math.abs(mm.max), 1.0e-9);
    const useDiverging = activeColorMapIsDiverging() && mm.min < 0 && mm.max > 0;
    const useCircularBfield = activeColorMapIsCyclic() && isDerivedPolModeActive() && state.derivedPolMode === "bfield";

    const gl = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    this.updateColorTexture();
    const valueTex = this.valueTextureFor(values, width, height);

    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, valueTex);
    gl.uniform1i(this.uniforms.values, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.uniform1i(this.uniforms.cmap, 1);

    gl.uniform1f(this.uniforms.minV, mm.min);
    gl.uniform1f(this.uniforms.maxV, mm.max);
    gl.uniform1f(this.uniforms.maxPositive, maxPositive);
    gl.uniform1f(this.uniforms.minPositive, minPositive);
    gl.uniform1f(this.uniforms.maxAbs, maxAbs);
    gl.uniform1i(this.uniforms.fluxScale, state.fluxScale === "log" ? 1 : state.fluxScale === "sqrt" ? 2 : 0);
    gl.uniform1i(this.uniforms.useDiverging, useDiverging ? 1 : 0);
    gl.uniform1i(this.uniforms.useCircularBfield, useCircularBfield ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    out.getContext("2d").drawImage(this.canvas, 0, 0);
    return out;
  }
}

class GpuRgbRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      depth: false,
      stencil: false,
      desynchronized: true,
    });
    if (!this.gl) throw new Error("WebGL2 not supported");

    const gl = this.gl;
    const vs = `#version 300 es
      precision highp float;
      out vec2 v_uv;
      const vec2 POS[3] = vec2[3](
        vec2(-1.0, -1.0),
        vec2( 3.0, -1.0),
        vec2(-1.0,  3.0)
      );
      void main() {
        vec2 p = POS[gl_VertexID];
        v_uv = 0.5 * (p + 1.0);
        gl_Position = vec4(p, 0.0, 1.0);
      }
    `;
    const fs = `#version 300 es
      precision highp float;
      precision highp sampler2D;
      in vec2 v_uv;
      out vec4 outColor;

      uniform sampler2D u_red;
      uniform sampler2D u_green;
      uniform sampler2D u_blue;
      uniform vec3 u_gain;
      uniform vec2 u_base_range;
      uniform vec2 u_target_range;
      uniform int u_base_flux_scale;
      uniform int u_target_flux_scale;
      uniform float u_chroma_boost;
      uniform float u_brightness_luma_scale;

      const float DYNAMIC_RANGE = 2500.0;

      float rgbLuma(vec3 sampleV) {
        return dot(sampleV, vec3(0.2126, 0.7152, 0.0722));
      }

      float rawFractionFromDisplay(float displayValue, int fluxScale, vec2 rangeWindow) {
        float value = clamp(displayValue, 0.0, 1.0);
        float lo = clamp(rangeWindow.x, 0.0, 1.0);
        float hi = clamp(rangeWindow.y, lo + 1.0e-9, 1.0);
        if (fluxScale == 1) {
          float logLo = lo > 0.0 ? lo : max(hi / DYNAMIC_RANGE, 1.0e-30);
          float logHi = max(hi, logLo * (1.0 + 1.0e-12));
          return clamp(logLo * exp(value * log(logHi / logLo)), 0.0, 1.0);
        }
        float linear = fluxScale == 2 ? value * value : value;
        return clamp(lo + linear * max(1.0e-9, hi - lo), 0.0, 1.0);
      }

      float displayFromRawFraction(float rawFraction, int fluxScale, vec2 rangeWindow) {
        float raw = clamp(rawFraction, 0.0, 1.0);
        float lo = clamp(rangeWindow.x, 0.0, 1.0);
        float hi = clamp(rangeWindow.y, lo + 1.0e-9, 1.0);
        if (fluxScale == 1) {
          float logLo = lo > 0.0 ? lo : max(hi / DYNAMIC_RANGE, 1.0e-30);
          float logHi = max(hi, logLo * (1.0 + 1.0e-12));
          float clipped = clamp(raw, logLo, logHi);
          return clamp(log(clipped / logLo) / max(1.0e-9, log(logHi / logLo)), 0.0, 1.0);
        }
        float linear = clamp((raw - lo) / max(1.0e-9, hi - lo), 0.0, 1.0);
        return fluxScale == 2 ? sqrt(linear) : linear;
      }

      void main() {
        vec2 uv = vec2(1.0 - v_uv.y, v_uv.x);
        vec3 sourceV = vec3(
          texture(u_red, uv).r,
          texture(u_green, uv).r,
          texture(u_blue, uv).r
        );
        float sourceBrightness = rgbLuma(max(sourceV, vec3(0.0))) / max(u_brightness_luma_scale, 1.0e-6);
        float rawFraction = rawFractionFromDisplay(sourceBrightness, u_base_flux_scale, u_base_range);
        float targetBrightness = u_brightness_luma_scale * displayFromRawFraction(rawFraction, u_target_flux_scale, u_target_range);
        vec3 sampleV = max(sourceV * u_gain, vec3(0.0));
        if (abs(u_chroma_boost - 1.0) > 1.0e-6) {
          float gray = (sampleV.r + sampleV.g + sampleV.b) / 3.0;
          sampleV = max(vec3(0.0), vec3(gray) + (sampleV - vec3(gray)) * u_chroma_boost);
        }

        float adjustedLuma = rgbLuma(sampleV);
        if (!(adjustedLuma > 0.0)) {
          outColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        sampleV *= targetBrightness / adjustedLuma;
        outColor = vec4(clamp(sampleV, 0.0, 1.0), 1.0);
      }
    `;

    this.program = createWebGlProgram(gl, vs, fs);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.uniforms = {
      red: gl.getUniformLocation(this.program, "u_red"),
      green: gl.getUniformLocation(this.program, "u_green"),
      blue: gl.getUniformLocation(this.program, "u_blue"),
      gain: gl.getUniformLocation(this.program, "u_gain"),
      baseRange: gl.getUniformLocation(this.program, "u_base_range"),
      targetRange: gl.getUniformLocation(this.program, "u_target_range"),
      baseFluxScale: gl.getUniformLocation(this.program, "u_base_flux_scale"),
      targetFluxScale: gl.getUniformLocation(this.program, "u_target_flux_scale"),
      chromaBoost: gl.getUniformLocation(this.program, "u_chroma_boost"),
      brightnessLumaScale: gl.getUniformLocation(this.program, "u_brightness_luma_scale"),
    };

    this.valueTextureCache = new WeakMap();
  }

  valueTextureFor(values, width, height) {
    const gl = this.gl;
    let rec = this.valueTextureCache.get(values);
    if (rec && rec.width === width && rec.height === height) {
      return rec.texture;
    }

    const texData = values instanceof Float32Array ? values : Float32Array.from(values);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, height, width, 0, gl.RED, gl.FLOAT, texData);

    rec = { texture: tex, width, height };
    this.valueTextureCache.set(values, rec);
    return tex;
  }

  render(width, height, redVals, greenVals, blueVals, preview = null) {
    if (width < 1 || height < 1) return null;
    if (!isNumericArrayLike(redVals) || !isNumericArrayLike(greenVals) || !isNumericArrayLike(blueVals)) return null;
    if (redVals.length !== width * height || greenVals.length !== width * height || blueVals.length !== width * height) return null;

    const gainR = Number.isFinite(preview?.gains?.[0]) ? preview.gains[0] : 1;
    const gainG = Number.isFinite(preview?.gains?.[1]) ? preview.gains[1] : 1;
    const gainB = Number.isFinite(preview?.gains?.[2]) ? preview.gains[2] : 1;
    const chromaBoost = Number.isFinite(preview?.chromaBoost) ? preview.chromaBoost : 1;
    const brightnessLumaScale = Number.isFinite(preview?.brightnessLumaScale)
      ? Math.max(1.0e-6, Math.min(1, preview.brightnessLumaScale))
      : 1;
    const baseFluxScale = preview?.baseFluxScale === "log" ? 1 : preview?.baseFluxScale === "sqrt" ? 2 : 0;
    const targetFluxScale = preview?.targetFluxScale === "log" ? 1 : preview?.targetFluxScale === "sqrt" ? 2 : 0;
    const baseRange = preview?.baseRange || { min: 0, max: 1 };
    const targetRange = preview?.targetRange || baseRange;

    const gl = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;

    const texR = this.valueTextureFor(redVals, width, height);
    const texG = this.valueTextureFor(greenVals, width, height);
    const texB = this.valueTextureFor(blueVals, width, height);

    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texR);
    gl.uniform1i(this.uniforms.red, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texG);
    gl.uniform1i(this.uniforms.green, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform1i(this.uniforms.blue, 2);

    gl.uniform3f(this.uniforms.gain, gainR, gainG, gainB);
    gl.uniform2f(this.uniforms.baseRange, Number.isFinite(baseRange.min) ? baseRange.min : 0, Number.isFinite(baseRange.max) ? baseRange.max : 1);
    gl.uniform2f(this.uniforms.targetRange, Number.isFinite(targetRange.min) ? targetRange.min : 0, Number.isFinite(targetRange.max) ? targetRange.max : 1);
    gl.uniform1i(this.uniforms.baseFluxScale, baseFluxScale);
    gl.uniform1i(this.uniforms.targetFluxScale, targetFluxScale);
    gl.uniform1f(this.uniforms.chromaBoost, chromaBoost);
    gl.uniform1f(this.uniforms.brightnessLumaScale, brightnessLumaScale);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    out.getContext("2d").drawImage(this.canvas, 0, 0);
    return out;
  }
}

class GpuVolumeRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      depth: false,
      stencil: false,
      desynchronized: true,
    });
    if (!this.gl) throw new Error("WebGL2 not supported");

    const gl = this.gl;
    const vs = `#version 300 es
      precision highp float;
      out vec2 v_uv;
      const vec2 POS[3] = vec2[3](
        vec2(-1.0, -1.0),
        vec2( 3.0, -1.0),
        vec2(-1.0,  3.0)
      );
      void main() {
        vec2 p = POS[gl_VertexID];
        v_uv = 0.5 * (p + 1.0);
        gl_Position = vec4(p, 0.0, 1.0);
      }
    `;
    const fs = `#version 300 es
      precision highp float;
      precision highp sampler3D;
      in vec2 v_uv;
      out vec4 outColor;

      uniform sampler3D u_volume;
      uniform sampler2D u_cmap;
      uniform float u_min_v;
      uniform float u_max_v;
      uniform float u_max_positive;
      uniform float u_min_positive;
      uniform float u_max_abs;
      uniform int u_steps;
      uniform int u_flux_scale;
      uniform int u_use_diverging_density;
      uniform int u_use_bfield_circular_density;
      uniform int u_render_mode;
      uniform int u_tf_mode;
      uniform float u_iso_threshold;
      uniform float u_clip_near;
      uniform float u_clip_far;
      uniform float u_opacity;
      uniform float u_gamma;
      uniform float u_cutoff;
      uniform mat3 u_volume_rot;
      uniform float u_zoom;
      uniform int u_sphere_projection;
      uniform float u_sphere_inside_scale;
      uniform int u_sphere_nside;
      uniform int u_out_width;
      uniform int u_out_height;

      const int MAX_STEPS = ${GPU_VOLUME_MAX_STEPS};
      const float PI = 3.14159265358979323846;
      const float SQRT2 = 1.4142135623730950488;

      float clamp01(float v) {
        return clamp(v, 0.0, 1.0);
      }

      vec3 rotatePos(vec3 p) {
        return u_volume_rot * p;
      }

      float sampleVolume(vec3 uvw) {
        return texture(u_volume, vec3(uvw.z, uvw.y, uvw.x)).r;
      }

      float sampleToNorm(float sampleV) {
        float minv = u_min_v;
        float maxv = max(u_max_v, minv + 1e-6);
        if (u_flux_scale == 1) {
          float lo = max(0.0, u_min_positive);
          if (sampleV < 0.0 && lo <= 0.0) return 0.0;
          float hi = max(lo, u_max_positive);
          if (!(hi > 0.0)) return 0.0;
          float loEff = lo > 0.0 ? min(lo, hi) : max(hi * 1.0e-6, 1.0e-30);
          if (!(hi > loEff)) return 0.0;
          float v = clamp(sampleV, loEff, hi);
          float loL = log(loEff);
          float hiL = log(hi);
          return (log(v) - loL) / max(1e-6, hiL - loL);
        }
        if (u_flux_scale == 2) {
          if (u_use_bfield_circular_density == 1) {
            float a = mod(sampleV, 180.0);
            if (a < 0.0) a += 180.0;
            return a / 180.0;
          }
          if (u_use_diverging_density == 1) {
            float maxAbs = max(u_max_abs, 1.0e-9);
            float maxAbsSqrt = sqrt(maxAbs);
            float transformed = sign(sampleV) * sqrt(abs(sampleV));
            return (transformed + maxAbsSqrt) / max(1.0e-6, 2.0 * maxAbsSqrt);
          }
          float t = clamp((sampleV - minv) / (maxv - minv), 0.0, 1.0);
          return sqrt(t);
        }
        if (u_use_bfield_circular_density == 1) {
          float a = mod(sampleV, 180.0);
          if (a < 0.0) a += 180.0;
          return a / 180.0;
        }
        if (u_use_diverging_density == 1) {
          float maxAbs = max(u_max_abs, 1.0e-9);
          return (sampleV + maxAbs) / (2.0 * maxAbs);
        }
        return (sampleV - minv) / (maxv - minv);
      }

      float applyTf(float x) {
        x = clamp01(x);
        if (u_tf_mode == 1) return sqrt(x);
        if (u_tf_mode == 2) return x * x;
        if (u_tf_mode == 3) return 1.0 / (1.0 + exp(-10.0 * (x - 0.5)));
        return x;
      }

      bool sphereCameraRay(float px, float py, out vec3 cam) {
        float w = float(max(1, u_out_width));
        float h = float(max(1, u_out_height));
        if (u_sphere_projection == 1) {
          float nx = px / max(1.0, w - 1.0);
          float ny = py / max(1.0, h - 1.0);
          float u = (nx - 0.5) / max(1.0e-6, u_sphere_inside_scale);
          float v = (0.5 - ny) / max(1.0e-6, u_sphere_inside_scale);
          float inv = inversesqrt(1.0 + u * u + v * v);
          cam = vec3(inv, u * inv, v * inv);
          return true;
        }

        float xProj = (px / max(1.0, w - 1.0)) * (4.0 * SQRT2) - 2.0 * SQRT2;
        float yProj = SQRT2 - (py / max(1.0, h - 1.0)) * (2.0 * SQRT2);
        float xn = xProj / (2.0 * SQRT2);
        float yn = yProj / SQRT2;
        if (xn * xn + yn * yn > 1.0) return false;
        float theta = asin(clamp(yProj / SQRT2, -1.0, 1.0));
        float ct = cos(theta);
        float lon = 0.0;
        if (abs(ct) > 1.0e-8) lon = (PI * xProj) / (2.0 * SQRT2 * ct);
        lon = clamp(lon, -PI, PI);
        float lat = asin(clamp((2.0 * theta + sin(2.0 * theta)) / PI, -1.0, 1.0));
        float cl = cos(lat);
        cam = vec3(cl * cos(lon), cl * sin(lon), sin(lat));
        return true;
      }

      vec3 quantizeSphereDir(vec3 dir) {
        int nside = max(1, u_sphere_nside);
        float lon = atan(dir.y, dir.x);
        if (lon < 0.0) lon += 2.0 * PI;
        float lat = asin(clamp(dir.z, -1.0, 1.0));
        float nLon = float(max(4, 4 * nside));
        float nLat = float(max(3, 3 * nside));
        float iLon = floor((lon / (2.0 * PI)) * nLon);
        float iLat = floor(((lat + 0.5 * PI) / PI) * nLat);
        iLon = clamp(iLon, 0.0, nLon - 1.0);
        iLat = clamp(iLat, 0.0, nLat - 1.0);
        float lonC = ((iLon + 0.5) / nLon) * (2.0 * PI);
        float latC = ((iLat + 0.5) / nLat) * PI - 0.5 * PI;
        float cl = cos(latC);
        return vec3(cl * cos(lonC), cl * sin(lonC), sin(latC));
      }

      void main() {
        float u = v_uv.x * 2.0 - 1.0;
        float v = v_uv.y * 2.0 - 1.0;
        float alphaBase = clamp((2.4 / max(24.0, float(u_steps))) * u_opacity, 0.004, 0.34);
        bool sphericalMode = (u_render_mode == 5);
        vec3 sphericalDir = vec3(1.0, 0.0, 0.0);
        float sphericalExit = 1.0;
        if (sphericalMode) {
          float px = gl_FragCoord.x - 0.5;
          float py = float(max(1, u_out_height)) - gl_FragCoord.y - 0.5;
          vec3 camRay;
          if (!sphereCameraRay(px, py, camRay)) {
            outColor = vec4(0.0);
            return;
          }
          sphericalDir = normalize(rotatePos(camRay));
          sphericalDir = quantizeSphereDir(sphericalDir);
          sphericalExit = 1.0 / max(max(abs(sphericalDir.x), abs(sphericalDir.y)), abs(sphericalDir.z));
        }

        vec3 rgbAcc = vec3(0.0);
        float aAcc = 0.0;
        float bestMax = -1e20;
        float bestMin = 1e20;
        float sumNorm = 0.0;
        float sumCount = 0.0;
        float validCount = 0.0;
        vec3 isoColor = vec3(0.0);
        float isoHit = 0.0;

        for (int i = 0; i < MAX_STEPS; i += 1) {
          if (i >= u_steps) break;
          float f = float(i) / max(1.0, float(u_steps - 1));
          if (f < u_clip_near || f > u_clip_far) continue;

          vec3 pos;
          if (sphericalMode) {
            pos = sphericalDir * (sphericalExit * f);
          } else {
            float depth = -1.15 + f * 2.3;
            float planeScale = 1.05 / max(0.15, u_zoom);
            float aspect = float(max(1, u_out_width)) / float(max(1, u_out_height));
            pos = rotatePos(vec3(u * planeScale * aspect, -v * planeScale, depth));
          }
          if (abs(pos.x) > 1.0 || abs(pos.y) > 1.0 || abs(pos.z) > 1.0) continue;

          vec3 uvw = pos * 0.5 + 0.5;
          float sampleV = sampleVolume(uvw);
          if (isnan(sampleV) || isinf(sampleV)) continue;
          float norm = sampleToNorm(sampleV);
          if (norm < 0.0) continue;
          norm = clamp01(norm);
          validCount += 1.0;

          vec3 color = texture(u_cmap, vec2(norm, 0.5)).rgb;
          float density;
          if (u_use_diverging_density == 1) {
            density = abs(norm * 2.0 - 1.0);
          } else if (u_use_bfield_circular_density == 1) {
            density = 0.58;
          } else {
            density = norm;
          }

          if (u_render_mode == 1) {
            if (norm > bestMax) {
              bestMax = norm;
              rgbAcc = color;
            }
            continue;
          }
          if (u_render_mode == 2) {
            if (norm < bestMin) {
              bestMin = norm;
              rgbAcc = color;
            }
            continue;
          }
          if (u_render_mode == 3) {
            sumNorm += norm;
            sumCount += 1.0;
            continue;
          }
          if (u_render_mode == 4) {
            if (isoHit > 0.5) continue;
            if (density < u_iso_threshold) continue;
            float eps = 1.0 / 128.0;
            vec3 ex = vec3(eps, 0.0, 0.0);
            vec3 ey = vec3(0.0, eps, 0.0);
            vec3 ez = vec3(0.0, 0.0, eps);
            float gx = sampleVolume(clamp(uvw + ex, 0.0, 1.0)) - sampleVolume(clamp(uvw - ex, 0.0, 1.0));
            float gy = sampleVolume(clamp(uvw + ey, 0.0, 1.0)) - sampleVolume(clamp(uvw - ey, 0.0, 1.0));
            float gz = sampleVolume(clamp(uvw + ez, 0.0, 1.0)) - sampleVolume(clamp(uvw - ez, 0.0, 1.0));
            vec3 nrm = normalize(vec3(gx, gy, gz) + vec3(1e-6));
            vec3 lightDir = normalize(vec3(0.58, 0.50, 0.65));
            float shade = 0.32 + 0.68 * max(0.0, dot(nrm, lightDir));
            isoColor = color * shade;
            isoHit = 1.0;
            continue;
          }

          float dn = clamp01((density - u_cutoff) / max(1e-6, 1.0 - u_cutoff));
          if (dn <= 0.0) continue;
          float shaped = applyTf(pow(dn, u_gamma));
          float depthBoost = sphericalMode ? (0.90 + 0.18 * f) : (0.86 + 0.24 * f);
          float a = clamp(shaped * alphaBase, 0.0, 0.35);

          float rem = 1.0 - aAcc;
          rgbAcc += rem * a * clamp(color * depthBoost, 0.0, 1.0);
          aAcc += rem * a;
          if (aAcc >= 0.985) break;
        }

        if (u_render_mode == 1) {
          outColor = vec4(rgbAcc, bestMax > -1e19 ? 1.0 : 0.0);
          return;
        }
        if (u_render_mode == 2) {
          outColor = vec4(rgbAcc, bestMin < 1e19 ? 1.0 : 0.0);
          return;
        }
        if (u_render_mode == 3) {
          if (sumCount > 0.0) {
            float av = clamp01(sumNorm / sumCount);
            outColor = vec4(texture(u_cmap, vec2(av, 0.5)).rgb, 1.0);
          } else {
            outColor = vec4(0.0);
          }
          return;
        }
        if (u_render_mode == 4) {
          outColor = vec4(isoColor, isoHit);
          return;
        }

        outColor = vec4(rgbAcc, validCount > 0.0 ? aAcc : 0.0);
      }
    `;
    this.program = createWebGlProgram(gl, vs, fs);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.uniforms = {
      volume: gl.getUniformLocation(this.program, "u_volume"),
      cmap: gl.getUniformLocation(this.program, "u_cmap"),
      minV: gl.getUniformLocation(this.program, "u_min_v"),
      maxV: gl.getUniformLocation(this.program, "u_max_v"),
      maxPositive: gl.getUniformLocation(this.program, "u_max_positive"),
      minPositive: gl.getUniformLocation(this.program, "u_min_positive"),
      maxAbs: gl.getUniformLocation(this.program, "u_max_abs"),
      steps: gl.getUniformLocation(this.program, "u_steps"),
      fluxScale: gl.getUniformLocation(this.program, "u_flux_scale"),
      useDivergingDensity: gl.getUniformLocation(this.program, "u_use_diverging_density"),
      useBfieldCircularDensity: gl.getUniformLocation(this.program, "u_use_bfield_circular_density"),
      renderMode: gl.getUniformLocation(this.program, "u_render_mode"),
      tfMode: gl.getUniformLocation(this.program, "u_tf_mode"),
      isoThreshold: gl.getUniformLocation(this.program, "u_iso_threshold"),
      clipNear: gl.getUniformLocation(this.program, "u_clip_near"),
      clipFar: gl.getUniformLocation(this.program, "u_clip_far"),
      opacity: gl.getUniformLocation(this.program, "u_opacity"),
      gamma: gl.getUniformLocation(this.program, "u_gamma"),
      cutoff: gl.getUniformLocation(this.program, "u_cutoff"),
      volumeRot: gl.getUniformLocation(this.program, "u_volume_rot"),
      zoom: gl.getUniformLocation(this.program, "u_zoom"),
      sphereProjection: gl.getUniformLocation(this.program, "u_sphere_projection"),
      sphereInsideScale: gl.getUniformLocation(this.program, "u_sphere_inside_scale"),
      sphereNside: gl.getUniformLocation(this.program, "u_sphere_nside"),
      outWidth: gl.getUniformLocation(this.program, "u_out_width"),
      outHeight: gl.getUniformLocation(this.program, "u_out_height"),
    };

    this.colorTexture = gl.createTexture();
    this.volumeTextureCache = new WeakMap();
    this.lastColorMap = "";
  }

  updateColorTexture() {
    const gl = this.gl;
    const cmap = state.colorMap || "viridis";
    if (this.lastColorMap === cmap) return;
    this.lastColorMap = cmap;

    const width = 256;
    const data = new Uint8Array(width * 3);
    for (let i = 0; i < width; i += 1) {
      const [r, g, b] = colorForNorm(i / (width - 1));
      data[i * 3 + 0] = r;
      data[i * 3 + 1] = g;
      data[i * 3 + 2] = b;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, width, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
  }

  volumeTextureFor(volume) {
    const gl = this.gl;
    const nx = volume.shape[0];
    const ny = volume.shape[1];
    const nz = volume.shape[2];
    let rec = this.volumeTextureCache.get(volume);
    if (rec && rec.nx === nx && rec.ny === ny && rec.nz === nz) {
      return rec.texture;
    }

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    const typed = volume.values instanceof Float32Array ? volume.values : Float32Array.from(volume.values);
    // Backend flattens volumes as [x, y, z] C-order (z-fastest). Upload with
    // swapped texture dimensions (width=z, height=y, depth=x) so the source
    // buffer can be reused without a CPU-side repack.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32F, nz, ny, nx, 0, gl.RED, gl.FLOAT, typed);
    rec = { texture: tex, nx, ny, nz };
    this.volumeTextureCache.set(volume, rec);
    return tex;
  }

  render(volume, resolution, rangeOverride = null, outputAspect = 1.0) {
    const gl = this.gl;
    if (!volume || !Array.isArray(volume.shape) || volume.shape.length !== 3 || !isNumericArrayLike(volume.values)) {
      return null;
    }
    const nx = volume.shape[0];
    const ny = volume.shape[1];
    const nz = volume.shape[2];
    if (nx < 2 || ny < 2 || nz < 2 || volume.values.length !== nx * ny * nz) return null;
    const sphericalMode = state.volumeRender && state.volumeRender.mode === "spherical";
    const sphereProjection = state.volumeRender && state.volumeRender.sphereProjection === "inside" ? "inside" : "mollweide";
    let outWidth = resolution;
    let outHeight = resolution;
    if (sphericalMode && sphereProjection === "mollweide") {
      outWidth = resolution * 2;
      outHeight = resolution;
    } else if (!sphericalMode) {
      const aspect = Number.isFinite(outputAspect) && outputAspect > 0 ? outputAspect : 1.0;
      const area = Math.max(64, resolution * resolution);
      outWidth = clamp(Math.round(Math.sqrt(area * aspect)), 64, 4096);
      outHeight = clamp(Math.round(Math.sqrt(area / Math.max(1.0e-6, aspect))), 64, 4096);
    }
    const sphereProjectionMode = sphereProjection === "inside" ? 1 : 0;
    const sphereInsideScale = Math.max(
      0.1,
      Math.min(3.6, 0.45 * Math.max(GPU_VOLUME_ZOOM_MIN, Math.min(GPU_VOLUME_ZOOM_MAX, state.volumeZoom || 1)))
    );
    const sphereNside = Math.max(1, Math.min(512, Math.round(Number.parseInt(state.volumeRender?.sphereNsite, 10) || 32)));

    this.canvas.width = outWidth;
    this.canvas.height = outHeight;
    this.updateColorTexture();
    const volumeTex = this.volumeTextureFor(volume);

    const fixedStats =
      rangeOverride && isValidRangeStats(rangeOverride)
        ? rangeOverride
        : isValidRangeStats(state.fixedColorRange)
        ? state.fixedColorRange
        : null;
    const stats = fixedStats
      ? { min: fixedStats.min, max: fixedStats.max }
      : volume.stats && Number.isFinite(volume.stats.min) && Number.isFinite(volume.stats.max)
      ? { min: volume.stats.min, max: volume.stats.max }
      : minMax(volume.values);
    const normalizedStats = resolveColorNormStats(stats);
    const mmMin = Number.isFinite(normalizedStats.min) ? normalizedStats.min : 0;
    const mmMax = Number.isFinite(normalizedStats.max) ? normalizedStats.max : 1;
    const minPositive = Math.max(0, mmMin);
    const maxPositive = Math.max(minPositive, mmMax);
    const maxAbs = Math.max(Math.abs(mmMin), Math.abs(mmMax), 1.0e-9);
    const qCfg = volumeQualityConfig();
    const steps = clamp(Math.round(Math.max(nx, ny, nz) * qCfg.stepMul), 24, GPU_VOLUME_MAX_STEPS);
    const isDiverging = activeColorMapIsDiverging() && mmMin < 0 && mmMax > 0;
    const isBfieldCircular = activeColorMapIsCyclic() && isDerivedPolModeActive() && state.derivedPolMode === "bfield";

    gl.viewport(0, 0, outWidth, outHeight);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, volumeTex);
    gl.uniform1i(this.uniforms.volume, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTexture);
    gl.uniform1i(this.uniforms.cmap, 1);

    gl.uniform1f(this.uniforms.minV, mmMin);
    gl.uniform1f(this.uniforms.maxV, mmMax);
    gl.uniform1f(this.uniforms.maxPositive, maxPositive);
    gl.uniform1f(this.uniforms.minPositive, minPositive);
    gl.uniform1f(this.uniforms.maxAbs, maxAbs);
    gl.uniform1i(this.uniforms.steps, steps);
    gl.uniform1i(this.uniforms.fluxScale, state.fluxScale === "log" ? 1 : state.fluxScale === "sqrt" ? 2 : 0);
    gl.uniform1i(this.uniforms.useDivergingDensity, isDiverging ? 1 : 0);
    gl.uniform1i(this.uniforms.useBfieldCircularDensity, isBfieldCircular ? 1 : 0);
    gl.uniform1i(this.uniforms.renderMode, volumeRenderModeInt());
    gl.uniform1i(this.uniforms.tfMode, volumeTfModeInt());
    gl.uniform1f(this.uniforms.isoThreshold, clamp(state.volumeRender.isoThreshold, 0.01, 0.99));
    const clipNear = sphericalMode ? clamp(state.volumeRender.clipNear, 0, 0.999) : clamp(state.volumeRender.clipNear, 0, 0.95);
    const clipFar = sphericalMode
      ? clamp(state.volumeRender.clipFar, clipNear + 0.001, 1.0)
      : clamp(state.volumeRender.clipFar, 0.05, 1.0);
    gl.uniform1f(this.uniforms.clipNear, clipNear);
    gl.uniform1f(this.uniforms.clipFar, clipFar);
    gl.uniform1f(this.uniforms.opacity, clamp(state.volumeRender.opacity, 0.1, 12.0));
    gl.uniform1f(this.uniforms.gamma, clamp(state.volumeRender.gamma, 0.4, 2.4));
    gl.uniform1f(this.uniforms.cutoff, 0.0);
    const volumeRotRowMajor =
      (Array.isArray(state.volumeRotationMatrix) || ArrayBuffer.isView(state.volumeRotationMatrix)) &&
      state.volumeRotationMatrix.length >= 9
        ? state.volumeRotationMatrix
        : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const volumeRot = [
      volumeRotRowMajor[0],
      volumeRotRowMajor[3],
      volumeRotRowMajor[6],
      volumeRotRowMajor[1],
      volumeRotRowMajor[4],
      volumeRotRowMajor[7],
      volumeRotRowMajor[2],
      volumeRotRowMajor[5],
      volumeRotRowMajor[8],
    ];
    gl.uniformMatrix3fv(this.uniforms.volumeRot, false, volumeRot);
    gl.uniform1f(this.uniforms.zoom, clamp(state.volumeZoom, GPU_VOLUME_ZOOM_MIN, GPU_VOLUME_ZOOM_MAX));
    gl.uniform1i(this.uniforms.sphereProjection, sphereProjectionMode);
    gl.uniform1f(this.uniforms.sphereInsideScale, sphereInsideScale);
    gl.uniform1i(this.uniforms.sphereNside, sphereNside);
    gl.uniform1i(this.uniforms.outWidth, outWidth);
    gl.uniform1i(this.uniforms.outHeight, outHeight);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const out = document.createElement("canvas");
    out.width = outWidth;
    out.height = outHeight;
    out.getContext("2d").drawImage(this.canvas, 0, 0);
    return out;
  }
}


  return { GpuSliceRenderer, GpuRgbRenderer, GpuVolumeRenderer, GpuSphereRenderer, GPU_VOLUME_MAX_STEPS };
}
