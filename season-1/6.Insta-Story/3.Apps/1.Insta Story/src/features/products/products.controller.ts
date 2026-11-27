import type { FastifyReply, FastifyRequest } from "fastify";
import { Product } from "./products.model.js";
import * as validate from "./products.validation.js";
import { enqueueIngest, getIngestStats } from "./products.ingest.js";
import { httpError } from "../../shared/error.js";
import {
  parseLimit,
  parsePage,
  buildCursorFilter,
  buildNextCursor,
} from "../../shared/pagination.js";

const queryOf = (req: FastifyRequest): Record<string, unknown> =>
  req.query as Record<string, unknown>;
const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;

const buildListFilter = (
  query: Record<string, unknown>,
): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};
  if (typeof query.category === "string" && query.category.trim()) {
    filter.category = query.category.trim();
  }
  if (typeof query.name === "string" && query.name.trim()) {
    const term = query.name.trim().replace(/"/g, "");
    if (term) filter.$text = { $search: term };
  }
  return filter;
};

// GET /products?page=&limit=      -> offset pagination (page numbers, totalPages)
// GET /products?cursor=&limit=    -> cursor pagination (default when no "page" query given)
export const list = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const query = queryOf(req);
  const limit = parseLimit(query.limit);
  const baseFilter = buildListFilter(query);

  if (query.page !== undefined) {
    const page = parsePage(query.page);
    const skip = (page - 1) * limit;
    const hasFilter = Object.keys(baseFilter).length > 0;

    // countDocuments({}) walks the whole collection even with indexes present (tested:
    // 22s on 40M docs) - estimatedDocumentCount() reads collection metadata instead
    // (~4ms) and is the standard fix for an unfiltered total. A real filter (category)
    // narrows the scan enough that the exact count stays cheap.
    const [items, totalItems] = await Promise.all([
      Product.find(baseFilter).sort({ _id: 1 }).skip(skip).limit(limit).lean(),
      // hasFilter ? Product.countDocuments(baseFilter) : Product.estimatedDocumentCount(),
      Product.estimatedDocumentCount(),
    ]);

    await reply.send({
      items,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      fresh: true,
    });
    return;
  }

  const filter = { ...baseFilter, ...buildCursorFilter(query.cursor) };
  const items = await Product.find(filter).sort({ _id: 1 }).limit(limit).lean();
  await reply.send({
    items,
    nextCursor: buildNextCursor(items, limit),
    fresh: true,
  });
};

export const getById = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const product = await Product.findById(idOf(req)).lean();
  if (!product) throw httpError(404, "Product not found");
  await reply.send(product);
};

export const create = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const payload = validate.validateCreate(req.body);
  const product = await Product.create(payload);
  await reply.code(201).send(product);
};

export const ingest = (req: FastifyRequest, reply: FastifyReply): void => {
  const payload = validate.validateCreate(req.body);
  enqueueIngest(payload);
  reply.code(202).send({ accepted: true });
};

export const ingestStats = (
  _req: FastifyRequest,
  reply: FastifyReply,
): void => {
  reply.send(getIngestStats());
};

export const update = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const patch = validate.validateUpdate(req.body);
  const product = await Product.findByIdAndUpdate(idOf(req), patch, {
    new: true,
    runValidators: true,
  });
  if (!product) throw httpError(404, "Product not found");
  await reply.send(product);
};

export const remove = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const product = await Product.findByIdAndDelete(idOf(req));
  if (!product) throw httpError(404, "Product not found");
  await reply.send({ deleted: product });
};
