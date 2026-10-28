import "./mongo-host-dns.js";
import { startAiSettingsSync } from "../ai/ai.settings.js";
import { upsertSynonyms } from "../search/synonyms.js";
import { connectDatabase } from "./database.js";
import { DEV_ADMIN_KEY, env } from "./env.js";
import { connectKafka } from "./kafka.js";
import { logger } from "./logger.js";
import { ensureIndexes } from "./models.js";
import { connectRedis } from "./redis.js";
import { registerProcessHandlers } from "./shutdown.js";
import { connectTypesense, isTypesenseReady } from "./typesense.js";

export const bootstrap = async () => {
  registerProcessHandlers();
  await connectDatabase();
  await ensureIndexes();
  // each waits at most 3 s and keeps retrying in the background: a missing service never blocks startup
  await connectRedis();
  await connectKafka(); // producer only. Consumers run in their own process: pnpm workers
  await connectTypesense();
  startAiSettingsSync();
  // a fresh Typesense gets the synonym set without a reindex (idempotent)
  if (isTypesenseReady()) void upsertSynonyms().catch((err: unknown) => logger.warn(`synonyms: ${err instanceof Error ? err.message : String(err)}`));
  if (env.adminKeyIsDefault) logger.warn(`ADMIN_KEY is not set: the admin pages use "${DEV_ADMIN_KEY}". Set ADMIN_KEY in .env.`);
  logger.info(`Bootstrap complete, env: ${env.nodeEnv}`);
  return { logger, env };
};
