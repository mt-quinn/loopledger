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

export type ReferenceCapture = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageDataUrl: string;
};

export type ProjectWorkspace = {
  zoom: number;
  annotations: Annotation[];
  counters: KnitCounter[];
  connections: CounterConnection[];
  referenceCapture: ReferenceCapture | null;
  strokeColor: string;
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
};

export type StoredProjectFile = {
  projectId: string;
  pdfBlob: Blob;
};

export type StoredProjectWorkspace = {
  projectId: string;
  workspace: ProjectWorkspace;
};

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

export const LEGACY_STORAGE_KEY = "whichstitch-pdf-workspace-v1";
export const THEME_KEY = "whichstitch-theme-v1";
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 10;
export const COUNTER_HITBOX_WIDTH = 150;
export const COUNTER_HITBOX_HEIGHT = 140;
export const COUNTER_GAP = 12;
export const MAX_REFERENCE_IMAGE_DIM = 900;
export const DEFAULT_STROKE_COLOR = "#c62828";
export const STROKE_PALETTE = [
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

export function createDefaultWorkspace(): ProjectWorkspace {
  return {
    zoom: 1.1,
    annotations: [],
    counters: [],
    connections: [],
    referenceCapture: null,
    strokeColor: DEFAULT_STROKE_COLOR
  };
}
