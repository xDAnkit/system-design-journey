import dotenv from "dotenv";
import { z } from "zod";

// NODE_ENV=test (set by the caller before this file runs) loads .env.test instead of .env:
// its own database, Redis DB, Kafka topic prefix and Typesense collection prefix.
dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

// "" in .env means "not set"
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
// z.coerce.boolean() treats the string "false" as true, so booleans are an explicit enum
const flag = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5003),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),

  // z.string().url() rejects replica URIs, comma-separated hosts are not a WHATWG URL
  MONGO_URI: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"), {
      message: "MONGO_URI must start with mongodb:// or mongodb+srv://",
    })
    // brew mongod, standalone. Own database, so no other project's data is touched.
    .default("mongodb://127.0.0.1:27017/blinkit"),
  // auto = probe the hosts and adapt (dev/test). A fixed value is probed too and must match,
  // otherwise startup fails. Production must pin replica or sharded (checked below).
  MONGO_MODE: z.enum(["auto", "standalone", "replica", "sharded"]).default("auto"),
  MONGO_CIRCUIT_MS: z.coerce.number().int().positive().default(2000),
  MONGO_CIRCUIT_FAILS: z.coerce.number().int().positive().default(3),
  MONGO_SELECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // Connection pool PER WORKER (and per Mongo member). 50 per worker measured best earlier.
  MONGO_MAX_POOL: z.coerce.number().int().min(1).max(500).default(50),
  MONGO_MIN_POOL: z.coerce.number().int().min(0).max(500).default(10),

  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),

  // comma separated host:port list. 9094 = this project's own broker (qc-kafka), not Insta's 9092.
  KAFKA_BROKERS: z.string().min(1).default("127.0.0.1:9094"),
  KAFKA_CLIENT_ID: z.string().min(1).default("qc-search"),
  // "test." in .env.test, so test events never reach the dev workers
  KAFKA_TOPIC_PREFIX: z.string().default(""),

  TYPESENSE_URL: z.string().url().default("http://127.0.0.1:8108"),
  TYPESENSE_API_KEY: z.string().min(1).default("qc-local-typesense-key"),
  TYPESENSE_COLLECTION_PREFIX: z.string().default(""),

  // Admin pages and admin APIs send it in the x-admin-key header. Required in production.
  ADMIN_KEY: optional(z.string().min(8)),

  // Hinglish -> native script rewrite before the vector step (background, cached in Redis)
  SEARCH_REWRITE: flag("true"),
  RATE_LIMIT_SEARCH_PER_MIN: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_EVENTS_PER_MIN: z.coerce.number().int().positive().default(300),

  // AI suggested tags: a vector-only match goes live after this many real clicks from different people
  SUGGEST_MIN_CLICKS: z.coerce.number().int().positive().default(3),
  SUGGEST_MIN_SESSIONS: z.coerce.number().int().positive().default(3),
  SUGGEST_MIN_CTR: z.coerce.number().min(0).max(1).default(0.2),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

const data = parsed.data;
const isProd = data.NODE_ENV === "production";

// never let production silently fall back to a node without majority writes
if (isProd && !["replica", "sharded"].includes(data.MONGO_MODE)) {
  console.error("Invalid environment configuration: MONGO_MODE must be replica or sharded in production");
  process.exit(1);
}
if (isProd && !data.ADMIN_KEY) {
  console.error("Invalid environment configuration: ADMIN_KEY is required in production");
  process.exit(1);
}

// ponytail: a fixed local key when ADMIN_KEY is empty, so every cluster worker agrees on it.
// Startup logs a warning. Production refuses to start without a real key (checked above).
export const DEV_ADMIN_KEY = "dev-admin-key";

export const env = {
  nodeEnv: data.NODE_ENV,
  isProd,
  isTest: data.NODE_ENV === "test",
  port: data.PORT,
  logLevel: data.LOG_LEVEL,
  mongoUri: data.MONGO_URI,
  mongoMode: data.MONGO_MODE,
  mongoCircuitMs: data.MONGO_CIRCUIT_MS,
  mongoCircuitFails: data.MONGO_CIRCUIT_FAILS,
  mongoSelectTimeoutMs: data.MONGO_SELECT_TIMEOUT_MS,
  mongoMaxPool: data.MONGO_MAX_POOL,
  // min can never exceed max, the driver rejects that
  mongoMinPool: Math.min(data.MONGO_MIN_POOL, data.MONGO_MAX_POOL),
  redisUrl: data.REDIS_URL,
  kafkaBrokers: data.KAFKA_BROKERS.split(",").map((b) => b.trim()),
  kafkaClientId: data.KAFKA_CLIENT_ID,
  kafkaTopicPrefix: data.KAFKA_TOPIC_PREFIX,
  typesenseUrl: data.TYPESENSE_URL,
  typesenseApiKey: data.TYPESENSE_API_KEY,
  typesensePrefix: data.TYPESENSE_COLLECTION_PREFIX,
  adminKey: data.ADMIN_KEY ?? DEV_ADMIN_KEY,
  adminKeyIsDefault: !data.ADMIN_KEY,
  searchRewrite: data.SEARCH_REWRITE,
  rateLimitSearchPerMin: data.RATE_LIMIT_SEARCH_PER_MIN,
  rateLimitEventsPerMin: data.RATE_LIMIT_EVENTS_PER_MIN,
  suggestMinClicks: data.SUGGEST_MIN_CLICKS,
  suggestMinSessions: data.SUGGEST_MIN_SESSIONS,
  suggestMinCtr: data.SUGGEST_MIN_CTR,
};
