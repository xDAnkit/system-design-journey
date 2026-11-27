import type { FastifyPluginAsync } from "fastify";
import * as controller from "./likes.controller.js";

// registered under the /posts prefix
const likesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /posts/{id}/like:
   *   post:
   *     summary: Like a post or reel. Goes to Kafka, so the count updates a moment later
   *     tags: [Likes]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: Accepted }
   *       400: { description: Bad post id or missing x-user-id }
   *       404: { description: Post not found }
   *       503: { description: Kafka not available }
   */
  app.post("/:id/like", controller.like);

  /**
   * @openapi
   * /posts/{id}/like:
   *   delete:
   *     summary: Remove your like
   *     tags: [Likes]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: Accepted }
   *       400: { description: Bad post id or missing x-user-id }
   *       404: { description: Post not found }
   *       503: { description: Kafka not available }
   */
  app.delete("/:id/like", controller.unlike);
};

export default likesRoutes;
