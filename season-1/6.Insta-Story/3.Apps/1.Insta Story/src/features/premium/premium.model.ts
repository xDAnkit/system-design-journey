import mongoose, { Schema } from "mongoose";
import { auditSnapshotSchema } from "../audit/audit.model.js";

// One row per username. No payment, so no invoices and no history: only the current state.
const subscriptionSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    tier: { type: String, enum: ["meta_one"], default: "meta_one" },
    status: { type: String, enum: ["active", "cancelled"], default: "active" },
    startedAt: { type: Date, default: Date.now },
    cancelledAt: { type: Date, default: null },
    audit: { type: auditSnapshotSchema, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const Subscription = mongoose.model(
  "Subscription",
  subscriptionSchema,
  "subscriptions",
);
