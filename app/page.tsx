"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

type ViewerMode = "pan" | "highlight";
type DrawTool = "rectangle" | "line" | "highlight";
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
};

const STORAGE_KEY = "whichstitch-pdf-workspace-v1";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCounterLabel(type: CounterType): string {
  return type === "row" ? "Row" : "Stitch";
}

export default function HomePage() {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfFileName, setPdfFileName] = useState("No PDF loaded");
  const [pages, setPages] = useState<PageMetric[]>([]);
  const [zoom, setZoom] = useState(1.1);
  const [mode, setMode] = useState<ViewerMode>("pan");
  const [drawTool, setDrawTool] = useState<DrawTool>("rectangle");
  const [highlights, setHighlights] = useState<Annotation[]>([]);
  const [counters, setCounters] = useState<KnitCounter[]>([]);
  const [editingCounterId, setEditingCounterId] = useState<string | null>(null);
  const [editingCounterTitle, setEditingCounterTitle] = useState("");
  const [loadedState, setLoadedState] = useState(false);

  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pageRefs = useRef<(HTMLElement | null)[]>([]);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const counterUndoHistoryRef = useRef<Record<string, number[]>>({});

  const drawingRef = useRef<{
    tool: DrawTool;
    pageIndex: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
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

  useEffect(() => {
    GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
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
      counters
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [loadedState, zoom, highlights, counters]);

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

  useEffect(() => {
    function handlePointerMove(event: MouseEvent) {
      const drawing = drawingRef.current;
      if (drawing) {
        const pageElement = pageRefs.current[drawing.pageIndex];
        if (!pageElement) {
          return;
        }

        const rect = pageElement.getBoundingClientRect();
        const x = clamp((event.clientX - rect.left) / zoom, 0, pages[drawing.pageIndex]?.width ?? 0);
        const y = clamp((event.clientY - rect.top) / zoom, 0, pages[drawing.pageIndex]?.height ?? 0);

        if (drawing.tool === "rectangle") {
          const startX = Math.min(drawing.startX, x);
          const startY = Math.min(drawing.startY, y);

          setDraftHighlight({
            id: "draft",
            kind: "rectangle",
            pageIndex: drawing.pageIndex,
            x: startX,
            y: startY,
            width: Math.abs(x - drawing.startX),
            height: Math.abs(y - drawing.startY)
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
            y2: y
          });
          return;
        }

        const dx = x - drawing.lastX;
        const dy = y - drawing.lastY;
        if (Math.hypot(dx, dy) >= 12) {
          drawingRef.current = {
            ...drawing,
            lastX: x,
            lastY: y
          };
          setHighlights((prev) => [
            ...prev,
            {
              id: `hl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              kind: "highlight",
              pageIndex: drawing.pageIndex,
              x: x - 7,
              y: y - 6,
              width: 14,
              height: 12
            }
          ]);
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
        const x = clamp((event.clientX - rect.left) / zoom - drag.offsetX, 0, pageMetric.width - 8);
        const y = clamp((event.clientY - rect.top) / zoom - drag.offsetY, 0, pageMetric.height - 8);

        setCounters((prev) =>
          prev.map((counter) =>
            counter.id === drag.counterId
              ? {
                  ...counter,
                  x,
                  y
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
      if (drawing?.tool === "rectangle" && draftHighlight && draftHighlight.width > 10 && draftHighlight.height > 10) {
        setHighlights((prev) => [...prev, { ...draftHighlight, id: `hl-${Date.now()}`, kind: "rectangle" }]);
      }

      if (drawing?.tool === "line" && draftHighlight?.kind === "line") {
        const lineLength = Math.hypot((draftHighlight.x2 ?? draftHighlight.x) - draftHighlight.x, (draftHighlight.y2 ?? draftHighlight.y) - draftHighlight.y);
        if (lineLength > 8) {
          setHighlights((prev) => [...prev, { ...draftHighlight, id: `hl-${Date.now()}`, kind: "line" }]);
        }
      }

      drawingRef.current = null;
      draggingCounterRef.current = null;
      panningRef.current = null;
      setDraftHighlight(null);
    }

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [draftHighlight, pages, zoom]);

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

  function pageOverlayMouseDown(event: React.MouseEvent, pageIndex: number) {
    if (event.button !== 0) {
      return;
    }

    const pageElement = pageRefs.current[pageIndex];
    if (!pageElement) {
      return;
    }

    if (mode === "highlight") {
      const rect = pageElement.getBoundingClientRect();
      const startX = clamp((event.clientX - rect.left) / zoom, 0, pages[pageIndex]?.width ?? 0);
      const startY = clamp((event.clientY - rect.top) / zoom, 0, pages[pageIndex]?.height ?? 0);

      if (drawTool === "highlight") {
        setHighlights((prev) => [
          ...prev,
          {
            id: `hl-${Date.now()}`,
            kind: "highlight",
            pageIndex,
            x: startX - 7,
            y: startY - 6,
            width: 14,
            height: 12
          }
        ]);
      }

      drawingRef.current = { tool: drawTool, pageIndex, startX, startY, lastX: startX, lastY: startY };
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

    const viewerRect = viewer.getBoundingClientRect();
    const centerY = viewer.scrollTop + viewerRect.height / 2;

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
    setCounters((prev) => [
      ...prev,
      {
        id: `counter-${Date.now()}`,
        pageIndex: targetPage,
        x: page.width * 0.34,
        y: page.height * 0.22,
        type,
        label: formatCounterLabel(type),
        value: 0
      }
    ]);
  }

  function startDraggingCounter(event: React.MouseEvent, counter: KnitCounter) {
    const target = event.target as HTMLElement;
    if (target.closest("input, button, select, textarea, label")) {
      return;
    }

    event.stopPropagation();

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

      <section className={mode === "pan" ? "pdf-viewer pan-mode" : "pdf-viewer highlight-tools-open"} ref={viewerRef}>
        {!pdfDoc ? <div className="empty-state">Load a PDF to start marking your knitting pattern.</div> : null}

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

            <div className="overlay-layer" onMouseDown={(event) => pageOverlayMouseDown(event, pageIndex)}>
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
                        height: item.height * zoom
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
                    onMouseDown={(event) => startDraggingCounter(event, counter)}
                  >
                    <div className="counter-top">
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
      </section>
    </main>
  );
}
