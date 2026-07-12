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
  saveWorkspaceToCloud,
  uploadPdfProject
} from "../lib/convex-upload";
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

  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
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

  const hubStatus = projects === undefined ? "loading" : "ready";
  const projectCount = projects?.length ?? 0;
  const importBusy = busyAction === "import-pdf" || busyAction === "import-backup";
  const menuProject = projects?.find((project) => project.id === menuProjectId) ?? null;

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

      <header className="hub-header">
        <div className="hub-brand">
          <p className="hub-kicker">WhichStitch</p>
          <h1 className="hub-title">Projects</h1>
          <p className="hub-count">
            {hubStatus === "loading"
              ? "Loading your library"
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

      {hubStatus === "ready" && projectCount === 0 ? (
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

      {hubStatus === "ready" && projectCount > 0 ? (
        <div className="hub-grid">
          {projects!.map((project, index) => (
            <article
              key={project.id}
              className="project-card"
              style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
              onClick={() => {
                if (editingProjectId !== project.id) {
                  router.push(`/projects/${project.id}`);
                }
              }}
            >
              <div className="project-card-thumb" aria-hidden="true">
                {project.thumbnailDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={project.thumbnailDataUrl} alt="" loading="lazy" />
                ) : (
                  <span className="project-card-thumb-placeholder">🧶</span>
                )}
              </div>

              <div className="project-card-main">
                <div className="project-card-head">
                  <span className="project-card-badge">
                    {project.pageCount > 0
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

                <p className="project-card-meta">Last opened {formatProjectTime(project.lastOpenedAt)}</p>
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
