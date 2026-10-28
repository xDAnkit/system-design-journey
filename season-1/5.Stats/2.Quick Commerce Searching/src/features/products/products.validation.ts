import { z } from "zod";
import { CATEGORIES } from "../../catalog/index.js";
import { STORES } from "../../locations/locations.service.js";
import { LANGS, cleanText } from "../../shared/text.js";

// Admin tags are user input that ends up in the search index: plain text only, short, capped.
const tagWord = z
  .string()
  .transform((s) => cleanText(s, 60).toLowerCase())
  .pipe(z.string().min(1));
const tagList = (max: number) => z.array(tagWord).max(max).default([]);

export const tagSetSchema = z.object({
  en: tagList(30),
  hinglish: tagList(30),
  typos: tagList(20),
  native: z.partialRecord(z.enum(LANGS), z.array(tagWord).max(6)).default({}),
  ai: tagList(150),
});

const text = (max: number) => z.string().transform((s) => cleanText(s, max));

const productShape = {
  name: text(120).pipe(z.string().min(2, "name needs at least 2 letters")),
  brand: text(60).default(""),
  category: z.string().refine((k) => k in CATEGORIES, "unknown category, see GET /products/categories"),
  size: text(30).default(""),
  price: z.number().min(0).max(100000),
  mrp: z.number().min(0).max(100000).optional(),
  icon: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .optional(),
  storeIds: z
    .array(z.string().refine((id) => STORES.has(id), "unknown store id"))
    .max(100)
    .optional(),
};

export const createProductSchema = z.object({
  ...productShape,
  tags: tagSetSchema.optional(),
  tagsFor: z.string().max(200).optional(),
});

export const updateProductSchema = z
  .object({
    ...Object.fromEntries(Object.entries(productShape).map(([k, v]) => [k, (v as z.ZodType).optional()])),
    tags: tagSetSchema.optional(),
    tagsFor: z.string().max(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "send at least one field to change");

export const previewTagsSchema = z.object({
  name: text(120).pipe(z.string().min(2)),
  brand: text(60).optional(),
  category: z.string().optional(),
  /** rules = instant KB tags, full = KB + LLM (2-6 s) */
  mode: z.enum(["rules", "full"]).default("full"),
});
