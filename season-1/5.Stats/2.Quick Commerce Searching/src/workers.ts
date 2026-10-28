/**
 * pnpm workers                         all four workers in one process
 * WORKER_ROLES=enrich pnpm workers     only some (start more copies to share the load, up to 3 per topic)
 *
 * Kafka consumers live here, away from the API, so a flood of events or a slow LLM never slows search down.
 */
import "./bootstrap/mongo-host-dns.js";
import { startAiSettingsSync } from "./ai/ai.settings.js";
import { connectDatabase } from "./bootstrap/database.js";
import { connectKafka, ensureTopics } from "./bootstrap/kafka.js";
import { logger } from "./bootstrap/logger.js";
import { ensureIndexes } from "./bootstrap/models.js";
import { connectRedis } from "./bootstrap/redis.js";
import { closeConnections, registerProcessHandlers } from "./bootstrap/shutdown.js";
import { connectTypesense } from "./bootstrap/typesense.js";
import { startAnalyticsWorker } from "./workers/analytics.worker.js";
import { startEnrichWorker } from "./workers/enrich.worker.js";
import { startIndexWorker } from "./workers/index.worker.js";
import { startIngestWorker } from "./workers/ingest.worker.js";

const ROLES = {
  ingest: startIngestWorker,
  enrich: startEnrichWorker,
  index: startIndexWorker,
  analytics: startAnalyticsWorker,
} as const;

const main = async (): Promise<void> => {
  registerProcessHandlers();
  await connectDatabase();
  await ensureIndexes();
  await connectRedis();
  await connectKafka();
  await connectTypesense();
  startAiSettingsSync();

  const wanted = (process.env.WORKER_ROLES ?? Object.keys(ROLES).join(",")).split(",").map((r) => r.trim());
  const unknown = wanted.filter((r) => !(r in ROLES));
  if (unknown.length) throw new Error(`unknown WORKER_ROLES: ${unknown.join(", ")} (use ${Object.keys(ROLES).join(", ")})`);

  // subscribing needs the topics; the broker does not auto-create them
  await ensureTopics().catch((err: unknown) => logger.warn(`topic setup: ${err instanceof Error ? err.message : String(err)}`));
  for (const role of wanted) void ROLES[role as keyof typeof ROLES]();
  logger.info(`Workers process started: ${wanted.join(", ")}`);
};

const stop = (signal: string): void => {
  logger.info(`${signal} received, stopping workers`);
  void closeConnections().finally(() => process.exit(0));
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

main().catch((err: unknown) => {
  logger.error(`Workers failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
