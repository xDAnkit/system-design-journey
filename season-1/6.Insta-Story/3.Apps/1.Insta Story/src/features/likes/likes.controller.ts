import type { FastifyReply, FastifyRequest } from "fastify";
import { Post } from "../posts/posts.model.js";
import { TOPIC_LIKES, sendEvent } from "../../bootstrap/kafka.js";
import { httpError } from "../../shared/error.js";
import { requireUser } from "../../shared/user.js";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// The API only checks the request and drops an event on Kafka. The consumer does the real work.
// Key = postId:userId, so one user's like and unlike of a post stay in order, while a hot post still spreads over partitions.
const publish = async (req: FastifyRequest, reply: FastifyReply, action: "like" | "unlike"): Promise<void> => {
  const userId = requireUser(req);
  const postId = (req.params as { id: string }).id.toLowerCase();
  if (!OBJECT_ID.test(postId)) throw httpError(400, "Invalid post id");
  if (!(await Post.exists({ _id: postId }))) throw httpError(404, "Post not found");

  await sendEvent(TOPIC_LIKES, `${postId}:${userId}`, { action, postId, userId });
  await reply.code(202).send({ accepted: true });
};

export const like = (req: FastifyRequest, reply: FastifyReply): Promise<void> => publish(req, reply, "like");
export const unlike = (req: FastifyRequest, reply: FastifyReply): Promise<void> => publish(req, reply, "unlike");
