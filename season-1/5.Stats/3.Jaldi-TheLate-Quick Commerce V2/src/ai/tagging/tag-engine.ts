/**
 * Tags for one product: KB rules first (instant), then the LLM for extra words, then two filters:
 *   1. right script only (a Tamil tag must be Tamil letters)
 *   2. no other product's words (KB terms of another category), via isValidTag
 * Same flow as generateFinalTags() in Tag-Generator.js. The admin preview and the enrich worker both call this.
 */
import { logger } from "../../bootstrap/logger.js";
import { LANGS, LANG_SCRIPT, detectScript, isInScript, type Lang } from "../../shared/text.js";
import { ai } from "../index.js";
import { tagRules } from "./kb.js";
import { tagSystemPrompt, tagUserPrompt } from "./tag.prompts.js";
import { tagLlmSchema, tagLlmWithScriptsSchema, type TagLlmAnswer, type TagLlmAnswerWithScripts } from "./tag.schema.js";
import { safeTags, withoutTags } from "./tag-guard.js";
import { STOP_WORDS, has, isBlocked, isLatin, normalize, phoneticTypos, type Analysis } from "./tag-rules.js";
import { emptyTagSet, type TagSet } from "./tag.types.js";

export interface TagInput {
  name: string;
  brand?: string | null;
  /** The admin's category pick. Used instead of detecting one, if the KB has it. */
  category?: string | null;
}

export interface TagResult {
  tags: TagSet;
  category: string | null;
  brand: string | null;
  /** product name with spelling fixed by the rules */
  corrected: string;
  /** normalized title the tags were made for */
  tagsFor: string;
  llmUsed: boolean;
  llmError?: string;
  /** LLM or admin tags the safety gate removed (tag-guard.ts) */
  dropped?: string[];
  ms: number;
}

const CAPS = { words: 16, typos: 10, perLang: 3 };

/** The enrich worker re-tags when a product's normalized title no longer matches this. */
export const tagsForName = (name: string): string => normalize(name);

const analyzeInput = (input: TagInput): Analysis => {
  const name = input.name.trim();
  const brand = input.brand?.trim();
  const text = brand && !has(normalize(name), normalize(brand)) ? `${brand} ${name}` : name;
  return tagRules.analyze(text, input.category);
};

// Devanagari is Hindi or Marathi, Bengali script is Bengali or Assamese: the KB lists decide
const langOfNative = (tag: string, category: string | null): Lang | null => {
  const kb = category ? tagRules.kb[category] : undefined;
  const listed = (lang: Lang): boolean => Boolean(kb?.all_langs[lang]?.some((w) => normalize(w) === tag));
  switch (detectScript(tag)) {
    case "Devanagari":
      return listed("Marathi") && !listed("Hindi") ? "Marathi" : "Hindi";
    case "Bengali":
      return (listed("Assamese") && !listed("Bengali")) || /[ৰৱ]/.test(tag) ? "Assamese" : "Bengali";
    case "Gurmukhi":
      return "Punjabi";
    case "Gujarati":
      return "Gujarati";
    case "Odia":
      return "Odia";
    case "Tamil":
      return "Tamil";
    case "Telugu":
      return "Telugu";
    case "Kannada":
      return "Kannada";
    case "Malayalam":
      return "Malayalam";
    case "Urdu":
      return "Urdu";
    default:
      return null;
  }
};

class TagCollector {
  readonly tags = emptyTagSet();

  constructor(
    private readonly category: string | null,
    private readonly brandTypos: Set<string>,
  ) {}

  add(raw: string, fromAi: boolean): void {
    const tag = normalize(raw);
    if (!tag || isBlocked(tag)) return;
    if (isLatin(tag)) {
      const typo = tagRules.typos.has(tag) || this.brandTypos.has(tag);
      const bucket = typo ? this.tags.typos : tag.split(" ").some((w) => tagRules.hindiWords.has(w)) ? this.tags.hinglish : this.tags.en;
      if (bucket.includes(tag) || bucket.length >= (typo ? CAPS.typos : CAPS.words)) return;
      bucket.push(tag);
      if (fromAi) this.tags.ai.push(tag);
      return;
    }
    const lang = langOfNative(tag, this.category);
    if (lang) this.addNative(lang, tag, fromAi);
  }

  addNative(lang: Lang, tag: string, fromAi: boolean): void {
    const list = (this.tags.native[lang] ??= []);
    if (list.includes(tag) || list.length >= CAPS.perLang) return;
    list.push(tag);
    if (fromAi) this.tags.ai.push(tag);
  }
}

const brandTyposOf = (a: Analysis): Set<string> => new Set(a.brand && isLatin(a.brand) ? phoneticTypos(a.brand) : []);

const result = (collector: TagCollector, a: Analysis, input: TagInput, started: number, llmUsed: boolean, llmError?: string): TagResult => ({
  tags: collector.tags,
  category: a.category,
  brand: a.brand,
  corrected: a.fixed,
  tagsFor: tagsForName(input.name),
  llmUsed,
  llmError,
  ms: performance.now() - started,
});

/** KB rules only. Instant, no LLM: the admin preview's first step and the seed. */
export function ruleTags(input: TagInput): TagResult {
  const started = performance.now();
  const a = analyzeInput(input);
  const { core, extras } = tagRules.generateRuleTags(a);
  const collector = new TagCollector(a.category, brandTyposOf(a));
  for (const t of [...core, ...extras]) collector.add(t, false);
  return result(collector, a, input, started, false);
}

/** KB rules + LLM. If the LLM fails, the rule tags still come back (llmError says why). */
export async function generateTags(input: TagInput): Promise<TagResult> {
  const started = performance.now();
  let a = analyzeInput(input);
  let { core, extras } = tagRules.generateRuleTags(a);

  // the KB has curated scripts for its categories, the LLM writes them only for unknown products
  const withScripts = !a.category;
  const kb = a.category ? tagRules.kb[a.category] : undefined;
  let llm: TagLlmAnswer | TagLlmAnswerWithScripts | null = null;
  let llmError: string | undefined;
  try {
    const res = await ai.generateJson<TagLlmAnswer | TagLlmAnswerWithScripts>({
      name: "tags",
      system: tagSystemPrompt(withScripts),
      prompt: tagUserPrompt(input.name, a, kb ? [...kb.english, ...kb.hindi] : core.slice(0, 8)),
      schema: withScripts ? tagLlmWithScriptsSchema : tagLlmSchema,
      maxTokens: withScripts ? 700 : 350,
    });
    llm = res.data;
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err);
    logger.warn(`tags: LLM skipped for "${input.name}" (${llmError}), rule tags only`);
  }

  if (!llm) {
    const collector = new TagCollector(a.category, brandTyposOf(a));
    for (const t of [...core, ...extras]) collector.add(t, false);
    return result(collector, a, input, started, false, llmError);
  }

  // rules found no category: retry with the LLM's spelling fix / product type
  if (!a.category) {
    for (const guess of [llm.corrected_name, llm.product_type]) {
      const b = guess ? tagRules.analyze(guess) : null;
      if (b?.category) {
        a = { ...b, text: a.text, brand: a.brand || b.brand };
        ({ core, extras } = tagRules.generateRuleTags(a));
        break;
      }
    }
  }

  // still unknown: the LLM's product type becomes the anchor ("bisleri" -> "mineral water")
  const generic: string[] = [];
  const productType = normalize(llm.product_type);
  if (!a.category && productType) {
    generic.push(productType);
    if (a.brand) generic.push(normalize(`${a.brand} ${productType}`));
    const words = productType.split(" ").filter((w) => !STOP_WORDS.has(w));
    a = { ...a, anchors: new Set([...a.anchors, ...words]), familiar: new Set([...a.familiar, ...words]) };
  }

  const clean = (v: string[]): string[] => v.map(normalize).filter(Boolean);
  const synonyms = clean(llm.english_synonyms);
  const llmTags = [...synonyms, ...(a.brand ? synonyms.slice(0, 2).map((s) => normalize(`${a.brand} ${s}`)) : []), ...clean(llm.hinglish).filter(isLatin)].filter((t) =>
    tagRules.isValidTag(t, a),
  );

  const collector = new TagCollector(a.category, brandTyposOf(a));
  for (const t of core) collector.add(t, false);
  for (const t of generic) collector.add(t, true);
  for (const t of llmTags) collector.add(t, !core.includes(t));
  if (!a.category && "scripts" in llm) {
    for (const lang of LANGS) {
      for (const raw of llm.scripts[lang] ?? []) {
        const t = normalize(raw);
        if (t && !isBlocked(t) && isInScript(t, LANG_SCRIPT[lang]) && tagRules.isValidTag(t, a)) collector.addNative(lang, t, true);
      }
    }
  }
  for (const t of extras) collector.add(t, false);
  return guardAiTags(collector, a, input, started, new Set([...core, ...extras].map(normalize)));
}

// LLM tags pass the safety gate (tag-guard.ts), KB words skip it. If the gate cannot answer, only KB tags stay.
async function guardAiTags(collector: TagCollector, a: Analysis, input: TagInput, started: number, kbWords: Set<string>): Promise<TagResult> {
  const unchecked = collector.tags.ai.filter((t) => !kbWords.has(t));
  try {
    const ok = await safeTags(input.name, unchecked);
    const dropped = unchecked.filter((t) => !ok.has(t));
    return { ...result(collector, a, input, started, true), tags: withoutTags(collector.tags, dropped), dropped };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    logger.warn(`tags: safety check failed for "${input.name}" (${why}), LLM tags dropped`);
    return { ...result(collector, a, input, started, false, `safety check failed: ${why}`), tags: withoutTags(collector.tags, unchecked), dropped: unchecked };
  }
}
