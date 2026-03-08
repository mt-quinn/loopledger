import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageMetric } from "./project-types";

let workerConfigured = false;

export function configurePdfWorker(): void {
  if (workerConfigured) {
    return;
  }

  GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  workerConfigured = true;
}

export async function loadPdfFromBlob(pdfBlob: Blob): Promise<PDFDocumentProxy> {
  configurePdfWorker();
  const data = new Uint8Array(await pdfBlob.arrayBuffer());
  return await getDocument({ data }).promise;
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
