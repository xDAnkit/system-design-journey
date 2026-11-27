import { Follow, followersKey, followingFilterKey, followingKey } from "./follows.model.js";
import { TOPIC_FOLLOWS, startConsumer } from "../../bootstrap/kafka.js";
import { addCounts, bump } from "../../shared/counters.js";
import { cuckooAddMany, cuckooDelMany } from "../../shared/cuckoo.js";
import { applyPairs } from "../../shared/pairs.js";

interface FollowEvent {
  action: "follow" | "unfollow";
  followerId: string;
  followeeId: string;
}

// Mongo is the truth: the two Redis counters move only by rows that really changed, so a repeated batch changes nothing.
const handleBatch = async (events: FollowEvent[]): Promise<void> => {
  const { adds, added, removed } = await applyPairs(
    Follow,
    events.filter((e) => e.followerId && e.followeeId),
    (e) => e.action === "follow",
    (e) => ({ followerId: e.followerId, followeeId: e.followeeId }),
  );

  const deltas = new Map<string, number>();
  for (const e of added) {
    bump(deltas, followersKey(e.followeeId), 1);
    bump(deltas, followingKey(e.followerId), 1);
  }
  for (const e of removed) {
    bump(deltas, followersKey(e.followeeId), -1);
    bump(deltas, followingKey(e.followerId), -1);
  }
  await addCounts(deltas);

  // filter: add for every final follow (also repairs a lost filter), delete only for follows that really existed
  await cuckooAddMany(adds.map((e) => [followingFilterKey(e.followerId), e.followeeId]));
  await cuckooDelMany(removed.map((e) => [followingFilterKey(e.followerId), e.followeeId]));
};

export const startFollowsConsumer = (): Promise<void> =>
  startConsumer<FollowEvent>("follows-writer", TOPIC_FOLLOWS, "Follows", handleBatch);
