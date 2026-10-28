# 01. Voice search

| Field | Value |
|---|---|
| Added | 2026-10-27 |
| Status | Later |
| Effort | Low |
| Fits in phase | 5 (customer UI) |

## What

A mic button in the search bar. The shopper speaks in Hindi, Tamil or another Indian language and the words land in the normal search box.

## Why

Many shoppers find speaking easier than typing Hindi on a phone keyboard. It is the biggest "wow" for the least work.

## How

- Browser Web Speech API (`SpeechRecognition`). No backend change.
- Language from a small picker (`hi-IN`, `ta-IN`, `te-IN`, `bn-IN`, ...). Default comes from the shopper's city.
- The spoken text goes through the same search flow (rewrite, hybrid search, events).

## Watch out

- Chrome and Edge support it, Safari only partly, Firefox not at all. Hide the mic when it is not supported.
- In Chrome the audio goes to Google's speech service. Say so next to the mic.
