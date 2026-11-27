import { logger } from "../../bootstrap/logger.js";
import { redisClient } from "../../bootstrap/redis.js";
import { TOPIC_STORY_VIEWS, startConsumer } from "../../bootstrap/kafka.js";
import { addCounts } from "../../shared/counters.js";
import { cuckooAddMany } from "../../shared/cuckoo.js";
import type { ClientMeta } from "../../shared/client-meta.js";
import { cacheDel } from "../../shared/redisGateway.js";
import { StoryView } from "./stories.model.js";
import {
  seenStoryKey,
  storyUvKey,
  storyViewersKey,
  storyViewsKey,
} from "./stories.keys.js";

interface StoryViewEvent {
  storyId: string;
  viewerId: string;
  anonymous?: boolean;
  at?: string;
  client?: ClientMeta;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UPSERT_CHUNK = 2000;
const PFADD_CHUNK = 1000;

// The evidence block kept on the view row. This is the audit answer for a view: the story_views
// row itself says who watched, from which IP, device and geo, so no second audit doc is needed.
const evidenceOf = (
  client: ClientMeta | undefined,
  at: Date,
): Record<string, unknown> | null =>
  !client
    ? null
    : {
        ip: client.ip,
        socketIp: client.socketIp,
        ipHash: client.ipHash,
        ua: client.ua,
        browser: client.browser,
        os: client.os,
        device: client.device,
        lang: client.lang,
        timezone: client.timezone,
        clientId: client.clientId,
        geo: client.geo,
        at,
      };

// One row per (story, viewer). A repeat view only bumps watchCount and lastViewedAt, so the
// unique viewer count and the row count never disagree. Safe to repeat: the filter is the pair.
const handleBatch = async (events: StoryViewEvent[]): Promise<void> => {
  const pairs = new Map<
    string,
    {
      storyId: string;
      viewerId: string;
      views: number;
      at: Date;
      client?: ClientMeta;
    }
  >();
  const totals = new Map<string, number>(); // every open, anonymous included

  for (const event of events) {
    if (!event?.storyId || !event.viewerId || !OBJECT_ID.test(event.storyId))
      continue;
    totals.set(event.storyId, (totals.get(event.storyId) ?? 0) + 1);
    // Anonymous is a Meta One feature: the total moves, the viewer row and the unique set do not.
    if (event.anonymous) continue;

    const key = `${event.storyId}:${event.viewerId}`;
    const at = event.at ? new Date(event.at) : new Date();
    const seen = pairs.get(key);
    if (seen) {
      seen.views += 1;
      seen.at = at;
      seen.client = event.client ?? seen.client;
    } else {
      pairs.set(key, {
        storyId: event.storyId,
        viewerId: event.viewerId,
        views: 1,
        at,
        client: event.client,
      });
    }
  }
  if (totals.size === 0) return;

  const ops = [...pairs.values()].map((pair) => ({
    updateOne: {
      filter: { storyId: pair.storyId, viewerId: pair.viewerId },
      update: {
        $set: {
          lastViewedAt: pair.at,
          lastClient: evidenceOf(pair.client, pair.at),
        },
        $setOnInsert: { firstViewedAt: pair.at },
        $inc: { watchCount: pair.views },
      },
      upsert: true,
    },
  }));

  for (let i = 0; i < ops.length; i += UPSERT_CHUNK) {
    const chunk = ops.slice(i, i + UPSERT_CHUNK);
    try {
      await StoryView.bulkWrite(chunk, { ordered: false });
    } catch (firstErr) {
      // Two batches can upsert the same new pair at once. The loser sees a duplicate key, and a
      // second pass turns that row into an update, so no view is lost.
      try {
        await StoryView.bulkWrite(chunk, { ordered: false });
      } catch (retryErr) {
        logger.warn(
          `Story views upsert skipped for ${chunk.length} rows (${firstErr instanceof Error ? firstErr.message : String(firstErr)} / ${retryErr instanceof Error ? retryErr.message : String(retryErr)})`,
        );
      }
    }
  }

  // Totals count every open, including a rewatch. Unique viewers are a HyperLogLog.
  const viewers = new Map<string, string[]>();
  for (const pair of pairs.values()) {
    const list = viewers.get(pair.storyId) ?? [];
    list.push(pair.viewerId);
    viewers.set(pair.storyId, list);
  }
  await addCounts(
    new Map([...totals].map(([id, n]) => [storyViewsKey(id), n])),
  );

  if (redisClient.isReady) {
    for (const [id, list] of viewers) {
      for (let i = 0; i < list.length; i += PFADD_CHUNK) {
        await redisClient
          .pfAdd(storyUvKey(id), list.slice(i, i + PFADD_CHUNK))
          .catch(() => 0);
      }
    }
  }

  // Only powers the tray ring, never stops a view from counting.
  await cuckooAddMany(
    [...pairs.values()].map((pair): [string, string] => [
      seenStoryKey(pair.viewerId),
      pair.storyId,
    ]),
  );

  // The owner's viewer list is cached, so a new view must not wait for the TTL to show up.
  await cacheDel([...totals.keys()].map((id) => storyViewersKey(id)));
};

export const startStoriesConsumer = (): Promise<void> =>
  startConsumer<StoryViewEvent>(
    "story-views-writer",
    TOPIC_STORY_VIEWS,
    "Story views",
    handleBatch,
  );
