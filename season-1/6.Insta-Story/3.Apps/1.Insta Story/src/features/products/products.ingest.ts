import { logger } from "../../bootstrap/logger.js";
import type { CreateProductInput } from "./products.types.js";
import { Product } from "./products.model.js";

const FLUSH_MS = 300;
const CHUNK = 5000;

type IngestDoc = CreateProductInput & { createdAt: Date; updatedAt: Date };

const buffer: IngestDoc[] = [];
const stats = { accepted: 0, flushed: 0, failed: 0 };

let timer: ReturnType<typeof setInterval> | null = null;
let chain: Promise<void> = Promise.resolve();

export const getIngestStats = (): {
  pid: number;
  accepted: number;
  queued: number;
  flushed: number;
  failed: number;
} => ({
  pid: process.pid,
  accepted: stats.accepted,
  queued: buffer.length,
  flushed: stats.flushed,
  failed: stats.failed,
});

export const isIngestPost = (req: { method: string; url: string }): boolean => {
  const path = req.url.split("?")[0];
  return req.method === "POST" && path === "/products/ingest";
};

export const enqueueIngest = (payload: CreateProductInput): void => {
  const now = new Date();
  buffer.push({ ...payload, createdAt: now, updatedAt: now });
  stats.accepted += 1;
  ensureTimer();
};

const ensureTimer = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    void flushIngest();
  }, FLUSH_MS);
};

const bulkInserted = (err: unknown): number | null => {
  if (!err || typeof err !== "object") return null;
  const e = err as { name?: string; insertedCount?: number };
  if (e.name === "MongoBulkWriteError" && typeof e.insertedCount === "number") return e.insertedCount;
  return null;
};

const insertChunk = async (docs: IngestDoc[]): Promise<void> => {
  try {
    const result = await Product.collection.insertMany(docs, { ordered: false });
    stats.flushed += result.insertedCount;
  } catch (err) {
    const inserted = bulkInserted(err);
    if (inserted !== null) {
      stats.flushed += inserted;
      stats.failed += docs.length - inserted;
      logger.error(
        `ingest insertMany partial: inserted=${inserted} failed=${docs.length - inserted} ${String((err as Error).message)}`,
      );
      return;
    }

    stats.failed += docs.length;
    logger.error(`ingest insertMany failed: count=${docs.length} ${err instanceof Error ? err.message : String(err)}`);
  }
};

const runFlush = async (): Promise<void> => {
  while (buffer.length > 0) {
    const chunk = buffer.splice(0, CHUNK);
    await insertChunk(chunk);
  }
};

export const flushIngest = (): Promise<void> => {
  chain = chain.then(runFlush, runFlush);
  return chain;
};

export const flushIngestOnShutdown = async (): Promise<void> => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await flushIngest();
  if (buffer.length > 0) {
    stats.failed += buffer.length;
    logger.error(`ingest shutdown leftover failed=${buffer.length}`);
    buffer.length = 0;
  }
};
