# 12. Image search

| Field | Value |
|---|---|
| Added | 2026-10-27 |
| Status | Later |
| Effort | High |
| Fits in phase | much later |

## What

The shopper uploads a photo of a pack and gets the matching product.

## Why

Useful when the shopper does not know the name, for example a pack from another city.

## How

- Option A: image embeddings (a CLIP-style model) stored next to the text vectors.
- Option B: a vision LLM describes the photo, then the normal text search runs.

## Watch out

- The catalog has only icons, no real product photos. This needs photos first.
- Image models are heavy for a 16 GB laptop.
