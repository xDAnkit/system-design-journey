import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { logger } from "../bootstrap/logger.js";
import { noteMongoInfraFailure, sendMongoUnavailable } from "./mongo-gate.js";

export interface HttpError extends Error {
  status: number;
}

export const httpError = (status: number, message: string): HttpError =>
  Object.assign(new Error(message), { status });

const PUBLIC_INTERNAL = "Something went wrong. Please try again later.";

const isMongoInfraError = (err: Error): boolean => {
  const name = err.name;
  const msg = err.message;
  const code = (err as { code?: string | number }).code;

  if (
    name === "MongoServerSelectionError" ||
    name === "MongooseServerSelectionError" ||
    name === "MongoNetworkError" ||
    name === "MongoNetworkTimeoutError" ||
    name === "MongoTimeoutError" ||
    name === "MongoNotConnectedError"
  ) {
    return true;
  }

  // NotWritablePrimary / PrimarySteppedDown / ShutdownInProgress
  if (code === 10107 || code === 189 || code === 91 || code === 11600) return true;

  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ReplicaSetNoPrimary|not primary|not writable/i.test(msg);
};

const statusOf = (err: HttpError | FastifyError): number => {
  if ("status" in err && typeof err.status === "number") return err.status;
  if ("statusCode" in err && typeof err.statusCode === "number") return err.statusCode;
  return 500;
};

// A response can already be sent before its handler's promise settles (request timeout
// while a slow query is still running). Writing again throws.
export const errorHandler = (
  err: HttpError | FastifyError | mongoose.Error.CastError,
  req: FastifyRequest,
  reply: FastifyReply,
): void => {
  void req;

  if (reply.sent) return;

  if (err instanceof mongoose.Error.CastError) {
    reply.code(400).send({ error: `Invalid ${err.path}` });
    return;
  }

  if (isMongoInfraError(err)) {
    logger.error(err.stack ?? err.message);
    noteMongoInfraFailure();
    sendMongoUnavailable(reply);
    return;
  }

  const status = statusOf(err as HttpError | FastifyError);
  if (status >= 500) {
    logger.error(err.stack ?? err.message);
    reply.code(status).send({ error: PUBLIC_INTERNAL });
    return;
  }

  reply.code(status).send({ error: err.message });
};
