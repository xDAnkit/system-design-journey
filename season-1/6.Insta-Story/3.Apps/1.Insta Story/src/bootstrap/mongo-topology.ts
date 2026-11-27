import mongoose from "mongoose";
import { logger } from "./logger.js";

export type MongoTopology = {
  connected: boolean;
  membersUp: number;
  membersTotal: number;
  primaryHost: string | null;
  writes: boolean;
  reads: boolean;
  electionPossible: boolean;
};

type ServerDesc = { address: string; type: string };
type TopologyDesc = { servers: Map<string, ServerDesc> };

let shuttingDown = false;
let monitorBound = false;
let cachedDescription: TopologyDesc | null = null;
let lastLogKey = "";

export const markMongoShuttingDown = (): void => {
  shuttingDown = true;
};

export const isMongoShuttingDown = (): boolean => shuttingDown;

const displayMember = (address: string): string =>
  address.replace(/^host\.docker\.internal/, "127.0.0.1");

const readDescription = (): TopologyDesc | null => {
  if (cachedDescription?.servers.size) return cachedDescription;

  const client = mongoose.connection.getClient() as unknown as {
    topology?: { description?: TopologyDesc };
  };

  return client.topology?.description ?? cachedDescription;
};

const isUp = (type: string): boolean =>
  type === "RSPrimary" || type === "RSSecondary" || type === "Standalone" || type === "Mongos";

const uniqueMembers = (servers: Map<string, ServerDesc>): ServerDesc[] => {
  const byPort = new Map<string, ServerDesc>();
  for (const server of servers.values()) {
    const port = server.address.split(":").at(-1) ?? server.address;
    const prev = byPort.get(port);
    if (!prev || isUp(server.type)) byPort.set(port, server);
  }
  return [...byPort.values()];
};

export const getMongoTopology = (): MongoTopology => {
  const connected = mongoose.connection.readyState === 1;
  const empty: MongoTopology = {
    connected,
    membersUp: 0,
    membersTotal: 0,
    primaryHost: null,
    writes: false,
    reads: false,
    electionPossible: false,
  };

  try {
    const description = readDescription();
    const servers = description?.servers;
    if (!servers || servers.size === 0) return empty;

    // sharded: members are mongos routers, and any one router is enough. uniqueMembers() dedupes by
    // port (docker port-mapping quirk), which would merge routers on different machines.
    const all = [...servers.values()];
    const sharded = all.some((s) => s.type === "Mongos");
    const members = sharded ? all : uniqueMembers(servers);
    let membersUp = 0;
    let primaryHost: string | null = null;

    for (const server of members) {
      if (server.type === "RSPrimary" || server.type === "Standalone" || server.type === "Mongos") {
        membersUp += 1;
        primaryHost = displayMember(server.address);
      } else if (server.type === "RSSecondary") {
        membersUp += 1;
      }
    }

    const membersTotal = members.length; // 1
    const majority = sharded ? 1 : Math.floor(membersTotal / 2) + 1; // 1
    const electionPossible = membersUp >= majority; // 1 >= 1 => true
    const writes = primaryHost !== null && electionPossible; // Standalone && electionPossible => true
    const reads = membersUp > 0;

    return {
      connected: connected || reads,
      membersUp,
      membersTotal,
      primaryHost,
      writes,
      reads,
      electionPossible,
    };
  } catch {
    return empty;
  }
};

const formatRs = (snap: MongoTopology): string => {
  const electionWait =
    snap.electionPossible && !snap.writes ? " | write waiting for primary" : "";
  return `MongoDB: ${snap.membersUp}/${snap.membersTotal} up | primary ${snap.primaryHost ?? "none"} | writes ${snap.writes ? "ok" : "no"} | reads ${snap.reads ? "ok" : "no"}${electionWait}`;
};

export const logMongoTopologyIfChanged = (): void => {
  const snap = getMongoTopology();
  const key = `${snap.membersUp}/${snap.membersTotal}|${snap.primaryHost ?? "none"}|${snap.writes}|${snap.reads}|${snap.electionPossible}`;
  if (key === lastLogKey) return;
  lastLogKey = key;
  logger.info(formatRs(snap));
};

export const attachMongoTopologyMonitor = (): void => {
  if (monitorBound) return;
  monitorBound = true;

  mongoose.connection.on("disconnected", () => {
    if (shuttingDown) return;
    const snap = getMongoTopology();
    if (snap.reads) return;
    logger.warn(
      `MongoDB socket dropped | readyState=${mongoose.connection.readyState} | ${formatRs(snap)}`,
    );
  });

  const client = mongoose.connection.getClient() as unknown as {
    on: (
      event: string,
      listener: (event: { newDescription?: TopologyDesc }) => void,
    ) => void;
  };

  client.on("topologyDescriptionChanged", (event) => {
    if (event.newDescription) cachedDescription = event.newDescription;
    logMongoTopologyIfChanged();
  });
};
