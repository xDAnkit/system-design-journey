import "../bootstrap/mongo-host-dns.js";
import { connectDatabase, disconnectDatabase } from "../bootstrap/database.js";
import { connectKafka, disconnectKafka, isKafkaReady, sendEvents, TOPIC_FOLLOWS, TOPIC_LIKES, TOPIC_VIEWS } from "../bootstrap/kafka.js";
import { connectRedis, disconnectRedis, redisClient } from "../bootstrap/redis.js";
import { logger } from "../bootstrap/logger.js";
import { Post } from "../features/posts/posts.model.js";
import { Profile } from "../features/profiles/profiles.model.js";
import { Comment } from "../features/comments/comments.model.js";
import { commentsKey } from "../features/posts/posts.keys.js";

// pnpm boost -- --post=<id> --likes=1000 --comments=50 --views=10000 --unique=2000 --yes
// pnpm boost -- --profile=virat.kohli --followers=100000 --yes
// Likes, views and follows go through Kafka like real traffic, so Mongo, counters, HLL and Cuckoo stay consistent.
// Every run uses fresh fake users (boost-<run>-<n>), so a second run adds more instead of being ignored as duplicates.
// Without --yes it only prints the plan.

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const num = (name: string): number => Math.max(0, Math.trunc(Number(arg(name) ?? 0)) || 0);

const BATCH = 50_000; // events per Kafka send
const COMMENTS = ["Amazing!", "Love this", "Legend", "So good", "Wow", "Superb", "Goals", "Well played"];

const send = async (topic: string, total: number, make: (i: number) => { key: string; value: unknown }): Promise<void> => {
  for (let i = 0; i < total; i += BATCH) {
    await sendEvents(topic, Array.from({ length: Math.min(BATCH, total - i) }, (_, j) => make(i + j)));
    if ((i / BATCH) % 10 === 0) logger.info(`${topic}: sent ${Math.min(i + BATCH, total)}/${total}`);
  }
};

const main = async (): Promise<void> => {
  const postId = arg("post")?.toLowerCase();
  const username = arg("profile")?.toLowerCase();
  const likes = num("likes");
  const comments = num("comments");
  const views = num("views");
  const unique = Math.min(num("unique") || views, views); // unique viewers can never be more than views
  const followers = num("followers");
  const run = Date.now().toString(36);
  const user = (n: number): string => `boost-${run}-${n}`;

  if (!postId && !username) throw new Error("give --post=<id> and/or --profile=<username>");
  logger.info(`Plan: post=${postId ?? "-"} likes=${likes} comments=${comments} views=${views} unique=${unique} | profile=${username ?? "-"} followers=${followers}`);
  if (!process.argv.includes("--yes")) {
    logger.info("Dry run. Add --yes to send.");
    return;
  }

  await connectDatabase();
  if (postId && !(await Post.exists({ _id: postId }))) throw new Error(`post ${postId} not found`);
  if (username && !(await Profile.exists({ username }))) throw new Error(`profile ${username} not found`);
  await connectKafka();
  if (!isKafkaReady()) throw new Error("Kafka is not available");

  if (postId) {
    await send(TOPIC_LIKES, likes, (i) => ({ key: `${postId}:${user(i)}`, value: { action: "like", postId, userId: user(i) } }));
    // views spread over `unique` users: total = views, HLL sees `unique` people
    await send(TOPIC_VIEWS, views, (i) => ({ key: `${postId}:${user(i % unique)}`, value: { postId, userId: user(i % unique) } }));
    if (comments > 0) {
      await Comment.insertMany(Array.from({ length: comments }, (_, i) => ({ postId, authorId: user(i), text: COMMENTS[i % COMMENTS.length] })));
      // counter missing = the next GET counts from Mongo, so only bump a counter that already exists
      await connectRedis();
      if (await redisClient.exists(commentsKey(postId))) await redisClient.incrBy(commentsKey(postId), comments);
    }
  }
  if (username) {
    await send(TOPIC_FOLLOWS, followers, (i) => ({ key: `${user(i)}:${username}`, value: { action: "follow", followerId: user(i), followeeId: username } }));
  }
  logger.info("Sent. Counts update as the consumers catch up (server must be running).");
};

main()
  .catch((err: unknown) => {
    logger.error(`Boost failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([disconnectKafka(), disconnectDatabase(), disconnectRedis()]);
    process.exit();
  });
