// products.enrich -> tags (KB rules + LLM) + vector (bge-m3) -> Mongo -> products.index.
// Fresh admin tags (made for the current title in the preview) skip the LLM. 3 tries, then the DLQ.
import { generateTags, tagsForName } from "../ai/tagging/tag-engine.js";
import { GROUPS, TOPICS, sendEvents, startConsumer } from "../bootstrap/kafka.js";
import { logger } from "../bootstrap/logger.js";
import { ProductModel } from "../features/products/products.model.js";
import type { EnrichDlqMessage, EnrichMessage } from "../features/products/products.types.js";
import { getOrCreateEmbeddings, productEmbedText } from "../search/embeddings.js";
import { mapLimit, sleep } from "../shared/pool.js";

const MAX_ATTEMPTS = 3;
// Ollama runs one model call at a time per model, more lanes only queue up there
const LANES = 2;

async function enrichOne(id: string): Promise<boolean> {
  const p = await ProductModel.findById(id).lean();
  if (!p) return false;
  let { tags, tagsSource, tagsFor } = p;
  const freshAdminTags = p.tagsSource === "admin" && p.tagsFor === tagsForName(p.name);
  if (!freshAdminTags) {
    const r = await generateTags({ name: p.name, brand: p.brand, category: p.category });
    tags = r.tags;
    tagsSource = r.llmUsed ? "kb+ai" : "kb";
    tagsFor = r.tagsFor;
  }
  const text = productEmbedText(p.name, tags);
  const embedding = (await getOrCreateEmbeddings([text])).get(text)!;
  await ProductModel.updateOne({ _id: id }, { $set: { tags, tagsSource, tagsFor, embedKey: embedding.key, status: "enriched", error: null } });
  return true;
}

async function handle(messages: EnrichMessage[]): Promise<void> {
  const ids = [...new Set(messages.map((m) => m.id))];
  const indexed: string[] = [];
  const dead: EnrichDlqMessage[] = [];

  await mapLimit(ids, LANES, async (id) => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (await enrichOne(id)) indexed.push(id);
        return;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(1000 * attempt);
          continue;
        }
        logger.error(`enrich worker: ${id} failed ${MAX_ATTEMPTS} times, sent to the DLQ (${error})`);
        await ProductModel.updateOne({ _id: id }, { $set: { status: "failed", error: error.slice(0, 300) } });
        dead.push({ id, error, attempts: MAX_ATTEMPTS, at: new Date().toISOString() });
      }
    }
  });

  await sendEvents(TOPICS.productsIndex, indexed.map((id) => ({ key: id, value: { id } })));
  await sendEvents(TOPICS.productsEnrichDlq, dead.map((d) => ({ key: d.id, value: d })));
}

// small batches: one product can take a few seconds of LLM time
export const startEnrichWorker = (): Promise<void> => startConsumer<EnrichMessage>(GROUPS.enrich, TOPICS.productsEnrich, "enrich worker", handle, { maxBatch: 8 });
