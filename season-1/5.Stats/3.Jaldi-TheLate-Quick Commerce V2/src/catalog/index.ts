// The test catalog: aisles -> categories -> base items. The seed expands base items into products.
import { z } from "zod";
import atta from "./aisles/atta-rice-dal.json";
import baby from "./aisles/baby-pet-pharmacy-meat.json";
import beverages from "./aisles/beverages.json";
import cleaning from "./aisles/cleaning-home.json";
import dairy from "./aisles/dairy-bread-eggs.json";
import fruits from "./aisles/fruits-vegetables.json";
import oil from "./aisles/oil-masala-dry-fruits.json";
import personal from "./aisles/personal-care.json";
import snacks from "./aisles/snacks-breakfast.json";

const itemSchema = z.object({
  name: z.string().min(1),
  brands: z.array(z.string().min(1)).min(1),
  variants: z.array(z.string().min(1)).min(1),
  sizes: z.array(z.string().min(1)).min(1),
  price: z.tuple([z.number().positive(), z.number().positive()]),
  /** variant goes after the name: "Amul Cheese Slices", not "Amul Slices Cheese" */
  after: z.boolean().optional(),
});

const aisleSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().min(1),
  categories: z.record(
    z.string(),
    z.object({
      label: z.string().min(1),
      icon: z.string().min(1),
      /** staples every dark store carries */
      core: z.boolean().optional(),
      items: z.array(itemSchema).min(1),
    }),
  ),
});

export interface CategoryInfo {
  key: string;
  label: string;
  icon: string;
  aisle: string;
  core: boolean;
}

export interface BaseItem extends z.infer<typeof itemSchema> {
  /** "milk/milk", stable across runs */
  id: string;
  category: string;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const aisles = [dairy, fruits, atta, oil, snacks, beverages, personal, cleaning, baby].map((a) => aisleSchema.parse(a));

export const AISLES = aisles.map((a) => ({ key: a.key, label: a.label, icon: a.icon, categories: Object.keys(a.categories) }));

export const CATEGORIES: Record<string, CategoryInfo> = Object.fromEntries(
  aisles.flatMap((a) => Object.entries(a.categories).map(([key, c]) => [key, { key, label: c.label, icon: c.icon, aisle: a.key, core: Boolean(c.core) }])),
);

export const BASE_ITEMS: BaseItem[] = aisles.flatMap((a) =>
  Object.entries(a.categories).flatMap(([category, c]) => c.items.map((item) => ({ ...item, category, id: `${slug(category)}/${slug(item.name)}` }))),
);

export const categoryIcon = (category: string): string => CATEGORIES[category]?.icon ?? "shopping_basket";
