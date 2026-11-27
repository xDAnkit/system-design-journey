import mongoose, { Schema } from "mongoose";

// One row per (post, user). The unique index is what stops a double like.
const likeSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

likeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export const Like = mongoose.model("Like", likeSchema);
