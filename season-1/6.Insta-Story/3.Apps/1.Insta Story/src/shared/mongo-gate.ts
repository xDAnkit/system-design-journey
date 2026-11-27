import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../bootstrap/env.js";
import { getMongoTopology, isMongoShuttingDown } from "../bootstrap/mongo-topology.js";

const PUBLIC_UNAVAILABLE = "Service is temporarily unavailable. Please try again later.";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let circuitOpenUntil = 0;
let failCount = 0;
let failWindowStart = 0;

const tripMongoCircuit = (): void => {
  circuitOpenUntil = Date.now() + env.mongoCircuitMs;
  failCount = 0;
  failWindowStart = 0;
};

export const noteMongoInfraFailure = (): void => {
  if (getMongoTopology().electionPossible) return;

  const now = Date.now();
  if (failWindowStart === 0 || now - failWindowStart > env.mongoCircuitMs) {
    failWindowStart = now;
    failCount = 0;
  }

  failCount += 1;
  if (failCount >= env.mongoCircuitFails) tripMongoCircuit();
};

export const noteMongoSuccess = (): void => {
  failCount = 0;
  failWindowStart = 0;
};

const retryAfterSeconds = (): number => {
  const remaining = circuitOpenUntil - Date.now();
  if (remaining > 0) return Math.max(1, Math.ceil(remaining / 1000));
  return Math.max(1, Math.ceil(env.mongoSelectTimeoutMs / 1000));
};

export const sendMongoUnavailable = (reply: FastifyReply): FastifyReply => {
  reply.header("Retry-After", String(retryAfterSeconds()));
  reply.code(503);
  return reply.send({ error: PUBLIC_UNAVAILABLE });
};

export const mongoGate = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> => {
  if (isMongoShuttingDown()) return sendMongoUnavailable(reply);

  const { reads, writes, electionPossible } = getMongoTopology();
  const needsWrite = WRITE_METHODS.has(req.method);
  const waitingForPrimary = needsWrite && !writes && electionPossible;

  if (!reads) return sendMongoUnavailable(reply);

  // Majority impossible (e.g. 1 leftover SECONDARY). Waiting will never elect a PRIMARY.
  if (needsWrite && !writes && !electionPossible) return sendMongoUnavailable(reply);

  // Election: skip the circuit so the driver can wait for a new PRIMARY.
  if (Date.now() < circuitOpenUntil && !waitingForPrimary) return sendMongoUnavailable(reply);

  reply.raw.on("finish", () => {
    if (reply.statusCode < 500) noteMongoSuccess();
  });
};
