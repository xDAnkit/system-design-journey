export type ParsedMongoUri = { auth: string; hosts: string[]; db: string; query: string };

// replicaSet / directConnection / w / retryWrites / readPreference are decided in code per
// detected mode, so an old URI that still carries them cannot fight the detection.
const CODE_OWNED = new Set(["replicaset", "directconnection", "w", "retrywrites", "readpreference"]);

// new URL() rejects comma-separated hosts, so split by hand. Only mongodb:// (srv has one host, no split needed).
export const parseMongoUri = (uri: string): ParsedMongoUri => {
  const m = /^mongodb:\/\/(?:([^@/]*)@)?([^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/.exec(uri);
  if (!m) throw new Error("MONGO_URI must look like mongodb://[user:pass@]host1,host2/db");

  const query = (m[4] ?? "")
    .split("&")
    .filter((kv) => kv && !CODE_OWNED.has((kv.split("=")[0] ?? "").toLowerCase()))
    .join("&");

  return { auth: m[1] ? `${m[1]}@` : "", hosts: m[2].split(","), db: m[3] ?? "", query };
};

export const buildMongoUri = (p: ParsedMongoUri, hosts: string[]): string =>
  `mongodb://${p.auth}${hosts.join(",")}/${p.db}${p.query ? `?${p.query}` : ""}`;
