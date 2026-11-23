---
description: Repo map and topic boundaries. Always apply.
alwaysApply: true
trigger: always_on
---

# Repo map

This is not an app. It is the Season 1 system design repo for a YouTube playlist. There is no root build, lint, or test command. Do not call it a personal project.

| Path | Contents |
|---|---|
| `season-1/1.compressions/` | Topic folder |
| `season-1/2.vertical-vs-horizontal-scaling/` | Topic folder |

New topic path: `season-1/<number>.<topic-name>/`.

# Working rules

- Do the work for one topic inside that topic's folder.
- Do not edit another topic's files.
- There is no root `package.json`. If a topic contains its own project, go into that folder and follow its config.
- `Codes/`, `Repos/`, `Tasks/`, `Designs/`, and `Notes/` are not in this repo. Do not assume they exist.
- Do not edit reference or copied folders unless the user explicitly asks.

Shared contracts, loaded when their paths are open:

| File | What it locks |
|---|---|
| `rules/scoped/api.md` | `GET /items` pagination |
| `rules/scoped/backend.md` | `pnpm`, one server at a time, vertical phase 1 |
| `rules/scoped/bench.md` | k6, compression, result columns |
| `rules/scoped/content-safety.md` | tag guard, safe tags only |
