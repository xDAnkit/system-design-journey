// products.ingest -> Mongo. New or renamed products go on to enrich (tags + vector); price / stock
// changes go straight to index, no AI.
import { Types } from "mongoose";
import { emptyTagSet } from "../ai/tagging/tag.types.js";
import { GROUPS, TOPICS, sendEvents, startConsumer } from "../bootstrap/kafka.js";
import { ProductModel } from "../features/products/products.model.js";
import type { IndexMessage, IngestMessage, ProductFields } from "../features/products/products.types.js";

// a new name, brand or category means the product is something else: new tags, new vector
const MEANING_FIELDS: Array<keyof ProductFields> = ["name", "brand", "category"];

async function handle(messages: IngestMessage[]): Promise<void> {
  const enrich: string[] = [];
  const index: IndexMessage[] = [];

  // creates in one bulk write. Upsert + $setOnInsert: a replayed message changes nothing.
  const creates = messages.filter((m): m is Extract<IngestMessage, { op: "create" }> => m.op === "create");
  if (creates.length) {
    await ProductModel.bulkWrite(
      creates.map((m) => ({
        updateOne: {
          filter: { _id: new Types.ObjectId(m.id) },
          update: {
            $setOnInsert: {
              ...m.product,
              baseKey: null,
              tags: m.tags ?? emptyTagSet(),
              tagsSource: m.tags ? "admin" : "kb",
              tagsFor: m.tags ? (m.tagsFor ?? "") : "",
              suggestedTags: [],
              embedKey: null,
              status: "pending",
              error: null,
              popularity: 0,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    enrich.push(...creates.map((m) => m.id));
  }

  for (const m of messages) {
    if (m.op === "update") {
      const before = await ProductModel.findById(m.id).lean();
      if (!before) continue;
      const set: Record<string, unknown> = { ...m.changes };
      const meaningChanged = MEANING_FIELDS.some((f) => m.changes[f] !== undefined && m.changes[f] !== before[f]);
      if (m.tags) Object.assign(set, { tags: m.tags, tagsSource: "admin", tagsFor: m.tagsFor ?? "" });
      if (meaningChanged || m.tags) set.status = "pending";
      await ProductModel.updateOne({ _id: m.id }, { $set: set });
      if (meaningChanged || m.tags) enrich.push(m.id);
      else index.push({ id: m.id });
    } else if (m.op === "delete") {
      await ProductModel.deleteOne({ _id: m.id });
      index.push({ id: m.id, delete: true });
    }
  }

  await sendEvents(TOPICS.productsEnrich, enrich.map((id) => ({ key: id, value: { id } })));
  await sendEvents(TOPICS.productsIndex, index.map((msg) => ({ key: msg.id, value: msg })));
}

export const startIngestWorker = (): Promise<void> => startConsumer<IngestMessage>(GROUPS.ingest, TOPICS.productsIngest, "ingest worker", handle, { maxBatch: 500 });
