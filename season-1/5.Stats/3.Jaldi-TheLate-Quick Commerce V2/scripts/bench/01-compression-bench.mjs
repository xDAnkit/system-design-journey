import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

// 1 lakh:  node scripts/bench/01-compression-bench.mjs
// level:   node scripts/bench/01-compression-bench.mjs --level 1
// sirf zstd: node scripts/bench/01-compression-bench.mjs --modes zstd
// 10 lakh: node scripts/bench/01-compression-bench.mjs --requests 1000000 --concurrency 200
// faster client: --requests 1000000 --concurrency 400

const here = path.dirname(fileURLToPath(import.meta.url));
const ALL_MODES = [
  { name: "identity", accept: "identity" },
  { name: "gzip", accept: "gzip" },
  { name: "br", accept: "br" },
  { name: "zstd", accept: "zstd" },
];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const url = arg("url", "http://localhost:4500/products?limit=20");
const requests = Number(arg("requests", "100000"));
const concurrency = Number(arg("concurrency", "200"));
const warmup = Number(arg("warmup", "1000"));
const gapMs = Number(arg("gap", "3000"));
const timeoutMs = Number(arg("timeout", "30000"));
const level = arg("level", "");
const wanted = arg("modes", "identity,gzip,br,zstd").split(",").map((s) => s.trim());
const MODES = ALL_MODES.filter((mode) => wanted.includes(mode.name));
if (MODES.length === 0) {
  console.error(`unknown --modes. use: ${ALL_MODES.map((mode) => mode.name).join(",")}`);
  process.exit(1);
}
const target = new URL(url);

const parsePsTime = (raw) => {
  const parts = raw.trim().split(":");
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return Number(raw);
};

const ps = (pid, field) =>
  execFileSync("ps", ["-p", String(pid), "-o", `${field}=`], { encoding: "utf8" }).trim();

const findServerPid = (port) => {
  const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  const pids = [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))];
  if (pids.length === 0) throw new Error(`nothing listening on port ${port}`);
  for (const pid of pids) {
    const cmd = ps(pid, "command");
    if (cmd.includes("node")) return { pid: Number(pid), cmd };
  }
  return { pid: Number(pids[0]), cmd: ps(pids[0], "command") };
};

const workerPids = () => {
  const out = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
  const pids = [];
  for (const line of out.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (match && match[2].includes("dist/server.js")) pids.push(Number(match[1]));
  }
  return pids;
};

const cpuSeconds = (pids) => pids.reduce((sum, pid) => sum + parsePsTime(ps(pid, "time")), 0);

const startSampler = (pids) => {
  const samples = [];
  const tick = () => {
    let n = 0;
    let ok = false;
    for (const pid of pids) {
      try {
        const value = Number(ps(pid, "%cpu"));
        if (Number.isFinite(value)) {
          n += value;
          ok = true;
        }
      } catch {
        // pid gone
      }
    }
    if (ok) samples.push(n);
  };
  tick();
  const timer = setInterval(tick, 500);
  return {
    stop() {
      clearInterval(timer);
      const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
      return { avg, n: samples.length };
    },
  };
};

const once = (agent, accept) =>
  new Promise((resolve) => {
    let done = false;
    let body = 0;
    let startRead = 0;
    let startWritten = 0;
    const started = performance.now();
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        agent,
        headers: {
          "Accept-Encoding": accept,
          Accept: "application/json",
          ...(level ? { "x-compression-level": level } : {}),
        },
      },
      (res) => {
        res.on("data", (chunk) => {
          body += chunk.length;
        });
        res.on("end", () => {
          const socket = res.socket || req.socket;
          const inbound = socket ? Math.max(0, socket.bytesWritten - startWritten) : 0;
          const outbound = socket ? Math.max(0, socket.bytesRead - startRead) : body;
          const encoding = String(res.headers["content-encoding"] || "identity");
          const pass = res.statusCode === 200;
          finish({
            kind: pass ? "pass" : "status",
            status: res.statusCode,
            ms: performance.now() - started,
            inbound,
            outbound,
            body,
            encoding,
          });
        });
      },
    );

    req.on("socket", (socket) => {
      startRead = socket.bytesRead;
      startWritten = socket.bytesWritten;
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish({ kind: "timeout", ms: performance.now() - started, inbound: 0, outbound: 0, body: 0, encoding: "" });
    });
    req.on("error", () => {
      finish({ kind: "connect", ms: performance.now() - started, inbound: 0, outbound: 0, body: 0, encoding: "" });
    });
    req.end();
  });

const makeAgent = () =>
  new http.Agent({ keepAlive: true, maxSockets: concurrency, maxFreeSockets: concurrency });

const runMany = async ({ agent, accept, total, stats, label }) => {
  let started = 0;
  let finished = 0;
  await new Promise((resolve) => {
    const launch = () => {
      while (started < total && started - finished < concurrency) {
        started += 1;
        once(agent, accept).then((result) => {
          finished += 1;
          if (stats) record(stats, result);
          if (stats && (finished % 10000 === 0 || finished === total)) {
            const fail = stats.failStatus + stats.failTimeout + stats.failConnect;
            console.log(`${label} ${finished}/${total} pass=${stats.pass} fail=${fail}`);
          }
          if (finished === total) resolve();
          else launch();
        });
      }
    };
    launch();
  });
};

const freshStats = (total) => ({
  pass: 0,
  failStatus: 0,
  failTimeout: 0,
  failConnect: 0,
  statusCodes: new Map(),
  encodings: new Map(),
  inbound: 0,
  outbound: 0,
  body: 0,
  latencies: new Float64Array(total),
  latencyCount: 0,
});

const record = (stats, result) => {
  if (result.kind === "pass") {
    stats.pass += 1;
    stats.inbound += result.inbound;
    stats.outbound += result.outbound;
    stats.body += result.body;
    stats.latencies[stats.latencyCount] = result.ms;
    stats.latencyCount += 1;
    stats.encodings.set(result.encoding, (stats.encodings.get(result.encoding) || 0) + 1);
    return;
  }
  if (result.kind === "timeout") {
    stats.failTimeout += 1;
    return;
  }
  if (result.kind === "status") {
    stats.failStatus += 1;
    const code = String(result.status);
    stats.statusCodes.set(code, (stats.statusCodes.get(code) || 0) + 1);
    return;
  }
  stats.failConnect += 1;
};

const percentile = (stats, p) => {
  const n = stats.latencyCount;
  if (n === 0) return 0;
  const sorted = Float64Array.from(stats.latencies.subarray(0, n)).sort();
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sorted[idx];
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const topEncoding = (stats) => {
  let best = "identity";
  let n = -1;
  for (const [name, count] of stats.encodings) {
    if (count > n) {
      best = name;
      n = count;
    }
  }
  return best;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = findServerPid(target.port);
const cpuPids = workerPids();
if (cpuPids.length === 0) cpuPids.push(server.pid);
console.log(`server pid ${server.pid}  ${server.cmd}`);
console.log(`cpu pids ${cpuPids.join(",")}`);
console.log(`url ${url}`);
console.log(`requests ${requests}  concurrency ${concurrency}  warmup ${warmup}  level ${level || "env"}`);

const probeAgent = makeAgent();
const probe = await once(probeAgent, "identity");
probeAgent.destroy();
if (probe.kind !== "pass") {
  console.error(`probe failed: ${probe.kind} ${probe.status ?? ""}`);
  process.exit(1);
}
if (probe.body < 1024) {
  console.error(`body is ${probe.body} bytes. compression starts at 1024. aborting.`);
  process.exit(1);
}
console.log(`probe body ${probe.body} bytes`);

const rows = [];
for (let i = 0; i < MODES.length; i += 1) {
  const mode = MODES[i];
  const agent = makeAgent();
  console.log(`\n${mode.name}: warmup ${warmup}`);
  await runMany({ agent, accept: mode.accept, total: warmup, stats: null, label: mode.name });
  const stats = freshStats(requests);
  const cpuStart = cpuSeconds(cpuPids);
  const sampler = startSampler(cpuPids);
  const t0 = performance.now();
  await runMany({ agent, accept: mode.accept, total: requests, stats, label: mode.name });
  const wallMs = performance.now() - t0;
  const cpuDelta = cpuSeconds(cpuPids) - cpuStart;
  const sample = sampler.stop();
  agent.destroy();

  const fail = stats.failStatus + stats.failTimeout + stats.failConnect;
  if (stats.pass + fail !== requests) {
    console.error(`${mode.name}: pass+fail ${stats.pass + fail} !== sent ${requests}`);
    process.exit(1);
  }

  rows.push({
    mode: mode.name,
    asked: mode.accept,
    encoding: topEncoding(stats),
    sent: requests,
    pass: stats.pass,
    fail,
    failPct: (fail / requests) * 100,
    status: stats.failStatus,
    timeout: stats.failTimeout,
    connect: stats.failConnect,
    statusCodes: stats.statusCodes,
    wallS: wallMs / 1000,
    rps: stats.pass / (wallMs / 1000),
    inbound: stats.inbound,
    outbound: stats.outbound,
    body: stats.body,
    cpuS: cpuDelta,
    cpuPct: sample.avg,
    p50: percentile(stats, 50),
    p99: percentile(stats, 99),
  });

  if (i < MODES.length - 1) await sleep(gapMs);
}

const plain = rows[0].outbound || 1;
const num = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "0");

const header = [
  "mode",
  "encoding",
  "sent",
  "pass",
  "fail",
  "fail %",
  "status",
  "timeout",
  "connect",
  "time",
  "rps",
  "inbound",
  "outbound",
  "ratio",
  "node cpu",
  "avg cpu %",
  "p50",
  "p99",
];

const line = (cells) => `| ${cells.join(" | ")} |`;
const table = [
  line(header),
  line(header.map(() => "---")),
  ...rows.map((row) =>
    line([
      row.mode,
      row.encoding,
      String(row.sent),
      String(row.pass),
      String(row.fail),
      num(row.failPct, 2),
      String(row.status),
      String(row.timeout),
      String(row.connect),
      `${num(row.wallS, 2)} s`,
      num(row.rps, 0),
      mb(row.inbound),
      mb(row.outbound),
      num(row.outbound / plain, 2),
      `${num(row.cpuS, 2)} s`,
      num(row.cpuPct, 1),
      `${num(row.p50, 1)} ms`,
      `${num(row.p99, 1)} ms`,
    ]),
  ),
].join("\n");

const notes = [
  "",
  `URL: ${url}`,
  `Server PID: ${server.pid} (${server.cmd})`,
  `CPU PIDs: ${cpuPids.join(", ")}`,
  `Requests: ${requests} per mode, concurrency ${concurrency}, warmup ${warmup} (not counted)`,
  `Compression level: ${level || "server COMPRESSION_LEVEL"} (1 = least CPU, higher = smaller body)`,
  "Pass = HTTP 200. Fail = any other status, timeout, or socket error.",
  "pass + fail = sent. Inbound, outbound, and latency are pass-only.",
  "Outbound is bytes the server wrote on the socket (headers + body).",
  "Node CPU is process time from ps during the run, not hardware cycles.",
  "CPU includes failed requests too. It cannot be split per request.",
  "",
  "10 lakh next time:",
  "`node scripts/bench/01-compression-bench.mjs --requests 1000000 --concurrency 200`",
  "`node scripts/bench/01-compression-bench.mjs --requests 1000000 --concurrency 400`",
];

const statusNotes = rows
  .filter((row) => row.statusCodes.size > 0)
  .map((row) => {
    const parts = [...row.statusCodes.entries()].map(([code, count]) => `${code} x ${count}`);
    return `${row.mode} status codes: ${parts.join(", ")}`;
  });

const bodyNotes = rows.map(
  (row) => `${row.mode} body ${mb(row.body)} (asked ${row.asked}, got ${row.encoding})`,
);

const report = [table, ...notes, "", ...bodyNotes, ...(statusNotes.length ? ["", ...statusNotes] : []), ""].join("\n");
console.log(`\n${report}`);

const outDir = path.join(here, "results");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outFile = path.join(outDir, `01-${stamp}.md`);
fs.writeFileSync(outFile, report);
console.log(`saved ${outFile}`);
