import type { ConvexReactClient } from "convex/react";
import { getProject, listProjects, normalizeWorkspace } from "./project-store";
import { saveWorkspaceToCloud, uploadPdfProject } from "./convex-upload";

const MIGRATION_FLAG = "whichstitch-cloud-migrated-v1";

export function hasMigratedLocalProjects(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return window.localStorage.getItem(MIGRATION_FLAG) === "done";
}

/**
 * One-time upload of any projects sitting in this browser's IndexedDB into the
 * signed-in account. Safe to call repeatedly: the server dedupes by PDF
 * fingerprint, and a localStorage flag prevents re-running once it succeeds.
 */
export async function migrateLocalProjects(convex: ConvexReactClient): Promise<number> {
  if (hasMigratedLocalProjects()) {
    return 0;
  }

  let migratedCount = 0;
  const locals = await listProjects();

  for (const meta of locals) {
    const record = await getProject(meta.id);
    if (!record) {
      continue;
    }

    const result = await uploadPdfProject(convex, record.pdfBlob, {
      name: meta.name,
      sourceFileName: meta.sourceFileName,
      fingerprint: meta.fingerprint,
      pageCount: meta.pageCount,
      pdfMimeType: record.pdfBlob.type || "application/pdf"
    });

    if (!result.isExisting) {
      await saveWorkspaceToCloud(convex, result.projectId, normalizeWorkspace(record.workspace));
      migratedCount += 1;
    }
  }

  window.localStorage.setItem(MIGRATION_FLAG, "done");
  return migratedCount;
}
