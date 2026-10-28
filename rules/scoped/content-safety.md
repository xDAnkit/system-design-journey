---
description: No abusive or sensitive word may ever become a product tag or a shown suggestion
alwaysApply: false
trigger: glob
globs:
  - "**/5.Stats/2.Quick Commerce Searching/**"
  - "**/5.Stats/3.Jaldi-TheLate-Quick Commerce V2/**"
paths:
  - "**/5.Stats/2.Quick Commerce Searching/**"
  - "**/5.Stats/3.Jaldi-TheLate-Quick Commerce V2/**"
---

# Tag content safety

No abusive, sexual, caste, religious, communal, political, violent, body-shaming or otherwise offensive word may ever reach a shopper.

| Rule | Meaning |
|---|---|
| One gate | Every tag that is not a curated KB word passes `safeTags()` (`src/ai/tagging/tag-guard.ts`) before it is stored, indexed or shown. This covers LLM tags, admin-typed tags, retags and search-to-product mappings. |
| KB is trusted | Words from the curated `product-kb.json` skip the gate. Anything added to the KB must follow this file. |
| No blocklist | Do not keep a list of bad words in the repo. The gate is a strict LLM judge: it returns the tags it keeps, a skipped tag is dropped. An embedding "close to the product" check was tested and does not separate good from bad tags. |
| Fail closed | If the judge is down, times out or answers badly, the tag is dropped, never kept. |
| Admin cannot override | A tag the guard drops stays dropped, even when the admin typed it. |
| User queries | A raw user query is never shown to other users (trending, top searches, suggestions) unless it passes the guard. |
| Search to tag | A user query becomes a product tag only after an admin approves it, and it still passes the guard. |
| Veg products | A veg product never gets a non-veg word. |
| Sensitive products | Legit products (sanitary pads, contraceptives) stay listed with neutral tags only, no slang. |
| No examples in the repo | Never write offensive words into code, prompts, KB, seed data, tests or docs. Test examples live outside the repo. |
