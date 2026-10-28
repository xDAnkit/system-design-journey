/**
 * pnpm seed:traffic                                 30 days, 1 lakh searches, asks first
 * pnpm seed:traffic -- --days=30 --searches=200000 --yes
 *
 * Fake shoppers in 8 cities, each city in its own languages (Chennai Tamil, Kolkata Bengali...), more
 * searches in the morning and evening, some from pincodes with no dark store. Events go through Kafka
 * (search.events) like real traffic: keep `pnpm workers` running to see them in the dashboard.
 * Reads product ids from Mongo (only a "jaldi..." database). Writes nothing to Mongo itself.
 */
import "../bootstrap/mongo-host-dns.js";
import mongoose from "mongoose";
import type { AnalyticsEvent } from "../analytics/analytics.types.js";
import { tagRules } from "../ai/tagging/kb.js";
import { BASE_ITEMS, CATEGORIES } from "../catalog/index.js";
import { connectDatabase, disconnectDatabase } from "../bootstrap/database.js";
import { TOPICS, connectKafka, disconnectKafka, ensureTopics, sendEvents } from "../bootstrap/kafka.js";
import { ProductModel } from "../features/products/products.model.js";
import { CITIES, resolveLocation, type City, type Pincode } from "../locations/locations.service.js";
import { assertSafeDatabase, confirm, intFlag } from "../shared/cli.js";
import { detectScript, normalizeQuery, type Lang } from "../shared/text.js";
import { EVAL_INTENTS } from "../search/eval/eval-queries.js";

const DAYS = intFlag("days", 30);
const SEARCHES = intFlag("searches", 100_000);
const SEND_BATCH = 10_000;

const rnd = Math.random;
const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)];
const weighted = <T>(items: Array<[T, number]>): T => {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items[items.length - 1][0];
};

// more searches at breakfast and in the evening, few at night (IST hour -> weight)
const HOUR_WEIGHTS: Array<[number, number]> = Array.from({ length: 24 }, (_, h) => [h, h < 6 ? 0.3 : h < 8 ? 1.5 : h < 11 ? 4 : h < 17 ? 2 : h < 22 ? 5 : 1.2]);
const UNKNOWN = ["dragon fruit", "air fryer", "iphone charger", "kombucha", "quinoa puffs", "avocado oil spray", "matcha latte", "gluten free pasta"];

interface Query {
  q: string;
  categories: string[];
}

// query pools per language, straight from the KB (plus brand searches and intents)
const pools = new Map<string, Map<string, Query[]>>();
const addQuery = (lang: string, category: string, q: string, categories = [category]): void => {
  if (!q) return;
  let byCat = pools.get(lang);
  if (!byCat) pools.set(lang, (byCat = new Map()));
  const list = byCat.get(category) ?? [];
  list.push({ q, categories });
  byCat.set(category, list);
};
for (const [category, kb] of Object.entries(tagRules.kb)) {
  if (!CATEGORIES[category]) continue;
  kb.english.forEach((w) => addQuery("English", category, w));
  kb.hindi.forEach((w) => addQuery("Hinglish", category, w));
  kb.typos.slice(0, 2).forEach((w) => addQuery("Hinglish", category, w));
  for (const [lang, words] of Object.entries(kb.all_langs)) (words ?? []).forEach((w) => addQuery(lang, category, w));
}
for (const item of BASE_ITEMS) for (const brand of item.brands.slice(0, 3)) if (brand !== "Fresh" && brand !== "Organic") addQuery("English", item.category, `${brand} ${item.name}`.toLowerCase());
const intentPool = EVAL_INTENTS.map((i) => ({ q: i.text, categories: i.expected, lang: i.group }));

// staples are searched far more often
const categoryWeights: Array<[string, number]> = Object.values(CATEGORIES).map((c) => [c.key, c.core ? 6 : 1]);

const main = async (): Promise<void> => {
  await connectDatabase();
  assertSafeDatabase(mongoose.connection.name);
  const productCount = await ProductModel.estimatedDocumentCount();
  if (!productCount) throw new Error("no products yet: run pnpm seed:products and pnpm reindex first");

  console.log(`Plan: ${SEARCHES.toLocaleString("en-IN")} searches over the last ${DAYS} days in ${CITIES.length} cities, + clicks and ADDs`);
  console.log(`      sent to Kafka topic ${TOPICS.searchEvents}; pnpm workers turns them into dashboard numbers.`);
  if (!(await confirm("Go ahead?"))) return;

  // product ids per category and store, read once (a sample per category is enough for clicks)
  const rows = await ProductModel.aggregate<{ _id: string; items: Array<{ id: unknown; stores: string[] }> }>(
    [{ $project: { category: 1, storeIds: 1 } }, { $group: { _id: "$category", items: { $push: { id: "$_id", stores: "$storeIds" } } } }, { $project: { items: { $slice: ["$items", 600] } } }],
    { allowDiskUse: true },
  );
  const products = new Map(rows.map((r) => [r._id, r.items.map((i) => ({ id: String(i.id), stores: new Set(i.stores) }))]));

  await connectKafka();
  await ensureTopics();

  const now = Date.now();
  const sessions = new Map<string, string[]>();
  const sessionFor = (city: string): string => {
    const list = sessions.get(city) ?? [];
    sessions.set(city, list);
    // a returning shopper most of the time, a new one sometimes
    if (list.length && rnd() < 0.75) return pick(list);
    const id = `sim-${city.toLowerCase().slice(0, 3)}-${Math.random().toString(36).slice(2, 12)}`;
    list.push(id);
    return id;
  };
  const tsFor = (): number => {
    // a little growth: recent days get more traffic
    const daysAgo = Math.floor(DAYS * rnd() ** 1.3);
    const hour = weighted(HOUR_WEIGHTS);
    const istMidnight = Math.floor((now + 5.5 * 3600_000) / 86_400_000) * 86_400_000 - 5.5 * 3600_000;
    const ms = istMidnight - daysAgo * 86_400_000 + hour * 3600_000 + Math.floor(rnd() * 3600_000);
    return Math.min(ms, now - Math.floor(rnd() * 60_000));
  };

  let buffer: AnalyticsEvent[] = [];
  const stats = { searches: 0, clicks: 0, adds: 0, unserviceable: 0, zero: 0 };
  const flush = async (): Promise<void> => {
    if (!buffer.length) return;
    await sendEvents(TOPICS.searchEvents, buffer.map((e) => ({ key: e.sessionId, value: e })));
    buffer = [];
  };

  for (let i = 0; i < SEARCHES; i++) {
    const city: City = weighted(CITIES.map((c) => [c, c.weight]));
    // most traffic comes from areas a store serves; the rest is demand for new stores
    const pin: Pincode = weighted(city.pincodes.map((p) => [p, resolveLocation({ pincode: p.pin })?.serviceable ? 4 : 1]));
    const loc = resolveLocation({ pincode: pin.pin })!;
    const sessionId = sessionFor(city.name);
    const ts = tsFor();
    const lang = weighted(Object.entries(city.langMix));

    let query: Query;
    const roll = rnd();
    if (roll < 0.03) query = { q: pick(UNKNOWN), categories: [] };
    else if (roll < 0.15) {
      const fitting = intentPool.filter((x) => (lang === "Hinglish" ? x.lang === "Hinglish" : lang === "English" ? x.lang === "English" : lang === "Hindi" ? x.lang === "Hindi script" : x.lang === "Regional script"));
      const it = pick(fitting.length ? fitting : intentPool);
      query = { q: it.q, categories: it.categories };
    } else {
      const category = weighted(categoryWeights);
      const pool = pools.get(lang as Lang)?.get(category) ?? pools.get("Hinglish")?.get(category) ?? pools.get("English")?.get(category) ?? [];
      query = pool.length ? pick(pool) : { q: category, categories: [category] };
    }
    const q = query.q;
    const qNorm = normalizeQuery(q);
    const base = { ts: new Date(ts).toISOString(), sessionId, city: city.name, pincode: pin.pin };

    if (!loc.store) {
      buffer.push({ type: "unserviceable", ...base, q, qNorm });
      stats.unserviceable++;
    } else {
      const storeId = loc.store.id;
      const catalog = query.categories.flatMap((c) => products.get(c) ?? []);
      const inStore = catalog.filter((p) => p.stores.has(storeId));
      const shown = inStore.sort(() => rnd() - 0.5).slice(0, 20).map((p) => p.id);
      const results = Math.min(100, inStore.length);
      const intent = query.categories.length > 1;
      const vectorOnly = intent && shown.length && rnd() < 0.6 ? shown.slice(0, 1 + Math.floor(rnd() * 2)) : [];
      const latencyMs = Math.round(30 + rnd() ** 2 * (detectScript(q) === "Roman" ? 380 : 220));
      buffer.push({ type: "search", ...base, storeId, q, qNorm, script: detectScript(q), results, latencyMs, shown, vectorOnly, outOfStock: results === 0 && catalog.length > 0 });
      stats.searches++;
      if (results === 0) stats.zero++;

      if (shown.length && rnd() < 0.45) {
        // position bias: the first results get most clicks; vector-only matches get clicked sometimes
        const position = vectorOnly.length && rnd() < 0.5 ? shown.indexOf(vectorOnly[0]) + 1 : Math.min(shown.length, 1 + Math.floor(-Math.log(1 - rnd()) * 2.2));
        const productId = shown[position - 1];
        const clickTs = new Date(Math.min(now, ts + 2000 + Math.floor(rnd() * 20_000))).toISOString();
        buffer.push({ type: "click", ts: clickTs, sessionId, city: city.name, pincode: pin.pin, storeId, q, qNorm, productId, position });
        stats.clicks++;
        if (rnd() < 0.4) {
          buffer.push({ type: "add", ts: clickTs, sessionId, city: city.name, pincode: pin.pin, storeId, q, qNorm, productId, position });
          stats.adds++;
        }
      }
    }
    if (buffer.length >= SEND_BATCH) {
      await flush();
      console.log(`  ${(i + 1).toLocaleString("en-IN")} / ${SEARCHES.toLocaleString("en-IN")} searches sent`);
    }
  }
  await flush();
  console.log(`done: ${stats.searches} searches (${stats.zero} with 0 results), ${stats.unserviceable} from places with no store, ${stats.clicks} clicks, ${stats.adds} ADDs.`);
  console.log("Keep pnpm workers running: the analytics worker turns these into dashboard numbers.");
};

main()
  .catch((err: unknown) => {
    console.error(`seed:traffic failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => Promise.allSettled([disconnectKafka(), disconnectDatabase()]));
