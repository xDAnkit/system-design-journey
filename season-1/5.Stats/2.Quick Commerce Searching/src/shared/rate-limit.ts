import type { FastifyReply, FastifyRequest } from "fastify";
import { redisClient } from "../bootstrap/redis.js";

/**
 * Fixed window per IP and minute, counted in Redis so every cluster worker shares it.
 * Fails open: if Redis is down, requests go through (search stays up).
 * ponytail: fixed window lets a burst of 2x through at the minute edge. Sliding window if that ever matters.
 */
export const rateLimit =
  (name: string, perMinute: number) =>
  async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
    if (!redisClient.isReady) return;
    const minute = Math.floor(Date.now() / 60_000);
    const key = `rl:${name}:${req.ip}:${minute}`;
    let count = 0;
    try {
      const [n] = await redisClient.multi().incr(key).expire(key, 70).exec();
      count = Number(n);
    } catch {
      return;
    }
    if (count > perMinute) {
      reply.header("Retry-After", String(60 - (Math.floor(Date.now() / 1000) % 60)));
      return reply.code(429).send({ error: "Too many requests, try again in a minute" });
    }
  };
