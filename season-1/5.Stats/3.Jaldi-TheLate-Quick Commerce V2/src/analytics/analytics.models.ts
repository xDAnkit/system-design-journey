import mongoose, { Schema } from "mongoose";

// ---------- search_events: every raw event, time-series, deleted after 90 days ----------

export interface SearchEventDoc {
  ts: Date;
  meta: { type: string; city?: string };
  sessionId: string;
  q?: string;
  qNorm?: string;
  script?: string;
  results?: number;
  latencyMs?: number;
  productId?: string;
  position?: number;
  pincode?: string;
  storeId?: string;
  outOfStock?: boolean;
  vectorOnly?: number;
}

const searchEventSchema = new Schema<SearchEventDoc>(
  {
    ts: { type: Date, required: true },
    meta: { type: { type: String, required: true }, city: String },
    sessionId: String,
    q: String,
    qNorm: String,
    script: String,
    results: Number,
    latencyMs: Number,
    productId: String,
    position: Number,
    pincode: String,
    storeId: String,
    outOfStock: Boolean,
    vectorOnly: Number,
  },
  {
    timeseries: { timeField: "ts", metaField: "meta", granularity: "minutes" },
    expireAfterSeconds: 90 * 24 * 3600,
    versionKey: false,
  },
);
searchEventSchema.index({ qNorm: 1, ts: -1 });
searchEventSchema.index({ productId: 1, ts: -1 });

export const SearchEventModel = mongoose.model<SearchEventDoc>("SearchEvent", searchEventSchema, "search_events");

// ---------- stats_daily: counters per IST day, so a 30 day filter reads 30 docs per key ----------

export type StatsKind = "total" | "query" | "product" | "query_product" | "city" | "pincode" | "store" | "query_city" | "product_city";

export interface StatsDailyDoc {
  day: string;
  kind: StatsKind;
  key: string;
  q?: string;
  qDisplay?: string;
  script?: string;
  productId?: string;
  name?: string;
  brand?: string;
  category?: string;
  city?: string;
  pincode?: string;
  area?: string;
  storeId?: string;
  lat?: number;
  lng?: number;
  searches?: number;
  zero?: number;
  clicks?: number;
  adds?: number;
  impressions?: number;
  positionSum?: number;
  resultsSum?: number;
  latencySum?: number;
  latencyCount?: number;
  unserviceable?: number;
  outOfStock?: number;
  /** searches per IST hour, { "0": n ... "23": n } ($inc on an object, an array would not upsert) */
  hours?: Record<string, number>;
  /** latency histogram, bucket index -> count, see LATENCY_BUCKETS_MS */
  latency?: Record<string, number>;
}

const statsDailySchema = new Schema<StatsDailyDoc>(
  {
    day: { type: String, required: true },
    kind: { type: String, required: true },
    key: { type: String, required: true },
    q: String,
    qDisplay: String,
    script: String,
    productId: String,
    name: String,
    brand: String,
    category: String,
    city: String,
    pincode: String,
    area: String,
    storeId: String,
    lat: Number,
    lng: Number,
    searches: Number,
    zero: Number,
    clicks: Number,
    adds: Number,
    impressions: Number,
    positionSum: Number,
    resultsSum: Number,
    latencySum: Number,
    latencyCount: Number,
    unserviceable: Number,
    outOfStock: Number,
    hours: Schema.Types.Mixed,
    latency: Schema.Types.Mixed,
  },
  { versionKey: false, minimize: false },
);
statsDailySchema.index({ kind: 1, day: 1, key: 1 }, { unique: true });
statsDailySchema.index({ kind: 1, productId: 1, day: 1 });
statsDailySchema.index({ kind: 1, q: 1, day: 1 });
statsDailySchema.index({ kind: 1, city: 1, day: 1 });

export const StatsDailyModel = mongoose.model<StatsDailyDoc>("StatsDaily", statsDailySchema, "stats_daily");

/** upper bounds of the latency buckets, last one is "everything slower" */
export const LATENCY_BUCKETS_MS = [50, 100, 200, 300, 500, 1000, 2000, Infinity];

// ---------- tag_suggestions: vector-only matches that may become AI suggested tags ----------

export type SuggestionStatus = "candidate" | "active" | "rejected";

export interface TagSuggestionDoc {
  q: string;
  qDisplay: string;
  productId: string;
  productName: string;
  category: string;
  status: SuggestionStatus;
  aiCheck: "pending" | "yes" | "no";
  aiReason?: string | null;
  searches: number;
  clicks: number;
  adds: number;
  sessions: number;
  activatedBy: "clicks" | "admin" | null;
  activatedAt: Date | null;
  rejectedBy: "ai" | "admin" | null;
  firstSeen: Date;
  lastSeen: Date;
}

const tagSuggestionSchema = new Schema<TagSuggestionDoc>(
  {
    q: { type: String, required: true },
    qDisplay: String,
    productId: { type: String, required: true },
    productName: String,
    category: String,
    status: { type: String, enum: ["candidate", "active", "rejected"], default: "candidate" },
    aiCheck: { type: String, enum: ["pending", "yes", "no"], default: "pending" },
    aiReason: { type: String, default: null },
    searches: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    adds: { type: Number, default: 0 },
    sessions: { type: Number, default: 0 },
    activatedBy: { type: String, default: null },
    activatedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    firstSeen: Date,
    lastSeen: Date,
  },
  { versionKey: false },
);
tagSuggestionSchema.index({ q: 1, productId: 1 }, { unique: true });
tagSuggestionSchema.index({ status: 1, lastSeen: -1 });
tagSuggestionSchema.index({ aiCheck: 1, searches: -1 });
tagSuggestionSchema.index({ productId: 1 });

export const TagSuggestionModel = mongoose.model<TagSuggestionDoc>("TagSuggestion", tagSuggestionSchema, "tag_suggestions");
