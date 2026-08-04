function extractPerfHeaders(res) {
  return {
    cache: res.headers.get("X-Mobula-Dataset-Cache"),
    computeMs: res.headers.get("X-Mobula-Compute-Ms"),
    loadMs: res.headers.get("X-Mobula-Dataset-Load-Ms"),
    requestMs: res.headers.get("X-Mobula-Request-Ms"),
    responseBytes: res.headers.get("X-Mobula-Response-Bytes"),
    serializeMs: res.headers.get("X-Mobula-Serialize-Ms"),
    serverTiming: res.headers.get("Server-Timing"),
  };
}

const binaryTextDecoder = new TextDecoder();

function applicationBaseUrl() {
  return new URL(".", document.baseURI);
}

export function applicationUrl(url) {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return url;
  return new URL(url.slice(1), applicationBaseUrl()).toString();
}

function decodeScalarPayload(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) {
    throw new Error("invalid Mobula scalar payload");
  }
  const view = new DataView(buffer);
  const metadataLength = view.getUint32(0, true);
  const metadataStart = 4;
  const paddedMetadataLength = (metadataLength + 3) & ~3;
  const valuesStart = metadataStart + paddedMetadataLength;
  if (valuesStart > buffer.byteLength || (buffer.byteLength - valuesStart) % 4 !== 0) {
    throw new Error("invalid Mobula scalar payload envelope");
  }
  const metadataBytes = new Uint8Array(buffer, metadataStart, metadataLength);
  const metadata = JSON.parse(binaryTextDecoder.decode(metadataBytes));
  return {
    ...metadata,
    values: new Float32Array(buffer, valuesStart),
  };
}

function decodeRgbPayload(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) {
    throw new Error("invalid Mobula RGB payload");
  }
  const view = new DataView(buffer);
  const metadataLength = view.getUint32(0, true);
  const metadataStart = 4;
  const paddedMetadataLength = (metadataLength + 3) & ~3;
  const valuesStart = metadataStart + paddedMetadataLength;
  if (valuesStart > buffer.byteLength || (buffer.byteLength - valuesStart) % 4 !== 0) {
    throw new Error("invalid Mobula RGB payload envelope");
  }
  const metadataBytes = new Uint8Array(buffer, metadataStart, metadataLength);
  const metadata = JSON.parse(binaryTextDecoder.decode(metadataBytes));
  const valuesLength = Number.parseInt(metadata?.values_length, 10);
  const channelCount = Number.parseInt(metadata?.values_channels, 10);
  if (!Number.isFinite(valuesLength) || valuesLength < 0 || channelCount !== 3) {
    throw new Error("invalid Mobula RGB payload metadata");
  }
  const values = new Float32Array(buffer, valuesStart);
  if (values.length !== valuesLength * channelCount) {
    throw new Error("invalid Mobula RGB payload data length");
  }
  return {
    ...metadata,
    values: {
      r: values.subarray(0, valuesLength),
      g: values.subarray(valuesLength, valuesLength * 2),
      b: values.subarray(valuesLength * 2, valuesLength * 3),
    },
  };
}

function decodeBinaryPayload(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) {
    throw new Error("invalid Mobula payload");
  }
  const view = new DataView(buffer);
  const metadataLength = view.getUint32(0, true);
  const metadataStart = 4;
  if (metadataStart + metadataLength > buffer.byteLength) {
    throw new Error("invalid Mobula payload envelope");
  }
  const metadataBytes = new Uint8Array(buffer, metadataStart, metadataLength);
  const metadata = JSON.parse(binaryTextDecoder.decode(metadataBytes));
  const transport = String(metadata?.transport || "").trim().toLowerCase();
  if (transport === "binary-v1") return decodeScalarPayload(buffer);
  if (transport === "binary-rgb-v1") return decodeRgbPayload(buffer);
  throw new Error(`unsupported Mobula transport: ${transport || "unknown"}`);
}

export async function fetchJson(url, options) {
  const opts = options ? { ...options } : {};
  const onPerf = typeof opts.onPerf === "function" ? opts.onPerf : null;
  delete opts.onPerf;

  const requestUrl = applicationUrl(url);
  const fetchStartedAt = performance.now();
  const res = await fetch(requestUrl, opts);
  const fetchMs = performance.now() - fetchStartedAt;
  const perfHeaders = extractPerfHeaders(res);
  if (!res.ok) {
    let detail = res.statusText;
    let parseMs = 0;
    try {
      const parseStartedAt = performance.now();
      const body = await res.json();
      parseMs = performance.now() - parseStartedAt;
      const rawDetail = body.detail;
      if (Array.isArray(rawDetail)) {
        const first = rawDetail[0];
        if (first && typeof first === "object") {
          const loc = Array.isArray(first.loc) ? first.loc.join(".") : "";
          const msg = first.msg || JSON.stringify(first);
          detail = loc ? `${loc}: ${msg}` : String(msg);
        } else {
          detail = rawDetail.map((item) => String(item)).join("; ");
        }
      } else if (rawDetail && typeof rawDetail === "object") {
        if (typeof rawDetail.msg === "string") detail = rawDetail.msg;
        else detail = JSON.stringify(rawDetail);
      } else if (rawDetail) {
        detail = String(rawDetail);
      }
    } catch (_) {
      // ignore parse failure
    }
    if (onPerf) {
      onPerf({
        ...perfHeaders,
        completedAt: performance.now(),
        fetchMs,
        ok: false,
        parseMs,
        status: res.status,
        url: requestUrl,
      });
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  const parseStartedAt = performance.now();
  const body = await res.json();
  const parseMs = performance.now() - parseStartedAt;
  if (onPerf) {
    onPerf({
      ...perfHeaders,
      completedAt: performance.now(),
      fetchMs,
      ok: true,
      parseMs,
      status: res.status,
      url: requestUrl,
    });
  }
  return body;
}

export async function fetchBinaryPayload(url, options) {
  const opts = options ? { ...options } : {};
  const onPerf = typeof opts.onPerf === "function" ? opts.onPerf : null;
  delete opts.onPerf;

  const requestUrl = applicationUrl(url);
  const fetchStartedAt = performance.now();
  const res = await fetch(requestUrl, opts);
  const fetchMs = performance.now() - fetchStartedAt;
  const perfHeaders = extractPerfHeaders(res);
  if (!res.ok) {
    let detail = res.statusText;
    let parseMs = 0;
    try {
      const parseStartedAt = performance.now();
      const body = await res.json();
      parseMs = performance.now() - parseStartedAt;
      detail = body?.detail ? String(body.detail) : detail;
    } catch (_) {
      // ignore parse failure
    }
    if (onPerf) {
      onPerf({
        ...perfHeaders,
        completedAt: performance.now(),
        fetchMs,
        ok: false,
        parseMs,
        status: res.status,
        url: requestUrl,
      });
    }
    throw new Error(`${res.status}: ${detail}`);
  }

  const parseStartedAt = performance.now();
  const buffer = await res.arrayBuffer();
  const body = decodeBinaryPayload(buffer);
  const parseMs = performance.now() - parseStartedAt;
  if (onPerf) {
    onPerf({
      ...perfHeaders,
      completedAt: performance.now(),
      fetchMs,
      ok: true,
      parseMs,
      status: res.status,
      url: requestUrl,
    });
  }
  return body;
}

export function createRequestBuilders(deps) {
  const { state, planeDims, normalizeSampleMode, getProjectedDims } = deps;
  const normalizeMode = typeof normalizeSampleMode === "function" ? normalizeSampleMode : (mode) => mode;
  const activeProjectedDims = typeof getProjectedDims === "function" ? getProjectedDims : () => [];

  function applyProjectedDims(params) {
    const dims = activeProjectedDims();
    if (Array.isArray(dims) && dims.length) {
      params.set("project_dims", dims.join(","));
    }
  }

  function buildVolumeParams(sampleOverride, polOverride = state.values.pol, sampleModeOverride = state.sampleMode) {
    const params = new URLSearchParams({
      sample: String(sampleOverride !== undefined ? sampleOverride : state.values.sample),
      pol: String(polOverride),
      t: String(state.values.t),
      nu: String(state.values.nu),
      x: String(state.values.x),
      y: String(state.values.y),
      z: String(state.values.z),
      sample_mode: normalizeMode(sampleModeOverride),
    });
    applyProjectedDims(params);
    return params;
  }

  function buildSliceParams(
    nuOverride,
    sampleOverride,
    polOverride = state.values.pol,
    sampleModeOverride = state.sampleMode,
    maxPixels = null
  ) {
    const p = planeDims();
    const params = new URLSearchParams({
      sample: String(sampleOverride !== undefined ? sampleOverride : state.values.sample),
      pol: String(polOverride),
      t: String(state.values.t),
      nu: String(nuOverride !== undefined ? nuOverride : state.values.nu),
      x: String(state.values.x),
      y: String(state.values.y),
      z: String(state.values.z),
      sample_mode: normalizeMode(sampleModeOverride),
      plane_x: p.planeX,
      plane_y: p.planeY,
    });
    if (maxPixels && Number.isFinite(maxPixels) && maxPixels > 0) {
      params.set("max_pixels", String(Math.floor(maxPixels)));
    }
    applyProjectedDims(params);
    return params;
  }

  function buildMultispectralParams(sampleOverride, maxPixels = null) {
    const p = planeDims();
    const axisScale = state.multiSpectralNuAxisScale === "log" ? "log" : "linear";
    const deslope = Number.isFinite(state.multiSpectralDeslope) ? state.multiSpectralDeslope : 0;
    const normalizeSpectrum = Boolean(state.multiSpectralNormalizeSpectrum);
    const normalizeBoostRaw = Number.parseFloat(state.multiSpectralNormalizeBoost);
    const normalizeSpectrumBoost = Number.isFinite(normalizeBoostRaw) ? Math.max(0.25, Math.min(8.0, normalizeBoostRaw)) : 1.0;
    const intensityScale = ["linear", "sqrt", "log"].includes(state.fluxScale) ? state.fluxScale : "linear";
    const rangeRawMin = Number.parseFloat(state.multiSpectralChannelRange?.min);
    const rangeRawMax = Number.parseFloat(state.multiSpectralChannelRange?.max);
    const rangeMin = Number.isFinite(rangeRawMin) ? Math.max(0, Math.min(100, rangeRawMin)) : 0;
    const rangeMax = Number.isFinite(rangeRawMax) ? Math.max(0, Math.min(100, rangeRawMax)) : 100;
    const computeBackend = ["auto", "cpu", "native", "cuda", "metal"].includes(state.multiSpectralComputeBackend)
      ? state.multiSpectralComputeBackend
      : "auto";
    const artifactMode = ["robust", "manual", "off"].includes(state.multiSpectralArtifactMode)
      ? state.multiSpectralArtifactMode
      : "robust";
    const confidenceFloor = Number.isFinite(state.multiSpectralConfidenceFloor)
      ? Math.max(0, Math.min(1, state.multiSpectralConfidenceFloor))
      : 0.015;
    const alphaMin = Number.isFinite(state.multiSpectralIndexRange?.min)
      ? Math.max(-8, Math.min(8, state.multiSpectralIndexRange.min))
      : -4;
    const alphaMax = Number.isFinite(state.multiSpectralIndexRange?.max)
      ? Math.max(-8, Math.min(8, state.multiSpectralIndexRange.max))
      : 4;
    const faintBehavior = state.multiSpectralFaintBehavior === "hide" ? "hide" : "desaturate";
    const params = new URLSearchParams({
      sample: String(sampleOverride !== undefined ? sampleOverride : state.values.sample),
      pol: String(state.values.pol),
      t: String(state.values.t),
      x: String(state.values.x),
      y: String(state.values.y),
      z: String(state.values.z),
      sample_mode: normalizeMode(state.sampleMode),
      plane_x: p.planeX,
      plane_y: p.planeY,
      nu_axis_scale: axisScale,
      deslope: String(deslope),
      normalize_spectrum: normalizeSpectrum ? "true" : "false",
      normalize_spectrum_boost: String(normalizeSpectrumBoost),
      intensity_scale: intensityScale,
      range_min: String(rangeMin),
      range_max: String(rangeMax),
      compute_backend: computeBackend,
      artifact_mode: artifactMode,
      artifact_confidence_floor: String(confidenceFloor),
      spectral_index_min: String(alphaMin),
      spectral_index_max: String(alphaMax),
      faint_behavior: faintBehavior,
    });
    if (Number.isFinite(state.multiSpectralBrightnessReference) && state.multiSpectralBrightnessReference > 0) {
      params.set("artifact_brightness_reference", String(state.multiSpectralBrightnessReference));
    }
    if (state.axisWindow.nu) {
      params.set("nu0", String(state.axisWindow.nu.start));
      params.set("nu1", String(state.axisWindow.nu.end + 1));
    }
    if (maxPixels && Number.isFinite(maxPixels) && maxPixels > 0) {
      params.set("max_pixels", String(Math.floor(maxPixels)));
    }
    applyProjectedDims(params);
    return params;
  }

  function buildRangeParams() {
    const p = planeDims();
    const params = new URLSearchParams({
      sample: String(state.values.sample),
      pol: String(state.values.pol),
      t: String(state.values.t),
      nu: String(state.values.nu),
      x: String(state.values.x),
      y: String(state.values.y),
      z: String(state.values.z),
      sample_mode: normalizeMode(state.sampleMode),
      range_mode: state.colorRangeMode,
      plane_x: p.planeX,
      plane_y: p.planeY,
    });
    if (state.axisWindow.t) {
      params.set("t0", String(state.axisWindow.t.start));
      params.set("t1", String(state.axisWindow.t.end + 1));
    }
    if (state.axisWindow.nu) {
      params.set("nu0", String(state.axisWindow.nu.start));
      params.set("nu1", String(state.axisWindow.nu.end + 1));
    }
    applyProjectedDims(params);
    return params;
  }

  function profileRequestBody(bounds) {
    const p = planeDims();
    return {
      plane_x: p.planeX,
      plane_y: p.planeY,
      u0: bounds.u0,
      u1: bounds.u1,
      v0: bounds.v0,
      v1: bounds.v1,
      sample: state.values.sample,
      pol: state.values.pol,
      t: state.values.t,
      nu: state.values.nu,
      x: state.values.x,
      y: state.values.y,
      z: state.values.z,
    };
  }

  return {
    buildVolumeParams,
    buildSliceParams,
    buildMultispectralParams,
    buildRangeParams,
    profileRequestBody,
  };
}
