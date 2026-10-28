import assert from "node:assert/strict";
import { ruleTags } from "../ai/tagging/tag-engine.js";
import { BASE_KB, tagRules } from "../ai/tagging/kb.js";
import { BASE_ITEMS, CATEGORIES } from "../catalog/index.js";
import { parseSize } from "../catalog/size.js";
import { STORE_IDS, resolveLocation } from "../locations/locations.service.js";
import { generateProducts, maxProducts } from "./catalog-generator.js";

export function run(): void {
  // every catalog category has language data, and every category of the user's KB is in the catalog
  for (const key of Object.keys(CATEGORIES)) assert(tagRules.kb[key], `catalog category "${key}" is missing from the KB`);
  for (const key of Object.keys(BASE_KB.categories)) assert(CATEGORIES[key], `KB category "${key}" has no catalog items`);

  // sizes
  assert.deepEqual(parseSize("500 ml"), { qty: 500, unit: "ml" });
  assert.deepEqual(parseSize("1 L"), { qty: 1000, unit: "ml" });
  assert.deepEqual(parseSize("1.25 L"), { qty: 1250, unit: "ml" });
  assert.deepEqual(parseSize("4 x 100 g"), { qty: 100, unit: "g" });
  assert.deepEqual(parseSize("1.2 kg"), { qty: 1200, unit: "g" });
  assert.deepEqual(parseSize("25 bags"), { qty: 25, unit: "pcs" });
  assert.equal(parseSize("9 m"), null);

  // enough combinations for 2 lakh, deterministic, unique names, sane prices and stores
  assert(maxProducts() >= 200_000, `only ${maxProducts()} combinations`);
  const a = [...generateProducts(3000)];
  const b = [...generateProducts(3000)];
  assert.deepEqual(
    a.map((p) => p.name),
    b.map((p) => p.name),
    "same count must give the same products",
  );
  assert.equal(new Set(a.map((p) => p.name)).size, a.length, "product names must be unique");
  assert.equal(new Set(a.slice(0, BASE_ITEMS.length).map((p) => p.baseKey)).size, BASE_ITEMS.length, "first round covers every base item");
  const stores = new Set(STORE_IDS);
  for (const p of a) {
    assert(p.price > 0 && p.mrp >= p.price, `${p.name}: price ${p.price} mrp ${p.mrp}`);
    assert(p.storeIds.length > 0 && p.storeIds.every((s) => stores.has(s)), `${p.name}: stores`);
    if (CATEGORIES[p.category].core) assert.equal(p.storeIds.length, STORE_IDS.length, `${p.name}: core items are in every store`);
  }

  // seeded tags carry the KB words
  const milk = ruleTags({ name: "Amul Toned Milk", brand: "Amul", category: "milk" }).tags;
  assert(milk.native.Hindi?.includes("दूध") && milk.native.Tamil?.includes("பால்") && milk.hinglish.includes("doodh"));

  // locations
  assert.equal(resolveLocation({ pincode: "560034" })?.store?.id, "blr-koramangala");
  assert.equal(resolveLocation({ pincode: "560066" })?.serviceable, false, "Whitefield has no store on purpose");
  assert.equal(resolveLocation({ lat: 12.936, lng: 77.624 })?.pincode, "560034");
  assert.equal(resolveLocation({ lat: 51.5, lng: -0.12 }), null, "London is not covered");
}
