const replicaSetName = "fk-rs";

const config = {
  _id: replicaSetName,
  members: [
    { _id: 0, host: "host.docker.internal:27017", priority: 2 },
    { _id: 1, host: "host.docker.internal:27018", priority: 1 },
    { _id: 2, host: "host.docker.internal:27019", priority: 1 },
  ],
};

function alreadyInitiated() {
  try {
    const status = rs.status();
    return status.ok === 1 && status.set === replicaSetName;
  } catch {
    return false;
  }
}

if (alreadyInitiated()) {
  print("fk-rs already initiated, skip rs.initiate");
} else {
  print("initiating fk-rs");
  const result = rs.initiate(config);
  printjson(result);
  if (result.ok !== 1) {
    throw new Error("rs.initiate failed");
  }
}

const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  try {
    if (db.hello().isWritablePrimary) {
      break;
    }
  } catch {
    // election in progress
  }
  sleep(1000);
}

if (!db.hello().isWritablePrimary) {
  throw new Error("timed out waiting for PRIMARY");
}

const concern = db.adminCommand({
  setDefaultRWConcern: 1,
  defaultWriteConcern: { w: "majority" },
});
printjson(concern);

print("fk-rs ready, w:majority");
