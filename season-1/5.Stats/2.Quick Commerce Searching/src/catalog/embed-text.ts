import { ruleTags } from "../ai/tagging/tag-engine.js";
import type { TagSet } from "../ai/tagging/tag.types.js";
import { productEmbedText } from "../search/embeddings.js";
import { BASE_ITEMS, type BaseItem } from "./index.js";

const ITEMS = new Map(BASE_ITEMS.map((item) => [item.id, item]));
const cache = new Map<string, string>();

/** Vector text of a base item: its name + the category's tags in every language, no brand or size. */
export const baseItemEmbedText = (item: BaseItem): string => {
  let text = cache.get(item.id);
  if (!text) {
    text = productEmbedText(item.name, ruleTags({ name: item.name, category: item.category }).tags);
    cache.set(item.id, text);
  }
  return text;
};

/**
 * Seeded products share their base item's vector (2 lakh products, ~150 vectors).
 * Products the admin added get their own: name + their tags.
 */
export const embedTextFor = (p: { baseKey: string | null; name: string; tags: TagSet }): string => {
  const item = p.baseKey ? ITEMS.get(p.baseKey) : undefined;
  return item ? baseItemEmbedText(item) : productEmbedText(p.name, p.tags);
};
