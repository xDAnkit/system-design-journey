import mongoose, { Schema } from "mongoose";

// authorId on posts and comments is the username. There is no users feature, only this display card.
// followers and following are not stored here: they are Redis counters backed by the follows collection (Phase 4).
const profileSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    displayName: { type: String, required: true, trim: true },
    bio: { type: String, default: "", trim: true },
    avatarUrl: { type: String, required: true },
    verified: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

export const Profile = mongoose.model("Profile", profileSchema);
