export type ViewerMode = "pan" | "highlight";
export type DrawTool = "rectangle" | "line" | "highlight" | "freeDraw" | "text";
export type DrawingTool = DrawTool | "reference";
export type CounterType = "row" | "stitch";

export type PageMetric = {
  width: number;
  height: number;
};

export type Annotation = {
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
  points?: Array<{ x: number; y: number }>;
  text?: string;
  fontSize?: number;
};

export type KnitCounter = {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  type: CounterType;
  label: string;
  value: number;
};

export type CounterConnection = {
  id: string;
  fromCounterId: string;
  toCounterId: string;
};

export type GaugeConversionDirection = "patternToObserved" | "observedToPattern";

export type GaugeCalculatorState = {
  patternRowsPerInch: string;
  patternStitchesPerInch: string;
  observedRowsPerInch: string;
  observedStitchesPerInch: string;
  direction: GaugeConversionDirection;
  rowInput: string;
  stitchInput: string;
};

export type ReferenceCapture = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageDataUrl: string;
};

export type ScrollAnchor = {
  id: string;
  name: string;
  pageIndex: number;
  yRatio: number;
};

export type ProjectWorkspace = {
  zoom: number;
  annotations: Annotation[];
  counters: KnitCounter[];
  connections: CounterConnection[];
  referenceCapture: ReferenceCapture | null;
  strokeColor: string;
  calculator: GaugeCalculatorState;
  anchors: ScrollAnchor[];
};

export type ProjectMetadata = {
  id: string;
  name: string;
  sourceFileName: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  pageCount: number;
  thumbnailDataUrl?: string;
};

export type PageLook = "normal" | "dimmed" | "inverted";

export type ProjectRecord = {
  metadata: ProjectMetadata;
  pdfBlob: Blob;
  workspace: ProjectWorkspace;
};

export type ProjectBackup = {
  version: 1;
  exportedAt: string;
  metadata: ProjectMetadata;
  workspace: ProjectWorkspace;
  pdfBase64: string;
  pdfMimeType: string;
};

export const THEME_KEY = "whichstitch-theme-v1";
export const PAGE_LOOK_KEY = "whichstitch-page-look-v1";
export const LINK_HINT_KEY = "whichstitch-link-hint-v1";
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 10;
export const COUNTER_HITBOX_WIDTH = 150;
export const COUNTER_HITBOX_HEIGHT = 140;
export const COUNTER_GAP = 12;
export const MAX_REFERENCE_IMAGE_DIM = 900;
export const DEFAULT_STROKE_COLOR = "#d64045";
// Curated to read clearly on white pattern pages (and inverted pages) while
// sitting comfortably with the app's muted sage/cream identity.
export const STROKE_PALETTE = [
  "#d64045", // red
  "#e07a1f", // orange
  "#c9a227", // marigold
  "#3e8e5a", // green
  "#2a9d8f", // teal
  "#3a6ea5", // blue
  "#7b5ea7", // violet
  "#c2559d" // magenta
];

export function createDefaultGaugeCalculator(): GaugeCalculatorState {
  return {
    patternRowsPerInch: "",
    patternStitchesPerInch: "",
    observedRowsPerInch: "",
    observedStitchesPerInch: "",
    direction: "patternToObserved",
    rowInput: "",
    stitchInput: ""
  };
}

export function createDefaultWorkspace(): ProjectWorkspace {
  return {
    zoom: 1.1,
    annotations: [],
    counters: [],
    connections: [],
    referenceCapture: null,
    strokeColor: DEFAULT_STROKE_COLOR,
    calculator: createDefaultGaugeCalculator(),
    anchors: []
  };
}
