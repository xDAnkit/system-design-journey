import { redisClient } from "../bootstrap/redis.js";

// Counters live only in Redis. Mongo holds the real rows, so a lost counter can be rebuilt from them.

// KEYS = counters, ARGV = +/- change for each. One atomic call for a whole batch, a counter never goes below 0.
const APPLY_DELTAS = `
for i, key in ipairs(KEYS) do
  local d = tonumber(ARGV[i])
  if d ~= 0 then
    if redis.call('INCRBY', key, d) < 0 then redis.call('SET', key, 0) end
  end
end
return #KEYS`;

// one round trip for many counters, a missing key counts as 0
export const getCounts = async (keys: string[]): Promise<number[]> =>
  keys.length === 0 ? [] : (await redisClient.mGet(keys)).map((v) => Number(v ?? 0));

// Redis runs one script at a time and everything else waits, so a big batch goes in slices of 5k.
// One slice blocks Redis for a few ms, not 100+ ms, and the API stays fast.
export const LUA_SLICE = 5000;

export const addCounts = async (deltas: Map<string, number>): Promise<void> => {
  const entries = [...deltas];
  for (let i = 0; i < entries.length; i += LUA_SLICE) {
    const slice = entries.slice(i, i + LUA_SLICE);
    await redisClient.eval(APPLY_DELTAS, { keys: slice.map((e) => e[0]), arguments: slice.map((e) => String(e[1])) });
  }
};

export const bump = (deltas: Map<string, number>, key: string, d: number): void => {
  deltas.set(key, (deltas.get(key) ?? 0) + d);
};
