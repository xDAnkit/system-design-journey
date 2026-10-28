// Query vectors cached in Redis: a new query costs one embedding call (~160 ms with bge-m3), a repeat costs 0.
import { ai } from "../ai/index.js";
import { redisClient } from "../bootstrap/redis.js";
import { sleep } from "../shared/pool.js";
import { sha1 } from "../shared/text.js";

const TTL_S = 7 * 24 * 3600;
// a search waits at most this long for a new vector; a slower one still finishes and fills the cache
const WAIT_MS = 1500;

const key = (text: string): string => `qvec:${ai.embedModelId()}:${sha1(text)}`;
const encode = (v: number[]): string => Buffer.from(new Float32Array(v).buffer).toString("base64");
const decode = (s: string): number[] => Array.from(new Float32Array(Uint8Array.from(Buffer.from(s, "base64")).buffer));

/** Only the cache, never the model. */
export async function cachedQueryVector(text: string): Promise<number[] | null> {
  if (!redisClient.isReady) return null;
  try {
    const hit = (await redisClient.get(key(text))) as string | null;
    return hit ? decode(hit) : null;
  } catch {
    return null;
  }
}

/** Cached vector, else embed it. null when the model is down or slower than WAIT_MS: search goes keyword-only. */
export async function queryVector(text: string): Promise<number[] | null> {
  const cached = await cachedQueryVector(text);
  if (cached) return cached;
  const job = ai.embed([text], "query").then(([v]) => {
    if (redisClient.isReady) void redisClient.set(key(text), encode(v), { EX: TTL_S }).catch(() => {});
    return v;
  });
  job.catch(() => {}); // a late failure must not become an unhandled rejection
  return Promise.race([job, sleep(WAIT_MS).then(() => null)]).catch(() => null);
}

/** Many at once (analytics worker): cache first, one batched model call for the rest, all cached after. */
export async function queryVectors(texts: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const missing: string[] = [];
  for (const t of new Set(texts)) {
    const v = await cachedQueryVector(t);
    if (v) out.set(t, v);
    else missing.push(t);
  }
  if (missing.length) {
    const vectors = await ai.embed(missing, "query");
    missing.forEach((t, i) => {
      out.set(t, vectors[i]);
      if (redisClient.isReady) void redisClient.set(key(t), encode(vectors[i]), { EX: TTL_S }).catch(() => {});
    });
  }
  return out;
}
