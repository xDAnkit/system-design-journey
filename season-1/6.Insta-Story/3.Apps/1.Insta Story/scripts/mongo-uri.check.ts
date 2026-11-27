// Run: node scripts/mongo-uri.check.ts   (Node 22.18+ runs TypeScript directly)
import assert from "node:assert/strict";
import { buildMongoUri, parseMongoUri } from "../src/bootstrap/mongo-uri.ts";

// 3 hosts, old replica options in the URI are dropped, other params stay
const old =
  "mongodb://127.0.0.1:27017,127.0.0.1:27018,127.0.0.1:27019/instagram?replicaSet=fk-rs&w=majority&retryWrites=true&readPreference=primaryPreferred&authSource=admin";
const p = parseMongoUri(old);
assert.deepEqual(p.hosts, ["127.0.0.1:27017", "127.0.0.1:27018", "127.0.0.1:27019"]);
assert.equal(p.db, "instagram");
assert.equal(p.query, "authSource=admin");

// standalone: only the live host is passed back
assert.equal(buildMongoUri(p, ["127.0.0.1:27017"]), "mongodb://127.0.0.1:27017/instagram?authSource=admin");

// credentials survive, no query, no db
const c = parseMongoUri("mongodb://user:p%40ss@h1:1,h2:2");
assert.equal(c.auth, "user:p%40ss@");
assert.deepEqual(c.hosts, ["h1:1", "h2:2"]);
assert.equal(buildMongoUri(c, c.hosts), "mongodb://user:p%40ss@h1:1,h2:2/");

// not a mongodb:// URI
assert.throws(() => parseMongoUri("redis://x"));

console.log("mongo-uri check ok");
