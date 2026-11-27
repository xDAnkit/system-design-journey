import type { FastifyRequest } from "fastify";
import { verifyAccessToken } from "./jwt.js";
import { isSessionValid } from "./session.js";
import { httpError } from "./error.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; jti: string };
  }
}

export const requireAuth = async (req: FastifyRequest): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw httpError(401, "Missing bearer token");

  const payload = verifyAccessToken(header.slice("Bearer ".length));

  const valid = await isSessionValid(payload.jti);
  if (!valid) throw httpError(401, "Session has been revoked or expired");

  req.user = { id: payload.sub, jti: payload.jti };
};
