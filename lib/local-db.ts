import type { ProjectMetadata, ProjectRecord, ProjectWorkspace } from "./project-types";
import { normalizeWorkspace } from "./workspace-utils";

const DB_NAME = "whichstitch-projects";
const DB_VERSION = 2;

// v1 stores from the local-first era. Kept read-only so devices that never
// signed in can still migrate their projects into an account.
const LEGACY_PROJECTS_STORE = "projects";
const LEGACY_FILES_STORE = "projectFiles";
const LEGACY_WORKSPACES_STORE = "projectWorkspaces";
const LEGACY_FINGERPRINT_INDEX = "byFingerprint";

// v2 stores: an offline cache of cloud projects, keyed by the Convex project id.
const CACHED_PROJECTS_STORE = "cachedProjects";
const CACHED_PDFS_STORE = "cachedPdfs";
const CACHED_WORKSPACES_STORE = "cachedWorkspaces";

type LegacyFileRecord = {
  projectId: string;
  pdfBlob: Blob;
};

type LegacyWorkspaceRecord = {
  projectId: string;
  workspace: ProjectWorkspace;
};

type CachedProjectRecord = {
  projectId: string;
  metadata: ProjectMetadata;
};

type CachedPdfRecord = {
  projectId: string;
  pdfBlob: Blob;
  fingerprint: string;
};

type CachedWorkspaceRecord = {
  projectId: string;
  workspace: ProjectWorkspace;
  revision: number;
  dirty: boolean;
};

export type CachedProject = {
  metadata: ProjectMetadata;
  pdfBlob: Blob;
  fingerprint: string;
  workspace: ProjectWorkspace | null;
  workspaceDirty: boolean;
};

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(LEGACY_PROJECTS_STORE)) {
        const projects = db.createObjectStore(LEGACY_PROJECTS_STORE, { keyPath: "id" });
        projects.createIndex(LEGACY_FINGERPRINT_INDEX, "fingerprint", { unique: false });
      }
      if (!db.objectStoreNames.contains(LEGACY_FILES_STORE)) {
        db.createObjectStore(LEGACY_FILES_STORE, { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains(LEGACY_WORKSPACES_STORE)) {
        db.createObjectStore(LEGACY_WORKSPACES_STORE, { keyPath: "projectId" });
      }

      if (!db.objectStoreNames.contains(CACHED_PROJECTS_STORE)) {
        db.createObjectStore(CACHED_PROJECTS_STORE, { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains(CACHED_PDFS_STORE)) {
        db.createObjectStore(CACHED_PDFS_STORE, { keyPath: "projectId" });
      }
      if (!db.objectStoreNames.contains(CACHED_WORKSPACES_STORE)) {
        db.createObjectStore(CACHED_WORKSPACES_STORE, { keyPath: "projectId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB."));
  });
}

// ---------- Legacy local projects (migration only) ----------

export async function listLegacyProjects(): Promise<ProjectMetadata[]> {
  const db = await openDatabase();
  const transaction = db.transaction(LEGACY_PROJECTS_STORE, "readonly");
  const results = (await requestToPromise(transaction.objectStore(LEGACY_PROJECTS_STORE).getAll())) as ProjectMetadata[];
  await transactionToPromise(transaction);
  return results.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
}

export async function getLegacyProject(projectId: string): Promise<ProjectRecord | null> {
  const db = await openDatabase();
  const transaction = db.transaction(
    [LEGACY_PROJECTS_STORE, LEGACY_FILES_STORE, LEGACY_WORKSPACES_STORE],
    "readonly"
  );
  const metadata = (await requestToPromise(
    transaction.objectStore(LEGACY_PROJECTS_STORE).get(projectId)
  )) as ProjectMetadata | undefined;
  const fileRecord = (await requestToPromise(
    transaction.objectStore(LEGACY_FILES_STORE).get(projectId)
  )) as LegacyFileRecord | undefined;
  const workspaceRecord = (await requestToPromise(
    transaction.objectStore(LEGACY_WORKSPACES_STORE).get(projectId)
  )) as LegacyWorkspaceRecord | undefined;
  await transactionToPromise(transaction);

  if (!metadata || !fileRecord?.pdfBlob) {
    return null;
  }

  return {
    metadata,
    pdfBlob: fileRecord.pdfBlob,
    workspace: normalizeWorkspace(workspaceRecord?.workspace)
  };
}

// ---------- Offline cache of cloud projects ----------

export async function readCachedProject(projectId: string): Promise<CachedProject | null> {
  const db = await openDatabase();
  const transaction = db.transaction(
    [CACHED_PROJECTS_STORE, CACHED_PDFS_STORE, CACHED_WORKSPACES_STORE],
    "readonly"
  );
  const projectRecord = (await requestToPromise(
    transaction.objectStore(CACHED_PROJECTS_STORE).get(projectId)
  )) as CachedProjectRecord | undefined;
  const pdfRecord = (await requestToPromise(
    transaction.objectStore(CACHED_PDFS_STORE).get(projectId)
  )) as CachedPdfRecord | undefined;
  const workspaceRecord = (await requestToPromise(
    transaction.objectStore(CACHED_WORKSPACES_STORE).get(projectId)
  )) as CachedWorkspaceRecord | undefined;
  await transactionToPromise(transaction);

  if (!projectRecord || !pdfRecord?.pdfBlob) {
    return null;
  }

  return {
    metadata: projectRecord.metadata,
    pdfBlob: pdfRecord.pdfBlob,
    fingerprint: pdfRecord.fingerprint,
    workspace: workspaceRecord ? normalizeWorkspace(workspaceRecord.workspace) : null,
    workspaceDirty: workspaceRecord?.dirty ?? false
  };
}

export async function writeCachedProject(
  projectId: string,
  input: { metadata: ProjectMetadata; pdfBlob: Blob; fingerprint: string }
): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([CACHED_PROJECTS_STORE, CACHED_PDFS_STORE], "readwrite");
  transaction.objectStore(CACHED_PROJECTS_STORE).put({
    projectId,
    metadata: input.metadata
  } satisfies CachedProjectRecord);
  transaction.objectStore(CACHED_PDFS_STORE).put({
    projectId,
    pdfBlob: input.pdfBlob,
    fingerprint: input.fingerprint
  } satisfies CachedPdfRecord);
  await transactionToPromise(transaction);
}

/**
 * Persists the workspace locally and returns a monotonically increasing
 * revision. Callers that later confirm a cloud save should pass that revision
 * to `markCachedWorkspaceClean` so a newer local edit is never marked clean
 * by an older save's acknowledgement.
 */
export async function writeCachedWorkspace(
  projectId: string,
  workspace: ProjectWorkspace,
  options: { dirty: boolean }
): Promise<number> {
  const db = await openDatabase();
  const transaction = db.transaction(CACHED_WORKSPACES_STORE, "readwrite");
  const store = transaction.objectStore(CACHED_WORKSPACES_STORE);
  const existing = (await requestToPromise(store.get(projectId))) as CachedWorkspaceRecord | undefined;
  const revision = (existing?.revision ?? 0) + 1;
  store.put({
    projectId,
    workspace,
    revision,
    dirty: options.dirty
  } satisfies CachedWorkspaceRecord);
  await transactionToPromise(transaction);
  return revision;
}

export async function markCachedWorkspaceClean(projectId: string, revision: number): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(CACHED_WORKSPACES_STORE, "readwrite");
  const store = transaction.objectStore(CACHED_WORKSPACES_STORE);
  const existing = (await requestToPromise(store.get(projectId))) as CachedWorkspaceRecord | undefined;
  if (existing && existing.revision === revision && existing.dirty) {
    store.put({ ...existing, dirty: false });
  }
  await transactionToPromise(transaction);
}

export async function deleteCachedProject(projectId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(
    [CACHED_PROJECTS_STORE, CACHED_PDFS_STORE, CACHED_WORKSPACES_STORE],
    "readwrite"
  );
  transaction.objectStore(CACHED_PROJECTS_STORE).delete(projectId);
  transaction.objectStore(CACHED_PDFS_STORE).delete(projectId);
  transaction.objectStore(CACHED_WORKSPACES_STORE).delete(projectId);
  await transactionToPromise(transaction);
}
