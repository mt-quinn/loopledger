import type { Annotation } from "./project-types";

export const ERASER_SCREEN_RADIUS = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function rectIntersectsSegment(
  rect: { x: number; y: number; width: number; height: number },
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number
): boolean {
  const closestX = clamp((ax + bx) / 2, rect.x, rect.x + rect.width);
  const closestY = clamp((ay + by) / 2, rect.y, rect.y + rect.height);
  if (distanceToSegment(closestX, closestY, ax, ay, bx, by) <= radius) {
    return true;
  }
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height]
  ];
  return corners.some(([cx, cy]) => distanceToSegment(cx, cy, ax, ay, bx, by) <= radius);
}

/**
 * Erases along the eraser drag segment (ax,ay)->(bx,by). Free-draw strokes are
 * split where points fall inside the eraser radius; other shapes are removed
 * whole when the eraser touches them. Returns the next annotation array plus a
 * flag indicating whether anything changed (so callers can avoid re-renders).
 */
export function eraseAlongSegment(
  annotations: Annotation[],
  pageIndex: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number
): { annotations: Annotation[]; changed: boolean } {
  let changed = false;
  const next: Annotation[] = [];

  for (const annotation of annotations) {
    if (annotation.pageIndex !== pageIndex) {
      next.push(annotation);
      continue;
    }

    if (annotation.kind === "freeDraw" && annotation.points && annotation.points.length > 0) {
      const segments: Array<Array<{ x: number; y: number }>> = [];
      let current: Array<{ x: number; y: number }> = [];
      let strokeTouched = false;
      for (const point of annotation.points) {
        if (distanceToSegment(point.x, point.y, ax, ay, bx, by) <= radius) {
          if (current.length > 0) {
            segments.push(current);
            current = [];
          }
          strokeTouched = true;
        } else {
          current.push(point);
        }
      }
      if (current.length > 0) {
        segments.push(current);
      }

      if (!strokeTouched) {
        next.push(annotation);
        continue;
      }

      changed = true;
      segments
        .filter((segment) => segment.length >= 2)
        .forEach((segment, index) => {
          next.push({
            ...annotation,
            id: `${annotation.id}-e${index}-${Date.now()}`,
            points: segment
          });
        });
      continue;
    }

    let touched = false;
    if (annotation.kind === "line") {
      const x2 = annotation.x2 ?? annotation.x;
      const y2 = annotation.y2 ?? annotation.y;
      const closestX = clamp((ax + bx) / 2, Math.min(annotation.x, x2), Math.max(annotation.x, x2));
      const closestY = clamp((ay + by) / 2, Math.min(annotation.y, y2), Math.max(annotation.y, y2));
      touched =
        distanceToSegment(annotation.x, annotation.y, ax, ay, bx, by) <= radius ||
        distanceToSegment(x2, y2, ax, ay, bx, by) <= radius ||
        distanceToSegment(closestX, closestY, ax, ay, bx, by) <= radius;
    } else {
      const width = annotation.kind === "text" ? Math.max(annotation.width, 28) : annotation.width;
      const height =
        annotation.kind === "text"
          ? Math.max(annotation.height, (annotation.fontSize ?? 22) * 1.4)
          : annotation.height;
      touched = rectIntersectsSegment(
        { x: annotation.x, y: annotation.y, width, height },
        ax,
        ay,
        bx,
        by,
        radius
      );
    }

    if (touched) {
      changed = true;
    } else {
      next.push(annotation);
    }
  }

  return { annotations: next, changed };
}
