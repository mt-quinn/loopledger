import type { ConvexReactClient } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProjectWorkspace } from "./project-types";

export type UploadResult = {
  projectId: Id<"projects">;
  isExisting: boolean;
};

export type UploadMetadata = {
  name: string;
  sourceFileName: string;
  fingerprint: string;
  pageCount: number;
  pdfMimeType: string;
};

export async function computeBlobFingerprint(blob: Blob): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadPdfProject(
  convex: ConvexReactClient,
  pdfBlob: Blob,
  meta: UploadMetadata
): Promise<UploadResult> {
  // Skip the upload entirely when this exact PDF is already in the account.
  // Fail open: createFromPdf still dedupes server-side as a safety net.
  const existing = await convex
    .query(api.projects.findByFingerprint, { fingerprint: meta.fingerprint })
    .catch(() => null);
  if (existing) {
    await convex.mutation(api.projects.touch, { projectId: existing.projectId });
    return { projectId: existing.projectId, isExisting: true };
  }

  const uploadUrl = await convex.mutation(api.projects.generateUploadUrl, {});
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": meta.pdfMimeType || "application/pdf" },
    body: pdfBlob
  });

  if (!response.ok) {
    throw new Error("The PDF could not be uploaded to your account.");
  }

  const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };

  return await convex.mutation(api.projects.createFromPdf, {
    storageId,
    name: meta.name,
    sourceFileName: meta.sourceFileName,
    fingerprint: meta.fingerprint,
    pageCount: meta.pageCount,
    pdfMimeType: meta.pdfMimeType || "application/pdf"
  });
}

export async function saveWorkspaceToCloud(
  convex: ConvexReactClient,
  projectId: Id<"projects">,
  workspace: ProjectWorkspace
): Promise<void> {
  await convex.mutation(api.projects.saveWorkspace, { projectId, workspace });
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || "application/pdf" });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
