export function createOfflineRenderController(deps) {
  const {
    state,
    els,
    renderJob,
    sampleMorphAxis,
    renderAxisRotate,
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
    setRenderOverlayOverride,
    updateSliderReadouts,
    refreshSelectionAnalytics,
    updateRenderMovieDialogActions,
    updateExportButtonState,
    computeSampleMorphRenderFrameCount,
    computeRenderRotationFrameCount,
    blobToDataUrl,
  } = deps;

  function buildRenderFrameCanvas(resolution = "canvas", options = null) {
    const source = visibleCanvasForSnapshot(els.canvas);
    if (!source) throw new Error("Viewer canvas is not available.");
    const includeColorbar = !options || options.includeColorbar !== false;
    const colorbar = includeColorbar ? visibleCanvasForSnapshot(els.colorbarCanvas, els.colorbarPanel) : null;
    const sourceW = Math.max(1, source.width);
    const sourceH = Math.max(1, source.height);
    const colorbarH = colorbar ? Math.max(1, colorbar.height) : 0;
    const gap = colorbar ? 8 : 0;
    const rawOutW = sourceW;
    const rawOutH = sourceH + (colorbar ? colorbarH + gap : 0);
    const dims = resolveRenderFrameDimensions(rawOutW, rawOutH, resolution);
    const mainH = Math.max(1, Math.round((sourceH / rawOutH) * dims.height));
    const colorH = colorbar ? Math.max(1, Math.round((colorbarH / rawOutH) * dims.height)) : 0;
    const gapH = colorbar ? Math.max(1, dims.height - mainH - colorH) : 0;

    const out = document.createElement("canvas");
    out.width = dims.width;
    out.height = dims.height;
    const ctx = out.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not initialize render frame canvas.");
    ctx.fillStyle = "#060d16";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, out.width, mainH);
    if (colorbar) {
      ctx.drawImage(colorbar, 0, 0, colorbar.width, colorbar.height, 0, mainH + gapH, out.width, colorH);
    }
    return out;
  }

  function renderFrameInterpolationFactor(axis) {
    if (axis === "t") return temporalScaleFactor();
    if (axis === "nu") return spectralScaleFactor();
    return 1;
  }

  function computeRenderFramePositions(axis) {
    const axisLen = Math.max(1, axisSize(axis));
    let start = 0;
    let end = axisLen - 1;
    if (axis === "t" || axis === "nu") {
      const [w0, w1] = getAxisWindow(axis, axisLen);
      start = w0;
      end = w1;
    }
    const frameCount = end - start + 1;
    const factor = renderFrameInterpolationFactor(axis);
    const targetN = resampledDomainLength(frameCount, factor);
    if (targetN <= 1 || frameCount <= 1) {
      return [start];
    }

    const srcSpan = frameCount - 1;
    const dstSpan = targetN - 1;
    const out = [];
    for (let i = 0; i < targetN; i += 1) {
      const srcPos = (i * srcSpan) / dstSpan;
      out.push(start + srcPos);
    }
    return out;
  }

  function formatEtaMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "--";
    const totalSec = Math.round(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function showRenderProgressOverlay() {
    if (!els.renderProgressOverlay) return;
    els.renderProgressOverlay.hidden = false;
  }

  function hideRenderProgressOverlay() {
    if (!els.renderProgressOverlay) return;
    els.renderProgressOverlay.hidden = true;
  }

  function updateRenderProgressOverlay(extraMessage = "") {
    const total = Math.max(1, renderJob.totalFrames);
    const completed = clamp(renderJob.completedFrames, 0, total);
    const pct = Math.round((completed / total) * 100);
    if (els.renderProgressPrimary) {
      els.renderProgressPrimary.textContent = `${pct}%`;
    }
    if (els.renderProgressSecondary) {
      const suffix = extraMessage ? ` | ${extraMessage}` : "";
      els.renderProgressSecondary.textContent = `Frame ${completed} / ${total}${suffix}`;
    }
    if (els.renderProgressEta) {
      if (completed <= 0 || renderJob.encoding) {
        els.renderProgressEta.textContent = renderJob.encoding ? "ETA encoding..." : "ETA --";
      } else {
        const elapsed = Date.now() - renderJob.startedAtMs;
        const avg = elapsed / completed;
        const remainingMs = avg * (total - completed);
        els.renderProgressEta.textContent = `ETA ${formatEtaMs(remainingMs)}`;
      }
    }
  }

  function makeRenderCancelError() {
    const err = new Error("render canceled");
    err.name = "AbortError";
    return err;
  }

  function requestRenderCancel() {
    if (!renderJob.running) return;
    renderJob.cancelRequested = true;
    if (renderJob.fetchAbortController) {
      try {
        renderJob.fetchAbortController.abort();
      } catch (_) {
        // ignore abort errors
      }
    }
    updateRenderProgressOverlay("Canceling...");
  }

  async function nextAnimationFrame() {
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve(null));
    });
  }

  function sleepMs(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, ms));
    });
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("failed to decode rendered frame"));
      img.src = dataUrl;
    });
  }

  async function encodeFramesToWebmDataUrl(frames, fps) {
    if (!Array.isArray(frames) || frames.length < 1) {
      throw new Error("No rendered frames to encode.");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("Fallback render encoding requires MediaRecorder support.");
    }
    const candidateMimes = [];
    const preferredMime = preferredMovieMimeType();
    if (preferredMime) candidateMimes.push(preferredMime);
    candidateMimes.push("video/webm;codecs=vp8", "video/webm");
    const uniqueMimes = Array.from(new Set(candidateMimes)).filter((mime) => {
      if (typeof MediaRecorder.isTypeSupported !== "function") return true;
      return MediaRecorder.isTypeSupported(mime);
    });
    if (!uniqueMimes.length) {
      throw new Error("Fallback render encoding requires WebM MediaRecorder support.");
    }

    const first = await loadImageFromDataUrl(frames[0].data_url);
    const frameDurationMs = Math.max(1, Math.round(1000 / Math.max(1, fps)));
    let lastErr = null;

    for (const mimeType of uniqueMimes) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, first.naturalWidth || first.width || 2);
      canvas.height = Math.max(2, first.naturalHeight || first.height || 2);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Could not initialize fallback render encoder canvas.");

      const stream = canvas.captureStream(Math.max(1, fps));
      const track = stream.getVideoTracks().length ? stream.getVideoTracks()[0] : null;
      const chunks = [];
      let stopResolve = null;
      let stopReject = null;
      const stopPromise = new Promise((resolve, reject) => {
        stopResolve = resolve;
        stopReject = reject;
      });
      let recorder = null;
      try {
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        recorder.onerror = (ev) => {
          if (stopReject) {
            stopReject(ev && ev.error ? ev.error : new Error("fallback render encoding failed"));
          }
        };
        recorder.onstop = () => {
          if (stopResolve) stopResolve(null);
        };
        recorder.start(250);

        for (let i = 0; i < frames.length; i += 1) {
          if (renderJob.cancelRequested) throw makeRenderCancelError();
          const img = i === 0 ? first : await loadImageFromDataUrl(frames[i].data_url);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          if (track && typeof track.requestFrame === "function") {
            try {
              track.requestFrame();
            } catch (_) {
              // ignore requestFrame failures
            }
          }
          await sleepMs(frameDurationMs);
        }
        await sleepMs(frameDurationMs);
        try {
          if (typeof recorder.requestData === "function") recorder.requestData();
        } catch (_) {
          // ignore requestData failures
        }
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        await stopPromise;
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size > 0) {
          for (const t of stream.getTracks()) {
            try {
              t.stop();
            } catch (_) {
              // ignore cleanup failures
            }
          }
          return blobToDataUrl(blob);
        }
        lastErr = new Error(`Fallback render encoding produced no video data for ${mimeType}.`);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err || "fallback render encoding failed"));
        try {
          if (recorder && recorder.state !== "inactive") recorder.stop();
        } catch (_) {
          // ignore stop failures
        }
      } finally {
        for (const t of stream.getTracks()) {
          try {
            t.stop();
          } catch (_) {
            // ignore cleanup failures
          }
        }
      }
    }

    if (lastErr) throw lastErr;
    throw new Error("Fallback render encoding produced no video data.");
  }

  async function runOfflineRenderFromDialog() {
    if (!state.dataId) return;
    if (renderJob.running) return;

    deps.readRenderSettingsFromUi();
    state.renderMoviePrefs.overwrite = Boolean(els.renderMovieOverwriteChk ? els.renderMovieOverwriteChk.checked : true);
    if (els.renderMovieFilenameInput) {
      state.renderMoviePrefs.filename = normalizeRenderMovieFilename(
        els.renderMovieFilenameInput.value,
        state.renderMoviePrefs.format
      );
    }
    state.renderMoviePrefs.quality = normalizeRecordQuality(state.renderMoviePrefs.quality);

    if (!state.renderMoviePrefs.outputDir) {
      setRenderMovieStatus("Choose a destination folder.", true);
      const selected = await chooseRenderMovieFolder();
      if (!selected) return;
    }

    closeRenderMovieDialog();

    if (!canRenderSweepAxis(state.renderMoviePrefs.axis)) {
      throw new Error("Selected axis is not currently renderable.");
    }
    const axis = resolveRenderSweepAxis(state.renderMoviePrefs.axis);
    if (axis !== sampleMorphAxis && axis !== renderAxisRotate) {
      if (isAxisSelectorLocked(axis)) {
        throw new Error(`Axis ${axisDisplayLabel(axis)} cannot be swept in the current mode.`);
      }
      if (isAxisProjectionActive(axis)) {
        throw new Error(`Axis ${axisDisplayLabel(axis)} is projected; disable projection before rendering.`);
      }
    }
    const fps = normalizeRenderFps(state.renderMoviePrefs.fps);
    const baseFramePositions = axis === sampleMorphAxis || axis === renderAxisRotate ? [] : computeRenderFramePositions(axis);
    const baseFrameCount = axis === sampleMorphAxis
      ? computeSampleMorphRenderFrameCount(fps)
      : axis === renderAxisRotate
      ? computeRenderRotationFrameCount(fps)
      : baseFramePositions.length;
    if (!baseFrameCount) {
      throw new Error("No frames to render for the current range.");
    }
    const loopCount = normalizeRenderLoops(state.renderMoviePrefs.loops);
    const renderedFrameCount = baseFrameCount;

    const restoreValues = { ...state.values };
    const restoreSampleState = {
      sampleMode: state.sampleMode,
      sampleSingleView: state.sampleSingleView,
      sampleGridSize: state.sampleGridSize,
      sampleGridIndices: cloneSessionValue(state.sampleGridIndices),
      activeSampleTile: state.activeSampleTile,
      sampleMorph: cloneSessionValue(state.sampleMorph),
    };
    const restoreViewState = {
      volumeYaw: state.volumeYaw,
      volumePitch: state.volumePitch,
      volumeRotationMatrix: cloneSessionValue(state.volumeRotationMatrix),
      volumeRotateAxisObject: cloneSessionValue(state.volumeRotateAxisObject),
      sphereYaw: state.sphereYaw,
      spherePitch: state.spherePitch,
      sphereRotationMatrix: cloneSessionValue(state.sphereRotationMatrix),
      sphereRotateAxisObject: cloneSessionValue(state.sphereRotateAxisObject),
    };
    const wasPlaying = isPlaying();
    const wasSampleMorphPlaying = isSampleMorphPlaybackActive();
    const renderDataId = state.dataId;

    if (wasPlaying) stopPlayback(false);
    if (wasSampleMorphPlaying) stopSampleMorphPlayback();

    renderJob.running = true;
    renderJob.cancelRequested = false;
    renderJob.startedAtMs = Date.now();
    renderJob.totalFrames = renderedFrameCount;
    renderJob.completedFrames = 0;
    renderJob.encoding = false;
    renderJob.dataId = renderDataId;
    renderJob.fetchAbortController = null;
    showRenderProgressOverlay();
    updateRenderProgressOverlay();
    updateExportButtonState();
    setRenderOverlayOverride({
      includeSkyDirections: normalizeRenderOverlayOption(state.renderMoviePrefs.includeSkyDirections),
      includeLengthScale: normalizeRenderOverlayOption(state.renderMoviePrefs.includeLengthScale),
      includeSampleLabels: normalizeRenderOverlayOption(state.renderMoviePrefs.includeSampleLabels),
    });
    drawFrameAndOverlays();

    const frames = [];
    try {
      const cycleFrames = [];
      if (axis === sampleMorphAxis && !isSampleMorphMode()) {
        const sampleIdx = clamp(state.values.sample, 0, Math.max(0, sampleCount() - 1));
        state.sampleMode = "single";
        state.sampleSingleView = "morph";
        state.sampleGridIndices = [sampleIdx];
        state.activeSampleTile = 0;
        resetSampleMorphState();
        updateControlCaps();
        await refreshSlice();
      }
      if (axis === sampleMorphAxis) {
        await prepareSampleMorphPair(null, false);
        const frameDeltaSec = 1 / Math.max(1, fps);
        for (let i = 0; i < baseFrameCount; i += 1) {
          if (renderJob.cancelRequested) throw makeRenderCancelError();
          if (i > 0) {
            await advanceSampleMorphPlayback(frameDeltaSec, { fullResolution: true });
          }
          await nextAnimationFrame();
          const frameCanvas = buildRenderFrameCanvas(state.renderMoviePrefs.resolution, state.renderMoviePrefs);
          const dataUrl = frameCanvas.toDataURL("image/png");
          cycleFrames.push(dataUrl);
          frames.push({ data_url: dataUrl });
          renderJob.completedFrames = i + 1;
          updateRenderProgressOverlay();
        }
      } else if (axis === renderAxisRotate) {
        const direction = normalizeViewRotateRate(state.viewRotateRate) < 0 ? -1 : 1;
        const angleStep = (direction * Math.PI * 2) / Math.max(1, baseFrameCount);
        for (let i = 0; i < baseFrameCount; i += 1) {
          if (renderJob.cancelRequested) throw makeRenderCancelError();
          if (i > 0) {
            if (isVolumeMode()) {
              applyVolumeAutoRotateDelta(angleStep);
              rerenderVolumeFrame();
            } else if (isSphereMode()) {
              applySphereAutoRotateDelta(angleStep);
              rerenderSphereFrame();
            }
          }
          await nextAnimationFrame();
          const frameCanvas = buildRenderFrameCanvas(state.renderMoviePrefs.resolution, state.renderMoviePrefs);
          const dataUrl = frameCanvas.toDataURL("image/png");
          cycleFrames.push(dataUrl);
          frames.push({ data_url: dataUrl });
          renderJob.completedFrames = i + 1;
          updateRenderProgressOverlay();
        }
      } else {
        const endpointFrameCanvasCache = new Map();
        let blendReuseCanvas = null;
        const captureEndpointFrame = async (idx) => {
          const key = String(idx);
          if (endpointFrameCanvasCache.has(key)) return endpointFrameCanvasCache.get(key);
          await setAxisIndex(axis, idx, { playback: true });
          await nextAnimationFrame();
          const frameCanvas = buildRenderFrameCanvas(state.renderMoviePrefs.resolution, state.renderMoviePrefs);
          endpointFrameCanvasCache.set(key, frameCanvas);
          return frameCanvas;
        };
        for (let i = 0; i < baseFramePositions.length; i += 1) {
          if (renderJob.cancelRequested) throw makeRenderCancelError();
          const framePos = baseFramePositions[i];
          const lower = clamp(Math.floor(framePos), 0, axisSize(axis) - 1);
          const upper = clamp(Math.ceil(framePos), 0, axisSize(axis) - 1);
          let frameCanvas;
          if (lower === upper || Math.abs(framePos - lower) <= 1.0e-6 || Math.abs(upper - framePos) <= 1.0e-6) {
            frameCanvas = await captureEndpointFrame(clamp(Math.round(framePos), 0, axisSize(axis) - 1));
          } else {
            const alpha = clamp(framePos - lower, 0, 1);
            const fromCanvas = await captureEndpointFrame(lower);
            const toCanvas = await captureEndpointFrame(upper);
            frameCanvas = blendCanvasPair(fromCanvas, toCanvas, alpha, blendReuseCanvas);
            blendReuseCanvas = frameCanvas;
          }
          const dataUrl = frameCanvas.toDataURL("image/png");
          cycleFrames.push(dataUrl);
          frames.push({ data_url: dataUrl });
          renderJob.completedFrames = i + 1;
          updateRenderProgressOverlay();
        }
      }

      if (loopCount > 1) {
        updateRenderProgressOverlay("Loop duplication...");
        for (let loop = 2; loop <= loopCount; loop += 1) {
          for (let i = 0; i < cycleFrames.length; i += 1) {
            if (renderJob.cancelRequested) throw makeRenderCancelError();
            frames.push({ data_url: cycleFrames[i] });
          }
          updateRenderProgressOverlay();
        }
      }

      if (renderJob.cancelRequested) throw makeRenderCancelError();

      renderJob.encoding = true;
      updateRenderProgressOverlay("Encoding...");
      const saveBody = {
        output_dir: state.renderMoviePrefs.outputDir,
        format: normalizeRecordMovieFormat(state.renderMoviePrefs.format),
        filename: state.renderMoviePrefs.filename,
        overwrite: state.renderMoviePrefs.overwrite !== false,
        fps,
        quality: state.renderMoviePrefs.quality,
        frames,
      };

      let response = null;
      try {
        renderJob.fetchAbortController = new AbortController();
        response = await fetchJson(`/api/datasets/${renderDataId}/save-render-movie`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: renderJob.fetchAbortController.signal,
          body: JSON.stringify(saveBody),
        });
      } catch (err) {
        if (isNotFoundError(err)) {
          updateRenderProgressOverlay("Compatibility encoding...");
          const dataUrl = await encodeFramesToWebmDataUrl(frames, fps);
          if (renderJob.cancelRequested) throw makeRenderCancelError();
          updateRenderProgressOverlay("Compatibility save...");
          renderJob.fetchAbortController = new AbortController();
          response = await fetchJson(`/api/datasets/${renderDataId}/save-movie`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: renderJob.fetchAbortController.signal,
            body: JSON.stringify({
              output_dir: state.renderMoviePrefs.outputDir,
              format: normalizeRecordMovieFormat(state.renderMoviePrefs.format),
              filename: state.renderMoviePrefs.filename,
              overwrite: state.renderMoviePrefs.overwrite !== false,
              data_url: dataUrl,
            }),
          });
        } else {
          throw err;
        }
      }

      if (!response || !response.saved) {
        throw new Error((response && response.detail) || "render save failed");
      }
      setSystemPickerStatus(`Saved movie: ${response.path}`);
    } catch (err) {
      if (isAbortError(err) || renderJob.cancelRequested) {
        setSystemPickerStatus("Render canceled.");
        return;
      }
      throw err;
    } finally {
      setRenderOverlayOverride(null);
      drawFrameAndOverlays();
      renderJob.running = false;
      renderJob.cancelRequested = false;
      renderJob.encoding = false;
      renderJob.fetchAbortController = null;
      renderJob.completedFrames = 0;
      renderJob.totalFrames = 0;
      hideRenderProgressOverlay();

      state.values = { ...state.values, ...restoreValues };
      state.sampleMode = restoreSampleState.sampleMode;
      state.sampleSingleView = restoreSampleState.sampleSingleView;
      state.sampleGridSize = restoreSampleState.sampleGridSize;
      state.sampleGridIndices = cloneSessionValue(restoreSampleState.sampleGridIndices);
      state.activeSampleTile = restoreSampleState.activeSampleTile;
      state.sampleMorph = cloneSessionValue(restoreSampleState.sampleMorph);
      state.volumeYaw = restoreViewState.volumeYaw;
      state.volumePitch = restoreViewState.volumePitch;
      state.volumeRotationMatrix = cloneSessionValue(restoreViewState.volumeRotationMatrix);
      state.volumeRotateAxisObject = cloneSessionValue(restoreViewState.volumeRotateAxisObject);
      state.sphereYaw = restoreViewState.sphereYaw;
      state.spherePitch = restoreViewState.spherePitch;
      state.sphereRotationMatrix = cloneSessionValue(restoreViewState.sphereRotationMatrix);
      state.sphereRotateAxisObject = cloneSessionValue(restoreViewState.sphereRotateAxisObject);
      updateSliderReadouts(state.selectedCoords);
      updateControlCaps();
      await refreshSlice();
      if (state.selection) await refreshSelectionAnalytics();
      updateRenderMovieDialogActions();
      updateExportButtonState();
    }
  }

  return {
    requestRenderCancel,
    runOfflineRenderFromDialog,
  };
}
