import type { FastifyPluginAsync } from "fastify";
import * as controller from "./profiles.controller.js";

const profilesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /profiles:
   *   get:
   *     summary: Profile cards, or a profile search when q is present
   *     tags: [Profiles]
   *     parameters:
   *       - { in: query, name: q, required: false, schema: { type: string }, description: "username prefix or displayName match" }
   *     responses:
   *       200: { description: "{ items }" }
   */
  app.get("/", controller.list);

  /**
   * @openapi
   * /profiles/{username}:
   *   get:
   *     summary: Profile card with postsCount
   *     tags: [Profiles]
   *     parameters:
   *       - { in: path, name: username, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: Profile }
   *       404: { description: Profile not found }
   */
  app.get("/:username", controller.getByUsername);
};

export default profilesRoutes;
