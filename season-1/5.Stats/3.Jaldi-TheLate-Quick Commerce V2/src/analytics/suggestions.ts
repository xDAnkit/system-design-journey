/**
 * AI suggested tags. A search found a product only through its vector (no keyword hit):
 *   1. candidate  the (query, product) pair is saved, not used in search
 *   2. AI check   the LLM says if the product fits the query; "no" rejects it
 *   3. active     only when the admin approves it AND the query passes the safety gate (tag-guard.ts):
 *                 the query becomes a suggested tag on the product (own Typesense field, lowest weight)
 * Clicks and distinct shoppers are counted so the admin can sort by them, they never activate a tag.
 * A shopper's query is untrusted text (rules/scoped/content-safety.md).
 * A vector match is never trusted on its own: in the bake-off it put namkeen first for "bukhar hai".
 */
import { z } from "zod";
import { ai } from "../ai/index.js";
import { TOPICS, sendEvent } from "../bootstrap/kafka.js";
import { logger } from "../bootstrap/logger.js";
import { redisClient } from "../bootstrap/redis.js";
import { ProductModel } from "../features/products/products.model.js";
import { safeTags } from "../ai/tagging/tag-guard.js";
import { sha1 } from "../shared/text.js";
import { TagSuggestionModel, type TagSuggestionDoc } from "./analytics.models.js";
import type { Rollup, ProductMeta } from "./rollup.js";

const sessionsKey = (q: string, productId: string): string => `ts:uv:${sha1(`${q}|${productId}`)}`;
const SESSIONS_TTL_S = 90 * 24 * 3600;

/** Save new candidates and count searches / clicks on known pairs, then promote the ones that qualify. */
export async function recordSuggestions(r: Rollup, meta: Map<string, ProductMeta>): Promise<void> {
  const seen = [...r.seenPairs.values()].filter((p) => p.q.length >= 3);
  if (seen.length) {
    await TagSuggestionModel.bulkWrite(
      seen.map((p) => ({
        updateOne: {
          filter: { q: p.q, productId: p.productId },
          update: {
            $inc: { searches: p.searches },
            $max: { lastSeen: p.lastSeen },
            $setOnInsert: {
              qDisplay: p.qDisplay,
              productName: meta.get(p.productId)?.name ?? "",
              category: meta.get(p.productId)?.category ?? "",
              status: "candidate",
              aiCheck: "pending",
              clicks: 0,
              adds: 0,
              sessions: 0,
              activatedBy: null,
              activatedAt: null,
              rejectedBy: null,
              firstSeen: p.lastSeen,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  // clicks only count for pairs that exist: a click on a keyword match is not a suggestion
  const clicked = [...r.clickedPairs.values()];
  if (!clicked.length) return;
  await TagSuggestionModel.bulkWrite(
    clicked.map((p) => ({ updateOne: { filter: { q: p.q, productId: p.productId }, update: { $inc: { clicks: p.clicks, adds: p.adds } } } })),
    { ordered: false },
  );
  // distinct shoppers per pair: HyperLogLog, so one person clicking 50 times counts once
  if (redisClient.isReady) {
    const multi = redisClient.multi();
    for (const p of clicked) {
      const key = sessionsKey(p.q, p.productId);
      multi.pfAdd(key, [...p.sessions]);
      multi.expire(key, SESSIONS_TTL_S);
    }
    await multi.exec();
  }
  await promoteIfReady(clicked.map((p) => ({ q: p.q, productId: p.productId })));
}

/** Refresh the distinct-shopper count of AI-checked candidates. The admin sees it; nothing goes live here. */
export async function promoteIfReady(pairs: Array<{ q: string; productId: string }>): Promise<void> {
  for (const { q, productId } of pairs) {
    const doc = await TagSuggestionModel.findOne({ q, productId, status: "candidate", aiCheck: "yes" }).lean();
    if (!doc) continue;
    const sessions = redisClient.isReady ? await redisClient.pfCount(sessionsKey(q, productId)) : doc.sessions;
    await TagSuggestionModel.updateOne({ _id: doc._id }, { $set: { sessions } });
  }
}

type Suggestion = Pick<TagSuggestionDoc, "q" | "productId"> & { _id: unknown; productName?: string };

/** Admin approval. The query must pass the safety gate first; a dropped query is rejected for good. Returns false then. */
export async function activate(doc: Suggestion, by: "admin"): Promise<boolean> {
  const name = doc.productName || (await ProductModel.findById(doc.productId, { name: 1 }).lean())?.name || "";
  // throws when the gate cannot answer: the router turns it into an error, nothing goes live (fail closed)
  const ok = await safeTags(name, [doc.q]);
  if (!ok.size) {
    await reject(doc, "ai");
    logger.warn(`suggested tag "${doc.q}" -> ${doc.productId} blocked by the safety check`);
    return false;
  }
  await TagSuggestionModel.updateOne({ _id: doc._id }, { $set: { status: "active", activatedBy: by, activatedAt: new Date(), rejectedBy: null } });
  await ProductModel.updateOne({ _id: doc.productId }, { $addToSet: { suggestedTags: doc.q } });
  await sendEvent(TOPICS.productsIndex, doc.productId, { id: doc.productId });
  logger.info(`AI suggested tag live: "${doc.q}" -> ${doc.productId} (by ${by})`);
  return true;
}

export async function reject(doc: Suggestion, by: "ai" | "admin"): Promise<void> {
  await TagSuggestionModel.updateOne({ _id: doc._id }, { $set: { status: "rejected", rejectedBy: by } });
  const res = await ProductModel.updateOne({ _id: doc.productId }, { $pull: { suggestedTags: doc.q } });
  if (res.modifiedCount) await sendEvent(TOPICS.productsIndex, doc.productId, { id: doc.productId });
}

const checkSchema = z.object({ relevant: z.boolean(), reason: z.string() });
const CHECK_SYSTEM =
  "You review search results for an Indian quick-commerce grocery app. Shoppers type in English, Hinglish (Hindi in Roman letters) or Indian languages. Say if a shopper who typed the search would be happy to see the product. Give a short reason.";

/** One round of AI checks on the most searched pending candidates. Called on a timer by the analytics worker. */
export async function runAiChecks(limit = 3): Promise<number> {
  const pending = await TagSuggestionModel.find({ status: "candidate", aiCheck: "pending" }).sort({ searches: -1 }).limit(limit).lean();
  for (const doc of pending) {
    try {
      const res = await ai.generateJson({
        name: "relevance",
        system: CHECK_SYSTEM,
        prompt: `Search: "${doc.qDisplay || doc.q}"\nProduct: ${doc.productName || doc.productId} (category: ${doc.category || "unknown"})\nIs this product a good result for this search?`,
        schema: checkSchema,
        maxTokens: 120,
      });
      await TagSuggestionModel.updateOne({ _id: doc._id }, { $set: { aiCheck: res.data.relevant ? "yes" : "no", aiReason: res.data.reason.slice(0, 200) } });
      if (!res.data.relevant) await reject(doc, "ai");
      else await promoteIfReady([{ q: doc.q, productId: doc.productId }]);
    } catch (err) {
      logger.debug(`AI check skipped for "${doc.q}": ${err instanceof Error ? err.message : String(err)}`);
      return 0; // the LLM is busy or down, try again next round
    }
  }
  return pending.length;
}
