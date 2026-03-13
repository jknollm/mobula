import {
  AXIS_CONTROL_DIMS,
  DEFAULT_EXPORT_OUTPUT_DIR,
  DEFAULT_MOSAIC_GRID_SIZE,
  PLANE_KEYS,
} from "./viewer_constants.js?v=20260306b";

export function normalizeAxisSettingEntry(entry) {
  const flip = Boolean(entry && entry.flip === true);
  const rawUnit = entry && entry.unit !== undefined && entry.unit !== null ? String(entry.unit).trim() : "";
  const unit = rawUnit || "";
  const rawLength = Number.parseFloat(entry && entry.length);
  const length = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : null;
  const rawStart = Number.parseFloat(entry && entry.start);
  const rawEnd = Number.parseFloat(entry && entry.end);
  const start = Number.isFinite(rawStart) ? rawStart : null;
  const end = Number.isFinite(rawEnd) ? rawEnd : null;
  return { flip, length, unit, start, end };
}

export function createDefaultAxisSettings() {
  const out = {};
  for (const dim of AXIS_CONTROL_DIMS) out[dim] = { flip: false, length: null, unit: "", start: null, end: null };
  return out;
}

export function createDefaultAxisPlaneSwap() {
  const out = {};
  for (const key of PLANE_KEYS) out[key] = false;
  return out;
}

export function normalizeAxisSettingsState(raw) {
  const base = createDefaultAxisSettings();
  if (!raw || typeof raw !== "object") return base;
  for (const dim of AXIS_CONTROL_DIMS) {
    if (!Object.prototype.hasOwnProperty.call(raw, dim)) continue;
    base[dim] = normalizeAxisSettingEntry(raw[dim]);
  }
  return base;
}

export function normalizeAxisPlaneSwapState(raw) {
  const base = createDefaultAxisPlaneSwap();
  if (!raw || typeof raw !== "object") return base;
  for (const key of PLANE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    base[key] = raw[key] === true;
  }
  return base;
}

const VIEW_ROTATE_SPEED_LEVELS = Object.freeze([0.5, 1, 2, 4]);
const VIEW_ROTATE_RATE_LEVELS = Object.freeze([0, 0.5, 1, 2, 4, -4, -2, -1, -0.5]);
export const VIEW_ROTATE_RATE_STEP_LEVELS = Object.freeze([...VIEW_ROTATE_RATE_LEVELS].sort((a, b) => a - b));

export function normalizeViewRotateDirection(raw) {
  return raw === -1 ? -1 : 1;
}

export function normalizeViewRotateSpeed(raw) {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1;
  let best = VIEW_ROTATE_SPEED_LEVELS[0];
  let bestErr = Math.abs(parsed - best);
  for (let i = 1; i < VIEW_ROTATE_SPEED_LEVELS.length; i += 1) {
    const candidate = VIEW_ROTATE_SPEED_LEVELS[i];
    const err = Math.abs(parsed - candidate);
    if (err < bestErr) {
      best = candidate;
      bestErr = err;
    }
  }
  return best;
}

export function normalizeViewRotateRate(raw) {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0;
  let best = VIEW_ROTATE_RATE_LEVELS[0];
  let bestErr = Math.abs(parsed - best);
  for (let i = 1; i < VIEW_ROTATE_RATE_LEVELS.length; i += 1) {
    const candidate = VIEW_ROTATE_RATE_LEVELS[i];
    const err = Math.abs(parsed - candidate);
    if (err < bestErr) {
      best = candidate;
      bestErr = err;
    }
  }
  return best;
}

export function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normalizeVec3(raw, fallback = [0, 0, 1]) {
  if (!(Array.isArray(raw) || ArrayBuffer.isView(raw)) || raw.length < 3) {
    return [...fallback];
  }
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  const z = Number(raw[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return [...fallback];
  }
  const mag = Math.hypot(x, y, z);
  if (!(mag > 1.0e-12)) return [...fallback];
  return [x / mag, y / mag, z / mag];
}

export function mat3Mul(a, b) {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function mat3MulVec3(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mat3Transpose(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3RotationX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function mat3RotationY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

export function mat3RotationZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function mat3RotationAxis(axisRaw, angle) {
  const axis = normalizeVec3(axisRaw, [0, 0, 1]);
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

export function orthonormalizeRotationMatrix(mRaw) {
  if (!(Array.isArray(mRaw) || ArrayBuffer.isView(mRaw)) || mRaw.length < 9) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  const m = new Array(9);
  for (let i = 0; i < 9; i += 1) {
    const v = Number(mRaw[i]);
    if (!Number.isFinite(v)) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    m[i] = v;
  }
  let c0 = normalizeVec3([m[0], m[3], m[6]], [1, 0, 0]);
  let c1 = [m[1], m[4], m[7]];
  const proj = vec3Dot(c1, c0);
  c1 = [c1[0] - proj * c0[0], c1[1] - proj * c0[1], c1[2] - proj * c0[2]];
  c1 = normalizeVec3(c1, [0, 1, 0]);
  let c2 = vec3Cross(c0, c1);
  c2 = normalizeVec3(c2, [0, 0, 1]);
  c1 = vec3Cross(c2, c0);
  c1 = normalizeVec3(c1, [0, 1, 0]);
  c0 = normalizeVec3(c0, [1, 0, 0]);
  return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
}

export function sphereRotationMatrixFromYawPitch(yawRaw, pitchRaw) {
  const yaw = Number.isFinite(yawRaw) ? yawRaw : 0;
  const pitch = Number.isFinite(pitchRaw) ? pitchRaw : 0;
  return mat3Mul(mat3RotationY(pitch), mat3RotationZ(yaw));
}

export function volumeRotationMatrixFromYawPitch(yawRaw, pitchRaw) {
  const yaw = Number.isFinite(yawRaw) ? yawRaw : 0;
  const pitch = Number.isFinite(pitchRaw) ? pitchRaw : 0;
  return mat3Mul(mat3RotationY(yaw), mat3RotationX(pitch));
}

export function normalizeSphereRotationMatrix(raw, yawRaw = 0, pitchRaw = 0) {
  if (!(Array.isArray(raw) || ArrayBuffer.isView(raw)) || raw.length < 9) {
    return sphereRotationMatrixFromYawPitch(yawRaw, pitchRaw);
  }
  const out = new Array(9);
  for (let i = 0; i < 9; i += 1) {
    const v = Number(raw[i]);
    if (!Number.isFinite(v)) return sphereRotationMatrixFromYawPitch(yawRaw, pitchRaw);
    out[i] = v;
  }
  return out;
}

export function normalizeVolumeRotationMatrix(raw, yawRaw = 0, pitchRaw = 0) {
  if (!(Array.isArray(raw) || ArrayBuffer.isView(raw)) || raw.length < 9) {
    return volumeRotationMatrixFromYawPitch(yawRaw, pitchRaw);
  }
  const out = new Array(9);
  for (let i = 0; i < 9; i += 1) {
    const v = Number(raw[i]);
    if (!Number.isFinite(v)) return volumeRotationMatrixFromYawPitch(yawRaw, pitchRaw);
    out[i] = v;
  }
  return out;
}

export function normalizeSphereRotateAxisObject(raw) {
  return normalizeVec3(raw, [0, 0, 1]);
}

export function normalizeVolumeRotateAxisObject(raw) {
  return normalizeVec3(raw, [0, 1, 0]);
}

export function createViewerState() {
  return {
    dataId: null,
    pickerStatusMessage: "",
    pickerStatusError: false,
    meta: null,
    plane: "xy",
    values: { sample: 0, pol: 0, t: 0, nu: 0, x: 0, y: 0, z: 0 },
    axisSettings: createDefaultAxisSettings(),
    axisPlaneSwap: createDefaultAxisPlaneSwap(),

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
    colorNormWindowsByQuantity: {},
    spatialMode: "slice",
    sphereMeta: null,
    sphereProjection: "mollweide",
    sphereInsideScale: 0.2,
    sphereYaw: 0,
    spherePitch: 0,
    sphereRotationMatrix: sphereRotationMatrixFromYawPitch(0, 0),
    sphereRotateAxisObject: [0, 0, 1],
    viewRotateRate: 0,
    viewRotateEnabled: false,
    viewRotateDirection: 1,
    viewRotateSpeed: 1,
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
    multiSpectralComputeBackend: "auto",
    multiSpectralNuAxisScale: "linear",
    multiSpectralDeslope: 0,
    multiSpectralNormalizeSpectrum: false,
    multiSpectralNormalizeBoost: 1.0,
    multiSpectralChannelRange: { min: 0, max: 100 },
    accelerationCaps: {
      compute: null,
      render: null,
    },
    dragMode: null,
    dragModeModifier: null,
    renderScale: {
      spatial: 1,
      temporal: 1,
      spectral: 1,
    },
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
      outputDir: DEFAULT_EXPORT_OUTPUT_DIR,
      filename: "",
      overwrite: true,
    },
    saveImagesPrefs: {
      outputDir: DEFAULT_EXPORT_OUTPUT_DIR,
      prefix: "",
      overwrite: true,
      transparentBackground: false,
      includeViewer: true,
      includeColorbar: true,
      includeSampleLabels: true,
      includeTimeProfile: true,
      includeSpectralProfile: true,
      includeSpatialProfile: true,
    },
    recordMoviePrefs: {
      format: "mp4",
      quality: "balanced",
      outputDir: DEFAULT_EXPORT_OUTPUT_DIR,
      filename: "",
      overwrite: true,
    },
    renderMoviePrefs: {
      axis: "t",
      format: "mp4",
      quality: "balanced",
      fps: 30,
      loops: 1,
      resolution: "canvas",
      includeColorbar: true,
      includeSkyDirections: true,
      includeLengthScale: true,
      includeSampleLabels: true,
      outputDir: DEFAULT_EXPORT_OUTPUT_DIR,
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
    playbackFps: 10,
    playbackTimer: null,
    sampleMorphTimer: null,
    playbackBusy: false,
    playbackRefineToken: 0,
    playbackPreviewMaxPixels: 220000,

    _selectionToken: 0,
    _viewProfileToken: 0,
    _resizePanelsRaf: 0,
    _resizePanelsNeedsGraphs: false,
    _colorNormRerenderTimer: null,
    _multispectralRerenderRaf: 0,
    profileZoom: {},
    panelWidths: { left: null, right: null },
    volumeYaw: 0.65,
    volumePitch: -0.45,
    volumeRotationMatrix: volumeRotationMatrixFromYawPitch(0.65, -0.45),
    volumeRotateAxisObject: normalizeVec3(
      mat3MulVec3(mat3Transpose(volumeRotationMatrixFromYawPitch(0.65, -0.45)), [0, 1, 0]),
      [0, 1, 0]
    ),
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
    rgbGpu: {
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
}
