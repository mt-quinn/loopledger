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
  saveWorkspaceToCloud,
  uploadPdfProject
} from "../lib/convex-upload";
import { migrateLocalProjects } from "../lib/migrate-local";
import { computeBlobFingerprint, normalizeWorkspace } from "../lib/project-store";
import type { ProjectBackup } from "../lib/project-types";
import { useStoredTheme } from "../lib/use-stored-theme";
import AuthForm from "./AuthForm";

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

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");

  useEffect(() => {
    if (migrationStartedRef.current) {
      return;
    }
    migrationStartedRef.current = true;

    void migrateLocalProjects(convex)
      .then((count) => {
        if (count > 0) {
          setBannerMessage(
            `Moved ${count} ${count === 1 ? "project" : "projects"} from this device into your account.`
          );
        }
      })
      .catch(() => {
        // A failed migration leaves the flag unset and simply retries next visit.
      });
  }, [convex]);

  async function handlePdfImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setBusyAction("import-pdf");
    setBannerMessage(null);
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
      setBannerMessage("The PDF could not be uploaded to your account.");
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
      setBannerMessage(error instanceof Error ? error.message : "The backup file could not be restored.");
    }
  }

  async function handleExport(projectId: Id<"projects">) {
    setBusyAction(`export:${projectId}`);
    setBannerMessage(null);

    try {
      const data = await convex.query(api.projects.get, { projectId });
      if (!data) {
        setBannerMessage("The project could not be exported.");
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
      setBannerMessage("The project could not be exported.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDelete(projectId: Id<"projects">) {
    if (!window.confirm("Delete this project from your account?")) {
      return;
    }

    setBusyAction(`delete:${projectId}`);
    setBannerMessage(null);
    try {
      await removeProjectMutation({ projectId });
      if (editingProjectId === projectId) {
        setEditingProjectId(null);
        setEditingProjectName("");
      }
    } catch {
      setBannerMessage("The project could not be deleted.");
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
    setBannerMessage(null);
    try {
      await renameProjectMutation({ projectId, name: trimmed });
    } catch {
      setBannerMessage("The project name could not be updated.");
    } finally {
      setBusyAction(null);
    }
  }

  const hubStatus = projects === undefined ? "loading" : "ready";

  return (
    <section className="hub-shell">
      <input ref={pdfInputRef} type="file" accept="application/pdf" hidden onChange={handlePdfImport} />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json,.whichstitch.json,application/json"
        hidden
        onChange={handleBackupImport}
      />

      <section className="hub-board">
        <div className="hub-toolbar">
          <div className="hub-board-head">
            <div>
              <p className="hub-kicker">WhichStitch</p>
              <h1 className="hub-board-title">Projects</h1>
            </div>
            <p className="hub-board-meta">
              {(projects?.length ?? 0)} {(projects?.length ?? 0) === 1 ? "project" : "projects"}
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
            <button type="button" className="hub-secondary-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>

        {bannerMessage ? <p className="hub-banner">{bannerMessage}</p> : null}

        {hubStatus === "loading" ? (
          <div className="hub-empty">
            <h2 className="hub-empty-title">Loading projects.</h2>
          </div>
        ) : null}

        {hubStatus === "ready" && projects && projects.length === 0 ? (
          <div className="hub-empty">
            <h2 className="hub-empty-title">No projects yet.</h2>
          </div>
        ) : null}

        {hubStatus === "ready" && projects && projects.length > 0 ? (
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
  );
}

export default function ProjectHub() {
  const { theme, setTheme } = useStoredTheme();

  return (
    <main className="hub-page">
      <AuthLoading>
        <section className="hub-shell">
          <div className="hub-board">
            <div className="hub-empty">
              <h2 className="hub-empty-title">Loading account.</h2>
            </div>
          </div>
        </section>
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
