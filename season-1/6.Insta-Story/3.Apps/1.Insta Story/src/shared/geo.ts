import { readFile } from "node:fs/promises";
import { env } from "../bootstrap/env.js";
import { logger } from "../bootstrap/logger.js";

// Geo comes from a local IP table, never from a network call, so a request is never held
// while a third party answers. Without GEO_DB_PATH the geo block stays null and writes still work.
export interface GeoPoint {
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  asn: number | null;
}

// { "1.2.3.4": {...}, "1.2.3.0/24": {...} }. A /24 entry covers the whole subnet.
type Table = Record<string, Partial<GeoPoint>>;

let table: Table | null = null;
let loading: Promise<Table> | null = null;

const cache = new Map<string, GeoPoint | null>();
const CACHE_MAX = 10_000;
const EMPTY = {} as Table;

const load = async (): Promise<Table> => {
  loading ??= readFile(env.geoDbPath, "utf8")
    .then((raw) => JSON.parse(raw) as Table)
    .catch((err: unknown) => {
      logger.warn(
        `Geo database not loaded from ${env.geoDbPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return EMPTY;
    })
    .then((parsed) => {
      table = parsed;
      return parsed;
    });
  return loading;
};

// Loopback and private ranges can never have a public geo entry.
export const isPrivateIp = (ip: string): boolean =>
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd)/i.test(
    ip,
  );

const fromEntry = (entry: Partial<GeoPoint> | undefined): GeoPoint | null =>
  !entry
    ? null
    : {
        country: entry.country ?? null,
        region: entry.region ?? null,
        city: entry.city ?? null,
        lat: entry.lat ?? null,
        lng: entry.lng ?? null,
        asn: entry.asn ?? null,
      };

export const geoFor = async (ip: string | null): Promise<GeoPoint | null> => {
  if (!ip || !env.geoDbPath || isPrivateIp(ip)) return null;
  if (cache.has(ip)) return cache.get(ip) ?? null;

  const db = table ?? (await load());
  const subnet = ip.split(".").slice(0, 3).join(".") + ".0/24";
  const point = fromEntry(db[ip]) ?? fromEntry(db[subnet]);

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(ip, point);
  return point;
};
