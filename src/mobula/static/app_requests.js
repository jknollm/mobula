export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
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
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
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
    });
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
