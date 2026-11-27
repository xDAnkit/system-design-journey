import type { FastifyPluginAsync } from "fastify";
import * as controller from "./highlights.controller.js";

// Mounted at /highlights
export const highlightsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /highlights:
   *   post:
   *     summary: Create a highlight from your own stories
   *     tags: [Highlights]
   *     parameters:
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [title]
   *             properties:
   *               title: { type: string, maxLength: 50 }
   *               storyIds:
   *                 type: array
   *                 items: { type: string }
   *     responses:
   *       201: { description: "{ highlight }" }
   */
  app.post("/", controller.create);

  /**
   * @openapi
   * /highlights/{id}:
   *   get:
   *     summary: One highlight with its slides
   *     tags: [Highlights]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "{ highlight }" }
   *   delete:
   *     summary: Delete a highlight and its items (owner only)
   *     tags: [Highlights]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "{ deleted, highlightId }" }
   */
  app.get("/:id", controller.get);
  app.delete("/:id", controller.remove);

  /**
   * @openapi
   * /highlights/{id}/items:
   *   post:
   *     summary: Add one of your stories to a highlight (owner only)
   *     tags: [Highlights]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [storyId]
   *             properties:
   *               storyId: { type: string }
   *     responses:
   *       201: { description: "{ added: true, storyId }" }
   *       200: { description: Already in the list }
   */
  app.post("/:id/items", controller.addItem);

  /**
   * @openapi
   * /highlights/{id}/items/{storyId}:
   *   delete:
   *     summary: Remove one slide from a highlight (owner only)
   *     tags: [Highlights]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: path, name: storyId, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "{ removed, storyId }" }
   */
  app.delete("/:id/items/:storyId", controller.removeItem);
};

// Mounted at /profiles, next to the profile routes
export const profileHighlightsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /profiles/{username}/highlights:
   *   get:
   *     summary: Highlight tray for a profile, cover first
   *     tags: [Highlights]
   *     parameters:
   *       - { in: path, name: username, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "{ items: [{ _id, title, itemCount, cover, items }] }" }
   */
  app.get("/:username/highlights", controller.list);
};

export default highlightsRoutes;
