// products.index -> Typesense (through the `products` alias). Batches of up to 1000 in one import.
import { ai } from "../ai/index.js";
import { GROUPS, TOPICS, startConsumer } from "../bootstrap/kafka.js";
import { logger } from "../bootstrap/logger.js";
import { typesense } from "../bootstrap/typesense.js";
import { ProductModel } from "../features/products/products.model.js";
import type { IndexMessage } from "../features/products/products.types.js";
import { vectorsByKeys } from "../search/embeddings.js";
import { ensureProductsCollection, importDocs, isNotFound, toProductDoc } from "../search/typesense.schema.js";

let warnedModel = "";

async function handle(messages: IndexMessage[]): Promise<void> {
  const deletes = new Set(messages.filter((m) => m.delete).map((m) => m.id));
  const upserts = [...new Set(messages.filter((m) => !m.delete).map((m) => m.id))].filter((id) => !deletes.has(id));
  const active = await ensureProductsCollection();

  // vectors from another model have another size: index without them until pnpm reindex
  const sameModel = active.embedModel === ai.embedModelId();
  if (!sameModel && warnedModel !== active.embedModel) {
    warnedModel = active.embedModel ?? "";
    logger.warn(`index worker: ${active.collection} was built with ${active.embedModel}, .env now says ${ai.embedModelId()}. Products go in without vectors until you run pnpm reindex`);
  }

  if (upserts.length) {
    const products = await ProductModel.find({ _id: { $in: upserts } }).lean();
    const vectors = sameModel ? await vectorsByKeys(products.map((p) => p.embedKey ?? "")) : new Map<string, number[]>();
    const docs = products.map((p) => toProductDoc(p, p.embedKey ? vectors.get(p.embedKey) : undefined, active.dims));
    const res = await importDocs(active.collection, docs);
    if (res.failed) logger.error(`index worker: ${res.failed} of ${docs.length} documents failed (${res.firstError})`);
    await ProductModel.updateMany({ _id: { $in: products.map((p) => p._id) }, status: "enriched" }, { $set: { status: "indexed" } });
  }

  for (const id of deletes) {
    await typesense
      .collections(active.collection)
      .documents(id)
      .delete()
      .catch((err: unknown) => {
        if (!isNotFound(err)) throw err;
      });
  }
}

export const startIndexWorker = (): Promise<void> => startConsumer<IndexMessage>(GROUPS.index, TOPICS.productsIndex, "index worker", handle, { maxBatch: 1000 });
