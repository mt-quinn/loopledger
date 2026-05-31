"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ReferenceViewerProps = {
  src: string;
};

const MAX_ZOOM_FACTOR = 8;
const STEP = 1.3;

type ViewState = {
  scale: number;
  x: number;
  y: number;
  natW: number;
  natH: number;
  vpW: number;
  vpH: number;
  fit: number;
};

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Fits a captured reference image to a fixed viewport, then allows the user to
 * zoom (buttons / wheel / pinch) and pan (drag) within it.
 */
export default function ReferenceViewer({ src }: ReferenceViewerProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const stateRef = useRef<ViewState>({ scale: 1, x: 0, y: 0, natW: 0, natH: 0, vpW: 0, vpH: 0, fit: 1 });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDistRef = useRef(0);
  const [zoomPct, setZoomPct] = useState(100);

  const clampAndApply = useCallback(() => {
    const s = stateRef.current;
    const dispW = s.natW * s.scale;
    const dispH = s.natH * s.scale;
    if (dispW <= s.vpW) {
      s.x = (s.vpW - dispW) / 2;
    } else {
      s.x = Math.min(0, Math.max(s.vpW - dispW, s.x));
    }
    if (dispH <= s.vpH) {
      s.y = (s.vpH - dispH) / 2;
    } else {
      s.y = Math.min(0, Math.max(s.vpH - dispH, s.y));
    }
    if (imgRef.current) {
      imgRef.current.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
    }
    setZoomPct(s.fit > 0 ? Math.round((s.scale / s.fit) * 100) : 100);
  }, []);

  const setFit = useCallback(() => {
    const s = stateRef.current;
    if (s.natW <= 0 || s.vpW <= 0) {
      return;
    }
    s.fit = Math.min(s.vpW / s.natW, s.vpH / s.natH);
    s.scale = s.fit;
    s.x = (s.vpW - s.natW * s.scale) / 2;
    s.y = (s.vpH - s.natH * s.scale) / 2;
    clampAndApply();
  }, [clampAndApply]);

  const zoomTo = useCallback(
    (nextScale: number, cx: number, cy: number) => {
      const s = stateRef.current;
      const min = s.fit;
      const max = s.fit * MAX_ZOOM_FACTOR;
      const ns = Math.min(max, Math.max(min, nextScale));
      const imgX = (cx - s.x) / s.scale;
      const imgY = (cy - s.y) / s.scale;
      s.x = cx - imgX * ns;
      s.y = cy - imgY * ns;
      s.scale = ns;
      clampAndApply();
    },
    [clampAndApply]
  );

  const zoomByStep = useCallback(
    (factor: number) => {
      const s = stateRef.current;
      zoomTo(s.scale * factor, s.vpW / 2, s.vpH / 2);
    },
    [zoomTo]
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      stateRef.current.vpW = el.clientWidth;
      stateRef.current.vpH = el.clientHeight;
      if (stateRef.current.natW > 0) {
        // Recompute the fit floor and keep the current zoom within bounds.
        stateRef.current.fit = Math.min(
          stateRef.current.vpW / stateRef.current.natW,
          stateRef.current.vpH / stateRef.current.natH
        );
        stateRef.current.scale = Math.max(stateRef.current.scale, stateRef.current.fit);
        clampAndApply();
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [clampAndApply]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = event.deltaY < 0 ? STEP : 1 / STEP;
      zoomTo(stateRef.current.scale * factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  const handleImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) {
      return;
    }
    stateRef.current.natW = img.naturalWidth;
    stateRef.current.natH = img.naturalHeight;
    img.style.width = `${img.naturalWidth}px`;
    img.style.height = `${img.naturalHeight}px`;
    setFit();
  }, [setFit]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      pinchDistRef.current = distance(pts[0], pts[1]);
    }
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) {
        return;
      }
      const prev = pointersRef.current.get(event.pointerId)!;
      const cur = { x: event.clientX, y: event.clientY };
      pointersRef.current.set(event.pointerId, cur);
      const pts = [...pointersRef.current.values()];
      const rect = viewportRef.current?.getBoundingClientRect();

      if (pts.length >= 2 && rect) {
        const d = distance(pts[0], pts[1]);
        const ratio = pinchDistRef.current > 0 ? d / pinchDistRef.current : 1;
        pinchDistRef.current = d;
        const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
        const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
        zoomTo(stateRef.current.scale * ratio, midX, midY);
        return;
      }

      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      stateRef.current.x += dx;
      stateRef.current.y += dy;
      clampAndApply();
    },
    [clampAndApply, zoomTo]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchDistRef.current = 0;
    }
  }, []);

  return (
    <div className="reference-viewer">
      <div
        ref={viewportRef}
        className="reference-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          className="reference-viewer-img"
          src={src}
          alt="Reference capture"
          draggable={false}
          onLoad={handleImageLoad}
        />
      </div>
      <div className="reference-controls">
        <button
          type="button"
          className="reference-zoom-btn"
          onClick={() => zoomByStep(1 / STEP)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button type="button" className="reference-fit-btn" onClick={setFit}>
          Fit
        </button>
        <button
          type="button"
          className="reference-zoom-btn"
          onClick={() => zoomByStep(STEP)}
          aria-label="Zoom in"
        >
          +
        </button>
        <span className="reference-zoom-readout" aria-live="polite">
          {zoomPct}%
        </span>
      </div>
    </div>
  );
}
