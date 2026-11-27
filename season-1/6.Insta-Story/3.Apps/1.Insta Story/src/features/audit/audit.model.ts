import mongoose, { Schema } from "mongoose";
import { env } from "../../bootstrap/env.js";

// The small block copied onto a write record. Kept out of every index on purpose.
export const auditSnapshotSchema = new Schema(
  {
    by: { type: String, default: null },
    clientId: { type: String, default: null },
    ip: { type: String, default: null },
    requestId: { type: String, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// Geo block, shared with story view rows.
export const geoPointSchema = new Schema(
  {
    country: { type: String, default: null },
    region: { type: String, default: null },
    city: { type: String, default: null },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    asn: { type: Number, default: null },
  },
  { _id: false },
);

// Append-only trail: one row per write action, so "who did what, from where" can be answered
// later. Raw rows expire after AUDIT_RETENTION_DAYS; ipHash stays for correlation.
const auditEventSchema = new Schema(
  {
    requestId: { type: String, default: null },
    userId: { type: String, default: null },
    clientId: { type: String, default: null },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, default: null },
    ip: { type: String, default: null },
    socketIp: { type: String, default: null },
    ipHash: { type: String, default: null },
    ua: { type: String, default: null },
    browser: { type: String, default: null },
    os: { type: String, default: null },
    device: { type: String, default: null },
    lang: { type: String, default: null },
    timezone: { type: String, default: null },
    referer: { type: String, default: null },
    geo: { type: geoPointSchema, default: null },
    status: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

// Only index is the retention clock. Audit fields are for reading evidence, never for lookups.
auditEventSchema.index(
  { at: 1 },
  { expireAfterSeconds: env.auditRetentionDays * 24 * 60 * 60 },
);

export const AuditEvent = mongoose.model(
  "AuditEvent",
  auditEventSchema,
  "audit_events",
);
