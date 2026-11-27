import { Types } from "mongoose";
import { Like } from "./likes.model.js";
import { likedFilterKey, likesKey } from "../posts/posts.keys.js";
import { TOPIC_LIKES, startConsumer } from "../../bootstrap/kafka.js";
import { logger } from "../../bootstrap/logger.js";
import { addCounts, bump } from "../../shared/counters.js";
import { cuckooAddMany, cuckooDelMany } from "../../shared/cuckoo.js";
import { applyPairs } from "../../shared/pairs.js";

interface LikeEvent {
  action: "like" | "unlike";
  postId: string;
  userId: string;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// Mongo is the truth: the Redis counter moves only by rows that really changed, so a repeated batch changes nothing.
const handleBatch = async (raw: LikeEvent[]): Promise<void> => {
  // a bad id would make the whole batch fail on every retry, so drop it here
  const events = raw.filter((e) => OBJECT_ID.test(e.postId) && e.userId);
  if (events.length < raw.length) logger.warn(`likes consumer: skipped ${raw.length - events.length} bad events`);

  const { adds, added, removed } = await applyPairs(
    Like,
    events,
    (e) => e.action === "like",
    (e) => ({ postId: new Types.ObjectId(e.postId), userId: e.userId }),
  );

  const deltas = new Map<string, number>();
  for (const e of added) bump(deltas, likesKey(e.postId), 1);
  for (const e of removed) bump(deltas, likesKey(e.postId), -1);
  await addCounts(deltas);

  // filter: add for every final like (also repairs a lost filter), delete only for likes that really existed
  await cuckooAddMany(adds.map((e) => [likedFilterKey(e.userId), e.postId]));
  await cuckooDelMany(removed.map((e) => [likedFilterKey(e.userId), e.postId]));
};

export const startLikesConsumer = (): Promise<void> => startConsumer<LikeEvent>("likes-writer", TOPIC_LIKES, "Likes", handleBatch);
