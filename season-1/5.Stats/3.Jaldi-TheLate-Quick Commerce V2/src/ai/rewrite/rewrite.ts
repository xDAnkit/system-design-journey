// Roman-letter query -> native script ("bukhar hai" -> "बुखार है"), so the vector model sees the script it knows.
// Never blocks a search: a miss returns null at once and the LLM fills Redis in the background.
import { z } from "zod";
import { logger } from "../../bootstrap/logger.js";
import { redisClient } from "../../bootstrap/redis.js";
import { hasNativeScript, sha1 } from "../../shared/text.js";
import { ai } from "../index.js";
import { REWRITE_SYSTEM } from "./rewrite.prompts.js";

const TTL_S = 30 * 24 * 3600;
const LOCK_S = 30;
// LLM calls running in this process at once; more only queue up inside Ollama
const MAX_RUNNING = 2;
/** stored for "the LLM had nothing useful", so the same query is not asked again */
const NONE = "-";

const schema = z.object({ query: z.string() });
let running = 0;

const key = (qNorm: string): string => `qrw:${sha1(qNorm)}`;

/** Worth rewriting: typed in Roman letters, has letters, not too short or long. */
export const shouldRewrite = (q: string): boolean => !hasNativeScript(q) && /[a-z]{3}/i.test(q) && q.length <= 80;

async function fill(q: string, qNorm: string): Promise<void> {
  const k = key(qNorm);
  // one LLM call per query across all workers: whoever gets the lock does it
  const locked = await redisClient.set(`${k}:lock`, "1", { NX: true, EX: LOCK_S });
  if (locked !== "OK") return;
  running++;
  try {
    const res = await ai.generateJson({ name: "rewrite", system: REWRITE_SYSTEM, prompt: q, schema, maxTokens: 80 });
    const out = res.data.query.trim().slice(0, 160);
    // only a native-script answer helps the vector; English kept as is is "nothing to add"
    const useful = out && out.toLowerCase() !== q.toLowerCase() && hasNativeScript(out);
    await redisClient.set(k, useful ? out : NONE, { EX: TTL_S });
  } catch (err) {
    logger.debug(`rewrite skipped for "${q}": ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    running--;
  }
}

/** Cached rewrite, or null. A miss starts the LLM in the background for the next search. */
export async function cachedRewrite(q: string, qNorm: string): Promise<string | null> {
  if (!shouldRewrite(q) || !redisClient.isReady) return null;
  let cached: string | null = null;
  try {
    cached = (await redisClient.get(key(qNorm))) as string | null;
  } catch {
    return null;
  }
  if (cached !== null) return cached === NONE ? null : cached;
  if (running < MAX_RUNNING) void fill(q, qNorm).catch(() => {});
  return null;
}
