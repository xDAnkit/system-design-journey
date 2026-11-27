import type { FastifyReply, FastifyRequest } from "fastify";
import { isIngestPost } from "../features/products/products.ingest.js";

export const REQUEST_TIMEOUT_MS = 30_000;

// Plain setTimeout, not the socket timeout. Keep-alive reuses the socket, so a
// stale socket timer could fire after a later response already finished.
// This does not cancel in-flight work (a stuck DB query keeps running).
export const armRequestTimeout = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  if (isIngestPost(req)) return;

  const timer = setTimeout(() => {
    if (!reply.sent) reply.code(503).send({ error: "Request timed out" });
  }, REQUEST_TIMEOUT_MS);

  const clear = (): void => clearTimeout(timer);
  reply.raw.once("finish", clear);
  reply.raw.once("close", clear);
};
