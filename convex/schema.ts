import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { workspaceValidator } from "./workspace";

export default defineSchema({
  ...authTables,

  projects: defineTable({
    userId: v.id("users"),
    name: v.string(),
    sourceFileName: v.string(),
    fingerprint: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
    lastOpenedAt: v.string(),
    pageCount: v.number(),
    pdfStorageId: v.id("_storage"),
    pdfMimeType: v.string(),
    // Small page-1 preview (JPEG data URL) shown on library cards.
    thumbnailDataUrl: v.optional(v.string()),
    // Finished-project archive. Absent status means active.
    status: v.optional(v.union(v.literal("active"), v.literal("finished"))),
    finishedAt: v.optional(v.string()),
    finishedNotes: v.optional(v.string()),
    finishedPhotoIds: v.optional(v.array(v.id("_storage")))
  })
    .index("by_user", ["userId"])
    .index("by_user_and_fingerprint", ["userId", "fingerprint"]),

  workspaces: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    workspace: workspaceValidator,
    updatedAt: v.string()
  }).index("by_project", ["projectId"])
});
