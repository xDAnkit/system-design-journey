import { z } from "zod";
import { LANGS, type Lang } from "../../shared/text.js";

const list = z.array(z.string());

/** LLM answer for a product the KB knows: the KB already has curated words in 12 scripts. */
export const tagLlmSchema = z.object({
  corrected_name: z.string(),
  brand: z.string(),
  product_type: z.string(),
  english_synonyms: list,
  hinglish: list,
});

/** LLM answer for a product the KB does not know: it also writes the item word in 12 scripts. */
export const tagLlmWithScriptsSchema = tagLlmSchema.extend({
  scripts: z.object(Object.fromEntries(LANGS.map((lang) => [lang, list])) as Record<Lang, typeof list>),
});

export type TagLlmAnswer = z.infer<typeof tagLlmSchema>;
export type TagLlmAnswerWithScripts = z.infer<typeof tagLlmWithScriptsSchema>;
