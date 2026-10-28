# Future scope

Ideas parked for later. They are not part of the current plan (phases 1 to 6).
To pick one up, move it into the plan, then update its status here.

| No | Idea | Added | Effort | Fits in phase | Status | File |
|---|---|---|---|---|---|---|
| 01 | Voice search | 2026-10-27 | Low | 5 | Later | [01-2026-10-27-voice-search.md](01-2026-10-27-voice-search.md) |
| 02 | AI basket | 2026-10-27 | Medium | 4, 5 | Later | [02-2026-10-27-ai-basket.md](02-2026-10-27-ai-basket.md) |
| 03 | Filters from the query text | 2026-10-27 | Medium | 4 | **In plan** (picked 2026-10-27) | [03-2026-10-27-query-filters.md](03-2026-10-27-query-filters.md) |
| 04 | Trending and recent searches | 2026-10-27 | Low | 5, 6 | Later | [04-2026-10-27-trending-recent-searches.md](04-2026-10-27-trending-recent-searches.md) |
| 05 | Zero-result help | 2026-10-27 | Low | 4, 5 | Later | [05-2026-10-27-zero-result-help.md](05-2026-10-27-zero-result-help.md) |
| 06 | A/B testing of ranking | 2026-10-27 | Medium | 6 | Later | [06-2026-10-27-ab-testing.md](06-2026-10-27-ab-testing.md) |
| 07 | System health page | 2026-10-27 | Medium | 6 | Later | [07-2026-10-27-system-health-page.md](07-2026-10-27-system-health-page.md) |
| 08 | Load test with k6 | 2026-10-27 | Medium | after 4 | Later | [08-2026-10-27-load-test-k6.md](08-2026-10-27-load-test-k6.md) |
| 09 | Search funnel | 2026-10-27 | Low | 6 | Later | [09-2026-10-27-search-funnel.md](09-2026-10-27-search-funnel.md) |
| 10 | Learn synonyms from rephrasing | 2026-10-27 | Medium | 6 | Later | [10-2026-10-27-rephrase-learning.md](10-2026-10-27-rephrase-learning.md) |
| 11 | Semantic cache | 2026-10-27 | Medium | after 4 | Later | [11-2026-10-27-semantic-cache.md](11-2026-10-27-semantic-cache.md) |
| 12 | Image search | 2026-10-27 | High | much later | Later | [12-2026-10-27-image-search.md](12-2026-10-27-image-search.md) |
| 13 | CSV export | 2026-10-27 | Low | 6 | Later | [13-2026-10-27-csv-export.md](13-2026-10-27-csv-export.md) |

Not parked here, because they stay in the main plan:

- Rate limit on `/search` and `/events` (public routes, fake clicks could poison the AI suggested tags).
- Search quality test `pnpm eval:search` (catches a drop in Hit@1 after any change).
- AI suggested tags (candidate, AI check, active after real clicks or admin approval).
- Location picker, dark stores and location analytics.
