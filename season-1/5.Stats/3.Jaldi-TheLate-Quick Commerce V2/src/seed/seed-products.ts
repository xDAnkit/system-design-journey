/**
 * pnpm seed:products                       asks before writing, 2 lakh products
 * pnpm seed:products -- --count=50000 --yes
 * pnpm seed:products -- --append            add more to a collection that already has products
 * pnpm seed:products -- --append --only="mosquito repellent" --count=24
 *                                           only that category's catalog items (key from GET /products/categories)
 *
 * Writes products + their vectors into the database of MONGO_URI (only a "jaldi..." database).
 * Tags come from the KB rules (no LLM, so it is fast). One vector per base item (~150 Ollama calls),
 * shared by all its products. Then run: pnpm reindex
 */
import "../bootstrap/mongo-host-dns.js";
import mongoose from "mongoose";
import { ai } from "../ai/index.js";
import { ruleTags, tagsForName } from "../ai/tagging/tag-engine.js";
import type { TagSet } from "../ai/tagging/tag.types.js";
import { connectDatabase, disconnectDatabase } from "../bootstrap/database.js";
import { ensureIndexes } from "../bootstrap/models.js";
import { BASE_ITEMS } from "../catalog/index.js";
import { baseItemEmbedText } from "../catalog/embed-text.js";
import { ProductModel } from "../features/products/products.model.js";
import { getOrCreateEmbeddings } from "../search/embeddings.js";
import { assertSafeDatabase, confirm, flag, hasFlag, intFlag } from "../shared/cli.js";
import { generateProducts, maxProducts, type GeneratedProduct } from "./catalog-generator.js";

const ONLY = flag("only");
const ITEMS = ONLY ? BASE_ITEMS.filter((item) => item.category === ONLY) : BASE_ITEMS;
const COUNT = intFlag("count", ONLY ? ITEMS.length * 3 : 200_000);
const BATCH = intFlag("batch", 5000);
const CONCURRENCY = 4;

const main = async (): Promise<void> => {
  if (!ITEMS.length) throw new Error(`no catalog items in category "${ONLY}"`);
  await connectDatabase();
  const db = mongoose.connection.name;
  assertSafeDatabase(db);

  const total = await ProductModel.estimatedDocumentCount();
  if (total > 0 && !hasFlag("append")) {
    console.log(`"${db}.products" already has ${total} products. Add --append to add more. Nothing was written.`);
    return;
  }
  // where this run goes on from: all seeded products, or only the --only category's
  const existing = ONLY ? await ProductModel.countDocuments({ baseKey: { $in: ITEMS.map((item) => item.id) } }) : total;
  if (existing + COUNT > maxProducts(ITEMS)) throw new Error(`these catalog items make at most ${maxProducts(ITEMS)} products, ${existing} are already there`);

  const scope = ONLY ? ` from the "${ONLY}" category (${ITEMS.length} catalog items, ${existing} of its products already there)` : "";
  console.log(`Plan: write ${COUNT.toLocaleString("en-IN")} products${scope} into ${db}.products (${total ? `${total} already there` : "empty"}),`);
  console.log(`      + ${ITEMS.length} vectors from ${ai.embedModelId()} into ${db}.embeddings.`);
  if (!(await confirm("Go ahead?"))) return;

  await ensureIndexes();

  // 1. one vector per base item
  const started = performance.now();
  const texts = ITEMS.map(baseItemEmbedText);
  const vectors = await getOrCreateEmbeddings(texts);
  const embedKeyOf = new Map(ITEMS.map((item, i) => [item.id, vectors.get(texts[i])!.key]));
  console.log(`vectors ready: ${ITEMS.length} base items in ${((performance.now() - started) / 1000).toFixed(1)} s`);

  // 2. products, tags cached per (base item, brand, variant): size, pack and edition don't change them
  const tagCache = new Map<string, TagSet>();
  const tagsOf = (tagText: string, brand: string, category: string, baseKey: string): TagSet => {
    const key = `${baseKey}|${tagText}`;
    let tags = tagCache.get(key);
    if (!tags) {
      tags = ruleTags({ name: tagText, brand, category }).tags;
      tagCache.set(key, tags);
    }
    return tags;
  };

  let written = 0;
  const insertBatch = async (batch: GeneratedProduct[]): Promise<void> => {
    const now = new Date();
    const docs = batch.map((p) => ({
      _id: new mongoose.Types.ObjectId(),
      name: p.name,
      brand: p.brand,
      category: p.category,
      baseKey: p.baseKey,
      size: p.size,
      sizeQty: p.sizeQty,
      sizeUnit: p.sizeUnit,
      price: p.price,
      mrp: p.mrp,
      icon: p.icon,
      storeIds: p.storeIds,
      tags: tagsOf(p.tagText, p.brand, p.category, p.baseKey),
      tagsSource: "kb",
      tagsFor: tagsForName(p.name),
      suggestedTags: [],
      embedKey: embedKeyOf.get(p.baseKey) ?? null,
      status: "enriched",
      error: null,
      popularity: p.popularity,
      createdAt: now,
      updatedAt: now,
    }));
    // raw driver insert: skips Mongoose document hydration, the main cost at lakhs of docs
    await ProductModel.collection.insertMany(docs, { ordered: false });
    written += docs.length;
    if (written % (BATCH * 10) === 0 || written === COUNT) console.log(`  ${written.toLocaleString("en-IN")} / ${COUNT.toLocaleString("en-IN")}`);
  };

  // stream: build a batch, insert it, at most CONCURRENCY inserts in flight, never all products in memory
  const inFlight = new Set<Promise<void>>();
  let failure: unknown = null;
  const launch = (batch: GeneratedProduct[]): void => {
    const job = insertBatch(batch)
      .catch((err: unknown) => {
        failure ??= err;
      })
      .finally(() => inFlight.delete(job));
    inFlight.add(job);
  };
  let current: GeneratedProduct[] = [];
  // --append goes on where the last run stopped: the generator is deterministic, so the first `existing` are already there.
  // ponytail: assumes every existing product came from this seed; products added by the admin shift it by that many.
  let skip = existing;
  for (const p of generateProducts(existing + COUNT, ITEMS)) {
    if (skip > 0) {
      skip--;
      continue;
    }
    current.push(p);
    if (current.length < BATCH) continue;
    if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
    if (failure) break;
    launch(current);
    current = [];
  }
  if (current.length && !failure) launch(current);
  await Promise.all(inFlight);
  if (failure) throw failure;

  console.log(`done: ${written.toLocaleString("en-IN")} products in ${((performance.now() - started) / 1000).toFixed(1)} s. Next: pnpm reindex`);
};

main()
  .catch((err: unknown) => {
    console.error(`seed failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase().catch(() => {}));
