import baseKb from "./product-kb.json";
import extraKb from "./kb-extra.json";
import { createTagRules, type Kb } from "./tag-rules.js";

/** The user's KB exactly as copied from Content/7.AI Searching/product-kb.json */
export const BASE_KB = baseKb as unknown as Kb;

/** The user's KB + the categories added for the catalog (kb-extra.json). The KB wins on a clash. */
export const MERGED_KB: Kb = {
  umbrella_brands: BASE_KB.umbrella_brands,
  categories: { ...(extraKb.categories as unknown as Kb["categories"]), ...BASE_KB.categories },
};

/** Rules over the merged KB: what the app uses */
export const tagRules = createTagRules(MERGED_KB);

export const categoryKeys = (): string[] => Object.keys(tagRules.kb);
