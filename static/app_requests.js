export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch (_) {
      // ignore parse failure
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

export function createRequestBuilders(deps) {
  const { state, planeDims } = deps;

  function buildVolumeParams(sampleOverride, polOverride = state.values.pol, sampleModeOverride = state.sampleMode) {
    return new URLSearchParams({
      sample: String(sampleOverride !== undefined ? sampleOverride : state.values.sample),
      pol: String(polOverride),
      t: String(state.values.t),
      nu: String(state.values.nu),
      x: String(state.values.x),
      y: String(state.values.y),
      z: String(state.values.z),
      sample_mode: sampleModeOverride,
    });
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
      sample_mode: sampleModeOverride,
      plane_x: p.planeX,
      plane_y: p.planeY,
    });
    if (maxPixels && Number.isFinite(maxPixels) && maxPixels > 0) {
      params.set("max_pixels", String(Math.floor(maxPixels)));
    }
    return params;
  }

  function buildMultispectralParams(sampleOverride, maxPixels = null) {
    const p = planeDims();
    const params = new URLSearchParams({
      sample: String(sampleOverride !== undefined ? sampleOverride : state.values.sample),
      pol: String(state.values.pol),
      t: String(state.values.t),
      x: String(state.values.x),
      y: String(state.values.y),
      z: String(state.values.z),
      sample_mode: state.sampleMode,
      plane_x: p.planeX,
      plane_y: p.planeY,
    });
    if (state.axisWindow.nu) {
      params.set("nu0", String(state.axisWindow.nu.start));
      params.set("nu1", String(state.axisWindow.nu.end + 1));
    }
    if (maxPixels && Number.isFinite(maxPixels) && maxPixels > 0) {
      params.set("max_pixels", String(Math.floor(maxPixels)));
    }
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
      sample_mode: state.sampleMode,
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
