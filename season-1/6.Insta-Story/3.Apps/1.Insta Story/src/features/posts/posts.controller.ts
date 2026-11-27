import type { FastifyReply, FastifyRequest } from "fastify";
import { Post } from "./posts.model.js";
import { Comment } from "../comments/comments.model.js";
import { httpError } from "../../shared/error.js";
import { attachStats } from "./posts.stats.js";
import { parseLimit } from "../../shared/pagination.js";
import { optionalUser } from "../../shared/user.js";

const queryOf = (req: FastifyRequest): Record<string, unknown> => req.query as Record<string, unknown>;
const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// newest first, so the cursor is "everything older than this _id". A bad cursor is a CastError, errorHandler turns it into 400.
const olderThan = (cursor: unknown): Record<string, unknown> => {
  const c = str(cursor);
  return c ? { _id: { $lt: c } } : {};
};

const nextCursor = (items: Array<{ _id: unknown }>, limit: number): string | null =>
  items.length < limit ? null : String(items[items.length - 1]._id);

const listBy = async (req: FastifyRequest, reply: FastifyReply, type?: "post" | "reel"): Promise<void> => {
  const query = queryOf(req);
  const limit = parseLimit(query.limit);
  const authorId = str(query.authorId)?.toLowerCase();
  const wanted = type ?? str(query.type);
  if (wanted && wanted !== "post" && wanted !== "reel") throw httpError(400, "type must be post or reel");

  const filter: Record<string, unknown> = {
    ...(authorId ? { authorId } : {}),
    ...(wanted ? { type: wanted } : {}),
    ...olderThan(query.cursor),
  };
  const items = await Post.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .lean();
  await reply.send({ items: await attachStats(items, optionalUser(req)), nextCursor: nextCursor(items, limit) });
};

// GET /posts?authorId=&type=&cursor=&limit=
export const list = (req: FastifyRequest, reply: FastifyReply): Promise<void> => listBy(req, reply);

// GET /reels?authorId=&cursor=&limit=
export const listReels = (req: FastifyRequest, reply: FastifyReply): Promise<void> => listBy(req, reply, "reel");

export const getById = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const post = await Post.findById(idOf(req)).lean();
  if (!post) throw httpError(404, "Post not found");
  const [withStats] = await attachStats([post], optionalUser(req));
  await reply.send(withStats);
};

// GET /posts/:id/comments?cursor=&limit=
export const listComments = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const query = queryOf(req);
  const limit = parseLimit(query.limit);
  const items = await Comment.find({ postId: idOf(req), ...olderThan(query.cursor) })
    .sort({ _id: -1 })
    .limit(limit)
    .lean();
  await reply.send({ items, nextCursor: nextCursor(items, limit) });
};
