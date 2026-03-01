export function resetForPlaneChange(state) {
  state.selection = null;
  state.selectionDrag = null;
  state.zoomDrag = null;
  state.volumeDrag = null;
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
  state.frameTiles = null;
  state.frameGrid = 1;
  state.drawTiles = [];
}

export function resetForDatasetChange(state) {
  state.values = { sample: 0, pol: 0, t: 0, nu: 0, x: 0, y: 0, z: 0 };

  state.selection = null;
  state.selectionDrag = null;
  state.zoomDrag = null;
  state.volumeDrag = null;
  state.profileZoomDrag = null;
  state.profileZoom = {};
  state.axisWindow = { t: null, nu: null };
  state.evpaTicks = [];
  state.evpaTicksBySample = {};
  state.currentMonoSlice = null;
  state.currentVolume = null;
  state.currentVolumeTiles = null;
  state.currentMultispectralBands = null;
  state.currentIntensityStats = null;
  state.currentIntensityUnit = "";
  state.fixedColorRange = null;
  state.frameCanvas = null;
  state.frameTiles = null;
  state.frameGrid = 1;
  state.drawTiles = [];
  state.selectedCoords = null;
  state.profiles = null;
  state.viewProfiles = null;
  state.sampleGridIndices = [0];
  state.activeSampleTile = 0;
}
