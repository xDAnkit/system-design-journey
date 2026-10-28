/**
 * Hybrid search: Typesense keyword (name, 12-script tags, brand, typos, AI suggested tags) + bge-m3 vector,
 * fused by Typesense, then a small re-rank for intents ("chai peeni hai" -> tea, milk, sugar).
 * Pure: no events here, the controller sends them. The eval script calls this directly.
 */
import { ai } from "../ai/index.js";
import { cachedRewrite } from "../ai/rewrite/rewrite.js";
import { env } from "../bootstrap/env.js";
import { typesense } from "../bootstrap/typesense.js";
import { httpError } from "../shared/error.js";
import { shuffle } from "../shared/pool.js";
import { detectScript, normalizeQuery, type Script } from "../shared/text.js";
import { matchIntents } from "./intents.js";
import { parseQuery, type FilterKind, type ParsedQuery } from "./query-parser.js";
import { queryVector } from "./query-vector.js";
import { spellFix } from "./spell.js";
import { activeProductsCollection } from "./typesense.schema.js";

export interface SearchInput {
  q: string;
  storeId?: string | null;
  /** category chip in the UI */
  category?: string | null;
  page?: number;
  perPage?: number;
  /** filter chips the shopper removed */
  ignore?: FilterKind[];
  /** eval only: use this native-script rewrite instead of the Redis cache (null = none) */
  rewrite?: string | null;
}

export interface SearchHit {
  id: string;
  name: string;
  brand: string;
  category: string;
  size: string;
  price: number;
  mrp: number;
  icon: string;
  /** keyword = text match only, vector = meaning only (an AI suggested tag candidate), both, intent = from the intent's categories */
  matchedBy: "keyword" | "vector" | "both" | "intent";
}

export interface SearchResult {
  q: string;
  qNorm: string;
  script: Script;
  rewrite: string | null;
  /** the words the keyword search used after the Hinglish spelling fix ("maccharaa" -> "macchar"), null = no fix */
  corrected: string | null;
  filters: ParsedQuery["chips"];
  /** the parsed filters gave nothing, so they were dropped */
  filtersRelaxed: boolean;
  intents: string[];
  storeId: string | null;
  total: number;
  page: number;
  perPage: number;
  hits: SearchHit[];
  vectorUsed: boolean;
  /** 0 results in this store, but other stores have it: stock demand */
  outOfStock: boolean;
  tookMs: number;
}

// How many results we fetch and re-rank. Quick commerce shoppers rarely scroll past 5 pages.
const CANDIDATES = 100;
// cosine distance cut for the vector part (bake-off: right answers start around cosine 0.38)
const DISTANCE_THRESHOLD = 0.62;
// weight of the vector in Typesense's rank fusion (keyword gets 1 - alpha)
const ALPHA = 0.3;

const quote = (v: string): string => `\`${v.replace(/`/g, "")}\``;

interface Raw {
  found: number;
  hits: Array<{ document: Record<string, unknown>; text_match?: number; vector_distance?: number }>;
}

async function runSearch(collection: string, text: string, filters: string[], vector: number[] | null, perPage = CANDIDATES): Promise<Raw> {
  const search: Record<string, unknown> = {
    collection,
    q: text || "*",
    query_by: "name,tags,brand,typos,suggested_tags",
    query_by_weights: "5,4,3,1,1",
    // typos field: known misspellings, 1 more edit allowed ("macchr" -> "macchar"). Typesense only tries
    // typo matches when the exact words find nothing, so "chai" never turns into "chas"
    num_typos: "2,2,1,1,1",
    prefix: "true,true,true,false,false",
    per_page: perPage,
    include_fields: "id,name,brand,category,size,price,mrp,icon,popularity",
  };
  if (filters.length) search.filter_by = filters.join(" && ");
  // q:"*" + vector = pure vector search; text + vector = hybrid
  if (vector) search.vector_query = `embedding:([${vector.map((x) => x.toFixed(5)).join(",")}], k:${CANDIDATES}, alpha:${ALPHA}, distance_threshold:${DISTANCE_THRESHOLD})`;
  // multi_search: the vector is too long for a GET query string
  const res = (await typesense.multiSearch.perform({ searches: [search] } as never)) as unknown as { results: Array<Raw & { error?: string }> };
  const r = res.results[0];
  if (r?.error) throw httpError(502, `Search engine error: ${r.error}`);
  return { found: r?.found ?? 0, hits: r?.hits ?? [] };
}

// top products per intent category ("pulav" -> rice, ghee, peas...)
const INTENT_PER_CATEGORY = 4;

/**
 * A re-rank can only reorder what the search found. When the words and the vector both miss
 * ("pulav khana hai" finds no rice), these bring the intent's categories in. Intent order is kept.
 */
async function intentHits(collection: string, filters: string[], intents: string[], perCategory = INTENT_PER_CATEGORY): Promise<Raw["hits"]> {
  const res = (await typesense
    .collections(collection)
    .documents()
    .search({
      q: "*",
      filter_by: [...filters, `category:=[${intents.map(quote).join(",")}]`].join(" && "),
      group_by: "category",
      group_limit: perCategory,
      per_page: intents.length,
      sort_by: "popularity:desc",
      include_fields: "id,name,brand,category,size,price,mrp,icon,popularity",
    } as never)) as unknown as { grouped_hits?: Array<{ group_key: string[]; hits: Raw["hits"] }> };
  const groups = res.grouped_hits ?? [];
  return intents.flatMap((c) => groups.find((g) => g.group_key[0] === c)?.hits ?? []);
}

export async function searchProducts(input: SearchInput): Promise<SearchResult> {
  const started = performance.now();
  const q = input.q.trim().slice(0, 120);
  const qNorm = normalizeQuery(q);
  const script = detectScript(q);
  const perPage = Math.min(Math.max(input.perPage ?? 20, 1), 50);
  const page = Math.max(input.page ?? 1, 1);

  const active = await activeProductsCollection().catch(() => null);
  if (!active) throw httpError(503, "Search index is not built yet: run pnpm seed:products, then pnpm reindex");

  const parsed = parseQuery(q, input.ignore ?? []);
  const rewrite = input.rewrite !== undefined ? input.rewrite : env.searchRewrite && script === "Roman" ? await cachedRewrite(q, qNorm) : null;

  // stretched Hinglish ("maccharaa") -> a word the index knows; the vector still gets what was typed
  const keywordText = spellFix(parsed.text);
  const corrected = keywordText !== parsed.text ? keywordText : null;

  // the vector needs the meaning words, not the filter words; original + rewrite won the bake-off
  const sameModel = active.embedModel === ai.embedModelId();
  const vectorText = [parsed.text, corrected, rewrite].filter(Boolean).join(" | ");
  const vector = sameModel && parsed.text ? await queryVector(vectorText) : null;

  const base: string[] = [];
  if (input.storeId) base.push(`store_ids:=${quote(input.storeId)}`);
  if (input.category) base.push(`category:=${quote(input.category)}`);
  const parsedFilters: string[] = [];
  if (parsed.brand) parsedFilters.push(`brand:=${quote(parsed.brand)}`);
  if (parsed.maxPrice !== undefined) parsedFilters.push(`price:<=${parsed.maxPrice}`);
  if (parsed.minPrice !== undefined) parsedFilters.push(`price:>=${parsed.minPrice}`);
  if (parsed.size) parsedFilters.push(`size_unit:=${parsed.size.unit} && size_qty:>=${Math.floor(parsed.size.qty * 0.9)} && size_qty:<=${Math.ceil(parsed.size.qty * 1.1)}`);

  let raw = await runSearch(active.collection, keywordText, [...base, ...parsedFilters], vector);
  let filtersRelaxed = false;
  if (raw.hits.length === 0 && parsedFilters.length) {
    // "amul doodh 20 rs" with no such product: show doodh anyway, and say so
    raw = await runSearch(active.collection, keywordText || qNorm, base, vector);
    filtersRelaxed = true;
  }

  // intent-style query (few keyword hits): intent picks compete for the top. Words that already match
  // products ("green tea") keep the top, intent picks only go after them.
  const intents = matchIntents(qNorm, corrected, rewrite);
  const keywordHits = raw.hits.slice(0, 10).filter((h) => (h.text_match ?? 0) > 0).length;
  const intentStyle = keywordHits < 3;
  const seen = new Set(raw.hits.map((h) => String(h.document.id)));
  const extra = intents.length
    ? (await intentHits(active.collection, filtersRelaxed ? base : [...base, ...parsedFilters], intents).catch(() => [])).filter((h) => !seen.has(String(h.document.id)))
    : [];

  let outOfStock = false;
  if (raw.hits.length === 0 && extra.length === 0 && input.storeId) {
    const anywhere = await runSearch(active.collection, keywordText || qNorm, base.filter((f) => !f.startsWith("store_ids")), null, 1);
    outOfStock = anywhere.found > 0;
  }

  // re-rank: Typesense order, plus an intent boost. Strong for an intent-style query,
  // tiny when the words already match products ("green tea" must not turn into milk and sugar).
  const boost = intentStyle ? 0.03 : 0.005;
  const offset = intentStyle ? 0 : raw.hits.length;
  const candidates = [...raw.hits.map((h, i) => ({ h, i, fromIntent: false })), ...extra.map((h, j) => ({ h, i: offset + j, fromIntent: true }))];
  const ranked = candidates
    .map(({ h, i, fromIntent }) => {
      const d = h.document;
      const category = String(d.category);
      const score = 1 / (20 + i) + (intents.includes(category) ? boost * (1 - intents.indexOf(category) / (intents.length * 2)) : 0) + Math.log10(1 + Number(d.popularity ?? 0)) * 0.0005;
      const textMatch = (h.text_match ?? 0) > 0;
      const hit: SearchHit = {
        id: String(d.id),
        name: String(d.name),
        brand: String(d.brand ?? ""),
        category,
        size: String(d.size ?? ""),
        price: Number(d.price),
        mrp: Number(d.mrp ?? d.price),
        icon: String(d.icon ?? "shopping_basket"),
        matchedBy: fromIntent ? "intent" : textMatch ? (h.vector_distance !== undefined ? "both" : "keyword") : "vector",
      };
      return { hit, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.hit);

  return {
    q,
    qNorm,
    script,
    rewrite,
    corrected,
    filters: filtersRelaxed ? [] : parsed.chips,
    filtersRelaxed,
    intents,
    storeId: input.storeId ?? null,
    total: Math.min(raw.found, CANDIDATES) + extra.length,
    page,
    perPage,
    hits: ranked.slice((page - 1) * perPage, page * perPage),
    vectorUsed: Boolean(vector),
    outOfStock,
    tookMs: Math.round(performance.now() - started),
  };
}

const SUGGEST_LIMIT = 8;

export type Suggestion = Pick<SearchHit, "id" | "name" | "brand" | "size" | "price" | "icon" | "category">;

const toSuggestion = (h: Raw["hits"][number]): Suggestion => ({
  id: String(h.document.id),
  name: String(h.document.name),
  brand: String(h.document.brand ?? ""),
  size: String(h.document.size ?? ""),
  price: Number(h.document.price),
  icon: String(h.document.icon ?? "shopping_basket"),
  category: String(h.document.category),
});

/**
 * Typing suggestions: keyword prefix search, no vector, so it stays fast.
 * No word matches ("sabzi dede")? The intent's categories fill the dropdown, one product each.
 */
export async function suggestProducts(q: string, storeId?: string | null): Promise<Suggestion[]> {
  const text = q.trim().slice(0, 60);
  if (!text) return [];
  const active = await activeProductsCollection().catch(() => null);
  if (!active) return [];
  const filters = storeId ? [`store_ids:=${quote(storeId)}`] : [];
  const fixed = spellFix(normalizeQuery(text));
  const res = (await typesense
    .collections(active.collection)
    .documents()
    .search({
      q: fixed || text,
      query_by: "name,tags,brand,typos",
      query_by_weights: "4,3,2,1",
      prefix: "true,true,true,false",
      per_page: SUGGEST_LIMIT,
      ...(filters.length ? { filter_by: filters.join(" && ") } : {}),
      include_fields: "id,name,brand,size,price,icon,category",
    } as never)) as unknown as Raw;
  let hits = res.hits;
  if (!hits.length) {
    const intents = matchIntents(normalizeQuery(text), fixed).slice(0, SUGGEST_LIMIT);
    if (intents.length) hits = await intentHits(active.collection, filters, intents, 1).catch(() => []);
  }
  return hits.map(toSuggestion);
}

/** Empty search box: the store's most clicked products; random ones fill in until clicks make a popularity */
export async function popularProducts(storeId?: string | null, limit = 6): Promise<Suggestion[]> {
  const active = await activeProductsCollection().catch(() => null);
  if (!active) return [];
  const res = (await typesense
    .collections(active.collection)
    .documents()
    .search({
      q: "*",
      sort_by: "popularity:desc",
      per_page: 50,
      ...(storeId ? { filter_by: `store_ids:=${quote(storeId)}` } : {}),
      include_fields: "id,name,brand,size,price,icon,category,popularity",
    } as never)) as unknown as Raw;
  const clicked = res.hits.filter((h) => Number(h.document.popularity) > 0);
  const rest = shuffle(res.hits.filter((h) => !(Number(h.document.popularity) > 0)));
  return [...clicked, ...rest].slice(0, limit).map(toSuggestion);
}
