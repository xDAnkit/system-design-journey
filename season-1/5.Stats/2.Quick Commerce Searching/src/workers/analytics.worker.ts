// search.events -> Mongo (raw events + daily counters) + Redis (unique visitors, live ticker)
// + AI suggested tags + the searched-queries collection in Typesense.
// At-least-once: a batch that fails is read again, so a crash can count a batch twice. Fine for analytics.
import { ai } from "../ai/index.js";
import { SearchEventModel, StatsDailyModel } from "../analytics/analytics.models.js";
import type { AnalyticsEvent } from "../analytics/analytics.types.js";
import { buildRollup, toBulkOps, type ProductMeta } from "../analytics/rollup.js";
import { recordSuggestions, runAiChecks } from "../analytics/suggestions.js";
import { GROUPS, TOPICS, startConsumer } from "../bootstrap/kafka.js";
import { logger } from "../bootstrap/logger.js";
import { redisClient } from "../bootstrap/redis.js";
import { ProductModel } from "../features/products/products.model.js";
import { queryVectors } from "../search/query-vector.js";
import { activeProductsCollection, ensureQueriesCollection, importDocs } from "../search/typesense.schema.js";
import { sha1 } from "../shared/text.js";

const VISITORS_TTL_S = 100 * 24 * 3600;
const LIVE_TTL_S = 3 * 3600;
// new query vectors per batch: bounds the time a traffic burst spends on embeddings
const MAX_NEW_QUERY_VECTORS = 200;
const AI_CHECK_EVERY_MS = 15_000;
const POPULARITY_EVERY_MS = 10 * 60_000;

// product name / brand / category for the counters, so dashboards need no join
const metaCache = new Map<string, ProductMeta>();
const META_CACHE_MAX = 100_000;

async function productMeta(ids: string[]): Promise<Map<string, ProductMeta>> {
  const missing = [...new Set(ids)].filter((id) => !metaCache.has(id) && /^[a-f0-9]{24}$/.test(id));
  if (missing.length) {
    if (metaCache.size > META_CACHE_MAX) metaCache.clear();
    const docs = await ProductModel.find({ _id: { $in: missing } }, { name: 1, brand: 1, category: 1 }).lean();
    for (const d of docs) metaCache.set(String(d._id), { name: d.name, brand: d.brand, category: d.category });
  }
  return metaCache;
}

const isEvent = (e: AnalyticsEvent): boolean =>
  Boolean(e && typeof e.ts === "string" && typeof e.sessionId === "string" && ["search", "click", "add", "unserviceable"].includes(e.type));

async function writeRedis(visitors: Map<string, Set<string>>, live: Map<number, number>): Promise<void> {
  if (!redisClient.isReady) return;
  const multi = redisClient.multi();
  for (const [key, sessions] of visitors) {
    multi.pfAdd(`uv:${key}`, [...sessions]);
    multi.expire(`uv:${key}`, VISITORS_TTL_S);
  }
  for (const [minute, n] of live) {
    if (!n) continue;
    multi.incrBy(`live:${minute}`, n);
    multi.expire(`live:${minute}`, LIVE_TTL_S);
  }
  await multi.exec();
}

async function writeSearchedQueries(queries: Map<string, { q: string; script: string; count: number; lastSeen: number }>): Promise<void> {
  if (!queries.size || !redisClient.isReady) return;
  const active = await activeProductsCollection().catch(() => null);
  if (!active?.dims || active.embedModel !== ai.embedModelId()) return;
  const collection = await ensureQueriesCollection(active.dims);

  // running totals in a Redis hash, the Typesense doc gets the new total
  const multi = redisClient.multi();
  for (const [qNorm, q] of queries) multi.hIncrBy("qtotal", qNorm, q.count);
  const totals = (await multi.exec()) as unknown as number[];

  const entries = [...queries.entries()];
  const vectors = await queryVectors(entries.slice(0, MAX_NEW_QUERY_VECTORS).map(([qNorm]) => qNorm)).catch(() => new Map<string, number[]>());
  const docs = entries.map(([qNorm, q], i) => ({
    id: sha1(qNorm),
    q: q.q,
    script: q.script,
    count: Number(totals[i]) || q.count,
    last_seen: Math.floor(q.lastSeen / 1000),
    ...(vectors.get(qNorm) ? { embedding: vectors.get(qNorm)!.map((x) => Math.round(x * 1e5) / 1e5) } : {}),
  }));
  // emplace: a query that already has a vector keeps it when this batch had none for it
  const res = await importDocs(collection, docs, "emplace");
  if (res.failed) logger.debug(`searched-queries import: ${res.failed} failed (${res.firstError})`);
}

async function handle(events: AnalyticsEvent[]): Promise<void> {
  const valid = events.filter(isEvent);
  if (!valid.length) return;
  const ids = valid.flatMap((e) => (e.type === "search" ? e.shown.slice(0, 10) : e.type === "unserviceable" ? [] : [e.productId]));
  const meta = await productMeta(ids);
  const r = buildRollup(valid, meta, Date.now());

  await Promise.all([
    r.raw.length ? SearchEventModel.collection.insertMany(r.raw, { ordered: false }) : null,
    r.counters.length ? StatsDailyModel.bulkWrite(toBulkOps(r.counters) as never, { ordered: false }) : null,
  ]);
  await writeRedis(r.visitors, r.live);
  await recordSuggestions(r, meta);
  await writeSearchedQueries(r.queries).catch((err: unknown) => logger.warn(`searched-queries update failed: ${err instanceof Error ? err.message : String(err)}`));
}

// clicks of the last 7 days -> product popularity, a tie-breaker in ranking
async function refreshPopularity(): Promise<void> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const top = await StatsDailyModel.aggregate<{ _id: string; clicks: number }>([
    { $match: { kind: "product", day: { $gte: since } } },
    { $group: { _id: "$key", clicks: { $sum: { $add: [{ $ifNull: ["$clicks", 0] }, { $multiply: [{ $ifNull: ["$adds", 0] }, 2] }] } } } },
    { $sort: { clicks: -1 } },
    { $limit: 5000 },
  ]);
  if (!top.length) return;
  await ProductModel.bulkWrite(top.map((t) => ({ updateOne: { filter: { _id: t._id }, update: { $set: { popularity: t.clicks } } } })), { ordered: false });
  const active = await activeProductsCollection();
  if (!active) return;
  // partial update; ids that are not in Typesense just come back as failed rows
  await importDocs(active.collection, top.map((t) => ({ id: t._id, popularity: Math.round(t.clicks) })), "update");
}

export async function startAnalyticsWorker(): Promise<void> {
  const checks = setInterval(() => void runAiChecks().catch((err: unknown) => logger.debug(`AI checks: ${String(err)}`)), AI_CHECK_EVERY_MS);
  const popularity = setInterval(() => void refreshPopularity().catch((err: unknown) => logger.debug(`popularity: ${String(err)}`)), POPULARITY_EVERY_MS);
  checks.unref();
  popularity.unref();
  await startConsumer<AnalyticsEvent>(GROUPS.analytics, TOPICS.searchEvents, "analytics worker", handle, { maxBatch: 5000 });
}
