import { createGpuRenderers } from "./app_gpu.js";
import { bindCanvasInteractions } from "./app_interactions.js";
import { fetchJson, createRequestBuilders } from "./app_requests.js";
import { resetForDatasetChange, resetForPlaneChange } from "./app_state_transitions.js";

const PLANE_OPTIONS = {
  xy: { planeX: "x", planeY: "y", hidden: "z", label: "XY" },
  yz: { planeX: "y", planeY: "z", hidden: "x", label: "YZ" },
  zx: { planeX: "z", planeY: "x", hidden: "y", label: "ZX" },
};

const COLOR_RAMPS = {
  viridis: [
    [0.0, 68, 1, 84],
    [0.25, 59, 82, 139],
    [0.5, 33, 145, 140],
    [0.75, 94, 201, 98],
    [1.0, 253, 231, 37],
  ],
  plasma: [
    [0.0, 13, 8, 135],
    [0.25, 126, 3, 167],
    [0.5, 203, 71, 119],
    [0.75, 248, 149, 64],
    [1.0, 240, 249, 33],
  ],
  inferno: [
    [0.0, 0, 0, 4],
    [0.25, 87, 15, 109],
    [0.5, 187, 55, 84],
    [0.75, 249, 142, 9],
    [1.0, 252, 255, 164],
  ],
  gray: [
    [0.0, 0, 0, 0],
    [1.0, 255, 255, 255],
  ],
  diverging: [
    [0.0, 58, 76, 192],
    [0.25, 141, 175, 253],
    [0.5, 247, 247, 247],
    [0.75, 244, 109, 67],
    [1.0, 180, 4, 38],
  ],
  circular: [
    [0.0, 255, 68, 68],
    [0.16, 255, 183, 77],
    [0.33, 234, 255, 77],
    [0.5, 77, 255, 123],
    [0.66, 77, 197, 255],
    [0.83, 173, 92, 255],
    [1.0, 255, 68, 68],
  ],
};

const els = {
  layout: document.querySelector(".layout"),
  workspaceRow: document.getElementById("workspaceRow"),
  leftSplitter: document.getElementById("leftSplitter"),
  rightSplitter: document.getElementById("rightSplitter"),
  controlsPanel: document.querySelector(".controls"),
  viewerPanel: document.querySelector(".viewer"),
  colorbarPanel: document.querySelector(".colorbarPanel"),
  viewerToolbar: document.querySelector(".viewerToolbar"),
  dataControlGroup: document.getElementById("dataControlGroup"),
  spatialControlGroup: document.getElementById("spatialControlGroup"),
  temporalControlGroup: document.getElementById("temporalControlGroup"),
  spectralControlGroup: document.getElementById("spectralControlGroup"),
  polarizationControlGroup: document.getElementById("polarizationControlGroup"),

  datasetSelect: document.getElementById("datasetSelect"),
  colorMapSelect: document.getElementById("colorMapSelect"),
  colorRangeModeSelect: document.getElementById("colorRangeModeSelect"),
  sliceBackendSelect: document.getElementById("sliceBackendSelect"),
  fluxScaleLinearBtn: document.getElementById("fluxScaleLinearBtn"),
  fluxScaleLogBtn: document.getElementById("fluxScaleLogBtn"),
  sampleModeMeanBtn: document.getElementById("sampleModeMeanBtn"),
  sampleModeStdBtn: document.getElementById("sampleModeStdBtn"),
  sampleModeRelBtn: document.getElementById("sampleModeRelBtn"),
  sampleModeSamplesBtn: document.getElementById("sampleModeSamplesBtn"),
  sampleModeBlock: document.getElementById("sampleModeBlock"),
  sampleMosaicControls: document.getElementById("sampleMosaicControls"),
  sampleGridCountSelect: document.getElementById("sampleGridCountSelect"),
  resampleSamplesBtn: document.getElementById("resampleSamplesBtn"),
  playSpeedLabel: document.getElementById("playSpeedLabel"),
  playSpeedSelect: document.getElementById("playSpeedSelect"),

  planeSelect: document.getElementById("planeSelect"),
  planeLabel: document.getElementById("planeLabel"),
  spatialSliceBtn: document.getElementById("spatialSliceBtn"),
  spatialVolumeBtn: document.getElementById("spatialVolumeBtn"),
  hiddenAxisTitle: document.getElementById("hiddenAxisTitle"),
  hiddenNavValue: document.getElementById("hiddenNavValue"),
  hiddenPlayBtn: document.getElementById("hiddenPlayBtn"),
  hiddenNavPanel: document.getElementById("hiddenNavPanel"),
  volumeRenderControls: document.getElementById("volumeRenderControls"),
  volumeBackendSelect: document.getElementById("volumeBackendSelect"),
  volumeBackendStatus: document.getElementById("volumeBackendStatus"),
  volumeQualitySelect: document.getElementById("volumeQualitySelect"),
  volumeRenderModeSelect: document.getElementById("volumeRenderModeSelect"),
  volumeTfSelect: document.getElementById("volumeTfSelect"),
  volumeOpacityRange: document.getElementById("volumeOpacityRange"),
  volumeOpacityValue: document.getElementById("volumeOpacityValue"),
  volumeGammaRange: document.getElementById("volumeGammaRange"),
  volumeGammaValue: document.getElementById("volumeGammaValue"),
  volumeCutoffRange: document.getElementById("volumeCutoffRange"),
  volumeCutoffValue: document.getElementById("volumeCutoffValue"),
  volumeClipNearRange: document.getElementById("volumeClipNearRange"),
  volumeClipNearValue: document.getElementById("volumeClipNearValue"),
  volumeClipFarRange: document.getElementById("volumeClipFarRange"),
  volumeClipFarValue: document.getElementById("volumeClipFarValue"),
  volumeIsoThresholdLabel: document.getElementById("volumeIsoThresholdLabel"),
  volumeIsoThresholdRange: document.getElementById("volumeIsoThresholdRange"),
  volumeIsoThresholdValue: document.getElementById("volumeIsoThresholdValue"),
  hiddenNavCanvas: document.getElementById("hiddenNavCanvas"),
  hiddenAxisMin: document.getElementById("hiddenAxisMin"),
  hiddenAxisMax: document.getElementById("hiddenAxisMax"),

  multiSpectralBtn: document.getElementById("multiSpectralBtn"),
  tValue: document.getElementById("tValue"),
  nuValue: document.getElementById("nuValue"),
  timePlayBtn: document.getElementById("timePlayBtn"),
  freqPlayBtn: document.getElementById("freqPlayBtn"),
  timeNavCanvas: document.getElementById("timeNavCanvas"),
  freqNavCanvas: document.getElementById("freqNavCanvas"),
  timeAxisMin: document.getElementById("timeAxisMin"),
  timeAxisMax: document.getElementById("timeAxisMax"),
  freqAxisMin: document.getElementById("freqAxisMin"),
  freqAxisMax: document.getElementById("freqAxisMax"),

  polValue: document.getElementById("polValue"),
  evpaToggleBtn: document.getElementById("evpaToggleBtn"),
  evpaDensitySelect: document.getElementById("evpaDensitySelect"),
  evpaIThresholdSelect: document.getElementById("evpaIThresholdSelect"),
  fracPolBtn: document.getElementById("fracPolBtn"),
  bfieldBtn: document.getElementById("bfieldBtn"),
  linPolBtn: document.getElementById("linPolBtn"),
  circPolBtn: document.getElementById("circPolBtn"),
  polButtons: [
    document.getElementById("polBtn0"),
    document.getElementById("polBtn1"),
    document.getElementById("polBtn2"),
    document.getElementById("polBtn3"),
  ],

  canvas: document.getElementById("sliceCanvas"),
  colorbarCanvas: document.getElementById("colorbarCanvas"),
  colorbarMin: document.getElementById("colorbarMin"),
  colorbarMid: document.getElementById("colorbarMid"),
  colorbarMax: document.getElementById("colorbarMax"),

  modeInspectBtn: document.getElementById("modeInspectBtn"),
  modeZoomBtn: document.getElementById("modeZoomBtn"),
  resetZoomBtn: document.getElementById("resetZoomBtn"),

  metricsPanel: document.getElementById("metricsPanel"),
  metricsTitle: document.getElementById("metricsTitle"),
  metricsHint: document.getElementById("metricsHint"),
  timeProfileBlock: document.getElementById("timeProfileBlock"),
  spectrumProfileBlock: document.getElementById("spectrumProfileBlock"),
  spatialProfileBlock: document.getElementById("spatialProfileBlock"),
  timeProfileCanvas: document.getElementById("timeProfileCanvas"),
  spectrumProfileCanvas: document.getElementById("spectrumProfileCanvas"),
  spatialProfileTitle: document.getElementById("spatialProfileTitle"),
  spatialProfileCanvas: document.getElementById("spatialProfileCanvas"),
};

const state = {
  dataId: null,
  meta: null,
  plane: "xy",
  values: { sample: 0, pol: 0, t: 0, nu: 0, x: 0, y: 0, z: 0 },

  sampleMode: "mean",
  sampleGridSize: 1,
  sampleGridIndices: [0],
  activeSampleTile: 0,
  colorMap: "viridis",
  colorRangeMode: "none",
  spatialMode: "slice",
  fluxScale: "linear",
  multiSpectral: false,
  dragMode: "investigate",
  sliceRender: {
    backend: "auto",
  },
  showEvpa: false,
  evpaStep: 8,
  evpaIMinFraction: 0.0,
  derivedPolMode: "none",

  evpaTicks: [],
  evpaTicksBySample: {},
  frameCanvas: null,
  frameTiles: null,
  frameGrid: 1,
  drawTiles: [],
  currentMonoSlice: null,
  currentVolume: null,
  currentVolumeTiles: null,
  currentIntensityStats: null,
  currentIntensityUnit: "",
  fixedColorRange: null,
  currentMultispectralBands: null,
  selectedCoords: null,

  selection: null,
  selectionDrag: null,
  zoomDrag: null,
  volumeDrag: null,
  panDrag: null,
  navDrag: null,
  profileZoomDrag: null,
  axisWindow: { t: null, nu: null },

  profiles: null,
  viewProfiles: null,

  drawRect: { x: 0, y: 0, w: 1, h: 1 },
  view: { u: 0, v: 0, w: 1, h: 1 },

  playbackAxis: null,
  playbackFps: 7,
  playbackTimer: null,
  playbackBusy: false,
  playbackRefineToken: 0,
  playbackPreviewMaxPixels: 360000,

  _selectionToken: 0,
  _viewProfileToken: 0,
  _resizePanelsRaf: 0,
  profileZoom: {},
  panelWidths: { left: null, right: null },
  volumeYaw: 0.65,
  volumePitch: -0.45,
  volumeZoom: 1.0,
  volumeRender: {
    backend: "auto",
    quality: "balanced",
    mode: "composite",
    tf: "linear",
    opacity: 1.2,
    gamma: 0.9,
    cutoff: 0.06,
    clipNear: 0.0,
    clipFar: 1.0,
    isoThreshold: 0.45,
  },
  volumeGpu: {
    available: null,
    renderer: null,
    lastError: "",
  },
  sliceGpu: {
    available: null,
    renderer: null,
    lastError: "",
  },
};

const PROFILE_MARGIN = { l: 92, r: 18, t: 16, b: 54 };
const NAV_MARGIN = { l: 36, r: 8, t: 6, b: 8 };
const COLOR_RANGE_MODE_LABEL = {
  none: "dynamic",
  time: "time-fixed",
  spectral: "spectral-fixed",
  time_spectral: "time+spectral-fixed",
  space: "space-fixed",
  full: "full-fixed",
};
const DERIVED_POL_MODES = {
  none: { label: "None" },
  frac: { label: "Fractional Polarisation" },
  bfield: { label: "Magnetic Field Angle" },
  linear: { label: "Linear Polarisation" },
  circular: { label: "Circular Polarisation" },
};

function planeDims() {
  return PLANE_OPTIONS[state.plane] || PLANE_OPTIONS.xy;
}

function hiddenDim() {
  return planeDims().hidden;
}

function axisSize(dim) {
  if (!state.meta || !state.meta.coords[dim]) return 1;
  return state.meta.coords[dim].size;
}

function dimUnit(dim) {
  if (!state.meta || !state.meta.coords[dim]) return "";
  return state.meta.coords[dim].unit || "";
}

function dimCoord(dim, idx) {
  if (!state.meta || !state.meta.coords[dim]) return null;
  const cmin = state.meta.coords[dim].min;
  const cmax = state.meta.coords[dim].max;
  const n = axisSize(dim);
  if (n <= 1 || cmin === null || cmax === null) return idx;
  const f = idx / (n - 1);
  return cmin + f * (cmax - cmin);
}

function polLabel(idx) {
  const labels =
    state.meta && Array.isArray(state.meta.pol_labels) ? state.meta.pol_labels : ["I", "Q", "U", "V"];
  return labels[idx] || String(idx);
}

function isDerivedPolModeActive() {
  return state.derivedPolMode !== "none";
}

function derivedPolLabel(mode) {
  return DERIVED_POL_MODES[mode]?.label || mode;
}

function derivedPolChannels(mode) {
  if (mode === "frac") return [0, 1, 2];
  if (mode === "bfield") return [1, 2];
  if (mode === "linear") return [1, 2];
  if (mode === "circular") return [0, 3];
  return [];
}

function derivedPolSupported(mode, polSize = axisSize("pol")) {
  const required = derivedPolChannels(mode);
  if (!required.length) return false;
  return required.every((idx) => idx < polSize);
}

function derivedPolUnit(mode) {
  if (mode === "bfield") return "deg";
  if (mode === "frac" || mode === "circular") return "fraction";
  return state.meta ? state.meta.intensity_unit || "" : "";
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function setVisible(el, visible) {
  if (!el) return;
  el.style.display = visible ? "" : "none";
}

function axisVarying(axis) {
  return axisSize(axis) > 1;
}

function volumeQualityConfig() {
  const quality = state.volumeRender.quality;
  if (quality === "draft") return { stepMul: 0.58, resMul: 0.82 };
  if (quality === "fine") return { stepMul: 1.25, resMul: 1.14 };
  if (quality === "ultra") return { stepMul: 1.62, resMul: 1.3 };
  return { stepMul: 0.92, resMul: 1.0 };
}

function volumeBaseResolution(tileCount) {
  if (tileCount > 4) return 170;
  if (tileCount > 1) return 200;
  return 280;
}

function volumeRenderModeInt() {
  const mode = state.volumeRender.mode;
  if (mode === "mip") return 1;
  if (mode === "minip") return 2;
  if (mode === "average") return 3;
  if (mode === "isosurface") return 4;
  return 0;
}

function volumeTfModeInt() {
  const tf = state.volumeRender.tf;
  if (tf === "sqrt") return 1;
  if (tf === "square") return 2;
  if (tf === "sigmoid") return 3;
  return 0;
}

function volumeTransferShape(x) {
  const v = clamp(x, 0, 1);
  const tf = state.volumeRender.tf;
  if (tf === "sqrt") return Math.sqrt(v);
  if (tf === "square") return v * v;
  if (tf === "sigmoid") return 1 / (1 + Math.exp(-10 * (v - 0.5)));
  return v;
}

function gpuAvailableKnown() {
  return state.volumeGpu.available !== null;
}

function gpuAvailable() {
  return state.volumeGpu.available === true;
}

function volumeBackendMode() {
  const requested = state.volumeRender.backend;
  if (requested === "cpu") return "cpu";
  if (!gpuAvailableKnown()) ensureVolumeGpuRenderer();
  if (requested === "gpu") return gpuAvailable() ? "gpu" : "cpu";
  return gpuAvailable() ? "gpu" : "cpu";
}

function sliceGpuAvailableKnown() {
  return state.sliceGpu.available !== null;
}

function sliceGpuAvailable() {
  return state.sliceGpu.available === true;
}

function sliceBackendMode(width = 0, height = 0) {
  const requested = state.sliceRender.backend;
  if (requested === "cpu") return "cpu";
  if (!sliceGpuAvailableKnown()) ensureSliceGpuRenderer();
  if (!sliceGpuAvailable()) return "cpu";
  if (requested === "gpu") return "gpu";
  const pixels = Math.max(1, width) * Math.max(1, height);
  return pixels >= 512 * 512 ? "gpu" : "cpu";
}

function updateVolumeControlReadouts() {
  if (els.volumeBackendSelect) els.volumeBackendSelect.value = state.volumeRender.backend;
  if (els.volumeQualitySelect) els.volumeQualitySelect.value = state.volumeRender.quality;
  if (els.volumeRenderModeSelect) els.volumeRenderModeSelect.value = state.volumeRender.mode;
  if (els.volumeTfSelect) els.volumeTfSelect.value = state.volumeRender.tf;
  if (els.volumeOpacityRange) els.volumeOpacityRange.value = String(state.volumeRender.opacity);
  if (els.volumeGammaRange) els.volumeGammaRange.value = String(state.volumeRender.gamma);
  if (els.volumeCutoffRange) els.volumeCutoffRange.value = String(state.volumeRender.cutoff);
  if (els.volumeClipNearRange) els.volumeClipNearRange.value = String(state.volumeRender.clipNear);
  if (els.volumeClipFarRange) els.volumeClipFarRange.value = String(state.volumeRender.clipFar);
  if (els.volumeIsoThresholdRange) els.volumeIsoThresholdRange.value = String(state.volumeRender.isoThreshold);
  if (els.volumeOpacityValue) els.volumeOpacityValue.textContent = `${state.volumeRender.opacity.toFixed(1)}x`;
  if (els.volumeGammaValue) els.volumeGammaValue.textContent = state.volumeRender.gamma.toFixed(2);
  if (els.volumeCutoffValue) els.volumeCutoffValue.textContent = state.volumeRender.cutoff.toFixed(2);
  if (els.volumeClipNearValue) els.volumeClipNearValue.textContent = state.volumeRender.clipNear.toFixed(2);
  if (els.volumeClipFarValue) els.volumeClipFarValue.textContent = state.volumeRender.clipFar.toFixed(2);
  if (els.volumeIsoThresholdValue) els.volumeIsoThresholdValue.textContent = state.volumeRender.isoThreshold.toFixed(2);
  const compositeLike = state.volumeRender.mode === "composite";
  const isoMode = state.volumeRender.mode === "isosurface";
  setVisible(els.volumeTfSelect ? els.volumeTfSelect.closest("label") : null, compositeLike);
  setVisible(els.volumeOpacityRange ? els.volumeOpacityRange.closest("label") : null, compositeLike);
  setVisible(els.volumeGammaRange ? els.volumeGammaRange.closest("label") : null, compositeLike);
  setVisible(els.volumeCutoffRange ? els.volumeCutoffRange.closest("label") : null, compositeLike);
  setVisible(els.volumeIsoThresholdLabel, isoMode);
  if (els.volumeBackendStatus) {
    const zoomMsg = `Scroll: zoom ${state.volumeZoom.toFixed(2)}x`;
    const modeMsg = `Mode: ${state.volumeRender.mode}`;
    if (!gpuAvailableKnown()) {
      els.volumeBackendStatus.textContent = `GPU backend: probing WebGL2 support. ${modeMsg}. ${zoomMsg}`;
    } else if (gpuAvailable()) {
      const mode = volumeBackendMode() === "gpu" ? "using GPU" : "available, currently on CPU";
      els.volumeBackendStatus.textContent = `GPU backend: WebGL2 available, ${mode}. ${modeMsg}. ${zoomMsg}`;
    } else if (state.volumeGpu.lastError) {
      els.volumeBackendStatus.textContent = `GPU backend unavailable (${state.volumeGpu.lastError}); using CPU. ${modeMsg}. ${zoomMsg}`;
    } else {
      els.volumeBackendStatus.textContent = `GPU backend unavailable; using CPU. ${modeMsg}. ${zoomMsg}`;
    }
  }
}

function isPlaying() {
  return state.playbackTimer !== null;
}

function playbackMaxPixelsForFrame() {
  const tileCount = isSamplesMode() ? Math.max(1, state.sampleGridIndices.length || 1) : 1;
  const budget = Math.max(40000, state.playbackPreviewMaxPixels);
  return Math.max(20000, Math.floor(budget / tileCount));
}

function sampleCount() {
  return axisSize("sample");
}

function isSamplesMode() {
  return state.sampleMode === "single";
}

function isVolumeMode() {
  return state.spatialMode === "volume";
}

const PANEL_WIDTH_STORAGE_KEY = "ncube-panel-widths-v1";

function isNarrowLayout() {
  return window.matchMedia("(max-width: 1100px)").matches;
}

function readCurrentPanelWidths() {
  const left = els.controlsPanel ? els.controlsPanel.getBoundingClientRect().width : 320;
  const right = els.metricsPanel ? els.metricsPanel.getBoundingClientRect().width : 300;
  return {
    left: Number.isFinite(left) ? left : 320,
    right: Number.isFinite(right) ? right : 300,
  };
}

function loadPanelWidths() {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.right)) return null;
    return { left: parsed.left, right: parsed.right };
  } catch (_) {
    return null;
  }
}

function persistPanelWidths(left, right) {
  try {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify({ left, right }));
  } catch (_) {
    // ignore storage failures
  }
}

function clampPanelWidths(left, right) {
  const rowW = els.workspaceRow ? els.workspaceRow.getBoundingClientRect().width : window.innerWidth;
  const splitW = (els.leftSplitter ? els.leftSplitter.getBoundingClientRect().width : 0) +
    (els.rightSplitter ? els.rightSplitter.getBoundingClientRect().width : 0);
  const minLeft = 270;
  const minRight = 250;
  const minCenter = 460;

  const safeLeftMax = Math.max(minLeft, rowW - splitW - minCenter - minRight);
  let nextLeft = clamp(left, minLeft, safeLeftMax);
  const safeRightMax = Math.max(minRight, rowW - splitW - minCenter - nextLeft);
  let nextRight = clamp(right, minRight, safeRightMax);

  const center = rowW - splitW - nextLeft - nextRight;
  if (center < minCenter) {
    nextRight = Math.max(minRight, rowW - splitW - nextLeft - minCenter);
  }
  return { left: nextLeft, right: nextRight };
}

function requestResizeRedraw() {
  if (state._resizePanelsRaf) return;
  state._resizePanelsRaf = window.requestAnimationFrame(() => {
    state._resizePanelsRaf = 0;
    layoutViewerCanvas();
    drawFrameAndOverlays();
    drawNavigationGraphs();
    drawSelectionGraphs();
    drawColorbar();
  });
}

function layoutViewerCanvas() {
  if (!els.viewerPanel || !els.canvas) return;
  if (isNarrowLayout()) {
    els.canvas.style.width = "100%";
    els.canvas.style.height = "auto";
    return;
  }

  const panel = els.viewerPanel;
  const panelRect = panel.getBoundingClientRect();
  const styles = window.getComputedStyle(panel);
  const panelPadTop = Number.parseFloat(styles.paddingTop || "0") || 0;
  const panelPadBottom = Number.parseFloat(styles.paddingBottom || "0") || 0;
  const panelPadLeft = Number.parseFloat(styles.paddingLeft || "0") || 0;
  const panelPadRight = Number.parseFloat(styles.paddingRight || "0") || 0;
  const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;

  const panelW = Math.max(160, panel.clientWidth - panelPadLeft - panelPadRight);
  const panelH = Math.max(160, panel.clientHeight - panelPadTop - panelPadBottom);
  const reservedH =
    (els.colorbarPanel ? els.colorbarPanel.getBoundingClientRect().height : 0) +
    (els.viewerToolbar ? els.viewerToolbar.getBoundingClientRect().height : 0) +
    gap * 2;
  const availablePanelH = Math.max(120, panelH - reservedH);
  const availableViewportH = Math.max(
    120,
    window.innerHeight - panelRect.top - panelPadBottom - reservedH - 8
  );
  const size = Math.max(120, Math.min(panelW, availablePanelH, availableViewportH));

  els.canvas.style.width = `${Math.floor(size)}px`;
  els.canvas.style.height = `${Math.floor(size)}px`;
}

function applyPanelWidths(left, right, persist = true) {
  if (isNarrowLayout()) return;
  const next = clampPanelWidths(left, right);
  state.panelWidths.left = next.left;
  state.panelWidths.right = next.right;
  document.documentElement.style.setProperty("--left-col", `${Math.round(next.left)}px`);
  document.documentElement.style.setProperty("--right-col", `${Math.round(next.right)}px`);
  if (persist) persistPanelWidths(next.left, next.right);
  requestResizeRedraw();
}

function initPanelResize() {
  if (!els.workspaceRow || !els.leftSplitter || !els.rightSplitter || !els.controlsPanel || !els.metricsPanel) return;

  const saved = loadPanelWidths();
  if (saved && !isNarrowLayout()) {
    applyPanelWidths(saved.left, saved.right, false);
  } else {
    const cur = readCurrentPanelWidths();
    applyPanelWidths(cur.left, cur.right, false);
  }

  const beginDrag = (side, ev) => {
    if (isNarrowLayout() || ev.button !== 0) return;
    ev.preventDefault();
    const start = readCurrentPanelWidths();
    const startX = ev.clientX;
    const leftEl = els.leftSplitter;
    const rightEl = els.rightSplitter;
    if (leftEl) leftEl.classList.toggle("active", side === "left");
    if (rightEl) rightEl.classList.toggle("active", side === "right");
    document.body.classList.add("resizing-panels");

    const onMove = (mev) => {
      const dx = mev.clientX - startX;
      if (side === "left") {
        const nextLeft = start.left + dx;
        applyPanelWidths(nextLeft, start.right, false);
      } else {
        const nextRight = start.right - dx;
        applyPanelWidths(start.left, nextRight, false);
      }
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("resizing-panels");
      if (leftEl) leftEl.classList.remove("active");
      if (rightEl) rightEl.classList.remove("active");
      const cur = readCurrentPanelWidths();
      applyPanelWidths(cur.left, cur.right, true);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  els.leftSplitter.addEventListener("mousedown", (ev) => beginDrag("left", ev));
  els.rightSplitter.addEventListener("mousedown", (ev) => beginDrag("right", ev));

  window.addEventListener("resize", () => {
    if (isNarrowLayout()) return;
    const cur = state.panelWidths.left && state.panelWidths.right
      ? state.panelWidths
      : readCurrentPanelWidths();
    applyPanelWidths(cur.left, cur.right, false);
    layoutViewerCanvas();
  });
}

function parseGridCount(value) {
  const count = Number.parseInt(String(value || "1"), 10);
  if (!Number.isFinite(count)) return 1;
  const root = Math.round(Math.sqrt(Math.max(1, count)));
  return clamp(root, 1, 4);
}

function maxGridSize() {
  const n = sampleCount();
  if (n <= 0) return 1;
  return Math.max(1, Math.min(4, Math.floor(Math.sqrt(n))));
}

function randomSampleIndices(gridSize) {
  const n = sampleCount();
  const count = Math.max(1, gridSize * gridSize);
  if (n <= 0) return [0];
  const use = Math.min(n, count);
  const pool = Array.from({ length: n }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool
    .slice(0, use)
    .sort((a, b) => a - b);
}

function ensureGridIndices() {
  const n = sampleCount();
  const allowedGrid = Math.min(state.sampleGridSize, maxGridSize());
  const wanted = Math.max(1, allowedGrid * allowedGrid);
  const valid =
    Array.isArray(state.sampleGridIndices) &&
    state.sampleGridIndices.length === wanted &&
    state.sampleGridIndices.every((idx) => Number.isInteger(idx) && idx >= 0 && idx < n);

  state.sampleGridSize = allowedGrid;
  if (!valid) {
    state.sampleGridIndices = randomSampleIndices(state.sampleGridSize);
  }
  if (!state.sampleGridIndices.length) state.sampleGridIndices = [0];
  state.activeSampleTile = clamp(state.activeSampleTile, 0, state.sampleGridIndices.length - 1);
  state.values.sample = state.sampleGridIndices[state.activeSampleTile];
}

function fmtPhysical(dim, coord, unit) {
  if (coord === null || coord === undefined || Number.isNaN(coord)) return "n/a";
  if (dim === "nu" || unit === "Hz") return `${(coord / 1.0e9).toFixed(3)} GHz`;
  const abs = Math.abs(coord);
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return `${coord.toExponential(2)} ${unit}`.trim();
  return `${coord.toFixed(2)} ${unit}`.trim();
}

function fmtIntensity(v) {
  if (!Number.isFinite(v)) return "n/a";
  const abs = Math.abs(v);
  if (abs >= 10000 || (abs > 0 && abs < 0.001)) return v.toExponential(2);
  return v.toFixed(3);
}

function fluxPlotValue(v) {
  if (state.fluxScale === "log") return Math.log10(1 + Math.max(v, 0));
  return v;
}

function fluxFromPlotValue(v) {
  if (state.fluxScale === "log") return Math.max(0, 10 ** v - 1);
  return v;
}

function fmtAxisTick(axis, unit, v) {
  if (!Number.isFinite(v)) return "";
  if (axis === "nu" || unit === "Hz") return (v / 1.0e9).toFixed(3);
  const abs = Math.abs(v);
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return v.toExponential(1);
  return v.toFixed(2);
}

function buildAxisXMapper(coords) {
  const transformed = coords.slice();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const t of transformed) {
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    min = 0;
    max = 1;
  }
  const span = Math.max(1e-9, max - min);

  return {
    transformed,
    toNorm(i) {
      return (transformed[i] - min) / span;
    },
    nearestIndex(norm) {
      const target = min + clamp(norm, 0, 1) * span;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < transformed.length; i += 1) {
        const d = Math.abs(transformed[i] - target);
        if (d < bestDist) {
          best = i;
          bestDist = d;
        }
      }
      return best;
    },
  };
}

function sampleColorRamp(stops, t) {
  if (t <= 0) return [stops[0][1], stops[0][2], stops[0][3]];
  if (t >= 1) {
    const end = stops[stops.length - 1];
    return [end[1], end[2], end[3]];
  }
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [p0, r0, g0, b0] = stops[i];
    const [p1, r1, g1, b1] = stops[i + 1];
    if (t >= p0 && t <= p1) {
      const w = (t - p0) / Math.max(1e-6, p1 - p0);
      return [
        Math.round(r0 + (r1 - r0) * w),
        Math.round(g0 + (g1 - g0) * w),
        Math.round(b0 + (b1 - b0) * w),
      ];
    }
  }
  return [255, 255, 255];
}

function colorForNorm(norm) {
  const t = clamp(norm, 0, 1);
  const ramp = COLOR_RAMPS[state.colorMap] || COLOR_RAMPS.viridis;
  return sampleColorRamp(ramp, t);
}

function isFiniteNumber(v) {
  return Number.isFinite(v);
}

function finiteMinMax(values) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!isFiniteNumber(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

function normalizeForColormap(v, mm) {
  if (!isFiniteNumber(v)) return null;
  if (state.colorMap === "circular" && isDerivedPolModeActive() && state.derivedPolMode === "bfield") {
    let a = v % 180;
    if (a < 0) a += 180;
    return a / 180;
  }
  if (state.colorMap === "diverging" && mm.min < 0 && mm.max > 0) {
    const maxAbs = Math.max(Math.abs(mm.min), Math.abs(mm.max));
    if (maxAbs > 0) return (v + maxAbs) / (2 * maxAbs);
  }
  return (v - mm.min) / Math.max(1e-9, mm.max - mm.min);
}

function isValidRangeStats(stats) {
  if (!stats) return false;
  return Number.isFinite(stats.min) && Number.isFinite(stats.max) && stats.max > stats.min;
}

function colorForSpectralNu(freqHz, bands) {
  if (!bands) return [255, 255, 255];
  const b = bands.blue || [0, 1];
  const g = bands.green || [0, 1];
  const r = bands.red || [0, 1];
  const cB = 0.5 * (b[0] + b[1]);
  const cG = 0.5 * (g[0] + g[1]);
  const cR = 0.5 * (r[0] + r[1]);

  if (!Number.isFinite(cB) || !Number.isFinite(cG) || !Number.isFinite(cR) || cB >= cG || cG >= cR) {
    return [255, 255, 255];
  }

  if (freqHz <= cG) {
    const t = clamp((freqHz - cB) / Math.max(1e-9, cG - cB), 0, 1);
    return [0, Math.round(255 * t), Math.round(255 * (1 - t))];
  }

  const t = clamp((freqHz - cG) / Math.max(1e-9, cR - cG), 0, 1);
  return [Math.round(255 * t), Math.round(255 * (1 - t)), 0];
}

function normalizeFluxLog(v, maxPositive) {
  if (v < 0) return null;
  if (!(maxPositive > 0)) return 0;
  return Math.log10(1 + v) / Math.log10(1 + maxPositive);
}

function resetView() {
  const p = planeDims();
  state.view.u = 0;
  state.view.v = 0;
  state.view.w = axisSize(p.planeX);
  state.view.h = axisSize(p.planeY);
}

function getViewRect() {
  const p = planeDims();
  const tileRef = state.frameTiles && state.frameTiles.length ? state.frameTiles[0] : null;
  const imgW = tileRef ? tileRef.width : state.frameCanvas ? state.frameCanvas.width : axisSize(p.planeX);
  const imgH = tileRef ? tileRef.height : state.frameCanvas ? state.frameCanvas.height : axisSize(p.planeY);

  if (isVolumeMode()) {
    state.view.u = 0;
    state.view.v = 0;
    state.view.w = imgW;
    state.view.h = imgH;
    return {
      srcX: 0,
      srcY: 0,
      srcW: imgW,
      srcH: imgH,
      imgW,
      imgH,
    };
  }

  if (!Number.isFinite(state.view.w) || state.view.w <= 0 || !Number.isFinite(state.view.h) || state.view.h <= 0) {
    resetView();
  }

  const minW = Math.min(2, imgW);
  const minH = Math.min(2, imgH);
  state.view.w = clamp(state.view.w, minW, imgW);
  state.view.h = clamp(state.view.h, minH, imgH);
  state.view.u = clamp(state.view.u, 0, imgW - state.view.w);
  state.view.v = clamp(state.view.v, 0, imgH - state.view.h);

  return {
    srcX: state.view.u,
    srcY: state.view.v,
    srcW: state.view.w,
    srcH: state.view.h,
    imgW,
    imgH,
  };
}

function getDrawRect(viewRect) {
  const cw = els.canvas.width;
  const ch = els.canvas.height;
  const srcAspect = viewRect.srcW / Math.max(1e-6, viewRect.srcH);
  const canvasAspect = cw / Math.max(1e-6, ch);

  let w;
  let h;
  if (srcAspect >= canvasAspect) {
    w = cw;
    h = w / srcAspect;
  } else {
    h = ch;
    w = h * srcAspect;
  }

  return {
    x: (cw - w) / 2,
    y: (ch - h) / 2,
    w,
    h,
  };
}

function getGridDrawRects(viewRect) {
  const grid = Math.max(1, state.frameGrid || 1);
  const cw = els.canvas.width;
  const ch = els.canvas.height;
  const gap = grid > 1 ? 6 : 0;
  const maxCellW = (cw - gap * (grid - 1)) / grid;
  const maxCellH = (ch - gap * (grid - 1)) / grid;
  const cell = Math.max(8, Math.floor(Math.min(maxCellW, maxCellH)));
  const gridW = cell * grid + gap * (grid - 1);
  const gridH = cell * grid + gap * (grid - 1);
  const startX = (cw - gridW) / 2;
  const startY = (ch - gridH) / 2;
  const srcAspect = viewRect.srcW / Math.max(1e-6, viewRect.srcH);
  const tiles = [];
  const nTiles = state.frameTiles ? state.frameTiles.length : 0;

  for (let i = 0; i < nTiles; i += 1) {
    const row = Math.floor(i / grid);
    const col = i % grid;
    const cellX = startX + col * (cell + gap);
    const cellY = startY + row * (cell + gap);

    let w;
    let h;
    if (srcAspect >= 1) {
      w = cell;
      h = w / srcAspect;
    } else {
      h = cell;
      w = h * srcAspect;
    }
    tiles.push({
      x: cellX + (cell - w) / 2,
      y: cellY + (cell - h) / 2,
      w,
      h,
      cellX,
      cellY,
      cellW: cell,
      cellH: cell,
    });
  }

  return {
    x: startX,
    y: startY,
    w: gridW,
    h: gridH,
    tiles,
  };
}

function dataToScreen(u, v, viewRect, drawRect) {
  return {
    x: drawRect.x + ((u - viewRect.srcX) / viewRect.srcW) * drawRect.w,
    y: drawRect.y + ((v - viewRect.srcY) / viewRect.srcH) * drawRect.h,
  };
}

function screenToData(ev, viewRect, drawRect, forcedTile = null) {
  const rect = els.canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (els.canvas.width / Math.max(1, rect.width));
  const cy = (ev.clientY - rect.top) * (els.canvas.height / Math.max(1, rect.height));

  let usedRect = drawRect;
  let tile = 0;
  const tiles = state.drawTiles || [];
  if (tiles.length > 0) {
    if (forcedTile !== null && forcedTile !== undefined && tiles[forcedTile]) {
      usedRect = tiles[forcedTile];
      tile = forcedTile;
    } else {
      let found = -1;
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < tiles.length; i += 1) {
        const t = tiles[i];
        if (cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h) {
          found = i;
          break;
        }
        const dx = cx - clamp(cx, t.x, t.x + t.w);
        const dy = cy - clamp(cy, t.y, t.y + t.h);
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          best = i;
        }
      }
      tile = found >= 0 ? found : best;
      usedRect = tiles[tile] || drawRect;
    }
  }

  const xClamped = clamp(cx, usedRect.x, usedRect.x + usedRect.w);
  const yClamped = clamp(cy, usedRect.y, usedRect.y + usedRect.h);

  const ux = (xClamped - usedRect.x) / Math.max(1e-6, usedRect.w);
  const uy = (yClamped - usedRect.y) / Math.max(1e-6, usedRect.h);
  return {
    u: viewRect.srcX + ux * viewRect.srcW,
    v: viewRect.srcY + uy * viewRect.srcH,
    ux,
    uy,
    tile,
  };
}

function selectionBounds() {
  if (!state.selection) return null;
  const p = planeDims();
  const uSize = axisSize(p.planeX);
  const vSize = axisSize(p.planeY);
  const u0 = clamp(Math.min(state.selection.u0, state.selection.u1), 0, uSize - 1);
  const u1 = clamp(Math.max(state.selection.u0, state.selection.u1), 0, uSize - 1) + 1;
  const v0 = clamp(Math.min(state.selection.v0, state.selection.v1), 0, vSize - 1);
  const v1 = clamp(Math.max(state.selection.v0, state.selection.v1), 0, vSize - 1) + 1;
  return { u0, u1, v0, v1 };
}

function currentViewBounds() {
  const p = planeDims();
  const viewRect = getViewRect();
  const uSize = axisSize(p.planeX);
  const vSize = axisSize(p.planeY);
  const u0 = clamp(Math.floor(viewRect.srcX), 0, uSize - 1);
  const u1 = clamp(Math.ceil(viewRect.srcX + viewRect.srcW), u0 + 1, uSize);
  const v0 = clamp(Math.floor(viewRect.srcY), 0, vSize - 1);
  const v1 = clamp(Math.ceil(viewRect.srcY + viewRect.srcH), v0 + 1, vSize);
  return { u0, u1, v0, v1 };
}

function updateModeButtons() {
  els.modeInspectBtn.classList.toggle("activeMode", state.dragMode === "investigate");
  els.modeZoomBtn.classList.toggle("activeMode", state.dragMode === "zoom");
}

function updatePlaybackButtons() {
  const hidden = hiddenDim();
  const activeAxis = isPlaying() ? state.playbackAxis : null;
  const buttonState = [
    [els.timePlayBtn, "t"],
    [els.freqPlayBtn, "nu"],
    [els.hiddenPlayBtn, hidden],
  ];

  for (const [btn, axis] of buttonState) {
    const axisLen = isVolumeMode() && axis === hidden ? 1 : axisSize(axis);
    const active = activeAxis === axis;
    btn.disabled = axisLen <= 1;
    btn.textContent = active ? "Pause" : "Play";
    btn.classList.toggle("activePlay", active);
  }
}

function updatePlayUi() {
  els.playSpeedSelect.value = String(state.playbackFps);
  updatePlaybackButtons();
}

function updatePolButtonState() {
  const polSize = axisSize("pol");
  const evpaSupported = !isVolumeMode() && state.plane === "xy" && polSize >= 3;
  if (isDerivedPolModeActive() && !derivedPolSupported(state.derivedPolMode, polSize)) {
    state.derivedPolMode = "none";
  }
  if (!evpaSupported) state.showEvpa = false;

  els.polButtons.forEach((btn, idx) => {
    btn.textContent = polLabel(idx);
    btn.disabled = idx >= polSize;
    btn.classList.toggle("activePol", !isDerivedPolModeActive() && idx === state.values.pol);
  });

  els.evpaToggleBtn.textContent = evpaSupported ? "EVPA" : "EVPA (XY)";
  els.evpaToggleBtn.disabled = !evpaSupported;
  els.evpaToggleBtn.classList.toggle("activeAux", state.showEvpa);
  els.evpaDensitySelect.disabled = !evpaSupported;
  els.evpaDensitySelect.value = String(state.evpaStep);
  els.evpaIThresholdSelect.disabled = !evpaSupported;
  const iThresholdPct = clamp(Math.round(state.evpaIMinFraction * 100), 0, 100);
  const evpaThresholdOptions = [0, 1, 3, 5, 10];
  const nearestPct = evpaThresholdOptions.reduce((best, cur) =>
    Math.abs(cur - iThresholdPct) < Math.abs(best - iThresholdPct) ? cur : best
  );
  els.evpaIThresholdSelect.value = String(nearestPct);

  const derivedButtons = [
    ["frac", els.fracPolBtn],
    ["bfield", els.bfieldBtn],
    ["linear", els.linPolBtn],
    ["circular", els.circPolBtn],
  ];
  for (const [mode, btn] of derivedButtons) {
    const supported = derivedPolSupported(mode, polSize);
    btn.disabled = !supported;
    btn.classList.toggle("activeDerived", state.derivedPolMode === mode);
  }

  if (isDerivedPolModeActive()) {
    els.polValue.textContent = `Current: ${derivedPolLabel(state.derivedPolMode)}`;
  } else {
    els.polValue.textContent = `Current: ${polLabel(state.values.pol)} (index ${state.values.pol})`;
  }
}

function updateSampleViewOptions() {
  const maxGrid = maxGridSize();
  const options = [1, 4, 9, 16];
  for (const count of options) {
    const g = Math.round(Math.sqrt(count));
    const opt = Array.from(els.sampleGridCountSelect.options).find((o) => Number.parseInt(o.value, 10) === count);
    if (opt) opt.disabled = g > maxGrid;
  }
}

function updateSliderReadouts(selectedCoords) {
  const tCoord = selectedCoords && selectedCoords.t !== undefined ? selectedCoords.t : dimCoord("t", state.values.t);
  const nuCoord = selectedCoords && selectedCoords.nu !== undefined ? selectedCoords.nu : dimCoord("nu", state.values.nu);
  const hDim = hiddenDim();
  const hCoord =
    selectedCoords && selectedCoords[hDim] !== undefined ? selectedCoords[hDim] : dimCoord(hDim, state.values[hDim]);

  els.tValue.textContent = `${state.values.t} | ${fmtPhysical("t", tCoord, dimUnit("t"))}`;
  els.nuValue.textContent = `${state.values.nu} | ${fmtPhysical("nu", nuCoord, dimUnit("nu"))}`;

  const hText = `${state.values[hDim]} | ${fmtPhysical(hDim, hCoord, dimUnit(hDim))}`;
  els.hiddenNavValue.textContent = hText;
}

function updateSpatialProfileTitle(profile) {
  if (profile && profile.axis) {
    els.spatialProfileTitle.textContent = `${profile.axis.toUpperCase()} Flux Profile`;
  } else {
    els.spatialProfileTitle.textContent = `${hiddenDim().toUpperCase()} Flux Profile`;
  }
}

function updateDomainVisibility() {
  const volumeMode = isVolumeMode();
  const tVarying = axisVarying("t");
  const nuVarying = axisVarying("nu");
  const sampleVarying = axisVarying("sample");
  const polVarying = axisVarying("pol");
  const hiddenAxis = hiddenDim();
  const hiddenSpatialVarying = axisVarying(hiddenAxis);

  if (!sampleVarying && isSamplesMode()) {
    state.sampleMode = "mean";
    state.sampleGridSize = 1;
    state.sampleGridIndices = [0];
    state.activeSampleTile = 0;
  }

  if (!tVarying) {
    state.axisWindow.t = null;
    delete state.profileZoom.t;
    state.values.t = 0;
  }
  if (!nuVarying) {
    state.axisWindow.nu = null;
    delete state.profileZoom.nu;
    state.values.nu = 0;
  }
  if (!hiddenSpatialVarying) {
    delete state.profileZoom[hiddenAxis];
    state.values[hiddenAxis] = 0;
  }

  if (!polVarying) {
    state.derivedPolMode = "none";
    state.showEvpa = false;
    state.values.pol = 0;
  }

  if (isPlaying() && (!state.playbackAxis || axisSize(state.playbackAxis) <= 1)) {
    stopPlayback();
  }
  if (volumeMode && state.playbackAxis === hiddenAxis) {
    stopPlayback();
  }

  setVisible(els.temporalControlGroup, tVarying);
  setVisible(els.spectralControlGroup, nuVarying);
  setVisible(els.planeLabel, !volumeMode);
  setVisible(els.hiddenNavPanel, !volumeMode && hiddenSpatialVarying);
  setVisible(els.volumeRenderControls, volumeMode);
  setVisible(els.polarizationControlGroup, polVarying);
  setVisible(els.sampleModeBlock, sampleVarying);
  setVisible(els.playSpeedLabel, tVarying || nuVarying || (!volumeMode && hiddenSpatialVarying));

  setVisible(els.timeProfileBlock, tVarying);
  setVisible(els.spectrumProfileBlock, nuVarying);
  setVisible(els.spatialProfileBlock, hiddenSpatialVarying);

  if (els.metricsHint) {
    const anyProfile = tVarying || nuVarying || hiddenSpatialVarying;
    els.metricsHint.textContent = anyProfile
      ? "Click for point or drag for area."
      : "No varying temporal/spectral/spatial axis available for profiles.";
  }
  updateVolumeControlReadouts();
}

function updateControlCaps() {
  ["sample", "pol", "t", "nu", "x", "y", "z"].forEach((dim) => {
    const max = Math.max(0, axisSize(dim) - 1);
    state.values[dim] = clamp(state.values[dim], 0, max);
  });

  const hDim = hiddenDim();
  els.hiddenAxisTitle.textContent = `Unused Spatial Axis (${hDim.toUpperCase()})`;
  els.spatialSliceBtn.classList.toggle("activeSpatial", state.spatialMode === "slice");
  els.spatialVolumeBtn.classList.toggle("activeSpatial", state.spatialMode === "volume");
  updateDomainVisibility();

  updateSampleViewOptions();
  if (isSamplesMode()) ensureGridIndices();
  els.sampleGridCountSelect.value = String(state.sampleGridSize * state.sampleGridSize);
  els.sampleModeMeanBtn.classList.toggle("activeSampleMode", state.sampleMode === "mean");
  els.sampleModeStdBtn.classList.toggle("activeSampleMode", state.sampleMode === "std");
  els.sampleModeRelBtn.classList.toggle("activeSampleMode", state.sampleMode === "rel_uncert");
  els.sampleModeSamplesBtn.classList.toggle("activeSampleMode", isSamplesMode());
  els.sampleMosaicControls.style.display = isSamplesMode() ? "flex" : "none";
  els.colorRangeModeSelect.value = state.colorRangeMode;
  if (els.sliceBackendSelect) {
    els.sliceBackendSelect.value = state.sliceRender.backend;
  }
  els.planeSelect.value = state.plane;
  els.planeSelect.disabled = isVolumeMode();
  const msAvailable = axisSize("nu") >= 3 && state.sampleMode !== "rel_uncert" && !isDerivedPolModeActive() && !isVolumeMode();
  if (!msAvailable) state.multiSpectral = false;
  els.multiSpectralBtn.disabled = !msAvailable;
  els.multiSpectralBtn.textContent = state.multiSpectral ? "On" : "Off";
  els.multiSpectralBtn.classList.toggle("activeAux", state.multiSpectral);
  els.fluxScaleLinearBtn.classList.toggle("activeScale", state.fluxScale === "linear");
  els.fluxScaleLogBtn.classList.toggle("activeScale", state.fluxScale === "log");
  els.resampleSamplesBtn.disabled = !isSamplesMode();

  updatePolButtonState();
  updateModeButtons();
  updatePlayUi();
  updateSliderReadouts(state.selectedCoords);
  updateSpatialProfileTitle(state.profiles ? state.profiles.spatial_profile : null);
}

function setFluxScale(mode) {
  if (mode !== "linear" && mode !== "log") return;
  if (state.fluxScale === mode) return;
  state.fluxScale = mode;
  updateControlCaps();
  drawSelectionGraphs();
  refreshSlice();
}

function onVolumeRenderControlChange() {
  if (els.volumeBackendSelect) {
    const backend = els.volumeBackendSelect.value;
    if (backend === "auto" || backend === "gpu" || backend === "cpu") {
      state.volumeRender.backend = backend;
    }
  }
  if (els.volumeRenderModeSelect) {
    const mode = els.volumeRenderModeSelect.value;
    if (["composite", "mip", "minip", "average", "isosurface"].includes(mode)) {
      state.volumeRender.mode = mode;
    }
  }
  if (els.volumeTfSelect) {
    const tf = els.volumeTfSelect.value;
    if (["linear", "sqrt", "square", "sigmoid"].includes(tf)) {
      state.volumeRender.tf = tf;
    }
  }
  const q = els.volumeQualitySelect ? els.volumeQualitySelect.value : "balanced";
  if (["draft", "balanced", "fine", "ultra"].includes(q)) {
    state.volumeRender.quality = q;
  }
  if (els.volumeOpacityRange) {
    const v = Number.parseFloat(els.volumeOpacityRange.value);
    if (Number.isFinite(v)) state.volumeRender.opacity = clamp(v, 0.1, 12.0);
  }
  if (els.volumeGammaRange) {
    const v = Number.parseFloat(els.volumeGammaRange.value);
    if (Number.isFinite(v)) state.volumeRender.gamma = clamp(v, 0.4, 2.4);
  }
  if (els.volumeCutoffRange) {
    const v = Number.parseFloat(els.volumeCutoffRange.value);
    if (Number.isFinite(v)) state.volumeRender.cutoff = clamp(v, 0, 0.9);
  }
  if (els.volumeClipNearRange) {
    const v = Number.parseFloat(els.volumeClipNearRange.value);
    if (Number.isFinite(v)) state.volumeRender.clipNear = clamp(v, 0, 0.95);
  }
  if (els.volumeClipFarRange) {
    const v = Number.parseFloat(els.volumeClipFarRange.value);
    if (Number.isFinite(v)) state.volumeRender.clipFar = clamp(v, 0.05, 1.0);
  }
  if (state.volumeRender.clipFar <= state.volumeRender.clipNear + 0.01) {
    if (els.volumeClipNearRange && document.activeElement === els.volumeClipNearRange) {
      state.volumeRender.clipFar = clamp(state.volumeRender.clipNear + 0.01, 0.05, 1.0);
    } else {
      state.volumeRender.clipNear = clamp(state.volumeRender.clipFar - 0.01, 0, 0.95);
    }
  }
  if (els.volumeIsoThresholdRange) {
    const v = Number.parseFloat(els.volumeIsoThresholdRange.value);
    if (Number.isFinite(v)) state.volumeRender.isoThreshold = clamp(v, 0.01, 0.99);
  }
  if (state.volumeRender.backend !== "cpu") {
    ensureVolumeGpuRenderer();
  }
  updateVolumeControlReadouts();
  if (isVolumeMode()) rerenderVolumeFrame();
}

function drawEvpaOverlay(viewRect, drawRect) {
  if (isVolumeMode()) return;
  if (!state.showEvpa || state.plane !== "xy") return;
  const ctx = els.canvas.getContext("2d");
  const tiles = state.drawTiles && state.drawTiles.length ? state.drawTiles : [drawRect];
  const hasTicks = state.evpaTicks.length > 0 || Object.keys(state.evpaTicksBySample || {}).length > 0;
  if (!hasTicks) return;

  for (let i = 0; i < tiles.length; i += 1) {
    const tileRect = tiles[i];
    ctx.save();
    ctx.beginPath();
    ctx.rect(tileRect.x, tileRect.y, tileRect.w, tileRect.h);
    ctx.clip();
    ctx.strokeStyle = "#ffe37a";
    ctx.lineWidth = 1.2;

    let ticks = state.evpaTicks;
    if (isSamplesMode() && state.frameTiles && state.frameTiles.length > 1) {
      const sampleIdx = state.sampleGridIndices[i];
      ticks = state.evpaTicksBySample[String(sampleIdx)] || state.evpaTicks;
    }
    for (const tick of ticks) {
      const p0 = dataToScreen(tick.x - tick.dx, tick.y - tick.dy, viewRect, tileRect);
      const p1 = dataToScreen(tick.x + tick.dx, tick.y + tick.dy, viewRect, tileRect);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawSelectionOverlay(viewRect, drawRect) {
  if (isVolumeMode()) return;
  if (!state.selection) return;
  const b = selectionBounds();
  if (!b) return;
  const tileRects = state.drawTiles && state.drawTiles.length ? state.drawTiles : [drawRect];

  const ctx = els.canvas.getContext("2d");
  for (const tileRect of tileRects) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(tileRect.x, tileRect.y, tileRect.w, tileRect.h);
    ctx.clip();
    ctx.strokeStyle = "#49b8ff";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);

    const p0 = dataToScreen(b.u0, b.v0, viewRect, tileRect);
    const p1 = dataToScreen(b.u1, b.v1, viewRect, tileRect);
    const x = Math.min(p0.x, p1.x);
    const y = Math.min(p0.y, p1.y);
    const w = Math.abs(p1.x - p0.x);
    const h = Math.abs(p1.y - p0.y);

    if (w <= 2 && h <= 2) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.stroke();
    } else {
      ctx.strokeRect(x, y, Math.max(1, w), Math.max(1, h));
    }
    ctx.restore();
  }
}

function drawZoomDragOverlay(viewRect, drawRect) {
  if (isVolumeMode()) return;
  if (!state.zoomDrag) return;
  const tileRect =
    state.drawTiles && state.drawTiles.length
      ? state.drawTiles[clamp(state.zoomDrag.tile || 0, 0, state.drawTiles.length - 1)]
      : drawRect;
  const p0 = dataToScreen(state.zoomDrag.startU, state.zoomDrag.startV, viewRect, tileRect);
  const p1 = dataToScreen(state.zoomDrag.lastU, state.zoomDrag.lastV, viewRect, tileRect);

  const ctx = els.canvas.getContext("2d");
  ctx.save();
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(
    Math.min(p0.x, p1.x),
    Math.min(p0.y, p1.y),
    Math.max(1, Math.abs(p1.x - p0.x)),
    Math.max(1, Math.abs(p1.y - p0.y))
  );
  ctx.restore();
}

function niceScaleValue(target) {
  if (!Number.isFinite(target) || target <= 0) return null;
  const exp = 10 ** Math.floor(Math.log10(target));
  const frac = target / exp;
  if (frac < 1.5) return 1 * exp;
  if (frac < 3.5) return 2 * exp;
  if (frac < 7.5) return 5 * exp;
  return 10 * exp;
}

function fmtScale(dim, value, unit) {
  if (!Number.isFinite(value)) return "";
  if (dim === "nu" || unit === "Hz") return `${(value / 1.0e9).toFixed(3)} GHz`;
  const abs = Math.abs(value);
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return `${value.toExponential(2)} ${unit}`.trim();
  return `${value.toFixed(2)} ${unit}`.trim();
}

function drawOrientationAndScale(viewRect, drawRect) {
  if (isVolumeMode()) return;
  const ctx = els.canvas.getContext("2d");
  ctx.save();
  const canvasW = els.canvas.width;
  const canvasH = els.canvas.height;
  const baseX = canvasW - 56;
  const baseY = 58;
  const arrow = 26;

  ctx.strokeStyle = "rgba(237, 242, 247, 0.9)";
  ctx.fillStyle = "rgba(237, 242, 247, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.font = "11px sans-serif";

  if (state.plane === "xy") {
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX, baseY - arrow);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX - arrow, baseY);
    ctx.stroke();
    ctx.fillText("N", baseX - 3, baseY - arrow - 6);
    ctx.fillText("E", baseX - arrow - 16, baseY + 4);
  } else {
    const p = planeDims();
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX, baseY - arrow);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX + arrow, baseY);
    ctx.stroke();
    ctx.fillText(`+${p.planeY.toUpperCase()}`, baseX - 6, baseY - arrow - 4);
    ctx.fillText(`+${p.planeX.toUpperCase()}`, baseX + arrow + 2, baseY + 4);
  }

  const p = planeDims();
  const dim = p.planeX;
  const unit = dimUnit(dim);
  const c0 = dimCoord(dim, viewRect.srcX);
  const c1 = dimCoord(dim, viewRect.srcX + viewRect.srcW - 1);
  if (c0 !== null && c1 !== null && Number.isFinite(c0) && Number.isFinite(c1)) {
    const span = Math.abs(c1 - c0);
    const target = span * 0.22;
    const length = niceScaleValue(target);
    if (length && span > 0) {
      const px = (length / span) * canvasW * 0.55;
      if (px >= 20 && px <= canvasW * 0.6) {
        const sx = 30;
        const sy = canvasH - 26;
        ctx.strokeStyle = "rgba(237, 242, 247, 0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + px, sy);
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 4);
        ctx.lineTo(sx, sy + 4);
        ctx.moveTo(sx + px, sy - 4);
        ctx.lineTo(sx + px, sy + 4);
        ctx.stroke();
        ctx.fillStyle = "rgba(237, 242, 247, 0.95)";
        ctx.fillText(fmtScale(dim, length, unit), sx, sy - 7);
      }
    }
  }

  ctx.restore();
}

function drawFrameAndOverlays() {
  const ctx = els.canvas.getContext("2d");
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = "#070a11";
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);

  if (!state.frameCanvas && !(state.frameTiles && state.frameTiles.length)) return;

  const viewRect = getViewRect();
  let drawRect;
  state.drawTiles = [];
  ctx.imageSmoothingEnabled = false;

  if (state.frameTiles && state.frameTiles.length) {
    const gridRects = getGridDrawRects(viewRect);
    drawRect = { x: gridRects.x, y: gridRects.y, w: gridRects.w, h: gridRects.h };
    state.drawTiles = gridRects.tiles;

    for (let i = 0; i < state.frameTiles.length && i < gridRects.tiles.length; i += 1) {
      const tileCanvas = state.frameTiles[i];
      const tileRect = gridRects.tiles[i];
      ctx.drawImage(
        tileCanvas,
        viewRect.srcX,
        viewRect.srcY,
        viewRect.srcW,
        viewRect.srcH,
        tileRect.x,
        tileRect.y,
        tileRect.w,
        tileRect.h
      );

      if (isSamplesMode() && Number.isInteger(state.sampleGridIndices[i])) {
        const label = `S${state.sampleGridIndices[i]}`;
        ctx.save();
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#d9e6f5";
        ctx.textBaseline = "top";
        const lx = (tileRect.cellX ?? tileRect.x) + 8;
        const ly = (tileRect.cellY ?? tileRect.y) + 7;
        ctx.fillText(label, lx, ly);
        ctx.restore();
      }
    }
  } else {
    drawRect = getDrawRect(viewRect);
    state.drawTiles = [drawRect];
    ctx.drawImage(
      state.frameCanvas,
      viewRect.srcX,
      viewRect.srcY,
      viewRect.srcW,
      viewRect.srcH,
      drawRect.x,
      drawRect.y,
      drawRect.w,
      drawRect.h
    );
  }
  state.drawRect = drawRect;

  drawOrientationAndScale(viewRect, drawRect);
  drawEvpaOverlay(viewRect, drawRect);
  drawSelectionOverlay(viewRect, drawRect);
  drawZoomDragOverlay(viewRect, drawRect);
}

function minMax(values) {
  return finiteMinMax(values) || { min: 0, max: 1 };
}

function payloadFullShape(payload, width, height) {
  if (payload && Array.isArray(payload.full_shape) && payload.full_shape.length === 2) {
    const fw = Number.parseInt(payload.full_shape[0], 10);
    const fh = Number.parseInt(payload.full_shape[1], 10);
    if (Number.isFinite(fw) && Number.isFinite(fh) && fw > 0 && fh > 0) {
      return [fw, fh];
    }
  }
  return [width, height];
}

function upscaleCanvasNearest(srcCanvas, targetW, targetH) {
  if (!srcCanvas) return null;
  if (srcCanvas.width === targetW && srcCanvas.height === targetH) return srcCanvas;
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);
  return out;
}

function createSingleCanvasCpu(slice, rangeOverride = null) {
  const [width, height] = slice.shape;
  const img = els.canvas.getContext("2d").createImageData(width, height);
  const values = slice.values;
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
  let maxPositive = 0;
  if (state.fluxScale === "log") {
    if (fixedStats) {
      maxPositive = Math.max(0, fixedStats.max);
    } else if (sliceStats) {
      maxPositive = Math.max(0, sliceStats.max);
    } else {
      for (let i = 0; i < values.length; i += 1) {
        if (values[i] > maxPositive) maxPositive = values[i];
      }
    }
  }

  // Backend flattens as (plane_x, plane_y) in C-order: idx = x * height + y.
  // ImageData expects raster order: idx = y * width + x.
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const src = x * height + y;
      const v = values[src];
      let rgb;
      if (state.fluxScale === "log") {
        const norm = normalizeFluxLog(v, maxPositive);
        rgb = norm === null ? [255, 255, 255] : colorForNorm(norm);
      } else {
        const norm = normalizeForColormap(v, mm);
        rgb = norm === null ? [255, 255, 255] : colorForNorm(norm);
      }
      const [r, g, b] = rgb;
      const dst = (y * width + x) * 4;
      img.data[dst + 0] = r;
      img.data[dst + 1] = g;
      img.data[dst + 2] = b;
      img.data[dst + 3] = 255;
    }
  }

  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  off.getContext("2d").putImageData(img, 0, 0);
  return off;
}

function createSingleCanvas(slice, rangeOverride = null) {
  const [width, height] = slice.shape;
  const [fullW, fullH] = payloadFullShape(slice, width, height);
  if (sliceBackendMode(width, height) === "gpu") {
    const renderer = ensureSliceGpuRenderer();
    if (renderer) {
      try {
        const gpu = renderer.render(slice, rangeOverride);
        if (gpu) return upscaleCanvasNearest(gpu, fullW, fullH);
      } catch (err) {
        state.sliceGpu.lastError = err && err.message ? err.message : "render failed";
        state.sliceGpu.available = false;
        state.sliceGpu.renderer = null;
      }
    }
  }
  return upscaleCanvasNearest(createSingleCanvasCpu(slice, rangeOverride), fullW, fullH);
}

function createRgbCanvas(width, height, redVals, greenVals, blueVals, payload = null) {
  const img = els.canvas.getContext("2d").createImageData(width, height);
  const mmR = minMax(redVals);
  const mmG = minMax(greenVals);
  const mmB = minMax(blueVals);
  const spanR = mmR.max - mmR.min || 1;
  const spanG = mmG.max - mmG.min || 1;
  const spanB = mmB.max - mmB.min || 1;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;
  if (state.fluxScale === "log") {
    for (let i = 0; i < redVals.length; i += 1) {
      if (redVals[i] > maxR) maxR = redVals[i];
      if (greenVals[i] > maxG) maxG = greenVals[i];
      if (blueVals[i] > maxB) maxB = blueVals[i];
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const src = x * height + y;
      const rv = redVals[src];
      const gv = greenVals[src];
      const bv = blueVals[src];
      let r;
      let g;
      let b;
      if (state.fluxScale === "log") {
        if (rv < 0 || gv < 0 || bv < 0) {
          r = 1;
          g = 1;
          b = 1;
        } else {
          r = normalizeFluxLog(rv, maxR) ?? 0;
          g = normalizeFluxLog(gv, maxG) ?? 0;
          b = normalizeFluxLog(bv, maxB) ?? 0;
        }
      } else {
        r = clamp((rv - mmR.min) / spanR, 0, 1);
        g = clamp((gv - mmG.min) / spanG, 0, 1);
        b = clamp((bv - mmB.min) / spanB, 0, 1);
      }
      const dst = (y * width + x) * 4;
      img.data[dst + 0] = Math.round(r * 255);
      img.data[dst + 1] = Math.round(g * 255);
      img.data[dst + 2] = Math.round(b * 255);
      img.data[dst + 3] = 255;
    }
  }

  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  off.getContext("2d").putImageData(img, 0, 0);
  const [fullW, fullH] = payloadFullShape(payload, width, height);
  return upscaleCanvasNearest(off, fullW, fullH);
}

function trilinearSample(values, nx, ny, nz, fx, fy, fz) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const z1 = Math.min(nz - 1, z0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;

  const idx = (x, y, z) => (x * ny + y) * nz + z;

  const c000 = values[idx(x0, y0, z0)];
  const c001 = values[idx(x0, y0, z1)];
  const c010 = values[idx(x0, y1, z0)];
  const c011 = values[idx(x0, y1, z1)];
  const c100 = values[idx(x1, y0, z0)];
  const c101 = values[idx(x1, y0, z1)];
  const c110 = values[idx(x1, y1, z0)];
  const c111 = values[idx(x1, y1, z1)];

  const c00 = c000 * (1 - tx) + c100 * tx;
  const c01 = c001 * (1 - tx) + c101 * tx;
  const c10 = c010 * (1 - tx) + c110 * tx;
  const c11 = c011 * (1 - tx) + c111 * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}

const { buildVolumeParams, buildSliceParams, buildMultispectralParams, buildRangeParams, profileRequestBody } =
  createRequestBuilders({
    state,
    planeDims,
  });

const { GpuSliceRenderer, GpuVolumeRenderer, GPU_VOLUME_MAX_STEPS } = createGpuRenderers({
  state,
  colorForNorm,
  isValidRangeStats,
  minMax,
  volumeQualityConfig,
  clamp,
  isDerivedPolModeActive,
  volumeRenderModeInt,
  volumeTfModeInt,
});
function ensureSliceGpuRenderer() {
  if (state.sliceGpu.renderer) {
    state.sliceGpu.available = true;
    return state.sliceGpu.renderer;
  }
  if (state.sliceGpu.available === false) return null;
  try {
    const renderer = new GpuSliceRenderer();
    state.sliceGpu.renderer = renderer;
    state.sliceGpu.available = true;
    state.sliceGpu.lastError = "";
    return renderer;
  } catch (err) {
    state.sliceGpu.renderer = null;
    state.sliceGpu.available = false;
    state.sliceGpu.lastError = err && err.message ? err.message : "initialization failed";
    return null;
  }
}

function ensureVolumeGpuRenderer() {
  if (state.volumeGpu.renderer) {
    state.volumeGpu.available = true;
    return state.volumeGpu.renderer;
  }
  if (state.volumeGpu.available === false) return null;
  try {
    const renderer = new GpuVolumeRenderer();
    state.volumeGpu.renderer = renderer;
    state.volumeGpu.available = true;
    state.volumeGpu.lastError = "";
    return renderer;
  } catch (err) {
    state.volumeGpu.renderer = null;
    state.volumeGpu.available = false;
    state.volumeGpu.lastError = err && err.message ? err.message : "initialization failed";
    return null;
  } finally {
    updateVolumeControlReadouts();
  }
}

function createVolumeCanvasAuto(volume, resolution = 240) {
  const backend = volumeBackendMode();
  if (backend === "gpu") {
    const renderer = ensureVolumeGpuRenderer();
    if (renderer) {
      try {
        const gpu = renderer.render(volume, resolution);
        if (gpu) return gpu;
      } catch (err) {
        state.volumeGpu.lastError = err && err.message ? err.message : "render failed";
        state.volumeGpu.available = false;
        state.volumeGpu.renderer = null;
        updateVolumeControlReadouts();
      }
    }
  }
  return createVolumeCanvasCpu(volume, resolution);
}

function createVolumeCanvasCpu(volume, resolution = 240) {
  const off = document.createElement("canvas");
  off.width = resolution;
  off.height = resolution;

  if (!volume || !Array.isArray(volume.shape) || volume.shape.length !== 3 || !Array.isArray(volume.values)) {
    return off;
  }

  const nx = volume.shape[0];
  const ny = volume.shape[1];
  const nz = volume.shape[2];
  const values = volume.values;
  if (nx < 2 || ny < 2 || nz < 2 || values.length !== nx * ny * nz) return off;

  const img = els.canvas.getContext("2d").createImageData(resolution, resolution);
  const mm = minMax(values);
  const maxAbs = Math.max(Math.abs(mm.min), Math.abs(mm.max), 1.0e-9);
  let maxPositive = 0;
  if (state.fluxScale === "log") {
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] > maxPositive) maxPositive = values[i];
    }
  }

  const yaw = state.volumeYaw;
  const pitch = state.volumePitch;
  const planeScale = 1.05 / clamp(state.volumeZoom, 0.35, 10.0);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const qCfg = volumeQualityConfig();
  const steps = clamp(Math.round(Math.max(nx, ny, nz) * qCfg.stepMul), 24, 160);
  const opacityGain = clamp(state.volumeRender.opacity, 0.1, 12.0);
  const gamma = clamp(state.volumeRender.gamma, 0.4, 2.4);
  const cutoff = clamp(state.volumeRender.cutoff, 0, 0.9);
  const clipNear = clamp(state.volumeRender.clipNear, 0, 0.95);
  const clipFar = clamp(state.volumeRender.clipFar, clipNear + 0.01, 1.0);
  const isoThreshold = clamp(state.volumeRender.isoThreshold, 0.01, 0.99);
  const mode = state.volumeRender.mode;
  const alphaBase = clamp((2.4 / Math.max(24, steps)) * opacityGain, 0.004, 0.34);
  const ldx = 0.58;
  const ldy = 0.5;
  const ldz = 0.65;
  const llen = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz) || 1;
  const lx = ldx / llen;
  const ly = ldy / llen;
  const lz = ldz / llen;

  for (let py = 0; py < resolution; py += 1) {
    const v = ((py + 0.5) / resolution) * 2 - 1;
    for (let px = 0; px < resolution; px += 1) {
      const u = ((px + 0.5) / resolution) * 2 - 1;
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;
      let bestMaxNorm = -Number.POSITIVE_INFINITY;
      let bestMinNorm = Number.POSITIVE_INFINITY;
      let avgNorm = 0;
      let avgCount = 0;

      for (let si = 0; si < steps; si += 1) {
        const frac = si / Math.max(1, steps - 1);
        if (frac < clipNear || frac > clipFar) continue;
        const depth = -1.15 + (si / Math.max(1, steps - 1)) * 2.3;
        const cx = u * planeScale;
        const cyv = -v * planeScale;
        const cz = depth;

        const x1 = cx;
        const y1 = cyv * cp + cz * sp;
        const z1 = -cyv * sp + cz * cp;

        const ox = x1 * cy - z1 * sy;
        const oy = y1;
        const oz = x1 * sy + z1 * cy;

        if (Math.abs(ox) > 1 || Math.abs(oy) > 1 || Math.abs(oz) > 1) continue;

        const fx = (ox * 0.5 + 0.5) * (nx - 1);
        const fy = (oy * 0.5 + 0.5) * (ny - 1);
        const fz = (oz * 0.5 + 0.5) * (nz - 1);
        const sample = trilinearSample(values, nx, ny, nz, fx, fy, fz);
        if (!Number.isFinite(sample)) continue;

        let norm;
        if (state.fluxScale === "log") {
          norm = normalizeFluxLog(sample, maxPositive);
          if (norm === null) continue;
        } else {
          norm = normalizeForColormap(sample, mm);
          if (norm === null) continue;
        }
        const [r, g, b] = colorForNorm(norm);

        let density;
        if (state.colorMap === "diverging" && mm.min < 0 && mm.max > 0) {
          density = Math.abs(sample) / maxAbs;
        } else if (state.colorMap === "circular" && isDerivedPolModeActive() && state.derivedPolMode === "bfield") {
          density = 0.58;
        } else {
          density = norm;
        }

        if (mode === "mip") {
          if (norm > bestMaxNorm) {
            bestMaxNorm = norm;
            rAcc = r / 255;
            gAcc = g / 255;
            bAcc = b / 255;
          }
          continue;
        }
        if (mode === "minip") {
          if (norm < bestMinNorm) {
            bestMinNorm = norm;
            rAcc = r / 255;
            gAcc = g / 255;
            bAcc = b / 255;
          }
          continue;
        }
        if (mode === "average") {
          avgNorm += norm;
          avgCount += 1;
          continue;
        }
        if (mode === "isosurface") {
          if (density < isoThreshold) continue;
          const eps = 0.75;
          const gx = trilinearSample(values, nx, ny, nz, clamp(fx + eps, 0, nx - 1), fy, fz) -
            trilinearSample(values, nx, ny, nz, clamp(fx - eps, 0, nx - 1), fy, fz);
          const gy = trilinearSample(values, nx, ny, nz, fx, clamp(fy + eps, 0, ny - 1), fz) -
            trilinearSample(values, nx, ny, nz, fx, clamp(fy - eps, 0, ny - 1), fz);
          const gz = trilinearSample(values, nx, ny, nz, fx, fy, clamp(fz + eps, 0, nz - 1)) -
            trilinearSample(values, nx, ny, nz, fx, fy, clamp(fz - eps, 0, nz - 1));
          const gnorm = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
          const nxg = gx / gnorm;
          const nyg = gy / gnorm;
          const nzg = gz / gnorm;
          const shade = 0.32 + 0.68 * Math.max(0, nxg * lx + nyg * ly + nzg * lz);
          rAcc = clamp((r / 255) * shade, 0, 1);
          gAcc = clamp((g / 255) * shade, 0, 1);
          bAcc = clamp((b / 255) * shade, 0, 1);
          aAcc = 1;
          break;
        }

        const dn = clamp((density - cutoff) / Math.max(1.0e-6, 1 - cutoff), 0, 1);
        if (dn <= 0) continue;
        const shaped = volumeTransferShape(Math.pow(dn, gamma));
        const depthBoost = 0.86 + 0.24 * (si / Math.max(1, steps - 1));
        const a = clamp(shaped * alphaBase, 0, 0.35);
        const rem = 1 - aAcc;
        rAcc += rem * a * clamp((r / 255) * depthBoost, 0, 1);
        gAcc += rem * a * clamp((g / 255) * depthBoost, 0, 1);
        bAcc += rem * a * clamp((b / 255) * depthBoost, 0, 1);
        aAcc += rem * a;
        if (aAcc >= 0.985) break;
      }

      if (mode === "average" && avgCount > 0) {
        const [ar, ag, ab] = colorForNorm(clamp(avgNorm / avgCount, 0, 1));
        rAcc = ar / 255;
        gAcc = ag / 255;
        bAcc = ab / 255;
      }

      const di = (py * resolution + px) * 4;
      img.data[di + 0] = Math.round(clamp(rAcc, 0, 1) * 255);
      img.data[di + 1] = Math.round(clamp(gAcc, 0, 1) * 255);
      img.data[di + 2] = Math.round(clamp(bAcc, 0, 1) * 255);
      img.data[di + 3] = 255;
    }
  }

  off.getContext("2d").putImageData(img, 0, 0);
  return off;
}

function sharedStatsFromPayloads(payloads) {
  if (!Array.isArray(payloads) || !payloads.length) return null;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of payloads) {
    if (!p || !p.stats) continue;
    if (Number.isFinite(p.stats.min) && p.stats.min < min) min = p.stats.min;
    if (Number.isFinite(p.stats.max) && p.stats.max > max) max = p.stats.max;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

function drawColorbar() {
  const ctx = els.colorbarCanvas.getContext("2d");
  const w = els.colorbarCanvas.width;
  const h = els.colorbarCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const unit = state.currentIntensityUnit || (state.meta ? state.meta.intensity_unit || "" : "");
  if (state.multiSpectral && state.currentMultispectralBands) {
    const bands = state.currentMultispectralBands;
    const nuMin = bands.blue ? bands.blue[0] : 0;
    const nuMax = bands.red ? bands.red[1] : 1;
    const nuSpan = Math.max(1e-9, nuMax - nuMin);
    const unitNu = bands.unit || dimUnit("nu") || "Hz";

    for (let x = 0; x < w; x += 1) {
      const t = x / Math.max(1, w - 1);
      const nu = nuMin + t * nuSpan;
      const [r, g, b] = colorForSpectralNu(nu, bands);
      ctx.fillStyle = `rgb(${r} ${g} ${b})`;
      ctx.fillRect(x, 0, 1, h);
    }

    const bgEdge = 0.5 * ((bands.blue?.[1] ?? nuMin) + (bands.green?.[0] ?? nuMin));
    const grEdge = 0.5 * ((bands.green?.[1] ?? nuMax) + (bands.red?.[0] ?? nuMax));
    const xOf = (nu) => ((nu - nuMin) / nuSpan) * (w - 1);
    ctx.strokeStyle = "rgba(237, 242, 247, 0.85)";
    ctx.lineWidth = 1;
    for (const edge of [bgEdge, grEdge]) {
      if (Number.isFinite(edge) && edge > nuMin && edge < nuMax) {
        const x = xOf(edge);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    els.colorbarMin.textContent = fmtPhysical("nu", nuMin, unitNu);
    els.colorbarMid.textContent = "Spectral map: B -> G -> R";
    els.colorbarMax.textContent = fmtPhysical("nu", nuMax, unitNu);
  } else {
    const stats = activeIntensityRangeStats();
    for (let x = 0; x < w; x += 1) {
      const t = x / Math.max(1, w - 1);
      const [r, g, b] = colorForNorm(t);
      ctx.fillStyle = `rgb(${r} ${g} ${b})`;
      ctx.fillRect(x, 0, 1, h);
    }
    if (stats) {
      const fixedLabel = state.fixedColorRange ? `, ${COLOR_RANGE_MODE_LABEL[state.colorRangeMode] || "fixed"}` : "";
      if (state.fluxScale === "log") {
        els.colorbarMin.textContent = `0 ${unit}`.trim();
        els.colorbarMid.textContent = `${state.colorMap} (log, neg=white${fixedLabel})`;
        els.colorbarMax.textContent = `${fmtIntensity(Math.max(0, stats.max))} ${unit}`.trim();
      } else {
        els.colorbarMin.textContent = `${fmtIntensity(stats.min)} ${unit}`.trim();
        els.colorbarMid.textContent = `${state.colorMap}${fixedLabel}`;
        els.colorbarMax.textContent = `${fmtIntensity(stats.max)} ${unit}`.trim();
      }
    } else {
      els.colorbarMin.textContent = "";
      els.colorbarMid.textContent = state.colorMap;
      els.colorbarMax.textContent = "";
    }
  }
}

function indicesToCoords(indices) {
  const out = {};
  for (const [dim, idx] of Object.entries(indices || {})) {
    out[dim] = dimCoord(dim, idx);
  }
  return out;
}

function renderFrame(frameCanvas, selectedCoords, intensityStats, intensityUnit = null) {
  state.frameCanvas = frameCanvas;
  state.frameTiles = null;
  state.frameGrid = 1;
  state.drawTiles = [];
  state.selectedCoords = selectedCoords || null;
  state.currentIntensityStats = intensityStats || null;
  state.currentIntensityUnit = intensityUnit || (state.meta ? state.meta.intensity_unit || "" : "");
  updateSliderReadouts(state.selectedCoords);
  layoutViewerCanvas();
  drawFrameAndOverlays();
  drawColorbar();
}

function renderTileFrame(frameTiles, gridSize, selectedCoords, intensityStats, intensityUnit = null) {
  state.frameCanvas = null;
  state.frameTiles = frameTiles;
  state.frameGrid = Math.max(1, gridSize);
  state.drawTiles = [];
  state.selectedCoords = selectedCoords || null;
  state.currentIntensityStats = intensityStats || null;
  state.currentIntensityUnit = intensityUnit || (state.meta ? state.meta.intensity_unit || "" : "");
  updateSliderReadouts(state.selectedCoords);
  layoutViewerCanvas();
  drawFrameAndOverlays();
  drawColorbar();
}

function activeIntensityRangeStats() {
  if (isValidRangeStats(state.fixedColorRange)) return state.fixedColorRange;
  return state.currentIntensityStats;
}

async function refreshFixedColorRange() {
  if (!state.dataId || state.colorRangeMode === "none" || state.multiSpectral || isDerivedPolModeActive() || isVolumeMode()) {
    state.fixedColorRange = null;
    return;
  }

  const data = await fetchJson(`/api/datasets/${state.dataId}/intensity-range?${buildRangeParams().toString()}`);
  state.fixedColorRange = isValidRangeStats(data) ? data : null;
}

async function refreshEvpaTicks() {
  if (!state.dataId || !state.showEvpa || state.plane !== "xy" || isVolumeMode()) {
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
    return;
  }

  try {
    const effectiveMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : state.sampleMode;
    const baseParams = {
      t: String(state.values.t),
      nu: String(state.values.nu),
      z: String(state.values.z),
      sample_mode: effectiveMode,
      step: String(state.evpaStep),
      min_fraction: "0.05",
      i_min_fraction: String(state.evpaIMinFraction),
    };

    if (isSamplesMode() && state.sampleGridIndices.length > 1) {
      const samples = state.sampleGridIndices.slice();
      const results = await Promise.all(
        samples.map((sampleIdx) => {
          const qs = new URLSearchParams({ ...baseParams, sample: String(sampleIdx) });
          return fetchJson(`/api/datasets/${state.dataId}/evpa?${qs.toString()}`);
        })
      );
      const bySample = {};
      for (let i = 0; i < samples.length; i += 1) {
        bySample[String(samples[i])] = results[i].ticks || [];
      }
      state.evpaTicksBySample = bySample;
      const activeSample = state.sampleGridIndices[clamp(state.activeSampleTile, 0, state.sampleGridIndices.length - 1)];
      state.evpaTicks = bySample[String(activeSample)] || [];
    } else {
      const qs = new URLSearchParams({ ...baseParams, sample: String(state.values.sample) });
      const data = await fetchJson(`/api/datasets/${state.dataId}/evpa?${qs.toString()}`);
      state.evpaTicks = data.ticks || [];
      state.evpaTicksBySample = {};
    }
  } catch (err) {
    console.warn("EVPA overlay unavailable:", err);
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
  }
}

function computeStats(values) {
  if (!Array.isArray(values) || !values.length) return { min: 0, max: 1, mean: 0, std: 0 };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!isFiniteNumber(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sumSq += v * v;
    n += 1;
  }
  if (n < 1) return { min: 0, max: 1, mean: 0, std: 0 };
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(mean) || !Number.isFinite(variance)) {
    return { min: 0, max: 1, mean: 0, std: 0 };
  }
  return { min, max, mean, std: Math.sqrt(variance) };
}

function mapDerivedPolarizationPayload(mode, payloadsByPol) {
  const ref = payloadsByPol[0] || payloadsByPol[1] || payloadsByPol[2] || payloadsByPol[3];
  if (!ref || !Array.isArray(ref.values)) {
    throw new Error("no Stokes data available for derived polarization view");
  }

  const iVals = payloadsByPol[0] ? payloadsByPol[0].values : null;
  const qVals = payloadsByPol[1] ? payloadsByPol[1].values : null;
  const uVals = payloadsByPol[2] ? payloadsByPol[2].values : null;
  const vVals = payloadsByPol[3] ? payloadsByPol[3].values : null;
  const values = new Array(ref.values.length);
  let maxAbsI = 0;
  if (iVals) {
    for (let i = 0; i < iVals.length; i += 1) {
      const a = Math.abs(iVals[i]);
      if (a > maxAbsI) maxAbsI = a;
    }
  }
  const iFloor = Math.max(1.0e-8, maxAbsI * 1.0e-5);

  for (let i = 0; i < values.length; i += 1) {
    const I = iVals ? iVals[i] : 0;
    const Q = qVals ? qVals[i] : 0;
    const U = uVals ? uVals[i] : 0;
    const V = vVals ? vVals[i] : 0;
    const iAbs = Math.abs(I);
    const hasReliableI = iAbs >= iFloor;

    let mapped;
    if (mode === "frac") {
      if (!hasReliableI) {
        mapped = Number.NaN;
      } else {
        mapped = clamp(Math.sqrt(Q * Q + U * U) / iAbs, 0, 1);
      }
    } else if (mode === "linear") {
      mapped = Math.sqrt(Q * Q + U * U);
    } else if (mode === "circular") {
      if (!hasReliableI) {
        mapped = Number.NaN;
      } else {
        mapped = clamp(V / I, -1, 1);
      }
    } else if (mode === "bfield") {
      let angle = 0.5 * Math.atan2(U, Q) + Math.PI / 2;
      angle %= Math.PI;
      if (angle < 0) angle += Math.PI;
      mapped = (angle * 180) / Math.PI;
    } else {
      mapped = ref.values[i];
    }
    values[i] = mapped;
  }

  return {
    ...ref,
    intensity_unit: derivedPolUnit(mode),
    stats: computeStats(values),
    values,
  };
}

async function fetchDerivedSlice(sampleOverride, maxPixels = null) {
  const mode = state.derivedPolMode;
  if (!isDerivedPolModeActive()) {
    return fetchJson(
      `/api/datasets/${state.dataId}/slice?${buildSliceParams(undefined, sampleOverride, state.values.pol, state.sampleMode, maxPixels).toString()}`
    );
  }
  const effectiveSampleMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : state.sampleMode;
  const channels = derivedPolChannels(mode);
  if (!channels.length) {
    throw new Error(`invalid derived polarization mode: ${mode}`);
  }

  const fetched = await Promise.all(
    channels.map((polIdx) =>
      fetchJson(
        `/api/datasets/${state.dataId}/slice?${buildSliceParams(
          undefined,
          sampleOverride,
          polIdx,
          effectiveSampleMode,
          maxPixels
        ).toString()}`
      )
    )
  );
  const byPol = {};
  for (let i = 0; i < channels.length; i += 1) {
    byPol[channels[i]] = fetched[i];
  }
  return mapDerivedPolarizationPayload(mode, byPol);
}

async function fetchVolume(sampleOverride) {
  return fetchJson(`/api/datasets/${state.dataId}/volume?${buildVolumeParams(sampleOverride).toString()}`);
}

async function fetchDerivedVolume(sampleOverride) {
  const mode = state.derivedPolMode;
  if (!isDerivedPolModeActive()) return fetchVolume(sampleOverride);

  const effectiveSampleMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : state.sampleMode;
  const channels = derivedPolChannels(mode);
  if (!channels.length) {
    throw new Error(`invalid derived polarization mode: ${mode}`);
  }

  const fetched = await Promise.all(
    channels.map((polIdx) =>
      fetchJson(
        `/api/datasets/${state.dataId}/volume?${buildVolumeParams(sampleOverride, polIdx, effectiveSampleMode).toString()}`
      )
    )
  );
  const byPol = {};
  for (let i = 0; i < channels.length; i += 1) {
    byPol[channels[i]] = fetched[i];
  }
  return mapDerivedPolarizationPayload(mode, byPol);
}

function rerenderVolumeFrame() {
  if (!isVolumeMode()) return;
  const unit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : state.meta ? state.meta.intensity_unit || "" : "";
  const qCfg = volumeQualityConfig();

  if (state.currentVolumeTiles && state.currentVolumeTiles.length) {
    const resolution = clamp(
      Math.round(volumeBaseResolution(state.currentVolumeTiles.length) * qCfg.resMul),
      140,
      420
    );
    const tiles = state.currentVolumeTiles.map((v) => createVolumeCanvasAuto(v, resolution));
    const sharedStats = sharedStatsFromPayloads(state.currentVolumeTiles);
    renderTileFrame(tiles, state.sampleGridSize, null, sharedStats, unit);
    return;
  }
  if (state.currentVolume) {
    const resolution = clamp(Math.round(volumeBaseResolution(1) * qCfg.resMul), 180, 520);
    renderFrame(createVolumeCanvasAuto(state.currentVolume, resolution), null, state.currentVolume.stats || null, unit);
  }
}

async function setSpatialMode(mode) {
  if (mode !== "slice" && mode !== "volume") return;
  if (state.spatialMode === mode) return;

  state.spatialMode = mode;
  state.fixedColorRange = null;
  state.multiSpectral = false;
  state.showEvpa = false;
  state.zoomDrag = null;
  state.selectionDrag = null;
  state.volumeDrag = null;
  resetView();
  updateControlCaps();
  await refreshSlice();
  if (mode === "slice" && state.selection) await refreshSelectionAnalytics();
}

async function refreshSlice(options = {}) {
  if (!state.dataId) return;
  const playbackMode = options.playback === true;
  const lodMaxPixels = playbackMode ? playbackMaxPixelsForFrame() : null;
  if (state.sampleMode === "single") {
    ensureGridIndices();
    state.values.sample = state.sampleGridIndices[state.activeSampleTile];
  } else {
    state.sampleGridSize = 1;
    state.frameGrid = 1;
  }

  const evpaPromise = state.showEvpa && !isVolumeMode() && !playbackMode ? refreshEvpaTicks() : Promise.resolve();
  if (playbackMode && state.showEvpa) {
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
  }
  if (!playbackMode) {
    await refreshFixedColorRange();
  }

  if (isVolumeMode()) {
    state.currentMonoSlice = null;
    state.currentMultispectralBands = null;
    state.evpaTicks = [];
    state.evpaTicksBySample = {};

    if (state.sampleMode === "single") {
      const sampleIndices = state.sampleGridIndices.slice();
      const volumes = await Promise.all(
        sampleIndices.map((sampleIdx) => (isDerivedPolModeActive() ? fetchDerivedVolume(sampleIdx) : fetchVolume(sampleIdx)))
      );
      await evpaPromise;
      state.currentVolumeTiles = volumes;
      state.currentVolume = null;
    } else {
      const volume = isDerivedPolModeActive() ? await fetchDerivedVolume(undefined) : await fetchVolume(undefined);
      await evpaPromise;
      state.currentVolume = volume;
      state.currentVolumeTiles = null;
    }

    rerenderVolumeFrame();
    await refreshViewProfiles();
    return;
  }

  state.currentVolume = null;
  state.currentVolumeTiles = null;

  if (state.sampleMode === "single") {
    const sampleIndices = state.sampleGridIndices.slice();
    if (!isDerivedPolModeActive() && state.multiSpectral && axisSize("nu") > 2) {
      const mosaics = await Promise.all(
        sampleIndices.map((sampleIdx) =>
          fetchJson(`/api/datasets/${state.dataId}/multispectral?${buildMultispectralParams(sampleIdx, lodMaxPixels).toString()}`)
        )
      );
      await evpaPromise;
      const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, mosaics.length - 1));
      const primary = mosaics[activeIdx] || mosaics[0];
      state.currentMonoSlice = null;
      state.currentMultispectralBands = primary ? primary.bands || null : null;
      const tiles = mosaics.map((ms) => createRgbCanvas(ms.shape[0], ms.shape[1], ms.values.r, ms.values.g, ms.values.b, ms));
      renderTileFrame(tiles, state.sampleGridSize, primary ? indicesToCoords(primary.selected_indices) : null, null);
    } else {
      const slices = await Promise.all(
        sampleIndices.map((sampleIdx) =>
          isDerivedPolModeActive()
            ? fetchDerivedSlice(sampleIdx, lodMaxPixels)
            : fetchJson(`/api/datasets/${state.dataId}/slice?${buildSliceParams(undefined, sampleIdx, state.values.pol, state.sampleMode, lodMaxPixels).toString()}`)
        )
      );
      await evpaPromise;
      state.currentMultispectralBands = null;
      const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, slices.length - 1));
      const primary = slices[activeIdx] || slices[0] || null;
      state.currentMonoSlice = primary;

      let sharedStats = isValidRangeStats(state.fixedColorRange) ? state.fixedColorRange : null;
      if (!sharedStats && slices.length) {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const s of slices) {
          if (s.stats) {
            if (s.stats.min < min) min = s.stats.min;
            if (s.stats.max > max) max = s.stats.max;
          }
        }
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
          sharedStats = { min, max };
        }
      }
      const tiles = slices.map((s) => createSingleCanvas(s, sharedStats));
      const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
      const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
      renderTileFrame(tiles, state.sampleGridSize, selectedCoords, sharedStats, intensityUnit);
    }
  } else {
    if (!isDerivedPolModeActive() && state.multiSpectral && axisSize("nu") > 2) {
      const ms = await fetchJson(`/api/datasets/${state.dataId}/multispectral?${buildMultispectralParams(undefined, lodMaxPixels).toString()}`);
      await evpaPromise;
      state.currentMonoSlice = null;
      state.currentMultispectralBands = ms.bands || null;
      renderFrame(
        createRgbCanvas(ms.shape[0], ms.shape[1], ms.values.r, ms.values.g, ms.values.b, ms),
        indicesToCoords(ms.selected_indices),
        null
      );
    } else {
      const slice = isDerivedPolModeActive()
        ? await fetchDerivedSlice(undefined, lodMaxPixels)
        : await fetchJson(
            `/api/datasets/${state.dataId}/slice?${buildSliceParams(undefined, undefined, state.values.pol, state.sampleMode, lodMaxPixels).toString()}`
          );
      await evpaPromise;
      state.currentMonoSlice = slice;
      state.currentMultispectralBands = null;
      const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
      renderFrame(
        createSingleCanvas(slice),
        slice.selected_coords || indicesToCoords(slice.selected_indices),
        slice.stats || null,
        intensityUnit
      );
    }
  }

  if (!playbackMode) {
    await refreshViewProfiles();
  } else {
    drawNavigationGraphs();
    if (state.selection) drawSelectionGraphs();
  }
}

function profileForAxis(source, axis) {
  if (!source) return null;
  if (axis === "t") return source.time_profile || null;
  if (axis === "nu") return source.spectrum_profile || null;
  if (source.spatial_profile && source.spatial_profile.axis === axis) return source.spatial_profile;
  return null;
}

function axisRangeFromProfile(axis, profile) {
  if (profile && Array.isArray(profile.coords) && profile.coords.length >= 1) {
    return [profile.coords[0], profile.coords[profile.coords.length - 1]];
  }
  return [dimCoord(axis, 0), dimCoord(axis, Math.max(0, axisSize(axis) - 1))];
}

function setAxisRangeLabels(minEl, maxEl, axis, profile) {
  if (profile && Array.isArray(profile.coords) && profile.coords.length >= 1 && (axis === "t" || axis === "nu")) {
    const [s, e] = getAxisWindow(axis, profile.coords.length);
    minEl.textContent = fmtPhysical(axis, profile.coords[s], dimUnit(axis));
    maxEl.textContent = fmtPhysical(axis, profile.coords[e], dimUnit(axis));
    return;
  }
  const [a, b] = axisRangeFromProfile(axis, profile);
  minEl.textContent = fmtPhysical(axis, a, dimUnit(axis));
  maxEl.textContent = fmtPhysical(axis, b, dimUnit(axis));
}

function getAxisWindow(axis, n) {
  if ((axis !== "t" && axis !== "nu") || n <= 1) return [0, Math.max(0, n - 1)];
  const w = state.axisWindow[axis];
  if (!w) return [0, n - 1];
  const start = clamp(w.start, 0, n - 2);
  const end = clamp(w.end, start + 1, n - 1);
  return [start, end];
}

function clearAxisWindow(axis) {
  if (axis === "t" || axis === "nu") {
    state.axisWindow[axis] = null;
  }
}

function setAxisWindow(axis, start, end) {
  if (axis !== "t" && axis !== "nu") return;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1) return;
  state.axisWindow[axis] = { start, end };
  delete state.profileZoom[axis];
}

function clampIndexToWindow(axis, idx) {
  const max = axisSize(axis) - 1;
  const clamped = clamp(idx, 0, max);
  const [start, end] = getAxisWindow(axis, max + 1);
  return clamp(clamped, start, end);
}

function drawNavigator(canvasEl, profile, indicatorIdx, axis) {
  const ctx = canvasEl.getContext("2d");
  const w = canvasEl.width;
  const h = canvasEl.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b1118";
  ctx.fillRect(0, 0, w, h);

  if (!profile || !profile.series_mean || profile.series_mean.length < 2) {
    ctx.fillStyle = "#98a8ba";
    ctx.font = "11px sans-serif";
    ctx.fillText("No data", 8, 16);
    return;
  }

  const margin = NAV_MARGIN;
  const pxW = w - margin.l - margin.r;
  const pxH = h - margin.t - margin.b;

  const fullCoords = profile.coords;
  const fullSeries = profile.series_mean;
  const [startIdx, endIdx] = getAxisWindow(axis, fullCoords.length);
  const series = fullSeries.slice(startIdx, endIdx + 1);
  const coords = fullCoords.slice(startIdx, endIdx + 1);
  const n = series.length;
  const xmap = buildAxisXMapper(coords);
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < series.length; i += 1) {
    if (series[i] < yMin) yMin = series[i];
    if (series[i] > yMax) yMax = series[i];
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) {
    yMin = -1;
    yMax = 1;
  }

  const pad = (yMax - yMin) * 0.06;
  yMin -= pad;
  yMax += pad;
  const ySpan = Math.max(1e-8, yMax - yMin);

  const xOf = (i) => margin.l + xmap.toNorm(i) * pxW;
  const yOf = (v) => margin.t + (1 - (v - yMin) / ySpan) * pxH;

  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.l, margin.t);
  ctx.lineTo(margin.l, margin.t + pxH);
  ctx.lineTo(margin.l + pxW, margin.t + pxH);
  ctx.stroke();

  ctx.strokeStyle = "#cfd7e3";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const x = xOf(i);
    const y = yOf(series[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (indicatorIdx !== null && indicatorIdx !== undefined) {
    if (indicatorIdx >= startIdx && indicatorIdx <= endIdx) {
      const i = indicatorIdx - startIdx;
      const x = xOf(i);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, margin.t);
      ctx.lineTo(x, margin.t + pxH);
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#8ea1b5";
  ctx.font = "10px sans-serif";
  ctx.fillText(yMax.toExponential(1), 2, margin.t + 9);
  ctx.fillText(yMin.toExponential(1), 2, margin.t + pxH);
}

function drawNavigatorZoomDrag(canvasEl, profile, axis, drag) {
  if (!drag || !drag.zoom || !profile || !profile.coords || profile.coords.length < 2) return;
  if (drag.startIdx === undefined || drag.lastIdx === undefined) return;

  const [startIdx, endIdx] = getAxisWindow(axis, profile.coords.length);
  const visibleCoords = profile.coords.slice(startIdx, endIdx + 1);
  if (visibleCoords.length < 2) return;
  const xmap = buildAxisXMapper(visibleCoords);
  const local0 = clamp(Math.min(drag.startIdx, drag.lastIdx) - startIdx, 0, visibleCoords.length - 1);
  const local1 = clamp(Math.max(drag.startIdx, drag.lastIdx) - startIdx, 0, visibleCoords.length - 1);
  const margin = NAV_MARGIN;
  const pxW = canvasEl.width - margin.l - margin.r;
  const pxH = canvasEl.height - margin.t - margin.b;
  const x0 = margin.l + xmap.toNorm(local0) * pxW;
  const x1 = margin.l + xmap.toNorm(local1) * pxW;

  const ctx = canvasEl.getContext("2d");
  ctx.save();
  ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
  ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
  ctx.lineWidth = 1.1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(Math.min(x0, x1), margin.t, Math.max(1, Math.abs(x1 - x0)), pxH);
  ctx.strokeRect(Math.min(x0, x1), margin.t, Math.max(1, Math.abs(x1 - x0)), pxH);
  ctx.restore();
}

function axisFromProfileKind(kind) {
  if (kind === "hidden") return hiddenDim();
  return kind;
}

function profileCanvasForKind(kind) {
  if (kind === "t") return els.timeProfileCanvas;
  if (kind === "nu") return els.spectrumProfileCanvas;
  return els.spatialProfileCanvas;
}

function getProfileZoomWindow(profile) {
  const n = profile && Array.isArray(profile.coords) ? profile.coords.length : 0;
  if (n < 2) return [0, Math.max(0, n - 1)];
  let baseStart = 0;
  let baseEnd = n - 1;
  if (profile.axis === "t" || profile.axis === "nu") {
    const [w0, w1] = getAxisWindow(profile.axis, n);
    baseStart = w0;
    baseEnd = w1;
  }
  const z = state.profileZoom[profile.axis];
  if (!z) return [baseStart, baseEnd];
  const start = clamp(Math.floor(z.start), baseStart, Math.max(baseStart, baseEnd - 1));
  const end = clamp(Math.floor(z.end), Math.min(start + 1, baseEnd), baseEnd);
  return [start, end];
}

function profileIndexFromEvent(canvas, profile, ev) {
  const axis = profile.axis || hiddenDim();
  const [startIdx, endIdx] = getProfileZoomWindow(profile);
  if (endIdx - startIdx < 1) return startIdx;
  const visibleCoords = profile.coords.slice(startIdx, endIdx + 1);
  const xmap = buildAxisXMapper(visibleCoords);

  const rect = canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const pxW = canvas.width - PROFILE_MARGIN.l - PROFILE_MARGIN.r;
  const u = clamp((cx - PROFILE_MARGIN.l) / Math.max(1e-6, pxW), 0, 1);
  const local = xmap.nearestIndex(u);
  return startIdx + local;
}

function drawProfileZoomDragOverlay() {
  if (!state.profileZoomDrag) return;
  const axis = axisFromProfileKind(state.profileZoomDrag.kind);
  const profile = profileForAxis(state.profiles, axis);
  if (!profile || !profile.coords || profile.coords.length < 2) return;

  const canvas = profileCanvasForKind(state.profileZoomDrag.kind);
  const rect = canvas.getBoundingClientRect();
  const x0 = (state.profileZoomDrag.startClientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const x1 = (state.profileZoomDrag.currentClientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const left = clamp(Math.min(x0, x1), PROFILE_MARGIN.l, canvas.width - PROFILE_MARGIN.r);
  const right = clamp(Math.max(x0, x1), PROFILE_MARGIN.l, canvas.width - PROFILE_MARGIN.r);
  const w = Math.max(1, right - left);
  const h = canvas.height - PROFILE_MARGIN.t - PROFILE_MARGIN.b;

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.fillStyle = "rgba(245, 158, 11, 0.10)";
  ctx.strokeStyle = "rgba(245, 158, 11, 0.95)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(left, PROFILE_MARGIN.t, w, h);
  ctx.strokeRect(left, PROFILE_MARGIN.t, w, h);
  ctx.restore();
}

function drawSelectionProfile(canvasEl, profile, lineColor, indicatorIdx) {
  const ctx = canvasEl.getContext("2d");
  const w = canvasEl.width;
  const h = canvasEl.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0d1119";
  ctx.fillRect(0, 0, w, h);

  if (!profile || !profile.coords || profile.coords.length < 2) {
    ctx.fillStyle = "#9fb0c3";
    ctx.font = "12px sans-serif";
    ctx.fillText("No selected area", 10, 20);
    return;
  }

  const margin = PROFILE_MARGIN;
  const pxW = w - margin.l - margin.r;
  const pxH = h - margin.t - margin.b;
  const [startIdx, endIdx] = getProfileZoomWindow(profile);
  const n = endIdx - startIdx + 1;
  const coords = profile.coords.slice(startIdx, endIdx + 1);
  const axisName = profile.axis || "axis";
  const axisUnit = profile.axis_unit || "";
  const fluxUnit = state.meta ? state.meta.intensity_unit || "arb" : "arb";
  const perSample = (profile.per_sample || []).map((s) => s.slice(startIdx, endIdx + 1));
  const mean = (profile.series_mean || []).slice(startIdx, endIdx + 1);
  const std = (profile.series_std || []).slice(startIdx, endIdx + 1);
  const perSampleY = perSample.map((s) => s.map(fluxPlotValue));
  const meanY = mean.map(fluxPlotValue);
  const upperY = mean.map((m, i) => fluxPlotValue(m + std[i]));
  const lowerY = mean.map((m, i) => fluxPlotValue(m - std[i]));
  const xmap = buildAxisXMapper(coords);

  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const s of perSampleY) {
    for (const v of s) {
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) {
    yMin = -1;
    yMax = 1;
  }

  const pad = (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;
  const ySpan = Math.max(1e-8, yMax - yMin);
  const xOf = (i) => margin.l + xmap.toNorm(i) * pxW;
  const yOf = (v) => margin.t + (1 - (v - yMin) / ySpan) * pxH;

  ctx.strokeStyle = "#2a3648";
  ctx.lineWidth = 1;
  ctx.strokeRect(margin.l, margin.t, pxW, pxH);

  const xTickCount = Math.min(5, Math.max(3, Math.floor(pxW / 120) + 1), n);
  const yTickCount = 5;

  ctx.strokeStyle = "rgba(130, 148, 170, 0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (let ti = 0; ti < yTickCount; ti += 1) {
    const t = ti / (yTickCount - 1);
    const y = margin.t + t * pxH;
    ctx.beginPath();
    ctx.moveTo(margin.l, y);
    ctx.lineTo(margin.l + pxW, y);
    ctx.stroke();
  }
  for (let ti = 0; ti < xTickCount; ti += 1) {
    const idx = xTickCount > 1 ? Math.round((ti / (xTickCount - 1)) * (n - 1)) : 0;
    const x = xOf(idx);
    ctx.beginPath();
    ctx.moveTo(x, margin.t);
    ctx.lineTo(x, margin.t + pxH);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const s of perSampleY) {
    ctx.strokeStyle = "rgba(155, 179, 204, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 1) {
      const x = xOf(i);
      const y = yOf(s[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  if (std.length === mean.length && mean.length > 1) {
    ctx.fillStyle = "rgba(148, 163, 184, 0.16)";
    ctx.beginPath();
    for (let i = 0; i < meanY.length; i += 1) {
      const x = xOf(i);
      const y = yOf(upperY[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = meanY.length - 1; i >= 0; i -= 1) {
      const x = xOf(i);
      const y = yOf(lowerY[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < meanY.length; i += 1) {
    const x = xOf(i);
    const y = yOf(meanY[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (indicatorIdx !== null && indicatorIdx !== undefined) {
    if (indicatorIdx >= startIdx && indicatorIdx <= endIdx) {
      const i = indicatorIdx - startIdx;
      const x = xOf(i);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x, margin.t);
      ctx.lineTo(x, margin.t + pxH);
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#9eb0c7";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let ti = 0; ti < yTickCount; ti += 1) {
    const t = ti / (yTickCount - 1);
    const value = fluxFromPlotValue(yMax - t * (yMax - yMin));
    const y = margin.t + t * pxH;
    ctx.fillText(fmtIntensity(value), margin.l - 8, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let ti = 0; ti < xTickCount; ti += 1) {
    const idx = xTickCount > 1 ? Math.round((ti / (xTickCount - 1)) * (n - 1)) : 0;
    const x = xOf(idx);
    const c = coords[idx];
    const label = fmtAxisTick(axisName, axisUnit, c);
    const tw = ctx.measureText(label).width;
    const clampedX = clamp(x, margin.l + tw / 2, margin.l + pxW - tw / 2);
    ctx.fillText(label, clampedX, h - 28);
  }

  ctx.fillStyle = "#b8c8dc";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xLabelBase = axisUnit ? `${axisName.toUpperCase()} [${axisUnit}]` : axisName.toUpperCase();
  const xLabel = xLabelBase;
  ctx.fillText(xLabel, margin.l + pxW / 2, h - 13);

  ctx.save();
  ctx.translate(28, margin.t + pxH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const yLabel = `Flux [${fluxUnit}]`;
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function drawNavigationGraphs() {
  const hiddenAxis = hiddenDim();
  const tProfile = profileForAxis(state.viewProfiles, "t");
  const fProfile = profileForAxis(state.viewProfiles, "nu");
  const hProfile = profileForAxis(state.viewProfiles, hiddenAxis);

  drawNavigator(els.timeNavCanvas, tProfile, state.values.t, "t");
  drawNavigator(els.freqNavCanvas, fProfile, state.values.nu, "nu");
  drawNavigator(els.hiddenNavCanvas, hProfile, state.values[hiddenAxis], hiddenAxis);

  if (state.navDrag && state.navDrag.zoom) {
    if (state.navDrag.kind === "t") {
      drawNavigatorZoomDrag(els.timeNavCanvas, tProfile, "t", state.navDrag);
    } else if (state.navDrag.kind === "nu") {
      drawNavigatorZoomDrag(els.freqNavCanvas, fProfile, "nu", state.navDrag);
    } else if (state.navDrag.kind === "hidden") {
      drawNavigatorZoomDrag(els.hiddenNavCanvas, hProfile, hiddenAxis, state.navDrag);
    }
  }

  setAxisRangeLabels(els.timeAxisMin, els.timeAxisMax, "t", tProfile);
  setAxisRangeLabels(els.freqAxisMin, els.freqAxisMax, "nu", fProfile);
  setAxisRangeLabels(els.hiddenAxisMin, els.hiddenAxisMax, hiddenAxis, hProfile);
}

function drawSelectionGraphs() {
  const hiddenAxis = hiddenDim();
  const tProfile = profileForAxis(state.profiles, "t");
  const fProfile = profileForAxis(state.profiles, "nu");
  const hProfile = profileForAxis(state.profiles, hiddenAxis);

  drawSelectionProfile(els.timeProfileCanvas, tProfile, "#7dd3fc", state.values.t);
  drawSelectionProfile(els.spectrumProfileCanvas, fProfile, "#f472b6", state.values.nu);
  drawSelectionProfile(els.spatialProfileCanvas, hProfile, "#6ee7b7", state.values[hiddenAxis]);

  drawProfileZoomDragOverlay();
  updateSpatialProfileTitle(hProfile);
}

async function refreshSelectionAnalytics() {
  if (!state.dataId || !state.selection) {
    state.profiles = null;
    drawSelectionGraphs();
    return;
  }

  const bounds = selectionBounds();
  if (!bounds) return;
  const token = ++state._selectionToken;

  try {
    const profiles = await fetchJson(`/api/datasets/${state.dataId}/profiles-plane`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileRequestBody(bounds)),
    });
    if (token !== state._selectionToken) return;
    state.profiles = profiles;
  } catch (err) {
    if (token !== state._selectionToken) return;
    console.error(err);
    state.profiles = null;
  }

  drawSelectionGraphs();
}

async function refreshViewProfiles() {
  if (!state.dataId || (!state.frameCanvas && !(state.frameTiles && state.frameTiles.length))) return;
  const token = ++state._viewProfileToken;
  const bounds = currentViewBounds();

  try {
    const profiles = await fetchJson(`/api/datasets/${state.dataId}/profiles-plane`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileRequestBody(bounds)),
    });
    if (token !== state._viewProfileToken) return;
    state.viewProfiles = profiles;
  } catch (err) {
    if (token !== state._viewProfileToken) return;
    console.error(err);
    state.viewProfiles = null;
  }

  drawNavigationGraphs();
}

function schedulePlaybackRefine() {
  const token = (state.playbackRefineToken || 0) + 1;
  state.playbackRefineToken = token;
  setTimeout(async () => {
    if (token !== state.playbackRefineToken) return;
    if (isPlaying()) return;
    try {
      await refreshSlice();
      if (state.selection) await refreshSelectionAnalytics();
    } catch (err) {
      console.warn("playback refine failed:", err);
    }
  }, 0);
}

function stopPlayback(refine = false) {
  const wasPlaying = state.playbackTimer !== null;
  if (state.playbackTimer) {
    clearInterval(state.playbackTimer);
    state.playbackTimer = null;
  }
  state.playbackAxis = null;
  state.playbackBusy = false;
  state.playbackRefineToken = (state.playbackRefineToken || 0) + 1;
  updatePlayUi();
  if (refine && wasPlaying) {
    schedulePlaybackRefine();
  }
}

function startPlayback(axis) {
  if (!axis || axisSize(axis) <= 1) return;
  stopPlayback(false);
  state.playbackAxis = axis;

  const intervalMs = Math.max(30, Math.floor(1000 / Math.max(1, state.playbackFps)));
  state.playbackTimer = setInterval(async () => {
    if (state.playbackBusy) return;
    state.playbackBusy = true;

    try {
      const max = axisSize(axis) - 1;
      const [w0, w1] = getAxisWindow(axis, max + 1);
      const cur = clamp(state.values[axis], w0, w1);
      const next = cur >= w1 ? w0 : cur + 1;
      await setAxisIndex(axis, next, { playback: true });
    } finally {
      state.playbackBusy = false;
    }
  }, intervalMs);

  updatePlayUi();
}

function toggleAxisPlayback(axis) {
  if (isPlaying() && state.playbackAxis === axis) {
    stopPlayback(true);
  } else {
    startPlayback(axis);
  }
}

function restartPlaybackIfRunning() {
  if (!isPlaying()) return;
  const axis = state.playbackAxis;
  if (!axis) {
    stopPlayback(false);
    return;
  }
  startPlayback(axis);
}

function applyZoomBox(zoomDrag) {
  const u0 = Math.min(zoomDrag.startU, zoomDrag.lastU);
  const u1 = Math.max(zoomDrag.startU, zoomDrag.lastU);
  const v0 = Math.min(zoomDrag.startV, zoomDrag.lastV);
  const v1 = Math.max(zoomDrag.startV, zoomDrag.lastV);
  const w = u1 - u0;
  const h = v1 - v0;
  if (w < 2 || h < 2) return;

  state.view.u = u0;
  state.view.v = v0;
  state.view.w = w;
  state.view.h = h;
  getViewRect();
}

function handleWheelZoom(ev) {
  if (!state.frameCanvas && !(state.frameTiles && state.frameTiles.length)) return;
  ev.preventDefault();
  if (isVolumeMode()) {
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    state.volumeZoom = clamp(state.volumeZoom * factor, 0.5, 8.0);
    updateVolumeControlReadouts();
    rerenderVolumeFrame();
    return;
  }

  const viewRect = getViewRect();
  const drawRect = state.drawRect || getDrawRect(viewRect);
  const before = screenToData(ev, viewRect, drawRect);

  const scale = ev.deltaY < 0 ? 1 / 1.12 : 1.12;
  const minW = Math.min(2, viewRect.imgW);
  const minH = Math.min(2, viewRect.imgH);
  const newW = clamp(viewRect.srcW * scale, minW, viewRect.imgW);
  const newH = clamp(viewRect.srcH * scale, minH, viewRect.imgH);

  state.view.w = newW;
  state.view.h = newH;
  state.view.u = before.u - before.ux * newW;
  state.view.v = before.v - before.uy * newH;
  getViewRect();

  drawFrameAndOverlays();
  refreshViewProfiles();
}

function navIndexFromEvent(canvas, ev, profile, axis) {
  const len = profile && profile.coords ? profile.coords.length : 0;
  if (len <= 1) return 0;
  const [startIdx, endIdx] = getAxisWindow(axis, len);
  const visibleCoords = profile.coords.slice(startIdx, endIdx + 1);
  const xmap = buildAxisXMapper(visibleCoords);
  const rect = canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const pxW = canvas.width - NAV_MARGIN.l - NAV_MARGIN.r;
  const u = clamp((cx - NAV_MARGIN.l) / Math.max(1e-6, pxW), 0, 1);
  return startIdx + xmap.nearestIndex(u);
}

async function setAxisIndex(axis, idx, options = {}) {
  const max = axisSize(axis) - 1;
  const next = clampIndexToWindow(axis, clamp(idx, 0, max));
  if (state.values[axis] === next) return;

  state.values[axis] = next;
  updateSliderReadouts(state.selectedCoords);

  await refreshSlice({ playback: options.playback === true });
  if (!options.playback && state.selection) await refreshSelectionAnalytics();
}

function axisFromNavKind(kind) {
  if (kind === "hidden") return hiddenDim();
  return kind;
}

function bindNavigationCanvas(canvas, kind) {
  const onPoint = (ev) => {
    const axis = axisFromNavKind(kind);
    const profile = profileForAxis(state.viewProfiles, axis);
    if (!profile || !profile.coords || profile.coords.length <= 1) return;
    const idx = navIndexFromEvent(canvas, ev, profile, axis);
    setAxisIndex(axis, idx);
  };

  canvas.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) return;
    const axis = axisFromNavKind(kind);
    const profile = profileForAxis(state.viewProfiles, axis);
    if (!profile || !profile.coords || profile.coords.length <= 1) return;
    const idx = navIndexFromEvent(canvas, ev, profile, axis);
    if (state.dragMode === "zoom" && (axis === "t" || axis === "nu")) {
      state.navDrag = { kind, canvas, zoom: true, startIdx: idx, lastIdx: idx };
      drawNavigationGraphs();
      return;
    }
    state.navDrag = { kind, canvas, zoom: false };
    setAxisIndex(axis, idx);
  });

  canvas.addEventListener("click", (ev) => {
    if (state.dragMode === "zoom") return;
    onPoint(ev);
  });

  canvas.addEventListener("dblclick", async () => {
    const axis = axisFromNavKind(kind);
    if (axis !== "t" && axis !== "nu") return;
    clearAxisWindow(axis);
    state.values[axis] = clampIndexToWindow(axis, state.values[axis]);
    drawNavigationGraphs();
    await refreshSlice();
    if (state.selection) await refreshSelectionAnalytics();
  });
}

function bindProfileZoomCanvas(canvas, kind) {
  canvas.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || state.dragMode !== "zoom") return;
    const axis = axisFromProfileKind(kind);
    const profile = profileForAxis(state.profiles, axis);
    if (!profile || !profile.coords || profile.coords.length < 2) return;
    state.profileZoomDrag = {
      kind,
      startClientX: ev.clientX,
      currentClientX: ev.clientX,
    };
    ev.preventDefault();
    drawSelectionGraphs();
  });

  canvas.addEventListener("dblclick", () => {
    const axis = axisFromProfileKind(kind);
    delete state.profileZoom[axis];
    drawSelectionGraphs();
  });
}

async function onSampleModeChange(mode) {
  if (!["single", "mean", "std", "rel_uncert"].includes(mode)) return;
  state.sampleMode = mode;
  if (mode === "single") {
    const requestedGrid = parseGridCount(els.sampleGridCountSelect.value);
    state.sampleGridSize = requestedGrid;
    state.sampleGridIndices = randomSampleIndices(state.sampleGridSize);
    state.activeSampleTile = 0;
    ensureGridIndices();
  } else {
    state.sampleGridSize = 1;
    state.sampleGridIndices = [0];
    state.activeSampleTile = 0;
  }
  updateControlCaps();
  await refreshSlice();
  if (state.selection) await refreshSelectionAnalytics();
}

async function onSampleGridCountChange() {
  if (!isSamplesMode()) return;
  const requestedGrid = parseGridCount(els.sampleGridCountSelect.value);
  state.sampleGridSize = requestedGrid;
  state.sampleGridIndices = randomSampleIndices(state.sampleGridSize);
  state.activeSampleTile = 0;
  ensureGridIndices();
  updateControlCaps();
  await refreshSlice();
  if (state.selection) await refreshSelectionAnalytics();
}

async function onResampleSamples() {
  if (!isSamplesMode()) return;
  state.sampleGridIndices = randomSampleIndices(state.sampleGridSize);
  state.activeSampleTile = 0;
  ensureGridIndices();
  await refreshSlice();
  if (state.selection) await refreshSelectionAnalytics();
}

async function onPlaneChange() {
  stopPlayback();
  state.plane = els.planeSelect.value;
  resetForPlaneChange(state);
  resetView();
  updateControlCaps();
  drawSelectionGraphs();
  await refreshSlice();
}

async function onDatasetChange() {
  stopPlayback();
  state.dataId = els.datasetSelect.value;
  state.meta = await fetchJson(`/api/datasets/${state.dataId}/meta`);
  resetForDatasetChange(state);

  resetView();
  updateControlCaps();
  drawSelectionGraphs();
  await refreshSlice();
}

async function init() {
  const list = await fetchJson("/api/datasets");
  els.datasetSelect.innerHTML = "";

  for (const ds of list.datasets) {
    const opt = document.createElement("option");
    opt.value = ds.data_id;
    opt.textContent = `${ds.data_id} (${ds.shape.join("x")})`;
    els.datasetSelect.appendChild(opt);
  }

  if (!list.datasets.length) {
    console.warn("No datasets loaded");
    return;
  }

  els.canvas.width = 640;
  els.canvas.height = 640;
  els.colorbarCanvas.width = 640;
  els.colorbarCanvas.height = 26;
  initPanelResize();

  state.dataId = list.datasets[0].data_id;
  state.meta = await fetchJson(`/api/datasets/${state.dataId}/meta`);
  if (state.sliceRender.backend !== "cpu") ensureSliceGpuRenderer();
  if (state.volumeRender.backend !== "cpu") ensureVolumeGpuRenderer();
  resetView();
  updateControlCaps();
  drawSelectionGraphs();
  drawColorbar();
  await refreshSlice();

  els.datasetSelect.addEventListener("change", onDatasetChange);

  els.colorMapSelect.addEventListener("change", async () => {
    state.colorMap = els.colorMapSelect.value;
    await refreshSlice();
    if (state.selection) await refreshSelectionAnalytics();
  });

  els.colorRangeModeSelect.addEventListener("change", async () => {
    state.colorRangeMode = els.colorRangeModeSelect.value;
    await refreshSlice();
    if (state.selection) await refreshSelectionAnalytics();
  });

  els.sliceBackendSelect.addEventListener("change", async () => {
    const backend = els.sliceBackendSelect.value;
    if (!["auto", "gpu", "cpu"].includes(backend)) return;
    state.sliceRender.backend = backend;
    if (backend !== "cpu") ensureSliceGpuRenderer();
    updateControlCaps();
    await refreshSlice();
    if (state.selection) await refreshSelectionAnalytics();
  });

  els.fluxScaleLinearBtn.addEventListener("click", () => setFluxScale("linear"));
  els.fluxScaleLogBtn.addEventListener("click", () => setFluxScale("log"));

  els.sampleModeMeanBtn.addEventListener("click", () => onSampleModeChange("mean"));
  els.sampleModeStdBtn.addEventListener("click", () => onSampleModeChange("std"));
  els.sampleModeRelBtn.addEventListener("click", () => onSampleModeChange("rel_uncert"));
  els.sampleModeSamplesBtn.addEventListener("click", () => onSampleModeChange("single"));
  els.sampleGridCountSelect.addEventListener("change", onSampleGridCountChange);
  els.resampleSamplesBtn.addEventListener("click", onResampleSamples);

  els.planeSelect.addEventListener("change", onPlaneChange);
  els.spatialSliceBtn.addEventListener("click", () => setSpatialMode("slice"));
  els.spatialVolumeBtn.addEventListener("click", () => setSpatialMode("volume"));
  els.volumeBackendSelect.addEventListener("change", onVolumeRenderControlChange);
  els.volumeQualitySelect.addEventListener("change", onVolumeRenderControlChange);
  els.volumeRenderModeSelect.addEventListener("change", onVolumeRenderControlChange);
  els.volumeTfSelect.addEventListener("change", onVolumeRenderControlChange);
  els.volumeOpacityRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeGammaRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeCutoffRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeClipNearRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeClipFarRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeIsoThresholdRange.addEventListener("input", onVolumeRenderControlChange);

  els.multiSpectralBtn.addEventListener("click", async () => {
    if (els.multiSpectralBtn.disabled) return;
    state.multiSpectral = !state.multiSpectral;
    updateControlCaps();
    await refreshSlice();
  });

  els.timePlayBtn.addEventListener("click", () => toggleAxisPlayback("t"));
  els.freqPlayBtn.addEventListener("click", () => toggleAxisPlayback("nu"));
  els.hiddenPlayBtn.addEventListener("click", () => toggleAxisPlayback(hiddenDim()));

  els.playSpeedSelect.addEventListener("change", () => {
    state.playbackFps = Number.parseInt(els.playSpeedSelect.value, 10);
    restartPlaybackIfRunning();
    updatePlayUi();
  });

  els.polButtons.forEach((btn, idx) => {
    btn.addEventListener("click", async () => {
      if (idx >= axisSize("pol")) return;
      state.values.pol = idx;
      state.derivedPolMode = "none";
      updateControlCaps();
      await refreshSlice();
      if (state.selection) await refreshSelectionAnalytics();
    });
  });

  els.evpaToggleBtn.addEventListener("click", async () => {
    if (els.evpaToggleBtn.disabled) return;
    state.showEvpa = !state.showEvpa;
    updatePolButtonState();
    await refreshSlice();
  });

  els.evpaDensitySelect.addEventListener("change", async () => {
    const step = Number.parseInt(els.evpaDensitySelect.value, 10);
    if (Number.isFinite(step)) {
      state.evpaStep = clamp(step, 4, 32);
      updatePolButtonState();
      if (state.showEvpa) await refreshSlice();
    }
  });

  els.evpaIThresholdSelect.addEventListener("change", async () => {
    const pct = Number.parseInt(els.evpaIThresholdSelect.value, 10);
    if (!Number.isFinite(pct)) return;
    state.evpaIMinFraction = clamp(pct, 0, 100) / 100;
    updatePolButtonState();
    if (state.showEvpa) await refreshSlice();
  });

  const derivedButtonModes = [
    [els.fracPolBtn, "frac"],
    [els.bfieldBtn, "bfield"],
    [els.linPolBtn, "linear"],
    [els.circPolBtn, "circular"],
  ];
  for (const [btn, mode] of derivedButtonModes) {
    btn.addEventListener("click", async () => {
      if (!derivedPolSupported(mode)) return;
      state.derivedPolMode = state.derivedPolMode === mode ? "none" : mode;
      updateControlCaps();
      await refreshSlice();
      if (state.selection) await refreshSelectionAnalytics();
    });
  }

  els.modeInspectBtn.addEventListener("click", () => {
    state.dragMode = "investigate";
    updateModeButtons();
  });

  els.modeZoomBtn.addEventListener("click", () => {
    state.dragMode = "zoom";
    updateModeButtons();
  });

  els.resetZoomBtn.addEventListener("click", async () => {
    state.navDrag = null;
    state.profileZoomDrag = null;
    state.profileZoom = {};
    state.axisWindow = { t: null, nu: null };
    state.volumeYaw = 0.65;
    state.volumePitch = -0.45;
    state.volumeZoom = 1.0;
    state.volumeDrag = null;
    updateVolumeControlReadouts();
    resetView();
    state.values.t = clampIndexToWindow("t", state.values.t);
    state.values.nu = clampIndexToWindow("nu", state.values.nu);
    await refreshSlice();
    if (state.selection) await refreshSelectionAnalytics();
    else drawSelectionGraphs();
  });

  bindNavigationCanvas(els.timeNavCanvas, "t");
  bindNavigationCanvas(els.freqNavCanvas, "nu");
  bindNavigationCanvas(els.hiddenNavCanvas, "hidden");
  bindProfileZoomCanvas(els.timeProfileCanvas, "t");
  bindProfileZoomCanvas(els.spectrumProfileCanvas, "nu");
  bindProfileZoomCanvas(els.spatialProfileCanvas, "hidden");
  bindCanvasInteractions({
    axisFromNavKind,
    axisFromProfileKind,
    axisSize,
    applyZoomBox,
    clamp,
    clampIndexToWindow,
    drawFrameAndOverlays,
    drawNavigationGraphs,
    drawSelectionGraphs,
    els,
    ensureGridIndices,
    getDrawRect,
    getViewRect,
    handleWheelZoom,
    isVolumeMode,
    navIndexFromEvent,
    planeDims,
    profileCanvasForKind,
    profileForAxis,
    profileIndexFromEvent,
    refreshSelectionAnalytics,
    refreshSlice,
    refreshViewProfiles,
    screenToData,
    setAxisIndex,
    setAxisWindow,
    state,
  });

  window.addEventListener("resize", () => {
    layoutViewerCanvas();
    drawFrameAndOverlays();
    drawNavigationGraphs();
    drawSelectionGraphs();
    drawColorbar();
  });

  updatePlayUi();
}

init().catch((err) => {
  console.error(err);
  window.alert(`Failed to initialize demo: ${err.message}`);
});
