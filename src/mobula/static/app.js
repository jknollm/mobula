import { createGpuRenderers } from "./app_gpu.js?v=20260306a";
import { bindCanvasInteractions } from "./app_interactions.js?v=20260803a";
import { fetchBinaryPayload as fetchBinaryPayloadBase, fetchJson as fetchJsonBase, createRequestBuilders } from "./app_requests.js?v=20260803a";
import { resetForDatasetChange, resetForPlaneChange, resetForSceneLayerChange } from "./app_state_transitions.js?v=20260803a";
import {
  AXIS_CONTROL_DIMS,
  AXIS_DISPLAY_LABEL,
  COLOR_RAMPS,
  DEFAULT_EXPORT_OUTPUT_DIR,
  DEFAULT_MOSAIC_GRID_SIZE,
  DEFAULT_RECORD_BITRATE,
  DEFAULT_RECORD_MAX_PIXELS,
  GLOBAL_ZOOM_OUT_FACTOR,
  INGEST_AXIS_LABEL,
  INGEST_AXIS_THEME,
  INGEST_CANONICAL_DIMS,
  INGEST_HDF5_STACK_TOKEN_PREFIX,
  INGEST_SPHERE_ALIAS_DIM,
  INGEST_UI_DIMS,
  PLANE_KEYS,
  PLANE_OPTIONS,
  PROFILE_THEME,
  RENDER_AXIS_HIDDEN,
  RENDER_AXIS_ROTATE,
  RECORD_STOP_TIMEOUT_MS,
  SUPPORTED_DROP_UPLOAD_EXTS,
  VIEW_SOURCE_RECT_MAX_MULTIPLIER,
  VOLUME_ZOOM_MAX,
  VOLUME_ZOOM_MIN,
  WHEEL_ZOOM_STEP_FACTOR,
  normalizeColorMapKey,
} from "./viewer_constants.js?v=20260306b";
import { normalizeComputeBackendPreference, probeRenderCapabilities } from "./viewer_acceleration.js?v=20260309a";
import { lookupViewerElements } from "./viewer_dom.js?v=20260306b";
import {
  VIEW_ROTATE_RATE_STEP_LEVELS,
  createAxisSettingsForMetadata,
  createDefaultAxisPlaneSwap,
  createDefaultAxisSettings,
  createViewerState,
  mat3Mul,
  mat3MulVec3,
  mat3RotationX,
  mat3RotationAxis,
  mat3RotationY,
  mat3RotationZ,
  mat3Transpose,
  normalizeAxisPlaneSwapState,
  normalizeAxisSettingEntry,
  normalizeAxisSettingsState,
  normalizeSphereRotateAxisObject,
  normalizeSphereRotationMatrix,
  normalizeVolumeRotateAxisObject,
  normalizeVolumeRotationMatrix,
  normalizeVec3,
  normalizeViewRotateDirection,
  normalizeViewRotateRate,
  normalizeViewRotateSpeed,
  orthonormalizeRotationMatrix,
  sphereRotationMatrixFromYawPitch,
  volumeRotationMatrixFromYawPitch,
} from "./viewer_state.js?v=20260803c";
import { createPerfStore, perfEnabledFromLocation } from "./viewer_perf.js?v=20260306c";
import { createPlaybackController } from "./viewer_playback.js?v=20260306d";
import { createMovieRecordingController } from "./viewer_recording.js?v=20260306a";
import { createOfflineRenderController } from "./viewer_rendering.js?v=20260306a";
import {
  buildDefaultRecordMovieFilename,
  buildDefaultRenderMovieFilename,
  normalizeMovieFilename,
  normalizeRecordMovieFormat,
  normalizeRecordQuality,
  normalizeRenderFps,
  normalizeRenderLoops,
  normalizeRenderOverlayOption,
  normalizeRenderResolution,
  parseRenderAxis,
  recordQualityConfig,
  renderQualityLabel,
  resolveRenderFrameDimensions,
} from "./viewer_media.js?v=20260306a";

const els = lookupViewerElements();
const perfStore = createPerfStore({
  enabled: perfEnabledFromLocation(),
  onChange(summary, snapshot) {
    if (!els.perfReadout) return;
    els.perfReadout.hidden = !snapshot.enabled;
    els.perfReadout.textContent = summary;
  },
});

function ensureSphereRotationState() {
  state.sphereRotationMatrix = normalizeSphereRotationMatrix(state.sphereRotationMatrix, state.sphereYaw, state.spherePitch);
  state.sphereRotateAxisObject = normalizeSphereRotateAxisObject(state.sphereRotateAxisObject);
}

function ensureVolumeRotationState() {
  state.volumeRotationMatrix = normalizeVolumeRotationMatrix(state.volumeRotationMatrix, state.volumeYaw, state.volumePitch);
  state.volumeRotateAxisObject = normalizeVolumeRotateAxisObject(state.volumeRotateAxisObject);
}

function activeSphereRotationMatrix() {
  const m = state.sphereRotationMatrix;
  if ((Array.isArray(m) || ArrayBuffer.isView(m)) && m.length >= 9) {
    return m;
  }
  state.sphereRotationMatrix = sphereRotationMatrixFromYawPitch(state.sphereYaw, state.spherePitch);
  return state.sphereRotationMatrix;
}

function activeVolumeRotationMatrix() {
  const m = state.volumeRotationMatrix;
  if ((Array.isArray(m) || ArrayBuffer.isView(m)) && m.length >= 9) {
    return m;
  }
  state.volumeRotationMatrix = volumeRotationMatrixFromYawPitch(state.volumeYaw, state.volumePitch);
  return state.volumeRotationMatrix;
}

function setSphereOrientationFromYawPitch(yaw, pitch, options = {}) {
  state.sphereYaw = Number.isFinite(yaw) ? yaw : 0;
  state.spherePitch = Number.isFinite(pitch) ? pitch : 0;
  state.sphereRotationMatrix = sphereRotationMatrixFromYawPitch(state.sphereYaw, state.spherePitch);
  if (options.resetAxis === true) {
    state.sphereRotateAxisObject = [0, 0, 1];
  } else {
    state.sphereRotateAxisObject = normalizeSphereRotateAxisObject(state.sphereRotateAxisObject);
  }
}

function syncVolumeYawPitchFromMatrix() {
  const m = activeVolumeRotationMatrix();
  const fx = Number(m[2]) || 0;
  const fy = Number(m[5]) || 0;
  const fz = Number(m[8]) || 1;
  const yaw = Math.atan2(fx, Math.max(1.0e-9, fz));
  const pitch = clamp(Math.atan2(-fy, Math.max(1.0e-9, Math.hypot(fx, fz))), -1.45, 1.45);
  state.volumeYaw = normalizeAngleRad(yaw);
  state.volumePitch = pitch;
}

function defaultVolumeRotateAxisObject() {
  const base = volumeRotationMatrixFromYawPitch(DEFAULT_VOLUME_YAW, DEFAULT_VOLUME_PITCH);
  return normalizeVolumeRotateAxisObject(mat3MulVec3(mat3Transpose(base), [0, 1, 0]));
}

function setVolumeOrientationFromYawPitch(yaw, pitch, options = {}) {
  state.volumeYaw = Number.isFinite(yaw) ? yaw : DEFAULT_VOLUME_YAW;
  state.volumePitch = Number.isFinite(pitch) ? pitch : DEFAULT_VOLUME_PITCH;
  state.volumeRotationMatrix = volumeRotationMatrixFromYawPitch(state.volumeYaw, state.volumePitch);
  if (options.resetAxis === true) {
    state.volumeRotateAxisObject = defaultVolumeRotateAxisObject();
  } else {
    state.volumeRotateAxisObject = normalizeVolumeRotateAxisObject(state.volumeRotateAxisObject);
  }
}

function applyVolumeDragRotation(startMatrixRaw, dxRaw, dyRaw, speedRaw) {
  ensureVolumeRotationState();
  const startMatrix = normalizeVolumeRotationMatrix(startMatrixRaw, state.volumeYaw, state.volumePitch);
  const dx = Number.isFinite(dxRaw) ? dxRaw : 0;
  const dy = Number.isFinite(dyRaw) ? dyRaw : 0;
  const speed = Number.isFinite(speedRaw) ? speedRaw : 0.012;
  const viewerPitch = mat3RotationX(dy * speed);
  const objectYaw = mat3RotationY(dx * speed);
  state.volumeRotationMatrix = orthonormalizeRotationMatrix(mat3Mul(mat3Mul(viewerPitch, startMatrix), objectYaw));
  syncVolumeYawPitchFromMatrix();
}

function applyVolumeAutoRotateDelta(deltaRaw) {
  const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
  if (delta === 0) return;
  ensureVolumeRotationState();
  const axisObj = normalizeVolumeRotateAxisObject(state.volumeRotateAxisObject);
  const rot = mat3RotationAxis(axisObj, delta);
  state.volumeRotationMatrix = orthonormalizeRotationMatrix(mat3Mul(state.volumeRotationMatrix, rot));
  syncVolumeYawPitchFromMatrix();
}

function applySphereDragRotation(startMatrixRaw, dxRaw, dyRaw, speedRaw) {
  ensureSphereRotationState();
  const startMatrix = normalizeSphereRotationMatrix(startMatrixRaw, state.sphereYaw, state.spherePitch);
  const dx = Number.isFinite(dxRaw) ? dxRaw : 0;
  const dy = Number.isFinite(dyRaw) ? dyRaw : 0;
  const speed = Number.isFinite(speedRaw) ? speedRaw : 0.0095;
  const viewerPitch = mat3RotationY(dy * speed);
  const objectYaw = mat3RotationZ(dx * speed);
  state.sphereRotationMatrix = orthonormalizeRotationMatrix(mat3Mul(mat3Mul(viewerPitch, startMatrix), objectYaw));
}

function applySphereAutoRotateDelta(deltaRaw) {
  const delta = Number.isFinite(deltaRaw) ? deltaRaw : 0;
  if (delta === 0) return;
  ensureSphereRotationState();
  const axisObj = normalizeSphereRotateAxisObject(state.sphereRotateAxisObject);
  const rot = mat3RotationAxis(axisObj, delta);
  state.sphereRotationMatrix = orthonormalizeRotationMatrix(mat3Mul(state.sphereRotationMatrix, rot));
}

function resetSphereRotateAxisToViewerZ() {
  ensureSphereRotationState();
  const inv = mat3Transpose(state.sphereRotationMatrix);
  state.sphereRotateAxisObject = normalizeSphereRotateAxisObject(mat3MulVec3(inv, [0, 0, 1]));
}

function resetVolumeRotateAxisToViewerY() {
  ensureVolumeRotationState();
  const inv = mat3Transpose(state.volumeRotationMatrix);
  state.volumeRotateAxisObject = normalizeVolumeRotateAxisObject(mat3MulVec3(inv, [0, 1, 0]));
}

function resetVolumeOrientation() {
  setVolumeOrientationFromYawPitch(DEFAULT_VOLUME_YAW, DEFAULT_VOLUME_PITCH, { resetAxis: true });
}

const state = createViewerState();
state.accelerationCaps.render = probeRenderCapabilities();

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
const MULTISPECTRAL_RANGE_STEPS = 1000;
const MULTISPECTRAL_RANGE_MIN_GAP = 1 / MULTISPECTRAL_RANGE_STEPS;
const VOLUME_CLIP_RANGE_STEPS = 1000;
const VOLUME_CLIP_MIN_GAP = 0.01;
const VOLUME_SPHERE_RANGE_STEPS = 1000;
const VOLUME_SPHERE_MIN_GAP = 1 / VOLUME_SPHERE_RANGE_STEPS;
const VOLUME_SPHERE_NSITE_MIN = 1;
const VOLUME_SPHERE_NSITE_MAX = 512;
const SPHERE_RENDER_NSIDE_MIN = 1;
const SPHERE_RENDER_NSIDE_MAX = 512;
const SPHERE_UPSAMPLE_KERNEL_CACHE_MAX = 8;
const VIEW_ROTATE_BASE_RATE_RAD_PER_SEC = Math.PI / 6;
const VIEW_ROTATE_MAX_DT_SEC = 0.12;
const VIEW_ROTATE_MIN_RENDER_VOLUME_MS = 72;
const VIEW_ROTATE_MIN_RENDER_SPHERE_MS = 48;
const VIEW_ROTATE_SPHERE_REFRESH_MS = 220;
const DEFAULT_VOLUME_YAW = 0.65;
const DEFAULT_VOLUME_PITCH = -0.45;
const PLAYBACK_PREVIEW_BASE_MAX_PIXELS = 220000;
const PLAYBACK_PREVIEW_MIN_PIXELS = 90000;
const PLAYBACK_PREVIEW_MAX_PIXELS = 520000;
const PLAYBACK_FRAME_CACHE_MAX = 24;
const PLAYBACK_PREFETCH_LOOKAHEAD_MAX = 3;
const DOMAIN_SCALE_FACTORS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const SPATIAL_SCALE_MAX_PIXELS = 64_000_000;
const VOLUME_FRAME_RES_MAX = 1024;
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
const DATASET_TAB_LABEL_MAX = 42;
let viewerDropDragDepth = 0;
let stateEpoch = 0;
let activeRequestController = new AbortController();
const playbackFrameCache = new Map();
const spatialSliceResampleCache = new WeakMap();
const spatialRgbResampleCache = new WeakMap();
const sphereUpsampleKernelCache = new Map();
const sphereScalarColorTableCache = new WeakMap();
const sphereRgbColorTableCache = new WeakMap();
const datasetSummaryById = new Map();
const datasetTabs = [];
let activeDatasetTabId = null;
let nextDatasetTabId = 1;
const movieRecording = {
  recorder: null,
  stream: null,
  stopDrawing: null,
  stopCompositor: null,
  chunks: [],
  mimeType: "video/webm",
  dataId: null,
  startedAtMs: 0,
  pendingBlob: null,
  pendingMimeType: "",
  pendingDataId: null,
  stopping: false,
  saving: false,
  stopPromise: null,
};
const renderJob = {
  running: false,
  cancelRequested: false,
  startedAtMs: 0,
  totalFrames: 0,
  completedFrames: 0,
  encoding: false,
  dataId: null,
  fetchAbortController: null,
};
let renderOverlayDrawOverride = null;
const ingestWizard = {
  step: "intent",
  inspection: null,
  plan: null,
  selectedPresetId: null,
  mappings: [],
  intent: "tabs",
  fileAxis: "sample",
  activeFileIndex: 0,
};
const ingestAxisDrag = {
  activeBlock: null,
  payload: null,
  pointerId: null,
  pointerDx: 0,
  pointerDy: 0,
  sourceZone: null,
  vacancyBlock: null,
  vacancyCollapsed: false,
};
let viewRotateRaf = 0;
let viewRotateLastTs = 0;
let viewRotateLastRenderTs = 0;
let viewRotateSphereRefreshTimer = 0;

function isAbortError(err) {
  return Boolean(err && (err.name === "AbortError" || /aborted/i.test(String(err.message || ""))));
}

function isNotFoundError(err) {
  const message = err && err.message ? String(err.message) : String(err || "");
  return /404/.test(message) && /not found/i.test(message);
}

function makeAbortError(message = "aborted") {
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function assertEpoch(epoch) {
  if (epoch !== stateEpoch) throw makeAbortError("stale state epoch");
}

function bumpStateEpoch() {
  stateEpoch += 1;
  playbackFrameCache.clear();
  try {
    activeRequestController.abort();
  } catch (_) {
    // ignore abort errors
  }
  activeRequestController = new AbortController();
}

function activeEpoch() {
  return stateEpoch;
}

function cloneSessionValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    // Large data payload arrays (slice/volume values) are treated as immutable and reused by reference.
    if (value.length > 4096) return value;
    return value.map((entry) => cloneSessionValue(entry));
  }
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return value;
    }
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = cloneSessionValue(nested);
    }
    return out;
  }
  return value;
}

function snapshotState() {
  return cloneSessionValue(state);
}

function restoreState(snapshot) {
  const base = createViewerState();
  const source = snapshot && typeof snapshot === "object" ? snapshot : base;
  const merged = { ...base, ...source };
  const legacyUpscale =
    merged &&
    merged.sliceRender &&
    typeof merged.sliceRender === "object" &&
    Number.isFinite(Number.parseFloat(merged.sliceRender.upscaleFactor))
      ? Number.parseFloat(merged.sliceRender.upscaleFactor)
      : null;
  if (!merged.renderScale || typeof merged.renderScale !== "object") {
    merged.renderScale = { ...base.renderScale };
  }
  if (legacyUpscale !== null && !Number.isFinite(Number.parseFloat(source?.renderScale?.spatial))) {
    merged.renderScale.spatial = normalizeDomainScaleFactor(legacyUpscale);
  }
  merged.renderScale.spatial = normalizeDomainScaleFactor(merged.renderScale.spatial);
  merged.renderScale.temporal = normalizeDomainScaleFactor(merged.renderScale.temporal);
  merged.renderScale.spectral = normalizeDomainScaleFactor(merged.renderScale.spectral);
  merged.colorMap = normalizeColorMapKey(merged.colorMap);
  merged.axisSettings = normalizeAxisSettingsState(merged.axisSettings);
  merged.axisPlaneSwap = normalizeAxisPlaneSwapState(merged.axisPlaneSwap);
  merged.sphereHorizontalFlip = merged.sphereHorizontalFlip !== false;
  merged.colorNormValueWindow = normalizeColorNormWindowValue(merged.colorNormValueWindow);
  merged.multiSpectralChannelRange = normalizeMultispectralChannelRange(merged.multiSpectralChannelRange);
  merged.multiSpectralNormalizeSpectrum = Boolean(merged.multiSpectralNormalizeSpectrum);
  merged.multiSpectralNormalizeBoost = normalizeMultispectralNormalizeBoost(merged.multiSpectralNormalizeBoost);
  const sourceHasViewRotateRate = Object.prototype.hasOwnProperty.call(source, "viewRotateRate");
  const legacyViewRotateDirection = normalizeViewRotateDirection(merged.viewRotateDirection);
  const legacyViewRotateSpeed = normalizeViewRotateSpeed(merged.viewRotateSpeed);
  const legacyViewRotateRate = merged.viewRotateEnabled ? legacyViewRotateDirection * legacyViewRotateSpeed : 0;
  merged.viewRotateRate = normalizeViewRotateRate(sourceHasViewRotateRate ? merged.viewRotateRate : legacyViewRotateRate);
  merged.viewRotateEnabled = merged.viewRotateRate !== 0;
  merged.viewRotateDirection = merged.viewRotateRate < 0 ? -1 : 1;
  merged.viewRotateSpeed = normalizeViewRotateSpeed(Math.abs(merged.viewRotateRate) || legacyViewRotateSpeed);
  const sourceHasSphereRotation = Object.prototype.hasOwnProperty.call(source, "sphereRotationMatrix");
  const sourceHasSphereAxis = Object.prototype.hasOwnProperty.call(source, "sphereRotateAxisObject");
  merged.sphereRotationMatrix = orthonormalizeRotationMatrix(
    normalizeSphereRotationMatrix(
      sourceHasSphereRotation ? merged.sphereRotationMatrix : null,
      merged.sphereYaw,
      merged.spherePitch
    )
  );
  merged.sphereRotateAxisObject = normalizeSphereRotateAxisObject(
    sourceHasSphereAxis ? merged.sphereRotateAxisObject : null
  );
  if (!merged.colorNormWindowsByQuantity || typeof merged.colorNormWindowsByQuantity !== "object") {
    merged.colorNormWindowsByQuantity = {};
  }

  for (const key of Object.keys(state)) {
    if (!(key in merged)) delete state[key];
  }
  for (const [key, value] of Object.entries(merged)) {
    state[key] = cloneSessionValue(value);
  }
  rememberCurrentQuantityColorNormWindow();
}

const playbackController = createPlaybackController({
  state,
  els,
  renderJob,
  sampleMorphAxis: SAMPLE_MORPH_AXIS,
  playbackPreviewBaseMaxPixels: PLAYBACK_PREVIEW_BASE_MAX_PIXELS,
  playbackPreviewMinPixels: PLAYBACK_PREVIEW_MIN_PIXELS,
  playbackPreviewMaxPixels: PLAYBACK_PREVIEW_MAX_PIXELS,
  hiddenDim,
  isSampleMorphMode,
  sampleCount,
  isAxisProjectionActive,
  isVolumeMode,
  isSphereMode,
  axisSize,
  isAxisSelectorLocked,
  refreshSlice,
  refreshSelectionAnalytics,
  advanceSampleMorphPlayback,
  isSamplesMode,
  clamp,
  getAxisWindow,
  onUpdatePlayUi: updateSampleMorphPlaybackStatus,
  prefetchAxisPlaybackFrame,
  setAxisIndex,
});

const {
  isPlaying,
  isSampleMorphPlaybackActive,
  playbackAxisLength,
  playbackIntervalMs,
  playbackMaxPixelsForFrame,
  restartPlaybackIfRunning,
  restartPlaybackTimersIfRunning,
  restartSampleMorphPlaybackIfRunning,
  scheduleNextPlaybackTick,
  schedulePlaybackRefine,
  startPlayback,
  stopPlayback,
  stopSampleMorphPlayback,
  syncSampleMorphPlayback,
  toggleAxisPlayback,
  updatePlayUi,
  updatePlaybackButtons,
} = playbackController;

function debugStateSnapshot() {
  const msBands = state.currentMultispectralBands || null;
  return {
    acceleration: {
      compute: state.accelerationCaps?.compute || null,
      computeBackendPreference: state.multiSpectralComputeBackend,
      computeFallbackReason: msBands?.fallback_reason || null,
      computePreviewActive: Boolean(msBands?.preview_active),
      computeUsed: msBands?.compute_backend_used || msBands?.compute_backend || null,
      render: state.accelerationCaps?.render || null,
      renderRequested: state.sliceRender.backend,
    },
    axisWindow: {
      t: state.axisWindow?.t ? { ...state.axisWindow.t } : null,
      nu: state.axisWindow?.nu ? { ...state.axisWindow.nu } : null,
    },
    colorMap: state.colorMap,
    dataId: state.dataId,
    fluxScale: state.fluxScale,
    hoverProbeActive: Boolean(state.hoverProbe),
    ingest: {
      dialogOpen: Boolean(els.ingestDialog?.open),
      hasInspection: Boolean(ingestWizard.inspection),
      hasPlan: Boolean(ingestWizard.plan),
      intentDialogOpen: Boolean(els.ingestIntentDialog?.open),
      keysDialogOpen: Boolean(els.ingestKeysDialog?.open),
      step: ingestWizard.step,
    },
    plane: state.plane,
    playback: {
      active: isPlaying(),
      axis: state.playbackAxis || null,
      fps: state.playbackFps,
      prefetchCacheSize: playbackFrameCache.size,
      sampleMorphActive: isSampleMorphPlaybackActive(),
    },
    recording: {
      active: isMovieRecordingActive(),
      dialogOpen: Boolean(els.recordMovieDialog?.open),
      pending: hasPendingMovieRecording(),
    },
    render: {
      active: renderJob.running,
      dialogOpen: Boolean(els.renderMovieDialog?.open),
      encoding: renderJob.encoding,
    },
    profileZoomKeys: Object.keys(state.profileZoom || {}).sort(),
    profilesActive: Boolean(state.profiles),
    sampleMode: state.sampleMode,
    sampleSingleView: state.sampleSingleView,
    selection: state.selection
      ? {
          tile: state.selection.tile ?? null,
          u0: state.selection.u0,
          u1: state.selection.u1,
          v0: state.selection.v0,
          v1: state.selection.v1,
        }
      : null,
    spatialMode: state.spatialMode,
    sphere: {
      flipX: state.sphereHorizontalFlip !== false,
      hasVectors: Boolean(state.sphereVectors),
      pitch: state.spherePitch,
      projection: state.sphereProjection,
      yaw: state.sphereYaw,
    },
    volume: {
      pitch: state.volumePitch,
      rotateAxisObject:
        Array.isArray(state.volumeRotateAxisObject) || ArrayBuffer.isView(state.volumeRotateAxisObject)
          ? Array.from(state.volumeRotateAxisObject).slice(0, 3)
          : null,
      rotationMatrix:
        Array.isArray(state.volumeRotationMatrix) || ArrayBuffer.isView(state.volumeRotationMatrix)
          ? Array.from(state.volumeRotationMatrix).slice(0, 9)
          : null,
      yaw: state.volumeYaw,
    },
    values: { ...state.values },
    view: { ...state.view },
    viewProfilesActive: Boolean(state.viewProfiles),
  };
}

if (typeof window !== "undefined") {
  window.__mobulaDebug = {
    getStateSnapshot: debugStateSnapshot,
  };
}

async function fetchJson(url, options = null) {
  const opts = options ? { ...options } : {};
  if (!opts.signal) opts.signal = activeRequestController.signal;
  opts.onPerf = (event) => {
    perfStore.recordFetch(event);
  };
  return fetchJsonBase(url, opts);
}

async function fetchBinaryPayload(url, options = null) {
  const opts = options ? { ...options } : {};
  if (!opts.signal) opts.signal = activeRequestController.signal;
  opts.onPerf = (event) => {
    perfStore.recordFetch(event);
  };
  return fetchBinaryPayloadBase(url, opts);
}

function withBinaryResponse(params) {
  const next = new URLSearchParams(params);
  next.set("response_format", "binary");
  return next;
}

function rememberPlaybackFramePromise(cacheKey, loader) {
  const existing = playbackFrameCache.get(cacheKey);
  if (existing) {
    playbackFrameCache.delete(cacheKey);
    playbackFrameCache.set(cacheKey, existing);
    return existing.promise;
  }
  const entry = { promise: null };
  entry.promise = Promise.resolve()
    .then(() => loader())
    .catch((err) => {
      if (playbackFrameCache.get(cacheKey) === entry) {
        playbackFrameCache.delete(cacheKey);
      }
      throw err;
    });
  playbackFrameCache.set(cacheKey, entry);
  while (playbackFrameCache.size > PLAYBACK_FRAME_CACHE_MAX) {
    const oldestKey = playbackFrameCache.keys().next().value;
    if (oldestKey === undefined) break;
    playbackFrameCache.delete(oldestKey);
  }
  return entry.promise;
}

function fetchPlaybackCachedJson(url) {
  return rememberPlaybackFramePromise(`json:${url}`, () => fetchJson(url));
}

function fetchPlaybackCachedBinaryPayload(url) {
  return rememberPlaybackFramePromise(`binary:${url}`, () => fetchBinaryPayload(url));
}

function slicePayloadUrl(params) {
  return `/api/datasets/${state.dataId}/slice?${withBinaryResponse(params).toString()}`;
}

function fetchSlicePayload(params, options = {}) {
  const url = slicePayloadUrl(params);
  return options.playback === true ? fetchPlaybackCachedBinaryPayload(url) : fetchBinaryPayload(url);
}

async function loadAccelerationCapabilities() {
  try {
    const payload = await fetchJsonBase("/api/acceleration/capabilities");
    state.accelerationCaps.compute = payload?.compute || null;
  } catch (err) {
    console.warn("acceleration capability probe failed:", err);
    state.accelerationCaps.compute = null;
  }
}

function activeRenderBackendUsed() {
  const width = Math.max(1, Math.round(state.drawRect?.w || els.canvas?.width || 0));
  const height = Math.max(1, Math.round(state.drawRect?.h || els.canvas?.height || 0));
  if (isVolumeMode()) return volumeBackendMode();
  if (isSphereMode()) return sphereBackendMode(width, height);
  if (multispectralFrameActive()) return rgbBackendMode(width, height);
  return sliceBackendMode(width, height);
}

function renderBackendStatusText() {
  const requested = state.sliceRender.backend || "auto";
  const used = activeRenderBackendUsed();
  const webgl2 = state.accelerationCaps?.render?.webgl2 || null;
  if (used === "gpu") {
    return `Render ${requested} -> GPU (WebGL2)`;
  }
  if (requested === "gpu") {
    const reason = webgl2?.reason || "WebGL2 unavailable";
    return `Render GPU requested, CPU used. ${reason}`;
  }
  if (requested === "auto" && webgl2?.supported === false) {
    return `Render auto -> CPU. ${webgl2.reason || "WebGL2 unavailable"}`;
  }
  return `Render ${requested} -> CPU`;
}

function computeBackendStatusText() {
  const bands = state.currentMultispectralBands || null;
  const requested = normalizeComputeBackendPreference(state.multiSpectralComputeBackend);
  if (!canUseMultiSpectral()) {
    return "Compute backend applies to multi-spectral conversion only.";
  }
  if (!bands) {
    const nativeBackend = state.accelerationCaps?.compute?.native_backend;
    if (requested === "auto" && nativeBackend && nativeBackend !== "cpu") {
      return `Compute auto prefers ${nativeBackend}.`;
    }
    return `Compute request: ${requested}.`;
  }
  const requestedUsed = bands.compute_backend_requested || requested;
  const used = bands.compute_backend_used || bands.compute_backend || "cpu";
  const preview = bands.preview_active ? " Preview active." : "";
  const fallback = bands.fallback_reason ? ` ${bands.fallback_reason}` : "";
  return `Compute ${requestedUsed} -> ${used}.${preview}${fallback}`.trim();
}

function updateBackendStatusUi() {
  if (els.renderBackendStatus) {
    els.renderBackendStatus.textContent = renderBackendStatusText();
  }
  if (els.computeBackendStatus) {
    els.computeBackendStatus.textContent = computeBackendStatusText();
  }
}

function volumePayloadUrl(params) {
  return `/api/datasets/${state.dataId}/volume?${withBinaryResponse(params).toString()}`;
}

function fetchVolumePayload(params, options = {}) {
  const url = volumePayloadUrl(params);
  return options.playback === true ? fetchPlaybackCachedBinaryPayload(url) : fetchBinaryPayload(url);
}

function multispectralPayloadUrl(params) {
  return `/api/datasets/${state.dataId}/multispectral?${withBinaryResponse(params).toString()}`;
}

function fetchMultispectralPayload(params, options = {}) {
  const url = multispectralPayloadUrl(params);
  return options.playback === true ? fetchPlaybackCachedBinaryPayload(url) : fetchBinaryPayload(url);
}

function startVisibleUpdate(label, meta = null) {
  perfStore.startVisibleUpdate(label, meta);
}

function ensureVisibleUpdate(label, meta = null) {
  perfStore.ensureVisibleUpdate(label, meta);
}

function renderPerfContext() {
  if (isPlaying() || isSampleMorphPlaybackActive()) {
    return { context: "playback", targetMs: playbackIntervalMs() };
  }
  if (
    state.volumeDrag
    || state.sphereDrag
    || state.panDrag
    || state.zoomDrag
    || state.selectionDrag
    || state.navDrag
    || state.profileZoomDrag
  ) {
    return { context: "interaction", targetMs: 1000 / 60 };
  }
  return { context: "idle", targetMs: null };
}

function recordViewerRender(startedAt, label = "viewer-frame") {
  const { context, targetMs } = renderPerfContext();
  perfStore.recordRender({
    completedAt: performance.now(),
    context,
    drawMode: state.frameTiles && state.frameTiles.length ? "tiles" : "single",
    durationMs: performance.now() - startedAt,
    framePixels: els.canvas ? els.canvas.width * els.canvas.height : null,
    label,
    meta: {
      multiSpectral: Boolean(state.multiSpectral),
      plane: state.plane,
      sampleMode: state.sampleMode,
      spatialMode: state.spatialMode,
    },
    targetMs,
  });
}

function planeDims() {
  const key = Object.prototype.hasOwnProperty.call(PLANE_OPTIONS, state.plane) ? state.plane : "xy";
  const base = PLANE_OPTIONS[key] || PLANE_OPTIONS.xy;
  if (!axisPlaneSwapEnabled(key)) return base;
  return {
    planeX: base.planeY,
    planeY: base.planeX,
    hidden: base.hidden,
    label: `${base.planeY.toUpperCase()}${base.planeX.toUpperCase()}`,
  };
}

function hiddenDim() {
  return planeDims().hidden;
}

function hasThirdSpatialDimension() {
  let varying = 0;
  for (const dim of ["x", "y", "z"]) {
    if (axisSize(dim) > 1) varying += 1;
  }
  return varying >= 3;
}

function preferredSpatialPlaneForDataset() {
  const xVar = axisSize("x") > 1;
  const yVar = axisSize("y") > 1;
  const zVar = axisSize("z") > 1;
  if (xVar && yVar) return "xy";
  if (yVar && zVar) return "yz";
  if (zVar && xVar) return "zx";
  return "xy";
}

function axisSize(dim) {
  if (!state.meta || !state.meta.coords[dim]) return 1;
  return state.meta.coords[dim].size;
}

function dimUnit(dim) {
  if (!state.meta || !state.meta.coords[dim]) return "";
  return state.meta.coords[dim].unit || "";
}

function axisDisplayUnit(dim) {
  const cfg = axisSetting(dim);
  if (cfg.unit) return cfg.unit;
  return dimUnit(dim);
}

function axisHasCustomUnit(dim) {
  const cfg = axisSetting(dim);
  return Boolean(cfg.unit);
}

function dimCoord(dim, idx) {
  if (!state.meta || !state.meta.coords[dim]) return null;
  const coordMeta = state.meta.coords[dim];
  if (Array.isArray(coordMeta.values) && idx >= 0 && idx < coordMeta.values.length) {
    return coordMeta.values[idx];
  }
  if (coordMeta.linear && Number.isFinite(coordMeta.linear.start) && Number.isFinite(coordMeta.linear.step)) {
    return coordMeta.linear.start + idx * coordMeta.linear.step;
  }
  if (coordMeta.coordinate_encoding === "unavailable") return idx;
  const cmin = coordMeta.min;
  const cmax = coordMeta.max;
  const n = axisSize(dim);
  if (n <= 1 || cmin === null || cmax === null) return idx;
  const f = idx / (n - 1);
  return cmin + f * (cmax - cmin);
}

function isSparseSceneView() {
  return state.meta?.scene_access === "slice" || state.sceneSession?.descriptor?.access?.mode === "slice";
}

function sparseSceneProfileCapability() {
  if (!isSparseSceneView()) return null;
  return state.meta?.scene_profiles || state.sceneSession?.descriptor?.access?.profiles || null;
}

function sparseSceneProfilesAvailable() {
  const capability = sparseSceneProfileCapability();
  if (!capability || !Array.isArray(capability.axes) || !Array.isArray(capability.plane_axes)) return false;
  const p = planeDims();
  return capability.plane_axes[0] === p.planeX && capability.plane_axes[1] === p.planeY;
}

function profileAxisAvailable(axis) {
  if (!isSparseSceneView()) return true;
  const capability = sparseSceneProfileCapability();
  return sparseSceneProfilesAvailable() && capability.axes.includes(axis);
}

function axisPlaneSwapState() {
  if (!state.axisPlaneSwap || typeof state.axisPlaneSwap !== "object") {
    state.axisPlaneSwap = createDefaultAxisPlaneSwap();
  }
  for (const key of PLANE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(state.axisPlaneSwap, key)) {
      state.axisPlaneSwap[key] = false;
    }
    state.axisPlaneSwap[key] = state.axisPlaneSwap[key] === true;
  }
  return state.axisPlaneSwap;
}

function axisPlaneSwapEnabled(planeKey = state.plane) {
  if (!PLANE_KEYS.includes(planeKey)) return false;
  return axisPlaneSwapState()[planeKey] === true;
}

function axisPlaneSwapSet(planeKey, enabled) {
  if (!PLANE_KEYS.includes(planeKey)) return;
  axisPlaneSwapState()[planeKey] = enabled === true;
}

function axisSetting(dim) {
  if (!state.axisSettings || typeof state.axisSettings !== "object") {
    state.axisSettings = createDefaultAxisSettings();
  }
  if (!Object.prototype.hasOwnProperty.call(state.axisSettings, dim)) {
    state.axisSettings[dim] = { flip: false, length: null, unit: "", start: null, end: null };
  }
  state.axisSettings[dim] = normalizeAxisSettingEntry(state.axisSettings[dim]);
  return state.axisSettings[dim];
}

function axisIsFlipped(dim) {
  return axisSetting(dim).flip === true;
}

function sphereHorizontalFlipEnabled() {
  return state.sphereHorizontalFlip !== false;
}

function axisRawEndpoints(dim) {
  const n = axisSize(dim);
  if (n <= 1) return null;
  const start = dimCoord(dim, 0);
  const end = dimCoord(dim, n - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (Math.abs(end - start) <= 1.0e-15) return null;
  return { start, end };
}

function axisMappedEndpoints(dim) {
  const raw = axisRawEndpoints(dim);
  if (!raw) return null;
  const cfg = axisSetting(dim);
  const length = Number.isFinite(cfg.length) && cfg.length > 0 ? cfg.length : null;
  let start = Number.isFinite(cfg.start) ? cfg.start : null;
  let end = Number.isFinite(cfg.end) ? cfg.end : null;

  if (start === null && end === null && length !== null) {
    start = 0;
    end = length;
  } else if (start !== null && end === null && length !== null) {
    end = start + length;
  } else if (end !== null && start === null && length !== null) {
    start = end - length;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (Math.abs(end - start) <= 1.0e-15) return null;
  return { rawStart: raw.start, rawEnd: raw.end, start, end };
}

function axisValueCoord(dim, coord) {
  if (!Number.isFinite(coord)) return coord;
  const endpoints = axisMappedEndpoints(dim);
  if (!endpoints) return coord;
  const t = (coord - endpoints.rawStart) / (endpoints.rawEnd - endpoints.rawStart);
  return endpoints.start + t * (endpoints.end - endpoints.start);
}

function axisDisplayLabel(dim, fallback = null) {
  if (Object.prototype.hasOwnProperty.call(AXIS_DISPLAY_LABEL, dim)) {
    return AXIS_DISPLAY_LABEL[dim];
  }
  if (fallback !== null && fallback !== undefined) return String(fallback);
  if (!dim) return "Axis";
  return String(dim).toUpperCase();
}

function axisMapCoord(dim, coord) {
  const valueCoord = axisValueCoord(dim, coord);
  if (!Number.isFinite(valueCoord)) return valueCoord;
  return axisIsFlipped(dim) ? -valueCoord : valueCoord;
}

function axisMapCoords(dim, coords) {
  if (!Array.isArray(coords)) return [];
  const mappedValueCoords = coords.map((coord) => axisValueCoord(dim, coord));
  const useLogFrequencyAxis =
    dim === "nu"
    && state.multiSpectralNuAxisScale === "log"
    && mappedValueCoords.length > 1
    && mappedValueCoords.every((v) => Number.isFinite(v) && v > 0);
  return mappedValueCoords.map((coord) => {
    if (!Number.isFinite(coord)) return coord;
    const plotted = useLogFrequencyAxis ? Math.log10(coord) : coord;
    return axisIsFlipped(dim) ? -plotted : plotted;
  });
}

function axisSettingsCustomizedCount() {
  let count = 0;
  for (const dim of AXIS_CONTROL_DIMS) {
    const cfg = axisSetting(dim);
    if (
      cfg.flip
      || Number.isFinite(cfg.length)
      || Number.isFinite(cfg.start)
      || Number.isFinite(cfg.end)
      || Boolean(cfg.unit)
    ) count += 1;
  }
  return count;
}

function sphereFlipCustomizedCount() {
  return isSphereDataset() && !sphereHorizontalFlipEnabled() ? 1 : 0;
}

function axisPlaneSwapCustomizedCount() {
  const activePlane = PLANE_KEYS.includes(state.plane) ? state.plane : "xy";
  return axisPlaneSwapEnabled(activePlane) ? 1 : 0;
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

function provisionalAxisUnit(dim) {
  if (dim === "sample") return "index";
  if (dim === "pol") return "index";
  if (dim === "t") return "s";
  if (dim === "nu") return "Hz";
  return "pix";
}

function provisionalAxisType(dim) {
  if (dim === "sample") return "sample";
  if (dim === "pol") return "polarization";
  if (dim === "t") return "time";
  if (dim === "nu") return "spectral";
  return "spatial";
}

function buildProvisionalMetaFromDatasetSummary(summary) {
  if (!summary || !Array.isArray(summary.dims) || !Array.isArray(summary.shape) || summary.dims.length !== summary.shape.length) {
    return null;
  }
  const coords = {};
  const axisTypes = {};
  for (let i = 0; i < summary.dims.length; i += 1) {
    const dim = String(summary.dims[i] || "");
    if (!dim) continue;
    const size = Math.max(1, Number.parseInt(summary.shape[i], 10) || 1);
    coords[dim] = {
      size,
      unit: provisionalAxisUnit(dim),
      min: 0,
      max: Math.max(0, size - 1),
    };
    axisTypes[dim] = provisionalAxisType(dim);
  }

  const meta = {
    data_id: summary.data_id,
    dims: [...summary.dims],
    shape: [...summary.shape],
    coords,
    intensity_unit: summary.intensity_unit || "arb",
    wcs: {
      frame: "unknown",
      source: "summary",
      axis_types: axisTypes,
    },
    provenance: {
      source: summary.source || "summary",
      provisional_meta: true,
    },
    uncertainty: null,
    scene_access: String(summary.source || "").includes("scene-virtual-slice") ? "slice" : null,
    pol_labels: coords.pol && Number.parseInt(coords.pol.size, 10) === 4 ? ["I", "Q", "U", "V"] : null,
    sphere: null,
  };
  meta.sphere = detectSphereMeta(meta);
  return meta;
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

function setDualRangeLabelPosition(trackEl, labelEl, pct) {
  if (!trackEl || !labelEl) return;
  const safePct = Number.isFinite(pct) ? clamp(pct, 0, 100) : 50;
  const trackWidth = trackEl.clientWidth;
  if (!(trackWidth > 0)) {
    labelEl.style.left = `${safePct.toFixed(3)}%`;
    return;
  }

  const targetPx = (safePct / 100) * trackWidth;
  const labelWidth = Math.max(labelEl.offsetWidth, labelEl.getBoundingClientRect().width || 0);
  let leftPx = targetPx;
  if (labelWidth > 0) {
    const halfWidth = labelWidth / 2;
    leftPx = labelWidth >= trackWidth ? trackWidth / 2 : clamp(targetPx, halfWidth, trackWidth - halfWidth);
  }
  labelEl.style.left = `${leftPx.toFixed(2)}px`;
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
  if (isSparseSceneView()) return false;
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
  const zoom = clamp(state.volumeZoom, VOLUME_ZOOM_MIN, VOLUME_ZOOM_MAX);
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
  const requested = state.sliceRender.backend;
  if (requested === "cpu") return "cpu";
  if (!sliceGpuAvailableKnown()) ensureSliceGpuRenderer();
  if (!sliceGpuAvailable()) return "cpu";
  if (requested === "gpu") return "gpu";
  const pixels = Math.max(1, width) * Math.max(1, height);
  return pixels >= 320 * 320 ? "gpu" : "cpu";
}

function normalizeDomainScaleFactor(raw) {
  const value = Number.parseFloat(raw);
  for (const candidate of DOMAIN_SCALE_FACTORS) {
    if (Math.abs(value - candidate) <= 1.0e-6) return candidate;
  }
  return 1;
}

function domainScaleFactor(domain) {
  const cfg = state.renderScale && typeof state.renderScale === "object" ? state.renderScale : null;
  const raw = cfg && Object.prototype.hasOwnProperty.call(cfg, domain) ? cfg[domain] : 1;
  return normalizeDomainScaleFactor(raw);
}

function spatialScaleFactor() {
  return domainScaleFactor("spatial");
}

function temporalScaleFactor() {
  return domainScaleFactor("temporal");
}

function spectralScaleFactor() {
  return domainScaleFactor("spectral");
}

function axisDomainScaleFactor(axis) {
  if (axis === "t") return temporalScaleFactor();
  if (axis === "nu") return spectralScaleFactor();
  if (axis === "x" || axis === "y" || axis === "z") return spatialScaleFactor();
  return 1;
}

function finiteLerp(v0, v1, a) {
  const has0 = Number.isFinite(v0);
  const has1 = Number.isFinite(v1);
  if (has0 && has1) return v0 * (1 - a) + v1 * a;
  if (has0) return v0;
  if (has1) return v1;
  return Number.NaN;
}

function catmullRomFinite(p0, p1, p2, p3, t) {
  const has0 = Number.isFinite(p0);
  const has1 = Number.isFinite(p1);
  const has2 = Number.isFinite(p2);
  const has3 = Number.isFinite(p3);
  if (!has1 && !has2) return Number.NaN;
  if (!has0 || !has1 || !has2 || !has3) {
    return finiteLerp(p1, p2, t);
  }
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function resampledDomainLength(n, factor) {
  if (!Number.isFinite(factor) || factor <= 0) return n;
  if (n <= 1) return n;
  return clamp(Math.round((n - 1) * factor) + 1, 2, 16384);
}

function resampleSeriesWithCoords(series, coords, factor) {
  const n = Array.isArray(series) ? series.length : 0;
  if (!Array.isArray(coords) || coords.length !== n || n < 2) {
    return { series, coords, sourceLength: n };
  }
  const targetN = resampledDomainLength(n, factor);
  if (targetN === n) {
    return { series, coords, sourceLength: n };
  }

  const outSeries = new Array(targetN);
  const outCoords = new Array(targetN);
  const srcSpan = n - 1;
  const dstSpan = targetN - 1;
  for (let i = 0; i < targetN; i += 1) {
    const srcPos = (i * srcSpan) / dstSpan;
    const i1 = clamp(Math.floor(srcPos), 0, n - 1);
    const i2 = clamp(i1 + 1, 0, n - 1);
    const t = srcPos - i1;
    const i0 = clamp(i1 - 1, 0, n - 1);
    const i3 = clamp(i2 + 1, 0, n - 1);
    outCoords[i] = finiteLerp(coords[i1], coords[i2], t);
    outSeries[i] = catmullRomFinite(series[i0], series[i1], series[i2], series[i3], t);
  }
  return {
    series: outSeries,
    coords: outCoords,
    sourceLength: n,
  };
}

function mappedIndicatorIndex(baseIdx, sourceLength, targetLength) {
  if (!Number.isFinite(baseIdx)) return null;
  if (!Number.isFinite(sourceLength) || !Number.isFinite(targetLength) || sourceLength < 2 || targetLength < 2) {
    return clamp(Math.round(baseIdx), 0, Math.max(0, targetLength - 1));
  }
  return clamp(Math.round((baseIdx * (targetLength - 1)) / Math.max(1, sourceLength - 1)), 0, targetLength - 1);
}

function rgbGpuAvailableKnown() {
  return state.rgbGpu.available !== null;
}

function rgbGpuAvailable() {
  return state.rgbGpu.available === true;
}

function rgbBackendMode(width = 0, height = 0) {
  const requested = state.sliceRender.backend;
  if (requested === "cpu") return "cpu";
  if (!rgbGpuAvailableKnown()) ensureRgbGpuRenderer();
  if (!rgbGpuAvailable()) return "cpu";
  if (requested === "gpu") return "gpu";
  const pixels = Math.max(1, width) * Math.max(1, height);
  return pixels >= 220 * 220 ? "gpu" : "cpu";
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
  setSliderFill(els.volumeIsoThresholdRange);
}

function setVolumeClipRangeActiveHandle(bound = null) {
  if (!els.volumeClipRangeMin || !els.volumeClipRangeMax) return;
  els.volumeClipRangeMin.classList.toggle("isActive", bound === "min");
  els.volumeClipRangeMax.classList.toggle("isActive", bound === "max");
}

function syncVolumeClipRangeStateFromSteps(activeBound = null) {
  if (!els.volumeClipRangeMin || !els.volumeClipRangeMax) return;
  const minStep = Number.parseInt(els.volumeClipRangeMin.value, 10);
  const maxStep = Number.parseInt(els.volumeClipRangeMax.value, 10);
  if (!Number.isFinite(minStep) || !Number.isFinite(maxStep)) return;

  let low = clamp(minStep / VOLUME_CLIP_RANGE_STEPS, 0, 0.95);
  let high = clamp(maxStep / VOLUME_CLIP_RANGE_STEPS, 0.05, 1);
  if (high <= low + VOLUME_CLIP_MIN_GAP) {
    if (activeBound === "min") high = clamp(low + VOLUME_CLIP_MIN_GAP, 0.05, 1);
    else low = clamp(high - VOLUME_CLIP_MIN_GAP, 0, 0.95);
  }
  low = clamp(low, 0, 0.95);
  high = clamp(high, low + VOLUME_CLIP_MIN_GAP, 1);
  state.volumeRender.clipNear = low;
  state.volumeRender.clipFar = high;
}

function updateVolumeClipRangeUi() {
  if (
    !els.volumeClipRangeTrack ||
    !els.volumeClipRangeMin ||
    !els.volumeClipRangeMax ||
    !els.volumeClipRangeMinValue ||
    !els.volumeClipRangeMaxValue
  ) {
    return;
  }
  const low = clamp(state.volumeRender.clipNear, 0, 0.95);
  const high = clamp(state.volumeRender.clipFar, Math.max(low + VOLUME_CLIP_MIN_GAP, 0.05), 1);
  state.volumeRender.clipNear = low;
  state.volumeRender.clipFar = high;

  const minStep = Math.round(low * VOLUME_CLIP_RANGE_STEPS);
  const maxStep = Math.round(high * VOLUME_CLIP_RANGE_STEPS);
  els.volumeClipRangeMin.value = String(minStep);
  els.volumeClipRangeMax.value = String(maxStep);

  const leftPct = (100 * minStep) / VOLUME_CLIP_RANGE_STEPS;
  const rightPct = (100 * maxStep) / VOLUME_CLIP_RANGE_STEPS;
  els.volumeClipRangeTrack.style.setProperty("--range-left", `${leftPct.toFixed(3)}%`);
  els.volumeClipRangeTrack.style.setProperty("--range-right", `${rightPct.toFixed(3)}%`);

  els.volumeClipRangeMinValue.textContent = low.toFixed(2);
  els.volumeClipRangeMaxValue.textContent = high.toFixed(2);
  setDualRangeLabelPosition(els.volumeClipRangeTrack, els.volumeClipRangeMinValue, leftPct);
  setDualRangeLabelPosition(els.volumeClipRangeTrack, els.volumeClipRangeMaxValue, rightPct);
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
  setDualRangeLabelPosition(els.volumeSphereRangeTrack, els.volumeSphereRangeMinValue, leftPct);
  setDualRangeLabelPosition(els.volumeSphereRangeTrack, els.volumeSphereRangeMaxValue, rightPct);
}

function setMultispectralRangeActiveHandle(bound = null) {
  if (!els.msChannelRangeMinRange || !els.msChannelRangeMaxRange) return;
  els.msChannelRangeMinRange.classList.toggle("isActive", bound === "min");
  els.msChannelRangeMaxRange.classList.toggle("isActive", bound === "max");
}

function syncMultispectralRangeUi() {
  if (
    !els.msChannelRangeTrack ||
    !els.msChannelRangeMinRange ||
    !els.msChannelRangeMaxRange ||
    !els.msChannelRangeMinValue ||
    !els.msChannelRangeMaxValue
  ) {
    return;
  }
  const normalized = normalizeMultispectralChannelRange(state.multiSpectralChannelRange);
  state.multiSpectralChannelRange = normalized;
  const minStep = Math.round((normalized.min / 100) * MULTISPECTRAL_RANGE_STEPS);
  const maxStep = Math.round((normalized.max / 100) * MULTISPECTRAL_RANGE_STEPS);
  els.msChannelRangeMinRange.value = String(minStep);
  els.msChannelRangeMaxRange.value = String(maxStep);
  const leftPct = (100 * minStep) / MULTISPECTRAL_RANGE_STEPS;
  const rightPct = (100 * maxStep) / MULTISPECTRAL_RANGE_STEPS;
  els.msChannelRangeTrack.style.setProperty("--range-left", `${leftPct.toFixed(3)}%`);
  els.msChannelRangeTrack.style.setProperty("--range-right", `${rightPct.toFixed(3)}%`);
  els.msChannelRangeMinValue.textContent = `${normalized.min.toFixed(1)}%`;
  els.msChannelRangeMaxValue.textContent = `${normalized.max.toFixed(1)}%`;
  setDualRangeLabelPosition(els.msChannelRangeTrack, els.msChannelRangeMinValue, leftPct);
  setDualRangeLabelPosition(els.msChannelRangeTrack, els.msChannelRangeMaxValue, rightPct);
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
  if (els.volumeIsoThresholdRange) els.volumeIsoThresholdRange.value = String(state.volumeRender.isoThreshold);
  if (els.volumeOpacityValue) els.volumeOpacityValue.textContent = `${state.volumeRender.opacity.toFixed(1)}x`;
  if (els.volumeGammaValue) els.volumeGammaValue.textContent = state.volumeRender.gamma.toFixed(2);
  if (els.volumeIsoThresholdValue) els.volumeIsoThresholdValue.textContent = state.volumeRender.isoThreshold.toFixed(2);
  const sphericalMode = isVolumeSphericalMode();
  const compositeLike = state.volumeRender.mode === "composite" || sphericalMode;
  const isoMode = state.volumeRender.mode === "isosurface";
  setVisible(els.volumeSphereProjectionLabel, sphericalMode);
  setVisible(els.volumeSphereNsiteLabel, sphericalMode);
  setVisible(els.volumeClipRangeBlock, !sphericalMode);
  setVisible(els.volumeSphereRangeBlock, sphericalMode);
  setVisible(els.volumeTfSelect ? els.volumeTfSelect.closest("label") : null, compositeLike);
  setVisible(els.volumeOpacityRange ? els.volumeOpacityRange.closest("label") : null, compositeLike);
  setVisible(els.volumeGammaRange ? els.volumeGammaRange.closest("label") : null, compositeLike);
  setVisible(els.volumeIsoThresholdLabel, isoMode);
  if (!sphericalMode) updateVolumeClipRangeUi();
  updateVolumeSphereRangeUi();
  updateVolumeSliderTrackFill();
  if (els.volumeBackendStatus) {
    els.volumeBackendStatus.textContent = "";
  }
}

function normalizeAngleRad(angle) {
  if (!Number.isFinite(angle)) return 0;
  const tau = Math.PI * 2;
  let out = angle % tau;
  if (out > Math.PI) out -= tau;
  if (out < -Math.PI) out += tau;
  return out;
}

function viewRotateModeActive() {
  return isVolumeMode() || isSphereMode();
}

function viewRotateLoopCanAdvance() {
  if (normalizeViewRotateRate(state.viewRotateRate) === 0) return false;
  if (!state.dataId || !viewRotateModeActive()) return false;
  if (state.volumeDrag || state.sphereDrag) return false;
  return true;
}

function syncLegacyViewRotateState() {
  const rate = normalizeViewRotateRate(state.viewRotateRate);
  state.viewRotateRate = rate;
  state.viewRotateEnabled = rate !== 0;
  state.viewRotateDirection = rate < 0 ? -1 : 1;
  state.viewRotateSpeed = normalizeViewRotateSpeed(Math.abs(rate) || 1);
  return rate;
}

function viewRotateRateLabel(rawRate) {
  const rate = normalizeViewRotateRate(rawRate);
  if (rate === 0) return "0x";
  const magnitude = Math.abs(rate);
  const speedLabel = Number.isInteger(magnitude) ? `${magnitude}x` : `${magnitude.toFixed(1)}x`;
  return `${rate > 0 ? "+" : "-"}${speedLabel}`;
}

function stopViewRotateLoop() {
  if (viewRotateRaf) {
    window.cancelAnimationFrame(viewRotateRaf);
    viewRotateRaf = 0;
  }
  viewRotateLastTs = 0;
  viewRotateLastRenderTs = 0;
  if (viewRotateSphereRefreshTimer) {
    window.clearTimeout(viewRotateSphereRefreshTimer);
    viewRotateSphereRefreshTimer = 0;
  }
}

function scheduleViewRotateSphereRefresh() {
  if (!isSphereMode() || !state.selection) return;
  if (viewRotateSphereRefreshTimer) return;
  viewRotateSphereRefreshTimer = window.setTimeout(async () => {
    viewRotateSphereRefreshTimer = 0;
    if (!isSphereMode() || !state.selection) return;
    try {
      await refreshSelectionAnalytics();
    } catch (err) {
      if (!isAbortError(err)) console.warn("sphere selection refresh failed:", err);
    }
  }, VIEW_ROTATE_SPHERE_REFRESH_MS);
}

function stepViewRotate(ts) {
  viewRotateRaf = 0;
  const rate = normalizeViewRotateRate(state.viewRotateRate);
  if (rate === 0) {
    stopViewRotateLoop();
    return;
  }
  if (!viewRotateLoopCanAdvance()) {
    const waitingForDrag =
      rate !== 0 && state.dataId && viewRotateModeActive() && (state.volumeDrag || state.sphereDrag);
    if (!waitingForDrag) {
      stopViewRotateLoop();
      return;
    }
    viewRotateLastTs = ts;
    if (!viewRotateRaf) viewRotateRaf = window.requestAnimationFrame(stepViewRotate);
    return;
  }

  const prevTs = viewRotateLastTs || ts;
  const dtSec = clamp((ts - prevTs) / 1000, 0, VIEW_ROTATE_MAX_DT_SEC);
  viewRotateLastTs = ts;
  const delta = VIEW_ROTATE_BASE_RATE_RAD_PER_SEC * rate * dtSec;
  if (delta !== 0) {
    if (isVolumeMode()) {
      applyVolumeAutoRotateDelta(delta);
    } else if (isSphereMode()) {
      applySphereAutoRotateDelta(delta);
    }
  }

  const minRenderMs = isVolumeMode() ? VIEW_ROTATE_MIN_RENDER_VOLUME_MS : VIEW_ROTATE_MIN_RENDER_SPHERE_MS;
  if (ts - viewRotateLastRenderTs >= minRenderMs) {
    viewRotateLastRenderTs = ts;
    if (isVolumeMode()) {
      rerenderVolumeFrame();
    } else if (isSphereMode()) {
      rerenderSphereFrame();
      scheduleViewRotateSphereRefresh();
    }
  }
  if (!viewRotateRaf) viewRotateRaf = window.requestAnimationFrame(stepViewRotate);
}

function ensureViewRotateLoop() {
  if (normalizeViewRotateRate(state.viewRotateRate) === 0) {
    stopViewRotateLoop();
    return;
  }
  if (!viewRotateRaf) viewRotateRaf = window.requestAnimationFrame(stepViewRotate);
}

function stepViewRotateRate(directionRaw) {
  const direction = directionRaw < 0 ? -1 : 1;
  const current = normalizeViewRotateRate(state.viewRotateRate);
  const idx = VIEW_ROTATE_RATE_STEP_LEVELS.indexOf(current);
  const safeIdx = idx >= 0 ? idx : VIEW_ROTATE_RATE_STEP_LEVELS.indexOf(0);
  const nextIdx = clamp(safeIdx + direction, 0, VIEW_ROTATE_RATE_STEP_LEVELS.length - 1);
  state.viewRotateRate = VIEW_ROTATE_RATE_STEP_LEVELS[nextIdx];
}

function updateViewRotateControls() {
  const rate = syncLegacyViewRotateState();
  const modeActive = viewRotateModeActive();
  const volumeMode = isVolumeMode();
  const sphereMode = isSphereMode();
  if (els.viewRotateNegBtn) {
    els.viewRotateNegBtn.disabled = !modeActive;
  }
  if (els.viewRotatePosBtn) {
    els.viewRotatePosBtn.disabled = !modeActive;
  }
  if (els.viewRotateSpeedValue) {
    els.viewRotateSpeedValue.textContent = viewRotateRateLabel(rate);
  }
  if (els.viewRotateRateControl) {
    els.viewRotateRateControl.classList.toggle("isActive", modeActive && rate !== 0);
  }
  if (els.viewRotateRebaseBtn) {
    setVisible(els.viewRotateRebaseBtn, volumeMode || sphereMode);
    els.viewRotateRebaseBtn.disabled = !modeActive || (!volumeMode && !sphereMode);
    els.viewRotateRebaseBtn.textContent = "Rebase";
    els.viewRotateRebaseBtn.title = volumeMode ? "Rebase volume rotate axis to the current view" : "Rebase sphere rotate axis";
    els.viewRotateRebaseBtn.setAttribute("aria-label", els.viewRotateRebaseBtn.title);
  }
  ensureViewRotateLoop();
}

function spatialLodMaxPixels(baseMaxPixels = null) {
  let maxPixels = Number.isFinite(baseMaxPixels) && baseMaxPixels > 0 ? Math.floor(baseMaxPixels) : null;
  const factor = spatialScaleFactor();
  if (!(factor < 1)) return maxPixels;
  const p = planeDims();
  const est = Math.max(1, axisSize(p.planeX)) * Math.max(1, axisSize(p.planeY));
  const scaled = Math.max(4096, Math.floor(est * factor * factor));
  if (maxPixels === null) return scaled;
  return Math.min(maxPixels, scaled);
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
  if (isSparseSceneView()) return false;
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

function multispectralFrameActive() {
  return (
    isMultiSpectralActive() ||
    Boolean(state.sampleMorph.multispectral) ||
    Boolean(state.currentMultispectralSlice) ||
    (Array.isArray(state.currentMultispectralTiles) && state.currentMultispectralTiles.length > 0)
  );
}

function multispectralDeslopeLabel() {
  const alpha = Number.isFinite(state.multiSpectralDeslope) ? state.multiSpectralDeslope : 0;
  return alpha.toFixed(1);
}

function normalizeMultispectralNormalizeBoost(raw) {
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 1.0;
  return clamp(parsed, 0.25, 8.0);
}

function multispectralNormalizeBoostLabel() {
  return `${normalizeMultispectralNormalizeBoost(state.multiSpectralNormalizeBoost).toFixed(2)}x`;
}

function normalizeMultispectralChannelRange(raw) {
  const out = { min: 0, max: 100 };
  if (raw && typeof raw === "object") {
    const minIn = Number.parseFloat(raw.min);
    const maxIn = Number.parseFloat(raw.max);
    if (Number.isFinite(minIn)) out.min = clamp(minIn, 0, 100);
    if (Number.isFinite(maxIn)) out.max = clamp(maxIn, 0, 100);
  }
  const minGapPct = 100 * MULTISPECTRAL_RANGE_MIN_GAP;
  if (out.max <= out.min + minGapPct) {
    out.max = clamp(out.min + minGapPct, minGapPct, 100);
    out.min = clamp(out.max - minGapPct, 0, 100 - minGapPct);
  }
  out.min = clamp(out.min, 0, 100 - minGapPct);
  out.max = clamp(out.max, out.min + minGapPct, 100);
  return out;
}

function multispectralChannelRangeFractionWindow() {
  let source = normalizeMultispectralChannelRange(state.multiSpectralChannelRange);
  if (multispectralFrameActive()) {
    const resolved = resolveColorNormWindow({ min: 0, max: 100 });
    if (resolved) {
      source = normalizeMultispectralChannelRange({ min: resolved.min, max: resolved.max });
    }
  }
  const normalized = source;
  state.multiSpectralChannelRange = normalized;
  return {
    min: normalized.min / 100,
    max: normalized.max / 100,
  };
}

function maxPositiveInArray(values, count = values?.length ?? 0) {
  if (!values || !Number.isFinite(count) || count < 1) return 0;
  let maxPositive = 0;
  const n = Math.min(values.length, Math.max(0, Math.floor(count)));
  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    if (v > maxPositive) maxPositive = v;
  }
  return maxPositive;
}

function applyMultispectralChannelRange(mm, rawMaxPositive) {
  const minBase = Number.isFinite(mm?.min) ? mm.min : 0;
  const maxBase = Number.isFinite(mm?.max) ? mm.max : 1;
  const baseHi = Math.max(0, Number.isFinite(rawMaxPositive) ? rawMaxPositive : maxBase);
  const fallbackLo = Math.min(minBase, maxBase);
  const fallbackHi = Math.max(minBase, maxBase);
  if (!(baseHi > 0)) {
    const spanFallback = Math.max(1.0e-9, fallbackHi - fallbackLo || 1);
    return {
      min: fallbackLo,
      max: fallbackHi,
      span: spanFallback,
      minPositive: Math.max(0, fallbackLo),
      maxPositive: Math.max(0, fallbackHi),
    };
  }
  const window = multispectralChannelRangeFractionWindow();
  let minV = baseHi * clamp(window.min, 0, 1);
  let maxV = baseHi * clamp(window.max, 0, 1);
  if (maxV <= minV) {
    const minGap = baseHi * MULTISPECTRAL_RANGE_MIN_GAP;
    maxV = Math.min(baseHi, minV + minGap);
    minV = Math.max(0, maxV - minGap);
  }
  const span = Math.max(1.0e-9, maxV - minV);
  return {
    min: minV,
    max: maxV,
    span,
    minPositive: Math.max(0, minV),
    maxPositive: Math.max(0, maxV),
  };
}

function multispectralBandCenterHz(band) {
  if (!Array.isArray(band) || band.length < 2) return Number.NaN;
  const lo = Number.parseFloat(band[0]);
  const hi = Number.parseFloat(band[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return Number.NaN;
  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);
  if (low > 0 && high > 0) return Math.sqrt(low * high);
  return 0.5 * (low + high);
}

function multispectralCorrectionGains(payload, targetAlpha = state.multiSpectralDeslope) {
  const bands = payload && payload.bands ? payload.bands : null;
  if (!bands) return [1, 1, 1];
  const alphaTarget = Number.isFinite(targetAlpha) ? targetAlpha : 0;
  const alphaBase = Number.isFinite(bands.deslope) ? bands.deslope : 0;
  const deltaAlpha = alphaTarget - alphaBase;
  if (Math.abs(deltaAlpha) <= 1.0e-8) return [1, 1, 1];

  const ref = Number.isFinite(bands.deslope_ref) ? bands.deslope_ref : null;
  if (!(ref > 0)) return [1, 1, 1];
  const gainForBand = (band) => {
    const center = multispectralBandCenterHz(band);
    if (!(center > 0)) return 1;
    const gain = (center / ref) ** deltaAlpha;
    return Number.isFinite(gain) && gain > 0 ? gain : 1;
  };
  return [gainForBand(bands.red), gainForBand(bands.green), gainForBand(bands.blue)];
}

function multispectralChromaPreviewBoost(payload) {
  const bands = payload && payload.bands ? payload.bands : null;
  if (!bands || !bands.normalize_spectrum) return 1;
  const baseBoost = Number.isFinite(bands.normalize_spectrum_boost) ? bands.normalize_spectrum_boost : 1;
  const targetBoost = state.multiSpectralNormalizeSpectrum
    ? normalizeMultispectralNormalizeBoost(state.multiSpectralNormalizeBoost)
    : 1;
  return clamp(targetBoost / Math.max(0.25, baseBoost), 0.25, 8.0);
}

function multispectralRangeWindowFromPercent(minPct, maxPct) {
  const min = Number.isFinite(minPct) ? clamp(minPct / 100, 0, 1) : 0;
  const max = Number.isFinite(maxPct) ? clamp(maxPct / 100, 0, 1) : 1;
  if (max <= min + MULTISPECTRAL_RANGE_MIN_GAP) {
    const hi = clamp(min + MULTISPECTRAL_RANGE_MIN_GAP, MULTISPECTRAL_RANGE_MIN_GAP, 1);
    return {
      min: clamp(hi - MULTISPECTRAL_RANGE_MIN_GAP, 0, 1 - MULTISPECTRAL_RANGE_MIN_GAP),
      max: hi,
    };
  }
  return { min, max };
}

function multispectralFluxScaleMode(rawMode) {
  return rawMode === "log" ? "log" : rawMode === "sqrt" ? "sqrt" : "linear";
}

function multispectralBrightnessFractionFromDisplay(displayValue, fluxScale, rangeWindow) {
  const value = clamp(Number.isFinite(displayValue) ? displayValue : 0, 0, 1);
  const min = clamp(Number.isFinite(rangeWindow?.min) ? rangeWindow.min : 0, 0, 1);
  const max = clamp(Number.isFinite(rangeWindow?.max) ? rangeWindow.max : 1, min + 1.0e-9, 1);
  if (fluxScale === "log") {
    const lo = min > 0 ? min : Math.max(max / 2500.0, 1.0e-30);
    const hi = Math.max(max, lo * (1.0 + 1.0e-12));
    return clamp(lo * Math.exp(value * Math.log(hi / lo)), 0, 1);
  }
  const linear = fluxScale === "sqrt" ? value * value : value;
  return clamp(min + linear * Math.max(1.0e-9, max - min), 0, 1);
}

function multispectralBrightnessDisplayFromFraction(rawFraction, fluxScale, rangeWindow) {
  const raw = clamp(Number.isFinite(rawFraction) ? rawFraction : 0, 0, 1);
  const min = clamp(Number.isFinite(rangeWindow?.min) ? rangeWindow.min : 0, 0, 1);
  const max = clamp(Number.isFinite(rangeWindow?.max) ? rangeWindow.max : 1, min + 1.0e-9, 1);
  if (fluxScale === "log") {
    const lo = min > 0 ? min : Math.max(max / 2500.0, 1.0e-30);
    const hi = Math.max(max, lo * (1.0 + 1.0e-12));
    const clipped = clamp(raw, lo, hi);
    return clamp((Math.log(clipped / lo) / Math.log(hi / lo)), 0, 1);
  }
  const linear = clamp((raw - min) / Math.max(1.0e-9, max - min), 0, 1);
  return fluxScale === "sqrt" ? Math.sqrt(linear) : linear;
}

function multispectralPreviewBrightness(displayValue, preview) {
  if (!preview) return clamp(Number.isFinite(displayValue) ? displayValue : 0, 0, 1);
  const rawFraction = multispectralBrightnessFractionFromDisplay(displayValue, preview.baseFluxScale, preview.baseRange);
  return multispectralBrightnessDisplayFromFraction(rawFraction, preview.targetFluxScale, preview.targetRange);
}

function buildMultispectralLocalPreview(payload) {
  const bands = payload && payload.bands ? payload.bands : null;
  if (!bands) return null;
  const targetRange = multispectralChannelRangeFractionWindow();
  return {
    gains: multispectralCorrectionGains(payload),
    chromaBoost: multispectralChromaPreviewBoost(payload),
    baseFluxScale: multispectralFluxScaleMode(bands.intensity_scale),
    targetFluxScale: multispectralFluxScaleMode(state.fluxScale),
    baseRange: multispectralRangeWindowFromPercent(bands.range_min, bands.range_max),
    targetRange,
  };
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

function viewerMinCenterWidth() {
  const baseMin = 460;
  if (!els.viewerPanel) return baseMin;
  const panelStyles = window.getComputedStyle(els.viewerPanel);
  const panelPadLeft = Number.parseFloat(panelStyles.paddingLeft || "0") || 0;
  const panelPadRight = Number.parseFloat(panelStyles.paddingRight || "0") || 0;
  let toolbarMin = 0;
  if (els.viewerToolbar) {
    const toolbarStyles = window.getComputedStyle(els.viewerToolbar);
    const gap = Number.parseFloat(toolbarStyles.columnGap || toolbarStyles.gap || "0") || 0;
    const children = Array.from(els.viewerToolbar.children).filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
    if (children.length) {
      const contentW = children.reduce((acc, child) => {
        const childStyles = window.getComputedStyle(child);
        const marginLeft = Number.parseFloat(childStyles.marginLeft || "0") || 0;
        const marginRight = Number.parseFloat(childStyles.marginRight || "0") || 0;
        const childW = Math.max(child.scrollWidth || 0, child.getBoundingClientRect().width || 0);
        return acc + childW + marginLeft + marginRight;
      }, 0);
      toolbarMin = Math.ceil(contentW + gap * Math.max(0, children.length - 1));
    }
  }
  return Math.max(baseMin, Math.ceil(toolbarMin + panelPadLeft + panelPadRight));
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
  const minLeft = 300;
  const minRight = 250;
  const minCenter = viewerMinCenterWidth();

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

function requestResizeRedraw(interactive = false) {
  if (!interactive) state._resizePanelsNeedsGraphs = true;
  if (state._resizePanelsRaf) return;
  state._resizePanelsRaf = window.requestAnimationFrame(() => {
    state._resizePanelsRaf = 0;
    const drawGraphs = Boolean(state._resizePanelsNeedsGraphs);
    state._resizePanelsNeedsGraphs = false;
    layoutViewerCanvas();
    drawFrameAndOverlays();
    if (drawGraphs) {
      drawNavigationGraphs();
      drawSelectionGraphs();
    }
    drawColorbar();
  });
}

function canvasDomainScaleFactor(canvasEl) {
  if (!canvasEl) return 1;
  if (canvasEl === els.timeNavCanvas || canvasEl === els.timeProfileCanvas) return temporalScaleFactor();
  if (canvasEl === els.freqNavCanvas || canvasEl === els.spectrumProfileCanvas) return spectralScaleFactor();
  return spatialScaleFactor();
}

function syncCanvasToDisplaySize(canvasEl) {
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(canvasEl.clientWidth || rect.width || canvasEl.width || 1));
  const cssH = Math.max(1, Math.round(canvasEl.clientHeight || rect.height || canvasEl.height || 1));
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const domainScale = clamp(canvasDomainScaleFactor(canvasEl), 0.25, 8);
  const pixelW = Math.max(1, Math.round(cssW * dpr * domainScale));
  const pixelH = Math.max(1, Math.round(cssH * dpr * domainScale));
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
  const canvasW = Math.max(120, panelW);
  const canvasH = Math.max(120, Math.min(availablePanelH, availableViewportH));
  const canvasWPx = `${Math.floor(canvasW)}px`;
  const canvasHPx = `${Math.floor(canvasH)}px`;

  els.canvas.style.width = canvasWPx;
  els.canvas.style.height = canvasHPx;
  if (els.colorbarPanel) els.colorbarPanel.style.width = canvasWPx;
}

function applyPanelWidths(left, right, persist = true, interactive = false) {
  if (isNarrowLayout()) return;
  const next = clampPanelWidths(left, right);
  state.panelWidths.left = next.left;
  state.panelWidths.right = next.right;
  document.documentElement.style.setProperty("--left-col", `${Math.round(next.left)}px`);
  document.documentElement.style.setProperty("--right-col", `${Math.round(next.right)}px`);
  if (persist) persistPanelWidths(next.left, next.right);
  requestResizeRedraw(interactive);
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
        applyPanelWidths(nextLeft, start.right, false, true);
      } else {
        const nextRight = start.right - dx;
        applyPanelWidths(start.left, nextRight, false, true);
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
  const displayCoord = axisValueCoord(dim, coord);
  if (!Number.isFinite(displayCoord)) return "n/a";
  const hasCustomUnit = axisHasCustomUnit(dim);
  const formatScaled = (value, scale, scaledUnit) => {
    const scaled = value / scale;
    const absScaled = Math.abs(scaled);
    let decimals = 2;
    if (absScaled >= 100) decimals = 0;
    else if (absScaled >= 10) decimals = 1;
    return `${scaled.toFixed(decimals)} ${scaledUnit}`.trim();
  };
  if (!hasCustomUnit && (dim === "nu" || unit === "Hz")) {
    const abs = Math.abs(displayCoord);
    if (abs >= 1.0e12) return formatScaled(displayCoord, 1.0e12, "THz");
    if (abs >= 1.0e9) return formatScaled(displayCoord, 1.0e9, "GHz");
    if (abs >= 1.0e6) return formatScaled(displayCoord, 1.0e6, "MHz");
    if (abs >= 1.0e3) return formatScaled(displayCoord, 1.0e3, "kHz");
    return formatScaled(displayCoord, 1.0, "Hz");
  }
  if (!hasCustomUnit && (dim === "t" || unit === "s")) {
    const abs = Math.abs(displayCoord);
    if (abs >= 3600) return formatScaled(displayCoord, 3600, "h");
    if (abs >= 60) return formatScaled(displayCoord, 60, "min");
    if (abs >= 1) return formatScaled(displayCoord, 1, "s");
    if (abs >= 1.0e-3) return formatScaled(displayCoord, 1.0e-3, "ms");
    if (abs >= 1.0e-6) return formatScaled(displayCoord, 1.0e-6, "us");
    return formatScaled(displayCoord, 1.0e-9, "ns");
  }
  const abs = Math.abs(displayCoord);
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return `${displayCoord.toExponential(2)} ${unit}`.trim();
  return `${displayCoord.toFixed(2)} ${unit}`.trim();
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
  const displayV = axisValueCoord(axis, v);
  if (!Number.isFinite(displayV)) return "";
  if (!axisHasCustomUnit(axis) && (axis === "nu" || unit === "Hz")) return (displayV / 1.0e9).toFixed(3);
  const abs = Math.abs(displayV);
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return displayV.toExponential(1);
  return displayV.toFixed(2);
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
  if (!isFiniteNumber(v)) return 0;
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
  if (isSparseSceneView()) return ["none"];
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
  els.colorRangeModeSelect.disabled = isSparseSceneView();
  els.colorRangeModeSelect.title = isSparseSceneView()
    ? "Sparse Scene views use statistics from the requested plane; no whole-domain range is computed."
    : "";
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

function normalizeColorNormWindowValue(window) {
  if (!window || typeof window !== "object") return { min: null, max: null };
  const min = Number.isFinite(window.min) ? window.min : null;
  const max = Number.isFinite(window.max) ? window.max : null;
  return { min, max };
}

function colorNormWindowsByQuantityState() {
  if (!state.colorNormWindowsByQuantity || typeof state.colorNormWindowsByQuantity !== "object") {
    state.colorNormWindowsByQuantity = {};
  }
  return state.colorNormWindowsByQuantity;
}

function intensityQuantityKey(
  options = {
    sampleMode: state.sampleMode,
    derivedPolMode: state.derivedPolMode,
    multiSpectral: state.multiSpectral || multispectralFrameActive(),
    spatialMode: state.spatialMode,
  }
) {
  const sampleMode = options.sampleMode ?? state.sampleMode;
  const derivedPolMode = options.derivedPolMode ?? state.derivedPolMode;
  const multiSpectral = options.multiSpectral ?? state.multiSpectral;
  const spatialMode = options.spatialMode ?? state.spatialMode;
  if (multiSpectral && spatialMode !== "volume") return "multispectral";
  if (derivedPolMode && derivedPolMode !== "none") return `derived:${derivedPolMode}`;
  if (sampleMode === "std") return "sample:std";
  if (sampleMode === "rel_uncert") return "sample:rel_uncert";
  return "flux";
}

function saveColorNormWindowForQuantity(key) {
  if (!key) return;
  const map = colorNormWindowsByQuantityState();
  map[key] = normalizeColorNormWindowValue(state.colorNormValueWindow);
}

function restoreColorNormWindowForQuantity(key) {
  const map = colorNormWindowsByQuantityState();
  const restored = map[key];
  state.colorNormValueWindow = normalizeColorNormWindowValue(restored);
}

function rememberCurrentQuantityColorNormWindow() {
  saveColorNormWindowForQuantity(intensityQuantityKey());
}

function applyIntensityQuantityTransition(previousKey, nextKey) {
  if (!previousKey || !nextKey || previousKey === nextKey) return false;
  saveColorNormWindowForQuantity(previousKey);
  restoreColorNormWindowForQuantity(nextKey);
  updateColorNormalizationControls();
  return true;
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
  if (multispectralFrameActive()) {
    return { min: 0, max: 100 };
  }
  if (isValidRangeStats(state.fixedColorRange)) return state.fixedColorRange;
  if (isValidRangeStats(state.currentIntensityStats)) return state.currentIntensityStats;
  return null;
}

function updateColorNormalizationControls() {
  if (!els.colorNormMinRange || !els.colorNormMaxRange || !els.colorNormTrack) return;
  const base = activeIntensityBaseStats();
  const resolved = resolveColorNormWindow(base);
  const multispectral = multispectralFrameActive();
  const enabled = Boolean(resolved);

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
    setDualRangeLabelPosition(els.colorNormTrack, el, pct);
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
  const fmtPct = (v) => `${v.toFixed(v < 1 ? 3 : v < 10 ? 2 : 1)}%`;
  if (els.colorNormBoundMin) {
    els.colorNormBoundMin.textContent = multispectral ? "0%" : `${fmtIntensity(base.min)} ${unit}`.trim();
  }
  if (els.colorNormBoundMax) {
    els.colorNormBoundMax.textContent = multispectral ? "100%" : `${fmtIntensity(base.max)} ${unit}`.trim();
  }
  if (resolved) {
    if (multispectral) {
      state.multiSpectralChannelRange = normalizeMultispectralChannelRange({ min: resolved.min, max: resolved.max });
      setRangeValueLabel(els.colorNormMinValue, fmtPct(resolved.min), leftPct);
      setRangeValueLabel(els.colorNormMaxValue, fmtPct(resolved.max), rightPct);
    } else {
      setRangeValueLabel(els.colorNormMinValue, `${fmtIntensity(resolved.min)} ${unit}`.trim(), leftPct);
      setRangeValueLabel(els.colorNormMaxValue, `${fmtIntensity(resolved.max)} ${unit}`.trim(), rightPct);
    }
    return;
  }
  setRangeValueLabel(els.colorNormMinValue, "n/a", 25);
  setRangeValueLabel(els.colorNormMaxValue, "n/a", 75);
}

const SPECTRAL_CMF_START_NM = 380.0;
const SPECTRAL_CMF_END_NM = 780.0;
const SPECTRAL_CMF_STEP_NM = 5.0;
const SPECTRAL_VISIBLE_MIN_NM = 400.0;
const SPECTRAL_VISIBLE_MAX_NM = 700.0;
const SPECTRAL_XYZ_CMF_X = [
  0.000160, 0.000662, 0.002362, 0.007242, 0.019110, 0.043400, 0.084736, 0.140638, 0.204492, 0.264737, 0.314679,
  0.357719, 0.383734, 0.386726, 0.370702, 0.342957, 0.302273, 0.254085, 0.195618, 0.132349, 0.080507, 0.041072,
  0.016172, 0.005132, 0.003816, 0.015444, 0.037465, 0.071358, 0.117749, 0.172953, 0.236491, 0.304213, 0.376772,
  0.451584, 0.529826, 0.616053, 0.705224, 0.793832, 0.878655, 0.951162, 1.014160, 1.074300, 1.118520, 1.134300,
  1.123990, 1.089100, 1.030480, 0.950740, 0.856297, 0.754930, 0.647467, 0.535110, 0.431567, 0.343690, 0.268329,
  0.204300, 0.152568, 0.112210, 0.081261, 0.057930, 0.040851, 0.028623, 0.019941, 0.013842, 0.009577, 0.006605,
  0.004553, 0.003145, 0.002175, 0.001506, 0.001045, 0.000727, 0.000508, 0.000356, 0.000251, 0.000178, 0.000126,
  0.000090, 0.000065, 0.000046, 0.000033,
];
const SPECTRAL_XYZ_CMF_Y = [
  0.000017, 0.000072, 0.000253, 0.000769, 0.002004, 0.004509, 0.008756, 0.014456, 0.021391, 0.029497, 0.038676,
  0.049602, 0.062077, 0.074704, 0.089456, 0.106256, 0.128201, 0.152761, 0.185190, 0.219940, 0.253589, 0.297665,
  0.339133, 0.395379, 0.460777, 0.531360, 0.606741, 0.685660, 0.761757, 0.823330, 0.875211, 0.923810, 0.961988,
  0.982200, 0.991761, 0.999110, 0.997340, 0.982380, 0.955552, 0.915175, 0.868934, 0.825623, 0.777405, 0.720353,
  0.658341, 0.593878, 0.527963, 0.461834, 0.398057, 0.339554, 0.283493, 0.228254, 0.179828, 0.140211, 0.107633,
  0.081187, 0.060281, 0.044096, 0.031800, 0.022602, 0.015905, 0.011130, 0.007749, 0.005375, 0.003718, 0.002565,
  0.001768, 0.001222, 0.000846, 0.000586, 0.000407, 0.000284, 0.000199, 0.000140, 0.000098, 0.000070, 0.000050,
  0.000036, 0.000025, 0.000018, 0.000013,
];
const SPECTRAL_XYZ_CMF_Z = [
  0.000705, 0.002928, 0.010482, 0.032344, 0.086011, 0.197120, 0.389366, 0.656760, 0.972542, 1.282500, 1.553480,
  1.798500, 1.967280, 2.027300, 1.994800, 1.900700, 1.745370, 1.554900, 1.317560, 1.030200, 0.772125, 0.570060,
  0.415254, 0.302356, 0.218502, 0.159249, 0.112044, 0.082248, 0.060709, 0.043050, 0.030451, 0.020584, 0.013676,
  0.007918, 0.003988, 0.001091, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
  0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
  0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
  0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000,
  0.000000, 0.000000, 0.000000, 0.000000,
];
const SPECTRAL_XYZ_TO_SRGB_D65 = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252],
];

function multispectralNuMapper(bands) {
  if (!bands) return null;
  let nuMin = Number.POSITIVE_INFINITY;
  let nuMax = Number.NEGATIVE_INFINITY;
  for (const band of [bands.red, bands.green, bands.blue]) {
    if (!Array.isArray(band) || band.length < 2) continue;
    const a = Number.parseFloat(band[0]);
    const b = Number.parseFloat(band[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    nuMin = Math.min(nuMin, a, b);
    nuMax = Math.max(nuMax, a, b);
  }
  if (!Number.isFinite(nuMin) || !Number.isFinite(nuMax) || !(nuMax > nuMin)) return null;
  const requestedAxisScale = bands.axis_scale === "log" ? "log" : "linear";
  const axisScale = requestedAxisScale === "log" && nuMin > 0 ? "log" : "linear";
  const axisFromNu = (nu) => (axisScale === "log" ? Math.log10(Math.max(nu, 1.0e-30)) : nu);
  const nuFromAxis = (axisCoord) => (axisScale === "log" ? 10 ** axisCoord : axisCoord);
  const axisMin = axisFromNu(nuMin);
  const axisMax = axisFromNu(nuMax);
  const axisSpan = Math.max(1.0e-9, axisMax - axisMin);
  return {
    nuMin,
    nuMax,
    axisScale,
    axisFromNu,
    nuFromAxis,
    axisMin,
    axisMax,
    axisSpan,
  };
}

function wavelengthFromMappedNu(freqHz, mapper) {
  const t = clamp((mapper.axisFromNu(freqHz) - mapper.axisMin) / mapper.axisSpan, 0, 1);
  return SPECTRAL_VISIBLE_MAX_NM - t * (SPECTRAL_VISIBLE_MAX_NM - SPECTRAL_VISIBLE_MIN_NM);
}

function interpolateCmfChannel(channel, wavelengthNm) {
  const lambdaNm = clamp(wavelengthNm, SPECTRAL_CMF_START_NM, SPECTRAL_CMF_END_NM);
  const f = (lambdaNm - SPECTRAL_CMF_START_NM) / SPECTRAL_CMF_STEP_NM;
  const i0 = clamp(Math.floor(f), 0, channel.length - 1);
  const i1 = clamp(i0 + 1, 0, channel.length - 1);
  const t = clamp(f - i0, 0, 1);
  return channel[i0] * (1 - t) + channel[i1] * t;
}

function gammaEncodeSrgb(linearValue) {
  if (linearValue <= 0.0031308) return 12.92 * linearValue;
  return 1.055 * Math.max(linearValue, 0.0031308) ** (1 / 2.4) - 0.055;
}

function colorForWavelengthDelta(wavelengthNm) {
  const x = interpolateCmfChannel(SPECTRAL_XYZ_CMF_X, wavelengthNm);
  const y = interpolateCmfChannel(SPECTRAL_XYZ_CMF_Y, wavelengthNm);
  const z = interpolateCmfChannel(SPECTRAL_XYZ_CMF_Z, wavelengthNm);
  const rLinear = x * SPECTRAL_XYZ_TO_SRGB_D65[0][0] + y * SPECTRAL_XYZ_TO_SRGB_D65[0][1] + z * SPECTRAL_XYZ_TO_SRGB_D65[0][2];
  const gLinear = x * SPECTRAL_XYZ_TO_SRGB_D65[1][0] + y * SPECTRAL_XYZ_TO_SRGB_D65[1][1] + z * SPECTRAL_XYZ_TO_SRGB_D65[1][2];
  const bLinear = x * SPECTRAL_XYZ_TO_SRGB_D65[2][0] + y * SPECTRAL_XYZ_TO_SRGB_D65[2][1] + z * SPECTRAL_XYZ_TO_SRGB_D65[2][2];
  const r = clamp(gammaEncodeSrgb(rLinear), 0, 1);
  const g = clamp(gammaEncodeSrgb(gLinear), 0, 1);
  const b = clamp(gammaEncodeSrgb(bLinear), 0, 1);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function colorForSpectralNu(freqHz, bands, mapper = null) {
  const map = mapper || multispectralNuMapper(bands);
  if (!map) return [255, 255, 255];
  return colorForWavelengthDelta(wavelengthFromMappedNu(freqHz, map));
}

const LOG_SCALE_FLOOR_RATIO = 1.0e-6;

function normalizeFluxLog(v, maxPositive, minPositive = 0) {
  if (!isFiniteNumber(v)) return 0;
  const lo = Math.max(0, minPositive);
  if (v < 0 && lo <= 0) return 0;
  const hi = Math.max(lo, maxPositive);
  if (!(hi > 0)) return 0;
  const loEff = lo > 0 ? Math.min(lo, hi) : Math.max(hi * LOG_SCALE_FLOOR_RATIO, 1.0e-30);
  if (!(hi > loEff)) return 0;
  const sample = clamp(v, loEff, hi);
  const loLog = Math.log10(loEff);
  const hiLog = Math.log10(hi);
  const span = hiLog - loLog;
  if (!(span > 0)) return 0;
  return (Math.log10(sample) - loLog) / span;
}

function normalizeFluxSqrt(v, mm) {
  if (!isFiniteNumber(v)) return 0;
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
  const imgW = axisSize(p.planeX);
  const imgH = axisSize(p.planeY);
  const base = sliceFullViewWindow(imgW, imgH);
  state.view.w = base.w;
  state.view.h = base.h;
  state.view.u = 0.5 * (imgW - base.w);
  state.view.v = 0.5 * (imgH - base.h);
}

function sphereZoomOutLimit() {
  if (!isSphereMode()) return GLOBAL_ZOOM_OUT_FACTOR;
  if (state.sphereProjection === "outside") return GLOBAL_ZOOM_OUT_FACTOR;
  if (state.sphereProjection === "inside") return 1.0;
  return GLOBAL_ZOOM_OUT_FACTOR;
}

function sphereInsideRenderScale() {
  const s = Number.isFinite(state.sphereInsideScale) ? state.sphereInsideScale : SPHERE_INSIDE_SCALE;
  return clamp(s, SPHERE_INSIDE_SCALE_MIN, SPHERE_INSIDE_SCALE_MAX);
}

function mollweideViewAspect(imgW = null, imgH = null) {
  const w = Number.isFinite(imgW) && imgW > 0 ? imgW : Number.isFinite(els?.canvas?.width) ? els.canvas.width : 1;
  const h = Number.isFinite(imgH) && imgH > 0 ? imgH : Number.isFinite(els?.canvas?.height) ? els.canvas.height : 1;
  return Math.max(1.0e-6, w / Math.max(1.0e-6, h));
}

function sliceViewAspect(imgW = null, imgH = null) {
  const w = Number.isFinite(imgW) && imgW > 0 ? imgW : Number.isFinite(els?.canvas?.width) ? els.canvas.width : 1;
  const h = Number.isFinite(imgH) && imgH > 0 ? imgH : Number.isFinite(els?.canvas?.height) ? els.canvas.height : 1;
  return Math.max(1.0e-6, w / Math.max(1.0e-6, h));
}

function sliceFullViewWindow(imgW, imgH) {
  const a = sliceViewAspect(imgW, imgH);
  const imgAspect = imgW / Math.max(1.0e-6, imgH);
  if (imgAspect >= a) {
    const w = imgW;
    return { w, h: w / a };
  }
  const h = imgH;
  return { w: h * a, h };
}

function mollweideFullViewWindow(imgW, imgH) {
  const a = mollweideViewAspect(imgW, imgH);
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
  const imgW = tileRef
    ? canvasLogicalWidth(tileRef)
    : state.frameCanvas
    ? canvasLogicalWidth(state.frameCanvas)
    : axisSize(p.planeX);
  const imgH = tileRef
    ? canvasLogicalHeight(tileRef)
    : state.frameCanvas
    ? canvasLogicalHeight(state.frameCanvas)
    : axisSize(p.planeY);

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

  if (!isSphereMode()) {
    const base = sliceFullViewWindow(imgW, imgH);
    const targetAspect = base.w / Math.max(1.0e-6, base.h);
    const minW = Math.min(2, base.w);
    const minH = Math.min(2, base.h);
    const maxW = base.w * GLOBAL_ZOOM_OUT_FACTOR;
    const maxH = base.h * GLOBAL_ZOOM_OUT_FACTOR;

    let w = state.view.w;
    let h = state.view.h;
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      w = base.w;
      h = base.h;
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

function shouldUseCoverView(viewRect) {
  const eps = 2.5e-3;
  const zoomedIn =
    viewRect.srcW < viewRect.imgW * (1 - eps) || viewRect.srcH < viewRect.imgH * (1 - eps);
  if (!isSphereMode()) return zoomedIn;
  if (state.sphereProjection === "inside") {
    return true;
  }
  return zoomedIn;
}

function cropViewRectToAspect(viewRect, targetAspect) {
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return viewRect;
  const eps = 1.0e-6;
  const srcAspect = viewRect.srcW / Math.max(1e-6, viewRect.srcH);
  if (Math.abs(srcAspect - targetAspect) <= eps) return viewRect;

  let srcX = viewRect.srcX;
  let srcY = viewRect.srcY;
  let srcW = viewRect.srcW;
  let srcH = viewRect.srcH;

  if (srcAspect > targetAspect + eps) {
    srcW = srcH * targetAspect;
    srcX += 0.5 * (viewRect.srcW - srcW);
  } else if (srcAspect < targetAspect - eps) {
    srcH = srcW / targetAspect;
    srcY += 0.5 * (viewRect.srcH - srcH);
  }

  return {
    srcX,
    srcY,
    srcW,
    srcH,
    imgW: viewRect.imgW,
    imgH: viewRect.imgH,
  };
}

function sampleGridLayoutMetrics() {
  const grid = Math.max(1, state.frameGrid || 1);
  const cw = Math.max(1, els.canvas.width);
  const ch = Math.max(1, els.canvas.height);
  const s = canvasPixelRatio(els.canvas);
  const gap = grid > 1 ? 6 * s : 0;
  const cellW = Math.max(8 * s, (cw - gap * (grid - 1)) / grid);
  const cellH = Math.max(8 * s, (ch - gap * (grid - 1)) / grid);
  const gridW = cellW * grid + gap * (grid - 1);
  const gridH = cellH * grid + gap * (grid - 1);
  return {
    grid,
    gap,
    cellW,
    cellH,
    gridW,
    gridH,
    startX: (cw - gridW) / 2,
    startY: (ch - gridH) / 2,
  };
}

function getRenderGeometry(baseViewRect = null) {
  const viewRect = baseViewRect || getViewRect();
  const baseDrawRect = getDrawRect(viewRect);
  if (!els.canvas) return { viewRect, drawRect: baseDrawRect };
  const useCover = shouldUseCoverView(viewRect);
  if (state.frameTiles && state.frameTiles.length) {
    if (!useCover) return { viewRect, drawRect: baseDrawRect };
    const layout = sampleGridLayoutMetrics();
    const adjusted = cropViewRectToAspect(viewRect, layout.cellW / Math.max(1e-6, layout.cellH));
    return { viewRect: adjusted, drawRect: baseDrawRect };
  }
  if (!useCover) return { viewRect, drawRect: baseDrawRect };

  const cw = Math.max(1, els.canvas.width);
  const ch = Math.max(1, els.canvas.height);
  const adjusted = cropViewRectToAspect(viewRect, cw / Math.max(1e-6, ch));

  return {
    viewRect: adjusted,
    drawRect: { x: 0, y: 0, w: cw, h: ch },
  };
}

function planeAxisFlipState() {
  if (isVolumeMode() || isSphereMode()) {
    return { flipU: false, flipV: false };
  }
  const p = planeDims();
  return {
    flipU: axisIsFlipped(p.planeX),
    flipV: axisIsFlipped(p.planeY),
  };
}

function drawImageWithPlaneFlip(ctx, image, srcRect, drawRect) {
  const { flipU, flipV } = planeAxisFlipState();
  if (!flipU && !flipV) {
    ctx.drawImage(
      image,
      srcRect.srcX,
      srcRect.srcY,
      srcRect.srcW,
      srcRect.srcH,
      drawRect.x,
      drawRect.y,
      drawRect.w,
      drawRect.h
    );
    return;
  }

  ctx.save();
  ctx.translate(drawRect.x + (flipU ? drawRect.w : 0), drawRect.y + (flipV ? drawRect.h : 0));
  ctx.scale(flipU ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(image, srcRect.srcX, srcRect.srcY, srcRect.srcW, srcRect.srcH, 0, 0, drawRect.w, drawRect.h);
  ctx.restore();
}

function getGridDrawRects(viewRect) {
  const layout = sampleGridLayoutMetrics();
  const { grid, gap, cellW, cellH, gridW, gridH, startX, startY } = layout;
  const srcAspect = viewRect.srcW / Math.max(1e-6, viewRect.srcH);
  const cellAspect = cellW / Math.max(1e-6, cellH);
  const useCover = shouldUseCoverView(viewRect);
  const tiles = [];
  const nTiles = state.frameTiles ? state.frameTiles.length : 0;

  for (let i = 0; i < nTiles; i += 1) {
    const row = Math.floor(i / grid);
    const col = i % grid;
    const cellX = startX + col * (cellW + gap);
    const cellY = startY + row * (cellH + gap);

    let w = cellW;
    let h = cellH;
    if (!useCover) {
      if (srcAspect >= cellAspect) {
        w = cellW;
        h = w / srcAspect;
      } else {
        h = cellH;
        w = h * srcAspect;
      }
    }
    tiles.push({
      x: cellX + (cellW - w) / 2,
      y: cellY + (cellH - h) / 2,
      w,
      h,
      cellX,
      cellY,
      cellW,
      cellH,
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

function fullImageViewRect(baseViewRect) {
  const imgW = baseViewRect.imgW;
  const imgH = baseViewRect.imgH;
  if (isSphereMode() && state.sphereProjection === "mollweide") {
    const base = mollweideFullViewWindow(imgW, imgH);
    return {
      srcX: 0.5 * (imgW - base.w),
      srcY: 0.5 * (imgH - base.h),
      srcW: base.w,
      srcH: base.h,
      imgW,
      imgH,
    };
  }
  if (!isSphereMode()) {
    const base = sliceFullViewWindow(imgW, imgH);
    return {
      srcX: 0.5 * (imgW - base.w),
      srcY: 0.5 * (imgH - base.h),
      srcW: base.w,
      srcH: base.h,
      imgW,
      imgH,
    };
  }
  return { srcX: 0, srcY: 0, srcW: imgW, srcH: imgH, imgW, imgH };
}

function colorbarReferenceCssWidth(_baseViewRect, scale) {
  const cssCanvasW = Math.max(1, Math.round(els.canvas.width / Math.max(1, scale)));
  return cssCanvasW;
}

function dataToScreen(u, v, viewRect, drawRect) {
  const { flipU, flipV } = planeAxisFlipState();
  const ux = (u - viewRect.srcX) / viewRect.srcW;
  const uy = (v - viewRect.srcY) / viewRect.srcH;
  const mx = flipU ? 1 - ux : ux;
  const my = flipV ? 1 - uy : uy;
  return {
    x: drawRect.x + mx * drawRect.w,
    y: drawRect.y + my * drawRect.h,
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

  const { flipU, flipV } = planeAxisFlipState();
  const rawUx = (xClamped - usedRect.x) / Math.max(1e-6, usedRect.w);
  const rawUy = (yClamped - usedRect.y) / Math.max(1e-6, usedRect.h);
  const ux = flipU ? 1 - rawUx : rawUx;
  const uy = flipV ? 1 - rawUy : rawUy;
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
  const { viewRect } = getRenderGeometry(getViewRect());
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

function exportZoomModeSupported() {
  return !isVolumeMode() && !isSampleMorphMode() && !isSphereMode();
}

function canExportZoomCutout() {
  if (!state.dataId || isSparseSceneView() || !exportZoomModeSupported()) return false;
  return hasSpatialZoom() || hasDomainZoom();
}

function updateExportButtonState() {
  const enabled = canExportZoomCutout();
  if (els.exportZoomBtn) {
    const unsupported = Boolean(state.dataId) && (isSparseSceneView() || !exportZoomModeSupported());
    els.exportZoomBtn.disabled = !enabled;
    els.exportZoomBtn.classList.toggle("unsupported", unsupported);
    els.exportZoomBtn.title = isSparseSceneView()
      ? "Data cutout export needs a dedicated bounded Scene source query."
      : "";
  }
  if (els.saveImagesBtn) {
    els.saveImagesBtn.disabled = !state.dataId;
  }
  if (els.mediaQualitySelect) {
    const quality = normalizeRecordQuality(state.recordMoviePrefs.quality);
    state.recordMoviePrefs.quality = quality;
    const busy = isMovieRecordingActive() || movieRecording.stopping || movieRecording.saving || renderJob.running;
    els.mediaQualitySelect.disabled = !state.dataId || busy;
    els.mediaQualitySelect.value = quality;
    els.mediaQualitySelect.title = busy ? "Quality cannot be changed while recording, rendering, or saving." : "Quality preset";
  }
  if (els.renderMovieBtn) {
    const recording = isMovieRecordingActive() || movieRecording.stopping || movieRecording.saving;
    const playbackActive = isPlaying() || isSampleMorphPlaybackActive();
    const hasAxis = hasAnyRenderableSweepAxis();
    const disabled = !state.dataId || renderJob.running || recording || playbackActive || !hasAxis;
    els.renderMovieBtn.disabled = disabled;
    els.renderMovieBtn.classList.toggle("activeRecord", renderJob.running);
    els.renderMovieBtn.textContent = renderJob.running ? "Rendering" : "Render";
    els.renderMovieBtn.title = !hasAxis
      ? "No sweepable axis is currently available for render"
      : playbackActive
      ? "Pause playback before starting offline render"
      : recording
      ? "Stop recording before starting offline render"
      : (renderJob.running ? "Rendering movie frames..." : "Render a deterministic offline movie");
  }
  if (els.recordMovieBtn) {
    const recording = isMovieRecordingActive() || movieRecording.stopping;
    const supported = isMovieRecordingSupported();
    els.recordMovieBtn.disabled = renderJob.running || movieRecording.saving || (recording ? false : (!state.dataId || !supported));
    els.recordMovieBtn.classList.toggle("activeRecord", recording);
    els.recordMovieBtn.textContent = recording ? "Recording" : "Record";
    els.recordMovieBtn.title = supported
      ? (recording ? "Click to stop and export recording" : "Record central viewer panel movie")
      : "Recording is not supported in this browser";
  }
  updateRenderSettingsFields();
  updateRenderMovieDialogActions();
  updateRecordMovieDialogActions();
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

function isNumericArrayLike(values) {
  return Array.isArray(values) || ArrayBuffer.isView(values);
}

function isRgbValuePayload(values) {
  return Boolean(values && isNumericArrayLike(values.r) && isNumericArrayLike(values.g) && isNumericArrayLike(values.b));
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
  if (isNumericArrayLike(values)) {
    const flux = values[src];
    if (Number.isFinite(flux)) return { kind: "single", flux };
    return { kind: "single", flux: null };
  }
  if (isRgbValuePayload(values)) {
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
  if (isNumericArrayLike(values)) {
    const flux = values[idx];
    if (Number.isFinite(flux)) return { kind: "single", flux };
    return { kind: "single", flux: null };
  }
  if (isRgbValuePayload(values)) {
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
  const { viewRect, drawRect } = getRenderGeometry(getViewRect());
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
  const label = axisDisplayLabel(dim, dim);
  if (!Number.isFinite(coord)) return `${label}: n/a`;
  if (axisType === "ra") {
    const deg = unitToDegrees(coord, unit);
    return `${label} ${formatAngleHms(deg)} (${deg.toFixed(6)} deg)`;
  }
  if (axisType === "dec") {
    const deg = unitToDegrees(coord, unit);
    return `${label} ${formatAngleSigned(deg)} (${deg.toFixed(6)} deg)`;
  }
  return `${label} ${fmtPhysical(dim, coord, unit)}`;
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
  const xUnitNative = dimUnit(probe.planeX);
  const yUnitNative = dimUnit(probe.planeY);
  const xUnitDisplay = axisDisplayUnit(probe.planeX);
  const yUnitDisplay = axisDisplayUnit(probe.planeY);

  let lines;
  if (state.coordSystem === "pixel") {
    lines = [
      "Plane Inspect",
      `X idx   : ${padLeft(probe.ix, 8)} (${axisDisplayLabel(probe.planeX)})`,
      `Y idx   : ${padLeft(probe.iy, 8)} (${axisDisplayLabel(probe.planeY)})`,
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
    const xCoordDisplay = axisValueCoord(probe.planeX, probe.xCoord);
    const yCoordDisplay = axisValueCoord(probe.planeY, probe.yCoord);
    if (xType === "ra") {
      const deg = unitToDegrees(xCoordDisplay, xUnitNative);
      xValue = Number.isFinite(deg) ? fmtSignedFixed(deg, 6, 12) : "n/a";
    } else if (Number.isFinite(xCoordDisplay)) {
      xValue = fmtSignedFixed(xCoordDisplay, 6, 12);
    }
    if (yType === "dec") {
      const deg = unitToDegrees(yCoordDisplay, yUnitNative);
      yValue = Number.isFinite(deg) ? fmtSignedFixed(deg, 6, 12) : "n/a";
    } else if (Number.isFinite(yCoordDisplay)) {
      yValue = fmtSignedFixed(yCoordDisplay, 6, 12);
    }
    lines = [
      "Plane Inspect",
      `${axisDisplayLabel(probe.planeX)} [${xUnitDisplay || "-"}]: ${xValue}`,
      `${axisDisplayLabel(probe.planeY)} [${yUnitDisplay || "-"}]: ${yValue}`,
    ];
  }
  lines.push(...fluxReadoutLines(probe.value));
  setHoverReadoutLines(lines);
}

function updateAxisSettingsButtonState() {
  if (!els.axisSettingsBtn) return;
  const count = axisSettingsCustomizedCount() + axisPlaneSwapCustomizedCount() + sphereFlipCustomizedCount();
  els.axisSettingsBtn.textContent = count > 0 ? `Axis Settings (${count})` : "Axis Settings";
  els.axisSettingsBtn.classList.toggle("activeAux", count > 0);
}

function axisSettingsSummaryText() {
  const axisCount = axisSettingsCustomizedCount();
  const swapCount = axisPlaneSwapCustomizedCount();
  const sphereCount = sphereFlipCustomizedCount();
  const count = axisCount + swapCount + sphereCount;
  if (count <= 0) return "Using dataset-native axis coordinates.";
  const parts = [];
  if (axisCount > 0) parts.push(`${axisCount} axis setting${axisCount === 1 ? "" : "s"}`);
  if (swapCount > 0) parts.push(`${swapCount} plane swap${swapCount === 1 ? "" : "s"}`);
  if (sphereCount > 0) parts.push(`${sphereCount} sphere orientation override${sphereCount === 1 ? "" : "s"}`);
  return `${parts.join(" + ")} customized.`;
}

function applyAxisSettingsChange() {
  updateAxisSettingsButtonState();
  if (els.axisSettingsSummary) els.axisSettingsSummary.textContent = axisSettingsSummaryText();
  if (!state.dataId) return;
  updateSliderReadouts(state.selectedCoords);
  if (isSphereMode()) {
    rerenderSphereFrame();
  } else {
    drawFrameAndOverlays();
  }
  drawNavigationGraphs();
  drawSelectionGraphs();
  drawColorbar();
  updateHoverReadout();
}

async function applyAxisPlaneSwapChange(planeKey) {
  updateAxisSettingsButtonState();
  if (els.axisSettingsSummary) els.axisSettingsSummary.textContent = axisSettingsSummaryText();
  if (!state.dataId) return;
  const activePlane = PLANE_KEYS.includes(state.plane) ? state.plane : "xy";
  if (planeKey !== activePlane) return;
  await onPlaneChange();
}

function renderAxisSwapRows() {
  if (!els.axisSwapRows) return;
  els.axisSwapRows.innerHTML = "";
  if (!state.meta || !state.meta.coords) return;

  const activePlane = PLANE_KEYS.includes(state.plane) ? state.plane : "xy";
  const base = PLANE_OPTIONS[activePlane];
  if (!base) return;
  const dimX = base.planeX.toUpperCase();
  const dimY = base.planeY.toUpperCase();
  const canSwap = axisSize(base.planeX) > 1 && axisSize(base.planeY) > 1;
  const swapped = axisPlaneSwapEnabled(activePlane);

  const row = document.createElement("div");
  row.className = "axisSwapRow isCurrent";

  const title = document.createElement("span");
  title.className = "axisSwapTitle";
  title.textContent = `Active plane: ${base.label}`;
  row.appendChild(title);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "axisToggleBtn axisSwapBtn";
  btn.classList.toggle("isActive", swapped);
  btn.setAttribute("aria-pressed", swapped ? "true" : "false");
  btn.disabled = !canSwap;
  btn.textContent = `Swap ${dimX}/${dimY}`;
  btn.addEventListener("click", async () => {
    axisPlaneSwapSet(activePlane, !axisPlaneSwapEnabled(activePlane));
    await applyAxisPlaneSwapChange(activePlane);
    renderAxisSettingsDialog();
  });
  row.appendChild(btn);

  if (!canSwap) {
    const hint = document.createElement("span");
    hint.className = "axisSwapHint";
    hint.textContent = "Not available for this plane.";
    row.appendChild(hint);
  }

  els.axisSwapRows.appendChild(row);
}

function renderAxisSettingsDialog() {
  renderAxisSwapRows();
  if (!els.axisSettingsRows) return;
  els.axisSettingsRows.innerHTML = "";
  if (els.axisSettingsSummary) els.axisSettingsSummary.textContent = axisSettingsSummaryText();
  if (!state.meta || !state.meta.coords) {
    const empty = document.createElement("div");
    empty.className = "axisSettingsEmpty";
    empty.textContent = "Load a dataset to configure axis settings.";
    els.axisSettingsRows.appendChild(empty);
    return;
  }

  const dims = AXIS_CONTROL_DIMS.filter((dim) => axisSize(dim) > 1);
  if (!dims.length && !isSphereDataset()) {
    const empty = document.createElement("div");
    empty.className = "axisSettingsEmpty";
    empty.textContent = "No varying axis available.";
    els.axisSettingsRows.appendChild(empty);
    return;
  }

  if (isSphereDataset()) {
    const row = document.createElement("div");
    row.className = "axisSettingsRow";

    const headerWrap = document.createElement("div");
    headerWrap.className = "axisSettingsHeader";
    const header = document.createElement("div");
    header.className = "axisSettingsAxis";
    header.textContent = "Sphere map";
    headerWrap.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "axisSettingsMeta";
    meta.textContent = sphereHorizontalFlipEnabled()
      ? "Left-right flipped for astronomy-style sky maps."
      : "Left-right unflipped for Earth-observation-style maps.";
    headerWrap.appendChild(meta);
    row.appendChild(headerWrap);

    const actions = document.createElement("div");
    actions.className = "axisSettingsActions";
    const flipBtn = document.createElement("button");
    flipBtn.type = "button";
    flipBtn.className = "axisToggleBtn axisRevertBtn";
    flipBtn.classList.toggle("isActive", sphereHorizontalFlipEnabled());
    flipBtn.setAttribute("aria-pressed", sphereHorizontalFlipEnabled() ? "true" : "false");
    flipBtn.textContent = "Flip left/right";
    flipBtn.addEventListener("click", () => {
      state.sphereHorizontalFlip = !sphereHorizontalFlipEnabled();
      applyAxisSettingsChange();
      renderAxisSettingsDialog();
    });
    actions.appendChild(flipBtn);
    row.appendChild(actions);

    els.axisSettingsRows.appendChild(row);
  }

  for (const dim of dims) {
    const cfg = axisSetting(dim);
    const nativeUnit = dimUnit(dim) || "";
    const displayUnit = axisDisplayUnit(dim) || "-";
    const endpoints = axisRawEndpoints(dim);
    const row = document.createElement("div");
    row.className = "axisSettingsRow";

    const headerWrap = document.createElement("div");
    headerWrap.className = "axisSettingsHeader";
    const header = document.createElement("div");
    header.className = "axisSettingsAxis";
    header.textContent = `${axisDisplayLabel(dim)} (${displayUnit})`;
    headerWrap.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "axisSettingsMeta";
    meta.textContent = nativeUnit ? `N=${axisSize(dim)} native: ${nativeUnit}` : `N=${axisSize(dim)}`;
    headerWrap.appendChild(meta);
    row.appendChild(headerWrap);

    const controls = document.createElement("div");
    controls.className = "axisSettingsFields";

    const unitLabel = document.createElement("label");
    unitLabel.className = "axisSettingsLabel";
    unitLabel.textContent = "Display unit";
    const unitInput = document.createElement("input");
    unitInput.type = "text";
    unitInput.className = "axisSettingsUnit";
    unitInput.placeholder = nativeUnit || "native";
    unitInput.value = cfg.unit || "";
    unitInput.maxLength = 24;
    unitInput.addEventListener("change", () => {
      axisSetting(dim).unit = String(unitInput.value || "").trim();
      applyAxisSettingsChange();
      renderAxisSettingsDialog();
    });
    unitLabel.appendChild(unitInput);
    controls.appendChild(unitLabel);

    const startLabel = document.createElement("label");
    startLabel.className = "axisSettingsLabel";
    startLabel.textContent = "Start value";
    const startInput = document.createElement("input");
    startInput.type = "number";
    startInput.className = "axisSettingsStart";
    startInput.step = "any";
    startInput.placeholder = endpoints ? String(endpoints.start) : "auto";
    startInput.value = Number.isFinite(cfg.start) ? String(cfg.start) : "";
    startInput.addEventListener("change", () => {
      const raw = Number.parseFloat(startInput.value);
      axisSetting(dim).start = Number.isFinite(raw) ? raw : null;
      if (!Number.isFinite(raw)) startInput.value = "";
      applyAxisSettingsChange();
    });
    startLabel.appendChild(startInput);
    controls.appendChild(startLabel);

    const endLabel = document.createElement("label");
    endLabel.className = "axisSettingsLabel";
    endLabel.textContent = "End value";
    const endInput = document.createElement("input");
    endInput.type = "number";
    endInput.className = "axisSettingsEnd";
    endInput.step = "any";
    endInput.placeholder = endpoints ? String(endpoints.end) : "auto";
    endInput.value = Number.isFinite(cfg.end) ? String(cfg.end) : "";
    endInput.addEventListener("change", () => {
      const raw = Number.parseFloat(endInput.value);
      axisSetting(dim).end = Number.isFinite(raw) ? raw : null;
      if (!Number.isFinite(raw)) endInput.value = "";
      applyAxisSettingsChange();
    });
    endLabel.appendChild(endInput);
    controls.appendChild(endLabel);

    const lengthLabel = document.createElement("label");
    lengthLabel.className = "axisSettingsLabel";
    lengthLabel.textContent = "Physical length";
    const lengthInput = document.createElement("input");
    lengthInput.type = "number";
    lengthInput.className = "axisSettingsLength";
    lengthInput.min = "0";
    lengthInput.step = "any";
    lengthInput.placeholder = "auto";
    lengthInput.value = Number.isFinite(cfg.length) ? String(cfg.length) : "";
    lengthInput.addEventListener("change", () => {
      const raw = Number.parseFloat(lengthInput.value);
      axisSetting(dim).length = Number.isFinite(raw) && raw > 0 ? raw : null;
      if (!Number.isFinite(raw) || raw <= 0) lengthInput.value = "";
      applyAxisSettingsChange();
    });
    lengthLabel.appendChild(lengthInput);
    controls.appendChild(lengthLabel);
    row.appendChild(controls);

    const actions = document.createElement("div");
    actions.className = "axisSettingsActions";
    const flipBtn = document.createElement("button");
    flipBtn.type = "button";
    flipBtn.className = "axisToggleBtn axisRevertBtn";
    flipBtn.classList.toggle("isActive", cfg.flip === true);
    flipBtn.setAttribute("aria-pressed", cfg.flip === true ? "true" : "false");
    flipBtn.textContent = "Revert axis";
    flipBtn.addEventListener("click", () => {
      axisSetting(dim).flip = !axisSetting(dim).flip;
      applyAxisSettingsChange();
      renderAxisSettingsDialog();
    });
    actions.appendChild(flipBtn);
    row.appendChild(actions);

    els.axisSettingsRows.appendChild(row);
  }
}

function openAxisSettingsDialog() {
  if (!els.axisSettingsDialog) return;
  renderAxisSettingsDialog();
  if (!els.axisSettingsDialog.open) {
    els.axisSettingsDialog.showModal();
  }
}

function closeAxisSettingsDialog() {
  if (!els.axisSettingsDialog || !els.axisSettingsDialog.open) return;
  els.axisSettingsDialog.close();
}

async function resetAxisSettings() {
  const activePlane = PLANE_KEYS.includes(state.plane) ? state.plane : "xy";
  const hadActivePlaneSwap = axisPlaneSwapEnabled(activePlane);
  state.axisSettings = createDefaultAxisSettings();
  state.axisPlaneSwap = createDefaultAxisPlaneSwap();
  state.sphereHorizontalFlip = true;
  if (hadActivePlaneSwap) {
    await applyAxisPlaneSwapChange(activePlane);
    renderAxisSettingsDialog();
    applyAxisSettingsChange();
    return;
  }
  renderAxisSettingsDialog();
  applyAxisSettingsChange();
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
  if (!state.exportPrefs.outputDir) {
    state.exportPrefs.outputDir = DEFAULT_EXPORT_OUTPUT_DIR;
  }
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

function snapshotTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

function defaultSaveImagesPrefix() {
  const base = state.dataId ? state.dataId : "mobula";
  return `${base}_${snapshotTimestamp()}`;
}

function normalizeSaveImagesPrefix(prefix) {
  let out = String(prefix || "").trim();
  if (!out) out = defaultSaveImagesPrefix();
  out = out.replace(/[\\/]/g, "_");
  out = out.replace(/\s+/g, "_");
  out = out.replace(/[^A-Za-z0-9._-]/g, "");
  out = out.replace(/_+/g, "_");
  return out || defaultSaveImagesPrefix();
}

function visibleCanvasForSnapshot(canvas, container = null) {
  if (!canvas || canvas.width < 1 || canvas.height < 1) return null;
  if (container && container.offsetParent === null) return null;
  return canvas;
}

function withRenderOverlayOverride(overrideOptions, fn) {
  const prev = renderOverlayDrawOverride;
  renderOverlayDrawOverride = { ...(prev || {}), ...(overrideOptions || {}) };
  drawFrameAndOverlays();
  try {
    return fn();
  } finally {
    renderOverlayDrawOverride = prev;
    drawFrameAndOverlays();
  }
}

function setRenderOverlayDrawOverride(overrideOptions) {
  renderOverlayDrawOverride = overrideOptions && typeof overrideOptions === "object"
    ? { ...overrideOptions }
    : null;
}

function drawSnapshotCardBackground(ctx, width, height) {
  ctx.fillStyle = "#0b1119";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(143, 176, 211, 0.38)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

function buildViewerSnapshotCanvas(options = null) {
  const includeColorbar = !options || options.includeColorbar !== false;
  const includeSampleLabels = !options || options.includeSampleLabels !== false;
  const transparentBackground = Boolean(options && options.transparentBackground === true);
  const capture = () => {
    const source = visibleCanvasForSnapshot(els.canvas);
    if (!source) throw new Error("Viewer canvas is not available.");
    const colorbar = includeColorbar ? visibleCanvasForSnapshot(els.colorbarCanvas, els.colorbarPanel) : null;

    const maxMainDim = 1200;
    const sourceMax = Math.max(source.width, source.height, 1);
    const scale = Math.min(1, maxMainDim / sourceMax);
    const mainW = Math.max(320, Math.round(source.width * scale));
    const mainH = Math.max(240, Math.round(source.height * scale));

    const pad = transparentBackground ? 0 : 20;
    const titleH = transparentBackground ? 0 : 26;
    const blockGap = transparentBackground ? 0 : 12;
    const colorbarH = colorbar
      ? clamp(Math.round((colorbar.height / Math.max(1, colorbar.width)) * mainW), 18, 40)
      : 0;
    const outW = mainW + pad * 2;
    const outH = pad * 2 + titleH + mainH + (colorbar ? blockGap + colorbarH : 0);

    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Could not initialize viewer snapshot.");

    if (!transparentBackground) {
      drawSnapshotCardBackground(ctx, outW, outH);
      ctx.fillStyle = "#e8f2ff";
      ctx.font = "600 16px 'Source Sans 3', sans-serif";
      ctx.fillText("Viewer", pad, pad + 17);
    }

    let y = pad + titleH;
    ctx.drawImage(source, pad, y, mainW, mainH);
    y += mainH;

    if (colorbar) {
      y += blockGap;
      ctx.drawImage(colorbar, pad, y, mainW, colorbarH);
    }
    return out;
  };
  if (includeSampleLabels || !isSamplesMode()) return capture();
  return withRenderOverlayOverride({ includeSampleLabels: false }, capture);
}

function collectInspectSnapshotCharts() {
  if (!state.selection) return [];
  const charts = [];
  const timeCanvas = visibleCanvasForSnapshot(els.timeProfileCanvas, els.timeProfileBlock);
  if (timeCanvas) charts.push({ key: "time_profile", title: "Time Flux Profile", canvas: timeCanvas });
  const specCanvas = visibleCanvasForSnapshot(els.spectrumProfileCanvas, els.spectrumProfileBlock);
  if (specCanvas) charts.push({ key: "spectral_profile", title: "Spectral Flux Profile", canvas: specCanvas });
  const spatialCanvas = visibleCanvasForSnapshot(els.spatialProfileCanvas, els.spatialProfileBlock);
  if (spatialCanvas) {
    charts.push({
      key: "spatial_profile",
      title: els.spatialProfileTitle?.textContent || "Spatial Flux Profile",
      canvas: spatialCanvas,
    });
  }
  return charts;
}

function availableInspectSnapshotChartsByKey() {
  const out = new Map();
  for (const chart of collectInspectSnapshotCharts()) {
    out.set(chart.key, chart);
  }
  return out;
}

function buildGraphSnapshotCanvas(entry) {
  if (!entry || !entry.canvas) throw new Error("Inspect graph is not available.");
  const source = entry.canvas;
  const transparentBackground = Boolean(entry && entry.transparentBackground === true);
  const pad = transparentBackground ? 0 : 20;
  const titleH = transparentBackground ? 0 : 26;
  const targetW = clamp(source.width, 360, 960);
  const scale = targetW / Math.max(1, source.width);
  const targetH = Math.max(150, Math.round(source.height * scale));
  const outW = targetW + pad * 2;
  const outH = targetH + pad * 2 + titleH;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not initialize graph snapshot.");

  if (!transparentBackground) {
    drawSnapshotCardBackground(ctx, outW, outH);
    ctx.fillStyle = "#e8f2ff";
    ctx.font = "600 16px 'Source Sans 3', sans-serif";
    ctx.fillText(entry.title || "Profile Graph", pad, pad + 17);
  }
  ctx.drawImage(source, pad, pad + titleH, targetW, targetH);
  return out;
}

function setSaveImagesStatus(message, error = false) {
  if (!els.saveImagesStatus) return;
  els.saveImagesStatus.textContent = message || "";
  els.saveImagesStatus.classList.toggle("error", Boolean(error));
}

function normalizeSaveImagesPrefs() {
  state.saveImagesPrefs.transparentBackground = Boolean(state.saveImagesPrefs.transparentBackground);
  state.saveImagesPrefs.includeViewer = normalizeRenderOverlayOption(state.saveImagesPrefs.includeViewer);
  state.saveImagesPrefs.includeColorbar = normalizeRenderOverlayOption(state.saveImagesPrefs.includeColorbar);
  state.saveImagesPrefs.includeSampleLabels = normalizeRenderOverlayOption(state.saveImagesPrefs.includeSampleLabels);
  state.saveImagesPrefs.includeTimeProfile = normalizeRenderOverlayOption(state.saveImagesPrefs.includeTimeProfile);
  state.saveImagesPrefs.includeSpectralProfile = normalizeRenderOverlayOption(state.saveImagesPrefs.includeSpectralProfile);
  state.saveImagesPrefs.includeSpatialProfile = normalizeRenderOverlayOption(state.saveImagesPrefs.includeSpatialProfile);
}

function saveImagesSummaryText(availableCharts) {
  const includeViewer = normalizeRenderOverlayOption(state.saveImagesPrefs.includeViewer);
  const includeColorbar = normalizeRenderOverlayOption(state.saveImagesPrefs.includeColorbar);
  const includeSampleLabels = normalizeRenderOverlayOption(state.saveImagesPrefs.includeSampleLabels);
  const selected = [];
  if (includeViewer) {
    const viewerItems = ["Viewer"];
    if (includeColorbar) viewerItems.push("color bar");
    if (includeSampleLabels) viewerItems.push("sample labels");
    selected.push(viewerItems.join(" + "));
  }
  if (normalizeRenderOverlayOption(state.saveImagesPrefs.includeTimeProfile) && availableCharts.has("time_profile")) {
    selected.push("Time profile");
  }
  if (normalizeRenderOverlayOption(state.saveImagesPrefs.includeSpectralProfile) && availableCharts.has("spectral_profile")) {
    selected.push("Spectral profile");
  }
  if (normalizeRenderOverlayOption(state.saveImagesPrefs.includeSpatialProfile) && availableCharts.has("spatial_profile")) {
    selected.push("Spatial profile");
  }
  if (!selected.length) return "No images selected.";
  return `Saving: ${selected.join(" | ")}`;
}

function updateSaveImagesSelectionButtons() {
  normalizeSaveImagesPrefs();
  const hasViewer = Boolean(visibleCanvasForSnapshot(els.canvas));
  const hasColorbar = hasViewer && Boolean(visibleCanvasForSnapshot(els.colorbarCanvas, els.colorbarPanel));
  const availableCharts = availableInspectSnapshotChartsByKey();
  const profileConfigs = [
    [els.saveImagesIncludeTimeProfileBtn, "includeTimeProfile", "time_profile"],
    [els.saveImagesIncludeSpectralProfileBtn, "includeSpectralProfile", "spectral_profile"],
    [els.saveImagesIncludeSpatialProfileBtn, "includeSpatialProfile", "spatial_profile"],
  ];

  if (els.saveImagesIncludeViewerBtn) {
    setRenderToggleButton(els.saveImagesIncludeViewerBtn, hasViewer && state.saveImagesPrefs.includeViewer);
    els.saveImagesIncludeViewerBtn.disabled = !hasViewer;
  }
  if (els.saveImagesIncludeColorbarBtn) {
    setRenderToggleButton(els.saveImagesIncludeColorbarBtn, hasColorbar && state.saveImagesPrefs.includeColorbar);
    els.saveImagesIncludeColorbarBtn.disabled = !hasColorbar;
  }
  if (els.saveImagesIncludeSampleLabelsBtn) {
    const samplesMode = isSamplesMode();
    setRenderToggleButton(
      els.saveImagesIncludeSampleLabelsBtn,
      hasViewer && samplesMode && state.saveImagesPrefs.includeSampleLabels
    );
    els.saveImagesIncludeSampleLabelsBtn.disabled = !hasViewer || !samplesMode;
  }
  let visibleProfileCount = 0;
  for (const [btn, prefKey, chartKey] of profileConfigs) {
    if (!btn) continue;
    const available = availableCharts.has(chartKey);
    setRenderToggleButton(btn, available && state.saveImagesPrefs[prefKey]);
    btn.hidden = !available;
    btn.disabled = !available;
    if (available) visibleProfileCount += 1;
  }
  const profileGroup =
    els.saveImagesIncludeTimeProfileBtn?.closest(".renderChoiceGroup") ||
    els.saveImagesIncludeSpectralProfileBtn?.closest(".renderChoiceGroup") ||
    els.saveImagesIncludeSpatialProfileBtn?.closest(".renderChoiceGroup") ||
    null;
  if (profileGroup) {
    profileGroup.hidden = visibleProfileCount === 0;
  }
  if (els.saveImagesSummary) {
    els.saveImagesSummary.textContent = saveImagesSummaryText(availableCharts);
  }
}

function updateSaveImagesDialogFields() {
  if (!els.saveImagesPrefixInput || !els.saveImagesLocationInput || !els.saveImagesOverwriteChk) return;
  normalizeSaveImagesPrefs();
  if (!state.saveImagesPrefs.outputDir) {
    state.saveImagesPrefs.outputDir = DEFAULT_EXPORT_OUTPUT_DIR;
  }
  if (!state.saveImagesPrefs.prefix) {
    state.saveImagesPrefs.prefix = defaultSaveImagesPrefix();
  }
  state.saveImagesPrefs.prefix = normalizeSaveImagesPrefix(state.saveImagesPrefs.prefix);
  els.saveImagesPrefixInput.value = state.saveImagesPrefs.prefix;
  els.saveImagesLocationInput.value = state.saveImagesPrefs.outputDir || "";
  els.saveImagesOverwriteChk.checked = state.saveImagesPrefs.overwrite !== false;
  if (els.saveImagesTransparentBgChk) {
    els.saveImagesTransparentBgChk.checked = state.saveImagesPrefs.transparentBackground === true;
  }
  updateSaveImagesSelectionButtons();
}

async function chooseSaveImagesFolder() {
  const payload = await fetchJson("/api/fs/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "folder" }),
  });
  if (payload.canceled) return false;
  if (!payload.exists || !payload.is_dir) {
    throw new Error(`invalid folder: ${payload.path || "unknown"}`);
  }
  state.saveImagesPrefs.outputDir = payload.path;
  updateSaveImagesDialogFields();
  return true;
}

function openSaveImagesDialog() {
  if (!els.saveImagesDialog) return;
  if (!state.saveImagesPrefs.prefix) {
    state.saveImagesPrefs.prefix = defaultSaveImagesPrefix();
  }
  updateSaveImagesDialogFields();
  setSaveImagesStatus("");
  if (typeof els.saveImagesDialog.showModal === "function") {
    els.saveImagesDialog.showModal();
  }
}

function closeSaveImagesDialog() {
  if (!els.saveImagesDialog) return;
  if (els.saveImagesDialog.open) {
    els.saveImagesDialog.close();
  }
  setSaveImagesStatus("");
}

function buildSaveImagesRequestBody() {
  normalizeSaveImagesPrefs();
  const prefix = normalizeSaveImagesPrefix(state.saveImagesPrefs.prefix);
  state.saveImagesPrefs.prefix = prefix;

  const images = [];
  if (state.saveImagesPrefs.includeViewer) {
    const viewerCanvas = buildViewerSnapshotCanvas({
      includeColorbar: state.saveImagesPrefs.includeColorbar,
      includeSampleLabels: state.saveImagesPrefs.includeSampleLabels,
      transparentBackground: state.saveImagesPrefs.transparentBackground,
    });
    images.push({ filename: `${prefix}_viewer.png`, data_url: viewerCanvas.toDataURL("image/png") });
  }

  const charts = availableInspectSnapshotChartsByKey();
  const profileConfigs = [
    ["includeTimeProfile", "time_profile"],
    ["includeSpectralProfile", "spectral_profile"],
    ["includeSpatialProfile", "spatial_profile"],
  ];
  for (const [prefKey, chartKey] of profileConfigs) {
    if (!state.saveImagesPrefs[prefKey]) continue;
    const chart = charts.get(chartKey);
    if (!chart) continue;
    const graphCanvas = buildGraphSnapshotCanvas({
      ...chart,
      transparentBackground: state.saveImagesPrefs.transparentBackground,
    });
    images.push({
      filename: `${prefix}_${chart.key}.png`,
      data_url: graphCanvas.toDataURL("image/png"),
    });
  }

  if (!images.length) {
    throw new Error("Select at least one image to save.");
  }
  return {
    output_dir: state.saveImagesPrefs.outputDir,
    overwrite: state.saveImagesPrefs.overwrite !== false,
    images,
  };
}

async function saveCurrentImagesFromDialog() {
  if (!state.dataId || !els.saveImagesPrefixInput || !els.saveImagesOverwriteChk) return;
  state.saveImagesPrefs.prefix = normalizeSaveImagesPrefix(els.saveImagesPrefixInput.value);
  state.saveImagesPrefs.overwrite = Boolean(els.saveImagesOverwriteChk.checked);
  if (els.saveImagesTransparentBgChk) {
    state.saveImagesPrefs.transparentBackground = Boolean(els.saveImagesTransparentBgChk.checked);
  }

  if (!state.saveImagesPrefs.outputDir) {
    setSaveImagesStatus("Choose a destination folder.", true);
    const selected = await chooseSaveImagesFolder();
    if (!selected) return;
  }

  setSaveImagesStatus("Preparing snapshots...");
  const reqBody = buildSaveImagesRequestBody();
  setSaveImagesStatus("Saving images...");
  const response = await fetchJson(`/api/datasets/${state.dataId}/save-images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  if (!response.saved) {
    throw new Error(response.detail || "save failed");
  }
  setSystemPickerStatus("");
  closeSaveImagesDialog();
}

function defaultRecordMovieFilename(format = "mp4") {
  return buildDefaultRecordMovieFilename(state.dataId, snapshotTimestamp(), format);
}

function normalizeRecordMovieFilename(name, format = "mp4") {
  const fmt = normalizeRecordMovieFormat(format);
  return normalizeMovieFilename(name, fmt, defaultRecordMovieFilename(fmt));
}

function setRecordMovieStatus(message, error = false) {
  if (!els.recordMovieStatus) return;
  els.recordMovieStatus.textContent = message || "";
  els.recordMovieStatus.classList.toggle("error", Boolean(error));
}

function updateRecordMovieFormatButtons() {
  const fmt = normalizeRecordMovieFormat(state.recordMoviePrefs.format);
  const pairs = [
    [els.recordMovieFormatWebmBtn, "webm"],
    [els.recordMovieFormatMp4Btn, "mp4"],
    [els.recordMovieFormatGifBtn, "gif"],
  ];
  for (const [btn, value] of pairs) {
    if (!btn) continue;
    const active = value === fmt;
    btn.classList.toggle("activeRecordFormat", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function updateRecordMovieDialogFields() {
  if (!els.recordMovieFilenameInput || !els.recordMovieLocationInput || !els.recordMovieOverwriteChk) return;
  state.recordMoviePrefs.format = normalizeRecordMovieFormat(state.recordMoviePrefs.format);
  if (!state.recordMoviePrefs.outputDir) {
    state.recordMoviePrefs.outputDir = DEFAULT_EXPORT_OUTPUT_DIR;
  }
  if (!state.recordMoviePrefs.filename) {
    state.recordMoviePrefs.filename = defaultRecordMovieFilename(state.recordMoviePrefs.format);
  }
  state.recordMoviePrefs.filename = normalizeRecordMovieFilename(state.recordMoviePrefs.filename, state.recordMoviePrefs.format);
  updateRecordMovieFormatButtons();
  els.recordMovieFilenameInput.value = state.recordMoviePrefs.filename;
  els.recordMovieLocationInput.value = state.recordMoviePrefs.outputDir || "";
  els.recordMovieOverwriteChk.checked = state.recordMoviePrefs.overwrite !== false;
}

function updateRecordMovieDialogActions() {
  const busy = movieRecording.stopping || movieRecording.saving;
  const hasPending = hasPendingMovieRecording();
  if (els.recordMovieCancelBtn) {
    els.recordMovieCancelBtn.disabled = busy;
  }
  if (els.recordMovieConfirmBtn) {
    els.recordMovieConfirmBtn.disabled = busy || !hasPending;
  }
  if (els.recordMovieFilenameInput) {
    els.recordMovieFilenameInput.disabled = busy || !hasPending;
  }
  for (const btn of [els.recordMovieFormatWebmBtn, els.recordMovieFormatMp4Btn, els.recordMovieFormatGifBtn]) {
    if (!btn) continue;
    btn.disabled = busy || !hasPending;
  }
  if (els.recordMovieBrowseBtn) {
    els.recordMovieBrowseBtn.disabled = busy || !hasPending;
  }
  if (els.recordMovieOverwriteChk) {
    els.recordMovieOverwriteChk.disabled = busy || !hasPending;
  }
}

async function chooseRecordMovieFolder() {
  const payload = await fetchJson("/api/fs/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "folder" }),
  });
  if (payload.canceled) return false;
  if (!payload.exists || !payload.is_dir) {
    throw new Error(`invalid folder: ${payload.path || "unknown"}`);
  }
  state.recordMoviePrefs.outputDir = payload.path;
  updateRecordMovieDialogFields();
  return true;
}

function openRecordMovieDialog() {
  if (!els.recordMovieDialog) return;
  if (!hasPendingMovieRecording()) return;
  state.recordMoviePrefs.format = normalizeRecordMovieFormat(state.recordMoviePrefs.format);
  if (!state.recordMoviePrefs.filename) {
    state.recordMoviePrefs.filename = defaultRecordMovieFilename(state.recordMoviePrefs.format);
  }
  updateRecordMovieDialogFields();
  updateRecordMovieDialogActions();
  if (typeof els.recordMovieDialog.showModal === "function") {
    els.recordMovieDialog.showModal();
  }
}

function closeRecordMovieDialog() {
  if (!els.recordMovieDialog) return;
  if (els.recordMovieDialog.open) {
    els.recordMovieDialog.close();
  }
  setRecordMovieStatus("");
}

const movieRecordingController = createMovieRecordingController({
  state,
  els,
  movieRecording,
  recordStopTimeoutMs: RECORD_STOP_TIMEOUT_MS,
  fetchJson,
  visibleCanvasForSnapshot,
  normalizeRecordQuality,
  normalizeRecordMovieFormat,
  normalizeRecordMovieFilename,
  defaultRecordMovieFilename,
  recordQualityConfig,
  setSystemPickerStatus,
  setRecordMovieStatus,
  updateRecordMovieDialogActions,
  updateExportButtonState,
  openRecordMovieDialog,
  closeRecordMovieDialog,
  chooseRecordMovieFolder,
  blobToDataUrl,
});

function isMovieRecordingActive() {
  return movieRecordingController.isMovieRecordingActive();
}

function hasPendingMovieRecording() {
  return movieRecordingController.hasPendingMovieRecording();
}

function preferredMovieMimeType() {
  return movieRecordingController.preferredMovieMimeType();
}

function isMovieRecordingSupported() {
  return movieRecordingController.isMovieRecordingSupported();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("failed to encode recording"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

async function startMovieRecordingFromToolbar() {
  return movieRecordingController.startMovieRecordingFromToolbar();
}

async function stopMovieRecordingForExport() {
  return movieRecordingController.stopMovieRecordingForExport();
}

function discardPendingMovieRecording() {
  return movieRecordingController.discardPendingMovieRecording();
}

async function savePendingMovieFromDialog() {
  return movieRecordingController.savePendingMovieFromDialog();
}

function parseRenderAxisToken(axis) {
  return parseRenderAxis(axis, SAMPLE_MORPH_AXIS);
}

function isValidRenderAxis(axis) {
  return parseRenderAxisToken(axis) !== null;
}

function normalizeRenderAxis(axis) {
  return parseRenderAxisToken(axis) || "t";
}

function computeSampleMorphRenderFrameCount(fps) {
  const nSamples = sampleCount();
  if (nSamples <= 1) return 0;
  const transitionFrames = Math.max(1, Math.ceil(sampleMorphDeltaTSec() * Math.max(1, fps)));
  return nSamples * transitionFrames;
}

function computeRenderRotationFrameCount(fps) {
  const fpsSafe = Math.max(1, normalizeRenderFps(fps));
  // One deterministic full revolution over ~6s by default.
  return clamp(Math.round(fpsSafe * 6), 24, 720);
}

function resolveRenderSweepAxis(axisPref = null) {
  const pref = normalizeRenderAxis(axisPref || state.renderMoviePrefs.axis);
  return pref === RENDER_AXIS_HIDDEN ? hiddenDim() : pref;
}

function defaultRenderMovieFilename(format = "mp4") {
  return buildDefaultRenderMovieFilename(state.dataId, snapshotTimestamp(), format);
}

function normalizeRenderMovieFilename(name, format = "mp4") {
  const fmt = normalizeRecordMovieFormat(format);
  return normalizeMovieFilename(name, fmt, defaultRenderMovieFilename(fmt));
}

function setRenderMovieStatus(message, error = false) {
  if (!els.renderMovieStatus) return;
  els.renderMovieStatus.textContent = message || "";
  els.renderMovieStatus.classList.toggle("error", Boolean(error));
}

function setRenderChoiceButtons(pairs, activeValue) {
  for (const [btn, value] of pairs) {
    if (!btn) continue;
    const active = value === activeValue;
    btn.classList.toggle("activeRecordFormat", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function setRenderToggleButton(btn, enabled) {
  if (!btn) return;
  const active = Boolean(enabled);
  btn.classList.toggle("activeRecordFormat", active);
  btn.setAttribute("aria-pressed", active ? "true" : "false");
}

function readRenderToggleButton(btn, fallback = true) {
  if (!btn) return Boolean(fallback);
  const pressed = btn.getAttribute("aria-pressed");
  if (pressed === "true") return true;
  if (pressed === "false") return false;
  return btn.classList.contains("activeRecordFormat");
}

function normalizeRenderAxisForData() {
  const options = ["t", "nu", RENDER_AXIS_HIDDEN, SAMPLE_MORPH_AXIS, RENDER_AXIS_ROTATE];
  let current = normalizeRenderAxis(state.renderMoviePrefs.axis);
  if (!canRenderSweepAxis(current)) {
    const fallback = options.find((value) => canRenderSweepAxis(value));
    current = fallback || "t";
  }
  state.renderMoviePrefs.axis = current;
}

function canRenderRotationAxis() {
  return isVolumeMode() || isSphereMode();
}

function canRenderSweepAxis(axisToken) {
  const normalizedAxis = parseRenderAxisToken(axisToken);
  if (!normalizedAxis) return false;
  if (normalizedAxis === SAMPLE_MORPH_AXIS) {
    return sampleCount() > 1;
  }
  if (normalizedAxis === RENDER_AXIS_ROTATE) {
    return canRenderRotationAxis();
  }
  const axis = normalizedAxis === RENDER_AXIS_HIDDEN ? hiddenDim() : normalizedAxis;
  if (!axis) return false;
  if (playbackAxisLength(axis) <= 1) return false;
  if (isAxisSelectorLocked(axis)) return false;
  if (isAxisProjectionActive(axis)) return false;
  return true;
}

function hasAnyRenderableSweepAxis() {
  return (
    canRenderSweepAxis("t")
    || canRenderSweepAxis("nu")
    || canRenderSweepAxis(RENDER_AXIS_HIDDEN)
    || canRenderSweepAxis(SAMPLE_MORPH_AXIS)
    || canRenderSweepAxis(RENDER_AXIS_ROTATE)
  );
}

function updateRenderAxisOptions() {
  const hidden = hiddenDim();
  const busy = renderJob.running || renderJob.encoding;
  normalizeRenderAxisForData();
  if (els.renderAxisHiddenBtn) {
    els.renderAxisHiddenBtn.textContent = axisDisplayLabel(hidden);
  }
  const axisButtons = [
    [els.renderAxisTimeBtn, "t"],
    [els.renderAxisFreqBtn, "nu"],
    [els.renderAxisHiddenBtn, RENDER_AXIS_HIDDEN],
    [els.renderAxisSampleMorphBtn, SAMPLE_MORPH_AXIS],
    [els.renderAxisRotateBtn, RENDER_AXIS_ROTATE],
  ];
  for (const [btn, value] of axisButtons) {
    if (!btn) continue;
    const available = canRenderSweepAxis(value);
    setVisible(btn, available);
    btn.disabled = busy;
  }
  setRenderChoiceButtons(axisButtons, state.renderMoviePrefs.axis);
}

function updateRenderSettingsFields() {
  if (!state.renderMoviePrefs) return;
  normalizeRenderAxisForData();
  state.renderMoviePrefs.format = normalizeRecordMovieFormat(state.renderMoviePrefs.format);
  state.renderMoviePrefs.quality = normalizeRecordQuality(state.renderMoviePrefs.quality);
  state.renderMoviePrefs.fps = normalizeRenderFps(state.renderMoviePrefs.fps);
  state.renderMoviePrefs.loops = normalizeRenderLoops(state.renderMoviePrefs.loops);
  state.renderMoviePrefs.resolution = normalizeRenderResolution(state.renderMoviePrefs.resolution);
  state.renderMoviePrefs.includeColorbar = normalizeRenderOverlayOption(state.renderMoviePrefs.includeColorbar);
  state.renderMoviePrefs.includeSkyDirections = normalizeRenderOverlayOption(state.renderMoviePrefs.includeSkyDirections);
  state.renderMoviePrefs.includeLengthScale = normalizeRenderOverlayOption(state.renderMoviePrefs.includeLengthScale);
  state.renderMoviePrefs.includeSampleLabels = normalizeRenderOverlayOption(state.renderMoviePrefs.includeSampleLabels);

  updateRenderAxisOptions();
  setRenderChoiceButtons(
    [
      [els.renderFormatMp4Btn, "mp4"],
      [els.renderFormatWebmBtn, "webm"],
      [els.renderFormatGifBtn, "gif"],
    ],
    state.renderMoviePrefs.format
  );
  setRenderChoiceButtons(
    [
      [els.renderQualityLowBtn, "low"],
      [els.renderQualityMedBtn, "balanced"],
      [els.renderQualityHighBtn, "high"],
    ],
    state.renderMoviePrefs.quality
  );
  setRenderChoiceButtons(
    [
      [els.renderResCanvasBtn, "canvas"],
      [els.renderRes720Btn, "720p"],
      [els.renderRes1080Btn, "1080p"],
      [els.renderRes1440Btn, "1440p"],
      [els.renderRes2160Btn, "2160p"],
    ],
    state.renderMoviePrefs.resolution
  );
  if (els.renderFpsInput) {
    els.renderFpsInput.value = String(state.renderMoviePrefs.fps);
  }
  if (els.renderLoopInput) {
    els.renderLoopInput.value = String(state.renderMoviePrefs.loops);
  }
  setRenderToggleButton(els.renderIncludeColorbarBtn, state.renderMoviePrefs.includeColorbar);
  setRenderToggleButton(els.renderIncludeSkyDirectionsBtn, state.renderMoviePrefs.includeSkyDirections);
  setRenderToggleButton(els.renderIncludeLengthScaleBtn, state.renderMoviePrefs.includeLengthScale);
  setRenderToggleButton(els.renderIncludeSampleLabelsBtn, state.renderMoviePrefs.includeSampleLabels);
}

function readRenderSettingsFromUi() {
  if (els.renderFpsInput) {
    state.renderMoviePrefs.fps = normalizeRenderFps(els.renderFpsInput.value);
  }
  if (els.renderLoopInput) {
    state.renderMoviePrefs.loops = normalizeRenderLoops(els.renderLoopInput.value);
  }
  state.renderMoviePrefs.includeColorbar = readRenderToggleButton(
    els.renderIncludeColorbarBtn,
    state.renderMoviePrefs.includeColorbar
  );
  state.renderMoviePrefs.includeSkyDirections = readRenderToggleButton(
    els.renderIncludeSkyDirectionsBtn,
    state.renderMoviePrefs.includeSkyDirections
  );
  state.renderMoviePrefs.includeLengthScale = readRenderToggleButton(
    els.renderIncludeLengthScaleBtn,
    state.renderMoviePrefs.includeLengthScale
  );
  state.renderMoviePrefs.includeSampleLabels = readRenderToggleButton(
    els.renderIncludeSampleLabelsBtn,
    state.renderMoviePrefs.includeSampleLabels
  );
}

function renderSettingsSummaryText() {
  const axis = resolveRenderSweepAxis(state.renderMoviePrefs.axis);
  const fmt = normalizeRecordMovieFormat(state.renderMoviePrefs.format);
  const fps = normalizeRenderFps(state.renderMoviePrefs.fps);
  const loops = normalizeRenderLoops(state.renderMoviePrefs.loops);
  const quality = normalizeRecordQuality(state.renderMoviePrefs.quality);
  const resolution = normalizeRenderResolution(state.renderMoviePrefs.resolution);
  const includeColorbar = normalizeRenderOverlayOption(state.renderMoviePrefs.includeColorbar);
  const includeSky = normalizeRenderOverlayOption(state.renderMoviePrefs.includeSkyDirections);
  const includeScale = normalizeRenderOverlayOption(state.renderMoviePrefs.includeLengthScale);
  const includeLabels = normalizeRenderOverlayOption(state.renderMoviePrefs.includeSampleLabels);
  const overlayLabel = `CB:${includeColorbar ? "on" : "off"} Sky:${includeSky ? "on" : "off"} Scale:${includeScale ? "on" : "off"} Labels:${includeLabels ? "on" : "off"}`;
  const axisLabel = axis === SAMPLE_MORPH_AXIS
    ? "Sample Morph"
    : axis === RENDER_AXIS_ROTATE
    ? "Rotation"
    : axisDisplayLabel(axis);
  return `Axis ${axisLabel} | ${fmt.toUpperCase()} | ${fps} FPS | Loops ${loops} | ${renderQualityLabel(quality)} quality | ${resolution} | ${overlayLabel}`;
}

function updateRenderMovieDialogFields() {
  if (!els.renderMovieFilenameInput || !els.renderMovieLocationInput || !els.renderMovieOverwriteChk) return;
  if (!state.renderMoviePrefs.outputDir) {
    state.renderMoviePrefs.outputDir = DEFAULT_EXPORT_OUTPUT_DIR;
  }
  if (!state.renderMoviePrefs.filename) {
    state.renderMoviePrefs.filename = defaultRenderMovieFilename(state.renderMoviePrefs.format);
  }
  state.renderMoviePrefs.filename = normalizeRenderMovieFilename(state.renderMoviePrefs.filename, state.renderMoviePrefs.format);
  els.renderMovieFilenameInput.value = state.renderMoviePrefs.filename;
  els.renderMovieLocationInput.value = state.renderMoviePrefs.outputDir || "";
  els.renderMovieOverwriteChk.checked = state.renderMoviePrefs.overwrite !== false;
  if (els.renderMovieSummary) {
    els.renderMovieSummary.textContent = renderSettingsSummaryText();
  }
}

function updateRenderMovieDialogActions() {
  const busy = renderJob.running || renderJob.encoding;
  if (els.renderMovieCancelBtn) {
    els.renderMovieCancelBtn.disabled = busy;
  }
  if (els.renderMovieConfirmBtn) {
    els.renderMovieConfirmBtn.disabled = busy;
  }
  if (els.renderMovieFilenameInput) {
    els.renderMovieFilenameInput.disabled = busy;
  }
  if (els.renderMovieBrowseBtn) {
    els.renderMovieBrowseBtn.disabled = busy;
  }
  if (els.renderMovieOverwriteChk) {
    els.renderMovieOverwriteChk.disabled = busy;
  }
  const settingButtons = [
    els.renderFormatMp4Btn,
    els.renderFormatWebmBtn,
    els.renderFormatGifBtn,
    els.renderQualityLowBtn,
    els.renderQualityMedBtn,
    els.renderQualityHighBtn,
    els.renderResCanvasBtn,
    els.renderRes720Btn,
    els.renderRes1080Btn,
    els.renderRes1440Btn,
    els.renderRes2160Btn,
  ];
  for (const btn of settingButtons) {
    if (!btn) continue;
    btn.disabled = busy;
  }
  if (els.renderFpsInput) {
    els.renderFpsInput.disabled = busy;
  }
  if (els.renderLoopInput) {
    els.renderLoopInput.disabled = busy;
  }
  if (els.renderIncludeColorbarBtn) els.renderIncludeColorbarBtn.disabled = busy;
  if (els.renderIncludeSkyDirectionsBtn) els.renderIncludeSkyDirectionsBtn.disabled = busy;
  if (els.renderIncludeLengthScaleBtn) els.renderIncludeLengthScaleBtn.disabled = busy;
  if (els.renderIncludeSampleLabelsBtn) els.renderIncludeSampleLabelsBtn.disabled = busy;
}

async function chooseRenderMovieFolder() {
  const payload = await fetchJson("/api/fs/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "folder" }),
  });
  if (payload.canceled) return false;
  if (!payload.exists || !payload.is_dir) {
    throw new Error(`invalid folder: ${payload.path || "unknown"}`);
  }
  state.renderMoviePrefs.outputDir = payload.path;
  updateRenderMovieDialogFields();
  return true;
}

function openRenderMovieDialog() {
  if (!els.renderMovieDialog) return;
  readRenderSettingsFromUi();
  if (!state.renderMoviePrefs.filename) {
    state.renderMoviePrefs.filename = defaultRenderMovieFilename(state.renderMoviePrefs.format);
  }
  state.renderMoviePrefs.filename = normalizeRenderMovieFilename(state.renderMoviePrefs.filename, state.renderMoviePrefs.format);
  updateRenderSettingsFields();
  updateRenderMovieDialogFields();
  updateRenderMovieDialogActions();
  setRenderMovieStatus("");
  if (typeof els.renderMovieDialog.showModal === "function") {
    els.renderMovieDialog.showModal();
  }
}

function closeRenderMovieDialog() {
  if (!els.renderMovieDialog) return;
  if (els.renderMovieDialog.open) {
    els.renderMovieDialog.close();
  }
  setRenderMovieStatus("");
}

const offlineRenderController = createOfflineRenderController({
  state,
  els,
  renderJob,
  sampleMorphAxis: SAMPLE_MORPH_AXIS,
  renderAxisRotate: RENDER_AXIS_ROTATE,
  fetchJson,
  preferredMovieMimeType,
  normalizeRecordMovieFormat,
  normalizeRecordQuality,
  normalizeRenderFps,
  normalizeRenderLoops,
  normalizeRenderOverlayOption,
  normalizeRenderMovieFilename,
  visibleCanvasForSnapshot,
  resolveRenderFrameDimensions,
  temporalScaleFactor,
  spectralScaleFactor,
  axisSize,
  getAxisWindow,
  resampledDomainLength,
  clamp,
  chooseRenderMovieFolder,
  setRenderMovieStatus,
  closeRenderMovieDialog,
  canRenderSweepAxis,
  resolveRenderSweepAxis,
  isAxisSelectorLocked,
  isAxisProjectionActive,
  axisDisplayLabel,
  sampleCount,
  isSampleMorphMode,
  resetSampleMorphState,
  updateControlCaps,
  refreshSlice,
  prepareSampleMorphPair,
  advanceSampleMorphPlayback,
  normalizeViewRotateRate,
  applyVolumeAutoRotateDelta,
  rerenderVolumeFrame,
  isVolumeMode,
  isSphereMode,
  applySphereAutoRotateDelta,
  rerenderSphereFrame,
  setAxisIndex,
  blendCanvasPair,
  isNotFoundError,
  isAbortError,
  setSystemPickerStatus,
  cloneSessionValue,
  isPlaying,
  isSampleMorphPlaybackActive,
  stopPlayback,
  stopSampleMorphPlayback,
  drawFrameAndOverlays,
  setRenderOverlayOverride: setRenderOverlayDrawOverride,
  updateSliderReadouts,
  refreshSelectionAnalytics,
  updateRenderMovieDialogActions,
  updateExportButtonState,
  computeSampleMorphRenderFrameCount,
  computeRenderRotationFrameCount,
  blobToDataUrl,
  readRenderSettingsFromUi,
});

function requestRenderCancel() {
  return offlineRenderController.requestRenderCancel();
}

async function runOfflineRenderFromDialog() {
  return offlineRenderController.runOfflineRenderFromDialog();
}

function modifierDragMode(metaDown, shiftDown) {
  if (metaDown) return "zoom";
  if (shiftDown) return "investigate";
  return null;
}

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  const uaPlatform =
    navigator.userAgentData && typeof navigator.userAgentData.platform === "string"
      ? navigator.userAgentData.platform
      : "";
  const platformInfo = `${navigator.platform || ""} ${uaPlatform}`.toLowerCase();
  return platformInfo.includes("mac");
}

function updateModeButtonTooltips() {
  if (!els.modeInspectBtn || !els.modeZoomBtn) return;
  const zoomModifier = isMacPlatform() ? "Command (\u2318)" : "Ctrl";
  els.modeInspectBtn.title = "Inspect (Shift)";
  els.modeZoomBtn.title = `Zoom (${zoomModifier})`;
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

function sampleMorphDeltaTSec() {
  return Math.max(0.01, state.sampleMorphDeltaT || 0.5);
}

function volumeSpatialRenderFactor() {
  // Volume raymarching already interpolates values continuously (trilinear),
  // so apply a conservative frame-resolution boost to avoid stalls at high scales.
  return clamp(Math.sqrt(spatialScaleFactor()), 0.5, 2.0);
}

function volumeFrameResolution(tileCount = 1) {
  const qCfg = volumeQualityConfig();
  const base = tileCount > 1
    ? clamp(Math.round(volumeBaseResolution(tileCount) * qCfg.resMul), 140, 420)
    : clamp(Math.round(volumeBaseResolution(1) * qCfg.resMul), 180, 520);
  const scaled = clamp(Math.round(base * volumeSpatialRenderFactor()), 96, VOLUME_FRAME_RES_MAX);
  if (!state.volumeDrag) return scaled;
  const min = tileCount > 1 ? 96 : 120;
  const max = tileCount > 1 ? 260 : 300;
  return clamp(Math.round(scaled * 0.55), min, max);
}

function setNavigatorProjectionState(canvas, projected) {
  if (!canvas) return;
  canvas.classList.toggle("isProjected", Boolean(projected));
}

function updateSampleMorphPlaybackStatus() {
  if (els.sampleMorphDeltaSelect) {
    els.sampleMorphDeltaSelect.value = String(state.sampleMorphDeltaT);
  }
  if (!els.sampleMorphStatus) return;
  if (!isSampleMorphMode() || !state.sampleMorph.fromCanvas || !state.sampleMorph.toCanvas) {
    els.sampleMorphStatus.textContent = "";
  } else {
    const pct = Math.round(clamp(state.sampleMorph.alpha, 0, 1) * 100);
    els.sampleMorphStatus.textContent = `S${state.sampleMorph.fromSample} -> S${state.sampleMorph.toSample} (${pct}%)`;
  }
}

function updatePolButtonState() {
  const polSize = axisSize("pol");
  const evpaSupported = !isSparseSceneView() && !isVolumeMode() && state.plane === "xy" && polSize >= 3;
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
  els.evpaToggleBtn.title = isSparseSceneView()
    ? "EVPA ticks need a dedicated bounded Scene source query."
    : "";
  els.evpaToggleBtn.classList.toggle("activeAux", state.showEvpa);
  els.evpaDensitySelect.disabled = !evpaSupported;
  els.evpaDensitySelect.value = String(state.evpaStep);
  els.evpaIThresholdSelect.disabled = !evpaSupported;
  const iThresholdPct = clamp(Math.round(state.evpaIMinFraction * 100), 0, 100);
  const evpaThresholdOptions = [0, 1, 3, 5, 10, 15, 20];
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

  els.tValue.textContent = fmtPhysical("t", tCoord, axisDisplayUnit("t"));
  els.nuValue.textContent = fmtPhysical("nu", nuCoord, axisDisplayUnit("nu"));
  els.hiddenNavValue.textContent = fmtPhysical(hDim, hCoord, axisDisplayUnit(hDim));
}

function updateSpatialProfileTitle(profile) {
  if (profile && profile.axis) {
    els.spatialProfileTitle.textContent = `${axisDisplayLabel(profile.axis)} Flux Profile`;
  } else {
    els.spatialProfileTitle.textContent = `${axisDisplayLabel(hiddenDim())} Flux Profile`;
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
    setVisible(els.viewRotateControls, false);
    setVisible(els.timeProfileBlock, false);
    setVisible(els.spectrumProfileBlock, false);
    setVisible(els.spatialProfileBlock, false);
    if (els.metricsHint) {
      els.metricsHint.textContent = "Load a dataset to enable controls and profiles.";
    }
    updateVolumeControlReadouts();
    updateViewRotateControls();
    return;
  }

  let volumeMode = isVolumeMode();
  let sphereMode = isSphereMode();
  const sphereDataset = isSphereDataset();
  const tVarying = axisVarying("t");
  const nuVarying = axisVarying("nu");
  const sampleVarying = axisVarying("sample");
  const polVarying = axisVarying("pol");
  const thirdSpatialDim = hasThirdSpatialDimension();
  if (!thirdSpatialDim) {
    const preferredPlane = preferredSpatialPlaneForDataset();
    if (state.plane !== preferredPlane) {
      state.plane = preferredPlane;
    }
  }
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
  setVisible(els.spatialResolutionSelect ? els.spatialResolutionSelect.closest("label") : null, !sphereMode);
  setVisible(els.spatialViewRow, !sphereDataset);
  setVisible(els.spatialSliceBtn, !sphereDataset);
  setVisible(els.spatialVolumeBtn, canUseVolumeMode());
  setVisible(els.spatialSphereBtn, sphereDataset);
  setVisible(els.temporalControlGroup, tVarying);
  setVisible(els.spectralControlGroup, nuVarying);
  setVisible(els.planeLabel, !volumeMode && !sphereMode && thirdSpatialDim);
  setVisible(els.hiddenNavPanel, !volumeMode && !sphereMode && hiddenSpatialVarying);
  setVisible(els.volumeRenderControls, volumeMode);
  setVisible(els.sphereControls, sphereMode);
  setVisible(els.viewRotateControls, volumeMode || sphereMode);
  setVisible(els.polarizationControlGroup, polVarying);
  setVisible(els.sampleModeBlock, sampleVarying);
  setVisible(
    els.playbackTimingControls,
    tVarying || nuVarying || (!volumeMode && !sphereMode && hiddenSpatialVarying) || (sampleVarying && isSampleMorphMode())
  );

  const profilesAvailable = !isSparseSceneView() || sparseSceneProfilesAvailable();
  setVisible(els.timeProfileBlock, profilesAvailable && profileAxisAvailable("t") && tVarying);
  setVisible(els.spectrumProfileBlock, profilesAvailable && profileAxisAvailable("nu") && nuVarying);
  setVisible(
    els.spatialProfileBlock,
    profilesAvailable && profileAxisAvailable(hiddenAxis) && !sphereMode && hiddenSpatialVarying
  );

  if (els.metricsHint) {
    const anyProfile = tVarying || nuVarying || hiddenSpatialVarying;
    if (isSparseSceneView() && !profilesAvailable) {
      els.metricsHint.textContent = "This Scene source does not advertise bounded profiles for the active plane.";
    } else if (sphereMode) {
      els.metricsHint.textContent = "Click for point or drag for area.";
    } else {
      els.metricsHint.textContent = anyProfile
        ? "Click for point or drag for area."
        : "No varying temporal/spectral/spatial axis available for profiles.";
    }
  }
  updateVolumeControlReadouts();
  updateViewRotateControls();
}

function updateControlCaps() {
  const quantityBefore = intensityQuantityKey();
  ["sample", "pol", "t", "nu", "x", "y", "z"].forEach((dim) => {
    const max = Math.max(0, axisSize(dim) - 1);
    state.values[dim] = clamp(state.values[dim], 0, max);
  });

  for (const dim of ["x", "y", "z"]) {
    if (centralViewAxes().has(dim)) state.axisProjection[dim] = false;
  }

  const hDim = hiddenDim();
  const spectralSelectorLocked = isAxisSelectorLocked("nu");
  els.hiddenAxisTitle.textContent = axisDisplayLabel(hDim);
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
    els.timeProjectBtn.title = isSparseSceneView()
      ? "Axis projection is unavailable until the Scene source advertises a bounded reduction."
      : "";
  }
  if (els.freqProjectBtn) {
    const active = isAxisProjectionActive("nu");
    els.freqProjectBtn.disabled = spectralSelectorLocked || !canProjectAxis("nu");
    els.freqProjectBtn.classList.toggle("activeProject", active);
    els.freqProjectBtn.textContent = "Project";
    els.freqProjectBtn.title = isSparseSceneView()
      ? "Axis projection is unavailable until the Scene source advertises a bounded reduction."
      : "";
  }
  if (els.hiddenProjectBtn) {
    const active = isAxisProjectionActive(hDim);
    els.hiddenProjectBtn.disabled = !canProjectAxis(hDim);
    els.hiddenProjectBtn.classList.toggle("activeProject", active);
    els.hiddenProjectBtn.textContent = "Project";
    els.hiddenProjectBtn.title = isSparseSceneView()
      ? "Axis projection is unavailable until the Scene source advertises a bounded reduction."
      : "";
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
  if (els.spatialResolutionSelect) {
    els.spatialResolutionSelect.value = String(spatialScaleFactor());
  }
  if (els.temporalResolutionSelect) {
    els.temporalResolutionSelect.value = String(temporalScaleFactor());
  }
  if (els.spectralResolutionSelect) {
    els.spectralResolutionSelect.value = String(spectralScaleFactor());
  }
  if (els.axisSettingsBtn) {
    els.axisSettingsBtn.disabled = !state.meta;
  }
  updateAxisSettingsButtonState();
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
    els.sphereMetaLabel.textContent = "";
  }
  els.planeSelect.value = state.plane;
  els.planeSelect.disabled = isVolumeMode() || isSphereMode() || !hasThirdSpatialDimension();
  const msAvailable = canUseMultiSpectral();
  if (!msAvailable) state.multiSpectral = false;
  state.multiSpectralComputeBackend = normalizeComputeBackendPreference(state.multiSpectralComputeBackend);
  if (state.multiSpectralNuAxisScale !== "log") state.multiSpectralNuAxisScale = "linear";
  if (!Number.isFinite(state.multiSpectralDeslope)) state.multiSpectralDeslope = 0;
  state.multiSpectralDeslope = clamp(state.multiSpectralDeslope, -8, 8);
  state.multiSpectralNormalizeSpectrum = Boolean(state.multiSpectralNormalizeSpectrum);
  state.multiSpectralNormalizeBoost = normalizeMultispectralNormalizeBoost(state.multiSpectralNormalizeBoost);
  state.multiSpectralChannelRange = normalizeMultispectralChannelRange(state.multiSpectralChannelRange);
  els.multiSpectralBtn.disabled = !msAvailable;
  els.multiSpectralBtn.title = "";
  els.multiSpectralBtn.textContent = state.multiSpectral ? "On" : "Off";
  els.multiSpectralBtn.classList.toggle("activeAux", state.multiSpectral);
  if (els.spectralMapControls) {
    els.spectralMapControls.style.display = msAvailable && state.multiSpectral ? "grid" : "none";
  }
  if (els.computeBackendSelect) {
    els.computeBackendSelect.value = state.multiSpectralComputeBackend;
    els.computeBackendSelect.disabled = !msAvailable || !state.multiSpectral;
  }
  if (els.msNuAxisLogBtn) {
    const logAxis = state.multiSpectralNuAxisScale === "log";
    els.msNuAxisLogBtn.disabled = !msAvailable || !state.multiSpectral;
    els.msNuAxisLogBtn.textContent = "Log";
    els.msNuAxisLogBtn.classList.toggle("activeAux", logAxis);
    els.msNuAxisLogBtn.setAttribute("aria-pressed", logAxis ? "true" : "false");
  }
  if (els.msDeslopeRange) {
    els.msDeslopeRange.value = String(state.multiSpectralDeslope);
    els.msDeslopeRange.disabled = !msAvailable || !state.multiSpectral;
    setSliderFill(els.msDeslopeRange);
  }
  if (els.msDeslopeValue) {
    els.msDeslopeValue.textContent = multispectralDeslopeLabel();
  }
  if (els.msNormalizeBtn) {
    els.msNormalizeBtn.disabled = !msAvailable || !state.multiSpectral;
    els.msNormalizeBtn.textContent = state.multiSpectralNormalizeSpectrum ? "On" : "Off";
    els.msNormalizeBtn.classList.toggle("activeAux", state.multiSpectralNormalizeSpectrum);
    els.msNormalizeBtn.setAttribute("aria-pressed", state.multiSpectralNormalizeSpectrum ? "true" : "false");
  }
  if (els.msNormalizeBoostRange) {
    els.msNormalizeBoostRange.value = String(state.multiSpectralNormalizeBoost);
    els.msNormalizeBoostRange.disabled = !msAvailable || !state.multiSpectral || !state.multiSpectralNormalizeSpectrum;
    setSliderFill(els.msNormalizeBoostRange);
  }
  if (els.msNormalizeBoostLabel) {
    setVisible(els.msNormalizeBoostLabel, msAvailable && state.multiSpectral && state.multiSpectralNormalizeSpectrum);
  }
  if (els.msNormalizeBoostValue) {
    els.msNormalizeBoostValue.textContent = multispectralNormalizeBoostLabel();
  }
  if (els.msChannelRangeBlock) {
    els.msChannelRangeBlock.classList.toggle("isDisabled", !msAvailable || !state.multiSpectral);
  }
  if (els.msChannelRangeMinRange) {
    els.msChannelRangeMinRange.disabled = !msAvailable || !state.multiSpectral;
  }
  if (els.msChannelRangeMaxRange) {
    els.msChannelRangeMaxRange.disabled = !msAvailable || !state.multiSpectral;
  }
  if (els.msChannelRangeBoundMin) els.msChannelRangeBoundMin.textContent = "0%";
  if (els.msChannelRangeBoundMax) els.msChannelRangeBoundMax.textContent = "100%";
  syncMultispectralRangeUi();
  if (els.spectralNavPanel) {
    els.spectralNavPanel.classList.toggle("isLocked", spectralSelectorLocked);
  }
  els.fluxScaleLinearBtn.classList.toggle("activeScale", state.fluxScale === "linear");
  els.fluxScaleSqrtBtn.classList.toggle("activeScale", state.fluxScale === "sqrt");
  els.fluxScaleLogBtn.classList.toggle("activeScale", state.fluxScale === "log");
  els.fluxScaleLinearBtn.disabled = false;
  els.fluxScaleSqrtBtn.disabled = false;
  els.fluxScaleLogBtn.disabled = false;
  els.resampleSamplesBtn.disabled = !isSamplesMode();

  updatePolButtonState();
  updateModeButtons();
  updateCoordSystemOptions();
  updateExportFormatAvailability();
  updateExportButtonState();
  syncSampleMorphPlayback();
  updatePlayUi();
  updateSliderReadouts(state.selectedCoords);
  applyIntensityQuantityTransition(quantityBefore, intensityQuantityKey());
  updateColorNormalizationControls();
  updateSpatialProfileTitle(state.profiles ? state.profiles.spatial_profile : null);
  updateHoverReadout();
  updateBackendStatusUi();
}

function setFluxScale(mode) {
  if (!["linear", "sqrt", "log"].includes(mode)) return;
  if (state.fluxScale === mode) return;
  state.fluxScale = mode;
  updateControlCaps();
  drawNavigationGraphs();
  drawSelectionGraphs();
  refreshSlice();
}

function rerenderMultispectralFromCache() {
  if (!multispectralFrameActive()) {
    drawColorbar();
    return false;
  }
  if (isSphereMode()) {
    if (
      Boolean(state.currentMultispectralSlice) ||
      (Array.isArray(state.currentMultispectralTiles) && state.currentMultispectralTiles.length) ||
      (isSampleMorphMode() && state.sampleMorph.multispectral && state.sampleMorph.fromSlice && state.sampleMorph.toSlice)
    ) {
      rerenderSphereFrame();
      return true;
    }
    drawColorbar();
    return false;
  }

  if (isSampleMorphMode() && state.sampleMorph.multispectral && state.sampleMorph.fromSlice && state.sampleMorph.toSlice) {
    state.sampleMorph.fromCanvas = createRgbCanvas(
      state.sampleMorph.fromSlice.shape[0],
      state.sampleMorph.fromSlice.shape[1],
      state.sampleMorph.fromSlice.values.r,
      state.sampleMorph.fromSlice.values.g,
      state.sampleMorph.fromSlice.values.b,
      state.sampleMorph.fromSlice
    );
    state.sampleMorph.toCanvas = createRgbCanvas(
      state.sampleMorph.toSlice.shape[0],
      state.sampleMorph.toSlice.shape[1],
      state.sampleMorph.toSlice.values.r,
      state.sampleMorph.toSlice.values.g,
      state.sampleMorph.toSlice.values.b,
      state.sampleMorph.toSlice
    );
    renderSampleMorphFrame();
    return true;
  }

  if (Array.isArray(state.currentMultispectralTiles) && state.currentMultispectralTiles.length) {
    const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, state.currentMultispectralTiles.length - 1));
    const primary = state.currentMultispectralTiles[activeIdx] || state.currentMultispectralTiles[0] || null;
    state.currentMultispectralSlice = primary;
    state.currentMultispectralBands = primary ? primary.bands || null : null;
    updateBackendStatusUi();
    const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
    const tiles = state.currentMultispectralTiles.map((ms) =>
      createRgbCanvas(ms.shape[0], ms.shape[1], ms.values.r, ms.values.g, ms.values.b, ms)
    );
    renderTileFrame(tiles, state.sampleGridSize, selectedCoords, null);
    return true;
  }

  if (state.currentMultispectralSlice) {
    const ms = state.currentMultispectralSlice;
    state.currentMultispectralBands = ms.bands || null;
    updateBackendStatusUi();
    renderFrame(
      createRgbCanvas(ms.shape[0], ms.shape[1], ms.values.r, ms.values.g, ms.values.b, ms),
      ms.selected_coords || indicesToCoords(ms.selected_indices),
      null
    );
    return true;
  }

  drawColorbar();
  return false;
}

function scheduleMultispectralLocalRerender() {
  if (state._multispectralRerenderRaf) return;
  state._multispectralRerenderRaf = window.requestAnimationFrame(() => {
    state._multispectralRerenderRaf = 0;
    rerenderMultispectralFromCache();
  });
}

async function refreshMultispectralControlsFromServer() {
  if (state._multispectralRerenderRaf) {
    window.cancelAnimationFrame(state._multispectralRerenderRaf);
    state._multispectralRerenderRaf = 0;
  }
  if (!multispectralFrameActive()) {
    drawColorbar();
    return;
  }
  try {
    await refreshSlice();
  } catch (err) {
    if (!isAbortError(err)) console.warn("multispectral control refresh failed:", err);
  }
}

function onMultispectralRangeInput(bound, commit = false) {
  if (!els.msChannelRangeMinRange || !els.msChannelRangeMaxRange) return;
  const minStep = Number.parseInt(els.msChannelRangeMinRange.value, 10);
  const maxStep = Number.parseInt(els.msChannelRangeMaxRange.value, 10);
  if (!Number.isFinite(minStep) || !Number.isFinite(maxStep)) return;
  let low = clamp(minStep / MULTISPECTRAL_RANGE_STEPS, 0, 1 - MULTISPECTRAL_RANGE_MIN_GAP);
  let high = clamp(maxStep / MULTISPECTRAL_RANGE_STEPS, MULTISPECTRAL_RANGE_MIN_GAP, 1);
  if (high <= low + MULTISPECTRAL_RANGE_MIN_GAP) {
    if (bound === "min") high = Math.min(1, low + MULTISPECTRAL_RANGE_MIN_GAP);
    else low = Math.max(0, high - MULTISPECTRAL_RANGE_MIN_GAP);
  }
  low = clamp(low, 0, 1 - MULTISPECTRAL_RANGE_MIN_GAP);
  high = clamp(high, low + MULTISPECTRAL_RANGE_MIN_GAP, 1);
  state.multiSpectralChannelRange = { min: low * 100, max: high * 100 };
  syncMultispectralRangeUi();
  if (commit) {
    void refreshMultispectralControlsFromServer();
    return;
  }
  scheduleMultispectralLocalRerender();
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
    let activeBound = null;
    if (els.volumeClipRangeMin && document.activeElement === els.volumeClipRangeMin) activeBound = "min";
    if (els.volumeClipRangeMax && document.activeElement === els.volumeClipRangeMax) activeBound = "max";
    syncVolumeClipRangeStateFromSteps(activeBound);
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
    ctx.lineWidth = 1.6 * s;

    let ticks = state.evpaTicks;
    if (isSamplesMode() && state.frameTiles && state.frameTiles.length > 1) {
      const sampleIdx = state.sampleGridIndices[i];
      ticks = state.evpaTicksBySample[String(sampleIdx)] || state.evpaTicks;
    }
    for (const tick of ticks) {
      const drawTick = evpaTickForCurrentPlane(tick);
      if (!drawTick) continue;
      const p0 = dataToScreen(drawTick.x - drawTick.dx, drawTick.y - drawTick.dy, viewRect, tileRect);
      const p1 = dataToScreen(drawTick.x + drawTick.dx, drawTick.y + drawTick.dy, viewRect, tileRect);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function evpaTickForCurrentPlane(tick) {
  if (!tick || !Number.isFinite(tick.x) || !Number.isFinite(tick.y)) return null;
  if (!Number.isFinite(tick.dx) || !Number.isFinite(tick.dy)) return null;
  if (state.plane !== "xy") return tick;
  if (!axisPlaneSwapEnabled("xy")) return tick;
  return {
    x: tick.y,
    y: tick.x,
    dx: tick.dy,
    dy: tick.dx,
  };
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
  if (!axisHasCustomUnit(dim) && (dim === "nu" || unit === "Hz")) return `${(value / 1.0e9).toFixed(3)} GHz`;
  const abs = Math.abs(value);
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return `${value.toExponential(2)} ${unit}`.trim();
  return `${value.toFixed(2)} ${unit}`.trim();
}

function drawOrientationAndScale(viewRect, drawRect, options = null) {
  if (isVolumeMode() || isSphereMode()) return;
  const includeSkyDirections = !options || options.includeSkyDirections !== false;
  const includeLengthScale = !options || options.includeLengthScale !== false;
  if (!includeSkyDirections && !includeLengthScale) return;
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

  if (includeSkyDirections) {
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
      const xSign = axisIsFlipped(p.planeX) ? "-" : "+";
      const ySign = axisIsFlipped(p.planeY) ? "-" : "+";
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(baseX, baseY - arrow);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(baseX, baseY);
      ctx.lineTo(baseX + arrow, baseY);
      ctx.stroke();
      ctx.fillText(`${ySign}${p.planeY.toUpperCase()}`, baseX - 6 * s, baseY - arrow - 4 * s);
      ctx.fillText(`${xSign}${p.planeX.toUpperCase()}`, baseX + arrow + 2 * s, baseY + 4 * s);
    }
  }

  if (includeLengthScale) {
    const p = planeDims();
    const dim = p.planeX;
    const unit = axisDisplayUnit(dim);
    const c0 = axisValueCoord(dim, dimCoord(dim, viewRect.srcX));
    const c1 = axisValueCoord(dim, dimCoord(dim, viewRect.srcX + viewRect.srcW - 1));
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
  }

  ctx.restore();
}

function drawFrameAndOverlays() {
  const renderStartedAt = performance.now();
  syncCanvasToDisplaySize(els.canvas);
  const ctx = els.canvas.getContext("2d");
  const s = canvasPixelRatio(els.canvas);
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = "#070a11";
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  const hasFrame = Boolean(state.frameCanvas || (state.frameTiles && state.frameTiles.length));
  try {
    if (!hasFrame) {
      state.drawTiles = [];
      state.drawRect = null;
      return;
    }
    const baseViewRect = getViewRect();
    const renderGeometry = getRenderGeometry(baseViewRect);
    const viewRect = renderGeometry.viewRect;
    let drawRect;
    state.drawTiles = [];
    const smoothUpscale = spatialScaleFactor() !== 1 && !isVolumeMode() && !isSphereMode();
    ctx.imageSmoothingEnabled = smoothUpscale;
    if (ctx.imageSmoothingEnabled && "imageSmoothingQuality" in ctx) {
      ctx.imageSmoothingQuality = "high";
    }

    if (state.frameTiles && state.frameTiles.length) {
      const gridRects = getGridDrawRects(viewRect);
      drawRect = { x: gridRects.x, y: gridRects.y, w: gridRects.w, h: gridRects.h };
      state.drawTiles = gridRects.tiles;

      for (let i = 0; i < state.frameTiles.length && i < gridRects.tiles.length; i += 1) {
        const tileCanvas = state.frameTiles[i];
        const tileRect = gridRects.tiles[i];
        const srcRect = canvasViewSourceRect(tileCanvas, viewRect);
        drawImageWithPlaneFlip(ctx, tileCanvas, srcRect, tileRect);

        const includeSampleLabels = !renderOverlayDrawOverride || renderOverlayDrawOverride.includeSampleLabels !== false;
        if (isSamplesMode() && includeSampleLabels && Number.isInteger(state.sampleGridIndices[i])) {
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
      drawRect = renderGeometry.drawRect;
      state.drawTiles = [drawRect];
      const srcRect = canvasViewSourceRect(state.frameCanvas, viewRect);
      drawImageWithPlaneFlip(ctx, state.frameCanvas, srcRect, drawRect);
    }
    state.drawRect = drawRect;
    if (els.colorbarPanel) {
      const cssBarW = colorbarReferenceCssWidth(baseViewRect, s);
      els.colorbarPanel.style.width = `${cssBarW}px`;
    }

    drawOrientationAndScale(viewRect, drawRect, renderOverlayDrawOverride);
    drawEvpaOverlay(viewRect, drawRect);
    drawSelectionOverlay(viewRect, drawRect);
    drawZoomDragOverlay(viewRect, drawRect);
  } finally {
    recordViewerRender(renderStartedAt, hasFrame ? "viewer-frame" : "viewer-empty");
  }
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
const SPHERE_INSIDE_SCALE_MIN = 0.004;
const SPHERE_INSIDE_SCALE_MAX = 6.0;
const SPHERE_OUTSIDE_RADIUS = 0.47;
const SPHERE_DRAG_PREVIEW_MAX_PIXELS = 140000;

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
  const m = activeSphereRotationMatrix();
  return [
    x * m[0] + y * m[1] + z * m[2],
    x * m[3] + y * m[4] + z * m[5],
    x * m[6] + y * m[7] + z * m[8],
  ];
}

function inverseSphereRotationMatrix() {
  return mat3Transpose(activeSphereRotationMatrix());
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
  const xSign = sphereHorizontalFlipEnabled() ? -1 : 1;
  if (projection === "inside") {
    const nx = px / Math.max(1, width - 1);
    const ny = py / Math.max(1, height - 1);
    const insideScale = sphereInsideRenderScale();
    const u = ((nx - 0.5) * xSign) / insideScale;
    const v = (0.5 - ny) / insideScale;
    const inv = 1 / Math.sqrt(1 + u * u + v * v);
    return [inv, u * inv, v * inv];
  }
  if (projection === "outside") {
    const cx = 0.5 * (width - 1);
    const cy = 0.5 * (height - 1);
    const r = SPHERE_OUTSIDE_RADIUS * Math.min(width, height);
    const y = ((px - cx) * xSign) / Math.max(1.0e-6, r);
    const z = (cy - py) / Math.max(1.0e-6, r);
    const rr = y * y + z * z;
    if (rr > 1.0) return null;
    const x = Math.sqrt(Math.max(0, 1 - rr));
    return [x, y, z];
  }
  if (projection === "mollweide") {
    const xProj = ((px / Math.max(1, width - 1)) * (4 * Math.SQRT2) - 2 * Math.SQRT2) * xSign;
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
  const key = `${projection}:${width}x${height}:${insideScale}:${SPHERE_OUTSIDE_RADIUS}:${sphereHorizontalFlipEnabled() ? "flip" : "native"}`;
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

function sphereOrthogonalBasis(x, y, z) {
  let rx = 0;
  let ry = 0;
  let rz = 1;
  if (Math.abs(z) > 0.9) {
    rx = 0;
    ry = 1;
    rz = 0;
  }

  let tx = ry * z - rz * y;
  let ty = rz * x - rx * z;
  let tz = rx * y - ry * x;
  let tn = Math.hypot(tx, ty, tz);
  if (!(tn > 1.0e-12)) {
    tx = 1;
    ty = 0;
    tz = 0;
    tn = 1;
  }
  tx /= tn;
  ty /= tn;
  tz /= tn;

  let ux = y * tz - z * ty;
  let uy = z * tx - x * tz;
  let uz = x * ty - y * tx;
  let un = Math.hypot(ux, uy, uz);
  if (!(un > 1.0e-12)) {
    ux = 0;
    uy = 1;
    uz = 0;
    un = 1;
  }
  ux /= un;
  uy /= un;
  uz /= un;
  return [tx, ty, tz, ux, uy, uz];
}

function sphereNormalizeVector(x, y, z) {
  const norm = Math.hypot(x, y, z);
  if (!(norm > 1.0e-12)) return [1, 0, 0];
  const inv = 1 / norm;
  return [x * inv, y * inv, z * inv];
}

function sphereUpsampleKernelCacheKey(dataNside, mapNside, ordering) {
  return `${ordering}:${dataNside}->${mapNside}`;
}

function cacheSphereUpsampleKernel(key, kernel) {
  sphereUpsampleKernelCache.set(key, kernel);
  if (sphereUpsampleKernelCache.size <= SPHERE_UPSAMPLE_KERNEL_CACHE_MAX) return;
  const oldestKey = sphereUpsampleKernelCache.keys().next().value;
  if (oldestKey !== undefined) sphereUpsampleKernelCache.delete(oldestKey);
}

function ensureSphereUpsampleKernel(dataNside, mapNside, ordering, ringLut) {
  if (!(mapNside > dataNside)) return null;
  const key = sphereUpsampleKernelCacheKey(dataNside, mapNside, ordering);
  const cached = sphereUpsampleKernelCache.get(key);
  if (cached) return cached;

  const mapNpix = 12 * mapNside * mapNside;
  const samples = new Int32Array(mapNpix * 5);
  const centers = new Int32Array(mapNpix);
  samples.fill(-1);
  centers.fill(-1);

  const ringToData = ordering === "nested" ? ringLut : null;
  const angularJitter = 0.62 / Math.max(1, dataNside);
  for (let mapRing = 0; mapRing < mapNpix; mapRing += 1) {
    const [vx, vy, vz] = healpixRingPixToVector(mapNside, mapRing);
    const [tx, ty, tz, ux, uy, uz] = sphereOrthogonalBasis(vx, vy, vz);
    const samplePoints = [
      vx,
      vy,
      vz,
      ...sphereNormalizeVector(vx + tx * angularJitter, vy + ty * angularJitter, vz + tz * angularJitter),
      ...sphereNormalizeVector(vx - tx * angularJitter, vy - ty * angularJitter, vz - tz * angularJitter),
      ...sphereNormalizeVector(vx + ux * angularJitter, vy + uy * angularJitter, vz + uz * angularJitter),
      ...sphereNormalizeVector(vx - ux * angularJitter, vy - uy * angularJitter, vz - uz * angularJitter),
    ];

    let center = -1;
    const base = mapRing * 5;
    for (let si = 0; si < 5; si += 1) {
      const pi = si * 3;
      const ring = healpixVecToRingPix(dataNside, samplePoints[pi + 0], samplePoints[pi + 1], samplePoints[pi + 2]);
      const dataIdx = ringToData ? ringToData[ring] : ring;
      if (!Number.isFinite(dataIdx) || dataIdx < 0) continue;
      samples[base + si] = dataIdx;
      if (si === 0) center = dataIdx;
    }
    if (center < 0) {
      for (let si = 1; si < 5; si += 1) {
        const idx = samples[base + si];
        if (idx >= 0) {
          center = idx;
          break;
        }
      }
    }
    centers[mapRing] = center;
  }

  const kernel = { samples, centers, mapNpix };
  cacheSphereUpsampleKernel(key, kernel);
  return kernel;
}

function sphereBuildRayMappedColorBuffers(npix, colorForPixel, dataNside, mapNside, ordering, ringLut, interpolateUpscale) {
  const dataR = new Uint8Array(npix);
  const dataG = new Uint8Array(npix);
  const dataB = new Uint8Array(npix);
  const fallback = colorForNorm(0);
  for (let ipix = 0; ipix < npix; ipix += 1) {
    const rgb = colorForPixel(ipix);
    if (rgb) {
      dataR[ipix] = rgb[0];
      dataG[ipix] = rgb[1];
      dataB[ipix] = rgb[2];
    } else {
      dataR[ipix] = fallback[0];
      dataG[ipix] = fallback[1];
      dataB[ipix] = fallback[2];
    }
  }

  const useInterpolation = Boolean(interpolateUpscale && mapNside > dataNside);
  if (!useInterpolation) {
    return {
      colorR: dataR,
      colorG: dataG,
      colorB: dataB,
      mapToData: null,
      interpolated: false,
    };
  }

  const kernel = ensureSphereUpsampleKernel(dataNside, mapNside, ordering, ringLut);
  if (!kernel) {
    return {
      colorR: dataR,
      colorG: dataG,
      colorB: dataB,
      mapToData: null,
      interpolated: false,
    };
  }
  const mapNpix = kernel.mapNpix;
  const mapR = new Uint8Array(mapNpix);
  const mapG = new Uint8Array(mapNpix);
  const mapB = new Uint8Array(mapNpix);
  const mapToData = kernel.centers;
  const sampleIdx = kernel.samples;
  const sampleWeight = [2.2, 1, 1, 1, 1];

  for (let mapRing = 0; mapRing < mapNpix; mapRing += 1) {
    const base = mapRing * 5;
    let wr = 0;
    let wg = 0;
    let wb = 0;
    let wsum = 0;
    for (let si = 0; si < 5; si += 1) {
      const idx = sampleIdx[base + si];
      if (idx < 0 || idx >= npix) continue;
      const w = sampleWeight[si];
      wr += dataR[idx] * w;
      wg += dataG[idx] * w;
      wb += dataB[idx] * w;
      wsum += w;
    }
    if (!(wsum > 0)) {
      mapR[mapRing] = 255;
      mapG[mapRing] = 255;
      mapB[mapRing] = 255;
      continue;
    }
    mapR[mapRing] = clamp(Math.round(wr / wsum), 0, 255);
    mapG[mapRing] = clamp(Math.round(wg / wsum), 0, 255);
    mapB[mapRing] = clamp(Math.round(wb / wsum), 0, 255);
  }

  return {
    colorR: mapR,
    colorG: mapG,
    colorB: mapB,
    mapToData,
    interpolated: true,
  };
}

function renderSphereRayMapped(img, indexMap, width, height, projection, npix, colorForPixel, vectors, dataNside, renderNside) {
  if (projection !== "inside" && projection !== "outside" && projection !== "mollweide") return false;
  const ordering = state.sphereMeta.ordering || "ring";
  const ringLut = ordering === "nested" ? ensureSphereRingToDataLut(vectors) : null;
  const rayGrid = ensureSphereRayGrid(width, height, projection);
  if (!rayGrid || !rayGrid.pixels || !rayGrid.rays) return false;

  const data = img.data;
  const nside = Math.max(1, Math.round(dataNside || state.sphereMeta.nside || 1));
  const mapNside = Math.max(1, Math.round(renderNside || nside));
  const useUpscaleInterpolation = mapNside > nside && !state.sphereDrag;
  const colorBuffers = sphereBuildRayMappedColorBuffers(
    npix,
    colorForPixel,
    nside,
    mapNside,
    ordering,
    ringLut,
    useUpscaleInterpolation
  );
  const colorR = colorBuffers.colorR;
  const colorG = colorBuffers.colorG;
  const colorB = colorBuffers.colorB;
  const mapToData = colorBuffers.mapToData;
  const interpolated = colorBuffers.interpolated === true;

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

    let colorIdx = -1;
    let dataIdx = -1;
    if (interpolated) {
      const mapRing = healpixVecToRingPix(mapNside, wx, wy, wz);
      colorIdx = mapRing;
      dataIdx = mapToData ? mapToData[mapRing] : -1;
      if (dataIdx < 0) {
        const mapVec = healpixRingPixToVector(mapNside, mapRing);
        const ring = healpixVecToRingPix(nside, mapVec[0], mapVec[1], mapVec[2]);
        dataIdx = ordering === "nested" ? ringLut[ring] : ring;
      }
    } else {
      if (mapNside === nside) {
        const ring = healpixVecToRingPix(nside, wx, wy, wz);
        dataIdx = ordering === "nested" ? ringLut[ring] : ring;
      } else {
        const mapRing = healpixVecToRingPix(mapNside, wx, wy, wz);
        const mapVec = healpixRingPixToVector(mapNside, mapRing);
        const ring = healpixVecToRingPix(nside, mapVec[0], mapVec[1], mapVec[2]);
        dataIdx = ordering === "nested" ? ringLut[ring] : ring;
      }
      colorIdx = dataIdx;
    }

    if (!Number.isFinite(colorIdx) || colorIdx < 0 || colorIdx >= colorR.length) continue;
    if (!Number.isFinite(dataIdx) || dataIdx < 0 || dataIdx >= npix) continue;

    const didx = pixels[k];
    const di = didx * 4;
    data[di + 0] = colorR[colorIdx];
    data[di + 1] = colorG[colorIdx];
    data[di + 2] = colorB[colorIdx];
    data[di + 3] = 255;
    indexMap[didx] = dataIdx;
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
  const xSign = sphereHorizontalFlipEnabled() ? -1 : 1;
  if (projection === "inside") {
    if (x <= 1.0e-5) return null;
    const u = (y / x) * xSign;
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
    const sx = cx + y * xSign * r;
    const sy = cy - z * r;
    if (!allowOutside && (sx < 0 || sy < 0 || sx >= width || sy >= height)) return null;
    return { x: sx, y: sy, depth: x };
  }

  const lon = Math.atan2(y, x);
  const lat = Math.asin(clamp(z, -1, 1));
  const theta = mollweideTheta(lat);
  const xProj = ((2 * Math.SQRT2) / Math.PI) * lon * Math.cos(theta) * xSign;
  const yProj = Math.SQRT2 * Math.sin(theta);
  const sx = ((xProj + 2 * Math.SQRT2) / (4 * Math.SQRT2)) * (width - 1);
  const sy = ((Math.SQRT2 - yProj) / (2 * Math.SQRT2)) * (height - 1);
  if (!allowOutside && (sx < 0 || sy < 0 || sx >= width || sy >= height)) return null;
  return { x: sx, y: sy, depth: x };
}

function sphereNsideScaleOffset() {
  // Disabled for now: sphere rendering should not be coupled to spatial resolution scaling.
  return 0;
}

function sphereRenderNside(baseNside) {
  const n = Math.max(1, Math.round(Number.isFinite(baseNside) ? baseNside : 1));
  const offset = sphereNsideScaleOffset();
  const hardMax = Math.max(SPHERE_RENDER_NSIDE_MAX, n);
  const log2n = Math.log2(n);
  if (Number.isFinite(log2n) && Math.abs(log2n - Math.round(log2n)) <= 1.0e-6) {
    const order = Math.round(log2n);
    const targetOrder = Math.max(0, order + offset);
    const scaled = 2 ** targetOrder;
    return clamp(Math.round(scaled), SPHERE_RENDER_NSIDE_MIN, hardMax);
  }
  const scaled = n + offset;
  return clamp(Math.max(1, Math.round(scaled)), SPHERE_RENDER_NSIDE_MIN, hardMax);
}

function sphereCanvasSize() {
  const baseNside = state.sphereMeta && Number.isFinite(state.sphereMeta.nside) ? state.sphereMeta.nside : 16;
  const nside = sphereRenderNside(baseNside);
  const ratio = Math.sqrt(Math.max(1.0e-6, nside / Math.max(1, baseNside)));
  if (state.sphereProjection === "inside") {
    const baseSide = clamp(Math.round(baseNside * 64), 1024, 1792);
    const side = clamp(Math.round(baseSide * ratio), 640, 1792);
    return [side, side];
  }
  if (state.sphereProjection === "outside") {
    const baseSide = clamp(Math.round(baseNside * 56), 896, 1536);
    const side = clamp(Math.round(baseSide * ratio), 560, 1536);
    return [side, side];
  }
  const baseWidth = clamp(Math.round(baseNside * 96), 1024, 2048);
  const width = clamp(Math.round(baseWidth * ratio), 768, 2048);
  return [width, Math.round(width * 0.5)];
}

function sphereRenderDimensions(options = null) {
  const [outW, outH] = sphereCanvasSize();
  const previewRequested =
    options && options.spherePreview === false
      ? false
      : (options && options.spherePreview === true) || state.sphereDrag || isPlaying() || isSampleMorphPlaybackActive();
  if (!previewRequested) {
    return { renderW: outW, renderH: outH, outW, outH };
  }
  const defaultMaxPixels = state.sphereDrag ? Math.min(playbackMaxPixelsForFrame(), SPHERE_DRAG_PREVIEW_MAX_PIXELS) : playbackMaxPixelsForFrame();
  const maxPixels =
    options && Number.isFinite(options.sphereMaxPixels) && options.sphereMaxPixels > 0
      ? Math.floor(options.sphereMaxPixels)
      : defaultMaxPixels;
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) {
    return { renderW: outW, renderH: outH, outW, outH };
  }
  const fullPixels = outW * outH;
  if (fullPixels <= maxPixels) {
    return { renderW: outW, renderH: outH, outW, outH };
  }
  const scale = Math.sqrt(maxPixels / Math.max(1, fullPixels));
  // Keep one shared preview scale so square/circular sphere projections stay stable in motion.
  const minScale = Math.max(192 / Math.max(1, outW), 128 / Math.max(1, outH));
  const previewScale = clamp(Math.max(scale, minScale), 1 / Math.max(outW, outH), 1);
  const renderW = clamp(Math.round(outW * previewScale), 1, outW);
  const renderH = clamp(Math.round(outH * previewScale), 1, outH);
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

function colorizeMultispectral(rv, gv, bv) {
  const r = clamp(Number.isFinite(rv) ? rv : 0, 0, 1);
  const g = clamp(Number.isFinite(gv) ? gv : 0, 0, 1);
  const b = clamp(Number.isFinite(bv) ? bv : 0, 0, 1);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function sphereScalarColorTableKey(mm, maxPositive, minPositive) {
  const fmt = (v) => (Number.isFinite(v) ? Number(v).toPrecision(9) : "nan");
  return [
    state.colorMap || "viridis",
    state.fluxScale || "linear",
    state.derivedPolMode || "none",
    fmt(mm?.min),
    fmt(mm?.max),
    fmt(maxPositive),
    fmt(minPositive),
  ].join("|");
}

function getSphereScalarColorTable(values, npix, mm, maxPositive, minPositive) {
  if (!values || values.length < npix) return null;
  let byKey = sphereScalarColorTableCache.get(values);
  if (!byKey) {
    byKey = new Map();
    sphereScalarColorTableCache.set(values, byKey);
  }
  const key = sphereScalarColorTableKey(mm, maxPositive, minPositive);
  const cached = byKey.get(key);
  if (cached && cached.npix === npix) return cached;

  const colors = new Uint8Array(npix * 3);
  const valid = new Uint8Array(npix);
  for (let ipix = 0; ipix < npix; ipix += 1) {
    const v = values[ipix];
    let norm;
    if (state.fluxScale === "log") {
      norm = normalizeFluxLog(v, maxPositive, minPositive);
    } else if (state.fluxScale === "sqrt") {
      norm = normalizeFluxSqrt(v, mm);
    } else {
      norm = normalizeForColormap(v, mm);
    }
    if (norm === null) continue;
    const rgb = colorForNorm(norm);
    if (!rgb) continue;
    const ci = ipix * 3;
    colors[ci + 0] = rgb[0];
    colors[ci + 1] = rgb[1];
    colors[ci + 2] = rgb[2];
    valid[ipix] = 1;
  }
  const out = { npix, colors, valid };
  byKey.set(key, out);
  return out;
}

function getSphereRgbColorTable(rgbValues, npix) {
  if (!rgbValues || !rgbValues.r || !rgbValues.g || !rgbValues.b) return null;
  if (rgbValues.r.length < npix || rgbValues.g.length < npix || rgbValues.b.length < npix) return null;
  const cached = sphereRgbColorTableCache.get(rgbValues);
  if (cached && cached.npix === npix) return cached;

  const colors = new Uint8Array(npix * 3);
  for (let ipix = 0; ipix < npix; ipix += 1) {
    const ci = ipix * 3;
    colors[ci + 0] = Math.round(clamp(Number.isFinite(rgbValues.r[ipix]) ? rgbValues.r[ipix] : 0, 0, 1) * 255);
    colors[ci + 1] = Math.round(clamp(Number.isFinite(rgbValues.g[ipix]) ? rgbValues.g[ipix] : 0, 0, 1) * 255);
    colors[ci + 2] = Math.round(clamp(Number.isFinite(rgbValues.b[ipix]) ? rgbValues.b[ipix] : 0, 0, 1) * 255);
  }
  const out = { npix, colors };
  sphereRgbColorTableCache.set(rgbValues, out);
  return out;
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
  const dataNside = state.sphereMeta.nside;
  const renderNside = sphereRenderNside(dataNside);
  const values = slice && isNumericArrayLike(slice.values) ? slice.values : null;
  const rgbValues = slice && isRgbValuePayload(slice.values) ? slice.values : null;
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
  if (scalarMode) {
    const sliceStats = isValidRangeStats(slice?.stats) ? slice.stats : null;
    const baseStats = fixedStats ? { min: fixedStats.min, max: fixedStats.max } : sliceStats ? sliceStats : minMax(values);
    mm = resolveColorNormStats(baseStats);

    if (state.fluxScale === "log") {
      minPositive = Math.max(0, mm.min);
      maxPositive = Math.max(minPositive, mm.max);
    }
  }
  const scalarTable = scalarMode ? getSphereScalarColorTable(values, npix, mm, maxPositive, minPositive) : null;
  const rgbTable = rgbMode ? getSphereRgbColorTable(rgbValues, npix) : null;
  const scratchRgb = [0, 0, 0];
  const pixelColor = (ipix) => {
    if (scalarTable) {
      if (!scalarTable.valid[ipix]) return null;
      const ci = ipix * 3;
      scratchRgb[0] = scalarTable.colors[ci + 0];
      scratchRgb[1] = scalarTable.colors[ci + 1];
      scratchRgb[2] = scalarTable.colors[ci + 2];
      return scratchRgb;
    }
    if (!rgbTable) return null;
    const ci = ipix * 3;
    scratchRgb[0] = rgbTable.colors[ci + 0];
    scratchRgb[1] = rgbTable.colors[ci + 1];
    scratchRgb[2] = rgbTable.colors[ci + 2];
    return scratchRgb;
  };

  const projection = state.sphereProjection || "mollweide";
  if (renderSphereRayMapped(img, indexMap, width, height, projection, npix, pixelColor, vectors, dataNside, renderNside)) {
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
  const values = slice && isNumericArrayLike(slice.values) ? slice.values : null;
  const rgbValues = slice && isRgbValuePayload(slice.values) ? slice.values : null;
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
  const scaledSphereNside = sphereRenderNside(state.sphereMeta?.nside || 1);
  const useGpuSphere = (scalarMode || rgbMode) && sphereBackendMode(width, height) === "gpu" && scaledSphereNside === (state.sphereMeta?.nside || 1);
  if (useGpuSphere) {
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
          flipX: sphereHorizontalFlipEnabled(),
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

function upscaleCanvasInterpolated(srcCanvas, targetW, targetH) {
  if (!srcCanvas) return null;
  if (srcCanvas.width === targetW && srcCanvas.height === targetH) return srcCanvas;
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);
  return out;
}

function setCanvasLogicalSize(canvas, logicalW, logicalH) {
  if (!canvas) return;
  const w = Math.max(1, Math.round(Number.isFinite(logicalW) ? logicalW : canvas.width));
  const h = Math.max(1, Math.round(Number.isFinite(logicalH) ? logicalH : canvas.height));
  canvas.__logicalWidth = w;
  canvas.__logicalHeight = h;
}

function canvasLogicalWidth(canvas) {
  if (!canvas) return 1;
  const w = Number(canvas.__logicalWidth);
  return Number.isFinite(w) && w > 0 ? w : Math.max(1, canvas.width || 1);
}

function canvasLogicalHeight(canvas) {
  if (!canvas) return 1;
  const h = Number(canvas.__logicalHeight);
  return Number.isFinite(h) && h > 0 ? h : Math.max(1, canvas.height || 1);
}

function canvasViewSourceRect(canvas, viewRect) {
  const logicalW = canvasLogicalWidth(canvas);
  const logicalH = canvasLogicalHeight(canvas);
  const scaleX = (canvas && canvas.width ? canvas.width : logicalW) / Math.max(1.0e-6, logicalW);
  const scaleY = (canvas && canvas.height ? canvas.height : logicalH) / Math.max(1.0e-6, logicalH);
  const maxSrcW = canvas && canvas.width ? canvas.width : logicalW;
  const maxSrcH = canvas && canvas.height ? canvas.height : logicalH;
  const rawSrcX = viewRect.srcX * scaleX;
  const rawSrcY = viewRect.srcY * scaleY;
  const rawSrcW = viewRect.srcW * scaleX;
  const rawSrcH = viewRect.srcH * scaleY;
  const spanW = Math.max(1.0, maxSrcW * VIEW_SOURCE_RECT_MAX_MULTIPLIER);
  const spanH = Math.max(1.0, maxSrcH * VIEW_SOURCE_RECT_MAX_MULTIPLIER);
  const srcX = clamp(rawSrcX, -spanW, maxSrcW + spanW);
  const srcY = clamp(rawSrcY, -spanH, maxSrcH + spanH);
  const srcW = clamp(rawSrcW, 1.0e-6, spanW);
  const srcH = clamp(rawSrcH, 1.0e-6, spanH);
  return { srcX, srcY, srcW, srcH };
}

function applySliceUpscale(canvas, logicalW, logicalH) {
  if (!canvas) return null;
  const lw = Math.max(1, Math.round(logicalW));
  const lh = Math.max(1, Math.round(logicalH));
  const factor = spatialScaleFactor();
  let targetW = Math.max(1, lw * factor);
  let targetH = Math.max(1, lh * factor);
  const totalPixels = targetW * targetH;
  if (totalPixels > SPATIAL_SCALE_MAX_PIXELS) {
    const scale = Math.sqrt(SPATIAL_SCALE_MAX_PIXELS / totalPixels);
    targetW = Math.max(1, Math.floor(targetW * scale));
    targetH = Math.max(1, Math.floor(targetH * scale));
  }
  const shouldInterpolate = targetW !== canvas.width || targetH !== canvas.height;
  const out = shouldInterpolate ? upscaleCanvasInterpolated(canvas, targetW, targetH) : canvas;
  setCanvasLogicalSize(out, lw, lh);
  return out;
}

function spatialScaledPlaneShape(logicalW, logicalH, factor = spatialScaleFactor()) {
  const lw = Math.max(1, Math.round(logicalW));
  const lh = Math.max(1, Math.round(logicalH));
  let targetW = Math.max(1, Math.round(lw * factor));
  let targetH = Math.max(1, Math.round(lh * factor));
  const totalPixels = targetW * targetH;
  if (totalPixels > SPATIAL_SCALE_MAX_PIXELS) {
    const scale = Math.sqrt(SPATIAL_SCALE_MAX_PIXELS / totalPixels);
    targetW = Math.max(1, Math.floor(targetW * scale));
    targetH = Math.max(1, Math.floor(targetH * scale));
  }
  return { logicalW: lw, logicalH: lh, width: targetW, height: targetH };
}

function finiteBilinearValue(c00, c10, c01, c11, tx, ty) {
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  let sum = 0;
  let weight = 0;
  if (Number.isFinite(c00)) {
    sum += c00 * w00;
    weight += w00;
  }
  if (Number.isFinite(c10)) {
    sum += c10 * w10;
    weight += w10;
  }
  if (Number.isFinite(c01)) {
    sum += c01 * w01;
    weight += w01;
  }
  if (Number.isFinite(c11)) {
    sum += c11 * w11;
    weight += w11;
  }
  if (weight <= 1.0e-12) return Number.NaN;
  return sum / weight;
}

function bilinearSamplePlane(values, width, height, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const c00 = values[x0 * height + y0];
  const c10 = values[x1 * height + y0];
  const c01 = values[x0 * height + y1];
  const c11 = values[x1 * height + y1];
  return finiteBilinearValue(c00, c10, c01, c11, tx, ty);
}

function resampleScalarPlaneValues(values, sourceW, sourceH, logicalW, logicalH, stepX, stepY, targetW, targetH) {
  if (!isNumericArrayLike(values) || values.length !== sourceW * sourceH) return null;
  const sx = Math.max(1, Number.isFinite(stepX) ? Math.floor(stepX) : 1);
  const sy = Math.max(1, Number.isFinite(stepY) ? Math.floor(stepY) : 1);
  const out = new Array(targetW * targetH);
  const logicalSpanX = Math.max(1, logicalW - 1);
  const logicalSpanY = Math.max(1, logicalH - 1);
  const targetSpanX = Math.max(1, targetW - 1);
  const targetSpanY = Math.max(1, targetH - 1);

  for (let x = 0; x < targetW; x += 1) {
    const logicalX = targetW > 1 ? (x * logicalSpanX) / targetSpanX : 0;
    const fx = clamp(logicalX / sx, 0, sourceW - 1);
    for (let y = 0; y < targetH; y += 1) {
      const logicalY = targetH > 1 ? (y * logicalSpanY) / targetSpanY : 0;
      const fy = clamp(logicalY / sy, 0, sourceH - 1);
      out[x * targetH + y] = bilinearSamplePlane(values, sourceW, sourceH, fx, fy);
    }
  }
  return out;
}

function resampleScalarSliceForSpatialScale(slice, logicalW, logicalH, targetW, targetH) {
  if (!slice || !Array.isArray(slice.shape) || slice.shape.length < 2 || !isNumericArrayLike(slice.values)) return null;
  const sourceW = Math.max(1, Number.parseInt(slice.shape[0], 10));
  const sourceH = Math.max(1, Number.parseInt(slice.shape[1], 10));
  const [stepX, stepY] = payloadSamplingStep(slice);
  const cacheKey = `${targetW}x${targetH}:${logicalW}x${logicalH}:${stepX}x${stepY}`;
  let cacheByKey = spatialSliceResampleCache.get(slice);
  if (!cacheByKey) {
    cacheByKey = new Map();
    spatialSliceResampleCache.set(slice, cacheByKey);
  }
  const cached = cacheByKey.get(cacheKey);
  if (cached) return cached;
  const values = resampleScalarPlaneValues(slice.values, sourceW, sourceH, logicalW, logicalH, stepX, stepY, targetW, targetH);
  if (!values) return null;
  const resampled = {
    ...slice,
    shape: [targetW, targetH],
    full_shape: [logicalW, logicalH],
    sampling_step: [1, 1],
    values,
  };
  cacheByKey.set(cacheKey, resampled);
  return resampled;
}

function resampleRgbPayloadForSpatialScale(payload, logicalW, logicalH, targetW, targetH) {
  if (!payload || !isRgbValuePayload(payload.values)) {
    return null;
  }
  const [sourceWRaw, sourceHRaw] = payloadShape2d(payload);
  const sourceW = Math.max(1, sourceWRaw);
  const sourceH = Math.max(1, sourceHRaw);
  const [stepX, stepY] = payloadSamplingStep(payload);
  const cacheKey = `${targetW}x${targetH}:${logicalW}x${logicalH}:${stepX}x${stepY}`;
  let cacheByKey = spatialRgbResampleCache.get(payload);
  if (!cacheByKey) {
    cacheByKey = new Map();
    spatialRgbResampleCache.set(payload, cacheByKey);
  }
  const cached = cacheByKey.get(cacheKey);
  if (cached) return cached;
  const r = resampleScalarPlaneValues(payload.values.r, sourceW, sourceH, logicalW, logicalH, stepX, stepY, targetW, targetH);
  const g = resampleScalarPlaneValues(payload.values.g, sourceW, sourceH, logicalW, logicalH, stepX, stepY, targetW, targetH);
  const b = resampleScalarPlaneValues(payload.values.b, sourceW, sourceH, logicalW, logicalH, stepX, stepY, targetW, targetH);
  if (!r || !g || !b) return null;
  const resampled = { width: targetW, height: targetH, r, g, b };
  cacheByKey.set(cacheKey, resampled);
  return resampled;
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
  const [width, height] = payloadShape2d(slice);
  const [fullW, fullH] = payloadFullShape(slice, width, height);
  const shape = spatialScaledPlaneShape(fullW, fullH);
  const scaled = shape.width !== fullW || shape.height !== fullH;
  const renderPayload = scaled
    ? resampleScalarSliceForSpatialScale(slice, shape.logicalW, shape.logicalH, shape.width, shape.height) || slice
    : slice;
  const [renderWidth, renderHeight] = payloadShape2d(renderPayload);

  if (sliceBackendMode(renderWidth, renderHeight) === "gpu") {
    const renderer = ensureSliceGpuRenderer();
    if (renderer) {
      try {
        const gpu = renderer.render(renderPayload, rangeOverride);
        if (gpu) {
          if (scaled && renderWidth === shape.width && renderHeight === shape.height) {
            setCanvasLogicalSize(gpu, shape.logicalW, shape.logicalH);
            return gpu;
          }
          const upsampled = upscaleCanvasNearest(gpu, fullW, fullH);
          return applySliceUpscale(upsampled, fullW, fullH);
        }
      } catch (err) {
        state.sliceGpu.lastError = err && err.message ? err.message : "render failed";
        state.sliceGpu.available = false;
        state.sliceGpu.renderer = null;
      }
    }
  }
  if (scaled && renderWidth === shape.width && renderHeight === shape.height) {
    const cpuScaled = createSingleCanvasCpu(renderPayload, rangeOverride);
    setCanvasLogicalSize(cpuScaled, shape.logicalW, shape.logicalH);
    return cpuScaled;
  }
  const cpuCanvas = upscaleCanvasNearest(createSingleCanvasCpu(slice, rangeOverride), fullW, fullH);
  return applySliceUpscale(cpuCanvas, fullW, fullH);
}

function createRgbRasterCanvas(width, height, redVals, greenVals, blueVals, preview = null) {
  const img = els.canvas.getContext("2d").createImageData(width, height);
  const gainR = Number.isFinite(preview?.gains?.[0]) ? preview.gains[0] : 1;
  const gainG = Number.isFinite(preview?.gains?.[1]) ? preview.gains[1] : 1;
  const gainB = Number.isFinite(preview?.gains?.[2]) ? preview.gains[2] : 1;
  const chromaBoost = Number.isFinite(preview?.chromaBoost) ? preview.chromaBoost : 1;
  const applyChromaBoost = Math.abs(chromaBoost - 1) > 1.0e-6;
  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const src = x * height + y;
      const sourceR = Math.max(0, Number.isFinite(redVals[src]) ? redVals[src] : 0);
      const sourceG = Math.max(0, Number.isFinite(greenVals[src]) ? greenVals[src] : 0);
      const sourceB = Math.max(0, Number.isFinite(blueVals[src]) ? blueVals[src] : 0);
      const targetBrightness = multispectralPreviewBrightness(luma(sourceR, sourceG, sourceB), preview);
      let r = sourceR * gainR;
      let g = sourceG * gainG;
      let b = sourceB * gainB;
      if (applyChromaBoost) {
        const gray = (r + g + b) / 3;
        r = Math.max(0, gray + (r - gray) * chromaBoost);
        g = Math.max(0, gray + (g - gray) * chromaBoost);
        b = Math.max(0, gray + (b - gray) * chromaBoost);
      } else {
        r = Math.max(0, r);
        g = Math.max(0, g);
        b = Math.max(0, b);
      }
      const adjustedLuma = luma(r, g, b);
      if (adjustedLuma > 0) {
        const scale = targetBrightness / adjustedLuma;
        r *= scale;
        g *= scale;
        b *= scale;
      } else {
        r = 0;
        g = 0;
        b = 0;
      }
      const dst = (y * width + x) * 4;
      img.data[dst + 0] = Math.round(clamp(r, 0, 1) * 255);
      img.data[dst + 1] = Math.round(clamp(g, 0, 1) * 255);
      img.data[dst + 2] = Math.round(clamp(b, 0, 1) * 255);
      img.data[dst + 3] = 255;
    }
  }

  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  off.getContext("2d").putImageData(img, 0, 0);
  return off;
}

function createRgbCanvas(width, height, redVals, greenVals, blueVals, payload = null) {
  const [fullW, fullH] = payloadFullShape(payload, width, height);
  const shape = spatialScaledPlaneShape(fullW, fullH);
  const scaledRequested = shape.width !== fullW || shape.height !== fullH;
  let scaled = false;
  let renderWidth = width;
  let renderHeight = height;
  let renderR = redVals;
  let renderG = greenVals;
  let renderB = blueVals;

  if (scaledRequested) {
    const resampled = payload ? resampleRgbPayloadForSpatialScale(payload, shape.logicalW, shape.logicalH, shape.width, shape.height) : null;
    if (resampled) {
      renderWidth = resampled.width;
      renderHeight = resampled.height;
      renderR = resampled.r;
      renderG = resampled.g;
      renderB = resampled.b;
      scaled = true;
    } else {
      const rScaled = resampleScalarPlaneValues(redVals, width, height, fullW, fullH, 1, 1, shape.width, shape.height);
      const gScaled = resampleScalarPlaneValues(greenVals, width, height, fullW, fullH, 1, 1, shape.width, shape.height);
      const bScaled = resampleScalarPlaneValues(blueVals, width, height, fullW, fullH, 1, 1, shape.width, shape.height);
      if (rScaled && gScaled && bScaled) {
        renderWidth = shape.width;
        renderHeight = shape.height;
        renderR = rScaled;
        renderG = gScaled;
        renderB = bScaled;
        scaled = true;
      }
    }
  }

  const preview = buildMultispectralLocalPreview(payload);

  if (rgbBackendMode(renderWidth, renderHeight) === "gpu") {
    const renderer = ensureRgbGpuRenderer();
    if (renderer) {
      try {
        const gpu = renderer.render(renderWidth, renderHeight, renderR, renderG, renderB, preview);
        if (gpu) {
          if (scaled) {
            setCanvasLogicalSize(gpu, shape.logicalW, shape.logicalH);
            return gpu;
          }
          const upsampled = upscaleCanvasNearest(gpu, fullW, fullH);
          return applySliceUpscale(upsampled, fullW, fullH);
        }
      } catch (err) {
        state.rgbGpu.lastError = err && err.message ? err.message : "render failed";
        state.rgbGpu.available = false;
        state.rgbGpu.renderer = null;
      }
    }
  }

  const off = createRgbRasterCanvas(renderWidth, renderHeight, renderR, renderG, renderB, preview);
  if (scaled) {
    setCanvasLogicalSize(off, shape.logicalW, shape.logicalH);
    return off;
  }
  const upsampled = upscaleCanvasNearest(off, fullW, fullH);
  return applySliceUpscale(upsampled, fullW, fullH);
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

const { GpuSliceRenderer, GpuRgbRenderer, GpuVolumeRenderer, GpuSphereRenderer, GPU_VOLUME_MAX_STEPS } = createGpuRenderers({
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

function ensureRgbGpuRenderer() {
  if (state.rgbGpu.renderer) {
    state.rgbGpu.available = true;
    return state.rgbGpu.renderer;
  }
  if (state.rgbGpu.available === false) return null;
  try {
    const renderer = new GpuRgbRenderer();
    state.rgbGpu.renderer = renderer;
    state.rgbGpu.available = true;
    state.rgbGpu.lastError = "";
    return renderer;
  } catch (err) {
    state.rgbGpu.renderer = null;
    state.rgbGpu.available = false;
    state.rgbGpu.lastError = err && err.message ? err.message : "initialization failed";
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

function volumeRenderOutputAspectRatio() {
  const rect = els.canvas ? els.canvas.getBoundingClientRect() : null;
  const w =
    rect && rect.width > 0 ? rect.width : els.canvas?.clientWidth || els.canvas?.width || 1;
  const h =
    rect && rect.height > 0 ? rect.height : els.canvas?.clientHeight || els.canvas?.height || 1;
  return clamp(w / Math.max(1.0e-6, h), 0.35, 3.0);
}

function createVolumeCanvasAuto(volume, resolution = 240, rangeOverride = null) {
  const outputAspect = volumeRenderOutputAspectRatio();
  const backend = volumeBackendMode();
  if (backend === "gpu") {
    const renderer = ensureVolumeGpuRenderer();
    if (renderer) {
      try {
        const gpu = renderer.render(volume, resolution, rangeOverride, outputAspect);
        if (gpu) return gpu;
      } catch (err) {
        state.volumeGpu.lastError = err && err.message ? err.message : "render failed";
        state.volumeGpu.available = false;
        state.volumeGpu.renderer = null;
        updateVolumeControlReadouts();
      }
    }
  }
  return createVolumeCanvasCpu(volume, resolution, rangeOverride, outputAspect);
}

function createVolumeCanvasCpu(volume, resolution = 240, rangeOverride = null, outputAspect = 1.0) {
  const off = document.createElement("canvas");
  const sphericalMode = state.volumeRender.mode === "spherical";
  const sphericalProjection = sphericalMode ? volumeSphereProjectionMode() : "mollweide";
  let width = resolution;
  let height = resolution;
  if (sphericalMode && sphericalProjection === "mollweide") {
    width = resolution * 2;
    height = resolution;
  } else if (!sphericalMode) {
    const aspect = Number.isFinite(outputAspect) && outputAspect > 0 ? outputAspect : 1.0;
    const area = Math.max(64, resolution * resolution);
    width = clamp(Math.round(Math.sqrt(area * aspect)), 64, 4096);
    height = clamp(Math.round(Math.sqrt(area / Math.max(1.0e-6, aspect))), 64, 4096);
  }
  off.width = width;
  off.height = height;

  if (!volume || !Array.isArray(volume.shape) || volume.shape.length !== 3 || !isNumericArrayLike(volume.values)) {
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

  const rot = activeVolumeRotationMatrix();
  const planeScale = 1.05 / clamp(state.volumeZoom, VOLUME_ZOOM_MIN, VOLUME_ZOOM_MAX);
  const planeScaleX = planeScale * (width / Math.max(1, height));
  const qCfg = volumeQualityConfig();
  const stepScale = clamp(volumeSpatialRenderFactor(), 0.75, 1.75);
  const steps = clamp(Math.round(Math.max(nx, ny, nz) * qCfg.stepMul * stepScale), 24, 180);
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

      const ox = cx * rot[0] + cyv * rot[1] + cz * rot[2];
      const oy = cx * rot[3] + cyv * rot[4] + cz * rot[5];
      const oz = cx * rot[6] + cyv * rot[7] + cz * rot[8];
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
        const cx = u * planeScaleX;
        const cyv = -v * planeScale;
        const cz = depth;

        const ox = cx * rot[0] + cyv * rot[1] + cz * rot[2];
        const oy = cx * rot[3] + cyv * rot[4] + cz * rot[5];
        const oz = cx * rot[6] + cyv * rot[7] + cz * rot[8];

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
    const mapper = multispectralNuMapper(bands);
    const unitNu = bands.unit || dimUnit("nu") || "Hz";
    const deslopeAlpha = Number.isFinite(state.multiSpectralDeslope)
      ? state.multiSpectralDeslope
      : Number.isFinite(bands.deslope)
      ? bands.deslope
      : 0;
    const spectrumNormalized = Boolean(bands.normalize_spectrum);
    const spectrumNormalizeBoost = Number.isFinite(bands.normalize_spectrum_boost)
      ? bands.normalize_spectrum_boost
      : normalizeMultispectralNormalizeBoost(state.multiSpectralNormalizeBoost);
    const totalFluxBrightness = bands.brightness_mode === "total_flux";

    for (let x = 0; x < w; x += 1) {
      const t = x / Math.max(1, w - 1);
      const nu = mapper ? mapper.nuFromAxis(mapper.axisMin + t * mapper.axisSpan) : t;
      const [r, g, b] = colorForSpectralNu(nu, bands, mapper);
      ctx.fillStyle = `rgb(${r} ${g} ${b})`;
      ctx.fillRect(x, 0, 1, h);
    }

    const nuMin = mapper ? mapper.nuMin : Number.parseFloat(bands.red?.[0] ?? 0);
    const nuMax = mapper ? mapper.nuMax : Number.parseFloat(bands.blue?.[1] ?? 1);
    els.colorbarMin.textContent = fmtPhysical("nu", nuMin, unitNu);
    const axisLabel = mapper && mapper.axisScale === "log" ? "log Frequency" : "linear Frequency";
    const deslopeLabel = Math.abs(deslopeAlpha) > 1.0e-6 ? `, spectral index correction=${deslopeAlpha.toFixed(1)}` : "";
    const normalizeLabel = spectrumNormalized
      ? Math.abs(spectrumNormalizeBoost - 1.0) > 1.0e-6
        ? `, mean spectrum removed (boost=${spectrumNormalizeBoost.toFixed(2)}x)`
        : ", mean spectrum removed"
      : "";
    const brightnessLabel = totalFluxBrightness ? ", brightness from total flux" : "";
    els.colorbarMid.textContent = `Spectral delta -> eye RGB (${axisLabel}${deslopeLabel}${normalizeLabel}${brightnessLabel})`;
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
        els.colorbarMid.textContent = `${state.colorMap} (log${fixedLabel})`;
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

function renderFrameFast(frameCanvas, options = null) {
  const refreshHover = !options || options.refreshHover !== false;
  state.frameCanvas = frameCanvas;
  state.frameTiles = null;
  state.frameGrid = 1;
  state.drawTiles = [];
  drawFrameAndOverlays();
  if (refreshHover) refreshHoverProbeFromPointer();
}

function renderTileFrameFast(frameTiles, gridSize, options = null) {
  const refreshHover = !options || options.refreshHover !== false;
  state.frameCanvas = null;
  state.frameTiles = frameTiles;
  state.frameGrid = Math.max(1, gridSize);
  state.drawTiles = [];
  drawFrameAndOverlays();
  if (refreshHover) refreshHoverProbeFromPointer();
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
  const mix = clamp(alpha, 0, 1);
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
  // Crossfade explicitly so morph playback interpolates between samples
  // instead of adding the next frame on top of the current one.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(fromCanvas, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.globalAlpha = 1 - mix;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = mix;
  ctx.drawImage(toCanvas, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  setCanvasLogicalSize(out, canvasLogicalWidth(fromCanvas), canvasLogicalHeight(fromCanvas));
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
    axis_scale: toBands.axis_scale || fromBands.axis_scale || state.multiSpectralNuAxisScale,
    deslope: state.multiSpectralDeslope,
    deslope_ref: Number.isFinite(toBands.deslope_ref) ? toBands.deslope_ref : fromBands.deslope_ref,
    normalize_spectrum: Boolean(toBands.normalize_spectrum) || Boolean(fromBands.normalize_spectrum),
    normalize_spectrum_boost: Number.isFinite(toBands.normalize_spectrum_boost)
      ? toBands.normalize_spectrum_boost
      : Number.isFinite(fromBands.normalize_spectrum_boost)
      ? fromBands.normalize_spectrum_boost
      : normalizeMultispectralNormalizeBoost(state.multiSpectralNormalizeBoost),
    brightness_mode: toBands.brightness_mode || fromBands.brightness_mode || "total_flux",
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
  updateBackendStatusUi();
  if (sampleMorphEvpaActive()) {
    state.evpaTicksBySample = {};
    state.evpaTicks = interpolateEvpaTicks(state.sampleMorph.fromEvpaTicks, state.sampleMorph.toEvpaTicks, alpha);
  }
  renderFrame(frameCanvas, selectedCoords, intensityStats, intensityUnit);
  updatePlayUi();
}

async function fetchSampleMorphSlice(sampleIdx, maxPixels = null, multispectral = isMultiSpectralActive()) {
  if (!isDerivedPolModeActive() && multispectral) {
    return fetchMultispectralPayload(buildMultispectralParams(sampleIdx, maxPixels));
  }
  if (isDerivedPolModeActive()) {
    return fetchDerivedSlice(sampleIdx, maxPixels);
  }
  return fetchSlicePayload(
    buildSliceParams(
      undefined,
      sampleIdx,
      state.values.pol,
      sampleModeForApi(),
      maxPixels
    )
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

async function advanceSampleMorphPlayback(deltaSec, options = {}) {
  if (!isSampleMorphMode() || sampleCount() <= 1) return;
  if (isVolumeMode() && state.volumeDrag) return;
  const fullResolution = Boolean(options && options.fullResolution === true);
  const lodMaxPixels = fullResolution ? null : (isSphereMode() ? null : spatialLodMaxPixels(playbackMaxPixelsForFrame()));
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
  if (multispectralFrameActive()) {
    if (!rerenderMultispectralFromCache()) {
      updateColorNormalizationControls();
      drawColorbar();
    }
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
  if (multispectralFrameActive()) {
    state.multiSpectralChannelRange = normalizeMultispectralChannelRange({ min: lowV, max: highV });
  }
  rememberCurrentQuantityColorNormWindow();
  updateColorNormalizationControls();
  if (multispectralFrameActive()) {
    if (commit) {
      void refreshMultispectralControlsFromServer();
    } else {
      scheduleMultispectralLocalRerender();
    }
    return;
  }
  scheduleColorNormRerender(commit);
}

async function refreshFixedColorRange() {
  if (
    !state.dataId ||
    isSparseSceneView() ||
    state.colorRangeMode === "none" ||
    state.multiSpectral ||
    isDerivedPolModeActive() ||
    isVolumeMode()
  ) {
    state.fixedColorRange = null;
    return;
  }

  const epoch = activeEpoch();
  try {
    const data = await fetchJson(`/api/datasets/${state.dataId}/intensity-range?${buildRangeParams().toString()}`);
    assertEpoch(epoch);
    state.fixedColorRange = isValidRangeStats(data) ? data : null;
  } catch (err) {
    if (!isAbortError(err)) throw err;
  }
}

async function refreshEvpaTicks() {
  if (!state.dataId || !state.showEvpa || state.plane !== "xy" || isVolumeMode() || isSphereMode()) {
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
    return;
  }

  const epoch = activeEpoch();
  try {
    if (isSamplesMode() && state.sampleGridIndices.length > 1) {
      const samples = state.sampleGridIndices.slice();
      const tickSets = await Promise.all(samples.map((sampleIdx) => fetchEvpaTicksForSample(sampleIdx)));
      assertEpoch(epoch);
      const bySample = {};
      for (let i = 0; i < samples.length; i += 1) {
        bySample[String(samples[i])] = tickSets[i];
      }
      state.evpaTicksBySample = bySample;
      const activeSample = state.sampleGridIndices[clamp(state.activeSampleTile, 0, state.sampleGridIndices.length - 1)];
      state.evpaTicks = bySample[String(activeSample)] || [];
    } else {
      state.evpaTicks = await fetchEvpaTicksForSample(state.values.sample);
      assertEpoch(epoch);
      state.evpaTicksBySample = {};
    }
  } catch (err) {
    if (isAbortError(err)) return;
    console.warn("EVPA overlay unavailable:", err);
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
  }
}

async function fetchEvpaTicksForSample(sampleIdx) {
  if (!state.dataId || state.plane !== "xy" || isVolumeMode() || isSphereMode()) return [];
  const effectiveMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : sampleModeForApi();
  const upscaleAwareStep = evpaStepForCurrentResolution();
  const qs = new URLSearchParams({
    sample: String(sampleIdx),
    t: String(state.values.t),
    nu: String(state.values.nu),
    z: String(state.values.z),
    sample_mode: effectiveMode,
    step: String(upscaleAwareStep),
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

function evpaStepForCurrentResolution() {
  const baseStep = clamp(Math.round(state.evpaStep), 1, 32);
  const scale = evpaResolutionScaleFactor();
  if (!(scale > 1)) return baseStep;
  return clamp(Math.round(baseStep / scale), 1, 32);
}

function evpaResolutionScaleFactor() {
  const direct = Number.parseFloat(state?.renderScale?.spatial);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const legacy = Number.parseFloat(state?.sliceRender?.upscaleFactor);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return spatialScaleFactor();
}

function computeStats(values) {
  if (!isNumericArrayLike(values) || !values.length) return { min: 0, max: 1, mean: 0, std: 0 };
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
  if (!ref || !isNumericArrayLike(ref.values)) {
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

async function fetchDerivedSlice(sampleOverride, maxPixels = null, options = {}) {
  const mode = state.derivedPolMode;
  const axisOverride =
    options && options.axisOverride && typeof options.axisOverride === "object" ? options.axisOverride : null;
  if (!isDerivedPolModeActive()) {
    let params = buildSliceParams(undefined, sampleOverride, state.values.pol, state.sampleMode, maxPixels);
    if (axisOverride && axisOverride.axis) {
      params = paramsWithAxisIndex(params, axisOverride.axis, axisOverride.index);
    }
    return fetchSlicePayload(params, options);
  }
  const effectiveSampleMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : sampleModeForApi();
  const channels = derivedPolChannels(mode);
  if (!channels.length) {
    throw new Error(`invalid derived polarization mode: ${mode}`);
  }

  const fetched = await Promise.all(
    channels.map((polIdx) => {
      let params = buildSliceParams(
        undefined,
        sampleOverride,
        polIdx,
        effectiveSampleMode,
        maxPixels
      );
      if (axisOverride && axisOverride.axis) {
        params = paramsWithAxisIndex(params, axisOverride.axis, axisOverride.index);
      }
      return fetchSlicePayload(params, options);
    })
  );
  const byPol = {};
  for (let i = 0; i < channels.length; i += 1) {
    byPol[channels[i]] = fetched[i];
  }
  return mapDerivedPolarizationPayload(mode, byPol);
}

async function fetchVolume(sampleOverride, options = {}) {
  return fetchVolumePayload(buildVolumeParams(sampleOverride), options);
}

async function fetchDerivedVolume(sampleOverride, options = {}) {
  const mode = state.derivedPolMode;
  const axisOverride =
    options && options.axisOverride && typeof options.axisOverride === "object" ? options.axisOverride : null;
  if (!isDerivedPolModeActive()) return fetchVolume(sampleOverride, options);

  const effectiveSampleMode = state.sampleMode === "std" || state.sampleMode === "rel_uncert" ? "mean" : sampleModeForApi();
  const channels = derivedPolChannels(mode);
  if (!channels.length) {
    throw new Error(`invalid derived polarization mode: ${mode}`);
  }

  const fetched = await Promise.all(
    channels.map((polIdx) => {
      let params = buildVolumeParams(sampleOverride, polIdx, effectiveSampleMode);
      if (axisOverride && axisOverride.axis) {
        params = paramsWithAxisIndex(params, axisOverride.axis, axisOverride.index);
      }
      return fetchVolumePayload(params, options);
    })
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
  if (state.volumeDrag) {
    ensureVisibleUpdate("volume-drag", { spatialMode: "volume" });
  }
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
  if (state.sphereDrag) {
    ensureVisibleUpdate("sphere-drag", { spatialMode: "sphere" });
  }
  const fastPreview = Boolean(state.sphereDrag);
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
    if (fastPreview) {
      renderTileFrameFast(tiles, state.sampleGridSize, { refreshHover: false });
    } else {
      const primary = state.currentMultispectralTiles[activeIdx] || state.currentMultispectralTiles[0] || null;
      const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
      renderTileFrame(tiles, state.sampleGridSize, selectedCoords, null);
    }
    return;
  }
  if (state.currentMultispectralSlice) {
    const slice = state.currentMultispectralSlice;
    const canvas = createSingleCanvas(slice);
    if (fastPreview) {
      renderFrameFast(canvas, { refreshHover: false });
    } else {
      renderFrame(
        canvas,
        slice.selected_coords || indicesToCoords(slice.selected_indices),
        null,
        null
      );
    }
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
    if (fastPreview) {
      renderTileFrameFast(tiles, state.sampleGridSize, { refreshHover: false });
    } else {
      const primary = state.currentMonoSliceTiles[activeIdx] || state.currentMonoSliceTiles[0] || null;
      const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
      const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
      renderTileFrame(tiles, state.sampleGridSize, selectedCoords, sharedStats, intensityUnit);
    }
    return;
  }
  if (state.currentMonoSlice) {
    const slice = state.currentMonoSlice;
    const canvas = createSingleCanvas(slice);
    if (fastPreview) {
      renderFrameFast(canvas, { refreshHover: false });
    } else {
      const intensityUnit = isDerivedPolModeActive() ? derivedPolUnit(state.derivedPolMode) : null;
      renderFrame(
        canvas,
        slice.selected_coords || indicesToCoords(slice.selected_indices),
        slice.stats || null,
        intensityUnit
      );
    }
  }
}

function axisPlaybackPrefetchIndices(axis) {
  if (!axis || isAxisSelectorLocked(axis) || isAxisProjectionActive(axis)) return [];
  const length = axisSize(axis);
  if (!(length > 1)) return [];
  const [w0, w1] = getAxisWindow(axis, length);
  const span = w1 - w0 + 1;
  if (span <= 1) return [];
  const lookahead = Math.min(PLAYBACK_PREFETCH_LOOKAHEAD_MAX, span - 1);
  const current = clamp(state.values[axis], w0, w1);
  const out = [];
  let next = current;
  for (let i = 0; i < lookahead; i += 1) {
    next = next >= w1 ? w0 : next + 1;
    out.push(next);
  }
  return out;
}

function paramsWithAxisIndex(params, axis, index) {
  const next = new URLSearchParams(params);
  next.set(axis, String(index));
  return next;
}

async function prefetchAxisPlaybackFrame(axis) {
  if (!state.dataId || !axis || isSampleMorphMode()) return;
  const nextIndices = axisPlaybackPrefetchIndices(axis);
  if (!nextIndices.length) return;

  const lodMaxPixels = !isSphereMode() ? spatialLodMaxPixels(playbackMaxPixelsForFrame()) : null;

  if (isVolumeMode()) {
    if (state.sampleMode === "single") {
      const sampleIndices = state.sampleGridIndices.slice();
      await Promise.all(
        nextIndices.flatMap((nextIndex) =>
          sampleIndices.map((sampleIdx) =>
            isDerivedPolModeActive()
              ? fetchDerivedVolume(sampleIdx, { playback: true, axisOverride: { axis, index: nextIndex } })
              : fetchVolumePayload(paramsWithAxisIndex(buildVolumeParams(sampleIdx), axis, nextIndex), { playback: true })
          )
        )
      );
      return;
    }
    if (isDerivedPolModeActive()) {
      await Promise.all(
        nextIndices.map((nextIndex) =>
          fetchDerivedVolume(undefined, { playback: true, axisOverride: { axis, index: nextIndex } })
        )
      );
      return;
    }
    await Promise.all(
      nextIndices.map((nextIndex) =>
        fetchVolumePayload(paramsWithAxisIndex(buildVolumeParams(undefined), axis, nextIndex), { playback: true })
      )
    );
    return;
  }

  if (isMultiSpectralActive()) {
    if (state.sampleMode === "single") {
      const sampleIndices = state.sampleGridIndices.slice();
      await Promise.all(
        nextIndices.flatMap((nextIndex) =>
          sampleIndices.map((sampleIdx) =>
            fetchMultispectralPayload(
              paramsWithAxisIndex(buildMultispectralParams(sampleIdx, lodMaxPixels), axis, nextIndex),
              { playback: true }
            )
          )
        )
      );
      return;
    }
    await Promise.all(
      nextIndices.map((nextIndex) =>
        fetchMultispectralPayload(
          paramsWithAxisIndex(buildMultispectralParams(undefined, lodMaxPixels), axis, nextIndex),
          { playback: true }
        )
      )
    );
    return;
  }

  if (state.sampleMode === "single") {
    const sampleIndices = state.sampleGridIndices.slice();
    await Promise.all(
      nextIndices.flatMap((nextIndex) =>
        sampleIndices.map((sampleIdx) =>
          isDerivedPolModeActive()
            ? fetchDerivedSlice(sampleIdx, lodMaxPixels, { playback: true, axisOverride: { axis, index: nextIndex } })
            : fetchSlicePayload(
                paramsWithAxisIndex(
                  buildSliceParams(undefined, sampleIdx, state.values.pol, state.sampleMode, lodMaxPixels),
                  axis,
                  nextIndex
                ),
                { playback: true }
              )
        )
      )
    );
    return;
  }

  if (isDerivedPolModeActive()) {
    await Promise.all(
      nextIndices.map((nextIndex) =>
        fetchDerivedSlice(undefined, lodMaxPixels, { playback: true, axisOverride: { axis, index: nextIndex } })
      )
    );
    return;
  }
  await Promise.all(
    nextIndices.map((nextIndex) =>
      fetchSlicePayload(
        paramsWithAxisIndex(
          buildSliceParams(undefined, undefined, state.values.pol, state.sampleMode, lodMaxPixels),
          axis,
          nextIndex
        ),
        { playback: true }
      )
    )
  );
}

async function setSpatialMode(mode) {
  if (mode !== "slice" && mode !== "volume" && mode !== "sphere") return;
  if (mode === "slice" && isSphereDataset()) return;
  if (mode === "volume" && !canUseVolumeMode()) return;
  if (mode === "sphere" && !isSphereDataset()) return;
  if (state.spatialMode === mode) return;

  const quantityBefore = intensityQuantityKey();
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
  applyIntensityQuantityTransition(quantityBefore, intensityQuantityKey());
  updateControlCaps();
  await refreshSlice();
  if (mode === "slice" && state.selection) await refreshSelectionAnalytics();
}

async function refreshSlice(options = {}) {
  if (!state.dataId) return;
  ensureVisibleUpdate(options.playback === true ? "playback-refresh" : "slice-refresh", {
    dataId: state.dataId,
    plane: state.plane,
    sampleMode: state.sampleMode,
    spatialMode: state.spatialMode,
  });
  const epoch = activeEpoch();
  const ensureActive = () => assertEpoch(epoch);
  try {
  state.hoverProbe = null;
  const playbackMode = options.playback === true;
  const deferFixedColorRange = options.deferFixedColorRange === true && !playbackMode;
  const playbackLodMaxPixels = playbackMode && !isSphereMode() ? playbackMaxPixelsForFrame() : null;
  const lodMaxPixels = !isSphereMode() ? spatialLodMaxPixels(playbackLodMaxPixels) : null;
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
  const pendingFixedColorRange = deferFixedColorRange ? refreshFixedColorRange() : null;
  if (!playbackMode && !deferFixedColorRange) {
    await refreshFixedColorRange();
    ensureActive();
  }

  if (isVolumeMode()) {
    state.currentMonoSlice = null;
    state.currentMonoSliceTiles = null;
    state.currentMultispectralBands = null;
    state.currentMultispectralSlice = null;
    state.currentMultispectralTiles = null;
    updateBackendStatusUi();
    state.evpaTicks = [];
    state.evpaTicksBySample = {};
    if (isSampleMorphMode()) {
      await evpaPromise;
      ensureActive();
      const preserveAlpha = playbackMode || Boolean(state.sampleMorph.fromCanvas && state.sampleMorph.toCanvas);
      await prepareSampleMorphPair(lodMaxPixels, preserveAlpha);
      ensureActive();
    } else if (state.sampleMode === "single") {
      const sampleIndices = state.sampleGridIndices.slice();
      const volumes = await Promise.all(
        sampleIndices.map((sampleIdx) =>
          isDerivedPolModeActive()
            ? fetchDerivedVolume(sampleIdx, { playback: playbackMode })
            : fetchVolume(sampleIdx, { playback: playbackMode })
        )
      );
      ensureActive();
      await evpaPromise;
      ensureActive();
      state.currentVolumeTiles = volumes;
      state.currentVolume = null;
    } else {
      const volume = isDerivedPolModeActive()
        ? await fetchDerivedVolume(undefined, { playback: playbackMode })
        : await fetchVolume(undefined, { playback: playbackMode });
      ensureActive();
      await evpaPromise;
      ensureActive();
      state.currentVolume = volume;
      state.currentVolumeTiles = null;
    }

    if (!isSampleMorphMode()) {
      rerenderVolumeFrame();
    }
    await refreshViewProfiles();
    ensureActive();
    syncSampleMorphPlayback();
    updateExportButtonState();
    updateHoverReadout();
    return;
  }

  state.currentVolume = null;
  state.currentVolumeTiles = null;
  const preserveSphereSampleTiles = isSphereMode() && isSamplesMode() && !isSampleMorphMode();
  if (!preserveSphereSampleTiles) {
    state.currentMonoSlice = null;
    state.currentMonoSliceTiles = null;
    state.currentMultispectralBands = null;
    state.currentMultispectralSlice = null;
    state.currentMultispectralTiles = null;
  }

  if (isSampleMorphMode()) {
    await evpaPromise;
    ensureActive();
    state.currentMultispectralBands = null;
    updateBackendStatusUi();
    const preserveAlpha =
      !state.sampleMorph.initializing && (playbackMode || Boolean(state.sampleMorph.fromSlice && state.sampleMorph.toSlice));
    await prepareSampleMorphPair(lodMaxPixels, preserveAlpha);
    ensureActive();
  } else if (state.sampleMode === "single") {
    const sampleIndices = state.sampleGridIndices.slice();
    if (isMultiSpectralActive()) {
      const mosaics = await Promise.all(
        sampleIndices.map((sampleIdx) =>
          fetchMultispectralPayload(buildMultispectralParams(sampleIdx, lodMaxPixels), { playback: playbackMode })
        )
      );
      ensureActive();
      await evpaPromise;
      ensureActive();
      const activeIdx = clamp(state.activeSampleTile, 0, Math.max(0, mosaics.length - 1));
      const primary = mosaics[activeIdx] || mosaics[0];
      state.currentMonoSlice = null;
      state.currentMonoSliceTiles = null;
      state.currentMultispectralBands = primary ? primary.bands || null : null;
      state.currentMultispectralTiles = mosaics;
      state.currentMultispectralSlice = primary || null;
      updateBackendStatusUi();
      const selectedCoords = primary ? primary.selected_coords || indicesToCoords(primary.selected_indices) : null;
      const tiles = isSphereMode()
        ? mosaics.map((ms, idx) => createSingleCanvas(ms, null, { sphereIncludeIndexMap: idx === activeIdx }))
        : mosaics.map((ms) => createRgbCanvas(ms.shape[0], ms.shape[1], ms.values.r, ms.values.g, ms.values.b, ms));
      renderTileFrame(tiles, state.sampleGridSize, selectedCoords, null);
    } else {
      const slices = await Promise.all(
        sampleIndices.map((sampleIdx) =>
          isDerivedPolModeActive()
            ? fetchDerivedSlice(sampleIdx, lodMaxPixels, { playback: playbackMode })
            : fetchSlicePayload(buildSliceParams(undefined, sampleIdx, state.values.pol, state.sampleMode, lodMaxPixels), {
                playback: playbackMode,
              })
        )
      );
      ensureActive();
      await evpaPromise;
      ensureActive();
      state.currentMultispectralBands = null;
      state.currentMultispectralSlice = null;
      state.currentMultispectralTiles = null;
      updateBackendStatusUi();
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
      const ms = await fetchMultispectralPayload(buildMultispectralParams(undefined, lodMaxPixels), {
        playback: playbackMode,
      });
      ensureActive();
      await evpaPromise;
      ensureActive();
      state.currentMonoSlice = null;
      state.currentMultispectralBands = ms.bands || null;
      state.currentMultispectralSlice = ms;
      state.currentMultispectralTiles = null;
      updateBackendStatusUi();
      renderFrame(
        isSphereMode() ? createSingleCanvas(ms) : createRgbCanvas(ms.shape[0], ms.shape[1], ms.values.r, ms.values.g, ms.values.b, ms),
        ms.selected_coords || indicesToCoords(ms.selected_indices),
        null
      );
    } else {
      const slice = isDerivedPolModeActive()
        ? await fetchDerivedSlice(undefined, lodMaxPixels, { playback: playbackMode })
        : await fetchSlicePayload(buildSliceParams(undefined, undefined, state.values.pol, state.sampleMode, lodMaxPixels), {
            playback: playbackMode,
          });
      ensureActive();
      await evpaPromise;
      ensureActive();
      state.currentMonoSlice = slice;
      state.currentMultispectralBands = null;
      state.currentMultispectralSlice = null;
      state.currentMultispectralTiles = null;
      updateBackendStatusUi();
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
    if (pendingFixedColorRange) {
      await pendingFixedColorRange;
      ensureActive();
      rerenderCurrentFrameForColorNormalization();
    }
    await refreshViewProfiles();
    ensureActive();
  } else {
    drawNavigationGraphs();
    if (state.selection) drawSelectionGraphs();
  }
  syncSampleMorphPlayback();
  updateExportButtonState();
  updateHoverReadout();
  } catch (err) {
    if (!isAbortError(err)) throw err;
  }
}

function profileForAxis(source, axis) {
  if (!source) return null;
  if (source.profiles && source.profiles[axis]) return source.profiles[axis];
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
    const leftCoord = axisIsFlipped(axis) ? profile.coords[e] : profile.coords[s];
    const rightCoord = axisIsFlipped(axis) ? profile.coords[s] : profile.coords[e];
    minEl.textContent = fmtPhysical(axis, leftCoord, axisDisplayUnit(axis));
    maxEl.textContent = fmtPhysical(axis, rightCoord, axisDisplayUnit(axis));
    return;
  }
  const [a, b] = axisRangeFromProfile(axis, profile);
  const leftCoord = axisIsFlipped(axis) ? b : a;
  const rightCoord = axisIsFlipped(axis) ? a : b;
  minEl.textContent = fmtPhysical(axis, leftCoord, axisDisplayUnit(axis));
  maxEl.textContent = fmtPhysical(axis, rightCoord, axisDisplayUnit(axis));
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
  startVisibleUpdate(`${axis}-window`, { axis });
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
  const windowSeries = fullSeries.slice(startIdx, endIdx + 1);
  const windowCoords = fullCoords.slice(startIdx, endIdx + 1);
  const domainFactor = axisDomainScaleFactor(axis);
  const resampled = resampleSeriesWithCoords(windowSeries, windowCoords, domainFactor);
  const series = resampled.series;
  const coords = resampled.coords;
  const plotSeries = series.map(fluxPlotValue);
  const n = series.length;
  const xmap = buildAxisXMapper(axisMapCoords(axis, coords));
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < plotSeries.length; i += 1) {
    if (plotSeries[i] < yMin) yMin = plotSeries[i];
    if (plotSeries[i] > yMax) yMax = plotSeries[i];
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
    const y = yOf(plotSeries[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (indicatorIdx !== null && indicatorIdx !== undefined) {
    if (indicatorIdx >= startIdx && indicatorIdx <= endIdx) {
      const i = mappedIndicatorIndex(indicatorIdx - startIdx, resampled.sourceLength, n);
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
  ctx.fillText(fmtIntensity(fluxFromPlotValue(yMax)), 2 * s, margin.t + 9 * s);
  ctx.fillText(fmtIntensity(fluxFromPlotValue(yMin)), 2 * s, margin.t + pxH);
}

function drawNavigatorZoomDrag(canvasEl, profile, axis, drag) {
  if (!drag || !drag.zoom || !profile || !profile.coords || profile.coords.length < 2) return;
  if (drag.startIdx === undefined || drag.lastIdx === undefined) return;

  const [startIdx, endIdx] = getAxisWindow(axis, profile.coords.length);
  const visibleCoords = profile.coords.slice(startIdx, endIdx + 1);
  if (visibleCoords.length < 2) return;
  const xmap = buildAxisXMapper(axisMapCoords(axis, visibleCoords));
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
  const xmap = buildAxisXMapper(axisMapCoords(axis, visibleCoords));

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
  const baseCoords = profile.coords.slice(startIdx, endIdx + 1);
  const axisName = profile.axis || "axis";
  const axisUnit = profile.axis_unit || "";
  const fluxUnit = profile.value_unit || (state.meta ? state.meta.intensity_unit || "arb" : "arb");
  const perSample = (profile.per_sample || []).map((s) => s.slice(startIdx, endIdx + 1));
  const mean = (profile.series_mean || []).slice(startIdx, endIdx + 1);
  const std = (profile.series_std || []).slice(startIdx, endIdx + 1);
  const domainFactor = axisDomainScaleFactor(axisName);
  const meanResampled = resampleSeriesWithCoords(mean, baseCoords, domainFactor);
  const stdResampled = resampleSeriesWithCoords(std, baseCoords, domainFactor);
  const perSampleResampled = perSample.map((series) => resampleSeriesWithCoords(series, baseCoords, domainFactor).series);
  const coords = meanResampled.coords;
  const n = coords.length;
  const meanSeries = meanResampled.series;
  const stdSeries = stdResampled.series;
  const sourceLength = meanResampled.sourceLength;
  const meanY = meanSeries.map(fluxPlotValue);
  const upperY = meanSeries.map((m, i) => fluxPlotValue(m + (stdSeries[i] || 0)));
  const lowerY = meanSeries.map((m, i) => fluxPlotValue(m - (stdSeries[i] || 0)));
  const perSampleY = perSampleResampled.map((s) => s.map(fluxPlotValue));
  const xmap = buildAxisXMapper(axisMapCoords(axisName, coords));

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

  if (stdSeries.length === meanSeries.length && meanSeries.length > 1) {
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
      const i = mappedIndicatorIndex(indicatorIdx - startIdx, sourceLength, n);
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
  const axisLabel = axisDisplayLabel(axisName);
  const logSuffix = axisName === "nu" && state.multiSpectralNuAxisScale === "log" ? " (log scale)" : "";
  const xLabelBase = axisUnit ? `${axisLabel} [${axisUnit}]${logSuffix}` : `${axisLabel}${logSuffix}`;
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
  if (!state.dataId || !state.selection || (isSparseSceneView() && !sparseSceneProfilesAvailable())) {
    state.profiles = null;
    drawSelectionGraphs();
    return;
  }

  const epoch = activeEpoch();
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
    assertEpoch(epoch);
    if (token !== state._selectionToken) return;
    state.profiles = profiles;
  } catch (err) {
    if (token !== state._selectionToken) return;
    if (isAbortError(err)) return;
    console.error(err);
    state.profiles = null;
  }

  drawSelectionGraphs();
}

async function refreshViewProfiles() {
  if (
    !state.dataId ||
    (isSparseSceneView() && !sparseSceneProfilesAvailable()) ||
    (!state.frameCanvas && !(state.frameTiles && state.frameTiles.length))
  ) {
    if (isSparseSceneView() && !sparseSceneProfilesAvailable()) {
      state.viewProfiles = null;
      drawNavigationGraphs();
    }
    return;
  }
  const epoch = activeEpoch();
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
    assertEpoch(epoch);
    if (token !== state._viewProfileToken) return;
    state.viewProfiles = profiles;
  } catch (err) {
    if (token !== state._viewProfileToken) return;
    if (isAbortError(err)) return;
    console.error(err);
    state.viewProfiles = null;
  }

  drawNavigationGraphs();
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
    if (!(zoomFactor > 0)) zoomFactor = 1 / WHEEL_ZOOM_STEP_FACTOR;
    zoomFactor = clamp(1 / zoomFactor, 1, 16);
    state.sphereInsideScale = clamp(
      sphereInsideRenderScale() * zoomFactor,
      SPHERE_INSIDE_SCALE_MIN,
      SPHERE_INSIDE_SCALE_MAX
    );

    const probe = sphereProbeFromDataPoint({ u: cx, v: cy }, tile, null);
    if (probe && Number.isFinite(probe.vx) && Number.isFinite(probe.vy) && Number.isFinite(probe.vz)) {
      const rxy = Math.hypot(probe.vx, probe.vy);
      const yaw = Math.atan2(-probe.vy, probe.vx);
      const pitch = clamp(Math.atan2(probe.vz, Math.max(1.0e-9, rxy)), -1.45, 1.45);
      setSphereOrientationFromYawPitch(yaw, pitch);
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
  startVisibleUpdate("wheel-zoom", { spatialMode: state.spatialMode });
  if (isVolumeMode()) {
    const factor = ev.deltaY < 0 ? WHEEL_ZOOM_STEP_FACTOR : 1 / WHEEL_ZOOM_STEP_FACTOR;
    state.volumeZoom = clamp(state.volumeZoom * factor, VOLUME_ZOOM_MIN, VOLUME_ZOOM_MAX);
    updateVolumeControlReadouts();
    rerenderVolumeFrame();
    return;
  }
  if (isSphereMode() && state.sphereProjection === "inside") {
    const factor = ev.deltaY < 0 ? WHEEL_ZOOM_STEP_FACTOR : 1 / WHEEL_ZOOM_STEP_FACTOR;
    state.sphereInsideScale = clamp(
      sphereInsideRenderScale() * factor,
      SPHERE_INSIDE_SCALE_MIN,
      SPHERE_INSIDE_SCALE_MAX
    );
    rerenderSphereFrame();
    refreshViewProfiles();
    return;
  }

  const baseViewRect = getViewRect();
  const { viewRect: renderViewRect, drawRect } = getRenderGeometry(baseViewRect);
  const before = screenToData(ev, renderViewRect, drawRect);

  const scale = ev.deltaY < 0 ? 1 / WHEEL_ZOOM_STEP_FACTOR : WHEEL_ZOOM_STEP_FACTOR;
  let newW;
  let newH;
  if (isSphereMode() && state.sphereProjection === "mollweide") {
    const bounds = mollweideZoomBounds(baseViewRect.imgW, baseViewRect.imgH);
    newW = clamp(baseViewRect.srcW * scale, bounds.minW, bounds.maxW);
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
    const base = !isSphereMode() ? sliceFullViewWindow(baseViewRect.imgW, baseViewRect.imgH) : null;
    const minW = isSphereMode() && state.sphereProjection === "inside"
      ? baseViewRect.imgW
      : Math.min(2, baseViewRect.imgW);
    const minH = isSphereMode() && state.sphereProjection === "inside"
      ? baseViewRect.imgH
      : Math.min(2, baseViewRect.imgH);
    const maxZoomOut = sphereZoomOutLimit();
    const maxW = isSphereMode()
      ? baseViewRect.imgW * maxZoomOut
      : (base ? base.w : baseViewRect.imgW) * maxZoomOut;
    const maxH = isSphereMode()
      ? baseViewRect.imgH * maxZoomOut
      : (base ? base.h : baseViewRect.imgH) * maxZoomOut;
    newW = clamp(baseViewRect.srcW * scale, minW, maxW);
    newH = clamp(baseViewRect.srcH * scale, minH, maxH);
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
  const xmap = buildAxisXMapper(axisMapCoords(axis, visibleCoords));
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

  startVisibleUpdate(options.playback === true ? "playback-step" : `${axis}-index`, { axis });
  state.values[axis] = next;
  updateSliderReadouts(state.selectedCoords);

  await refreshSlice({ playback: options.playback === true });
  if (!options.playback && state.selection) await refreshSelectionAnalytics();
}

async function toggleAxisProjection(axis) {
  if (!canProjectAxis(axis)) return;
  startVisibleUpdate(`${axis}-projection`, { axis });
  const quantityBefore = intensityQuantityKey();
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
  applyIntensityQuantityTransition(quantityBefore, intensityQuantityKey());

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
  const quantityBefore = intensityQuantityKey();
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
  const quantityAfter = intensityQuantityKey();
  applyIntensityQuantityTransition(quantityBefore, quantityAfter);
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

function normalizeTabLabel(label) {
  const txt = String(label || "").trim();
  if (!txt) return "Untitled";
  if (txt.length <= DATASET_TAB_LABEL_MAX) return txt;
  return `${txt.slice(0, DATASET_TAB_LABEL_MAX - 1)}…`;
}

function positionalTabLabel(index) {
  const n = Math.max(1, Number.isInteger(index) ? index + 1 : 1);
  return `Tab ${n}`;
}

function relabelFallbackTabsByPosition() {
  for (let i = 0; i < datasetTabs.length; i += 1) {
    const tab = datasetTabs[i];
    const fallback = positionalTabLabel(i);
    tab.fallbackLabel = fallback;
    const hasDataset = Boolean(tab?.snapshot?.dataId);
    if (!hasDataset) {
      tab.label = fallback;
    }
  }
}

function createDatasetTab(baseLabel = null) {
  const id = `tab-${nextDatasetTabId}`;
  nextDatasetTabId += 1;
  const fallbackLabel = baseLabel || positionalTabLabel(datasetTabs.length);
  return {
    id,
    fallbackLabel,
    label: String(fallbackLabel || "").trim() || "Untitled",
    snapshot: createViewerState(),
  };
}

function activeDatasetTab() {
  return datasetTabs.find((tab) => tab.id === activeDatasetTabId) || null;
}

function tabLabelForState(tabSnapshot, fallbackLabel) {
  const sceneTitle = String(tabSnapshot?.sceneSession?.descriptor?.title || "").trim();
  if (sceneTitle) return sceneTitle;
  const dataId = String(tabSnapshot?.dataId || "").trim();
  if (!dataId) return String(fallbackLabel || "").trim() || "Untitled";
  return dataId;
}

function sceneLayerOptionValue(recipeId, targetKind, targetId) {
  return JSON.stringify({ recipeId, targetKind, targetId });
}

function sceneLayerOptions(session) {
  const descriptor = session?.descriptor;
  if (!descriptor || String(descriptor.scene_id || "").startsWith("cube:")) return [];
  const components = Array.isArray(descriptor.components) ? descriptor.components : [];
  const titleById = new Map(components.map((component) => [component.component_id, component.title || component.component_id]));
  const recipes = Array.isArray(descriptor.recipes) ? descriptor.recipes : [];
  const options = [];
  for (const recipe of recipes) {
    const recipeId = String(recipe?.recipe_id || "");
    if (!recipeId) continue;
    const recipeTitle = String(recipe?.title || recipeId);
    options.push({
      value: sceneLayerOptionValue(recipeId, "combined", "combined"),
      label: recipes.length > 1 ? `${recipeTitle} · Combined` : "Combined Scene",
      recipeId,
      targetKind: "combined",
      targetId: "combined",
    });
    const seen = new Set();
    for (const layer of Array.isArray(recipe.layers) ? recipe.layers : []) {
      const componentId = String(layer?.component_id || "");
      if (!componentId || seen.has(componentId)) continue;
      seen.add(componentId);
      const componentTitle = String(titleById.get(componentId) || componentId);
      options.push({
        value: sceneLayerOptionValue(recipeId, "component", componentId),
        label: recipes.length > 1 ? `${recipeTitle} · ${componentTitle}` : componentTitle,
        recipeId,
        targetKind: "component",
        targetId: componentId,
      });
    }
  }
  return options;
}

function renderSceneLayerOptions() {
  if (!els.sceneLayerLabel || !els.sceneLayerSelect) return;
  const options = sceneLayerOptions(state.sceneSession);
  els.sceneLayerSelect.innerHTML = "";
  els.sceneLayerLabel.hidden = options.length < 2;
  if (options.length < 2) return;
  for (const item of options) {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    els.sceneLayerSelect.appendChild(option);
  }
  const activeRecipe = String(state.sceneSession?.active_recipe_id || "");
  const activeTargetKind = String(state.sceneSession?.active_target_kind || "combined");
  const activeTarget = String(state.sceneSession?.active_target_id || "combined");
  const activeValue = sceneLayerOptionValue(activeRecipe, activeTargetKind, activeTarget);
  if (options.some((item) => item.value === activeValue)) {
    els.sceneLayerSelect.value = activeValue;
  }
}

async function loadSceneContext(dataId) {
  if (!dataId) {
    state.sceneSession = null;
    renderSceneLayerOptions();
    return null;
  }
  try {
    const context = await fetchJson(`/api/datasets/${encodeURIComponent(dataId)}/scene`);
    state.sceneSession = context;
  } catch (err) {
    if (isAbortError(err)) throw err;
    state.sceneSession = null;
  }
  renderSceneLayerOptions();
  return state.sceneSession;
}

function ensureDatasetOption(summary) {
  if (!els.datasetSelect || !summary?.data_id) return;
  datasetSummaryById.set(summary.data_id, summary);
  if (Array.from(els.datasetSelect.options).some((option) => option.value === summary.data_id)) return;
  const option = document.createElement("option");
  option.value = summary.data_id;
  option.textContent = `${summary.data_id} (${summary.shape.join("x")})`;
  els.datasetSelect.appendChild(option);
}

async function onSceneLayerChange() {
  if (!state.sceneSession || !els.sceneLayerSelect?.value) return;
  const epoch = activeEpoch() + 1;
  bumpStateEpoch();
  stopPlayback();
  stopSampleMorphPlayback();
  const previousDataId = state.dataId;
  try {
    const selected = JSON.parse(els.sceneLayerSelect.value);
    const sceneId = String(state.sceneSession.descriptor?.scene_id || "");
    if (!sceneId) return;
    setSystemPickerStatus("Preparing Scene layer…");
    const component = selected.targetKind === "component" ? selected.targetId : null;
    const rendered = await fetchJson(`/api/scenes/${encodeURIComponent(sceneId)}/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipe_id: selected.recipeId,
        target: selected.targetKind,
        component_id: component,
      }),
    });
    assertEpoch(epoch);
    ensureDatasetOption(rendered);
    state.dataId = rendered.data_id;
    els.datasetSelect.value = state.dataId;
    resetForSceneLayerChange(state);
    state.meta = await fetchJson(`/api/datasets/${encodeURIComponent(state.dataId)}/meta`);
    assertEpoch(epoch);
    await loadSceneContext(state.dataId);
    assertEpoch(epoch);
    state.sphereMeta = detectSphereMeta(state.meta);
    updateControlCaps();
    await refreshSlice();
    if (state.selection) await refreshSelectionAnalytics();
    else drawSelectionGraphs();
    refreshActiveTabLabel();
    setSystemPickerStatus("");
  } catch (err) {
    if (isAbortError(err)) return;
    state.dataId = previousDataId;
    els.datasetSelect.value = previousDataId || "";
    renderSceneLayerOptions();
    setSystemPickerStatus(`Scene layer failed: ${err.message}`, true);
  }
}

function syncActiveTabSnapshot() {
  const tab = activeDatasetTab();
  if (!tab) return;
  tab.snapshot = snapshotState();
  tab.label = tabLabelForState(tab.snapshot, tab.fallbackLabel);
}

function refreshActiveTabLabel() {
  const tab = activeDatasetTab();
  if (!tab) return;
  if (tab.snapshot && typeof tab.snapshot === "object") {
    tab.snapshot.dataId = state.dataId;
  }
  tab.label = tabLabelForState(state, tab.fallbackLabel);
  renderDatasetTabs();
}

function renderDatasetTabs() {
  if (!els.datasetTabs) return;
  relabelFallbackTabsByPosition();
  els.datasetTabs.innerHTML = "";

  const createAddButton = () => {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "datasetTabAddBtn";
    addBtn.textContent = "+";
    addBtn.title = "Create new dataset tab";
    addBtn.setAttribute("aria-label", "Create new dataset tab");
    addBtn.addEventListener("click", async () => {
      await addDatasetTabAndActivate();
    });
    return addBtn;
  };

  for (let i = 0; i < datasetTabs.length; i += 1) {
    const tab = datasetTabs[i];
    const isActive = tab.id === activeDatasetTabId;
    const fullLabel = String(tab.label || "").trim() || "Untitled";
    const displayLabel = isActive ? fullLabel : normalizeTabLabel(fullLabel);
    const item = document.createElement("div");
    item.className = "datasetTabItem";
    item.classList.toggle("isActive", isActive);

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "datasetTabBtn";
    selectBtn.textContent = displayLabel;
    selectBtn.title = fullLabel;
    selectBtn.setAttribute("role", "tab");
    selectBtn.dataset.tabId = tab.id;
    selectBtn.setAttribute("aria-selected", isActive ? "true" : "false");
    selectBtn.addEventListener("click", async () => {
      await activateDatasetTab(tab.id);
    });
    item.appendChild(selectBtn);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "datasetTabCloseBtn";
    closeBtn.textContent = "x";
    closeBtn.title = `Close ${fullLabel}`;
    closeBtn.setAttribute("aria-label", `Close ${fullLabel}`);
    closeBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await closeDatasetTab(tab.id);
    });
    item.appendChild(closeBtn);

    els.datasetTabs.appendChild(item);
  }
  els.datasetTabs.appendChild(createAddButton());
}

function ensureActiveTabVisible() {
  if (!els.datasetTabs) return;
  const activeBtn = els.datasetTabs.querySelector(".datasetTabItem.isActive");
  if (!activeBtn) return;
  activeBtn.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
}

function syncUiToState() {
  if (els.datasetSelect) {
    const wanted = state.dataId || "";
    if (els.datasetSelect.value !== wanted) {
      els.datasetSelect.value = wanted;
    }
  }
  state.colorMap = normalizeColorMapKey(state.colorMap);
  if (els.colorMapSelect) els.colorMapSelect.value = state.colorMap;
  if (els.colorRangeModeSelect) els.colorRangeModeSelect.value = state.colorRangeMode;
  if (els.sliceBackendSelect) els.sliceBackendSelect.value = state.sliceRender.backend;
  if (els.computeBackendSelect) els.computeBackendSelect.value = normalizeComputeBackendPreference(state.multiSpectralComputeBackend);
  if (els.spatialResolutionSelect) els.spatialResolutionSelect.value = String(spatialScaleFactor());
  if (els.temporalResolutionSelect) els.temporalResolutionSelect.value = String(temporalScaleFactor());
  if (els.spectralResolutionSelect) els.spectralResolutionSelect.value = String(spectralScaleFactor());
  if (els.playSpeedSelect) els.playSpeedSelect.value = String(state.playbackFps);
  if (els.sampleMorphDeltaSelect) els.sampleMorphDeltaSelect.value = String(state.sampleMorphDeltaT);
  if (els.coordSystemSelect) els.coordSystemSelect.value = state.coordSystem;
  setSystemPickerStatus(state.pickerStatusMessage || "", Boolean(state.pickerStatusError));
  renderSceneLayerOptions();
}

async function activateDatasetTab(tabId) {
  const target = datasetTabs.find((tab) => tab.id === tabId);
  if (!target || target.id === activeDatasetTabId) return;

  try {
    stopPlayback();
    stopSampleMorphPlayback();
    syncActiveTabSnapshot();
    activeDatasetTabId = target.id;
    bumpStateEpoch();
    restoreState(target.snapshot);
    syncUiToState();
    renderDatasetTabs();
    ensureActiveTabVisible();
    updateControlCaps();

    if (state.dataId && !state.meta) {
      try {
        state.meta = await fetchJson(`/api/datasets/${state.dataId}/meta`);
      } catch (err) {
        if (!isAbortError(err)) {
          setSystemPickerStatus(`Failed to restore tab dataset: ${err.message}`, true);
        }
        return;
      }
    }

    if (state.dataId && !state.sceneSession) {
      await loadSceneContext(state.dataId);
    }

    if (state.dataId) {
      const hasFrame = Boolean(state.frameCanvas || (state.frameTiles && state.frameTiles.length));
      if (!hasFrame) {
        await refreshSlice();
        if (state.selection) await refreshSelectionAnalytics();
        else drawSelectionGraphs();
      } else {
        drawFrameAndOverlays();
        drawNavigationGraphs();
        drawSelectionGraphs();
        drawColorbar();
      }
      return;
    }

    drawFrameAndOverlays();
    drawNavigationGraphs();
    drawSelectionGraphs();
    drawColorbar();
  } catch (err) {
    if (!isAbortError(err)) {
      setSystemPickerStatus(`Tab switch failed: ${err.message}`, true);
    }
  }
}

async function addDatasetTabAndActivate(options = {}) {
  const readyStatus = options.readyStatus !== false;
  syncActiveTabSnapshot();
  const tab = createDatasetTab();
  datasetTabs.push(tab);
  renderDatasetTabs();
  await activateDatasetTab(tab.id);
  if (readyStatus) {
    setSystemPickerStatus("New tab ready. Load a dataset to begin.");
  }
  return tab;
}

async function closeDatasetTab(tabId) {
  const idx = datasetTabs.findIndex((tab) => tab.id === tabId);
  if (idx < 0) return;

  syncActiveTabSnapshot();
  const closingActive = datasetTabs[idx].id === activeDatasetTabId;

  if (datasetTabs.length <= 1) {
    const onlyTab = datasetTabs[0];
    const emptyLabel = "Tab 1";
    onlyTab.fallbackLabel = emptyLabel;
    onlyTab.snapshot = createViewerState();
    onlyTab.label = emptyLabel;
    activeDatasetTabId = onlyTab.id;
    bumpStateEpoch();
    restoreState(onlyTab.snapshot);
    syncUiToState();
    updateControlCaps();
    drawFrameAndOverlays();
    drawNavigationGraphs();
    drawSelectionGraphs();
    drawColorbar();
    renderDatasetTabs();
    return;
  }

  datasetTabs.splice(idx, 1);
  renderDatasetTabs();
  if (!closingActive) return;

  const fallback = datasetTabs[idx] || datasetTabs[idx - 1] || datasetTabs[0];
  if (!fallback) return;
  await activateDatasetTab(fallback.id);
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
  const epoch = activeEpoch();
  const list = await fetchJson("/api/datasets");
  assertEpoch(epoch);
  const visibleDatasets = Array.isArray(list.datasets) ? list.datasets.filter((ds) => !isSeededDatasetSummary(ds)) : [];
  datasetSummaryById.clear();
  for (const ds of visibleDatasets) {
    if (ds && ds.data_id) datasetSummaryById.set(ds.data_id, ds);
  }
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

async function prepareInitialSceneLaunch() {
  const params = new URLSearchParams(window.location.search);
  const sceneId = String(params.get("scene_id") || "").trim();
  if (!sceneId) return;
  const descriptor = await fetchJson(`/api/scenes/${encodeURIComponent(sceneId)}`);
  const recipeId = String(params.get("recipe_id") || descriptor.default_recipe_id || "").trim();
  const componentId = String(params.get("component_id") || "").trim();
  const rendered = await fetchJson(`/api/scenes/${encodeURIComponent(sceneId)}/views`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipe_id: recipeId,
      target: componentId ? "component" : "combined",
      component_id: componentId || null,
    }),
  });
  await refreshDatasetOptions(rendered.data_id);
  ensureDatasetOption(rendered);
  state.dataId = rendered.data_id;
  els.datasetSelect.value = rendered.data_id;
}

function setSystemPickerStatus(message, isError = false) {
  const nextMessage = message || "";
  const nextError = Boolean(isError);
  state.pickerStatusMessage = nextMessage;
  state.pickerStatusError = nextError;
  if (!els.systemPickerStatus) return;
  els.systemPickerStatus.textContent = nextMessage;
  els.systemPickerStatus.classList.toggle("error", nextError);
}

function resetIngestWizardState() {
  endIngestAxisDrag();
  ingestWizard.step = "intent";
  ingestWizard.inspection = null;
  ingestWizard.plan = null;
  ingestWizard.selectedPresetId = null;
  ingestWizard.mappings = [];
  ingestWizard.intent = "tabs";
  ingestWizard.fileAxis = "sample";
  ingestWizard.activeFileIndex = 0;
}

function setIngestStatus(message, isError = false) {
  if (!els.ingestStatus) return;
  els.ingestStatus.textContent = message || "";
  els.ingestStatus.classList.toggle("error", Boolean(isError));
}

function setIngestStep(step) {
  const resolved = ["intent", "keys", "map"].includes(String(step || "")) ? String(step) : "intent";
  ingestWizard.step = resolved;
  if (els.ingestStepPillMap) els.ingestStepPillMap.classList.toggle("isActive", resolved === "map");
}

function ingestConfidenceLabel(fileInfo) {
  const tier = String(fileInfo?.confidence_tier || "low");
  const score = Number(fileInfo?.confidence || 0);
  return `${tier.toUpperCase()} (${score.toFixed(2)})`;
}

function ingestFiles() {
  return Array.isArray(ingestWizard.inspection?.files) ? ingestWizard.inspection.files : [];
}

function ingestDatasetCandidates(fileInfo) {
  const candidates = fileInfo?.parsed?.format_metadata?.dataset_candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates.filter(
    (row) => row && typeof row === "object" && typeof row.path === "string" && Array.isArray(row.shape) && row.shape.length
  );
}

function ingestDisplayDatasetCandidates(fileInfo, mapping) {
  const candidates = ingestDatasetCandidates(fileInfo);
  if (!candidates.length) return [];
  const nonStack = candidates.filter((row) => String(row.kind || "dataset") !== "stokes_stack");
  const filtered = nonStack.filter((row) => !Boolean(row.coordinate_like));
  const base = filtered.length ? filtered : nonStack;
  return [...base];
}

function ingestSelectableDatasetPathSet(fileInfo) {
  const candidates = ingestDisplayDatasetCandidates(fileInfo, null);
  if (candidates.length) {
    return new Set(candidates.map((row) => String(row.path || "").trim()).filter((path) => path));
  }
  return new Set(
    ingestDatasetCandidates(fileInfo)
      .filter((row) => String(row.kind || "dataset") !== "stokes_stack")
      .map((row) => String(row.path || "").trim())
      .filter((path) => path)
  );
}

function ingestNormalizeDatasetSelectionPaths(fileInfo, paths) {
  const candidates = ingestDatasetCandidates(fileInfo);
  const candidateByPath = new Map(candidates.map((row) => [String(row.path || "").trim(), row]));
  const selectablePathSet = ingestSelectableDatasetPathSet(fileInfo);
  const out = [];
  const seen = new Set();
  const rawPaths = Array.isArray(paths) ? paths : [];
  for (const rawPath of rawPaths) {
    const target = String(rawPath || "").trim();
    if (!target) continue;
    const candidate = candidateByPath.get(target);
    const expanded =
      String(candidate?.kind || "dataset") === "stokes_stack" && Array.isArray(candidate?.member_paths) && candidate.member_paths.length
        ? candidate.member_paths
        : [target];
    for (const member of expanded) {
      const memberPath = String(member || "").trim();
      if (!memberPath || seen.has(memberPath)) continue;
      if (selectablePathSet.size && !selectablePathSet.has(memberPath)) continue;
      seen.add(memberPath);
      out.push(memberPath);
    }
  }
  return out;
}

function ingestStokesStackCandidates(fileInfo) {
  return ingestDatasetCandidates(fileInfo).filter(
    (row) => String(row.kind || "") === "stokes_stack" && Array.isArray(row.member_paths) && row.member_paths.length >= 2
  );
}

function ingestDefaultDatasetSelectionPaths(fileInfo) {
  const defaultPath = String(fileInfo?.parsed?.format_metadata?.dataset_path || "").trim();
  if (defaultPath) {
    const normalizedDefault = ingestNormalizeDatasetSelectionPaths(fileInfo, [defaultPath]);
    if (normalizedDefault.length) return normalizedDefault;
  }

  const stacks = ingestStokesStackCandidates(fileInfo).sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
  if (stacks.length) {
    const members = ingestNormalizeDatasetSelectionPaths(fileInfo, stacks[0].member_paths);
    if (members.length) return members;
  }

  const visible = ingestDisplayDatasetCandidates(fileInfo, null);
  if (visible.length) {
    const normalizedVisible = ingestNormalizeDatasetSelectionPaths(fileInfo, [visible[0].path]);
    if (normalizedVisible.length) return normalizedVisible;
  }

  const anyNonStack = ingestDatasetCandidates(fileInfo).filter((row) => String(row.kind || "dataset") !== "stokes_stack");
  if (anyNonStack.length) {
    const normalizedAny = ingestNormalizeDatasetSelectionPaths(fileInfo, [anyNonStack[0].path]);
    if (normalizedAny.length) return normalizedAny;
  }
  return [];
}

function ingestTrimmedDatasetPath(path) {
  return String(path || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function ingestStackAxisHintFromToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "sample" || normalized === "samples" || normalized === "realization" || normalized === "realizations") {
    return "sample";
  }
  if (normalized === "pol" || normalized === "polarization" || normalized === "polarizations" || normalized === "stokes") {
    return "pol";
  }
  if (normalized === "t" || normalized === "time" || normalized === "times" || normalized === "frame" || normalized === "frames") {
    return "t";
  }
  if (
    normalized === "nu" ||
    normalized === "freq" ||
    normalized === "frequency" ||
    normalized === "frequencies" ||
    normalized === "band" ||
    normalized === "bands"
  ) {
    return "nu";
  }
  if (normalized === "x") return "x";
  if (normalized === "y") return "y";
  if (normalized === "z") return "z";
  return null;
}

function ingestInferStackAxisFromPaths(paths) {
  const selected = Array.isArray(paths)
    ? [...new Set(paths.map((path) => ingestTrimmedDatasetPath(path)).filter((path) => path))]
    : [];
  if (selected.length < 2) return null;

  const partsList = selected.map((path) => path.split("/").filter((part) => part));
  if (!partsList.every((parts) => parts.length > 0)) return null;

  const tokenized = (part) => String(part || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token);
  const inferFromPart = (part) => {
    const direct = ingestStackAxisHintFromToken(part);
    if (direct) return direct;
    const tokens = tokenized(part);
    for (const token of tokens) {
      const inferred = ingestStackAxisHintFromToken(token);
      if (inferred) return inferred;
    }
    return null;
  };

  const minDepth = Math.min(...partsList.map((parts) => parts.length));
  let sharedDepth = 0;
  while (sharedDepth < minDepth) {
    const seg = String(partsList[0][sharedDepth] || "").toLowerCase();
    if (partsList.every((parts) => String(parts[sharedDepth] || "").toLowerCase() === seg)) {
      sharedDepth += 1;
      continue;
    }
    break;
  }
  if (sharedDepth > 0) {
    const sharedSegment = partsList[0][sharedDepth - 1];
    const fromShared = inferFromPart(sharedSegment);
    if (fromShared) return fromShared;
  }

  const leafTokens = new Set(partsList.flatMap((parts) => tokenized(parts[parts.length - 1])));
  if (leafTokens.size > 0 && [...leafTokens].every((token) => /^\d+$/.test(token))) {
    const parentTokens = new Set(partsList.flatMap((parts) => (parts.length > 1 ? tokenized(parts[parts.length - 2]) : [])));
    if (parentTokens.has("sample") || parentTokens.has("samples")) return "sample";
    if (parentTokens.has("time") || parentTokens.has("times") || parentTokens.has("t")) return "t";
  }
  if (["i", "q", "u", "v"].every((token) => leafTokens.has(token))) return "pol";

  const voteCounts = new Map();
  for (const parts of partsList) {
    for (const part of parts) {
      const inferred = inferFromPart(part);
      if (!inferred) continue;
      voteCounts.set(inferred, Number(voteCounts.get(inferred) || 0) + 1);
    }
  }
  let best = null;
  let bestScore = 0;
  for (const dim of INGEST_CANONICAL_DIMS) {
    const score = Number(voteCounts.get(dim) || 0);
    if (score > bestScore) {
      best = dim;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function ingestSetSelectedDatasetPaths(mapping, fileInfo, paths) {
  if (!mapping || !fileInfo) return;
  let next = ingestNormalizeDatasetSelectionPaths(fileInfo, paths);
  if (!next.length && ingestShouldAutoselectDatasets(fileInfo)) {
    next = ingestDefaultDatasetSelectionPaths(fileInfo);
  }
  mapping.datasetPaths = next;
  mapping.datasetPath = next.length ? next[0] : null;
  mapping.keyStackAxis = next.length > 1 ? ingestStackAxisForMapping(mapping) : null;
  normalizeIngestMappingForFile(fileInfo, mapping);
}

function ingestDatasetPrefixGroups(fileInfo, mapping) {
  const groups = new Map();
  const candidates = ingestDisplayDatasetCandidates(fileInfo, mapping);
  for (const cand of candidates) {
    const rawPath = String(cand?.path || "").trim();
    if (!rawPath) continue;
    const trimmed = ingestTrimmedDatasetPath(rawPath);
    const parts = trimmed.split("/").filter((part) => part);
    if (parts.length < 2) continue;
    for (let depth = 1; depth < parts.length; depth += 1) {
      const prefix = parts.slice(0, depth).join("/");
      const existing = groups.get(prefix) || { prefix, depth, paths: new Set() };
      existing.paths.add(rawPath);
      groups.set(prefix, existing);
    }
  }
  return [...groups.values()]
    .filter((group) => group.paths.size > 1)
    .sort((a, b) => b.depth - a.depth || b.paths.size - a.paths.size || a.prefix.localeCompare(b.prefix));
}

function ingestStackableDatasetCandidates(fileInfo) {
  return ingestDatasetCandidates(fileInfo).filter(
    (row) => String(row.kind || "dataset") === "dataset" && !Boolean(row.coordinate_like) && Array.isArray(row.shape) && row.shape.length >= 2
  );
}

function ingestDatasetCandidateLabel(cand) {
  if (!cand || typeof cand !== "object") return "?";
  if (String(cand.kind || "") === "stokes_stack") {
    const members = Array.isArray(cand.member_paths) ? cand.member_paths.join(", ") : "I,Q,U,V";
    return `Stokes stack (${members})`;
  }
  return String(cand.path || "?");
}

function ingestDatasetLeafName(path) {
  const trimmed = ingestTrimmedDatasetPath(path);
  if (!trimmed) return "";
  const parts = trimmed.split("/");
  return String(parts[parts.length - 1] || "").trim();
}

function ingestUniqueDatasetPathList(paths) {
  const out = [];
  const seen = new Set();
  const items = Array.isArray(paths) ? paths : [];
  for (const item of items) {
    const path = String(item || "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function ingestPolarizationChannelHint(path) {
  const trimmed = ingestTrimmedDatasetPath(path).toLowerCase();
  if (!trimmed) return "";
  const parts = trimmed.split("/").filter((part) => part);
  const inspectParts = [];
  if (parts.length) inspectParts.push(parts[parts.length - 1]);
  if (parts.length > 1) inspectParts.push(parts[parts.length - 2]);
  const direct = new Set(["i", "q", "u", "v"]);
  for (const part of inspectParts) {
    if (direct.has(part)) return part;
    const tokens = String(part).split(/[^a-z0-9]+/).filter((token) => token);
    for (const token of tokens) {
      if (direct.has(token)) return token;
      const stokesMatch = token.match(/^stokes([iquv])$/);
      if (stokesMatch) return String(stokesMatch[1] || "");
      const polMatch = token.match(/^pol([iquv])$/);
      if (polMatch) return String(polMatch[1] || "");
    }
  }
  return "";
}

function ingestMapSelectionByPolarizationChannels(fileInfo, sourcePaths) {
  const source = ingestUniqueDatasetPathList(sourcePaths);
  if (source.length < 2) return [];
  const sourceChannels = source.map((path) => ingestPolarizationChannelHint(path));
  if (sourceChannels.some((channel) => !channel)) return [];
  if (new Set(sourceChannels).size !== sourceChannels.length) return [];

  const selectable = ingestSelectableDatasetPathSet(fileInfo);
  const candidates = ingestDatasetCandidates(fileInfo).filter((row) => selectable.has(String(row?.path || "").trim()));
  const channelToPath = new Map();
  const duplicateChannels = new Set();
  for (const cand of candidates) {
    const path = String(cand?.path || "").trim();
    if (!path) continue;
    const channel = ingestPolarizationChannelHint(path);
    if (!channel) continue;
    if (channelToPath.has(channel)) {
      duplicateChannels.add(channel);
      continue;
    }
    channelToPath.set(channel, path);
  }
  for (const channel of duplicateChannels) channelToPath.delete(channel);

  const mapped = [];
  const used = new Set();
  for (const channel of sourceChannels) {
    const path = String(channelToPath.get(channel) || "").trim();
    if (!path || used.has(path)) return [];
    used.add(path);
    mapped.push(path);
  }
  const normalized = ingestNormalizeDatasetSelectionPaths(fileInfo, mapped);
  return normalized.length === source.length ? normalized : [];
}

function ingestMapSelectionByLeafNames(fileInfo, sourcePaths) {
  const source = ingestUniqueDatasetPathList(sourcePaths);
  if (!source.length) return [];
  const sourceLeaves = source.map((path) => ingestDatasetLeafName(path).toLowerCase()).filter((leaf) => leaf);
  if (sourceLeaves.length !== source.length) return [];

  const selectable = ingestSelectableDatasetPathSet(fileInfo);
  const candidates = ingestDatasetCandidates(fileInfo).filter((row) => selectable.has(String(row?.path || "").trim()));
  const leafToPath = new Map();
  const duplicateLeaves = new Set();
  for (const cand of candidates) {
    const path = String(cand?.path || "").trim();
    if (!path) continue;
    const leaf = ingestDatasetLeafName(path).toLowerCase();
    if (!leaf) continue;
    if (leafToPath.has(leaf)) {
      duplicateLeaves.add(leaf);
      continue;
    }
    leafToPath.set(leaf, path);
  }
  for (const leaf of duplicateLeaves) leafToPath.delete(leaf);

  const mapped = [];
  const used = new Set();
  for (const leaf of sourceLeaves) {
    const path = String(leafToPath.get(leaf) || "").trim();
    if (!path || used.has(path)) return [];
    used.add(path);
    mapped.push(path);
  }
  const normalized = ingestNormalizeDatasetSelectionPaths(fileInfo, mapped);
  return normalized.length === source.length ? normalized : [];
}

function ingestResolveDatasetSelectionForFile(fileInfo, sourcePaths, { stackAxis = null, allowDefaultFallback = false } = {}) {
  const source = ingestUniqueDatasetPathList(sourcePaths);
  const selectable = ingestSelectableDatasetPathSet(fileInfo);
  if (source.length) {
    if (source.every((path) => selectable.has(path))) {
      const normalized = ingestNormalizeDatasetSelectionPaths(fileInfo, source);
      if (normalized.length === source.length) return normalized;
    }
    if (source.length > 1 && String(stackAxis || "").toLowerCase() === "pol") {
      const byChannel = ingestMapSelectionByPolarizationChannels(fileInfo, source);
      if (byChannel.length === source.length) return byChannel;
      const stokesCandidates = ingestStokesStackCandidates(fileInfo).sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
      for (const cand of stokesCandidates) {
        const members = ingestStokesMemberPathsFromCandidate(fileInfo, cand);
        if (members.length === source.length) return members;
      }
    }
    const byLeaf = ingestMapSelectionByLeafNames(fileInfo, source);
    if (byLeaf.length === source.length) return byLeaf;
  }
  if (allowDefaultFallback) {
    return ingestDefaultDatasetSelectionPaths(fileInfo);
  }
  return [];
}

function ingestStokesMemberPathsFromCandidate(fileInfo, cand) {
  if (!cand) return [];
  const members = Array.isArray(cand.member_paths) ? cand.member_paths : [];
  return ingestNormalizeDatasetSelectionPaths(fileInfo, members);
}

function ingestStokesStackQuickLabel(cand, memberPaths = []) {
  const labels = memberPaths
    .map((path) => ingestDatasetLeafName(path))
    .map((name) => name.toUpperCase())
    .filter((name) => name);
  if (labels.length) return `Stokes stack (${labels.join(", ")})`;
  return ingestDatasetCandidateLabel(cand);
}

function ingestSelectedDatasetPaths(fileInfo, mapping) {
  if (Array.isArray(mapping?.datasetPaths)) {
    const fromList = mapping.datasetPaths.map((x) => String(x || "").trim()).filter((x) => x);
    return ingestNormalizeDatasetSelectionPaths(fileInfo, fromList);
  }
  const single = String(mapping?.datasetPath || fileInfo?.parsed?.format_metadata?.dataset_path || "").trim();
  return single ? ingestNormalizeDatasetSelectionPaths(fileInfo, [single]) : [];
}

function ingestSelectedDatasetCandidate(fileInfo, mapping) {
  const visibleCandidates = ingestDisplayDatasetCandidates(fileInfo, mapping);
  const candidates = visibleCandidates.length
    ? visibleCandidates
    : ingestDatasetCandidates(fileInfo).filter((row) => String(row.kind || "dataset") !== "stokes_stack");
  if (!candidates.length) return null;
  const selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
  if (!selectedPaths.length) return null;
  const selectedPath = selectedPaths.length ? selectedPaths[0] : "";
  if (selectedPath) {
    const selected = candidates.find((row) => String(row.path || "") === String(selectedPath));
    if (selected) return selected;
  }
  return candidates[0];
}

function ingestStackAxisForMapping(mapping) {
  const axis = String(mapping?.keyStackAxis || "").trim().toLowerCase();
  if (INGEST_CANONICAL_DIMS.includes(axis)) return axis;
  const inferred = ingestInferStackAxisFromPaths(mapping?.datasetPaths);
  return inferred && INGEST_CANONICAL_DIMS.includes(inferred) ? inferred : "pol";
}

function ingestHdf5StackToken(paths) {
  const items = Array.isArray(paths)
    ? paths.map((x) => String(x || "").trim()).filter((x) => x)
    : [];
  if (!items.length) return "";
  return `${INGEST_HDF5_STACK_TOKEN_PREFIX}${JSON.stringify(items)}`;
}

function ingestShapeForMapping(fileInfo, mapping) {
  const candidates = ingestDatasetCandidates(fileInfo);
  const selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
  if (!selectedPaths.length) {
    return Array.isArray(fileInfo?.parsed?.shape) ? fileInfo.parsed.shape : [];
  }
  const selectedRows = selectedPaths
    .map((path) => candidates.find((row) => String(row.path || "") === String(path)))
    .filter((row) => row && Array.isArray(row.shape));
  if (!selectedRows.length) {
    return Array.isArray(fileInfo?.parsed?.shape) ? fileInfo.parsed.shape : [];
  }
  if (selectedRows.length === 1) {
    return selectedRows[0].shape;
  }
  const baseShape = selectedRows[0].shape;
  const compatible = selectedRows.every((row) => row.shape.length === baseShape.length && row.shape.every((v, i) => v === baseShape[i]));
  if (!compatible) {
    return [];
  }
  return [selectedRows.length, ...baseShape];
}

function reorderIngestSelectedKeys(mapping, sourcePath, targetPath, { after = false } = {}) {
  if (!mapping || !Array.isArray(mapping.datasetPaths) || mapping.datasetPaths.length < 2) return false;
  const src = mapping.datasetPaths.findIndex((path) => String(path || "") === String(sourcePath || ""));
  if (src < 0) return false;
  const next = [...mapping.datasetPaths];
  const [moved] = next.splice(src, 1);
  if (!targetPath) {
    next.push(moved);
  } else {
    let dst = next.findIndex((path) => String(path || "") === String(targetPath || ""));
    if (dst < 0) return false;
    if (after) dst += 1;
    next.splice(dst, 0, moved);
  }
  mapping.datasetPaths = next;
  mapping.datasetPath = next[0] || null;
  return true;
}

function normalizeIngestMappingForFile(fileInfo, mapping, { forceResetAxes = false } = {}) {
  if (!mapping || !fileInfo) return;
  const selected = ingestSelectedDatasetPaths(fileInfo, mapping);
  if (!selected.length && ingestShouldAutoselectDatasets(fileInfo)) {
    selected.push(...ingestDefaultDatasetSelectionPaths(fileInfo));
  }
  mapping.datasetPaths = selected;
  mapping.datasetPath = selected.length ? selected[0] : null;
  mapping.keyStackAxis = selected.length > 1 ? ingestStackAxisForMapping(mapping) : null;

  const shape = ingestShapeForMapping(fileInfo, mapping);
  const current = Array.isArray(mapping.axisAssignments) ? mapping.axisAssignments : [];
  let needsReset = forceResetAxes || current.length !== shape.length;
  if (!needsReset && selected.length > 1 && current.length) {
    const stackAxis = ingestStackAxisForMapping(mapping);
    const firstCanonical = canonicalIngestDim(String(current[0] || "").trim());
    if (firstCanonical !== stackAxis) needsReset = true;
  }
  if (needsReset) {
    mapping.axisAssignments = ingestDefaultAxisAssignments(fileInfo, mapping, shape);
    mapping.axisAssignmentsConfirmed = new Array(mapping.axisAssignments.length).fill(false);
  } else {
    ensureIngestAssignmentConfirmed(mapping, mapping.axisAssignments.length);
  }
  if (typeof mapping.fileAxisConfirmed !== "boolean") mapping.fileAxisConfirmed = false;
}

function fileAxisFromGrouping(mode) {
  if (mode === "files_as_t") return "t";
  if (mode === "files_as_nu") return "nu";
  if (mode === "files_as_pol") return "pol";
  return "sample";
}

function groupingFromFileAxis(dim) {
  if (dim === "t") return "files_as_t";
  if (dim === "nu") return "files_as_nu";
  if (dim === "pol") return "files_as_pol";
  return "files_as_sample";
}

function canonicalIngestDim(dim) {
  return dim === INGEST_SPHERE_ALIAS_DIM ? "x" : dim;
}

function ingestAxisLabel(dim) {
  const raw = String(dim || "").trim().toLowerCase();
  return INGEST_AXIS_LABEL[raw] || INGEST_AXIS_LABEL[canonicalIngestDim(raw)] || raw || "?";
}

function ingestSupportsKeySelection(fileInfo) {
  return String(fileInfo?.raw_input?.format || "").toLowerCase() === "hdf5";
}

function ingestShouldAutoselectDatasets(fileInfo) {
  return !ingestSupportsKeySelection(fileInfo);
}

function ingestHasKeySelectionStep() {
  const files = ingestFiles();
  if (files.length > 1) return true;
  return ingestSupportsKeySelection(files[0]);
}

function ensureIngestAssignmentConfirmed(mapping, shapeLength) {
  const targetLength = Math.max(0, Number(shapeLength) || 0);
  const current = Array.isArray(mapping?.axisAssignmentsConfirmed) ? mapping.axisAssignmentsConfirmed : [];
  const next = new Array(targetLength).fill(false);
  for (let i = 0; i < targetLength; i += 1) {
    next[i] = Boolean(current[i]);
  }
  if (mapping) mapping.axisAssignmentsConfirmed = next;
  if (mapping && typeof mapping.fileAxisConfirmed !== "boolean") mapping.fileAxisConfirmed = false;
}

function isIngestAxisAssignmentConfirmed(mapping, axis) {
  if (!mapping) return false;
  const idx = Number(axis);
  if (!Number.isInteger(idx) || idx < 0) return false;
  const list = Array.isArray(mapping.axisAssignmentsConfirmed) ? mapping.axisAssignmentsConfirmed : [];
  return Boolean(list[idx]);
}

function setIngestAxisAssignmentConfirmed(mapping, axis, confirmed) {
  if (!mapping) return;
  const idx = Number(axis);
  if (!Number.isInteger(idx) || idx < 0) return;
  ensureIngestAssignmentConfirmed(mapping, Array.isArray(mapping.axisAssignments) ? mapping.axisAssignments.length : 0);
  if (idx >= mapping.axisAssignmentsConfirmed.length) return;
  mapping.axisAssignmentsConfirmed[idx] = Boolean(confirmed);
}

function ingestAxisThemeForDim(dim) {
  const canonical = canonicalIngestDim(String(dim || "").trim().toLowerCase());
  return INGEST_AXIS_THEME[canonical] || null;
}

function applyIngestAxisTheme(el, dim) {
  if (!el || !(el instanceof HTMLElement)) return;
  const theme = ingestAxisThemeForDim(dim);
  if (!theme) {
    el.style.removeProperty("--ingest-axis-rgb");
    el.style.removeProperty("--ingest-axis-border");
    el.style.removeProperty("--ingest-axis-text");
    return;
  }
  el.style.setProperty("--ingest-axis-rgb", theme.rgb);
  el.style.setProperty("--ingest-axis-border", theme.border);
  el.style.setProperty("--ingest-axis-text", theme.text);
}

function defaultIntentFromInspection(inspection) {
  const files = Array.isArray(inspection?.files) ? inspection.files : [];
  if (files.length <= 1) {
    return { intent: "tabs", fileAxis: "sample" };
  }
  const candidates = Array.isArray(inspection?.grouping_candidates) ? inspection.grouping_candidates : [];
  const sorted = [...candidates].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const top = sorted[0];
  const second = sorted[1];
  if (!top) return { intent: "tabs", fileAxis: "sample" };
  const topScore = Number(top.score || 0);
  if (top.mode === "separate" || topScore < 0.6) return { intent: "tabs", fileAxis: "sample" };
  if (top.mode === "files_as_sample" && topScore >= 0.7) {
    return { intent: "axis", fileAxis: "sample" };
  }
  if (second && Math.abs(topScore - Number(second.score || 0)) <= 0.1) return { intent: "tabs", fileAxis: "sample" };
  return { intent: "axis", fileAxis: fileAxisFromGrouping(top.mode) };
}

function highConfidenceAxisAssignments(file, shapeOverride = null) {
  const shape = Array.isArray(shapeOverride) ? shapeOverride : Array.isArray(file?.parsed?.shape) ? file.parsed.shape : [];
  const assignments = new Array(shape.length).fill(null);
  const used = new Set();

  const inferences = Array.isArray(file?.axis_inferences) ? file.axis_inferences : [];
  for (let axis = 0; axis < shape.length; axis += 1) {
    const inf = inferences.find((row) => Number(row.axis_index) === axis);
    const recommended = String(inf?.recommended || "");
    const candidates = Array.isArray(inf?.candidates) ? inf.candidates : [];
    const recCandidate = candidates.find((c) => String(c.target_dim || "") === recommended);
    const score = Number(recCandidate?.score ?? 0);
    if (score >= 0.85 && INGEST_CANONICAL_DIMS.includes(recommended) && !used.has(recommended)) {
      assignments[axis] = recommended;
      used.add(recommended);
    }
  }
  return assignments;
}

function ingestDefaultAxisAssignments(fileInfo, mapping, shapeOverride = null) {
  const shape = Array.isArray(shapeOverride) ? shapeOverride : ingestShapeForMapping(fileInfo, mapping);
  if (!Array.isArray(shape) || !shape.length) return [];

  const selected = ingestSelectedDatasetCandidate(fileInfo, mapping);
  const selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
  const dimsFromAttr = Array.isArray(selected?.dims_attr)
    ? selected.dims_attr
        .map((dim) => String(dim || "").trim().toLowerCase())
        .filter((dim) => INGEST_CANONICAL_DIMS.includes(dim))
    : [];
  const fallbackOrder = ["y", "z", "x", "t", "nu", "sample", "pol"];
  const isPolSizeValid = (size) => Number(size) === 1 || Number(size) === 4;
  const isSphereSizeValid = (size) => healpixNsideFromNpix(Math.trunc(Number(size))) !== null;
  const isDimAllowedForSize = (dim, size) => {
    const raw = String(dim || "").trim().toLowerCase();
    if (!raw) return false;
    const canonical = canonicalIngestDim(raw);
    if (canonical === "pol") return isPolSizeValid(size);
    if (raw === INGEST_SPHERE_ALIAS_DIM) return isSphereSizeValid(size);
    return INGEST_CANONICAL_DIMS.includes(canonical);
  };
  const pickUnusedDim = (candidates, size, usedCanonical) => {
    for (const cand of candidates) {
      const dim = String(cand || "").trim().toLowerCase();
      if (!isDimAllowedForSize(dim, size)) continue;
      const canonical = canonicalIngestDim(dim);
      if (usedCanonical.has(canonical)) continue;
      return dim;
    }
    return "";
  };
  const fillUnknownAxes = (seedDims, startAxis = 0) => {
    const out = new Array(shape.length).fill(null);
    const usedCanonical = new Set();
    for (let axis = 0; axis < shape.length; axis += 1) {
      if (axis < startAxis) continue;
      const size = Number(shape[axis] || 0);
      const seed = String(seedDims[axis] || "").trim().toLowerCase();
      if (!seed) continue;
      if (!isDimAllowedForSize(seed, size)) continue;
      const canonical = canonicalIngestDim(seed);
      if (usedCanonical.has(canonical)) continue;
      out[axis] = seed;
      usedCanonical.add(canonical);
    }
    for (let axis = startAxis; axis < shape.length; axis += 1) {
      if (out[axis]) continue;
      const size = Number(shape[axis] || 0);
      const candidates = [];
      if (isSphereSizeValid(size)) candidates.push(INGEST_SPHERE_ALIAS_DIM);
      if (isPolSizeValid(size)) candidates.push("pol");
      candidates.push(...fallbackOrder);
      const chosen = pickUnusedDim(candidates, size, usedCanonical);
      if (!chosen) continue;
      out[axis] = chosen;
      usedCanonical.add(canonicalIngestDim(chosen));
    }
    return out.map((dim) => (dim ? String(dim).trim().toLowerCase() : dim));
  };

  if (selectedPaths.length > 1 && shape.length >= 1) {
    const stackAxis = ingestStackAxisForMapping(mapping);
    const baseRank = shape.length - 1;
    const baseShape = shape.slice(1).map((v) => Number(v || 0));
    const inferredBase = highConfidenceAxisAssignments(fileInfo, baseShape);
    const ordered = new Array(shape.length).fill(null);
    ordered[0] = canonicalIngestDim(stackAxis);
    const usedCanonical = new Set([canonicalIngestDim(stackAxis)]);
    for (let i = 0; i < baseRank; i += 1) {
      const axis = i + 1;
      const size = baseShape[i];
      const attrDim = String(dimsFromAttr[i] || "").trim().toLowerCase();
      const infDim = String(inferredBase[i] || "").trim().toLowerCase();
      const candidates = [];
      if (isSphereSizeValid(size)) candidates.push(INGEST_SPHERE_ALIAS_DIM);
      if (attrDim) candidates.push(attrDim);
      if (infDim) candidates.push(infDim);
      if (isPolSizeValid(size)) candidates.push("pol");
      candidates.push(...fallbackOrder);
      const chosen = pickUnusedDim(candidates, size, usedCanonical);
      if (!chosen) continue;
      ordered[axis] = chosen;
      usedCanonical.add(canonicalIngestDim(chosen));
    }
    return ordered.map((dim) => (dim ? String(dim).trim().toLowerCase() : dim));
  }

  const seeded = new Array(shape.length).fill(null);
  if (dimsFromAttr.length === shape.length) {
    for (let axis = 0; axis < shape.length; axis += 1) seeded[axis] = dimsFromAttr[axis];
  } else {
    const inferred = highConfidenceAxisAssignments(fileInfo, shape);
    for (let axis = 0; axis < shape.length; axis += 1) seeded[axis] = inferred[axis];
  }
  return fillUnknownAxes(seeded, 0);
}

function nextUnfilledSlot(mapping, startIndex = 0) {
  const dims = Array.isArray(mapping?.axisAssignments) ? mapping.axisAssignments : [];
  if (!dims.length) return -1;
  const start = clamp(Number(startIndex) || 0, 0, dims.length - 1);
  for (let i = start; i < dims.length; i += 1) {
    if (!dims[i]) return i;
  }
  for (let i = 0; i < start; i += 1) {
    if (!dims[i]) return i;
  }
  return -1;
}

function activeMapping() {
  if (!ingestWizard.mappings.length) return null;
  ingestWizard.activeFileIndex = clamp(ingestWizard.activeFileIndex, 0, ingestWizard.mappings.length - 1);
  return ingestWizard.mappings[ingestWizard.activeFileIndex] || null;
}

function ingestMappingValidationIssues(mapping, fileInfo) {
  const issues = [];
  const dimsRaw = Array.isArray(mapping?.axisAssignments) ? mapping.axisAssignments : [];
  const shape = ingestShapeForMapping(fileInfo, mapping);
  const selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
  if (ingestSupportsKeySelection(fileInfo) && selectedPaths.length < 1) {
    issues.push("select at least one data key");
    return issues;
  }
  if (selectedPaths.length > 1) {
    if (!shape.length) {
      issues.push("selected data keys must have matching shapes to stack");
    } else if (dimsRaw.length === shape.length && dimsRaw[0]) {
      const stackAxis = ingestStackAxisForMapping(mapping);
      const first = canonicalIngestDim(String(dimsRaw[0]));
      if (first !== stackAxis) {
        issues.push(`axis 0 must be assigned to key-stack axis '${stackAxis}'`);
      }
    }
  }
  if (!dimsRaw.length || dimsRaw.length !== shape.length) return issues;
  if (dimsRaw.some((dim) => !dim)) return issues;

  const canonicalDims = dimsRaw.map((dim) => canonicalIngestDim(String(dim)));
  const polAxis = canonicalDims.indexOf("pol");
  if (polAxis >= 0) {
    const polSize = Number(shape[polAxis] || 0);
    if (polSize !== 1 && polSize !== 3 && polSize !== 4) {
      issues.push(`pol axis size must be 1, 3, or 4 (got ${polSize})`);
    }
  }

  const sphereAxes = dimsRaw.reduce((out, dim, axis) => {
    if (dim === INGEST_SPHERE_ALIAS_DIM) out.push(axis);
    return out;
  }, []);
  if (sphereAxes.length > 1) {
    issues.push("only one sphere axis can be assigned per file");
  } else if (sphereAxes.length === 1) {
    const sphereAxis = sphereAxes[0];
    const npix = Number(shape[sphereAxis] || 0);
    const nside = healpixNsideFromNpix(npix);
    if (nside === null) {
      issues.push(`sphere axis requires HEALPix npix=12*nside^2 with power-of-two nside (got N=${npix})`);
    }
  }
  return issues;
}

function renderIntentDialogControls() {
  const files = ingestFiles();
  const multi = files.length > 1;
  if (els.ingestIntentAxisBtn) {
    const selected = ingestWizard.intent === "axis";
    els.ingestIntentAxisBtn.classList.toggle("isSelected", selected);
    els.ingestIntentAxisBtn.setAttribute("aria-pressed", selected ? "true" : "false");
    els.ingestIntentAxisBtn.disabled = !multi;
  }
  if (els.ingestIntentTabsBtn) {
    const selected = ingestWizard.intent !== "axis";
    els.ingestIntentTabsBtn.classList.toggle("isSelected", selected);
    els.ingestIntentTabsBtn.setAttribute("aria-pressed", selected ? "true" : "false");
    els.ingestIntentTabsBtn.disabled = !multi;
  }
  if (els.ingestIntentFileAxisFieldset) {
    els.ingestIntentFileAxisFieldset.hidden = !(multi && ingestWizard.intent === "axis");
  }

  const axisButtons = [
    els.ingestIntentFileAxisSampleBtn,
    els.ingestIntentFileAxisPolBtn,
    els.ingestIntentFileAxisTimeBtn,
    els.ingestIntentFileAxisFreqBtn,
  ];
  for (const btn of axisButtons) {
    if (!btn) continue;
    const dim = String(btn.dataset.fileAxis || "");
    const selected = dim === ingestWizard.fileAxis;
    btn.classList.toggle("isSelected", selected);
    btn.setAttribute("aria-pressed", selected ? "true" : "false");
    btn.disabled = !(multi && ingestWizard.intent === "axis");
    applyIngestAxisTheme(btn, dim);
  }
  if (els.ingestIntentFileAxisHint) {
    if (multi && ingestWizard.intent === "axis") {
      els.ingestIntentFileAxisHint.textContent =
        `Files will be combined along '${ingestWizard.fileAxis}' (new file identity axis).`;
    } else if (multi) {
      els.ingestIntentFileAxisHint.textContent = "Files will create separate datasets/tabs.";
    } else {
      els.ingestIntentFileAxisHint.textContent = "Single file import.";
    }
  }
}

function openIngestIntentDialog() {
  if (!els.ingestIntentDialog) return;
  setIngestStep("intent");
  renderIntentDialogControls();
  if (typeof els.ingestIntentDialog.showModal === "function" && !els.ingestIntentDialog.open) {
    els.ingestIntentDialog.showModal();
  }
}

function closeIngestIntentDialog() {
  if (!els.ingestIntentDialog?.open) return;
  els.ingestIntentDialog.close();
}

function setIngestKeysStatus(message, isError = false) {
  if (!els.ingestKeysStatus) return;
  els.ingestKeysStatus.textContent = message || "";
  els.ingestKeysStatus.classList.toggle("error", Boolean(isError));
}

function openIngestKeysDialog() {
  if (!els.ingestKeysDialog) return;
  setIngestStep("keys");
  renderIngestKeysDialog();
  if (typeof els.ingestKeysDialog.showModal === "function" && !els.ingestKeysDialog.open) {
    els.ingestKeysDialog.showModal();
  }
}

function closeIngestKeysDialog() {
  if (!els.ingestKeysDialog?.open) return;
  els.ingestKeysDialog.close();
}

function closeAllIngestDialogs() {
  closeIngestDialog();
  closeIngestKeysDialog();
  closeIngestIntentDialog();
}

function toggleIngestKeySelection(mapping, fileInfo, path, enabled) {
  const target = String(path || "").trim();
  if (!target || !mapping || !fileInfo) return;
  const current = ingestSelectedDatasetPaths(fileInfo, mapping);
  let next = [...current];
  if (enabled) {
    if (!next.includes(target)) next.push(target);
  } else {
    next = next.filter((row) => row !== target);
  }
  ingestSetSelectedDatasetPaths(mapping, fileInfo, next);
}

function renderIngestSelectedKeysList(fileInfo, mapping) {
  if (!els.ingestSelectedKeysList) return;
  els.ingestSelectedKeysList.innerHTML = "";
  const selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
  const candidateByPath = new Map(ingestDatasetCandidates(fileInfo).map((row) => [String(row.path || ""), row]));
  if (!selectedPaths.length) {
    const msg = document.createElement("div");
    msg.className = "ingestKeyEmpty";
    msg.textContent = "Select one or more keys.";
    els.ingestSelectedKeysList.appendChild(msg);
    return;
  }
  for (const path of selectedPaths) {
    const cand = candidateByPath.get(path);
    const item = document.createElement("div");
    item.className = "ingestKeyOrderItem";
    item.draggable = true;
    item.dataset.path = path;
    const shape = Array.isArray(cand?.shape) ? cand.shape.join("x") : "?";
    item.textContent = `${ingestDatasetCandidateLabel(cand || { path })} (${shape})`;
    item.addEventListener("dragstart", (ev) => {
      if (!ev.dataTransfer) return;
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", path);
      item.classList.add("isDragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("isDragging");
      for (const node of els.ingestSelectedKeysList.querySelectorAll(".ingestKeyOrderItem.isDragTarget")) {
        node.classList.remove("isDragTarget");
      }
    });
    item.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      item.classList.add("isDragTarget");
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("isDragTarget");
    });
    item.addEventListener("drop", (ev) => {
      ev.preventDefault();
      item.classList.remove("isDragTarget");
      const src = String(ev.dataTransfer?.getData("text/plain") || "");
      if (!src || src === path) return;
      if (!reorderIngestSelectedKeys(mapping, src, path)) return;
      normalizeIngestMappingForFile(fileInfo, mapping);
      renderIngestKeysDialog();
    });
    els.ingestSelectedKeysList.appendChild(item);
  }
  const tail = document.createElement("div");
  tail.className = "ingestKeyOrderTail";
  tail.textContent = "Drop here to move key to end";
  tail.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    tail.classList.add("isDragTarget");
  });
  tail.addEventListener("dragleave", () => {
    tail.classList.remove("isDragTarget");
  });
  tail.addEventListener("drop", (ev) => {
    ev.preventDefault();
    tail.classList.remove("isDragTarget");
    const src = String(ev.dataTransfer?.getData("text/plain") || "");
    if (!src) return;
    if (!reorderIngestSelectedKeys(mapping, src, "")) return;
    normalizeIngestMappingForFile(fileInfo, mapping);
    renderIngestKeysDialog();
  });
  els.ingestSelectedKeysList.appendChild(tail);
}

function renderIngestStokesQuickList(fileInfo, mapping) {
  if (!els.ingestStokesQuickList) return;
  els.ingestStokesQuickList.innerHTML = "";
  const stacks = ingestStokesStackCandidates(fileInfo);
  if (!stacks.length) {
    els.ingestStokesQuickList.hidden = true;
    return;
  }
  const selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
  const selected = new Set(selectedPaths);
  const stackAxis = selectedPaths.length > 1 ? ingestStackAxisForMapping(mapping) : "";
  let rendered = 0;
  for (const cand of stacks) {
    const memberPaths = ingestStokesMemberPathsFromCandidate(fileInfo, cand);
    if (memberPaths.length < 2) continue;
    rendered += 1;
    const selectedCount = memberPaths.reduce((count, path) => count + (selected.has(path) ? 1 : 0), 0);
    const allSelected = selectedCount === memberPaths.length;
    const isSelected = allSelected && stackAxis === "pol";
    const isPartial = selectedCount > 0 && !isSelected;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ingestKeyGroupBtn ingestKeyGroupBtn--stokes";
    btn.textContent = ingestStokesStackQuickLabel(cand, memberPaths);
    btn.classList.toggle("isSelected", isSelected);
    btn.classList.toggle("isPartial", isPartial);
    btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
    btn.addEventListener("click", () => {
      ingestSetSelectedDatasetPaths(mapping, fileInfo, memberPaths);
      mapping.keyStackAxis = "pol";
      normalizeIngestMappingForFile(fileInfo, mapping, { forceResetAxes: true });
      renderIngestKeysDialog();
    });
    els.ingestStokesQuickList.appendChild(btn);
  }
  els.ingestStokesQuickList.hidden = rendered === 0;
}

function renderIngestKeyGroupList(fileInfo, mapping) {
  if (!els.ingestKeyGroupList) return;
  els.ingestKeyGroupList.innerHTML = "";
  const groups = ingestDatasetPrefixGroups(fileInfo, mapping);
  if (!groups.length) {
    els.ingestKeyGroupList.hidden = true;
    return;
  }
  els.ingestKeyGroupList.hidden = false;
  const selected = new Set(ingestSelectedDatasetPaths(fileInfo, mapping));
  for (const group of groups) {
    const paths = [...group.paths];
    const selectedCount = paths.reduce((count, path) => count + (selected.has(path) ? 1 : 0), 0);
    const allSelected = selectedCount === paths.length;
    const partiallySelected = selectedCount > 0 && selectedCount < paths.length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ingestKeyGroupBtn";
    btn.textContent = `${group.prefix}/... (${paths.length})`;
    btn.classList.toggle("isSelected", allSelected);
    btn.classList.toggle("isPartial", partiallySelected);
    btn.setAttribute("aria-pressed", allSelected ? "true" : "false");
    btn.addEventListener("click", () => {
      const next = new Set(ingestSelectedDatasetPaths(fileInfo, mapping));
      if (allSelected) {
        for (const path of paths) next.delete(path);
      } else {
        for (const path of paths) next.add(path);
      }
      ingestSetSelectedDatasetPaths(mapping, fileInfo, [...next]);
      renderIngestKeysDialog();
    });
    els.ingestKeyGroupList.appendChild(btn);
  }
}

function renderIngestStackAxisButtons(mapping, { show = false } = {}) {
  if (!els.ingestKeysStackAxisButtons) return;
  const stackAxis = ingestStackAxisForMapping(mapping);
  const buttons = els.ingestKeysStackAxisButtons.querySelectorAll("button[data-stack-axis]");
  for (const btn of buttons) {
    const axis = String(btn.dataset.stackAxis || "");
    const selected = show && axis === stackAxis;
    btn.textContent = ingestAxisLabel(axis);
    btn.classList.toggle("isSelected", selected);
    btn.setAttribute("aria-pressed", selected ? "true" : "false");
    btn.disabled = !show;
    applyIngestAxisTheme(btn, axis);
  }
}

function renderIngestKeysDialog() {
  const files = ingestFiles();
  if (!files.length) return;
  const single = files.length <= 1;
  if (els.ingestKeysStepPills) els.ingestKeysStepPills.hidden = single;
  if (els.ingestKeysFileSelect) {
    els.ingestKeysFileSelect.innerHTML = "";
    for (let i = 0; i < files.length; i += 1) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = files[i].raw_input?.name || `File ${i + 1}`;
      els.ingestKeysFileSelect.appendChild(opt);
    }
    ingestWizard.activeFileIndex = clamp(ingestWizard.activeFileIndex, 0, files.length - 1);
    els.ingestKeysFileSelect.value = String(ingestWizard.activeFileIndex);
    if (els.ingestKeysFileLabel) {
      els.ingestKeysFileLabel.hidden = single;
      els.ingestKeysFileLabel.style.display = single ? "none" : "";
    }
  }

  const mapping = activeMapping();
  const fileInfo = files[ingestWizard.activeFileIndex];
  if (!mapping || !fileInfo) return;
  normalizeIngestMappingForFile(fileInfo, mapping);
  renderIngestStokesQuickList(fileInfo, mapping);
  renderIngestKeyGroupList(fileInfo, mapping);

  if (els.ingestKeyCandidatesList) {
    els.ingestKeyCandidatesList.innerHTML = "";
    const candidates = ingestDisplayDatasetCandidates(fileInfo, mapping);
    const selected = new Set(ingestSelectedDatasetPaths(fileInfo, mapping));
    if (!candidates.length) {
      const msg = document.createElement("div");
      msg.className = "ingestKeyEmpty";
      msg.textContent = "No candidate keys found for this file.";
      els.ingestKeyCandidatesList.appendChild(msg);
    } else {
      for (const cand of candidates) {
        const path = String(cand.path || "");
        const isSelected = selected.has(path);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "ingestKeyCandidateBtn";
        row.classList.toggle("isSelected", isSelected);
        row.setAttribute("aria-pressed", isSelected ? "true" : "false");
        row.addEventListener("click", () => {
          toggleIngestKeySelection(mapping, fileInfo, path, !isSelected);
          renderIngestKeysDialog();
        });

        const text = document.createElement("span");
        text.className = "ingestKeyCandidateTitle";
        text.textContent = ingestDatasetCandidateLabel(cand);
        row.appendChild(text);

        const detail = document.createElement("span");
        detail.className = "ingestKeyCandidateMeta";
        const shape = Array.isArray(cand.shape) ? cand.shape.join("x") : "?";
        const dims = Array.isArray(cand.dims_attr) && cand.dims_attr.length ? ` | dims=${cand.dims_attr.join(",")}` : "";
        const coord = cand.coordinate_like ? " | coord-like" : "";
        detail.textContent = `${shape}, ${cand.dtype || "?"}${dims}${coord}`;
        row.appendChild(detail);
        els.ingestKeyCandidatesList.appendChild(row);
      }
    }
  }

  renderIngestSelectedKeysList(fileInfo, mapping);

  const selectedCount = ingestSelectedDatasetPaths(fileInfo, mapping).length;
  if (els.ingestKeysStackAxisLabel) {
    const show = selectedCount > 1;
    els.ingestKeysStackAxisLabel.hidden = !show;
    renderIngestStackAxisButtons(mapping, { show });
  }
  if (els.ingestKeysBackBtn) {
    els.ingestKeysBackBtn.hidden = single;
    els.ingestKeysBackBtn.disabled = single;
  }
  if (els.ingestKeysContinueBtn) {
    const needsSelection = ingestSupportsKeySelection(fileInfo);
    const blocked = needsSelection && selectedCount < 1;
    els.ingestKeysContinueBtn.disabled = blocked;
  }
  setIngestKeysStatus(
    selectedCount > 1
      ? `Stacking ${selectedCount} keys. Drag selected items to set stack order.`
      : "Select one or more keys to continue."
  );
}

function propagateIngestKeySelectionToCompatibleFiles({ onlyMissing = true } = {}) {
  const files = ingestFiles();
  if (files.length <= 1) return 0;
  const current = activeMapping();
  const currentFile = files[ingestWizard.activeFileIndex];
  if (!current || !currentFile) return 0;

  const selectedPaths = ingestSelectedDatasetPaths(currentFile, current);
  if (!selectedPaths.length) return 0;
  const stackAxis = selectedPaths.length > 1 ? ingestStackAxisForMapping(current) : null;
  let applied = 0;

  for (const mapping of ingestWizard.mappings) {
    if (!mapping || mapping === current) continue;
    const fileInfo = files.find((row) => String(row?.raw_input?.id || "") === String(mapping.raw_input_id || ""));
    if (!fileInfo || !ingestSupportsKeySelection(fileInfo)) continue;
    const targetPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
    if (onlyMissing && targetPaths.length) continue;
    const resolvedPaths = ingestResolveDatasetSelectionForFile(fileInfo, selectedPaths, {
      stackAxis,
      allowDefaultFallback: true,
    });
    if (!resolvedPaths.length) continue;
    mapping.datasetPaths = [...resolvedPaths];
    mapping.datasetPath = resolvedPaths[0];
    mapping.keyStackAxis = resolvedPaths.length > 1 ? stackAxis : null;
    normalizeIngestMappingForFile(fileInfo, mapping);
    applied += 1;
  }
  return applied;
}

function applyDroppedAxis(mapping, targetAxis, payload) {
  if (!mapping || !Array.isArray(mapping.axisAssignments)) return;
  ensureIngestAssignmentConfirmed(mapping, mapping.axisAssignments.length);
  const target = clamp(targetAxis, 0, mapping.axisAssignments.length - 1);
  const dim = String(payload?.dim || "");
  if (!INGEST_UI_DIMS.includes(dim)) return;
  const canonicalDim = canonicalIngestDim(dim);

  const sourceType = String(payload?.sourceType || "palette");
  const sourceAxis = Number(payload?.sourceAxis);
  if (sourceType === "slot" && Number.isInteger(sourceAxis)) {
    const src = clamp(sourceAxis, 0, mapping.axisAssignments.length - 1);
    if (src === target) return;
    const sourceDim = mapping.axisAssignments[src];
    if (!sourceDim) return;
    mapping.axisAssignments[target] = sourceDim;
    mapping.axisAssignments[src] = null;
    setIngestAxisAssignmentConfirmed(mapping, target, true);
    setIngestAxisAssignmentConfirmed(mapping, src, false);
    return;
  }

  const existingIdx = mapping.axisAssignments.findIndex((value) => canonicalIngestDim(value) === canonicalDim);
  mapping.axisAssignments[target] = dim;
  setIngestAxisAssignmentConfirmed(mapping, target, true);
  if (existingIdx >= 0 && existingIdx !== target) {
    mapping.axisAssignments[existingIdx] = null;
    setIngestAxisAssignmentConfirmed(mapping, existingIdx, false);
  }
}

function unassignedIngestDims(mapping, { excludeDims = [] } = {}) {
  const assigned = new Set(
    (Array.isArray(mapping?.axisAssignments) ? mapping.axisAssignments : [])
      .filter((value) => INGEST_UI_DIMS.includes(value))
      .map((value) => canonicalIngestDim(value))
  );
  for (const dim of excludeDims) {
    const canonical = canonicalIngestDim(String(dim || ""));
    if (canonical) assigned.add(canonical);
  }
  return INGEST_UI_DIMS.filter((dim) => !assigned.has(canonicalIngestDim(dim)));
}

function clearIngestDragTargets() {
  if (els.ingestPalette) els.ingestPalette.classList.remove("isDragTarget");
  if (!els.ingestSlotStrip) return;
  for (const node of els.ingestSlotStrip.querySelectorAll(".ingestSlotCard.isDragTarget")) {
    node.classList.remove("isDragTarget");
  }
}

function makeIngestVacancyBlock(sourceBlock) {
  const ghost = sourceBlock.cloneNode(true);
  ghost.disabled = true;
  ghost.draggable = false;
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("ingestAxisVacancy");
  return ghost;
}

function collapseIngestDragVacancy() {
  const ghost = ingestAxisDrag.vacancyBlock;
  if (!ghost || ingestAxisDrag.vacancyCollapsed) return;
  ingestAxisDrag.vacancyCollapsed = true;
  ghost.classList.add("isCollapsed");
}

function ingestDropTargetFromPoint(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit) return null;
  const slot = hit.closest?.(".ingestSlotCard[data-axis]");
  if (slot && els.ingestSlotStrip?.contains(slot)) {
    const axis = Number.parseInt(slot.dataset.axis || "", 10);
    if (Number.isInteger(axis)) return { type: "slot", axis, slotEl: slot };
  }
  if (els.ingestPalette && (hit === els.ingestPalette || els.ingestPalette.contains(hit))) {
    return { type: "palette" };
  }
  return null;
}

function setIngestDragTarget(target) {
  clearIngestDragTargets();
  if (!target) return;
  if (target.type === "slot" && target.slotEl) {
    target.slotEl.classList.add("isDragTarget");
    return;
  }
  if (target.type === "palette" && els.ingestPalette) {
    els.ingestPalette.classList.add("isDragTarget");
  }
}

function dropIngestAxisAtPointer(clientX, clientY) {
  const mapping = activeMapping();
  const payload = ingestAxisDrag.payload;
  if (!mapping || !payload || !Array.isArray(mapping.axisAssignments)) return false;
  const target = ingestDropTargetFromPoint(clientX, clientY);
  if (!target) return false;
  if (target.type === "slot") {
    applyDroppedAxis(mapping, target.axis, payload);
    return true;
  }
  if (target.type === "palette") {
    const sourceType = String(payload.sourceType || "palette");
    if (sourceType !== "slot") return false;
    const sourceAxis = Number(payload.sourceAxis);
    if (!Number.isInteger(sourceAxis)) return false;
    const src = clamp(sourceAxis, 0, mapping.axisAssignments.length - 1);
    if (!mapping.axisAssignments[src]) return false;
    mapping.axisAssignments[src] = null;
    setIngestAxisAssignmentConfirmed(mapping, src, false);
    return true;
  }
  return false;
}

function onIngestAxisPointerMove(ev) {
  if (!ingestAxisDrag.activeBlock) return;
  if (ingestAxisDrag.pointerId !== null && ev.pointerId !== ingestAxisDrag.pointerId) return;
  ev.preventDefault();
  updateIngestAxisDrag(ev);
  setIngestDragTarget(ingestDropTargetFromPoint(Number(ev.clientX), Number(ev.clientY)));
}

function onIngestAxisPointerUp(ev) {
  if (!ingestAxisDrag.activeBlock) return;
  if (ingestAxisDrag.pointerId !== null && ev.pointerId !== ingestAxisDrag.pointerId) return;
  ev.preventDefault();
  const changed = dropIngestAxisAtPointer(Number(ev.clientX), Number(ev.clientY));
  endIngestAxisDrag();
  if (changed) renderIngestMappingStep();
}

function onIngestAxisPointerCancel(ev) {
  if (!ingestAxisDrag.activeBlock) return;
  if (ingestAxisDrag.pointerId !== null && ev.pointerId !== ingestAxisDrag.pointerId) return;
  endIngestAxisDrag();
}

function startIngestAxisDrag(block, ev, payload) {
  endIngestAxisDrag();
  const rect = block.getBoundingClientRect();
  const startX = Number(ev.clientX);
  const startY = Number(ev.clientY);
  const useEventPoint = Number.isFinite(startX) && Number.isFinite(startY) && !(startX === 0 && startY === 0);
  const pointerX = useEventPoint ? startX : rect.left + rect.width / 2;
  const pointerY = useEventPoint ? startY : rect.top + rect.height / 2;
  ingestAxisDrag.activeBlock = block;
  ingestAxisDrag.payload = payload;
  ingestAxisDrag.pointerId = Number.isFinite(ev.pointerId) ? ev.pointerId : null;
  ingestAxisDrag.pointerDx = Math.max(0, pointerX - rect.left);
  ingestAxisDrag.pointerDy = Math.max(0, pointerY - rect.top);
  ingestAxisDrag.sourceZone = block.parentElement || null;
  ingestAxisDrag.vacancyCollapsed = false;
  if (ingestAxisDrag.sourceZone) {
    ingestAxisDrag.sourceZone.classList.add("isVacating");
    const vacancy = makeIngestVacancyBlock(block);
    ingestAxisDrag.sourceZone.insertBefore(vacancy, block);
    ingestAxisDrag.vacancyBlock = vacancy;
  }
  block.classList.add("isDragging");
  block.style.width = `${Math.round(rect.width)}px`;
  block.style.height = `${Math.round(rect.height)}px`;
  block.style.left = `${Math.round(rect.left)}px`;
  block.style.top = `${Math.round(rect.top)}px`;
  if (ingestAxisDrag.pointerId !== null && typeof block.setPointerCapture === "function") {
    try {
      block.setPointerCapture(ingestAxisDrag.pointerId);
    } catch (_) {
      // ignore capture failures
    }
  }
  window.addEventListener("pointermove", onIngestAxisPointerMove, { capture: true });
  window.addEventListener("pointerup", onIngestAxisPointerUp, { capture: true });
  window.addEventListener("pointercancel", onIngestAxisPointerCancel, { capture: true });
  updateIngestAxisDrag(ev);
  setIngestDragTarget(ingestDropTargetFromPoint(pointerX, pointerY));
  document.body.classList.add("isIngestAxisDragging");
}

function updateIngestAxisDrag(ev) {
  const block = ingestAxisDrag.activeBlock;
  if (!block) return;
  const x = Number(ev.clientX);
  const y = Number(ev.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (x === 0 && y === 0) return;
  block.style.left = `${Math.round(x - ingestAxisDrag.pointerDx)}px`;
  block.style.top = `${Math.round(y - ingestAxisDrag.pointerDy)}px`;
}

function endIngestAxisDrag() {
  const block = ingestAxisDrag.activeBlock;
  const pointerId = ingestAxisDrag.pointerId;
  const sourceZone = ingestAxisDrag.sourceZone;
  const vacancy = ingestAxisDrag.vacancyBlock;
  ingestAxisDrag.activeBlock = null;
  ingestAxisDrag.payload = null;
  ingestAxisDrag.pointerId = null;
  ingestAxisDrag.pointerDx = 0;
  ingestAxisDrag.pointerDy = 0;
  ingestAxisDrag.sourceZone = null;
  ingestAxisDrag.vacancyBlock = null;
  ingestAxisDrag.vacancyCollapsed = false;
  window.removeEventListener("pointermove", onIngestAxisPointerMove, true);
  window.removeEventListener("pointerup", onIngestAxisPointerUp, true);
  window.removeEventListener("pointercancel", onIngestAxisPointerCancel, true);
  if (block) {
    if (pointerId !== null && typeof block.releasePointerCapture === "function") {
      try {
        block.releasePointerCapture(pointerId);
      } catch (_) {
        // ignore release failures
      }
    }
    block.classList.remove("isDragging");
    block.style.left = "";
    block.style.top = "";
    block.style.width = "";
    block.style.height = "";
  }
  if (vacancy && vacancy.parentElement) vacancy.parentElement.removeChild(vacancy);
  if (sourceZone) sourceZone.classList.remove("isVacating");
  document.body.classList.remove("isIngestAxisDragging");
  clearIngestDragTargets();
}

function makeIngestAxisBlock(
  dim,
  { sourceType = "palette", sourceAxis = -1, palette = false, fileAxis = null, keyAxis = null, draggable = true, prefilled = false } = {}
) {
  const block = document.createElement("button");
  block.type = "button";
  block.className = "ingestAxisBlock";
  if (palette) block.classList.add("isPalette");
  if (prefilled) block.classList.add("isPrefilled");
  const canonical = canonicalIngestDim(String(dim));
  if (fileAxis && canonical === fileAxis) block.classList.add("isFileAxis");
  if (keyAxis && canonical === keyAxis) block.classList.add("isKeyAxis");
  if (!draggable) block.classList.add("isLocked");
  applyIngestAxisTheme(block, canonical);
  block.textContent = ingestAxisLabel(dim);
  block.title = ingestAxisLabel(dim);
  block.dataset.dim = String(dim || "");
  block.draggable = false;
  if (draggable) {
    block.addEventListener("selectstart", (ev) => {
      ev.preventDefault();
    });
    block.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 && ev.pointerType !== "touch" && ev.pointerType !== "pen") return;
      ev.preventDefault();
      const sel = window.getSelection?.();
      if (sel && typeof sel.removeAllRanges === "function") sel.removeAllRanges();
      startIngestAxisDrag(block, ev, { dim, sourceType, sourceAxis });
    });
  } else {
    block.setAttribute("aria-disabled", "true");
  }
  return block;
}

function renderFileSelectorControls() {
  const files = ingestFiles();
  if (!els.ingestActiveFileSelect) return;
  els.ingestActiveFileSelect.innerHTML = "";
  for (let i = 0; i < files.length; i += 1) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = files[i].raw_input?.name || `File ${i + 1}`;
    els.ingestActiveFileSelect.appendChild(opt);
  }
  if (files.length) {
    ingestWizard.activeFileIndex = clamp(ingestWizard.activeFileIndex, 0, files.length - 1);
    els.ingestActiveFileSelect.value = String(ingestWizard.activeFileIndex);
  }
  const multi = files.length > 1;
  if (els.ingestActiveFileLabel) {
    els.ingestActiveFileLabel.hidden = !multi;
    els.ingestActiveFileLabel.style.display = multi ? "" : "none";
  }
  if (els.ingestPrevFileBtn) els.ingestPrevFileBtn.disabled = !multi;
  if (els.ingestNextFileBtn) els.ingestNextFileBtn.disabled = !multi;
  if (els.ingestApplyToAllBtn) {
    const show = multi && ingestWizard.intent === "tabs";
    els.ingestApplyToAllBtn.hidden = !show;
    els.ingestApplyToAllBtn.disabled = !show;
  }
}

function renderIngestInspectStep() {
  if (!ingestWizard.inspection) return;
  const files = ingestFiles();
  if (els.ingestInspectSummary) {
    els.ingestInspectSummary.textContent = `Parsed ${files.length} file(s). Review inferred mappings before building plan.`;
  }
  if (els.ingestInspectWarnings) {
    els.ingestInspectWarnings.innerHTML = "";
    const warnings = Array.isArray(ingestWizard.inspection.global_warnings) ? ingestWizard.inspection.global_warnings : [];
    for (const warning of warnings) {
      const row = document.createElement("div");
      row.textContent = warning;
      els.ingestInspectWarnings.appendChild(row);
    }
  }
  if (els.ingestInspectFiles) {
    els.ingestInspectFiles.innerHTML = "";
    for (const file of files) {
      const item = document.createElement("div");
      item.className = "ingestFileRow";

      const title = document.createElement("div");
      title.className = "ingestFileTitle";
      title.textContent = file.raw_input?.name || file.raw_input?.id || "input";
      item.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "ingestFileMeta";
      const selectedPath = String(file?.parsed?.format_metadata?.dataset_path || "");
      const candidateCount = ingestDatasetCandidates(file).length;
      const selectedCandidate = ingestDatasetCandidates(file).find((row) => String(row.path || "") === selectedPath);
      const formatName = String(file?.raw_input?.format || "").toLowerCase();
      const keyMeta =
        formatName === "hdf5" || formatName === "npz"
          ? ` | key=${selectedCandidate ? ingestDatasetCandidateLabel(selectedCandidate) : selectedPath || "?"}${
              candidateCount > 1 ? ` (${candidateCount} candidates)` : ""
            }`
          : "";
      meta.textContent =
        `format=${file.raw_input?.format || "unknown"} | shape=${(file.parsed?.shape || []).join("x")} | ` +
        `inferred dims=${(file.recommended_dims || []).join(", ")}${keyMeta}`;
      item.appendChild(meta);

      const conf = document.createElement("div");
      conf.className = "ingestFileMeta";
      conf.textContent = `confidence: ${ingestConfidenceLabel(file)}`;
      item.appendChild(conf);

      els.ingestInspectFiles.appendChild(item);
    }
  }
}

function renderIngestMappingStep() {
  if (!ingestWizard.inspection) return;
  const files = ingestFiles();
  renderFileSelectorControls();

  const mapping = activeMapping();
  const fileInfo = files[ingestWizard.activeFileIndex];
  if (!mapping || !fileInfo) return;
  normalizeIngestMappingForFile(fileInfo, mapping);
  ensureIngestAssignmentConfirmed(mapping, mapping.axisAssignments.length);
  if (els.ingestStepPills) els.ingestStepPills.hidden = files.length <= 1;
  if (els.ingestBackBtn) {
    const canGoBack = ingestHasKeySelectionStep();
    els.ingestBackBtn.hidden = !canGoBack;
    els.ingestBackBtn.disabled = !canGoBack;
  }
  const validationIssues = ingestMappingValidationIssues(mapping, fileInfo);
  if (els.ingestMapperBoard) els.ingestMapperBoard.hidden = false;

  if (els.ingestSlotStrip) {
    els.ingestSlotStrip.innerHTML = "";
    const shape = ingestShapeForMapping(fileInfo, mapping);
    const includeFileAxisSlot = files.length > 1 && ingestWizard.intent === "axis";
    const fileAxis = files.length > 1 && ingestWizard.intent === "axis" ? canonicalIngestDim(ingestWizard.fileAxis) : null;
    const selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
    const keyAxis = selectedPaths.length > 1 ? ingestStackAxisForMapping(mapping) : null;
    const displaySlots = [];
    if (includeFileAxisSlot && fileAxis) {
      displaySlots.push({
        finalAxis: 0,
        sourceAxis: -1,
        size: files.length,
        assigned: fileAxis,
        locked: true,
        lockReason: "file identity",
        prefilled: !Boolean(mapping.fileAxisConfirmed),
      });
    }
    for (let axis = 0; axis < shape.length; axis += 1) {
      const assigned = mapping.axisAssignments[axis] || "";
      const assignedCanonical = assigned ? canonicalIngestDim(String(assigned)) : "";
      const lockAsKeyAxis = Boolean(keyAxis && axis === 0 && assignedCanonical === keyAxis);
      const confirmed = isIngestAxisAssignmentConfirmed(mapping, axis);
      displaySlots.push({
        finalAxis: axis + (includeFileAxisSlot ? 1 : 0),
        sourceAxis: axis,
        size: shape[axis],
        assigned,
        locked: lockAsKeyAxis,
        lockReason: lockAsKeyAxis ? "key stack" : "",
        prefilled: Boolean(assigned) && !confirmed,
      });
    }
    for (const slotDef of displaySlots) {
      const slot = document.createElement("div");
      slot.className = "ingestSlotCard";
      if (!slotDef.locked) slot.dataset.axis = String(slotDef.sourceAxis);
      if (slotDef.locked) slot.classList.add("isLocked");
      const assigned = slotDef.assigned;
      slot.classList.toggle("isFilled", Boolean(assigned));
      slot.classList.toggle("isPrefilled", Boolean(slotDef.prefilled));
      const assignedCanonical = assigned ? canonicalIngestDim(String(assigned)) : "";
      slot.classList.toggle("isFileAxisHint", Boolean(fileAxis && assignedCanonical === fileAxis));
      slot.classList.toggle("isKeyAxisHint", Boolean(keyAxis && assignedCanonical === keyAxis));
      applyIngestAxisTheme(slot, assignedCanonical);

      const label = document.createElement("div");
      label.className = "ingestSlotLabel";
      const labelMain = document.createElement("span");
      labelMain.className = "ingestSlotLabelMain";
      labelMain.textContent = `Axis ${slotDef.finalAxis}`;
      const labelMeta = document.createElement("span");
      labelMeta.className = "ingestSlotLabelMeta";
      labelMeta.textContent = slotDef.lockReason ? `N=${slotDef.size} • ${slotDef.lockReason}` : `N=${slotDef.size}`;
      label.appendChild(labelMain);
      label.appendChild(labelMeta);
      slot.appendChild(label);

      const zone = document.createElement("div");
      zone.className = "ingestSlotDropZone";
      zone.classList.toggle("isPrefilled", Boolean(slotDef.prefilled));
      if (assigned) {
        zone.appendChild(
          makeIngestAxisBlock(assigned, {
            sourceType: slotDef.locked ? "fixed" : "slot",
            sourceAxis: slotDef.sourceAxis,
            palette: false,
            fileAxis,
            keyAxis,
            draggable: !slotDef.locked,
            prefilled: Boolean(slotDef.prefilled),
          })
        );
      } else {
        const empty = document.createElement("span");
        empty.className = "ingestSlotLabel";
        empty.textContent = "Drop axis";
        zone.appendChild(empty);
      }
      slot.appendChild(zone);
      if (slotDef.prefilled && assigned) {
        slot.title = "Click to confirm this prefilled assignment";
        slot.addEventListener("click", () => {
          if (ingestAxisDrag.activeBlock) return;
          if (slotDef.sourceAxis >= 0) setIngestAxisAssignmentConfirmed(mapping, slotDef.sourceAxis, true);
          else mapping.fileAxisConfirmed = true;
          renderIngestMappingStep();
        });
      }

      els.ingestSlotStrip.appendChild(slot);
    }
  }

  if (els.ingestPalette) {
    els.ingestPalette.innerHTML = "";
    const fileAxis = files.length > 1 && ingestWizard.intent === "axis" ? canonicalIngestDim(ingestWizard.fileAxis) : null;
    const paletteDims = unassignedIngestDims(mapping, { excludeDims: fileAxis ? [fileAxis] : [] });
    els.ingestPalette.classList.toggle("isEmpty", !paletteDims.length);
    const keyAxis = ingestSelectedDatasetPaths(fileInfo, mapping).length > 1 ? ingestStackAxisForMapping(mapping) : null;
    for (const dim of paletteDims) {
      els.ingestPalette.appendChild(
        makeIngestAxisBlock(dim, {
          sourceType: "palette",
          sourceAxis: -1,
          palette: true,
          fileAxis,
          keyAxis,
        })
      );
    }
  }

  if (els.ingestMapperLegend) {
    const selectedKey = ingestSelectedDatasetCandidate(fileInfo, mapping);
    const selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
    const next = nextUnfilledSlot(mapping, 0);
    const axisOffset = files.length > 1 && ingestWizard.intent === "axis" ? 1 : 0;
    const nextTxt = next >= 0 ? `next empty axis label: Axis ${next + axisOffset}` : "all axis labels filled";
    const combineTxt =
      files.length > 1 && ingestWizard.intent === "axis" ? ` | file-axis (${ingestAxisLabel(ingestWizard.fileAxis)}) prefilled` : "";
    const keyTxt =
      selectedPaths.length > 1
        ? ` | key-stack axis (${ingestAxisLabel(ingestStackAxisForMapping(mapping))}), keys=${selectedPaths.length}`
        : selectedKey
          ? ` | data key: ${ingestDatasetCandidateLabel(selectedKey)}`
          : "";
    const validationTxt = validationIssues.length ? ` | validation: ${validationIssues[0]}` : "";
    els.ingestMapperLegend.textContent =
      `Drag axes into labels. Drag assigned axes between labels or back to Axes to unassign (${nextTxt}).${combineTxt}${keyTxt}${validationTxt}`;
    els.ingestMapperLegend.classList.toggle("hasError", validationIssues.length > 0);
  }

  if (els.ingestPresetRow && els.ingestPresetLabel) {
    const presets = Array.isArray(ingestWizard.inspection.preset_suggestions)
      ? ingestWizard.inspection.preset_suggestions
      : [];
    if (!presets.length) {
      els.ingestPresetRow.hidden = true;
    } else {
      const top = presets[0];
      els.ingestPresetRow.hidden = false;
      const isApplied = ingestWizard.selectedPresetId && ingestWizard.selectedPresetId === top.preset_id;
      const verb = isApplied ? "Applied preset" : "Suggested preset";
      els.ingestPresetLabel.textContent = `${verb}: ${top.name} (${Number(top.confidence || 0).toFixed(2)})`;
    }
  }
}

function renderIngestPreviewStep() {
  const plan = ingestWizard.plan;
  if (!plan) return;
  if (els.ingestPreviewSummary) {
    els.ingestPreviewSummary.textContent = plan.is_valid
      ? "Plan is valid. Commit will materialize datasets and tabs."
      : "Plan has strict validation errors. Resolve mapping/grouping first.";
  }

  if (els.ingestPreviewDatasets) {
    els.ingestPreviewDatasets.innerHTML = "";
    const datasets = Array.isArray(plan.datasets) ? plan.datasets : [];
    for (const ds of datasets) {
      const row = document.createElement("div");
      row.className = "ingestPreviewItem";
      row.textContent =
        `${ds.dataset_id} | shape=${(ds.projected_shape || []).join("x")} | ` +
        `sources=${(ds.source_input_ids || []).length}`;
      els.ingestPreviewDatasets.appendChild(row);
    }
  }

  if (els.ingestPreviewWarnings) {
    els.ingestPreviewWarnings.innerHTML = "";
    const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
    for (const warning of warnings) {
      const row = document.createElement("div");
      row.textContent = warning;
      els.ingestPreviewWarnings.appendChild(row);
    }
  }

  if (els.ingestPreviewErrors) {
    els.ingestPreviewErrors.innerHTML = "";
    const errors = Array.isArray(plan.errors) ? plan.errors : [];
    for (const err of errors) {
      const row = document.createElement("div");
      row.textContent = err;
      els.ingestPreviewErrors.appendChild(row);
    }
  }
}

function applySuggestedPreset({ silent = false, render = true } = {}) {
  if (!ingestWizard.inspection) return;
  const presets = Array.isArray(ingestWizard.inspection.preset_suggestions)
    ? ingestWizard.inspection.preset_suggestions
    : [];
  if (!presets.length) return false;
  const preset = presets[0];
  ingestWizard.selectedPresetId = preset.preset_id || null;
  const mode = String(preset.default_grouping_mode || "separate");
  if (mode === "separate") {
    ingestWizard.intent = "tabs";
  } else {
    ingestWizard.intent = "axis";
    ingestWizard.fileAxis = fileAxisFromGrouping(mode);
  }
  for (const mapping of ingestWizard.mappings) {
    if (Array.isArray(preset.default_dims) && preset.default_dims.length === mapping.axisAssignments.length) {
      mapping.axisAssignments = [...preset.default_dims];
      mapping.axisAssignmentsConfirmed = new Array(mapping.axisAssignments.length).fill(false);
      mapping.fileAxisConfirmed = false;
    }
  }
  if (render) renderIngestMappingStep();
  if (!silent) setIngestStatus(`Applied preset '${preset.name}'.`);
  return true;
}

function openIngestDialog() {
  if (!els.ingestDialog) return;
  setIngestStep("map");
  if (typeof els.ingestDialog.showModal === "function") {
    if (!els.ingestDialog.open) els.ingestDialog.showModal();
  }
}

function closeIngestDialog() {
  if (!els.ingestDialog?.open) return;
  endIngestAxisDrag();
  els.ingestDialog.close();
}

async function startIngestInspect({ paths = [], files = [] } = {}) {
  resetIngestWizardState();
  closeAllIngestDialogs();
  setIngestStatus("Inspecting inputs...");
  setIngestStep("intent");
  try {
    const body = new FormData();
    if (Array.isArray(paths) && paths.length) {
      body.append("paths_json", JSON.stringify(paths));
    }
    for (const file of files) {
      body.append("files", file, file.name || "dataset");
    }
    const inspection = await fetchJson("/api/ingest/inspect", { method: "POST", body });
    ingestWizard.inspection = inspection;
    const defaults = defaultIntentFromInspection(inspection);
    ingestWizard.intent = defaults.intent;
    ingestWizard.fileAxis = defaults.fileAxis;
    ingestWizard.mappings = ingestFiles().map((file) => {
      const selectedPaths = ingestShouldAutoselectDatasets(file) ? ingestDefaultDatasetSelectionPaths(file) : [];
      const mapping = {
        raw_input_id: file.raw_input?.id,
        datasetPath: selectedPaths[0] || null,
        datasetPaths: [...selectedPaths],
        keyStackAxis: null,
        axisAssignments: [],
        axisAssignmentsConfirmed: [],
        fileAxisConfirmed: false,
      };
      normalizeIngestMappingForFile(file, mapping, { forceResetAxes: true });
      return mapping;
    });
    ingestWizard.activeFileIndex = 0;
    const inspectedFiles = ingestFiles();
    const isSingleFile = inspectedFiles.length <= 1;
    const activeFile = inspectedFiles[ingestWizard.activeFileIndex] || null;
    const activeFormat = String(activeFile?.raw_input?.format || "").toLowerCase();
    const needsHdf5KeySelection = activeFormat === "hdf5";
    const autoPresetApplied = isSingleFile ? false : applySuggestedPreset({ silent: true, render: false });

    if (isSingleFile) {
      ingestWizard.intent = "tabs";
      if (needsHdf5KeySelection) {
        setIngestStep("keys");
        openIngestKeysDialog();
      } else {
        setIngestStep("map");
        openIngestDialog();
        renderIngestMappingStep();
      }
    } else {
      renderIntentDialogControls();
      openIngestIntentDialog();
    }
    if (autoPresetApplied) setIngestStatus(`Applied suggested preset.`);
    else setIngestStatus("");
    return inspection;
  } catch (err) {
    const message = formatIngestWizardError(err, "Inspect failed.");
    setIngestStatus(`Inspect failed: ${message}`, true);
    setSystemPickerStatus(`Inspect failed: ${message}`, true);
    return null;
  }
}

function buildIngestPlanDecision() {
  if (!ingestWizard.inspection) throw new Error("No inspection session is active.");
  propagateIngestKeySelectionToCompatibleFiles({ onlyMissing: true });
  const files = ingestFiles();
  const fileByInputId = new Map(files.map((file) => [String(file.raw_input?.id || ""), file]));
  const isMulti = files.length > 1;
  const fileMappings = [];
  for (const mapping of ingestWizard.mappings) {
    const fileInfo = fileByInputId.get(String(mapping.raw_input_id || ""));
    if (!fileInfo) throw new Error(`Unknown file mapping '${mapping.raw_input_id}'.`);
    normalizeIngestMappingForFile(fileInfo, mapping);
    let dimsRaw = Array.isArray(mapping.axisAssignments) ? mapping.axisAssignments : [];
    let selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
    if (ingestSupportsKeySelection(fileInfo) && selectedPaths.length < 1) {
      const fallbackPaths = ingestResolveDatasetSelectionForFile(fileInfo, [], { allowDefaultFallback: true });
      if (fallbackPaths.length) {
        ingestSetSelectedDatasetPaths(mapping, fileInfo, fallbackPaths);
        normalizeIngestMappingForFile(fileInfo, mapping);
        dimsRaw = Array.isArray(mapping.axisAssignments) ? mapping.axisAssignments : [];
        selectedPaths = ingestSelectedDatasetPaths(fileInfo, mapping);
      }
    }
    if (ingestSupportsKeySelection(fileInfo) && selectedPaths.length < 1) {
      throw new Error(`'${fileInfo?.raw_input?.name || mapping.raw_input_id}': select at least one data key.`);
    }
    if (!dimsRaw.length || dimsRaw.some((dim) => !dim)) throw new Error("One or more files are missing axis assignments.");
    for (const dim of dimsRaw) {
      if (!INGEST_UI_DIMS.includes(dim)) {
        throw new Error(`Invalid axis assignment '${dim}'.`);
      }
    }
    const dims = dimsRaw.map((dim) => canonicalIngestDim(String(dim)));
    if (new Set(dims).size !== dims.length) {
      throw new Error("Duplicate axis assignment detected within a file.");
    }

    const shape = ingestShapeForMapping(fileInfo, mapping);
    if (selectedPaths.length > 1) {
      if (!shape.length) {
        throw new Error(`'${fileInfo?.raw_input?.name || mapping.raw_input_id}': selected data keys must share the same shape.`);
      }
      const stackAxis = ingestStackAxisForMapping(mapping);
      if (!dimsRaw.length || canonicalIngestDim(String(dimsRaw[0] || "")) !== stackAxis) {
        throw new Error(`'${fileInfo?.raw_input?.name || mapping.raw_input_id}': axis 0 must be assigned to key-stack axis '${stackAxis}'.`);
      }
    }
    if (shape.length && dimsRaw.length !== shape.length) {
      const name = fileInfo?.raw_input?.name || mapping.raw_input_id;
      throw new Error(`'${name}': selected data key rank (${shape.length}) does not match assigned axes (${dimsRaw.length}).`);
    }
    if (shape.length === dimsRaw.length) {
      const polAxis = dims.indexOf("pol");
      if (polAxis >= 0) {
        const polSize = Number(shape[polAxis] || 0);
        if (polSize !== 1 && polSize !== 3 && polSize !== 4) {
          throw new Error(`'${fileInfo?.raw_input?.name || mapping.raw_input_id}': pol axis size must be 1, 3, or 4 (got ${polSize}).`);
        }
      }
    }

    const sphereAxis = dimsRaw.findIndex((dim) => dim === INGEST_SPHERE_ALIAS_DIM);
    if (sphereAxis >= 0) {
      const npix = Number(shape[sphereAxis] || 0);
      const nside = healpixNsideFromNpix(npix);
      if (nside === null) {
        throw new Error(
          `'${fileInfo?.raw_input?.name || mapping.raw_input_id}': sphere axis requires HEALPix npix=12*nside^2 with power-of-two nside (got N=${npix}).`
        );
      }
    }

    const mappingPayload = {
      raw_input_id: mapping.raw_input_id,
      dims,
      ignore: false,
    };
    if (selectedPaths.length) {
      mappingPayload.dataset_path = selectedPaths.length > 1 ? ingestHdf5StackToken(selectedPaths) : selectedPaths[0];
      mappingPayload.dataset_paths = [...selectedPaths];
    }
    if (selectedPaths.length > 1) {
      mappingPayload.key_stack_axis = ingestStackAxisForMapping(mapping);
    }
    if (sphereAxis >= 0) mappingPayload.sphere_axis = sphereAxis;
    fileMappings.push(mappingPayload);
  }

  const groupingMode = isMulti && ingestWizard.intent === "axis" ? groupingFromFileAxis(ingestWizard.fileAxis) : "separate";
  const tabMode = isMulti && ingestWizard.intent === "tabs" ? "multiple_tabs" : "single_tab";

  return {
    inspection_id: ingestWizard.inspection.inspection_id,
    decision: {
      grouping_mode: groupingMode,
      tab_mode: tabMode,
      use_preset_id: ingestWizard.selectedPresetId,
      file_mappings: fileMappings,
    },
  };
}

function formatIngestWizardError(err, fallbackMessage = "Import failed.") {
  const raw = String(err?.message || err || "").trim();
  const normalized = raw.replace(/^\d{3}:\s*/, "");
  const lower = normalized.toLowerCase();
  if (lower.includes("inspection session not found")) {
    return "Import session expired or was cleared. Re-inspect the input file(s) and try again.";
  }
  if (lower.includes("ingest plan not found")) {
    return "Import plan expired or was cleared. Rebuild the preview and try again.";
  }
  return normalized || fallbackMessage;
}

async function buildIngestPreview() {
  try {
    setIngestStatus("Building ingest plan preview...");
    const req = buildIngestPlanDecision();
    const plan = await fetchJson("/api/ingest/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    ingestWizard.plan = plan;
    renderIngestPreviewStep();
    setIngestStep("map");
    setIngestStatus(plan.is_valid ? "Preview is valid." : "Preview contains strict errors.", !plan.is_valid);
  } catch (err) {
    setIngestStatus(`Preview failed: ${formatIngestWizardError(err, "Preview failed.")}`, true);
  }
}

async function loadDataIdIntoActiveTab(dataId) {
  await refreshDatasetOptions(dataId);
  els.datasetSelect.value = dataId;
  await onDatasetChange();
}

async function materializeCommittedDatasets(dataIds, tabMode) {
  if (!Array.isArray(dataIds) || !dataIds.length) return;
  if (tabMode !== "multiple_tabs" || dataIds.length < 2) {
    await loadDataIdIntoActiveTab(dataIds[0]);
    return;
  }
  await loadDataIdIntoActiveTab(dataIds[0]);
  for (let i = 1; i < dataIds.length; i += 1) {
    await addDatasetTabAndActivate({ readyStatus: false });
    await loadDataIdIntoActiveTab(dataIds[i]);
  }
}

async function commitIngestPlan() {
  try {
    setIngestStatus("Validating ingest plan...");
    const req = buildIngestPlanDecision();
    const plan = await fetchJson("/api/ingest/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    ingestWizard.plan = plan;
    if (!plan?.plan_id) {
      setIngestStatus("No ingest plan selected for commit.", true);
      return;
    }
    if (!plan.is_valid) {
      const firstErr = Array.isArray(plan.errors) && plan.errors.length ? plan.errors[0] : "Cannot commit invalid plan.";
      setIngestStatus(firstErr, true);
      return;
    }

    setIngestStatus("Committing ingest plan...");
    const payload = await fetchJson("/api/ingest/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: plan.plan_id }),
    });
    const created = Array.isArray(payload.created_data_ids) ? payload.created_data_ids : [];
    await materializeCommittedDatasets(created, payload.tab_mode || "single_tab");
    closeIngestDialog();
    setSystemPickerStatus(`Imported ${created.length} dataset(s): ${created.join(", ")}`);
  } catch (err) {
    setIngestStatus(`Commit failed: ${formatIngestWizardError(err, "Commit failed.")}`, true);
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

function validateDroppedDatasetFile(file) {
  const ext = dropUploadExt(file?.name);
  if (!ext) {
    return { ok: false, message: "has no extension" };
  }
  if (ext === ".zarr") {
    return { ok: false, message: "drag-and-drop does not support .zarr folders (use Load Data)" };
  }
  if (!SUPPORTED_DROP_UPLOAD_EXTS.has(ext)) {
    return { ok: false, message: `unsupported file type: ${ext}` };
  }
  return { ok: true, message: "" };
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

    const files = Array.from(droppedFiles);
    const validFiles = [];
    const invalid = [];
    for (const file of files) {
      const check = validateDroppedDatasetFile(file);
      if (check.ok) validFiles.push(file);
      else invalid.push(`${file.name || "unnamed"}: ${check.message}`);
    }

    if (!validFiles.length) {
      const reason = invalid.length ? ` (${invalid[0]})` : "";
      setSystemPickerStatus(`No supported dataset files found in drop${reason}.`, true);
      return;
    }

    const inspection = await startIngestInspect({ files: validFiles });
    if (!inspection) return;
    if (invalid.length) {
      setSystemPickerStatus(`Ignored ${invalid.length} unsupported file(s): ${invalid[0]}`, false);
    } else {
      setSystemPickerStatus(`Inspection ready for ${validFiles.length} dropped file(s).`);
    }
  });
}

async function pickPathWithSystemDialog() {
  const epoch = activeEpoch();
  setSystemPickerStatus("Opening system picker...");
  try {
    const payload = await fetchJson("/api/fs/pick", {
      method: "POST",
    });
    assertEpoch(epoch);
    if (payload.canceled) {
      setSystemPickerStatus("Selection canceled");
      return;
    }
    if (!payload.exists) {
      setSystemPickerStatus(`Selected path no longer exists: ${payload.path}`, true);
      return;
    }

    if (payload.loadable) {
      const inspection = await startIngestInspect({ paths: [payload.path] });
      if (!inspection) return;
      setSystemPickerStatus(`Inspection ready for selected path: ${payload.path}`);
      return;
    }

    setSystemPickerStatus("Selected path is not a supported dataset format", true);
  } catch (err) {
    if (isAbortError(err)) return;
    setSystemPickerStatus(`System picker failed: ${err.message}`, true);
  }
}

async function onDatasetChange() {
  const expectedEpoch = activeEpoch() + 1;
  bumpStateEpoch();
  startVisibleUpdate("dataset-change", { dataId: els.datasetSelect.value || null });
  stopPlayback();
  stopSampleMorphPlayback();
  try {
    const selectedId = els.datasetSelect.value;
    if (!selectedId) {
      state.dataId = null;
      state.meta = null;
      state.sceneSession = null;
      resetForDatasetChange(state);
      state.axisSettings = createDefaultAxisSettings();
      state.axisPlaneSwap = createDefaultAxisPlaneSwap();
      state.colorNormValueWindow = { min: null, max: null };
      state.colorNormWindowsByQuantity = {};
      resetSampleMorphState();
      resetView();
      updateControlCaps();
      drawFrameAndOverlays();
      drawNavigationGraphs();
      drawSelectionGraphs();
      drawColorbar();
      setSystemPickerStatus("No dataset loaded.");
      refreshActiveTabLabel();
      return;
    }

    state.dataId = selectedId;
    state.sceneSession = null;
    renderSceneLayerOptions();
    refreshActiveTabLabel();
    setSystemPickerStatus("");
    const summary = datasetSummaryById.get(state.dataId) || null;
    const provisionalMeta = buildProvisionalMetaFromDatasetSummary(summary);
    const metaPromise = fetchJson(`/api/datasets/${state.dataId}/meta`);
    resetForDatasetChange(state);
    state.meta = provisionalMeta;
    state.axisSettings = createDefaultAxisSettings();
    state.axisPlaneSwap = createDefaultAxisPlaneSwap();
    state.colorNormValueWindow = { min: null, max: null };
    state.colorNormWindowsByQuantity = {};
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
    setSphereOrientationFromYawPitch(0, 0, { resetAxis: true });
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
    const slicePromise = refreshSlice({ deferFixedColorRange: true });
    const fullMeta = await metaPromise;
    assertEpoch(expectedEpoch);
    state.meta = fullMeta;
    state.axisSettings = createAxisSettingsForMetadata(fullMeta);
    await loadSceneContext(state.dataId);
    assertEpoch(expectedEpoch);
    state.sphereMeta = detectSphereMeta(state.meta);
    updateControlCaps();
    await slicePromise;
    drawFrameAndOverlays();
    refreshActiveTabLabel();
  } catch (err) {
    if (!isAbortError(err)) throw err;
  }
}

async function init() {
  if (!datasetTabs.length) {
    const firstTab = createDatasetTab("Tab 1");
    firstTab.snapshot = snapshotState();
    datasetTabs.push(firstTab);
    activeDatasetTabId = firstTab.id;
    renderDatasetTabs();
  }

  await refreshDatasetOptions();
  await prepareInitialSceneLaunch();
  await loadAccelerationCapabilities();
  syncUiToState();
  updateModeButtonTooltips();

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
  if (els.sceneLayerSelect) {
    els.sceneLayerSelect.addEventListener("change", () => {
      void onSceneLayerChange();
    });
  }
  els.systemPickerBtn.addEventListener("click", () => pickPathWithSystemDialog());
  if (els.ingestCancelBtn) {
    els.ingestCancelBtn.addEventListener("click", () => {
      closeAllIngestDialogs();
      resetIngestWizardState();
    });
  }
  if (els.ingestBackBtn) {
    els.ingestBackBtn.addEventListener("click", () => {
      closeIngestDialog();
      setIngestStep("keys");
      openIngestKeysDialog();
    });
  }
  if (els.ingestPreviewBtn) {
    els.ingestPreviewBtn.addEventListener("click", () => {
      void buildIngestPreview();
    });
  }
  if (els.ingestCommitBtn) {
    els.ingestCommitBtn.addEventListener("click", () => {
      void commitIngestPlan();
    });
  }
  if (els.ingestApplyPresetBtn) {
    els.ingestApplyPresetBtn.addEventListener("click", () => applySuggestedPreset());
  }
  if (els.ingestIntentAxisBtn) {
    els.ingestIntentAxisBtn.addEventListener("click", () => {
      if (ingestFiles().length <= 1) return;
      ingestWizard.intent = "axis";
      for (const mapping of ingestWizard.mappings) mapping.fileAxisConfirmed = false;
      renderIntentDialogControls();
    });
  }
  if (els.ingestIntentTabsBtn) {
    els.ingestIntentTabsBtn.addEventListener("click", () => {
      ingestWizard.intent = "tabs";
      for (const mapping of ingestWizard.mappings) mapping.fileAxisConfirmed = false;
      renderIntentDialogControls();
    });
  }
  const intentAxisButtons = [
    els.ingestIntentFileAxisSampleBtn,
    els.ingestIntentFileAxisPolBtn,
    els.ingestIntentFileAxisTimeBtn,
    els.ingestIntentFileAxisFreqBtn,
  ];
  for (const btn of intentAxisButtons) {
    if (!btn) continue;
    btn.addEventListener("click", () => {
      const dim = String(btn.dataset.fileAxis || "");
      if (!["sample", "pol", "t", "nu"].includes(dim)) return;
      ingestWizard.fileAxis = dim;
      for (const mapping of ingestWizard.mappings) mapping.fileAxisConfirmed = false;
      renderIntentDialogControls();
    });
  }
  if (els.ingestIntentCancelBtn) {
    els.ingestIntentCancelBtn.addEventListener("click", () => {
      closeAllIngestDialogs();
      resetIngestWizardState();
    });
  }
  if (els.ingestIntentContinueBtn) {
    els.ingestIntentContinueBtn.addEventListener("click", () => {
      closeIngestIntentDialog();
      setIngestStep("keys");
      openIngestKeysDialog();
    });
  }
  if (els.ingestActiveFileSelect) {
    els.ingestActiveFileSelect.addEventListener("change", () => {
      const idx = Number.parseInt(els.ingestActiveFileSelect.value, 10);
      if (!Number.isFinite(idx)) return;
      ingestWizard.activeFileIndex = clamp(idx, 0, Math.max(0, ingestWizard.mappings.length - 1));
      renderIngestMappingStep();
    });
  }
  if (els.ingestKeysFileSelect) {
    els.ingestKeysFileSelect.addEventListener("change", () => {
      const idx = Number.parseInt(els.ingestKeysFileSelect.value, 10);
      if (!Number.isFinite(idx)) return;
      ingestWizard.activeFileIndex = clamp(idx, 0, Math.max(0, ingestWizard.mappings.length - 1));
      renderIngestKeysDialog();
    });
  }
  if (els.ingestKeysStackAxisButtons) {
    const buttons = els.ingestKeysStackAxisButtons.querySelectorAll("button[data-stack-axis]");
    for (const btn of buttons) {
      btn.addEventListener("click", () => {
        const mapping = activeMapping();
        const fileInfo = ingestFiles()[ingestWizard.activeFileIndex];
        if (!mapping || !fileInfo) return;
        const axis = String(btn.dataset.stackAxis || "").trim().toLowerCase();
        if (!INGEST_CANONICAL_DIMS.includes(axis)) return;
        mapping.keyStackAxis = axis;
        normalizeIngestMappingForFile(fileInfo, mapping, { forceResetAxes: true });
        renderIngestKeysDialog();
      });
    }
  }
  if (els.ingestKeysCancelBtn) {
    els.ingestKeysCancelBtn.addEventListener("click", () => {
      closeAllIngestDialogs();
      resetIngestWizardState();
    });
  }
  if (els.ingestKeysBackBtn) {
    els.ingestKeysBackBtn.addEventListener("click", () => {
      closeIngestKeysDialog();
      setIngestStep("intent");
      openIngestIntentDialog();
    });
  }
  if (els.ingestKeysContinueBtn) {
    els.ingestKeysContinueBtn.addEventListener("click", () => {
      const mapping = activeMapping();
      const fileInfo = ingestFiles()[ingestWizard.activeFileIndex];
      let propagated = 0;
      if (mapping && fileInfo) {
        const selectedCount = ingestSelectedDatasetPaths(fileInfo, mapping).length;
        if (ingestSupportsKeySelection(fileInfo) && selectedCount < 1) {
          setIngestKeysStatus("Select at least one key before continuing.", true);
          return;
        }
        normalizeIngestMappingForFile(fileInfo, mapping);
        propagated = propagateIngestKeySelectionToCompatibleFiles({ onlyMissing: true });
      }
      closeIngestKeysDialog();
      setIngestStep("map");
      openIngestDialog();
      renderIngestMappingStep();
      if (propagated > 0) {
        setIngestStatus(`Copied key selection to ${propagated} compatible file(s).`);
      }
    });
  }
  if (els.ingestPrevFileBtn) {
    els.ingestPrevFileBtn.addEventListener("click", () => {
      ingestWizard.activeFileIndex = clamp(ingestWizard.activeFileIndex - 1, 0, Math.max(0, ingestWizard.mappings.length - 1));
      renderIngestMappingStep();
    });
  }
  if (els.ingestNextFileBtn) {
    els.ingestNextFileBtn.addEventListener("click", () => {
      ingestWizard.activeFileIndex = clamp(ingestWizard.activeFileIndex + 1, 0, Math.max(0, ingestWizard.mappings.length - 1));
      renderIngestMappingStep();
    });
  }
  if (els.ingestApplyToAllBtn) {
    els.ingestApplyToAllBtn.addEventListener("click", () => {
      const current = activeMapping();
      const files = ingestFiles();
      const currentFile = files[ingestWizard.activeFileIndex];
      if (!current || !Array.isArray(current.axisAssignments)) return;
      const currentPaths = ingestSelectedDatasetPaths(currentFile, current);
      const currentStackAxis = ingestStackAxisForMapping(current);
      let applied = 0;
      for (const mapping of ingestWizard.mappings) {
        if (mapping === current) continue;
        if (!Array.isArray(mapping.axisAssignments) || mapping.axisAssignments.length !== current.axisAssignments.length) continue;
        mapping.axisAssignments = [...current.axisAssignments];
        mapping.axisAssignmentsConfirmed = Array.isArray(current.axisAssignmentsConfirmed)
          ? [...current.axisAssignmentsConfirmed]
          : new Array(mapping.axisAssignments.length).fill(false);
        mapping.fileAxisConfirmed = Boolean(current.fileAxisConfirmed);
        const fileInfo = files.find((row) => String(row.raw_input?.id || "") === String(mapping.raw_input_id || ""));
        const resolvedPaths = ingestResolveDatasetSelectionForFile(fileInfo, currentPaths, {
          stackAxis: currentStackAxis,
          allowDefaultFallback: false,
        });
        if (resolvedPaths.length) {
          mapping.datasetPaths = [...resolvedPaths];
          mapping.datasetPath = resolvedPaths[0];
          mapping.keyStackAxis = resolvedPaths.length > 1 ? currentStackAxis : null;
        }
        normalizeIngestMappingForFile(fileInfo, mapping);
        applied += 1;
      }
      normalizeIngestMappingForFile(currentFile, current);
      renderIngestMappingStep();
      setIngestStatus(applied > 0 ? `Applied mapping to ${applied} additional tab(s).` : "No compatible tabs for apply-all.");
    });
  }
  if (els.ingestDialog) {
    els.ingestDialog.addEventListener("close", () => {
      endIngestAxisDrag();
      setIngestStatus("");
    });
  }
  if (els.ingestKeysDialog) {
    els.ingestKeysDialog.addEventListener("close", () => {
      setIngestKeysStatus("");
    });
  }

  els.colorMapSelect.addEventListener("change", async () => {
    state.colorMap = normalizeColorMapKey(els.colorMapSelect.value);
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
  if (els.spatialResolutionSelect) {
    els.spatialResolutionSelect.addEventListener("change", async () => {
      const factor = normalizeDomainScaleFactor(els.spatialResolutionSelect.value);
      if (factor === spatialScaleFactor()) return;
      state.renderScale.spatial = factor;
      updateControlCaps();
      if (!state.dataId) {
        requestResizeRedraw(false);
        return;
      }
      await refreshSlice();
      if (state.selection) await refreshSelectionAnalytics();
    });
  }
  if (els.temporalResolutionSelect) {
    els.temporalResolutionSelect.addEventListener("change", () => {
      const factor = normalizeDomainScaleFactor(els.temporalResolutionSelect.value);
      if (factor === temporalScaleFactor()) return;
      state.renderScale.temporal = factor;
      updateControlCaps();
      drawNavigationGraphs();
      drawSelectionGraphs();
    });
  }
  if (els.spectralResolutionSelect) {
    els.spectralResolutionSelect.addEventListener("change", () => {
      const factor = normalizeDomainScaleFactor(els.spectralResolutionSelect.value);
      if (factor === spectralScaleFactor()) return;
      state.renderScale.spectral = factor;
      updateControlCaps();
      drawNavigationGraphs();
      drawSelectionGraphs();
    });
  }
  if (els.axisSettingsBtn) {
    els.axisSettingsBtn.addEventListener("click", () => {
      if (els.axisSettingsBtn.disabled) return;
      openAxisSettingsDialog();
    });
  }
  if (els.axisSettingsResetBtn) {
    els.axisSettingsResetBtn.addEventListener("click", () => {
      void resetAxisSettings();
    });
  }
  if (els.axisSettingsCloseBtn) {
    els.axisSettingsCloseBtn.addEventListener("click", () => {
      closeAxisSettingsDialog();
    });
  }
  if (els.axisSettingsDialog) {
    els.axisSettingsDialog.addEventListener("close", () => {
      updateAxisSettingsButtonState();
    });
  }

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
  if (els.viewRotateNegBtn) {
    els.viewRotateNegBtn.addEventListener("click", () => {
      if (!viewRotateModeActive()) return;
      stepViewRotateRate(-1);
      updateViewRotateControls();
      if (isVolumeMode()) rerenderVolumeFrame();
      if (isSphereMode()) rerenderSphereFrame();
    });
  }
  if (els.viewRotatePosBtn) {
    els.viewRotatePosBtn.addEventListener("click", () => {
      if (!viewRotateModeActive()) return;
      stepViewRotateRate(1);
      updateViewRotateControls();
      if (isVolumeMode()) rerenderVolumeFrame();
      if (isSphereMode()) rerenderSphereFrame();
    });
  }
  if (els.viewRotateRebaseBtn) {
    els.viewRotateRebaseBtn.addEventListener("click", () => {
      if (isVolumeMode()) {
        resetVolumeRotateAxisToViewerY();
        rerenderVolumeFrame();
      } else if (isSphereMode()) {
        resetSphereRotateAxisToViewerZ();
        rerenderSphereFrame();
      } else {
        return;
      }
      updateViewRotateControls();
    });
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
  if (els.volumeClipRangeMin && els.volumeClipRangeMax) {
    els.volumeClipRangeMin.addEventListener("pointerdown", () => setVolumeClipRangeActiveHandle("min"));
    els.volumeClipRangeMax.addEventListener("pointerdown", () => setVolumeClipRangeActiveHandle("max"));
    els.volumeClipRangeMin.addEventListener("focus", () => setVolumeClipRangeActiveHandle("min"));
    els.volumeClipRangeMax.addEventListener("focus", () => setVolumeClipRangeActiveHandle("max"));
    els.volumeClipRangeMin.addEventListener("input", onVolumeRenderControlChange);
    els.volumeClipRangeMax.addEventListener("input", onVolumeRenderControlChange);
    els.volumeClipRangeMin.addEventListener("change", onVolumeRenderControlChange);
    els.volumeClipRangeMax.addEventListener("change", onVolumeRenderControlChange);
    els.volumeClipRangeMin.addEventListener("blur", () => setVolumeClipRangeActiveHandle(null));
    els.volumeClipRangeMax.addEventListener("blur", () => setVolumeClipRangeActiveHandle(null));
  }
  els.volumeIsoThresholdRange.addEventListener("input", onVolumeRenderControlChange);

  els.multiSpectralBtn.addEventListener("click", async () => {
    if (els.multiSpectralBtn.disabled) return;
    const quantityBefore = intensityQuantityKey();
    state.multiSpectral = !state.multiSpectral;
    if (state.multiSpectral && isPlaying() && state.playbackAxis === "nu") {
      stopPlayback(false);
    }
    if (state.multiSpectral && state.navDrag && axisFromNavKind(state.navDrag.kind) === "nu") {
      state.navDrag = null;
    }
    applyIntensityQuantityTransition(quantityBefore, intensityQuantityKey());
    updateControlCaps();
    await refreshSlice();
  });
  if (els.computeBackendSelect) {
    els.computeBackendSelect.addEventListener("change", async () => {
      if (!canUseMultiSpectral()) return;
      state.multiSpectralComputeBackend = normalizeComputeBackendPreference(els.computeBackendSelect.value);
      updateControlCaps();
      await refreshMultispectralControlsFromServer();
    });
  }
  if (els.msNuAxisLogBtn) {
    els.msNuAxisLogBtn.addEventListener("click", async () => {
      if (!canUseMultiSpectral()) return;
      state.multiSpectralNuAxisScale = state.multiSpectralNuAxisScale === "log" ? "linear" : "log";
      updateControlCaps();
      drawNavigationGraphs();
      drawSelectionGraphs();
      await refreshMultispectralControlsFromServer();
    });
  }
  if (els.msDeslopeRange) {
    els.msDeslopeRange.addEventListener("input", () => {
      const parsed = Number.parseFloat(els.msDeslopeRange.value);
      state.multiSpectralDeslope = Number.isFinite(parsed) ? clamp(parsed, -8, 8) : 0;
      if (els.msDeslopeValue) els.msDeslopeValue.textContent = multispectralDeslopeLabel();
      setSliderFill(els.msDeslopeRange);
      scheduleMultispectralLocalRerender();
    });
    els.msDeslopeRange.addEventListener("change", async () => {
      const parsed = Number.parseFloat(els.msDeslopeRange.value);
      state.multiSpectralDeslope = Number.isFinite(parsed) ? clamp(parsed, -8, 8) : 0;
      if (els.msDeslopeValue) els.msDeslopeValue.textContent = multispectralDeslopeLabel();
      setSliderFill(els.msDeslopeRange);
      await refreshMultispectralControlsFromServer();
    });
  }
  if (els.msNormalizeBtn) {
    els.msNormalizeBtn.addEventListener("click", async () => {
      if (!canUseMultiSpectral()) return;
      state.multiSpectralNormalizeSpectrum = !state.multiSpectralNormalizeSpectrum;
      updateControlCaps();
      await refreshMultispectralControlsFromServer();
    });
  }
  if (els.msNormalizeBoostRange) {
    els.msNormalizeBoostRange.addEventListener("input", () => {
      state.multiSpectralNormalizeBoost = normalizeMultispectralNormalizeBoost(els.msNormalizeBoostRange.value);
      if (els.msNormalizeBoostValue) els.msNormalizeBoostValue.textContent = multispectralNormalizeBoostLabel();
      setSliderFill(els.msNormalizeBoostRange);
      if (state.multiSpectralNormalizeSpectrum) {
        scheduleMultispectralLocalRerender();
      }
    });
    els.msNormalizeBoostRange.addEventListener("change", async () => {
      state.multiSpectralNormalizeBoost = normalizeMultispectralNormalizeBoost(els.msNormalizeBoostRange.value);
      if (els.msNormalizeBoostValue) els.msNormalizeBoostValue.textContent = multispectralNormalizeBoostLabel();
      setSliderFill(els.msNormalizeBoostRange);
      if (state.multiSpectralNormalizeSpectrum) {
        await refreshMultispectralControlsFromServer();
      }
    });
  }
  if (els.msChannelRangeMinRange && els.msChannelRangeMaxRange) {
    els.msChannelRangeMinRange.addEventListener("pointerdown", () => setMultispectralRangeActiveHandle("min"));
    els.msChannelRangeMaxRange.addEventListener("pointerdown", () => setMultispectralRangeActiveHandle("max"));
    els.msChannelRangeMinRange.addEventListener("focus", () => setMultispectralRangeActiveHandle("min"));
    els.msChannelRangeMaxRange.addEventListener("focus", () => setMultispectralRangeActiveHandle("max"));
    els.msChannelRangeMinRange.addEventListener("input", () => onMultispectralRangeInput("min", false));
    els.msChannelRangeMaxRange.addEventListener("input", () => onMultispectralRangeInput("max", false));
    els.msChannelRangeMinRange.addEventListener("change", () => onMultispectralRangeInput("min", true));
    els.msChannelRangeMaxRange.addEventListener("change", () => onMultispectralRangeInput("max", true));
    els.msChannelRangeMinRange.addEventListener("blur", () => setMultispectralRangeActiveHandle(null));
    els.msChannelRangeMaxRange.addEventListener("blur", () => setMultispectralRangeActiveHandle(null));
  }

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
      const quantityBefore = intensityQuantityKey();
      state.values.pol = idx;
      state.derivedPolMode = "none";
      applyIntensityQuantityTransition(quantityBefore, intensityQuantityKey());
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
      state.evpaStep = clamp(step, 1, 32);
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
      const quantityBefore = intensityQuantityKey();
      state.derivedPolMode = state.derivedPolMode === mode ? "none" : mode;
      applyIntensityQuantityTransition(quantityBefore, intensityQuantityKey());
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
  window.addEventListener("keydown", async (ev) => {
    if (ev.key !== "Escape") return;
    if (renderJob.running) {
      ev.preventDefault();
      requestRenderCancel();
      return;
    }
    if (!(isMovieRecordingActive() || movieRecording.stopping)) return;
    ev.preventDefault();
    try {
      await stopMovieRecordingForExport();
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      setSystemPickerStatus(`Record failed: ${message}`, true);
    }
  });
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

  if (els.saveImagesBtn) {
    els.saveImagesBtn.addEventListener("click", async () => {
      if (els.saveImagesBtn.disabled) return;
      openSaveImagesDialog();
    });
  }

  if (els.recordMovieBtn) {
    els.recordMovieBtn.addEventListener("click", async () => {
      if (els.recordMovieBtn.disabled) return;
      try {
        if (isMovieRecordingActive() || movieRecording.stopping) {
          await stopMovieRecordingForExport();
        } else {
          await startMovieRecordingFromToolbar();
        }
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setSystemPickerStatus(`Record failed: ${message}`, true);
      }
    });
  }

  if (els.mediaQualitySelect) {
    els.mediaQualitySelect.addEventListener("change", () => {
      if (els.mediaQualitySelect.disabled) return;
      const next = normalizeRecordQuality(els.mediaQualitySelect.value);
      state.recordMoviePrefs.quality = next;
      updateExportButtonState();
      setSystemPickerStatus(`Recording quality set to ${recordQualityConfig(next).label}.`);
    });
  }

  if (els.renderMovieBtn) {
    els.renderMovieBtn.addEventListener("click", () => {
      if (els.renderMovieBtn.disabled) return;
      openRenderMovieDialog();
    });
  }

  const renderChoiceButtons = [
    [els.renderAxisTimeBtn, "axis", "t"],
    [els.renderAxisFreqBtn, "axis", "nu"],
    [els.renderAxisHiddenBtn, "axis", RENDER_AXIS_HIDDEN],
    [els.renderAxisSampleMorphBtn, "axis", SAMPLE_MORPH_AXIS],
    [els.renderAxisRotateBtn, "axis", RENDER_AXIS_ROTATE],
    [els.renderFormatMp4Btn, "format", "mp4"],
    [els.renderFormatWebmBtn, "format", "webm"],
    [els.renderFormatGifBtn, "format", "gif"],
    [els.renderQualityLowBtn, "quality", "low"],
    [els.renderQualityMedBtn, "quality", "balanced"],
    [els.renderQualityHighBtn, "quality", "high"],
    [els.renderResCanvasBtn, "resolution", "canvas"],
    [els.renderRes720Btn, "resolution", "720p"],
    [els.renderRes1080Btn, "resolution", "1080p"],
    [els.renderRes1440Btn, "resolution", "1440p"],
    [els.renderRes2160Btn, "resolution", "2160p"],
  ];
  for (const [btn, key, value] of renderChoiceButtons) {
    if (!btn) continue;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      state.renderMoviePrefs[key] = value;
      state.renderMoviePrefs.filename = normalizeRenderMovieFilename(
        state.renderMoviePrefs.filename,
        state.renderMoviePrefs.format
      );
      updateRenderMovieDialogFields();
      updateRenderSettingsFields();
      updateExportButtonState();
    });
  }
  if (els.renderFpsInput) {
    els.renderFpsInput.addEventListener("change", () => {
      readRenderSettingsFromUi();
      updateRenderMovieDialogFields();
      updateRenderSettingsFields();
      updateExportButtonState();
    });
  }
  if (els.renderLoopInput) {
    els.renderLoopInput.addEventListener("change", () => {
      readRenderSettingsFromUi();
      updateRenderMovieDialogFields();
      updateRenderSettingsFields();
      updateExportButtonState();
    });
  }
  const renderOverlayToggles = [
    [els.renderIncludeColorbarBtn, "includeColorbar"],
    [els.renderIncludeSkyDirectionsBtn, "includeSkyDirections"],
    [els.renderIncludeLengthScaleBtn, "includeLengthScale"],
    [els.renderIncludeSampleLabelsBtn, "includeSampleLabels"],
  ];
  for (const [btn, key] of renderOverlayToggles) {
    if (!btn) continue;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const current = normalizeRenderOverlayOption(state.renderMoviePrefs[key]);
      state.renderMoviePrefs[key] = !current;
      updateRenderSettingsFields();
      updateRenderMovieDialogFields();
      updateExportButtonState();
    });
  }

  if (els.renderProgressCancelBtn) {
    els.renderProgressCancelBtn.addEventListener("click", () => {
      requestRenderCancel();
    });
  }

  if (els.renderMovieFilenameInput) {
    els.renderMovieFilenameInput.addEventListener("input", () => {
      state.renderMoviePrefs.filename = els.renderMovieFilenameInput.value;
      setRenderMovieStatus("");
    });
  }

  if (els.renderMovieOverwriteChk) {
    els.renderMovieOverwriteChk.addEventListener("change", () => {
      state.renderMoviePrefs.overwrite = Boolean(els.renderMovieOverwriteChk.checked);
    });
  }

  if (els.renderMovieBrowseBtn) {
    els.renderMovieBrowseBtn.addEventListener("click", async () => {
      try {
        await chooseRenderMovieFolder();
        setRenderMovieStatus("");
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setRenderMovieStatus(message, true);
      }
    });
  }

  if (els.renderMovieCancelBtn) {
    els.renderMovieCancelBtn.addEventListener("click", () => {
      closeRenderMovieDialog();
    });
  }

  if (els.renderMovieConfirmBtn) {
    els.renderMovieConfirmBtn.addEventListener("click", async () => {
      try {
        await runOfflineRenderFromDialog();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setSystemPickerStatus(`Render failed: ${message}`, true);
        setRenderMovieStatus(`Render failed: ${message}`, true);
      }
    });
  }

  if (els.renderMovieDialog) {
    els.renderMovieDialog.addEventListener("cancel", () => {
      closeRenderMovieDialog();
    });
    els.renderMovieDialog.addEventListener("close", () => {
      setRenderMovieStatus("");
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

  if (els.saveImagesPrefixInput) {
    els.saveImagesPrefixInput.addEventListener("input", () => {
      state.saveImagesPrefs.prefix = els.saveImagesPrefixInput.value;
      setSaveImagesStatus("");
    });
  }

  const saveImagesToggleButtons = [
    [els.saveImagesIncludeViewerBtn, "includeViewer"],
    [els.saveImagesIncludeColorbarBtn, "includeColorbar"],
    [els.saveImagesIncludeSampleLabelsBtn, "includeSampleLabels"],
    [els.saveImagesIncludeTimeProfileBtn, "includeTimeProfile"],
    [els.saveImagesIncludeSpectralProfileBtn, "includeSpectralProfile"],
    [els.saveImagesIncludeSpatialProfileBtn, "includeSpatialProfile"],
  ];
  for (const [btn, key] of saveImagesToggleButtons) {
    if (!btn) continue;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const current = normalizeRenderOverlayOption(state.saveImagesPrefs[key]);
      state.saveImagesPrefs[key] = !current;
      updateSaveImagesSelectionButtons();
      setSaveImagesStatus("");
    });
  }

  if (els.saveImagesOverwriteChk) {
    els.saveImagesOverwriteChk.addEventListener("change", () => {
      state.saveImagesPrefs.overwrite = Boolean(els.saveImagesOverwriteChk.checked);
    });
  }
  if (els.saveImagesTransparentBgChk) {
    els.saveImagesTransparentBgChk.addEventListener("change", () => {
      state.saveImagesPrefs.transparentBackground = Boolean(els.saveImagesTransparentBgChk.checked);
    });
  }

  if (els.saveImagesBrowseBtn) {
    els.saveImagesBrowseBtn.addEventListener("click", async () => {
      try {
        await chooseSaveImagesFolder();
        setSaveImagesStatus("");
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setSaveImagesStatus(message, true);
      }
    });
  }

  if (els.saveImagesCancelBtn) {
    els.saveImagesCancelBtn.addEventListener("click", () => {
      closeSaveImagesDialog();
    });
  }

  if (els.saveImagesConfirmBtn) {
    els.saveImagesConfirmBtn.addEventListener("click", async () => {
      try {
        await saveCurrentImagesFromDialog();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setSaveImagesStatus(`Save failed: ${message}`, true);
      }
    });
  }

  if (els.saveImagesDialog) {
    els.saveImagesDialog.addEventListener("cancel", () => {
      setSaveImagesStatus("");
    });
    els.saveImagesDialog.addEventListener("close", () => {
      setSaveImagesStatus("");
    });
  }

  if (els.recordMovieFilenameInput) {
    els.recordMovieFilenameInput.addEventListener("input", () => {
      state.recordMoviePrefs.filename = els.recordMovieFilenameInput.value;
      setRecordMovieStatus("");
    });
  }

  const recordFormatButtons = [
    [els.recordMovieFormatWebmBtn, "webm"],
    [els.recordMovieFormatMp4Btn, "mp4"],
    [els.recordMovieFormatGifBtn, "gif"],
  ];
  for (const [btn, format] of recordFormatButtons) {
    if (!btn) continue;
    btn.addEventListener("click", () => {
      state.recordMoviePrefs.format = format;
      const currentName = els.recordMovieFilenameInput ? els.recordMovieFilenameInput.value : state.recordMoviePrefs.filename;
      state.recordMoviePrefs.filename = normalizeRecordMovieFilename(currentName, format);
      updateRecordMovieDialogFields();
      setRecordMovieStatus("");
    });
  }

  if (els.recordMovieOverwriteChk) {
    els.recordMovieOverwriteChk.addEventListener("change", () => {
      state.recordMoviePrefs.overwrite = Boolean(els.recordMovieOverwriteChk.checked);
    });
  }

  if (els.recordMovieBrowseBtn) {
    els.recordMovieBrowseBtn.addEventListener("click", async () => {
      try {
        await chooseRecordMovieFolder();
        setRecordMovieStatus("");
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setRecordMovieStatus(message, true);
      }
    });
  }

  if (els.recordMovieCancelBtn) {
    els.recordMovieCancelBtn.addEventListener("click", async () => {
      try {
        discardPendingMovieRecording();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setRecordMovieStatus(`Record failed: ${message}`, true);
      }
    });
  }

  if (els.recordMovieConfirmBtn) {
    els.recordMovieConfirmBtn.addEventListener("click", async () => {
      try {
        await savePendingMovieFromDialog();
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        setRecordMovieStatus(`Save failed: ${message}`, true);
      }
    });
  }

  if (els.recordMovieDialog) {
    els.recordMovieDialog.addEventListener("cancel", () => {
      discardPendingMovieRecording();
    });
    els.recordMovieDialog.addEventListener("close", () => {
      setRecordMovieStatus("");
    });
  }

  els.resetZoomBtn.addEventListener("click", async () => {
    state.navDrag = null;
    state.profileZoomDrag = null;
    state.profileZoom = {};
    state.axisWindow = { t: null, nu: null };
    resetVolumeOrientation();
    state.volumeZoom = 1.0;
    state.viewRotateRate = 0;
    state.volumeDrag = null;
    setSphereOrientationFromYawPitch(0, 0, { resetAxis: true });
    state.sphereDrag = null;
    updateVolumeControlReadouts();
    updateViewRotateControls();
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
    applyVolumeDragRotation,
    applySphereDragRotation,
    applyZoomBox,
    clamp,
    clampIndexToWindow,
    drawFrameAndOverlays,
    drawNavigationGraphs,
    drawSelectionGraphs,
    effectiveDragMode,
    els,
    ensureGridIndices,
    getRenderGeometry,
    getViewRect,
    handleWheelZoom,
    isSphereMode,
    isVolumeMode,
    navIndexFromEvent,
    planeAxisFlipState,
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
    startVisibleUpdate,
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

  updateRenderSettingsFields();
  updatePlayUi();
  await onDatasetChange();
}

init().catch((err) => {
  console.error(err);
  window.alert(`Failed to initialize demo: ${err.message}`);
});
