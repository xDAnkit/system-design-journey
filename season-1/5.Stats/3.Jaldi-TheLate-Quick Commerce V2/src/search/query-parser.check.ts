import assert from "node:assert/strict";
import { matchIntents } from "./intents.js";
import { parseQuery } from "./query-parser.js";
import { spellFix } from "./spell.js";

export function run(): void {
  // intents: a dish asks for its ingredients, a plain product word asks for nothing extra
  assert.equal(matchIntents("pulav khana hai mujhe")[0], "rice");
  assert.equal(matchIntents("मुझे पुलाव बनाना है")[0], "rice");
  assert.deepEqual(matchIntents("chawal"), []);
  assert.deepEqual(matchIntents("green tea"), []);

  // spelling: stretched Hinglish becomes a dictionary word; good queries and 1-typo words stay as typed
  assert.equal(spellFix("maccharaa"), "macchar");
  assert.equal(spellFix("doodhhh"), "doodh");
  assert.equal(spellFix("chaaawal"), "chawal");
  assert.equal(spellFix("mujhe chai peeni hai"), "mujhe chai peeni hai");
  assert.equal(spellFix("green tea"), "green tea");

  const full = parseQuery("amul doodh 1 litre 60 se kam");
  assert.equal(full.brand, "Amul");
  assert.deepEqual(full.size, { qty: 1000, unit: "ml" });
  assert.equal(full.maxPrice, 60);
  assert.equal(full.text, "doodh");
  assert.deepEqual(
    full.chips.map((c) => c.kind),
    ["price", "size", "brand"],
  );

  assert.deepEqual(pick(parseQuery("chips under 50")), { text: "chips", maxPrice: 50 });
  assert.deepEqual(pick(parseQuery("₹100 tak biscuit")), { text: "biscuit", maxPrice: 100 });
  assert.deepEqual(pick(parseQuery("doodh ₹60")), { text: "doodh", maxPrice: 60 });
  assert.deepEqual(pick(parseQuery("oil above 200")), { text: "oil", minPrice: 200 });
  assert.deepEqual(pick(parseQuery("दूध 50 से कम")), { text: "दूध", maxPrice: 50 });
  assert.deepEqual(parseQuery("aadha kilo atta").size, { qty: 500, unit: "g" });
  assert.equal(parseQuery("aadha kilo atta").text, "atta");
  assert.deepEqual(parseQuery("500ml coke").size, { qty: 500, unit: "ml" });
  assert.deepEqual(parseQuery("1 किलो चीनी").size, { qty: 1000, unit: "g" });
  assert.deepEqual(parseQuery("eggs 1 dozen").size, { qty: 12, unit: "pcs" });

  // brand alone stays a text search, a typo in a brand still counts
  assert.deepEqual(pick(parseQuery("maggi")), { text: "maggi" });
  const harpic = parseQuery("harpik toilet cleaner");
  assert.equal(harpic.brand, "Harpic");
  assert.equal(harpic.text, "toilet cleaner");

  // nothing to parse
  assert.deepEqual(pick(parseQuery("mujhe chai peeni hai")), { text: "mujhe chai peeni hai" });
  assert.deepEqual(pick(parseQuery("7up")), { text: "7up" });

  // the shopper removed a chip
  assert.equal(parseQuery("amul doodh", ["brand"]).brand, undefined);
}

const pick = (p: ReturnType<typeof parseQuery>) => ({
  text: p.text,
  ...(p.maxPrice !== undefined ? { maxPrice: p.maxPrice } : {}),
  ...(p.minPrice !== undefined ? { minPrice: p.minPrice } : {}),
  ...(p.brand ? { brand: p.brand } : {}),
});
