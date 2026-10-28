#!/usr/bin/env node
/**
 * ZEPTO ENTERPRISE TAG ENGINE - V8
 * All Indian Languages + Interactive Mode
 *
 * Pipeline (rules first, LLM only where it is reliable):
 *   1. normalize      -> lowercase, drop sizes/punctuation
 *   2. brand          -> brand dictionary + fuzzy ("harpik" -> "harpic")
 *   3. category       -> KB terms (exact > fuzzy) + brand -> category map
 *   4. rule tags      -> KB (product-kb.json): Hinglish, English, 12 scripts, typos
 *                        missing scripts derived from Hindi by transliteration
 *   5. LLM            -> spelling fix, English synonyms, Hinglish (JSON schema)
 *   6. validation     -> drop tags about other products / other variants / off-topic
 *
 * Usage:
 *   node Tag-Generator.js                              -> interactive
 *   node Tag-Generator.js "Tata Salt 1kg"              -> single product
 *   node Tag-Generator.js --file in.txt --out tags.json
 *   node Tag-Generator.js --test                       -> self check (no LLM)
 *   TAG_MODEL=qwen3.5:9b node Tag-Generator.js         -> other model
 *   TAG_LLM_SCRIPTS=1 ...                              -> also take Indic scripts from LLM
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");

const CONFIG = {
  MODEL: process.env.TAG_MODEL || "qwen2.5-coder:3b",
  OLLAMA_URL: "http://localhost:11434/api/chat",
  KB_FILE: path.join(__dirname, "product-kb.json"),
  TIMEOUT_MS: 60000,
  MAX_TAGS: 50,
  // ponytail: off by default, qwen2.5-coder:3b writes garbage in Indic scripts. Turn on only
  // after eyeballing a bigger model's output (qwen3.5:9b etc).
  LLM_SCRIPTS: process.env.TAG_LLM_SCRIPTS === "1",
  OPTIONS: { temperature: 0.1, num_predict: 600, repeat_penalty: 1.1, num_ctx: 2048 },
};

const KB = JSON.parse(fs.readFileSync(CONFIG.KB_FILE, "utf8"));
const PRODUCT_KB = KB.categories;

// Variant words (buffalo milk, mustard oil...). hi = Roman Hindi forms, script = Devanagari,
// ka = Hindi uses "ka" ("bhains ka dudh"), native = other-script forms
// used only to drop conflicting tags (cow milk tags on a buffalo milk product)
const QUALIFIERS = {
  buffalo: { hi: ["bhains", "bhais", "bhens"], script: "भैंस", ka: true, native: ["भैंस", "মহিষ"] },
  cow: {
    hi: ["gaay", "gai", "gau"],
    script: "गाय",
    ka: true,
    native: ["गाय", "ఆవు", "ಹಸುವಿನ", "പശുവിൻ", "ਗਾਂ", "گائے", "பசும்பால்"],
  },
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
const qualForms = (q) => [q, ...QUALIFIERS[q].hi];
const QUAL_WORDS = Object.keys(QUALIFIERS).flatMap(qualForms);

// Words that look like a brand (first word) but aren't
const GENERIC_WORDS = new Set(
  "full fresh pure organic premium toned double cow buffalo white brown desi classic original gold special new natural healthy blue green red"
    .split(" "),
);
// Connector words, never count as "about the product"
const STOP_WORDS = new Set("ka ki ke wala wali wale karne ke liye for of the and se with in".split(" "));
// Words that turn a product into a different product ("milk" -> "milk powder", "shampoo" ->
// "conditioner"). LLM tag with one of these is dropped unless the category's own KB uses it.
const FORM_WORDS = new Set(
  "powder cream essence conditioner serum spray wipes carton box set mix sauce paste gel lotion oil syrup flavour flavor bottle tray combo kit holder stand".split(" "),
);

// Never in any tag, whatever the source (product name, KB, LLM). Substring match, so
// "beefsteak" / "porkchop" are caught too. Abusive words are handled in the LLM prompt.
const BLOCKED = ["beef", "beaf", "pork", "bacon", "gomaans", "gaumaans", "suar", "sooar", "बीफ", "पोर्क", "सूअर", "गोमांस"];
const isBlocked = (tag) => BLOCKED.some((w) => tag.includes(w));

const UNITS =
  /\b\d+(\.\d+)?\s*(kg|kgs|g|gm|gms|grams?|ml|l|ltr|litres?|liters?|pcs?|pack)\b/gi;

// lowercase, drop sizes + punctuation, keep all scripts (\p{M} + ZWJ/ZWNJ needed for Indic)
function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/['’]/g, "") // "lay's" -> "lays"
    .replace(UNITS, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s‌‍]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^| )(\S+(?: \S+)*?)(?: \2)+(?= |$)/gu, "$1$2"); // "coca cola coca cola" -> "coca cola"
}

// whole-word match, works for every script ("toilet" must not match "oil")
const has = (text, term) => ` ${text} `.includes(` ${term} `);
const isLatin = (t) => /^[a-z0-9 ]+$/.test(t);

// Levenshtein + adjacent swap ("mlik" -> "milk" = 1)
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// best fuzzy hit of any term inside text (same word count window), Latin terms only
function fuzzyFind(text, terms, maxTypos) {
  const words = text.split(" ");
  let best = null;
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
const termTypos = (t) => (t.length >= 9 ? 2 : t.length >= 6 ? 1 : 0);
const brandTypos = (t) => (t.length >= 9 ? 2 : t.length >= 5 ? 1 : 0);

// ================= TRANSLITERATION (Devanagari -> other Indic scripts) =================
// Indic Unicode blocks share one layout, so क (U+0915) -> ক (U+0995) -> க (U+0B95)...
// ponytail: phonetic copy, fine for loanwords ("टॉयलेट क्लीनर"), not a translation.
// Upgrade path: AI4Bharat IndicXlit for real transliteration.
const SCRIPTS = {
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
const LANGS = ["Hindi", "Marathi", ...Object.keys(SCRIPTS), "Urdu"];
const DRAVIDIAN = new Set(["Tamil", "Telugu", "Kannada", "Malayalam"]);
// used when the target script has no such letter
const FALLBACK = { "ॉ": "ो", "ॅ": "े", "ऑ": "ओ", "ऍ": "ए", "ँ": "ं", "व": "ब", "ष": "श", "ळ": "ल", "़": "" };
// Tamil has one letter per consonant group (क ख ग घ -> க)
const TAMIL_FOLD = {};
for (const [to, from] of [["क", "खगघ"], ["च", "छझ"], ["ट", "ठडढ"], ["त", "थदध"], ["प", "फबभ"]])
  for (const c of from) TAMIL_FOLD[c] = to;
TAMIL_FOLD["ं"] = "म्";

function translit(dev, lang) {
  if (lang === "Hindi" || lang === "Marathi") return dev;
  if (!SCRIPTS[lang]) return null; // Urdu: different script family
  const [script, base] = SCRIPTS[lang];
  const valid = new RegExp(`^\\p{Script=${script}}$`, "u");
  const conv = (ch) => {
    const cp = ch.codePointAt(0);
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

// fill languages the KB entry doesn't have, from its Hindi word
for (const kb of Object.values(PRODUCT_KB)) {
  const hindi = kb.all_langs.Hindi?.[0];
  if (!hindi) continue;
  for (const lang of LANGS) if (!kb.all_langs[lang]) {
    // Assamese shares Bengali script, a curated Bengali spelling beats a transliteration
    const bn = kb.all_langs.Bengali?.[0];
    const t = lang === "Assamese" && bn ? bn.replace(/র/g, "ৰ") : translit(hindi, lang);
    if (t) kb.all_langs[lang] = [t];
  }
}

// ================= INDEXES (built once from KB) =================
const TERMS = {};
for (const [cat, kb] of Object.entries(PRODUCT_KB)) {
  TERMS[cat] = [
    ...new Set([cat, ...kb.hindi, ...kb.english, ...kb.typos, ...Object.values(kb.all_langs).flat()].map(normalize)),
  ];
}
const ALL_TERMS = new Set(Object.values(TERMS).flat());
const ALL_WORDS = new Set([...ALL_TERMS].flatMap((t) => t.split(" ")));
// Auto blacklist: every other category's terms
const FOREIGN = {};
for (const cat of Object.keys(TERMS)) {
  const own = new Set(TERMS[cat]);
  FOREIGN[cat] = [...ALL_TERMS].filter((t) => !own.has(t));
}
// brand -> its only category (umbrella brands like amul/tata point nowhere)
const BRAND_CAT = {};
for (const [cat, kb] of Object.entries(PRODUCT_KB)) {
  for (const b of kb.brands.map(normalize)) BRAND_CAT[b] = b in BRAND_CAT ? null : cat;
}
// longest first so "tata sampann" wins over "tata"
const KNOWN_BRANDS = [...new Set([...KB.umbrella_brands.map(normalize), ...Object.keys(BRAND_CAT)])].sort(
  (a, b) => b.length - a.length,
);
const TYPOS = new Set(Object.values(PRODUCT_KB).flatMap((k) => k.typos));

// ================= ANALYSIS =================
// { brand, fixed } with the brand's typo corrected ("harpik blue" -> "harpic blue")
function detectBrand(text) {
  const exact = KNOWN_BRANDS.find((b) => has(text, b));
  if (exact) return { brand: exact, fixed: text };
  const fuzzy = fuzzyFind(text, KNOWN_BRANDS, brandTypos);
  return fuzzy ? { brand: fuzzy.term, fixed: fuzzy.fixed } : { brand: null, fixed: text };
}

// unknown brand: first word, if it isn't a product word
function guessBrand(text) {
  const first = text.split(" ")[0];
  if (!first || first.length <= 2 || /^\d/.test(first)) return null;
  if (ALL_WORDS.has(first) || GENERIC_WORDS.has(first) || QUAL_WORDS.includes(first)) return null;
  return first;
}

// { category, fixed }. Score per KB term found: its word count, +1 if it is the last word
// (head noun: "tomato KETCHUP", "aloo BHUJIA"), +0.5 tie-break for a single-category brand.
function detectCategory(text, brand) {
  // brand's own words don't count: "cadbury DAIRY MILK" is chocolate, "tata TEA gold" via brand
  const rest = brand ? ` ${text} `.replace(` ${brand} `, " ").trim() : text;
  let best = null;
  let bestScore = 0;
  for (const [cat, terms] of Object.entries(TERMS)) {
    let score = terms
      .filter((t) => has(rest, t))
      .reduce((s, t) => s + t.split(" ").length + (rest === t || rest.endsWith(` ${t}`) ? 1 : 0), 0);
    if (brand && BRAND_CAT[brand] === cat) score += 0.5;
    if (score > bestScore) [best, bestScore] = [cat, score];
  }
  if (best) return { category: best, fixed: text };

  // fuzzy fallback: "sanitarry pads" -> "sanitary pads"
  let fix = null;
  for (const [cat, terms] of Object.entries(TERMS)) {
    const hit = fuzzyFind(text, terms, termTypos);
    if (hit && (!fix || hit.dist < fix.dist)) fix = { ...hit, category: cat };
  }
  return fix ? { category: fix.category, fixed: fix.fixed } : { category: null, fixed: text };
}

function analyze(product) {
  const text = normalize(product);
  const b = detectBrand(text);
  const { category, fixed } = detectCategory(b.fixed, b.brand);
  const brand = b.brand || guessBrand(fixed);
  const quals = Object.keys(QUALIFIERS).filter((q) => qualForms(q).some((f) => has(fixed, f)));
  // words an LLM tag must touch to count as "about this product"
  const source = category ? TERMS[category] : [text, fixed];
  const words = (arr) => arr.filter(Boolean).flatMap((t) => t.split(" ")).filter((w) => !STOP_WORDS.has(w));
  const anchors = new Set(words([...source, ...quals.flatMap(qualForms)]));
  // anchors + words the user typed: LLM tag may add at most 1 word outside this set
  const familiar = new Set([...anchors, ...words([text, fixed, brand])]);
  return { text, fixed, category, brand, quals, anchors, familiar };
}

// tag mentions a variant the product doesn't have -> conflict
// (buffalo milk -> no "cow milk"; plain Tata Salt -> no "sendha namak"; Dove -> no "anti dandruff")
function conflicts(tag, quals) {
  return Object.keys(QUALIFIERS)
    .filter((q) => !quals.includes(q))
    .some((q) => [...qualForms(q), ...(QUALIFIERS[q].native || [])].some((f) => has(tag, f)));
}

// how Indians mistype brands: harpic -> harpik, lizol -> lisol, maggi -> magi
const PHONETIC = [[/c(?!h)/g, "k"], [/ph/g, "f"], [/ee/g, "i"], [/oo/g, "u"], [/([a-z])\1/g, "$1"], [/z/g, "s"], [/w/g, "v"], [/x/g, "ks"]];
const phoneticTypos = (w) => [...new Set(PHONETIC.map(([re, r]) => w.replace(re, r)))].filter((v) => v !== w).slice(0, 2);

// ================= RULE TAGS =================
// core = high priority, extras = 2nd variants per language (go after LLM tags)
function generateRuleTags({ text, fixed = text, category, brand, quals = [] }) {
  const core = [];
  const extras = [];
  const push = (arr) => (t) => {
    t = t && normalize(t);
    if (t && !core.includes(t) && !extras.includes(t) && !conflicts(t, quals)) arr.push(t);
  };
  const add = push(core);

  add(fixed);
  add(text); // user's own typo is a real search query too
  if (brand) add(brand);
  KNOWN_BRANDS.filter((b) => has(fixed, b)).forEach(add); // "cadbury" too, not just "dairy milk"

  const kb = category && PRODUCT_KB[category];
  if (kb) {
    // variant combos first, most specific: "bhains ka dudh", "bhais milk", "buffalo mik"
    const plain = (arr) => arr.filter((w) => !QUAL_WORDS.some((f) => has(w, f)));
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
    LANGS.forEach((l) => add(kb.all_langs[l]?.[0])); // 1 per language
    kb.typos.forEach(add);
    LANGS.forEach((l) => (kb.all_langs[l] || []).slice(1).forEach(push(extras)));
  }
  if (brand && isLatin(brand)) {
    phoneticTypos(brand).forEach((t) => {
      add(t);
      if (kb) add(`${t} ${category}`);
    });
  }
  return { core, extras };
}

// word is in set, or 1 typo away from a word in it
const near = (w, set) => set.has(w) || (w.length >= 4 && [...set].some((a) => a.length >= 4 && editDistance(a, w) <= 1));

function isValidTag(tag, { category, brand, quals = [], anchors, familiar = anchors }) {
  if (tag.length < 2 || tag.length > 40 || tag.split(" ").length > 5) return false;
  if (/\d/.test(tag)) return false; // sizes, prices, "1kg" noise
  if (conflicts(tag, quals)) return false; // "cow milk" for buffalo, "olive oil" for sunflower, invented variants
  // reject tags that mention another product ("tata namak" for milk)
  if (category && FOREIGN[category].some((f) => has(tag, f))) return false;
  if (!isLatin(tag)) return true; // Indic scripts can't be word-checked
  const words = tag.split(" ").filter((w) => !STOP_WORDS.has(w));
  // "milk powder" / "hair conditioner" = different product
  if (words.some((w) => FORM_WORDS.has(w) && !anchors.has(w))) return false;
  if (new Set(words).size < words.length) return false; // "energy shot energy drink"
  if (brand && has(tag, brand) && !tag.startsWith(brand)) return false; // "crisps lays", "sabun dettol"
  if (!words.some((w) => near(w, anchors))) return false; // drops "toilet paper" for sanitary pad
  // ponytail: KB product -> LLM may only recombine words we already trust ("surf excel laundry
  // detergent"). A 3B model's new words were mostly wrong ("mutter paneer", "tandoori chips").
  // Unknown product -> allow 1 new word. Loosen with a bigger model / embeddings check.
  if (category) return words.length >= 2 && words.every((w) => familiar.has(w));
  return words.filter((w) => !near(w, familiar)).length <= 1;
}

// ================= LLM =================
const STR = { type: "string" };
const ARR = { type: "array", items: STR };
const LLM_SCHEMA = {
  type: "object",
  properties: {
    corrected_name: STR,
    brand: STR,
    product_type: STR,
    english_synonyms: ARR,
    hinglish: ARR,
    ...(CONFIG.LLM_SCRIPTS ? { hindi_devanagari: ARR } : {}),
  },
  required: ["corrected_name", "brand", "product_type", "english_synonyms", "hinglish", ...(CONFIG.LLM_SCRIPTS ? ["hindi_devanagari"] : [])],
};
const LLM_SYSTEM = `You are a catalog expert for an Indian quick-commerce app (Zepto/Blinkit).
Return JSON with:
- corrected_name: product name with spelling fixed.
- brand: brand name only, "" if none.
- product_type: generic product type in English, 1-3 words, no brand (e.g. "detergent powder").
- english_synonyms: 6 different English words/phrases Indian shoppers type to find this product type.
- hinglish: 4 search phrases in Hindi written in English letters only (Roman script).${CONFIG.LLM_SCRIPTS ? "\n- hindi_devanagari: 3 search words for this product in Hindi Devanagari script." : ""}
Every value must be about THIS product only. No sizes, prices or other products.
STRICT: never output abusive, vulgar, sexual, offensive or insulting words in any language or spelling, and never mention beef or pork. If unsure about a word, leave it out.`;

async function understandLLM(product, { category, brand, quals }, known) {
  const user = [
    `Product: "${product}"`,
    category ? `Product type: ${category}` : "",
    brand ? `Brand: ${brand}` : "",
    quals.length ? `Variant: ${quals.join(", ")}. Keep this variant in every phrase.` : "",
    known.length ? `Already have (give different ones): ${JSON.stringify(known.slice(0, 12))}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const res = await fetch(CONFIG.OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(CONFIG.TIMEOUT_MS),
      body: JSON.stringify({
        model: CONFIG.MODEL,
        messages: [
          { role: "system", content: LLM_SYSTEM },
          { role: "user", content: user },
        ],
        stream: false,
        think: false, // qwen3.x thinks by default, 10x slower and not needed here
        format: LLM_SCHEMA, // Ollama forces this exact JSON shape
        options: CONFIG.OPTIONS,
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const out = JSON.parse((await res.json()).message?.content || "{}");
    const list = (v) => (Array.isArray(v) ? v.filter((t) => typeof t === "string").map(normalize).filter(Boolean) : []);
    return {
      corrected_name: normalize(out.corrected_name || ""),
      product_type: normalize(out.product_type || ""),
      english_synonyms: list(out.english_synonyms),
      hinglish: list(out.hinglish).filter(isLatin), // coder model writes Devanagari junk here
      hindi_devanagari: list(out.hindi_devanagari).filter((t) => /^[ऀ-ॿ\s‌‍]+$/.test(t)),
    };
  } catch (e) {
    console.error(`⚠️  LLM skipped (${e.message}), rule tags only`);
    return { english_synonyms: [], hinglish: [], hindi_devanagari: [] };
  }
}

async function generateFinalTags(product) {
  const t0 = Date.now();
  let a = analyze(product);
  let { core, extras } = generateRuleTags(a);
  // show the LLM the KB's own words so it adds new ones, not brand combos it can't improve
  const kb = a.category && PRODUCT_KB[a.category];
  const llm = await understandLLM(product, a, kb ? [...kb.english, ...kb.hindi] : core.slice(0, 8));

  // rules found no category -> retry with the LLM's spelling fix / product type
  if (!a.category) {
    for (const guess of [llm.corrected_name, llm.product_type]) {
      const b = guess ? analyze(guess) : null;
      if (b?.category) {
        a = { ...b, text: a.text, brand: a.brand || b.brand };
        ({ core, extras } = generateRuleTags(a));
        break;
      }
    }
  }

  // still unknown: LLM product type becomes the anchor ("bisleri" -> "mineral water")
  const generic = [];
  if (!a.category && llm.product_type) {
    generic.push(llm.product_type);
    if (a.brand) generic.push(`${a.brand} ${llm.product_type}`);
    const ptWords = llm.product_type.split(" ").filter((w) => !STOP_WORDS.has(w));
    a.anchors = new Set([...a.anchors, ...ptWords]);
    a.familiar = new Set([...a.familiar, ...ptWords]);
  }

  const llmTags = [
    ...llm.english_synonyms,
    ...(a.brand ? llm.english_synonyms.slice(0, 2).map((s) => normalize(`${a.brand} ${s}`)) : []),
    ...llm.hinglish,
  ].filter((t) => isValidTag(t, a));

  // LLM Hindi -> all scripts, only when no KB entry has curated ones
  const scripts = a.category
    ? []
    : llm.hindi_devanagari.flatMap((h) => LANGS.map((l) => translit(h, l)).filter(Boolean));

  const tags = [...new Set([...core, ...generic, ...llmTags, ...scripts, ...extras])]
    .filter((t) => !isBlocked(t))
    .slice(0, CONFIG.MAX_TAGS);
  return {
    product,
    corrected: a.fixed,
    category: a.category || "generic",
    brand: a.brand,
    tags,
    llm_added: llmTags.filter((t) => !core.includes(t)).length,
    time: ((Date.now() - t0) / 1000).toFixed(2),
  };
}

function detectLang(tag) {
  if (/[ঀ-৿]/.test(tag)) return "(Bengali/Assamese)";
  if (/[઀-૿]/.test(tag)) return "(Gujarati)";
  if (/[஀-௿]/.test(tag)) return "(Tamil)";
  if (/[ఀ-౿]/.test(tag)) return "(Telugu)";
  if (/[ಀ-೿]/.test(tag)) return "(Kannada)";
  if (/[ഀ-ൿ]/.test(tag)) return "(Malayalam)";
  if (/[਀-੿]/.test(tag)) return "(Punjabi)";
  if (/[଀-୿]/.test(tag)) return "(Odia)";
  if (/[؀-ۿ]/.test(tag)) return "(Urdu)";
  if (/[ऀ-ॿ]/.test(tag)) return "(Hindi/Marathi)";
  if (TYPOS.has(tag)) return "(Typo)";
  return "(EN/HI)";
}

// ================= INTERACTIVE CLI =================
async function interactiveMode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`
╔════════════════════════════════════════════════╗
║   ZEPTO ENTERPRISE TAG ENGINE - ALL LANGS      ║
║   Model: ${CONFIG.MODEL.padEnd(38)}║
║   KB: ${String(Object.keys(PRODUCT_KB).length).padEnd(3)} product types                       ║
║   Languages: HI, BN, GU, MR, TA, TE, KN, ML,   ║
║              PA, OR, AS, UR + English + Typo   ║
║   Type 'exit' to quit                          ║
╚════════════════════════════════════════════════╝
`);

  for (;;) {
    const ans = (await rl.question("\n📦 Product naam likh > ")).trim().replace(/^["']+|["']+$/g, "");
    if (["exit", "quit", "q"].includes(ans.toLowerCase())) break;
    if (!ans) continue;

    console.log(`\n⏳ Generating for "${ans}"...`);
    const res = await generateFinalTags(ans);

    const fixedNote = res.corrected !== normalize(ans) ? ` → "${res.corrected}"` : "";
    console.log(
      `\n✅ ${res.product}${fixedNote} [${res.category}${res.brand ? ` | ${res.brand}` : ""}] (${res.time}s) - ${res.tags.length} tags (${res.llm_added} from LLM)`,
    );
    console.log("────────────────────────────────────────");
    res.tags.forEach((t, i) => console.log(`${String(i + 1).padStart(2)}. ${t.padEnd(28)} ${detectLang(t)}`));
    console.log("────────────────────────────────────────");
    console.log(`\nJSON: ${JSON.stringify(res.tags)}`);
    fs.writeFileSync("last_tags.json", JSON.stringify(res, null, 2));
  }
  console.log("\nBye! Last tags saved to last_tags.json");
  rl.close();
}

// ================= FILE MODE =================
async function fileMode(filePath, outPath) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const products = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  console.log(`\nBatch: ${products.length} products`);
  const results = [];
  // ponytail: sequential, Ollama serves one request at a time anyway
  for (const p of products) {
    const res = await generateFinalTags(p);
    results.push(res);
    console.log(`${p} => ${res.tags.length} tags [${res.category}] ${res.time}s`);
  }
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

function selfTest() {
  const assert = require("assert");
  const salt = analyze("Tata Salt 1kg");
  assert.equal(salt.text, "tata salt");
  assert.equal(salt.category, "salt");
  assert.equal(salt.brand, "tata");
  assert.deepEqual(salt.quals, []);
  // variants
  const buf = generateRuleTags(analyze("Buffalo Milk 1L"));
  for (const t of ["bhains ka dudh", "bhais milk", "buffalo mik", "भैंस का दूध"]) assert(buf.core.includes(t), t);
  assert(![...buf.core, ...buf.extras].some((t) => t.includes("cow") || t.includes("ఆవు")));
  assert.equal(analyze("Bhains ka Dudh").brand, null);
  assert(!isValidTag("cow milk", analyze("buffalo milk")));
  // typos + off-topic LLM tags
  const pad = analyze("sanitry pad");
  assert.equal(pad.category, "sanitary pad");
  assert.equal(pad.brand, null);
  assert(!isValidTag("toilet paper", pad) && !isValidTag("washcloth", pad));
  assert(isValidTag("sanitary pad for periods", pad));
  assert(!isValidTag("whisper pad", pad)); // other brand's name on this product = wrong
  assert.equal(analyze("sanitarry pads").fixed, "sanitary pads");
  // brand typo + brand -> category
  const harpic = analyze("harpik blue toilet cleaner");
  assert.equal(harpic.brand, "harpic");
  assert.equal(harpic.fixed, "harpic blue toilet cleaner");
  assert.equal(harpic.category, "toilet cleaner");
  const ht = generateRuleTags(harpic).core;
  for (const t of ["bathroom cleaner", "harpik", "टॉयलेट क्लीनर", "டாய்லெட் கிளீனர்", "harpic toilet cleaner"]) assert(ht.includes(t), t);
  assert(ht.some((t) => /[઀-૿]/.test(t)), "derived Gujarati");
  assert.equal(analyze("Lizol citrus 975ml").category, "floor cleaner");
  assert.equal(analyze("floor cleaner").category, "floor cleaner"); // not "flour"
  assert.equal(analyze("Cadbury Dairy Milk").category, "chocolate");
  assert.equal(analyze("Parachute coconut hair oil").category, "hair oil");
  assert.equal(analyze("Harpic Toilet Cleaner").category, "toilet cleaner"); // not "oil"
  assert.equal(analyze("Amul Butter").category, "butter");
  assert.equal(analyze("Full Cream Milk").brand, null);
  assert.equal(analyze("Tata Sampann Toor Dal").brand, "tata sampann");
  // head noun + brand words don't count
  assert.equal(analyze("Kissan tomato ketchup").category, "ketchup");
  assert.equal(analyze("Haldiram aloo bhujia").category, "namkeen");
  assert.equal(analyze("Lifebuoy handwash").category, "handwash");
  assert.equal(analyze("Tata Tea Gold 500g").category, "tea");
  assert.equal(normalize("coca cola coca cola thanda"), "coca cola thanda");
  // LLM junk filters
  const sun = analyze("Fortune Sunflower Oil");
  assert(!isValidTag("olive oil", sun) && isValidTag("edible sunflower oil", sun));
  const dove = analyze("Dove Intense Repair Shampoo");
  assert(!isValidTag("hair conditioner", dove) && !isValidTag("intensive hair care", dove));
  assert(isValidTag("dove repair shampoo", dove));
  assert(!isValidTag("amul toned milk powder", analyze("Amul Taaza Toned Milk")));
  const paneer = analyze("Mother Dairy Paneer");
  assert(!isValidTag("mutter paneer", paneer) && isValidTag("mother dairy paneer block", paneer));
  assert(!isValidTag("balloon ka shampoo", dove)); // fuzzy "balon" is not enough for KB products
  assert(!isValidTag("brown bread britannia", analyze("Britannia brown bread")));
  assert(!isValidTag("energy shot energy drink", analyze("Red Bull energy drink")));
  assert(generateRuleTags(analyze("Cadbury Dairy Milk Silk")).core.includes("cadbury"));
  // variants: no invented / conflicting variant
  assert(!isValidTag("dove anti dandruff shampoo", dove));
  const toned = analyze("Amul Taaza Toned Milk");
  assert(!isValidTag("amul full cream milk", toned));
  const tonedTags = generateRuleTags(toned);
  assert(![...tonedTags.core, ...tonedTags.extras].includes("full cream"));
  const plainSalt = generateRuleTags(analyze("Tata Salt"));
  assert(![...plainSalt.core, ...plainSalt.extras].some((t) => /sendha|kala|सेंधा/.test(t)));
  assert(!generateRuleTags(dove).core.includes("anti dandruff shampoo"));
  const brownBread = generateRuleTags(analyze("Britannia brown bread"));
  assert(!brownBread.core.includes("white bread") && brownBread.core.includes("ब्राउन ब्रेड"));
  // blocked words
  assert(isBlocked("beef curry cut") && isBlocked("porkchop") && isBlocked("बीफ"));
  assert(!isBlocked("beer") && !isBlocked("paneer") && !isBlocked("toilet cleaner"));
  // transliteration
  assert.equal(translit("क्लीनर", "Punjabi"), "ਕਲੀਨਰ");
  assert.equal(translit("ड्रिंक", "Punjabi"), "ਡ੍ਰਿੰਕ");
  assert.equal(translit("टॉयलेट", "Gujarati"), "ટૉયલેટ");
  assert.equal(translit("क्लीनर", "Tamil"), "க்லீநர்");
  // KB core
  const { core } = generateRuleTags(analyze("Aashirvaad Atta"));
  assert(core.includes("आटा") && core.includes("aashirvaad atta") && core.includes("ಹಿಟ್ಟು"));
  const milk = analyze("milk");
  assert(!isValidTag("tata namak", milk));
  assert(isValidTag("milk doodh", milk) && !isValidTag("doodh packet", milk));
  assert(!isValidTag("cow milk doodh", milk)); // invented variant
  assert(!isValidTag("amul milk 500", milk));
  console.log("selftest ok");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--test")) return selfTest();
  if (args.includes("--file")) {
    const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "tags.json";
    return fileMode(args[args.indexOf("--file") + 1], out);
  }
  if (args.length > 0 && !args[0].startsWith("--")) {
    const res = await generateFinalTags(args.join(" "));
    return console.log(JSON.stringify(res, null, 2));
  }
  return interactiveMode();
}

main();
