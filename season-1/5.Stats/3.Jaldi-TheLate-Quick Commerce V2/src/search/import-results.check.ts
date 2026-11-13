import assert from "node:assert/strict";
import { requireCompleteImport, summarizeImportResults } from "./import-results.js";

export function run(): void {
  const complete = summarizeImportResults([{ success: true }, { success: true }], 2);
  assert.equal(complete.ok, 2);
  assert.equal(complete.failed, 0);
  assert.doesNotThrow(() => requireCompleteImport(complete, 2));
  assert.doesNotThrow(() => requireCompleteImport(summarizeImportResults([], 0), 0));

  const partial = summarizeImportResults([{ success: true }, { success: false, error: "Invalid price" }], 2);
  assert.deepEqual(partial, { ok: 1, failed: 1, firstError: "Invalid price" });
  assert.throws(() => requireCompleteImport(partial, 2), /1 of 2 indexed, 1 failed \(Invalid price\)/);

  const rejected = summarizeImportResults([{ success: false }, { success: false, error: "Invalid name" }], 2);
  assert.equal(rejected.ok, 0);
  assert.equal(rejected.failed, 2);
  assert.equal(rejected.firstError, "Document rejected without an error message");
  assert.throws(() => requireCompleteImport(rejected, 2), /0 of 2 indexed, 2 failed/);

  // Reindex totals must be complete across all batches, even if the final batch succeeded.
  assert.throws(() => requireCompleteImport({ ok: complete.ok + partial.ok, failed: partial.failed }, 4), /3 of 4 indexed/);
  assert.throws(() => requireCompleteImport({ ok: 1, failed: 0 }, 2), /1 of 2 indexed/);

  for (const results of [undefined, null, {}, [], [{ success: true }], [{ success: true }, { success: true }, { success: true }]]) {
    assert.throws(() => summarizeImportResults(results, 2), /incomplete response/);
  }
  for (const result of [null, {}, { success: "true" }, { success: 1 }]) {
    assert.throws(() => summarizeImportResults([result], 1), /malformed document result/);
  }
}
