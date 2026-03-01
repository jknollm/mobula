export function bindCanvasInteractions(ctx) {
  const {
    axisFromNavKind,
    axisFromProfileKind,
    axisSize,
    applyZoomBox,
    clamp,
    clampIndexToWindow,
    drawFrameAndOverlays,
    drawNavigationGraphs,
    drawSelectionGraphs,
    els,
    ensureGridIndices,
    getDrawRect,
    getViewRect,
    handleWheelZoom,
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
    screenToData,
    setAxisIndex,
    setAxisWindow,
    state,
  } = ctx;

  els.canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
  els.canvas.addEventListener("wheel", handleWheelZoom, { passive: false });

  els.canvas.addEventListener("mousedown", (ev) => {
    if (!state.frameCanvas && !(state.frameTiles && state.frameTiles.length)) return;

    const viewRect = getViewRect();
    const drawRect = state.drawRect || getDrawRect(viewRect);
    const p = screenToData(ev, viewRect, drawRect);

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
      }
      return;
    }

    if (ev.button === 2 || ev.altKey) {
      const panRect =
        state.drawTiles && state.drawTiles.length ? state.drawTiles[clamp(p.tile || 0, 0, state.drawTiles.length - 1)] : drawRect;
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
      return;
    }

    if (ev.button !== 0) return;

    state.activeSampleTile = p.tile || 0;
    if (state.sampleMode === "single") {
      ensureGridIndices();
      state.values.sample = state.sampleGridIndices[clamp(state.activeSampleTile, 0, state.sampleGridIndices.length - 1)];
    }
    if (state.dragMode === "zoom") {
      state.zoomDrag = { startU: p.u, startV: p.v, lastU: p.u, lastV: p.v, moved: false, tile: p.tile || 0 };
      drawFrameAndOverlays();
      return;
    }

    const iu = Math.floor(p.u);
    const iv = Math.floor(p.v);
    state.selectionDrag = { startU: iu, startV: iv, lastU: iu, lastV: iv, moved: false, tile: p.tile || 0 };
    state.selection = { u0: iu, v0: iv, u1: iu, v1: iv };
    drawFrameAndOverlays();
  });

  window.addEventListener("mousemove", (ev) => {
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
      rerenderVolumeFrame();
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
      const viewRect = getViewRect();
      const drawRect = state.drawRect || getDrawRect(viewRect);
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
      const viewRect = getViewRect();
      const drawRect = state.drawRect || getDrawRect(viewRect);
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
    }
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
      return;
    }

    if (ev.button !== 0) return;

    if (state.zoomDrag) {
      const z = state.zoomDrag;
      state.zoomDrag = null;
      if (z.moved) {
        applyZoomBox(z);
        drawFrameAndOverlays();
        await refreshViewProfiles();
      } else {
        const p = planeDims();
        const iu = clamp(Math.floor(z.startU), 0, axisSize(p.planeX) - 1);
        const iv = clamp(Math.floor(z.startV), 0, axisSize(p.planeY) - 1);
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
