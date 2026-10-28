// Global synonym list, built from the KB: milk = doodh = दूध. Product tags already carry these words;
// synonyms also help when a query word is not in any product's tags.
import { tagRules } from "../ai/tagging/kb.js";
import { normalize } from "../ai/tagging/tag-rules.js";
import { typesense, tsNames } from "../bootstrap/typesense.js";

const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

export const synonymItems = (): Array<{ id: string; synonyms: string[] }> =>
  Object.entries(tagRules.kb)
    .map(([category, kb]) => {
      // few words per set: long sets also expand into near-neighbour products and hurt precision
      const words = [kb.english[0], ...kb.hindi.slice(0, 2), kb.all_langs.Hindi?.[0]].filter((w): w is string => Boolean(w)).map(normalize);
      return { id: slug(category) || "category", synonyms: [...new Set(words)].filter((w) => w.length > 1) };
    })
    .filter((item) => item.synonyms.length >= 2);

/** Typesense v30 synonym set. Collections link to it by name. Idempotent. */
export async function upsertSynonyms(): Promise<number> {
  const items = synonymItems();
  await typesense.synonymSets(tsNames.synonymSet).upsert({ items } as never);
  return items.length;
}
