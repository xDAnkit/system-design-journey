# Insta Story API

Instagram-style backend for the Season 1 story episode: profiles, posts, reels, likes, views, follows, Meta One premium and stories. TypeScript, Fastify, Mongoose, Redis counters, Kafka, cursor pagination, Swagger.

## Stack

| Piece           | Choice                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Language        | TypeScript                                                                                                         |
| HTTP            | Fastify 5                                                                                                          |
| Database        | MongoDB + Mongoose, one database (`instagram`). `MONGO_MODE=auto` adapts to a standalone `mongod` or a replica set |
| Cache           | Redis: counters, HyperLogLog, Cuckoo filters, short-lived caches (`shared/redisGateway.ts`)                        |
| Queue           | Kafka topics `likes`, `views`, `follows`, `story-views`, `story-likes`                                             |
| Env validation  | zod                                                                                                                |
| Logging         | winston (console + `logs/*.log` file transports)                                                                   |
| Build           | tsup (esbuild)                                                                                                     |
| Process manager | node:cluster (`WORKERS`, default 1), pm2 via `ecosystem.config.json`                                               |
| API docs        | swagger-jsdoc + @fastify/swagger-ui                                                                                |

## Folder structure

```
src/
├── server.ts                 # API: bootstrap → listen → graceful shutdown
├── consumers.ts              # Kafka consumers + story sweeper, separate process
├── app.ts                    # routes, onRequest hooks, /health, /ready, /api-docs
├── bootstrap/                # env, logger, database, redis, kafka, mongo topology
├── shared/                   # counters, cuckoo, pairs, pagination, redisGateway, error, user, client-meta, geo
├── docs/swagger.ts           # @openapi comments are read from *.router.ts
├── features/
│   ├── products/             # leftover ecommerce demo, kept for pagination practice
│   ├── profiles/ follows/    # profile cards and the follow graph
│   ├── posts/ likes/ views/ comments/
│   ├── premium/              # Meta One, demo plan, no payment
│   ├── stories/              # create, feed, open, view, likes, replies, viewers, extend, highlights, consumer, sweeper
│   └── audit/                # audit_events, one row per write action
└── seed/                     # seed-products, seed-insta, boost
```

No `*.service.ts` layer: controllers call Mongoose models directly, except the shared primitives in `shared/`.

## Setup

```bash
pnpm install
cp .env.example .env   # already created, adjust values if needed
```

### Run order

1. Mongo (`mongod` on 27017, or `pnpm mongo:up`), Redis on 6379, Kafka (`pnpm kafka:up`).
2. `pnpm dev` starts the API on 5003.
3. `pnpm consumers` in a second terminal. The API never consumes; without this process likes, views, follows, story views and story likes stay queued in Kafka.
4. `pnpm seed:insta` once for the demo profiles.

### Env vars (`.env`, validated by `src/bootstrap/env.ts`)

| Var                                        | Default                               | Notes                                                              |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| `PORT`                                     | 5003                                  |                                                                    |
| `MONGO_URI`                                | `mongodb://127.0.0.1:27017/instagram` | one database, `MONGO_MODE` decides standalone vs replica behaviour |
| `REDIS_URL`                                | `redis://127.0.0.1:6379`              | counters, HLL, Cuckoo, caches                                      |
| `KAFKA_BROKERS`                            | `127.0.0.1:9092`                      | comma separated                                                    |
| `LOG_LEVEL`                                | `info`                                | `error` \| `warn` \| `info` \| `http` \| `debug`                   |
| `NODE_ENV`                                 | `development`                         | `development` \| `production` \| `test`                            |
| `TRUST_PROXY`                              | `true`                                | client IP from `X-Forwarded-For`; the socket peer is stored too    |
| `AUDIT_SALT`                               | dev default                           | salts `ipHash`, keep the real value in `.env`                      |
| `AUDIT_RETENTION_DAYS`                     | 90                                    | TTL on `audit_events.at`                                           |
| `GEO_DB_PATH`                              | empty                                 | optional local JSON IP table for geo, empty means geo is null      |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | required                              | reserved for the auth episode, currently unused                    |

Invalid/missing required env values fail fast at startup with a clear error.

### Audit metadata

Every request captures IP (`trustProxy` on, socket peer kept too), a salted IP hash, user agent, parsed browser/OS/device, language, timezone, `x-client-id` and referer, plus geo when `GEO_DB_PATH` points to a local table. Write endpoints add one `audit_events` row and a small `audit` snapshot on the record. Story views keep their evidence on the `story_views` row (`lastClient`), because one audit doc per view would double storage.

Caveat: identity is still the client-claimed `x-user-id` header, so the trail becomes real evidence only after login is wired. IP and location are personal data: purpose, consent, retention and a delete path are required under DPDP Act 2023 and GDPR.

### Known dead code

`shared/auth.ts`, `shared/jwt.ts`, `shared/session.ts` and `bcrypt` are not wired. `shared/zstd-compression.ts` is unused and `@fastify/compress` is commented out in `src/app.ts`. Left in place for the auth episode on purpose.

## Optional: Mongo replica set (Docker)

The app runs fine on a local standalone `mongod` (`MONGO_MODE=auto`). This compose file is only for testing replica behaviour.

| Node      | Container              | Host port | Volume                      |
| --------- | ---------------------- | --------- | --------------------------- |
| Primary   | `fk-mongo-primary`     | 27017     | `fk-mongo-primary-data`     |
| Secondary | `fk-mongo-secondary-1` | 27018     | `fk-mongo-secondary-1-data` |
| Secondary | `fk-mongo-secondary-2` | 27019     | `fk-mongo-secondary-2-data` |

Replica set: `fk-rs`. App DB: `instagram`. Test DB: `fk-test` (same cluster). Write concern: `w: majority`. Read: `primaryPreferred` (PRIMARY nahi to last SECONDARY se read).

```bash
pnpm mongo:up       # start (reuses volumes)
pnpm mongo:status   # 1 PRIMARY, 2 SECONDARY
pnpm mongo:down     # stop, data rehti
pnpm mongo:reset    # data mitati + dubara init
```

Host pe pehle se `mongod` 27017 pe ho to band karo, warna primary port bind fail.

App `host.docker.internal` ko `127.0.0.1` map karti hai (Mac pe wo DNS nahi milta). Compass/mongosh se replica set connect karna ho to `/etc/hosts` me ye line:

`127.0.0.1 host.docker.internal`

Init: `fk-mongo-init` ek baar `rs.initiate` chalata hai (already initiated ho to skip), phir exit.

Docker Desktop (Linux VM kernel 6.19+) pe Mongo 8 ko `GLIBC_TUNABLES=glibc.pthread.rseq=1` chahiye — compose me already set (SERVER-121912).

## Scripts

| Command                                                                                                             | What it does                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                                                                          | tsup watch build (minified) → runs `dist/server.js`, rebuilds + restarts on change                                                                               |
| `pnpm build`                                                                                                        | one-off tsup build (not minified, has sourcemaps)                                                                                                                |
| `pnpm build:prod`                                                                                                   | tsup build, minified, `dist/` cleaned first                                                                                                                      |
| `pnpm start:prod`                                                                                                   | `build:prod` then runs `dist/server.js` with `NODE_ENV=production`                                                                                               |
| `pnpm seed:products`                                                                                                | builds + runs the bulk product seeder                                                                                                                            |
| `pnpm consumers`                                                                                                    | runs the Kafka consumers (likes, follows, views, story views, story likes) and the story expiry sweeper in their own process. Keep it running next to the server |
| `pnpm boost -- --post=<id> --likes=N --views=N --unique=N --comments=N --yes` / `--profile=<u> --followers=N --yes` | fake traffic through Kafka, 50k events per send. Without `--yes` it only prints the plan                                                                         |
| `pnpm seed:insta`                                                                                                   | builds + seeds 3 demo profiles with posts, reels and comments (insert-only, skips a profile that already has posts)                                              |
| `pnpm typecheck`                                                                                                    | `tsc --noEmit`                                                                                                                                                   |
| `pnpm mongo:up`                                                                                                     | start replica set (`infra/mongo/compose.yaml`)                                                                                                                   |
| `pnpm mongo:down`                                                                                                   | stop containers — **volumes stay**                                                                                                                               |
| `pnpm mongo:status`                                                                                                 | compact replica roles (PRIMARY / SECONDARY / DOWN)                                                                                                               |
| `pnpm mongo:reset`                                                                                                  | wipe volumes + start fresh — **only this deletes data**                                                                                                          |
| `pnpm kafka:up`                                                                                                     | start Kafka (`infra/kafka/compose.yaml`, `localhost:9092`, volume `insta-kafka-data`)                                                                            |
| `pnpm kafka:stop`                                                                                                   | stop the container, keep it and the data                                                                                                                         |
| `pnpm kafka:down`                                                                                                   | remove the container — **volume stays**                                                                                                                          |
| `pnpm kafka:status`                                                                                                 | show the container state                                                                                                                                         |
| `pnpm kafka:logs`                                                                                                   | follow the last 100 log lines (Ctrl+C to leave)                                                                                                                  |
| `pnpm kafka:reset`                                                                                                  | wipe the volume + start fresh — **deletes all Kafka data**                                                                                                       |

## Mongo mode

`MONGO_MODE` = `auto` (default), `standalone`, `replica` or `sharded`. On startup each host in `MONGO_URI` is probed and the app adapts (standalone `w:1`, replica/sharded `w:majority`). A fixed value must match what is found, else startup fails. `NODE_ENV=production` only starts with `replica` or `sharded`.

## Running via pm2

Two pm2 apps are defined in `ecosystem.config.json`:

| App             | Mode        | Instances | watch                                              | script                           |
| --------------- | ----------- | --------- | -------------------------------------------------- | -------------------------------- |
| `flipkart-dev`  | fork        | 1         | false (tsup `--watch` already rebuilds + restarts) | `pnpm dev`                       |
| `flipkart-prod` | **cluster** | **4**     | false                                              | `dist/server.js` (already built) |

`flipkart-prod` runs the already-built file directly — not `pnpm start:prod` — on purpose: in cluster mode pm2 forks 4 worker processes from the same script, so if the script itself triggered a build (like `pnpm start:prod` does), all 4 workers would race to build at once. `scripts/start-prod.sh` builds once _before_ handing the built file to pm2.

```bash
./scripts/dev.sh          # pm2: start "flipkart-dev" (runs `pnpm dev`) if not running, else restart
./scripts/start-prod.sh   # pnpm build:prod, then pm2 start/reload "flipkart-prod" (4 cluster workers)
```

Both scripts are idempotent — safe to re-run any time you change code. `start-prod.sh` uses `pm2 reload` (zero-downtime rolling restart across the 4 workers) when already running, `dev.sh` uses `pm2 restart`. Logs land in `logs/{dev,prod}-{out,error}.log`.

## API docs

Swagger UI: `http://localhost:5003/api-docs` (once the server is running).

Health check: `GET /health`.

## Routes

All list endpoints use **cursor pagination**: `?cursor=<last _id from previous page>&limit=<n>`. `limit` is clamped to a maximum of **100** (default 20) regardless of what's requested.

### Products (`/products`)

| Method | Path   | Body / Query                                                    |
| ------ | ------ | --------------------------------------------------------------- |
| GET    | `/`    | `?cursor&limit&category&name` (`name` = text-index word search) |
| GET    | `/:id` |                                                                 |
| POST   | `/`    | `{ name, description, price, stock, category, imageUrl }`       |
| PUT    | `/:id` | any subset of the above                                         |
| DELETE | `/:id` |                                                                 |

### Instagram

Pages: `/` (pick a user, this is the "login") and `/u/:username` (profile). One file, `public/index.html`, Tailwind from the CDN. Logout goes back to `/`. The picked user is sent as the `x-user-id` header.

| Method | Path                         | Notes                                                                                                                                                                                                                 |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/profiles`                  | all profile cards. `?q=` searches instead: username prefix or displayName match, top 20                                                                                                                               |
| GET    | `/profiles/:username`        | profile card, `postsCount`, `followers`, `following` (Redis counters), `isFollowing` (needs `x-user-id`)                                                                                                              |
| POST   | `/profiles/:username/follow` | header `x-user-id`. Kafka topic `follows`, answers `202`. Consumer writes Mongo `follows`, Redis `profile:{u}:followers` and `:following`, and the Cuckoo filter `user:{id}:following`                                |
| DELETE | `/profiles/:username/follow` | same flow, unfollow                                                                                                                                                                                                   |
| GET    | `/posts`                     | `?authorId&type=post\|reel&cursor&limit`, newest first. Every item also has `likes`, `comments`, `totalViews`, `uniqueViews` (Redis) and `isLiked`, `isSeen` (need `x-user-id`)                                       |
| GET    | `/posts/:id`                 | one post or reel                                                                                                                                                                                                      |
| GET    | `/posts/:id/comments`        | `?cursor&limit`, newest first                                                                                                                                                                                         |
| GET    | `/reels`                     | `?authorId&cursor&limit`, reels only                                                                                                                                                                                  |
| POST   | `/posts/:id/view`            | header `x-user-id`. Call it when a post is opened. Kafka topic `views`, answers `202`. Consumer adds 1 to `post:{id}:views` and the user to the HyperLogLog `post:{id}:uv`, and to the Cuckoo filter `user:{id}:seen` |
| POST   | `/posts/:id/like`            | header `x-user-id`. Goes to Kafka topic `likes`, answers `202`. A consumer writes Mongo `likes`, then Redis `post:{id}:likes` and the user's Cuckoo filter                                                            |
| DELETE | `/posts/:id/like`            | same flow, removes the like                                                                                                                                                                                           |

### Meta One premium (`/premium`)

Demo plan, no payment and no pricing UI. Only the owner can change their own plan (`x-user-id` must equal the username).

| Method | Path                 | Notes                                                          |
| ------ | -------------------- | -------------------------------------------------------------- |
| GET    | `/premium/:username` | `{ username, active, tier, startedAt, cancelledAt, benefits }` |
| POST   | `/premium/:username` | activate or re-activate, cache `premium:{u}` refreshed         |
| DELETE | `/premium/:username` | cancel, row and start date are kept                            |

`GET /profiles/:username` also returns `isPremium`, so the profile page needs one call.

### Stories (`/stories`)

| Method | Path                   | Notes                                                                                                                                                                                                                             |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/stories/media`       | body `{ dataUrl }`, a base64 image up to 6 MB decoded. Writes `public/uploads/<uuid>.<ext>` and returns `{ url, bytes }`. Route body limit is 12 MB                                                                               |
| POST   | `/stories`             | body `{ type, mediaUrl, caption?, thumbnailUrl?, audience? }`. Audience is `public` unless you pass `followers`. Mongo row, then `story:{id}:meta` with `EXAT`, then one `audit_events` row                                       |
| GET    | `/stories/feed`        | own plus followed authors' live stories, plus public stories from authors you do not follow, grouped by author. `?authorId=` returns just that author's tray. `views` is filled for your own stories only. The followee list is cached 300s, the stories are always read fresh |
| GET    | `/stories/:id`         | tombstone, then cache, then Mongo. Followers-only stories check the follow graph. `views`, `uniqueViews` and `rewatches` are returned to the author only, other viewers get `null` |
| POST   | `/stories/:id/view`    | Kafka topic `story-views`, answers `202`. The author's own open never counts. `?anonymous=true` is a Meta One gate: the total moves, no viewer row                                                                                |
| PATCH  | `/stories/:id`         | owner only, `now - createdAt <= 15 min`, `version + 1`, `edited = true`, cache dropped then re-cached with the original `expiresAt`                                                                                               |
| DELETE | `/stories/:id`         | owner only, soft delete, tombstone 300s, the row stays for audit                                                                                                                                                                  |
| POST   | `/stories/:id/like`    | Kafka topic `story-likes`, `202`. One row per story + viewer via `shared/pairs.ts`                                                                                                                                                |
| DELETE | `/stories/:id/like`    | same topic, the pair is removed and the counter moves down                                                                                                                                                                        |
| POST   | `/stories/:id/reply`   | body `{ text }` (1 to 500 chars), one `story_replies` row that survives story expiry                                                                                                                                              |
| GET    | `/stories/:id/replies` | owner only, cursor pagination, oldest first                                                                                                                                                                                       |
| GET    | `/stories/:id/viewers` | owner plus Meta One, rows inside `createdAt + 48h`, `?q=` prefix search, cached 300s. Without an active plan the route answers `403`                                    |
| POST   | `/stories/:id/share`   | counter only in v1, `story:{id}:shares`                                                                                                                                                                                           |
| POST   | `/stories/:id/extend`  | Meta One plus owner, once, `expiresAt = createdAt + 48h`, never 72h                                                                                                                                                               |

Consumer writes `story_views` (one row per story + viewer, `watchCount`, `lastClient` evidence), `story:{id}:views`, `story:{id}:uv` HyperLogLog and the Cuckoo filter `user:{id}:seenStory`. A sweeper runs every 60s and sets `status=expired`; rows are never deleted. The second consumer writes `story_likes` and moves `story:{id}:likes` only by rows that really changed, so a replayed batch changes nothing.

### Story composer (UI)

The composer has two modes:

| Mode   | What happens                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device | Pick or drop an image, type text on it, drag the text, choose size and colour. The browser draws the 1080x1920 canvas, uploads a JPEG and creates the story |
| Link   | Paste an image or video URL with an optional caption, used for video since there is no upload pipeline for video yet                                        |

Text typed on the device image is baked into the canvas and also saved as the story `caption`, so the edit sheet can prefill it. Editing changes the caption line, the pixels stay as posted. Uploaded files live in `public/uploads/` (gitignored) and are served by `GET /uploads/:name` with an immutable cache header. Nothing deletes them yet, that is part of the Phase 6 media work.

Owner sheets (Edit, Viewers, Highlight, Delete) freeze the story timer and resume it from the same point on close. The edit sheet is disabled once the 15 minute window has passed. The Viewers button only renders while the author has an active Meta One plan, so the named list with rewatch counts stays behind the plan.

Views, unique viewers and rewatches render for the author only. Everyone else sees the story, likes and shares, with no watch count.

The audience select defaults to `Public`, so another account can open the story without following the author. `Followers only` keeps the follow graph gate.

### Discovery (UI)

The search icon in the left rail opens a profile search: it calls `GET /profiles?q=` with a 220 ms debounce and each row opens `/u/<username>`. With an empty box it lists the suggested profiles.

A profile page renders that author's tray with `GET /stories/feed?authorId=<username>`, so their public stories show even when you do not follow them. The home feed also appends public stories from authors outside your follow list.

### Highlights (`/highlights`)

A highlight is a named list of story references. The story may expire, the highlight still renders.

| Method | Path                             | Notes                                                                |
| ------ | -------------------------------- | -------------------------------------------------------------------- |
| POST   | `/highlights`                    | owner, body `{ title, storyIds? }`, only your own stories go in      |
| GET    | `/highlights/:id`                | slides in the order they were added, followers-only items filtered   |
| DELETE | `/highlights/:id`                | owner, removes the highlight and its items                           |
| POST   | `/highlights/:id/items`          | owner, body `{ storyId }`, `itemCount` moves only on a new pair      |
| DELETE | `/highlights/:id/items/:storyId` | owner, the cover moves to the next story                             |
| GET    | `/profiles/:username/highlights` | profile tray with cover and slides, one query per collection, no N+1 |

## Seeding products

Bulk-inserts fake products directly via the MongoDB driver (bypasses Mongoose document hydration — the dominant cost at millions-of-docs scale). Non-`_id` indexes are dropped before the insert and rebuilt after, to avoid index-maintenance overhead mid-insert.

```bash
# Interactive menu (only when run in a real terminal)
pnpm seed:products

# Skip the menu — pass the count directly
pnpm seed:products -- --count=1000000

# Tune batch size / concurrency for your machine (defaults: batch 5000, concurrency = min(CPU cores, 8))
pnpm seed:products -- --count=10000000 --batch-size=10000 --concurrency=8
```

Menu options: 1M / 4M / 6M / 10M (= 1 crore, default) / custom. Piped/non-interactive runs with no `--count` default straight to 10M without prompting.

Self-check for the batch-planning logic: `node dist/seed-products.js --selfcheck` (build first with `pnpm build`).
