import type { FastifyReply, FastifyRequest } from "fastify";
import { Profile } from "../profiles/profiles.model.js";
import { TOPIC_FOLLOWS, sendEvent } from "../../bootstrap/kafka.js";
import { httpError } from "../../shared/error.js";
import { requireUser } from "../../shared/user.js";

// Key = follower:followee, so one pair's follow and unfollow stay in order, while a celebrity's millions of followers spread over partitions.
const publish = async (req: FastifyRequest, reply: FastifyReply, action: "follow" | "unfollow"): Promise<void> => {
  const followerId = requireUser(req);
  const followeeId = (req.params as { username: string }).username.toLowerCase();
  if (followerId === followeeId) throw httpError(400, "You cannot follow yourself");
  if (!(await Profile.exists({ username: followeeId }))) throw httpError(404, "Profile not found");

  await sendEvent(TOPIC_FOLLOWS, `${followerId}:${followeeId}`, { action, followerId, followeeId });
  await reply.code(202).send({ accepted: true });
};

export const follow = (req: FastifyRequest, reply: FastifyReply): Promise<void> => publish(req, reply, "follow");
export const unfollow = (req: FastifyRequest, reply: FastifyReply): Promise<void> => publish(req, reply, "unfollow");
