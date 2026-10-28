import type { FastifyReply, FastifyRequest } from "fastify";
import { Types } from "mongoose";
import {
  generateTags,
  ruleTags,
  tagsForName,
} from "../../ai/tagging/tag-engine.js";
import type { TagSet } from "../../ai/tagging/tag.types.js";
import { TOPICS, sendEvent } from "../../bootstrap/kafka.js";
import { AISLES, CATEGORIES, categoryIcon } from "../../catalog/index.js";
import { parseSize } from "../../catalog/size.js";
import { STORE_IDS } from "../../locations/locations.service.js";
import { httpError } from "../../shared/error.js";
import {
  buildCursorFilter,
  buildNextCursor,
  parseLimit,
} from "../../shared/pagination.js";
import { parse } from "../../shared/validate.js";
import { ProductModel } from "./products.model.js";
import type { IngestMessage, ProductFields } from "./products.types.js";
import {
  createProductSchema,
  previewTagsSchema,
  updateProductSchema,
} from "./products.validation.js";

const idOf = (req: FastifyRequest): string => {
  const id = (req.params as { id: string }).id;
  if (!Types.ObjectId.isValid(id)) throw httpError(400, "Invalid product id");
  return id;
};

// GET /products?category=&cursor=&limit=  (cursor pagination, newest ids last)
export const list = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const limit = parseLimit(query.limit);
  const filter: Record<string, unknown> = {
    ...buildCursorFilter(query.cursor),
  };
  if (typeof query.category === "string" && query.category)
    filter.category = query.category;
  const items = await ProductModel.find(filter)
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  await reply.send({ items, nextCursor: buildNextCursor(items, limit) });
};

export const getById = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const product = await ProductModel.findById(idOf(req)).lean();
  if (!product) throw httpError(404, "Product not found");
  await reply.send(product);
};

/** Aisles and categories for the shop chips and the admin's category dropdown */
export const categories = async (
  _req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  await reply.send({ aisles: AISLES, categories: Object.values(CATEGORIES) });
};

const at = (): string => new Date().toISOString();

// POST /products -> Kafka products.ingest -> 202. The ingest worker writes Mongo, enrich makes tags + vector.
export const create = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const body = parse(createProductSchema, req.body);
  const size = parseSize(body.size);
  const product: ProductFields = {
    name: body.name,
    brand: body.brand,
    category: body.category,
    size: body.size,
    sizeQty: size?.qty ?? null,
    sizeUnit: size?.unit ?? null,
    price: body.price,
    mrp: Math.max(body.mrp ?? body.price, body.price),
    icon: body.icon ?? categoryIcon(body.category),
    storeIds: body.storeIds?.length ? body.storeIds : STORE_IDS,
  };
  const id = new Types.ObjectId().toHexString();
  // admin tags count only for the title they were made for; the worker re-tags otherwise
  const message: IngestMessage = {
    op: "create",
    id,
    product,
    ...(body.tags
      ? { tags: body.tags, tagsFor: body.tagsFor ?? tagsForName(body.name) }
      : {}),
    at: at(),
  };
  await sendEvent(TOPICS.productsIngest, id, message);
  await reply.code(202).send({ id, status: "queued" });
};

export const update = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const id = idOf(req);
  const { tags, tagsFor, ...rest } = parse(
    updateProductSchema,
    req.body,
  ) as Partial<ProductFields> & { tags?: TagSet; tagsFor?: string };
  if (!(await ProductModel.exists({ _id: id })))
    throw httpError(404, "Product not found");
  const changes: Partial<ProductFields> = rest;
  if (changes.size !== undefined) {
    const size = parseSize(changes.size);
    changes.sizeQty = size?.qty ?? null;
    changes.sizeUnit = size?.unit ?? null;
  }
  const message: IngestMessage = {
    op: "update",
    id,
    changes,
    ...(tags ? { tags, tagsFor } : {}),
    at: at(),
  };
  await sendEvent(TOPICS.productsIngest, id, message);
  await reply.code(202).send({ id, status: "queued" });
};

export const remove = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const id = idOf(req);
  await sendEvent(TOPICS.productsIngest, id, {
    op: "delete",
    id,
    at: at(),
  } satisfies IngestMessage);
  await reply.code(202).send({ id, status: "queued" });
};

// POST /products/preview-tags  { name, brand?, category?, mode: "rules" | "full" }. Saves nothing.
export const previewTags = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const body = parse(previewTagsSchema, req.body);
  const input = {
    name: body.name,
    brand: body.brand,
    category:
      body.category && body.category in CATEGORIES ? body.category : null,
  };
  const result =
    body.mode === "rules" ? ruleTags(input) : await generateTags(input);
  await reply.send({ ...result, ms: Math.round(result.ms) });
};
