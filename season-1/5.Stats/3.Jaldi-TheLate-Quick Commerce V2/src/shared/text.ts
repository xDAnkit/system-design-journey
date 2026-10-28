import crypto from "node:crypto";

// The 12 languages of product-kb.json, in display order
export const LANGS = ["Hindi", "Marathi", "Bengali", "Assamese", "Gujarati", "Punjabi", "Odia", "Tamil", "Telugu", "Kannada", "Malayalam", "Urdu"] as const;
export type Lang = (typeof LANGS)[number];

/** What a search was typed in. Roman = Latin letters (English or Hinglish, we can't tell them apart cheaply). */
export type Script = "Roman" | "Devanagari" | "Bengali" | "Gujarati" | "Gurmukhi" | "Odia" | "Tamil" | "Telugu" | "Kannada" | "Malayalam" | "Urdu" | "Other";

const BLOCKS: Array<[Script, number, number]> = [
  ["Devanagari", 0x0900, 0x097f],
  ["Bengali", 0x0980, 0x09ff],
  ["Gurmukhi", 0x0a00, 0x0a7f],
  ["Gujarati", 0x0a80, 0x0aff],
  ["Odia", 0x0b00, 0x0b7f],
  ["Tamil", 0x0b80, 0x0bff],
  ["Telugu", 0x0c00, 0x0c7f],
  ["Kannada", 0x0c80, 0x0cff],
  ["Malayalam", 0x0d00, 0x0d7f],
  ["Urdu", 0x0600, 0x06ff],
  ["Urdu", 0x0750, 0x077f],
  ["Urdu", 0xfb50, 0xfdff],
  ["Urdu", 0xfe70, 0xfeff],
];

/** Which script each language is written in */
export const LANG_SCRIPT: Record<Lang, Script> = {
  Hindi: "Devanagari",
  Marathi: "Devanagari",
  Bengali: "Bengali",
  Assamese: "Bengali",
  Gujarati: "Gujarati",
  Punjabi: "Gurmukhi",
  Odia: "Odia",
  Tamil: "Tamil",
  Telugu: "Telugu",
  Kannada: "Kannada",
  Malayalam: "Malayalam",
  Urdu: "Urdu",
};

// \p{M} keeps Indic vowel signs and viramas
const letters = (s: string): string[] => [...s.normalize("NFC")].filter((c) => /[\p{L}\p{M}]/u.test(c));

const scriptOfChar = (c: string): Script => {
  const cp = c.codePointAt(0) ?? 0;
  if (cp <= 0x024f) return "Roman";
  for (const [script, lo, hi] of BLOCKS) if (cp >= lo && cp <= hi) return script;
  return "Other";
};

/** Main script of a text: the script most of its letters are in. */
export const detectScript = (s: string): Script => {
  const counts = new Map<Script, number>();
  for (const c of letters(s)) {
    const script = scriptOfChar(c);
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  let best: Script = "Roman";
  let max = 0;
  for (const [script, n] of counts) if (n > max) [best, max] = [script, n];
  return best;
};

/** True when every letter is in the script, spaces, digits and ZWJ ignored. */
export const isInScript = (s: string, script: Script): boolean => {
  const ls = letters(s);
  return ls.length > 0 && ls.every((c) => scriptOfChar(c) === script);
};

/** True when the text has any letter outside Latin, i.e. it is already typed in a native script. */
export const hasNativeScript = (s: string): boolean => letters(s).some((c) => scriptOfChar(c) !== "Roman");

/** Lowercase, NFC, single spaces. The key for caches, counters and analytics. */
export const normalizeQuery = (s: string): string =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s‌‍.₹-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const sha1 = (s: string): string => crypto.createHash("sha1").update(s).digest("hex");

/** Strip anything that looks like markup or a control character from user text. */
export const cleanText = (s: string, max: number): string =>
  s
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
