# 11. Semantic cache

| Field | Value |
|---|---|
| Added | 2026-10-27 |
| Status | Later |
| Effort | Medium |
| Fits in phase | after 4 (search) |

## What

Queries that mean the same thing ("doodh", "दूध", "milk") reuse one cached result list instead of running the full search each time.

## Why

Fewer vector and Typesense calls under load.

## How

- Look up the nearest cached query vector. Reuse its results when the cosine is at least 0.95.
- Cache per dark store, with a short TTL (about 5 minutes), because stock and prices change.

## Watch out

- A loose threshold reuses wrong results. Measure hit rate against accuracy with `pnpm eval:search` before turning it on.
