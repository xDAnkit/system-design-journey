import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { env } from "../bootstrap/env.js";
import { geoFor, type GeoPoint } from "./geo.js";

// Everything the server can learn about the caller, stored on write records so a later
// "who did this, from where, on what device" question has an answer.
export interface ClientMeta {
  ip: string | null;
  socketIp: string | null;
  ipHash: string | null;
  ua: string;
  browser: string;
  os: string;
  device: string;
  lang: string | null;
  timezone: string | null;
  referer: string | null;
  clientId: string | null;
  requestId: string;
  geo: GeoPoint | null;
}

// The small block copied onto a record. The full row lives in audit_events.
export interface AuditSnapshot {
  by: string | null;
  clientId: string | null;
  ip: string | null;
  requestId: string;
  at: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    client: ClientMeta;
  }
}

const CLIENT_ID = /^[a-z0-9._-]{1,64}$/i;
const UNKNOWN_UA = "unknown";

const headerValue = (value: string | string[] | undefined): string | null =>
  (Array.isArray(value) ? value[0] : value)?.trim() || null;

// Fastify hands out IPv6 mapped IPv4 ("::ffff:127.0.0.1"); two spellings of the same
// address would otherwise look like two different clients.
const normalizeIp = (ip: string | null): string | null => {
  if (!ip) return null;
  const value = ip.trim();
  const mapped = value.startsWith("::ffff:") ? value.slice(7) : value;
  return mapped === "::1" ? "127.0.0.1" : mapped;
};

const BROWSERS: Array<[RegExp, string]> = [
  [/edg\/([\d.]+)/i, "Edge"],
  [/opr\/([\d.]+)/i, "Opera"],
  [/chrome\/([\d.]+)/i, "Chrome"],
  [/firefox\/([\d.]+)/i, "Firefox"],
  [/version\/([\d.]+).*safari/i, "Safari"],
  [/curl\/([\d.]+)/i, "curl"],
  [/node/i, "node"],
];

const OSES: Array<[RegExp, string]> = [
  [/windows nt ([\d.]+)/i, "Windows"],
  [/android ([\d.]+)/i, "Android"],
  [/(?:iphone )?os ([\d_]+).*like mac os x/i, "iOS"],
  [/mac os x ([\d_]+)/i, "macOS"],
  [/linux/i, "Linux"],
];

// A readable name plus version, so a support answer does not need a raw UA string decoded.
const parse = (
  ua: string,
  table: Array<[RegExp, string]>,
  fallback: string,
): string => {
  for (const [pattern, name] of table) {
    const hit = ua.match(pattern);
    if (hit) return hit[1] ? `${name} ${hit[1].replace(/_/g, ".")}` : name;
  }
  return fallback;
};

const deviceOf = (ua: string): string => {
  if (/bot|crawl|spider|slurp|facebookexternalhit|headless/i.test(ua))
    return "bot";
  if (/ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)))
    return "tablet";
  if (/mobile|iphone|ipod|android/i.test(ua)) return "mobile";
  return "desktop";
};

const hashIp = (ip: string | null): string | null =>
  ip
    ? createHash("sha256")
        .update(`${env.auditSalt}:${ip}`)
        .digest("hex")
        .slice(0, 32)
    : null;

export const clientOf = async (req: FastifyRequest): Promise<ClientMeta> => {
  const ua = (headerValue(req.headers["user-agent"]) ?? UNKNOWN_UA).slice(
    0,
    512,
  );
  const ip = normalizeIp(req.ip ?? null);
  const socketIp = normalizeIp(req.socket.remoteAddress ?? null);
  const rawClientId = headerValue(req.headers["x-client-id"]);

  return {
    ip,
    socketIp,
    ipHash: hashIp(ip),
    ua,
    browser: parse(ua, BROWSERS, "other"),
    os: parse(ua, OSES, "other"),
    device: deviceOf(ua),
    lang: headerValue(req.headers["accept-language"])?.slice(0, 120) ?? null,
    timezone: headerValue(req.headers["x-client-tz"])?.slice(0, 64) ?? null,
    referer: headerValue(req.headers.referer)?.slice(0, 512) ?? null,
    clientId:
      rawClientId && CLIENT_ID.test(rawClientId)
        ? rawClientId.toLowerCase()
        : null,
    requestId: req.id,
    geo: await geoFor(ip),
  };
};

// onRequest hook: one capture per request, used by handlers, audit rows and Kafka events.
export const captureClient = async (req: FastifyRequest): Promise<void> => {
  req.client = await clientOf(req);
};

export const auditSnapshot = (
  req: FastifyRequest,
  by: string | null,
): AuditSnapshot => ({
  by,
  clientId: req.client?.clientId ?? null,
  ip: req.client?.ip ?? null,
  requestId: req.client?.requestId ?? req.id,
  at: new Date(),
});
