import { TOPIC_VIEWS, startConsumer } from "../../bootstrap/kafka.js";
import { redisClient } from "../../bootstrap/redis.js";
import { LUA_SLICE } from "../../shared/counters.js";
import { cuckooAddMany } from "../../shared/cuckoo.js";
import { seenFilterKey, uniqueViewsKey, viewsKey } from "../posts/posts.keys.js";

interface ViewEvent {
  postId: string;
  userId: string;
}

// Per post: KEYS = [total, hll], ARGV = [views, viewers joined by \n]. One atomic call for the whole batch.
// PFADD goes in chunks of 1000 because Lua's unpack has a stack limit.
const RECORD_VIEWS = `
for p = 1, #KEYS, 2 do
  redis.call('INCRBY', KEYS[p], ARGV[p])
  local users, chunk = ARGV[p + 1], {}
  for u in string.gmatch(users, '[^\\n]+') do
    chunk[#chunk + 1] = u
    if #chunk == 1000 then redis.call('PFADD', KEYS[p + 1], unpack(chunk)); chunk = {} end
  end
  if #chunk > 0 then redis.call('PFADD', KEYS[p + 1], unpack(chunk)) end
end
return #KEYS / 2`;

// ponytail: views live only in Redis (no Mongo row per view, there would be far too many). If Redis is wiped the
// counts are gone, and a retried batch adds its views again. Both are fine for a view counter.
const handleBatch = async (events: ViewEvent[]): Promise<void> => {
  const totals = new Map<string, number>();
  const viewers = new Map<string, Set<string>>();
  for (const { postId, userId } of events) {
    if (!postId || !userId) continue;
    totals.set(postId, (totals.get(postId) ?? 0) + 1);
    if (!viewers.has(postId)) viewers.set(postId, new Set());
    viewers.get(postId)!.add(userId);
  }
  if (totals.size === 0) return;

  // calls of at most LUA_SLICE viewers each, so Redis never stalls the API for long.
  // A post with more viewers is split, its total goes with the first part (INCRBY 0 for the rest).
  let keys: string[] = [];
  let args: string[] = [];
  let size = 0;
  const flush = async (): Promise<void> => {
    if (keys.length > 0) await redisClient.eval(RECORD_VIEWS, { keys, arguments: args });
    keys = [];
    args = [];
    size = 0;
  };
  for (const [postId, n] of totals) {
    const users = [...viewers.get(postId)!];
    for (let i = 0; i < users.length; i += LUA_SLICE) {
      const part = users.slice(i, i + LUA_SLICE);
      if (size + part.length > LUA_SLICE) await flush();
      keys.push(viewsKey(postId), uniqueViewsKey(postId));
      args.push(i === 0 ? String(n) : "0", part.join("\n"));
      size += part.length;
    }
  }
  await flush();

  // only powers isSeen, never stops a view from counting
  await cuckooAddMany([...viewers].flatMap(([postId, users]) => [...users].map((u): [string, string] => [seenFilterKey(u), postId])));
};

export const startViewsConsumer = (): Promise<void> => startConsumer<ViewEvent>("views-writer", TOPIC_VIEWS, "Views", handleBatch);
