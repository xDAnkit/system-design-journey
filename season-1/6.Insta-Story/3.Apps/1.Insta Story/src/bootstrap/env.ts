import dotenv from "dotenv";
import { z } from "zod";

// NODE_ENV=test (set by the caller/pm2 env, before this file runs) loads .env.test
// instead of .env - a persistent, separate DB/port for repeatable perf/functional
// testing without ever touching the main .env or its database.
dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5003),
  // z.string().url() rejects replica URIs — comma-separated hosts are not a WHATWG URL
  MONGO_URI: z
    .string()
    .min(1)
    .refine(
      (v) => v.startsWith("mongodb://") || v.startsWith("mongodb+srv://"),
      {
        message: "MONGO_URI must start with mongodb:// or mongodb+srv://",
      },
    )
    .default(
      "mongodb://127.0.0.1:27017,127.0.0.1:27018,127.0.0.1:27019/instagram",
    ),
  // auto = probe the hosts and adapt (dev/test). A fixed value is probed too and must match,
  // otherwise startup fails. Production must pin replica or sharded (checked below).
  MONGO_MODE: z
    .enum(["auto", "standalone", "replica", "sharded"])
    .default("auto"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  // comma separated host:port list
  KAFKA_BROKERS: z.string().min(1).default("127.0.0.1:9092"),
  KAFKA_CLIENT_ID: z.string().min(1).default("insta-stats"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
  // z.coerce.boolean() would treat the literal string "false" as truthy - explicit
  // enum + transform avoids that footgun. Opt-in (needs Node 22.15+ for zlib zstd).
  ENABLE_ZSTD: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // 1 = fastest, least CPU. Higher = smaller body, more CPU.
  // gzip uses 1-9, brotli 0-11, zstd 1-19. One number, each codec clamps it.
  COMPRESSION_LEVEL: z.coerce.number().int().min(1).max(19).default(1),
  // no default on either secret - a leaked/forgotten one must fail startup, not silently sign tokens
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("6h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  MONGO_CIRCUIT_MS: z.coerce.number().int().positive().default(2000),
  MONGO_CIRCUIT_FAILS: z.coerce.number().int().positive().default(3),
  MONGO_SELECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // Connection pool PER WORKER (and per Mongo member). Rule of thumb: total across workers about
  // 2-4x the Mongo CPU cores. More than that adds threads, not speed. Min pre-warms connections so a
  // sudden load spike does not wait on the driver opening them 2 at a time.
  // 50 per worker measured best (4 workers, 3000 users): 10 -> 30 gave +15%, 30 -> 50 +28%, 50 -> 80 only +4%.
  MONGO_MAX_POOL: z.coerce.number().int().min(1).max(500).default(50),
  MONGO_MIN_POOL: z.coerce.number().int().min(0).max(500).default(10),
  // audit: salt keeps ipHash stable but not reversible without this value. Rotating it breaks
  // long-term correlation on purpose, so treat it like a secret and keep it in .env only.
  AUDIT_SALT: z.string().min(8).default("insta-story-audit"),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  // optional local IP table for geo. Empty = geo stays null, nothing else changes.
  GEO_DB_PATH: z.string().default(""),
  // behind nginx the client IP arrives in X-Forwarded-For. The socket peer is stored too,
  // so a spoofed header is visible instead of silent.
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment configuration:",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

// payment data: never let production silently fall back to a node without majority writes
if (
  parsed.data.NODE_ENV === "production" &&
  !["replica", "sharded"].includes(parsed.data.MONGO_MODE)
) {
  console.error(
    "Invalid environment configuration: MONGO_MODE must be replica or sharded in production",
  );
  process.exit(1);
}

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  mongoUri: parsed.data.MONGO_URI,
  mongoMode: parsed.data.MONGO_MODE,
  redisUrl: parsed.data.REDIS_URL,
  kafkaBrokers: parsed.data.KAFKA_BROKERS.split(",").map((b) => b.trim()),
  kafkaClientId: parsed.data.KAFKA_CLIENT_ID,
  logLevel: parsed.data.LOG_LEVEL,
  isProd: parsed.data.NODE_ENV === "production",
  enableZstd: parsed.data.ENABLE_ZSTD,
  compressionLevel: parsed.data.COMPRESSION_LEVEL,
  jwtAccessSecret: parsed.data.JWT_ACCESS_SECRET,
  jwtRefreshSecret: parsed.data.JWT_REFRESH_SECRET,
  jwtAccessExpiresIn: parsed.data.JWT_ACCESS_EXPIRES_IN,
  jwtRefreshExpiresIn: parsed.data.JWT_REFRESH_EXPIRES_IN,
  mongoCircuitMs: parsed.data.MONGO_CIRCUIT_MS,
  mongoCircuitFails: parsed.data.MONGO_CIRCUIT_FAILS,
  mongoSelectTimeoutMs: parsed.data.MONGO_SELECT_TIMEOUT_MS,
  mongoMaxPool: parsed.data.MONGO_MAX_POOL,
  auditSalt: parsed.data.AUDIT_SALT,
  auditRetentionDays: parsed.data.AUDIT_RETENTION_DAYS,
  geoDbPath: parsed.data.GEO_DB_PATH,
  trustProxy: parsed.data.TRUST_PROXY,
  // min can never exceed max, the driver rejects that
  mongoMinPool: Math.min(
    parsed.data.MONGO_MIN_POOL,
    parsed.data.MONGO_MAX_POOL,
  ),
};
