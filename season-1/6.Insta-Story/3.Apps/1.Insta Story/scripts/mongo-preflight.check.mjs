// Run: node scripts/mongo-preflight.check.mjs
import assert from "node:assert/strict";
import net from "node:net";
import { findConflicts, formatConflicts, hintFor, parseDockerPorts } from "./mongo-preflight.mjs";

// docker ps --format {{.Ports}} output
const ports = parseDockerPorts("0.0.0.0:27019->27017/tcp, [::]:27019->27017/tcp");
assert.deepEqual([...ports], [27019]);
assert.equal(parseDockerPorts("").size, 0);

// hint is per OS, with a generic fallback
assert.match(hintFor("darwin"), /brew services stop/);
assert.match(hintFor("linux"), /systemctl stop mongod/);
assert.match(hintFor("win32"), /net stop MongoDB/);
assert.match(hintFor("freebsd"), /stop the process/);

// real listener: busy port is reported, a port that is "ours" is not, a closed port is not
const server = net.createServer().listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const busy = server.address().port;

const found = await findConflicts([busy], new Set());
assert.equal(found.length, 1);
assert.equal(found[0].port, busy);
assert.equal((await findConflicts([busy], new Set([busy]))).length, 0);

const text = formatConflicts(found, "darwin");
assert.match(text, new RegExp(`Port ${busy} is busy`));
assert.match(text, /Nothing was stopped for you/);

await new Promise((resolve) => server.close(resolve));
assert.equal((await findConflicts([busy], new Set())).length, 0);

console.log("mongo-preflight check ok");
