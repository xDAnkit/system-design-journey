# 05. Zero-result help

| Field | Value |
|---|---|
| Added | 2026-10-27 |
| Status | Later |
| Effort | Low |
| Fits in phase | 4 (search) and 5 (customer UI) |

## What

When nothing matches, the page is never empty. It shows "Did you mean doodh?", a row of similar products, and a "Request this product" button.

## Why

An empty page loses the shopper. A request button also tells us what to stock.

## How

- "Did you mean": the closest popular query from the Typesense `search_queries` collection (text match first, vector as fallback).
- Similar products: a vector-only search without strict filters, else the best category.
- "Request this product" logs a demand event, which shows up in the analytics.
