const DEFAULT_MAX_EVENTS = 48;

function clampRecent(items, maxItems) {
  if (items.length <= maxItems) return items;
  items.splice(0, items.length - maxItems);
  return items;
}

function roundMs(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function finiteNumber(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteInteger(value) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function displayMs(value) {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)} ms` : "--";
}

function displayBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(2)} MB`;
}

function formatMetricName(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return String(url);
  }
}

function safeMark(name) {
  if (typeof performance?.mark !== "function") return;
  try {
    performance.mark(name);
  } catch (_) {
    // Ignore mark failures in older browser contexts.
  }
}

function safeMeasure(name, startMark, endMark) {
  if (typeof performance?.measure !== "function") return;
  try {
    performance.measure(name, startMark, endMark);
  } catch (_) {
    // Ignore measure failures when marks were cleared or unsupported.
  }
  if (typeof performance?.clearMarks === "function") {
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
  }
  if (typeof performance?.clearMeasures === "function") {
    performance.clearMeasures(name);
  }
}

function parseServerTiming(serverTiming) {
  const summary = {};
  if (typeof serverTiming !== "string" || !serverTiming.trim()) return summary;
  for (const segment of serverTiming.split(",")) {
    const parts = segment
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    const metricName = parts[0];
    if (!metricName) continue;
    for (const part of parts.slice(1)) {
      const [key, rawValue] = part.split("=");
      if (key !== "dur") continue;
      const dur = Number.parseFloat(rawValue);
      if (Number.isFinite(dur)) {
        summary[metricName] = dur;
      }
    }
  }
  return summary;
}

function cloneEvent(event) {
  if (!event || typeof event !== "object") return event;
  return {
    ...event,
    meta: event.meta && typeof event.meta === "object" ? { ...event.meta } : event.meta,
    serverTiming: event.serverTiming && typeof event.serverTiming === "object" ? { ...event.serverTiming } : event.serverTiming,
  };
}

function createPacingBucket() {
  return {
    frames: 0,
    droppedFrames: 0,
    totalDeltaMs: 0,
    deltaSamples: 0,
    totalRenderMs: 0,
    targetMs: null,
    lastCompletedAt: null,
  };
}

function bucketSnapshot(bucket) {
  const avgDeltaMs = bucket.deltaSamples > 0 ? bucket.totalDeltaMs / bucket.deltaSamples : null;
  const avgRenderMs = bucket.frames > 0 ? bucket.totalRenderMs / bucket.frames : null;
  return {
    frames: bucket.frames,
    droppedFrames: bucket.droppedFrames,
    avgDeltaMs: roundMs(avgDeltaMs),
    avgRenderMs: roundMs(avgRenderMs),
    targetMs: roundMs(bucket.targetMs),
  };
}

export function perfEnabledFromLocation(loc = window.location) {
  const params = new URLSearchParams(loc.search || "");
  const raw = String(params.get("perf") || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function createPerfStore(options = {}) {
  const maxEvents = Math.max(8, finiteInteger(options.maxEvents) || DEFAULT_MAX_EVENTS);
  const state = {
    enabled: options.enabled === true,
    sequence: 0,
    recentFetches: [],
    recentRenders: [],
    visibleUpdates: [],
    pendingVisibleUpdate: null,
    lastFetch: null,
    lastRender: null,
    pacing: {
      playback: createPacingBucket(),
      interaction: createPacingBucket(),
      idle: createPacingBucket(),
    },
  };

  const emitChange = () => {
    const summary = getSummary();
    const snapshot = getSnapshot();
    if (typeof window !== "undefined") {
      window.__mobulaPerf = {
        clear,
        enabled: state.enabled,
        getSnapshot,
        getSummary,
        snapshot,
        startVisibleUpdate,
      };
    }
    if (typeof options.onChange === "function") {
      options.onChange(summary, snapshot);
    }
  };

  const normalizeContext = (value) => {
    if (value === "playback" || value === "interaction") return value;
    return "idle";
  };

  const updatePacing = (context, completedAt, durationMs, targetMs) => {
    const bucket = state.pacing[context];
    bucket.frames += 1;
    bucket.totalRenderMs += Number.isFinite(durationMs) ? durationMs : 0;
    bucket.targetMs = Number.isFinite(targetMs) && targetMs > 0 ? targetMs : bucket.targetMs;
    if (Number.isFinite(bucket.lastCompletedAt) && Number.isFinite(completedAt)) {
      const deltaMs = Math.max(0, completedAt - bucket.lastCompletedAt);
      bucket.totalDeltaMs += deltaMs;
      bucket.deltaSamples += 1;
      if (Number.isFinite(bucket.targetMs) && bucket.targetMs > 0) {
        bucket.droppedFrames += Math.max(0, Math.floor(deltaMs / bucket.targetMs) - 1);
      }
    }
    bucket.lastCompletedAt = completedAt;
  };

  function getSnapshot() {
    return {
      enabled: state.enabled,
      pendingVisibleUpdate: state.pendingVisibleUpdate ? cloneEvent(state.pendingVisibleUpdate) : null,
      lastFetch: state.lastFetch ? cloneEvent(state.lastFetch) : null,
      lastRender: state.lastRender ? cloneEvent(state.lastRender) : null,
      recentFetches: state.recentFetches.map(cloneEvent),
      recentRenders: state.recentRenders.map(cloneEvent),
      visibleUpdates: state.visibleUpdates.map(cloneEvent),
      pacing: {
        playback: bucketSnapshot(state.pacing.playback),
        interaction: bucketSnapshot(state.pacing.interaction),
        idle: bucketSnapshot(state.pacing.idle),
      },
    };
  }

  function getSummary() {
    if (!state.enabled) {
      return "Performance metrics disabled. Add ?perf=1 to enable.";
    }

    const lines = ["Performance"];
    if (state.pendingVisibleUpdate) {
      lines.push(`pending: ${state.pendingVisibleUpdate.label}`);
    }
    if (state.lastFetch) {
      const last = state.lastFetch;
      const server = last.serverTiming || {};
      const serverBits = [];
      if (Number.isFinite(server.compute)) serverBits.push(`compute ${displayMs(server.compute)}`);
      if (Number.isFinite(server.serialize)) serverBits.push(`serialize ${displayMs(server.serialize)}`);
      if (Number.isFinite(server.total)) serverBits.push(`total ${displayMs(server.total)}`);
      const cache = last.cache ? `, cache ${last.cache}` : "";
      lines.push(
        `fetch: ${last.label} ${displayMs(last.totalMs)}`
          + ` (${displayMs(last.fetchMs)} net, ${displayMs(last.parseMs)} parse, ${displayBytes(last.responseBytes)})${cache}`
      );
      if (serverBits.length) {
        lines.push(`server: ${serverBits.join(", ")}`);
      }
    } else {
      lines.push("fetch: waiting");
    }

    if (state.lastRender) {
      const last = state.lastRender;
      const visible = Number.isFinite(last.visibleMs) ? `, visible ${displayMs(last.visibleMs)}` : "";
      lines.push(`render: ${last.context} ${displayMs(last.durationMs)}${visible}`);
    } else {
      lines.push("render: waiting");
    }

    for (const [name, bucket] of Object.entries(state.pacing)) {
      const snapshot = bucketSnapshot(bucket);
      lines.push(
        `${name}: ${snapshot.frames} frames, avg render ${displayMs(snapshot.avgRenderMs)}, `
          + `avg pacing ${displayMs(snapshot.avgDeltaMs)}, dropped ${snapshot.droppedFrames}`
      );
    }

    return lines.join("\n");
  }

  function startVisibleUpdate(label, meta = null) {
    if (!state.enabled) return null;
    const id = state.sequence + 1;
    state.sequence = id;
    const startedAt = performance.now();
    const startMark = `mobula-visible-start-${id}`;
    safeMark(startMark);
    state.pendingVisibleUpdate = {
      id,
      label: String(label || "update"),
      meta: meta && typeof meta === "object" ? { ...meta } : null,
      startedAt,
      startMark,
    };
    emitChange();
    return id;
  }

  function ensureVisibleUpdate(label, meta = null) {
    if (state.pendingVisibleUpdate) return state.pendingVisibleUpdate.id;
    return startVisibleUpdate(label, meta);
  }

  function recordFetch(event) {
    if (!state.enabled) return;
    const normalized = {
      cache: event.cache ? String(event.cache) : null,
      completedAt: finiteNumber(event.completedAt) ?? performance.now(),
      computeMs: roundMs(finiteNumber(event.computeMs)),
      fetchMs: roundMs(finiteNumber(event.fetchMs)),
      label: formatMetricName(event.label || event.url || "fetch"),
      loadMs: roundMs(finiteNumber(event.loadMs)),
      ok: event.ok !== false,
      parseMs: roundMs(finiteNumber(event.parseMs)),
      requestMs: roundMs(finiteNumber(event.requestMs)),
      responseBytes: finiteInteger(event.responseBytes),
      serializeMs: roundMs(finiteNumber(event.serializeMs)),
      serverTiming: parseServerTiming(event.serverTiming),
      status: finiteInteger(event.status),
      totalMs: roundMs((finiteNumber(event.fetchMs) || 0) + (finiteNumber(event.parseMs) || 0)),
    };
    state.lastFetch = normalized;
    state.recentFetches.push(normalized);
    clampRecent(state.recentFetches, maxEvents);
    emitChange();
  }

  function recordRender(event) {
    if (!state.enabled) return;
    const completedAt = finiteNumber(event.completedAt) ?? performance.now();
    const context = normalizeContext(event.context);
    const normalized = {
      completedAt,
      context,
      drawMode: event.drawMode ? String(event.drawMode) : "single",
      durationMs: roundMs(finiteNumber(event.durationMs)),
      framePixels: finiteInteger(event.framePixels),
      label: String(event.label || "viewer-frame"),
      meta: event.meta && typeof event.meta === "object" ? { ...event.meta } : null,
      targetMs: roundMs(finiteNumber(event.targetMs)),
      visibleMs: null,
    };
    updatePacing(context, completedAt, normalized.durationMs, normalized.targetMs);

    if (state.pendingVisibleUpdate) {
      const visibleMs = Math.max(0, completedAt - state.pendingVisibleUpdate.startedAt);
      const endMark = `mobula-visible-end-${state.pendingVisibleUpdate.id}`;
      const measureName = `mobula-visible-${state.pendingVisibleUpdate.id}`;
      safeMark(endMark);
      safeMeasure(measureName, state.pendingVisibleUpdate.startMark, endMark);
      normalized.visibleMs = roundMs(visibleMs);
      state.visibleUpdates.push({
        context,
        id: state.pendingVisibleUpdate.id,
        label: state.pendingVisibleUpdate.label,
        meta: state.pendingVisibleUpdate.meta,
        visibleMs: roundMs(visibleMs),
      });
      clampRecent(state.visibleUpdates, maxEvents);
      state.pendingVisibleUpdate = null;
    }

    state.lastRender = normalized;
    state.recentRenders.push(normalized);
    clampRecent(state.recentRenders, maxEvents);
    emitChange();
  }

  function clear() {
    state.sequence = 0;
    state.recentFetches.length = 0;
    state.recentRenders.length = 0;
    state.visibleUpdates.length = 0;
    state.pendingVisibleUpdate = null;
    state.lastFetch = null;
    state.lastRender = null;
    state.pacing.playback = createPacingBucket();
    state.pacing.interaction = createPacingBucket();
    state.pacing.idle = createPacingBucket();
    emitChange();
  }

  emitChange();

  return {
    clear,
    ensureVisibleUpdate,
    enabled: state.enabled,
    getSnapshot,
    getSummary,
    recordFetch,
    recordRender,
    startVisibleUpdate,
  };
}
