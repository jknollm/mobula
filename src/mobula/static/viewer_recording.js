export function createMovieRecordingController(deps) {
  const {
    state,
    els,
    movieRecording,
    recordStopTimeoutMs,
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
  } = deps;

  function isMovieRecordingActive() {
    return Boolean(movieRecording.recorder && movieRecording.recorder.state === "recording");
  }

  function hasPendingMovieRecording() {
    return Boolean(movieRecording.pendingBlob && movieRecording.pendingBlob.size > 0);
  }

  function preferredMovieMimeType() {
    if (typeof MediaRecorder === "undefined") return null;
    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    if (typeof MediaRecorder.isTypeSupported !== "function") return "video/webm";
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return null;
  }

  function isMovieRecordingSupported() {
    if (!els.canvas || typeof els.canvas.captureStream !== "function") return false;
    return Boolean(preferredMovieMimeType());
  }

  function beginMovieCompositor(qualityCfg) {
    const cfg = qualityCfg || recordQualityConfig(state.recordMoviePrefs.quality);
    const source = visibleCanvasForSnapshot(els.canvas);
    if (!source) throw new Error("Viewer canvas is not available.");
    const colorbar = visibleCanvasForSnapshot(els.colorbarCanvas, els.colorbarPanel);
    const sourceW = Math.max(1, source.width);
    const sourceH = Math.max(1, source.height);
    const colorbarH = colorbar ? Math.max(1, colorbar.height) : 0;
    const gap = colorbar ? 3 : 0;
    const rawOutW = sourceW;
    const rawOutH = sourceH + (colorbar ? colorbarH + gap : 0);
    const pixelCount = rawOutW * rawOutH;
    const scale = pixelCount > cfg.maxPixels
      ? Math.sqrt(cfg.maxPixels / Math.max(1, pixelCount))
      : 1;

    const out = document.createElement("canvas");
    const targetW = Math.max(2, Math.round(rawOutW * scale));
    const targetH = Math.max(2, Math.round(rawOutH * scale));
    out.width = targetW % 2 === 0 ? targetW : targetW + 1;
    out.height = targetH % 2 === 0 ? targetH : targetH + 1;
    const ctx = out.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("Could not initialize movie recorder canvas.");

    const drawMainH = Math.max(1, Math.round(sourceH * scale));
    const drawColorbarH = colorbar ? Math.max(1, Math.round(colorbarH * scale)) : 0;
    const drawGap = colorbar ? Math.max(1, Math.round(gap * scale)) : 0;

    const drawFrame = () => {
      ctx.fillStyle = "#060d16";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, out.width, drawMainH);
      if (colorbar) {
        ctx.drawImage(colorbar, 0, 0, colorbar.width, colorbar.height, 0, drawMainH + drawGap, out.width, drawColorbarH);
      }
    };
    drawFrame();
    const frameIntervalMs = Math.max(16, Math.round(1000 / Math.max(1, cfg.fps)));
    const timerId = window.setInterval(drawFrame, frameIntervalMs);

    const stream = out.captureStream(cfg.fps);
    const stopDrawing = () => {
      window.clearInterval(timerId);
    };
    return {
      stream,
      stopDrawing,
      stop: () => {
        stopDrawing();
        for (const track of stream.getTracks()) {
          track.stop();
        }
      },
    };
  }

  function clearPendingMovieRecording() {
    movieRecording.pendingBlob = null;
    movieRecording.pendingMimeType = "";
    movieRecording.pendingDataId = null;
  }

  function resetMovieRecordingRuntime(clearPending = false) {
    if (movieRecording.stopDrawing) {
      try {
        movieRecording.stopDrawing();
      } catch (_) {
        // ignore cleanup failures
      }
    }
    if (movieRecording.stopCompositor) {
      try {
        movieRecording.stopCompositor();
      } catch (_) {
        // ignore cleanup failures
      }
    } else if (movieRecording.stream) {
      for (const track of movieRecording.stream.getTracks()) {
        try {
          track.stop();
        } catch (_) {
          // ignore cleanup failures
        }
      }
    }
    movieRecording.recorder = null;
    movieRecording.stream = null;
    movieRecording.stopDrawing = null;
    movieRecording.stopCompositor = null;
    movieRecording.chunks = [];
    movieRecording.mimeType = "video/webm";
    movieRecording.dataId = null;
    movieRecording.startedAtMs = 0;
    movieRecording.stopPromise = null;
    if (clearPending) {
      clearPendingMovieRecording();
    }
  }

  async function startMovieRecordingFromToolbar() {
    if (!state.dataId) return;
    if (isMovieRecordingActive() || movieRecording.stopping) return;
    if (!isMovieRecordingSupported()) {
      throw new Error("Movie recording is not supported in this browser.");
    }

    state.recordMoviePrefs.quality = normalizeRecordQuality(state.recordMoviePrefs.quality);
    const qualityCfg = recordQualityConfig(state.recordMoviePrefs.quality);
    if (els.recordMovieDialog && els.recordMovieDialog.open) {
      closeRecordMovieDialog();
    }
    clearPendingMovieRecording();
    setSystemPickerStatus(`Starting recording (${qualityCfg.label})...`);
    const mimeType = preferredMovieMimeType() || "video/webm";
    const compositor = beginMovieCompositor(qualityCfg);
    const chunks = [];
    const recorderOpts = { mimeType, videoBitsPerSecond: qualityCfg.bitrate };
    let recorder = null;
    try {
      recorder = new MediaRecorder(compositor.stream, recorderOpts);
    } catch (err) {
      compositor.stop();
      throw err;
    }

    let settled = false;
    let resolveStop = null;
    let rejectStop = null;
    const stopPromise = new Promise((resolve, reject) => {
      resolveStop = resolve;
      rejectStop = reject;
    });
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      if (resolveStop) resolveStop();
    };
    const rejectOnce = (err) => {
      if (settled) return;
      settled = true;
      const wrapped = err instanceof Error ? err : new Error(String(err || "recording failed"));
      if (rejectStop) rejectStop(wrapped);
    };

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onerror = (ev) => {
      rejectOnce(ev && ev.error ? ev.error : new Error("recording failed"));
    };
    recorder.onstop = () => {
      resolveOnce();
    };

    try {
      recorder.start(250);
    } catch (err) {
      compositor.stop();
      throw err;
    }

    movieRecording.recorder = recorder;
    movieRecording.stream = compositor.stream;
    movieRecording.stopDrawing = compositor.stopDrawing;
    movieRecording.stopCompositor = compositor.stop;
    movieRecording.chunks = chunks;
    movieRecording.mimeType = mimeType;
    movieRecording.dataId = state.dataId;
    movieRecording.startedAtMs = Date.now();
    movieRecording.stopPromise = stopPromise;
    movieRecording.stopping = false;
    updateExportButtonState();
    setSystemPickerStatus(`Recording central panel (${qualityCfg.label})`);
  }

  async function stopMovieRecordingForExport() {
    if (!movieRecording.recorder) return;
    if (movieRecording.stopping) return;
    movieRecording.stopping = true;
    updateExportButtonState();
    setSystemPickerStatus("Stopping recording...");

    const recorder = movieRecording.recorder;
    const stopPromise = movieRecording.stopPromise;
    let stopError = null;
    let stopTimedOut = false;
    try {
      if (movieRecording.stopDrawing) {
        try {
          movieRecording.stopDrawing();
        } catch (_) {
          // ignore stopDrawing errors
        }
      }
      try {
        if (typeof recorder.requestData === "function") {
          recorder.requestData();
        }
      } catch (_) {
        // ignore requestData errors
      }
      try {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (_) {
        // ignore stop errors and continue cleanup
      }
      if (stopPromise) {
        await Promise.race([
          stopPromise,
          new Promise((resolve) => {
            window.setTimeout(() => {
              stopTimedOut = true;
              resolve(null);
            }, recordStopTimeoutMs);
          }),
        ]);
      }
    } catch (err) {
      stopError = err;
    }

    const chunks = movieRecording.chunks.slice();
    const mimeType = movieRecording.mimeType || "video/webm";
    const dataId = movieRecording.dataId || state.dataId;
    const startedAt = movieRecording.startedAtMs || 0;
    resetMovieRecordingRuntime(false);
    movieRecording.stopping = false;
    updateExportButtonState();
    if (stopError) {
      throw stopError;
    }
    if (stopTimedOut) {
      setSystemPickerStatus("Recording stop timed out; attempting export with captured frames.", true);
    }

    if (!chunks.length) {
      throw new Error("No recording data captured.");
    }
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 1) {
      throw new Error("No recording data captured.");
    }
    if (!dataId) {
      throw new Error("No dataset selected for movie export.");
    }

    movieRecording.pendingBlob = blob;
    movieRecording.pendingMimeType = mimeType;
    movieRecording.pendingDataId = dataId;
    if (!state.recordMoviePrefs.filename) {
      state.recordMoviePrefs.filename = defaultRecordMovieFilename(state.recordMoviePrefs.format);
    }
    state.recordMoviePrefs.filename = normalizeRecordMovieFilename(state.recordMoviePrefs.filename, state.recordMoviePrefs.format);
    openRecordMovieDialog();
    const durationSec = startedAt > 0 ? (Date.now() - startedAt) / 1000 : 0;
    setRecordMovieStatus(`Recording ready (${durationSec.toFixed(1)}s). Choose format and save.`);
  }

  function discardPendingMovieRecording() {
    clearPendingMovieRecording();
    closeRecordMovieDialog();
    setSystemPickerStatus("Recording discarded.");
  }

  async function savePendingMovieFromDialog() {
    if (!hasPendingMovieRecording()) {
      throw new Error("No recording available to save.");
    }
    if (!els.recordMovieFilenameInput || !els.recordMovieOverwriteChk) return;

    state.recordMoviePrefs.format = normalizeRecordMovieFormat(state.recordMoviePrefs.format);
    state.recordMoviePrefs.filename = normalizeRecordMovieFilename(
      els.recordMovieFilenameInput.value,
      state.recordMoviePrefs.format
    );
    state.recordMoviePrefs.overwrite = Boolean(els.recordMovieOverwriteChk.checked);

    if (!state.recordMoviePrefs.outputDir) {
      setRecordMovieStatus("Choose a destination folder.", true);
      const selected = await chooseRecordMovieFolder();
      if (!selected) return;
    }

    const dataId = movieRecording.pendingDataId || state.dataId;
    if (!dataId) {
      throw new Error("No dataset selected for movie export.");
    }

    movieRecording.saving = true;
    updateRecordMovieDialogActions();
    try {
      setRecordMovieStatus("Encoding movie...");
      const dataUrl = await blobToDataUrl(movieRecording.pendingBlob);
      setRecordMovieStatus("Saving movie...");
      const response = await fetchJson(`/api/datasets/${dataId}/save-movie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          output_dir: state.recordMoviePrefs.outputDir,
          format: state.recordMoviePrefs.format,
          filename: state.recordMoviePrefs.filename,
          overwrite: state.recordMoviePrefs.overwrite !== false,
          data_url: dataUrl,
        }),
      });
      if (!response.saved) {
        throw new Error(response.detail || "save failed");
      }
      clearPendingMovieRecording();
      closeRecordMovieDialog();
      setSystemPickerStatus(`Saved movie: ${response.path}`);
    } finally {
      movieRecording.saving = false;
      updateRecordMovieDialogActions();
    }
  }

  return {
    discardPendingMovieRecording,
    hasPendingMovieRecording,
    isMovieRecordingActive,
    isMovieRecordingSupported,
    preferredMovieMimeType,
    savePendingMovieFromDialog,
    startMovieRecordingFromToolbar,
    stopMovieRecordingForExport,
  };
}
