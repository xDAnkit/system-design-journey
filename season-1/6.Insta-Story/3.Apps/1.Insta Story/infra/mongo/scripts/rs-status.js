const s = rs.status();
const pad = (v, n) => String(v ?? "-").padEnd(n);
const members = s.members || [];
const primary = members.find((m) => m.stateStr === "PRIMARY");
const up = members.filter((m) => m.health === 1).length;
const down = members.length - up;

print("");
print(`replica set : ${s.set}`);
print(`PRIMARY     : ${primary ? primary.name : "NONE (no majority / election)"}`);
print(`health      : ${up} up, ${down} down  |  majority needs ${s.majorityVoteCount}/${s.votingMembersCount}`);
print(`writes      : ${primary && up >= s.majorityVoteCount ? "ok (w:majority possible)" : "blocked"}`);
print("");
print(`${pad("ROLE", 26)}${pad("HEALTH", 8)}${pad("HOST", 34)}SYNC FROM`);
print("-".repeat(90));

for (const m of members) {
  const health = m.health === 1 ? "up" : "DOWN";
  const sync = m.syncSourceHost || (m.stateStr === "PRIMARY" ? "(self)" : "-");
  print(`${pad(m.stateStr, 26)}${pad(health, 8)}${pad(m.name, 34)}${sync}`);
}

print("");
