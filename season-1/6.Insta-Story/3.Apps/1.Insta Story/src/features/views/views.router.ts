import type { FastifyPluginAsync } from "fastify";
import * as controller from "./views.controller.js";

// registered under the /posts prefix
const viewsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /posts/{id}/view:
   *   post:
   *     summary: Count a view. Call it when a post or reel is opened. Goes to Kafka, so the counts update a moment later
   *     tags: [Views]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: Accepted }
   *       400: { description: Bad post id or missing x-user-id }
   *       404: { description: Post not found }
   *       503: { description: Kafka not available }
   */
  app.post("/:id/view", controller.view);
};

export default viewsRoutes;
