// pnpm check: every self check, no database, no Kafka, no network.
import { run as tagRules } from "./ai/tagging/tag-rules.check.js";
import { run as rollup } from "./analytics/rollup.check.js";
import { run as catalog } from "./seed/catalog.check.js";
import { run as queryParser } from "./search/query-parser.check.js";
import { run as dateRange } from "./shared/date-range.check.js";

const checks: Array<[string, () => void]> = [
  ["tag rules (port of Tag-Generator.js selfTest)", tagRules],
  ["catalog, product generator, locations", catalog],
  ["query parser (brand, size, price), intents, spelling fix", queryParser],
  ["date ranges in IST", dateRange],
  ["analytics rollup (events -> daily counters)", rollup],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    run();
    console.log(`ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  }
}
if (failed) {
  console.error(`\n${failed} of ${checks.length} checks failed`);
  process.exit(1);
}
console.log(`\nall ${checks.length} checks passed`);
