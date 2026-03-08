import {
  createDefaultWorkspace,
  LEGACY_STORAGE_KEY,
  type ProjectBackup,
  type ProjectMetadata,
  type ProjectRecord,
  type ProjectWorkspace,
  type StoredProjectFile,
  type StoredProjectWorkspace
} from "./project-types";

const DB_NAME = "whichstitch-projects";
const DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const PROJECT_FILES_STORE = "projectFiles";
const PROJECT_WORKSPACES_STORE = "projectWorkspaces";
const PROJECT_FINGERPRINT_INDEX = "byFingerprint";

type ProjectLookupResult = {
  projectId: string;
  isExisting: boolean;
};

type StoredProjectWorkspaceRecord = {
  projectId: string;
  workspace: ProjectWorkspace;
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

function normalizeWorkspace(workspace: Partial<ProjectWorkspace> | null | undefined): ProjectWorkspace {
  const fallback = createDefaultWorkspace();
  return {
    zoom: typeof workspace?.zoom === "number" ? workspace.zoom : fallback.zoom,
    annotations: Array.isArray(workspace?.annotations) ? workspace.annotations : fallback.annotations,
    counters: Array.isArray(workspace?.counters) ? workspace.counters : fallback.counters,
    connections: Array.isArray(workspace?.connections) ? workspace.connections : fallback.connections,
    referenceCapture: workspace?.referenceCapture ?? fallback.referenceCapture,
    strokeColor: typeof workspace?.strokeColor === "string" ? workspace.strokeColor : fallback.strokeColor
  };
}

async function openProjectDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        const projects = db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        projects.createIndex(PROJECT_FINGERPRINT_INDEX, "fingerprint", { unique: false });
      }

      if (!db.objectStoreNames.contains(PROJECT_FILES_STORE)) {
        db.createObjectStore(PROJECT_FILES_STORE, { keyPath: "projectId" });
      }

      if (!db.objectStoreNames.contains(PROJECT_WORKSPACES_STORE)) {
        db.createObjectStore(PROJECT_WORKSPACES_STORE, { keyPath: "projectId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open IndexedDB."));
  });
}

function createProjectId(): string {
  return `project-${crypto.randomUUID()}`;
}

function createImportedName(name: string, existingNames: Set<string>): string {
  if (!existingNames.has(name)) {
    return name;
  }

  let counter = 2;
  while (existingNames.has(`${name} (${counter})`)) {
    counter += 1;
  }
  return `${name} (${counter})`;
}

function createProjectMetadata(input: {
  id?: string;
  name: string;
  sourceFileName: string;
  fingerprint: string;
  pageCount?: number;
}): ProjectMetadata {
  const timestamp = new Date().toISOString();
  return {
    id: input.id ?? createProjectId(),
    name: input.name,
    sourceFileName: input.sourceFileName,
    fingerprint: input.fingerprint,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
    pageCount: input.pageCount ?? 0
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
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

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || "application/pdf" });
}

async function getMetadataByFingerprint(db: IDBDatabase, fingerprint: string): Promise<ProjectMetadata | null> {
  const transaction = db.transaction(PROJECTS_STORE, "readonly");
  const index = transaction.objectStore(PROJECTS_STORE).index(PROJECT_FINGERPRINT_INDEX);
  const metadata = (await requestToPromise(index.getAll(fingerprint))) as ProjectMetadata[];
  await transactionToPromise(transaction);
  if (!metadata.length) {
    return null;
  }
  return metadata.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))[0];
}

async function updateProjectMetadataInternal(
  db: IDBDatabase,
  projectId: string,
  mutate: (metadata: ProjectMetadata) => ProjectMetadata
): Promise<ProjectMetadata | null> {
  const transaction = db.transaction(PROJECTS_STORE, "readwrite");
  const store = transaction.objectStore(PROJECTS_STORE);
  const existing = (await requestToPromise(store.get(projectId))) as ProjectMetadata | undefined;
  if (!existing) {
    await transactionToPromise(transaction);
    return null;
  }

  const nextMetadata = mutate(existing);
  store.put(nextMetadata);
  await transactionToPromise(transaction);
  return nextMetadata;
}

export function clearLegacyWorkspaceStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export async function requestDurableStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }

  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function computeBlobFingerprint(blob: Blob): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function listProjects(): Promise<ProjectMetadata[]> {
  const db = await openProjectDatabase();
  const transaction = db.transaction(PROJECTS_STORE, "readonly");
  const results = (await requestToPromise(transaction.objectStore(PROJECTS_STORE).getAll())) as ProjectMetadata[];
  await transactionToPromise(transaction);
  return results.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
}

export async function getProject(projectId: string): Promise<ProjectRecord | null> {
  const db = await openProjectDatabase();
  const transaction = db.transaction([PROJECTS_STORE, PROJECT_FILES_STORE, PROJECT_WORKSPACES_STORE], "readonly");
  const metadataStore = transaction.objectStore(PROJECTS_STORE);
  const filesStore = transaction.objectStore(PROJECT_FILES_STORE);
  const workspacesStore = transaction.objectStore(PROJECT_WORKSPACES_STORE);

  const metadata = (await requestToPromise(metadataStore.get(projectId))) as ProjectMetadata | undefined;
  const fileRecord = (await requestToPromise(filesStore.get(projectId))) as StoredProjectFile | undefined;
  const workspaceRecord = (await requestToPromise(workspacesStore.get(projectId))) as StoredProjectWorkspaceRecord | undefined;

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

export async function createOrOpenProjectFromPdf(file: File): Promise<ProjectLookupResult> {
  const db = await openProjectDatabase();
  const fingerprint = await computeBlobFingerprint(file);
  const existing = await getMetadataByFingerprint(db, fingerprint);

  if (existing) {
    await updateProjectMetadataInternal(db, existing.id, (metadata) => ({
      ...metadata,
      sourceFileName: file.name,
      lastOpenedAt: new Date().toISOString()
    }));
    return { projectId: existing.id, isExisting: true };
  }

  const metadata = createProjectMetadata({
    name: file.name.replace(/\.pdf$/i, ""),
    sourceFileName: file.name,
    fingerprint
  });
  const workspace = createDefaultWorkspace();

  const transaction = db.transaction([PROJECTS_STORE, PROJECT_FILES_STORE, PROJECT_WORKSPACES_STORE], "readwrite");
  transaction.objectStore(PROJECTS_STORE).put(metadata);
  transaction.objectStore(PROJECT_FILES_STORE).put({ projectId: metadata.id, pdfBlob: file } satisfies StoredProjectFile);
  transaction.objectStore(PROJECT_WORKSPACES_STORE).put({
    projectId: metadata.id,
    workspace
  } satisfies StoredProjectWorkspace);
  await transactionToPromise(transaction);

  return { projectId: metadata.id, isExisting: false };
}

export async function touchProject(projectId: string): Promise<void> {
  const db = await openProjectDatabase();
  await updateProjectMetadataInternal(db, projectId, (metadata) => ({
    ...metadata,
    lastOpenedAt: new Date().toISOString()
  }));
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }

  const db = await openProjectDatabase();
  await updateProjectMetadataInternal(db, projectId, (metadata) => ({
    ...metadata,
    name: trimmed,
    updatedAt: new Date().toISOString()
  }));
}

export async function saveProjectWorkspace(projectId: string, workspace: ProjectWorkspace): Promise<void> {
  const db = await openProjectDatabase();
  const transaction = db.transaction([PROJECTS_STORE, PROJECT_WORKSPACES_STORE], "readwrite");
  const nextWorkspace = normalizeWorkspace(workspace);
  transaction.objectStore(PROJECT_WORKSPACES_STORE).put({
    projectId,
    workspace: nextWorkspace
  } satisfies StoredProjectWorkspace);

  const projectStore = transaction.objectStore(PROJECTS_STORE);
  const existing = (await requestToPromise(projectStore.get(projectId))) as ProjectMetadata | undefined;
  if (existing) {
    projectStore.put({
      ...existing,
      updatedAt: new Date().toISOString()
    });
  }

  await transactionToPromise(transaction);
}

export async function updateProjectPageCount(projectId: string, pageCount: number): Promise<void> {
  const db = await openProjectDatabase();
  await updateProjectMetadataInternal(db, projectId, (metadata) => {
    if (metadata.pageCount === pageCount) {
      return metadata;
    }

    return {
      ...metadata,
      pageCount,
      updatedAt: new Date().toISOString()
    };
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await openProjectDatabase();
  const transaction = db.transaction([PROJECTS_STORE, PROJECT_FILES_STORE, PROJECT_WORKSPACES_STORE], "readwrite");
  transaction.objectStore(PROJECTS_STORE).delete(projectId);
  transaction.objectStore(PROJECT_FILES_STORE).delete(projectId);
  transaction.objectStore(PROJECT_WORKSPACES_STORE).delete(projectId);
  await transactionToPromise(transaction);
}

export async function exportProjectBackup(projectId: string): Promise<ProjectBackup | null> {
  const project = await getProject(projectId);
  if (!project) {
    return null;
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    metadata: project.metadata,
    workspace: normalizeWorkspace(project.workspace),
    pdfBase64: await blobToBase64(project.pdfBlob),
    pdfMimeType: project.pdfBlob.type || "application/pdf"
  };
}

export async function importProjectBackup(file: File): Promise<string> {
  const raw = await file.text();
  const parsed = JSON.parse(raw) as Partial<ProjectBackup>;

  if (parsed.version !== 1 || !parsed.metadata || !parsed.pdfBase64) {
    throw new Error("This backup file is not a valid WhichStitch project export.");
  }

  const pdfBlob = base64ToBlob(parsed.pdfBase64, parsed.pdfMimeType || "application/pdf");
  const fingerprint = parsed.metadata.fingerprint || (await computeBlobFingerprint(pdfBlob));
  const db = await openProjectDatabase();
  const existingProjects = await listProjects();
  const uniqueName = createImportedName(parsed.metadata.name || parsed.metadata.sourceFileName || "Imported project", new Set(existingProjects.map((project) => project.name)));

  const metadata = createProjectMetadata({
    id: createProjectId(),
    name: uniqueName,
    sourceFileName: parsed.metadata.sourceFileName || `${uniqueName}.pdf`,
    fingerprint,
    pageCount: parsed.metadata.pageCount ?? 0
  });

  const transaction = db.transaction([PROJECTS_STORE, PROJECT_FILES_STORE, PROJECT_WORKSPACES_STORE], "readwrite");
  transaction.objectStore(PROJECTS_STORE).put(metadata);
  transaction.objectStore(PROJECT_FILES_STORE).put({
    projectId: metadata.id,
    pdfBlob
  } satisfies StoredProjectFile);
  transaction.objectStore(PROJECT_WORKSPACES_STORE).put({
    projectId: metadata.id,
    workspace: normalizeWorkspace(parsed.workspace)
  } satisfies StoredProjectWorkspace);
  await transactionToPromise(transaction);

  return metadata.id;
}
