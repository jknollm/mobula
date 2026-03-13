export const PLANE_OPTIONS = {
  xy: { planeX: "x", planeY: "y", hidden: "z", label: "XY" },
  yz: { planeX: "y", planeY: "z", hidden: "x", label: "YZ" },
  zx: { planeX: "z", planeY: "x", hidden: "y", label: "ZX" },
};

export const PLANE_KEYS = Object.freeze(["xy", "yz", "zx"]);

export const COLOR_RAMPS = {
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
  afmhot_us: [
    [0.0, 0, 0, 0],
    [0.0625, 27, 0, 0],
    [0.125, 56, 0, 0],
    [0.1875, 82, 0, 0],
    [0.25, 108, 0, 0],
    [0.3125, 132, 5, 0],
    [0.375, 153, 27, 1],
    [0.4375, 172, 45, 1],
    [0.5, 190, 63, 0],
    [0.5625, 208, 81, 0],
    [0.625, 226, 99, 0],
    [0.6875, 244, 118, 8],
    [0.75, 251, 146, 34],
    [0.8125, 250, 178, 65],
    [0.875, 247, 208, 109],
    [0.9375, 246, 235, 166],
    [1.0, 255, 254, 253],
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

COLOR_RAMPS.afmhot_u = COLOR_RAMPS.afmhot_us;
COLOR_RAMPS.ehtplot = COLOR_RAMPS.afmhot_us;

export function normalizeColorMapKey(raw) {
  const key = String(raw || "").trim();
  if (key === "afmhot_u" || key === "ehtplot") return "afmhot_us";
  if (Object.prototype.hasOwnProperty.call(COLOR_RAMPS, key)) return key;
  return "viridis";
}

export const PROFILE_THEME = {
  dragFill: "rgba(245, 250, 255, 0.08)",
  dragStroke: "rgba(245, 250, 255, 0.92)",
  indicator: "#f7fbff",
  time: "#57daff",
  spectral: "#36d7d8",
  spatial: "#52efbc",
};

export const SUPPORTED_DROP_UPLOAD_EXTS = new Set([".h5", ".hdf5", ".fits", ".fit", ".fts", ".npz"]);
export const INGEST_CANONICAL_DIMS = ["sample", "pol", "t", "nu", "x", "y", "z"];
export const INGEST_SPHERE_ALIAS_DIM = "sphere";
export const INGEST_UI_DIMS = [...INGEST_CANONICAL_DIMS, INGEST_SPHERE_ALIAS_DIM];
export const INGEST_HDF5_STACK_TOKEN_PREFIX = "__stokes_stack__:";
export const INGEST_AXIS_LABEL = {
  sample: "Samples",
  pol: "Polarisation",
  t: "Time",
  nu: "Frequency",
  x: "X-Axis",
  y: "Y-Axis",
  z: "Z-Axis",
  sphere: "Sphere",
};
export const AXIS_DISPLAY_LABEL = {
  sample: "Sample",
  pol: "Polarisation",
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
