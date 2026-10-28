import { Client } from "typesense";
import { env } from "./env.js";
import { logger } from "./logger.js";

const url = new URL(env.typesenseUrl);
const protocol = url.protocol === "https:" ? "https" : "http";

export const typesense = new Client({
  nodes: [{ host: url.hostname, port: Number(url.port || (protocol === "https" ? 443 : 80)), protocol }],
  apiKey: env.typesenseApiKey,
  connectionTimeoutSeconds: 10,
  numRetries: 1,
  logLevel: "warn",
});

// .env.test sets TYPESENSE_COLLECTION_PREFIX=test_, so tests never touch dev search data
export const tsNames = {
  /** Alias the app searches. It points at products__<model>__<dims>__<time>, swapped by pnpm reindex. */
  productsAlias: `${env.typesensePrefix}products`,
  productsCollectionPrefix: `${env.typesensePrefix}products__`,
  /** One collection per vector size, so a new embedding model never mixes with old vectors */
  queriesCollection: (dims: number): string => `${env.typesensePrefix}search_queries__${dims}`,
  synonymSet: `${env.typesensePrefix}grocery-synonyms`,
};

let ready = false;
export const isTypesenseReady = (): boolean => ready;

const RECHECK_MS = 10_000;

// Typesense down must not block startup: search answers 503 until it is back.
export const connectTypesense = async (): Promise<void> => {
  const check = async (): Promise<void> => {
    try {
      const health = await typesense.health.retrieve();
      if (!ready && health.ok) logger.info("Typesense ready");
      ready = Boolean(health.ok);
    } catch {
      if (ready) logger.warn("Typesense unreachable, search answers 503 until it is back");
      ready = false;
    }
  };
  await check();
  if (!ready) logger.warn(`Typesense not reachable at ${env.typesenseUrl}. Start it with: pnpm typesense:up`);
  setInterval(() => void check(), RECHECK_MS).unref();
};
