// Execute the real worker/reindex code with isolated service doubles. No network or database access.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

async function load(relative, doubles, context) {
  const modules = new Map();
  async function source(path) {
    if (modules.has(path)) return modules.get(path);
    const code = stripTypeScriptTypes(await readFile(new URL(path, root), "utf8"));
    const module = new vm.SourceTextModule(code, { context, identifier: path });
    modules.set(path, module);
    await module.link(async (specifier) => {
      if (specifier.endsWith("/import-results.js")) return source("src/search/import-results.ts");
      const exports = doubles[specifier];
      assert.ok(exports, `Unmocked dependency: ${specifier}`);
      return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context });
    });
    return module;
  }
  const module = await source(relative);
  await module.evaluate();
  return module;
}

const silent = { log() {}, warn() {}, error() {}, info() {} };

async function checkWorker(result, shouldFail) {
  let handle;
  const operations = [];
  const context = vm.createContext({ console: silent });
  const module = await load("src/workers/index.worker.ts", {
    "../ai/index.js": { ai: { embedModelId: () => "test-model" } },
    "../bootstrap/kafka.js": { GROUPS: { index: "test-index" }, TOPICS: { productsIndex: "test-products" }, startConsumer: async (_group, _topic, _label, handler) => { handle = handler; } },
    "../bootstrap/logger.js": { logger: silent },
    "../bootstrap/typesense.js": { typesense: { collections: () => ({ documents: () => ({ delete: async () => operations.push("delete") }) }) } },
    "../features/products/products.model.js": { ProductModel: {
      find: () => ({ lean: async () => [{ _id: "p1" }, { _id: "p2" }] }),
      updateMany: async () => operations.push("status"),
    } },
    "../search/embeddings.js": { vectorsByKeys: async () => new Map() },
    "../search/typesense.schema.js": {
      ensureProductsCollection: async () => ({ collection: "live", embedModel: "test-model", dims: 2 }),
      toProductDoc: (p) => ({ id: p._id }),
      importDocs: async () => { operations.push("import"); return result; },
      isNotFound: () => false,
    },
  }, context);
  await module.namespace.startIndexWorker();
  const run = () => handle([{ id: "p1" }, { id: "p2" }, { id: "deleted", delete: true }]);
  if (shouldFail) {
    await assert.rejects(run, /Typesense import incomplete/);
    assert.deepEqual(operations, ["import"], "Failed batch must reject before status updates or later side effects");
  } else {
    await run();
    assert.deepEqual(operations, ["import", "status", "delete"]);
  }
}

async function checkReindex(result, shouldFail) {
  const operations = [];
  const processState = { exitCode: 0 };
  let disconnected;
  const finished = new Promise((resolve) => { disconnected = resolve; });
  const context = vm.createContext({ console: silent, process: processState, performance });
  const products = [{ _id: "p1", embedKey: "test-model:p1" }, { _id: "p2", embedKey: "test-model:p2" }];
  await load("src/search/reindex.ts", {
    "../bootstrap/mongo-host-dns.js": {},
    mongoose: { default: { connection: { name: "jaldi_test" } } },
    "../ai/index.js": { ai: { embedDims: async () => 2, embedModelId: () => "test-model" } },
    "../bootstrap/database.js": { connectDatabase: async () => {}, disconnectDatabase: async () => disconnected() },
    "../bootstrap/typesense.js": { tsNames: { productsAlias: "products" }, typesense: {
      health: { retrieve: async () => {} },
      aliases: () => ({ upsert: async () => operations.push("alias") }),
      collections: () => ({ delete: async () => operations.push("delete-old") }),
    } },
    "../catalog/embed-text.js": { embedTextFor: () => "milk" },
    "../features/products/products.model.js": { ProductModel: {
      estimatedDocumentCount: async () => 2,
      find: () => ({ lean: () => ({ cursor: async function* () { yield* products; } }) }),
      updateMany: async () => operations.push("status"),
    } },
    "../shared/cli.js": { assertSafeDatabase() {}, confirm: async () => true, hasFlag: () => false, intFlag: () => 2000 },
    "./embeddings.js": { getOrCreateEmbeddings: async () => new Map(), vectorsByKeys: async () => new Map() },
    "./typesense.schema.js": {
      activeProductsCollection: async () => ({ collection: "old" }),
      newProductsCollectionName: () => "new",
      createProductsCollection: async () => operations.push("create"),
      toProductDoc: (p) => ({ id: p._id }),
      importDocs: async () => { operations.push("import"); return result; },
    },
  }, context);
  await finished;
  assert.equal(processState.exitCode, shouldFail ? 1 : 0);
  assert.deepEqual(operations, shouldFail ? ["create", "import"] : ["create", "import", "alias", "status", "delete-old"],
    "Failed rebuild must preserve the live alias, product statuses and old collection");
}

for (const result of [{ ok: 1, failed: 1, firstError: "Invalid price" }, { ok: 0, failed: 2 }, { ok: 1, failed: 0 }]) {
  await checkWorker(result, true);
}
await checkWorker({ ok: 2, failed: 0 }, false);
await checkReindex({ ok: 1, failed: 1, firstError: "Invalid price" }, true);
await checkReindex({ ok: 0, failed: 2 }, true);
await checkReindex({ ok: 2, failed: 0 }, false);
console.log("ok    indexing worker and reindex failure/success paths (7 scenarios, isolated services)");
