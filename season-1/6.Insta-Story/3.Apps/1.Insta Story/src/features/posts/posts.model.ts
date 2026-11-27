import mongoose, { Schema } from "mongoose";

// One collection for posts and reels, told apart by `type`.
const postSchema = new Schema(
  {
    authorId: { type: String, required: true, trim: true, lowercase: true },
    type: { type: String, enum: ["post", "reel"], required: true },
    caption: { type: String, default: "", trim: true },
    // reels also use an image (cover). No video upload in this project.
    mediaUrl: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

// profile grid (newest first), and the global reels feed
postSchema.index({ authorId: 1, _id: -1 });
postSchema.index({ type: 1, _id: -1 });

export const Post = mongoose.model("Post", postSchema);
