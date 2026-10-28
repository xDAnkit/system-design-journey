/**
 * Rule-based tags: a TypeScript port of Content/7.AI Searching/Tag-Generator.js (V8).
 * Same pipeline and same rules: normalize -> brand -> category -> KB tags -> validation.
 * createTagRules(kb) builds every index from one KB, so the self check can run on the
 * original KB while the app runs on the merged one.
 */
import type { Lang } from "../../shared/text.js";

export interface KbCategory {
  hindi: string[];
  english: string[];
  all_langs: Partial<Record<Lang, string[]>>;
  typos: string[];
  brands: string[];
}

export interface Kb {
  umbrella_brands: string[];
  categories: Record<string, KbCategory>;
}

interface Qualifier {
  hi: string[];
  script: string;
  ka?: boolean;
  native?: string[];
}

// Variant words (buffalo milk, mustard oil...). hi = Roman Hindi forms, script = Devanagari,
// ka = Hindi uses "ka" ("bhains ka dudh"), native = other-script forms, used only to drop conflicting tags.
const QUALIFIERS: Record<string, Qualifier> = {
  buffalo: { hi: ["bhains", "bhais", "bhens"], script: "भैंस", ka: true, native: ["भैंस", "মহিষ"] },
  cow: { hi: ["gaay", "gai", "gau"], script: "गाय", ka: true, native: ["गाय", "ఆవు", "ಹಸುವಿನ", "പശുവിൻ", "ਗਾਂ", "گائے", "பசும்பால்"] },
  mustard: { hi: ["sarson"], script: "सरसों", ka: true, native: ["सरसों", "সরিষার", "मोहरी", "கடுகு", "ఆవ", "ಸಾಸಿವೆ", "കടുക്", "ਸਰ੍ਹੋਂ", "ସୋରିଷ", "সৰিয়হৰ", "سرسوں", "સરસવ"] },
  sunflower: { hi: ["surajmukhi"], script: "सूरजमुखी", ka: true },
  groundnut: { hi: ["mungfali", "moongfali", "peanut"], script: "मूंगफली", ka: true },
  olive: { hi: [], script: "ऑलिव" },
  coconut: { hi: ["nariyal"], script: "नारियल", ka: true },
  soybean: { hi: ["soya"], script: "सोयाबीन" },
  canola: { hi: ["rapeseed"], script: "कनोला" },
  "rice bran": { hi: [], script: "राइस ब्रान" },
  toned: { hi: [], script: "टोंड" },
  "double toned": { hi: [], script: "डबल टोंड" },
  "full cream": { hi: [], script: "फुल क्रीम" },
  skimmed: { hi: [], script: "स्किम्ड" },
  brown: { hi: [], script: "ब्राउन" },
  white: { hi: ["safed"], script: "सफ़ेद" },
  "anti dandruff": { hi: [], script: "एंटी डैंड्रफ" },
  rock: { hi: ["sendha"], script: "सेंधा", native: ["सेंधा", "सैंधव", "ਸੇਂਧਾ", "ସୈନ୍ଧବ", "সৈন্ধৱ", "سیندھا", "கல்", "రాతి", "ಕಲ್ಲುಪ್ಪು", "കല്ലുപ്പ്"] },
  black: { hi: ["kala"], script: "काला" },
};
const qualForms = (q: string): string[] => [q, ...QUALIFIERS[q].hi];
const QUAL_WORDS = Object.keys(QUALIFIERS).flatMap(qualForms);

// Words that look like a brand (first word) but aren't
const GENERIC_WORDS = new Set(
  "full fresh pure organic premium toned double cow buffalo white brown desi classic original gold special new natural healthy blue green red".split(" "),
);
// Connector words, never count as "about the product"
export const STOP_WORDS = new Set("ka ki ke wala wali wale karne ke liye for of the and se with in".split(" "));
// Words that turn a product into a different product ("milk" -> "milk powder"). Dropped unless the category's own KB uses them.
const FORM_WORDS = new Set(
  "powder cream essence conditioner serum spray wipes carton box set mix sauce paste gel lotion oil syrup flavour flavor bottle tray combo kit holder stand".split(" "),
);

// Never in any tag, whatever the source. Substring match, so "beefsteak" / "porkchop" are caught too.
const BLOCKED = ["beef", "beaf", "pork", "bacon", "gomaans", "gaumaans", "suar", "sooar", "बीफ", "पोर्क", "सूअर", "गोमांस"];
export const isBlocked = (tag: string): boolean => BLOCKED.some((w) => tag.includes(w));

const UNITS = /\b\d+(\.\d+)?\s*(kg|kgs|g|gm|gms|grams?|ml|l|ltr|litres?|liters?|pcs?|pack)\b/gi;

/** lowercase, drop sizes + punctuation, keep all scripts (\p{M} + ZWJ/ZWNJ needed for Indic) */
export function normalize(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/['’]/g, "") // "lay's" -> "lays"
    .replace(UNITS, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s‌‍]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^| )(\S+(?: \S+)*?)(?: \2)+(?= |$)/gu, "$1$2"); // "coca cola coca cola" -> "coca cola"
}

/** whole-word match, works for every script ("toilet" must not match "oil") */
export const has = (text: string, term: string): boolean => ` ${text} `.includes(` ${term} `);
export const isLatin = (t: string): boolean => /^[a-z0-9 ]+$/.test(t);

/** Levenshtein + adjacent swap ("mlik" -> "milk" = 1) */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

interface FuzzyHit {
  term: string;
  dist: number;
  fixed: string;
}

/** best fuzzy hit of any term inside text (same word count window), Latin terms only */
export function fuzzyFind(text: string, terms: string[], maxTypos: (t: string) => number): FuzzyHit | null {
  const words = text.split(" ");
  let best: FuzzyHit | null = null;
  for (const term of terms) {
    if (!isLatin(term) || !maxTypos(term)) continue;
    const k = term.split(" ").length;
    for (let i = 0; i + k <= words.length; i++) {
      const dist = editDistance(words.slice(i, i + k).join(" "), term);
      if (dist <= maxTypos(term) && (!best || dist < best.dist)) {
        best = { term, dist, fixed: [...words.slice(0, i), term, ...words.slice(i + k)].join(" ") };
      }
    }
  }
  return best;
}
// ponytail: short terms get no fuzzy ("floor" must not become "flour"), add those to KB typos
const termTypos = (t: string): number => (t.length >= 9 ? 2 : t.length >= 6 ? 1 : 0);
const brandTypos = (t: string): number => (t.length >= 9 ? 2 : t.length >= 5 ? 1 : 0);

// ================= TRANSLITERATION (Devanagari -> other Indic scripts) =================
// Indic Unicode blocks share one layout, so क (U+0915) -> ক (U+0995) -> க (U+0B95)...
// ponytail: phonetic copy, fine for loanwords ("टॉयलेट क्लीनर"), not a translation.
// Upgrade path: AI4Bharat IndicXlit for real transliteration.
const SCRIPTS: Partial<Record<Lang, [string, number]>> = {
  Bengali: ["Bengali", 0x980],
  Assamese: ["Bengali", 0x980],
  Gujarati: ["Gujarati", 0xa80],
  Punjabi: ["Gurmukhi", 0xa00],
  Odia: ["Oriya", 0xb00],
  Tamil: ["Tamil", 0xb80],
  Telugu: ["Telugu", 0xc00],
  Kannada: ["Kannada", 0xc80],
  Malayalam: ["Malayalam", 0xd00],
};
export const RULE_LANGS: Lang[] = ["Hindi", "Marathi", ...(Object.keys(SCRIPTS) as Lang[]), "Urdu"];
const DRAVIDIAN = new Set<Lang>(["Tamil", "Telugu", "Kannada", "Malayalam"]);
// used when the target script has no such letter
const FALLBACK: Record<string, string> = { "ॉ": "ो", "ॅ": "े", "ऑ": "ओ", "ऍ": "ए", "ँ": "ं", "व": "ब", "ष": "श", "ळ": "ल", "़": "" };
// Tamil has one letter per consonant group (क ख ग घ -> க)
const TAMIL_FOLD: Record<string, string> = {};
for (const [to, from] of [["क", "खगघ"], ["च", "छझ"], ["ट", "ठडढ"], ["त", "थदध"], ["प", "फबभ"]]) for (const c of from) TAMIL_FOLD[c] = to;
TAMIL_FOLD["ं"] = "म्";

export function translit(dev: string, lang: Lang): string | null {
  if (lang === "Hindi" || lang === "Marathi") return dev;
  const target = SCRIPTS[lang];
  if (!target) return null; // Urdu: different script family
  const [script, base] = target;
  const valid = new RegExp(`^\\p{Script=${script}}$`, "u");
  const conv = (ch: string): string | null => {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x900 || cp > 0x97f) return ch;
    const t = String.fromCodePoint(cp - 0x900 + base);
    return valid.test(t) ? t : null;
  };
  let out = "";
  for (const ch of dev) {
    for (const c of lang === "Tamil" && TAMIL_FOLD[ch] ? TAMIL_FOLD[ch] : ch) {
      if (c === "़" && lang !== "Punjabi") continue; // only Gurmukhi really writes nukta (ਫ਼)
      const t = conv(c);
      out += t ?? (FALLBACK[c] !== undefined ? [...FALLBACK[c]].map(conv).join("") : "");
    }
  }
  // per-script spelling habits
  if (lang === "Punjabi") {
    out = out
      .replace(/੍(?![ਰਵਹਯ])/g, "") // Punjabi drops halant: ਕ੍ਲੀਨਰ -> ਕਲੀਨਰ
      .replace(/([ਕ-ਹ][ਿੁ]?)ਂ/g, "$1ੰ"); // tippi after short vowel: ਡ੍ਰਿਂਕ -> ਡ੍ਰਿੰਕ
  }
  if (lang === "Bengali" || lang === "Assamese") out = out.replace(/(^|[^্])য/g, "$1য়"); // টোযলেট -> টোয়লেট
  if (lang === "Odia") out = out.replace(/(^|[^୍])ଯ/g, "$1ଯ଼").replace(/ଵ/g, "ୱ");
  // Dravidian scripts write a dead final consonant with virama: क्लीनर -> க்லீநர்
  if (DRAVIDIAN.has(lang)) {
    const cons = `[\\u{${(base + 0x15).toString(16)}}-\\u{${(base + 0x39).toString(16)}}]`;
    out = out.replace(new RegExp(`(${cons})(?=\\s|$)`, "gu"), `$1${String.fromCodePoint(base + 0x4d)}`);
  }
  if (lang === "Assamese") out = out.replace(/র/g, "ৰ");
  return out;
}

// how Indians mistype brands: harpic -> harpik, lizol -> lisol, maggi -> magi
const PHONETIC: Array<[RegExp, string]> = [[/c(?!h)/g, "k"], [/ph/g, "f"], [/ee/g, "i"], [/oo/g, "u"], [/([a-z])\1/g, "$1"], [/z/g, "s"], [/w/g, "v"], [/x/g, "ks"]];
export const phoneticTypos = (w: string): string[] => [...new Set(PHONETIC.map(([re, r]) => w.replace(re, r)))].filter((v) => v !== w).slice(0, 2);

export interface Analysis {
  text: string;
  fixed: string;
  category: string | null;
  brand: string | null;
  quals: string[];
  anchors: Set<string>;
  familiar: Set<string>;
}

export interface RuleTags {
  /** high priority tags */
  core: string[];
  /** 2nd variants per language, go after LLM tags */
  extras: string[];
}

export type TagRules = ReturnType<typeof createTagRules>;

export function createTagRules(source: Kb) {
  const KB: Record<string, KbCategory> = structuredClone(source.categories);

  // fill languages a KB entry doesn't have, from its Hindi word
  for (const kb of Object.values(KB)) {
    const hindi = kb.all_langs.Hindi?.[0];
    if (!hindi) continue;
    for (const lang of RULE_LANGS) {
      if (kb.all_langs[lang]) continue;
      // Assamese shares Bengali script, a curated Bengali spelling beats a transliteration
      const bn = kb.all_langs.Bengali?.[0];
      const t = lang === "Assamese" && bn ? bn.replace(/র/g, "ৰ") : translit(hindi, lang);
      if (t) kb.all_langs[lang] = [t];
    }
  }

  // ================= INDEXES (built once from KB) =================
  const TERMS: Record<string, string[]> = {};
  for (const [cat, kb] of Object.entries(KB)) {
    TERMS[cat] = [...new Set([cat, ...kb.hindi, ...kb.english, ...kb.typos, ...Object.values(kb.all_langs).flat()].map(normalize))];
  }
  const ALL_TERMS = new Set(Object.values(TERMS).flat());
  const ALL_WORDS = new Set([...ALL_TERMS].flatMap((t) => t.split(" ")));
  // Auto blacklist: every other category's terms
  const FOREIGN: Record<string, string[]> = {};
  for (const cat of Object.keys(TERMS)) {
    const own = new Set(TERMS[cat]);
    FOREIGN[cat] = [...ALL_TERMS].filter((t) => !own.has(t));
  }
  // brand -> its only category (umbrella brands like amul/tata point nowhere)
  const BRAND_CAT: Record<string, string | null> = {};
  for (const [cat, kb] of Object.entries(KB)) {
    for (const b of kb.brands.map(normalize)) BRAND_CAT[b] = b in BRAND_CAT ? null : cat;
  }
  // longest first so "tata sampann" wins over "tata"
  const KNOWN_BRANDS = [...new Set([...source.umbrella_brands.map(normalize), ...Object.keys(BRAND_CAT)])].sort((a, b) => b.length - a.length);
  const TYPOS = new Set(Object.values(KB).flatMap((k) => k.typos.map(normalize)));
  const HINDI_WORDS = new Set([...Object.values(KB).flatMap((k) => k.hindi.map(normalize)), ...Object.values(QUALIFIERS).flatMap((q) => q.hi)].flatMap((t) => t.split(" ")));

  // ================= ANALYSIS =================
  /** { brand, fixed } with the brand's typo corrected ("harpik blue" -> "harpic blue") */
  function detectBrand(text: string): { brand: string | null; fixed: string } {
    const exact = KNOWN_BRANDS.find((b) => has(text, b));
    if (exact) return { brand: exact, fixed: text };
    const fuzzy = fuzzyFind(text, KNOWN_BRANDS, brandTypos);
    return fuzzy ? { brand: fuzzy.term, fixed: fuzzy.fixed } : { brand: null, fixed: text };
  }

  /** unknown brand: first word, if it isn't a product word */
  function guessBrand(text: string): string | null {
    const first = text.split(" ")[0];
    if (!first || first.length <= 2 || /^\d/.test(first)) return null;
    if (ALL_WORDS.has(first) || GENERIC_WORDS.has(first) || QUAL_WORDS.includes(first)) return null;
    return first;
  }

  // Score per KB term found: its word count, +1 if it is the last word (head noun: "tomato KETCHUP"),
  // +0.5 tie-break for a single-category brand.
  function detectCategory(text: string, brand: string | null): { category: string | null; fixed: string } {
    // brand's own words don't count: "cadbury DAIRY MILK" is chocolate
    const rest = brand ? ` ${text} `.replace(` ${brand} `, " ").trim() : text;
    let best: string | null = null;
    let bestScore = 0;
    for (const [cat, terms] of Object.entries(TERMS)) {
      let score = terms.filter((t) => has(rest, t)).reduce((s, t) => s + t.split(" ").length + (rest === t || rest.endsWith(` ${t}`) ? 1 : 0), 0);
      if (brand && BRAND_CAT[brand] === cat) score += 0.5;
      if (score > bestScore) [best, bestScore] = [cat, score];
    }
    if (best) return { category: best, fixed: text };

    // fuzzy fallback: "sanitarry pads" -> "sanitary pads"
    let fix: (FuzzyHit & { category: string }) | null = null;
    for (const [cat, terms] of Object.entries(TERMS)) {
      const hit = fuzzyFind(text, terms, termTypos);
      if (hit && (!fix || hit.dist < fix.dist)) fix = { ...hit, category: cat };
    }
    return fix ? { category: fix.category, fixed: fix.fixed } : { category: null, fixed: text };
  }

  /** forcedCategory: the admin picked the category, use it instead of detecting one (must exist in the KB) */
  function analyze(product: string, forcedCategory?: string | null): Analysis {
    const text = normalize(product);
    const b = detectBrand(text);
    const detected = detectCategory(b.fixed, b.brand);
    const category = forcedCategory && KB[forcedCategory] ? forcedCategory : detected.category;
    const fixed = detected.fixed;
    const brand = b.brand || guessBrand(fixed);
    const quals = Object.keys(QUALIFIERS).filter((q) => qualForms(q).some((f) => has(fixed, f)));
    // words an LLM tag must touch to count as "about this product"
    const source = category ? TERMS[category] : [text, fixed];
    const words = (arr: Array<string | null>): string[] =>
      arr
        .filter((t): t is string => Boolean(t))
        .flatMap((t) => t.split(" "))
        .filter((w) => !STOP_WORDS.has(w));
    const anchors = new Set(words([...source, ...quals.flatMap(qualForms)]));
    // anchors + words the user typed: LLM tag may add at most 1 word outside this set
    const familiar = new Set([...anchors, ...words([text, fixed, brand])]);
    return { text, fixed, category, brand, quals, anchors, familiar };
  }

  /** tag mentions a variant the product doesn't have -> conflict ("cow milk" on buffalo milk) */
  function conflicts(tag: string, quals: string[]): boolean {
    return Object.keys(QUALIFIERS)
      .filter((q) => !quals.includes(q))
      .some((q) => [...qualForms(q), ...(QUALIFIERS[q].native ?? [])].some((f) => has(tag, f)));
  }

  // ================= RULE TAGS =================
  function generateRuleTags({ text, fixed = text, category, brand, quals = [] }: Pick<Analysis, "text" | "category" | "brand"> & Partial<Pick<Analysis, "fixed" | "quals">>): RuleTags {
    const core: string[] = [];
    const extras: string[] = [];
    const push = (arr: string[]) => (raw: string | undefined | null) => {
      const t = raw && normalize(raw);
      if (t && !core.includes(t) && !extras.includes(t) && !conflicts(t, quals)) arr.push(t);
    };
    const add = push(core);

    add(fixed);
    add(text); // user's own typo is a real search query too
    if (brand) add(brand);
    KNOWN_BRANDS.filter((b) => has(fixed, b)).forEach(add); // "cadbury" too, not just "dairy milk"

    const kb = category ? KB[category] : undefined;
    if (kb && category) {
      // variant combos first, most specific: "bhains ka dudh", "bhais milk", "buffalo mik"
      const plain = (arr: string[]) => arr.filter((w) => !QUAL_WORDS.some((f) => has(w, f)));
      const hi = plain(kb.hindi).slice(0, 2);
      const en = plain(kb.english)[0] || category;
      const hiScript = kb.all_langs.Hindi?.[0];
      for (const q of quals) {
        const Q = QUALIFIERS[q];
        if (hiScript && Q.script) add(`${Q.script}${Q.ka ? " का" : ""} ${hiScript}`);
        Q.hi.forEach((h) => hi.forEach((w) => add(`${h}${Q.ka ? " ka" : ""} ${w}`)));
        qualForms(q).forEach((f) => add(`${f} ${en}`));
        hi.forEach((w) => add(`${q} ${w}`));
        kb.typos.slice(0, 2).forEach((t) => add(`${q} ${t}`));
        if (brand) add(`${brand} ${q} ${en}`);
      }
      if (brand) {
        hi.forEach((h) => add(`${brand} ${h}`));
        add(`${brand} ${category}`);
        add(`${brand} ${en}`);
        if (hiScript) add(`${brand} ${hiScript}`);
      }
      kb.hindi.forEach(add);
      kb.english.forEach(add);
      RULE_LANGS.forEach((l) => add(kb.all_langs[l]?.[0])); // 1 per language
      kb.typos.forEach(add);
      RULE_LANGS.forEach((l) => (kb.all_langs[l] ?? []).slice(1).forEach(push(extras)));
    }
    if (brand && isLatin(brand)) {
      phoneticTypos(brand).forEach((t) => {
        add(t);
        if (kb) add(`${t} ${category}`);
      });
    }
    return { core, extras };
  }

  /** word is in set, or 1 typo away from a word in it */
  const near = (w: string, set: Set<string>): boolean => set.has(w) || (w.length >= 4 && [...set].some((a) => a.length >= 4 && editDistance(a, w) <= 1));

  function isValidTag(tag: string, { category, brand, quals = [], anchors, familiar = anchors }: Pick<Analysis, "category" | "brand" | "anchors"> & Partial<Pick<Analysis, "quals" | "familiar">>): boolean {
    if (tag.length < 2 || tag.length > 40 || tag.split(" ").length > 5) return false;
    if (/\d/.test(tag)) return false; // sizes, prices, "1kg" noise
    if (conflicts(tag, quals)) return false; // "cow milk" for buffalo, invented variants
    // reject tags that mention another product ("tata namak" for milk)
    if (category && FOREIGN[category].some((f) => has(tag, f))) return false;
    if (!isLatin(tag)) return true; // Indic scripts can't be word-checked
    const words = tag.split(" ").filter((w) => !STOP_WORDS.has(w));
    // "milk powder" / "hair conditioner" = different product
    if (words.some((w) => FORM_WORDS.has(w) && !anchors.has(w))) return false;
    if (new Set(words).size < words.length) return false; // "energy shot energy drink"
    if (brand && has(tag, brand) && !tag.startsWith(brand)) return false; // "crisps lays", "sabun dettol"
    if (!words.some((w) => near(w, anchors))) return false; // drops "toilet paper" for sanitary pad
    // ponytail: KB product -> LLM may only recombine words we already trust. A 3B model's new words
    // were mostly wrong ("mutter paneer"). Unknown product -> allow 1 new word.
    if (category) return words.length >= 2 && words.every((w) => familiar.has(w));
    return words.filter((w) => !near(w, familiar)).length <= 1;
  }

  return {
    kb: KB,
    terms: TERMS,
    knownBrands: KNOWN_BRANDS,
    typos: TYPOS,
    hindiWords: HINDI_WORDS,
    analyze,
    generateRuleTags,
    // also the "other product" filter: a tag holding another category's KB word is rejected, in every script
    isValidTag,
    conflicts,
  };
}
