import { LANGS } from "../../shared/text.js";
import { tagRules } from "./kb.js";
import type { Analysis } from "./tag-rules.js";

// From Tag-Generator.js, plus the 12-script part that won the LLM bake-off (gemma3:4b).
const BASE_RULES = `You are a catalog expert for an Indian quick-commerce grocery app.
Return JSON with:
- corrected_name: product name with spelling fixed.
- brand: brand name only, "" if none.
- product_type: generic product type in English, 1-3 words, no brand (e.g. "detergent powder").
- english_synonyms: 6 different English words/phrases Indian shoppers type to find this product type.
- hinglish: 4 search phrases in Hindi written in English letters only (Roman script).`;

const SCRIPT_RULES = `- scripts: for the product type, the everyday word shoppers use in each language, written in that language's own script only.
  Translate the item itself, not the brand, size or pack. Use the real word of each language, never spell the English or Hindi word in another script. 1 or 2 short words per language.`;

const SAFETY = `Every value must be about THIS product only. No sizes, prices or other products.
STRICT: never output abusive, vulgar, sexual, offensive or insulting words in any language or spelling, and never mention beef or pork. If unsure about a word, leave it out.`;

// few-shot example for the scripts, straight from the user's KB, so the words are curated
const waterExample = (): string => {
  const water = tagRules.kb.water;
  if (!water) return "";
  const scripts = Object.fromEntries(LANGS.map((lang) => [lang, (water.all_langs[lang] ?? []).slice(0, 2)]));
  return `Example "scripts" for product type "water": ${JSON.stringify(scripts)}`;
};

export const tagSystemPrompt = (withScripts: boolean): string =>
  withScripts ? `${BASE_RULES}\n${SCRIPT_RULES}\n${SAFETY}\n${waterExample()}` : `${BASE_RULES}\n${SAFETY}`;

/** The user message, same fields as understandLLM() in Tag-Generator.js */
export const tagUserPrompt = (product: string, a: Analysis, known: string[]): string =>
  [
    `Product: "${product}"`,
    a.category ? `Product type: ${a.category}` : "",
    a.brand ? `Brand: ${a.brand}` : "",
    a.quals.length ? `Variant: ${a.quals.join(", ")}. Keep this variant in every phrase.` : "",
    known.length ? `Already have (give different ones): ${JSON.stringify(known.slice(0, 12))}` : "",
  ]
    .filter(Boolean)
    .join("\n");
