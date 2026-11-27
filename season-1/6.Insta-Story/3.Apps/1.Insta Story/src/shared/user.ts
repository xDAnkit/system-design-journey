import type { FastifyRequest } from "fastify";
import { httpError } from "./error.js";

// No login. The caller says who they are in the x-user-id header, which is enough to tell users apart.
const USER_ID = /^[a-z0-9._-]{1,64}$/;

// for reads that work without a user but show more with one (isLiked, isFollowing)
export const optionalUser = (req: FastifyRequest): string | null => (req.headers["x-user-id"] ? requireUser(req) : null);

export const requireUser = (req: FastifyRequest): string => {
  const raw = req.headers["x-user-id"];
  const id = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (!id || !USER_ID.test(id)) throw httpError(400, "x-user-id header required (letters, digits, . _ -)");
  return id;
};
