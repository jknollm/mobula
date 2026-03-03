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
  // Sampled from ehtplot `ehtorange.ctab` (GPL-3.0 project):
  // https://github.com/liamedeiros/ehtplot
  ehtplot: [
    [0.0, 9, 9, 9],
    [0.0625, 31, 20, 17],
    [0.125, 53, 30, 21],
    [0.1875, 75, 37, 23],
    [0.25, 99, 43, 22],
    [0.3125, 123, 47, 18],
    [0.375, 148, 48, 9],
    [0.4375, 169, 57, 0],
    [0.5, 178, 79, 0],
    [0.5625, 185, 99, 0],
    [0.625, 192, 120, 0],
    [0.6875, 198, 141, 0],
    [0.75, 202, 162, 0],
    [0.8125, 214, 180, 0],
    [0.875, 232, 196, 0],
    [0.9375, 252, 212, 0],
    [1.0, 255, 233, 126],
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

const PROFILE_THEME = {
  dragFill: "rgba(245, 250, 255, 0.08)",
  dragStroke: "rgba(245, 250, 255, 0.92)",
  indicator: "#f7fbff",
  time: "#57daff",
  spectral: "#36d7d8",
  spatial: "#52efbc",
};
const SUPPORTED_DROP_UPLOAD_EXTS = new Set([".h5", ".hdf5", ".fits", ".fit", ".fts"]);
const DEFAULT_MOSAIC_SAMPLE_COUNT = 4;
const DEFAULT_MOSAIC_GRID_SIZE = Math.round(Math.sqrt(DEFAULT_MOSAIC_SAMPLE_COUNT));

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
  systemPickerBtn: document.getElementById("systemPickerBtn"),
  systemPickerStatus: document.getElementById("systemPickerStatus"),
  colorMapSelect: document.getElementById("colorMapSelect"),
  colorRangeModeSelect: document.getElementById("colorRangeModeSelect"),
  colorNormRangeBlock: document.getElementById("colorNormRangeBlock"),
  colorNormTrack: document.getElementById("colorNormTrack"),
  colorNormMinRange: document.getElementById("colorNormMinRange"),
  colorNormMaxRange: document.getElementById("colorNormMaxRange"),
  colorNormMinValue: document.getElementById("colorNormMinValue"),
  colorNormMaxValue: document.getElementById("colorNormMaxValue"),
  colorNormBoundMin: document.getElementById("colorNormBoundMin"),
  colorNormBoundMax: document.getElementById("colorNormBoundMax"),
  sliceBackendSelect: document.getElementById("sliceBackendSelect"),
  fluxScaleLinearBtn: document.getElementById("fluxScaleLinearBtn"),
  fluxScaleSqrtBtn: document.getElementById("fluxScaleSqrtBtn"),
  fluxScaleLogBtn: document.getElementById("fluxScaleLogBtn"),
  sampleModeMeanBtn: document.getElementById("sampleModeMeanBtn"),
  sampleModeStdBtn: document.getElementById("sampleModeStdBtn"),
  sampleModeRelBtn: document.getElementById("sampleModeRelBtn"),
  sampleModeSamplesBtn: document.getElementById("sampleModeSamplesBtn"),
  sampleModeBlock: document.getElementById("sampleModeBlock"),
  sampleViewControls: document.getElementById("sampleViewControls"),
  sampleViewMosaicBtn: document.getElementById("sampleViewMosaicBtn"),
  sampleViewMorphBtn: document.getElementById("sampleViewMorphBtn"),
  sampleMosaicControls: document.getElementById("sampleMosaicControls"),
  sampleMorphControls: document.getElementById("sampleMorphControls"),
  sampleMorphDeltaSelect: document.getElementById("sampleMorphDeltaSelect"),
  sampleMorphStatus: document.getElementById("sampleMorphStatus"),
  sampleGridCountSelect: document.getElementById("sampleGridCountSelect"),
  resampleSamplesBtn: document.getElementById("resampleSamplesBtn"),
  playbackTimingControls: document.getElementById("playbackTimingControls"),
  playSpeedSelect: document.getElementById("playSpeedSelect"),

  planeSelect: document.getElementById("planeSelect"),
  planeLabel: document.getElementById("planeLabel"),
  spatialViewRow: document.getElementById("spatialViewRow"),
  spatialSliceBtn: document.getElementById("spatialSliceBtn"),
  spatialVolumeBtn: document.getElementById("spatialVolumeBtn"),
  spatialSphereBtn: document.getElementById("spatialSphereBtn"),
  sphereControls: document.getElementById("sphereControls"),
  sphereProjMollweideBtn: document.getElementById("sphereProjMollweideBtn"),
  sphereProjInsideBtn: document.getElementById("sphereProjInsideBtn"),
  sphereProjOutsideBtn: document.getElementById("sphereProjOutsideBtn"),
  sphereMetaLabel: document.getElementById("sphereMetaLabel"),
  hiddenAxisTitle: document.getElementById("hiddenAxisTitle"),
  hiddenNavValue: document.getElementById("hiddenNavValue"),
  hiddenPlayBtn: document.getElementById("hiddenPlayBtn"),
  hiddenProjectBtn: document.getElementById("hiddenProjectBtn"),
  hiddenNavPanel: document.getElementById("hiddenNavPanel"),
  volumeRenderControls: document.getElementById("volumeRenderControls"),
  volumeBackendStatus: document.getElementById("volumeBackendStatus"),
  volumeQualitySelect: document.getElementById("volumeQualitySelect"),
  volumeRenderModeSelect: document.getElementById("volumeRenderModeSelect"),
  volumeSphereProjectionLabel: document.getElementById("volumeSphereProjectionLabel"),
  volumeSphereProjectionSelect: document.getElementById("volumeSphereProjectionSelect"),
  volumeSphereNsiteLabel: document.getElementById("volumeSphereNsiteLabel"),
  volumeSphereNsiteInput: document.getElementById("volumeSphereNsiteInput"),
  volumeTfSelect: document.getElementById("volumeTfSelect"),
  volumeOpacityRange: document.getElementById("volumeOpacityRange"),
  volumeOpacityValue: document.getElementById("volumeOpacityValue"),
  volumeGammaRange: document.getElementById("volumeGammaRange"),
  volumeGammaValue: document.getElementById("volumeGammaValue"),
  volumeClipNearRange: document.getElementById("volumeClipNearRange"),
  volumeClipNearValue: document.getElementById("volumeClipNearValue"),
  volumeClipFarRange: document.getElementById("volumeClipFarRange"),
  volumeClipFarValue: document.getElementById("volumeClipFarValue"),
  volumeSphereRangeBlock: document.getElementById("volumeSphereRangeBlock"),
  volumeSphereRangeTrack: document.getElementById("volumeSphereRangeTrack"),
  volumeSphereRangeMin: document.getElementById("volumeSphereRangeMin"),
  volumeSphereRangeMax: document.getElementById("volumeSphereRangeMax"),
  volumeSphereRangeMinValue: document.getElementById("volumeSphereRangeMinValue"),
  volumeSphereRangeMaxValue: document.getElementById("volumeSphereRangeMaxValue"),
  volumeIsoThresholdLabel: document.getElementById("volumeIsoThresholdLabel"),
  volumeIsoThresholdRange: document.getElementById("volumeIsoThresholdRange"),
  volumeIsoThresholdValue: document.getElementById("volumeIsoThresholdValue"),
  hiddenNavCanvas: document.getElementById("hiddenNavCanvas"),
  hiddenAxisMin: document.getElementById("hiddenAxisMin"),
  hiddenAxisMax: document.getElementById("hiddenAxisMax"),

  multiSpectralBtn: document.getElementById("multiSpectralBtn"),
  spectralNavPanel: document.getElementById("spectralNavPanel"),
  tValue: document.getElementById("tValue"),
  nuValue: document.getElementById("nuValue"),
  timePlayBtn: document.getElementById("timePlayBtn"),
  timeProjectBtn: document.getElementById("timeProjectBtn"),
  freqPlayBtn: document.getElementById("freqPlayBtn"),
  freqProjectBtn: document.getElementById("freqProjectBtn"),
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
  coordSystemSelect: document.getElementById("coordSystemSelect"),
  exportZoomBtn: document.getElementById("exportZoomBtn"),
  resetZoomBtn: document.getElementById("resetZoomBtn"),
  hoverReadout: document.getElementById("hoverReadout"),
  exportDialog: document.getElementById("exportDialog"),
  exportFormatSelect: document.getElementById("exportFormatSelect"),
  exportFormatNote: document.getElementById("exportFormatNote"),
  exportLocationInput: document.getElementById("exportLocationInput"),
  exportBrowseBtn: document.getElementById("exportBrowseBtn"),
  exportFilenameInput: document.getElementById("exportFilenameInput"),
  exportOverwriteChk: document.getElementById("exportOverwriteChk"),
  exportStatus: document.getElementById("exportStatus"),
  exportCancelBtn: document.getElementById("exportCancelBtn"),
  exportConfirmBtn: document.getElementById("exportConfirmBtn"),

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
  sampleSingleView: "mosaic",
  sampleMorphDeltaT: 0.5,
  sampleGridSize: DEFAULT_MOSAIC_GRID_SIZE,
  sampleGridIndices: [0],
  activeSampleTile: 0,
  sampleMorph: {
    token: 0,
    fromSample: 0,
    toSample: 0,
    alpha: 0,
    initializing: false,
    sharedStats: null,
    fromSlice: null,
    toSlice: null,
    fromVolume: null,
    toVolume: null,
    fromEvpaTicks: [],
    toEvpaTicks: [],
    fromCanvas: null,
    toCanvas: null,
    blendCanvas: null,
    multispectral: false,
  },
  colorMap: "viridis",
  colorRangeMode: "full",
  colorNormValueWindow: { min: null, max: null },
  spatialMode: "slice",
  sphereMeta: null,
  sphereProjection: "mollweide",
  sphereInsideScale: 0.2,
  sphereYaw: 0,
  spherePitch: 0,
  sphereVectorKey: "",
  sphereVectors: null,
  sphereSimplexKey: "",
  sphereSimplexFaces: null,
  sphereMeshCanvas: null,
  sphereRingLutKey: "",
  sphereRingLut: null,
  sphereRayGridKey: "",
  sphereRayGrid: null,
  volumeSphereVectorKey: "",
  volumeSphereVectors: null,
  volumeSphereRayGridKey: "",
  volumeSphereRayGrid: null,
  fluxScale: "linear",
  multiSpectral: false,
  dragMode: null,
  dragModeModifier: null,
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
  currentMonoSliceTiles: null,
  currentVolume: null,
  currentVolumeTiles: null,
  currentIntensityStats: null,
  currentIntensityUnit: "",
  fixedColorRange: null,
  currentMultispectralBands: null,
  currentMultispectralSlice: null,
  currentMultispectralTiles: null,
  selectedCoords: null,
  coordSystem: "native",
  hoverProbe: null,
  hoverPointer: { clientX: 0, clientY: 0, inside: false },
  exportPrefs: {
    format: "fits",
    outputDir: "",
    filename: "",
    overwrite: true,
  },

  selection: null,
  selectionDrag: null,
  zoomDrag: null,
  volumeDrag: null,
  sphereDrag: null,
  panDrag: null,
  navDrag: null,
  profileZoomDrag: null,
  axisWindow: { t: null, nu: null },
  axisProjection: { t: false, nu: false, x: false, y: false, z: false },

  profiles: null,
  viewProfiles: null,

  drawRect: { x: 0, y: 0, w: 1, h: 1 },
  view: { u: 0, v: 0, w: 1, h: 1 },

  playbackAxis: null,
  playbackFps: 7,
  playbackTimer: null,
  sampleMorphTimer: null,
  playbackBusy: false,
  playbackRefineToken: 0,
  playbackPreviewMaxPixels: 360000,

  _selectionToken: 0,
  _viewProfileToken: 0,
  _resizePanelsRaf: 0,
  _colorNormRerenderTimer: null,
  profileZoom: {},
  panelWidths: { left: null, right: null },
  volumeYaw: 0.65,
  volumePitch: -0.45,
  volumeZoom: 1.0,
  volumeRender: {
    quality: "balanced",
    mode: "composite",
    sphereProjection: "mollweide",
    sphereNsite: 32,
    tf: "linear",
    opacity: 1.2,
    gamma: 0.9,
    cutoff: 0.0,
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
  sphereGpu: {
    available: null,
    renderer: null,
    lastError: "",
  },
};

const PROFILE_MARGIN = { l: 102, r: 18, t: 16, b: 62 };
const NAV_MARGIN = { l: 40, r: 8, t: 6, b: 8 };
const COLOR_RANGE_MODE_LABEL = {
  none: "dynamic",
  time: "time-fixed",
  spectral: "spectral-fixed",
  time_spectral: "time+spectral-fixed",
  space: "space-fixed",
  full: "full-fixed",
};
const COLOR_RANGE_MODE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "time", label: "Time" },
  { value: "spectral", label: "Spectral" },
  { value: "time_spectral", label: "Time+Spectral" },
  { value: "space", label: "Space" },
  { value: "full", label: "Full" },
];
const COLOR_NORM_SLIDER_STEPS = 1000;
const COLOR_NORM_SLIDER_MIN_GAP = 1 / COLOR_NORM_SLIDER_STEPS;
const VOLUME_SPHERE_RANGE_STEPS = 1000;
const VOLUME_SPHERE_MIN_GAP = 1 / VOLUME_SPHERE_RANGE_STEPS;
const VOLUME_SPHERE_NSITE_MIN = 1;
const VOLUME_SPHERE_NSITE_MAX = 512;
const SAMPLE_MORPH_AXIS = "__sample_morph__";
const DERIVED_POL_MODES = {
  none: { label: "None" },
  frac: { label: "Fractional Polarisation" },
  bfield: { label: "Magnetic Field Angle" },
  linear: { label: "Linear Polarisation" },
  circular: { label: "Circular Polarisation" },
};
const COORD_SYSTEM_LABEL = {
  pixel: "Pixel",
  native: "Native",
  galactic: "Galactic",
};
const EQ_TO_GAL_MATRIX = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
];
let viewerDropDragDepth = 0;

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

function isPowerOfTwo(v) {
  return Number.isInteger(v) && v > 0 && (v & (v - 1)) === 0;
}

function healpixNsideFromNpix(npix) {
  if (!Number.isInteger(npix) || npix < 12 || npix % 12 !== 0) return null;
  const nside = Math.round(Math.sqrt(npix / 12));
  if (12 * nside * nside !== npix) return null;
  if (!isPowerOfTwo(nside)) return null;
  return nside;
}

function parseHealpixOrdering(raw) {
  if (raw === null || raw === undefined) return null;
  const txt = String(raw).trim().toLowerCase();
  if (txt.includes("nest")) return "nested";
  if (txt.includes("ring")) return "ring";
  return null;
}

function detectSphereMeta(meta) {
  if (!meta || !meta.coords || !meta.coords.x || !meta.coords.y) return null;
  const xSize = Number.parseInt(meta.coords.x.size, 10);
  const ySize = Number.parseInt(meta.coords.y.size, 10);
  if (!Number.isFinite(xSize) || !Number.isFinite(ySize) || ySize !== 1) return null;
  const nside = healpixNsideFromNpix(xSize);
  if (!nside) return null;

  let ordering = parseHealpixOrdering(meta?.sphere?.ordering);
  if (!ordering) {
    const candidates = [
      meta?.wcs?.healpix_ordering,
      meta?.wcs?.healpix_order,
      meta?.wcs?.ordering,
      meta?.wcs?.order,
      meta?.provenance?.healpix_ordering,
      meta?.provenance?.healpix_order,
      meta?.provenance?.ordering,
      meta?.provenance?.order,
    ];
    for (const c of candidates) {
      ordering = parseHealpixOrdering(c);
      if (ordering) break;
    }
  }
  if (!ordering) ordering = "ring";

  return {
    kind: "healpix",
    active: true,
    npix: xSize,
    nside,
    ordering,
  };
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

function centralViewAxes() {
  if (isVolumeMode()) return new Set(["x", "y", "z"]);
  const p = planeDims();
  return new Set([p.planeX, p.planeY]);
}

function isAxisProjected(axis) {
  if (!axis || !state.axisProjection) return false;
  return Boolean(state.axisProjection[axis]);
}

function isAxisProjectionActive(axis) {
  if (!axis || !isAxisProjected(axis) || axisSize(axis) <= 1) return false;
  return !centralViewAxes().has(axis);
}

function projectedDimsForCurrentView() {
  const dims = ["t", "nu", "x", "y", "z"];
  return dims.filter((dim) => isAxisProjectionActive(dim));
}

function canProjectAxis(axis) {
  if (!axis || !state.meta) return false;
  if (axisSize(axis) <= 1) return false;
  return !centralViewAxes().has(axis);
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
  if (mode === "spherical") return 5;
  return 0;
}

function isVolumeSphericalMode() {
  return state.volumeRender.mode === "spherical";
}

function volumeSphereProjectionMode() {
  return state.volumeRender.sphereProjection === "inside" ? "inside" : "mollweide";
}

function volumeSphereNsiteValue() {
  const raw = Number.parseInt(state.volumeRender.sphereNsite, 10);
  if (!Number.isFinite(raw)) return 32;
  return clamp(Math.round(raw), VOLUME_SPHERE_NSITE_MIN, VOLUME_SPHERE_NSITE_MAX);
}

function volumeSphereInsideScale() {
  const zoom = clamp(state.volumeZoom, 0.5, 8.0);
  return clamp(0.45 * zoom, 0.1, 3.6);
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
  if (state.fluxScale === "sqrt") return "cpu";
  const requested = state.sliceRender.backend;
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
  if (state.fluxScale === "sqrt") return "cpu";
  const requested = state.sliceRender.backend;
  if (requested === "cpu") return "cpu";
  if (!sliceGpuAvailableKnown()) ensureSliceGpuRenderer();
  if (!sliceGpuAvailable()) return "cpu";
  if (requested === "gpu") return "gpu";
  const pixels = Math.max(1, width) * Math.max(1, height);
  return pixels >= 512 * 512 ? "gpu" : "cpu";
}

function sphereGpuAvailableKnown() {
  return state.sphereGpu.available !== null;
}

function sphereGpuAvailable() {
  return state.sphereGpu.available === true;
}

function sphereBackendMode(width = 0, height = 0) {
  const requested = state.sliceRender.backend;
  if (requested === "cpu") return "cpu";
  if (!sphereGpuAvailableKnown()) ensureSphereGpuRenderer();
  if (!sphereGpuAvailable()) return "cpu";
  if (requested === "gpu") return "gpu";
  const pixels = Math.max(1, width) * Math.max(1, height);
  return pixels >= 384 * 192 ? "gpu" : "cpu";
}

function setSliderFill(rangeEl) {
  if (!rangeEl) return;
  const min = Number.parseFloat(rangeEl.min);
  const max = Number.parseFloat(rangeEl.max);
  const value = Number.parseFloat(rangeEl.value);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(value) || max <= min) {
    rangeEl.style.setProperty("--slider-pct", "50%");
    return;
  }
  const pct = ((value - min) / (max - min)) * 100;
  rangeEl.style.setProperty("--slider-pct", `${clamp(pct, 0, 100).toFixed(3)}%`);
}

function updateVolumeSliderTrackFill() {
  setSliderFill(els.volumeOpacityRange);
  setSliderFill(els.volumeGammaRange);
  setSliderFill(els.volumeClipNearRange);
  setSliderFill(els.volumeClipFarRange);
  setSliderFill(els.volumeIsoThresholdRange);
}

function setVolumeSphereRangeActiveHandle(bound = null) {
  if (!els.volumeSphereRangeMin || !els.volumeSphereRangeMax) return;
  els.volumeSphereRangeMin.classList.toggle("isActive", bound === "min");
  els.volumeSphereRangeMax.classList.toggle("isActive", bound === "max");
}

function syncVolumeSphereRangeStateFromSteps(activeBound = null) {
  if (!els.volumeSphereRangeMin || !els.volumeSphereRangeMax) return;
  const minStep = Number.parseInt(els.volumeSphereRangeMin.value, 10);
  const maxStep = Number.parseInt(els.volumeSphereRangeMax.value, 10);
  if (!Number.isFinite(minStep) || !Number.isFinite(maxStep)) return;

  let low = clamp(minStep / VOLUME_SPHERE_RANGE_STEPS, 0, 1);
  let high = clamp(maxStep / VOLUME_SPHERE_RANGE_STEPS, 0, 1);
  if (high <= low + VOLUME_SPHERE_MIN_GAP) {
    if (activeBound === "min") high = Math.min(1, low + VOLUME_SPHERE_MIN_GAP);
    else low = Math.max(0, high - VOLUME_SPHERE_MIN_GAP);
  }
  low = clamp(low, 0, 1 - VOLUME_SPHERE_MIN_GAP);
  high = clamp(high, low + VOLUME_SPHERE_MIN_GAP, 1);
  state.volumeRender.clipNear = low;
  state.volumeRender.clipFar = high;
}

function updateVolumeSphereRangeUi() {
  if (
    !els.volumeSphereRangeTrack ||
    !els.volumeSphereRangeMin ||
    !els.volumeSphereRangeMax ||
    !els.volumeSphereRangeMinValue ||
    !els.volumeSphereRangeMaxValue
  ) {
    return;
  }
  const low = clamp(state.volumeRender.clipNear, 0, 1 - VOLUME_SPHERE_MIN_GAP);
  const high = clamp(state.volumeRender.clipFar, low + VOLUME_SPHERE_MIN_GAP, 1);
  state.volumeRender.clipNear = low;
  state.volumeRender.clipFar = high;

  const minStep = Math.round(low * VOLUME_SPHERE_RANGE_STEPS);
  const maxStep = Math.round(high * VOLUME_SPHERE_RANGE_STEPS);
  els.volumeSphereRangeMin.value = String(minStep);
  els.volumeSphereRangeMax.value = String(maxStep);

  const leftPct = (100 * minStep) / VOLUME_SPHERE_RANGE_STEPS;
  const rightPct = (100 * maxStep) / VOLUME_SPHERE_RANGE_STEPS;
  els.volumeSphereRangeTrack.style.setProperty("--range-left", `${leftPct.toFixed(3)}%`);
  els.volumeSphereRangeTrack.style.setProperty("--range-right", `${rightPct.toFixed(3)}%`);

  els.volumeSphereRangeMinValue.textContent = low.toFixed(2);
  els.volumeSphereRangeMaxValue.textContent = high.toFixed(2);
  els.volumeSphereRangeMinValue.style.left = `${clamp(leftPct, 2, 98).toFixed(3)}%`;
  els.volumeSphereRangeMaxValue.style.left = `${clamp(rightPct, 2, 98).toFixed(3)}%`;
}

function updateVolumeControlReadouts() {
  state.volumeRender.sphereNsite = volumeSphereNsiteValue();
  state.volumeRender.sphereProjection = volumeSphereProjectionMode();
  if (els.volumeQualitySelect) els.volumeQualitySelect.value = state.volumeRender.quality;
  if (els.volumeRenderModeSelect) els.volumeRenderModeSelect.value = state.volumeRender.mode;
  if (els.volumeSphereProjectionSelect) els.volumeSphereProjectionSelect.value = state.volumeRender.sphereProjection;
  if (els.volumeSphereNsiteInput) els.volumeSphereNsiteInput.value = String(state.volumeRender.sphereNsite);
  if (els.volumeTfSelect) els.volumeTfSelect.value = state.volumeRender.tf;
  if (els.volumeOpacityRange) els.volumeOpacityRange.value = String(state.volumeRender.opacity);
  if (els.volumeGammaRange) els.volumeGammaRange.value = String(state.volumeRender.gamma);
  if (els.volumeClipNearRange) els.volumeClipNearRange.value = String(state.volumeRender.clipNear);
  if (els.volumeClipFarRange) els.volumeClipFarRange.value = String(state.volumeRender.clipFar);
  if (els.volumeIsoThresholdRange) els.volumeIsoThresholdRange.value = String(state.volumeRender.isoThreshold);
  if (els.volumeOpacityValue) els.volumeOpacityValue.textContent = `${state.volumeRender.opacity.toFixed(1)}x`;
  if (els.volumeGammaValue) els.volumeGammaValue.textContent = state.volumeRender.gamma.toFixed(2);
  if (els.volumeClipNearValue) els.volumeClipNearValue.textContent = state.volumeRender.clipNear.toFixed(2);
  if (els.volumeClipFarValue) els.volumeClipFarValue.textContent = state.volumeRender.clipFar.toFixed(2);
  if (els.volumeIsoThresholdValue) els.volumeIsoThresholdValue.textContent = state.volumeRender.isoThreshold.toFixed(2);
  const sphericalMode = isVolumeSphericalMode();
  const compositeLike = state.volumeRender.mode === "composite" || sphericalMode;
  const isoMode = state.volumeRender.mode === "isosurface";
  setVisible(els.volumeSphereProjectionLabel, sphericalMode);
  setVisible(els.volumeSphereNsiteLabel, sphericalMode);
  setVisible(els.volumeSphereRangeBlock, sphericalMode);
  setVisible(els.volumeClipNearRange ? els.volumeClipNearRange.closest("label") : null, !sphericalMode);
  setVisible(els.volumeClipFarRange ? els.volumeClipFarRange.closest("label") : null, !sphericalMode);
  setVisible(els.volumeTfSelect ? els.volumeTfSelect.closest("label") : null, compositeLike);
  setVisible(els.volumeOpacityRange ? els.volumeOpacityRange.closest("label") : null, compositeLike);
  setVisible(els.volumeGammaRange ? els.volumeGammaRange.closest("label") : null, compositeLike);
  setVisible(els.volumeIsoThresholdLabel, isoMode);
  updateVolumeSphereRangeUi();
  updateVolumeSliderTrackFill();
  if (els.volumeBackendStatus) {
    const zoomMsg = `Scroll: zoom ${state.volumeZoom.toFixed(2)}x`;
    const modeMsg = `Mode: ${state.volumeRender.mode}`;
    const requested = state.sliceRender.backend;
    const requestMsg = `follows Backend (${requested.toUpperCase()})`;
    if (state.fluxScale === "sqrt") {
      els.volumeBackendStatus.textContent = `GPU backend: ${requestMsg}, using CPU for sqrt scale. ${modeMsg}. ${zoomMsg}`;
      return;
    }
    if (!gpuAvailableKnown()) {
      els.volumeBackendStatus.textContent = `GPU backend: ${requestMsg}, probing WebGL2 support. ${modeMsg}. ${zoomMsg}`;
    } else if (gpuAvailable()) {
      const mode = volumeBackendMode() === "gpu" ? "using GPU" : "available, currently on CPU";
      els.volumeBackendStatus.textContent = `GPU backend: WebGL2 available, ${requestMsg}, ${mode}. ${modeMsg}. ${zoomMsg}`;
    } else if (state.volumeGpu.lastError) {
      els.volumeBackendStatus.textContent = `GPU backend unavailable (${state.volumeGpu.lastError}); ${requestMsg}, using CPU. ${modeMsg}. ${zoomMsg}`;
    } else {
      els.volumeBackendStatus.textContent = `GPU backend unavailable; ${requestMsg}, using CPU. ${modeMsg}. ${zoomMsg}`;
    }
  }
}

function isPlaying() {
  return state.playbackTimer !== null;
}

function isSampleMorphPlaybackActive() {
  return state.sampleMorphTimer !== null;
}

function shouldAutoPlaySampleMorph() {
  return Boolean(state.dataId) && isSampleMorphMode() && sampleCount() > 1 && !isPlaying() && !state.sampleMorph.initializing;
}

function stopSampleMorphPlayback() {
  if (state.sampleMorphTimer) {
    clearInterval(state.sampleMorphTimer);
    state.sampleMorphTimer = null;
  }
}

function startSampleMorphPlayback() {
  if (!shouldAutoPlaySampleMorph()) {
    stopSampleMorphPlayback();
    return;
  }
  if (state.sampleMorphTimer) return;

  const intervalMs = Math.max(30, Math.floor(1000 / Math.max(1, state.playbackFps)));
  state.sampleMorphTimer = setInterval(async () => {
    if (state.playbackBusy) return;
    state.playbackBusy = true;
    try {
      await advanceSampleMorphPlayback(intervalMs / 1000);
    } finally {
      state.playbackBusy = false;
    }
  }, intervalMs);
}

function syncSampleMorphPlayback() {
  if (shouldAutoPlaySampleMorph()) {
    startSampleMorphPlayback();
  } else {
    stopSampleMorphPlayback();
  }
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

function isSampleMorphMode() {
  return isSamplesMode() && state.sampleSingleView === "morph";
}

function sampleModeForApi(mode = state.sampleMode) {
  return mode;
}

function resetSampleMorphState() {
  state.sampleMorph.token += 1;
  state.sampleMorph.fromSample = clamp(state.values.sample, 0, Math.max(0, sampleCount() - 1));
  state.sampleMorph.toSample = state.sampleMorph.fromSample;
  state.sampleMorph.alpha = 0;
  state.sampleMorph.initializing = false;
  state.sampleMorph.sharedStats = null;
  state.sampleMorph.fromSlice = null;
  state.sampleMorph.toSlice = null;
  state.sampleMorph.fromVolume = null;
  state.sampleMorph.toVolume = null;
  state.sampleMorph.fromEvpaTicks = [];
  state.sampleMorph.toEvpaTicks = [];
  state.sampleMorph.fromCanvas = null;
  state.sampleMorph.toCanvas = null;
  state.sampleMorph.blendCanvas = null;
  state.sampleMorph.multispectral = false;
}

function isVolumeMode() {
  return state.spatialMode === "volume";
}

function isSphereDataset() {
  return Boolean(state.sphereMeta && state.sphereMeta.active && state.sphereMeta.kind === "healpix");
}

function isSphereMode() {
  return state.spatialMode === "sphere" && isSphereDataset();
}

function canUseVolumeMode() {
  if (isSphereDataset()) return false;
  return axisSize(hiddenDim()) > 1;
}

function setSphereProjection(mode) {
  if (!["mollweide", "inside", "outside"].includes(mode)) return;
  const prev = state.sphereProjection;
  state.sphereProjection = mode;
  if (mode === "inside") {
    state.sphereInsideScale = SPHERE_INSIDE_SCALE;
  }
  updateControlCaps();
  if (isSphereMode()) {
    if (prev !== mode) resetView();
    rerenderSphereFrame();
  }
}

function canUseMultiSpectral() {
  return (
    axisSize("nu") >= 3 &&
    state.sampleMode !== "rel_uncert" &&
    !isDerivedPolModeActive() &&
    !isAxisProjectionActive("nu") &&
    !isVolumeMode()
  );
}

function isMultiSpectralActive() {
  return state.multiSpectral && canUseMultiSpectral();
}

function isAxisSelectorLocked(axis) {
  return axis === "nu" && isMultiSpectralActive();
}

const PANEL_WIDTH_STORAGE_KEY = "mobula-panel-widths-v1";

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

function syncCanvasToDisplaySize(canvasEl) {
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(canvasEl.clientWidth || rect.width || canvasEl.width || 1));
  const cssH = Math.max(1, Math.round(canvasEl.clientHeight || rect.height || canvasEl.height || 1));
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const pixelW = Math.max(1, Math.round(cssW * dpr));
  const pixelH = Math.max(1, Math.round(cssH * dpr));
  if (canvasEl.width !== pixelW || canvasEl.height !== pixelH) {
    canvasEl.width = pixelW;
    canvasEl.height = pixelH;
  }
}

function canvasPixelRatio(canvasEl) {
  if (!canvasEl) return 1;
  const rect = canvasEl.getBoundingClientRect();
  const cssW = Math.max(1, rect.width || canvasEl.clientWidth || canvasEl.width || 1);
  return Math.max(1, canvasEl.width / cssW);
}

function scaleInsets(insets, scale) {
  return {
    l: insets.l * scale,
    r: insets.r * scale,
    t: insets.t * scale,
    b: insets.b * scale,
  };
}

function layoutViewerCanvas() {
  if (!els.viewerPanel || !els.canvas) return;
  if (isNarrowLayout()) {
    els.canvas.style.width = "100%";
    els.canvas.style.height = "auto";
    if (els.colorbarPanel) els.colorbarPanel.style.width = "100%";
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
  const sizePx = `${Math.floor(size)}px`;

  els.canvas.style.width = sizePx;
  els.canvas.style.height = sizePx;
  if (els.colorbarPanel) els.colorbarPanel.style.width = sizePx;
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

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad) {
  return (rad * 180) / Math.PI;
}

function wrap360(deg) {
  let out = deg % 360;
  if (out < 0) out += 360;
  return out;
}

function unitToDegrees(value, unit) {
  if (!Number.isFinite(value)) return null;
  const u = String(unit || "")
    .trim()
    .toLowerCase();
  if (!u || u === "deg" || u === "degree" || u === "degrees") return value;
  if (u === "rad" || u === "radian" || u === "radians") return toDegrees(value);
  if (u === "hourangle" || u === "hour" || u === "h" || u === "hr") return value * 15.0;
  return value;
}

function formatAngleSigned(deg) {
  if (!Number.isFinite(deg)) return "n/a";
  const sign = deg < 0 ? "-" : "+";
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${sign}${String(d).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function formatAngleHms(deg) {
  if (!Number.isFinite(deg)) return "n/a";
  const hour = wrap360(deg) / 15.0;
  const h = Math.floor(hour);
  const mFloat = (hour - h) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function planeAxisTypes() {
  const axisTypes = state.meta && state.meta.wcs && state.meta.wcs.axis_types ? state.meta.wcs.axis_types : {};
  const p = planeDims();
  return {
    xType: axisTypes[p.planeX] || "spatial",
    yType: axisTypes[p.planeY] || "spatial",
  };
}

function celestialPlaneInfo() {
  const p = planeDims();
  const { xType, yType } = planeAxisTypes();
  if (xType === "ra" && yType === "dec") {
    return { raDim: p.planeX, decDim: p.planeY, raAxis: "x", decAxis: "y" };
  }
  if (xType === "dec" && yType === "ra") {
    return { raDim: p.planeY, decDim: p.planeX, raAxis: "y", decAxis: "x" };
  }
  return null;
}

function canUseGalacticCoords() {
  return Boolean(celestialPlaneInfo());
}

function availableCoordSystems() {
  const out = ["native", "pixel"];
  if (canUseGalacticCoords()) out.push("galactic");
  return out;
}

function ensureCoordSystem() {
  const allowed = availableCoordSystems();
  if (!allowed.includes(state.coordSystem)) {
    state.coordSystem = allowed[0];
  }
}

function equatorialToGalactic(raDeg, decDeg) {
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null;
  const ra = toRadians(raDeg);
  const dec = toRadians(decDeg);
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  const gx = EQ_TO_GAL_MATRIX[0][0] * x + EQ_TO_GAL_MATRIX[0][1] * y + EQ_TO_GAL_MATRIX[0][2] * z;
  const gy = EQ_TO_GAL_MATRIX[1][0] * x + EQ_TO_GAL_MATRIX[1][1] * y + EQ_TO_GAL_MATRIX[1][2] * z;
  const gz = EQ_TO_GAL_MATRIX[2][0] * x + EQ_TO_GAL_MATRIX[2][1] * y + EQ_TO_GAL_MATRIX[2][2] * z;
  const l = wrap360(toDegrees(Math.atan2(gy, gx)));
  const b = toDegrees(Math.asin(clamp(gz, -1, 1)));
  return { l, b };
}

function fmtPhysical(dim, coord, unit) {
  if (coord === null || coord === undefined || Number.isNaN(coord)) return "n/a";
  const formatScaled = (value, scale, scaledUnit) => {
    const scaled = value / scale;
    const absScaled = Math.abs(scaled);
    let decimals = 2;
    if (absScaled >= 100) decimals = 0;
    else if (absScaled >= 10) decimals = 1;
    return `${scaled.toFixed(decimals)} ${scaledUnit}`.trim();
  };
  if (dim === "nu" || unit === "Hz") {
    const abs = Math.abs(coord);
    if (abs >= 1.0e12) return formatScaled(coord, 1.0e12, "THz");
    if (abs >= 1.0e9) return formatScaled(coord, 1.0e9, "GHz");
    if (abs >= 1.0e6) return formatScaled(coord, 1.0e6, "MHz");
    if (abs >= 1.0e3) return formatScaled(coord, 1.0e3, "kHz");
    return formatScaled(coord, 1.0, "Hz");
  }
  if (dim === "t" || unit === "s") {
    const abs = Math.abs(coord);
    if (abs >= 3600) return formatScaled(coord, 3600, "h");
    if (abs >= 60) return formatScaled(coord, 60, "min");
    if (abs >= 1) return formatScaled(coord, 1, "s");
    if (abs >= 1.0e-3) return formatScaled(coord, 1.0e-3, "ms");
    if (abs >= 1.0e-6) return formatScaled(coord, 1.0e-6, "us");
    return formatScaled(coord, 1.0e-9, "ns");
  }
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
  if (state.fluxScale === "sqrt") return Math.sign(v) * Math.sqrt(Math.abs(v));
  return v;
}

function fluxFromPlotValue(v) {
  if (state.fluxScale === "log") return Math.max(0, 10 ** v - 1);
  if (state.fluxScale === "sqrt") return Math.sign(v) * v * v;
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

function availableColorRangeModes() {
  const tVarying = axisSize("t") > 1;
  const nuVarying = axisSize("nu") > 1;
  const hiddenSpatialVarying = axisSize(hiddenDim()) > 1;
  const modes = ["none"];
  if (tVarying) modes.push("time");
  if (nuVarying) modes.push("spectral");
  if (tVarying && nuVarying) modes.push("time_spectral");
  if (hiddenSpatialVarying) modes.push("space");
  if (hiddenSpatialVarying || tVarying || nuVarying) modes.push("full");
  return modes;
}

function updateColorRangeModeOptions() {
  if (!els.colorRangeModeSelect) return;
  const available = new Set(availableColorRangeModes());
  if (!available.has(state.colorRangeMode)) {
    state.colorRangeMode = "none";
    state.fixedColorRange = null;
  }

  const desired = COLOR_RANGE_MODE_OPTIONS.filter((mode) => available.has(mode.value));
  const current = Array.from(els.colorRangeModeSelect.options).map((opt) => opt.value);
  const changed = current.length !== desired.length || desired.some((mode, idx) => current[idx] !== mode.value);
  if (changed) {
    els.colorRangeModeSelect.innerHTML = "";
    for (const mode of desired) {
      const opt = document.createElement("option");
      opt.value = mode.value;
      opt.textContent = mode.label;
      els.colorRangeModeSelect.appendChild(opt);
    }
  }
  els.colorRangeModeSelect.value = state.colorRangeMode;
}

function colorNormDomainForScale(stats) {
  if (!isValidRangeStats(stats)) return null;
  if (state.fluxScale === "log") {
    const min = Math.max(0, stats.min);
    const max = stats.max;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    return { min, max };
  }
  return { min: stats.min, max: stats.max };
}

function colorNormToScale(v) {
  if (state.fluxScale === "log") return Math.log10(1 + Math.max(0, v));
  if (state.fluxScale === "sqrt") return Math.sign(v) * Math.sqrt(Math.abs(v));
  return v;
}

function colorNormFromScale(v) {
  if (state.fluxScale === "log") return Math.max(0, 10 ** v - 1);
  if (state.fluxScale === "sqrt") return Math.sign(v) * v * v;
  return v;
}

function resolveColorNormWindow(stats) {
  const domain = colorNormDomainForScale(stats);
  if (!domain) return null;

  const domainMinT = colorNormToScale(domain.min);
  const domainMaxT = colorNormToScale(domain.max);
  const spanT = Math.max(1.0e-9, domainMaxT - domainMinT);
  const minGapT = spanT * COLOR_NORM_SLIDER_MIN_GAP;

  let minV = Number.isFinite(state.colorNormValueWindow?.min) ? state.colorNormValueWindow.min : domain.min;
  let maxV = Number.isFinite(state.colorNormValueWindow?.max) ? state.colorNormValueWindow.max : domain.max;
  minV = clamp(minV, domain.min, domain.max);
  maxV = clamp(maxV, domain.min, domain.max);

  let minT = clamp(colorNormToScale(minV), domainMinT, domainMaxT);
  let maxT = clamp(colorNormToScale(maxV), domainMinT, domainMaxT);
  if (maxT - minT < minGapT) {
    if (maxT >= domainMaxT) {
      minT = Math.max(domainMinT, domainMaxT - minGapT);
      maxT = domainMaxT;
    } else {
      maxT = Math.min(domainMaxT, minT + minGapT);
    }
  }
  if (maxT <= minT) {
    maxT = Math.min(domainMaxT, minT + minGapT);
    minT = Math.max(domainMinT, maxT - minGapT);
  }

  minV = clamp(colorNormFromScale(minT), domain.min, domain.max);
  maxV = clamp(colorNormFromScale(maxT), domain.min, domain.max);
  if (!Number.isFinite(minV) || !Number.isFinite(maxV) || maxV <= minV) {
    return {
      min: domain.min,
      max: domain.max,
      minT: domainMinT,
      maxT: domainMaxT,
      domain,
      domainMinT,
      domainMaxT,
    };
  }

  return { min: minV, max: maxV, minT, maxT, domain, domainMinT, domainMaxT };
}

function isColorNormWindowDefault() {
  const base = activeIntensityBaseStats();
  const resolved = resolveColorNormWindow(base);
  if (!resolved) return true;
  const tol = Math.max(1.0e-9, Math.abs(resolved.domain.max - resolved.domain.min) * 1.0e-6);
  return Math.abs(resolved.min - resolved.domain.min) <= tol && Math.abs(resolved.max - resolved.domain.max) <= tol;
}

function resolveColorNormStats(stats) {
  const resolved = resolveColorNormWindow(stats);
  if (!resolved) return stats;
  return { min: resolved.min, max: resolved.max };
}

function activeIntensityBaseStats() {
  if (isValidRangeStats(state.fixedColorRange)) return state.fixedColorRange;
  if (isValidRangeStats(state.currentIntensityStats)) return state.currentIntensityStats;
  return null;
}

function updateColorNormalizationControls() {
  if (!els.colorNormMinRange || !els.colorNormMaxRange || !els.colorNormTrack) return;
  const base = activeIntensityBaseStats();
  const resolved = resolveColorNormWindow(base);
  const enabled = Boolean(resolved) && !state.multiSpectral;

  const lowStep = resolved
    ? Math.round(
        (COLOR_NORM_SLIDER_STEPS * (resolved.minT - resolved.domainMinT)) /
          Math.max(1.0e-9, resolved.domainMaxT - resolved.domainMinT)
      )
    : 0;
  const highStep = resolved
    ? Math.round(
        (COLOR_NORM_SLIDER_STEPS * (resolved.maxT - resolved.domainMinT)) /
          Math.max(1.0e-9, resolved.domainMaxT - resolved.domainMinT)
      )
    : COLOR_NORM_SLIDER_STEPS;
  els.colorNormMinRange.value = String(lowStep);
  els.colorNormMaxRange.value = String(highStep);

  const leftPct = (100 * lowStep) / COLOR_NORM_SLIDER_STEPS;
  const rightPct = (100 * highStep) / COLOR_NORM_SLIDER_STEPS;
  els.colorNormTrack.style.setProperty("--range-left", `${leftPct.toFixed(3)}%`);
  els.colorNormTrack.style.setProperty("--range-right", `${rightPct.toFixed(3)}%`);

  els.colorNormMinRange.disabled = !enabled;
  els.colorNormMaxRange.disabled = !enabled;

  if (els.colorNormRangeBlock) {
    els.colorNormRangeBlock.classList.toggle("isDisabled", !enabled);
  }

  const setRangeValueLabel = (el, text, pct) => {
    if (!el) return;
    el.textContent = text;
    if (!Number.isFinite(pct)) {
      el.style.left = "50%";
      el.style.visibility = "hidden";
      return;
    }
    el.style.left = `${clamp(pct, 2, 98).toFixed(3)}%`;
    el.style.visibility = "visible";
  };

  if (!base) {
    setRangeValueLabel(els.colorNormMinValue, "--", NaN);
    setRangeValueLabel(els.colorNormMaxValue, "--", NaN);
    if (els.colorNormBoundMin) els.colorNormBoundMin.textContent = "--";
    if (els.colorNormBoundMax) els.colorNormBoundMax.textContent = "--";
    return;
  }

  const unit = state.currentIntensityUnit || (state.meta ? state.meta.intensity_unit || "" : "");
  if (els.colorNormBoundMin) els.colorNormBoundMin.textContent = `${fmtIntensity(base.min)} ${unit}`.trim();
  if (els.colorNormBoundMax) els.colorNormBoundMax.textContent = `${fmtIntensity(base.max)} ${unit}`.trim();
  if (resolved) {
    setRangeValueLabel(els.colorNormMinValue, `${fmtIntensity(resolved.min)} ${unit}`.trim(), leftPct);
    setRangeValueLabel(els.colorNormMaxValue, `${fmtIntensity(resolved.max)} ${unit}`.trim(), rightPct);
    return;
  }
  setRangeValueLabel(els.colorNormMinValue, "n/a", 25);
  setRangeValueLabel(els.colorNormMaxValue, "n/a", 75);
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

function normalizeFluxLog(v, maxPositive, minPositive = 0) {
  const lo = Math.max(0, minPositive);
  if (v < 0 && lo <= 0) return null;
  const hi = Math.max(lo, maxPositive);
  if (!(hi > lo)) return 0;
  const sample = Math.max(v, lo);
  const loLog = Math.log10(1 + lo);
  const hiLog = Math.log10(1 + hi);
  const span = hiLog - loLog;
  if (!(span > 0)) return 0;
  return (Math.log10(1 + sample) - loLog) / span;
}

function normalizeFluxSqrt(v, mm) {
  if (!isFiniteNumber(v)) return null;
  if (state.colorMap === "circular" && isDerivedPolModeActive() && state.derivedPolMode === "bfield") {
    return normalizeForColormap(v, mm);
  }
  if (state.colorMap === "diverging" && mm.min < 0 && mm.max > 0) {
    const maxAbs = Math.max(Math.abs(mm.min), Math.abs(mm.max));
    if (!(maxAbs > 0)) return 0.5;
    const maxAbsSqrt = Math.sqrt(maxAbs);
    const transformed = Math.sign(v) * Math.sqrt(Math.abs(v));
    return (transformed + maxAbsSqrt) / Math.max(1.0e-9, 2 * maxAbsSqrt);
  }
  const span = Math.max(1.0e-9, mm.max - mm.min);
  const t = clamp((v - mm.min) / span, 0, 1);
  return Math.sqrt(t);
}

function resetView() {
  if (isSphereMode()) {
    const [sw, sh] = sphereCanvasSize();
    if (state.sphereProjection === "mollweide") {
      const base = mollweideFullViewWindow(sw, sh);
      state.view.w = base.w;
      state.view.h = base.h;
      state.view.u = 0.5 * (sw - base.w);
      state.view.v = 0.5 * (sh - base.h);
      return;
    }
    state.view.u = 0;
    state.view.v = 0;
    state.view.w = sw;
    state.view.h = sh;
    return;
  }
  const p = planeDims();
  state.view.u = 0;
  state.view.v = 0;
  state.view.w = axisSize(p.planeX);
  state.view.h = axisSize(p.planeY);
}

function sphereZoomOutLimit() {
  if (!isSphereMode()) return 1.0;
  if (state.sphereProjection === "outside") return 1.6;
  if (state.sphereProjection === "inside") return 1.0;
  return 1.05;
}

function sphereInsideRenderScale() {
  const s = Number.isFinite(state.sphereInsideScale) ? state.sphereInsideScale : SPHERE_INSIDE_SCALE;
  return clamp(s, SPHERE_INSIDE_SCALE_MIN, SPHERE_INSIDE_SCALE_MAX);
}

function mollweideViewAspect() {
  const w = Number.isFinite(els?.canvas?.width) ? els.canvas.width : 1;
  const h = Number.isFinite(els?.canvas?.height) ? els.canvas.height : 1;
  return Math.max(1.0e-6, w / Math.max(1.0e-6, h));
}

function mollweideFullViewWindow(imgW, imgH) {
  const a = mollweideViewAspect();
  const imgAspect = imgW / Math.max(1.0e-6, imgH);
  if (imgAspect >= a) {
    const w = imgW;
    return { w, h: w / a };
  }
  const h = imgH;
  return { w: h * a, h };
}

function mollweideZoomBounds(imgW, imgH) {
  const base = mollweideFullViewWindow(imgW, imgH);
  const aspect = base.w / Math.max(1.0e-6, base.h);
  const maxZoomOut = sphereZoomOutLimit();
  return {
    base,
    aspect,
    minW: Math.min(2, base.w),
    minH: Math.min(2, base.h),
    maxW: base.w * maxZoomOut,
    maxH: base.h * maxZoomOut,
  };
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
  if (isSphereMode() && state.sphereProjection === "inside") {
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
  if (isSphereMode() && state.sphereProjection === "mollweide") {
    const bounds = mollweideZoomBounds(imgW, imgH);
    const targetAspect = bounds.aspect;
    const minW = bounds.minW;
    const minH = bounds.minH;
    const maxW = bounds.maxW;
    const maxH = bounds.maxH;

    let w = state.view.w;
    let h = state.view.h;
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      w = bounds.base.w;
      h = bounds.base.h;
    }
    const cx = (Number.isFinite(state.view.u) ? state.view.u : 0) + 0.5 * w;
    const cy = (Number.isFinite(state.view.v) ? state.view.v : 0) + 0.5 * h;

    if (w / Math.max(1.0e-6, h) > targetAspect) h = w / targetAspect;
    else w = h * targetAspect;

    w = clamp(w, minW, maxW);
    h = w / targetAspect;
    if (h < minH) {
      h = minH;
      w = h * targetAspect;
    }
    if (h > maxH) {
      h = maxH;
      w = h * targetAspect;
    }

    state.view.w = w;
    state.view.h = h;
    state.view.u = cx - 0.5 * w;
    state.view.v = cy - 0.5 * h;

    if (state.view.w > imgW) state.view.u = 0.5 * (imgW - state.view.w);
    else state.view.u = clamp(state.view.u, 0, imgW - state.view.w);
    if (state.view.h > imgH) state.view.v = 0.5 * (imgH - state.view.h);
    else state.view.v = clamp(state.view.v, 0, imgH - state.view.h);

    return {
      srcX: state.view.u,
      srcY: state.view.v,
      srcW: state.view.w,
      srcH: state.view.h,
      imgW,
      imgH,
    };
  }

  const minW = isSphereMode() && state.sphereProjection === "inside" ? imgW : Math.min(2, imgW);
  const minH = isSphereMode() && state.sphereProjection === "inside" ? imgH : Math.min(2, imgH);
  const maxZoomOut = sphereZoomOutLimit();
  const maxW = isSphereMode() ? imgW * maxZoomOut : imgW;
  const maxH = isSphereMode() ? imgH * maxZoomOut : imgH;
  state.view.w = clamp(state.view.w, minW, maxW);
  state.view.h = clamp(state.view.h, minH, maxH);
  if (isSphereMode() && state.view.w > imgW) {
    state.view.u = 0.5 * (imgW - state.view.w);
  } else if (state.view.w <= imgW) {
    state.view.u = clamp(state.view.u, 0, imgW - state.view.w);
  } else {
    state.view.u = clamp(state.view.u, imgW - state.view.w, 0);
  }
  if (isSphereMode() && state.view.h > imgH) {
    state.view.v = 0.5 * (imgH - state.view.h);
  } else if (state.view.h <= imgH) {
    state.view.v = clamp(state.view.v, 0, imgH - state.view.h);
  } else {
    state.view.v = clamp(state.view.v, imgH - state.view.h, 0);
  }

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
  const s = canvasPixelRatio(els.canvas);
  const gap = grid > 1 ? 6 * s : 0;
  const maxCellW = (cw - gap * (grid - 1)) / grid;
  const maxCellH = (ch - gap * (grid - 1)) / grid;
  const cell = Math.max(8 * s, Math.floor(Math.min(maxCellW, maxCellH)));
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
  const sphereCanvas = isSphereMode() ? activeHealpixFrameCanvas() : null;
  const uSize = sphereCanvas ? sphereCanvas.width : axisSize(p.planeX);
  const vSize = sphereCanvas ? sphereCanvas.height : axisSize(p.planeY);
  const u0 = clamp(Math.min(state.selection.u0, state.selection.u1), 0, uSize - 1);
  const u1 = clamp(Math.max(state.selection.u0, state.selection.u1), 0, uSize - 1) + 1;
  const v0 = clamp(Math.min(state.selection.v0, state.selection.v1), 0, vSize - 1);
  const v1 = clamp(Math.max(state.selection.v0, state.selection.v1), 0, vSize - 1) + 1;
  return { u0, u1, v0, v1 };
}

function currentViewBounds() {
  const p = planeDims();
  const viewRect = getViewRect();
  const uSize = isSphereMode() ? viewRect.imgW : axisSize(p.planeX);
  const vSize = isSphereMode() ? viewRect.imgH : axisSize(p.planeY);
  const u0 = clamp(Math.floor(viewRect.srcX), 0, uSize - 1);
  const u1 = clamp(Math.ceil(viewRect.srcX + viewRect.srcW), u0 + 1, uSize);
  const v0 = clamp(Math.floor(viewRect.srcY), 0, vSize - 1);
  const v1 = clamp(Math.ceil(viewRect.srcY + viewRect.srcH), v0 + 1, vSize);
  return { u0, u1, v0, v1 };
}

function hasSpatialZoom() {
  if (!state.dataId || isVolumeMode()) return false;
  const viewRect = getViewRect();
  const eps = 1.0e-6;
  return (
    viewRect.srcX > eps ||
    viewRect.srcY > eps ||
    viewRect.srcW < viewRect.imgW - eps ||
    viewRect.srcH < viewRect.imgH - eps
  );
}

function hasDomainZoom() {
  return Boolean(state.axisWindow.t || state.axisWindow.nu);
}

function canExportZoomCutout() {
  if (!state.dataId || isVolumeMode() || isSampleMorphMode()) return false;
  return hasSpatialZoom() || hasDomainZoom();
}

function updateExportButtonState() {
  if (!els.exportZoomBtn) return;
  const enabled = canExportZoomCutout();
  els.exportZoomBtn.disabled = !enabled;
}

function hoverPayloadForTile(tile = 0) {
  if (state.currentMonoSliceTiles && state.currentMonoSliceTiles.length) {
    return state.currentMonoSliceTiles[clamp(tile, 0, state.currentMonoSliceTiles.length - 1)] || null;
  }
  if (state.currentMonoSlice) return state.currentMonoSlice;
  if (state.currentMultispectralTiles && state.currentMultispectralTiles.length) {
    return state.currentMultispectralTiles[clamp(tile, 0, state.currentMultispectralTiles.length - 1)] || null;
  }
  if (state.currentMultispectralSlice) return state.currentMultispectralSlice;
  return null;
}

function payloadShape2d(payload) {
  if (!payload || !Array.isArray(payload.shape) || payload.shape.length < 2) return [0, 0];
  const w = Number.parseInt(payload.shape[0], 10);
  const h = Number.parseInt(payload.shape[1], 10);
  return [Math.max(0, w), Math.max(0, h)];
}

function payloadSamplingStep(payload) {
  if (!payload || !Array.isArray(payload.sampling_step) || payload.sampling_step.length < 2) return [1, 1];
  const sx = Number.parseInt(payload.sampling_step[0], 10);
  const sy = Number.parseInt(payload.sampling_step[1], 10);
  return [Math.max(1, sx), Math.max(1, sy)];
}

function payloadValueAt(payload, ix, iy) {
  if (!payload) return { kind: "none" };
  const [shapeX, shapeY] = payloadShape2d(payload);
  if (shapeX < 1 || shapeY < 1) return { kind: "none" };
  const [stepX, stepY] = payloadSamplingStep(payload);
  const sx = clamp(Math.floor(ix / stepX), 0, shapeX - 1);
  const sy = clamp(Math.floor(iy / stepY), 0, shapeY - 1);
  const src = sx * shapeY + sy;
  const values = payload.values;
  if (Array.isArray(values)) {
    const flux = values[src];
    if (Number.isFinite(flux)) return { kind: "single", flux };
    return { kind: "single", flux: null };
  }
  if (values && Array.isArray(values.r) && Array.isArray(values.g) && Array.isArray(values.b)) {
    const rv = values.r[src];
    const gv = values.g[src];
    const bv = values.b[src];
    return { kind: "rgb", r: rv, g: gv, b: bv };
  }
  return { kind: "none" };
}

function payloadValueAtIndex(payload, idx) {
  if (!payload) return { kind: "none" };
  const values = payload.values;
  if (Array.isArray(values)) {
    const flux = values[idx];
    if (Number.isFinite(flux)) return { kind: "single", flux };
    return { kind: "single", flux: null };
  }
  if (values && Array.isArray(values.r) && Array.isArray(values.g) && Array.isArray(values.b)) {
    const rv = values.r[idx];
    const gv = values.g[idx];
    const bv = values.b[idx];
    return { kind: "rgb", r: rv, g: gv, b: bv };
  }
  return { kind: "none" };
}

function payloadCoordAt(payload, dim, idx) {
  if (!payload || !payload.coords || !Array.isArray(payload.coords[dim])) return dimCoord(dim, idx);
  const coords = payload.coords[dim];
  if (!coords.length) return dimCoord(dim, idx);
  return coords[clamp(idx, 0, coords.length - 1)];
}

function clearHoverProbe() {
  state.hoverProbe = null;
  updateHoverReadout();
}

function refreshHoverProbeFromPointer() {
  if (!state.hoverPointer || !state.hoverPointer.inside) {
    updateHoverReadout();
    return;
  }
  updateHoverProbeFromEvent({
    clientX: state.hoverPointer.clientX,
    clientY: state.hoverPointer.clientY,
  });
}

function sphereProbeFromDataPoint(dataPoint, tile, payload) {
  const canvas = state.frameTiles && state.frameTiles.length
    ? state.frameTiles[clamp(tile, 0, state.frameTiles.length - 1)]
    : state.frameCanvas;
  const map = canvas ? canvas.__healpixIndexMap : null;
  if (!canvas || !map) return null;

  const imageX = clamp(Math.floor(dataPoint.u), 0, canvas.width - 1);
  const imageY = clamp(Math.floor(dataPoint.v), 0, canvas.height - 1);
  const ipix = map[imageY * canvas.width + imageX];
  if (!Number.isFinite(ipix) || ipix < 0) return null;

  const vectors = ensureSphereVectors();
  let vx = null;
  let vy = null;
  let vz = null;
  let lonDeg = null;
  let latDeg = null;
  if (vectors && vectors.length >= (ipix + 1) * 3) {
    vx = vectors[ipix * 3 + 0];
    vy = vectors[ipix * 3 + 1];
    vz = vectors[ipix * 3 + 2];
    lonDeg = wrap360(toDegrees(Math.atan2(vy, vx)));
    latDeg = toDegrees(Math.asin(clamp(vz, -1, 1)));
  }

  return {
    kind: "sphere",
    tile,
    ipix,
    imageX,
    imageY,
    nside: state.sphereMeta?.nside ?? null,
    ordering: state.sphereMeta?.ordering || "ring",
    projection: state.sphereProjection || "mollweide",
    lonDeg,
    latDeg,
    vx,
    vy,
    vz,
    value: payloadValueAtIndex(payload, ipix),
  };
}

function updateHoverProbeFromEvent(ev) {
  if (!state.dataId || isVolumeMode() || isSampleMorphMode()) {
    clearHoverProbe();
    return;
  }
  if (!state.frameCanvas && !(state.frameTiles && state.frameTiles.length)) {
    clearHoverProbe();
    return;
  }
  const canvasRect = els.canvas.getBoundingClientRect();
  if (
    ev.clientX < canvasRect.left ||
    ev.clientX > canvasRect.right ||
    ev.clientY < canvasRect.top ||
    ev.clientY > canvasRect.bottom
  ) {
    clearHoverProbe();
    return;
  }
  const viewRect = getViewRect();
  const drawRect = state.drawRect || getDrawRect(viewRect);
  const p = screenToData(ev, viewRect, drawRect);
  const tile = p.tile || 0;
  const payload = hoverPayloadForTile(tile);
  if (isSphereMode()) {
    const sphereProbe = sphereProbeFromDataPoint(p, tile, payload);
    if (!sphereProbe) {
      clearHoverProbe();
      return;
    }
    state.hoverProbe = sphereProbe;
    updateHoverReadout();
    return;
  }
  const plane = planeDims();
  const ix = clamp(Math.floor(p.u), 0, axisSize(plane.planeX) - 1);
  const iy = clamp(Math.floor(p.v), 0, axisSize(plane.planeY) - 1);
  const value = payloadValueAt(payload, ix, iy);
  const selectedCoords = payload ? payload.selected_coords || indicesToCoords(payload.selected_indices) : state.selectedCoords || {};
  state.hoverProbe = {
    kind: "plane",
    tile,
    ix,
    iy,
    planeX: plane.planeX,
    planeY: plane.planeY,
    xCoord: payloadCoordAt(payload, plane.planeX, ix),
    yCoord: payloadCoordAt(payload, plane.planeY, iy),
    selectedCoords,
    value,
  };
  updateHoverReadout();
}

function formatNativeCoordinate(dim, coord, unit, axisType) {
  if (!Number.isFinite(coord)) return `${dim.toUpperCase()}: n/a`;
  if (axisType === "ra") {
    const deg = unitToDegrees(coord, unit);
    return `${dim.toUpperCase()} ${formatAngleHms(deg)} (${deg.toFixed(6)} deg)`;
  }
  if (axisType === "dec") {
    const deg = unitToDegrees(coord, unit);
    return `${dim.toUpperCase()} ${formatAngleSigned(deg)} (${deg.toFixed(6)} deg)`;
  }
  return `${dim.toUpperCase()} ${fmtPhysical(dim, coord, unit)}`;
}

function updateCoordSystemOptions() {
  if (!els.coordSystemSelect) return;
  ensureCoordSystem();
  const allowed = new Set(availableCoordSystems());
  for (const opt of Array.from(els.coordSystemSelect.options)) {
    const value = String(opt.value || "");
    opt.disabled = !allowed.has(value);
    if (COORD_SYSTEM_LABEL[value]) opt.textContent = COORD_SYSTEM_LABEL[value];
  }
  els.coordSystemSelect.value = state.coordSystem;
}

function padLeft(val, width) {
  const txt = String(val ?? "");
  if (txt.length >= width) return txt;
  return `${" ".repeat(width - txt.length)}${txt}`;
}

function fmtSignedFixed(value, frac = 6, width = 0) {
  if (!Number.isFinite(value)) return width > 0 ? padLeft("n/a", width) : "n/a";
  const txt = `${value >= 0 ? "+" : ""}${value.toFixed(frac)}`;
  return width > 0 ? padLeft(txt, width) : txt;
}

function fluxReadoutLines(value) {
  const unit = state.currentIntensityUnit || (state.meta ? state.meta.intensity_unit || "" : "");
  if (!value || value.kind === "none") return [`Flux    : ${padLeft("n/a", 12)} ${unit}`.trimEnd()];
  if (value.kind === "single") {
    const flux = Number.isFinite(value.flux) ? fmtIntensity(value.flux) : "n/a";
    return [`Flux    : ${padLeft(flux, 12)} ${unit}`.trimEnd()];
  }
  const fmt = (v) => (Number.isFinite(v) ? fmtIntensity(v) : "n/a");
  return [
    `Flux R  : ${padLeft(fmt(value.r), 12)} ${unit}`.trimEnd(),
    `Flux G  : ${padLeft(fmt(value.g), 12)} ${unit}`.trimEnd(),
    `Flux B  : ${padLeft(fmt(value.b), 12)} ${unit}`.trimEnd(),
  ];
}

function setHoverReadoutLines(lines) {
  if (!els.hoverReadout) return;
  const out = Array.isArray(lines) ? lines.slice(0, 8) : [String(lines || "")];
  while (out.length < 8) out.push("");
  els.hoverReadout.textContent = out.join("\n");
}

function updateHoverReadout() {
  if (!state.dataId) {
    setHoverReadoutLines(["Hover over image to inspect", "coordinates and flux."]);
    return;
  }
  if (isVolumeMode()) {
    setHoverReadoutLines(["Hover readout is available", "in Slice and Sphere modes."]);
    return;
  }
  if (isSampleMorphMode()) {
    setHoverReadoutLines(["Hover readout paused", "during sample morph playback."]);
    return;
  }
  if (!state.hoverProbe) {
    setHoverReadoutLines(
      isSphereMode()
        ? ["Hover over sphere to inspect", "coordinates and value."]
        : ["Hover over image to inspect", "coordinates and flux."]
    );
    return;
  }

  const probe = state.hoverProbe;
  if (probe.kind === "sphere") {
    const lines = [
      `Lon[deg]: ${fmtSignedFixed(probe.lonDeg, 6, 12)}`,
      `Lat[deg]: ${fmtSignedFixed(probe.latDeg, 6, 12)}`,
      ...fluxReadoutLines(probe.value),
    ];
    setHoverReadoutLines(lines);
    return;
  }

  const { xType, yType } = planeAxisTypes();
  const xUnit = dimUnit(probe.planeX);
  const yUnit = dimUnit(probe.planeY);

  let lines;
  if (state.coordSystem === "pixel") {
    lines = [
      "Plane Inspect",
      `X idx   : ${padLeft(probe.ix, 8)} (${probe.planeX.toUpperCase()})`,
      `Y idx   : ${padLeft(probe.iy, 8)} (${probe.planeY.toUpperCase()})`,
    ];
  } else if (state.coordSystem === "galactic" && canUseGalacticCoords()) {
    const celestial = celestialPlaneInfo();
    const raCoord = celestial.raAxis === "x" ? probe.xCoord : probe.yCoord;
    const decCoord = celestial.decAxis === "x" ? probe.xCoord : probe.yCoord;
    const raDeg = unitToDegrees(raCoord, dimUnit(celestial.raDim));
    const decDeg = unitToDegrees(decCoord, dimUnit(celestial.decDim));
    const gal = equatorialToGalactic(raDeg, decDeg);
    lines = gal
      ? [
          "Plane Inspect",
          `l [deg] : ${fmtSignedFixed(gal.l, 6, 12)}`,
          `b [deg] : ${fmtSignedFixed(gal.b, 6, 12)}`,
        ]
      : ["Plane Inspect", "l [deg] :          n/a", "b [deg] :          n/a"];
  } else {
    let xValue = "n/a";
    let yValue = "n/a";
    if (xType === "ra") {
      const deg = unitToDegrees(probe.xCoord, xUnit);
      xValue = Number.isFinite(deg) ? fmtSignedFixed(deg, 6, 12) : "n/a";
    } else if (Number.isFinite(probe.xCoord)) {
      xValue = fmtSignedFixed(probe.xCoord, 6, 12);
    }
    if (yType === "dec") {
      const deg = unitToDegrees(probe.yCoord, yUnit);
      yValue = Number.isFinite(deg) ? fmtSignedFixed(deg, 6, 12) : "n/a";
    } else if (Number.isFinite(probe.yCoord)) {
      yValue = fmtSignedFixed(probe.yCoord, 6, 12);
    }
    lines = [
      "Plane Inspect",
      `${probe.planeX.toUpperCase()}[${xUnit || "-"}]: ${xValue}`,
      `${probe.planeY.toUpperCase()}[${yUnit || "-"}]: ${yValue}`,
    ];
  }
  lines.push(...fluxReadoutLines(probe.value));
  setHoverReadoutLines(lines);
}

function isValidExportFormat(format) {
  return format === "fits" || format === "hdf5";
}

function sphereFitsExportDisabled() {
  return isSphereMode();
}

function isExportFormatAllowed(format) {
  if (!isValidExportFormat(format)) return false;
  if (format === "fits" && sphereFitsExportDisabled()) return false;
  return true;
}

function updateExportFormatAvailability() {
  if (els.exportFormatSelect) {
    const fitsOpt = Array.from(els.exportFormatSelect.options).find((opt) => opt.value === "fits");
    if (fitsOpt) {
      fitsOpt.disabled = sphereFitsExportDisabled();
    }
  }
  if (els.exportFormatNote) {
    els.exportFormatNote.textContent = sphereFitsExportDisabled()
      ? "FITS export for sphere cutouts is temporarily disabled and planned as a future feature. Use HDF5 for now."
      : "";
  }
}

function exportFormatExtension(format) {
  return format === "hdf5" ? ".h5" : ".fits";
}

function exportDefaultFilename(format) {
  const p = planeDims();
  const mode = sampleModeForApi();
  return `${state.dataId}_cutout_${p.planeX}${p.planeY}_${mode}${exportFormatExtension(format)}`;
}

function normalizeExportFilename(name, format) {
  const fmt = isValidExportFormat(format) ? format : "fits";
  let out = String(name || "").trim();
  if (!out) out = exportDefaultFilename(fmt);
  out = out.split(/[\\/]/).pop() || exportDefaultFilename(fmt);
  const lower = out.toLowerCase();
  if (fmt === "hdf5") {
    if (!lower.endsWith(".h5") && !lower.endsWith(".hdf5")) {
      out = `${out.replace(/\.[^.]+$/, "")}.h5`;
    }
    return out;
  }
  if (!lower.endsWith(".fits") && !lower.endsWith(".fit") && !lower.endsWith(".fts")) {
    out = `${out.replace(/\.[^.]+$/, "")}.fits`;
  }
  return out;
}

function buildExportCutoutRequestBody() {
  const p = planeDims();
  const body = {
    sample: state.values.sample,
    pol: state.values.pol,
    t: state.values.t,
    nu: state.values.nu,
    x: state.values.x,
    y: state.values.y,
    z: state.values.z,
    sample_mode: sampleModeForApi(),
    plane_x: p.planeX,
    plane_y: p.planeY,
  };
  if (isSphereMode()) {
    let indices = healpixIndicesFromBounds(currentViewBounds());
    if (!indices.length) {
      const canvas = activeHealpixFrameCanvas();
      if (canvas) indices = healpixIndicesFromBounds({ u0: 0, u1: canvas.width, v0: 0, v1: canvas.height });
    }
    if (!indices.length) {
      throw new Error("No HEALPix pixels found in current sphere view.");
    }
    body.plane_x = "x";
    body.pixel_indices = indices;
  } else {
    const bounds = currentViewBounds();
    body.u0 = bounds.u0;
    body.u1 = bounds.u1;
    body.v0 = bounds.v0;
    body.v1 = bounds.v1;
  }
  if (state.axisWindow.t) {
    body.t0 = state.axisWindow.t.start;
    body.t1 = state.axisWindow.t.end + 1;
  }
  if (state.axisWindow.nu) {
    body.nu0 = state.axisWindow.nu.start;
    body.nu1 = state.axisWindow.nu.end + 1;
  }
  return body;
}

function setExportStatus(message, error = false) {
  if (!els.exportStatus) return;
  els.exportStatus.textContent = message || "";
  els.exportStatus.classList.toggle("error", Boolean(error));
}

function updateExportDialogFields() {
  if (!els.exportFormatSelect || !els.exportFilenameInput || !els.exportLocationInput || !els.exportOverwriteChk) return;
  let format = isValidExportFormat(state.exportPrefs.format) ? state.exportPrefs.format : "fits";
  if (!isExportFormatAllowed(format)) format = "hdf5";
  state.exportPrefs.format = format;
  if (!state.exportPrefs.filename) {
    state.exportPrefs.filename = exportDefaultFilename(format);
  }
  state.exportPrefs.filename = normalizeExportFilename(state.exportPrefs.filename, format);

  updateExportFormatAvailability();
  els.exportFormatSelect.value = format;
  els.exportFilenameInput.value = state.exportPrefs.filename;
  els.exportLocationInput.value = state.exportPrefs.outputDir || "";
  els.exportOverwriteChk.checked = state.exportPrefs.overwrite !== false;
}

async function chooseExportFolder() {
  const payload = await fetchJson("/api/fs/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "folder" }),
  });
  if (payload.canceled) return false;
  if (!payload.exists || !payload.is_dir) {
    throw new Error(`invalid folder: ${payload.path || "unknown"}`);
  }
  state.exportPrefs.outputDir = payload.path;
  updateExportDialogFields();
  return true;
}

function openExportDialog() {
  if (!els.exportDialog) return;
  const format = isValidExportFormat(state.exportPrefs.format) ? state.exportPrefs.format : "fits";
  state.exportPrefs.format = format;
  state.exportPrefs.filename = normalizeExportFilename(state.exportPrefs.filename || exportDefaultFilename(format), format);
  updateExportDialogFields();
  setExportStatus("");
  if (typeof els.exportDialog.showModal === "function") {
    els.exportDialog.showModal();
  }
}

function closeExportDialog() {
  if (!els.exportDialog) return;
  if (els.exportDialog.open) {
    els.exportDialog.close();
  }
  setExportStatus("");
}

async function saveExportCutoutFromDialog() {
  if (!state.dataId || !canExportZoomCutout()) return;
  if (!els.exportFormatSelect || !els.exportFilenameInput || !els.exportOverwriteChk) return;

  const requestedFormat = isValidExportFormat(els.exportFormatSelect.value) ? els.exportFormatSelect.value : "fits";
  const format = isExportFormatAllowed(requestedFormat) ? requestedFormat : "hdf5";
  state.exportPrefs.format = format;
  state.exportPrefs.filename = normalizeExportFilename(els.exportFilenameInput.value, format);
  state.exportPrefs.overwrite = Boolean(els.exportOverwriteChk.checked);

  if (!state.exportPrefs.outputDir) {
    setExportStatus("Choose a destination folder.", true);
    const selected = await chooseExportFolder();
    if (!selected) return;
  }

  setExportStatus("Saving export...");
  const reqBody = {
    ...buildExportCutoutRequestBody(),
    format: state.exportPrefs.format,
    output_dir: state.exportPrefs.outputDir,
    filename: state.exportPrefs.filename,
    overwrite: state.exportPrefs.overwrite,
  };
  const response = await fetchJson(`/api/datasets/${state.dataId}/export-cutout/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  if (!response.saved) {
    throw new Error(response.detail || "save failed");
  }
  setSystemPickerStatus(`Saved export: ${response.path}`);
  closeExportDialog();
}

function modifierDragMode(metaDown, shiftDown) {
  if (metaDown) return "zoom";
  if (shiftDown) return "investigate";
  return null;
}

function setDragModeModifier(next) {
  const mode = next === "zoom" || next === "investigate" ? next : null;
  if (state.dragModeModifier === mode) return;
  state.dragModeModifier = mode;
  updateModeButtons();
}

function effectiveDragMode(ev = null) {
  const override = modifierDragMode(Boolean(ev && ev.metaKey), Boolean(ev && ev.shiftKey));
  if (override) return override;
  if (state.dragModeModifier === "zoom" || state.dragModeModifier === "investigate") {
    return state.dragModeModifier;
  }
  return state.dragMode;
}

function syncDragModeModifierFromEvent(ev) {
  setDragModeModifier(modifierDragMode(Boolean(ev && ev.metaKey), Boolean(ev && ev.shiftKey)));
}

function updateModeButtons() {
  const mode = effectiveDragMode();
  els.modeInspectBtn.classList.toggle("activeMode", mode === "investigate");
  els.modeZoomBtn.classList.toggle("activeMode", mode === "zoom");
}

function playbackAxisLength(axis) {
  const hidden = hiddenDim();
  if (axis === SAMPLE_MORPH_AXIS) {
    return isSampleMorphMode() ? axisSize("sample") : 1;
  }
  if (isAxisProjectionActive(axis)) return 1;
  if ((isVolumeMode() || isSphereMode()) && axis === hidden) return 1;
  return axisSize(axis);
}

function sampleMorphDeltaTSec() {
  return Math.max(0.01, state.sampleMorphDeltaT || 0.5);
}

function volumeFrameResolution(tileCount = 1) {
  const qCfg = volumeQualityConfig();
  const normal = tileCount > 1
    ? clamp(Math.round(volumeBaseResolution(tileCount) * qCfg.resMul), 140, 420)
    : clamp(Math.round(volumeBaseResolution(1) * qCfg.resMul), 180, 520);
  if (!state.volumeDrag) return normal;
  const min = tileCount > 1 ? 96 : 120;
  const max = tileCount > 1 ? 260 : 300;
  return clamp(Math.round(normal * 0.55), min, max);
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
    const axisLen = playbackAxisLength(axis);
    const locked = isAxisSelectorLocked(axis);
    const active = !locked && activeAxis === axis;
    btn.disabled = locked || axisLen <= 1;
    btn.textContent = active ? "Pause" : "Play";
    btn.classList.toggle("activePlay", active);
  }
}

function setNavigatorProjectionState(canvas, projected) {
  if (!canvas) return;
  canvas.classList.toggle("isProjected", Boolean(projected));
}

function updatePlayUi() {
  els.playSpeedSelect.value = String(state.playbackFps);
  if (els.sampleMorphDeltaSelect) {
    els.sampleMorphDeltaSelect.value = String(state.sampleMorphDeltaT);
  }
  updatePlaybackButtons();
  if (els.sampleMorphStatus) {
    if (!isSampleMorphMode() || !state.sampleMorph.fromCanvas || !state.sampleMorph.toCanvas) {
      els.sampleMorphStatus.textContent = "";
    } else {
      const pct = Math.round(clamp(state.sampleMorph.alpha, 0, 1) * 100);
      els.sampleMorphStatus.textContent = `S${state.sampleMorph.fromSample} -> S${state.sampleMorph.toSample} (${pct}%)`;
    }
  }
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
  els.hiddenNavValue.textContent = `${state.values[hDim]} | ${fmtPhysical(hDim, hCoord, dimUnit(hDim))}`;
}

function updateSpatialProfileTitle(profile) {
  if (profile && profile.axis) {
    els.spatialProfileTitle.textContent = `${profile.axis.toUpperCase()} Flux Profile`;
  } else {
    els.spatialProfileTitle.textContent = `${hiddenDim().toUpperCase()} Flux Profile`;
  }
}

function updateDomainVisibility() {
  const hasData = Boolean(state.dataId && state.meta);
  if (!hasData) {
    if (isPlaying()) stopPlayback();
    stopSampleMorphPlayback();
    setVisible(els.spatialControlGroup, false);
    setVisible(els.temporalControlGroup, false);
    setVisible(els.spectralControlGroup, false);
    setVisible(els.polarizationControlGroup, false);
    setVisible(els.sampleModeBlock, false);
    setVisible(els.playbackTimingControls, false);
    setVisible(els.spatialViewRow, false);
    setVisible(els.planeLabel, false);
    setVisible(els.hiddenNavPanel, false);
    setVisible(els.volumeRenderControls, false);
    setVisible(els.sphereControls, false);
    setVisible(els.timeProfileBlock, false);
    setVisible(els.spectrumProfileBlock, false);
    setVisible(els.spatialProfileBlock, false);
    if (els.metricsHint) {
      els.metricsHint.textContent = "Load a dataset to enable controls and profiles.";
    }
    updateVolumeControlReadouts();
    return;
  }

  let volumeMode = isVolumeMode();
  let sphereMode = isSphereMode();
  const sphereDataset = isSphereDataset();
  const tVarying = axisVarying("t");
  const nuVarying = axisVarying("nu");
  const sampleVarying = axisVarying("sample");
  const polVarying = axisVarying("pol");
  const hiddenAxis = hiddenDim();
  const hiddenSpatialVarying = axisVarying(hiddenAxis);
  if (sphereMode && !sphereDataset) {
    state.spatialMode = "slice";
    state.sphereDrag = null;
    sphereMode = false;
  }
  if (volumeMode && (!hiddenSpatialVarying || sphereDataset)) {
    state.spatialMode = sphereDataset ? "sphere" : "slice";
    state.volumeDrag = null;
    volumeMode = false;
    sphereMode = sphereDataset;
  }
  if (sphereDataset && state.spatialMode === "slice") {
    state.spatialMode = "sphere";
    sphereMode = true;
  }

  if (!sampleVarying && (isSamplesMode() || isSampleMorphMode())) {
    state.sampleMode = "mean";
    state.sampleGridSize = 1;
    state.sampleGridIndices = [0];
    state.activeSampleTile = 0;
    resetSampleMorphState();
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

  if (isPlaying() && (!state.playbackAxis || playbackAxisLength(state.playbackAxis) <= 1)) {
    stopPlayback();
  }
  if (volumeMode && state.playbackAxis === hiddenAxis) {
    stopPlayback();
  }
  if (sphereMode && state.playbackAxis === hiddenAxis) {
    stopPlayback();
  }
  if (!sampleVarying) {
    stopSampleMorphPlayback();
  }

  setVisible(els.spatialControlGroup, true);
  setVisible(els.spatialViewRow, !sphereDataset);
  setVisible(els.spatialSliceBtn, !sphereDataset);
  setVisible(els.spatialVolumeBtn, canUseVolumeMode());
  setVisible(els.spatialSphereBtn, sphereDataset);
  setVisible(els.temporalControlGroup, tVarying);
  setVisible(els.spectralControlGroup, nuVarying);
  setVisible(els.planeLabel, !volumeMode && !sphereMode);
  setVisible(els.hiddenNavPanel, !volumeMode && !sphereMode && hiddenSpatialVarying);
  setVisible(els.volumeRenderControls, volumeMode);
  setVisible(els.sphereControls, sphereMode);
  setVisible(els.polarizationControlGroup, polVarying);
  setVisible(els.sampleModeBlock, sampleVarying);
  setVisible(
    els.playbackTimingControls,
    tVarying || nuVarying || (!volumeMode && !sphereMode && hiddenSpatialVarying) || (sampleVarying && isSampleMorphMode())
  );

  setVisible(els.timeProfileBlock, tVarying);
  setVisible(els.spectrumProfileBlock, nuVarying);
  setVisible(els.spatialProfileBlock, !sphereMode && hiddenSpatialVarying);

  if (els.metricsHint) {
    const anyProfile = tVarying || nuVarying || hiddenSpatialVarying;
    if (sphereMode) {
      els.metricsHint.textContent =
        "Drag to rotate sphere. Shift+drag to select HEALPix region. Wheel/Zoom mode adjusts magnification.";
    } else {
      els.metricsHint.textContent = anyProfile
        ? "Click for point or drag for area."
        : "No varying temporal/spectral/spatial axis available for profiles.";
    }
  }
  updateVolumeControlReadouts();
}

function updateControlCaps() {
  ["sample", "pol", "t", "nu", "x", "y", "z"].forEach((dim) => {
    const max = Math.max(0, axisSize(dim) - 1);
    state.values[dim] = clamp(state.values[dim], 0, max);
  });

  for (const dim of ["x", "y", "z"]) {
    if (centralViewAxes().has(dim)) state.axisProjection[dim] = false;
  }

  const hDim = hiddenDim();
  const spectralSelectorLocked = isAxisSelectorLocked("nu");
  els.hiddenAxisTitle.textContent = `Unused Spatial Axis (${hDim.toUpperCase()})`;
  els.spatialSliceBtn.classList.toggle("activeSpatial", state.spatialMode === "slice");
  els.spatialVolumeBtn.classList.toggle("activeSpatial", state.spatialMode === "volume");
  if (els.spatialSphereBtn) {
    els.spatialSphereBtn.classList.toggle("activeSpatial", state.spatialMode === "sphere");
  }
  if (els.timeProjectBtn) {
    const active = isAxisProjectionActive("t");
    els.timeProjectBtn.disabled = !canProjectAxis("t");
    els.timeProjectBtn.classList.toggle("activeProject", active);
    els.timeProjectBtn.textContent = "Project";
  }
  if (els.freqProjectBtn) {
    const active = isAxisProjectionActive("nu");
    els.freqProjectBtn.disabled = spectralSelectorLocked || !canProjectAxis("nu");
    els.freqProjectBtn.classList.toggle("activeProject", active);
    els.freqProjectBtn.textContent = "Project";
  }
  if (els.hiddenProjectBtn) {
    const active = isAxisProjectionActive(hDim);
    els.hiddenProjectBtn.disabled = !canProjectAxis(hDim);
    els.hiddenProjectBtn.classList.toggle("activeProject", active);
    els.hiddenProjectBtn.textContent = "Project";
  }
  updateDomainVisibility();

  updateSampleViewOptions();
  if (isSamplesMode()) ensureGridIndices();
  els.sampleGridCountSelect.value = String(state.sampleGridSize * state.sampleGridSize);
  els.sampleModeMeanBtn.classList.toggle("activeSampleMode", state.sampleMode === "mean");
  els.sampleModeStdBtn.classList.toggle("activeSampleMode", state.sampleMode === "std");
  els.sampleModeRelBtn.classList.toggle("activeSampleMode", state.sampleMode === "rel_uncert");
  els.sampleModeSamplesBtn.classList.toggle("activeSampleMode", isSamplesMode());
  if (els.sampleViewControls) {
    els.sampleViewControls.style.display = isSamplesMode() ? "flex" : "none";
  }
  if (els.sampleViewMosaicBtn) {
    els.sampleViewMosaicBtn.classList.toggle("activeSampleMode", isSamplesMode() && !isSampleMorphMode());
  }
  if (els.sampleViewMorphBtn) {
    els.sampleViewMorphBtn.classList.toggle("activeSampleMode", isSampleMorphMode());
  }
  els.sampleMosaicControls.style.display = isSamplesMode() && !isSampleMorphMode() ? "flex" : "none";
  if (els.sampleMorphControls) {
    els.sampleMorphControls.style.display = isSamplesMode() && isSampleMorphMode() ? "flex" : "none";
  }
  updateColorRangeModeOptions();
  if (els.sliceBackendSelect) {
    els.sliceBackendSelect.value = state.sliceRender.backend;
  }
  const projection = state.sphereProjection || "mollweide";
  if (els.sphereProjMollweideBtn) {
    const active = projection === "mollweide";
    els.sphereProjMollweideBtn.classList.toggle("activeProjection", active);
    els.sphereProjMollweideBtn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (els.sphereProjInsideBtn) {
    const active = projection === "inside";
    els.sphereProjInsideBtn.classList.toggle("activeProjection", active);
    els.sphereProjInsideBtn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (els.sphereProjOutsideBtn) {
    const active = projection === "outside";
    els.sphereProjOutsideBtn.classList.toggle("activeProjection", active);
    els.sphereProjOutsideBtn.setAttribute("aria-pressed", active ? "true" : "false");
  }
  if (els.sphereMetaLabel) {
    if (isSphereDataset()) {
      const ordering = state.sphereMeta.ordering || "ring";
      const [sw, sh] = sphereCanvasSize();
      let backendMsg = "";
      const requested = state.sliceRender.backend || "auto";
      if (requested === "cpu") {
        backendMsg = "backend=CPU (requested)";
      } else if (!sphereGpuAvailableKnown()) {
        backendMsg = `backend=GPU probe (${requested.toUpperCase()})`;
      } else if (sphereGpuAvailable()) {
        backendMsg = `backend=${sphereBackendMode(sw, sh).toUpperCase()} (${requested.toUpperCase()})`;
      } else {
        backendMsg = state.sphereGpu.lastError
          ? `backend=CPU (GPU unavailable: ${state.sphereGpu.lastError})`
          : "backend=CPU (GPU unavailable)";
      }
      els.sphereMetaLabel.textContent =
        `HEALPix nside=${state.sphereMeta.nside}, npix=${state.sphereMeta.npix}, ordering=${ordering}; ${backendMsg}`;
    } else {
      els.sphereMetaLabel.textContent = "";
    }
  }
  els.planeSelect.value = state.plane;
  els.planeSelect.disabled = isVolumeMode() || isSphereMode();
  const msAvailable = canUseMultiSpectral();
  if (!msAvailable) state.multiSpectral = false;
  els.multiSpectralBtn.disabled = !msAvailable;
  els.multiSpectralBtn.textContent = state.multiSpectral ? "On" : "Off";
  els.multiSpectralBtn.classList.toggle("activeAux", state.multiSpectral);
  if (els.spectralNavPanel) {
    els.spectralNavPanel.classList.toggle("isLocked", spectralSelectorLocked);
  }
  els.fluxScaleLinearBtn.classList.toggle("activeScale", state.fluxScale === "linear");
  els.fluxScaleSqrtBtn.classList.toggle("activeScale", state.fluxScale === "sqrt");
  els.fluxScaleLogBtn.classList.toggle("activeScale", state.fluxScale === "log");
  els.resampleSamplesBtn.disabled = !isSamplesMode();

  updatePolButtonState();
  updateModeButtons();
  updateCoordSystemOptions();
  updateExportFormatAvailability();
  updateExportButtonState();
  syncSampleMorphPlayback();
  updatePlayUi();
  updateSliderReadouts(state.selectedCoords);
  updateColorNormalizationControls();
  updateSpatialProfileTitle(state.profiles ? state.profiles.spatial_profile : null);
  updateHoverReadout();
}

function setFluxScale(mode) {
  if (!["linear", "sqrt", "log"].includes(mode)) return;
  if (state.fluxScale === mode) return;
  state.fluxScale = mode;
  updateControlCaps();
  drawSelectionGraphs();
  refreshSlice();
}

function onVolumeRenderControlChange() {
  if (els.volumeRenderModeSelect) {
    const mode = els.volumeRenderModeSelect.value;
    if (["composite", "mip", "minip", "average", "isosurface", "spherical"].includes(mode)) {
      state.volumeRender.mode = mode;
    }
  }
  if (els.volumeSphereProjectionSelect) {
    const projection = els.volumeSphereProjectionSelect.value;
    if (projection === "inside" || projection === "mollweide") {
      state.volumeRender.sphereProjection = projection;
    }
  }
  if (els.volumeSphereNsiteInput) {
    const nsite = Number.parseInt(els.volumeSphereNsiteInput.value, 10);
    if (Number.isFinite(nsite)) {
      state.volumeRender.sphereNsite = clamp(Math.round(nsite), VOLUME_SPHERE_NSITE_MIN, VOLUME_SPHERE_NSITE_MAX);
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
  if (isVolumeSphericalMode()) {
    let activeBound = null;
    if (els.volumeSphereRangeMin && document.activeElement === els.volumeSphereRangeMin) activeBound = "min";
    if (els.volumeSphereRangeMax && document.activeElement === els.volumeSphereRangeMax) activeBound = "max";
    syncVolumeSphereRangeStateFromSteps(activeBound);
  } else {
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
  }
  if (els.volumeIsoThresholdRange) {
    const v = Number.parseFloat(els.volumeIsoThresholdRange.value);
    if (Number.isFinite(v)) state.volumeRender.isoThreshold = clamp(v, 0.01, 0.99);
  }
  if (state.sliceRender.backend !== "cpu") {
    ensureVolumeGpuRenderer();
  }
  updateVolumeControlReadouts();
  if (isVolumeMode()) rerenderVolumeFrame();
}

function drawEvpaOverlay(viewRect, drawRect) {
  if (isVolumeMode() || isSphereMode()) return;
  if (!state.showEvpa || state.plane !== "xy") return;
  const ctx = els.canvas.getContext("2d");
  const s = canvasPixelRatio(els.canvas);
  const tiles = state.drawTiles && state.drawTiles.length ? state.drawTiles : [drawRect];
  const hasTicks = state.evpaTicks.length > 0 || Object.keys(state.evpaTicksBySample || {}).length > 0;
  if (!hasTicks) return;

  for (let i = 0; i < tiles.length; i += 1) {
    const tileRect = tiles[i];
    ctx.save();
    ctx.beginPath();
    ctx.rect(tileRect.x, tileRect.y, tileRect.w, tileRect.h);
    ctx.clip();
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 1.2 * s;

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
  const s = canvasPixelRatio(els.canvas);

  const ctx = els.canvas.getContext("2d");
  for (const tileRect of tileRects) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(tileRect.x, tileRect.y, tileRect.w, tileRect.h);
    ctx.clip();
    ctx.strokeStyle = "#49b8ff";
    ctx.lineWidth = 2 * s;
    ctx.setLineDash([8 * s, 4 * s]);

    const p0 = dataToScreen(b.u0, b.v0, viewRect, tileRect);
    const p1 = dataToScreen(b.u1, b.v1, viewRect, tileRect);
    const x = Math.min(p0.x, p1.x);
    const y = Math.min(p0.y, p1.y);
    const w = Math.abs(p1.x - p0.x);
    const h = Math.abs(p1.y - p0.y);

    if (w <= 2 * s && h <= 2 * s) {
      ctx.beginPath();
      ctx.arc(x, y, 4 * s, 0, 2 * Math.PI);
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
  const s = canvasPixelRatio(els.canvas);
  const tileRect =
    state.drawTiles && state.drawTiles.length
      ? state.drawTiles[clamp(state.zoomDrag.tile || 0, 0, state.drawTiles.length - 1)]
      : drawRect;
  const p0 = dataToScreen(state.zoomDrag.startU, state.zoomDrag.startV, viewRect, tileRect);
  const p1 = dataToScreen(state.zoomDrag.lastU, state.zoomDrag.lastV, viewRect, tileRect);

  const ctx = els.canvas.getContext("2d");
  ctx.save();
  ctx.fillStyle = PROFILE_THEME.dragFill;
  ctx.strokeStyle = PROFILE_THEME.dragStroke;
  ctx.lineWidth = 2 * s;
  ctx.setLineDash([6 * s, 4 * s]);
  ctx.fillRect(
    Math.min(p0.x, p1.x),
    Math.min(p0.y, p1.y),
    Math.max(1, Math.abs(p1.x - p0.x)),
    Math.max(1, Math.abs(p1.y - p0.y))
  );
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
  if (isVolumeMode() || isSphereMode()) return;
  const ctx = els.canvas.getContext("2d");
  const s = canvasPixelRatio(els.canvas);
  ctx.save();
  const canvasW = els.canvas.width;
  const canvasH = els.canvas.height;
  const baseX = canvasW - 56 * s;
  const baseY = 58 * s;
  const arrow = 26 * s;

  ctx.strokeStyle = "rgba(237, 242, 247, 0.9)";
  ctx.fillStyle = "rgba(237, 242, 247, 0.9)";
  ctx.lineWidth = 1.5 * s;
  ctx.font = `${Math.round(11 * s)}px sans-serif`;

  if (state.plane === "xy") {
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX, baseY - arrow);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX - arrow, baseY);
    ctx.stroke();
    ctx.fillText("N", baseX - 3 * s, baseY - arrow - 6 * s);
    ctx.fillText("E", baseX - arrow - 16 * s, baseY + 4 * s);
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
    ctx.fillText(`+${p.planeY.toUpperCase()}`, baseX - 6 * s, baseY - arrow - 4 * s);
    ctx.fillText(`+${p.planeX.toUpperCase()}`, baseX + arrow + 2 * s, baseY + 4 * s);
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
      if (px >= 20 * s && px <= canvasW * 0.6) {
        const sx = 30 * s;
        const sy = canvasH - 26 * s;
        ctx.strokeStyle = "rgba(237, 242, 247, 0.95)";
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + px, sy);
        ctx.stroke();
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath();
        ctx.moveTo(sx, sy - 4 * s);
        ctx.lineTo(sx, sy + 4 * s);
        ctx.moveTo(sx + px, sy - 4 * s);
        ctx.lineTo(sx + px, sy + 4 * s);
        ctx.stroke();
        ctx.fillStyle = "rgba(237, 242, 247, 0.95)";
        ctx.fillText(fmtScale(dim, length, unit), sx, sy - 7 * s);
      }
    }
  }

  ctx.restore();
}

function drawFrameAndOverlays() {
  syncCanvasToDisplaySize(els.canvas);
  const ctx = els.canvas.getContext("2d");
  const s = canvasPixelRatio(els.canvas);
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
        ctx.font = `${Math.round(11 * s)}px sans-serif`;
        ctx.fillStyle = "#d9e6f5";
        ctx.textBaseline = "top";
        const lx = (tileRect.cellX ?? tileRect.x) + 8 * s;
        const ly = (tileRect.cellY ?? tileRect.y) + 7 * s;
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
  if (els.colorbarPanel) {
    const cssBarW = Math.max(1, Math.round(drawRect.w / Math.max(1, s)));
    els.colorbarPanel.style.width = `${cssBarW}px`;
  }

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

const HEALPIX_JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const HEALPIX_JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];
const SPHERE_INSIDE_SCALE = 0.2;
const SPHERE_INSIDE_SCALE_MIN = 0.05;
const SPHERE_INSIDE_SCALE_MAX = 6.0;
const SPHERE_OUTSIDE_RADIUS = 0.47;

function healpixRingPixToVector(nside, ipix) {
  const npix = 12 * nside * nside;
  const ncap = 2 * nside * (nside - 1);
  const nl2 = 2 * nside;
  const nl4 = 4 * nside;
  const ipix1 = ipix + 1;
  let z;
  let phi;

  if (ipix1 <= ncap) {
    const hip = ipix1 * 0.5;
    const fihip = Math.floor(hip);
    const iring = Math.floor(Math.sqrt(hip - Math.sqrt(fihip))) + 1;
    const iphi = ipix1 - 2 * iring * (iring - 1);
    z = 1 - (iring * iring) / (3 * nside * nside);
    phi = ((iphi - 0.5) * Math.PI) / (2 * iring);
  } else if (ipix1 <= npix - ncap) {
    const ip = ipix1 - ncap - 1;
    const iring = Math.floor(ip / nl4) + nside;
    const iphi = (ip % nl4) + 1;
    const fodd = 0.5 * (1 + ((iring + nside) & 1));
    z = (nl2 - iring) * (2 / (3 * nside));
    phi = ((iphi - fodd) * Math.PI) / nl2;
  } else {
    const ip = npix - ipix1 + 1;
    const hip = ip * 0.5;
    const fihip = Math.floor(hip);
    const iring = Math.floor(Math.sqrt(hip - Math.sqrt(fihip))) + 1;
    const iphi = 4 * iring + 1 - (ip - 2 * iring * (iring - 1));
    z = -1 + (iring * iring) / (3 * nside * nside);
    phi = ((iphi - 0.5) * Math.PI) / (2 * iring);
  }

  const st = Math.sqrt(Math.max(0, 1 - z * z));
  return [st * Math.cos(phi), st * Math.sin(phi), z];
}

function healpixNestedPixToVector(nside, ipix) {
  const npface = nside * nside;
  const face = Math.floor(ipix / npface);
  const ipf = ipix % npface;

  let ix = 0;
  let iy = 0;
  let bit = 1;
  for (let b = 0; bit < nside; b += 1) {
    ix |= ((ipf >>> (2 * b)) & 1) * bit;
    iy |= ((ipf >>> (2 * b + 1)) & 1) * bit;
    bit <<= 1;
  }

  const jr = HEALPIX_JRLL[face] * nside - ix - iy - 1;
  let nr;
  let z;
  let kshift = 0;
  if (jr < nside) {
    nr = jr;
    z = 1 - (nr * nr) / (3 * nside * nside);
  } else if (jr > 3 * nside) {
    nr = 4 * nside - jr;
    z = -1 + (nr * nr) / (3 * nside * nside);
  } else {
    nr = nside;
    z = (2 * nside - jr) * (2 / (3 * nside));
    kshift = (jr - nside) & 1;
  }

  let jp = (HEALPIX_JPLL[face] * nr + ix - iy + 1 + kshift) / 2;
  const nl4 = 4 * nr;
  while (jp > nl4) jp -= nl4;
  while (jp < 1) jp += nl4;
  const phi = ((jp - (kshift + 1) * 0.5) * Math.PI) / (2 * nr);

  const st = Math.sqrt(Math.max(0, 1 - z * z));
  return [st * Math.cos(phi), st * Math.sin(phi), z];
}

function ensureSphereVectors() {
  if (!isSphereDataset()) return null;
  const npix = state.sphereMeta.npix;
  const nside = state.sphereMeta.nside;
  const ordering = state.sphereMeta.ordering || "ring";
  const key = `${npix}:${nside}:${ordering}`;
  if (state.sphereVectorKey === key && state.sphereVectors && state.sphereVectors.length === npix * 3) {
    return state.sphereVectors;
  }

  const out = new Float32Array(npix * 3);
  for (let i = 0; i < npix; i += 1) {
    const v = ordering === "nested" ? healpixNestedPixToVector(nside, i) : healpixRingPixToVector(nside, i);
    out[i * 3 + 0] = v[0];
    out[i * 3 + 1] = v[1];
    out[i * 3 + 2] = v[2];
  }
  state.sphereVectorKey = key;
  state.sphereVectors = out;
  return out;
}

function healpixRingSizes(nside) {
  const sizes = [];
  for (let ir = 1; ir < nside; ir += 1) sizes.push(4 * ir);
  for (let ir = nside; ir <= 3 * nside; ir += 1) sizes.push(4 * nside);
  for (let ir = 3 * nside + 1; ir <= 4 * nside - 1; ir += 1) sizes.push(4 * (4 * nside - ir));
  return sizes;
}

function ensureSphereSimplexFaces() {
  if (!isSphereDataset()) return null;
  if ((state.sphereMeta.ordering || "ring") !== "ring") return null;

  const nside = state.sphereMeta.nside;
  const npix = state.sphereMeta.npix;
  const key = `${npix}:${nside}:ring`;
  if (state.sphereSimplexKey === key && Array.isArray(state.sphereSimplexFaces) && state.sphereSimplexFaces.length) {
    return state.sphereSimplexFaces;
  }

  const ringSizes = healpixRingSizes(nside);
  const rings = [];
  let start = 0;
  for (let i = 0; i < ringSizes.length; i += 1) {
    const count = ringSizes[i];
    rings.push({ start, count });
    start += count;
  }

  const faces = [];
  for (let r = 0; r < rings.length - 1; r += 1) {
    const a = rings[r];
    const b = rings[r + 1];
    const nA = a.count;
    const nB = b.count;
    let ia = 0;
    let ib = 0;

    // Stitch two latitude rings by advancing the side with the smaller next arc.
    for (let steps = 0; steps < nA + nB; steps += 1) {
      const a0 = a.start + (ia % nA);
      const a1 = a.start + ((ia + 1) % nA);
      const b0 = b.start + (ib % nB);
      const b1 = b.start + ((ib + 1) % nB);
      const tA = (ia + 1) / nA;
      const tB = (ib + 1) / nB;
      if (tA <= tB) {
        faces.push([a0, a1, b0]);
        ia += 1;
      } else {
        faces.push([a0, b0, b1]);
        ib += 1;
      }
      if (ia >= nA && ib >= nB) break;
    }
  }

  state.sphereSimplexKey = key;
  state.sphereSimplexFaces = faces;
  return faces;
}

function rotateSphereVector(x, y, z) {
  const yaw = state.sphereYaw || 0;
  const pitch = state.spherePitch || 0;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  const x1 = x * cy - y * sy;
  const y1 = x * sy + y * cy;
  const z1 = z;

  const x2 = x1 * cp + z1 * sp;
  const y2 = y1;
  const z2 = -x1 * sp + z1 * cp;
  return [x2, y2, z2];
}

function inverseSphereRotationMatrix() {
  const yaw = state.sphereYaw || 0;
  const pitch = state.spherePitch || 0;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [
    cp * cy,
    sy,
    -sp * cy,
    -cp * sy,
    cy,
    sp * sy,
    sp,
    0,
    cp,
  ];
}

function healpixVecToRingPix(nside, x, y, z) {
  const npix = 12 * nside * nside;
  const ncap = 2 * nside * (nside - 1);
  const za = Math.abs(z);
  let phi = Math.atan2(y, x);
  if (phi < 0) phi += 2 * Math.PI;
  const tt = phi / (0.5 * Math.PI);

  if (za <= 2 / 3) {
    const jp = Math.floor(nside * (0.5 + tt - 0.75 * z));
    const jm = Math.floor(nside * (0.5 + tt + 0.75 * z));
    const ir = nside + 1 + jp - jm;
    const kshift = 1 - (ir & 1);
    const nl4 = 4 * nside;
    let ip = Math.floor((jp + jm - nside + kshift + 1) * 0.5) + 1;
    ip = ((ip - 1) % nl4 + nl4) % nl4 + 1;
    return clamp(ncap + (ir - 1) * nl4 + ip - 1, 0, npix - 1);
  }

  const tp = tt - Math.floor(tt);
  const tmp = nside * Math.sqrt(Math.max(0, 3 * (1 - za)));
  const jp = Math.floor(tp * tmp);
  const jm = Math.floor((1 - tp) * tmp);
  const ir = jp + jm + 1;
  const nl4 = 4 * ir;
  let ip = Math.floor(tt * ir) + 1;
  ip = ((ip - 1) % nl4 + nl4) % nl4 + 1;
  if (z >= 0) return clamp(2 * ir * (ir - 1) + ip - 1, 0, npix - 1);
  return clamp(npix - 2 * ir * (ir + 1) + ip - 1, 0, npix - 1);
}

function ensureVolumeSphereVectors(nside) {
  const ns = clamp(Math.round(nside), VOLUME_SPHERE_NSITE_MIN, VOLUME_SPHERE_NSITE_MAX);
  const npix = 12 * ns * ns;
  const key = `${ns}:${npix}`;
  if (state.volumeSphereVectorKey === key && state.volumeSphereVectors && state.volumeSphereVectors.length === npix * 3) {
    return state.volumeSphereVectors;
  }
  const out = new Float32Array(npix * 3);
  for (let i = 0; i < npix; i += 1) {
    const v = healpixRingPixToVector(ns, i);
    out[i * 3 + 0] = v[0];
    out[i * 3 + 1] = v[1];
    out[i * 3 + 2] = v[2];
  }
  state.volumeSphereVectorKey = key;
  state.volumeSphereVectors = out;
  return out;
}

function volumeSphereCameraRayForPixel(px, py, width, height, projection) {
  if (projection === "inside") {
    const nx = (px + 0.5) / Math.max(1, width);
    const ny = (py + 0.5) / Math.max(1, height);
    const insideScale = volumeSphereInsideScale();
    const u = (nx - 0.5) / insideScale;
    const v = (0.5 - ny) / insideScale;
    const inv = 1 / Math.sqrt(1 + u * u + v * v);
    return [inv, u * inv, v * inv];
  }
  if (projection === "mollweide") {
    const xProj = (px / Math.max(1, width - 1)) * (4 * Math.SQRT2) - 2 * Math.SQRT2;
    const yProj = Math.SQRT2 - (py / Math.max(1, height - 1)) * (2 * Math.SQRT2);
    const xn = xProj / (2 * Math.SQRT2);
    const yn = yProj / Math.SQRT2;
    if (xn * xn + yn * yn > 1.0) return null;
    const theta = Math.asin(clamp(yProj / Math.SQRT2, -1, 1));
    const ct = Math.cos(theta);
    let lon = 0;
    if (Math.abs(ct) > 1.0e-8) lon = (Math.PI * xProj) / (2 * Math.SQRT2 * ct);
    lon = clamp(lon, -Math.PI, Math.PI);
    const lat = Math.asin(clamp((2 * theta + Math.sin(2 * theta)) / Math.PI, -1, 1));
    const cl = Math.cos(lat);
    return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
  }
  return null;
}

function ensureVolumeSphereRayGrid(width, height, projection) {
  const insideScale = projection === "inside" ? Math.round(volumeSphereInsideScale() * 1.0e6) / 1.0e6 : 0;
  const key = `${projection}:${width}x${height}:${insideScale}`;
  if (state.volumeSphereRayGridKey === key && state.volumeSphereRayGrid) return state.volumeSphereRayGrid;

  const pixels = [];
  const rays = [];
  for (let py = 0; py < height; py += 1) {
    const row = py * width;
    for (let px = 0; px < width; px += 1) {
      const ray = volumeSphereCameraRayForPixel(px, py, width, height, projection);
      if (!ray) continue;
      pixels.push(row + px);
      rays.push(ray[0], ray[1], ray[2]);
    }
  }
  const out = {
    pixels: Int32Array.from(pixels),
    rays: Float32Array.from(rays),
  };
  state.volumeSphereRayGridKey = key;
  state.volumeSphereRayGrid = out;
  return out;
}

function ensureSphereRingToDataLut(vectors) {
  if (!isSphereDataset()) return null;
  const ordering = state.sphereMeta.ordering || "ring";
  if (ordering !== "nested") return null;

  const npix = state.sphereMeta.npix;
  const nside = state.sphereMeta.nside;
  const key = `${npix}:${nside}:${ordering}:ring-to-data`;
  if (state.sphereRingLutKey === key && state.sphereRingLut && state.sphereRingLut.length === npix) {
    return state.sphereRingLut;
  }

  const lut = new Int32Array(npix);
  lut.fill(-1);
  for (let ipix = 0; ipix < npix; ipix += 1) {
    const x = vectors[ipix * 3 + 0];
    const y = vectors[ipix * 3 + 1];
    const z = vectors[ipix * 3 + 2];
    const ring = healpixVecToRingPix(nside, x, y, z);
    if (lut[ring] < 0) lut[ring] = ipix;
  }
  for (let i = 0; i < npix; i += 1) {
    if (lut[i] < 0) lut[i] = i;
  }
  state.sphereRingLutKey = key;
  state.sphereRingLut = lut;
  return lut;
}

function sphereCameraRayForPixel(px, py, width, height, projection) {
  if (projection === "inside") {
    const nx = px / Math.max(1, width - 1);
    const ny = py / Math.max(1, height - 1);
    const insideScale = sphereInsideRenderScale();
    const u = (nx - 0.5) / insideScale;
    const v = (0.5 - ny) / insideScale;
    const inv = 1 / Math.sqrt(1 + u * u + v * v);
    return [inv, u * inv, v * inv];
  }
  if (projection === "outside") {
    const cx = 0.5 * (width - 1);
    const cy = 0.5 * (height - 1);
    const r = SPHERE_OUTSIDE_RADIUS * Math.min(width, height);
    const y = (px - cx) / Math.max(1.0e-6, r);
    const z = (cy - py) / Math.max(1.0e-6, r);
    const rr = y * y + z * z;
    if (rr > 1.0) return null;
    const x = Math.sqrt(Math.max(0, 1 - rr));
    return [x, y, z];
  }
  if (projection === "mollweide") {
    const xProj = (px / Math.max(1, width - 1)) * (4 * Math.SQRT2) - 2 * Math.SQRT2;
    const yProj = Math.SQRT2 - (py / Math.max(1, height - 1)) * (2 * Math.SQRT2);
    const xn = xProj / (2 * Math.SQRT2);
    const yn = yProj / Math.SQRT2;
    if (xn * xn + yn * yn > 1.0) return null;
    const theta = Math.asin(clamp(yProj / Math.SQRT2, -1, 1));
    const ct = Math.cos(theta);
    let lon = 0;
    if (Math.abs(ct) > 1.0e-8) lon = (Math.PI * xProj) / (2 * Math.SQRT2 * ct);
    lon = clamp(lon, -Math.PI, Math.PI);
    const lat = Math.asin(clamp((2 * theta + Math.sin(2 * theta)) / Math.PI, -1, 1));
    const cl = Math.cos(lat);
    return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
  }
  return null;
}

function ensureSphereRayGrid(width, height, projection) {
  const insideScale = projection === "inside" ? Math.round(sphereInsideRenderScale() * 1.0e6) / 1.0e6 : SPHERE_INSIDE_SCALE;
  const key = `${projection}:${width}x${height}:${insideScale}:${SPHERE_OUTSIDE_RADIUS}`;
  if (state.sphereRayGridKey === key && state.sphereRayGrid) return state.sphereRayGrid;

  const pixels = [];
  const rays = [];
  for (let py = 0; py < height; py += 1) {
    const row = py * width;
    for (let px = 0; px < width; px += 1) {
      const cam = sphereCameraRayForPixel(px, py, width, height, projection);
      if (!cam) continue;
      pixels.push(row + px);
      rays.push(cam[0], cam[1], cam[2]);
    }
  }

  const grid = {
    pixels: Int32Array.from(pixels),
    rays: Float32Array.from(rays),
  };
  state.sphereRayGridKey = key;
  state.sphereRayGrid = grid;
  return grid;
}

function renderSphereRayMapped(img, indexMap, width, height, projection, npix, colorForPixel, vectors) {
  if (projection !== "inside" && projection !== "outside" && projection !== "mollweide") return false;
  const ordering = state.sphereMeta.ordering || "ring";
  const ringLut = ordering === "nested" ? ensureSphereRingToDataLut(vectors) : null;
  const rayGrid = ensureSphereRayGrid(width, height, projection);
  if (!rayGrid || !rayGrid.pixels || !rayGrid.rays) return false;

  const colorR = new Uint8Array(npix);
  const colorG = new Uint8Array(npix);
  const colorB = new Uint8Array(npix);
  for (let ipix = 0; ipix < npix; ipix += 1) {
    const rgb = colorForPixel(ipix);
    if (rgb) {
      colorR[ipix] = rgb[0];
      colorG[ipix] = rgb[1];
      colorB[ipix] = rgb[2];
    } else {
      // Match slice rendering behavior in log mode where invalid/negative values appear as white.
      colorR[ipix] = 255;
      colorG[ipix] = 255;
      colorB[ipix] = 255;
    }
  }

  const data = img.data;
  const nside = state.sphereMeta.nside;
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = inverseSphereRotationMatrix();
  const pixels = rayGrid.pixels;
  const rays = rayGrid.rays;
  for (let k = 0; k < pixels.length; k += 1) {
    const ri = k * 3;
    const cx = rays[ri + 0];
    const cy = rays[ri + 1];
    const cz = rays[ri + 2];
    const wx = m00 * cx + m01 * cy + m02 * cz;
    const wy = m10 * cx + m11 * cy + m12 * cz;
    const wz = m20 * cx + m21 * cy + m22 * cz;
    const ring = healpixVecToRingPix(nside, wx, wy, wz);
    const ipix = ordering === "nested" ? ringLut[ring] : ring;
    if (!Number.isFinite(ipix) || ipix < 0 || ipix >= npix) continue;

    const didx = pixels[k];
    const di = didx * 4;
    data[di + 0] = colorR[ipix];
    data[di + 1] = colorG[ipix];
    data[di + 2] = colorB[ipix];
    data[di + 3] = 255;
    indexMap[didx] = ipix;
  }
  return true;
}

function mollweideTheta(lat) {
  const clamped = clamp(lat, -Math.PI / 2, Math.PI / 2);
  if (Math.abs(Math.abs(clamped) - Math.PI / 2) < 1.0e-8) return Math.sign(clamped) * Math.PI * 0.5;
  const target = Math.PI * Math.sin(clamped);
  let theta = clamped;
  for (let i = 0; i < 8; i += 1) {
    const f = 2 * theta + Math.sin(2 * theta) - target;
    const fp = 2 + 2 * Math.cos(2 * theta);
    if (Math.abs(fp) < 1.0e-8) break;
    theta -= f / fp;
  }
  return theta;
}

function projectSphereVector(x, y, z, width, height, projection, allowOutside = false) {
  if (projection === "inside") {
    if (x <= 1.0e-5) return null;
    const u = y / x;
    const v = z / x;
    // Slight overscan (zoom-out) reduces frustum-edge artifacts at the viewport boundary.
    const scale = sphereInsideRenderScale();
    const sx = (0.5 + u * scale) * (width - 1);
    const sy = (0.5 - v * scale) * (height - 1);
    if (!allowOutside && (sx < 0 || sy < 0 || sx >= width || sy >= height)) return null;
    return { x: sx, y: sy, depth: x };
  }
  if (projection === "outside") {
    if (x <= 0) return null;
    const r = SPHERE_OUTSIDE_RADIUS * Math.min(width, height);
    const cx = 0.5 * (width - 1);
    const cy = 0.5 * (height - 1);
    const sx = cx + y * r;
    const sy = cy - z * r;
    if (!allowOutside && (sx < 0 || sy < 0 || sx >= width || sy >= height)) return null;
    return { x: sx, y: sy, depth: x };
  }

  const lon = Math.atan2(y, x);
  const lat = Math.asin(clamp(z, -1, 1));
  const theta = mollweideTheta(lat);
  const xProj = ((2 * Math.SQRT2) / Math.PI) * lon * Math.cos(theta);
  const yProj = Math.SQRT2 * Math.sin(theta);
  const sx = ((xProj + 2 * Math.SQRT2) / (4 * Math.SQRT2)) * (width - 1);
  const sy = ((Math.SQRT2 - yProj) / (2 * Math.SQRT2)) * (height - 1);
  if (!allowOutside && (sx < 0 || sy < 0 || sx >= width || sy >= height)) return null;
  return { x: sx, y: sy, depth: x };
}

function sphereCanvasSize() {
  const nside = state.sphereMeta && Number.isFinite(state.sphereMeta.nside) ? state.sphereMeta.nside : 16;
  if (state.sphereProjection === "inside") {
    const side = clamp(Math.round(nside * 64), 1024, 1792);
    return [side, side];
  }
  if (state.sphereProjection === "outside") {
    const side = clamp(Math.round(nside * 56), 896, 1536);
    return [side, side];
  }
  const width = clamp(Math.round(nside * 96), 1024, 2048);
  return [width, Math.round(width * 0.5)];
}

function sphereRenderDimensions(options = null) {
  const [outW, outH] = sphereCanvasSize();
  const previewRequested =
    options && options.spherePreview === false
      ? false
      : (options && options.spherePreview === true) || isPlaying() || isSampleMorphPlaybackActive();
  if (!previewRequested) {
    return { renderW: outW, renderH: outH, outW, outH };
  }
  const maxPixels =
    options && Number.isFinite(options.sphereMaxPixels) && options.sphereMaxPixels > 0
      ? Math.floor(options.sphereMaxPixels)
      : playbackMaxPixelsForFrame();
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) {
    return { renderW: outW, renderH: outH, outW, outH };
  }
  const fullPixels = outW * outH;
  if (fullPixels <= maxPixels) {
    return { renderW: outW, renderH: outH, outW, outH };
  }
  const scale = Math.sqrt(maxPixels / Math.max(1, fullPixels));
  const renderW = clamp(Math.round(outW * scale), 192, outW);
  const renderH = clamp(Math.round(outH * scale), 128, outH);
  return { renderW, renderH, outW, outH };
}

function upscaleSphereIndexMap(srcMap, srcW, srcH, dstW, dstH) {
  if (!(srcMap instanceof Int32Array) || srcW < 1 || srcH < 1 || dstW < 1 || dstH < 1) return null;
  if (srcW === dstW && srcH === dstH) return srcMap;
  const out = new Int32Array(dstW * dstH);
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / Math.max(1, dstH)));
    const srcRow = sy * srcW;
    const dstRow = y * dstW;
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / Math.max(1, dstW)));
      out[dstRow + x] = srcMap[srcRow + sx];
    }
  }
  return out;
}

function upscaleSphereCanvasOutput(srcCanvas, outW, outH, includeIndexMap) {
  if (!srcCanvas) return null;
  const out = upscaleCanvasNearest(srcCanvas, outW, outH);
  if (!includeIndexMap) {
    if (out) delete out.__healpixIndexMap;
    return out;
  }
  const srcMap = srcCanvas.__healpixIndexMap;
  if (srcMap instanceof Int32Array) {
    out.__healpixIndexMap = upscaleSphereIndexMap(srcMap, srcCanvas.width, srcCanvas.height, outW, outH);
  }
  return out;
}

function colorizeScalar(v, mm, maxPositive, minPositive) {
  let norm;
  if (state.fluxScale === "log") {
    norm = normalizeFluxLog(v, maxPositive, minPositive);
  } else if (state.fluxScale === "sqrt") {
    norm = normalizeFluxSqrt(v, mm);
  } else {
    norm = normalizeForColormap(v, mm);
  }
  if (norm === null) return null;
  return colorForNorm(norm);
}

function colorizeMultispectral(rv, gv, bv, stats) {
  if (state.fluxScale === "log") {
    if (rv < 0 || gv < 0 || bv < 0) return [255, 255, 255];
    const r = normalizeFluxLog(rv, stats.maxR) ?? 0;
    const g = normalizeFluxLog(gv, stats.maxG) ?? 0;
    const b = normalizeFluxLog(bv, stats.maxB) ?? 0;
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  if (state.fluxScale === "sqrt") {
    const r = Math.sqrt(clamp((rv - stats.mmR.min) / stats.spanR, 0, 1));
    const g = Math.sqrt(clamp((gv - stats.mmG.min) / stats.spanG, 0, 1));
    const b = Math.sqrt(clamp((bv - stats.mmB.min) / stats.spanB, 0, 1));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  const r = clamp((rv - stats.mmR.min) / stats.spanR, 0, 1);
  const g = clamp((gv - stats.mmG.min) / stats.spanG, 0, 1);
  const b = clamp((bv - stats.mmB.min) / stats.spanB, 0, 1);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function buildSphereProjectionMask(width, height, projection) {
  const mask = new Uint8Array(width * height);
  if (projection === "inside") {
    mask.fill(1);
    return mask;
  }

  const cx = 0.5 * (width - 1);
  const cy = 0.5 * (height - 1);
  if (projection === "outside") {
    const r = SPHERE_OUTSIDE_RADIUS * Math.min(width, height);
    const r2 = r * r;
    for (let y = 0; y < height; y += 1) {
      const dy = y - cy;
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) mask[row + x] = 1;
      }
    }
    return mask;
  }

  // Mollweide map boundary is an ellipse in projected image coordinates.
  const a = 0.5 * (width - 1);
  const b = 0.5 * (height - 1);
  const ia = 1 / Math.max(1.0e-6, a);
  const ib = 1 / Math.max(1.0e-6, b);
  for (let y = 0; y < height; y += 1) {
    const yn = (y - cy) * ib;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const xn = (x - cx) * ia;
      if (xn * xn + yn * yn <= 1.0) mask[row + x] = 1;
    }
  }
  return mask;
}

function fillSphereProjectionHoles(img, indexMap, width, height, projection) {
  const mask = buildSphereProjectionMask(width, height, projection);
  const data = img.data;
  const maxPasses = projection === "inside" ? 80 : projection === "mollweide" ? 28 : 42;
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const updates = [];
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const idx = row + x;
        if (!mask[idx]) continue;
        if (data[idx * 4 + 3] !== 0) continue;

        for (let k = 0; k < neighbors.length; k += 1) {
          const nx = x + neighbors[k][0];
          const ny = y + neighbors[k][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nidx = ny * width + nx;
          if (!mask[nidx]) continue;
          if (data[nidx * 4 + 3] === 0) continue;
          updates.push([idx, nidx]);
          break;
        }
      }
    }
    if (!updates.length) break;
    for (let i = 0; i < updates.length; i += 1) {
      const [idx, nidx] = updates[i];
      const di = idx * 4;
      const ni = nidx * 4;
      data[di + 0] = data[ni + 0];
      data[di + 1] = data[ni + 1];
      data[di + 2] = data[ni + 2];
      data[di + 3] = 255;
      indexMap[idx] = indexMap[nidx];
    }
  }
}

function propagateSphereIndexMap(indexMap, img, width, height) {
  const data = img.data;
  const total = width * height;
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < total; i += 1) {
    if (indexMap[i] >= 0 && data[i * 4 + 3] !== 0) {
      queue[tail] = i;
      tail += 1;
    }
  }
  if (!tail) return;

  const neighbors = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const src = indexMap[idx];
    const x = idx % width;
    const y = (idx - x) / width;

    for (let k = 0; k < neighbors.length; k += 1) {
      const nx = x + neighbors[k][0];
      const ny = y + neighbors[k][1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nidx = ny * width + nx;
      if (indexMap[nidx] >= 0) continue;
      if (data[nidx * 4 + 3] === 0) continue;
      indexMap[nidx] = src;
      queue[tail] = nidx;
      tail += 1;
    }
  }
}

function renderSphereSimplexMesh(img, width, height, projection, vectors, npix, colorForPixel) {
  if (projection !== "inside" && projection !== "outside") return false;
  const faces = ensureSphereSimplexFaces();
  if (!faces || !faces.length) return false;

  const px = new Float32Array(npix);
  const py = new Float32Array(npix);
  const visible = new Uint8Array(npix);
  const colors = new Uint8Array(npix * 3);
  const validColor = new Uint8Array(npix);

  for (let ipix = 0; ipix < npix; ipix += 1) {
    const rgb = colorForPixel(ipix);
    if (rgb) {
      const ci = ipix * 3;
      colors[ci + 0] = rgb[0];
      colors[ci + 1] = rgb[1];
      colors[ci + 2] = rgb[2];
      validColor[ipix] = 1;
    }
    const [rx, ry, rz] = rotateSphereVector(vectors[ipix * 3], vectors[ipix * 3 + 1], vectors[ipix * 3 + 2]);
    const p = projectSphereVector(rx, ry, rz, width, height, projection);
    if (!p) continue;
    px[ipix] = p.x;
    py[ipix] = p.y;
    visible[ipix] = 1;
  }

  if (!state.sphereMeshCanvas || state.sphereMeshCanvas.width !== width || state.sphereMeshCanvas.height !== height) {
    state.sphereMeshCanvas = document.createElement("canvas");
    state.sphereMeshCanvas.width = width;
    state.sphereMeshCanvas.height = height;
  }
  const canvas = state.sphereMeshCanvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;

  const inflate = projection === "inside" ? 1.022 : 1.016;
  const maxEdge = projection === "inside" ? 0.26 * Math.max(width, height) : 0.6 * Math.min(width, height);
  for (let i = 0; i < faces.length; i += 1) {
    const [i0, i1, i2] = faces[i];
    if (!visible[i0] || !visible[i1] || !visible[i2]) continue;
    if (!validColor[i0] || !validColor[i1] || !validColor[i2]) continue;
    const x0 = px[i0];
    const y0 = py[i0];
    const x1 = px[i1];
    const y1 = py[i1];
    const x2 = px[i2];
    const y2 = py[i2];

    const d01 = Math.hypot(x1 - x0, y1 - y0);
    const d12 = Math.hypot(x2 - x1, y2 - y1);
    const d20 = Math.hypot(x0 - x2, y0 - y2);
    if (d01 > maxEdge || d12 > maxEdge || d20 > maxEdge) continue;

    const cx = (x0 + x1 + x2) / 3;
    const cy = (y0 + y1 + y2) / 3;
    const ix0 = cx + (x0 - cx) * inflate;
    const iy0 = cy + (y0 - cy) * inflate;
    const ix1 = cx + (x1 - cx) * inflate;
    const iy1 = cy + (y1 - cy) * inflate;
    const ix2 = cx + (x2 - cx) * inflate;
    const iy2 = cy + (y2 - cy) * inflate;

    const c0 = i0 * 3;
    const c1 = i1 * 3;
    const c2 = i2 * 3;
    const r = Math.round((colors[c0 + 0] + colors[c1 + 0] + colors[c2 + 0]) / 3);
    const g = Math.round((colors[c0 + 1] + colors[c1 + 1] + colors[c2 + 1]) / 3);
    const b = Math.round((colors[c0 + 2] + colors[c1 + 2] + colors[c2 + 2]) / 3);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.moveTo(ix0, iy0);
    ctx.lineTo(ix1, iy1);
    ctx.lineTo(ix2, iy2);
    ctx.closePath();
    ctx.fill();
  }

  const meshImg = ctx.getImageData(0, 0, width, height);
  const md = meshImg.data;
  for (let i = 0; i < md.length; i += 4) {
    if (md[i + 3] > 0) md[i + 3] = 255;
  }
  img.data.set(meshImg.data);
  return true;
}

function softenSphereMesh(img, width, height) {
  const src = img.data;
  const tmp = new Uint8ClampedArray(src.length);
  tmp.set(src);
  const idx = (x, y) => (y * width + x) * 4;

  // One light blur pass suppresses visible simplex boundaries without washing out structure.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = idx(x, y);
      const a = tmp[i + 3];
      if (!a) continue;
      let wr = 0;
      let wg = 0;
      let wb = 0;
      let wsum = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        const yy = y + oy;
        if (yy < 0 || yy >= height) continue;
        for (let ox = -1; ox <= 1; ox += 1) {
          const xx = x + ox;
          if (xx < 0 || xx >= width) continue;
          const j = idx(xx, yy);
          if (!tmp[j + 3]) continue;
          const w = ox === 0 && oy === 0 ? 3 : ox === 0 || oy === 0 ? 2 : 1;
          wr += tmp[j + 0] * w;
          wg += tmp[j + 1] * w;
          wb += tmp[j + 2] * w;
          wsum += w;
        }
      }
      if (wsum > 0) {
        src[i + 0] = Math.round(wr / wsum);
        src[i + 1] = Math.round(wg / wsum);
        src[i + 2] = Math.round(wb / wsum);
        src[i + 3] = 255;
      }
    }
  }
}

function sealSphereMeshPinholes(img, width, height, passes = 2) {
  for (let pass = 0; pass < passes; pass += 1) {
    const src = img.data;
    const tmp = new Uint8ClampedArray(src.length);
    tmp.set(src);
    let changed = 0;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = (y * width + x) * 4;
        if (tmp[i + 3] !== 0) continue;
        let count = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) continue;
            const j = ((y + oy) * width + (x + ox)) * 4;
            if (tmp[j + 3] === 0) continue;
            count += 1;
            r += tmp[j + 0];
            g += tmp[j + 1];
            b += tmp[j + 2];
          }
        }
        if (count < 7) continue;
        src[i + 0] = Math.round(r / count);
        src[i + 1] = Math.round(g / count);
        src[i + 2] = Math.round(b / count);
        src[i + 3] = 255;
        changed += 1;
      }
    }
    if (!changed) break;
  }
}

function createSphereCanvasCpu(slice, rangeOverride = null, options = null) {
  if (!isSphereDataset()) return null;
  const vectors = ensureSphereVectors();
  if (!vectors) return null;
  const npix = state.sphereMeta.npix;
  const values = slice && Array.isArray(slice.values) ? slice.values : null;
  const rgbValues =
    slice &&
    slice.values &&
    Array.isArray(slice.values.r) &&
    Array.isArray(slice.values.g) &&
    Array.isArray(slice.values.b)
      ? slice.values
      : null;
  const scalarMode = Boolean(values && values.length >= npix);
  const rgbMode = Boolean(
    rgbValues && rgbValues.r.length >= npix && rgbValues.g.length >= npix && rgbValues.b.length >= npix
  );
  if (!scalarMode && !rgbMode) return null;

  const dims = sphereRenderDimensions(options);
  const width = dims.renderW;
  const height = dims.renderH;
  const includeIndexMap = options?.sphereIncludeIndexMap !== false;
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const img = els.canvas.getContext("2d").createImageData(width, height);
  const indexMap = new Int32Array(width * height);
  indexMap.fill(-1);
  const depthMap = new Float32Array(width * height);
  depthMap.fill(-1.0e30);

  const fixedStats =
    rangeOverride && isValidRangeStats(rangeOverride)
      ? rangeOverride
      : isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : null;
  let mm = null;
  let maxPositive = 0;
  let minPositive = 0;
  let rgbStats = null;
  if (scalarMode) {
    const sliceStats = isValidRangeStats(slice?.stats) ? slice.stats : null;
    const baseStats = fixedStats ? { min: fixedStats.min, max: fixedStats.max } : sliceStats ? sliceStats : minMax(values);
    mm = resolveColorNormStats(baseStats);

    if (state.fluxScale === "log") {
      minPositive = Math.max(0, mm.min);
      maxPositive = Math.max(minPositive, mm.max);
    }
  } else {
    const mmR = minMax(rgbValues.r);
    const mmG = minMax(rgbValues.g);
    const mmB = minMax(rgbValues.b);
    rgbStats = {
      mmR,
      mmG,
      mmB,
      spanR: mmR.max - mmR.min || 1,
      spanG: mmG.max - mmG.min || 1,
      spanB: mmB.max - mmB.min || 1,
      maxR: 0,
      maxG: 0,
      maxB: 0,
    };
    if (state.fluxScale === "log") {
      for (let i = 0; i < npix; i += 1) {
        const rv = rgbValues.r[i];
        const gv = rgbValues.g[i];
        const bv = rgbValues.b[i];
        if (rv > rgbStats.maxR) rgbStats.maxR = rv;
        if (gv > rgbStats.maxG) rgbStats.maxG = gv;
        if (bv > rgbStats.maxB) rgbStats.maxB = bv;
      }
    }
  }
  const pixelColor = (ipix) =>
    scalarMode
      ? colorizeScalar(values[ipix], mm, maxPositive, minPositive)
      : colorizeMultispectral(rgbValues.r[ipix], rgbValues.g[ipix], rgbValues.b[ipix], rgbStats);

  const projection = state.sphereProjection || "mollweide";
  if (renderSphereRayMapped(img, indexMap, width, height, projection, npix, pixelColor, vectors)) {
    off.getContext("2d").putImageData(img, 0, 0);
    off.__healpixIndexMap = indexMap;
    return upscaleSphereCanvasOutput(off, dims.outW, dims.outH, includeIndexMap);
  }

  const baseRadius = Math.sqrt((width * height) / Math.max(1, npix));
  const useSimplexMesh = renderSphereSimplexMesh(img, width, height, projection, vectors, npix, pixelColor);
  const useDepthBuffer = projection !== "mollweide";
  const squareSplat = !useSimplexMesh && projection === "inside";
  const splat = useSimplexMesh
    ? projection === "inside"
      ? clamp(Math.round(baseRadius * 0.24), 1, 3)
      : clamp(Math.round(baseRadius * 0.2), 1, 3)
    : projection === "inside"
    ? clamp(Math.round(baseRadius * 1.65), 7, 34)
    : projection === "mollweide"
    ? clamp(Math.round(baseRadius * 0.56), 4, 16)
    : clamp(Math.round(baseRadius * 1.05), 4, 24);
  for (let ipix = 0; ipix < npix; ipix += 1) {
    const rgb = pixelColor(ipix);
    if (!rgb) continue;
    const [rx, ry, rz] = rotateSphereVector(vectors[ipix * 3], vectors[ipix * 3 + 1], vectors[ipix * 3 + 2]);
    const p = projectSphereVector(rx, ry, rz, width, height, projection, true);
    if (!p) continue;
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    for (let oy = -splat; oy <= splat; oy += 1) {
      const yy = py + oy;
      if (yy < 0 || yy >= height) continue;
      for (let ox = -splat; ox <= splat; ox += 1) {
        if (!squareSplat && ox * ox + oy * oy > splat * splat) continue;
        const xx = px + ox;
        if (xx < 0 || xx >= width) continue;
        const didx = yy * width + xx;
        if (useDepthBuffer) {
          if (p.depth < depthMap[didx]) continue;
          depthMap[didx] = p.depth;
        }
        indexMap[didx] = ipix;
        if (!useSimplexMesh) {
          const di = didx * 4;
          img.data[di + 0] = rgb[0];
          img.data[di + 1] = rgb[1];
          img.data[di + 2] = rgb[2];
          img.data[di + 3] = 255;
        }
      }
    }
  }
  if (useSimplexMesh) {
    sealSphereMeshPinholes(img, width, height, 2);
    softenSphereMesh(img, width, height);
    propagateSphereIndexMap(indexMap, img, width, height);
  } else {
    fillSphereProjectionHoles(img, indexMap, width, height, projection);
  }

  off.getContext("2d").putImageData(img, 0, 0);
  off.__healpixIndexMap = indexMap;
  return upscaleSphereCanvasOutput(off, dims.outW, dims.outH, includeIndexMap);
}

function createSphereCanvas(slice, rangeOverride = null, options = null) {
  if (!isSphereDataset()) return null;
  const values = slice && Array.isArray(slice.values) ? slice.values : null;
  const rgbValues =
    slice &&
    slice.values &&
    Array.isArray(slice.values.r) &&
    Array.isArray(slice.values.g) &&
    Array.isArray(slice.values.b)
      ? slice.values
      : null;
  const npix = state.sphereMeta?.npix || 0;
  const scalarMode = Boolean(values && values.length >= npix);
  const rgbMode = Boolean(
    rgbValues && rgbValues.r.length >= npix && rgbValues.g.length >= npix && rgbValues.b.length >= npix
  );
  if (!npix || (!scalarMode && !rgbMode)) return null;

  const dims = sphereRenderDimensions(options);
  const width = dims.renderW;
  const height = dims.renderH;
  const includeIndexMap = !state.sphereDrag && options?.sphereIncludeIndexMap !== false;
  if (sphereBackendMode(width, height) === "gpu") {
    const renderer = ensureSphereGpuRenderer();
    if (renderer) {
      try {
        const ordering = state.sphereMeta.ordering || "ring";
        let ringLut = null;
        if (ordering === "nested") {
          const vectors = ensureSphereVectors();
          ringLut = vectors ? ensureSphereRingToDataLut(vectors) : null;
        }
        const gpu = renderer.render({
          values: scalarMode ? values : null,
          rgbValues: rgbMode ? rgbValues : null,
          npix,
          nside: state.sphereMeta.nside,
          projection: state.sphereProjection || "mollweide",
          insideScale: sphereInsideRenderScale(),
          width,
          height,
          ordering,
          ringLut,
          rangeOverride,
          stats: slice?.stats || null,
          includeIndexMap,
        });
        if (gpu) return upscaleSphereCanvasOutput(gpu, dims.outW, dims.outH, includeIndexMap);
      } catch (err) {
        state.sphereGpu.lastError = err && err.message ? err.message : "render failed";
        state.sphereGpu.available = false;
        state.sphereGpu.renderer = null;
      }
    }
  }

  const cpuOptions = options ? { ...options, sphereIncludeIndexMap: includeIndexMap } : { sphereIncludeIndexMap: includeIndexMap };
  return createSphereCanvasCpu(slice, rangeOverride, cpuOptions);
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
  const baseStats = fixedStats
    ? { min: fixedStats.min, max: fixedStats.max }
    : sliceStats
    ? { min: sliceStats.min, max: sliceStats.max }
    : minMax(values);
  const mm = resolveColorNormStats(baseStats);
  let maxPositive = 0;
  let minPositive = 0;
  if (state.fluxScale === "log") {
    minPositive = Math.max(0, mm.min);
    maxPositive = Math.max(minPositive, mm.max);
  }

  // Backend flattens as (plane_x, plane_y) in C-order: idx = x * height + y.
  // ImageData expects raster order: idx = y * width + x.
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const src = x * height + y;
      const v = values[src];
      let rgb;
      if (state.fluxScale === "log") {
        const norm = normalizeFluxLog(v, maxPositive, minPositive);
        rgb = norm === null ? [255, 255, 255] : colorForNorm(norm);
      } else if (state.fluxScale === "sqrt") {
        const norm = normalizeFluxSqrt(v, mm);
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

function createSingleCanvas(slice, rangeOverride = null, options = null) {
  if (isSphereMode()) {
    const sphereCanvas = createSphereCanvas(slice, rangeOverride, options);
    if (sphereCanvas) return sphereCanvas;
  }
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
      } else if (state.fluxScale === "sqrt") {
        r = Math.sqrt(clamp((rv - mmR.min) / spanR, 0, 1));
        g = Math.sqrt(clamp((gv - mmG.min) / spanG, 0, 1));
        b = Math.sqrt(clamp((bv - mmB.min) / spanB, 0, 1));
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
    normalizeSampleMode: sampleModeForApi,
    getProjectedDims: projectedDimsForCurrentView,
  });

const { GpuSliceRenderer, GpuVolumeRenderer, GpuSphereRenderer, GPU_VOLUME_MAX_STEPS } = createGpuRenderers({
  state,
  colorForNorm,
  isValidRangeStats,
  minMax,
  resolveColorNormStats,
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

function ensureSphereGpuRenderer() {
  if (state.sphereGpu.renderer) {
    state.sphereGpu.available = true;
    return state.sphereGpu.renderer;
  }
  if (state.sphereGpu.available === false) return null;
  try {
    const renderer = new GpuSphereRenderer();
    state.sphereGpu.renderer = renderer;
    state.sphereGpu.available = true;
    state.sphereGpu.lastError = "";
    return renderer;
  } catch (err) {
    state.sphereGpu.renderer = null;
    state.sphereGpu.available = false;
    state.sphereGpu.lastError = err && err.message ? err.message : "initialization failed";
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

function createVolumeCanvasAuto(volume, resolution = 240, rangeOverride = null) {
  const backend = volumeBackendMode();
  if (backend === "gpu") {
    const renderer = ensureVolumeGpuRenderer();
    if (renderer) {
      try {
        const gpu = renderer.render(volume, resolution, rangeOverride);
        if (gpu) return gpu;
      } catch (err) {
        state.volumeGpu.lastError = err && err.message ? err.message : "render failed";
        state.volumeGpu.available = false;
        state.volumeGpu.renderer = null;
        updateVolumeControlReadouts();
      }
    }
  }
  return createVolumeCanvasCpu(volume, resolution, rangeOverride);
}

function createVolumeCanvasCpu(volume, resolution = 240, rangeOverride = null) {
  const off = document.createElement("canvas");
  const sphericalMode = state.volumeRender.mode === "spherical";
  const sphericalProjection = sphericalMode ? volumeSphereProjectionMode() : "mollweide";
  const width = sphericalMode && sphericalProjection === "mollweide" ? resolution * 2 : resolution;
  const height = resolution;
  off.width = width;
  off.height = height;

  if (!volume || !Array.isArray(volume.shape) || volume.shape.length !== 3 || !Array.isArray(volume.values)) {
    return off;
  }

  const nx = volume.shape[0];
  const ny = volume.shape[1];
  const nz = volume.shape[2];
  const values = volume.values;
  if (nx < 2 || ny < 2 || nz < 2 || values.length !== nx * ny * nz) return off;

  const img = els.canvas.getContext("2d").createImageData(width, height);
  const fixedStats =
    rangeOverride && isValidRangeStats(rangeOverride)
      ? rangeOverride
      : isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : null;
  const baseStats = fixedStats
    ? { min: fixedStats.min, max: fixedStats.max }
    : volume.stats && Number.isFinite(volume.stats.min) && Number.isFinite(volume.stats.max) && volume.stats.max > volume.stats.min
    ? { min: volume.stats.min, max: volume.stats.max }
    : minMax(values);
  const mm = resolveColorNormStats(baseStats);
  let maxPositive = 0;
  let minPositive = 0;
  if (state.fluxScale === "log") {
    minPositive = Math.max(0, mm.min);
    maxPositive = Math.max(minPositive, mm.max);
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
  const cutoff = 0;
  const clipNear = clamp(state.volumeRender.clipNear, 0, 0.95);
  const clipFar = clamp(state.volumeRender.clipFar, clipNear + 0.01, 1.0);
  const isoThreshold = clamp(state.volumeRender.isoThreshold, 0.01, 0.99);
  const mode = state.volumeRender.mode;
  const alphaBase = clamp((2.4 / Math.max(24, steps)) * opacityGain, 0.004, 0.34);

  if (mode === "spherical") {
    const projection = sphericalProjection;
    const nside = volumeSphereNsiteValue();
    const radialNear = clamp(state.volumeRender.clipNear, 0, 1 - VOLUME_SPHERE_MIN_GAP);
    const radialFar = clamp(state.volumeRender.clipFar, radialNear + VOLUME_SPHERE_MIN_GAP, 1);
    const rayGrid = ensureVolumeSphereRayGrid(width, height, projection);
    if (!rayGrid || !rayGrid.pixels || !rayGrid.rays) return off;
    const vectors = ensureVolumeSphereVectors(nside);
    const data = img.data;
    const pixels = rayGrid.pixels;
    const rays = rayGrid.rays;

    for (let k = 0; k < pixels.length; k += 1) {
      const ri = k * 3;
      const cx = rays[ri + 0];
      const cyv = rays[ri + 1];
      const cz = rays[ri + 2];

      const x1 = cx;
      const y1 = cyv * cp + cz * sp;
      const z1 = -cyv * sp + cz * cp;

      const ox = x1 * cy - z1 * sy;
      const oy = y1;
      const oz = x1 * sy + z1 * cy;
      const ring = healpixVecToRingPix(nside, ox, oy, oz);
      const vi = ring * 3;
      const rx = vectors[vi + 0];
      const ry = vectors[vi + 1];
      const rz = vectors[vi + 2];

      const rayExit = 1 / Math.max(Math.abs(rx), Math.abs(ry), Math.abs(rz), 1.0e-6);
      let rAcc = 0;
      let gAcc = 0;
      let bAcc = 0;
      let aAcc = 0;

      for (let si = 0; si < steps; si += 1) {
        const frac = si / Math.max(1, steps - 1);
        if (frac < radialNear || frac > radialFar) continue;
        const dist = rayExit * frac;
        const sx = rx * dist;
        const syw = ry * dist;
        const sz = rz * dist;
        const fx = (sx * 0.5 + 0.5) * (nx - 1);
        const fy = (syw * 0.5 + 0.5) * (ny - 1);
        const fz = (sz * 0.5 + 0.5) * (nz - 1);
        const sample = trilinearSample(values, nx, ny, nz, fx, fy, fz);
        if (!Number.isFinite(sample)) continue;

        let norm;
        if (state.fluxScale === "log") {
          norm = normalizeFluxLog(sample, maxPositive, minPositive);
          if (norm === null) continue;
        } else if (state.fluxScale === "sqrt") {
          norm = normalizeFluxSqrt(sample, mm);
          if (norm === null) continue;
        } else {
          norm = normalizeForColormap(sample, mm);
          if (norm === null) continue;
        }
        const [r, g, b] = colorForNorm(norm);

        let density;
        if (state.colorMap === "diverging" && mm.min < 0 && mm.max > 0) {
          density = Math.abs(norm * 2 - 1);
        } else if (state.colorMap === "circular" && isDerivedPolModeActive() && state.derivedPolMode === "bfield") {
          density = 0.58;
        } else {
          density = norm;
        }

        const dn = clamp((density - cutoff) / Math.max(1.0e-6, 1 - cutoff), 0, 1);
        if (dn <= 0) continue;
        const shaped = volumeTransferShape(Math.pow(dn, gamma));
        const depthBoost = 0.9 + 0.18 * frac;
        const a = clamp(shaped * alphaBase, 0, 0.35);
        const rem = 1 - aAcc;
        rAcc += rem * a * clamp((r / 255) * depthBoost, 0, 1);
        gAcc += rem * a * clamp((g / 255) * depthBoost, 0, 1);
        bAcc += rem * a * clamp((b / 255) * depthBoost, 0, 1);
        aAcc += rem * a;
        if (aAcc >= 0.985) break;
      }

      const di = pixels[k] * 4;
      data[di + 0] = Math.round(clamp(rAcc, 0, 1) * 255);
      data[di + 1] = Math.round(clamp(gAcc, 0, 1) * 255);
      data[di + 2] = Math.round(clamp(bAcc, 0, 1) * 255);
      data[di + 3] = 255;
    }
    off.getContext("2d").putImageData(img, 0, 0);
    return off;
  }

  const ldx = 0.58;
  const ldy = 0.5;
  const ldz = 0.65;
  const llen = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz) || 1;
  const lx = ldx / llen;
  const ly = ldy / llen;
  const lz = ldz / llen;

  for (let py = 0; py < height; py += 1) {
    const v = ((py + 0.5) / height) * 2 - 1;
    for (let px = 0; px < width; px += 1) {
      const u = ((px + 0.5) / width) * 2 - 1;
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
          norm = normalizeFluxLog(sample, maxPositive, minPositive);
          if (norm === null) continue;
        } else if (state.fluxScale === "sqrt") {
          norm = normalizeFluxSqrt(sample, mm);
          if (norm === null) continue;
        } else {
          norm = normalizeForColormap(sample, mm);
          if (norm === null) continue;
        }
        const [r, g, b] = colorForNorm(norm);

        let density;
        if (state.colorMap === "diverging" && mm.min < 0 && mm.max > 0) {
          density = Math.abs(norm * 2 - 1);
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

      const di = (py * width + px) * 4;
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
  syncCanvasToDisplaySize(els.colorbarCanvas);
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
      const modeLabel = state.fixedColorRange ? COLOR_RANGE_MODE_LABEL[state.colorRangeMode] || "fixed" : "";
      const windowLabel = isColorNormWindowDefault() ? "" : "windowed";
      const fixedLabel =
        modeLabel && windowLabel ? `, ${modeLabel}, ${windowLabel}` : modeLabel ? `, ${modeLabel}` : windowLabel ? `, ${windowLabel}` : "";
      if (state.fluxScale === "log") {
        els.colorbarMin.textContent = `${fmtIntensity(Math.max(0, stats.min))} ${unit}`.trim();
        els.colorbarMid.textContent = `${state.colorMap} (log, neg=white${fixedLabel})`;
        els.colorbarMax.textContent = `${fmtIntensity(Math.max(0, stats.max))} ${unit}`.trim();
      } else if (state.fluxScale === "sqrt") {
        els.colorbarMin.textContent = `${fmtIntensity(stats.min)} ${unit}`.trim();
        els.colorbarMid.textContent = `${state.colorMap} (sqrt${fixedLabel})`;
        els.colorbarMax.textContent = `${fmtIntensity(stats.max)} ${unit}`.trim();
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
  updateColorNormalizationControls();
  layoutViewerCanvas();
  drawFrameAndOverlays();
  drawColorbar();
  updateExportButtonState();
  refreshHoverProbeFromPointer();
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
  updateColorNormalizationControls();
  layoutViewerCanvas();
  drawFrameAndOverlays();
  drawColorbar();
  updateExportButtonState();
  refreshHoverProbeFromPointer();
}

function nextSampleIndex(idx) {
  const n = sampleCount();
  if (n <= 1) return 0;
  return (idx + 1) % n;
}

function blendCanvasPair(fromCanvas, toCanvas, alpha, reuseCanvas = null) {
  if (!fromCanvas) return toCanvas;
  if (!toCanvas || alpha <= 0) return fromCanvas;
  if (alpha >= 1) return toCanvas;
  const w = fromCanvas.width;
  const h = fromCanvas.height;
  let out = reuseCanvas;
  if (!out || out.width !== w || out.height !== h) {
    out = document.createElement("canvas");
    out.width = w;
    out.height = h;
  }
  const ctx = out.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.drawImage(fromCanvas, 0, 0);
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.drawImage(toCanvas, 0, 0);
  ctx.globalAlpha = 1;
  if (fromCanvas && fromCanvas.__healpixIndexMap) {
    out.__healpixIndexMap = fromCanvas.__healpixIndexMap;
  } else {
    delete out.__healpixIndexMap;
  }
  return out;
}

function blendSampleMorphCanvas(fromCanvas, toCanvas, alpha) {
  state.sampleMorph.blendCanvas = blendCanvasPair(fromCanvas, toCanvas, alpha, state.sampleMorph.blendCanvas);
  return state.sampleMorph.blendCanvas;
}

function interpolateSelectedCoords(fromCoords, toCoords, alpha) {
  if (!fromCoords && !toCoords) return null;
  const out = {};
  const keys = new Set([...Object.keys(fromCoords || {}), ...Object.keys(toCoords || {})]);
  const a = clamp(alpha, 0, 1);
  for (const key of keys) {
    const v0 = fromCoords ? fromCoords[key] : undefined;
    const v1 = toCoords ? toCoords[key] : undefined;
    if (Number.isFinite(v0) && Number.isFinite(v1)) {
      out[key] = v0 + (v1 - v0) * a;
    } else if (v1 !== undefined) {
      out[key] = v1;
    } else if (v0 !== undefined) {
      out[key] = v0;
    }
  }
  return out;
}

function sampleMorphSelectedCoords(fromSlice, toSlice, alpha) {
  const fromCoords = fromSlice ? fromSlice.selected_coords || indicesToCoords(fromSlice.selected_indices) : null;
  const toCoords = toSlice ? toSlice.selected_coords || indicesToCoords(toSlice.selected_indices) : null;
  const out = interpolateSelectedCoords(fromCoords, toCoords, alpha) || {};
  const fromSampleCoord = Number.isFinite(fromCoords?.sample) ? fromCoords.sample : dimCoord("sample", state.sampleMorph.fromSample);
  const toSampleCoord = Number.isFinite(toCoords?.sample) ? toCoords.sample : dimCoord("sample", state.sampleMorph.toSample);
  if (Number.isFinite(fromSampleCoord) && Number.isFinite(toSampleCoord)) {
    out.sample = fromSampleCoord + (toSampleCoord - fromSampleCoord) * clamp(alpha, 0, 1);
  }
  return Object.keys(out).length ? out : null;
}

function interpolateBandWindow(fromBand, toBand, alpha) {
  const a = clamp(alpha, 0, 1);
  const fromOk = Array.isArray(fromBand) && fromBand.length >= 2 && Number.isFinite(fromBand[0]) && Number.isFinite(fromBand[1]);
  const toOk = Array.isArray(toBand) && toBand.length >= 2 && Number.isFinite(toBand[0]) && Number.isFinite(toBand[1]);
  if (fromOk && toOk) {
    return [fromBand[0] + (toBand[0] - fromBand[0]) * a, fromBand[1] + (toBand[1] - fromBand[1]) * a];
  }
  if (toOk) return [toBand[0], toBand[1]];
  if (fromOk) return [fromBand[0], fromBand[1]];
  return null;
}

function sampleMorphMultispectralBands(fromSlice, toSlice, alpha) {
  const fromBands = fromSlice?.bands || null;
  const toBands = toSlice?.bands || null;
  if (!fromBands && !toBands) return null;
  if (!fromBands) return toBands;
  if (!toBands) return fromBands;
  return {
    blue: interpolateBandWindow(fromBands.blue, toBands.blue, alpha),
    green: interpolateBandWindow(fromBands.green, toBands.green, alpha),
    red: interpolateBandWindow(fromBands.red, toBands.red, alpha),
    unit: toBands.unit || fromBands.unit || dimUnit("nu") || "Hz",
  };
}

function sampleMorphPayloadStats() {
  const payloads = [];
  if (state.sampleMorph.fromSlice) payloads.push(state.sampleMorph.fromSlice);
  else if (state.sampleMorph.fromVolume) payloads.push(state.sampleMorph.fromVolume);
  if (state.sampleMorph.toSlice) payloads.push(state.sampleMorph.toSlice);
  else if (state.sampleMorph.toVolume) payloads.push(state.sampleMorph.toVolume);
  return sharedStatsFromPayloads(payloads);
}

function sampleMorphEvpaActive() {
  return Boolean(state.showEvpa) && !isVolumeMode() && !isSphereMode() && state.plane === "xy";
}

function evpaTickKey(tick) {
  if (!tick || !Number.isFinite(tick.x) || !Number.isFinite(tick.y)) return null;
  const qx = Math.round(tick.x * 1000);
  const qy = Math.round(tick.y * 1000);
  return `${qx}:${qy}`;
}

function buildEvpaTickMap(ticks) {
  const map = new Map();
  const arr = Array.isArray(ticks) ? ticks : [];
  for (const tick of arr) {
    if (!tick || !Number.isFinite(tick.x) || !Number.isFinite(tick.y)) continue;
    if (!Number.isFinite(tick.dx) || !Number.isFinite(tick.dy)) continue;
    const key = evpaTickKey(tick);
    if (!key) continue;
    map.set(key, tick);
  }
  return map;
}

function interpolateEvpaTicks(fromTicks, toTicks, alpha) {
  const a = clamp(alpha, 0, 1);
  const fromMap = buildEvpaTickMap(fromTicks);
  const toMap = buildEvpaTickMap(toTicks);
  if (!fromMap.size && !toMap.size) return [];

  const keys = new Set([...fromMap.keys(), ...toMap.keys()]);
  const out = [];
  for (const key of keys) {
    const f = fromMap.get(key);
    const t = toMap.get(key);
    const base = f || t;
    if (!base) continue;

    let dx = 0;
    let dy = 0;
    if (f && t) {
      dx = f.dx + (t.dx - f.dx) * a;
      dy = f.dy + (t.dy - f.dy) * a;
    } else if (f) {
      // Fade vectors out when a location disappears in the target sample.
      dx = f.dx * (1 - a);
      dy = f.dy * (1 - a);
    } else {
      // Fade vectors in when a new location appears in the target sample.
      dx = t.dx * a;
      dy = t.dy * a;
    }
    if (Math.hypot(dx, dy) < 1.0e-6) continue;

    out.push({
      x: base.x,
      y: base.y,
      dx,
      dy,
    });
  }
  return out;
}

function renderSampleMorphFrame() {
  if (!isSampleMorphMode() || !state.sampleMorph.fromCanvas) return;
  const alpha = clamp(state.sampleMorph.alpha, 0, 1);
  const morphMultispectral = Boolean(state.sampleMorph.multispectral && !isVolumeMode());
  const selectedCoords = sampleMorphSelectedCoords(state.sampleMorph.fromSlice, state.sampleMorph.toSlice, alpha);
  const intensityStats = morphMultispectral
    ? null
    : isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : state.sampleMorph.sharedStats ||
        (state.sampleMorph.fromSlice ? state.sampleMorph.fromSlice.stats || null : state.sampleMorph.fromVolume?.stats || null);
  const intensityUnit = morphMultispectral ? null : isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
  const frameCanvas = blendSampleMorphCanvas(state.sampleMorph.fromCanvas, state.sampleMorph.toCanvas, alpha);

  state.values.sample = clamp(state.sampleMorph.fromSample, 0, Math.max(0, sampleCount() - 1));
  if (isVolumeMode()) {
    state.currentVolume = state.sampleMorph.fromVolume || null;
    state.currentVolumeTiles = null;
    state.currentMonoSlice = null;
    state.currentMonoSliceTiles = null;
  } else {
    state.currentMonoSlice = morphMultispectral ? null : state.sampleMorph.fromSlice || null;
    state.currentMonoSliceTiles = null;
    state.currentVolume = null;
    state.currentVolumeTiles = null;
  }
  state.currentMultispectralBands = morphMultispectral
    ? sampleMorphMultispectralBands(state.sampleMorph.fromSlice, state.sampleMorph.toSlice, alpha)
    : null;
  if (sampleMorphEvpaActive()) {
    state.evpaTicksBySample = {};
    state.evpaTicks = interpolateEvpaTicks(state.sampleMorph.fromEvpaTicks, state.sampleMorph.toEvpaTicks, alpha);
  }
  renderFrame(frameCanvas, selectedCoords, intensityStats, intensityUnit);
  updatePlayUi();
}

async function fetchSampleMorphSlice(sampleIdx, maxPixels = null, multispectral = isMultiSpectralActive()) {
  if (!isDerivedPolModeActive() && multispectral) {
    return fetchJson(`/api/datasets/${state.dataId}/multispectral?${buildMultispectralParams(sampleIdx, maxPixels).toString()}`);
  }
  if (isDerivedPolModeActive()) {
    return fetchDerivedSlice(sampleIdx, maxPixels);
  }
  return fetchJson(
    `/api/datasets/${state.dataId}/slice?${buildSliceParams(
      undefined,
      sampleIdx,
      state.values.pol,
      sampleModeForApi(),
      maxPixels
    ).toString()}`
  );
}

async function prepareSampleMorphPair(maxPixels = null, preserveAlpha = false) {
  if (!isSampleMorphMode() || !state.dataId) return;
  const n = sampleCount();
  if (n <= 1) return;
  const morphVolumeMode = isVolumeMode();
  const morphMultispectral = !morphVolumeMode && isMultiSpectralActive();

  const fromSample = clamp(state.values.sample, 0, n - 1);
  const toSample = nextSampleIndex(fromSample);
  const token = state.sampleMorph.token + 1;
  state.sampleMorph.token = token;

  let fromPayload;
  let toPayload;
  if (morphVolumeMode) {
    [fromPayload, toPayload] = await Promise.all([
      isDerivedPolModeActive() ? fetchDerivedVolume(fromSample) : fetchVolume(fromSample),
      isDerivedPolModeActive() ? fetchDerivedVolume(toSample) : fetchVolume(toSample),
    ]);
  } else {
    [fromPayload, toPayload] = await Promise.all([
      fetchSampleMorphSlice(fromSample, maxPixels, morphMultispectral),
      fetchSampleMorphSlice(toSample, maxPixels, morphMultispectral),
    ]);
  }
  if (token !== state.sampleMorph.token || !isSampleMorphMode() || isVolumeMode() !== morphVolumeMode) return;

  const sharedStats = morphMultispectral
    ? null
    : isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : morphVolumeMode && isValidRangeStats(state.sampleMorph.sharedStats)
      ? state.sampleMorph.sharedStats
      : sharedStatsFromPayloads([fromPayload, toPayload]);
  state.sampleMorph.fromSample = fromSample;
  state.sampleMorph.toSample = toSample;
  state.sampleMorph.sharedStats = sharedStats;
  state.sampleMorph.multispectral = morphMultispectral;
  if (sampleMorphEvpaActive() && !morphVolumeMode) {
    const [fromTicks, toTicks] = await Promise.all([fetchEvpaTicksForSample(fromSample), fetchEvpaTicksForSample(toSample)]);
    if (token !== state.sampleMorph.token || !isSampleMorphMode() || isVolumeMode() !== morphVolumeMode) return;
    state.sampleMorph.fromEvpaTicks = fromTicks;
    state.sampleMorph.toEvpaTicks = toTicks;
  } else {
    state.sampleMorph.fromEvpaTicks = [];
    state.sampleMorph.toEvpaTicks = [];
  }
  if (morphVolumeMode) {
    const resolution = sampleMorphVolumeResolution();
    state.sampleMorph.fromSlice = null;
    state.sampleMorph.toSlice = null;
    state.sampleMorph.fromVolume = fromPayload;
    state.sampleMorph.toVolume = toPayload;
    state.sampleMorph.fromCanvas = createVolumeCanvasAuto(fromPayload, resolution, sharedStats);
    state.sampleMorph.toCanvas = createVolumeCanvasAuto(toPayload, resolution, sharedStats);
  } else {
    state.sampleMorph.fromVolume = null;
    state.sampleMorph.toVolume = null;
    state.sampleMorph.fromSlice = fromPayload;
    state.sampleMorph.toSlice = toPayload;
    if (morphMultispectral) {
      if (isSphereMode()) {
        state.sampleMorph.fromCanvas = createSingleCanvas(fromPayload, null);
        state.sampleMorph.toCanvas = createSingleCanvas(toPayload, null);
      } else {
        state.sampleMorph.fromCanvas = createRgbCanvas(
          fromPayload.shape[0],
          fromPayload.shape[1],
          fromPayload.values.r,
          fromPayload.values.g,
          fromPayload.values.b,
          fromPayload
        );
        state.sampleMorph.toCanvas = createRgbCanvas(
          toPayload.shape[0],
          toPayload.shape[1],
          toPayload.values.r,
          toPayload.values.g,
          toPayload.values.b,
          toPayload
        );
      }
    } else {
      state.sampleMorph.fromCanvas = createSingleCanvas(fromPayload, sharedStats);
      state.sampleMorph.toCanvas = createSingleCanvas(toPayload, sharedStats);
    }
  }
  if (!preserveAlpha) state.sampleMorph.alpha = 0;
  renderSampleMorphFrame();
}

async function advanceSampleMorphPlayback(deltaSec) {
  if (!isSampleMorphMode() || sampleCount() <= 1) return;
  if (isVolumeMode() && state.volumeDrag) return;
  const lodMaxPixels = isSphereMode() ? null : playbackMaxPixelsForFrame();
  const dSec = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 1 / Math.max(1, state.playbackFps);
  const sampleDeltaT = sampleMorphDeltaTSec();
  const morphVolumeMode = isVolumeMode();
  const morphMultispectral = !morphVolumeMode && Boolean(state.sampleMorph.multispectral);

  if (!state.sampleMorph.fromCanvas || !state.sampleMorph.toCanvas) {
    await prepareSampleMorphPair(lodMaxPixels, false);
    return;
  }

  let alpha = clamp(state.sampleMorph.alpha, 0, 1) + dSec / sampleDeltaT;
  if (alpha < 1) {
    state.sampleMorph.alpha = alpha;
    renderSampleMorphFrame();
    return;
  }

  alpha -= 1;
  const fromSample = state.sampleMorph.toSample;
  const toSample = nextSampleIndex(fromSample);
  state.sampleMorph.fromSample = fromSample;
  state.values.sample = fromSample;
  state.sampleMorph.fromCanvas = state.sampleMorph.toCanvas;
  state.sampleMorph.toSample = toSample;
  state.sampleMorph.alpha = alpha;
  if (morphVolumeMode) {
    state.sampleMorph.fromVolume = state.sampleMorph.toVolume;
  } else {
    state.sampleMorph.fromSlice = state.sampleMorph.toSlice;
    state.sampleMorph.fromEvpaTicks = state.sampleMorph.toEvpaTicks;
  }

  const token = state.sampleMorph.token + 1;
  state.sampleMorph.token = token;
  try {
    let toPayload;
    let toEvpaTicks = [];
    if (morphVolumeMode) {
      toPayload = await (isDerivedPolModeActive() ? fetchDerivedVolume(toSample) : fetchVolume(toSample));
    } else {
      [toPayload, toEvpaTicks] = await Promise.all([
        fetchSampleMorphSlice(toSample, lodMaxPixels, morphMultispectral),
        sampleMorphEvpaActive() ? fetchEvpaTicksForSample(toSample) : Promise.resolve([]),
      ]);
    }
    if (token !== state.sampleMorph.token || !isSampleMorphMode() || isVolumeMode() !== morphVolumeMode) return;
    const payloads = morphVolumeMode
      ? [state.sampleMorph.fromVolume, toPayload]
      : [state.sampleMorph.fromSlice, toPayload];
    const sharedStats = morphMultispectral
      ? null
      : isValidRangeStats(state.fixedColorRange)
        ? state.fixedColorRange
        : morphVolumeMode && isValidRangeStats(state.sampleMorph.sharedStats)
        ? state.sampleMorph.sharedStats
        : sharedStatsFromPayloads(payloads);
    state.sampleMorph.sharedStats = sharedStats;
    state.sampleMorph.multispectral = morphMultispectral;
    if (morphVolumeMode) {
      const resolution = sampleMorphVolumeResolution();
      state.sampleMorph.fromSlice = null;
      state.sampleMorph.toSlice = null;
      state.sampleMorph.fromCanvas = createVolumeCanvasAuto(state.sampleMorph.fromVolume, resolution, sharedStats);
      state.sampleMorph.toVolume = toPayload;
      state.sampleMorph.toCanvas = createVolumeCanvasAuto(toPayload, resolution, sharedStats);
    } else {
      state.sampleMorph.fromVolume = null;
      state.sampleMorph.toVolume = null;
      state.sampleMorph.toSlice = toPayload;
      state.sampleMorph.toEvpaTicks = toEvpaTicks;
      if (morphMultispectral) {
        if (isSphereMode()) {
          state.sampleMorph.fromCanvas = createSingleCanvas(state.sampleMorph.fromSlice, null);
          state.sampleMorph.toCanvas = createSingleCanvas(toPayload, null);
        } else {
          state.sampleMorph.fromCanvas = createRgbCanvas(
            state.sampleMorph.fromSlice.shape[0],
            state.sampleMorph.fromSlice.shape[1],
            state.sampleMorph.fromSlice.values.r,
            state.sampleMorph.fromSlice.values.g,
            state.sampleMorph.fromSlice.values.b,
            state.sampleMorph.fromSlice
          );
          state.sampleMorph.toCanvas = createRgbCanvas(
            toPayload.shape[0],
            toPayload.shape[1],
            toPayload.values.r,
            toPayload.values.g,
            toPayload.values.b,
            toPayload
          );
        }
      } else {
        state.sampleMorph.fromCanvas = createSingleCanvas(state.sampleMorph.fromSlice, sharedStats);
        state.sampleMorph.toCanvas = createSingleCanvas(toPayload, sharedStats);
      }
    }
  } catch (err) {
    console.warn("sample morph frame fetch failed:", err);
  }

  renderSampleMorphFrame();
}

function activeIntensityRangeStats() {
  const base = activeIntensityBaseStats();
  if (!base) return null;
  return resolveColorNormStats(base);
}

function rerenderCurrentFrameForColorNormalization() {
  if (!state.dataId) {
    drawColorbar();
    return;
  }
  if (state.multiSpectral) {
    updateColorNormalizationControls();
    drawColorbar();
    return;
  }
  if (isVolumeMode() && isSampleMorphMode() && state.sampleMorph.fromCanvas && state.sampleMorph.toCanvas) {
    const sharedStats = isValidRangeStats(state.fixedColorRange) ? state.fixedColorRange : sampleMorphPayloadStats();
    state.sampleMorph.sharedStats = sharedStats;
    if (state.sampleMorph.fromVolume && state.sampleMorph.toVolume) {
      const resolution = sampleMorphVolumeResolution();
      state.sampleMorph.fromCanvas = createVolumeCanvasAuto(state.sampleMorph.fromVolume, resolution, sharedStats);
      state.sampleMorph.toCanvas = createVolumeCanvasAuto(state.sampleMorph.toVolume, resolution, sharedStats);
    }
    renderSampleMorphFrame();
    return;
  }
  if (isVolumeMode()) {
    rerenderVolumeFrame();
    return;
  }
  if (isSampleMorphMode() && state.sampleMorph.fromSlice && state.sampleMorph.toSlice) {
    const sharedStats = isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : sharedStatsFromPayloads([state.sampleMorph.fromSlice, state.sampleMorph.toSlice]);
    state.sampleMorph.sharedStats = sharedStats;
    state.sampleMorph.fromCanvas = createSingleCanvas(state.sampleMorph.fromSlice, sharedStats);
    state.sampleMorph.toCanvas = createSingleCanvas(state.sampleMorph.toSlice, sharedStats);
    renderSampleMorphFrame();
    return;
  }
  if (state.currentMonoSliceTiles && state.currentMonoSliceTiles.length) {
    const sharedStats = isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : sharedStatsFromPayloads(state.currentMonoSliceTiles);
    const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, state.currentMonoSliceTiles.length - 1));
    const primary = state.currentMonoSliceTiles[activeIdx] || state.currentMonoSliceTiles[0];
    const tiles = state.currentMonoSliceTiles.map((slice, idx) =>
      createSingleCanvas(slice, sharedStats, { sphereIncludeIndexMap: idx === activeIdx })
    );
    state.currentMonoSlice = primary || null;
    const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
    const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
    renderTileFrame(tiles, state.sampleGridSize, selectedCoords, sharedStats, intensityUnit);
    return;
  }
  if (state.currentMonoSlice) {
    const slice = state.currentMonoSlice;
    const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
    renderFrame(
      createSingleCanvas(slice),
      slice.selected_coords || indicesToCoords(slice.selected_indices),
      slice.stats || null,
      intensityUnit
    );
    return;
  }
  updateColorNormalizationControls();
  drawColorbar();
}

function scheduleColorNormRerender(commit = false) {
  if (state._colorNormRerenderTimer) {
    clearTimeout(state._colorNormRerenderTimer);
    state._colorNormRerenderTimer = null;
  }
  if (commit) {
    rerenderCurrentFrameForColorNormalization();
    return;
  }
  state._colorNormRerenderTimer = window.setTimeout(() => {
    state._colorNormRerenderTimer = null;
    rerenderCurrentFrameForColorNormalization();
  }, 48);
}

function setColorNormActiveHandle(bound = null) {
  if (!els.colorNormMinRange || !els.colorNormMaxRange) return;
  els.colorNormMinRange.classList.toggle("isActive", bound === "min");
  els.colorNormMaxRange.classList.toggle("isActive", bound === "max");
}

function onColorNormRangeInput(bound, commit = false) {
  if (!els.colorNormMinRange || !els.colorNormMaxRange) return;
  const base = activeIntensityBaseStats();
  const resolved = resolveColorNormWindow(base);
  if (!resolved) return;
  const minStep = Number.parseInt(els.colorNormMinRange.value, 10);
  const maxStep = Number.parseInt(els.colorNormMaxRange.value, 10);
  if (!Number.isFinite(minStep) || !Number.isFinite(maxStep)) return;

  const spanT = Math.max(1.0e-9, resolved.domainMaxT - resolved.domainMinT);
  const minGapT = spanT * COLOR_NORM_SLIDER_MIN_GAP;
  let lowT = resolved.domainMinT + (spanT * clamp(minStep, 0, COLOR_NORM_SLIDER_STEPS)) / COLOR_NORM_SLIDER_STEPS;
  let highT = resolved.domainMinT + (spanT * clamp(maxStep, 0, COLOR_NORM_SLIDER_STEPS)) / COLOR_NORM_SLIDER_STEPS;

  if (bound === "min") {
    lowT = Math.min(lowT, highT - minGapT);
  } else if (bound === "max") {
    highT = Math.max(highT, lowT + minGapT);
  }

  lowT = clamp(lowT, resolved.domainMinT, resolved.domainMaxT - minGapT);
  highT = clamp(highT, resolved.domainMinT + minGapT, resolved.domainMaxT);
  if (highT <= lowT) {
    highT = Math.min(resolved.domainMaxT, lowT + minGapT);
    lowT = Math.max(resolved.domainMinT, highT - minGapT);
  }

  const lowV = clamp(colorNormFromScale(lowT), resolved.domain.min, resolved.domain.max);
  const highV = clamp(colorNormFromScale(highT), resolved.domain.min, resolved.domain.max);
  state.colorNormValueWindow = { min: lowV, max: highV };
  updateColorNormalizationControls();
  scheduleColorNormRerender(commit);
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
  if (!state.dataId || !state.showEvpa || state.plane !== "xy" || isVolumeMode() || isSphereMode()) {
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
    return;
  }

  try {
    if (isSamplesMode() && state.sampleGridIndices.length > 1) {
      const samples = state.sampleGridIndices.slice();
      const tickSets = await Promise.all(samples.map((sampleIdx) => fetchEvpaTicksForSample(sampleIdx)));
      const bySample = {};
      for (let i = 0; i < samples.length; i += 1) {
        bySample[String(samples[i])] = tickSets[i];
      }
      state.evpaTicksBySample = bySample;
      const activeSample = state.sampleGridIndices[clamp(state.activeSampleTile, 0, state.sampleGridIndices.length - 1)];
      state.evpaTicks = bySample[String(activeSample)] || [];
    } else {
      state.evpaTicks = await fetchEvpaTicksForSample(state.values.sample);
      state.evpaTicksBySample = {};
    }
  } catch (err) {
    console.warn("EVPA overlay unavailable:", err);
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
  }
}

async function fetchEvpaTicksForSample(sampleIdx) {
  if (!state.dataId || state.plane !== "xy" || isVolumeMode() || isSphereMode()) return [];
  const effectiveMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : sampleModeForApi();
  const qs = new URLSearchParams({
    sample: String(sampleIdx),
    t: String(state.values.t),
    nu: String(state.values.nu),
    z: String(state.values.z),
    sample_mode: effectiveMode,
    step: String(state.evpaStep),
    min_fraction: "0.05",
    i_min_fraction: String(state.evpaIMinFraction),
  });
  const projected = projectedDimsForCurrentView();
  if (projected.length) {
    qs.set("project_dims", projected.join(","));
  }
  const data = await fetchJson(`/api/datasets/${state.dataId}/evpa?${qs.toString()}`);
  return Array.isArray(data?.ticks) ? data.ticks : [];
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
  const effectiveSampleMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : sampleModeForApi();
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

  const effectiveSampleMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : sampleModeForApi();
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

function sampleMorphVolumeResolution() {
  return volumeFrameResolution(1);
}

function rerenderVolumeFrame() {
  if (!isVolumeMode()) return;
  if (isSampleMorphMode() && state.sampleMorph.fromVolume && state.sampleMorph.toVolume) {
    const resolution = sampleMorphVolumeResolution();
    const sharedStats = isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : state.sampleMorph.sharedStats || sampleMorphPayloadStats();
    state.sampleMorph.sharedStats = sharedStats;
    state.sampleMorph.fromCanvas = createVolumeCanvasAuto(state.sampleMorph.fromVolume, resolution, sharedStats);
    state.sampleMorph.toCanvas = createVolumeCanvasAuto(state.sampleMorph.toVolume, resolution, sharedStats);
    renderSampleMorphFrame();
    return;
  }
  const unit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : state.meta ? state.meta.intensity_unit || "" : "";
  const qCfg = volumeQualityConfig();

  if (state.currentVolumeTiles && state.currentVolumeTiles.length) {
    const resolution = volumeFrameResolution(state.currentVolumeTiles.length);
    const tiles = state.currentVolumeTiles.map((v) => createVolumeCanvasAuto(v, resolution));
    const sharedStats = sharedStatsFromPayloads(state.currentVolumeTiles);
    renderTileFrame(tiles, state.sampleGridSize, null, sharedStats, unit);
    return;
  }
  if (state.currentVolume) {
    const resolution = volumeFrameResolution(1);
    renderFrame(createVolumeCanvasAuto(state.currentVolume, resolution), null, state.currentVolume.stats || null, unit);
  }
}

function rerenderSphereFrame() {
  if (!isSphereMode()) return;
  if (isSampleMorphMode() && state.sampleMorph.fromSlice && state.sampleMorph.toSlice) {
    const sharedStats = isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : sharedStatsFromPayloads([state.sampleMorph.fromSlice, state.sampleMorph.toSlice]);
    state.sampleMorph.sharedStats = sharedStats;
    state.sampleMorph.fromCanvas = createSingleCanvas(state.sampleMorph.fromSlice, sharedStats);
    state.sampleMorph.toCanvas = createSingleCanvas(state.sampleMorph.toSlice, sharedStats);
    renderSampleMorphFrame();
    return;
  }
  if (state.currentMultispectralTiles && state.currentMultispectralTiles.length) {
    const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, state.currentMultispectralTiles.length - 1));
    const tiles = state.currentMultispectralTiles.map((slice, idx) =>
      createSingleCanvas(slice, null, { sphereIncludeIndexMap: idx === activeIdx })
    );
    const primary = state.currentMultispectralTiles[activeIdx] || state.currentMultispectralTiles[0] || null;
    const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
    renderTileFrame(tiles, state.sampleGridSize, selectedCoords, null);
    return;
  }
  if (state.currentMultispectralSlice) {
    const slice = state.currentMultispectralSlice;
    renderFrame(
      createSingleCanvas(slice),
      slice.selected_coords || indicesToCoords(slice.selected_indices),
      null,
      null
    );
    return;
  }
  if (state.currentMonoSliceTiles && state.currentMonoSliceTiles.length) {
    const sharedStats = isValidRangeStats(state.fixedColorRange)
      ? state.fixedColorRange
      : sharedStatsFromPayloads(state.currentMonoSliceTiles);
    const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, state.currentMonoSliceTiles.length - 1));
    const tiles = state.currentMonoSliceTiles.map((slice, idx) =>
      createSingleCanvas(slice, sharedStats, { sphereIncludeIndexMap: idx === activeIdx })
    );
    const primary = state.currentMonoSliceTiles[activeIdx] || state.currentMonoSliceTiles[0] || null;
    const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
    const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
    renderTileFrame(tiles, state.sampleGridSize, selectedCoords, sharedStats, intensityUnit);
    return;
  }
  if (state.currentMonoSlice) {
    const slice = state.currentMonoSlice;
    const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
    renderFrame(
      createSingleCanvas(slice),
      slice.selected_coords || indicesToCoords(slice.selected_indices),
      slice.stats || null,
      intensityUnit
    );
  }
}

async function setSpatialMode(mode) {
  if (mode !== "slice" && mode !== "volume" && mode !== "sphere") return;
  if (mode === "slice" && isSphereDataset()) return;
  if (mode === "volume" && !canUseVolumeMode()) return;
  if (mode === "sphere" && !isSphereDataset()) return;
  if (state.spatialMode === mode) return;

  stopSampleMorphPlayback();
  state.spatialMode = mode;
  if (mode === "sphere") {
    state.plane = "xy";
  }
  state.fixedColorRange = null;
  state.multiSpectral = false;
  state.showEvpa = false;
  state.zoomDrag = null;
  state.selectionDrag = null;
  state.volumeDrag = null;
  state.sphereDrag = null;
  resetView();
  updateControlCaps();
  await refreshSlice();
  if (mode === "slice" && state.selection) await refreshSelectionAnalytics();
}

async function refreshSlice(options = {}) {
  if (!state.dataId) return;
  state.hoverProbe = null;
  const playbackMode = options.playback === true;
  const lodMaxPixels = playbackMode && !isSphereMode() ? playbackMaxPixelsForFrame() : null;
  if (state.sampleMode === "single") {
    if (isSampleMorphMode()) {
      state.sampleGridIndices = [clamp(state.values.sample, 0, Math.max(0, sampleCount() - 1))];
      state.activeSampleTile = 0;
    } else {
      ensureGridIndices();
      state.values.sample = state.sampleGridIndices[state.activeSampleTile];
    }
  } else {
    state.frameGrid = 1;
    if (!isSampleMorphMode()) resetSampleMorphState();
  }

  const evpaPromise = state.showEvpa && !isVolumeMode() && !isSphereMode() ? refreshEvpaTicks() : Promise.resolve();
  if (!playbackMode) {
    await refreshFixedColorRange();
  }

  if (isVolumeMode()) {
    state.currentMonoSlice = null;
    state.currentMonoSliceTiles = null;
    state.currentMultispectralBands = null;
    state.currentMultispectralSlice = null;
    state.currentMultispectralTiles = null;
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
    if (isSampleMorphMode()) {
      await evpaPromise;
      const preserveAlpha = playbackMode || Boolean(state.sampleMorph.fromCanvas && state.sampleMorph.toCanvas);
      await prepareSampleMorphPair(lodMaxPixels, preserveAlpha);
    } else if (state.sampleMode === "single") {
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

    if (!isSampleMorphMode()) {
      rerenderVolumeFrame();
    }
    await refreshViewProfiles();
    syncSampleMorphPlayback();
    updateExportButtonState();
    updateHoverReadout();
    return;
  }

  state.currentVolume = null;
  state.currentVolumeTiles = null;
  state.currentMonoSliceTiles = null;
  state.currentMultispectralSlice = null;
  state.currentMultispectralTiles = null;

  if (isSampleMorphMode()) {
    await evpaPromise;
    state.currentMultispectralBands = null;
    const preserveAlpha =
      !state.sampleMorph.initializing && (playbackMode || Boolean(state.sampleMorph.fromSlice && state.sampleMorph.toSlice));
    await prepareSampleMorphPair(lodMaxPixels, preserveAlpha);
  } else if (state.sampleMode === "single") {
    const sampleIndices = state.sampleGridIndices.slice();
    if (isMultiSpectralActive()) {
      const mosaics = await Promise.all(
        sampleIndices.map((sampleIdx) =>
          fetchJson(`/api/datasets/${state.dataId}/multispectral?${buildMultispectralParams(sampleIdx, lodMaxPixels).toString()}`)
        )
      );
      await evpaPromise;
      const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, mosaics.length - 1));
      const primary = mosaics[activeIdx] || mosaics[0];
      state.currentMonoSlice = null;
      state.currentMonoSliceTiles = null;
      state.currentMultispectralBands = primary ? primary.bands || null : null;
      state.currentMultispectralTiles = mosaics;
      state.currentMultispectralSlice = primary || null;
      const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
      const tiles = isSphereMode()
        ? mosaics.map((ms, idx) => createSingleCanvas(ms, null, { sphereIncludeIndexMap: idx === activeIdx }))
        : mosaics.map((ms) => createRgbCanvas(ms.shape[0], ms.shape[1], ms.values.r, ms.values.g, ms.values.b, ms));
      renderTileFrame(tiles, state.sampleGridSize, selectedCoords, null);
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
      state.currentMultispectralSlice = null;
      state.currentMultispectralTiles = null;
      const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, slices.length - 1));
      const primary = slices[activeIdx] || slices[0] || null;
      state.currentMonoSlice = primary;
      state.currentMonoSliceTiles = slices;

      const sharedStats = isValidRangeStats(state.fixedColorRange) ? state.fixedColorRange : sharedStatsFromPayloads(slices);
      const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
      const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
      const tiles = slices.map((s, idx) =>
        createSingleCanvas(s, sharedStats, { sphereIncludeIndexMap: idx === activeIdx })
      );
      renderTileFrame(tiles, state.sampleGridSize, selectedCoords, sharedStats, intensityUnit);
    }
  } else {
    state.currentMonoSliceTiles = null;
    if (isMultiSpectralActive()) {
      const ms = await fetchJson(`/api/datasets/${state.dataId}/multispectral?${buildMultispectralParams(undefined, lodMaxPixels).toString()}`);
      await evpaPromise;
      state.currentMonoSlice = null;
      state.currentMultispectralBands = ms.bands || null;
      state.currentMultispectralSlice = ms;
      state.currentMultispectralTiles = null;
      renderFrame(
        isSphereMode() ? createSingleCanvas(ms) : createRgbCanvas(ms.shape[0], ms.shape[1], ms.values.r, ms.values.g, ms.values.b, ms),
        ms.selected_coords || indicesToCoords(ms.selected_indices),
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
      state.currentMultispectralSlice = null;
      state.currentMultispectralTiles = null;
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
  syncSampleMorphPlayback();
  updateExportButtonState();
  updateHoverReadout();
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
    updateExportButtonState();
  }
}

function setAxisWindow(axis, start, end) {
  if (axis !== "t" && axis !== "nu") return;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1) return;
  state.axisWindow[axis] = { start, end };
  delete state.profileZoom[axis];
  updateExportButtonState();
}

function clampIndexToWindow(axis, idx) {
  const max = axisSize(axis) - 1;
  const clamped = clamp(idx, 0, max);
  const [start, end] = getAxisWindow(axis, max + 1);
  return clamp(clamped, start, end);
}

function drawNavigator(canvasEl, profile, indicatorIdx, axis) {
  const ctx = canvasEl.getContext("2d");
  const s = canvasPixelRatio(canvasEl);
  const w = canvasEl.width;
  const h = canvasEl.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b1118";
  ctx.fillRect(0, 0, w, h);

  if (!profile || !profile.series_mean || profile.series_mean.length < 2) {
    ctx.fillStyle = "#98a8ba";
    ctx.font = `${Math.round(11 * s)}px sans-serif`;
    ctx.fillText("No data", 8 * s, 16 * s);
    return;
  }

  const margin = scaleInsets(NAV_MARGIN, s);
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
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(margin.l, margin.t);
  ctx.lineTo(margin.l, margin.t + pxH);
  ctx.lineTo(margin.l + pxW, margin.t + pxH);
  ctx.stroke();

  ctx.strokeStyle = "#cfd7e3";
  ctx.lineWidth = 1.6 * s;
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
      ctx.lineWidth = 1 * s;
      ctx.beginPath();
      ctx.moveTo(x, margin.t);
      ctx.lineTo(x, margin.t + pxH);
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#8ea1b5";
  ctx.font = `${Math.round(10 * s)}px sans-serif`;
  ctx.fillText(yMax.toExponential(1), 2 * s, margin.t + 9 * s);
  ctx.fillText(yMin.toExponential(1), 2 * s, margin.t + pxH);
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
  const s = canvasPixelRatio(canvasEl);
  const margin = scaleInsets(NAV_MARGIN, s);
  const pxW = canvasEl.width - margin.l - margin.r;
  const pxH = canvasEl.height - margin.t - margin.b;
  const x0 = margin.l + xmap.toNorm(local0) * pxW;
  const x1 = margin.l + xmap.toNorm(local1) * pxW;

  const ctx = canvasEl.getContext("2d");
  ctx.save();
  ctx.fillStyle = PROFILE_THEME.dragFill;
  ctx.strokeStyle = PROFILE_THEME.dragStroke;
  ctx.lineWidth = 1.1 * s;
  ctx.setLineDash([4 * s, 3 * s]);
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
  const s = canvasPixelRatio(canvas);
  const margin = scaleInsets(PROFILE_MARGIN, s);
  const visibleCoords = profile.coords.slice(startIdx, endIdx + 1);
  const xmap = buildAxisXMapper(visibleCoords);

  const rect = canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const pxW = canvas.width - margin.l - margin.r;
  const u = clamp((cx - margin.l) / Math.max(1e-6, pxW), 0, 1);
  const local = xmap.nearestIndex(u);
  return startIdx + local;
}

function drawProfileZoomDragOverlay() {
  if (!state.profileZoomDrag) return;
  const axis = axisFromProfileKind(state.profileZoomDrag.kind);
  const profile = profileForAxis(state.profiles, axis);
  if (!profile || !profile.coords || profile.coords.length < 2) return;

  const canvas = profileCanvasForKind(state.profileZoomDrag.kind);
  const s = canvasPixelRatio(canvas);
  const margin = scaleInsets(PROFILE_MARGIN, s);
  const rect = canvas.getBoundingClientRect();
  const x0 = (state.profileZoomDrag.startClientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const x1 = (state.profileZoomDrag.currentClientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const left = clamp(Math.min(x0, x1), margin.l, canvas.width - margin.r);
  const right = clamp(Math.max(x0, x1), margin.l, canvas.width - margin.r);
  const w = Math.max(1, right - left);
  const h = canvas.height - margin.t - margin.b;

  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.fillStyle = PROFILE_THEME.dragFill;
  ctx.strokeStyle = PROFILE_THEME.dragStroke;
  ctx.lineWidth = 1.4 * s;
  ctx.setLineDash([4 * s, 3 * s]);
  ctx.fillRect(left, margin.t, w, h);
  ctx.strokeRect(left, margin.t, w, h);
  ctx.restore();
}

function drawSelectionProfile(canvasEl, profile, lineColor, indicatorIdx) {
  const ctx = canvasEl.getContext("2d");
  const scale = canvasPixelRatio(canvasEl);
  const w = canvasEl.width;
  const h = canvasEl.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0d1119";
  ctx.fillRect(0, 0, w, h);

  if (!profile || !profile.coords || profile.coords.length < 2) {
    ctx.fillStyle = "#9fb0c3";
    ctx.font = `${Math.round(13 * scale)}px Manrope, sans-serif`;
    ctx.fillText("No selected area", 10 * scale, 20 * scale);
    return;
  }

  const margin = scaleInsets(PROFILE_MARGIN, scale);
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
  ctx.lineWidth = 1 * scale;
  ctx.strokeRect(margin.l, margin.t, pxW, pxH);

  const xTickCount = Math.min(5, Math.max(3, Math.floor(pxW / (120 * scale)) + 1), n);
  const yTickCount = 5;

  ctx.strokeStyle = "rgba(130, 148, 170, 0.25)";
  ctx.lineWidth = 1 * scale;
  ctx.setLineDash([3 * scale, 3 * scale]);
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

  for (const sampleSeries of perSampleY) {
    ctx.strokeStyle = "rgba(110, 170, 220, 0.24)";
    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    for (let i = 0; i < sampleSeries.length; i += 1) {
      const x = xOf(i);
      const y = yOf(sampleSeries[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  if (std.length === mean.length && mean.length > 1) {
    ctx.fillStyle = "rgba(99, 177, 231, 0.19)";
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
  ctx.lineWidth = 2.2 * scale;
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
      ctx.strokeStyle = PROFILE_THEME.indicator;
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.moveTo(x, margin.t);
      ctx.lineTo(x, margin.t + pxH);
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#b8c9de";
  ctx.font = `${Math.round(11 * scale)}px Manrope, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let ti = 0; ti < yTickCount; ti += 1) {
    const t = ti / (yTickCount - 1);
    const value = fluxFromPlotValue(yMax - t * (yMax - yMin));
    const y = margin.t + t * pxH;
    ctx.fillText(fmtIntensity(value), margin.l - 8 * scale, y);
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
    ctx.fillText(label, clampedX, h - 33 * scale);
  }

  ctx.fillStyle = "#d3e2f4";
  ctx.font = `${Math.round(13 * scale)}px Manrope, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xLabelBase = axisUnit ? `${axisName.toUpperCase()} [${axisUnit}]` : axisName.toUpperCase();
  const xLabel = xLabelBase;
  ctx.fillText(xLabel, margin.l + pxW / 2, h - 15 * scale);

  ctx.save();
  ctx.translate(34 * scale, margin.t + pxH / 2);
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

  syncCanvasToDisplaySize(els.timeNavCanvas);
  syncCanvasToDisplaySize(els.freqNavCanvas);
  syncCanvasToDisplaySize(els.hiddenNavCanvas);

  drawNavigator(els.timeNavCanvas, tProfile, state.values.t, "t");
  drawNavigator(els.freqNavCanvas, fProfile, state.values.nu, "nu");
  drawNavigator(els.hiddenNavCanvas, hProfile, state.values[hiddenAxis], hiddenAxis);
  setNavigatorProjectionState(els.timeNavCanvas, isAxisProjectionActive("t"));
  setNavigatorProjectionState(els.freqNavCanvas, isAxisProjectionActive("nu"));
  setNavigatorProjectionState(els.hiddenNavCanvas, isAxisProjectionActive(hiddenAxis));

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

  syncCanvasToDisplaySize(els.timeProfileCanvas);
  syncCanvasToDisplaySize(els.spectrumProfileCanvas);
  syncCanvasToDisplaySize(els.spatialProfileCanvas);

  drawSelectionProfile(els.timeProfileCanvas, tProfile, PROFILE_THEME.time, state.values.t);
  drawSelectionProfile(els.spectrumProfileCanvas, fProfile, PROFILE_THEME.spectral, state.values.nu);
  drawSelectionProfile(els.spatialProfileCanvas, hProfile, PROFILE_THEME.spatial, state.values[hiddenAxis]);

  drawProfileZoomDragOverlay();
  updateSpatialProfileTitle(hProfile);
}

function activeHealpixFrameCanvas() {
  if (state.frameTiles && state.frameTiles.length) {
    const idx = clamp(state.activeSampleTile || 0, 0, state.frameTiles.length - 1);
    return state.frameTiles[idx] || null;
  }
  return state.frameCanvas || null;
}

function healpixIndicesFromBounds(bounds) {
  const canvas = activeHealpixFrameCanvas();
  const map = canvas ? canvas.__healpixIndexMap : null;
  if (!map || !canvas || !bounds) return [];

  const w = canvas.width;
  const h = canvas.height;
  const u0 = clamp(Math.floor(bounds.u0), 0, w - 1);
  const u1 = clamp(Math.ceil(bounds.u1), u0 + 1, w);
  const v0 = clamp(Math.floor(bounds.v0), 0, h - 1);
  const v1 = clamp(Math.ceil(bounds.v1), v0 + 1, h);
  const out = new Set();
  for (let y = v0; y < v1; y += 1) {
    const row = y * w;
    for (let x = u0; x < u1; x += 1) {
      const p = map[row + x];
      if (p >= 0) out.add(p);
    }
  }
  return Array.from(out);
}

function limitHealpixIndexPayload(indices, maxCount = 24000) {
  if (!Array.isArray(indices) || indices.length <= maxCount) return indices || [];
  const step = Math.ceil(indices.length / maxCount);
  const out = [];
  for (let i = 0; i < indices.length; i += step) out.push(indices[i]);
  return out;
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
    let profiles;
    if (isSphereMode()) {
      const indices = limitHealpixIndexPayload(healpixIndicesFromBounds(bounds));
      if (!indices.length) {
        state.profiles = null;
        drawSelectionGraphs();
        return;
      }
      profiles = await fetchJson(`/api/datasets/${state.dataId}/profiles-healpix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pixel_indices: indices,
          sample: state.values.sample,
          pol: state.values.pol,
          t: state.values.t,
          nu: state.values.nu,
          y: state.values.y,
          z: state.values.z,
        }),
      });
    } else {
      profiles = await fetchJson(`/api/datasets/${state.dataId}/profiles-plane`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileRequestBody(bounds)),
      });
    }
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
    let profiles;
    if (isSphereMode()) {
      let indices = healpixIndicesFromBounds(bounds);
      if (!indices.length) {
        const canvas = activeHealpixFrameCanvas();
        if (canvas) {
          indices = healpixIndicesFromBounds({ u0: 0, u1: canvas.width, v0: 0, v1: canvas.height });
        }
      }
      indices = limitHealpixIndexPayload(indices);
      if (!indices.length) {
        state.viewProfiles = null;
        drawNavigationGraphs();
        return;
      }
      profiles = await fetchJson(`/api/datasets/${state.dataId}/profiles-healpix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pixel_indices: indices,
          sample: state.values.sample,
          pol: state.values.pol,
          t: state.values.t,
          nu: state.values.nu,
          y: state.values.y,
          z: state.values.z,
        }),
      });
    } else {
      profiles = await fetchJson(`/api/datasets/${state.dataId}/profiles-plane`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profileRequestBody(bounds)),
      });
    }
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
    if (isSampleMorphPlaybackActive()) return;
    try {
      await refreshSlice();
      if (state.selection) await refreshSelectionAnalytics();
    } catch (err) {
      console.warn("playback refine failed:", err);
    }
  }, 0);
}

async function advancePlaybackAxisOnce(axis) {
  const max = axisSize(axis) - 1;
  const [w0, w1] = getAxisWindow(axis, max + 1);
  const cur = clamp(state.values[axis], w0, w1);
  const next = cur >= w1 ? w0 : cur + 1;
  await setAxisIndex(axis, next, { playback: true });
}

async function advanceAxisPlayback(axis) {
  await advancePlaybackAxisOnce(axis);
}

function stopPlayback(refine = false) {
  const wasPlaying = state.playbackTimer !== null;
  if (state.playbackTimer) {
    clearInterval(state.playbackTimer);
    state.playbackTimer = null;
  }
  state.playbackAxis = null;
  state.playbackRefineToken = (state.playbackRefineToken || 0) + 1;
  updatePlayUi();
  if (refine && wasPlaying) {
    schedulePlaybackRefine();
  }
}

function startPlayback(axis) {
  if (!axis || axis === SAMPLE_MORPH_AXIS || isAxisSelectorLocked(axis) || playbackAxisLength(axis) <= 1) return;
  stopSampleMorphPlayback();
  stopPlayback(false);
  state.playbackAxis = axis;

  const intervalMs = Math.max(30, Math.floor(1000 / Math.max(1, state.playbackFps)));
  state.playbackTimer = setInterval(async () => {
    if (state.playbackBusy) return;
    state.playbackBusy = true;

    try {
      await advanceAxisPlayback(axis);
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

function restartSampleMorphPlaybackIfRunning() {
  if (!isSampleMorphPlaybackActive()) return;
  stopSampleMorphPlayback();
  startSampleMorphPlayback();
}

function restartPlaybackTimersIfRunning() {
  restartPlaybackIfRunning();
  restartSampleMorphPlaybackIfRunning();
}

function applyZoomBox(zoomDrag) {
  const u0 = Math.min(zoomDrag.startU, zoomDrag.lastU);
  const u1 = Math.max(zoomDrag.startU, zoomDrag.lastU);
  const v0 = Math.min(zoomDrag.startV, zoomDrag.lastV);
  const v1 = Math.max(zoomDrag.startV, zoomDrag.lastV);
  const w = u1 - u0;
  const h = v1 - v0;
  if (isSphereMode() && state.sphereProjection === "inside") {
    const tile = clamp(zoomDrag.tile || 0, 0, Number.MAX_SAFE_INTEGER);
    const canvas =
      state.frameTiles && state.frameTiles.length
        ? state.frameTiles[clamp(tile, 0, state.frameTiles.length - 1)]
        : state.frameCanvas;
    if (!canvas || !(canvas.width > 0) || !(canvas.height > 0)) return;

    const cx = 0.5 * (u0 + u1);
    const cy = 0.5 * (v0 + v1);
    let zoomFactor = Math.min(w / Math.max(1.0e-6, canvas.width), h / Math.max(1.0e-6, canvas.height));
    if (!(zoomFactor > 0)) zoomFactor = 1 / 1.12;
    zoomFactor = clamp(1 / zoomFactor, 1, 16);
    state.sphereInsideScale = clamp(
      sphereInsideRenderScale() * zoomFactor,
      SPHERE_INSIDE_SCALE_MIN,
      SPHERE_INSIDE_SCALE_MAX
    );

    const probe = sphereProbeFromDataPoint({ u: cx, v: cy }, tile, null);
    if (probe && Number.isFinite(probe.vx) && Number.isFinite(probe.vy) && Number.isFinite(probe.vz)) {
      const rxy = Math.hypot(probe.vx, probe.vy);
      state.sphereYaw = Math.atan2(-probe.vy, probe.vx);
      state.spherePitch = clamp(Math.atan2(probe.vz, Math.max(1.0e-9, rxy)), -1.45, 1.45);
    }

    rerenderSphereFrame();
    updateExportButtonState();
    return;
  }

  if (w < 2 || h < 2) return;

  state.view.u = u0;
  state.view.v = v0;
  state.view.w = w;
  state.view.h = h;
  getViewRect();
  updateExportButtonState();
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
  if (isSphereMode() && state.sphereProjection === "inside") {
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    state.sphereInsideScale = clamp(
      sphereInsideRenderScale() * factor,
      SPHERE_INSIDE_SCALE_MIN,
      SPHERE_INSIDE_SCALE_MAX
    );
    rerenderSphereFrame();
    refreshViewProfiles();
    return;
  }

  const viewRect = getViewRect();
  const drawRect = state.drawRect || getDrawRect(viewRect);
  const before = screenToData(ev, viewRect, drawRect);

  const scale = ev.deltaY < 0 ? 1 / 1.12 : 1.12;
  let newW;
  let newH;
  if (isSphereMode() && state.sphereProjection === "mollweide") {
    const bounds = mollweideZoomBounds(viewRect.imgW, viewRect.imgH);
    newW = clamp(viewRect.srcW * scale, bounds.minW, bounds.maxW);
    newH = newW / bounds.aspect;
    if (newH < bounds.minH) {
      newH = bounds.minH;
      newW = newH * bounds.aspect;
    }
    if (newH > bounds.maxH) {
      newH = bounds.maxH;
      newW = newH * bounds.aspect;
    }
  } else {
    const minW = isSphereMode() && state.sphereProjection === "inside" ? viewRect.imgW : Math.min(2, viewRect.imgW);
    const minH = isSphereMode() && state.sphereProjection === "inside" ? viewRect.imgH : Math.min(2, viewRect.imgH);
    const maxZoomOut = sphereZoomOutLimit();
    const maxW = isSphereMode() ? viewRect.imgW * maxZoomOut : viewRect.imgW;
    const maxH = isSphereMode() ? viewRect.imgH * maxZoomOut : viewRect.imgH;
    newW = clamp(viewRect.srcW * scale, minW, maxW);
    newH = clamp(viewRect.srcH * scale, minH, maxH);
  }

  state.view.w = newW;
  state.view.h = newH;
  state.view.u = before.u - before.ux * newW;
  state.view.v = before.v - before.uy * newH;
  getViewRect();

  drawFrameAndOverlays();
  updateExportButtonState();
  refreshViewProfiles();
}

function navIndexFromEvent(canvas, ev, profile, axis) {
  const len = profile && profile.coords ? profile.coords.length : 0;
  if (len <= 1) return 0;
  const s = canvasPixelRatio(canvas);
  const margin = scaleInsets(NAV_MARGIN, s);
  const [startIdx, endIdx] = getAxisWindow(axis, len);
  const visibleCoords = profile.coords.slice(startIdx, endIdx + 1);
  const xmap = buildAxisXMapper(visibleCoords);
  const rect = canvas.getBoundingClientRect();
  const cx = (ev.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  const pxW = canvas.width - margin.l - margin.r;
  const u = clamp((cx - margin.l) / Math.max(1e-6, pxW), 0, 1);
  return startIdx + xmap.nearestIndex(u);
}

async function setAxisIndex(axis, idx, options = {}) {
  if (isAxisSelectorLocked(axis)) return;
  if (isAxisProjectionActive(axis)) return;
  const max = axisSize(axis) - 1;
  const next = clampIndexToWindow(axis, clamp(idx, 0, max));
  if (state.values[axis] === next) return;

  state.values[axis] = next;
  updateSliderReadouts(state.selectedCoords);

  await refreshSlice({ playback: options.playback === true });
  if (!options.playback && state.selection) await refreshSelectionAnalytics();
}

async function toggleAxisProjection(axis) {
  if (!canProjectAxis(axis)) return;
  const next = !isAxisProjected(axis);
  state.axisProjection[axis] = next;

  if (next && isPlaying() && state.playbackAxis === axis) {
    stopPlayback(false);
  }
  if (next && state.navDrag) {
    const dragAxis = axisFromNavKind(state.navDrag.kind);
    if (dragAxis === axis) state.navDrag = null;
  }
  if (next && axis === "nu" && state.multiSpectral) {
    state.multiSpectral = false;
  }

  updateControlCaps();
  drawNavigationGraphs();
  await refreshSlice();
  if (state.selection) await refreshSelectionAnalytics();
}

function axisFromNavKind(kind) {
  if (kind === "hidden") return hiddenDim();
  return kind;
}

function bindNavigationCanvas(canvas, kind) {
  const onPoint = (ev) => {
    const axis = axisFromNavKind(kind);
    if (isAxisSelectorLocked(axis)) return;
    if (isAxisProjectionActive(axis)) return;
    const profile = profileForAxis(state.viewProfiles, axis);
    if (!profile || !profile.coords || profile.coords.length <= 1) return;
    const idx = navIndexFromEvent(canvas, ev, profile, axis);
    setAxisIndex(axis, idx);
  };

  canvas.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0) return;
    const axis = axisFromNavKind(kind);
    if (isAxisSelectorLocked(axis)) return;
    if (isAxisProjectionActive(axis)) return;
    const profile = profileForAxis(state.viewProfiles, axis);
    if (!profile || !profile.coords || profile.coords.length <= 1) return;
    const idx = navIndexFromEvent(canvas, ev, profile, axis);
    if (effectiveDragMode(ev) === "zoom" && (axis === "t" || axis === "nu")) {
      state.navDrag = { kind, canvas, zoom: true, startIdx: idx, lastIdx: idx };
      drawNavigationGraphs();
      return;
    }
    state.navDrag = { kind, canvas, zoom: false };
    setAxisIndex(axis, idx);
  });

  canvas.addEventListener("click", (ev) => {
    if (effectiveDragMode(ev) === "zoom") return;
    onPoint(ev);
  });

  canvas.addEventListener("dblclick", async () => {
    const axis = axisFromNavKind(kind);
    if (isAxisSelectorLocked(axis)) return;
    if (isAxisProjectionActive(axis)) return;
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
    if (ev.button !== 0 || effectiveDragMode(ev) !== "zoom") return;
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
    if (!isSampleMorphMode()) {
      state.sampleGridSize = requestedGrid;
      state.sampleGridIndices = randomSampleIndices(state.sampleGridSize);
      state.activeSampleTile = 0;
      ensureGridIndices();
    } else {
      state.values.sample = 0;
      state.sampleGridIndices = [0];
      state.activeSampleTile = 0;
      resetSampleMorphState();
      state.sampleMorph.initializing = true;
    }
  } else {
    state.sampleGridIndices = [clamp(state.values.sample, 0, Math.max(0, sampleCount() - 1))];
    state.activeSampleTile = 0;
    resetSampleMorphState();
  }
  updateControlCaps();
  try {
    await refreshSlice();
  } finally {
    state.sampleMorph.initializing = false;
  }
  syncSampleMorphPlayback();
  if (state.selection) await refreshSelectionAnalytics();
}

async function onSamplesViewChange(view) {
  if (!isSamplesMode()) return;
  if (!["mosaic", "morph"].includes(view)) return;
  if (state.sampleSingleView === view) return;
  state.sampleSingleView = view;
  if (view === "morph") {
    state.values.sample = 0;
    state.sampleGridIndices = [0];
    state.activeSampleTile = 0;
    resetSampleMorphState();
    state.sampleMorph.initializing = true;
  } else {
    const requestedGrid = parseGridCount(els.sampleGridCountSelect.value);
    state.sampleGridSize = requestedGrid;
    state.sampleGridIndices = randomSampleIndices(state.sampleGridSize);
    state.activeSampleTile = 0;
    ensureGridIndices();
  }
  updateControlCaps();
  try {
    await refreshSlice();
  } finally {
    state.sampleMorph.initializing = false;
  }
  syncSampleMorphPlayback();
  if (state.selection) await refreshSelectionAnalytics();
}

async function onSampleGridCountChange() {
  if (!isSamplesMode() || isSampleMorphMode()) return;
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
  if (!isSamplesMode() || isSampleMorphMode()) return;
  state.sampleGridIndices = randomSampleIndices(state.sampleGridSize);
  state.activeSampleTile = 0;
  ensureGridIndices();
  await refreshSlice();
  if (state.selection) await refreshSelectionAnalytics();
}

async function onPlaneChange() {
  stopPlayback();
  stopSampleMorphPlayback();
  state.plane = els.planeSelect.value;
  resetForPlaneChange(state);
  resetSampleMorphState();
  resetView();
  updateControlCaps();
  drawSelectionGraphs();
  await refreshSlice();
}

function isDemoDatasetSummary(ds) {
  const source = String(ds?.source || "").toLowerCase();
  const dataId = String(ds?.data_id || "").toLowerCase();
  return source.includes("demo") || dataId.startsWith("demo-");
}

function isSeededDatasetSummary(ds) {
  const source = String(ds?.source || "").toLowerCase();
  return source.includes("seeded-local") || source.startsWith("seeded");
}

async function refreshDatasetOptions(preferredDataId = null) {
  const list = await fetchJson("/api/datasets");
  const visibleDatasets = Array.isArray(list.datasets) ? list.datasets.filter((ds) => !isSeededDatasetSummary(ds)) : [];
  const previous = state.dataId;
  const selected = preferredDataId || previous;
  els.datasetSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "-- Select dataset --";
  els.datasetSelect.appendChild(placeholder);

  for (const ds of visibleDatasets) {
    const opt = document.createElement("option");
    opt.value = ds.data_id;
    const isDemo = isDemoDatasetSummary(ds);
    const demoPrefix = isDemo ? "[DEMO] " : "";
    opt.textContent = `${demoPrefix}${ds.data_id} (${ds.shape.join("x")})`;
    els.datasetSelect.appendChild(opt);
  }

  if (!visibleDatasets.length) {
    state.dataId = null;
    els.datasetSelect.value = "";
    return { datasets: [] };
  }

  const ids = new Set(visibleDatasets.map((ds) => ds.data_id));
  const nextDataId = selected && ids.has(selected) ? selected : "";
  els.datasetSelect.value = nextDataId;
  return { datasets: visibleDatasets };
}

function setSystemPickerStatus(message, isError = false) {
  if (!els.systemPickerStatus) return;
  els.systemPickerStatus.textContent = message || "";
  els.systemPickerStatus.classList.toggle("error", Boolean(isError));
}

function shouldOfferAxisMapping(message) {
  if (!message) return false;
  const lowered = String(message).toLowerCase();
  return (
    lowered.includes("missing 'dims'") ||
    lowered.includes("unknown dimensions") ||
    lowered.includes("dims length") ||
    lowered.includes("dims contain duplicates") ||
    lowered.includes("dims not in canonical order")
  );
}

function parseAxisMappingInput(raw) {
  const dims = String(raw || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!dims.length) throw new Error("No axes provided.");
  const valid = new Set(["sample", "pol", "t", "nu", "x", "y", "z"]);
  const invalid = dims.filter((dim) => !valid.has(dim));
  if (invalid.length) throw new Error(`Unknown axes: ${invalid.join(", ")}`);
  if (new Set(dims).size !== dims.length) throw new Error("Duplicate axes are not allowed.");
  return dims;
}

function promptForAxisMapping() {
  const help =
    "Enter axis names in file order (comma-separated).\nAllowed: sample, pol, t, nu, x, y, z\nExample: t,nu,x,y";
  // Keep prompting until user provides a valid mapping or cancels.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const raw = window.prompt(help, "t,nu,x,y");
    if (raw === null) return null;
    try {
      return parseAxisMappingInput(raw);
    } catch (err) {
      window.alert(err.message);
    }
  }
}

function dropUploadExt(name) {
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "";
  return lower.slice(dot);
}

function updateViewerDropActive(active) {
  if (!els.viewerPanel) return;
  els.viewerPanel.classList.toggle("isDropActive", Boolean(active));
}

function resetViewerDropActive() {
  viewerDropDragDepth = 0;
  updateViewerDropActive(false);
}

function isFileDragEvent(ev) {
  const types = ev?.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}

function isValidDroppedDatasetFile(file) {
  const ext = dropUploadExt(file?.name);
  if (!ext) {
    setSystemPickerStatus("Dropped file has no extension.", true);
    return false;
  }
  if (ext === ".zarr") {
    setSystemPickerStatus("Drag-and-drop does not support .zarr folders yet. Use Load Data.", true);
    return false;
  }
  if (!SUPPORTED_DROP_UPLOAD_EXTS.has(ext)) {
    setSystemPickerStatus(`Unsupported file type: ${ext}`, true);
    return false;
  }
  return true;
}

function installDatasetDropHandlers() {
  if (!els.viewerPanel) return;

  els.viewerPanel.addEventListener("dragenter", (ev) => {
    if (!isFileDragEvent(ev)) return;
    ev.preventDefault();
    viewerDropDragDepth += 1;
    updateViewerDropActive(true);
  });

  els.viewerPanel.addEventListener("dragover", (ev) => {
    if (!isFileDragEvent(ev)) return;
    ev.preventDefault();
    updateViewerDropActive(true);
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });

  els.viewerPanel.addEventListener("dragleave", (ev) => {
    if (!isFileDragEvent(ev)) return;
    ev.preventDefault();
    viewerDropDragDepth = Math.max(0, viewerDropDragDepth - 1);
    if (viewerDropDragDepth === 0) updateViewerDropActive(false);
  });

  // Prevent default browser file-open on drop anywhere in the app window.
  window.addEventListener("dragover", (ev) => {
    if (!isFileDragEvent(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("drop", (ev) => {
    if (!isFileDragEvent(ev)) return;
    ev.preventDefault();
    resetViewerDropActive();
  });

  els.viewerPanel.addEventListener("drop", async (ev) => {
    if (!isFileDragEvent(ev)) return;
    ev.preventDefault();
    resetViewerDropActive();

    const droppedFiles = ev.dataTransfer?.files;
    if (!droppedFiles || !droppedFiles.length) {
      setSystemPickerStatus("No dataset file detected in drop.", true);
      return;
    }
    if (droppedFiles.length > 1) {
      setSystemPickerStatus("Please drop a single dataset file.", true);
      return;
    }

    const file = droppedFiles[0];
    if (!isValidDroppedDatasetFile(file)) return;
    await loadDatasetFromUpload(file);
  });
}

async function loadDatasetFromLocalPath(path, options = {}) {
  const dims = Array.isArray(options.dims) ? options.dims : null;
  const padMissingDims = Boolean(options.padMissingDims);
  if (dims && dims.length) {
    setSystemPickerStatus(`Loading dataset with manual axes: ${dims.join(", ")}`);
  } else {
    setSystemPickerStatus(`Loading dataset: ${path}`);
  }
  try {
    const body = { path };
    if (dims && dims.length) {
      body.dims = dims;
      body.pad_missing_dims = padMissingDims;
    }
    const payload = await fetchJson("/api/load-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await refreshDatasetOptions(payload.loaded);
    els.datasetSelect.value = payload.loaded;
    await onDatasetChange();
    const padded = Array.isArray(payload.padded_dims) ? payload.padded_dims : [];
    if (padded.length) {
      setSystemPickerStatus(
        `Loaded ${payload.loaded} (${payload.shape.join("x")}); padded axes: ${padded.join(", ")}`
      );
      return;
    }
    setSystemPickerStatus(`Loaded ${payload.loaded} (${payload.shape.join("x")})`);
  } catch (err) {
    if (!dims && shouldOfferAxisMapping(err.message)) {
      const mapping = promptForAxisMapping();
      if (mapping) {
        await loadDatasetFromLocalPath(path, { dims: mapping, padMissingDims: true });
        return;
      }
      setSystemPickerStatus("Load canceled (manual axis mapping not provided).", true);
      return;
    }
    setSystemPickerStatus(`Load failed: ${err.message}`, true);
  }
}

async function loadDatasetFromUpload(file, options = {}) {
  const dims = Array.isArray(options.dims) ? options.dims : null;
  const padMissingDims = Boolean(options.padMissingDims);
  if (dims && dims.length) {
    setSystemPickerStatus(`Loading dataset with manual axes: ${dims.join(", ")}`);
  } else {
    setSystemPickerStatus(`Uploading dataset: ${file.name}`);
  }
  try {
    const body = new FormData();
    body.append("file", file, file.name || "dataset");
    if (dims && dims.length) {
      body.append("dims", dims.join(","));
      body.append("pad_missing_dims", String(padMissingDims));
    }

    const payload = await fetchJson("/api/upload-local", {
      method: "POST",
      body,
    });
    await refreshDatasetOptions(payload.loaded);
    els.datasetSelect.value = payload.loaded;
    await onDatasetChange();
    const padded = Array.isArray(payload.padded_dims) ? payload.padded_dims : [];
    if (padded.length) {
      setSystemPickerStatus(
        `Loaded ${payload.loaded} (${payload.shape.join("x")}); padded axes: ${padded.join(", ")}`
      );
      return;
    }
    setSystemPickerStatus(`Loaded ${payload.loaded} (${payload.shape.join("x")})`);
  } catch (err) {
    if (!dims && shouldOfferAxisMapping(err.message)) {
      const mapping = promptForAxisMapping();
      if (mapping) {
        await loadDatasetFromUpload(file, { dims: mapping, padMissingDims: true });
        return;
      }
      setSystemPickerStatus("Load canceled (manual axis mapping not provided).", true);
      return;
    }
    setSystemPickerStatus(`Load failed: ${err.message}`, true);
  }
}

async function pickPathWithSystemDialog() {
  setSystemPickerStatus("Opening system picker...");
  try {
    const payload = await fetchJson("/api/fs/pick", {
      method: "POST",
    });
    if (payload.canceled) {
      setSystemPickerStatus("Selection canceled");
      return;
    }
    if (!payload.exists) {
      setSystemPickerStatus(`Selected path no longer exists: ${payload.path}`, true);
      return;
    }

    if (payload.loadable) {
      await loadDatasetFromLocalPath(payload.path);
      return;
    }

    setSystemPickerStatus("Selected path is not a supported dataset format", true);
  } catch (err) {
    setSystemPickerStatus(`System picker failed: ${err.message}`, true);
  }
}

async function onDatasetChange() {
  stopPlayback();
  stopSampleMorphPlayback();
  const selectedId = els.datasetSelect.value;
  if (!selectedId) {
    state.dataId = null;
    state.meta = null;
    resetForDatasetChange(state);
    resetSampleMorphState();
    resetView();
    updateControlCaps();
    drawFrameAndOverlays();
    drawNavigationGraphs();
    drawSelectionGraphs();
    drawColorbar();
    setSystemPickerStatus("No dataset loaded.");
    return;
  }

  state.dataId = selectedId;
  setSystemPickerStatus("");
  state.meta = await fetchJson(`/api/datasets/${state.dataId}/meta`);
  resetForDatasetChange(state);
  state.sphereMeta = detectSphereMeta(state.meta);
  state.sphereVectorKey = "";
  state.sphereVectors = null;
  state.sphereSimplexKey = "";
  state.sphereSimplexFaces = null;
  state.sphereMeshCanvas = null;
  state.sphereRingLutKey = "";
  state.sphereRingLut = null;
  state.sphereRayGridKey = "";
  state.sphereRayGrid = null;
  state.sphereInsideScale = SPHERE_INSIDE_SCALE;
  state.sphereYaw = 0;
  state.spherePitch = 0;
  state.sphereDrag = null;
  state.sphereProjection = "mollweide";
  if (isSphereDataset()) {
    state.plane = "xy";
    state.spatialMode = "sphere";
  } else if (state.spatialMode === "sphere") {
    state.spatialMode = "slice";
  }
  resetSampleMorphState();

  resetView();
  updateControlCaps();
  drawSelectionGraphs();
  await refreshSlice();
}

async function init() {
  await refreshDatasetOptions();

  els.canvas.width = 640;
  els.canvas.height = 640;
  els.colorbarCanvas.width = 640;
  els.colorbarCanvas.height = 26;
  initPanelResize();

  if (state.sliceRender.backend !== "cpu") {
    ensureSliceGpuRenderer();
    ensureVolumeGpuRenderer();
    ensureSphereGpuRenderer();
  }

  installDatasetDropHandlers();
  els.datasetSelect.addEventListener("change", onDatasetChange);
  els.systemPickerBtn.addEventListener("click", () => pickPathWithSystemDialog());

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
  if (els.colorNormMinRange && els.colorNormMaxRange) {
    els.colorNormMinRange.addEventListener("pointerdown", () => setColorNormActiveHandle("min"));
    els.colorNormMaxRange.addEventListener("pointerdown", () => setColorNormActiveHandle("max"));
    els.colorNormMinRange.addEventListener("focus", () => setColorNormActiveHandle("min"));
    els.colorNormMaxRange.addEventListener("focus", () => setColorNormActiveHandle("max"));
    els.colorNormMinRange.addEventListener("input", () => onColorNormRangeInput("min", false));
    els.colorNormMaxRange.addEventListener("input", () => onColorNormRangeInput("max", false));
    els.colorNormMinRange.addEventListener("change", () => onColorNormRangeInput("min", true));
    els.colorNormMaxRange.addEventListener("change", () => onColorNormRangeInput("max", true));
    els.colorNormMinRange.addEventListener("blur", () => setColorNormActiveHandle(null));
    els.colorNormMaxRange.addEventListener("blur", () => setColorNormActiveHandle(null));
  }

  els.sliceBackendSelect.addEventListener("change", async () => {
    const backend = els.sliceBackendSelect.value;
    if (!["auto", "gpu", "cpu"].includes(backend)) return;
    state.sliceRender.backend = backend;
    if (backend !== "cpu") {
      ensureSliceGpuRenderer();
      ensureVolumeGpuRenderer();
      ensureSphereGpuRenderer();
    }
    updateControlCaps();
    await refreshSlice();
    if (state.selection) await refreshSelectionAnalytics();
  });

  els.fluxScaleLinearBtn.addEventListener("click", () => setFluxScale("linear"));
  els.fluxScaleSqrtBtn.addEventListener("click", () => setFluxScale("sqrt"));
  els.fluxScaleLogBtn.addEventListener("click", () => setFluxScale("log"));

  els.sampleModeMeanBtn.addEventListener("click", () => onSampleModeChange("mean"));
  els.sampleModeStdBtn.addEventListener("click", () => onSampleModeChange("std"));
  els.sampleModeRelBtn.addEventListener("click", () => onSampleModeChange("rel_uncert"));
  els.sampleModeSamplesBtn.addEventListener("click", () => onSampleModeChange("single"));
  if (els.sampleViewMosaicBtn) {
    els.sampleViewMosaicBtn.addEventListener("click", () => onSamplesViewChange("mosaic"));
  }
  if (els.sampleViewMorphBtn) {
    els.sampleViewMorphBtn.addEventListener("click", () => onSamplesViewChange("morph"));
  }
  els.sampleGridCountSelect.addEventListener("change", onSampleGridCountChange);
  els.resampleSamplesBtn.addEventListener("click", onResampleSamples);
  if (els.sampleMorphDeltaSelect) {
    els.sampleMorphDeltaSelect.addEventListener("change", () => {
      const dt = Number.parseFloat(els.sampleMorphDeltaSelect.value);
      if (Number.isFinite(dt) && dt > 0) {
        state.sampleMorphDeltaT = dt;
        updatePlayUi();
      }
    });
  }

  els.planeSelect.addEventListener("change", onPlaneChange);
  els.spatialSliceBtn.addEventListener("click", () => setSpatialMode("slice"));
  els.spatialVolumeBtn.addEventListener("click", () => setSpatialMode("volume"));
  if (els.spatialSphereBtn) {
    els.spatialSphereBtn.addEventListener("click", () => setSpatialMode("sphere"));
  }
  if (els.sphereProjMollweideBtn) {
    els.sphereProjMollweideBtn.addEventListener("click", () => setSphereProjection("mollweide"));
  }
  if (els.sphereProjInsideBtn) {
    els.sphereProjInsideBtn.addEventListener("click", () => setSphereProjection("inside"));
  }
  if (els.sphereProjOutsideBtn) {
    els.sphereProjOutsideBtn.addEventListener("click", () => setSphereProjection("outside"));
  }
  els.volumeQualitySelect.addEventListener("change", onVolumeRenderControlChange);
  els.volumeRenderModeSelect.addEventListener("change", onVolumeRenderControlChange);
  if (els.volumeSphereProjectionSelect) {
    els.volumeSphereProjectionSelect.addEventListener("change", onVolumeRenderControlChange);
  }
  if (els.volumeSphereNsiteInput) {
    els.volumeSphereNsiteInput.addEventListener("input", onVolumeRenderControlChange);
    els.volumeSphereNsiteInput.addEventListener("change", onVolumeRenderControlChange);
  }
  if (els.volumeSphereRangeMin && els.volumeSphereRangeMax) {
    els.volumeSphereRangeMin.addEventListener("pointerdown", () => setVolumeSphereRangeActiveHandle("min"));
    els.volumeSphereRangeMax.addEventListener("pointerdown", () => setVolumeSphereRangeActiveHandle("max"));
    els.volumeSphereRangeMin.addEventListener("focus", () => setVolumeSphereRangeActiveHandle("min"));
    els.volumeSphereRangeMax.addEventListener("focus", () => setVolumeSphereRangeActiveHandle("max"));
    els.volumeSphereRangeMin.addEventListener("input", onVolumeRenderControlChange);
    els.volumeSphereRangeMax.addEventListener("input", onVolumeRenderControlChange);
    els.volumeSphereRangeMin.addEventListener("change", onVolumeRenderControlChange);
    els.volumeSphereRangeMax.addEventListener("change", onVolumeRenderControlChange);
    els.volumeSphereRangeMin.addEventListener("blur", () => setVolumeSphereRangeActiveHandle(null));
    els.volumeSphereRangeMax.addEventListener("blur", () => setVolumeSphereRangeActiveHandle(null));
  }
  els.volumeTfSelect.addEventListener("change", onVolumeRenderControlChange);
  els.volumeOpacityRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeGammaRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeClipNearRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeClipFarRange.addEventListener("input", onVolumeRenderControlChange);
  els.volumeIsoThresholdRange.addEventListener("input", onVolumeRenderControlChange);

  els.multiSpectralBtn.addEventListener("click", async () => {
    if (els.multiSpectralBtn.disabled) return;
    state.multiSpectral = !state.multiSpectral;
    if (state.multiSpectral && isPlaying() && state.playbackAxis === "nu") {
      stopPlayback(false);
    }
    if (state.multiSpectral && state.navDrag && axisFromNavKind(state.navDrag.kind) === "nu") {
      state.navDrag = null;
    }
    updateControlCaps();
    await refreshSlice();
  });

  els.timePlayBtn.addEventListener("click", () => toggleAxisPlayback("t"));
  els.freqPlayBtn.addEventListener("click", () => toggleAxisPlayback("nu"));
  els.hiddenPlayBtn.addEventListener("click", () => toggleAxisPlayback(hiddenDim()));
  if (els.timeProjectBtn) {
    els.timeProjectBtn.addEventListener("click", () => toggleAxisProjection("t"));
  }
  if (els.freqProjectBtn) {
    els.freqProjectBtn.addEventListener("click", () => toggleAxisProjection("nu"));
  }
  if (els.hiddenProjectBtn) {
    els.hiddenProjectBtn.addEventListener("click", () => toggleAxisProjection(hiddenDim()));
  }

  els.playSpeedSelect.addEventListener("change", () => {
    state.playbackFps = Number.parseInt(els.playSpeedSelect.value, 10);
    restartPlaybackTimersIfRunning();
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
    state.dragMode = state.dragMode === "investigate" ? null : "investigate";
    updateModeButtons();
  });

  els.modeZoomBtn.addEventListener("click", () => {
    state.dragMode = state.dragMode === "zoom" ? null : "zoom";
    updateModeButtons();
  });

  window.addEventListener("keydown", syncDragModeModifierFromEvent);
  window.addEventListener("keyup", syncDragModeModifierFromEvent);
  window.addEventListener("mousedown", syncDragModeModifierFromEvent);
  window.addEventListener("mouseup", syncDragModeModifierFromEvent);
  window.addEventListener("blur", () => setDragModeModifier(null));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setDragModeModifier(null);
  });

  if (els.coordSystemSelect) {
    els.coordSystemSelect.addEventListener("change", () => {
      const next = els.coordSystemSelect.value;
      if (!["native", "pixel", "galactic"].includes(next)) return;
      state.coordSystem = next;
      ensureCoordSystem();
      updateCoordSystemOptions();
      updateHoverReadout();
    });
  }

  if (els.exportZoomBtn) {
    els.exportZoomBtn.addEventListener("click", async () => {
      if (els.exportZoomBtn.disabled) return;
      openExportDialog();
    });
  }

  if (els.exportFormatSelect) {
    els.exportFormatSelect.addEventListener("change", () => {
      const raw = isValidExportFormat(els.exportFormatSelect.value) ? els.exportFormatSelect.value : "fits";
      const next = isExportFormatAllowed(raw) ? raw : "hdf5";
      state.exportPrefs.format = next;
      const currentName = els.exportFilenameInput ? els.exportFilenameInput.value : state.exportPrefs.filename;
      state.exportPrefs.filename = normalizeExportFilename(currentName, next);
      updateExportDialogFields();
      setExportStatus("");
    });
  }

  if (els.exportFilenameInput) {
    els.exportFilenameInput.addEventListener("input", () => {
      state.exportPrefs.filename = els.exportFilenameInput.value;
      setExportStatus("");
    });
  }

  if (els.exportOverwriteChk) {
    els.exportOverwriteChk.addEventListener("change", () => {
      state.exportPrefs.overwrite = Boolean(els.exportOverwriteChk.checked);
    });
  }

  if (els.exportBrowseBtn) {
    els.exportBrowseBtn.addEventListener("click", async () => {
      try {
        await chooseExportFolder();
        setExportStatus("");
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setExportStatus(message, true);
      }
    });
  }

  if (els.exportCancelBtn) {
    els.exportCancelBtn.addEventListener("click", () => {
      closeExportDialog();
    });
  }

  if (els.exportConfirmBtn) {
    els.exportConfirmBtn.addEventListener("click", async () => {
      try {
        await saveExportCutoutFromDialog();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setExportStatus(`Export failed: ${message}`, true);
      }
    });
  }

  if (els.exportDialog) {
    els.exportDialog.addEventListener("cancel", () => {
      setExportStatus("");
    });
    els.exportDialog.addEventListener("close", () => {
      setExportStatus("");
    });
  }

  els.resetZoomBtn.addEventListener("click", async () => {
    state.navDrag = null;
    state.profileZoomDrag = null;
    state.profileZoom = {};
    state.axisWindow = { t: null, nu: null };
    state.volumeYaw = 0.65;
    state.volumePitch = -0.45;
    state.volumeZoom = 1.0;
    state.volumeDrag = null;
    state.sphereYaw = 0;
    state.spherePitch = 0;
    state.sphereDrag = null;
    updateVolumeControlReadouts();
    resetView();
    clearHoverProbe();
    updateExportButtonState();
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
    effectiveDragMode,
    els,
    ensureGridIndices,
    getDrawRect,
    getViewRect,
    handleWheelZoom,
    isSphereMode,
    isVolumeMode,
    navIndexFromEvent,
    planeDims,
    profileCanvasForKind,
    profileForAxis,
    profileIndexFromEvent,
    refreshSelectionAnalytics,
    refreshSlice,
    refreshViewProfiles,
    rerenderVolumeFrame,
    rerenderSphereFrame,
    screenToData,
    setAxisIndex,
    setAxisWindow,
    clearHoverProbe,
    state,
    updateHoverProbeFromEvent,
  });

  window.addEventListener("resize", () => {
    layoutViewerCanvas();
    drawFrameAndOverlays();
    drawNavigationGraphs();
    drawSelectionGraphs();
    drawColorbar();
    updateExportButtonState();
    updateHoverReadout();
  });

  updatePlayUi();
  await onDatasetChange();
}

init().catch((err) => {
  console.error(err);
  window.alert(`Failed to initialize demo: ${err.message}`);
});
