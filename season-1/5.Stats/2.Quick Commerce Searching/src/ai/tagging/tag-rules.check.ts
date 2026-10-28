// The self test of Tag-Generator.js (selfTest()), ported 1:1. Runs on the user's original KB,
// so it proves the TypeScript port behaves like the JS script. A few extra lines check the merged KB.
import assert from "node:assert/strict";
import { BASE_KB, tagRules } from "./kb.js";
import { createTagRules, isBlocked, normalize, translit } from "./tag-rules.js";

export function run(): void {
  const { analyze, generateRuleTags, isValidTag } = createTagRules(BASE_KB);

  const salt = analyze("Tata Salt 1kg");
  assert.equal(salt.text, "tata salt");
  assert.equal(salt.category, "salt");
  assert.equal(salt.brand, "tata");
  assert.deepEqual(salt.quals, []);
  // variants
  const buf = generateRuleTags(analyze("Buffalo Milk 1L"));
  for (const t of ["bhains ka dudh", "bhais milk", "buffalo mik", "भैंस का दूध"]) assert(buf.core.includes(t), t);
  assert(![...buf.core, ...buf.extras].some((t) => t.includes("cow") || t.includes("ఆవు")));
  assert.equal(analyze("Bhains ka Dudh").brand, null);
  assert(!isValidTag("cow milk", analyze("buffalo milk")));
  // typos + off-topic LLM tags
  const pad = analyze("sanitry pad");
  assert.equal(pad.category, "sanitary pad");
  assert.equal(pad.brand, null);
  assert(!isValidTag("toilet paper", pad) && !isValidTag("washcloth", pad));
  assert(isValidTag("sanitary pad for periods", pad));
  assert(!isValidTag("whisper pad", pad)); // other brand's name on this product = wrong
  assert.equal(analyze("sanitarry pads").fixed, "sanitary pads");
  // brand typo + brand -> category
  const harpic = analyze("harpik blue toilet cleaner");
  assert.equal(harpic.brand, "harpic");
  assert.equal(harpic.fixed, "harpic blue toilet cleaner");
  assert.equal(harpic.category, "toilet cleaner");
  const ht = generateRuleTags(harpic).core;
  for (const t of ["bathroom cleaner", "harpik", "टॉयलेट क्लीनर", "டாய்லெட் கிளீனர்", "harpic toilet cleaner"]) assert(ht.includes(t), t);
  assert(ht.some((t) => /[઀-૿]/.test(t)), "derived Gujarati");
  assert.equal(analyze("Lizol citrus 975ml").category, "floor cleaner");
  assert.equal(analyze("floor cleaner").category, "floor cleaner"); // not "flour"
  assert.equal(analyze("Cadbury Dairy Milk").category, "chocolate");
  assert.equal(analyze("Parachute coconut hair oil").category, "hair oil");
  assert.equal(analyze("Harpic Toilet Cleaner").category, "toilet cleaner"); // not "oil"
  assert.equal(analyze("Amul Butter").category, "butter");
  assert.equal(analyze("Full Cream Milk").brand, null);
  assert.equal(analyze("Tata Sampann Toor Dal").brand, "tata sampann");
  // head noun + brand words don't count
  assert.equal(analyze("Kissan tomato ketchup").category, "ketchup");
  assert.equal(analyze("Haldiram aloo bhujia").category, "namkeen");
  assert.equal(analyze("Lifebuoy handwash").category, "handwash");
  assert.equal(analyze("Tata Tea Gold 500g").category, "tea");
  assert.equal(normalize("coca cola coca cola thanda"), "coca cola thanda");
  // LLM junk filters
  const sun = analyze("Fortune Sunflower Oil");
  assert(!isValidTag("olive oil", sun) && isValidTag("edible sunflower oil", sun));
  const dove = analyze("Dove Intense Repair Shampoo");
  assert(!isValidTag("hair conditioner", dove) && !isValidTag("intensive hair care", dove));
  assert(isValidTag("dove repair shampoo", dove));
  assert(!isValidTag("amul toned milk powder", analyze("Amul Taaza Toned Milk")));
  const paneer = analyze("Mother Dairy Paneer");
  assert(!isValidTag("mutter paneer", paneer) && isValidTag("mother dairy paneer block", paneer));
  assert(!isValidTag("balloon ka shampoo", dove)); // fuzzy "balon" is not enough for KB products
  assert(!isValidTag("brown bread britannia", analyze("Britannia brown bread")));
  assert(!isValidTag("energy shot energy drink", analyze("Red Bull energy drink")));
  assert(generateRuleTags(analyze("Cadbury Dairy Milk Silk")).core.includes("cadbury"));
  // variants: no invented / conflicting variant
  assert(!isValidTag("dove anti dandruff shampoo", dove));
  const toned = analyze("Amul Taaza Toned Milk");
  assert(!isValidTag("amul full cream milk", toned));
  const tonedTags = generateRuleTags(toned);
  assert(![...tonedTags.core, ...tonedTags.extras].includes("full cream"));
  const plainSalt = generateRuleTags(analyze("Tata Salt"));
  assert(![...plainSalt.core, ...plainSalt.extras].some((t) => /sendha|kala|सेंधा/.test(t)));
  assert(!generateRuleTags(dove).core.includes("anti dandruff shampoo"));
  const brownBread = generateRuleTags(analyze("Britannia brown bread"));
  assert(!brownBread.core.includes("white bread") && brownBread.core.includes("ब्राउन ब्रेड"));
  // blocked words
  assert(isBlocked("beef curry cut") && isBlocked("porkchop") && isBlocked("बीफ"));
  assert(!isBlocked("beer") && !isBlocked("paneer") && !isBlocked("toilet cleaner"));
  // transliteration
  assert.equal(translit("क्लीनर", "Punjabi"), "ਕਲੀਨਰ");
  assert.equal(translit("ड्रिंक", "Punjabi"), "ਡ੍ਰਿੰਕ");
  assert.equal(translit("टॉयलेट", "Gujarati"), "ટૉયલેટ");
  assert.equal(translit("क्लीनर", "Tamil"), "க்லீநர்");
  // KB core
  const { core } = generateRuleTags(analyze("Aashirvaad Atta"));
  assert(core.includes("आटा") && core.includes("aashirvaad atta") && core.includes("ಹಿಟ್ಟು"));
  const milk = analyze("milk");
  assert(!isValidTag("tata namak", milk));
  assert(isValidTag("milk doodh", milk) && !isValidTag("doodh packet", milk));
  assert(!isValidTag("cow milk doodh", milk)); // invented variant
  assert(!isValidTag("amul milk 500", milk));

  // merged KB: the added categories are found, and the user's categories still win
  assert.equal(tagRules.analyze("Dolo 650 Paracetamol Tablet").category, "medicine");
  assert.equal(tagRules.analyze("Rajdhani Besan 500 g").category, "besan");
  assert.equal(tagRules.analyze("Rajdhani Maida 1 kg").category, "maida");
  assert.equal(tagRules.analyze("Lipton Honey Lemon Green Tea").category, "green tea");
  assert.equal(tagRules.analyze("Tata Tea Premium").category, "tea");
  assert.equal(tagRules.analyze("Amul Masti Spiced Buttermilk").category, "buttermilk");
  assert.equal(tagRules.analyze("Butter milk").category, "buttermilk", "two words is still buttermilk, not milk");
  assert.equal(tagRules.analyze("Amul Taaza Toned Milk").category, "milk");
  assert.equal(tagRules.analyze("Cadbury Dairy Milk Silk").category, "chocolate");
  assert.equal(tagRules.analyze("Pedigree Adult Dog Food Chicken").category, "dog food");
  assert(!tagRules.isValidTag("दही", tagRules.analyze("Amul Taaza Toned Milk")), "curd word is not a milk tag");
  assert(tagRules.isValidTag("दूध", tagRules.analyze("Amul Taaza Toned Milk")));
}
