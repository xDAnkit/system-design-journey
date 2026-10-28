# Quick Commerce Search

A Blinkit-style grocery search that understands 12 Indian languages, Hinglish and intents.

- "doodh", "paal", "दूध", "पाल" and "milk" all find milk.
- "mujhe chai peeni hai" finds tea, milk, sugar and biscuits.
- "amul doodh 1 litre 60 se kam" becomes brand, size and price filters.

Products flow through Kafka, get AI tags and a vector, and land in Typesense. Every search and click feeds an analytics dashboard.

## Stack

| Part | Tech | Job |
|---|---|---|
| API | Fastify 5, TypeScript, Node 24 | Search, events, admin APIs, serves the pages |
| Source of truth | MongoDB (brew, standalone), db `blinkit` | Products, tags, vectors, analytics counters |
| Search | Typesense 30.2 (Docker) | Keyword + vector (hybrid) search, synonyms |
| Queue | Kafka (Docker) | Product pipeline and search events |
| Cache | Redis | Query vectors, rewrites, unique visitors, live ticker, rate limit, AI setting |
| AI | Ollama `gemma3:4b` (tags, rewrite), `bge-m3` (vectors) | Plug-and-play: OpenAI, Anthropic, Gemini too |
| UI | Plain HTML + Tailwind CDN, Chart.js, Leaflet | Shop page and admin dashboard, no build step |

## How it works

```
Admin "Add product"            POST /products -> 202
        |
        v
  products.ingest  --ingest worker-->  Mongo (status: pending)
        |
        v
  products.enrich  --enrich worker-->  tags (rules + LLM) + vector (bge-m3) -> Mongo
        |                              admin tags for the same title: LLM skipped
        v                              3 failures -> products.enrich.dlq
  products.index   --index worker--->  Typesense (alias "products")

Shopper search   GET /search -> query parser (filters) -> hybrid search -> intents re-rank
                 Hinglish rewrite runs in the background and is cached for the next time
        |
        v
  search.events  --analytics worker-->  raw events (90 days) + daily counters (stats_daily)
                                        + Redis (visitors, live) + AI suggested tags
```

### AI suggested tags

1. A search finds a product only by meaning (vector hit, no keyword hit). The pair becomes a candidate.
2. The AI checks if the pair makes sense.
3. It goes live as a tag after enough real clicks from different sessions, or when the admin approves it.

Thresholds: `SUGGEST_MIN_CLICKS`, `SUGGEST_MIN_SESSIONS`, `SUGGEST_MIN_CTR`.

## Setup

You need Docker, MongoDB from brew, Redis, Ollama, Node 24 and pnpm.

```bash
pnpm install
ollama pull gemma3:4b
ollama pull bge-m3
```

Copy `.env.example` to `.env` and fill it in. The defaults work for a local machine.

## Run order

| Step | Command | What it does | Writes data |
|---|---|---|---|
| 1 | `pnpm typesense:up` | Starts Typesense on :8108 | No |
| 2 | `pnpm kafka:up` | Starts Kafka on :9094 | No |
| 3 | `pnpm ai:check` | Checks the LLM and the embed model answer | No |
| 4 | `pnpm check` | Self checks: tag rules, catalog, query parser, dates, rollup | No |
| 5 | `pnpm seed:products` | 2 lakh products into Mongo `blinkit` (asks first; `--count=`, `--append`, `--yes`) | Mongo |
| 6 | `pnpm reindex` | Tags + vectors for every product, new Typesense collection, alias switch (`--reembed`, `--keep-old`, `--yes`) | Mongo, Typesense |
| 7 | `pnpm dev` | API + pages on http://localhost:5003, plus all Kafka workers (ingest, enrich, index, analytics). Rebuilds and restarts both on a code change | All |
| 8 | `pnpm seed:traffic` | Fake searches and clicks so the dashboard has data (`--days=30 --searches=100000`) | Kafka, then Mongo |
| 9 | `pnpm eval:search` | Search quality report on fixed queries (`--rewrite`, `--min=`, `--words=`) | No |

`pnpm workers` runs the workers alone, for example more copies of one role: `WORKER_ROLES=enrich pnpm workers`.

The seed and reindex scripts only write to a database whose name starts with `blinkit` (or `--allow-db`).

## Pages

| URL | Page |
|---|---|
| `/` | Shop: location picker, search with suggestions, filter chips, cart |
| `/admin` | Overview: KPIs, trend, script split, live searches, top and zero-result searches |
| `/admin/searches` | Every search, sortable; click one for its detail (products clicked, cities, similar searches) |
| `/admin/products` | Product performance; product detail with tags editor |
| `/admin/products/new` | Add a product: instant rule tags, "Generate with AI", edit tags, follow it through the pipeline |
| `/admin/locations` | Demand map, cities, "where to open the next store", "what to stock" |
| `/admin/suggestions` | AI suggested tags: approve or reject |
| `/admin/settings` | Admin key, switch the LLM without a restart, search index status |
| `/api-docs` | Swagger |

Every admin page has a date filter (today, yesterday, 7 days, 30 days, this month, custom) and a city filter.

The admin key goes in the `x-admin-key` header. With `ADMIN_KEY` empty in dev, the key is `dev-admin-key`. Production needs a real one.

## API

| Route | Notes |
|---|---|
| `GET /search?q=&pincode=&page=&ignore=` | Hybrid search, rate limited. `ignore=brand,price,size` drops a parsed filter |
| `GET /search/suggest?q=` | Prefix search for the dropdown, sends no event |
| `GET /search/popular?pincode=` | Empty search box: trending categories in the city, popular products in the store. Other shoppers' searches are never shown |
| `POST /events` | Shop click and add events, rate limited |
| `GET /locations/cities`, `/search?q=`, `/resolve?pincode=`, `/stores` | Static location data |
| `GET /products`, `/products/:id`, `/products/categories` | Catalog reads |
| `POST /products`, `PUT /products/:id`, `DELETE /products/:id` | Admin. Queued on Kafka, answers 202 |
| `POST /products/preview-tags` | Admin. `mode: rules` (instant) or `full` (rules + LLM). Saves nothing |
| `GET /analytics/*` | Admin. overview, searches, products, locations, live, suggestions |
| `GET/PUT/DELETE /settings/ai` | Admin. LLM switch, stored in Redis |
| `GET /health`, `GET /ready` | Liveness, and Mongo / Typesense / Kafka / Redis state |

## Switching AI providers

Each provider lives in `src/ai/providers/<name>/` with its own config, types and provider file.

| How | What changes |
|---|---|
| `.env`: `AI_LLM_PROVIDER`, `AI_LLM_MODEL` | The default LLM |
| `.env`: `AI_LLM_FALLBACK`, `AI_LLM_FALLBACK_MODEL` | Used when the main LLM fails |
| Settings page | LLM for the API and all workers within 10 s, no restart |
| `.env`: `AI_EMBED_PROVIDER`, `AI_EMBED_MODEL`, `AI_EMBED_DIMS` + `pnpm reindex` | Embeddings. Old and new vectors cannot mix |

Keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`. A provider without a key is greyed out in Settings.

## Environment

Read and checked by `src/bootstrap/env.ts` and `src/ai/ai.config.ts`.

| Group | Variables |
|---|---|
| Server | `PORT` (5003), `NODE_ENV`, `LOG_LEVEL`, `ADMIN_KEY` |
| Mongo | `MONGO_URI` (`mongodb://127.0.0.1:27017/blinkit`), `MONGO_MODE`, `MONGO_MIN_POOL`, `MONGO_MAX_POOL`, `MONGO_SELECT_TIMEOUT_MS`, `MONGO_CIRCUIT_FAILS`, `MONGO_CIRCUIT_MS` |
| Redis | `REDIS_URL` |
| Kafka | `KAFKA_BROKERS` (`127.0.0.1:9094`), `KAFKA_CLIENT_ID`, `KAFKA_TOPIC_PREFIX` |
| Typesense | `TYPESENSE_URL`, `TYPESENSE_API_KEY`, `TYPESENSE_COLLECTION_PREFIX` |
| AI | `AI_LLM_*`, `AI_EMBED_*`, `AI_TIMEOUT_MS`, `OLLAMA_URL`, `OLLAMA_KEEP_ALIVE`, `OLLAMA_NUM_CTX`, `*_API_KEY`, `*_BASE_URL`, `ANTHROPIC_VERSION` |
| Search | `SEARCH_REWRITE`, `RATE_LIMIT_SEARCH_PER_MIN`, `RATE_LIMIT_EVENTS_PER_MIN` |
| Suggested tags | `SUGGEST_MIN_CLICKS`, `SUGGEST_MIN_SESSIONS`, `SUGGEST_MIN_CTR` |

`NODE_ENV=test` loads `.env.test` instead.

## Folders

```
src/
  ai/            providers (ollama, openai, anthropic, gemini), tagging (rules + KB + LLM), query rewrite
  analytics/     event types, rollups, dashboard queries, suggested tags
  bootstrap/     env, Mongo, Redis, Kafka, Typesense, shutdown
  catalog/       aisles and items used by the product generator
  features/      products and settings routes
  locations/     cities, pincodes, dark stores (static data)
  search/        Typesense schema, query parser, intents, search service, reindex, eval
  seed/          product generator, product seed, traffic seed
  workers/       ingest, enrich, index, analytics consumers
  app.ts         routes and pages
  server.ts      API entry
  workers.ts     workers entry
public/          shop (index.html) and admin (admin.html, assets/admin/*)
infra/           Docker compose for Typesense, Kafka, Mongo
.future-scope/   ideas for later, numbered and dated
```

## Kafka topics and groups

| Topic | Group | Worker |
|---|---|---|
| `products.ingest` | `qc-ingest` | Writes Mongo, routes to enrich or index |
| `products.enrich` | `qc-enrich` | Tags + vector |
| `products.enrich.dlq` | none | Products that failed 3 times |
| `products.index` | `qc-index` | Typesense upsert / delete |
| `search.events` | `qc-analytics` | Counters, visitors, suggested tags |

`KAFKA_TOPIC_PREFIX` goes in front of every name. Auto topic creation is off; the app creates them on start.

## Notes

- Analytics is at-least-once. A batch read again after a crash can count twice. Fine for dashboards.
- Days are India time (IST). A search at 23:30 belongs to that day.
- Seeded products share the vector of their base item, so 2 lakh products need about 150 embeddings.
