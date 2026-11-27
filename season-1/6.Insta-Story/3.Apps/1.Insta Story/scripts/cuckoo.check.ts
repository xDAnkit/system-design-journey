// Run: node scripts/cuckoo.check.ts   (Node 22.18+ runs TypeScript directly)
// Needs Redis on REDIS_URL (default 127.0.0.1:6379). It writes two test keys and removes them at the end.
import assert from "node:assert/strict";
import { createClient } from "redis";
import * as cuckoo from "../src/shared/cuckoo-core.ts";

const client = createClient({ url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" });
await client.connect();
const run = Date.now();
const key = `cuckoo:check:${run}:basic`;
const smallKey = `cuckoo:check:${run}:small`;

try {
  // add, exists, delete
  assert.equal(await cuckoo.add(client, key, "post-1"), 1);
  assert.equal(await cuckoo.add(client, key, "post-1"), 0, "same item twice is not added twice");
  assert.deepEqual(await cuckoo.exists(client, key, ["post-1", "post-2"]), [true, false]);
  assert.equal(await cuckoo.del(client, key, "post-2"), false, "deleting a missing item does nothing");
  assert.equal(await cuckoo.del(client, key, "post-1"), true);
  assert.deepEqual(await cuckoo.exists(client, key, ["post-1"]), [false]);
  assert.equal(await client.exists(key), 0, "empty filter leaves no key behind");

  // batch: same answers as one by one, across two filters in one call
  const other = `${key}:other`;
  assert.deepEqual(await cuckoo.addMany(client, [[key, "a"], [other, "a"], [key, "a"], [key, "b"]]), [1, 1, 0, 1]);
  assert.deepEqual(await cuckoo.exists(client, key, ["a", "b", "c"]), [true, true, false]);
  assert.deepEqual(await cuckoo.delMany(client, [[key, "a"], [key, "a"], [other, "a"], [key, "b"]]), [1, 0, 1, 1]);
  assert.equal(await client.exists([key, other]), 0, "batch delete leaves no keys behind");

  // a tiny filter (4 buckets x 4 slots) fills up: add says -1 and nothing it already held is lost
  const held: string[] = [];
  let sawFull = false;
  for (let i = 0; i < 40; i++) {
    const r = await cuckoo.add(client, smallKey, `item-${i}`, 4);
    if (r === 1) held.push(`item-${i}`);
    else if (r === -1) sawFull = true;
  }
  assert.ok(sawFull, "tiny filter must report full");
  assert.ok(held.length <= 16);
  assert.ok((await cuckoo.exists(client, smallKey, held, 4)).every(Boolean), "full filter must not lose items");

  console.log(`cuckoo ok (tiny filter held ${held.length}/16)`);
} finally {
  await client.del([key, `${key}:other`, smallKey]);
  await client.quit();
}
