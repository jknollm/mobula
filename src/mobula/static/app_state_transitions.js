export function resetForPlaneChange(state) {
  state.selection = null;
  state.selectionDrag = null;
  state.zoomDrag = null;
  state.volumeDrag = null;
  state.sphereDrag = null;
  state.profileZoomDrag = null;
  state.profileZoom = {};
  state.axisWindow = { t: null, nu: null };
  state.evpaTicks = [];
  state.evpaTicksBySample = {};
  state.profiles = null;
  state.viewProfiles = null;
  state.fixedColorRange = null;
  state.currentVolume = null;
  state.currentVolumeTiles = null;
  state.currentMonoSliceTiles = null;
  state.currentMultispectralSlice = null;
  state.currentMultispectralTiles = null;
  state.hoverProbe = null;
  state.frameTiles = null;
  state.frameGrid = 1;
  state.drawTiles = [];
  if (state.sampleMorph) {
    state.sampleMorph.token = (state.sampleMorph.token || 0) + 1;
    state.sampleMorph.alpha = 0;
    state.sampleMorph.sharedStats = null;
    state.sampleMorph.fromSlice = null;
    state.sampleMorph.toSlice = null;
    state.sampleMorph.fromVolume = null;
    state.sampleMorph.toVolume = null;
    state.sampleMorph.fromCanvas = null;
    state.sampleMorph.toCanvas = null;
    state.sampleMorph.blendCanvas = null;
  }
}

export function resetForDatasetChange(state) {
  state.values = { sample: 0, pol: 0, t: 0, nu: 0, x: 0, y: 0, z: 0 };
  state.axisProjection = { t: false, nu: false, x: false, y: false, z: false };
  state.sampleSingleView = "mosaic";
  state.colorRangeMode = "full";
  if (state.spatialMode === "sphere") {
    state.spatialMode = "slice";
  }
  state.sphereMeta = null;
  state.sphereProjection = "mollweide";
  state.sphereHorizontalFlip = true;
  state.sphereInsideScale = 0.2;
  state.sphereYaw = 0;
  state.spherePitch = 0;
  state.sphereRotationMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  state.sphereRotateAxisObject = [0, 0, 1];
  state.sphereVectorKey = "";
  state.sphereVectors = null;
  state.sphereSimplexKey = "";
  state.sphereSimplexFaces = null;
  state.sphereMeshCanvas = null;
  state.sphereRingLutKey = "";
  state.sphereRingLut = null;
  state.sphereRayGridKey = "";
  state.sphereRayGrid = null;

  state.selection = null;
  state.selectionDrag = null;
  state.zoomDrag = null;
  state.volumeDrag = null;
  state.sphereDrag = null;
  state.profileZoomDrag = null;
  state.profileZoom = {};
  state.axisWindow = { t: null, nu: null };
  state.evpaTicks = [];
  state.evpaTicksBySample = {};
  state.currentMonoSlice = null;
  state.currentMonoSliceTiles = null;
  state.currentVolume = null;
  state.currentVolumeTiles = null;
  state.currentMultispectralBands = null;
  state.currentMultispectralSlice = null;
  state.currentMultispectralTiles = null;
  state.currentIntensityStats = null;
  state.currentIntensityUnit = "";
  state.fixedColorRange = null;
  state.colorNormValueWindow = { min: null, max: null };
  state.colorNormWindowsByQuantity = {};
  state.frameCanvas = null;
  state.frameTiles = null;
  state.frameGrid = 1;
  state.drawTiles = [];
  state.selectedCoords = null;
  state.hoverProbe = null;
  state.profiles = null;
  state.viewProfiles = null;
  state.sampleGridIndices = [0];
  state.activeSampleTile = 0;
  if (state.exportPrefs) {
    state.exportPrefs.filename = "";
  }
  if (state.recordMoviePrefs) {
    state.recordMoviePrefs.filename = "";
  }
  if (state.renderMoviePrefs) {
    state.renderMoviePrefs.filename = "";
  }
  if (state.sampleMorph) {
    state.sampleMorph.token = (state.sampleMorph.token || 0) + 1;
    state.sampleMorph.fromSample = 0;
    state.sampleMorph.toSample = 0;
    state.sampleMorph.alpha = 0;
    state.sampleMorph.sharedStats = null;
    state.sampleMorph.fromSlice = null;
    state.sampleMorph.toSlice = null;
    state.sampleMorph.fromVolume = null;
    state.sampleMorph.toVolume = null;
    state.sampleMorph.fromCanvas = null;
    state.sampleMorph.toCanvas = null;
    state.sampleMorph.blendCanvas = null;
  }
}
