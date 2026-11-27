import mongoose, { Schema } from "mongoose";
import { auditSnapshotSchema } from "../audit/audit.model.js";

// A story is a row that stops rendering after expiresAt but is never deleted, so highlights and
// archived reads keep working. status is the single source of truth for visibility.
const storySchema = new Schema(
  {
    authorId: { type: String, required: true, trim: true, lowercase: true },
    type: { type: String, enum: ["image", "video"], required: true },
    caption: { type: String, default: "", trim: true, maxlength: 500 },
    mediaUrl: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },
    audience: {
      type: String,
      enum: ["public", "followers"],
      default: "followers",
    },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["live", "expired", "archived", "deleted"],
      default: "live",
    },
    version: { type: Number, default: 0 },
    edited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    isExtended: { type: Boolean, default: false },
    audit: { type: auditSnapshotSchema, default: null },
  },
  { timestamps: true, versionKey: false },
);

storySchema.index({ authorId: 1, _id: -1 }); // tray and author list
storySchema.index({ status: 1, expiresAt: 1 }); // sweeper

export const Story = mongoose.model("Story", storySchema, "stories");

// One row per (story, viewer). The unique index is what makes a rewatch a counter bump and never
// a second viewer. lastClient is the evidence: who watched, from which IP, device and geo.
const storyViewSchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, required: true, ref: "Story" },
    viewerId: { type: String, required: true, trim: true, lowercase: true },
    firstViewedAt: { type: Date, required: true },
    lastViewedAt: { type: Date, required: true },
    watchCount: { type: Number, default: 1 },
    lastClient: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false },
);

storyViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true });
storyViewSchema.index({ storyId: 1, lastViewedAt: -1 });

export const StoryView = mongoose.model(
  "StoryView",
  storyViewSchema,
  "story_views",
);

// One row per (story, viewer). The Redis counter moves only by rows that really changed.
const storyLikeSchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, required: true, ref: "Story" },
    userId: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

storyLikeSchema.index({ storyId: 1, userId: 1 }, { unique: true });

export const StoryLike = mongoose.model(
  "StoryLike",
  storyLikeSchema,
  "story_likes",
);

// A reply is a private message to the author. It keeps its storyId, so it survives story expiry.
const storyReplySchema = new Schema(
  {
    storyId: { type: Schema.Types.ObjectId, required: true, ref: "Story" },
    authorId: { type: String, required: true, trim: true, lowercase: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    audit: { type: auditSnapshotSchema, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

storyReplySchema.index({ storyId: 1, _id: 1 });

export const StoryReply = mongoose.model(
  "StoryReply",
  storyReplySchema,
  "story_replies",
);
