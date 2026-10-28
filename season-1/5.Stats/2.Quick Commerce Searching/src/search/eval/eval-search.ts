/**
 * pnpm eval:search                     63 intent queries + 300 KB words through the real search
 * pnpm eval:search -- --rewrite        Roman queries go through the LLM rewrite first (slower, like production once cached)
 * pnpm eval:search -- --min=0.6        exit 1 when overall Hit@1 is below 0.6: run it before and after a change
 * pnpm eval:search -- --words=1000     more KB words
 *
 * Read-only: Typesense searches and Ollama calls. No Redis, no Mongo, no events.
 */
import { z } from "zod";
import { ai } from "../../ai/index.js";
import { REWRITE_SYSTEM } from "../../ai/rewrite/rewrite.prompts.js";
import { shouldRewrite } from "../../ai/rewrite/rewrite.js";
import { tagRules } from "../../ai/tagging/kb.js";
import { CATEGORIES } from "../../catalog/index.js";
import { flag, hasFlag, intFlag } from "../../shared/cli.js";
import { LANGS, hasNativeScript } from "../../shared/text.js";
import { searchProducts } from "../search.service.js";
import { EVAL_INTENTS } from "./eval-queries.js";

const WORDS = intFlag("words", 300);
const MIN = flag("min") !== undefined ? Number(flag("min")) : null;
const REWRITE = hasFlag("rewrite");

interface Case {
  text: string;
  group: string;
  expected: string[];
}

/** One KB word per (category, language), taken round robin so every language gets its share. */
const kbWordCases = (): Case[] => {
  const perCategory = Object.keys(CATEGORIES).map((category) => {
    const kb = tagRules.kb[category];
    if (!kb) return [];
    const cases: Case[] = [];
    if (kb.hindi[0]) cases.push({ text: kb.hindi[0], group: "KB word: Romanized", expected: [category] });
    for (const lang of LANGS) {
      const word = kb.all_langs[lang]?.[0];
      if (word) cases.push({ text: word, group: `KB word: ${lang}`, expected: [category] });
    }
    return cases;
  });
  const out: Case[] = [];
  for (let i = 0; out.length < WORDS; i++) {
    let added = false;
    for (const list of perCategory) {
      if (list[i] && out.length < WORDS) {
        out.push(list[i]);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
};

const rewriteOf = async (q: string): Promise<string | null> => {
  if (!REWRITE || !shouldRewrite(q)) return null;
  const res = await ai.generateJson({ name: "rewrite", system: REWRITE_SYSTEM, prompt: q, schema: z.object({ query: z.string() }), maxTokens: 80 }).catch(() => null);
  const out = res?.data.query.trim();
  return out && hasNativeScript(out) ? out : null;
};

const main = async (): Promise<void> => {
  const cases: Case[] = [...EVAL_INTENTS, ...kbWordCases()];
  console.log(`eval: ${cases.length} queries (${EVAL_INTENTS.length} intents + ${cases.length - EVAL_INTENTS.length} KB words), rewrite ${REWRITE ? "on" : "off"}\n`);

  const results: Array<Case & { rank: number; got: string; ms: number }> = [];
  for (const c of cases) {
    const started = performance.now();
    const res = await searchProducts({ q: c.text, perPage: 10, rewrite: await rewriteOf(c.text) });
    const rank = res.hits.findIndex((h) => c.expected.includes(h.category)) + 1;
    results.push({ ...c, rank, got: res.hits[0]?.category ?? "(nothing)", ms: performance.now() - started });
  }

  const groups = [...new Set(results.map((r) => r.group))];
  const row = (name: string, rs: typeof results): string => {
    const hit1 = rs.filter((r) => r.rank === 1).length / rs.length;
    const hit5 = rs.filter((r) => r.rank >= 1 && r.rank <= 5).length / rs.length;
    return `| ${name} | ${rs.length} | ${(hit1 * 100).toFixed(1)} | ${(hit5 * 100).toFixed(1)} |`;
  };
  console.log("| Group | n | Hit@1 % | Hit@5 % |\n|---|---|---|---|");
  for (const g of groups) console.log(row(g, results.filter((r) => r.group === g)));
  console.log(row("ALL", results));

  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\nsearch time p50 ${ms[Math.floor(ms.length / 2)].toFixed(0)} ms, p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(0)} ms (cold cache, includes the embedding call)`);

  const misses = results.filter((r) => r.rank !== 1 && r.group.startsWith("Hinglish")).slice(0, 10);
  if (misses.length) console.log(`\nfirst Hinglish misses:\n${misses.map((m) => `  "${m.text}" wanted ${m.expected.slice(0, 2).join("/")}, got ${m.got}${m.rank ? ` (right one at ${m.rank})` : ""}`).join("\n")}`);

  const overall = results.filter((r) => r.rank === 1).length / results.length;
  if (MIN !== null && overall < MIN) {
    console.error(`\nHit@1 ${(overall * 100).toFixed(1)}% is below --min=${MIN}`);
    process.exitCode = 1;
  }
};

main().catch((err: unknown) => {
  console.error(`eval failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
