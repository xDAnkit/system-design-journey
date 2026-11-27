import type { Server } from "node:http";
import { logger } from "./logger.js";
import { disconnectDatabase } from "./database.js";
import { disconnectRedis } from "./redis.js";
import { disconnectKafka } from "./kafka.js";
import { flushIngestOnShutdown } from "../features/products/products.ingest.js";

export const registerProcessHandlers = (): void => {
  process.on("uncaughtException", (err: Error) => {
    logger.error(`Uncaught exception: ${err.stack ?? err.message}`);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error(`Unhandled rejection: ${String(reason)}`);
    process.exit(1);
  });
};

export const registerGracefulShutdown = (server: Server): void => {
  const shutdown = (signal: string): void => {
    logger.info(`${signal} received, shutting down gracefully`);
    server.close(() => {
      void (async () => {
        try {
          await flushIngestOnShutdown();
        } catch (err) {
          logger.error(`ingest shutdown flush failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await Promise.all([disconnectDatabase(), disconnectRedis(), disconnectKafka()]);
      })().finally(() => process.exit(0));
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};
