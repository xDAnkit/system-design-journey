import type { FastifyPluginAsync } from "fastify";
import * as controller from "./follows.controller.js";

// registered under the /profiles prefix
const followsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /profiles/{username}/follow:
   *   post:
   *     summary: Follow a profile. Goes to Kafka, so the counts update a moment later
   *     tags: [Follows]
   *     parameters:
   *       - { in: path, name: username, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: Accepted }
   *       400: { description: Missing x-user-id, or following yourself }
   *       404: { description: Profile not found }
   *       503: { description: Kafka not available }
   */
  app.post("/:username/follow", controller.follow);

  /**
   * @openapi
   * /profiles/{username}/follow:
   *   delete:
   *     summary: Unfollow a profile
   *     tags: [Follows]
   *     parameters:
   *       - { in: path, name: username, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: Accepted }
   *       400: { description: Missing x-user-id, or following yourself }
   *       404: { description: Profile not found }
   *       503: { description: Kafka not available }
   */
  app.delete("/:username/follow", controller.unfollow);
};

export default followsRoutes;
