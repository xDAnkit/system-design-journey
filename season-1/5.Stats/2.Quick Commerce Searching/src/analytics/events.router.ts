import type { FastifyPluginAsync } from "fastify";
import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../bootstrap/env.js";
import { rateLimit } from "../shared/rate-limit.js";
import { normalizeQuery } from "../shared/text.js";
import { parse } from "../shared/validate.js";
import { eventLocation, publishEvent, sessionOf } from "./events.publish.js";

// Public route: anyone can call it, so every field is checked and the rate limit stops click floods
// (fake clicks could otherwise push an AI suggested tag live).
const eventBody = z.object({
  type: z.enum(["click", "add"]),
  q: z.string().max(120).default(""),
  productId: z.string().refine((id) => Types.ObjectId.isValid(id), "invalid product id"),
  position: z.number().int().min(1).max(100),
  sessionId: z.string().max(64).optional(),
  pincode: z.string().regex(/^\d{6}$/).optional(),
  storeId: z.string().max(40).optional(),
});

const eventsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", rateLimit("events", env.rateLimitEventsPerMin));

  /**
   * @openapi
   * /events:
   *   post:
   *     summary: Click or ADD on a search result. Queued on Kafka, answers 202.
   *     tags: [Analytics]
   */
  app.post("/", async (req, reply) => {
    const body = parse(eventBody, req.body);
    const { city, pincode, storeId } = eventLocation(body);
    publishEvent({
      city,
      pincode,
      storeId,
      type: body.type,
      ts: new Date().toISOString(),
      sessionId: sessionOf(req, body.sessionId),
      q: body.q.trim(),
      qNorm: normalizeQuery(body.q),
      productId: body.productId,
      position: body.position,
    });
    return reply.code(202).send({ accepted: true });
  });
};

export default eventsRoutes;
