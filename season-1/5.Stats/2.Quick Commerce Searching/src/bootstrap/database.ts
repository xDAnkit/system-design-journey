import "./mongo-host-dns.js";
import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";
import {
  attachMongoTopologyMonitor,
  logMongoTopologyIfChanged,
  markMongoShuttingDown,
} from "./mongo-topology.js";
import { buildMongoUri, parseMongoUri, type ParsedMongoUri } from "./mongo-uri.js";

mongoose.set("strictQuery", true);
mongoose.set("bufferCommands", false);

type Mode = "standalone" | "replica" | "sharded";
type Probe = { mode: Mode; host: string; setName?: string };

// ponytail: fixed retry, not env vars. Make them env only if they ever need tuning per deploy.
const CONNECT_TRIES = 5;
const CONNECT_RETRY_MS = 2000;

class ModeMismatchError extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let connectionListenersBound = false;

const bindConnectionListeners = (): void => {
  if (connectionListenersBound) return;
  connectionListenersBound = true;
  mongoose.connection.on("error", (err: Error) => logger.error(`MongoDB connection error: ${err.message}`));
};

const base: ConnectOptions = {
  maxPoolSize: env.mongoMaxPool,
  minPoolSize: env.mongoMinPool,
  serverSelectionTimeoutMS: env.mongoSelectTimeoutMs,
  bufferCommands: false,
};

// standalone has no oplog: no retryable writes, and "majority" is just the one node
const standaloneOptions: ConnectOptions = {
  ...base,
  directConnection: true,
  retryWrites: false,
  writeConcern: { w: 1 },
  readPreference: "primary",
};

// replica set and mongos (sharded) share the same safe settings; only replicaSet differs
const clusterOptions: ConnectOptions = {
  ...base,
  retryWrites: true,
  writeConcern: { w: "majority" },
  readPreference: "primaryPreferred",
};

// Ask one host directly "who are you?". hello works without auth.
const probeHost = async (host: string): Promise<Probe | null> => {
  const client = new mongoose.mongo.MongoClient(`mongodb://${host}/?directConnection=true`, {
    serverSelectionTimeoutMS: 2000,
  });
  try {
    await client.connect();
    const hello = await client.db("admin").command({ hello: 1 });
    if (hello.isreplicaset) {
      logger.warn(`MongoDB probe: ${host} is a replica set member that is not initiated yet (run rs.initiate)`);
      return null;
    }
    const mode: Mode = hello.msg === "isdbgrid" ? "sharded" : hello.setName ? "replica" : "standalone";
    logger.info(`MongoDB probe: ${host} ok (${mode})`);
    return { mode, host, setName: hello.setName };
  } catch {
    logger.warn(`MongoDB probe: ${host} unreachable`);
    return null;
  } finally {
    await client.close().catch(() => {});
  }
};

const connectOnce = async (parsed: ParsedMongoUri | null): Promise<void> => {
  // ponytail: mongodb+srv (Atlas) is always a replica set, so skip the probe
  if (!parsed) {
    await mongoose.connect(env.mongoUri, clusterOptions);
    logger.info(`MongoDB mode: replica (srv) | db ${mongoose.connection.name}`);
    return;
  }

  const probes = await Promise.all(parsed.hosts.map(probeHost));
  const found = probes.find((p): p is Probe => p !== null);
  if (!found) throw new Error("no MongoDB host reachable");

  if (env.mongoMode !== "auto" && env.mongoMode !== found.mode) {
    throw new ModeMismatchError(
      `MongoDB mode mismatch: MONGO_MODE=${env.mongoMode} but ${found.host} is ${found.mode}. Start a ${env.mongoMode}, or fix MONGO_MODE.`,
    );
  }

  // standalone: other hosts in the URI would make the driver reject the server, so pass only the live one
  const hosts = found.mode === "standalone" ? [found.host] : parsed.hosts;
  const options: ConnectOptions =
    found.mode === "standalone"
      ? standaloneOptions
      : { ...clusterOptions, ...(found.setName ? { replicaSet: found.setName } : {}) };

  await mongoose.connect(buildMongoUri(parsed, hosts), options);

  const tag = env.mongoMode === "auto" ? "detected" : "forced by MONGO_MODE";
  const db = mongoose.connection.name;
  if (found.mode === "standalone") logger.info(`MongoDB mode: standalone (${tag}) | ${found.host} | db ${db}`);
  else if (found.mode === "replica")
    logger.info(`MongoDB mode: replica (${tag}) | set ${found.setName} | ${hosts.length} hosts | db ${db}`);
  else logger.info(`MongoDB mode: sharded (${tag}) | ${hosts.length} mongos | db ${db}`);
};

export const connectDatabase = async (): Promise<void> => {
  bindConnectionListeners();

  const parsed = env.mongoUri.startsWith("mongodb://") ? parseMongoUri(env.mongoUri) : null;

  for (let attempt = 1; ; attempt++) {
    try {
      await connectOnce(parsed);
      break;
    } catch (err) {
      if (err instanceof ModeMismatchError) throw err; // retrying cannot fix a wrong MONGO_MODE
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= CONNECT_TRIES) {
        throw new Error(`MongoDB: could not connect after ${CONNECT_TRIES} tries (${msg}). Check MONGO_URI`);
      }
      logger.warn(`MongoDB connect retry ${attempt}/${CONNECT_TRIES} in ${CONNECT_RETRY_MS / 1000}s`);
      await sleep(CONNECT_RETRY_MS);
    }
  }

  attachMongoTopologyMonitor();
  logMongoTopologyIfChanged();
  logger.info(
    `MongoDB connected: ${mongoose.connection.name} | pool ${env.mongoMinPool}-${env.mongoMaxPool} per worker`,
  );
};

export const disconnectDatabase = async (): Promise<void> => {
  markMongoShuttingDown();
  await mongoose.disconnect();
  logger.info("mongoose closed (shutdown)");
};
