/** Typesense can accept an HTTP request while rejecting individual documents. */
export interface ImportSummary {
  ok: number;
  failed: number;
  firstError?: string;
}

/** A missing or malformed result is not evidence that a document was indexed. */
export function summarizeImportResults(results: unknown, expected: number): ImportSummary {
  if (!Array.isArray(results) || results.length !== expected) {
    throw new Error(`Typesense import returned an incomplete response: expected ${expected} document results`);
  }
  let ok = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const result of results) {
    if (!result || typeof result.success !== "boolean") {
      throw new Error("Typesense import returned a malformed document result");
    }
    if (result.success) ok += 1;
    else {
      failed += 1;
      firstError ??= typeof result.error === "string" ? result.error : "Document rejected without an error message";
    }
  }
  return { ok, failed, firstError };
}

/** Call before acknowledging an indexing batch or publishing a rebuilt collection. */
export function requireCompleteImport(result: ImportSummary, expected: number): void {
  if (result.failed !== 0 || result.ok !== expected) {
    throw new Error(`Typesense import incomplete: ${result.ok} of ${expected} indexed, ${result.failed} failed${result.firstError ? ` (${result.firstError})` : ""}`);
  }
}
