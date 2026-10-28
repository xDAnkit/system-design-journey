import type { FastifyPluginAsync } from "fastify";
import { requireAdmin } from "../../shared/admin-auth.js";
import * as controller from "./products.controller.js";

const productsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /products/categories:
   *   get:
   *     summary: Aisles and categories (shop chips, admin category dropdown)
   *     tags: [Products]
   */
  app.get("/categories", controller.categories);

  /**
   * @openapi
   * /products:
   *   get:
   *     summary: List products, cursor pagination (?cursor=&limit=&category=)
   *     tags: [Products]
   */
  app.get("/", controller.list);

  /**
   * @openapi
   * /products/{id}:
   *   get:
   *     summary: One product with its tags
   *     tags: [Products]
   */
  app.get("/:id", controller.getById);

  /**
   * @openapi
   * /products/preview-tags:
   *   post:
   *     summary: Tags for a title without saving (mode rules = instant, full = KB + LLM). Admin key.
   *     tags: [Products]
   */
  app.post("/preview-tags", { onRequest: requireAdmin }, controller.previewTags);

  /**
   * @openapi
   * /products:
   *   post:
   *     summary: Add a product. Queued on Kafka, answers 202 with the new id. Admin key.
   *     tags: [Products]
   */
  app.post("/", { onRequest: requireAdmin }, controller.create);

  /**
   * @openapi
   * /products/{id}:
   *   put:
   *     summary: Change a product. Price / stock changes skip the AI step. Admin key.
   *     tags: [Products]
   */
  app.put("/:id", { onRequest: requireAdmin }, controller.update);

  /**
   * @openapi
   * /products/{id}:
   *   delete:
   *     summary: Delete a product from Mongo and Typesense. Admin key.
   *     tags: [Products]
   */
  app.delete("/:id", { onRequest: requireAdmin }, controller.remove);
};

export default productsRoutes;
