export function normalizeComputeBackendPreference(raw) {
  const value = String(raw || "auto").trim().toLowerCase();
  if (["auto", "cpu", "native", "cuda", "metal"].includes(value)) return value;
  if (value === "gpu") return "native";
  return "auto";
}

export function probeRenderCapabilities() {
  const out = {
    webgl2: {
      supported: false,
      reason: null,
    },
    webgpu: {
      supported: false,
      reason: null,
      experimental: true,
    },
  };

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      depth: false,
      desynchronized: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (gl) {
      out.webgl2.supported = true;
      out.webgl2.reason = null;
      const renderer = gl.getParameter(gl.RENDERER);
      if (renderer) out.webgl2.renderer = String(renderer);
      const vendor = gl.getParameter(gl.VENDOR);
      if (vendor) out.webgl2.vendor = String(vendor);
    } else {
      out.webgl2.reason = "WebGL2 is unavailable in this browser";
    }
  } catch (err) {
    out.webgl2.reason = err && err.message ? err.message : String(err);
  }

  try {
    if (navigator && "gpu" in navigator && navigator.gpu) {
      out.webgpu.supported = true;
      out.webgpu.reason = null;
    } else {
      out.webgpu.reason = "WebGPU is not exposed by this browser";
    }
  } catch (err) {
    out.webgpu.reason = err && err.message ? err.message : String(err);
  }

  return out;
}
