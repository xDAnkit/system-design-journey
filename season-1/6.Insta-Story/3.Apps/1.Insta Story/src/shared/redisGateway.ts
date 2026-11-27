import { redisClient } from "../bootstrap/redis.js";
import { logger } from "../bootstrap/logger.js";

const CALL_TIMEOUT_MS = 150;

const withTimeout = <T>(op: Promise<T>): Promise<T> => {
  op.catch(() => {}); // op background me reject ho sakta hai race haarne ke baad bhi, unhandled rejection na bane
  return Promise.race([
    op,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("redis call timeout")), CALL_TIMEOUT_MS)),
  ]);
};

export const cacheGet = async (key: string): Promise<string | null> => {
  if (!redisClient.isReady) return null;
  try {
    return await withTimeout(redisClient.get(key));
  } catch (err) {
    logger.warn(`Redis get short-circuited for ${key}: ${(err as Error).message}`);
    return null;
  }
};

export const cacheSet = async (key: string, value: string, ttlSeconds: number): Promise<void> => {
  if (!redisClient.isReady) return;
  try {
    await withTimeout(redisClient.set(key, value, { EX: ttlSeconds }));
  } catch (err) {
    logger.warn(`Redis set short-circuited for ${key}: ${(err as Error).message}`);
  }
};

export const cacheDel = async (keys: string | string[]): Promise<void> => {
  if (!redisClient.isReady) return;
  try {
    await withTimeout(redisClient.del(keys));
  } catch (err) {
    logger.warn(`Redis del short-circuited: ${(err as Error).message}`);
  }
};
