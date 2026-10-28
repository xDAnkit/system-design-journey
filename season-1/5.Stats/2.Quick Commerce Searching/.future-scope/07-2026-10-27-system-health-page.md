# 07. System health page

| Field | Value |
|---|---|
| Added | 2026-10-27 |
| Status | Later |
| Effort | Medium |
| Fits in phase | 6 (analytics) |

## What

One admin page that shows the whole pipeline at a glance:

- Kafka consumer lag per group, and the DLQ size.
- Worker throughput (messages per second).
- Ollama and Typesense latency (p50, p95).
- Redis cache hit rate (query vectors, rewrites).
- Mongo status (from the existing `/ready`).

## Why

It is the system design part of the video: where the time goes and where a queue backs up.

## How

- Lag: Kafka admin API (committed offset vs latest offset per partition).
- Workers write a heartbeat and counters to Redis every few seconds.
- The search route times each stage (rewrite, embed, Typesense) and keeps rolling percentiles.
- A Prometheus `/metrics` endpoint can come later if needed.
