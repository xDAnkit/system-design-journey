import { readFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import analyticsRouter from "./analytics/analytics.router.js";
import eventsRouter from "./analytics/events.router.js";
import { isKafkaReady } from "./bootstrap/kafka.js";
import { logger } from "./bootstrap/logger.js";
import { getMongoTopology } from "./bootstrap/mongo-topology.js";
import { redisClient } from "./bootstrap/redis.js";
import { isTypesenseReady } from "./bootstrap/typesense.js";
import { swaggerSpec } from "./docs/swagger.js";
import productsRouter from "./features/products/products.router.js";
import settingsRouter from "./features/settings/settings.router.js";
import locationsRouter from "./locations/locations.router.js";
import searchRouter from "./search/search.router.js";
import { errorHandler } from "./shared/error.js";
import { mongoGate } from "./shared/mongo-gate.js";
import { armRequestTimeout } from "./shared/timeout.js";

const BODY_LIMIT = 100 * 1024;
const PUBLIC = path.join(process.cwd(), "public");

export const buildApp = async () => {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT });

  // Must be set before any plugin registers: child plugins copy the handler at register time.
  app.setErrorHandler(errorHandler);

  await app.register(cors);
  // search answers are JSON lists of a few KB: fast compression levels, skip tiny bodies
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ["br", "gzip"],
    brotliOptions: { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } },
    zlibOptions: { level: 1 },
  });

  app.addHook("onRequest", armRequestTimeout);
  app.addHook("onResponse", async (req, reply) => {
    if (req.url.startsWith("/assets/")) return;
    logger.http(`${req.method} ${req.url} ${reply.statusCode}`);
  });

  // UI: two pages, the browser picks the view from the URL. Read on every request so edits show without a restart.
  const page = (file: string) => async (_req: unknown, reply: FastifyReply) => reply.type("text/html; charset=utf-8").send(await readFile(path.join(PUBLIC, file), "utf8"));
  app.get("/", page("index.html"));
  app.get("/admin", page("admin.html"));
  app.get("/admin/*", page("admin.html"));
  await app.register(fastifyStatic, { root: path.join(PUBLIC, "assets"), prefix: "/assets/" });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async (_req, reply) => {
    const mongo = getMongoTopology();
    const ready = mongo.reads && isTypesenseReady();
    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      mongo: mongo.connected ? "connected" : "disconnected",
      membersUp: `${mongo.membersUp}/${mongo.membersTotal}`,
      typesense: isTypesenseReady() ? "up" : "down",
      kafka: isKafkaReady() ? "up" : "down",
      redis: redisClient.isReady ? "up" : "down",
    });
  });

  await app.register(swagger, { mode: "static", specification: { document: swaggerSpec as never } });
  await app.register(swaggerUi, { routePrefix: "/api-docs" });

  // search and events need Typesense / Kafka, not Mongo: no Mongo gate in front of them
  await app.register(searchRouter, { prefix: "/search" });
  await app.register(eventsRouter, { prefix: "/events" });
  await app.register(locationsRouter, { prefix: "/locations" });

  await app.register(async (api) => {
    api.addHook("onRequest", mongoGate);
    await api.register(productsRouter, { prefix: "/products" });
    await api.register(analyticsRouter, { prefix: "/analytics" });
    await api.register(settingsRouter, { prefix: "/settings" });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: `Route ${req.method} ${req.url} not found` });
  });

  return app;
};

const app = await buildApp();
export default app;
