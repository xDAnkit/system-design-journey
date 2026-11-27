import "./bootstrap/mongo-host-dns.js";
import { connectDatabase, disconnectDatabase } from "./bootstrap/database.js";
import { connectRedis, disconnectRedis } from "./bootstrap/redis.js";
import { disconnectKafka } from "./bootstrap/kafka.js";
import { logger } from "./bootstrap/logger.js";
import { startLikesConsumer } from "./features/likes/likes.consumer.js";
import { startFollowsConsumer } from "./features/follows/follows.consumer.js";
import { startViewsConsumer } from "./features/views/views.consumer.js";
import { startStoriesConsumer } from "./features/stories/stories.consumer.js";
import { startStoryLikesConsumer } from "./features/stories/stories.likes.consumer.js";
import { startStoriesSweeper } from "./features/stories/stories.sweeper.js";

// Kafka consumers in their own process (pnpm consumers), so a flood of events never slows the API down.
// Run it next to the server. More copies share the work, up to one per partition (3 per topic).
const main = async (): Promise<void> => {
  await connectDatabase();
  await connectRedis();
  void startLikesConsumer();
  void startFollowsConsumer();
  void startViewsConsumer();
  void startStoriesConsumer();
  void startStoryLikesConsumer();
  startStoriesSweeper();
  logger.info("Consumers process started");
};

const stop = (signal: string): void => {
  logger.info(`${signal} received, stopping consumers`);
  void Promise.allSettled([
    disconnectKafka(),
    disconnectDatabase(),
    disconnectRedis(),
  ]).finally(() => process.exit(0));
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

main().catch((err: unknown) => {
  logger.error(
    `Consumers failed to start: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
