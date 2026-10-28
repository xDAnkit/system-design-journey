import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { trendingCategories } from "../analytics/analytics.queries.js";
import { eventLocation, publishEvent, sessionOf } from "../analytics/events.publish.js";
import { CATEGORIES } from "../catalog/index.js";
import { resolveRange } from "../shared/date-range.js";
import { shuffle } from "../shared/pool.js";
import { normalizeQuery } from "../shared/text.js";
import { parse } from "../shared/validate.js";
import { popularProducts, searchProducts, suggestProducts } from "./search.service.js";
import type { FilterKind } from "./query-parser.js";

const searchQuery = z.object({
  q: z.string().max(120).default(""),
  pincode: z.string().regex(/^\d{6}$/).optional(),
  storeId: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(5).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
  /** filter chips the shopper removed: "brand,price" */
  ignore: z.string().max(40).optional(),
  sessionId: z.string().max(64).optional(),
});

const IGNORABLE = new Set<FilterKind>(["brand", "price", "size"]);

// GET /search?q=&pincode=&storeId=&category=&page=&perPage=&ignore=
export const search = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const query = parse(searchQuery, req.query);
  const sessionId = sessionOf(req, query.sessionId);
  const { serviceable, ...location } = eventLocation(query);
  const ts = new Date().toISOString();

  // a place no dark store serves: no results, but the demand is recorded (where to open the next store)
  if (serviceable === false) {
    if (query.q.trim()) publishEvent({ type: "unserviceable", ts, sessionId, q: query.q.trim(), qNorm: normalizeQuery(query.q), ...location });
    await reply.send({ unserviceable: true, location, q: query.q, hits: [], total: 0 });
    return;
  }

  const ignore = (query.ignore ?? "").split(",").filter((k): k is FilterKind => IGNORABLE.has(k as FilterKind));
  const result = await searchProducts({ q: query.q, storeId: location.storeId, category: query.category, page: query.page, perPage: query.perPage, ignore });

  // one search event per search (page 1); later pages are the same search
  if (result.q && query.page === 1) {
    publishEvent({
      type: "search",
      ts,
      sessionId,
      q: result.q,
      qNorm: result.qNorm,
      script: result.script,
      results: result.total,
      latencyMs: result.tookMs,
      shown: result.hits.slice(0, 20).map((h) => h.id),
      vectorOnly: result.hits.slice(0, 5).filter((h) => h.matchedBy === "vector").map((h) => h.id),
      outOfStock: result.outOfStock,
      ...location,
    });
  }
  await reply.send(result);
};

const suggestQuery = z.object({ q: z.string().max(60).default(""), storeId: z.string().max(40).optional(), pincode: z.string().regex(/^\d{6}$/).optional() });

// GET /search/suggest?q=do&pincode=   keyword prefix only, for the dropdown while typing
export const suggest = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const query = parse(suggestQuery, req.query);
  const { storeId } = eventLocation(query);
  await reply.send({ products: await suggestProducts(query.q, storeId) });
};

const popularQuery = z.object({ pincode: z.string().regex(/^\d{6}$/).optional() });

const TRENDING = 6;
// core categories are in every store; random ones stand in until clicks tell what is trending
const CORE_CATEGORIES = Object.values(CATEGORIES)
  .filter((c) => c.core)
  .map((c) => c.key);

// GET /search/popular?pincode=   empty search box: trending categories in the city + popular products in the store.
// Never other shoppers' searches: those are private ("periods pad" is nobody else's business).
export const popular = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const { city, storeId, serviceable } = eventLocation(parse(popularQuery, req.query));
  const [products, top] = await Promise.all([
    popularProducts(serviceable === false ? undefined : storeId),
    // ponytail: aggregates 7 days of counters per call; cache it in Redis if this route gets hot
    trendingCategories(city, resolveRange({ range: "7d" }).days, TRENDING).catch((): string[] => []),
  ]);
  const fill = shuffle(CORE_CATEGORIES.filter((k) => !top.includes(k))).slice(0, TRENDING - top.length);
  await reply.send({ products, categories: [...top.map((key) => ({ key, real: true })), ...fill.map((key) => ({ key, real: false }))] });
};
