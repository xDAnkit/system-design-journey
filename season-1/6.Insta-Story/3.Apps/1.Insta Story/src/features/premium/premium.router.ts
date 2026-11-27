import type { FastifyPluginAsync } from "fastify";
import * as controller from "./premium.controller.js";

const premiumRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /premium/{username}:
   *   get:
   *     summary: Meta One state for a username (owner only)
   *     tags: [Premium]
   *     parameters:
   *       - { in: path, name: username, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "{ username, active, tier, startedAt, cancelledAt, benefits }" }
   *       403: { description: Only your own plan }
   *   post:
   *     summary: Become Meta One (demo, no payment)
   *     tags: [Premium]
   *     parameters:
   *       - { in: path, name: username, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: Active plan }
   *       403: { description: Only your own plan }
   *       404: { description: Profile not found }
   *   delete:
   *     summary: Cancel Meta One
   *     tags: [Premium]
   *     parameters:
   *       - { in: path, name: username, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: Cancelled plan }
   *       403: { description: Only your own plan }
   *       404: { description: No plan to cancel }
   */
  app.get("/:username", controller.get);
  app.post("/:username", controller.activate);
  app.delete("/:username", controller.cancel);
};

export default premiumRoutes;
