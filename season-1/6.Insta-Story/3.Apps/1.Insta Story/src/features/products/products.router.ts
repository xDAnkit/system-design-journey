import type { FastifyPluginAsync } from "fastify";
import * as controller from "./products.controller.js";

const productsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * @openapi
   * /products:
   *   get:
   *     summary: List products - supports both offset (page/limit) and cursor pagination
   *     tags: [Products]
   *     parameters:
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1 }
   *         description: If given, uses offset pagination - response includes totalItems/totalPages
   *       - in: query
   *         name: cursor
   *         schema: { type: string }
   *         description: Last _id from the previous page - ignored if "page" is given
   *       - in: query
   *         name: name
   *         schema: { type: string }
   *         description: Word search on product name (text index)
   *       - in: query
   *         name: limit
   *         schema: { type: integer, maximum: 100, default: 20 }
   *       - in: query
   *         name: category
   *         schema: { type: string }
   *     responses:
   *       200: { description: Paginated product list (shape depends on page vs cursor mode) }
   *       500: { description: Something went wrong. Please try again later. }
   */
  app.get("/", controller.list);

  /**
   * @openapi
   * /products/ingest/stats:
   *   get:
   *     summary: Per-worker ingest buffer stats (cluster me ek worker)
   *     tags: [Products]
   *     responses:
   *       200: { description: accepted queued flushed failed }
   */
  app.get("/ingest/stats", controller.ingestStats);

  /**
   * @openapi
   * /products/ingest:
   *   post:
   *     summary: Fire-and-forget product ingest (202, 300ms insertMany)
   *     tags: [Products]
   *     responses:
   *       202: { description: Accepted into worker buffer }
   *       400: { description: Validation error }
   */
  app.post("/ingest", controller.ingest);

  /**
   * @openapi
   * /products/{id}:
   *   get:
   *     summary: Get product by id
   *     tags: [Products]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Product }
   *       404: { description: Not found }
   */
  app.get("/:id", controller.getById);

  /**
   * @openapi
   * /products:
   *   post:
   *     summary: Create product
   *     tags: [Products]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, description, price, stock, category, imageUrl]
   *             properties:
   *               name: { type: string }
   *               description: { type: string }
   *               price: { type: number }
   *               stock: { type: integer }
   *               category: { type: string }
   *               imageUrl: { type: string }
   *     responses:
   *       201: { description: Created }
   *       400: { description: Validation error }
   */
  app.post("/", controller.create);

  /**
   * @openapi
   * /products/{id}:
   *   put:
   *     summary: Update product
   *     tags: [Products]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated }
   *       404: { description: Not found }
   */
  app.put("/:id", controller.update);

  /**
   * @openapi
   * /products/{id}:
   *   delete:
   *     summary: Delete product
   *     tags: [Products]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Deleted }
   *       404: { description: Not found }
   */
  app.delete("/:id", controller.remove);
};

export default productsRoutes;
