import type { FastifyPluginAsync } from "fastify";
import { env } from "../bootstrap/env.js";
import { rateLimit } from "../shared/rate-limit.js";
import * as controller from "./search.controller.js";

const searchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", rateLimit("search", env.rateLimitSearchPerMin));

  /**
   * @openapi
   * /search:
   *   get:
   *     summary: Hybrid search (keyword + vector) in the shopper's dark store. ?q=&pincode=&category=&page=&ignore=
   *     tags: [Search]
   */
  app.get("/", controller.search);

  /**
   * @openapi
   * /search/suggest:
   *   get:
   *     summary: Typing suggestions, keyword prefix only. ?q=&pincode=
   *     tags: [Search]
   */
  app.get("/suggest", controller.suggest);

  /**
   * @openapi
   * /search/popular:
   *   get:
   *     summary: Empty search box. Trending categories in the city and popular products in the store; random ones until clicks tell (?pincode=)
   *     tags: [Search]
   */
  app.get("/popular", controller.popular);
};

export default searchRoutes;
