import "./mongo-host-dns.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { connectDatabase } from "./database.js";
import { connectRedis } from "./redis.js";
import { connectKafka } from "./kafka.js";
import { Profile } from "../features/profiles/profiles.model.js";
import { Post } from "../features/posts/posts.model.js";
import { Comment } from "../features/comments/comments.model.js";
import { Like } from "../features/likes/likes.model.js";
import { Follow } from "../features/follows/follows.model.js";
import { registerProcessHandlers } from "./shutdown.js";

export const bootstrap = async () => {
  registerProcessHandlers();
  await connectDatabase();
  // bufferCommands is off, so Mongoose's own auto-index at model load runs before the connection is ready and builds
  // nothing. Build the Instagram indexes here instead. createIndexes only adds missing ones, it never drops.
  await Promise.all([Profile, Post, Comment, Like, Follow].map((m) => m.createIndexes())).catch((err: unknown) =>
    logger.error(`Index build failed: ${err instanceof Error ? err.message : String(err)}`),
  );
  void connectRedis();
  void connectKafka(); // producer only. Consumers run in their own process: pnpm consumers
  logger.info(`Bootstrap complete — env: ${env.nodeEnv}`);
  return { logger, env };
};
