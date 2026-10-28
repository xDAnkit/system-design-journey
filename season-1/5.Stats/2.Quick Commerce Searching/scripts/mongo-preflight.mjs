// Runs before `docker compose up`. If a local process already holds one of the Mongo host ports,
// print who and how to stop it, then exit 1. It never stops or kills anything itself.
// Why: Docker does NOT fail when e.g. Homebrew mongod holds 127.0.0.1:27017 (different bind address),
// it silently gets shadowed and the replica set loses that node.
import net from "node:net";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// keep in sync with the published host ports in infra/mongo/compose.yaml
export const PORTS = [27017, 27018, 27019];

// host ports published by our own running containers ("0.0.0.0:27019->27017/tcp, [::]:27019->27017/tcp")
export const parseDockerPorts = (text) => new Set([...text.matchAll(/:(\d+)->/g)].map((m) => Number(m[1])));

const HINTS = {
  darwin: "brew services stop mongodb-community@<version>   (find it with: brew services list)",
  linux: "sudo systemctl stop mongod",
  win32: "net stop MongoDB   (run as Administrator)",
};
export const hintFor = (platform) => HINTS[platform] ?? "stop the process that owns the port";

// ponytail: connect test instead of bind test. Connecting to 127.0.0.1 is exactly what the app does,
// works on every OS without lsof, and catches the shadowing case a bind test would miss.
const isBusy = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 500 });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("timeout", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false)); // ECONNREFUSED = nothing listening
  });

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

// best effort only: any failure just means "unknown process"
const ownersOf = (port) => {
  try {
    if (process.platform === "win32") {
      const pids = new Set(
        run("netstat", ["-ano", "-p", "TCP"])
          .split(/\r?\n/)
          .filter((line) => line.includes("LISTENING") && new RegExp(`:${port}\\s`).test(line))
          .map((line) => line.trim().split(/\s+/).pop()),
      );
      return [...pids].map((pid) => {
        let command = "unknown";
        try {
          command = run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]).split(",")[0].replace(/"/g, "");
        } catch {}
        return { pid, command };
      });
    }
    // lsof -F prints one "p<pid>" line then "c<command>" line per process
    const owners = [];
    for (const line of run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]).split("\n")) {
      if (line.startsWith("p")) owners.push({ pid: line.slice(1), command: "unknown" });
      else if (line.startsWith("c") && owners.length) owners[owners.length - 1].command = line.slice(1);
    }
    return owners;
  } catch {
    return [];
  }
};

export const findConflicts = async (ports, ownPorts) => {
  const conflicts = [];
  for (const port of ports) {
    if (!ownPorts.has(port) && (await isBusy(port))) conflicts.push({ port, owners: ownersOf(port) });
  }
  return conflicts;
};

export const formatConflicts = (conflicts, platform) =>
  [
    ...conflicts.map(({ port, owners }) => {
      const who = owners.length ? owners.map((o) => `${o.command} (pid ${o.pid})`).join(", ") : "unknown process";
      return `Port ${port} is busy: ${who}.`;
    }),
    "Docker would start, but localhost would reach that process, not the Mongo containers",
    "(the replica set loses a node and the app may connect to the wrong DB).",
    "Nothing was stopped for you. Stop it yourself, then run pnpm mongo:up again:",
    `  ${hintFor(platform)}`,
  ].join("\n");

const ownPorts = () => {
  try {
    return parseDockerPorts(run("docker", ["ps", "--filter", "name=fk-mongo", "--format", "{{.Ports}}"]));
  } catch {
    return new Set(); // docker not running: compose itself will complain, ports are simply all "not ours"
  }
};

const main = async () => {
  const conflicts = await findConflicts(PORTS, ownPorts());
  if (conflicts.length === 0) return;
  console.error(formatConflicts(conflicts, process.platform));
  process.exit(1);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
