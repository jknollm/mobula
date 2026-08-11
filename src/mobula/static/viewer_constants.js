import { SCIENTIFIC_COLOR_REGISTRY } from "./scientific_colormaps.js?v=20260810a";

export const PLANE_OPTIONS = {
  xy: { planeX: "x", planeY: "y", hidden: "z", label: "XY" },
  yz: { planeX: "y", planeY: "z", hidden: "x", label: "YZ" },
  zx: { planeX: "z", planeY: "x", hidden: "y", label: "ZX" },
};

export const PLANE_KEYS = Object.freeze(["xy", "yz", "zx"]);

export { SCIENTIFIC_COLOR_REGISTRY };

export const COLOR_RAMPS = Object.freeze(
  Object.fromEntries(Object.entries(SCIENTIFIC_COLOR_REGISTRY.maps).map(([key, record]) => [key, record.lut]))
);

const COLOR_MAP_ALIASES = Object.freeze({
  afmhot_u: "afmhot_us",
  ehtplot: "afmhot_us",
  cyan_coral: "cyan_coral.paper",
});

export function normalizeColorMapKey(raw) {
  const key = String(raw || "").trim();
  if (Object.prototype.hasOwnProperty.call(COLOR_MAP_ALIASES, key)) return COLOR_MAP_ALIASES[key];
  if (Object.prototype.hasOwnProperty.call(COLOR_RAMPS, key)) return key;
  return "viridis";
}

export function colorMapRecord(raw) {
  return SCIENTIFIC_COLOR_REGISTRY.maps[normalizeColorMapKey(raw)] || SCIENTIFIC_COLOR_REGISTRY.maps.viridis;
}

export function recommendedColorMapForQuantity(quantityKey, resolveTheme = "bright") {
  if (quantityKey === "sample:std" || quantityKey === "sample:rel_uncert") return "oslo";
  if (quantityKey === "derived:circular") {
    return resolveTheme === "dark" ? "cyan_coral.night" : "cyan_coral.paper";
  }
  if (quantityKey === "derived:bfield") return "phase_c3";
  if (quantityKey === "multispectral") return null;
  return "afmhot_us";
}

export const SUPPORTED_DROP_UPLOAD_EXTS = new Set([".h5", ".hdf5", ".fits", ".fit", ".fts", ".npz"]);
export const INGEST_CANONICAL_DIMS = ["sample", "pol", "t", "nu", "x", "y", "z"];
export const INGEST_SPHERE_ALIAS_DIM = "sphere";
export const INGEST_UI_DIMS = [...INGEST_CANONICAL_DIMS, INGEST_SPHERE_ALIAS_DIM];
export const INGEST_HDF5_STACK_TOKEN_PREFIX = "__stokes_stack__:";
export const INGEST_AXIS_LABEL = {
  sample: "Samples",
  pol: "Polarization",
  t: "Time",
  nu: "Frequency",
  x: "X-Axis",
  y: "Y-Axis",
  z: "Z-Axis",
  sphere: "Sphere",
};
export const AXIS_DISPLAY_LABEL = {
  sample: "Sample",
  pol: "Polarization",
  t: "Time",
  nu: "Frequency",
  x: "X-Axis",
  y: "Y-Axis",
  z: "Z-Axis",
};
export const INGEST_AXIS_THEME = {
  sample: { rgb: "56, 180, 119", border: "#38b477", text: "#eafff3" },
  pol: { rgb: "213, 155, 53", border: "#d59b35", text: "#fff7e6" },
  t: { rgb: "75, 166, 255", border: "#4ba6ff", text: "#eef6ff" },
  nu: { rgb: "238, 106, 79", border: "#ee6a4f", text: "#fff2ed" },
  x: { rgb: "68, 192, 200", border: "#44c0c8", text: "#ebfeff" },
  y: { rgb: "122, 201, 93", border: "#7ac95d", text: "#f0ffea" },
  z: { rgb: "186, 119, 214", border: "#ba77d6", text: "#fdf0ff" },
};
export const DEFAULT_MOSAIC_SAMPLE_COUNT = 4;
export const DEFAULT_MOSAIC_GRID_SIZE = Math.round(Math.sqrt(DEFAULT_MOSAIC_SAMPLE_COUNT));
export const DEFAULT_EXPORT_OUTPUT_DIR = "~/Downloads";
export const DEFAULT_RECORD_FPS = 12;
export const DEFAULT_RECORD_BITRATE = 3_500_000;
export const DEFAULT_RECORD_MAX_PIXELS = 640_000;
export const RECORD_STOP_TIMEOUT_MS = 3000;
export const WHEEL_ZOOM_STEP_FACTOR = 1.05;
export const GLOBAL_ZOOM_OUT_FACTOR = 25.0;
export const VOLUME_ZOOM_MIN = 0.2;
export const VOLUME_ZOOM_MAX = 8.0;
export const VIEW_SOURCE_RECT_MAX_MULTIPLIER = 64.0;
export const RECORD_QUALITY_PRESETS = {
  low: { key: "low", label: "Low", shortLabel: "Low", fps: 8, bitrate: 2_000_000, maxPixels: 360_000 },
  balanced: {
    key: "balanced",
    label: "Medium",
    shortLabel: "Med",
    fps: DEFAULT_RECORD_FPS,
    bitrate: DEFAULT_RECORD_BITRATE,
    maxPixels: DEFAULT_RECORD_MAX_PIXELS,
  },
  high: { key: "high", label: "High", shortLabel: "High", fps: 18, bitrate: 5_000_000, maxPixels: 1_000_000 },
};
export const RENDER_RESOLUTION_HEIGHT = {
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "2160p": 2160,
};
export const RENDER_AXIS_HIDDEN = "hidden";
export const RENDER_AXIS_ROTATE = "__rotate__";
export const AXIS_CONTROL_DIMS = ["sample", "pol", "t", "nu", "x", "y", "z"];
