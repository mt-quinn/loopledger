"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  clearLegacyWorkspaceStorage,
  createOrOpenProjectFromPdf,
  deleteProject,
  exportProjectBackup,
  importProjectBackup,
  listProjects,
  renameProject,
  requestDurableStorage
} from "../lib/project-store";
import type { ProjectMetadata } from "../lib/project-types";
import { useStoredTheme } from "../lib/use-stored-theme";

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

export default function ProjectHub() {
  const router = useRouter();
  const { theme, setTheme } = useStoredTheme();
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [hubStatus, setHubStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");

  async function refreshProjects() {
    try {
      setHubStatus("loading");
      setProjects(await listProjects());
      setHubStatus("ready");
    } catch {
      setHubStatus("error");
    }
  }

  useEffect(() => {
    clearLegacyWorkspaceStorage();
    void requestDurableStorage();
    void refreshProjects();
  }, []);

  async function handlePdfImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setBusyAction("import-pdf");
    setBannerMessage(null);
    try {
      const result = await createOrOpenProjectFromPdf(file);
      router.push(`/projects/${result.projectId}`);
    } catch {
      setBannerMessage("The PDF could not be imported into device storage.");
      setBusyAction(null);
    }
  }

  async function handleBackupImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setBusyAction("import-backup");
    setBannerMessage(null);
    try {
      const projectId = await importProjectBackup(file);
      router.push(`/projects/${projectId}`);
    } catch (error) {
      setBusyAction(null);
      setBannerMessage(error instanceof Error ? error.message : "The backup file could not be restored.");
    }
  }

  async function handleExport(projectId: string) {
    setBusyAction(`export:${projectId}`);
    setBannerMessage(null);

    try {
      const backup = await exportProjectBackup(projectId);
      if (!backup) {
        setBannerMessage("The project could not be exported.");
        return;
      }

      downloadBackupFile(
        `${backup.metadata.name || backup.metadata.sourceFileName}.whichstitch.json`,
        JSON.stringify(backup)
      );
    } catch {
      setBannerMessage("The project could not be exported.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete(projectId: string) {
    if (!window.confirm("Delete this project from device storage?")) {
      return;
    }

    setBusyAction(`delete:${projectId}`);
    setBannerMessage(null);
    try {
      await deleteProject(projectId);
      if (editingProjectId === projectId) {
        setEditingProjectId(null);
        setEditingProjectName("");
      }
      await refreshProjects();
    } catch {
      setBannerMessage("The project could not be deleted.");
    } finally {
      setBusyAction(null);
    }
  }

  async function commitRename(projectId: string) {
    const trimmed = editingProjectName.trim();
    setEditingProjectId(null);
    setEditingProjectName("");

    if (!trimmed) {
      return;
    }

    setBusyAction(`rename:${projectId}`);
    setBannerMessage(null);
    try {
      await renameProject(projectId, trimmed);
      await refreshProjects();
    } catch {
      setBannerMessage("The project name could not be updated.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="hub-page">
      <input ref={pdfInputRef} type="file" accept="application/pdf" hidden onChange={handlePdfImport} />
      <input ref={backupInputRef} type="file" accept=".json,.whichstitch.json,application/json" hidden onChange={handleBackupImport} />

      <section className="hub-shell">
        <section className="hub-board">
          <div className="hub-toolbar">
            <div className="hub-board-head">
              <div>
                <p className="hub-kicker">WhichStitch</p>
                <h1 className="hub-board-title">Projects</h1>
              </div>
              <p className="hub-board-meta">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </p>
            </div>

            <div className="hub-actions">
              <button
                type="button"
                className="hub-primary-btn"
                onClick={() => pdfInputRef.current?.click()}
                disabled={busyAction === "import-pdf" || busyAction === "import-backup"}
              >
                {busyAction === "import-pdf" ? "Importing PDF..." : "Import PDF"}
              </button>
              <button
                type="button"
                className="hub-secondary-btn"
                onClick={() => backupInputRef.current?.click()}
                disabled={busyAction === "import-pdf" || busyAction === "import-backup"}
              >
                {busyAction === "import-backup" ? "Restoring Backup..." : "Import Backup"}
              </button>
              <button
                type="button"
                className={theme === "dark" ? "hub-secondary-btn active" : "hub-secondary-btn"}
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              >
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
            </div>
          </div>

          {bannerMessage ? <p className="hub-banner">{bannerMessage}</p> : null}

          {hubStatus === "loading" ? (
            <div className="hub-empty">
              <h2 className="hub-empty-title">Loading projects.</h2>
            </div>
          ) : null}

          {hubStatus === "error" ? (
            <div className="hub-empty">
              <h2 className="hub-empty-title">Storage unavailable.</h2>
            </div>
          ) : null}

          {hubStatus === "ready" && projects.length === 0 ? (
            <div className="hub-empty">
              <h2 className="hub-empty-title">No projects yet.</h2>
            </div>
          ) : null}

          {hubStatus === "ready" && projects.length > 0 ? (
            <div className="hub-project-grid">
              {projects.map((project, index) => (
                <article
                  key={project.id}
                  className="hub-project-card"
                  style={{ animationDelay: `${index * 70}ms` }}
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <div className="hub-project-top">
                    <p className="hub-project-index">{String(index + 1).padStart(2, "0")}</p>
                    <p className="hub-project-badge">{project.pageCount > 0 ? `${project.pageCount} pages` : "PDF"}</p>
                  </div>

                  <div className="hub-project-body">
                    {editingProjectId === project.id ? (
                      <input
                        value={editingProjectName}
                        className="hub-project-name-input"
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
                      <h3 className="hub-project-name">{project.name}</h3>
                    )}

                    <p className="hub-project-file">{project.sourceFileName}</p>

                    <div className="hub-project-stats">
                      <span>Last opened {formatProjectTime(project.lastOpenedAt)}</span>
                    </div>
                  </div>

                  <div className="hub-project-actions" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="hub-card-btn" onClick={() => router.push(`/projects/${project.id}`)}>
                      Open
                    </button>
                    <button
                      type="button"
                      className="hub-card-btn"
                      onClick={() => {
                        setEditingProjectId(project.id);
                        setEditingProjectName(project.name);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="hub-card-btn"
                      onClick={() => void handleExport(project.id)}
                      disabled={busyAction === `export:${project.id}`}
                    >
                      {busyAction === `export:${project.id}` ? "Exporting..." : "Export"}
                    </button>
                    <button
                      type="button"
                      className="hub-card-btn hub-card-btn-danger"
                      onClick={() => void handleDelete(project.id)}
                      disabled={busyAction === `delete:${project.id}` || busyAction === `rename:${project.id}`}
                    >
                      {busyAction === `delete:${project.id}` ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
