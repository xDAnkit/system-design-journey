import type { FastifyPluginAsync } from "fastify";
import * as controller from "./posts.controller.js";

export const postsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /posts:
   *   get:
   *     summary: List posts and reels, newest first (cursor pagination)
   *     tags: [Posts]
   *     parameters:
   *       - { in: query, name: authorId, schema: { type: string }, description: Profile username }
   *       - { in: query, name: type, schema: { type: string, enum: [post, reel] } }
   *       - { in: query, name: cursor, schema: { type: string }, description: Last _id from the previous page }
   *       - { in: query, name: limit, schema: { type: integer, maximum: 100, default: 20 } }
   *     responses:
   *       200: { description: "{ items, nextCursor }" }
   */
  app.get("/", controller.list);

  /**
   * @openapi
   * /posts/{id}:
   *   get:
   *     summary: One post or reel
   *     tags: [Posts]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: Post }
   *       404: { description: Post not found }
   */
  app.get("/:id", controller.getById);

  /**
   * @openapi
   * /posts/{id}/comments:
   *   get:
   *     summary: Comments of a post, newest first (cursor pagination)
   *     tags: [Posts]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *       - { in: query, name: cursor, schema: { type: string } }
   *       - { in: query, name: limit, schema: { type: integer, maximum: 100, default: 20 } }
   *     responses:
   *       200: { description: "{ items, nextCursor }" }
   */
  app.get("/:id/comments", controller.listComments);
};

export const reelsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /reels:
   *   get:
   *     summary: List reels only, newest first (cursor pagination)
   *     tags: [Reels]
   *     parameters:
   *       - { in: query, name: authorId, schema: { type: string } }
   *       - { in: query, name: cursor, schema: { type: string } }
   *       - { in: query, name: limit, schema: { type: integer, maximum: 100, default: 20 } }
   *     responses:
   *       200: { description: "{ items, nextCursor }" }
   */
  app.get("/", controller.listReels);
};
