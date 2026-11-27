import { Types } from "mongoose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Highlight, HighlightItem } from "./highlights.model.js";
import { Story } from "./stories.model.js";
import { Follow } from "../follows/follows.model.js";
import { recordAudit } from "../audit/audit.service.js";
import { auditSnapshot } from "../../shared/client-meta.js";
import { httpError } from "../../shared/error.js";
import { requireUser } from "../../shared/user.js";

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MAX_ITEMS = 100;

const idParam = (req: FastifyRequest, name = "id"): string => {
  const raw = (req.params as Record<string, string>)[name] ?? "";
  const id = raw.toLowerCase();
  if (!OBJECT_ID.test(id)) throw httpError(400, `Invalid ${name}`);
  return id;
};

const ownHighlight = async (id: string, user: string) => {
  const doc = await Highlight.findById(id).lean();
  if (!doc) throw httpError(404, "Highlight not found");
  if (doc.ownerId !== user) throw httpError(403, "Only the owner can do this");
  return doc;
};

// What a viewer needs to render a slide, nothing else. Expired and archived rows still load,
// which is the whole point of a highlight: the story is gone, the reference is not.
interface StoryCard {
  _id: string;
  type: "image" | "video";
  caption: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  audience: "public" | "followers";
  createdAt: string;
  expiresAt: string;
}

const cardOf = (doc: Record<string, unknown>): StoryCard => ({
  _id: String(doc._id),
  type: doc.type === "video" ? "video" : "image",
  caption: String(doc.caption ?? ""),
  mediaUrl: String(doc.mediaUrl ?? ""),
  thumbnailUrl: (doc.thumbnailUrl as string | null) ?? null,
  audience: doc.audience === "public" ? "public" : "followers",
  createdAt: new Date(doc.createdAt as Date).toISOString(),
  expiresAt: new Date(doc.expiresAt as Date).toISOString(),
});

// A highlight is a list of references, so the story rules still apply: a followers-only story
// inside a highlight is only shown to the owner and to followers, never to a stranger. One query
// per collection for the whole page, no N+1 by highlight.
const cardsByHighlight = async (
  highlightIds: string[],
  ownerId: string,
  viewer: string,
): Promise<Map<string, StoryCard[]>> => {
  const cards = new Map<string, StoryCard[]>(
    highlightIds.map((id) => [id, []]),
  );
  if (highlightIds.length === 0) return cards;

  const links = await HighlightItem.find({ highlightId: { $in: highlightIds } })
    .sort({ _id: 1 })
    .lean();
  if (links.length === 0) return cards;

  const rows = await Story.find({
    _id: { $in: [...new Set(links.map((link) => link.storyId))] },
    status: { $ne: "deleted" },
  }).lean();
  const byId = new Map(rows.map((row) => [String(row._id), row]));

  const owner = viewer === ownerId;
  const followee = owner
    ? true
    : (await Follow.exists({ followerId: viewer, followeeId: ownerId })) !==
      null;

  for (const link of links) {
    const row = byId.get(String(link.storyId));
    if (!row) continue;
    if (row.audience === "followers" && !owner && !followee) continue;
    const list = cards.get(String(link.highlightId));
    if (list) list.push(cardOf(row as Record<string, unknown>));
  }
  return cards;
};

interface CreateBody {
  title?: string;
  storyIds?: string[];
}

// POST /highlights -> a named list. Media is referenced, never copied, so the story may expire
// while the highlight keeps rendering.
export const create = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const body = (req.body ?? {}) as CreateBody;
  const title = String(body.title ?? "").trim();
  if (title.length < 1 || title.length > 50)
    throw httpError(400, "title must be 1 to 50 characters");

  const raw = Array.isArray(body.storyIds) ? body.storyIds : [];
  const ids = [
    ...new Set(
      raw
        .filter((id) => typeof id === "string" && OBJECT_ID.test(id))
        .map((id) => id.toLowerCase()),
    ),
  ].slice(0, MAX_ITEMS);

  // Only your own stories can go into your highlight, and a deleted story never goes in.
  const owned =
    ids.length === 0
      ? []
      : await Story.find({
          _id: { $in: ids },
          authorId: user,
          status: { $ne: "deleted" },
        })
          .select("_id")
          .lean();
  const allowed = new Set(owned.map((row) => String(row._id)));
  const picked = ids.filter((id) => allowed.has(id));
  if (ids.length > 0 && picked.length === 0)
    throw httpError(400, "None of those stories belong to you");

  const doc = await Highlight.create({
    ownerId: user,
    title,
    coverStoryId: picked[0] ? new Types.ObjectId(picked[0]) : null,
    itemCount: picked.length,
    audit: auditSnapshot(req, user),
  });

  if (picked.length > 0) {
    const now = new Date();
    await HighlightItem.insertMany(
      picked.map((storyId) => ({
        highlightId: doc._id,
        storyId: new Types.ObjectId(storyId),
        addedAt: now,
      })),
      { ordered: false },
    ).catch(() => []); // a duplicate pair fails alone, the rest still go in
  }

  await recordAudit(req, {
    action: "highlight.create",
    entity: "highlights",
    entityId: String(doc._id),
    userId: user,
    status: 201,
  });
  await reply.code(201).send({
    highlight: {
      _id: String(doc._id),
      title,
      itemCount: picked.length,
      coverStoryId: picked[0] ?? null,
    },
  });
};

// GET /profiles/:username/highlights -> the profile tray, cover first.
export const list = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const ownerId = ((req.params as { username?: string }).username ?? "")
    .trim()
    .toLowerCase();
  if (!ownerId) throw httpError(400, "Invalid username");

  const rows = await Highlight.find({ ownerId })
    .sort({ _id: -1 })
    .limit(50)
    .lean();
  if (rows.length === 0) {
    await reply.send({ items: [] });
    return;
  }

  const ids = rows.map((row) => String(row._id));
  const [covers, cards] = await Promise.all([
    Story.find({
      _id: {
        $in: rows.map((row) => row.coverStoryId).filter((id) => id !== null),
      },
    })
      .select("type mediaUrl thumbnailUrl")
      .lean(),
    cardsByHighlight(ids, ownerId, user),
  ]);
  const coverById = new Map(covers.map((row) => [String(row._id), row]));

  await reply.send({
    items: rows.map((row) => {
      const cover = row.coverStoryId
        ? coverById.get(String(row.coverStoryId))
        : undefined;
      return {
        _id: String(row._id),
        title: row.title,
        itemCount: row.itemCount,
        cover: cover
          ? {
              type: cover.type,
              mediaUrl: cover.mediaUrl,
              thumbnailUrl: cover.thumbnailUrl ?? null,
            }
          : null,
        items: cards.get(String(row._id)) ?? [],
      };
    }),
  });
};

// GET /highlights/:id -> one highlight with its slides, in the order they were added.
export const get = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = idParam(req);
  const doc = await Highlight.findById(id).lean();
  if (!doc) throw httpError(404, "Highlight not found");

  const cards = await cardsByHighlight([id], doc.ownerId, user);
  await reply.send({
    highlight: {
      _id: String(doc._id),
      ownerId: doc.ownerId,
      title: doc.title,
      itemCount: doc.itemCount,
      items: cards.get(id) ?? [],
    },
  });
};

// POST /highlights/:id/items -> add one story to the list. $inc runs only when the pair is new,
// so adding the same story twice cannot inflate the count.
export const addItem = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = idParam(req);
  await ownHighlight(id, user);

  const storyId = String(
    (req.body as { storyId?: string } | undefined)?.storyId ?? "",
  ).toLowerCase();
  if (!OBJECT_ID.test(storyId)) throw httpError(400, "storyId is required");
  const story = await Story.findOne({
    _id: storyId,
    authorId: user,
    status: { $ne: "deleted" },
  })
    .select("_id")
    .lean();
  if (!story) throw httpError(404, "Story not found");

  const current = await HighlightItem.countDocuments({ highlightId: id });
  if (current >= MAX_ITEMS)
    throw httpError(400, `A highlight holds at most ${MAX_ITEMS} stories`);

  const result = await HighlightItem.updateOne(
    { highlightId: id, storyId },
    { $setOnInsert: { addedAt: new Date() } },
    { upsert: true },
  );
  const inserted = result.upsertedCount > 0;
  if (inserted) {
    await Highlight.updateOne(
      { _id: id },
      { $inc: { itemCount: 1 }, $set: { audit: auditSnapshot(req, user) } },
    );
  }

  await recordAudit(req, {
    action: "highlight.addItem",
    entity: "highlight_items",
    entityId: id,
    userId: user,
    status: inserted ? 201 : 200,
  });
  await reply.code(inserted ? 201 : 200).send({ added: inserted, storyId });
};

// DELETE /highlights/:id/items/:storyId -> remove one slide. The cover moves to the next story.
export const removeItem = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = idParam(req);
  const storyId = idParam(req, "storyId");
  const doc = await ownHighlight(id, user);

  const result = await HighlightItem.deleteOne({ highlightId: id, storyId });
  if (result.deletedCount === 0) {
    await reply.send({ removed: false, storyId });
    return;
  }

  const set: Record<string, unknown> = { audit: auditSnapshot(req, user) };
  if (String(doc.coverStoryId ?? "") === storyId) {
    const next = await HighlightItem.findOne({ highlightId: id })
      .sort({ _id: 1 })
      .lean();
    set.coverStoryId = next ? next.storyId : null;
  }

  await Highlight.updateOne(
    { _id: id },
    { $inc: { itemCount: -1 }, $set: set },
  );
  await recordAudit(req, {
    action: "highlight.removeItem",
    entity: "highlight_items",
    entityId: id,
    userId: user,
    status: 200,
  });
  await reply.send({ removed: true, storyId });
};

// DELETE /highlights/:id -> a highlight has no audit value of its own, the events stay in audit_events.
export const remove = async (
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const user = requireUser(req);
  const id = idParam(req);
  await ownHighlight(id, user);

  await Promise.all([
    Highlight.deleteOne({ _id: id }),
    HighlightItem.deleteMany({ highlightId: id }),
  ]);
  await recordAudit(req, {
    action: "highlight.delete",
    entity: "highlights",
    entityId: id,
    userId: user,
    status: 200,
  });
  await reply.send({ deleted: true, highlightId: id });
};
