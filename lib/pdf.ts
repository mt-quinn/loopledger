import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageMetric } from "./project-types";

let workerConfigured = false;

export function configurePdfWorker(): void {
  if (workerConfigured) {
    return;
  }

  // Bundled with the app so the viewer works offline and never depends on a CDN.
  GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url),
    { type: "module" }
  );
  workerConfigured = true;
}

export async function loadPdfFromBlob(pdfBlob: Blob): Promise<PDFDocumentProxy> {
  configurePdfWorker();
  const data = new Uint8Array(await pdfBlob.arrayBuffer());
  return await getDocument({ data }).promise;
}

const THUMBNAIL_MAX_DIM = 360;

/**
 * Downscales an already-rendered page canvas into a small JPEG data URL for
 * library cards. Reusing the on-screen canvas avoids a second pdf.js render
 * of the same page, which can stall while the visible render is in flight.
 */
export function canvasToThumbnail(sourceCanvas: HTMLCanvasElement): string | null {
  try {
    if (sourceCanvas.width < 1 || sourceCanvas.height < 1) {
      return null;
    }
    const scale = Math.min(1, THUMBNAIL_MAX_DIM / Math.max(sourceCanvas.width, sourceCanvas.height));
    const target = document.createElement("canvas");
    target.width = Math.max(1, Math.round(sourceCanvas.width * scale));
    target.height = Math.max(1, Math.round(sourceCanvas.height * scale));
    const context = target.getContext("2d");
    if (!context) {
      return null;
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(sourceCanvas, 0, 0, target.width, target.height);
    return target.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

export async function getPdfPageMetrics(pdfDoc: PDFDocumentProxy): Promise<PageMetric[]> {
  const metrics: PageMetric[] = [];
  for (let index = 1; index <= pdfDoc.numPages; index += 1) {
    const page = await pdfDoc.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    metrics.push({
      width: viewport.width,
      height: viewport.height
    });
  }
  return metrics;
}
