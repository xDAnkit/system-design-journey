import type { FastifyReply, FastifyRequest } from "fastify";
import { Profile } from "./profiles.model.js";
import { Post } from "../posts/posts.model.js";
import {
  Follow,
  followersKey,
  followingFilterKey,
  followingKey,
} from "../follows/follows.model.js";
import { getCounts } from "../../shared/counters.js";
import { cuckooExists } from "../../shared/cuckoo.js";
import { isPremiumActive } from "../premium/premium.controller.js";
import { httpError } from "../../shared/error.js";
import { requireUser } from "../../shared/user.js";

const PICKER_LIMIT = 50;
const SEARCH_LIMIT = 20;

// User input lands in a regex, so every regex symbol is escaped first.
const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /profiles -> without ?q it is every card for the "pick a user" page.
// With ?q it searches: username prefix and displayName substring, so "vir" finds virat.kohli.
export const list = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const q = String((req.query as { q?: string } | undefined)?.q ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 40);

  if (!q) {
    const items = await Profile.find(
      {},
      { username: 1, displayName: 1, avatarUrl: 1, verified: 1 },
    )
      .sort({ _id: 1 })
      .limit(PICKER_LIMIT)
      .lean();
    await reply.send({ items });
    return;
  }

  const safe = escapeRegex(q);
  const items = await Profile.find(
    {
      $or: [
        { username: { $regex: `^${safe}`, $options: "i" } },
        { displayName: { $regex: safe, $options: "i" } },
      ],
    },
    { username: 1, displayName: 1, avatarUrl: 1, verified: 1 },
  )
    .sort({ username: 1 })
    .limit(SEARCH_LIMIT)
    .lean();
  await reply.send({ items });
};

// "Does viewer follow username?" The Cuckoo filter only says "no" for sure, so a "maybe" is checked in Mongo.
const isFollowing = async (
  viewer: string | null,
  username: string,
): Promise<boolean> => {
  if (!viewer || viewer === username) return false;
  const [maybe] = await cuckooExists(followingFilterKey(viewer), [username]);
  return maybe
    ? (await Follow.exists({ followerId: viewer, followeeId: username })) !==
        null
    : false;
};

// GET /profiles/:username -> profile card, postsCount, followers, following, isFollowing (needs x-user-id)
export const getByUsername = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const username = (req.params as { username: string }).username.toLowerCase();
  const viewer = req.headers["x-user-id"] ? requireUser(req) : null;
  const [profile, postsCount, [followers, following], viewerFollows, premium] =
    await Promise.all([
      Profile.findOne({ username }).lean(),
      Post.countDocuments({ authorId: username }),
      getCounts([followersKey(username), followingKey(username)]),
      isFollowing(viewer, username),
      isPremiumActive(username),
    ]);
  if (!profile) throw httpError(404, "Profile not found");
  await reply.send({
    ...profile,
    postsCount,
    followers,
    following,
    isFollowing: viewerFollows,
    isPremium: premium,
  });
};
