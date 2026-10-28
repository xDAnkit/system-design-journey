// Base items -> products. Deterministic: the same count gives the same products on every run.
// ponytail: synthetic names (brand x variant x size x pack x edition), real enough for search and scale tests.
import { BASE_ITEMS, CATEGORIES, categoryIcon, type BaseItem } from "../catalog/index.js";
import { parseSize, type SizeUnit } from "../catalog/size.js";
import { STORE_IDS } from "../locations/locations.service.js";

const PACKS = [1, 2, 3, 4, 6, 12];
const EDITIONS = ["", "Value Pack", "Combo Pack", "Family Pack", "Super Saver", "Festive Pack", "Mega Pack", "Saver Pack", "Jumbo Pack", "Special Edition", "New", "Premium", "Classic", "Select", "Daily", "Fresh Pick", "Lite", "Plus", "Pro", "Mini", "Max", "Travel Pack", "Gift Pack", "Kitchen Pack", "Party Pack"];
/** share of a dark store's shelf for non-core categories */
const STOCK_SHARE = 0.25;

export interface GeneratedProduct {
  name: string;
  brand: string;
  category: string;
  baseKey: string;
  /** brand + variant + item name: what the tags are made for (size, pack and edition add nothing) */
  tagText: string;
  size: string;
  sizeQty: number | null;
  sizeUnit: SizeUnit | null;
  price: number;
  mrp: number;
  icon: string;
  storeIds: string[];
  popularity: number;
}

// FNV-1a + mulberry32: a "random" number that only depends on the seed string
const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
export const rand01 = (seed: string): number => {
  let t = (hash(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const combosOf = (item: BaseItem): number => item.brands.length * item.variants.length * item.sizes.length * PACKS.length * EDITIONS.length;

interface Combo {
  brand: string;
  variant: string;
  size: string;
  pack: number;
  edition: string;
}

// pack and edition change last, so every item's first products are plain single packs
const comboAt = (item: BaseItem, k: number): Combo => {
  let r = k;
  const pick = <T>(list: T[]): T => {
    const v = list[r % list.length];
    r = Math.floor(r / list.length);
    return v;
  };
  return { brand: pick(item.brands), variant: pick(item.variants), size: pick(item.sizes), pack: pick(PACKS), edition: pick(EDITIONS) };
};

// "4 x 100 g" -> 400 g for the price, the filter size stays 100 g
const totalQty = (size: string): number | null => {
  const each = parseSize(size)?.qty;
  if (each == null) return null;
  const multi = size.match(/^(\d+)\s*x/i);
  return each * (multi ? Number(multi[1]) : 1);
};

const build = (item: BaseItem, c: Combo): GeneratedProduct => {
  const variant = c.variant === "Regular" ? "" : c.variant;
  const core = item.after ? `${item.name} ${variant}` : `${variant} ${item.name}`;
  const name = [c.brand, core, c.size, c.pack > 1 ? `(Pack of ${c.pack})` : "", c.edition].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  const firstQty = totalQty(item.sizes[0]);
  const thisQty = totalQty(c.size);
  const sizeIndex = item.sizes.indexOf(c.size);
  const sameUnit = parseSize(item.sizes[0])?.unit === parseSize(c.size)?.unit;
  const sizeMult = firstQty && thisQty && sameUnit ? (thisQty / firstQty) ** 0.92 : 1 + sizeIndex * 0.9;
  const base = item.price[0] + (item.price[1] - item.price[0]) * rand01(`${item.id}|${c.brand}|${c.variant}`);
  const packMult = c.pack * (1 - Math.min(0.15, (c.pack - 1) * 0.02));
  const editionMult = c.edition ? 0.95 + rand01(`${item.id}|${c.edition}`) * 0.15 : 1;
  const price = Math.max(1, Math.round(base * sizeMult * packMult * editionMult));
  const mrp = Math.max(price, Math.round(price * (1.05 + rand01(`${name}|mrp`) * 0.2)));

  const parsed = parseSize(c.size);
  const isCore = CATEGORIES[item.category]?.core ?? false;
  let storeIds = isCore ? STORE_IDS : STORE_IDS.filter((id) => rand01(`${name}|${id}`) < STOCK_SHARE);
  if (!storeIds.length) storeIds = [STORE_IDS[hash(name) % STORE_IDS.length]];

  return {
    name,
    brand: c.brand,
    category: item.category,
    baseKey: item.id,
    tagText: `${c.brand} ${core}`.replace(/\s+/g, " ").trim(),
    size: c.size,
    sizeQty: parsed?.qty ?? null,
    sizeUnit: parsed?.unit ?? null,
    price,
    mrp,
    icon: categoryIcon(item.category),
    storeIds,
    // skewed: a few products are much more popular, like real shops
    popularity: Math.floor(rand01(`${name}|pop`) ** 3 * 100),
  };
};

/** Round robin over base items, so the first N products cover every category evenly. */
export function* generateProducts(count: number, items: BaseItem[] = BASE_ITEMS): Generator<GeneratedProduct> {
  const max = items.map(combosOf);
  let produced = 0;
  for (let k = 0; produced < count; k++) {
    let any = false;
    for (let i = 0; i < items.length && produced < count; i++) {
      if (k >= max[i]) continue;
      any = true;
      produced++;
      yield build(items[i], comboAt(items[i], k));
    }
    if (!any) return; // every combination used up
  }
}

export const maxProducts = (items: BaseItem[] = BASE_ITEMS): number => items.reduce((s, item) => s + combosOf(item), 0);
