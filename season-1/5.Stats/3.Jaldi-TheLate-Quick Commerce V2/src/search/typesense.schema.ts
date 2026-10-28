// Typesense collections. The app always searches the alias `products`; pnpm reindex builds a new
// collection and moves the alias, so a reindex or an embedding-model switch never takes search down.
import { ai } from "../ai/index.js";
import { flattenTags } from "../ai/tagging/tag.types.js";
import { logger } from "../bootstrap/logger.js";
import { typesense, tsNames } from "../bootstrap/typesense.js";
import type { Product } from "../features/products/products.types.js";
import { upsertSynonyms } from "./synonyms.js";

export interface ProductDoc {
  id: string;
  name: string;
  brand: string;
  category: string;
  size: string;
  size_qty?: number;
  size_unit?: string;
  price: number;
  mrp: number;
  icon: string;
  tags: string[];
  typos: string[];
  suggested_tags: string[];
  store_ids: string[];
  popularity: number;
  embedding?: number[];
  updated_at: number;
}

export interface ActiveProducts {
  collection: string;
  /** embedding model the collection's vectors came from (collection metadata) */
  embedModel: string | null;
  dims: number | null;
}

export const isNotFound = (err: unknown): boolean => (err as { httpStatus?: number })?.httpStatus === 404;

const productFields = (dims: number) => [
  { name: "name", type: "string" },
  { name: "brand", type: "string", facet: true },
  { name: "category", type: "string", facet: true },
  { name: "size", type: "string", index: false, optional: true },
  { name: "size_qty", type: "float", optional: true },
  { name: "size_unit", type: "string", facet: true, optional: true },
  { name: "price", type: "float" },
  { name: "mrp", type: "float" },
  { name: "icon", type: "string", index: false, optional: true },
  { name: "tags", type: "string[]" },
  { name: "typos", type: "string[]", optional: true },
  // AI suggested tags confirmed by real clicks: searched, with the lowest weight
  { name: "suggested_tags", type: "string[]", optional: true },
  { name: "store_ids", type: "string[]", facet: true },
  { name: "popularity", type: "int32" },
  { name: "embedding", type: "float[]", num_dim: dims, optional: true },
  { name: "updated_at", type: "int64" },
];

const stamp = (d: Date): string => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

export const newProductsCollectionName = (dims: number, now = new Date()): string =>
  `${tsNames.productsCollectionPrefix}${slug(ai.embedModelId())}__${dims}__${stamp(now)}`;

export async function createProductsCollection(name: string, dims: number): Promise<void> {
  await upsertSynonyms();
  await typesense.collections().create({
    name,
    fields: productFields(dims),
    default_sorting_field: "popularity",
    synonym_sets: [tsNames.synonymSet],
    metadata: { embedModel: ai.embedModelId(), dims, createdAt: new Date().toISOString() },
  } as never);
}

let cache: { value: ActiveProducts | null; at: number } | null = null;
const CACHE_MS = 30_000;

/** The collection the alias points at, or null before the first reindex. Cached 30 s. */
export async function activeProductsCollection(force = false): Promise<ActiveProducts | null> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: ActiveProducts | null = null;
  try {
    const alias = await typesense.aliases(tsNames.productsAlias).retrieve();
    const col = (await typesense.collections(alias.collection_name).retrieve()) as unknown as {
      metadata?: { embedModel?: string; dims?: number };
      fields?: Array<{ name: string; num_dim?: number }>;
    };
    value = {
      collection: alias.collection_name,
      embedModel: col.metadata?.embedModel ?? null,
      dims: col.metadata?.dims ?? col.fields?.find((f) => f.name === "embedding")?.num_dim ?? null,
    };
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  cache = { value, at: Date.now() };
  return value;
}

/** Live adds must work before the first seed: create an empty collection + alias if there is none. */
export async function ensureProductsCollection(): Promise<ActiveProducts> {
  const active = await activeProductsCollection(true);
  if (active) return active;
  const dims = await ai.embedDims();
  const name = newProductsCollectionName(dims);
  await createProductsCollection(name, dims);
  await typesense.aliases().upsert(tsNames.productsAlias, { collection_name: name });
  logger.info(`Typesense: created ${name}, alias ${tsNames.productsAlias} points at it`);
  return (await activeProductsCollection(true))!;
}

const round = (v: number[]): number[] => v.map((x) => Math.round(x * 1e5) / 1e5);

/** Mongo product -> Typesense document. The vector is left out if it came from another model (other size). */
export const toProductDoc = (p: Product, vector: number[] | undefined, dims: number | null): ProductDoc => ({
  id: String(p._id),
  name: p.name,
  brand: p.brand,
  category: p.category,
  size: p.size,
  ...(p.sizeQty != null ? { size_qty: p.sizeQty } : {}),
  ...(p.sizeUnit ? { size_unit: p.sizeUnit } : {}),
  price: p.price,
  mrp: p.mrp,
  icon: p.icon,
  tags: flattenTags(p.tags),
  typos: p.tags?.typos ?? [],
  suggested_tags: p.suggestedTags ?? [],
  store_ids: p.storeIds,
  popularity: Math.round(p.popularity ?? 0),
  ...(vector && dims && vector.length === dims ? { embedding: round(vector) } : {}),
  updated_at: Math.floor(new Date(p.updatedAt ?? Date.now()).getTime() / 1000),
});

/** Import documents (upsert by default). Typesense reports per-document errors instead of failing the whole batch. */
export async function importDocs(
  collection: string,
  docs: object[],
  action: "upsert" | "update" | "emplace" = "upsert",
): Promise<{ ok: number; failed: number; firstError?: string }> {
  if (!docs.length) return { ok: 0, failed: 0 };
  let results: Array<{ success: boolean; error?: string }>;
  try {
    results = (await typesense.collections(collection).documents().import(docs as never, { action })) as never;
  } catch (err) {
    const partial = (err as { importResults?: Array<{ success: boolean; error?: string }> }).importResults;
    if (!partial) throw err;
    results = partial;
  }
  const failed = results.filter((r) => !r.success);
  return { ok: results.length - failed.length, failed: failed.length, firstError: failed[0]?.error };
}

/** One collection per vector size for the searched-queries list ("log ye bhi search karte hain"). */
export async function ensureQueriesCollection(dims: number): Promise<string> {
  const name = tsNames.queriesCollection(dims);
  try {
    await typesense.collections(name).retrieve();
  } catch (err) {
    if (!isNotFound(err)) throw err;
    await typesense.collections().create({
      name,
      fields: [
        { name: "q", type: "string" },
        { name: "script", type: "string", facet: true },
        { name: "count", type: "int32" },
        { name: "last_seen", type: "int64" },
        { name: "embedding", type: "float[]", num_dim: dims, optional: true },
      ],
      default_sorting_field: "count",
    } as never);
  }
  return name;
}
