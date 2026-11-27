// Cuckoo filter as one Redis Lua script, plus the small TypeScript wrapper. This file has no relative
// imports, so scripts/cuckoo.check.ts can load it directly.
//
// Storage: one Redis hash per filter. field = bucket index, value = up to 4 fingerprints, 2 bytes each.
// Empty buckets are not stored, so memory grows with the items added, not with the capacity.
//
// ops (ARGV[1]):  add item   -> 1 added, 0 already there, -1 full (nothing changed)
//                 exists ... -> array of 0/1, one per item
//                 del item   -> 1 removed, 0 not there
// ARGV[2] = bucket count, must be a power of 2. ARGV[3..] = items.
//
// add changes buckets in memory first and writes only when it succeeds. A full filter therefore never
// loses an item it already holds, so "exists = 0" can always be trusted.
const CUCKOO_LUA = `
local key = KEYS[1]
local op = ARGV[1]
local B = tonumber(ARGV[2])
local SLOTS = 4
local MAX_KICKS = 200

local cache, dirty = {}, {}

local function load(idx)
  local c = cache[idx]
  if c then return c end
  c = {}
  local raw = redis.call('HGET', key, idx)
  if raw then
    for i = 1, #raw, 2 do c[#c + 1] = string.byte(raw, i) * 256 + string.byte(raw, i + 1) end
  end
  cache[idx] = c
  return c
end

local function flush()
  for idx in pairs(dirty) do
    local c = cache[idx]
    if #c == 0 then
      redis.call('HDEL', key, idx)
    else
      local parts = {}
      for i, fp in ipairs(c) do parts[i] = string.char(math.floor(fp / 256), fp % 256) end
      redis.call('HSET', key, idx, table.concat(parts))
    end
  end
end

local function alt(i, fp) return bit.bxor(i, (fp * 1540483477) % B) end

local function locate(item)
  local h = redis.sha1hex(item)
  local i1 = tonumber(string.sub(h, 1, 8), 16) % B
  local fp = tonumber(string.sub(h, 9, 12), 16) % 65535 + 1
  return fp, i1, alt(i1, fp)
end

local function find(c, fp)
  for i, v in ipairs(c) do if v == fp then return i end end
end

if op == 'exists' then
  local out = {}
  for n = 3, #ARGV do
    local fp, i1, i2 = locate(ARGV[n])
    out[#out + 1] = (find(load(i1), fp) or find(load(i2), fp)) and 1 or 0
  end
  return out
end

local function delOne(item)
  cache, dirty = {}, {}
  local fp, i1, i2 = locate(item)
  for _, idx in ipairs({ i1, i2 }) do
    local c = load(idx)
    local pos = find(c, fp)
    if pos then
      table.remove(c, pos)
      dirty[idx] = true
      flush()
      return 1
    end
  end
  return 0
end

local function addOne(item)
  cache, dirty = {}, {}
  local fp, i1, i2 = locate(item)
  if find(load(i1), fp) or find(load(i2), fp) then return 0 end
  for _, idx in ipairs({ i1, i2 }) do
    local c = load(idx)
    if #c < SLOTS then
      c[#c + 1] = fp
      dirty[idx] = true
      flush()
      return 1
    end
  end
  -- both buckets full: push a resident fingerprint to its other bucket, repeat
  local i, cur = i1, fp
  for n = 1, MAX_KICKS do
    local c = load(i)
    local slot = (n % SLOTS) + 1
    cur, c[slot] = c[slot], cur
    dirty[i] = true
    i = alt(i, cur)
    local t = load(i)
    if #t < SLOTS then
      t[#t + 1] = cur
      dirty[i] = true
      flush()
      return 1
    end
  end
  return -1 -- nothing was flushed, so the filter is unchanged
end

if op == 'add' then return addOne(ARGV[3]) end
if op == 'del' then return delOne(ARGV[3]) end

-- batch: madd / mdel, KEYS[n] is the filter and ARGV[n + 2] the item, all in one atomic call
local out = {}
for n = 1, #KEYS do
  key = KEYS[n]
  out[n] = (op == 'madd') and addOne(ARGV[n + 2]) or delOne(ARGV[n + 2])
end
return out
`;

import { createHash } from "node:crypto";

// 16384 buckets x 4 slots = 65,536 items per filter. Must stay a power of 2.
// ponytail: fixed size. A user with more than 65k likes gets add = -1, then raise this (or add expansion).
export const BUCKETS = 2 ** 14;

type Opts = { keys: string[]; arguments: string[] };
// the bits of node-redis we use, so the check script can pass its own client
export interface LuaClient {
  evalSha(sha: string, opts: Opts): Promise<unknown>;
  eval(script: string, opts: Opts): Promise<unknown>;
}

const SHA = createHash("sha1").update(CUCKOO_LUA).digest("hex");

const run = async (client: LuaClient, op: string, key: string | string[], buckets: number, items: string[]): Promise<unknown> => {
  const opts = { keys: Array.isArray(key) ? key : [key], arguments: [op, String(buckets), ...items] };
  try {
    return await client.evalSha(SHA, opts);
  } catch (err) {
    if (!String(err).includes("NOSCRIPT")) throw err;
    return client.eval(CUCKOO_LUA, opts); // EVAL also stores the script, next calls use the sha
  }
};

// 1 added, 0 already there, -1 full
export const add = async (client: LuaClient, key: string, item: string, buckets = BUCKETS): Promise<number> =>
  (await run(client, "add", key, buckets, [item])) as number;

export const exists = async (client: LuaClient, key: string, items: string[], buckets = BUCKETS): Promise<boolean[]> =>
  items.length === 0 ? [] : ((await run(client, "exists", key, buckets, items)) as number[]).map((v) => v === 1);

// Only call this for an item that was really added. Deleting a stranger can remove someone else's fingerprint.
export const del = async (client: LuaClient, key: string, item: string, buckets = BUCKETS): Promise<boolean> =>
  (await run(client, "del", key, buckets, [item])) === 1;

// Batch: many [filterKey, item] pairs, same results as add / del, one per pair. Sent in slices of 2k:
// Redis runs one script at a time, so a smaller slice keeps every other request (the API) from waiting long.
const SLICE = 2000;
const runMany = async (client: LuaClient, op: string, pairs: Array<[string, string]>, buckets: number): Promise<number[]> => {
  const out: number[] = [];
  for (let i = 0; i < pairs.length; i += SLICE) {
    const slice = pairs.slice(i, i + SLICE);
    out.push(...((await run(client, op, slice.map((p) => p[0]), buckets, slice.map((p) => p[1]))) as number[]));
  }
  return out;
};

export const addMany = (client: LuaClient, pairs: Array<[string, string]>, buckets = BUCKETS): Promise<number[]> =>
  runMany(client, "madd", pairs, buckets);

export const delMany = (client: LuaClient, pairs: Array<[string, string]>, buckets = BUCKETS): Promise<number[]> =>
  runMany(client, "mdel", pairs, buckets);
