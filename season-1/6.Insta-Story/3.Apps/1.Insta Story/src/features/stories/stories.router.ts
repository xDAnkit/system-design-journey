import type { FastifyPluginAsync } from "fastify";
import * as controller from "./stories.controller.js";
import * as media from "./media.controller.js";

// A composed 1080x1920 JPEG is base64 encoded, so this route needs its own, larger body limit.
const MEDIA_BODY_LIMIT = 12 * 1024 * 1024;

const storiesRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /stories/media:
   *   post:
   *     summary: Upload a composed story image (base64 data URL), returns a public path
   *     tags: [Stories]
   *     parameters:
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [dataUrl]
   *             properties:
   *               dataUrl: { type: string, description: "data:image/jpeg;base64,..." }
   *     responses:
   *       201: { description: "{ url, bytes }" }
   *       413: { description: Larger than 6 MB after composition }
   */
  app.post("/media", { bodyLimit: MEDIA_BODY_LIMIT }, media.upload);

  /**
   * @openapi
   * /stories:
   *   post:
   *     summary: Create a story (live for 24 hours)
   *     tags: [Stories]
   *     parameters:
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [type, mediaUrl]
   *             properties:
   *               type: { type: string, enum: [image, video] }
   *               mediaUrl: { type: string }
   *               thumbnailUrl: { type: string }
   *               caption: { type: string, maxLength: 500 }
   *               audience: { type: string, enum: [public, followers] }
   *     responses:
   *       201: { description: "{ story }" }
   */
  app.post("/", controller.create);

  /**
   * @openapi
   * /stories/feed:
   *   get:
   *     summary: Story tray for the caller, grouped by author
   *     tags: [Stories]
   *     parameters:
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "{ items: [{ authorId, displayName, avatarUrl, verified, hasUnseen, stories }] }" }
   */
  app.get("/feed", controller.feed);

  /**
   * @openapi
   * /stories/{id}:
   *   get:
   *     summary: One live story (tombstone, cache, then Mongo)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: Story with views and uniqueViews }
   *       403: { description: Followers only }
   *       404: { description: Not found, deleted or expired }
   */
  app.get("/:id", controller.open);

  /**
   * @openapi
   * /stories/{id}/view:
   *   post:
   *     summary: Count a view (Kafka, 202)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: "{ accepted, counted }" }
   *       404: { description: Not found or expired }
   */
  app.post("/:id/view", controller.view);

  /**
   * @openapi
   * /stories/{id}:
   *   patch:
   *     summary: Edit caption or media inside the 15 minute window (owner only)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               caption: { type: string, maxLength: 500 }
   *               mediaUrl: { type: string }
   *               thumbnailUrl: { type: string }
   *     responses:
   *       200: { description: "{ story }" }
   *       400: { description: Edit window closed }
   *       403: { description: Not the author }
   *   delete:
   *     summary: Soft delete, hidden at once, the row stays for audit (owner only)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "{ deleted, storyId }" }
   */
  app.patch("/:id", controller.edit);
  app.delete("/:id", controller.remove);

  /**
   * @openapi
   * /stories/{id}/like:
   *   post:
   *     summary: Like a story (Kafka, 202)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: "{ accepted }" }
   *   delete:
   *     summary: Remove the like (Kafka, 202)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: "{ accepted }" }
   */
  app.post("/:id/like", controller.like);
  app.delete("/:id/like", controller.unlike);

  /**
   * @openapi
   * /stories/{id}/reply:
   *   post:
   *     summary: Send a private reply to the author (kept after expiry)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [text]
   *             properties:
   *               text: { type: string, minLength: 1, maxLength: 500 }
   *     responses:
   *       201: { description: "{ reply }" }
   */
  app.post("/:id/reply", controller.reply);

  /**
   * @openapi
   * /stories/{id}/replies:
   *   get:
   *     summary: Author's reply list, oldest first (owner only)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *       - { in: query, name: cursor, schema: { type: string } }
   *       - { in: query, name: limit, schema: { type: integer } }
   *     responses:
   *       200: { description: "{ items, nextCursor }" }
   */
  app.get("/:id/replies", controller.replies);

  /**
   * @openapi
   * /stories/{id}/viewers:
   *   get:
   *     summary: Viewer list inside 48 hours, optional name search (owner only)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *       - { in: query, name: q, schema: { type: string } }
   *       - { in: query, name: limit, schema: { type: integer } }
   *     responses:
   *       200: { description: "{ items: [{ viewerId, firstViewedAt, lastViewedAt, watchCount }] }" }
   */
  app.get("/:id/viewers", controller.viewers);

  /**
   * @openapi
   * /stories/{id}/extend:
   *   post:
   *     summary: Extend to 48 hours, once, Meta One only (owner)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "{ story }" }
   *       403: { description: Meta One required }
   */
  app.post("/:id/extend", controller.extend);

  /**
   * @openapi
   * /stories/{id}/share:
   *   post:
   *     summary: Count a share (counter only in v1)
   *     tags: [Stories]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: header, name: x-user-id, required: true, schema: { type: string } }
   *     responses:
   *       202: { description: "{ accepted }" }
   */
  app.post("/:id/share", controller.share);
};

export default storiesRoutes;
