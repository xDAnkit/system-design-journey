# 03. Filters from the query text

| Field | Value |
|---|---|
| Added | 2026-10-27 |
| Status | In plan, phase 4 (picked 2026-10-27) |
| Effort | Medium |
| Fits in phase | 4 (search) |

## What

"amul doodh 1 litre 60 se kam" becomes brand = Amul, size = 1 L, price < 60, and the text search runs only on "doodh".

## Why

It feels like a real quick commerce app, and the results get much tighter.

## How

- Rules first, no LLM:
  - Price: "under 60", "60 se kam", "60 tak", "below ₹60".
  - Size: ml, l, litre, kg, g, gm, pcs.
  - Brand: the catalog's brand list, with small typo tolerance.
- The matched words leave the text query and become a Typesense `filter_by`.
- LLM fallback only for long queries where the rules found nothing.
- Show the filters as chips ("Amul ✕", "≤ ₹60 ✕") so the shopper can remove them.

## Watch out

- If the filters give 0 results, search again without them.
