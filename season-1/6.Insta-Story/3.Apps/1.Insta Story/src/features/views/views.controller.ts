import type { FastifyReply, FastifyRequest } from "fastify";
import { Post } from "../posts/posts.model.js";
import { TOPIC_VIEWS, sendEvent } from "../../bootstrap/kafka.js";
import { httpError } from "../../shared/error.js";
import { requireUser } from "../../shared/user.js";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

// The page calls this when a post is opened. Listing a grid does not count as a view.
export const view = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const userId = requireUser(req);
  const postId = (req.params as { id: string }).id.toLowerCase();
  if (!OBJECT_ID.test(postId)) throw httpError(400, "Invalid post id");
  if (!(await Post.exists({ _id: postId }))) throw httpError(404, "Post not found");

  await sendEvent(TOPIC_VIEWS, `${postId}:${userId}`, { postId, userId });
  await reply.code(202).send({ accepted: true });
};
