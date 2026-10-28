import type { Lang } from "../../shared/text.js";

/** A product's search tags, grouped the way the admin page shows them. */
export interface TagSet {
  /** English words and phrases ("toned milk", "amul milk") */
  en: string[];
  /** Hindi in Roman letters ("doodh", "amul doodh") */
  hinglish: string[];
  /** Native scripts, per language ("दूध", "பால்") */
  native: Partial<Record<Lang, string[]>>;
  /** Common misspellings ("mlik", "harpik") */
  typos: string[];
  /** Which of the tags above came from the LLM (AI badge). The rest came from the KB rules or the admin. */
  ai: string[];
}

export type TagsSource = "kb" | "kb+ai" | "admin";

export const emptyTagSet = (): TagSet => ({ en: [], hinglish: [], native: {}, typos: [], ai: [] });

/** Every tag once, for the Typesense `tags` field and the embedding text. Typos are kept apart. */
export const flattenTags = (tags: TagSet): string[] => [...new Set([...tags.en, ...tags.hinglish, ...Object.values(tags.native).flat()])];

export const tagCount = (tags: TagSet): number => flattenTags(tags).length + tags.typos.length;
