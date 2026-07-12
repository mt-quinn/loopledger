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

/** Renders page 1 to a small JPEG data URL for library cards. */
export async function renderPdfThumbnail(pdfDoc: PDFDocumentProxy): Promise<string | null> {
  try {
    const page = await pdfDoc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = THUMBNAIL_MAX_DIM / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.72);
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
