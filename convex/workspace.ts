import { v } from "convex/values";

const pointValidator = v.object({
  x: v.number(),
  y: v.number()
});

const annotationValidator = v.object({
  id: v.string(),
  pageIndex: v.number(),
  kind: v.union(
    v.literal("rectangle"),
    v.literal("line"),
    v.literal("highlight"),
    v.literal("freeDraw"),
    v.literal("text")
  ),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
  color: v.optional(v.string()),
  x2: v.optional(v.number()),
  y2: v.optional(v.number()),
  points: v.optional(v.array(pointValidator)),
  text: v.optional(v.string()),
  fontSize: v.optional(v.number())
});

const counterValidator = v.object({
  id: v.string(),
  pageIndex: v.number(),
  x: v.number(),
  y: v.number(),
  type: v.union(v.literal("row"), v.literal("stitch")),
  label: v.string(),
  value: v.number()
});

const connectionValidator = v.object({
  id: v.string(),
  fromCounterId: v.string(),
  toCounterId: v.string()
});

const referenceCaptureValidator = v.union(
  v.null(),
  v.object({
    pageIndex: v.number(),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
    imageDataUrl: v.string()
  })
);

const calculatorValidator = v.object({
  patternRowsPerInch: v.string(),
  patternStitchesPerInch: v.string(),
  observedRowsPerInch: v.string(),
  observedStitchesPerInch: v.string(),
  direction: v.union(v.literal("patternToObserved"), v.literal("observedToPattern")),
  rowInput: v.string(),
  stitchInput: v.string()
});

const anchorValidator = v.object({
  id: v.string(),
  name: v.string(),
  pageIndex: v.number(),
  yRatio: v.number()
});

export const workspaceValidator = v.object({
  zoom: v.number(),
  annotations: v.array(annotationValidator),
  counters: v.array(counterValidator),
  connections: v.array(connectionValidator),
  referenceCapture: referenceCaptureValidator,
  strokeColor: v.string(),
  calculator: calculatorValidator,
  anchors: v.array(anchorValidator)
});

export function createDefaultWorkspace() {
  return {
    zoom: 1.1,
    annotations: [],
    counters: [],
    connections: [],
    referenceCapture: null,
    strokeColor: "#c62828",
    calculator: {
      patternRowsPerInch: "",
      patternStitchesPerInch: "",
      observedRowsPerInch: "",
      observedStitchesPerInch: "",
      direction: "patternToObserved" as const,
      rowInput: "",
      stitchInput: ""
    },
    anchors: []
  };
}
