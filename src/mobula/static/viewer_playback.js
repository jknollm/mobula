export function createPlaybackController(deps) {
  const {
    state,
    els,
    renderJob,
    sampleMorphAxis,
    playbackPreviewBaseMaxPixels,
    playbackPreviewMinPixels,
    playbackPreviewMaxPixels,
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
    clamp,
    getAxisWindow,
    onUpdatePlayUi,
    prefetchAxisPlaybackFrame,
    setAxisIndex,
  } = deps;
  let sampleMorphLastTickMs = 0;

  function isPlaying() {
    return state.playbackTimer !== null;
  }

  function isSampleMorphPlaybackActive() {
    return state.sampleMorphTimer !== null;
  }

  function shouldAutoPlaySampleMorph() {
    return (
      Boolean(state.dataId)
      && isSampleMorphMode()
      && sampleCount() > 1
      && !isPlaying()
      && !renderJob.running
      && !renderJob.encoding
      && !state.sampleMorph.initializing
    );
  }

  function stopSampleMorphPlayback() {
    if (state.sampleMorphTimer) {
      clearTimeout(state.sampleMorphTimer);
      state.sampleMorphTimer = null;
    }
    sampleMorphLastTickMs = 0;
  }

  function sampleMorphIntervalMs() {
    const previewFps = Math.max(24, Math.max(1, state.playbackFps));
    return Math.max(16, Math.floor(1000 / previewFps));
  }

  function startSampleMorphPlayback() {
    if (!shouldAutoPlaySampleMorph()) {
      stopSampleMorphPlayback();
      return;
    }
    if (state.sampleMorphTimer) return;
    sampleMorphLastTickMs = performance.now();

    const scheduleSampleMorphTick = (delayMs = sampleMorphIntervalMs()) => {
      state.sampleMorphTimer = setTimeout(async () => {
        if (!shouldAutoPlaySampleMorph()) {
          stopSampleMorphPlayback();
          return;
        }
        const now = performance.now();
        const prev = sampleMorphLastTickMs || now;
        sampleMorphLastTickMs = now;
        if (!state.playbackBusy) {
          state.playbackBusy = true;
          try {
            await advanceSampleMorphPlayback(Math.max(1.0e-3, (now - prev) / 1000));
          } finally {
            state.playbackBusy = false;
          }
        }
        if (shouldAutoPlaySampleMorph()) {
          scheduleSampleMorphTick(sampleMorphIntervalMs());
        } else {
          stopSampleMorphPlayback();
        }
      }, delayMs);
    };

    scheduleSampleMorphTick();
  }

  async function advanceSampleMorphPlayback(deltaSeconds) {
    return deps.advanceSampleMorphPlayback(deltaSeconds);
  }

  function syncSampleMorphPlayback() {
    if (shouldAutoPlaySampleMorph()) {
      startSampleMorphPlayback();
    } else {
      stopSampleMorphPlayback();
    }
  }

  function playbackIntervalMs() {
    return Math.max(30, Math.floor(1000 / Math.max(1, state.playbackFps)));
  }

  function tunePlaybackPreviewBudget(frameMs) {
    const targetMs = playbackIntervalMs();
    const current = Math.max(
      playbackPreviewMinPixels,
      Math.floor(state.playbackPreviewMaxPixels || playbackPreviewBaseMaxPixels)
    );
    if (frameMs > targetMs * 1.2) {
      state.playbackPreviewMaxPixels = Math.max(playbackPreviewMinPixels, Math.floor(current * 0.85));
      return;
    }
    if (frameMs < targetMs * 0.7) {
      state.playbackPreviewMaxPixels = Math.min(playbackPreviewMaxPixels, Math.floor(current * 1.05));
    }
  }

  async function runPlaybackTick(axis) {
    if (!axis || !isPlaying() || state.playbackAxis !== axis) return;
    if (state.playbackBusy) {
      scheduleNextPlaybackTick(axis);
      return;
    }
    state.playbackBusy = true;
    const startedAt = performance.now();
    try {
      await advanceAxisPlayback(axis);
    } finally {
      state.playbackBusy = false;
      tunePlaybackPreviewBudget(performance.now() - startedAt);
    }
    if (typeof prefetchAxisPlaybackFrame === "function") {
      void prefetchAxisPlaybackFrame(axis);
    }
    scheduleNextPlaybackTick(axis);
  }

  function scheduleNextPlaybackTick(axis, delayMs = null) {
    if (!axis || state.playbackAxis !== axis) return;
    if (state.playbackTimer) {
      clearTimeout(state.playbackTimer);
    }
    const waitMs = Number.isFinite(delayMs) && delayMs !== null ? Math.max(0, Math.floor(delayMs)) : playbackIntervalMs();
    state.playbackTimer = setTimeout(() => {
      void runPlaybackTick(axis);
    }, waitMs);
  }

  function playbackMaxPixelsForFrame() {
    const tileCount = deps.isSamplesMode() ? Math.max(1, state.sampleGridIndices.length || 1) : 1;
    const budget = Math.max(40000, state.playbackPreviewMaxPixels);
    return Math.max(20000, Math.floor(budget / tileCount));
  }

  function playbackAxisLength(axis) {
    const hidden = hiddenDim();
    if (axis === sampleMorphAxis) {
      return isSampleMorphMode() ? axisSize("sample") : 1;
    }
    if (isAxisProjectionActive(axis)) return 1;
    if ((isVolumeMode() || isSphereMode()) && axis === hidden) return 1;
    return axisSize(axis);
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

  function updatePlayUi() {
    els.playSpeedSelect.value = String(state.playbackFps);
    if (els.sampleMorphDeltaSelect) {
      els.sampleMorphDeltaSelect.value = String(state.sampleMorphDeltaT);
    }
    updatePlaybackButtons();
    if (typeof onUpdatePlayUi === "function") {
      onUpdatePlayUi();
    }
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
      clearTimeout(state.playbackTimer);
      state.playbackTimer = null;
    }
    state.playbackAxis = null;
    state.playbackRefineToken = (state.playbackRefineToken || 0) + 1;
    updatePlayUi();
    syncSampleMorphPlayback();
    if (refine && wasPlaying) {
      schedulePlaybackRefine();
    }
  }

  function startPlayback(axis) {
    if (!axis || axis === sampleMorphAxis || isAxisSelectorLocked(axis) || playbackAxisLength(axis) <= 1) return;
    stopSampleMorphPlayback();
    stopPlayback(false);
    state.playbackAxis = axis;
    state.playbackPreviewMaxPixels = playbackPreviewBaseMaxPixels;
    if (typeof prefetchAxisPlaybackFrame === "function") {
      void prefetchAxisPlaybackFrame(axis);
    }
    scheduleNextPlaybackTick(axis, 0);

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

  return {
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
  };
}
