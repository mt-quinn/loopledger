import { createDefaultWorkspace, type ProjectWorkspace } from "./project-types";

export function normalizeWorkspace(workspace: Partial<ProjectWorkspace> | null | undefined): ProjectWorkspace {
  const fallback = createDefaultWorkspace();
  return {
    zoom: typeof workspace?.zoom === "number" ? workspace.zoom : fallback.zoom,
    annotations: Array.isArray(workspace?.annotations) ? workspace.annotations : fallback.annotations,
    counters: Array.isArray(workspace?.counters) ? workspace.counters : fallback.counters,
    connections: Array.isArray(workspace?.connections) ? workspace.connections : fallback.connections,
    referenceCapture: workspace?.referenceCapture ?? fallback.referenceCapture,
    strokeColor: typeof workspace?.strokeColor === "string" ? workspace.strokeColor : fallback.strokeColor,
    anchors: Array.isArray(workspace?.anchors) ? workspace.anchors : fallback.anchors,
    calculator: {
      patternRowsPerInch:
        typeof workspace?.calculator?.patternRowsPerInch === "string"
          ? workspace.calculator.patternRowsPerInch
          : fallback.calculator.patternRowsPerInch,
      patternStitchesPerInch:
        typeof workspace?.calculator?.patternStitchesPerInch === "string"
          ? workspace.calculator.patternStitchesPerInch
          : fallback.calculator.patternStitchesPerInch,
      observedRowsPerInch:
        typeof workspace?.calculator?.observedRowsPerInch === "string"
          ? workspace.calculator.observedRowsPerInch
          : fallback.calculator.observedRowsPerInch,
      observedStitchesPerInch:
        typeof workspace?.calculator?.observedStitchesPerInch === "string"
          ? workspace.calculator.observedStitchesPerInch
          : fallback.calculator.observedStitchesPerInch,
      direction:
        workspace?.calculator?.direction === "observedToPattern" || workspace?.calculator?.direction === "patternToObserved"
          ? workspace.calculator.direction
          : fallback.calculator.direction,
      rowInput:
        typeof workspace?.calculator?.rowInput === "string"
          ? workspace.calculator.rowInput
          : fallback.calculator.rowInput,
      stitchInput:
        typeof workspace?.calculator?.stitchInput === "string"
          ? workspace.calculator.stitchInput
          : fallback.calculator.stitchInput
    }
  };
}
