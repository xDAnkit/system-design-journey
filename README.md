# System Design Journey

System design notes and examples for the YouTube playlist, Season 1.

This is not an app. There is no root build, lint, or test command. Each video topic lives in its own folder.

## Topics

| Path | Topic |
|---|---|
| `season-1/1.compressions/` | Compressions (planned) |
| `season-1/2.vertical-vs-horizontal-scaling/` | Vertical vs horizontal scaling |
| `season-1/3.Searching/` | Searching: username availability with Bloom, Cuckoo, Xor and Fuse filters |
| `season-1/4.Database/` | Database: ScyllaDB with Fastify and Go (planned) |
| `season-1/5.Stats/` | Stats: Insta Stats |

New topic path: `season-1/<number>.<topic-name>/`.

### Searching folders

| Path | Contents |
|---|---|
| `1.bloom-filters/` | Bloom filter |
| `2.cuckoo-filters/` | Cuckoo filter |
| `3.binary-fuse-filters/` | Binary Fuse filter |
| `3.xor-filters/` | Xor filter |
| `3.cuckoo-filters-go/` | Cuckoo filter in Go |
| `6.cuckoo-filters-uwebsocket/` | Cuckoo filter on uWebSockets |
| `7.cuckoo-filters-with-rust/` | Cuckoo filter as a Rust native module |
| `8.Filters/` | Planned |
| `design/` | HLD and LLD |

## Shared scripts

| Path | What it does |
|---|---|
| `scripts/load-testing/1.api-test.js` | k6 test, 50 users for 15 seconds on `GET /api/v1/cities` |
| `scripts/verify-setup.sh` | Checks the agent rules and hooks setup |
| `pnpm nginx:local` | Runs the nginx from `season-1/2.vertical-vs-horizontal-scaling/servers/nginx/` |

## Searching benchmark

Same data (3,023,103 usernames in Mongo and Elasticsearch), same machine, 4 PM2 workers per app, k6 for 15 seconds, 80 users, k6 on 4 cores. Only `GET /check-username`, so no data changes. 0 failed requests in every run.

| Scenario | Metric | Bloom | Fuse | Cuckoo (Rust) |
|---|---|---|---|---|
| 100% new names | Req/s | 68,175 | 64,406 | 63,634 |
| | p95 | 2.7 ms | 2.9 ms | 3.0 ms |
| 50% new, 50% existing | Req/s | 27,784 | 26,558 | 27,198 |
| | p95 | 8.2 ms | 8.6 ms | 8.6 ms |
| 100% existing | Req/s | 16,710 | 16,240 | 17,100 |
| | p95 | 9.5 ms | 9.7 ms | 9.4 ms |
| Filter size in RAM | | ~7.5 MB per worker | ~6.5 MB per worker | ~14 MB, shared by all workers |
| Delete a name | | No | At next rebuild | Yes |

- Free names are answered by the filter alone, so they cost no database call. That is the gain.
- Speed is within about 5% across the three. The real difference is memory and features.
- With only existing names a filter cannot help, every check goes to Elasticsearch.
- Numbers move with other load on the machine. Treat them as relative.
- Details per topic are in each topic's own README.

## How to work

- Keep a topic's notes and code inside that topic folder.
- Do not edit another topic's files.
- If a topic has its own project, work inside that folder and follow its config.

## Agent rules

Edit `rules/always/`, then run `scripts/sync-agent-rules.sh`. That rebuilds `AGENTS.md`. Do not edit `AGENTS.md` by hand.

Scoped contracts stay in `rules/scoped/` and load only when a matching path is open.

| File | Who reads it |
|---|---|
| `AGENTS.md` | Codex, Claude (`CLAUDE.md`), Antigravity (`GEMINI.md`) |
| `.cursor/rules/` | Cursor |
| `.qoder/rules/` | Qoder |
| `.agents/rules/` | Antigravity |

## Safety hook

`hooks/block-dangerous.sh` runs before agent shell commands in Cursor and Claude. It blocks database writes, `rm -rf`, process kills, and git rewrites. Check it with `bash hooks/self-check.sh`.

Git rejects a non-fast-forward push when this repo uses `.githooks`. One-time setup, this repo only:

```bash
git config core.hooksPath .githooks
```
