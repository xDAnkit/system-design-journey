# 10. Learn synonyms from rephrasing

| Field | Value |
|---|---|
| Added | 2026-10-27 |
| Status | Later |
| Effort | Medium |
| Fits in phase | 6 (analytics) |

## What

A shopper searches "doodh", gets nothing useful, then searches "milk" within a minute and clicks. After enough shoppers do the same, the admin sees the suggestion "doodh = milk".

## Why

A second learning loop next to the AI suggested tags. The search improves from real behaviour.

## How

- The analytics worker keeps each session's last query in Redis (2 minute TTL).
- Pair (q1 → q2) counts when q1 had no click and q2 got a click. Pairs go to a Mongo `rephrase_pairs` collection.
- Above a threshold the pair becomes a synonym candidate in the admin. Approve adds it to the Typesense synonym set.

## Watch out

- Same safety as the AI suggested tags: candidate first, live only after approval.
