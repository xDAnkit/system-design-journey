/**
 * Safety gate for tags that did not come from the curated KB: LLM tags, admin-typed tags and shopper queries
 * that become suggested tags. Rule: rules/scoped/content-safety.md. No word list, the LLM judges every tag.
 *
 * Strict on purpose: the judge returns the numbers of the tags it keeps, so a tag it skips, a bad answer,
 * a timeout or Ollama being down all mean "drop" (fail closed). Callers catch the error and fall back to
 * KB tags only, or refuse the save.
 *
 * Tested 2026-10-28 on gemma3:4b (test words kept outside the repo): 14 of 14 abusive, sexual, political,
 * religious and skin-colour tags dropped, ~1.5 s warm. Cost: it also drops many correct native-script words,
 * so KB tags skip this gate. A bge-m3 "is the tag close to the product" check was tried and dropped: good and
 * bad tags scored in the same 0.28 to 0.57 band.
 * ponytail: one strict judge. If native recall matters more, add a second "meaning first" pass (26/27 kept, 13/14 caught, ~20 s).
 */
import { z } from "zod";
import { ai } from "../index.js";
import { normalize } from "./tag-rules.js";
import type { TagSet } from "./tag.types.js";

const judgeSchema = z.object({ keep: z.array(z.number().int()) });

const JUDGE_SYSTEM = `You check search tags for an Indian grocery app before shoppers see them.
You get a product and numbered tags in English, Hinglish (Hindi in Roman letters) or Indian languages.
Return "keep": the numbers of the tags that are clean, respectful words a shopper could type to find this product.
Leave a tag out if, in any language, script or spelling, it is abusive, vulgar, sexual, an insult, slang for a body part, about caste, religion, community, region, politics, violence, drugs or skin colour, or could hurt anyone in India.
Leave a tag out if it names meat, fish or egg while the product itself is not meat, fish or egg.
If you are not sure about a tag, leave it out.`;

/** The tags (normalized) that passed. Throws when the judge cannot answer, so nothing unchecked gets through. */
export async function safeTags(product: string, candidates: string[]): Promise<Set<string>> {
  const list = [...new Set(candidates.map(normalize).filter(Boolean))];
  if (!list.length) return new Set();
  const res = await ai.generateJson({
    name: "tag-guard",
    system: JUDGE_SYSTEM,
    prompt: `Product: "${product}"\nTags:\n${list.map((t, i) => `${i}. ${t}`).join("\n")}`,
    schema: judgeSchema,
    maxTokens: 300,
    temperature: 0,
  });
  return new Set(res.data.keep.filter((i) => i >= 0 && i < list.length).map((i) => list[i]!));
}

/** The same tag set without the given tags, in every bucket. */
export function withoutTags(tags: TagSet, drop: Iterable<string>): TagSet {
  const out = new Set(drop);
  if (!out.size) return tags;
  const keep = (list: string[]): string[] => list.filter((t) => !out.has(normalize(t)));
  return {
    en: keep(tags.en),
    hinglish: keep(tags.hinglish),
    native: Object.fromEntries(Object.entries(tags.native).map(([lang, list]) => [lang, keep(list ?? [])])),
    typos: keep(tags.typos),
    ai: keep(tags.ai),
  };
}
