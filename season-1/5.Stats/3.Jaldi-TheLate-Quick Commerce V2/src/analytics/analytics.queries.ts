// Read side of the analytics: every dashboard number comes from stats_daily (one doc per day per key),
// unique visitors from Redis HyperLogLogs. A 30 day range reads 30 docs per key, not 30 days of raw events.
import type { PipelineStage } from "mongoose";
import { redisClient } from "../bootstrap/redis.js";
import { typesense, tsNames } from "../bootstrap/typesense.js";
import { ProductModel } from "../features/products/products.model.js";
import { PINCODES, STORES, resolveLocation } from "../locations/locations.service.js";
import { activeProductsCollection } from "../search/typesense.schema.js";
import type { DateRange } from "../shared/date-range.js";
import { sha1 } from "../shared/text.js";
import { LATENCY_BUCKETS_MS, StatsDailyModel, TagSuggestionModel, type StatsKind } from "./analytics.models.js";

const COUNTERS = ["searches", "zero", "clicks", "adds", "impressions", "positionSum", "resultsSum", "latencySum", "latencyCount", "unserviceable", "outOfStock"] as const;
type Counters = Record<(typeof COUNTERS)[number], number>;

const sums = (fields: readonly string[]) => Object.fromEntries(fields.map((f) => [f, { $sum: { $ifNull: [`$${f}`, 0] } }]));
const ratio = (a: number, b: number): number => (b > 0 ? a / b : 0);
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pct = (now: number, before: number): number | null => (before > 0 ? (now - before) / before : null);

export interface Scope {
  city?: string;
}

async function totals(kind: StatsKind, days: string[], match: Record<string, unknown> = {}): Promise<Counters> {
  const [row] = await StatsDailyModel.aggregate([{ $match: { kind, day: { $in: days }, ...match } }, { $group: { _id: null, ...sums(COUNTERS) } }]);
  return Object.fromEntries(COUNTERS.map((f) => [f, row?.[f] ?? 0])) as Counters;
}

/** Unique visitors over any range: PFCOUNT merges the per-day HyperLogLogs on the fly. */
async function uniqueVisitors(days: string[], city?: string): Promise<number | null> {
  if (!redisClient.isReady || !days.length) return null;
  return redisClient.pfCount(days.map((d) => `uv:${city ? `${d}|${city}` : d}`));
}

// latency histogram -> approximate percentile (upper bound of the bucket that holds it)
async function latencyPercentiles(days: string[]): Promise<{ p50: number | null; p95: number | null }> {
  const docs = await StatsDailyModel.find({ kind: "total", day: { $in: days } }, { latency: 1 }).lean();
  const counts = LATENCY_BUCKETS_MS.map((_, i) => docs.reduce((s, d) => s + Number(d.latency?.[String(i)] ?? 0), 0));
  const n = counts.reduce((a, b) => a + b, 0);
  const at = (p: number): number | null => {
    if (!n) return null;
    let seen = 0;
    for (let i = 0; i < counts.length; i++) {
      seen += counts[i];
      if (seen >= n * p) return Number.isFinite(LATENCY_BUCKETS_MS[i]) ? LATENCY_BUCKETS_MS[i] : 5000;
    }
    return null;
  };
  return { p50: at(0.5), p95: at(0.95) };
}

const kpisOf = (c: Counters, visitors: number | null) => ({
  searches: c.searches,
  visitors,
  zeroRate: ratio(c.zero, c.searches),
  ctr: ratio(c.clicks, c.searches),
  clicks: c.clicks,
  adds: c.adds,
  unserviceable: c.unserviceable,
  outOfStock: c.outOfStock,
  avgLatencyMs: c.latencyCount ? Math.round(c.latencySum / c.latencyCount) : null,
});

const istRange = (range: DateRange): { from: Date; to: Date } => ({
  from: new Date(`${range.from}T00:00:00+05:30`),
  to: new Date(`${range.to}T23:59:59.999+05:30`),
});

async function trend(kind: StatsKind, range: DateRange, match: Record<string, unknown>) {
  if (range.hourly) {
    const docs = await StatsDailyModel.find({ kind, day: range.days[0], ...match }, { hours: 1 }).lean();
    return Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}:00`, searches: docs.reduce((s, d) => s + Number(d.hours?.[String(h)] ?? 0), 0) }));
  }
  const rows = await StatsDailyModel.aggregate([{ $match: { kind, day: { $in: range.days }, ...match } }, { $group: { _id: "$day", ...sums(["searches", "clicks", "adds", "zero"]) } }]);
  const byDay = new Map(rows.map((r) => [r._id as string, r]));
  return range.days.map((day) => ({ label: day, searches: byDay.get(day)?.searches ?? 0, clicks: byDay.get(day)?.clicks ?? 0, adds: byDay.get(day)?.adds ?? 0, zero: byDay.get(day)?.zero ?? 0 }));
}

async function topQueries(days: string[], scope: Scope, sortBy: "searches" | "zero", limit = 10) {
  const kind: StatsKind = scope.city ? "query_city" : "query";
  return StatsDailyModel.aggregate([
    { $match: { kind, day: { $in: days }, ...(scope.city ? { city: scope.city } : {}) } },
    { $group: { _id: "$q", qDisplay: { $last: "$qDisplay" }, script: { $last: "$script" }, ...sums(["searches", "zero", "clicks", "adds"]) } },
    ...(sortBy === "zero" ? [{ $match: { zero: { $gt: 0 } } }] : []),
    { $sort: { [sortBy]: -1 } },
    { $limit: limit },
  ]);
}

async function topProducts(days: string[], scope: Scope, limit = 10, extra: Record<string, unknown> = {}) {
  const kind: StatsKind = scope.city ? "product_city" : "product";
  return StatsDailyModel.aggregate([
    { $match: { kind, day: { $in: days }, ...(scope.city ? { city: scope.city } : {}), ...extra } },
    { $group: { _id: "$productId", name: { $last: "$name" }, brand: { $last: "$brand" }, category: { $last: "$category" }, ...sums(["impressions", "clicks", "adds"]) } },
    { $sort: { clicks: -1, impressions: -1 } },
    { $limit: limit },
  ]);
}

// ---------- pages ----------

export async function overview(range: DateRange, scope: Scope) {
  const kind: StatsKind = scope.city ? "city" : "total";
  const match = scope.city ? { city: scope.city } : {};
  const [now, before, visitorsNow, visitorsBefore, latency, scripts, queries, products, zero, learned, candidates] = await Promise.all([
    totals(kind, range.days, match),
    totals(kind, range.previous, match),
    uniqueVisitors(range.days, scope.city),
    uniqueVisitors(range.previous, scope.city),
    scope.city ? Promise.resolve({ p50: null, p95: null }) : latencyPercentiles(range.days),
    StatsDailyModel.aggregate([
      { $match: { kind: scope.city ? "query_city" : "query", day: { $in: range.days }, ...match } },
      { $group: { _id: { $ifNull: ["$script", "Roman"] }, searches: { $sum: { $ifNull: ["$searches", 0] } } } },
      { $sort: { searches: -1 } },
    ]),
    topQueries(range.days, scope, "searches"),
    topProducts(range.days, scope),
    topQueries(range.days, scope, "zero"),
    TagSuggestionModel.countDocuments({ status: "active", activatedAt: { $gte: istRange(range).from, $lte: istRange(range).to } }),
    TagSuggestionModel.countDocuments({ status: "candidate" }),
  ]);
  const k = kpisOf(now, visitorsNow);
  const p = kpisOf(before, visitorsBefore);
  return {
    range,
    kpis: { ...k, p50LatencyMs: latency.p50, p95LatencyMs: latency.p95, learnedTags: learned, pendingSuggestions: candidates },
    change: {
      searches: pct(k.searches, p.searches),
      visitors: k.visitors !== null && p.visitors !== null ? pct(k.visitors, p.visitors) : null,
      zeroRate: p.zeroRate ? k.zeroRate - p.zeroRate : null,
      ctr: p.ctr ? k.ctr - p.ctr : null,
      adds: pct(k.adds, p.adds),
      unserviceable: pct(k.unserviceable, p.unserviceable),
    },
    trend: await trend(kind, range, match),
    scripts: scripts.map((s) => ({ script: s._id, searches: s.searches })),
    topQueries: queries,
    topProducts: products,
    zeroQueries: zero,
  };
}

const SEARCH_SORTS = new Set(["searches", "zero", "clicks", "adds", "ctr", "avgResults", "outOfStock"]);
const PRODUCT_SORTS = new Set(["impressions", "clicks", "adds", "ctr", "addRate", "avgPosition"]);

export interface TableQuery {
  sort?: string;
  order?: "asc" | "desc";
  page: number;
  limit: number;
  q?: string;
}

const facetPage = (sort: string, order: "asc" | "desc", page: number, limit: number): PipelineStage[] => [
  { $sort: { [sort]: order === "asc" ? 1 : -1, _id: 1 } },
  { $facet: { rows: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: "n" }] } },
];

export async function searchesTable(range: DateRange, scope: Scope, t: TableQuery & { script?: string; zeroOnly?: boolean }) {
  const sort = t.sort && SEARCH_SORTS.has(t.sort) ? t.sort : "searches";
  const [res] = await StatsDailyModel.aggregate([
    {
      $match: {
        kind: scope.city ? "query_city" : "query",
        day: { $in: range.days },
        ...(scope.city ? { city: scope.city } : {}),
        ...(t.q ? { q: { $regex: escapeRegex(t.q.toLowerCase()) } } : {}),
      },
    },
    { $group: { _id: "$q", qDisplay: { $last: "$qDisplay" }, script: { $max: "$script" }, ...sums(["searches", "zero", "clicks", "adds", "resultsSum", "outOfStock"]) } },
    { $match: { searches: { $gt: 0 }, ...(t.script ? { script: t.script } : {}), ...(t.zeroOnly ? { zero: { $gt: 0 } } : {}) } },
    { $addFields: { ctr: { $cond: [{ $gt: ["$searches", 0] }, { $divide: ["$clicks", "$searches"] }, 0] }, avgResults: { $cond: [{ $gt: ["$searches", 0] }, { $divide: ["$resultsSum", "$searches"] }, 0] } } },
    ...facetPage(sort, t.order ?? "desc", t.page, t.limit),
  ]);
  return { rows: res?.rows ?? [], total: res?.total?.[0]?.n ?? 0, page: t.page, limit: t.limit, sort, order: t.order ?? "desc" };
}

export async function productsTable(range: DateRange, scope: Scope, t: TableQuery & { category?: string }) {
  const sort = t.sort && PRODUCT_SORTS.has(t.sort) ? t.sort : "clicks";
  const [res] = await StatsDailyModel.aggregate([
    {
      $match: {
        kind: scope.city ? "product_city" : "product",
        day: { $in: range.days },
        ...(scope.city ? { city: scope.city } : {}),
        ...(t.category ? { category: t.category } : {}),
        ...(t.q ? { name: { $regex: escapeRegex(t.q), $options: "i" } } : {}),
      },
    },
    { $group: { _id: "$productId", name: { $last: "$name" }, brand: { $last: "$brand" }, category: { $last: "$category" }, ...sums(["impressions", "clicks", "adds", "positionSum"]) } },
    {
      $addFields: {
        ctr: { $cond: [{ $gt: ["$impressions", 0] }, { $divide: ["$clicks", "$impressions"] }, 0] },
        addRate: { $cond: [{ $gt: ["$clicks", 0] }, { $divide: ["$adds", "$clicks"] }, 0] },
        avgPosition: { $cond: [{ $gt: ["$clicks", 0] }, { $divide: ["$positionSum", "$clicks"] }, null] },
      },
    },
    ...facetPage(sort, t.order ?? "desc", t.page, t.limit),
  ]);
  return { rows: res?.rows ?? [], total: res?.total?.[0]?.n ?? 0, page: t.page, limit: t.limit, sort, order: t.order ?? "desc" };
}

/** "Log ye bhi search karte hain": nearest queries by vector in the searched-queries collection */
async function similarQueries(qNorm: string): Promise<Array<{ q: string; count: number; distance: number }>> {
  const active = await activeProductsCollection().catch(() => null);
  if (!active?.dims) return [];
  try {
    const collection = tsNames.queriesCollection(active.dims);
    const res = (await typesense.multiSearch.perform({
      searches: [{ collection, q: "*", vector_query: `embedding:([], id: ${sha1(qNorm)}, k: 11)`, include_fields: "q,count", per_page: 11 }],
    } as never)) as unknown as { results: Array<{ hits?: Array<{ document: { id: string; q: string; count: number }; vector_distance: number }> }> };
    return (res.results[0]?.hits ?? []).filter((h) => h.document.id !== sha1(qNorm)).slice(0, 10).map((h) => ({ q: h.document.q, count: h.document.count, distance: Math.round(h.vector_distance * 1000) / 1000 }));
  } catch {
    return []; // this query has no vector yet
  }
}

export async function searchDetail(range: DateRange, scope: Scope, qNorm: string) {
  const kind: StatsKind = scope.city ? "query_city" : "query";
  const match = { q: qNorm, ...(scope.city ? { city: scope.city } : {}) };
  const [now, before, daily, products, cities, similar, rewrite, suggestions] = await Promise.all([
    totals(kind, range.days, match),
    totals(kind, range.previous, match),
    StatsDailyModel.aggregate([{ $match: { kind, day: { $in: range.days }, ...match } }, { $group: { _id: "$day", ...sums(["searches", "clicks", "zero", "adds"]) } }, { $sort: { _id: 1 } }]),
    StatsDailyModel.aggregate([
      { $match: { kind: "query_product", day: { $in: range.days }, q: qNorm } },
      { $group: { _id: "$productId", name: { $last: "$name" }, brand: { $last: "$brand" }, category: { $last: "$category" }, ...sums(["clicks", "adds"]) } },
      { $sort: { clicks: -1, adds: -1 } },
      { $limit: 20 },
    ]),
    StatsDailyModel.aggregate([
      { $match: { kind: "query_city", day: { $in: range.days }, q: qNorm } },
      { $group: { _id: "$city", ...sums(["searches", "clicks", "zero", "outOfStock"]) } },
      { $sort: { searches: -1 } },
    ]),
    similarQueries(qNorm),
    redisClient.isReady ? redisClient.get(`qrw:${sha1(qNorm)}`).catch(() => null) : Promise.resolve(null),
    TagSuggestionModel.find({ q: qNorm }).sort({ searches: -1 }).limit(20).lean(),
  ]);
  const byDay = new Map(daily.map((d) => [d._id as string, d]));
  return {
    q: qNorm,
    kpis: { searches: now.searches, clicks: now.clicks, adds: now.adds, zeroRate: ratio(now.zero, now.searches), ctr: ratio(now.clicks, now.searches), outOfStock: now.outOfStock, avgResults: ratio(now.resultsSum, now.searches) },
    change: { searches: pct(now.searches, before.searches) },
    trend: range.days.map((day) => ({ label: day, searches: byDay.get(day)?.searches ?? 0, clicks: byDay.get(day)?.clicks ?? 0, zero: byDay.get(day)?.zero ?? 0 })),
    products,
    cities,
    similar,
    rewrite: rewrite && rewrite !== "-" ? rewrite : null,
    suggestions,
  };
}

export async function productDetail(range: DateRange, scope: Scope, productId: string) {
  const product = await ProductModel.findById(productId).lean();
  if (!product) return null;
  const kind: StatsKind = scope.city ? "product_city" : "product";
  const match = { productId, ...(scope.city ? { city: scope.city } : {}) };
  const [now, before, daily, queries, cities, suggestions] = await Promise.all([
    totals(kind, range.days, match),
    totals(kind, range.previous, match),
    StatsDailyModel.aggregate([{ $match: { kind, day: { $in: range.days }, ...match } }, { $group: { _id: "$day", ...sums(["impressions", "clicks", "adds"]) } }]),
    StatsDailyModel.aggregate([
      { $match: { kind: "query_product", day: { $in: range.days }, productId } },
      { $group: { _id: "$q", qDisplay: { $last: "$qDisplay" }, ...sums(["clicks", "adds"]) } },
      { $sort: { clicks: -1 } },
      { $limit: 20 },
    ]),
    StatsDailyModel.aggregate([
      { $match: { kind: "product_city", day: { $in: range.days }, productId } },
      { $group: { _id: "$city", ...sums(["impressions", "clicks", "adds"]) } },
      { $sort: { clicks: -1 } },
    ]),
    TagSuggestionModel.find({ productId }).sort({ status: 1, searches: -1 }).limit(30).lean(),
  ]);
  const byDay = new Map(daily.map((d) => [d._id as string, d]));
  return {
    product: { ...product, stores: product.storeIds.map((id) => STORES.get(id)).filter(Boolean).map((s) => ({ id: s!.id, name: s!.name, city: s!.city })) },
    kpis: { impressions: now.impressions, clicks: now.clicks, adds: now.adds, ctr: ratio(now.clicks, now.impressions), addRate: ratio(now.adds, now.clicks), avgPosition: now.clicks ? now.positionSum / now.clicks : null },
    change: { clicks: pct(now.clicks, before.clicks), impressions: pct(now.impressions, before.impressions) },
    trend: range.days.map((day) => ({ label: day, impressions: byDay.get(day)?.impressions ?? 0, clicks: byDay.get(day)?.clicks ?? 0, adds: byDay.get(day)?.adds ?? 0 })),
    queries,
    cities,
    suggestions,
  };
}

export async function locations(range: DateRange) {
  const [cities, citiesBefore, pincodes, stores, outOfStock] = await Promise.all([
    StatsDailyModel.aggregate([{ $match: { kind: "city", day: { $in: range.days } } }, { $group: { _id: "$city", ...sums(["searches", "zero", "clicks", "adds", "unserviceable", "outOfStock"]) } }, { $sort: { searches: -1 } }]),
    StatsDailyModel.aggregate([{ $match: { kind: "city", day: { $in: range.previous } } }, { $group: { _id: "$city", searches: { $sum: { $ifNull: ["$searches", 0] } } } }]),
    StatsDailyModel.aggregate([{ $match: { kind: "pincode", day: { $in: range.days } } }, { $group: { _id: "$pincode", ...sums(["searches", "zero", "clicks", "adds", "unserviceable"]) } }]),
    StatsDailyModel.aggregate([{ $match: { kind: "store", day: { $in: range.days } } }, { $group: { _id: "$storeId", ...sums(["searches", "zero", "clicks", "adds", "outOfStock"]) } }, { $sort: { searches: -1 } }]),
    StatsDailyModel.aggregate([
      { $match: { kind: "query_city", day: { $in: range.days }, outOfStock: { $gt: 0 } } },
      { $group: { _id: { q: "$q", city: "$city" }, qDisplay: { $last: "$qDisplay" }, outOfStock: { $sum: "$outOfStock" }, searches: { $sum: { $ifNull: ["$searches", 0] } } } },
      { $sort: { outOfStock: -1 } },
      { $limit: 25 },
    ]),
  ]);
  const before = new Map(citiesBefore.map((c) => [c._id as string, c.searches as number]));
  const visitors = await Promise.all(cities.map((c) => uniqueVisitors(range.days, c._id as string)));
  const pins = pincodes
    .map((p) => {
      const meta = PINCODES.get(p._id as string);
      if (!meta) return null;
      return { pincode: meta.pin, area: meta.area, city: meta.city, lat: meta.lat, lng: meta.lng, serviceable: Boolean(resolveLocation({ pincode: meta.pin })?.serviceable), ...p, _id: undefined };
    })
    .filter(Boolean) as Array<{ pincode: string; area: string; city: string; lat: number; lng: number; serviceable: boolean; searches: number; unserviceable: number }>;
  return {
    range,
    cities: cities.map((c, i) => ({ city: c._id, ...c, _id: undefined, visitors: visitors[i], growth: pct(c.searches, before.get(c._id) ?? 0) })),
    pincodes: pins,
    stores: stores.map((s) => ({ ...s, storeId: s._id, _id: undefined, name: STORES.get(s._id)?.name ?? s._id, city: STORES.get(s._id)?.city ?? "" })),
    // searches from places with no dark store: where to open the next one
    unserviceable: pins.filter((p) => !p.serviceable && p.unserviceable > 0).sort((a, b) => b.unserviceable - a.unserviceable),
    // searched in a store that does not stock it, while other stores do: what to stock
    outOfStock: outOfStock.map((o) => ({ q: o._id.q, city: o._id.city, qDisplay: o.qDisplay, outOfStock: o.outOfStock, searches: o.searches })),
    storesList: [...STORES.values()].map(({ serves, ...s }) => ({ ...s, pincodes: serves.length })),
  };
}

export async function cityDetail(range: DateRange, city: string) {
  const [daily, queries, products, pincodes] = await Promise.all([
    trend("city", range, { city }),
    topQueries(range.days, { city }, "searches", 20),
    topProducts(range.days, { city }, 20),
    StatsDailyModel.aggregate([{ $match: { kind: "pincode", day: { $in: range.days }, city } }, { $group: { _id: "$pincode", area: { $last: "$area" }, ...sums(["searches", "clicks", "unserviceable"]) } }, { $sort: { searches: -1 } }]),
  ]);
  return { city, trend: daily, topQueries: queries, topProducts: products, pincodes };
}

/** Searches per minute, last 60 minutes */
export async function live(): Promise<Array<{ minute: string; searches: number }>> {
  const now = Math.floor(Date.now() / 60_000);
  const minutes = Array.from({ length: 60 }, (_, i) => now - 59 + i);
  const values = redisClient.isReady ? await redisClient.mGet(minutes.map((m) => `live:${m}`)).catch(() => []) : [];
  return minutes.map((m, i) => ({ minute: new Date(m * 60_000).toISOString(), searches: Number(values[i] ?? 0) }));
}

export async function suggestionsList(filter: { status?: string; q?: string; page: number; limit: number }) {
  const match: Record<string, unknown> = {};
  if (filter.status) match.status = filter.status;
  if (filter.q) match.q = { $regex: escapeRegex(filter.q.toLowerCase()) };
  const [rows, total] = await Promise.all([
    TagSuggestionModel.find(match)
      .sort({ lastSeen: -1 })
      .skip((filter.page - 1) * filter.limit)
      .limit(filter.limit)
      .lean(),
    TagSuggestionModel.countDocuments(match),
  ]);
  return { rows: rows.map((r) => ({ ...r, ctr: ratio(r.clicks, r.searches) })), total, page: filter.page, limit: filter.limit };
}

/**
 * Shop's empty search box: categories whose products got the most clicks and adds (adds count double).
 * Catalog categories only, never a shopper's typed text: other people's searches are private.
 */
export async function trendingCategories(city: string | undefined, days: string[], limit = 6): Promise<string[]> {
  const rows = await StatsDailyModel.aggregate<{ _id: string }>([
    { $match: { kind: city ? "product_city" : "product", day: { $in: days }, ...(city ? { city } : {}), category: { $type: "string" } } },
    { $group: { _id: "$category", score: { $sum: { $add: [{ $ifNull: ["$clicks", 0] }, { $multiply: [{ $ifNull: ["$adds", 0] }, 2] }] } } } },
    { $match: { score: { $gt: 0 } } },
    { $sort: { score: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => r._id);
}
