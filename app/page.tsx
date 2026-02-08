"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type StitchStep = {
  key: string;
  code: string;
  count: number;
  label: string;
};

type PatternRow = {
  id: string;
  raw: string;
  rowLabel: string;
  sequence: StitchStep[];
  expanded: StitchStep[];
  totalStitches: number;
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
};

type HistoryState = {
  rowIndex: number;
  stitchIndex: number;
  completedRows: number;
};

const STORAGE_KEY = "loop-ledger-state-v1";

const DEFAULT_PATTERN = `Rnd1: *k2, p2; rep from * to * 10 times
Rnd2: *k2, p2; rep from * to * 10 times
Rnd3: CDD, k1, yo, k2tog, k5`;

const DEFAULT_GLOSSARY: GlossaryEntry[] = [
  { code: "K", title: "Knit", detail: "Insert right needle front-to-back through the stitch, wrap yarn, and pull a new loop through." },
  { code: "P", title: "Purl", detail: "Insert right needle right-to-left through the stitch, wrap yarn at front, and pull through." },
  { code: "YO", title: "Yarn Over", detail: "Bring yarn over needle to create a new stitch and an eyelet opening." },
  { code: "K2TOG", title: "Knit Two Together", detail: "A right-leaning decrease made by knitting two stitches as one." },
  { code: "SSK", title: "Slip Slip Knit", detail: "A left-leaning decrease made by slipping two stitches then knitting them together through the back loop." },
  { code: "CDD", title: "Centered Double Decrease", detail: "Decrease two stitches at once so the center stitch stays visually centered." },
  { code: "PM", title: "Place Marker", detail: "Place a stitch marker on the needle to mark repeats or section boundaries." },
  { code: "SM", title: "Slip Marker", detail: "Move a marker from left to right needle without working a stitch." }
];

const DEFAULT_COUNTERS: Counter[] = [
  { id: "main", name: "Main Counter", value: 0, contributes: true }
];

function normalizeCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function inferStitchCount(code: string, explicit?: number): number {
  if (explicit && explicit > 0) {
    return explicit;
  }

  const lowered = code.toLowerCase();
  const numericPrefix = lowered.match(/^(\d+)/);
  const numericSuffix = lowered.match(/(\d+)$/);

  if (numericPrefix && /^(k|p)$/i.test(lowered.replace(/^\d+/, ""))) {
    return Number(numericPrefix[1]);
  }

  if (numericSuffix && /^(k|p)/i.test(lowered)) {
    return Number(numericSuffix[1]);
  }

  if (lowered.includes("k2tog") || lowered.includes("ssk") || lowered.includes("cdd")) {
    return 2;
  }

  return 1;
}

function expandInstructionBody(instruction: string): string {
  const repeatRegex = /\*(.+?);\s*rep\s+from\s+\*\s+to\s+\*\s+(\d+)\s+times?/i;
  const match = instruction.match(repeatRegex);

  if (!match) {
    return instruction;
  }

  const block = match[1].trim();
  const times = Number(match[2]);
  if (!Number.isFinite(times) || times < 1) {
    return instruction;
  }

  const repeated = Array.from({ length: times }, () => block).join(", ");
  return instruction.replace(repeatRegex, repeated);
}

function parseToken(token: string, glossaryMap: Map<string, GlossaryEntry>): StitchStep | null {
  const cleaned = token.trim().replace(/^"|"$/g, "");
  if (!cleaned) {
    return null;
  }

  const explicitCount = cleaned.match(/\[(\d+)\]$/);
  const codeWithoutCount = explicitCount ? cleaned.slice(0, cleaned.lastIndexOf("[")).trim() : cleaned;

  const parsed = codeWithoutCount.match(/^([A-Za-z0-9]+)(?:\s+(\d+))?$/);
  const rawCode = parsed ? parsed[1] : codeWithoutCount;
  const inlineNumber = parsed?.[2] ? Number(parsed[2]) : undefined;
  const normalized = normalizeCode(rawCode);
  const count = inferStitchCount(rawCode, explicitCount ? Number(explicitCount[1]) : inlineNumber);

  const glossaryEntry = glossaryMap.get(normalized);

  return {
    key: `${normalized}-${Math.random().toString(36).slice(2, 8)}`,
    code: rawCode,
    count,
    label: glossaryEntry ? glossaryEntry.title : rawCode
  };
}

function parsePatternRows(input: string, glossary: GlossaryEntry[]): ParseResult {
  const glossaryMap = new Map(glossary.map((entry) => [normalizeCode(entry.code), entry]));
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: PatternRow[] = [];
  const errors: string[] = [];

  lines.forEach((line, index) => {
    const rowMatch = line.match(/^(Rnd|Row)\s*(\d+)\s*:\s*(.+)$/i);
    if (!rowMatch) {
      errors.push(`Line ${index + 1}: must follow \"RndN: ...\" or \"RowN: ...\" format.`);
      return;
    }

    const rowType = rowMatch[1];
    const rowNumber = rowMatch[2];
    const body = expandInstructionBody(rowMatch[3]);
    const tokens = body
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

    if (!tokens.length) {
      errors.push(`Line ${index + 1}: has no stitch instructions.`);
      return;
    }

    const sequence = tokens
      .map((token) => parseToken(token, glossaryMap))
      .filter((token): token is StitchStep => Boolean(token));

    if (!sequence.length) {
      errors.push(`Line ${index + 1}: could not parse stitch tokens.`);
      return;
    }

    const expanded: StitchStep[] = [];
    sequence.forEach((step) => {
      for (let i = 0; i < Math.max(1, step.count); i += 1) {
        expanded.push({
          key: `${step.key}-${i}`,
          code: step.code,
          count: 1,
          label: step.label
        });
      }
    });

    rows.push({
      id: `${rowType.toUpperCase()}-${rowNumber}`,
      raw: line,
      rowLabel: `${rowType.toUpperCase()} ${rowNumber}`,
      sequence,
      expanded,
      totalStitches: expanded.length
    });
  });

  return { rows, errors };
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
  const [rowIndex, setRowIndex] = useState(0);
  const [stitchIndex, setStitchIndex] = useState(0);
  const [completedRows, setCompletedRows] = useState(0);
  const [rowToast, setRowToast] = useState<string>("");
  const [history, setHistory] = useState<HistoryState[]>([]);

  const [counters, setCounters] = useState<Counter[]>(DEFAULT_COUNTERS);
  const [newCounterName, setNewCounterName] = useState("");

  const [glossary, setGlossary] = useState<GlossaryEntry[]>(DEFAULT_GLOSSARY);
  const [glossarySearch, setGlossarySearch] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDetail, setNewDetail] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as {
        patternText?: string;
        rowIndex?: number;
        stitchIndex?: number;
        completedRows?: number;
        counters?: Counter[];
        glossary?: GlossaryEntry[];
      };

      if (parsed.patternText) {
        setPatternText(parsed.patternText);
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
    } catch {
      // ignore invalid persisted state
    }
  }, []);

  const parseResult = useMemo(() => parsePatternRows(patternText, glossary), [patternText, glossary]);
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
    const payload = JSON.stringify({
      patternText,
      rowIndex,
      stitchIndex,
      completedRows,
      counters,
      glossary
    });
    window.localStorage.setItem(STORAGE_KEY, payload);
  }, [patternText, rowIndex, stitchIndex, completedRows, counters, glossary]);

  useEffect(() => {
    if (!rowToast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRowToast("");
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [rowToast]);

  const currentStitch = currentRow?.expanded[Math.min(stitchIndex, Math.max(0, (currentRow?.expanded.length ?? 1) - 1))];

  const timeline = useMemo(() => getTimeline(currentRow, stitchIndex), [currentRow, stitchIndex]);

  const contributingTotal = counters
    .filter((counter) => counter.contributes)
    .reduce((sum, counter) => sum + counter.value, 0);

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

  function incrementCounter(counterId: string, amount: number) {
    setCounters((prev) =>
      prev.map((counter) =>
        counter.id === counterId ? { ...counter, value: Math.max(0, counter.value + amount) } : counter
      )
    );
  }

  function addCounter(event: FormEvent) {
    event.preventDefault();
    const trimmed = newCounterName.trim();
    if (!trimmed) {
      return;
    }

    setCounters((prev) => [
      ...prev,
      {
        id: `counter-${Date.now()}`,
        name: trimmed,
        value: 0,
        contributes: false
      }
    ]);
    setNewCounterName("");
  }

  function renameCounter(counterId: string, name: string) {
    setCounters((prev) => prev.map((counter) => (counter.id === counterId ? { ...counter, name } : counter)));
  }

  function addGlossaryEntry(event: FormEvent) {
    event.preventDefault();
    const code = newCode.trim();
    const title = newTitle.trim();
    const detail = newDetail.trim();
    if (!code || !title || !detail) {
      return;
    }

    const normalized = normalizeCode(code);
    setGlossary((prev) => {
      const existing = prev.find((entry) => normalizeCode(entry.code) === normalized);
      if (existing) {
        return prev.map((entry) =>
          normalizeCode(entry.code) === normalized ? { ...entry, code, title, detail } : entry
        );
      }

      return [...prev, { code, title, detail }];
    });

    setNewCode("");
    setNewTitle("");
    setNewDetail("");
  }

  const stitchProgress = currentRow
    ? `${Math.min(stitchIndex + 1, currentRow.totalStitches)} / ${currentRow.totalStitches}`
    : "-";

  const remainingStitches = currentRow ? Math.max(0, currentRow.totalStitches - (stitchIndex + 1)) : 0;

  return (
    <main className="page-shell">
      <header className="card command-center">
        <div className="title-row">
          <div>
            <p className="eyebrow">Loop Ledger</p>
            <h1>Knit Tracker</h1>
          </div>
          <div className="status-inline">
            <span>{currentRow ? currentRow.rowLabel : "No row"}</span>
            <span>{stitchProgress} stitches</span>
          </div>
        </div>

        <div className="current-panel">
          <div className="current-main">
            <p className="eyebrow">Current Stitch</p>
            <p className="stitch-code">{currentStitch ? currentStitch.code : "No active stitch"}</p>
            <p className="project-name">{currentStitch ? currentStitch.label : "Load a valid pattern to begin."}</p>
          </div>
          <div className="metrics-grid">
            <article>
              <p className="eyebrow">Row</p>
              <p className="stat-value">{currentRow ? currentRow.rowLabel : "-"}</p>
            </article>
            <article>
              <p className="eyebrow">Stitch</p>
              <p className="stat-value">{stitchProgress}</p>
            </article>
            <article>
              <p className="eyebrow">Remaining</p>
              <p className="stat-value">{remainingStitches}</p>
            </article>
            <article>
              <p className="eyebrow">Completed Rows</p>
              <p className="stat-value">{completedRows}</p>
            </article>
            <article>
              <p className="eyebrow">Contrib. Count</p>
              <p className="stat-value">{contributingTotal}</p>
            </article>
          </div>
        </div>

        {rowToast ? <p className="toast">{rowToast}</p> : null}

        <div className="control-strip">
          <button type="button" className="ghost" onClick={undoPatternStep}>
            Undo
          </button>
          <button type="button" className="primary" onClick={() => incrementPatternBy(1)}>
            +1 Stitch
          </button>
          <button type="button" className="ghost" onClick={() => incrementPatternBy(5)}>
            +5
          </button>
          <button type="button" className="ghost" onClick={() => incrementPatternBy(10)}>
            +10
          </button>
        </div>
      </header>

      <section className="card timeline-card">
        <div className="section-heading">
          <h2>Stitch Timeline</h2>
          <span className="muted">Past 10 - Current - Next 10</span>
        </div>
        {!timeline.length ? <p className="muted">Timeline appears once the pattern parses successfully.</p> : null}
        <div className="timeline" aria-live="polite">
          {timeline.map((item) => (
            <span key={`${item.index}-${item.code}`} className={item.active ? "chip active" : "chip"}>
              {item.index + 1}. {item.code}
            </span>
          ))}
        </div>
      </section>

      <section className="workspace-grid">
        <section className="card input-card">
          <div className="section-heading">
            <h2>Pattern Input</h2>
            <span className="muted">`RndN: ...` or `RowN: ...` per line</span>
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
        </section>

        <section className="side-stack">
          <section className="card counters-card">
            <div className="section-heading">
              <h2>Counters</h2>
              <span className="muted">Independent or contributing</span>
            </div>

            <form className="inline-form counter-add-form" onSubmit={addCounter}>
              <input
                value={newCounterName}
                onChange={(event) => setNewCounterName(event.target.value)}
                placeholder="New counter name"
                aria-label="New counter name"
              />
              <button type="submit" className="primary">
                Add
              </button>
            </form>

            <ul className="counter-list">
              {counters.map((counter) => (
                <li key={counter.id} className="counter-item">
                  <div className="counter-top">
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
                            prev.map((item) =>
                              item.id === counter.id ? { ...item, contributes: event.target.checked } : item
                            )
                          )
                        }
                      />
                      Include
                    </label>
                  </div>
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

          <section className="card glossary-card">
            <div className="section-heading">
              <h2>Stitch Glossary</h2>
              <span className="muted">{filteredGlossary.length} entries</span>
            </div>

            <input
              value={glossarySearch}
              onChange={(event) => setGlossarySearch(event.target.value)}
              placeholder="Search by code, name, or definition"
              aria-label="Search glossary"
            />

            <form className="glossary-form" onSubmit={addGlossaryEntry}>
              <input value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder="Code (e.g. M1L)" />
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Name" />
              <textarea
                value={newDetail}
                onChange={(event) => setNewDetail(event.target.value)}
                placeholder="Definition"
                rows={3}
              />
              <button type="submit" className="primary">
                Save Stitch
              </button>
            </form>

            <ul className="glossary-list">
              {filteredGlossary.map((entry) => (
                <li key={entry.code}>
                  <p>
                    <strong>{entry.code}</strong> - {entry.title}
                  </p>
                  <span>{entry.detail}</span>
                </li>
              ))}
            </ul>
          </section>
        </section>
      </section>
    </main>
  );
}
