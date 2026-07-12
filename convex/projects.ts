import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { createDefaultWorkspace, workspaceValidator } from "./workspace";

function toMetadata(project: Doc<"projects">) {
  return {
    id: project._id,
    name: project.name,
    sourceFileName: project.sourceFileName,
    fingerprint: project.fingerprint,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastOpenedAt: project.lastOpenedAt,
    pageCount: project.pageCount,
    thumbnailDataUrl: project.thumbnailDataUrl
  };
}

// Generous ceiling for a ~360px JPEG data URL; rejects accidental huge payloads.
const MAX_THUMBNAIL_LENGTH = 200_000;

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("Not signed in.");
  }
  return userId;
}

async function loadOwnedProject(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  projectIdInput: string
): Promise<Doc<"projects"> | null> {
  const projectId = ctx.db.normalizeId("projects", projectIdInput);
  if (!projectId) {
    return null;
  }
  const project = await ctx.db.get(projectId);
  if (!project || project.userId !== userId) {
    return null;
  }
  return project;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return projects
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
      .map(toMetadata);
  }
});

export const get = query({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const project = await loadOwnedProject(ctx, userId, args.projectId);
    if (!project) {
      return null;
    }

    const workspaceRecord = await ctx.db
      .query("workspaces")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .unique();

    const pdfUrl = await ctx.storage.getUrl(project.pdfStorageId);
    if (!pdfUrl) {
      return null;
    }

    return {
      metadata: toMetadata(project),
      workspace: workspaceRecord?.workspace ?? createDefaultWorkspace(),
      pdfUrl,
      pdfMimeType: project.pdfMimeType
    };
  }
});

export const findByFingerprint = query({
  args: { fingerprint: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_user_and_fingerprint", (q) =>
        q.eq("userId", userId).eq("fingerprint", args.fingerprint)
      )
      .first();

    return existing ? { projectId: existing._id } : null;
  }
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  }
});

export const createFromPdf = mutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    sourceFileName: v.string(),
    fingerprint: v.string(),
    pageCount: v.number(),
    pdfMimeType: v.string()
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const timestamp = new Date().toISOString();

    const existing = await ctx.db
      .query("projects")
      .withIndex("by_user_and_fingerprint", (q) =>
        q.eq("userId", userId).eq("fingerprint", args.fingerprint)
      )
      .first();

    if (existing) {
      // This PDF already lives in the account; drop the duplicate upload.
      await ctx.storage.delete(args.storageId);
      await ctx.db.patch(existing._id, {
        sourceFileName: args.sourceFileName,
        lastOpenedAt: timestamp
      });
      return { projectId: existing._id, isExisting: true };
    }

    const projectId = await ctx.db.insert("projects", {
      userId,
      name: args.name,
      sourceFileName: args.sourceFileName,
      fingerprint: args.fingerprint,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
      pageCount: args.pageCount,
      pdfStorageId: args.storageId,
      pdfMimeType: args.pdfMimeType
    });

    await ctx.db.insert("workspaces", {
      projectId,
      userId,
      workspace: createDefaultWorkspace(),
      updatedAt: timestamp
    });

    return { projectId, isExisting: false };
  }
});

export const touch = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const project = await loadOwnedProject(ctx, userId, args.projectId);
    if (!project) {
      return;
    }
    await ctx.db.patch(project._id, { lastOpenedAt: new Date().toISOString() });
  }
});

export const rename = mutation({
  args: { projectId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const trimmed = args.name.trim();
    if (!trimmed) {
      return;
    }
    const userId = await requireUserId(ctx);
    const project = await loadOwnedProject(ctx, userId, args.projectId);
    if (!project) {
      return;
    }
    await ctx.db.patch(project._id, {
      name: trimmed,
      updatedAt: new Date().toISOString()
    });
  }
});

export const setThumbnail = mutation({
  args: { projectId: v.string(), thumbnailDataUrl: v.string() },
  handler: async (ctx, args) => {
    if (args.thumbnailDataUrl.length > MAX_THUMBNAIL_LENGTH || !args.thumbnailDataUrl.startsWith("data:image/")) {
      return;
    }
    const userId = await requireUserId(ctx);
    const project = await loadOwnedProject(ctx, userId, args.projectId);
    if (!project) {
      return;
    }
    await ctx.db.patch(project._id, { thumbnailDataUrl: args.thumbnailDataUrl });
  }
});

export const updatePageCount = mutation({
  args: { projectId: v.string(), pageCount: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const project = await loadOwnedProject(ctx, userId, args.projectId);
    if (!project || project.pageCount === args.pageCount) {
      return;
    }
    await ctx.db.patch(project._id, {
      pageCount: args.pageCount,
      updatedAt: new Date().toISOString()
    });
  }
});

export const saveWorkspace = mutation({
  args: { projectId: v.string(), workspace: workspaceValidator },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const project = await loadOwnedProject(ctx, userId, args.projectId);
    if (!project) {
      return;
    }

    const timestamp = new Date().toISOString();
    const workspaceRecord = await ctx.db
      .query("workspaces")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .unique();

    if (workspaceRecord) {
      await ctx.db.patch(workspaceRecord._id, {
        workspace: args.workspace,
        updatedAt: timestamp
      });
    } else {
      await ctx.db.insert("workspaces", {
        projectId: project._id,
        userId,
        workspace: args.workspace,
        updatedAt: timestamp
      });
    }

    await ctx.db.patch(project._id, { updatedAt: timestamp });
  }
});

export const remove = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const project = await loadOwnedProject(ctx, userId, args.projectId);
    if (!project) {
      return;
    }

    const workspaceRecord = await ctx.db
      .query("workspaces")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .unique();
    if (workspaceRecord) {
      await ctx.db.delete(workspaceRecord._id);
    }

    await ctx.storage.delete(project.pdfStorageId);
    await ctx.db.delete(project._id);
  }
});
