"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

type StitchStep = {
  key: string;
  code: string;
  count: number;
  label: string;
  numbered: boolean;
  ordinal: number;
};

type PatternRow = {
  id: string;
  raw: string;
  rowLabel: string;
  sequence: StitchStep[];
  expanded: StitchStep[];
  totalStitches: number;
  numberedStitches: number;
  startCount: number;
  endCount: number;
};

type Counter = {
  id: string;
  name: string;
  value: number;
  contributes: boolean;
};

type GlossaryEntry = {
  code: string;
  title: string;
  detail: string;
};

type ParseResult = {
  rows: PatternRow[];
  errors: string[];
  warnings: string[];
};

type HistoryState = {
  rowIndex: number;
  stitchIndex: number;
  completedRows: number;
};

type RoundDraft = {
  roundNumber: number;
  body: string;
  raw: string;
};

type ParsedOperation = {
  code: string;
  label: string;
  consume: number;
  produce: number;
  units: number;
  countsTowardStitch: boolean;
  warning?: string;
};

const STORAGE_KEY = "whichstitch-state-v2";
const DEFAULT_STARTING_STITCHES = 90;

const DEFAULT_PATTERN = "";

const DEFAULT_GLOSSARY: GlossaryEntry[] = [];

const DEFAULT_COUNTERS: Counter[] = [];

function normalizeCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function cleanToken(value: string): string {
  return value.replace(/^"|"$/g, "").replace(/\.+$/, "").trim();
}

function parsePositiveInt(value: string | undefined, fallback = 1): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function normalizeBodyText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getGlossaryLabel(code: string, glossaryMap: Map<string, GlossaryEntry>): string {
  const normalized = normalizeCode(code);
  const exact = glossaryMap.get(normalized);
  if (exact) {
    return exact.title;
  }

  if (/^k\d*$/i.test(code)) {
    return "Knit";
  }
  if (/^p\d*$/i.test(code)) {
    return "Purl";
  }
  if (/^sl\d*$/i.test(code)) {
    return "Slip";
  }

  return code;
}

function parseGlossaryPaste(text: string): { entries: GlossaryEntry[]; errors: string[] } {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: GlossaryEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    let code = "";
    let meaning = "";

    if (line.includes("\t")) {
      const [left, ...rest] = line.split("\t");
      code = left.trim();
      meaning = rest.join(" ").trim();
    } else if (line.includes(":")) {
      const colonIndex = line.indexOf(":");
      code = line.slice(0, colonIndex).trim();
      meaning = line.slice(colonIndex + 1).trim();
    } else {
      const match = line.match(/^(\S+)\s{2,}(.+)$/);
      if (match) {
        code = match[1].trim();
        meaning = match[2].trim();
      } else {
        errors.push(`Line ${index + 1}: expected \"ABBREV<TAB>Meaning\" format.`);
        return;
      }
    }

    if (!code || !meaning) {
      errors.push(`Line ${index + 1}: missing abbreviation or meaning.`);
      return;
    }

    const normalized = normalizeCode(code);
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);

    entries.push({
      code,
      title: meaning,
      detail: meaning
    });
  });

  return { entries, errors };
}

function parseRoundDrafts(input: string): { drafts: RoundDraft[]; errors: string[] } {
  const errors: string[] = [];
  const drafts: RoundDraft[] = [];

  const rawLines = input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const logicalLines: string[] = [];

  rawLines.forEach((line) => {
    if (/^note\s*:/i.test(line)) {
      return;
    }

    if (/^(Rnds?|Rows?)\s*\d/i.test(line)) {
      logicalLines.push(line);
      return;
    }

    if (!logicalLines.length) {
      errors.push(`Unexpected continuation without round header: \"${line}\"`);
      return;
    }

    logicalLines[logicalLines.length - 1] = `${logicalLines[logicalLines.length - 1]} ${line}`;
  });

  logicalLines.forEach((line) => {
    const headerRegex = /(Rnds?|Rows?)\s*[\d,\s]+:/gi;
    const matches = [...line.matchAll(headerRegex)];

    if (!matches.length) {
      errors.push(`Could not find round header in: \"${line}\"`);
      return;
    }

    matches.forEach((match, index) => {
      const header = match[0];
      const headerStart = match.index ?? 0;
      const bodyStart = headerStart + header.length;
      const bodyEnd = index < matches.length - 1 ? matches[index + 1].index ?? line.length : line.length;
      const body = normalizeBodyText(line.slice(bodyStart, bodyEnd));

      const numbers = header.match(/\d+/g)?.map((value) => Number(value)) ?? [];
      if (!numbers.length) {
        errors.push(`No round numbers found in header \"${header}\".`);
        return;
      }

      numbers.forEach((roundNumber) => {
        drafts.push({
          roundNumber,
          body,
          raw: `${header} ${body}`.trim()
        });
      });
    });
  });

  return { drafts, errors };
}

function parseSingleOperation(token: string, glossaryMap: Map<string, GlossaryEntry>): ParsedOperation {
  const value = cleanToken(token);
  const normalizedValue = value.toLowerCase().replace(/\s+/g, " ");

  const kAroundMatch = normalizedValue.match(/^k\s+around$/i);
  if (kAroundMatch) {
    return {
      code: "k",
      label: getGlossaryLabel("k", glossaryMap),
      consume: 1,
      produce: 1,
      units: 1,
      countsTowardStitch: true
    };
  }

  const placeOnCNMatch = normalizedValue.match(/^place\s+(\d+)\s+sts?\s+on\s+cn\s+and\s+hold\s+(?:to\s+the\s+back|in\s+front)$/i);
  if (placeOnCNMatch) {
    return {
      code: `place${placeOnCNMatch[1]}CN`,
      label: "Cable setup",
      consume: 0,
      produce: 0,
      units: 1,
      countsTowardStitch: false
    };
  }

  const fromCNMatch = normalizedValue.match(/^k(\d+)\s+from\s+cn$/i);
  if (fromCNMatch) {
    const count = parsePositiveInt(fromCNMatch[1]);
    return {
      code: `k${count} from CN`,
      label: "Knit from cable needle",
      consume: count,
      produce: count,
      units: count,
      countsTowardStitch: true
    };
  }

  if (/^k1yok1$/i.test(normalizedValue)) {
    return {
      code: "k1yok1",
      label: getGlossaryLabel("k1yok1", glossaryMap),
      consume: 1,
      produce: 3,
      units: 1,
      countsTowardStitch: true
    };
  }

  if (/^yo$/i.test(normalizedValue)) {
    return {
      code: "yo",
      label: getGlossaryLabel("yo", glossaryMap),
      consume: 0,
      produce: 1,
      units: 1,
      countsTowardStitch: true
    };
  }

  if (/^cdd$/i.test(normalizedValue)) {
    return {
      code: "CDD",
      label: getGlossaryLabel("CDD", glossaryMap),
      consume: 3,
      produce: 1,
      units: 1,
      countsTowardStitch: true
    };
  }

  const kTogMatch = normalizedValue.match(/^k(\d+)tog(?:\s+(tbl|tlb))?(?:\s+from\s+cn)?$/i);
  if (kTogMatch) {
    const count = parsePositiveInt(kTogMatch[1]);
    const suffix = kTogMatch[2] ? ` ${kTogMatch[2].toLowerCase() === "tlb" ? "tbl" : kTogMatch[2].toLowerCase()}` : "";
    const code = `k${count}tog${suffix}`;
    return {
      code,
      label: getGlossaryLabel(`k${count}tog`, glossaryMap),
      consume: count,
      produce: 1,
      units: 1,
      countsTowardStitch: true
    };
  }

  const slipCountMatch = normalizedValue.match(/^sl(\d+)$/i);
  if (slipCountMatch) {
    const count = parsePositiveInt(slipCountMatch[1]);
    return {
      code: `sl${count}`,
      label: getGlossaryLabel(`sl${count}`, glossaryMap),
      consume: count,
      produce: count,
      units: count,
      countsTowardStitch: true
    };
  }

  const basicCountMatch = normalizedValue.match(/^([kp])(\d+)$/i);
  if (basicCountMatch) {
    const op = basicCountMatch[1].toLowerCase();
    const count = parsePositiveInt(basicCountMatch[2]);
    return {
      code: `${op}${count}`,
      label: getGlossaryLabel(`${op}${count}`, glossaryMap),
      consume: count,
      produce: count,
      units: count,
      countsTowardStitch: true
    };
  }

  const singleStitchMatch = normalizedValue.match(/^([kp])$/i);
  if (singleStitchMatch) {
    const op = singleStitchMatch[1].toLowerCase();
    return {
      code: op,
      label: getGlossaryLabel(op, glossaryMap),
      consume: 1,
      produce: 1,
      units: 1,
      countsTowardStitch: true
    };
  }

  return {
    code: value,
    label: value,
    consume: 1,
    produce: 1,
    units: 1,
    countsTowardStitch: true,
    warning: `Unknown token \"${value}\" used fallback consume=1/produce=1.`
  };
}

function parseBodyOperations(body: string, currentStitches: number, glossaryMap: Map<string, GlossaryEntry>): { operations: ParsedOperation[]; warnings: string[] } {
  const normalizedBody = normalizeBodyText(body);
  const warnings: string[] = [];

  if (/^k\s+around\.?$/i.test(normalizedBody)) {
    const stitches = Math.max(1, currentStitches);
    return {
      operations: [
        {
          code: `k${stitches}`,
          label: getGlossaryLabel("k", glossaryMap),
          consume: stitches,
          produce: stitches,
          units: stitches,
          countsTowardStitch: true
        }
      ],
      warnings
    };
  }

  const repeatMatch = normalizedBody.match(/^\*(.+)\*\s*,?\s*rep\s+from\s+\*\s+to\s+\*\s+(\d+)\s+times?\.?$/i);

  const parseTokenList = (text: string) =>
    text
      .split(",")
      .map((part) => cleanToken(part))
      .filter(Boolean)
      .map((part) => parseSingleOperation(part, glossaryMap));

  let operations: ParsedOperation[] = [];

  if (repeatMatch) {
    const block = repeatMatch[1].trim();
    const times = parsePositiveInt(repeatMatch[2]);
    const blockOps = parseTokenList(block);
    operations = Array.from({ length: times }, () => blockOps).flat();
  } else {
    operations = parseTokenList(normalizedBody);
  }

  operations.forEach((op) => {
    if (op.warning) {
      warnings.push(op.warning);
    }
  });

  return { operations, warnings };
}

function parsePatternRows(input: string, glossary: GlossaryEntry[], startingStitches: number): ParseResult {
  const glossaryMap = new Map(glossary.map((entry) => [normalizeCode(entry.code), entry]));
  const { drafts, errors: draftErrors } = parseRoundDrafts(input);
  const rows: PatternRow[] = [];
  const errors = [...draftErrors];
  const warnings: string[] = [];

  let liveStitches = Math.max(1, startingStitches);
  const resolvedBodies = new Map<number, string>();

  drafts
    .sort((a, b) => a.roundNumber - b.roundNumber)
    .forEach((draft) => {
      const seeMatch = draft.body.match(/^see\s+r(?:nd|ow)?\s*(\d+)\.?$/i);
      let resolvedBody = draft.body;

      if (seeMatch) {
        const target = Number(seeMatch[1]);
        const targetBody = resolvedBodies.get(target);
        if (!targetBody) {
          errors.push(`${draft.raw}: could not resolve reference to R${target}.`);
          return;
        }
        resolvedBody = targetBody;
      }

      resolvedBodies.set(draft.roundNumber, resolvedBody);

      const { operations, warnings: opWarnings } = parseBodyOperations(resolvedBody, liveStitches, glossaryMap);

      warnings.push(...opWarnings.map((warning) => `Rnd${draft.roundNumber}: ${warning}`));

      if (!operations.length) {
        errors.push(`Rnd${draft.roundNumber}: no instructions parsed.`);
        return;
      }

      const sequence: StitchStep[] = operations.map((operation, index) => ({
        key: `${draft.roundNumber}-${index}-${normalizeCode(operation.code)}`,
        code: operation.code,
        count: operation.units,
        label: operation.label,
        numbered: operation.countsTowardStitch,
        ordinal: 0
      }));

      const expanded: StitchStep[] = [];
      let runningOrdinal = 0;
      sequence.forEach((step, stepIndex) => {
        for (let i = 0; i < step.count; i += 1) {
          if (step.numbered) {
            runningOrdinal += 1;
          }
          expanded.push({
            key: `${step.key}-${stepIndex}-${i}`,
            code: step.code,
            count: 1,
            label: step.label,
            numbered: step.numbered,
            ordinal: runningOrdinal
          });
        }
      });

      const startCount = liveStitches;
      const stitchDelta = operations.reduce((sum, operation) => sum + (operation.produce - operation.consume), 0);
      const endCount = Math.max(0, startCount + stitchDelta);

      rows.push({
        id: `RND-${draft.roundNumber}`,
        raw: draft.raw,
        rowLabel: `RND ${draft.roundNumber}`,
        sequence,
        expanded,
        totalStitches: expanded.length,
        numberedStitches: runningOrdinal,
        startCount,
        endCount
      });

      liveStitches = endCount;
    });

  return {
    rows,
    errors,
    warnings: Array.from(new Set(warnings))
  };
}

function getTimeline(row: PatternRow | undefined, stitchIndex: number): Array<{ index: number; code: string; active: boolean }> {
  if (!row || !row.expanded.length) {
    return [];
  }

  const start = Math.max(0, stitchIndex - 10);
  const end = Math.min(row.expanded.length - 1, stitchIndex + 10);
  const timeline = [];

  for (let i = start; i <= end; i += 1) {
    timeline.push({ index: i, code: row.expanded[i].code, active: i === stitchIndex });
  }

  return timeline;
}

export default function HomePage() {
  const [patternText, setPatternText] = useState(DEFAULT_PATTERN);
  const [startingStitches, setStartingStitches] = useState(DEFAULT_STARTING_STITCHES);
  const [rowIndex, setRowIndex] = useState(0);
  const [stitchIndex, setStitchIndex] = useState(0);
  const [completedRows, setCompletedRows] = useState(0);
  const [rowToast, setRowToast] = useState<string>("");
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [selectedCell, setSelectedCell] = useState<{ row: number; stitch: number } | null>(null);
  const [autoCenterPending, setAutoCenterPending] = useState(false);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  const [counters, setCounters] = useState<Counter[]>(DEFAULT_COUNTERS);
  const [showPatternPanel, setShowPatternPanel] = useState(false);
  const [showGlossaryPanel, setShowGlossaryPanel] = useState(false);

  const [glossary, setGlossary] = useState<GlossaryEntry[]>(DEFAULT_GLOSSARY);
  const [glossarySearch, setGlossarySearch] = useState("");
  const [glossaryPaste, setGlossaryPaste] = useState("");
  const [glossaryPasteErrors, setGlossaryPasteErrors] = useState<string[]>([]);

  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const hasCenteredInitialRef = useRef(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setShowPatternPanel(true);
      setHasLoadedStorage(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        patternText?: string;
        startingStitches?: number;
        rowIndex?: number;
        stitchIndex?: number;
        completedRows?: number;
        counters?: Counter[];
        glossary?: GlossaryEntry[];
      };

      if (parsed.patternText) {
        setPatternText(parsed.patternText);
      }
      if (typeof parsed.startingStitches === "number") {
        setStartingStitches(parsed.startingStitches);
      }
      if (typeof parsed.rowIndex === "number") {
        setRowIndex(parsed.rowIndex);
      }
      if (typeof parsed.stitchIndex === "number") {
        setStitchIndex(parsed.stitchIndex);
      }
      if (typeof parsed.completedRows === "number") {
        setCompletedRows(parsed.completedRows);
      }
      if (Array.isArray(parsed.counters) && parsed.counters.length) {
        setCounters(parsed.counters);
      }
      if (Array.isArray(parsed.glossary) && parsed.glossary.length) {
        setGlossary(parsed.glossary);
      }
      if (!parsed.patternText || !parsed.patternText.trim()) {
        setShowPatternPanel(true);
      }
    } catch {
      // Ignore invalid persisted state.
      setShowPatternPanel(true);
    } finally {
      setHasLoadedStorage(true);
    }
  }, []);

  const parseResult = useMemo(
    () => parsePatternRows(patternText, glossary, startingStitches),
    [patternText, glossary, startingStitches]
  );
  const currentRow = parseResult.rows[rowIndex];

  useEffect(() => {
    if (!parseResult.rows.length) {
      setRowIndex(0);
      setStitchIndex(0);
      return;
    }

    if (rowIndex > parseResult.rows.length - 1) {
      setRowIndex(0);
      setStitchIndex(0);
      return;
    }

    const row = parseResult.rows[rowIndex];
    if (stitchIndex > row.totalStitches - 1) {
      setStitchIndex(Math.max(0, row.totalStitches - 1));
    }
  }, [parseResult.rows, rowIndex, stitchIndex]);

  useEffect(() => {
    if (!hasLoadedStorage) {
      return;
    }
    const payload = JSON.stringify({
      patternText,
      startingStitches,
      rowIndex,
      stitchIndex,
      completedRows,
      counters,
      glossary
    });
    window.localStorage.setItem(STORAGE_KEY, payload);
  }, [hasLoadedStorage, patternText, startingStitches, rowIndex, stitchIndex, completedRows, counters, glossary]);

  useEffect(() => {
    if (!rowToast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRowToast("");
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [rowToast]);

  useEffect(() => {
    if (!selectedCell) {
      return;
    }
    const row = parseResult.rows[selectedCell.row];
    if (!row || selectedCell.stitch > row.totalStitches - 1) {
      setSelectedCell(null);
    }
  }, [parseResult.rows, selectedCell]);

  const currentStitch = currentRow?.expanded[Math.min(stitchIndex, Math.max(0, (currentRow?.expanded.length ?? 1) - 1))];

  const timeline = useMemo(() => getTimeline(currentRow, stitchIndex), [currentRow, stitchIndex]);
  const maxTimelineStitches = useMemo(
    () => parseResult.rows.reduce((max, row) => Math.max(max, row.totalStitches), 0),
    [parseResult.rows]
  );

  const filteredGlossary = glossary.filter((entry) => {
    const q = glossarySearch.trim().toLowerCase();
    if (!q) {
      return true;
    }
    return (
      entry.code.toLowerCase().includes(q) ||
      entry.title.toLowerCase().includes(q) ||
      entry.detail.toLowerCase().includes(q)
    );
  });

  function pushHistoryState() {
    setHistory((prev) => [{ rowIndex, stitchIndex, completedRows }, ...prev].slice(0, 200));
  }

  function incrementPatternBy(step: number) {
    if (!parseResult.rows.length || step < 1) {
      return;
    }

    pushHistoryState();

    let nextRowIndex = rowIndex;
    let nextStitchIndex = stitchIndex;
    let nextCompletedRows = completedRows;

    for (let i = 0; i < step; i += 1) {
      const row = parseResult.rows[nextRowIndex];
      if (!row) {
        break;
      }

      const atFinalRow = nextRowIndex === parseResult.rows.length - 1;
      const atFinalStitch = nextStitchIndex >= row.totalStitches - 1;
      if (atFinalRow && atFinalStitch) {
        setRowToast("Pattern complete.");
        break;
      }

      if (nextStitchIndex < row.totalStitches - 1) {
        nextStitchIndex += 1;
      } else {
        nextCompletedRows += 1;
        if (nextRowIndex < parseResult.rows.length - 1) {
          nextRowIndex += 1;
          nextStitchIndex = 0;
          setRowToast(`${row.rowLabel} complete. Now on ${parseResult.rows[nextRowIndex].rowLabel}.`);
        }
      }
    }

    setRowIndex(nextRowIndex);
    setStitchIndex(nextStitchIndex);
    setCompletedRows(nextCompletedRows);
    setAutoCenterPending(true);
  }

  function moveToNextRow() {
    if (!parseResult.rows.length) {
      return;
    }

    pushHistoryState();

    if (rowIndex >= parseResult.rows.length - 1) {
      setRowToast("Pattern complete.");
      return;
    }

    const nextRow = rowIndex + 1;
    setRowIndex(nextRow);
    setStitchIndex(0);
    setCompletedRows(nextRow);
    setSelectedCell(null);
    setAutoCenterPending(true);
    setRowToast(`Moved to ${parseResult.rows[nextRow].rowLabel}.`);
  }

  function undoPatternStep() {
    setHistory((prev) => {
      const [latest, ...rest] = prev;
      if (!latest) {
        return prev;
      }

      setRowIndex(latest.rowIndex);
      setStitchIndex(latest.stitchIndex);
      setCompletedRows(latest.completedRows);
      return rest;
    });
  }

  const recenterTimeline = useCallback(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) {
      return;
    }

    const selector = `[data-timeline-cell="r${rowIndex}-s${stitchIndex}"]`;
    const cell = viewport.querySelector<HTMLElement>(selector);
    if (!cell) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    const targetLeft =
      viewport.scrollLeft + (cellRect.left - viewportRect.left) - (viewport.clientWidth - cellRect.width) / 2;
    const targetTop =
      viewport.scrollTop + (cellRect.top - viewportRect.top) - (viewport.clientHeight - cellRect.height) / 2;

    viewport.scrollTo({
      left: Math.max(0, targetLeft),
      top: Math.max(0, targetTop),
      behavior: "smooth"
    });
  }, [rowIndex, stitchIndex]);

  function moveToSelectedCell() {
    if (!selectedCell) {
      return;
    }

    pushHistoryState();
    setRowIndex(selectedCell.row);
    setStitchIndex(selectedCell.stitch);
    setCompletedRows(selectedCell.row);
    const target = parseResult.rows[selectedCell.row]?.expanded[selectedCell.stitch];
    const targetLabel = target?.numbered ? `stitch ${target.ordinal}` : "unnumbered step";
    setRowToast(`Moved to ${parseResult.rows[selectedCell.row]?.rowLabel}, ${targetLabel}.`);
    setSelectedCell(null);
  }

  useEffect(() => {
    if (hasCenteredInitialRef.current || !parseResult.rows.length) {
      return;
    }
    hasCenteredInitialRef.current = true;
    window.requestAnimationFrame(recenterTimeline);
  }, [parseResult.rows.length, recenterTimeline]);

  useEffect(() => {
    if (!autoCenterPending) {
      return;
    }
    window.requestAnimationFrame(() => {
      recenterTimeline();
      setAutoCenterPending(false);
    });
  }, [autoCenterPending, recenterTimeline]);

  function incrementCounter(counterId: string, amount: number) {
    let shouldAdvancePattern = false;

    setCounters((prev) =>
      prev.map((counter) => {
        if (counter.id !== counterId) {
          return counter;
        }

        if (counter.contributes && amount > 0) {
          shouldAdvancePattern = true;
        }

        return { ...counter, value: Math.max(0, counter.value + amount) };
      })
    );

    if (shouldAdvancePattern) {
      incrementPatternBy(amount);
    }
  }

  function addCounter() {
    setCounters((prev) => [
      ...prev,
      {
        id: `counter-${Date.now()}`,
        name: `Counter ${prev.length + 1}`,
        value: 0,
        contributes: false
      }
    ]);
  }

  function renameCounter(counterId: string, name: string) {
    setCounters((prev) => prev.map((counter) => (counter.id === counterId ? { ...counter, name } : counter)));
  }

  async function pastePatternFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setRowToast("Clipboard is empty.");
        return;
      }
      setPatternText(text);
      setRowToast("Pattern pasted from clipboard.");
    } catch {
      setRowToast("Clipboard access unavailable. Paste manually.");
    }
  }

  function importGlossaryFromPaste(event: FormEvent) {
    event.preventDefault();
    const { entries, errors } = parseGlossaryPaste(glossaryPaste);
    setGlossaryPasteErrors(errors);
    if (errors.length || !entries.length) {
      return;
    }
    setGlossary(entries);
    setGlossaryPaste("");
  }

  const currentOrdinal = currentStitch?.ordinal ?? 0;
  const stitchProgress = currentRow ? `${currentOrdinal} / ${currentRow.numberedStitches}` : "-";
  const remainingStitches = currentRow ? Math.max(0, currentRow.numberedStitches - currentOrdinal) : 0;
  const hasPatternInput = patternText.trim().length > 0;

  return (
      <main className="app-shell">
      <header className="toolbar card">
        <div className="brand">
          <p className="eyebrow">WhichStitch</p>
          <h1>Pattern Map</h1>
        </div>
        <div className="toolbar-stats">
          <span>{currentRow ? currentRow.rowLabel : "No row"}</span>
          <span>{stitchProgress}</span>
          <span>{currentRow ? `${currentRow.startCount} -> ${currentRow.endCount} sts` : `${startingStitches} sts`}</span>
        </div>
        <div className="toolbar-actions">
          <div className="toolbar-popover-anchor">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setShowPatternPanel((prev) => {
                  const next = !prev;
                  if (next) {
                    setShowGlossaryPanel(false);
                  }
                  return next;
                });
              }}
            >
              {showPatternPanel ? "Hide Pattern" : "Pattern"}
            </button>
            {showPatternPanel ? (
              <section className="card utility-panel toolbar-popover toolbar-popover-pattern">
                <div className="section-heading">
                  <h2>Pattern Input</h2>
                  <button type="button" className="ghost" onClick={pastePatternFromClipboard}>
                    Paste
                  </button>
                </div>
                <p className="muted">`RndN: ...` or `RowN: ...` per line</p>
                <div className="start-row">
                  <label htmlFor="starting-stitches" className="muted">
                    Starting stitches
                  </label>
                  <input
                    id="starting-stitches"
                    type="number"
                    min={1}
                    value={startingStitches}
                    onChange={(event) => setStartingStitches(Math.max(1, Number(event.target.value) || 1))}
                  />
                </div>
                <textarea
                  value={patternText}
                  onChange={(event) => setPatternText(event.target.value)}
                  className="pattern-input"
                  rows={12}
                  spellCheck={false}
                />
                {parseResult.errors.length ? (
                  <ul className="errors">
                    {parseResult.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{parseResult.rows.length} row(s) parsed successfully.</p>
                )}
                {parseResult.warnings.length ? (
                  <ul className="warnings">
                    {parseResult.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </div>

          <div className="toolbar-popover-anchor">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setShowGlossaryPanel((prev) => {
                  const next = !prev;
                  if (next) {
                    setShowPatternPanel(false);
                  }
                  return next;
                });
              }}
            >
              {showGlossaryPanel ? "Hide Glossary" : "Glossary"}
            </button>
            {showGlossaryPanel ? (
              <section className="card utility-panel toolbar-popover toolbar-popover-glossary">
                <div className="section-heading">
                  <h2>Stitch Glossary</h2>
                  <span className="muted">{filteredGlossary.length} entries</span>
                </div>
                {!glossary.length ? (
                  <form className="glossary-form" onSubmit={importGlossaryFromPaste}>
                    <p className="muted">
                      Paste glossary rows as `ABBREV[TAB]Meaning`, one per line.
                    </p>
                    <textarea
                      value={glossaryPaste}
                      onChange={(event) => setGlossaryPaste(event.target.value)}
                      placeholder={"BOR\tBeginning of round\nCO\tCast on\n..."}
                      rows={10}
                      aria-label="Paste glossary entries"
                    />
                    <button type="submit" className="primary">
                      Parse Glossary Paste
                    </button>
                    {glossaryPasteErrors.length ? (
                      <ul className="errors">
                        {glossaryPasteErrors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    ) : null}
                  </form>
                ) : (
                  <>
                    <input
                      value={glossarySearch}
                      onChange={(event) => setGlossarySearch(event.target.value)}
                      placeholder="Search by code or meaning"
                      aria-label="Search glossary"
                    />
                    <ul className="glossary-list">
                      {filteredGlossary.map((entry) => (
                        <li key={entry.code}>
                          <p className="glossary-code">{entry.code}</p>
                          <span>{entry.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            ) : null}
          </div>

          <button type="button" className="primary" onClick={addCounter}>
            New Counter
          </button>
        </div>
      </header>

      <section className="timeline-stage card">
        <div className="timeline-header">
          <h2>Stitch Timeline</h2>
          <span className="muted">Scroll any direction, tap any stitch to jump</span>
        </div>
        {!hasPatternInput ? (
          <p className="muted">
            Paste your pattern to begin. Use the `Pattern` button above to open the input panel.
          </p>
        ) : null}
        {hasPatternInput && !timeline.length ? (
          <p className="muted">Timeline appears once the pattern parses successfully.</p>
        ) : null}

        <div className="timeline-body">
          <aside className="floating-panel">
            <p className="eyebrow">Current</p>
            <p className="panel-stitch">{currentStitch ? currentStitch.code : "--"}</p>
            <p className="panel-note">{currentStitch ? currentStitch.label : "Load pattern"}</p>
            <div className="panel-mini">
              <span>{currentRow ? currentRow.rowLabel : "-"}</span>
              <span>{stitchProgress}</span>
              <span>{remainingStitches} left</span>
            </div>
            {rowToast ? <p className="toast small">{rowToast}</p> : null}
            <div className="panel-actions">
              <button type="button" className="primary" onClick={() => incrementPatternBy(1)}>
                +1
              </button>
              <button type="button" className="ghost" onClick={() => incrementPatternBy(5)}>
                +5
              </button>
              <button type="button" className="ghost" onClick={() => incrementPatternBy(10)}>
                +10
              </button>
              <button type="button" className="ghost" onClick={moveToNextRow}>
                Next Row
              </button>
              <button type="button" className="ghost" onClick={undoPatternStep}>
                Undo
              </button>
              <button type="button" className="ghost" onClick={recenterTimeline}>
                Recenter
              </button>
            </div>
          </aside>

          <div className="timeline-viewport" aria-live="polite" ref={timelineViewportRef}>
            <div
              className="timeline-grid"
              style={{
                gridTemplateColumns: `7.2rem repeat(${Math.max(maxTimelineStitches, 1)}, minmax(4.1rem, 4.1rem))`
              }}
            >
              <div className="timeline-header-cell corner">Row</div>
              {Array.from({ length: maxTimelineStitches }, (_, index) => (
                <div key={`col-${index + 1}`} className="timeline-header-cell">
                  {index + 1}
                </div>
              ))}

              {parseResult.rows.map((row, rowIdx) => (
                <Fragment key={row.id}>
                  <div className={rowIdx === rowIndex ? "timeline-row-label active" : "timeline-row-label"}>
                    {row.rowLabel}
                  </div>
                  {Array.from({ length: maxTimelineStitches }, (_, stitchIdx) => {
                    if (stitchIdx > row.totalStitches - 1) {
                      return <div key={`${row.id}-empty-${stitchIdx}`} className="timeline-cell-wrap empty" />;
                    }

                    const step = row.expanded[stitchIdx];
                    const isActive = rowIdx === rowIndex && stitchIdx === stitchIndex;
                    const isSelected = selectedCell?.row === rowIdx && selectedCell?.stitch === stitchIdx;
                    const cellClass = isActive
                      ? "timeline-cell active"
                      : isSelected
                        ? "timeline-cell selected"
                        : "timeline-cell";

                    return (
                      <div
                        key={`${row.id}-${stitchIdx}`}
                        className="timeline-cell-wrap"
                        data-timeline-cell={`r${rowIdx}-s${stitchIdx}`}
                      >
                        <button
                          type="button"
                          className={cellClass}
                          onClick={() => setSelectedCell({ row: rowIdx, stitch: stitchIdx })}
                        >
                          <span className="cell-index">{step.numbered ? step.ordinal : ""}</span>
                          <span className="cell-code">{step.code}</span>
                        </button>
                        {isSelected ? (
                          <div className="cell-popover">
                            <button type="button" className="primary" onClick={moveToSelectedCell}>
                              Move Here
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      {counters.length ? (
        <section className="counter-dock card">
          <div className="section-heading">
            <h2>Counters</h2>
            <span className="muted">{counters.length} active</span>
          </div>
          <ul className="counter-list compact">
            {counters.map((counter) => (
              <li key={counter.id} className="counter-item compact">
                <input
                  value={counter.name}
                  onChange={(event) => renameCounter(counter.id, event.target.value)}
                  aria-label={`Rename ${counter.name}`}
                />
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={counter.contributes}
                    onChange={(event) =>
                      setCounters((prev) =>
                        prev.map((item) => (item.id === counter.id ? { ...item, contributes: event.target.checked } : item))
                      )
                    }
                  />
                  Include
                </label>
                <div className="counter-controls">
                  <button type="button" className="ghost" onClick={() => incrementCounter(counter.id, -1)}>
                    -1
                  </button>
                  <strong>{counter.value}</strong>
                  <button type="button" className="ghost" onClick={() => incrementCounter(counter.id, 1)}>
                    +1
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      </main>
  );
}
