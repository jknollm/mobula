import {
  DEFAULT_RECORD_FPS,
  RECORD_QUALITY_PRESETS,
  RENDER_AXIS_HIDDEN,
  RENDER_AXIS_ROTATE,
  RENDER_RESOLUTION_HEIGHT,
} from "./viewer_constants.js?v=20260306b";

export function isValidRecordMovieFormat(format) {
  return format === "webm" || format === "mp4" || format === "gif";
}

export function normalizeRecordMovieFormat(format) {
  return isValidRecordMovieFormat(format) ? format : "mp4";
}

export function isValidRecordQuality(quality) {
  return quality === "low" || quality === "balanced" || quality === "high";
}

export function normalizeRecordQuality(quality) {
  return isValidRecordQuality(quality) ? quality : "balanced";
}

export function recordQualityConfig(quality) {
  const key = normalizeRecordQuality(quality);
  return RECORD_QUALITY_PRESETS[key] || RECORD_QUALITY_PRESETS.balanced;
}

export function recordMovieExtension(format) {
  const fmt = normalizeRecordMovieFormat(format);
  if (fmt === "mp4") return ".mp4";
  if (fmt === "gif") return ".gif";
  return ".webm";
}

function sanitizeMovieFilename(name, fallbackName) {
  let out = String(name || "").trim();
  if (!out) out = fallbackName;
  out = out.split(/[\\/]/).pop() || fallbackName;
  return out;
}

export function buildDefaultRecordMovieFilename(dataId, timestamp, format = "mp4") {
  const base = dataId || "mobula";
  return `${base}_recording_${timestamp}${recordMovieExtension(format)}`;
}

export function buildDefaultRenderMovieFilename(dataId, timestamp, format = "mp4") {
  const base = dataId || "mobula";
  return `${base}_render_${timestamp}${recordMovieExtension(format)}`;
}

export function normalizeMovieFilename(name, format = "mp4", fallbackName = "") {
  const fmt = normalizeRecordMovieFormat(format);
  const ext = recordMovieExtension(fmt);
  let out = sanitizeMovieFilename(name, fallbackName);
  if (!out.toLowerCase().endsWith(ext)) {
    out = `${out.replace(/\.[^.]+$/, "")}${ext}`;
  }
  return out;
}

export function parseRenderAxis(axis, sampleMorphAxis) {
  const token = String(axis || "").trim().toLowerCase();
  if (!token) return null;
  if (token === "t" || token === "nu" || token === RENDER_AXIS_HIDDEN) return token;
  if (token === sampleMorphAxis || token === "sample-morph" || token === "sample_morph") {
    return sampleMorphAxis;
  }
  if (token === RENDER_AXIS_ROTATE || token === "rotate" || token === "rotation") {
    return RENDER_AXIS_ROTATE;
  }
  return null;
}

export function isValidRenderAxis(axis, sampleMorphAxis) {
  return parseRenderAxis(axis, sampleMorphAxis) !== null;
}

export function normalizeRenderAxis(axis, sampleMorphAxis) {
  return parseRenderAxis(axis, sampleMorphAxis) || "t";
}

export function isValidRenderResolution(resolution) {
  return resolution === "canvas" || Object.prototype.hasOwnProperty.call(RENDER_RESOLUTION_HEIGHT, resolution);
}

export function normalizeRenderResolution(resolution) {
  return isValidRenderResolution(resolution) ? resolution : "canvas";
}

export function normalizeRenderFps(fps) {
  const parsed = Number.parseInt(fps, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RECORD_FPS;
  return Math.min(240, Math.max(1, parsed));
}

export function normalizeRenderLoops(loops) {
  const parsed = Number.parseInt(loops, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(100, Math.max(1, parsed));
}

export function normalizeRenderOverlayOption(value) {
  return value !== false;
}

export function renderQualityLabel(quality) {
  return recordQualityConfig(quality).label;
}

export function ensureEvenPositive(n) {
  const v = Math.max(2, Math.round(Number.isFinite(n) ? n : 2));
  return v % 2 === 0 ? v : v + 1;
}

export function resolveRenderFrameDimensions(rawW, rawH, resolution) {
  const key = normalizeRenderResolution(resolution);
  if (key === "canvas") {
    return { width: ensureEvenPositive(rawW), height: ensureEvenPositive(rawH) };
  }
  const targetH = RENDER_RESOLUTION_HEIGHT[key];
  const scale = targetH / Math.max(1, rawH);
  return {
    width: ensureEvenPositive(rawW * scale),
    height: ensureEvenPositive(targetH),
  };
}
