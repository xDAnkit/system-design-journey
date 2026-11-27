import { Types } from "mongoose";
import { StoryLike } from "./stories.model.js";
import { storyLikedFilterKey, storyLikesKey } from "./stories.keys.js";
import { TOPIC_STORY_LIKES, startConsumer } from "../../bootstrap/kafka.js";
import { logger } from "../../bootstrap/logger.js";
import { addCounts, bump } from "../../shared/counters.js";
import { cuckooAddMany, cuckooDelMany } from "../../shared/cuckoo.js";
import { applyPairs } from "../../shared/pairs.js";

interface StoryLikeEvent {
  action: "like" | "unlike";
  storyId: string;
  userId: string;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// Same contract as post likes: Mongo is the truth, the Redis counter moves only by rows that
// really changed, so a replayed batch changes nothing.
const handleBatch = async (raw: StoryLikeEvent[]): Promise<void> => {
  const events = raw.filter((e) => OBJECT_ID.test(e.storyId) && e.userId);
  if (events.length < raw.length)
    logger.warn(
      `story likes consumer: skipped ${raw.length - events.length} bad events`,
    );

  const { adds, added, removed } = await applyPairs(
    StoryLike,
    events,
    (e) => e.action === "like",
    (e) => ({ storyId: new Types.ObjectId(e.storyId), userId: e.userId }),
  );

  const deltas = new Map<string, number>();
  for (const e of added) bump(deltas, storyLikesKey(e.storyId), 1);
  for (const e of removed) bump(deltas, storyLikesKey(e.storyId), -1);
  await addCounts(deltas);

  await cuckooAddMany(
    adds.map((e) => [storyLikedFilterKey(e.userId), e.storyId]),
  );
  await cuckooDelMany(
    removed.map((e) => [storyLikedFilterKey(e.userId), e.storyId]),
  );
};

export const startStoryLikesConsumer = (): Promise<void> =>
  startConsumer<StoryLikeEvent>(
    "story-likes-writer",
    TOPIC_STORY_LIKES,
    "Story likes",
    handleBatch,
  );
