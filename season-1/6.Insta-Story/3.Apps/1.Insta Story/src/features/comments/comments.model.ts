import mongoose, { Schema } from "mongoose";

// Flat list only. No replies, no comment likes.
const commentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: String, required: true, trim: true, lowercase: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true, versionKey: false },
);

commentSchema.index({ postId: 1, _id: -1 });

export const Comment = mongoose.model("Comment", commentSchema);
