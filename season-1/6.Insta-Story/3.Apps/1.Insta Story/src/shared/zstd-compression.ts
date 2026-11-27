import zlib from "node:zlib";
import Negotiator from "negotiator";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../bootstrap/env.js";
import { logger } from "../bootstrap/logger.js";
import { isIngestPost } from "../features/products/products.ingest.js";

const ZSTD_SUPPORTED = typeof zlib.createZstdCompress === "function";
const MIN_COMPRESS_BYTES = 1024;
const SERVER_ENCODING_PREFERENCE = ["br", "zstd", "gzip", "identity"];

if (env.enableZstd && !ZSTD_SUPPORTED) {
  logger.warn("ENABLE_ZSTD is true but this Node version has no native zstd support (needs 22.15+) - gzip/brotli only");
}

const zstdActive = env.enableZstd && ZSTD_SUPPORTED;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const headerValue = (req: FastifyRequest, name: string): string | undefined => {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
};

// Header overrides the env default for this request, so the bench script can
// try levels without a restart. Each codec has its own legal range.
export const compressionLevel = (req: FastifyRequest): number => {
  const raw = headerValue(req, "x-compression-level");
  const n = raw === undefined ? env.compressionLevel : Number(raw);
  if (!Number.isInteger(n)) return env.compressionLevel;
  return n;
};

const openStream = (encoding: string, level: number) => {
  if (encoding === "zstd") {
    return zlib.createZstdCompress({
      params: { [zlib.constants.ZSTD_c_compressionLevel]: clamp(level, 1, 19) },
    });
  }
  if (encoding === "br") {
    return zlib.createBrotliCompress({
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: clamp(level, 0, 11) },
    });
  }
  return zlib.createGzip({ level: clamp(level, 1, 9) });
};

const compressBuffer = (encoding: string, payload: Buffer, level: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = openStream(encoding, level);
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.end(payload);
  });

const compressible = (reply: FastifyReply): boolean => {
  const type = String(reply.getHeader("content-type") ?? "");
  return /json|text|javascript|xml/.test(type);
};

// Negotiates br > zstd > gzip > identity. zstd only when ENABLE_ZSTD and Node 22.15+.
// Skips POST /products/ingest and bodies under 1024 bytes. Level comes from
// x-compression-level, otherwise COMPRESSION_LEVEL.
export const compressOnSend = async (
  req: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> => {
  if (payload == null) return payload;
  if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;
  if (isIngestPost(req)) return payload;
  if (headerValue(req, "x-no-compression") !== undefined) return payload;
  if (reply.getHeader("Content-Encoding")) return payload;
  if (!compressible(reply)) return payload;

  const available = zstdActive ? SERVER_ENCODING_PREFERENCE : ["br", "gzip", "identity"];
  const chosen = new Negotiator({ headers: req.headers }).encoding(available);
  if (!chosen || chosen === "identity") return payload;

  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.length < MIN_COMPRESS_BYTES) return payload;

  try {
    const compressed = await compressBuffer(chosen, buf, compressionLevel(req));
    reply.header("Content-Encoding", chosen);
    reply.header("Vary", "Accept-Encoding");
    reply.header("Content-Length", String(compressed.length));
    return compressed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${chosen} compression failed, falling back to uncompressed: ${message}`);
    return payload;
  }
};
