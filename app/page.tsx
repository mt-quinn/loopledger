"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

type ViewerMode = "pan" | "highlight";
type DrawTool = "rectangle" | "line" | "highlight";
type DrawingTool = DrawTool | "reference";
type CounterType = "row" | "stitch";

type PageMetric = {
  width: number;
  height: number;
};

type Annotation = {
  id: string;
  pageIndex: number;
  kind: DrawTool;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  x2?: number;
  y2?: number;
};

type KnitCounter = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  type: CounterType;
  label: string;
  value: number;
};

type PersistedState = {
  zoom: number;
  highlights: Annotation[];
  counters: KnitCounter[];
  strokeColor?: string;
  referenceCapture?: ReferenceCapture | null;
};

type ReferenceCapture = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageDataUrl: string;
};

const STORAGE_KEY = "whichstitch-pdf-workspace-v1";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.4;
const COUNTER_HITBOX_WIDTH = 150;
const COUNTER_HITBOX_HEIGHT = 140;
const COUNTER_GAP = 12;
const MAX_REFERENCE_IMAGE_DIM = 900;
const STROKE_PALETTE = [
  "#ff1744",
  "#ff6d00",
  "#ffea00",
  "#76ff03",
  "#00e676",
  "#00e5ff",
  "#00b0ff",
  "#2979ff",
  "#651fff",
  "#d500f9",
  "#f50057",
  "#ff4081"
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCounterLabel(type: CounterType): string {
  return type === "row" ? "Row" : "Stitch";
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function clampCounterPosition(x: number, y: number, page: PageMetric): { x: number; y: number } {
  return {
    x: clamp(x, 0, Math.max(0, page.width - COUNTER_HITBOX_WIDTH)),
    y: clamp(y, 0, Math.max(0, page.height - COUNTER_HITBOX_HEIGHT))
  };
}

function isCounterPositionBlocked(
  x: number,
  y: number,
  pageIndex: number,
  counters: KnitCounter[],
  ignoreId?: string
): boolean {
  const candidate = { x, y, width: COUNTER_HITBOX_WIDTH, height: COUNTER_HITBOX_HEIGHT };
  return counters
    .filter((counter) => counter.pageIndex === pageIndex && counter.id !== ignoreId)
    .some((counter) =>
      overlaps(candidate, {
        x: counter.x,
        y: counter.y,
        width: COUNTER_HITBOX_WIDTH,
        height: COUNTER_HITBOX_HEIGHT
      })
    );
}

function findOpenCounterPosition(
  startX: number,
  startY: number,
  pageIndex: number,
  page: PageMetric,
  counters: KnitCounter[]
): { x: number; y: number } {
  const base = clampCounterPosition(startX, startY, page);
  if (!isCounterPositionBlocked(base.x, base.y, pageIndex, counters)) {
    return base;
  }

  const step = COUNTER_HITBOX_WIDTH + COUNTER_GAP;
  for (let ring = 1; ring <= 10; ring += 1) {
    const offsets = [
      { dx: 0, dy: -ring * step },
      { dx: ring * step, dy: 0 },
      { dx: 0, dy: ring * step },
      { dx: -ring * step, dy: 0 },
      { dx: ring * step, dy: -ring * step },
      { dx: ring * step, dy: ring * step },
      { dx: -ring * step, dy: ring * step },
      { dx: -ring * step, dy: -ring * step }
    ];

    for (const offset of offsets) {
      const candidate = clampCounterPosition(base.x + offset.dx, base.y + offset.dy, page);
      if (!isCounterPositionBlocked(candidate.x, candidate.y, pageIndex, counters)) {
        return candidate;
      }
    }
  }

  return base;
}

export default function HomePage() {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfFileName, setPdfFileName] = useState("No PDF loaded");
  const [pages, setPages] = useState<PageMetric[]>([]);
  const [zoom, setZoom] = useState(1.1);
  const [mode, setMode] = useState<ViewerMode>("pan");
  const [drawTool, setDrawTool] = useState<DrawTool>("rectangle");
  const [strokeColor, setStrokeColor] = useState("#c62828");
  const [highlights, setHighlights] = useState<Annotation[]>([]);
  const [referenceCapture, setReferenceCapture] = useState<ReferenceCapture | null>(null);
  const [isSelectingReference, setIsSelectingReference] = useState(false);
  const [isReferencePopoverOpen, setIsReferencePopoverOpen] = useState(false);
  const [counters, setCounters] = useState<KnitCounter[]>([]);
  const [editingCounterId, setEditingCounterId] = useState<string | null>(null);
  const [editingCounterTitle, setEditingCounterTitle] = useState("");
  const [loadedState, setLoadedState] = useState(false);

  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pageRefs = useRef<(HTMLElement | null)[]>([]);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pagesLayerRef = useRef<HTMLDivElement | null>(null);
  const counterUndoHistoryRef = useRef<Record<string, number[]>>({});
  const touchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    startDistance: number;
    startZoom: number;
    anchorContentX: number;
    anchorContentY: number;
    midpointClientX: number;
    midpointClientY: number;
    lastZoom: number;
  } | null>(null);

  const drawingRef = useRef<{
    tool: DrawingTool;
    pageIndex: number;
    startX: number;
    startY: number;
  } | null>(null);

  const draggingCounterRef = useRef<{
    counterId: string;
    pageIndex: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const panningRef = useRef<{
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

  const [draftHighlight, setDraftHighlight] = useState<Annotation | null>(null);
  const [draftReferenceRect, setDraftReferenceRect] = useState<{
    pageIndex: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  }, []);

  useEffect(() => {
    // Keep browser-level pinch zoom disabled so the fixed toolbar stays in screen space.
    function preventBrowserPinch(event: TouchEvent) {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    }

    function preventGestureEvent(event: Event) {
      event.preventDefault();
    }

    document.addEventListener("touchmove", preventBrowserPinch, { passive: false });
    document.addEventListener("gesturestart" as keyof DocumentEventMap, preventGestureEvent, { passive: false });
    document.addEventListener("gesturechange" as keyof DocumentEventMap, preventGestureEvent, { passive: false });
    document.addEventListener("gestureend" as keyof DocumentEventMap, preventGestureEvent, { passive: false });

    return () => {
      document.removeEventListener("touchmove", preventBrowserPinch);
      document.removeEventListener("gesturestart" as keyof DocumentEventMap, preventGestureEvent);
      document.removeEventListener("gesturechange" as keyof DocumentEventMap, preventGestureEvent);
      document.removeEventListener("gestureend" as keyof DocumentEventMap, preventGestureEvent);
    };
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setLoadedState(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as PersistedState;
      if (typeof parsed.zoom === "number") {
        setZoom(clamp(parsed.zoom, MIN_ZOOM, MAX_ZOOM));
      }
      if (Array.isArray(parsed.highlights)) {
        setHighlights(parsed.highlights);
      }
      if (Array.isArray(parsed.counters)) {
        setCounters(parsed.counters.map((counter) => ({ ...counter })));
      }
      if (typeof parsed.strokeColor === "string") {
        setStrokeColor(parsed.strokeColor);
      }
      if (parsed.referenceCapture && typeof parsed.referenceCapture.imageDataUrl === "string") {
        setReferenceCapture(parsed.referenceCapture);
      }
    } catch {
      // Ignore invalid saved tool state.
    } finally {
      setLoadedState(true);
    }
  }, []);

  useEffect(() => {
    if (!loadedState) {
      return;
    }

    const payload: PersistedState = {
      zoom,
      highlights,
      counters,
      strokeColor,
      referenceCapture
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // LocalStorage can overflow when a captured reference image is large.
      // Persist everything else so the app keeps working without runtime errors.
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        const fallbackPayload: PersistedState = {
          zoom,
          highlights,
          counters,
          strokeColor,
          referenceCapture: null
        };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallbackPayload));
        } catch {
          // Ignore secondary persistence failures.
        }
      }
    }
  }, [loadedState, zoom, highlights, counters, strokeColor, referenceCapture]);

  useEffect(() => {
    if (!pdfDoc || !pages.length) {
      return;
    }

    const doc = pdfDoc;
    let cancelled = false;

    async function renderPages() {
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const canvas = canvasRefs.current[pageIndex];
        if (!canvas) {
          continue;
        }

        const page = await doc.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: zoom });
        const context = canvas.getContext("2d");

        if (!context || cancelled) {
          continue;
        }

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        await page.render({ canvasContext: context, viewport }).promise;
      }
    }

    renderPages();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pages, zoom]);

  const captureReferenceImage = useCallback((
    pageIndex: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): string | null => {
    const sourceCanvas = canvasRefs.current[pageIndex];
    const pageMetric = pages[pageIndex];
    if (!sourceCanvas || !pageMetric || width <= 0 || height <= 0) {
      return null;
    }

    const scaleX = sourceCanvas.width / pageMetric.width;
    const scaleY = sourceCanvas.height / pageMetric.height;
    const sx = Math.max(0, Math.floor(x * scaleX));
    const sy = Math.max(0, Math.floor(y * scaleY));
    const sw = Math.max(1, Math.floor(width * scaleX));
    const sh = Math.max(1, Math.floor(height * scaleY));

    const scale = Math.min(1, MAX_REFERENCE_IMAGE_DIM / Math.max(sw, sh));
    const tw = Math.max(1, Math.floor(sw * scale));
    const th = Math.max(1, Math.floor(sh * scale));

    const target = document.createElement("canvas");
    target.width = tw;
    target.height = th;
    const context = target.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, tw, th);
    return target.toDataURL("image/jpeg", 0.78);
  }, [pages]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drawing = drawingRef.current;
      if (drawing) {
        if (mode !== "highlight" && !isSelectingReference) {
          drawingRef.current = null;
          setDraftHighlight(null);
          setDraftReferenceRect(null);
          return;
        }
        event.preventDefault();
        const pageElement = pageRefs.current[drawing.pageIndex];
        if (!pageElement) {
          return;
        }

        const rect = pageElement.getBoundingClientRect();
        const x = clamp((event.clientX - rect.left) / zoom, 0, pages[drawing.pageIndex]?.width ?? 0);
        const y = clamp((event.clientY - rect.top) / zoom, 0, pages[drawing.pageIndex]?.height ?? 0);

        if (drawing.tool === "reference") {
          const startX = Math.min(drawing.startX, x);
          const startY = Math.min(drawing.startY, y);
          setDraftReferenceRect({
            pageIndex: drawing.pageIndex,
            x: startX,
            y: startY,
            width: Math.abs(x - drawing.startX),
            height: Math.abs(y - drawing.startY)
          });
          return;
        }

        if (drawing.tool === "rectangle" || drawing.tool === "highlight") {
          const startX = Math.min(drawing.startX, x);
          const startY = Math.min(drawing.startY, y);

          setDraftHighlight({
            id: "draft",
            kind: drawing.tool,
            pageIndex: drawing.pageIndex,
            x: startX,
            y: startY,
            width: Math.abs(x - drawing.startX),
            height: Math.abs(y - drawing.startY),
            color: drawing.tool === "rectangle" ? strokeColor : undefined
          });
          return;
        }

        if (drawing.tool === "line") {
          setDraftHighlight({
            id: "draft",
            kind: "line",
            pageIndex: drawing.pageIndex,
            x: drawing.startX,
            y: drawing.startY,
            width: 0,
            height: 0,
            x2: x,
            y2: y,
            color: strokeColor
          });
        }
        return;
      }

      const drag = draggingCounterRef.current;
      if (drag) {
        const pageElement = pageRefs.current[drag.pageIndex];
        const pageMetric = pages[drag.pageIndex];
        if (!pageElement || !pageMetric) {
          return;
        }

        const rect = pageElement.getBoundingClientRect();
        const rawX = (event.clientX - rect.left) / zoom - drag.offsetX;
        const rawY = (event.clientY - rect.top) / zoom - drag.offsetY;
        const clamped = clampCounterPosition(rawX, rawY, pageMetric);
        if (isCounterPositionBlocked(clamped.x, clamped.y, drag.pageIndex, counters, drag.counterId)) {
          return;
        }

        setCounters((prev) =>
          prev.map((counter) =>
            counter.id === drag.counterId
              ? {
                  ...counter,
                  x: clamped.x,
                  y: clamped.y
                }
              : counter
          )
        );
        return;
      }

      const pan = panningRef.current;
      const viewer = viewerRef.current;
      if (pan && viewer) {
        viewer.scrollLeft = pan.startScrollLeft - (event.clientX - pan.startClientX);
        viewer.scrollTop = pan.startScrollTop - (event.clientY - pan.startClientY);
      }
    }

    function handlePointerUp() {
      const drawing = drawingRef.current;
      if (drawing && mode !== "highlight" && !isSelectingReference) {
        drawingRef.current = null;
        setDraftHighlight(null);
        setDraftReferenceRect(null);
        draggingCounterRef.current = null;
        panningRef.current = null;
        return;
      }

      if (drawing?.tool === "reference" && draftReferenceRect && draftReferenceRect.width > 12 && draftReferenceRect.height > 12) {
        const imageDataUrl = captureReferenceImage(
          draftReferenceRect.pageIndex,
          draftReferenceRect.x,
          draftReferenceRect.y,
          draftReferenceRect.width,
          draftReferenceRect.height
        );
        if (imageDataUrl) {
          setReferenceCapture({
            ...draftReferenceRect,
            imageDataUrl
          });
        }
        setIsSelectingReference(false);
        setIsReferencePopoverOpen(true);
      }

      if (
        (drawing?.tool === "rectangle" || drawing?.tool === "highlight") &&
        draftHighlight &&
        draftHighlight.width > 10 &&
        draftHighlight.height > 10
      ) {
        setHighlights((prev) => [...prev, { ...draftHighlight, id: `hl-${Date.now()}`, kind: draftHighlight.kind }]);
      }

      if (drawing?.tool === "line" && draftHighlight?.kind === "line") {
        const lineLength = Math.hypot(
          (draftHighlight.x2 ?? draftHighlight.x) - draftHighlight.x,
          (draftHighlight.y2 ?? draftHighlight.y) - draftHighlight.y
        );
        if (lineLength > 8) {
          setHighlights((prev) => [...prev, { ...draftHighlight, id: `hl-${Date.now()}`, kind: "line" }]);
        }
      }

      drawingRef.current = null;
      draggingCounterRef.current = null;
      panningRef.current = null;
      setDraftHighlight(null);
      setDraftReferenceRect(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [captureReferenceImage, counters, draftHighlight, draftReferenceRect, isSelectingReference, mode, pages, strokeColor, zoom]);

  useEffect(() => {
    if (mode === "highlight" || isSelectingReference) {
      return;
    }
    drawingRef.current = null;
    setDraftHighlight(null);
    setDraftReferenceRect(null);
  }, [isSelectingReference, mode]);

  useEffect(() => {
    function onUndoHighlightHotkey(event: KeyboardEvent) {
      const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
      if (!isUndo) {
        return;
      }

      if (!highlights.length) {
        return;
      }

      event.preventDefault();
      setHighlights((prev) => prev.slice(0, -1));
    }

    window.addEventListener("keydown", onUndoHighlightHotkey);
    return () => {
      window.removeEventListener("keydown", onUndoHighlightHotkey);
    };
  }, [highlights.length]);

  function onSelectPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    void (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const loaded = await getDocument({ data }).promise;

        const metrics: PageMetric[] = [];
        for (let i = 1; i <= loaded.numPages; i += 1) {
          const page = await loaded.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          metrics.push({
            width: viewport.width,
            height: viewport.height
          });
        }

        setPdfDoc(loaded);
        setPages(metrics);
        setPdfFileName(file.name);
      } catch {}
    })();
  }

  function pageOverlayPointerDown(event: React.PointerEvent, pageIndex: number) {
    if (event.button !== 0) {
      return;
    }

    const pageElement = pageRefs.current[pageIndex];
    if (!pageElement) {
      return;
    }

    if (isSelectingReference) {
      event.preventDefault();
      const rect = pageElement.getBoundingClientRect();
      const startX = clamp((event.clientX - rect.left) / zoom, 0, pages[pageIndex]?.width ?? 0);
      const startY = clamp((event.clientY - rect.top) / zoom, 0, pages[pageIndex]?.height ?? 0);
      drawingRef.current = { tool: "reference", pageIndex, startX, startY };
      return;
    }

    if (mode === "highlight") {
      event.preventDefault();
      const rect = pageElement.getBoundingClientRect();
      const startX = clamp((event.clientX - rect.left) / zoom, 0, pages[pageIndex]?.width ?? 0);
      const startY = clamp((event.clientY - rect.top) / zoom, 0, pages[pageIndex]?.height ?? 0);

      drawingRef.current = { tool: drawTool, pageIndex, startX, startY };
      return;
    }

    if (event.pointerType !== "mouse") {
      return;
    }

    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    panningRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: viewer.scrollLeft,
      startScrollTop: viewer.scrollTop
    };
  }

  function addCounter(type: CounterType) {
    const viewer = viewerRef.current;
    if (!viewer || pages.length === 0) {
      return;
    }

    const centerY = viewer.scrollTop + viewer.clientHeight / 2;
    const centerX = viewer.scrollLeft + viewer.clientWidth / 2;

    let targetPage = 0;
    let accumulatedHeight = 0;

    for (let i = 0; i < pages.length; i += 1) {
      const scaledHeight = pages[i].height * zoom + 18;
      if (centerY <= accumulatedHeight + scaledHeight) {
        targetPage = i;
        break;
      }
      accumulatedHeight += scaledHeight;
      targetPage = i;
    }

    const page = pages[targetPage];
    const pageScaledWidth = page.width * zoom;
    const pageScaledLeft = Math.max((viewer.clientWidth - pageScaledWidth) / 2, 0);
    const pageScaledTop = accumulatedHeight;
    const localCenterX = (centerX - pageScaledLeft) / zoom;
    const localCenterY = (centerY - pageScaledTop) / zoom;
    const startX = localCenterX - COUNTER_HITBOX_WIDTH / 2;
    const startY = localCenterY - COUNTER_HITBOX_HEIGHT / 2;
    const safe = findOpenCounterPosition(startX, startY, targetPage, page, counters);

    setCounters((prev) => [
      ...prev,
      {
        id: `counter-${Date.now()}`,
        pageIndex: targetPage,
        x: safe.x,
        y: safe.y,
        type,
        label: formatCounterLabel(type),
        value: 0
      }
    ]);
  }

  function startDraggingCounter(event: React.PointerEvent, counter: KnitCounter) {
    event.stopPropagation();
    event.preventDefault();

    const pageElement = pageRefs.current[counter.pageIndex];
    if (!pageElement) {
      return;
    }

    const rect = pageElement.getBoundingClientRect();
    draggingCounterRef.current = {
      counterId: counter.id,
      pageIndex: counter.pageIndex,
      offsetX: (event.clientX - rect.left) / zoom - counter.x,
      offsetY: (event.clientY - rect.top) / zoom - counter.y
    };
  }

  const visibleHighlights = useMemo(() => {
    if (!draftHighlight) {
      return highlights;
    }
    return [...highlights, draftHighlight];
  }, [draftHighlight, highlights]);

  function setCounterValue(counterId: string, nextValue: number) {
    setCounters((prev) =>
      prev.map((item) =>
        item.id === counterId
          ? {
              ...item,
              value: Math.max(0, nextValue)
            }
          : item
      )
    );
  }

  function applyCounterIncrement(counterId: string, amount: number) {
    setCounters((prev) =>
      prev.map((item) => {
        if (item.id !== counterId) {
          return item;
        }

        const nextValue = Math.max(0, item.value + amount);
        if (nextValue === item.value) {
          return item;
        }

        const stack = counterUndoHistoryRef.current[counterId] ?? [];
        counterUndoHistoryRef.current[counterId] = [...stack, item.value];

        return {
          ...item,
          value: nextValue
        };
      })
    );
  }

  function undoCounter(counterId: string) {
    const stack = counterUndoHistoryRef.current[counterId] ?? [];
    if (!stack.length) {
      return;
    }

    const previousValue = stack[stack.length - 1];
    counterUndoHistoryRef.current[counterId] = stack.slice(0, -1);

    setCounters((prev) =>
      prev.map((item) =>
        item.id === counterId
          ? {
              ...item,
              value: previousValue
            }
          : item
      )
    );
  }

  function startCounterTitleEdit(counter: KnitCounter) {
    setEditingCounterId(counter.id);
    setEditingCounterTitle(counter.label);
  }

  function finishCounterTitleEdit(counterId: string) {
    const nextTitle = editingCounterTitle.trim();
    if (nextTitle) {
      setCounters((prev) =>
        prev.map((item) =>
          item.id === counterId
            ? {
                ...item,
                label: nextTitle
              }
            : item
        )
      );
    }
    setEditingCounterId(null);
    setEditingCounterTitle("");
  }

  function undoLatestAnnotation() {
    setHighlights((prev) => (prev.length ? prev.slice(0, -1) : prev));
  }

  function onReferenceButtonClick() {
    if (isSelectingReference) {
      setIsSelectingReference(false);
      setDraftReferenceRect(null);
      drawingRef.current = null;
      return;
    }

    if (!referenceCapture) {
      setIsSelectingReference(true);
      setIsReferencePopoverOpen(false);
      return;
    }

    setIsReferencePopoverOpen((prev) => !prev);
  }

  function handleViewerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (mode !== "pan" || isSelectingReference || event.pointerType !== "touch") {
      return;
    }

    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointsRef.current.size !== 2) {
      return;
    }

    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    const points = Array.from(touchPointsRef.current.values());
    const p1 = points[0];
    const p2 = points[1];
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (distance < 4) {
      return;
    }

    const rect = viewer.getBoundingClientRect();
    const midpointX = (p1.x + p2.x) / 2;
    const midpointY = (p1.y + p2.y) / 2;
    const contentX = viewer.scrollLeft + (midpointX - rect.left);
    const contentY = viewer.scrollTop + (midpointY - rect.top);

    pinchStateRef.current = {
      startDistance: distance,
      startZoom: zoom,
      anchorContentX: contentX / zoom,
      anchorContentY: contentY / zoom,
      midpointClientX: midpointX,
      midpointClientY: midpointY,
      lastZoom: zoom
    };
  }

  function handleViewerPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (mode !== "pan" || isSelectingReference || event.pointerType !== "touch") {
      return;
    }

    if (!touchPointsRef.current.has(event.pointerId)) {
      return;
    }
    touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const pinch = pinchStateRef.current;
    if (!pinch || touchPointsRef.current.size < 2) {
      return;
    }

    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    const points = Array.from(touchPointsRef.current.values());
    const p1 = points[0];
    const p2 = points[1];
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (distance < 4) {
      return;
    }

    event.preventDefault();
    const nextZoom = clamp((distance / pinch.startDistance) * pinch.startZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextZoom - pinch.lastZoom) < 0.001) {
      return;
    }

    const midpointX = (p1.x + p2.x) / 2;
    const midpointY = (p1.y + p2.y) / 2;
    pinchStateRef.current = {
      ...pinch,
      midpointClientX: midpointX,
      midpointClientY: midpointY,
      lastZoom: nextZoom
    };

    const layer = pagesLayerRef.current;
    if (!layer) {
      return;
    }

    const previewScale = nextZoom / pinch.startZoom;
    layer.style.transformOrigin = `${pinch.anchorContentX * pinch.startZoom}px ${pinch.anchorContentY * pinch.startZoom}px`;
    layer.style.transform = `scale(${previewScale})`;
    layer.style.willChange = "transform";
  }

  function handleViewerPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") {
      return;
    }
    touchPointsRef.current.delete(event.pointerId);
    if (touchPointsRef.current.size < 2) {
      const pinch = pinchStateRef.current;
      const viewer = viewerRef.current;
      const layer = pagesLayerRef.current;
      if (pinch && viewer && layer) {
        layer.style.transform = "";
        layer.style.transformOrigin = "";
        layer.style.willChange = "";

        setZoom(pinch.lastZoom);
        const rect = viewer.getBoundingClientRect();
        viewer.scrollLeft = pinch.anchorContentX * pinch.lastZoom - (pinch.midpointClientX - rect.left);
        viewer.scrollTop = pinch.anchorContentY * pinch.lastZoom - (pinch.midpointClientY - rect.top);
      }
      pinchStateRef.current = null;
    }
  }

  return (
    <main className="pdf-app">
      <header className="pdf-toolbar">
        <div className="toolbar-left">
          <label className="toolbar-btn file-btn">
            Open PDF
            <input type="file" accept="application/pdf" onChange={onSelectPdf} />
          </label>
          <button
            type="button"
            className={mode === "pan" ? "toolbar-btn active" : "toolbar-btn"}
            onClick={() => setMode("pan")}
          >
            Pan
          </button>
          <button type="button" className={mode === "highlight" ? "toolbar-btn active" : "toolbar-btn"} onClick={() => setMode("highlight")}>
            Annotate
          </button>
          <div className="reference-wrap">
            <button
              type="button"
              className={isSelectingReference ? "toolbar-btn active reference-btn" : "toolbar-btn reference-btn"}
              onClick={onReferenceButtonClick}
            >
              <span>Reference</span>
              {referenceCapture ? (
                <span
                  className="reference-thumb"
                  style={{ backgroundImage: `url(${referenceCapture.imageDataUrl})` }}
                  aria-hidden="true"
                />
              ) : null}
            </button>
            {isReferencePopoverOpen && referenceCapture ? (
              <div className="reference-popover">
                <img
                  className="reference-preview-image"
                  src={referenceCapture.imageDataUrl}
                  alt="Reference capture"
                />
                <button
                  type="button"
                  className="reference-reset-btn"
                  onClick={() => {
                    setReferenceCapture(null);
                    setIsReferencePopoverOpen(false);
                    setIsSelectingReference(false);
                    setDraftReferenceRect(null);
                    drawingRef.current = null;
                  }}
                >
                  Reset
                </button>
              </div>
            ) : null}
          </div>
          <button type="button" className="toolbar-btn" onClick={() => addCounter("row")}>
            Add Row Counter
          </button>
          <button type="button" className="toolbar-btn" onClick={() => addCounter("stitch")}>
            Add Stitch Counter
          </button>
        </div>

        <div className="toolbar-right">
          <span className="status-chip">{pdfFileName}</span>
          <label className="zoom-wrap">
            Zoom
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span>{Math.round(zoom * 100)}%</span>
          </label>
        </div>
      </header>
      {mode === "highlight" ? (
        <div className="highlight-subbar">
          <button
            type="button"
            className={drawTool === "rectangle" ? "toolbar-btn active" : "toolbar-btn"}
            onClick={() => setDrawTool("rectangle")}
          >
            Draw Rectangle
          </button>
          <button
            type="button"
            className={drawTool === "line" ? "toolbar-btn active" : "toolbar-btn"}
            onClick={() => setDrawTool("line")}
          >
            Draw Line
          </button>
          <button
            type="button"
            className={drawTool === "highlight" ? "toolbar-btn active" : "toolbar-btn"}
            onClick={() => setDrawTool("highlight")}
          >
            Draw Highlight
          </button>
          <div className="color-picker-wrap" role="group" aria-label="Annotation stroke color">
            <span>Stroke</span>
            <div className="stroke-palette">
              {STROKE_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={strokeColor === color ? "stroke-swatch active" : "stroke-swatch"}
                  style={{ background: color }}
                  onClick={() => setStrokeColor(color)}
                  aria-label={`Set stroke color ${color}`}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            className="toolbar-btn"
            onClick={undoLatestAnnotation}
            disabled={!highlights.length}
          >
            Undo
          </button>
        </div>
      ) : null}

      <section
        className={
          mode === "pan" && !isSelectingReference
            ? "pdf-viewer pan-mode"
            : `pdf-viewer annotate-mode${mode === "highlight" ? " highlight-tools-open" : ""}`
        }
        ref={viewerRef}
        onPointerDown={handleViewerPointerDown}
        onPointerMove={handleViewerPointerMove}
        onPointerUp={handleViewerPointerEnd}
        onPointerCancel={handleViewerPointerEnd}
      >
        {!pdfDoc ? <div className="empty-state">Load a PDF to start marking your knitting pattern.</div> : null}

        <div className="pdf-pages-layer" ref={pagesLayerRef}>
          {pages.map((page, pageIndex) => (
            <article
              key={`page-${pageIndex}`}
              className="pdf-page"
              style={{ width: page.width * zoom, height: page.height * zoom }}
              ref={(node) => {
                pageRefs.current[pageIndex] = node;
              }}
            >
              <canvas
                ref={(node) => {
                  canvasRefs.current[pageIndex] = node;
                }}
                className="pdf-canvas"
              />

            <div className="overlay-layer" onPointerDown={(event) => pageOverlayPointerDown(event, pageIndex)}>
              {draftReferenceRect && draftReferenceRect.pageIndex === pageIndex ? (
                <div
                  className="reference-selection"
                  style={{
                    left: draftReferenceRect.x * zoom,
                    top: draftReferenceRect.y * zoom,
                    width: draftReferenceRect.width * zoom,
                    height: draftReferenceRect.height * zoom
                  }}
                />
              ) : null}

              {visibleHighlights
                .filter((item) => item.pageIndex === pageIndex)
                .map((item) => (
                  item.kind === "line" ? (
                    <div
                      key={item.id}
                      className="highlight-line"
                      style={{
                        left: item.x * zoom,
                        top: item.y * zoom,
                        background: item.color ?? strokeColor,
                        width: Math.hypot(((item.x2 ?? item.x) - item.x) * zoom, ((item.y2 ?? item.y) - item.y) * zoom),
                        transform: `rotate(${Math.atan2((item.y2 ?? item.y) - item.y, (item.x2 ?? item.x) - item.x)}rad)`
                      }}
                    />
                  ) : (
                    <div
                      key={item.id}
                      className={item.kind === "highlight" ? "highlight-marker" : "highlight-box"}
                      style={{
                        left: item.x * zoom,
                        top: item.y * zoom,
                        width: item.width * zoom,
                        height: item.height * zoom,
                        borderColor: item.kind === "highlight" ? "transparent" : item.color ?? strokeColor
                      }}
                    />
                  )
                ))}

              {counters
                .filter((counter) => counter.pageIndex === pageIndex)
                .map((counter) => (
                  <div
                    key={counter.id}
                    className={`knit-counter ${counter.type}`}
                    style={{ left: counter.x * zoom, top: counter.y * zoom }}
                  >
                    <div className="counter-top">
                      <button
                        type="button"
                        className="counter-drag-handle"
                        onPointerDown={(event) => startDraggingCounter(event, counter)}
                        aria-label={`Drag ${counter.label} counter`}
                      />
                      {editingCounterId === counter.id ? (
                        <input
                          value={editingCounterTitle}
                          onChange={(event) => setEditingCounterTitle(event.target.value)}
                          onBlur={() => finishCounterTitleEdit(counter.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              finishCounterTitleEdit(counter.id);
                            }
                            if (event.key === "Escape") {
                              setEditingCounterId(null);
                              setEditingCounterTitle("");
                            }
                          }}
                          className="counter-title-input"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          className="counter-kind"
                          onClick={() => startCounterTitleEdit(counter)}
                          aria-label={`Edit ${counter.label} title`}
                        >
                          {counter.label}
                        </button>
                      )}
                      <button
                        type="button"
                        className="counter-close"
                        onClick={() => {
                          setCounters((prev) => prev.filter((item) => item.id !== counter.id));
                          delete counterUndoHistoryRef.current[counter.id];
                        }}
                        aria-label={`Remove ${counter.label} counter`}
                      >
                        x
                      </button>
                    </div>
                    <input
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      value={counter.value}
                      onChange={(event) => setCounterValue(counter.id, Number(event.target.value) || 0)}
                      className="counter-value-input"
                      aria-label={`${counter.label} value`}
                    />
                    <div className="counter-buttons">
                      <button
                        type="button"
                        onClick={() => undoCounter(counter.id)}
                      >
                        Undo
                      </button>
                      <button
                        type="button"
                        onClick={() => applyCounterIncrement(counter.id, 1)}
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() => applyCounterIncrement(counter.id, 5)}
                      >
                        +5
                      </button>
                      <button
                        type="button"
                        onClick={() => applyCounterIncrement(counter.id, 10)}
                      >
                        +10
                      </button>
                    </div>
                  </div>
                ))}
            </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
