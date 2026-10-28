// "amul doodh 1 litre 60 se kam" -> brand Amul, size 1 L, price <= 60, text "doodh".
// Rules only, no LLM: it runs on every search and must take microseconds.
import { tagRules } from "../ai/tagging/kb.js";
import { editDistance, has, isLatin, normalize } from "../ai/tagging/tag-rules.js";
import { BASE_ITEMS } from "../catalog/index.js";
import type { SizeUnit } from "../catalog/size.js";

export type FilterKind = "brand" | "price" | "size";

export interface ParsedQuery {
  /** what is left for the keyword + vector search ("" = only filters) */
  text: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  size?: { qty: number; unit: SizeUnit };
  chips: Array<{ kind: FilterKind; label: string }>;
}

// display form of every known brand, keyed by its normalized form; longest first so "tata sampann" beats "tata"
const BRANDS = new Map<string, string>();
for (const item of BASE_ITEMS) for (const b of item.brands) BRANDS.set(normalize(b), b);
for (const b of tagRules.knownBrands) if (!BRANDS.has(b)) BRANDS.set(b, b.replace(/\b\w/g, (c) => c.toUpperCase()));
const BRAND_KEYS = [...BRANDS.keys()].filter((b) => b.length >= 2 && b !== "fresh" && b !== "organic").sort((a, b) => b.length - a.length);

const NUM = "(\\d{1,6}(?:\\.\\d{1,2})?)";
const RS = "(?:rs\\.?|₹|inr|rupees?|रुपये|रु)?";
// Hindi / Hinglish / English ways to say "at most"
const MAX_BEFORE = new RegExp(`(?:under|below|less than|within|upto|up to|max|<=?)\\s*${RS}\\s*${NUM}\\s*${RS}`, "iu");
const MAX_AFTER = new RegExp(`${RS}\\s*${NUM}\\s*${RS}\\s*(?:se kam|se neeche|se niche|tak|ke andar|ke under|or less|से कम|तक|के अंदर|से नीचे)`, "iu");
const MIN_BEFORE = new RegExp(`(?:above|over|more than|>=?)\\s*${RS}\\s*${NUM}\\s*${RS}`, "iu");
const MIN_AFTER = new RegExp(`${RS}\\s*${NUM}\\s*${RS}\\s*(?:se zyada|se jyada|se upar|से ज़्यादा|से ज्यादा|से ऊपर)`, "iu");
// a bare amount with a currency sign: "doodh ₹60", "chips 20 rs"
const BARE_PRICE = new RegExp(`(?:(?:₹|rs\\.?)\\s*${NUM}|${NUM}\\s*(?:rs\\.?|rupees?|₹|रुपये))`, "iu");

const UNITS: Record<string, [SizeUnit, number]> = {
  ml: ["ml", 1], millilitre: ["ml", 1], l: ["ml", 1000], ltr: ["ml", 1000], lit: ["ml", 1000], litre: ["ml", 1000], liter: ["ml", 1000], लीटर: ["ml", 1000],
  g: ["g", 1], gm: ["g", 1], gms: ["g", 1], gram: ["g", 1], grams: ["g", 1], ग्राम: ["g", 1], kg: ["g", 1000], kilo: ["g", 1000], किलो: ["g", 1000],
  pc: ["pcs", 1], pcs: ["pcs", 1], piece: ["pcs", 1], pieces: ["pcs", 1], dozen: ["pcs", 12], दर्जन: ["pcs", 12],
};
const UNIT_WORDS = Object.keys(UNITS).sort((a, b) => b.length - a.length).join("|");
// no \b: JavaScript word boundaries don't work for Devanagari units
const SIZE = new RegExp(`(?<![\\p{L}\\d])${NUM}\\s*(${UNIT_WORDS})(?![\\p{L}\\p{M}])`, "iu");
const HALF = new RegExp(`(?<![\\p{L}])(aadha|adha|half|आधा)\\s*(litre|liter|ltr|l|kilo|kg|लीटर|किलो)(?![\\p{L}\\p{M}])`, "iu");

const sizeLabel = (qty: number, unit: SizeUnit): string => (unit === "ml" && qty >= 1000 ? `${qty / 1000} L` : unit === "g" && qty >= 1000 ? `${qty / 1000} kg` : `${qty} ${unit}`);

const take = (text: string, re: RegExp): { rest: string; match: RegExpExecArray | null } => {
  const match = re.exec(text);
  return { match, rest: match ? `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}` : text };
};

/** Brand at the start or anywhere, exact or 1 typo away (5+ letters): "harpik toilet cleaner" -> Harpic */
const findBrand = (words: string): { key: string; matched: string } | null => {
  for (const key of BRAND_KEYS) if (has(words, key)) return { key, matched: key };
  const tokens = words.split(" ");
  for (const key of BRAND_KEYS) {
    if (key.length < 5 || !isLatin(key)) continue;
    const n = key.split(" ").length;
    for (let i = 0; i + n <= tokens.length; i++) {
      const window = tokens.slice(i, i + n).join(" ");
      if (editDistance(window, key) <= 1) return { key, matched: window };
    }
  }
  return null;
};

export function parseQuery(raw: string, ignore: FilterKind[] = []): ParsedQuery {
  let text = raw.normalize("NFC").toLowerCase();
  const out: ParsedQuery = { text: "", chips: [] };

  if (!ignore.includes("price")) {
    for (const [re, kind] of [
      [MAX_BEFORE, "max"],
      [MAX_AFTER, "max"],
      [MIN_BEFORE, "min"],
      [MIN_AFTER, "min"],
    ] as const) {
      const { match, rest } = take(text, re);
      if (!match) continue;
      text = rest;
      if (kind === "max") out.maxPrice = Number(match[1]);
      else out.minPrice = Number(match[1]);
    }
    if (out.maxPrice === undefined && out.minPrice === undefined) {
      const { match, rest } = take(text, BARE_PRICE);
      if (match) {
        text = rest;
        out.maxPrice = Number(match[1] ?? match[2]);
      }
    }
    if (out.maxPrice !== undefined) out.chips.push({ kind: "price", label: `≤ ₹${out.maxPrice}` });
    if (out.minPrice !== undefined) out.chips.push({ kind: "price", label: `≥ ₹${out.minPrice}` });
  }

  if (!ignore.includes("size")) {
    const half = take(text, HALF);
    if (half.match) {
      const unit = UNITS[half.match[2].toLowerCase()][0];
      out.size = { qty: 500, unit };
      text = half.rest;
    } else {
      const { match, rest } = take(text, SIZE);
      if (match) {
        const [unit, factor] = UNITS[match[2].toLowerCase()];
        out.size = { qty: Math.round(Number(match[1]) * factor), unit };
        text = rest;
      }
    }
    if (out.size) out.chips.push({ kind: "size", label: sizeLabel(out.size.qty, out.size.unit) });
  }

  let words = normalize(text);
  if (!ignore.includes("brand") && words) {
    const found = findBrand(words);
    // a brand alone stays a text search ("maggi"), a brand plus more words becomes a filter ("amul doodh")
    const rest = found ? normalize(` ${words} `.replace(` ${found.matched} `, " ")) : "";
    if (found && rest) {
      out.brand = BRANDS.get(found.key);
      out.chips.push({ kind: "brand", label: out.brand ?? found.key });
      words = rest;
    }
  }
  out.text = words;
  return out;
}
