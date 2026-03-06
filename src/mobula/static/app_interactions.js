export function bindCanvasInteractions(ctx) {
  const {
    axisFromNavKind,
    axisFromProfileKind,
    axisSize,
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
    clearHoverProbe,
    state,
    updateHoverProbeFromEvent,
  } = ctx;
  const modeForEvent = (ev) => {
    if (typeof effectiveDragMode === "function") return effectiveDragMode(ev);
    if (ev && ev.metaKey) return "zoom";
    if (ev && ev.shiftKey) return "investigate";
    return state.dragMode;
  };
  let volumeDragRaf = 0;
  let volumeDragTimer = 0;
  let volumeDragLastRenderAt = 0;
  let sphereDragRaf = 0;
  let sphereDragTimer = 0;
  let sphereDragLastRenderAt = 0;
  const VOLUME_DRAG_MIN_RENDER_INTERVAL_MS = 72;
  const SPHERE_DRAG_MIN_RENDER_INTERVAL_MS = 28;
  const runVolumeDragRender = () => {
    volumeDragRaf = 0;
    volumeDragTimer = 0;
    if (!state.volumeDrag) return;
    volumeDragLastRenderAt = performance.now();
    rerenderVolumeFrame();
  };
  const scheduleVolumeDragRender = () => {
    if (volumeDragRaf || !state.volumeDrag) return;
    const now = performance.now();
    const elapsed = now - volumeDragLastRenderAt;
    if (elapsed >= VOLUME_DRAG_MIN_RENDER_INTERVAL_MS) {
      volumeDragRaf = window.requestAnimationFrame(runVolumeDragRender);
      return;
    }
    if (volumeDragTimer) return;
    const waitMs = Math.max(0, VOLUME_DRAG_MIN_RENDER_INTERVAL_MS - elapsed);
    volumeDragTimer = window.setTimeout(() => {
      volumeDragTimer = 0;
      if (volumeDragRaf || !state.volumeDrag) return;
      volumeDragRaf = window.requestAnimationFrame(runVolumeDragRender);
    }, waitMs);
  };
  const scheduleSphereDragRender = () => {
    if (sphereDragRaf || !state.sphereDrag) return;
    const now = performance.now();
    const elapsed = now - sphereDragLastRenderAt;
    if (elapsed >= SPHERE_DRAG_MIN_RENDER_INTERVAL_MS) {
      sphereDragRaf = window.requestAnimationFrame(() => {
        sphereDragRaf = 0;
        sphereDragTimer = 0;
        if (!state.sphereDrag) return;
        sphereDragLastRenderAt = performance.now();
        rerenderSphereFrame();
      });
      return;
    }
    if (sphereDragTimer) return;
    const waitMs = Math.max(0, SPHERE_DRAG_MIN_RENDER_INTERVAL_MS - elapsed);
    sphereDragTimer = window.setTimeout(() => {
      sphereDragTimer = 0;
      if (sphereDragRaf || !state.sphereDrag) return;
      sphereDragRaf = window.requestAnimationFrame(() => {
        sphereDragRaf = 0;
        if (!state.sphereDrag) return;
        sphereDragLastRenderAt = performance.now();
        rerenderSphereFrame();
      });
    }, waitMs);
  };
  const refreshSphereSelectionNow = async () => {
    if (!isSphereMode() || !state.selection) return;
    try {
      await refreshSelectionAnalytics();
    } catch (_err) {
      // Selection analytics are best-effort during interaction transitions.
    }
  };
  const updateHoverPointer = (ev) => {
    if (!ev) return;
    const rect = els.canvas.getBoundingClientRect();
    const inside =
      ev.clientX >= rect.left &&
      ev.clientX <= rect.right &&
      ev.clientY >= rect.top &&
      ev.clientY <= rect.bottom;
    state.hoverPointer.clientX = ev.clientX;
    state.hoverPointer.clientY = ev.clientY;
    state.hoverPointer.inside = inside;
  };
  const clearCurrentSelection = () => {
    if (!state.selection && !state.selectionDrag) return false;
    state._selectionToken += 1;
    state.selection = null;
    state.selectionDrag = null;
    state.profiles = null;
    drawFrameAndOverlays();
    drawSelectionGraphs();
    return true;
  };
  const isInsideRenderedImage = (ev, fallbackRect) => {
    if (!ev) return false;
    const rect = els.canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) * (els.canvas.width / Math.max(1, rect.width));
    const cy = (ev.clientY - rect.top) * (els.canvas.height / Math.max(1, rect.height));
    const rects = state.drawTiles && state.drawTiles.length ? state.drawTiles : [fallbackRect];
    for (const drawRect of rects) {
      if (!drawRect) continue;
      if (cx >= drawRect.x && cx <= drawRect.x + drawRect.w && cy >= drawRect.y && cy <= drawRect.y + drawRect.h) {
        return true;
      }
    }
    return false;
  };
  const sphereDragSpeedForView = (viewRect) => {
    const rw =
      viewRect && Number.isFinite(viewRect.srcW) && Number.isFinite(viewRect.imgW) && viewRect.imgW > 0
        ? viewRect.srcW / viewRect.imgW
        : 1;
    const rh =
      viewRect && Number.isFinite(viewRect.srcH) && Number.isFinite(viewRect.imgH) && viewRect.imgH > 0
        ? viewRect.srcH / viewRect.imgH
        : 1;
    const zoomScale = clamp(Math.min(rw, rh), 0.2, 1.0);
    let speed = 0.0095 * zoomScale;
    if (isSphereMode() && state.sphereProjection === "inside") {
      const baseScale = 0.2;
      const curScale = Number.isFinite(state.sphereInsideScale) ? state.sphereInsideScale : baseScale;
      const insideFactor = clamp(baseScale / Math.max(1.0e-6, curScale), 0.03, 1.2);
      speed *= insideFactor;
    }
    return speed;
  };

  els.canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
  els.canvas.addEventListener("wheel", handleWheelZoom, { passive: false });
  els.canvas.addEventListener("mouseleave", () => {
    state.hoverPointer.inside = false;
    clearHoverProbe();
  });
  window.addEventListener("mousedown", (ev) => {
    if (ev.button !== 0 || !ev.shiftKey) return;
    if (!state.selection && !state.selectionDrag) return;
    if (ev.target !== els.canvas) {
      clearCurrentSelection();
      return;
    }
    const { drawRect } = getRenderGeometry(getViewRect());
    if (!isInsideRenderedImage(ev, drawRect)) {
      clearCurrentSelection();
    }
  });

  els.canvas.addEventListener("mousedown", (ev) => {
    if (!state.frameCanvas && !(state.frameTiles && state.frameTiles.length)) return;
    updateHoverPointer(ev);

    const { viewRect, drawRect } = getRenderGeometry(getViewRect());
    if (!isInsideRenderedImage(ev, drawRect)) {
      return;
    }
    const p = screenToData(ev, viewRect, drawRect);
    const startPanDrag = (tileIdx) => {
      const panRect =
        state.drawTiles && state.drawTiles.length
          ? state.drawTiles[clamp(tileIdx || 0, 0, state.drawTiles.length - 1)]
          : drawRect;
      state.panDrag = {
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startU: viewRect.srcX,
        startV: viewRect.srcY,
        spanW: viewRect.srcW,
        spanH: viewRect.srcH,
        drawW: panRect.w,
        drawH: panRect.h,
      };
    };

    if (isVolumeMode()) {
      state.activeSampleTile = p.tile || 0;
      if (state.sampleMode === "single") {
        ensureGridIndices();
        state.values.sample = state.sampleGridIndices[clamp(state.activeSampleTile, 0, state.sampleGridIndices.length - 1)];
      }
      if (ev.button === 0) {
        state.volumeDrag = {
          startClientX: ev.clientX,
          startClientY: ev.clientY,
          startYaw: state.volumeYaw,
          startPitch: state.volumePitch,
        };
        volumeDragLastRenderAt = 0;
      }
      return;
    }

    if (isSphereMode()) {
      state.activeSampleTile = p.tile || 0;
      if (state.sampleMode === "single") {
        ensureGridIndices();
        state.values.sample = state.sampleGridIndices[clamp(state.activeSampleTile, 0, state.sampleGridIndices.length - 1)];
      }
      if (ev.button === 0) {
        const mode = modeForEvent(ev);
        if (mode === "zoom") {
          state.zoomDrag = { startU: p.u, startV: p.v, lastU: p.u, lastV: p.v, moved: false, tile: p.tile || 0 };
          drawFrameAndOverlays();
          return;
        }
        if (mode === "investigate") {
          const iu = Math.floor(p.u);
          const iv = Math.floor(p.v);
          state.selectionDrag = { startU: iu, startV: iv, lastU: iu, lastV: iv, moved: false, tile: p.tile || 0 };
          state.selection = { u0: iu, v0: iv, u1: iu, v1: iv };
          drawFrameAndOverlays();
          return;
        }
        state.sphereDrag = {
          startClientX: ev.clientX,
          startClientY: ev.clientY,
          startYaw: state.sphereYaw,
          startPitch: state.spherePitch,
          startRotationMatrix:
            Array.isArray(state.sphereRotationMatrix) && state.sphereRotationMatrix.length >= 9
              ? state.sphereRotationMatrix.slice(0, 9)
              : null,
          speed: sphereDragSpeedForView(viewRect),
        };
        sphereDragLastRenderAt = 0;
        return;
      }
      if (ev.button === 2 || ev.altKey) {
        state.sphereDrag = {
          startClientX: ev.clientX,
          startClientY: ev.clientY,
          startYaw: state.sphereYaw,
          startPitch: state.spherePitch,
          startRotationMatrix:
            Array.isArray(state.sphereRotationMatrix) && state.sphereRotationMatrix.length >= 9
              ? state.sphereRotationMatrix.slice(0, 9)
              : null,
          speed: sphereDragSpeedForView(viewRect),
        };
        sphereDragLastRenderAt = 0;
      }
      return;
    }

    if (ev.button === 2 || ev.altKey) {
      startPanDrag(p.tile);
      return;
    }

    if (ev.button !== 0) return;

    state.activeSampleTile = p.tile || 0;
    if (state.sampleMode === "single") {
      ensureGridIndices();
      state.values.sample = state.sampleGridIndices[clamp(state.activeSampleTile, 0, state.sampleGridIndices.length - 1)];
    }
    const mode = modeForEvent(ev);
    if (mode === "zoom") {
      state.zoomDrag = { startU: p.u, startV: p.v, lastU: p.u, lastV: p.v, moved: false, tile: p.tile || 0 };
      drawFrameAndOverlays();
      return;
    }
    if (mode === "investigate") {
      const iu = Math.floor(p.u);
      const iv = Math.floor(p.v);
      state.selectionDrag = { startU: iu, startV: iv, lastU: iu, lastV: iv, moved: false, tile: p.tile || 0 };
      state.selection = { u0: iu, v0: iv, u1: iu, v1: iv };
      drawFrameAndOverlays();
      return;
    }
    const zoomedIn = viewRect.srcW < viewRect.imgW - 1.0e-6 || viewRect.srcH < viewRect.imgH - 1.0e-6;
    if (zoomedIn) {
      startPanDrag(p.tile);
    }
  });

  window.addEventListener("mousemove", (ev) => {
    updateHoverPointer(ev);
    if (state.profileZoomDrag) {
      state.profileZoomDrag.currentClientX = ev.clientX;
      drawSelectionGraphs();
      return;
    }

    if (state.navDrag) {
      const axis = axisFromNavKind(state.navDrag.kind);
      const profile = profileForAxis(state.viewProfiles, axis);
      if (profile && profile.coords && profile.coords.length > 1) {
        const idx = navIndexFromEvent(state.navDrag.canvas, ev, profile, axis);
        if (state.navDrag.zoom) {
          state.navDrag.lastIdx = idx;
          drawNavigationGraphs();
        } else {
          setAxisIndex(axis, idx);
        }
      }
      return;
    }

    if (state.volumeDrag) {
      const dx = ev.clientX - state.volumeDrag.startClientX;
      const dy = ev.clientY - state.volumeDrag.startClientY;
      state.volumeYaw = state.volumeDrag.startYaw + dx * 0.012;
      state.volumePitch = clamp(state.volumeDrag.startPitch + dy * 0.012, -1.2, 1.2);
      scheduleVolumeDragRender();
      return;
    }

    if (state.sphereDrag) {
      const dx = ev.clientX - state.sphereDrag.startClientX;
      const dy = ev.clientY - state.sphereDrag.startClientY;
      const speed = Number.isFinite(state.sphereDrag.speed) ? state.sphereDrag.speed : 0.0095;
      if (typeof applySphereDragRotation === "function") {
        applySphereDragRotation(state.sphereDrag.startRotationMatrix, dx, dy, speed);
      } else {
        state.sphereYaw = state.sphereDrag.startYaw + dx * speed;
        state.spherePitch = clamp(state.sphereDrag.startPitch + dy * speed, -1.45, 1.45);
      }
      scheduleSphereDragRender();
      return;
    }

    if (state.panDrag) {
      const rect = els.canvas.getBoundingClientRect();
      const dxCanvas = (ev.clientX - state.panDrag.startClientX) * (els.canvas.width / Math.max(1, rect.width));
      const dyCanvas = (ev.clientY - state.panDrag.startClientY) * (els.canvas.height / Math.max(1, rect.height));

      state.view.u = state.panDrag.startU - (dxCanvas / Math.max(1e-6, state.panDrag.drawW)) * state.panDrag.spanW;
      state.view.v = state.panDrag.startV - (dyCanvas / Math.max(1e-6, state.panDrag.drawH)) * state.panDrag.spanH;
      getViewRect();
      drawFrameAndOverlays();
      return;
    }

    if (state.zoomDrag) {
      const { viewRect, drawRect } = getRenderGeometry(getViewRect());
      const p = screenToData(ev, viewRect, drawRect, state.zoomDrag.tile);
      state.zoomDrag.lastU = p.u;
      state.zoomDrag.lastV = p.v;
      if (Math.abs(p.u - state.zoomDrag.startU) + Math.abs(p.v - state.zoomDrag.startV) > 0.25) {
        state.zoomDrag.moved = true;
      }
      drawFrameAndOverlays();
      return;
    }

    if (state.selectionDrag) {
      const { viewRect, drawRect } = getRenderGeometry(getViewRect());
      const p = screenToData(ev, viewRect, drawRect, state.selectionDrag.tile);
      const iu = Math.floor(p.u);
      const iv = Math.floor(p.v);

      state.selectionDrag.lastU = iu;
      state.selectionDrag.lastV = iv;
      if (Math.abs(iu - state.selectionDrag.startU) + Math.abs(iv - state.selectionDrag.startV) > 0) {
        state.selectionDrag.moved = true;
      }

      state.selection = {
        u0: state.selectionDrag.startU,
        v0: state.selectionDrag.startV,
        u1: iu,
        v1: iv,
      };
      drawFrameAndOverlays();
      return;
    }

    updateHoverProbeFromEvent(ev);
  });

  window.addEventListener("mouseup", async (ev) => {
    if (state.profileZoomDrag && ev.button === 0) {
      const drag = state.profileZoomDrag;
      state.profileZoomDrag = null;

      const axis = axisFromProfileKind(drag.kind);
      const profile = profileForAxis(state.profiles, axis);
      if (profile && profile.coords && profile.coords.length > 1) {
        const canvas = profileCanvasForKind(drag.kind);
        const fakeStart = { clientX: drag.startClientX, clientY: 0 };
        const fakeEnd = { clientX: drag.currentClientX, clientY: 0 };
        const i0 = profileIndexFromEvent(canvas, profile, fakeStart);
        const i1 = profileIndexFromEvent(canvas, profile, fakeEnd);
        if (Math.abs(i1 - i0) >= 1) {
          state.profileZoom[axis] = {
            start: Math.min(i0, i1),
            end: Math.max(i0, i1),
          };
        }
      }
      drawSelectionGraphs();
      return;
    }

    if (state.navDrag && ev.button === 0) {
      if (state.navDrag.zoom) {
        const axis = axisFromNavKind(state.navDrag.kind);
        const s = state.navDrag.startIdx;
        const e = state.navDrag.lastIdx;
        if (Number.isFinite(s) && Number.isFinite(e) && Math.abs(e - s) >= 1) {
          setAxisWindow(axis, Math.min(s, e), Math.max(s, e));
          state.values[axis] = clampIndexToWindow(axis, state.values[axis]);
          drawNavigationGraphs();
          state.navDrag = null;
          await refreshSlice();
          if (state.selection) await refreshSelectionAnalytics();
          return;
        }
      }
      state.navDrag = null;
      drawNavigationGraphs();
      return;
    }

    if (state.panDrag) {
      state.panDrag = null;
      await refreshViewProfiles();
      return;
    }

    if (state.volumeDrag) {
      state.volumeDrag = null;
      if (volumeDragRaf) {
        window.cancelAnimationFrame(volumeDragRaf);
        volumeDragRaf = 0;
      }
      if (volumeDragTimer) {
        window.clearTimeout(volumeDragTimer);
        volumeDragTimer = 0;
      }
      rerenderVolumeFrame();
      return;
    }

    if (state.sphereDrag) {
      state.sphereDrag = null;
      if (sphereDragRaf) {
        window.cancelAnimationFrame(sphereDragRaf);
        sphereDragRaf = 0;
      }
      if (sphereDragTimer) {
        window.clearTimeout(sphereDragTimer);
        sphereDragTimer = 0;
      }
      rerenderSphereFrame();
      await refreshSphereSelectionNow();
      updateHoverProbeFromEvent(ev);
      return;
    }

    if (ev.button !== 0) return;

    if (state.zoomDrag) {
      const z = state.zoomDrag;
      state.zoomDrag = null;
      const insideZoomClick = isSphereMode() && state.sphereProjection === "inside";
      if (z.moved || insideZoomClick) {
        applyZoomBox(z);
        drawFrameAndOverlays();
        await refreshViewProfiles();
      } else {
        let iuMax;
        let ivMax;
        if (isSphereMode()) {
          const canvas = state.frameTiles && state.frameTiles.length
            ? state.frameTiles[clamp(state.activeSampleTile || 0, 0, state.frameTiles.length - 1)]
            : state.frameCanvas;
          iuMax = Math.max(0, (canvas ? canvas.width : 1) - 1);
          ivMax = Math.max(0, (canvas ? canvas.height : 1) - 1);
        } else {
          const p = planeDims();
          iuMax = Math.max(0, axisSize(p.planeX) - 1);
          ivMax = Math.max(0, axisSize(p.planeY) - 1);
        }
        const iu = clamp(Math.floor(z.startU), 0, iuMax);
        const iv = clamp(Math.floor(z.startV), 0, ivMax);
        state.selection = { u0: iu, v0: iv, u1: iu, v1: iv };
        drawFrameAndOverlays();
        await refreshSelectionAnalytics();
      }
      return;
    }

    if (!state.selectionDrag) return;

    const s = state.selectionDrag;
    state.selectionDrag = null;
    if (!s.moved) {
      state.selection = { u0: s.startU, v0: s.startV, u1: s.startU, v1: s.startV };
    } else {
      state.selection = { u0: s.startU, v0: s.startV, u1: s.lastU, v1: s.lastV };
    }

    drawFrameAndOverlays();
    await refreshSelectionAnalytics();
  });
}
