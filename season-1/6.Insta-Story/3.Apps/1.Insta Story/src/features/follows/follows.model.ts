import mongoose, { Schema } from "mongoose";

// One row per (follower, followee). Both are usernames. The unique index is what stops a double follow.
const followSchema = new Schema(
  {
    followerId: { type: String, required: true, trim: true, lowercase: true },
    followeeId: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

followSchema.index({ followerId: 1, followeeId: 1 }, { unique: true });

export const Follow = mongoose.model("Follow", followSchema);

export const followersKey = (username: string): string => `profile:${username}:followers`;
export const followingKey = (username: string): string => `profile:${username}:following`;
export const followingFilterKey = (userId: string): string => `user:${userId}:following`;
