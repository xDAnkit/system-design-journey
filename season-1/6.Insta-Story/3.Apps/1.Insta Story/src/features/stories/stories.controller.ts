import { Types } from "mongoose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { logger } from "../../bootstrap/logger.js";
import { redisClient } from "../../bootstrap/redis.js";
import {
  TOPIC_STORY_LIKES,
  TOPIC_STORY_VIEWS,
  sendEvent,
} from "../../bootstrap/kafka.js";
import { Story, StoryLike, StoryReply, StoryView } from "./stories.model.js";
import {
  seenStoryKey,
  storyLikedFilterKey,
  storyLikesKey,
  storyMetaKey,
  storySharesKey,
  storyTombstoneKey,
  storyUvKey,
  storyViewersKey,
  storyViewsKey,
  trayKey,
} from "./stories.keys.js";
import { Follow } from "../follows/follows.model.js";
import { Profile } from "../profiles/profiles.model.js";
import { isPremiumActive } from "../premium/premium.controller.js";
import { recordAudit } from "../audit/audit.service.js";
import { addCounts, getCounts } from "../../shared/counters.js";
import { cuckooExists } from "../../shared/cuckoo.js";
import { auditSnapshot } from "../../shared/client-meta.js";
import { httpError } from "../../shared/error.js";
import {
  buildCursorFilter,
  buildNextCursor,
  parseLimit,
} from "../../shared/pagination.js";
import { cacheDel, cacheGet, cacheSet } from "../../shared/redisGateway.js";
import { requireUser } from "../../shared/user.js";

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const EXTEND_MS = 48 * 60 * 60 * 1000;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const VIEW_WINDOW_MS = 48 * 60 * 60 * 1000;
const FEED_LIMIT = 200;
const DISCOVER_LIMIT = 60;
const FOLLOW_CAP = 2000;
const TRAY_TTL = 300;
const VIEWERS_TTL = 300;
const TOMBSTONE_TTL = 300;

interface CreateBody {
  type?: string;
  caption?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  audience?: string;
}

// The cached copy of a story. expiresAt is a string here because it travels through JSON.
interface StoryMeta {
  _id: string;
  authorId: string;
  type: "image" | "video";
  caption: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  audience: "public" | "followers";
  createdAt: string;
  expiresAt: string;
  isExtended: boolean;
  edited: boolean;
}

interface StoryRow {
  _id: unknown;
  authorId: string;
  type: string;
  caption: string;
  mediaUrl: string;
  thumbnailUrl?: string | null;
  audience: string;
  createdAt: Date;
  expiresAt: Date;
  isExtended?: boolean;
  edited?: boolean;
}

const storyId = (req: FastifyRequest): string => {
  const id = (req.params as { id: string }).id.toLowerCase();
  if (!OBJECT_ID.test(id)) throw httpError(400, "Invalid story id");
  return id;
};

const toMeta = (doc: StoryRow): StoryMeta => ({
  _id: String(doc._id),
  authorId: doc.authorId,
  type: doc.type === "video" ? "video" : "image",
  caption: doc.caption,
  mediaUrl: doc.mediaUrl,
  thumbnailUrl: doc.thumbnailUrl ?? null,
  audience: doc.audience === "public" ? "public" : "followers",
  createdAt: new Date(doc.createdAt).toISOString(),
  expiresAt: new Date(doc.expiresAt).toISOString(),
  isExtended: doc.isExtended === true,
  edited: doc.edited === true,
});

// Cache is written only after the Mongo row exists. EXAT equals the expiry, so a cached
// story can never outlive the row it came from.
const setStoryMeta = async (meta: StoryMeta): Promise<void> => {
  if (!redisClient.isReady) return;
  try {
    await redisClient.set(storyMetaKey(meta._id), JSON.stringify(meta), {
      EXAT: Math.floor(new Date(meta.expiresAt).getTime() / 1000),
    });
  } catch (err) {
    logger.warn(
      `Story meta cache skipped for ${meta._id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

const readStoryMeta = async (id: string): Promise<StoryMeta | null> => {
  const raw = await cacheGet(storyMetaKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoryMeta;
  } catch {
    return null;
  }
};

const uniqueViewers = async (id: string): Promise<number> => {
  if (!redisClient.isReady) return 0;
  try {
    return await redisClient.pfCount(storyUvKey(id));
  } catch {
    return 0;
  }
};

// POST /stories -> create. Mongo first, then cache, then the audit row.
export const create = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const body = (req.body ?? {}) as CreateBody;

  const type =
    body.type === "video" ? "video" : body.type === "image" ? "image" : null;
  if (!type) throw httpError(400, "type must be image or video");

  const mediaUrl = (body.mediaUrl ?? "").trim();
  if (!/^(https?:\/\/|\/)/i.test(mediaUrl) || mediaUrl.length > 2048) {
    throw httpError(400, "mediaUrl must be an http(s) link or a local path");
  }
  const caption = (body.caption ?? "").trim().slice(0, 500);
  // Public by default: a story that nobody else can open looks broken when accounts are
  // picked at random. The composer still offers "Followers only" as a choice.
  const audience = body.audience === "followers" ? "followers" : "public";
  const expiresAt = new Date(Date.now() + STORY_TTL_MS);

  const doc = await Story.create({
    authorId: user,
    type,
    caption,
    mediaUrl,
    thumbnailUrl: (body.thumbnailUrl ?? "").trim() || null,
    audience,
    expiresAt,
    audit: auditSnapshot(req, user),
  });

  const meta = toMeta(doc.toObject() as StoryRow);
  await setStoryMeta(meta);
  await recordAudit(req, {
    action: "story.create",
    entity: "stories",
    entityId: meta._id,
    userId: user,
    status: 201,
  });
  await reply.code(201).send({ story: meta });
};

// The followee list is cached, the stories are not: a brand new story must show up at once,
// and invalidating every follower's tray on publish is exactly the fanout this design avoids.
const followeesOf = async (user: string): Promise<string[]> => {
  const cached = await cacheGet(trayKey(user));
  if (cached) {
    try {
      return JSON.parse(cached) as string[];
    } catch {
      // treat a broken value as a miss
    }
  }
  const rows = await Follow.find({ followerId: user })
    .select("followeeId")
    .limit(FOLLOW_CAP)
    .lean();
  const ids = rows.map((row) => row.followeeId);
  await cacheSet(trayKey(user), JSON.stringify(ids), TRAY_TTL);
  return ids;
};

const FEED_SELECT =
  "authorId type caption mediaUrl thumbnailUrl audience createdAt expiresAt isExtended";

// GET /stories/feed -> own and followees' live stories, plus public stories from anyone else,
// so a fresh account still has something to watch. ?authorId= returns one profile's tray and
// applies the same visibility rule: public always, followers-only only when you are allowed.
export const feed = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const only = String(
    (req.query as { authorId?: string } | undefined)?.authorId ?? "",
  )
    .trim()
    .toLowerCase()
    .slice(0, 64);
  const now = new Date();

  let rows: StoryRow[];
  if (only) {
    const followed =
      only === user
        ? true
        : (await Follow.exists({ followerId: user, followeeId: only })) !==
          null;
    rows = (await Story.find({
      authorId: only,
      status: "live",
      expiresAt: { $gt: now },
      ...(followed ? {} : { audience: "public" }),
    })
      .sort({ _id: -1 })
      .limit(FEED_LIMIT)
      .select(FEED_SELECT)
      .lean()) as unknown as StoryRow[];
  } else {
    const authorIds = [user, ...(await followeesOf(user))];
    const [followedRows, publicRows] = await Promise.all([
      Story.find({
        authorId: { $in: authorIds },
        status: "live",
        expiresAt: { $gt: now },
      })
        .sort({ _id: -1 })
        .limit(FEED_LIMIT)
        .select(FEED_SELECT)
        .lean(),
      // Discovery: a public story from an author you do not follow yet.
      Story.find({
        authorId: { $nin: authorIds },
        audience: "public",
        status: "live",
        expiresAt: { $gt: now },
      })
        .sort({ _id: -1 })
        .limit(DISCOVER_LIMIT)
        .select(FEED_SELECT)
        .lean(),
    ]);
    rows = [...followedRows, ...publicRows] as unknown as StoryRow[];
  }
  if (rows.length === 0) {
    await reply.send({ items: [] });
    return;
  }

  const ids = rows.map((row) => String(row._id));
  const authors = [...new Set(rows.map((row) => row.authorId))];
  // View counts are author-only, so only your own stories ask Redis for them.
  const ownIds = rows
    .filter((row) => row.authorId === user)
    .map((row) => String(row._id));
  const [seen, profiles] = await Promise.all([
    cuckooExists(seenStoryKey(user), ids),
    Profile.find(
      { username: { $in: authors } },
      { username: 1, displayName: 1, avatarUrl: 1, verified: 1 },
    ).lean(),
  ]);

  const views = new Map<string, number>();
  if (ownIds.length > 0) {
    const ownCounts = await getCounts(ownIds.map(storyViewsKey));
    ownIds.forEach((id, i) => views.set(id, ownCounts[i]));
  }
  const seenIds = new Set(ids.filter((_, i) => seen[i]));
  const byAuthor = new Map<
    string,
    {
      authorId: string;
      displayName: string;
      avatarUrl: string;
      verified: boolean;
      hasUnseen: boolean;
      stories: Array<StoryMeta & { views: number | null }>;
    }
  >();

  for (const row of rows) {
    const meta = toMeta(row as StoryRow);
    let group = byAuthor.get(meta.authorId);
    if (!group) {
      const profile = profiles.find((p) => p.username === meta.authorId);
      group = {
        authorId: meta.authorId,
        displayName: profile?.displayName ?? meta.authorId,
        avatarUrl: profile?.avatarUrl ?? "",
        verified: profile?.verified === true,
        hasUnseen: false,
        stories: [],
      };
      byAuthor.set(meta.authorId, group);
    }
    if (!seenIds.has(meta._id)) group.hasUnseen = true;
    group.stories.push({
      ...meta,
      views: meta.authorId === user ? (views.get(meta._id) ?? 0) : null,
    });
  }

  await reply.send({ items: [...byAuthor.values()] });
};

// GET /stories/:id -> tombstone, then cache, then Mongo. The author may still open an expired
// story (archive and highlights), everyone else gets 404 the moment it stops being live.
export const open = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);

  if (await cacheGet(storyTombstoneKey(id)))
    throw httpError(404, "Story not found");

  let meta = await readStoryMeta(id);
  if (!meta) {
    const doc = await Story.findOne({
      _id: id,
      status: { $in: ["live", "expired", "archived"] },
    }).lean();
    if (!doc) throw httpError(404, "Story not found");
    const expired =
      new Date(doc.expiresAt).getTime() <= Date.now() || doc.status !== "live";
    if (expired && doc.authorId !== user)
      throw httpError(404, "Story not found");
    meta = toMeta(doc as StoryRow);
    if (doc.status === "live") await setStoryMeta(meta);
  }

  if (meta.audience === "followers" && meta.authorId !== user) {
    const follows = await Follow.exists({
      followerId: user,
      followeeId: meta.authorId,
    });
    if (!follows) throw httpError(403, "This story is for followers only");
  }

  const owner = meta.authorId === user;
  const [counts, maybe] = await Promise.all([
    getCounts([storyViewsKey(id), storyLikesKey(id), storySharesKey(id)]),
    cuckooExists(storyLikedFilterKey(user), [id]),
  ]);
  const [isLiked, uniques] = await Promise.all([
    maybe[0]
      ? StoryLike.exists({ storyId: id, userId: user }).then(
          (row) => row !== null,
        )
      : Promise.resolve(false),
    // Views and viewers belong to the author. A viewer never learns how many others watched.
    owner ? uniqueViewers(id) : Promise.resolve(null),
  ]);

  // Rewatches = opens minus viewers. Owner only, it is a Meta One style stat and costs a group by.
  let rewatches: number | null = null;
  if (owner) {
    const [row] = await StoryView.aggregate<{ total: number; viewers: number }>(
      [
        { $match: { storyId: new Types.ObjectId(id) } },
        {
          $group: {
            _id: null,
            total: { $sum: "$watchCount" },
            viewers: { $sum: 1 },
          },
        },
      ],
    );
    rewatches = row ? Math.max(0, row.total - row.viewers) : 0;
  }

  await reply.send({
    ...meta,
    views: owner ? counts[0] : null,
    uniqueViews: uniques,
    likes: counts[1],
    shares: counts[2],
    isLiked,
    rewatches,
  });
};

// POST /stories/:id/view -> one Kafka event, answer 202. Author's own open never counts.
// Anonymous is a Meta One feature: total views move, the viewer row and the name do not.
export const view = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const anonymous =
    (req.query as { anonymous?: string } | undefined)?.anonymous === "true";

  const doc = await Story.findOne({
    _id: id,
    status: "live",
    expiresAt: { $gt: new Date() },
  })
    .select("authorId")
    .lean();
  if (!doc) throw httpError(404, "Story not found");
  if (doc.authorId === user) {
    await reply.code(202).send({ accepted: true, counted: false });
    return;
  }
  if (anonymous && !(await isPremiumActive(user)))
    throw httpError(403, "Anonymous view is a Meta One feature");

  await sendEvent(TOPIC_STORY_VIEWS, `${id}:${user}`, {
    storyId: id,
    viewerId: user,
    anonymous,
    at: new Date().toISOString(),
    client: req.client,
  });
  await reply.code(202).send({ accepted: true, counted: true, anonymous });
};

const ownStory = async (id: string, user: string) => {
  const doc = await Story.findById(id).lean();
  if (!doc) throw httpError(404, "Story not found");
  if (doc.authorId !== user)
    throw httpError(403, "Only the author can do this");
  return doc;
};

interface EditBody {
  caption?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
}

// PATCH /stories/:id -> caption and media only, inside the 15 minute window. Expiry never moves.
export const edit = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const doc = await ownStory(id, user);
  if (doc.status === "deleted") throw httpError(404, "Story not found");
  if (Date.now() - new Date(doc.createdAt).getTime() > EDIT_WINDOW_MS) {
    throw httpError(
      400,
      "Edit window closed, a story is editable for 15 minutes",
    );
  }

  const body = (req.body ?? {}) as EditBody;
  const set: Record<string, unknown> = {
    edited: true,
    editedAt: new Date(),
    audit: auditSnapshot(req, user),
  };
  if (body.caption !== undefined)
    set.caption = String(body.caption).trim().slice(0, 500);
  if (body.mediaUrl !== undefined) {
    const mediaUrl = String(body.mediaUrl).trim();
    if (!/^(https?:\/\/|\/)/i.test(mediaUrl) || mediaUrl.length > 2048) {
      throw httpError(400, "mediaUrl must be an http(s) link or a local path");
    }
    set.mediaUrl = mediaUrl;
  }
  if (body.thumbnailUrl !== undefined)
    set.thumbnailUrl = String(body.thumbnailUrl).trim() || null;

  const updated = await Story.findByIdAndUpdate(
    id,
    { $set: set, $inc: { version: 1 } },
    { new: true },
  ).lean();
  if (!updated) throw httpError(404, "Story not found");

  await cacheDel(storyMetaKey(id));
  const meta = toMeta(updated as StoryRow);
  if (updated.status === "live") await setStoryMeta(meta);
  await recordAudit(req, {
    action: "story.edit",
    entity: "stories",
    entityId: id,
    userId: user,
    status: 200,
  });
  await reply.send({ story: meta });
};

// DELETE /stories/:id -> soft delete. The tombstone hides it at once, the row stays for audit.
export const remove = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const doc = await ownStory(id, user);
  if (doc.status === "deleted") {
    await reply.send({ deleted: true, storyId: id });
    return;
  }

  await Story.updateOne(
    { _id: id },
    {
      $set: {
        status: "deleted",
        deletedAt: new Date(),
        audit: auditSnapshot(req, user),
      },
    },
  );
  await cacheDel([storyMetaKey(id), storyViewersKey(id)]);
  await cacheSet(storyTombstoneKey(id), "1", TOMBSTONE_TTL);
  await recordAudit(req, {
    action: "story.delete",
    entity: "stories",
    entityId: id,
    userId: user,
    status: 200,
  });
  await reply.send({ deleted: true, storyId: id });
};

// Likes go through Kafka, the counter moves after the consumer runs.
const likeStory = async (
  req: FastifyRequest,
  reply: FastifyReply,
  action: "like" | "unlike",
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const exists = await Story.exists({
    _id: id,
    status: "live",
    expiresAt: { $gt: new Date() },
  });
  if (!exists) throw httpError(404, "Story not found");

  await sendEvent(TOPIC_STORY_LIKES, `${id}:${user}`, {
    action,
    storyId: id,
    userId: user,
  });
  await reply.code(202).send({ accepted: true });
};

export const like = (req: FastifyRequest, reply: FastifyReply): Promise<void> =>
  likeStory(req, reply, "like");
export const unlike = (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => likeStory(req, reply, "unlike");

// POST /stories/:id/reply -> a private message to the author, kept after the story expires.
export const reply = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const text = String(
    (req.body as { text?: string } | undefined)?.text ?? "",
  ).trim();
  if (text.length < 1 || text.length > 500)
    throw httpError(400, "text must be 1 to 500 characters");

  const exists = await Story.exists({ _id: id, status: { $ne: "deleted" } });
  if (!exists) throw httpError(404, "Story not found");

  const doc = await StoryReply.create({
    storyId: id,
    authorId: user,
    text,
    audit: auditSnapshot(req, user),
  });
  const plain = doc.toObject() as {
    _id: unknown;
    text: string;
    createdAt: Date;
  };
  await recordAudit(req, {
    action: "story.reply",
    entity: "story_replies",
    entityId: String(plain._id),
    userId: user,
    status: 201,
  });
  await reply.code(201).send({
    reply: {
      _id: String(plain._id),
      authorId: user,
      text: plain.text,
      createdAt: plain.createdAt,
    },
  });
};

// GET /stories/:id/replies -> owner only, newest last so the thread reads top to bottom.
export const replies = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const story = await Story.findById(id).select("authorId").lean();
  if (!story) throw httpError(404, "Story not found");
  if (story.authorId !== user)
    throw httpError(403, "Only the author can read replies");

  const query = req.query as { cursor?: string; limit?: string };
  const limit = parseLimit(query.limit);
  const items = await StoryReply.find({
    storyId: id,
    ...buildCursorFilter(query.cursor),
  })
    .sort({ _id: 1 })
    .limit(limit)
    .lean();
  await reply.send({
    items: items.map((row) => ({
      _id: String(row._id),
      authorId: row.authorId,
      text: row.text,
      createdAt: row.createdAt,
    })),
    nextCursor: buildNextCursor(items, limit),
  });
};

// GET /stories/:id/viewers -> owner only, 48 hour window, optional name search. The viewer's IP
// and device stay internal: the author sees who watched, not where they were.
export const viewers = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const story = await Story.findById(id).select("authorId createdAt").lean();
  if (!story) throw httpError(404, "Story not found");
  if (story.authorId !== user)
    throw httpError(403, "Only the author can see viewers");
  // The named list with rewatch counts is the Meta One feature, not a free author tool.
  if (!(await isPremiumActive(user)))
    throw httpError(403, "The viewer list is part of Meta One");

  const query = req.query as { q?: string; cursor?: string; limit?: string };
  const limit = parseLimit(query.limit);
  const search = (query.q ?? "").trim().toLowerCase().slice(0, 64);
  const cacheId = storyViewersKey(id);

  if (!search && !query.cursor) {
    const cached = await cacheGet(cacheId);
    if (cached) {
      try {
        await reply.send(JSON.parse(cached));
        return;
      } catch {
        // a broken value is treated as a miss
      }
    }
  }

  const windowStart = new Date(story.createdAt);
  const filter: {
    storyId: Types.ObjectId;
    lastViewedAt: { $gte: Date; $lte: Date };
    viewerId?: { $regex: string };
  } = {
    storyId: new Types.ObjectId(id),
    lastViewedAt: {
      $gte: windowStart,
      $lte: new Date(windowStart.getTime() + VIEW_WINDOW_MS),
    },
  };
  // Prefix match on the lowercased id: a viewer search is a support tool, not an exact lookup.
  if (search)
    filter.viewerId = {
      $regex: `^${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    };

  const rows = await StoryView.find(filter)
    .sort({ lastViewedAt: -1 })
    .limit(limit)
    .lean();
  const payload = {
    items: rows.map((row) => ({
      viewerId: row.viewerId,
      firstViewedAt: row.firstViewedAt,
      lastViewedAt: row.lastViewedAt,
      watchCount: row.watchCount,
    })),
    nextCursor: buildNextCursor(rows, limit),
  };
  if (!search) await cacheSet(cacheId, JSON.stringify(payload), VIEWERS_TTL);
  await reply.send(payload);
};

// POST /stories/:id/extend -> Meta One, once, 24h to 48h from the original publish time.
export const extend = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const doc = await ownStory(id, user);
  if (!(await isPremiumActive(user)))
    throw httpError(403, "Extending a story is a Meta One feature");
  if (doc.isExtended) throw httpError(400, "A story can be extended only once");
  if (doc.status !== "live")
    throw httpError(400, "Only a live story can be extended");

  const target = new Date(new Date(doc.createdAt).getTime() + EXTEND_MS);
  if (target.getTime() <= Date.now())
    throw httpError(400, "Too late to extend");

  const updated = await Story.findByIdAndUpdate(
    id,
    {
      $set: {
        expiresAt: target,
        isExtended: true,
        audit: auditSnapshot(req, user),
      },
    },
    { new: true },
  ).lean();
  if (!updated) throw httpError(404, "Story not found");

  await cacheDel(storyMetaKey(id));
  const meta = toMeta(updated as StoryRow);
  await setStoryMeta(meta);
  await recordAudit(req, {
    action: "story.extend",
    entity: "stories",
    entityId: id,
    userId: user,
    status: 200,
  });
  await reply.send({ story: meta });
};

// POST /stories/:id/share -> counter only in v1, the share sheet is out of scope.
export const share = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = storyId(req);
  const exists = await Story.exists({
    _id: id,
    status: "live",
    expiresAt: { $gt: new Date() },
  });
  if (!exists) throw httpError(404, "Story not found");

  await addCounts(new Map([[storySharesKey(id), 1]]));
  await recordAudit(req, {
    action: "story.share",
    entity: "stories",
    entityId: id,
    userId: user,
    status: 202,
  });
  await reply.code(202).send({ accepted: true });
};
