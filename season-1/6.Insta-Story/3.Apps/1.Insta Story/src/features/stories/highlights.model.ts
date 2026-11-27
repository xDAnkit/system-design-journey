import mongoose, { Schema } from "mongoose";
import { auditSnapshotSchema } from "../audit/audit.model.js";

// A highlight is a named list that outlives the story. It holds a reference, never a copy of the
// media, so the story row can expire and the highlight still renders.
const highlightSchema = new Schema(
  {
    ownerId: { type: String, required: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true, maxlength: 50 },
    coverStoryId: { type: Schema.Types.ObjectId, default: null, ref: "Story" },
    itemCount: { type: Number, default: 0 },
    audit: { type: auditSnapshotSchema, default: null },
  },
  { timestamps: true, versionKey: false },
);

highlightSchema.index({ ownerId: 1, _id: -1 });

export const Highlight = mongoose.model(
  "Highlight",
  highlightSchema,
  "highlights",
);

const highlightItemSchema = new Schema(
  {
    highlightId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Highlight",
    },
    storyId: { type: Schema.Types.ObjectId, required: true, ref: "Story" },
    addedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

highlightItemSchema.index({ highlightId: 1, storyId: 1 }, { unique: true });
highlightItemSchema.index({ highlightId: 1, _id: 1 });

export const HighlightItem = mongoose.model(
  "HighlightItem",
  highlightItemSchema,
  "highlight_items",
);
