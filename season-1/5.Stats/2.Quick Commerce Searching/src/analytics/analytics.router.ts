import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import { z } from "zod";
import { CITIES } from "../locations/locations.service.js";
import { requireAdmin } from "../shared/admin-auth.js";
import { resolveRange } from "../shared/date-range.js";
import { httpError } from "../shared/error.js";
import { normalizeQuery } from "../shared/text.js";
import { parse } from "../shared/validate.js";
import { TagSuggestionModel } from "./analytics.models.js";
import * as q from "./analytics.queries.js";
import { activate, reject } from "./suggestions.js";

const CITY_NAMES = new Set(CITIES.map((c) => c.name));

const common = z.object({
  range: z.enum(["today", "yesterday", "7d", "30d", "month", "custom"]).default("7d"),
  from: z.string().optional(),
  to: z.string().optional(),
  city: z
    .string()
    .optional()
    .refine((c) => !c || CITY_NAMES.has(c), "unknown city"),
});

const table = common.extend({
  sort: z.string().max(20).optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(80).optional(),
});

const scopeOf = (req: FastifyRequest) => {
  const query = parse(common, req.query);
  return { range: resolveRange(query), scope: { city: query.city } };
};

const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", requireAdmin);

  /** KPIs, trend, language split, top searches / products, zero results */
  app.get("/overview", async (req) => {
    const { range, scope } = scopeOf(req);
    return q.overview(range, scope);
  });

  app.get("/searches", async (req) => {
    const query = parse(table.extend({ script: z.string().max(20).optional(), zeroOnly: z.enum(["true", "false"]).optional() }), req.query);
    return q.searchesTable(resolveRange(query), { city: query.city }, { ...query, zeroOnly: query.zeroOnly === "true" });
  });

  /** ?q=doodh (any script) */
  app.get("/searches/detail", async (req) => {
    const query = parse(common.extend({ q: z.string().min(1).max(120) }), req.query);
    return q.searchDetail(resolveRange(query), { city: query.city }, normalizeQuery(query.q));
  });

  app.get("/products", async (req) => {
    const query = parse(table.extend({ category: z.string().max(40).optional() }), req.query);
    return q.productsTable(resolveRange(query), { city: query.city }, query);
  });

  app.get("/products/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    if (!Types.ObjectId.isValid(id)) throw httpError(400, "Invalid product id");
    const { range, scope } = scopeOf(req);
    const detail = await q.productDetail(range, scope, id);
    if (!detail) throw httpError(404, "Product not found");
    return detail;
  });

  /** Demand map: cities, pincodes, stores, "no store here" and "out of stock" demand */
  app.get("/locations", async (req) => q.locations(scopeOf(req).range));

  app.get("/locations/city", async (req) => {
    const query = parse(common.extend({ name: z.string().refine((c) => CITY_NAMES.has(c), "unknown city") }), req.query);
    return q.cityDetail(resolveRange(query), query.name);
  });

  /** Searches per minute, last 60 minutes */
  app.get("/live", async () => q.live());

  app.get("/suggestions", async (req) => {
    const query = parse(
      z.object({
        status: z.enum(["candidate", "active", "rejected"]).optional(),
        q: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }),
      req.query,
    );
    return q.suggestionsList(query);
  });

  const suggestionById = async (req: FastifyRequest) => {
    const id = (req.params as { id: string }).id;
    if (!Types.ObjectId.isValid(id)) throw httpError(400, "Invalid suggestion id");
    const doc = await TagSuggestionModel.findById(id).lean();
    if (!doc) throw httpError(404, "Suggestion not found");
    return doc;
  };

  /** Admin says yes: live at once, whatever the clicks say */
  app.post("/suggestions/:id/approve", async (req) => {
    const doc = await suggestionById(req);
    await activate(doc, "admin");
    return { id: doc._id, status: "active" };
  });

  app.post("/suggestions/:id/reject", async (req) => {
    const doc = await suggestionById(req);
    await reject(doc, "admin");
    return { id: doc._id, status: "rejected" };
  });
};

export default analyticsRoutes;
