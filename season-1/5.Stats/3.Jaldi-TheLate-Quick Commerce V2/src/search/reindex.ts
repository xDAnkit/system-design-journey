/**
 * pnpm reindex                  Mongo -> new Typesense collection -> move the `products` alias -> drop the old one
 * pnpm reindex -- --reembed     also re-embed every product text (after changing AI_EMBED_MODEL this happens
 *                               anyway for vectors of the old model; --reembed forces all)
 * pnpm reindex -- --keep-old    keep the previous collection (it holds RAM)
 *
 * Search keeps working the whole time: it reads the old collection until the alias moves.
 */
import "../bootstrap/mongo-host-dns.js";
import mongoose from "mongoose";
import { ai } from "../ai/index.js";
import { connectDatabase, disconnectDatabase } from "../bootstrap/database.js";
import { typesense, tsNames } from "../bootstrap/typesense.js";
import { embedTextFor } from "../catalog/embed-text.js";
import { ProductModel } from "../features/products/products.model.js";
import type { Product } from "../features/products/products.types.js";
import { assertSafeDatabase, confirm, hasFlag, intFlag } from "../shared/cli.js";
import { getOrCreateEmbeddings, vectorsByKeys } from "./embeddings.js";
import { activeProductsCollection, createProductsCollection, importDocs, newProductsCollectionName, toProductDoc } from "./typesense.schema.js";

const BATCH = intFlag("batch", 2000);
const REEMBED = hasFlag("reembed");

const main = async (): Promise<void> => {
  await connectDatabase();
  assertSafeDatabase(mongoose.connection.name);
  await typesense.health.retrieve().catch(() => {
    throw new Error("Typesense is not reachable. Start it with: pnpm typesense:up");
  });

  const dims = await ai.embedDims();
  const model = ai.embedModelId();
  const total = await ProductModel.estimatedDocumentCount();
  const old = await activeProductsCollection(true);
  const name = newProductsCollectionName(dims);

  console.log(`Plan: ${total.toLocaleString("en-IN")} products from ${mongoose.connection.name}.products -> Typesense ${name}`);
  console.log(`      vectors: ${model} (${dims} dims)${REEMBED ? ", re-embed all" : ""}`);
  console.log(`      alias ${tsNames.productsAlias}: ${old ? old.collection : "(none)"} -> ${name}${old && !hasFlag("keep-old") ? `, then drop ${old.collection}` : ""}`);
  if (!(await confirm("Go ahead?"))) return;

  const started = performance.now();
  await createProductsCollection(name, dims);

  let done = 0;
  let failed = 0;
  let reembedded = 0;
  let firstError: string | undefined;
  const flush = async (batch: Product[]): Promise<void> => {
    // vectors of the current model are reused, anything else is embedded now (shared texts once)
    const stale = batch.filter((p) => REEMBED || !p.embedKey || !p.embedKey.startsWith(`${model}:`));
    if (stale.length) {
      const texts = stale.map(embedTextFor);
      const fresh = await getOrCreateEmbeddings(texts);
      const updates = stale.map((p, i) => {
        p.embedKey = fresh.get(texts[i])!.key;
        return { updateOne: { filter: { _id: p._id }, update: { $set: { embedKey: p.embedKey } } } };
      });
      await ProductModel.bulkWrite(updates, { ordered: false });
      reembedded += stale.length;
    }
    const vectors = await vectorsByKeys(batch.map((p) => p.embedKey ?? ""));
    const res = await importDocs(name, batch.map((p) => toProductDoc(p, p.embedKey ? vectors.get(p.embedKey) : undefined, dims)));
    done += res.ok;
    failed += res.failed;
    firstError ??= res.firstError;
    console.log(`  ${(done + failed).toLocaleString("en-IN")} / ${total.toLocaleString("en-IN")}`);
  };

  let batch: Product[] = [];
  for await (const p of ProductModel.find({}).lean<Product>().cursor({ batchSize: BATCH })) {
    batch.push(p);
    if (batch.length >= BATCH) {
      await flush(batch);
      batch = [];
    }
  }
  if (batch.length) await flush(batch);

  await typesense.aliases().upsert(tsNames.productsAlias, { collection_name: name });
  await ProductModel.updateMany({ status: "enriched" }, { $set: { status: "indexed" } });
  if (old && old.collection !== name && !hasFlag("keep-old")) await typesense.collections(old.collection).delete();

  const secs = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`done in ${secs} s: ${done.toLocaleString("en-IN")} indexed, ${failed} failed, ${reembedded} re-embedded. ${tsNames.productsAlias} -> ${name}`);
  if (failed) console.log(`first error: ${firstError}`);
};

main()
  .catch((err: unknown) => {
    console.error(`reindex failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase().catch(() => {}));
