"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useConvex, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  base64ToBlob,
  blobToBase64,
  computeBlobFingerprint,
  knitAgain,
  saveWorkspaceToCloud,
  uploadFinishedPhoto,
  uploadPdfProject
} from "../lib/convex-upload";
import { resizePhotoForUpload } from "../lib/image";
import { migrateLocalProjects } from "../lib/migrate-local";
import { deleteCachedProject } from "../lib/local-db";
import { normalizeWorkspace } from "../lib/workspace-utils";
import type { ProjectBackup } from "../lib/project-types";
import { useStoredTheme } from "../lib/use-stored-theme";
import AuthForm from "./AuthForm";
import Panel from "./ui/Panel";

function downloadBackupFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatProjectTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffHours) < 24) {
    return relative.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 10) {
    return relative.format(diffDays, "day");
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function HubInner({
  theme,
  setTheme
}: {
  theme: ReturnType<typeof useStoredTheme>["theme"];
  setTheme: ReturnType<typeof useStoredTheme>["setTheme"];
}) {
  const router = useRouter();
  const convex = useConvex();
  const { signOut } = useAuthActions();
  const projects = useQuery(api.projects.list);
  const renameProjectMutation = useMutation(api.projects.rename);
  const removeProjectMutation = useMutation(api.projects.remove);
  const finishProjectMutation = useMutation(api.projects.finish);
  const reactivateProjectMutation = useMutation(api.projects.reactivate);
  const updateFinishedNotesMutation = useMutation(api.projects.updateFinishedNotes);
  const removeFinishedPhotoMutation = useMutation(api.projects.removeFinishedPhoto);

  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const migrationStartedRef = useRef(false);
  const accountBtnRef = useRef<HTMLButtonElement | null>(null);
  const cardMenuAnchorRef = useRef<HTMLButtonElement | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const bannerRetryRef = useRef<(() => void) | null>(null);
  const [hasBannerRetry, setHasBannerRetry] = useState(false);

  function showBanner(message: string, retry?: () => void) {
    setBannerMessage(message);
    bannerRetryRef.current = retry ?? null;
    setHasBannerRetry(Boolean(retry));
  }

  function clearBanner() {
    setBannerMessage(null);
    bannerRetryRef.current = null;
    setHasBannerRetry(false);
  }
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [menuProjectId, setMenuProjectId] = useState<Id<"projects"> | null>(null);
  const [tab, setTab] = useState<"active" | "finished">("active");
  const [detailProjectId, setDetailProjectId] = useState<Id<"projects"> | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const notesLoadedForRef = useRef<string | null>(null);

  const finishedDetail = useQuery(
    api.projects.finishedDetails,
    detailProjectId ? { projectId: detailProjectId } : "skip"
  );

  useEffect(() => {
    if (!detailProjectId || finishedDetail === undefined || finishedDetail === null) {
      return;
    }
    if (notesLoadedForRef.current === detailProjectId) {
      return;
    }
    notesLoadedForRef.current = detailProjectId;
    setNotesDraft(finishedDetail.notes);
  }, [detailProjectId, finishedDetail]);

  useEffect(() => {
    if (!detailProjectId || notesLoadedForRef.current !== detailProjectId) {
      return;
    }
    if (finishedDetail === undefined || finishedDetail === null || notesDraft === finishedDetail.notes) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void updateFinishedNotesMutation({ projectId: detailProjectId, notes: notesDraft }).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timeoutId);
  }, [notesDraft, detailProjectId, finishedDetail, updateFinishedNotesMutation]);

  useEffect(() => {
    if (migrationStartedRef.current) {
      return;
    }
    migrationStartedRef.current = true;

    void migrateLocalProjects(convex)
      .then((count) => {
        if (count > 0) {
          showBanner(
            `Moved ${count} ${count === 1 ? "project" : "projects"} from this device into your account.`
          );
        }
      })
      .catch(() => {
        // A failed migration leaves the flag unset and simply retries next visit.
      });
  }, [convex]);

  async function importPdfFile(file: File) {
    setBusyAction("import-pdf");
    clearBanner();
    try {
      const fingerprint = await computeBlobFingerprint(file);
      const result = await uploadPdfProject(convex, file, {
        name: file.name.replace(/\.pdf$/i, ""),
        sourceFileName: file.name,
        fingerprint,
        pageCount: 0,
        pdfMimeType: file.type || "application/pdf"
      });
      router.push(`/projects/${result.projectId}`);
    } catch {
      showBanner("The PDF could not be uploaded to your account.", () => void importPdfFile(file));
      setBusyAction(null);
    }
  }

  function handlePdfImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      void importPdfFile(file);
    }
  }

  async function importBackupFile(file: File) {
    setBusyAction("import-backup");
    clearBanner();
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ProjectBackup>;
      if (parsed.version !== 1 || !parsed.metadata || !parsed.pdfBase64) {
        throw new Error("This backup file is not a valid WhichStitch project export.");
      }

      const pdfBlob = base64ToBlob(parsed.pdfBase64, parsed.pdfMimeType || "application/pdf");
      const fingerprint = parsed.metadata.fingerprint || (await computeBlobFingerprint(pdfBlob));
      const result = await uploadPdfProject(convex, pdfBlob, {
        name: parsed.metadata.name || parsed.metadata.sourceFileName || "Imported project",
        sourceFileName: parsed.metadata.sourceFileName || `${parsed.metadata.name || "pattern"}.pdf`,
        fingerprint,
        pageCount: parsed.metadata.pageCount ?? 0,
        pdfMimeType: parsed.pdfMimeType || "application/pdf"
      });

      if (!result.isExisting) {
        await saveWorkspaceToCloud(convex, result.projectId, normalizeWorkspace(parsed.workspace));
      }
      router.push(`/projects/${result.projectId}`);
    } catch (error) {
      setBusyAction(null);
      showBanner(
        error instanceof Error ? error.message : "The backup file could not be restored.",
        () => void importBackupFile(file)
      );
    }
  }

  function handleBackupImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      void importBackupFile(file);
    }
  }

  async function handleExport(projectId: Id<"projects">) {
    setBusyAction(`export:${projectId}`);
    clearBanner();

    try {
      const data = await convex.query(api.projects.get, { projectId });
      if (!data) {
        showBanner("The project could not be exported.", () => void handleExport(projectId));
        return;
      }

      const response = await fetch(data.pdfUrl);
      const pdfBlob = await response.blob();
      const backup: ProjectBackup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        metadata: data.metadata,
        workspace: normalizeWorkspace(data.workspace),
        pdfBase64: await blobToBase64(pdfBlob),
        pdfMimeType: data.pdfMimeType || "application/pdf"
      };

      downloadBackupFile(
        `${backup.metadata.name || backup.metadata.sourceFileName}.whichstitch.json`,
        JSON.stringify(backup)
      );
    } catch {
      showBanner("The project could not be exported.", () => void handleExport(projectId));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete(projectId: Id<"projects">) {
    if (!window.confirm("Delete this project from your account?")) {
      return;
    }

    setBusyAction(`delete:${projectId}`);
    clearBanner();
    try {
      await removeProjectMutation({ projectId });
      // Drop any offline copy so a deleted project can't reappear from cache.
      void deleteCachedProject(projectId).catch(() => undefined);
      if (editingProjectId === projectId) {
        setEditingProjectId(null);
        setEditingProjectName("");
      }
    } catch {
      showBanner("The project could not be deleted.", () => void handleDelete(projectId));
    } finally {
      setBusyAction(null);
    }
  }

  async function commitRename(projectId: Id<"projects">) {
    const trimmed = editingProjectName.trim();
    setEditingProjectId(null);
    setEditingProjectName("");

    if (!trimmed) {
      return;
    }

    setBusyAction(`rename:${projectId}`);
    clearBanner();
    try {
      await renameProjectMutation({ projectId, name: trimmed });
    } catch {
      showBanner("The project name could not be updated.");
    } finally {
      setBusyAction(null);
    }
  }

  function closeFinishedDetail() {
    // Flush any notes typed within the debounce window.
    if (detailProjectId && finishedDetail && notesDraft !== finishedDetail.notes) {
      void updateFinishedNotesMutation({ projectId: detailProjectId, notes: notesDraft }).catch(() => undefined);
    }
    setDetailProjectId(null);
    notesLoadedForRef.current = null;
  }

  function openFinishedDetail(projectId: Id<"projects">) {
    notesLoadedForRef.current = null;
    setNotesDraft("");
    setDetailProjectId(projectId);
  }

  async function handleMarkFinished(projectId: Id<"projects">) {
    setBusyAction(`finish:${projectId}`);
    clearBanner();
    try {
      await finishProjectMutation({ projectId });
      setTab("finished");
      openFinishedDetail(projectId);
    } catch {
      showBanner("The project could not be marked as finished.", () => void handleMarkFinished(projectId));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReactivate(projectId: Id<"projects">) {
    setBusyAction(`reactivate:${projectId}`);
    clearBanner();
    try {
      await reactivateProjectMutation({ projectId });
      closeFinishedDetail();
      setTab("active");
    } catch {
      showBanner("The project could not be moved back to active.", () => void handleReactivate(projectId));
    } finally {
      setBusyAction(null);
    }
  }

  function nextCopyName(baseName: string): string {
    const names = new Set((projects ?? []).map((project) => project.name));
    let counter = 2;
    while (names.has(`${baseName} (${counter})`)) {
      counter += 1;
    }
    return `${baseName} (${counter})`;
  }

  async function handleKnitAgain(projectId: Id<"projects">, name: string) {
    setBusyAction(`knitAgain:${projectId}`);
    clearBanner();
    try {
      const result = await knitAgain(convex, projectId, nextCopyName(name));
      router.push(`/projects/${result.projectId}`);
    } catch {
      showBanner("The pattern could not be cast on again.", () => void handleKnitAgain(projectId, name));
      setBusyAction(null);
    }
  }

  async function handlePhotoFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!detailProjectId || files.length === 0) {
      return;
    }

    setBusyAction(`photo:${detailProjectId}`);
    clearBanner();
    try {
      const remaining = (finishedDetail?.maxPhotos ?? 6) - (finishedDetail?.photos.length ?? 0);
      for (const file of files.slice(0, Math.max(0, remaining))) {
        const photoBlob = await resizePhotoForUpload(file);
        await uploadFinishedPhoto(convex, detailProjectId, photoBlob);
      }
    } catch {
      showBanner("A photo could not be uploaded. Check your connection and try again.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemovePhoto(storageId: Id<"_storage">) {
    if (!detailProjectId || !window.confirm("Remove this photo?")) {
      return;
    }
    try {
      await removeFinishedPhotoMutation({ projectId: detailProjectId, storageId });
    } catch {
      showBanner("The photo could not be removed.");
    }
  }

  const hubStatus = projects === undefined ? "loading" : "ready";
  const projectCount = projects?.length ?? 0;
  const importBusy = busyAction === "import-pdf" || busyAction === "import-backup";
  const menuProject = projects?.find((project) => project.id === menuProjectId) ?? null;
  const activeProjects = (projects ?? []).filter((project) => (project.status ?? "active") !== "finished");
  const finishedProjects = (projects ?? [])
    .filter((project) => project.status === "finished")
    .sort((left, right) => (right.finishedAt ?? "").localeCompare(left.finishedAt ?? ""));
  const shownProjects = tab === "active" ? activeProjects : finishedProjects;
  const detailProject = projects?.find((project) => project.id === detailProjectId) ?? null;
  const photoBusy = busyAction === `photo:${detailProjectId}`;

  return (
    <div className="hub">
      <input ref={pdfInputRef} type="file" accept="application/pdf" hidden onChange={handlePdfImport} />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json,.whichstitch.json,application/json"
        hidden
        onChange={handleBackupImport}
      />
      <input ref={photoInputRef} type="file" accept="image/*" multiple hidden onChange={handlePhotoFiles} />

      <header className="hub-header">
        <div className="hub-brand">
          <p className="hub-kicker">WhichStitch</p>
          <h1 className="hub-title">Projects</h1>
          <p className="hub-count">
            {hubStatus === "loading"
              ? "Loading your library"
              : finishedProjects.length > 0
                ? `${activeProjects.length} on the needles · ${finishedProjects.length} finished`
                : `${projectCount} ${projectCount === 1 ? "pattern" : "patterns"}`}
          </p>
        </div>

        <div className="hub-header-actions">
          <button
            type="button"
            className="hub-btn hub-btn-primary"
            onClick={() => pdfInputRef.current?.click()}
            disabled={importBusy}
          >
            <span className="hub-btn-glyph" aria-hidden="true">
              +
            </span>
            {busyAction === "import-pdf" ? "Importing\u2026" : "Import PDF"}
          </button>
          <button
            ref={accountBtnRef}
            type="button"
            className="hub-btn hub-btn-icon"
            aria-label="Account and settings"
            aria-haspopup="dialog"
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">{"\u2699"}</span>
          </button>
        </div>
      </header>

      {hubStatus === "ready" && (finishedProjects.length > 0 || tab === "finished") ? (
        <div className="hub-tabs" role="tablist" aria-label="Project status">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "active"}
            className={`hub-tab${tab === "active" ? " active" : ""}`}
            onClick={() => setTab("active")}
          >
            Active
            <span className="hub-tab-count">{activeProjects.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "finished"}
            className={`hub-tab${tab === "finished" ? " active" : ""}`}
            onClick={() => setTab("finished")}
          >
            Finished
            <span className="hub-tab-count">{finishedProjects.length}</span>
          </button>
        </div>
      ) : null}

      {bannerMessage ? (
        <div className="hub-notice" role="status">
          <span>{bannerMessage}</span>
          {hasBannerRetry ? (
            <button
              type="button"
              className="hub-notice-retry"
              onClick={() => {
                const retry = bannerRetryRef.current;
                clearBanner();
                retry?.();
              }}
            >
              Retry
            </button>
          ) : null}
          <button type="button" className="hub-notice-close" onClick={clearBanner} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}

      {hubStatus === "loading" ? (
        <div className="hub-grid" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="hub-skeleton-card" />
          ))}
        </div>
      ) : null}

      {hubStatus === "ready" && tab === "finished" && finishedProjects.length === 0 ? (
        <div className="hub-empty">
          <div className="hub-empty-mark" aria-hidden="true">
            🎉
          </div>
          <h2 className="hub-empty-title">Nothing finished yet</h2>
          <p className="hub-empty-text">
            When you cast off, open a project&apos;s menu and mark it finished. It moves here, where you can add photos
            of the finished piece and notes about yarn, needles, and mods.
          </p>
        </div>
      ) : null}

      {hubStatus === "ready" && tab === "active" && projectCount > 0 && activeProjects.length === 0 ? (
        <div className="hub-empty">
          <div className="hub-empty-mark" aria-hidden="true">
            🧶
          </div>
          <h2 className="hub-empty-title">Nothing on the needles</h2>
          <p className="hub-empty-text">
            Import a new pattern, or visit your Finished shelf and knit an old favorite again.
          </p>
          <div className="hub-empty-actions">
            <button
              type="button"
              className="hub-btn hub-btn-primary"
              onClick={() => pdfInputRef.current?.click()}
              disabled={importBusy}
            >
              Import a PDF
            </button>
            <button type="button" className="hub-btn hub-btn-ghost" onClick={() => setTab("finished")}>
              Browse finished
            </button>
          </div>
        </div>
      ) : null}

      {hubStatus === "ready" && tab === "active" && projectCount === 0 ? (
        <div className="hub-empty">
          <div className="hub-empty-mark" aria-hidden="true">
            🧶
          </div>
          <h2 className="hub-empty-title">Start your first pattern</h2>
          <p className="hub-empty-text">
            Import a PDF knitting pattern to mark it up, drop counters, and keep your place. Everything syncs to your
            account automatically.
          </p>
          <div className="hub-empty-actions">
            <button
              type="button"
              className="hub-btn hub-btn-primary"
              onClick={() => pdfInputRef.current?.click()}
              disabled={importBusy}
            >
              Import a PDF
            </button>
            <button
              type="button"
              className="hub-btn hub-btn-ghost"
              onClick={() => backupInputRef.current?.click()}
              disabled={importBusy}
            >
              {busyAction === "import-backup" ? "Restoring\u2026" : "Restore a backup"}
            </button>
          </div>
        </div>
      ) : null}

      {hubStatus === "ready" && shownProjects.length > 0 ? (
        <div className="hub-grid">
          {shownProjects.map((project, index) => (
            <article
              key={project.id}
              className={`project-card${project.status === "finished" ? " project-card-finished" : ""}`}
              style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
              onClick={() => {
                if (editingProjectId === project.id) {
                  return;
                }
                if (project.status === "finished") {
                  openFinishedDetail(project.id);
                } else {
                  router.push(`/projects/${project.id}`);
                }
              }}
            >
              <div className="project-card-thumb" aria-hidden="true">
                {project.status === "finished" && project.finishedCoverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.finishedCoverUrl} alt="" loading="lazy" />
                ) : project.thumbnailDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.thumbnailDataUrl} alt="" loading="lazy" />
                ) : (
                  <span className="project-card-thumb-placeholder">🧶</span>
                )}
              </div>

              <div className="project-card-main">
                <div className="project-card-head">
                  <span
                    className={`project-card-badge${project.status === "finished" ? " badge-finished" : ""}`}
                  >
                    {project.status === "finished"
                      ? "✓ Finished"
                      : project.pageCount > 0
                        ? `${project.pageCount} ${project.pageCount === 1 ? "page" : "pages"}`
                        : "PDF"}
                  </span>
                  <button
                    type="button"
                    className="project-card-menu-btn"
                    aria-label={`Actions for ${project.name}`}
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      event.stopPropagation();
                      cardMenuAnchorRef.current = event.currentTarget;
                      setMenuProjectId(project.id);
                    }}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                </div>

                <div className="project-card-body">
                  {editingProjectId === project.id ? (
                    <input
                      value={editingProjectName}
                      className="project-card-name-input"
                      autoFocus
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setEditingProjectName(event.target.value)}
                      onBlur={() => void commitRename(project.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void commitRename(project.id);
                        }
                        if (event.key === "Escape") {
                          setEditingProjectId(null);
                          setEditingProjectName("");
                        }
                      }}
                    />
                  ) : (
                    <h3 className="project-card-name">{project.name}</h3>
                  )}
                  <p className="project-card-file">{project.sourceFileName}</p>
                </div>

                <p className="project-card-meta">
                  {project.status === "finished"
                    ? `Finished ${formatProjectTime(project.finishedAt ?? project.updatedAt)}`
                    : `Last opened ${formatProjectTime(project.lastOpenedAt)}`}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <Panel
        open={accountMenuOpen}
        onClose={() => setAccountMenuOpen(false)}
        title="Account"
        anchorRef={accountBtnRef}
        width={260}
      >
        <div className="menu-list">
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setAccountMenuOpen(false);
              setTheme((current) => (current === "dark" ? "light" : "dark"));
            }}
          >
            <span className="menu-item-glyph" aria-hidden="true">
              {theme === "dark" ? "☀" : "☾"}
            </span>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setAccountMenuOpen(false);
              backupInputRef.current?.click();
            }}
            disabled={importBusy}
          >
            <span className="menu-item-glyph" aria-hidden="true">
              ↥
            </span>
            {busyAction === "import-backup" ? "Restoring backup\u2026" : "Import backup"}
          </button>
          <button
            type="button"
            className="menu-item menu-item-danger"
            onClick={() => {
              setAccountMenuOpen(false);
              void signOut();
            }}
          >
            <span className="menu-item-glyph" aria-hidden="true">
              ⎋
            </span>
            Sign out
          </button>
        </div>
      </Panel>

      <Panel
        open={menuProject !== null}
        onClose={() => setMenuProjectId(null)}
        title={menuProject?.name}
        anchorRef={cardMenuAnchorRef}
        width={240}
      >
        {menuProject ? (
          <div className="menu-list">
            {menuProject.status === "finished" ? (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setMenuProjectId(null);
                    openFinishedDetail(menuProject.id);
                  }}
                >
                  <span className="menu-item-glyph" aria-hidden="true">
                    🖼
                  </span>
                  Photos &amp; notes
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    router.push(`/projects/${menuProject.id}`);
                  }}
                >
                  <span className="menu-item-glyph" aria-hidden="true">
                    ▸
                  </span>
                  Open pattern
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    const project = menuProject;
                    setMenuProjectId(null);
                    void handleKnitAgain(project.id, project.name);
                  }}
                  disabled={busyAction === `knitAgain:${menuProject.id}`}
                >
                  <span className="menu-item-glyph" aria-hidden="true">
                    ↻
                  </span>
                  {busyAction === `knitAgain:${menuProject.id}` ? "Casting on…" : "Knit again"}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    const id = menuProject.id;
                    setMenuProjectId(null);
                    void handleReactivate(id);
                  }}
                  disabled={busyAction === `reactivate:${menuProject.id}`}
                >
                  <span className="menu-item-glyph" aria-hidden="true">
                    ↩
                  </span>
                  Back to active
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    router.push(`/projects/${menuProject.id}`);
                  }}
                >
                  <span className="menu-item-glyph" aria-hidden="true">
                    ▸
                  </span>
                  Open
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    const id = menuProject.id;
                    setMenuProjectId(null);
                    void handleMarkFinished(id);
                  }}
                  disabled={busyAction === `finish:${menuProject.id}`}
                >
                  <span className="menu-item-glyph" aria-hidden="true">
                    ✓
                  </span>
                  {busyAction === `finish:${menuProject.id}` ? "Finishing…" : "Mark as finished"}
                </button>
              </>
            )}
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setEditingProjectId(menuProject.id);
                setEditingProjectName(menuProject.name);
                setMenuProjectId(null);
              }}
            >
              <span className="menu-item-glyph" aria-hidden="true">
                ✎
              </span>
              Rename
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                const id = menuProject.id;
                setMenuProjectId(null);
                void handleExport(id);
              }}
              disabled={busyAction === `export:${menuProject.id}`}
            >
              <span className="menu-item-glyph" aria-hidden="true">
                ↧
              </span>
              {busyAction === `export:${menuProject.id}` ? "Exporting\u2026" : "Export backup"}
            </button>
            <button
              type="button"
              className="menu-item menu-item-danger"
              onClick={() => {
                const id = menuProject.id;
                setMenuProjectId(null);
                void handleDelete(id);
              }}
              disabled={busyAction === `delete:${menuProject.id}`}
            >
              <span className="menu-item-glyph" aria-hidden="true">
                🗑
              </span>
              Delete
            </button>
          </div>
        ) : null}
      </Panel>

      <Panel
        open={detailProject !== null}
        onClose={closeFinishedDetail}
        title={detailProject?.name}
        width={440}
        className="finished-panel"
      >
        {detailProject ? (
          <>
            <p className="finished-date">
              {detailProject.finishedAt
                ? `Finished ${formatProjectTime(detailProject.finishedAt)}`
                : "Finished"}
            </p>

            <div className="finished-gallery">
              {(finishedDetail?.photos ?? []).map((photo) => (
                <div key={photo.storageId} className="finished-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="Finished project" loading="lazy" />
                  <button
                    type="button"
                    className="finished-photo-remove"
                    onClick={() => void handleRemovePhoto(photo.storageId)}
                    aria-label="Remove photo"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {(finishedDetail?.photos.length ?? 0) < (finishedDetail?.maxPhotos ?? 6) ? (
                <button
                  type="button"
                  className="finished-photo-add"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoBusy || finishedDetail === undefined}
                >
                  <span className="finished-photo-add-glyph" aria-hidden="true">
                    {photoBusy ? "…" : "＋"}
                  </span>
                  {photoBusy ? "Uploading" : "Add photo"}
                </button>
              ) : null}
            </div>

            <label className="finished-notes-field">
              <span>Notes</span>
              <textarea
                className="finished-notes"
                rows={4}
                placeholder="Yarn, needles, mods, who it was for…"
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.target.value)}
                disabled={finishedDetail === undefined}
              />
            </label>

            <div className="finished-actions">
              <button
                type="button"
                className="hub-btn hub-btn-primary"
                onClick={() => router.push(`/projects/${detailProject.id}`)}
              >
                Open pattern
              </button>
              <button
                type="button"
                className="hub-btn hub-btn-ghost"
                onClick={() => void handleKnitAgain(detailProject.id, detailProject.name)}
                disabled={busyAction === `knitAgain:${detailProject.id}`}
              >
                {busyAction === `knitAgain:${detailProject.id}` ? "Casting on…" : "Knit again"}
              </button>
              <button
                type="button"
                className="hub-btn hub-btn-ghost"
                onClick={() => void handleReactivate(detailProject.id)}
                disabled={busyAction === `reactivate:${detailProject.id}`}
              >
                Back to active
              </button>
            </div>
          </>
        ) : null}
      </Panel>
    </div>
  );
}

export default function ProjectHub() {
  const { theme, setTheme } = useStoredTheme();

  return (
    <main className="hub-page">
      <AuthLoading>
        <div className="hub-loading">
          <span className="hub-spinner" aria-hidden="true" />
          <p>Loading your account…</p>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <AuthForm theme={theme} setTheme={setTheme} />
      </Unauthenticated>
      <Authenticated>
        <HubInner theme={theme} setTheme={setTheme} />
      </Authenticated>
    </main>
  );
}
