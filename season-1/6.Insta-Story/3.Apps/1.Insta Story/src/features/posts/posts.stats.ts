import { Types } from "mongoose";
import { Comment } from "../comments/comments.model.js";
import { Like } from "../likes/likes.model.js";
import { commentsKey, likedFilterKey, likesKey, seenFilterKey, uniqueViewsKey, viewsKey } from "./posts.keys.js";
import { redisClient } from "../../bootstrap/redis.js";
import { logger } from "../../bootstrap/logger.js";
import { cuckooExists } from "../../shared/cuckoo.js";

export interface PostStats {
  likes: number | null;
  comments: number | null;
  totalViews: number | null;
  uniqueViews: number | null; // approximate, from the HyperLogLog (about 1% off)
  isLiked: boolean;
  isSeen: boolean;
}

const PER_POST = 4; // likes, views, comments, unique views

// One Redis round trip for every post. A comments counter that does not exist yet is built from Mongo once.
const readCounts = async (ids: string[]): Promise<Array<[number, number, number, number]>> => {
  const multi = redisClient.multi();
  for (const id of ids) multi.get(likesKey(id)).get(viewsKey(id)).get(commentsKey(id)).pfCount(uniqueViewsKey(id));
  const raw = (await multi.exec()) as unknown as Array<string | number | null>;

  const out = ids.map((_, i): [number, number, number, number] => {
    const at = i * PER_POST;
    return [Number(raw[at] ?? 0), Number(raw[at + 1] ?? 0), Number(raw[at + 2] ?? 0), Number(raw[at + 3] ?? 0)];
  });

  const missing = ids.filter((_, i) => raw[i * PER_POST + 2] === null);
  if (missing.length > 0) {
    const rows = await Comment.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { postId: { $in: missing.map((id) => new Types.ObjectId(id)) } } },
      { $group: { _id: "$postId", n: { $sum: 1 } } },
    ]);
    const counted = new Map(rows.map((r) => [String(r._id), r.n]));
    const fill = redisClient.multi();
    for (const id of missing) {
      const n = counted.get(id) ?? 0;
      out[ids.indexOf(id)][2] = n;
      fill.set(commentsKey(id), String(n), { condition: "NX" }); // NX: never overwrite a counter someone else just made
    }
    await fill.exec();
  }
  return out;
};

// Cuckoo says "no" for sure, so only its "maybe" ids are checked in Mongo.
const likedIds = async (viewer: string, ids: string[]): Promise<Set<string>> => {
  const maybe = await cuckooExists(likedFilterKey(viewer), ids);
  const candidates = ids.filter((_, i) => maybe[i]);
  if (candidates.length === 0) return new Set();
  const rows = await Like.find({ userId: viewer, postId: { $in: candidates } }).select("postId").lean();
  return new Set(rows.map((r) => String(r.postId)));
};

// Adds the Redis numbers to posts that came from Mongo. Redis down = the post still comes back, the numbers are null.
export const attachStats = async <T extends { _id: unknown }>(posts: T[], viewer: string | null): Promise<Array<T & PostStats>> => {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => String(p._id));
  try {
    const [counts, liked, seen] = await Promise.all([
      readCounts(ids),
      viewer ? likedIds(viewer, ids) : Promise.resolve(new Set<string>()),
      // isSeen is allowed to be a rare false "yes", a wrong "seen" mark costs nothing
      viewer ? cuckooExists(seenFilterKey(viewer), ids) : Promise.resolve([] as boolean[]),
    ]);
    return posts.map((p, i) => ({
      ...p,
      likes: counts[i][0],
      totalViews: counts[i][1],
      comments: counts[i][2],
      uniqueViews: counts[i][3],
      isLiked: liked.has(ids[i]),
      isSeen: seen[i] === true,
    }));
  } catch (err) {
    logger.warn(`post stats unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return posts.map((p) => ({ ...p, likes: null, totalViews: null, comments: null, uniqueViews: null, isLiked: false, isSeen: false }));
  }
};
