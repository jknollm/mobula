export function createGpuRenderers(deps) {
  const {
    state,
    colorForNorm,
    isValidRangeStats,
    minMax,
    volumeQualityConfig,
    clamp,
    isDerivedPolModeActive,
    volumeRenderModeInt,
    volumeTfModeInt,
  } = deps;

const GPU_VOLUME_MAX_STEPS = 192;

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

class GpuSliceRenderer {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
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
      uniform int u_flux_scale;

      void main() {
        float sampleV = texture(u_values, vec2(v_uv.x, 1.0 - v_uv.y)).r;
        float norm;
        if (u_flux_scale == 1) {
          if (sampleV < 0.0 || u_max_positive <= 0.0) {
            outColor = vec4(1.0, 1.0, 1.0, 1.0);
            return;
          }
          norm = log(1.0 + sampleV) / log(1.0 + u_max_positive);
        } else {
          float span = max(u_max_v - u_min_v, 1e-6);
          norm = (sampleV - u_min_v) / span;
        }
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
      fluxScale: gl.getUniformLocation(this.program, "u_flux_scale"),
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

    const texData = new Float32Array(width * height);
    for (let x = 0; x < width; x += 1) {
      const srcBase = x * height;
      for (let y = 0; y < height; y += 1) {
        texData[y * width + x] = values[srcBase + y];
      }
    }

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, texData);

    rec = { texture: tex, width, height };
    this.valueTextureCache.set(values, rec);
    return tex;
  }

  render(slice, rangeOverride = null) {
    if (!slice || !Array.isArray(slice.shape) || slice.shape.length !== 2 || !slice.values || !Number.isFinite(slice.values.length)) {
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
    const mm = fixedStats
      ? { min: fixedStats.min, max: fixedStats.max }
      : sliceStats
      ? { min: sliceStats.min, max: sliceStats.max }
      : minMax(values);
    const maxPositive = fixedStats ? Math.max(0, fixedStats.max) : Math.max(0, sliceStats ? sliceStats.max : mm.max);

    const gl = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    this.updateColorTexture();
    const valueTex = this.valueTextureFor(values, width, height);

    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
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
    gl.uniform1i(this.uniforms.fluxScale, state.fluxScale === "log" ? 1 : 0);

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
      alpha: false,
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
      uniform float u_yaw;
      uniform float u_pitch;
      uniform float u_zoom;

      const int MAX_STEPS = ${GPU_VOLUME_MAX_STEPS};

      float clamp01(float v) {
        return clamp(v, 0.0, 1.0);
      }

      vec3 rotatePos(vec3 p) {
        float cy = cos(u_yaw);
        float sy = sin(u_yaw);
        float cp = cos(u_pitch);
        float sp = sin(u_pitch);

        float x1 = p.x;
        float y1 = p.y * cp + p.z * sp;
        float z1 = -p.y * sp + p.z * cp;
        return vec3(
          x1 * cy - z1 * sy,
          y1,
          x1 * sy + z1 * cy
        );
      }

      float sampleToNorm(float sampleV) {
        float minv = u_min_v;
        float maxv = max(u_max_v, minv + 1e-6);
        if (u_flux_scale == 1) {
          if (sampleV < 0.0 || u_max_positive <= 0.0) return -1.0;
          return log(1.0 + sampleV) / log(1.0 + u_max_positive);
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

      void main() {
        float u = v_uv.x * 2.0 - 1.0;
        float v = v_uv.y * 2.0 - 1.0;
        float alphaBase = clamp((2.4 / max(24.0, float(u_steps))) * u_opacity, 0.004, 0.34);

        vec3 rgbAcc = vec3(0.0);
        float aAcc = 0.0;
        float bestMax = -1e20;
        float bestMin = 1e20;
        float sumNorm = 0.0;
        float sumCount = 0.0;
        vec3 isoColor = vec3(0.0);
        float isoHit = 0.0;

        for (int i = 0; i < MAX_STEPS; i += 1) {
          if (i >= u_steps) break;
          float f = float(i) / max(1.0, float(u_steps - 1));
          if (f < u_clip_near || f > u_clip_far) continue;

          float depth = -1.15 + f * 2.3;
          float planeScale = 1.05 / max(0.15, u_zoom);
          vec3 pos = rotatePos(vec3(u * planeScale, -v * planeScale, depth));
          if (abs(pos.x) > 1.0 || abs(pos.y) > 1.0 || abs(pos.z) > 1.0) continue;

          vec3 uvw = pos * 0.5 + 0.5;
          float sampleV = texture(u_volume, uvw).r;
          float norm = sampleToNorm(sampleV);
          if (norm < 0.0) continue;
          norm = clamp01(norm);

          vec3 color = texture(u_cmap, vec2(norm, 0.5)).rgb;
          float density;
          if (u_use_diverging_density == 1) {
            density = abs(sampleV) / max(u_max_abs, 1e-9);
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
            float gx = texture(u_volume, clamp(uvw + ex, 0.0, 1.0)).r - texture(u_volume, clamp(uvw - ex, 0.0, 1.0)).r;
            float gy = texture(u_volume, clamp(uvw + ey, 0.0, 1.0)).r - texture(u_volume, clamp(uvw - ey, 0.0, 1.0)).r;
            float gz = texture(u_volume, clamp(uvw + ez, 0.0, 1.0)).r - texture(u_volume, clamp(uvw - ez, 0.0, 1.0)).r;
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
          float depthBoost = 0.86 + 0.24 * f;
          float a = clamp(shaped * alphaBase, 0.0, 0.35);

          float rem = 1.0 - aAcc;
          rgbAcc += rem * a * clamp(color * depthBoost, 0.0, 1.0);
          aAcc += rem * a;
          if (aAcc >= 0.985) break;
        }

        if (u_render_mode == 1) {
          outColor = vec4(rgbAcc, 1.0);
          return;
        }
        if (u_render_mode == 2) {
          outColor = vec4(rgbAcc, 1.0);
          return;
        }
        if (u_render_mode == 3) {
          if (sumCount > 0.0) {
            float av = clamp01(sumNorm / sumCount);
            outColor = vec4(texture(u_cmap, vec2(av, 0.5)).rgb, 1.0);
          } else {
            outColor = vec4(0.0, 0.0, 0.0, 1.0);
          }
          return;
        }
        if (u_render_mode == 4) {
          outColor = vec4(isoColor, 1.0);
          return;
        }

        outColor = vec4(rgbAcc, 1.0);
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
      yaw: gl.getUniformLocation(this.program, "u_yaw"),
      pitch: gl.getUniformLocation(this.program, "u_pitch"),
      zoom: gl.getUniformLocation(this.program, "u_zoom"),
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
    const src = volume.values instanceof Float32Array ? volume.values : Float32Array.from(volume.values);
    // Backend flattens as [x, y, z] in C-order (z-fastest).
    // WebGL texImage3D expects x-fastest packing for (width=nx, height=ny, depth=nz).
    // Repack once into [z, y, x] C-order so texture sampling maps uvw=(x,y,z) correctly.
    const typed = new Float32Array(nx * ny * nz);
    for (let z = 0; z < nz; z += 1) {
      const zOff = z * nx * ny;
      for (let y = 0; y < ny; y += 1) {
        const yzOff = zOff + y * nx;
        for (let x = 0; x < nx; x += 1) {
          const srcIdx = (x * ny + y) * nz + z;
          typed[yzOff + x] = src[srcIdx];
        }
      }
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32F, nx, ny, nz, 0, gl.RED, gl.FLOAT, typed);
    rec = { texture: tex, nx, ny, nz };
    this.volumeTextureCache.set(volume, rec);
    return tex;
  }

  render(volume, resolution) {
    const gl = this.gl;
    if (!volume || !Array.isArray(volume.shape) || volume.shape.length !== 3 || !Array.isArray(volume.values)) {
      return null;
    }
    const nx = volume.shape[0];
    const ny = volume.shape[1];
    const nz = volume.shape[2];
    if (nx < 2 || ny < 2 || nz < 2 || volume.values.length !== nx * ny * nz) return null;

    this.canvas.width = resolution;
    this.canvas.height = resolution;
    this.updateColorTexture();
    const volumeTex = this.volumeTextureFor(volume);

    const stats = volume.stats && Number.isFinite(volume.stats.min) && Number.isFinite(volume.stats.max)
      ? { min: volume.stats.min, max: volume.stats.max }
      : minMax(volume.values);
    const mmMin = Number.isFinite(stats.min) ? stats.min : 0;
    const mmMax = Number.isFinite(stats.max) ? stats.max : 1;
    const maxPositive = Math.max(0, mmMax);
    const maxAbs = Math.max(Math.abs(mmMin), Math.abs(mmMax), 1.0e-9);
    const qCfg = volumeQualityConfig();
    const steps = clamp(Math.round(Math.max(nx, ny, nz) * qCfg.stepMul), 24, GPU_VOLUME_MAX_STEPS);
    const isDiverging = state.colorMap === "diverging" && mmMin < 0 && mmMax > 0;
    const isBfieldCircular = state.colorMap === "circular" && isDerivedPolModeActive() && state.derivedPolMode === "bfield";

    gl.viewport(0, 0, resolution, resolution);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
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
    gl.uniform1f(this.uniforms.maxAbs, maxAbs);
    gl.uniform1i(this.uniforms.steps, steps);
    gl.uniform1i(this.uniforms.fluxScale, state.fluxScale === "log" ? 1 : 0);
    gl.uniform1i(this.uniforms.useDivergingDensity, isDiverging ? 1 : 0);
    gl.uniform1i(this.uniforms.useBfieldCircularDensity, isBfieldCircular ? 1 : 0);
    gl.uniform1i(this.uniforms.renderMode, volumeRenderModeInt());
    gl.uniform1i(this.uniforms.tfMode, volumeTfModeInt());
    gl.uniform1f(this.uniforms.isoThreshold, clamp(state.volumeRender.isoThreshold, 0.01, 0.99));
    gl.uniform1f(this.uniforms.clipNear, clamp(state.volumeRender.clipNear, 0, 0.95));
    gl.uniform1f(this.uniforms.clipFar, clamp(state.volumeRender.clipFar, 0.05, 1.0));
    gl.uniform1f(this.uniforms.opacity, clamp(state.volumeRender.opacity, 0.1, 12.0));
    gl.uniform1f(this.uniforms.gamma, clamp(state.volumeRender.gamma, 0.4, 2.4));
    gl.uniform1f(this.uniforms.cutoff, clamp(state.volumeRender.cutoff, 0, 0.9));
    gl.uniform1f(this.uniforms.yaw, state.volumeYaw);
    gl.uniform1f(this.uniforms.pitch, state.volumePitch);
    gl.uniform1f(this.uniforms.zoom, clamp(state.volumeZoom, 0.35, 10.0));

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const out = document.createElement("canvas");
    out.width = resolution;
    out.height = resolution;
    out.getContext("2d").drawImage(this.canvas, 0, 0);
    return out;
  }
}


  return { GpuSliceRenderer, GpuVolumeRenderer, GPU_VOLUME_MAX_STEPS };
}
