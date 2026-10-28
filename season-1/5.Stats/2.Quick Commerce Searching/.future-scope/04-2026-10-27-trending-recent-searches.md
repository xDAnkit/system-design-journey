# 04. Trending and recent searches

| Field | Value |
|---|---|
| Added | 2026-10-27 |
| Status | Later |
| Effort | Low |
| Fits in phase | 5 (customer UI), data from 6 (analytics) |

## What

When the search box is empty, show "Trending near you" chips and the shopper's own recent searches, like Blinkit does.

## Why

Fewer keystrokes, and it shows that the analytics feed back into the product.

## How

- Trending: top queries of the last 24 hours in the shopper's city, from the analytics rollups (cached in Redis for a few minutes).
- Recent: the last 10 searches in `localStorage`, nothing on the server.

## Watch out

- Trending needs a minimum count and a small blocklist, so odd or rude queries never show up.
