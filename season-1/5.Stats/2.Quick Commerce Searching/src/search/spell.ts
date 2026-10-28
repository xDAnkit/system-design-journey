// Hinglish spelling fix for the keyword search: "maccharaa", "doodhhh", "chaaawal" -> a dictionary word.
// Typesense forgives 2 typos, but stretched Hinglish words are often 3 edits away ("maccharaa" vs "machhar").
import { tagRules } from "../ai/tagging/kb.js";
import { STOP_WORDS, editDistance, isLatin, normalize } from "../ai/tagging/tag-rules.js";
import { BASE_ITEMS } from "../catalog/index.js";

/** One key for spellings that sound the same: double letters, a final "a", oo/u, ee/i, w/v, z/j, ph/f, q/k */
export const soundKey = (w: string): string =>
  w
    .replace(/ph/g, "f")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/(.)\1+/g, "$1")
    .replace(/o/g, "u")
    .replace(/e/g, "i")
    .replace(/(.)\1+/g, "$1")
    .replace(/a$/, "");

// every Roman word the dictionary and the catalog know: these are never "fixed"
const VOCAB = new Set<string>();
const addWords = (text: string): void => {
  const t = normalize(text);
  if (isLatin(t)) for (const w of t.split(" ")) if (w) VOCAB.add(w);
};
for (const terms of Object.values(tagRules.terms)) terms.forEach(addWords);
tagRules.knownBrands.forEach(addWords);
for (const item of BASE_ITEMS) [item.name, ...item.brands, ...item.variants].forEach(addWords);

const BY_SOUND = new Map<string, string[]>();
for (const w of VOCAB) {
  if (w.length < 3) continue;
  const key = soundKey(w);
  BY_SOUND.set(key, [...(BY_SOUND.get(key) ?? []), w]);
}

/**
 * A word the dictionary does not know, but knows by sound, becomes the closest dictionary word.
 * Only when it is 2+ edits away: Typesense already forgives 1 typo, and a 1-edit "fix" can change
 * the meaning of a good query ("chai peeni hai" must not turn into "peene ka paani").
 */
export function spellFix(text: string): string {
  return text
    .split(" ")
    .map((w) => {
      if (w.length < 4 || VOCAB.has(w) || STOP_WORDS.has(w) || !isLatin(w)) return w;
      const options = BY_SOUND.get(soundKey(w));
      if (!options) return w;
      const best = options.reduce((a, b) => (editDistance(w, b) < editDistance(w, a) ? b : a));
      return editDistance(w, best) >= 2 ? best : w;
    })
    .join(" ");
}
