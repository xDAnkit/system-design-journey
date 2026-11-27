import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Archive, ArrowLeft, BarChart3, Check, CheckCircle2, Clock, Cog, Database, Eye, GitBranch,
  Inbox, Layers, Moon, Pause, Pencil, Play, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Smartphone,
  Sun, Tag, Trash2, TrendingUp, Upload, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type FlowId = "create" | "edit" | "delete" | "view" | "compare" | "anonymous" | "extend" | "rewatch" | "search";
type Theme = "light" | "dark";

type Step = {
  id: string; title: string; short: string; Icon: LucideIcon;
  what: string; db: string; cache: string; example: string; code: string;
  failure: string; recovery: string;
};

const flows: Record<Exclude<FlowId, "compare">, { kicker: string; title: string; sub: string; steps: Step[] }> = {
  create: {
    kicker: "FLOW 01 — CREATE",
    title: "Create: capture to live story",
    sub: "One story, one pipeline. Media goes to storage first, the database commits, then the cache is filled.",
    steps: [
      { id: "client", title: "Client App", short: "Capture & compress", Icon: Smartphone, what: "App captures media, compresses it, and prepares one upload request.", db: "No write yet — only a local draft.", cache: "No write yet.", example: "image · 9s · upload_id up_4821", code: "POST /stories/upload-url", failure: "Capture or compression fails on device.", recovery: "Keep local draft and retry. No server state to clean up." },
      { id: "s3", title: "S3 Upload", short: "Durable media store", Icon: Upload, what: "Media bytes go directly to object storage, outside the API and database.", db: "No row yet. A failed upload leaves nothing in Postgres.", cache: "No write yet.", example: "s3://stories-media/u_1042/st_7781.jpg · 1.8 MB", code: "PUT · image/jpeg", failure: "Upload fails — network drop or timeout.", recovery: "Retry the same PUT. Same token, no duplicate object." },
      { id: "kafka", title: "Kafka", short: "Durable event queue", Icon: Inbox, what: "Client publishes story.created. Kafka absorbs spikes and holds the event.", db: "No write yet. The event is the handoff.", cache: "No write yet.", example: "topic: story.events · key: user_1042", code: '{ "type": "story.created" }', failure: "Publish fails or broker is briefly down.", recovery: "Retry publish, then DLQ for replay. Never skip the queue." },
      { id: "worker", title: "Worker", short: "Validate & transcode", Icon: Cog, what: "Worker validates ownership, checks media, and builds resized variants.", db: "Reads metadata and prepares the INSERT.", cache: "No write before the DB commit.", example: "variants: 1080p / 720p / thumb", code: "idempotency_key: story_7781_v1", failure: "Validation fails or transcoding crashes.", recovery: "Retry with the same key. No second story is created." },
      { id: "postgres", title: "Postgres DB", short: "Source of truth", Icon: Database, what: "Worker inserts the canonical story row — ownership, expiry, visibility.", db: "INSERT first. Cache starts only after this commit.", cache: "No write until after commit.", example: "story_id: st_7781 · user_id: 1042", code: "INSERT INTO stories (...) VALUES (...);", failure: "INSERT fails — constraint or timeout.", recovery: "Retry with the same key. Cache nothing until it succeeds." },
      { id: "redis", title: "Redis Cache", short: "Fast read path", Icon: Zap, what: "Hot story metadata is cached for trays and feeds. Cache is speed, not truth.", db: "Already committed. Cache is a copy of that row.", cache: "SET story:meta after DB commit, EXAT expires_at.", example: "story:meta:7781 · EXAT expires_at", code: "SET story:meta:7781 {...} EXAT 1730000000", failure: "Redis write fails or Redis is down.", recovery: "Serve from DB and re-cache later. Readers see no error." },
      { id: "client2", title: "Client Accepted", short: "Story goes live", Icon: CheckCircle2, what: "Client gets confirmation and shows the story in the tray.", db: "Read path may check Postgres on a cache miss.", cache: "Read path may use Redis.", example: "story_id: st_7781 · state: LIVE", code: "200 OK · { story_id, expires_at }", failure: "Confirmation is lost though DB committed.", recovery: "Re-check state. If the row exists, show it live — never publish twice." },
    ],
  },
  edit: {
    kicker: "FLOW 02 — EDIT",
    title: "Edit: change without extending life",
    sub: "An edit is an event. First gate: now - created_at <= 15 min. Version protects against stale retries, old cache is removed first, expiry never moves.",
    steps: [
      { id: "edit-req", title: "Edit Request", short: "Creator changes story", Icon: Pencil, what: "Creator changes caption or crop. Original stays live while the edit is validated.", db: "No change yet. Validate first.", cache: "No change yet. Old version stays visible.", example: "story_id: st_7781 · edit: new caption", code: "PATCH /stories/st_7781", failure: "Request is invalid or story is gone.", recovery: "Return a clear error. Never apply a partial edit." },
      { id: "edit-window", title: "Check Edit Window", short: "now - created_at <= 15 min?", Icon: Clock, what: "Condition: now - created_at <= 15 min. Allowed: edit proceeds to Kafka Edit Event. Expired: Reject Edit, show Edit Window Expired — no DB change, no version bump, no cache change, Edited label NOT added, expires_at unchanged.", db: "No change yet. Read created_at to evaluate the window; no UPDATE on either outcome.", cache: "No change yet. Old version stays visible; nothing is invalidated or re-cached on rejection.", example: "created_at + 15 min · now - created_at <= 15 min", code: "now - created_at <= 15 min", failure: "If created_at is missing or clock skew is detected, reject safely and do not allow the edit.", recovery: "Show Edit Window Expired. Keep the original story live with its original expiry. Do not retry the edit after the window closes." },
      { id: "edit-kafka", title: "Kafka Edit Event", short: "Durable edit event", Icon: Send, what: "The edit becomes a durable event that can be retried and audited.", db: "No direct write from the client.", cache: "No change yet.", example: "topic: story.events · type: story.edited", code: '{ "type": "story.edited" }', failure: "Edit event fails to publish.", recovery: "Retry publish, then DLQ. Do not silently drop the edit." },
      { id: "edit-version", title: "Version Bump +1", short: "v1 → v2, no overwrite", Icon: GitBranch, what: "Version moves v1 → v2. An old retry cannot overwrite a newer edit.", db: "UPDATE story row: version + 1, updated_at = now.", cache: "Cache still holds v1 until invalidated.", example: "version: 1 → 2 · updated_at: now", code: "UPDATE stories SET version = version + 1 ...", failure: "Version conflict — a newer edit already landed.", recovery: "Reject the stale retry. Keep the newest version." },
      { id: "edit-del", title: "Cache Invalidate", short: "Remove old copy first", Icon: Trash2, what: "Old cached copy is removed before re-caching, so readers never see stale v1.", db: "DB already holds v2. DB fallback sees the correct version.", cache: "DEL story:meta:7781.", example: "DEL story:meta:7781", code: "DEL story:meta:7781", failure: "DEL fails and stale v1 stays in cache.", recovery: "Retry DEL. Short TTL limits how long stale v1 can live." },
      { id: "edit-recache", title: "Re-cache", short: "Same expires_at", Icon: RefreshCw, what: "New metadata is cached with the original expiry. Editing never extends 24h life.", db: "DB expiry is unchanged.", cache: "SET story:meta with EXAT = original expires_at.", example: "SET story:meta · EXAT = original", code: "SET story:meta:7781 {...} EXAT <original>", failure: "Re-cache fails after DEL.", recovery: "Fall back to DB. Next read re-caches v2." },
      { id: "edit-label", title: "Edited Label", short: "Viewers see Edited", Icon: Tag, what: "Viewers see a small Edited marker. Same story, same viewers, updated content.", db: "DB stores edited: true and edited_at.", cache: "Cached copy includes edited: true.", example: "edited: true · version: 2", code: "{ edited: true, version: 2 }", failure: "Edited flag missing in cache.", recovery: "Read the flag from DB on next miss and re-cache." },
    ],
  },
  delete: {
    kicker: "FLOW 03 — DELETE",
    title: "Delete: gone fast, auditable forever",
    sub: "Soft delete plus a tombstone. Viewers stop seeing it at once, the DB keeps the row for audit.",
    steps: [
      { id: "del-req", title: "Delete Request", short: "Creator confirms delete", Icon: Trash2, what: "Creator taps Delete and confirms. Story stays visible only until the pipeline confirms.", db: "No change yet. Validate first.", cache: "No change yet.", example: "story_id: st_7781 · action: delete", code: "DELETE /stories/st_7781", failure: "Request is invalid or already processed.", recovery: "Return current state. Do not apply delete twice." },
      { id: "del-kafka", title: "Kafka Delete Event", short: "Durable delete event", Icon: Send, what: "Delete becomes a durable event. If a worker is busy, the delete waits in the queue.", db: "No direct delete from the client.", cache: "No change yet.", example: "topic: story.events · type: story.deleted", code: '{ "type": "story.deleted" }', failure: "Delete event fails to publish.", recovery: "Retry publish, then DLQ. A lost delete leaves a story visible." },
      { id: "del-soft", title: "Soft Delete", short: "status = deleted", Icon: Database, what: "Postgres marks the story deleted instead of removing the row.", db: "UPDATE: deleted_at = now, status = 'deleted'. Row is kept.", cache: "Live cache still holds old copy until cleared.", example: "deleted_at: now · status: deleted", code: "UPDATE stories SET deleted_at = now ...", failure: "Soft-delete UPDATE fails.", recovery: "Retry UPDATE. Until it succeeds, story must stay visible." },
      { id: "del-tomb", title: "Tombstone", short: "Short-lived gone signal", Icon: Archive, what: "A short-lived tombstone says this story is gone, so repeat lookups skip the DB.", db: "DB is the source of the deleted state.", cache: "SET story:tombstone:7781 with short TTL.", example: "story:tombstone:7781 · TTL: short", code: "SET story:tombstone:7781 1 EX 300", failure: "Tombstone write fails.", recovery: "Fall back to DB checks. Every read checks deleted_at." },
      { id: "del-invalidate", title: "Cache Invalidate", short: "DEL live metadata", Icon: Trash2, what: "Live story:meta entry is removed at once. Cached copies must not keep it visible.", db: "DB is already marked deleted.", cache: "DEL story:meta:7781.", example: "DEL story:meta:7781", code: "DEL story:meta:7781", failure: "DEL fails and live copy remains.", recovery: "Retry DEL. Tombstone + DB check block the stale copy." },
      { id: "del-viewer", title: "Story Unavailable", short: "Clean viewer state", Icon: Eye, what: "Viewers who had it open see a clean unavailable state — no broken player, no spinner.", db: "Any DB fallback returns the deleted state.", cache: "Tombstone or missing cache leads to unavailable.", example: "viewer state: UNAVAILABLE", code: "404 / 410 · { state: 'unavailable' }", failure: "Viewer still sees deleted story from stale cache.", recovery: "Tombstone wins. Show unavailable and clear the tray entry." },
    ],
  },
  view: {
    kicker: "FLOW 04 — VIEW",
    title: "View: fast, correct, and counted",
    sub: "Viewing never waits for analytics. Tombstone first, cache, DB fallback, count in the background.",
    steps: [
      { id: "view-open", title: "Viewer Opens", short: "Tap from tray", Icon: Eye, what: "Viewer taps a tray item. Player starts instantly — no analytics work on this path.", db: "No DB read yet if cache can answer.", cache: "No read yet — tombstone is checked first.", example: "viewer: u_9021 · story: st_7781", code: "GET /stories/st_7781", failure: "Tray entry is stale or story ID is invalid.", recovery: "Show unavailable and refresh the tray." },
      { id: "view-tomb", title: "Tombstone Check", short: "Is it deleted?", Icon: Search, what: "Check the tombstone before serving anything. A deleted story must never flash on screen.", db: "If tombstone exists, skip the DB.", cache: "GET story:tombstone:7781 — if present, stop here.", example: "GET story:tombstone:7781 → nil / found", code: "GET story:tombstone:7781", failure: "Tombstone hit — story was deleted.", recovery: "Stop here. Show Unavailable. Do not read cache or DB." },
      { id: "view-cache", title: "Cache / DB", short: "Redis first, DB fallback", Icon: Layers, what: "Serve from Redis on a hit. On a miss, read Postgres, verify it is live, then re-cache.", db: "SELECT on miss, excluding deleted and expired rows.", cache: "GET story:meta → hit serves, miss goes to DB, then SET with EXAT.", example: "HIT → serve · MISS → DB → cache", code: "GET story:meta:7781", failure: "Cache miss, or DB row is deleted / expired.", recovery: "Show unavailable. Never cache a deleted or expired story." },
      { id: "view-record", title: "View Event", short: "Count without blocking", Icon: Pencil, what: "A view is recorded without blocking the player. Playback never waits for analytics.", db: "Views are not written synchronously to the story row.", cache: "Counts are cached briefly, not updated on every view.", example: "event: story.viewed · viewer: u_9021", code: '{ "type": "story.viewed" }', failure: "View event is dropped.", recovery: "Playback continues. Analytics may be slightly under-counted." },
      { id: "view-kafka", title: "Kafka", short: "Publish, don't wait", Icon: Send, what: "View event is published fire-and-forget. If analytics lags, viewing still feels instant.", db: "No DB write on the request path.", cache: "No cache block on the request path.", example: "ack: fire-and-forget · no read block", code: "publish story.events → story.viewed", failure: "Kafka publish fails.", recovery: "Do not retry on the request path. Drop or DLQ in background." },
      { id: "view-analytics", title: "Analytics", short: "Deduplicate + aggregate", Icon: BarChart3, what: "Consumers deduplicate views, filter invalid traffic, and build aggregates off the request path.", db: "Aggregates are stored away from the request path.", cache: "Aggregates cached briefly for the creator dashboard.", example: "consumer: analytics-worker", code: "consumer: analytics-worker", failure: "Consumer lags or crashes.", recovery: "Replay from Kafka offset. Aggregates catch up without touching viewers." },
      { id: "view-stats", title: "Aggregated Stats", short: "Near-real-time totals", Icon: TrendingUp, what: "Counts roll up into time buckets and are cached briefly. Creators see near-real-time totals.", db: "Aggregated tables hold totals — no raw view scan per request.", cache: "Counts cached for 60s, then refreshed.", example: "views: 12,480 · unique: 9,214", code: "{ views: 12480, unique: 9214 }", failure: "Counts cache is stale.", recovery: "Serve last cached total and refresh in background after 60s." },
    ],
  },
  anonymous: {
    kicker: "FLOW 06 — ANONYMOUS VIEW · PLUS",
    title: "Anonymous View: watch without a name",
    sub: "A Plus viewer can open a story without appearing in the viewer list. Media still plays — only the identity write is skipped.",
    steps: [
      { id: "anon-open", title: "Viewer Opens Story", short: "Tap from tray", Icon: Eye, what: "A Plus viewer taps a story. Playback starts the same way as a normal view.", db: "No viewer write yet. Identity is checked first.", cache: "Tombstone is checked first, as in a normal view.", example: "viewer: u_9021 · story: st_7781", code: "GET /stories/st_7781", failure: "Story is deleted, expired, or the tray entry is stale.", recovery: "Show unavailable and refresh the tray." },
      { id: "anon-plus", title: "Check Plus Subscription", short: "Is Plus active?", Icon: ShieldCheck, what: "The system checks whether the viewer has an active Plus subscription before hiding their identity.", db: "Read subscription status — no story row change.", cache: "Subscription status may be cached briefly.", example: "plus: active · viewer: u_9021", code: "GET /subscriptions/u_9021", failure: "Plus check fails or times out.", recovery: "Fall back to a normal view. The name will be recorded." },
      { id: "anon-flag", title: "Anonymous Flag ON", short: "anonymous = true", Icon: Tag, what: "Anonymous mode is turned on for this view only. It does not change the story or the viewer account.", db: "No viewer row is written for this view.", cache: "Anonymous flag lives only in this request context.", example: "anonymous: true · view_id: v_9912", code: "{ anonymous: true }", failure: "Flag is missing or not applied.", recovery: "Treat the view as normal and record the viewer." },
      { id: "anon-skip", title: "Skip Viewer List Write", short: "No name recorded", Icon: Database, what: "The viewer-list write is skipped. No username, profile, or timestamp is stored for this view.", db: "No INSERT into the viewers table for this view.", cache: "No viewer-list cache entry is added.", example: "viewers INSERT: skipped", code: "— no viewer write —", failure: "Viewer write still happens by mistake.", recovery: "Block the write at the service layer and audit the anonymous path." },
      { id: "anon-cdn", title: "Serve Media from CDN", short: "Same playback", Icon: Zap, what: "Media is served from the CDN, exactly like a normal view. Anonymous only hides identity — not content.", db: "No DB read is needed for playback itself.", cache: "Media and metadata come from cache / CDN.", example: "CDN: stories-media / st_7781", code: "GET cdn/stories-media/st_7781", failure: "CDN or cache is unavailable.", recovery: "Fall back to the origin / DB path and keep the view anonymous." },
      { id: "anon-hidden", title: "No Name in Viewer List", short: "Owner sees no entry", Icon: CheckCircle2, what: "The owner opens the viewer list and sees no entry for this anonymous view. Total views may still move; identity does not.", db: "Viewer list has no row for this view.", cache: "Cached viewer list also has no entry.", example: "viewer list: no u_9021", code: "{ viewers: [...] }", failure: "Anonymous viewer appears in the list.", recovery: "Remove the leaked entry, then fix the skip-write path before the next anonymous view." },
    ],
  },
  extend: {
    kicker: "FLOW 07 — STORY EXTEND · PLUS · 48H",
    title: "Story Extend: 24h becomes 48h",
    sub: "A Plus creator can extend one story once — from 24h to 48h. The DB moves expiry, the old cache is removed, and the new expiry is re-cached.",
    steps: [
      { id: "ext-tap", title: "User Taps Extend", short: "Creator extends story", Icon: Pencil, what: "The creator taps Extend on their own live story. The story stays live while the request is validated.", db: "No change yet. Validate ownership and expiry first.", cache: "No change yet. Old copy stays visible.", example: "story_id: st_7781 · action: extend", code: "POST /stories/st_7781/extend", failure: "Story is already expired, deleted, or already extended.", recovery: "Return a clear error. Do not change expiry." },
      { id: "ext-plus", title: "Check Plus Subscription", short: "Is Plus active?", Icon: ShieldCheck, what: "The system checks whether the creator has an active Plus subscription before extending.", db: "Read subscription status — no story row change.", cache: "Subscription status may be cached briefly.", example: "plus: active · owner: u_1042", code: "GET /subscriptions/u_1042", failure: "Creator is not Plus.", recovery: "Show Upgrade. expires_at stays unchanged." },
      { id: "ext-expiry", title: "Update expires_at 24h → 48h", short: "New expiry = +48h", Icon: RefreshCw, what: "Expiry moves from the original 24h deadline to 48h from the original publish time.", db: "expires_at is updated in the story row.", cache: "Old cached expiry is still present until invalidated.", example: "expires_at: +24h → +48h", code: "expires_at = created_at + 48h", failure: "Expiry update fails or is applied twice.", recovery: "Retry with the same key. Expiry must stay at 48h, never 72h." },
      { id: "ext-db", title: "DB Update is_extended=true", short: "One source of truth", Icon: Database, what: "Postgres marks the story as extended, so the new expiry is durable and auditable.", db: "UPDATE: is_extended = true, expires_at = new value.", cache: "No re-cache until after this commit.", example: "is_extended: true · expires_at: new", code: "UPDATE stories SET is_extended = true ...", failure: "DB UPDATE fails.", recovery: "Retry with the same key. Cache nothing until it succeeds." },
      { id: "ext-del", title: "Cache DEL Old", short: "Remove old copy first", Icon: Trash2, what: "The old cached copy — with the old 24h expiry — is removed before re-caching, so readers never see the old deadline.", db: "DB already holds the 48h expiry.", cache: "DEL story:meta:7781.", example: "DEL story:meta:7781", code: "DEL story:meta:7781", failure: "DEL fails and the old copy stays.", recovery: "Retry DEL. If cache is not invalidated, the old TTL remains — readers may still see 24h." },
      { id: "ext-recache", title: "Re-cache EXAT New expires_at", short: "Cache matches DB", Icon: Zap, what: "New metadata is cached with EXAT set to the new 48h expiry, so cache and DB agree.", db: "DB expiry is unchanged after this point.", cache: "SET story:meta with EXAT = new expires_at.", example: "SET story:meta · EXAT = new 48h", code: "SET story:meta:7781 {...} EXAT <new expires_at>", failure: "Re-cache fails after DEL.", recovery: "Fall back to DB. Next read re-caches with the new expiry." },
      { id: "ext-live", title: "Story Live 48h", short: "Still live, longer", Icon: CheckCircle2, what: "The story stays live for the full 48h window, with the same viewers, content, and story ID.", db: "DB is the source of the 48h state.", cache: "Cached copy carries the new expiry.", example: "story_id: st_7781 · state: LIVE · 48h", code: "200 OK · { expires_at, is_extended: true }", failure: "Viewers still see the old 24h expiry.", recovery: "Re-check DB, DEL the stale cache again, and re-cache the new expiry." },
    ],
  },
  rewatch: {
    kicker: "FLOW 08 — REWATCH COUNT",
    title: "Rewatch Count: counted, not double-counted",
    sub: "Watching again is a new event — but not a new unique viewer. Deduplication keeps the rewatch count honest.",
    steps: [
      { id: "re-open", title: "Viewer Watches Again", short: "Same viewer, same story", Icon: Eye, what: "The same viewer opens the same story again. Playback starts instantly — counting never blocks the player.", db: "No synchronous write to the story row.", cache: "Tombstone and metadata are checked as in a normal view.", example: "viewer: u_9021 · story: st_7781 · watch #2", code: "GET /stories/st_7781", failure: "Story is deleted or expired on the second watch.", recovery: "Show unavailable. Do not count a rewatch for a story that cannot play." },
      { id: "re-kafka", title: "View Event Kafka", short: "Durable view event", Icon: Send, what: "Each watch — first or repeat — becomes a durable view event that can be retried and replayed.", db: "No direct write from the client.", cache: "No cache block on the request path.", example: "topic: story.events · type: story.viewed", code: '{ "type": "story.viewed" }', failure: "View event is dropped.", recovery: "Playback continues. Analytics may be slightly under-counted." },
      { id: "re-dedup", title: "Deduplicate by viewer_id + story_id", short: "One key per viewer", Icon: GitBranch, what: "The consumer deduplicates repeat watches using viewer_id + story_id, so a rewatch is recognised as a repeat, not a new unique viewer.", db: "Dedup state is kept away from the request path.", cache: "Dedup key may be cached briefly.", example: "dedup key: u_9021:st_7781", code: "dedup_key = viewer_id + story_id", failure: "Dedup fails.", recovery: "Double count happens. Show the dedup key and replay from the Kafka offset." },
      { id: "re-inc", title: "Increment Rewatch Counter", short: "rewatch_count + 1", Icon: TrendingUp, what: "A recognised repeat watch increments the rewatch counter by one. The unique-viewer count does not move.", db: "Rewatch counter is updated in the analytics store.", cache: "Counters are cached briefly, not updated on every view.", example: "rewatch_count: 412 → 413", code: "INCR rewatch:st_7781", failure: "Counter increments twice for one rewatch.", recovery: "Re-check the dedup key and correct the counter from the event log." },
      { id: "re-analytics", title: "Background Analytics Aggregate", short: "Off the request path", Icon: BarChart3, what: "Consumers aggregate rewatches into time buckets in the background, away from viewers and creators.", db: "Aggregates are stored away from the request path.", cache: "Aggregates cached briefly for the creator dashboard.", example: "consumer: analytics-worker", code: "consumer: analytics-worker", failure: "Consumer lags or crashes.", recovery: "Replay from Kafka offset. Aggregates catch up without touching viewers." },
      { id: "re-owner", title: "Owner Sees Rewatch Count", short: "Near-real-time total", Icon: CheckCircle2, what: "The owner sees a separate rewatch total next to views — how often people came back, not just how many watched once.", db: "Aggregated tables hold rewatch totals.", cache: "Rewatch counts cached for 60s, then refreshed.", example: "views: 12,480 · rewatches: 1,214", code: "{ views: 12480, rewatches: 1214 }", failure: "Rewatch count cache is stale.", recovery: "Serve the last cached total and refresh in background after 60s." },
    ],
  },
  search: {
    kicker: "FLOW 09 — SEARCH VIEWERS",
    title: "Search Viewers: find a name in 48h",
    sub: "The viewer list lives for 48h. Inside that window, the owner can search it by username — filtered, fast, and cached.",
    steps: [
      { id: "sv-open", title: "Owner Opens Viewer List", short: "Creator checks viewers", Icon: Eye, what: "The story owner opens the viewer list. Only the owner can see it.", db: "Validate ownership before showing any viewer.", cache: "No cache write yet — check the list first.", example: "owner: u_1042 · story: st_7781", code: "GET /stories/st_7781/viewers", failure: "Requester is not the owner.", recovery: "Return a clear error. Show no viewer names." },
      { id: "sv-window", title: "Load Viewers created_at + 48h Window", short: "48h viewer window", Icon: Database, what: "Viewer entries are loaded only inside the created_at + 48h window. The list exists for support and audit, even after the story expires.", db: "SELECT viewers WHERE story_id = st_7781 AND created_at within 48h window.", cache: "Viewer list may be served from cache on a hit.", example: "window: created_at + 48h", code: "WHERE created_at >= created_at + 0 AND < + 48h", failure: "Story is older than 48h.", recovery: "Viewer list has expired. Show empty + message." },
      { id: "sv-query", title: "Search Query Filter by Username", short: "Type a username", Icon: Search, what: "The owner types a username. The list is filtered to matching usernames — no full reload, no new viewer write.", db: "Filter is applied to the loaded viewer rows.", cache: "Filtering happens on the loaded list, not on every keystroke against the DB.", example: "query: 'ana' → @ana, @ananya", code: "filter: username includes query", failure: "Query returns no match.", recovery: "Show an empty filtered result, not an error. Keep the full list available." },
      { id: "sv-cache", title: "Cache Viewer List", short: "Fast repeat search", Icon: Zap, what: "The loaded viewer list is cached briefly, so repeat searches and scrolling feel instant.", db: "DB is the source if the cache misses.", cache: "SET viewers:st_7781 with a short TTL.", example: "viewers:st_7781 · TTL: short", code: "SET viewers:st_7781 [...] EX 300", failure: "Cache write fails.", recovery: "Fall back to DB. Next search tries to cache again." },
      { id: "sv-results", title: "Show Filtered Results", short: "Only matching viewers", Icon: CheckCircle2, what: "Only the matching viewers are shown, in the same viewer-list format. Clearing the search restores the full list.", db: "No DB change from searching.", cache: "Cached list is reused until it expires.", example: "results: 2 of 184 viewers", code: "{ total: 184, shown: 2 }", failure: "Stale cache shows a viewer who has since been removed.", recovery: "Refresh from DB on the next load and re-cache." },
    ],
  },
};

const normalBoxes: Step[] = [
  { id: "n-db", title: "DB Insert", short: "Insert story row", Icon: Database, what: "Story is written once to Postgres. One row, one owner, one expiry.", db: "One INSERT. Same source of truth.", cache: "Not yet — lazy cache on first read.", example: "1 DB insert", code: "INSERT INTO stories ...", failure: "DB insert fails.", recovery: "Retry with the same key. Nothing is cached until it succeeds." },
  { id: "n-cache", title: "Lazy Cache", short: "Cache on first read", Icon: Zap, what: "Redis is filled only when someone actually opens the story.", db: "Read on first miss.", cache: "SET story:meta on first read.", example: "1 miss → DB → cache", code: "GET story:meta → MISS → SET", failure: "Cache write fails.", recovery: "Fall back to DB. Next read tries to cache again." },
  { id: "n-fanout", title: "Fanout on Write", short: "Push to 100 trays", Icon: Send, what: "Story ID is pushed into each follower's tray at publish time. With 100 followers, this is small and predictable.", db: "DB row already exists.", cache: "Tray lists are written at publish time.", example: "Fanout cost: ~100 small writes", code: "PUSH tray:{follower} story_id", failure: "Some tray pushes fail.", recovery: "Retry failed pushes. Tray rebuild from DB is the fallback." },
];
const celebBoxes: Step[] = [
  { id: "c-db", title: "DB Insert", short: "Insert story row", Icon: Database, what: "Same single Postgres insert. Scale changes the read strategy — never the source of truth.", db: "One INSERT. Same source of truth.", cache: "Not yet — write-through comes next.", example: "1 DB insert", code: "INSERT INTO stories ...", failure: "DB insert fails.", recovery: "Retry with the same key. Nothing is cached until it succeeds." },
  { id: "c-cache", title: "Write-Through", short: "Cache immediately", Icon: Zap, what: "Redis is filled right after the DB commit, because a huge audience is expected.", db: "Already committed.", cache: "SET story:meta immediately after commit.", example: "1 DB + 1 cache write", code: "SET story:meta {...} EXAT expires_at", failure: "Write-through cache fails.", recovery: "Serve from DB and re-cache. Watch DB load until cache recovers." },
  { id: "c-nofan", title: "No Fanout", short: "Skip 256M pushes", Icon: Archive, what: "Writing into 256M trays would be slow, expensive, and mostly wasted.", db: "No tray writes.", cache: "No tray fanout.", example: "Avoided cost: 256M writes", code: "— no push —", failure: "If fanout on write were used, publish would time out.", recovery: "Do not fan out. Assemble trays on read instead." },
  { id: "c-read", title: "Fanout on Read", short: "Build tray at view time", Icon: Eye, what: "Each follower's tray is assembled when they open the app, from cache or DB.", db: "DB fallback on a miss.", cache: "Celebrity stories are read from cache.", example: "Read cost: small, per viewer", code: "GET tray → assemble from cache", failure: "Cache miss on a celebrity story.", recovery: "DB fallback, then re-cache. Never fan out to 256M trays." },
];
const ttlRows = [
  { key: "story:meta", value: "EXAT expires_at", note: "Story lives exactly until expiry" },
  { key: "viewers", value: "created_at + 48h", note: "Viewer list kept for support & audit" },
  { key: "tray", value: "300s", note: "Fresh tray, low staleness" },
  { key: "feed", value: "900s", note: "Feed can tolerate longer cache" },
  { key: "counts", value: "60s", note: "View counts refresh often" },
];
const normalFlows: { id: FlowId; label: string }[] = [
  { id: "create", label: "Create Flow" }, { id: "edit", label: "Edit Flow" }, { id: "delete", label: "Delete Flow" }, { id: "view", label: "View Flow" }, { id: "compare", label: "Normal vs Celebrity" },
];
const premiumFlows: { id: FlowId; label: string }[] = [
  { id: "anonymous", label: "Anonymous View" }, { id: "extend", label: "Story Extend - 48h" }, { id: "rewatch", label: "Rewatch Count" }, { id: "search", label: "Search Viewers" },
];
const premiumFlowIds: FlowId[] = ["anonymous", "extend", "rewatch", "search"];

function Connector({ active, playing, speed }: { active: boolean; playing: boolean; speed: number }) {
  const dur = `${(1.5 / speed).toFixed(2)}s`;
  return (
    <div className={`relative shrink-0 flex items-center justify-center ${active ? "" : "opacity-60"}`} style={{ height: 34, width: "100%" } as React.CSSProperties}>
      {/* Desktop: horizontal — mobile: vertical, both in same box via responsive svg */}
      <svg className="hidden lg:block" width="48" height="24" viewBox="0 0 48 24" aria-hidden="true">
        <line x1="2" y1="12" x2="34" y2="12" stroke={active ? "#2563EB" : "#CBD5E1"} strokeWidth="2" />
        <path d="M34 5 L46 12 L34 19 Z" fill={active ? "#2563EB" : "#CBD5E1"} />
      </svg>
      <svg className="lg:hidden" width="24" height="34" viewBox="0 0 24 34" aria-hidden="true">
        <line x1="12" y1="2" x2="12" y2="22" stroke={active ? "#2563EB" : "#CBD5E1"} strokeWidth="2" />
        <path d="M5 22 L12 33 L19 22 Z" fill={active ? "#2563EB" : "#CBD5E1"} />
      </svg>
      {active && (
        <>
          <span className={`absolute hidden lg:block h-2.5 w-2.5 rounded-full bg-[#2563EB] shadow-[0_0_0_3px_rgba(37,99,235,0.18)] packet-x ${playing ? "" : "packet-paused"}`} style={{ top: "50%", ["--packet-dur" as string]: dur }} />
          <span className={`absolute lg:hidden h-2.5 w-2.5 rounded-full bg-[#2563EB] shadow-[0_0_0_3px_rgba(37,99,235,0.18)] packet-y ${playing ? "" : "packet-paused"}`} style={{ left: "50%", ["--packet-dur" as string]: dur }} />
        </>
      )}
    </div>
  );
}

function Pipeline({ steps, activeIndex, playing, speed, onSelect }: { steps: Step[]; activeIndex: number; playing: boolean; speed: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-stretch">
      {steps.map((s, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "next";
        const Icon = s.Icon;
        return (
          <React.Fragment key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(i)}
              aria-pressed={state === "active"}
              className={`step-node w-full lg:flex-1 lg:min-w-0 rounded-2xl border p-3.5 text-left ${state === "active" ? "step-active" : state === "next" ? "step-next" : ""}`}
              style={{
                minHeight: 132,
                borderWidth: state === "active" ? 2 : 1.5,
                borderColor: state === "active" ? "var(--blue)" : "var(--line)",
                background: state === "active" ? "var(--blue-soft)" : "var(--card)",
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-extrabold" style={{ background: state === "active" ? "var(--blue)" : state === "done" ? "#DCFCE7" : "var(--chip)", color: state === "active" ? "#fff" : state === "done" ? "#15803D" : "var(--muted)" }}>
                    {state === "done" ? <Check size={15} strokeWidth={3} /> : String(i + 1).padStart(2, "0")}
                  </span>
                  <Icon size={17} style={{ color: state === "active" ? "var(--blue)" : "var(--muted)" }} />
                </span>
                {state === "active" && <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-wide" style={{ background: "var(--blue)", color: "#fff" }}>NOW</span>}
                {state === "done" && <span className="text-[11px] font-bold" style={{ color: "#15803D" }}>Done</span>}
              </span>
              <span className="mt-3 block text-[15px] font-extrabold leading-5 [overflow-wrap:anywhere]">{s.title}</span>
              <span className="mt-1 block text-[13px] leading-5 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{s.short}</span>
              <span className="mt-2 block text-[11px] font-bold uppercase tracking-wider" style={{ color: state === "active" ? "var(--blue)" : "var(--muted)" }}>{state === "active" ? "In progress" : state === "done" ? "Completed" : "Up next"}</span>
            </button>
            {i < steps.length - 1 && (
              <div className="lg:w-[48px] lg:shrink-0 lg:flex lg:items-center">
                <Connector active={i === activeIndex} playing={playing} speed={speed} />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DetailPanel({ step, index, total }: { step: Step; index: number; total: number }) {
  return (
    <div className="detail-enter mt-4 rounded-2xl border p-4 sm:p-5" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[18px] font-extrabold [overflow-wrap:anywhere]">{String(index + 1).padStart(2, "0")} · {step.title}</h3>
        <span className="text-xs font-bold" style={{ color: "var(--muted)" }}>Step {index + 1} of {total}</span>
      </div>
      <ul className="mt-4 space-y-3.5">
        <li className="flex gap-3 text-[14px] leading-6"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--blue)" }} /><span className="[overflow-wrap:anywhere]"><b>What happens —</b> {step.what}</span></li>
        <li className="flex gap-3 text-[14px] leading-6"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--blue)" }} /><span className="[overflow-wrap:anywhere]"><b>DB —</b> {step.db}</span></li>
        <li className="flex gap-3 text-[14px] leading-6"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--blue)" }} /><span className="[overflow-wrap:anywhere]"><b>Cache —</b> {step.cache}</span></li>
        <li className="flex gap-3 text-[14px] leading-6"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--blue)" }} /><span className="[overflow-wrap:anywhere]"><b>Example —</b> {step.example} · <code className="rounded px-1.5 py-0.5 text-[12px]" style={{ background: "var(--chip)" }}>{step.code}</code></span></li>
        <li className="flex gap-3 rounded-xl p-3 text-[14px] leading-6" style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-line)" }}><AlertTriangle size={17} className="mt-1 shrink-0" style={{ color: "var(--danger)" }} /><span className="[overflow-wrap:anywhere]"><b style={{ color: "var(--danger)" }}>If this fails —</b> {step.failure} <b>Fix:</b> {step.recovery}</span></li>
      </ul>
    </div>
  );
}

type SavedNote = { id: string; value: { text: string; flow: string } };

const NOTES_KEY = "insta-story:explorer-notes";

// Notes are local to this browser. There is no backend in this docs project,
// so a fetch to an API would only ever fail.
function readSavedNotes(): SavedNote[] {
  try {
    const raw = window.localStorage.getItem(NOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedNote[]) : [];
  } catch {
    return [];
  }
}

function writeSavedNotes(next: SavedNote[]) {
  try {
    window.localStorage.setItem(NOTES_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: keep the notes in memory for this session only.
  }
}

export default function FeaturesExplorer({ onExit }: { onExit: () => void }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [notes, setNotes] = useState<SavedNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [notesBusy, setNotesBusy] = useState(false);
  const [notesStatus, setNotesStatus] = useState("");
  const [flow, setFlow] = useState<FlowId>("create");
  const [openGroup, setOpenGroup] = useState<"normal" | "premium" | null>("normal");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [compareLane, setCompareLane] = useState<"normal" | "celebrity">("normal");
  const [normalPlaying, setNormalPlaying] = useState(false);
  const [normalSpeed, setNormalSpeed] = useState(1);
  const [normalIndex, setNormalIndex] = useState(0);
  const [celebPlaying, setCelebPlaying] = useState(false);
  const [celebSpeed, setCelebSpeed] = useState(1);
  const [celebIndex, setCelebIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setNotes(readSavedNotes());
  }, []);

  const addNote = () => {
    const text = noteText.trim();
    if (!text || notesBusy) return;
    setNotesBusy(true);
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const next = [{ id, value: { text, flow } }, ...readSavedNotes()];
    writeSavedNotes(next);
    setNotes(next);
    setNoteText("");
    setNotesStatus("Note saved.");
    setNotesBusy(false);
  };

  const deleteNote = (id: string) => {
    setNotesBusy(true);
    const next = readSavedNotes().filter((n) => n.id !== id);
    writeSavedNotes(next);
    setNotes(next);
    setNotesStatus("Note deleted.");
    setNotesBusy(false);
  };

  const current = flow !== "compare" ? flows[flow] : null;
  const total = current ? current.steps.length : 4;
  const selectedStep = current ? current.steps[Math.min(activeIndex, current.steps.length - 1)] : null;
  const compareSteps = compareLane === "normal" ? normalBoxes : celebBoxes;
  const compareActiveIndex = compareLane === "normal" ? normalIndex : celebIndex;
  const comparePlaying = compareLane === "normal" ? normalPlaying : celebPlaying;
  const compareSpeed = compareLane === "normal" ? normalSpeed : celebSpeed;
  const compareDetail = compareSteps[Math.min(compareActiveIndex, compareSteps.length - 1)];

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setTimeout(() => {
      if (activeIndex < total - 1) setActiveIndex(activeIndex + 1);
      else setPlaying(false);
    }, 2300 / speed);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, activeIndex, speed, total]);

  useEffect(() => {
    if (flow !== "compare" || !normalPlaying) return;
    const t = setTimeout(() => {
      if (normalIndex < normalBoxes.length - 1) setNormalIndex(normalIndex + 1);
      else setNormalPlaying(false);
    }, 2300 / normalSpeed);
    return () => clearTimeout(t);
  }, [flow, normalPlaying, normalIndex, normalSpeed]);

  useEffect(() => {
    if (flow !== "compare" || !celebPlaying) return;
    const t = setTimeout(() => {
      if (celebIndex < celebBoxes.length - 1) setCelebIndex(celebIndex + 1);
      else setCelebPlaying(false);
    }, 2300 / celebSpeed);
    return () => clearTimeout(t);
  }, [flow, celebPlaying, celebIndex, celebSpeed]);

  const pickFlow = (id: FlowId) => { setFlow(id); setOpenGroup(premiumFlowIds.includes(id) ? "premium" : "normal"); setPlaying(false); setActiveIndex(0); if (id === "compare") { setNormalPlaying(false); setCelebPlaying(false); setNormalIndex(0); setCelebIndex(0); } };
  const selectStep = (i: number) => { setActiveIndex(i); setPlaying(false); };
  const playFlow = () => { if (flow === "compare") { if (compareLane === "normal") { if (normalIndex >= normalBoxes.length - 1) setNormalIndex(0); setNormalPlaying(true); } else { if (celebIndex >= celebBoxes.length - 1) setCelebIndex(0); setCelebPlaying(true); } return; } if (activeIndex >= total - 1) setActiveIndex(0); setPlaying(true); };
  const replayFlow = () => { if (flow === "compare") { if (compareLane === "normal") { setNormalIndex(0); setNormalPlaying(true); } else { setCelebIndex(0); setCelebPlaying(true); } return; } setActiveIndex(0); setPlaying(true); };
  const pauseCompare = () => { if (compareLane === "normal") setNormalPlaying(false); else setCelebPlaying(false); };
  const setCompareSpeed = (s: number) => { if (compareLane === "normal") setNormalSpeed(s); else setCelebSpeed(s); };
  const selectCompareStep = (i: number) => { if (compareLane === "normal") { setNormalIndex(i); setNormalPlaying(false); } else { setCelebIndex(i); setCelebPlaying(false); } };
  const pickCompareLane = (lane: "normal" | "celebrity") => { setCompareLane(lane); setNormalPlaying(false); setCelebPlaying(false); };

  return (
    <div data-theme={theme} data-safe-area-inset-root style={{ boxSizing: "border-box", paddingTop: "var(--safe-area-inset-top)" }} className="features-root min-h-screen overflow-x-clip">
      <div className="min-h-screen" style={{ background: "var(--surface)", color: "var(--ink)" }}>
        <header data-safe-area-sticky-top style={{ top: "var(--safe-area-inset-top)", background: "#0F172A" }} className="sticky z-30">
          <div className="mx-auto max-w-[1200px] px-2 sm:px-5">
            <div className="flex h-[60px] items-center gap-2">
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-black text-white" style={{ background: "#2563EB" }}>◉</span>
                <div className="leading-none"><div className="text-[13px] font-extrabold tracking-tight text-white whitespace-nowrap sm:text-[14px]">Instagram Stories</div><div className="mt-0.5 hidden text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 sm:block">System Design</div></div>
              </div>
              <nav className="flex flex-1 items-center justify-center gap-1.5 sm:gap-2" aria-label="Choose a flow group">
                <button type="button" onClick={() => setOpenGroup(openGroup === "normal" ? null : "normal")} aria-pressed={openGroup === "normal"} aria-expanded={openGroup === "normal"} className="shrink-0 rounded-full px-2.5 py-1.5 text-[12px] font-bold whitespace-nowrap sm:px-3 sm:text-[13px]" style={openGroup === "normal" ? { background: "#fff", color: "#0F172A" } : { background: "rgba(255,255,255,0.10)", color: "#E2E8F0" }}>Normal</button>
                <button type="button" onClick={() => setOpenGroup(openGroup === "premium" ? null : "premium")} aria-pressed={openGroup === "premium"} aria-expanded={openGroup === "premium"} className="shrink-0 rounded-full px-2.5 py-1.5 text-[12px] font-bold whitespace-nowrap sm:px-3 sm:text-[13px]" style={openGroup === "premium" ? { background: "#fff", color: "#0F172A" } : { background: "rgba(255,255,255,0.10)", color: "#E2E8F0" }}>Premium - Meta One</button>
              </nav>
              <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-bold text-white sm:px-2.5" style={{ background: "rgba(255,255,255,0.12)" }} aria-label="Toggle theme">{theme === "light" ? <Moon size={14} /> : <Sun size={14} />}<span className="hidden sm:inline">{theme === "light" ? "Dark" : "Light"}</span></button>
              <button type="button" onClick={onExit} className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-bold text-white sm:px-2.5" style={{ background: "rgba(255,255,255,0.12)" }} aria-label="Back to all docs"><ArrowLeft size={14} /><span className="hidden sm:inline">All docs</span></button>
            </div>
            {openGroup && (
              <div className="border-t" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                <nav className="flex flex-wrap items-center justify-center gap-1.5 py-2.5 sm:justify-start" aria-label={openGroup === "normal" ? "Normal flows" : "Premium flows"}>
                  {(openGroup === "normal" ? normalFlows : premiumFlows).map((t) => {
                    const active = flow === t.id;
                    return <button key={t.id} type="button" onClick={() => pickFlow(t.id)} aria-pressed={active} className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold whitespace-nowrap sm:text-[13px]" style={active ? { background: "#fff", color: "#0F172A" } : { background: "transparent", color: "#CBD5E1" }}>{t.label}</button>;
                  })}
                </nav>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
            <span><b style={{ color: "var(--ink)" }}>Postgres is truth.</b> One canonical row.</span>
            <span className="hidden sm:inline opacity-40">·</span>
            <span><b style={{ color: "var(--ink)" }}>Redis is speed.</b> Cache after the DB commit.</span>
            <span className="hidden sm:inline opacity-40">·</span>
            <span><b style={{ color: "var(--ink)" }}>Fanout follows scale.</b> Small: push. Huge: assemble on read.</span>
          </div>

          {current && selectedStep && (
            <section className="mt-5">
              <div className="mb-3"><div className="text-[11px] font-extrabold tracking-[0.18em] uppercase" style={{ color: "var(--blue)" }}>{current.kicker}</div><h1 className="mt-1 text-[clamp(22px,3vw,30px)] leading-tight font-extrabold tracking-tight">{current.title}</h1><p className="mt-1 max-w-3xl text-sm leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{current.sub}</p></div>

              <div className="rounded-2xl border p-3 sm:p-4" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  {!playing ? (
                    <button onClick={playFlow} className="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-extrabold text-white" style={{ background: "#2563EB" }}><Play size={15} fill="currentColor" /> Play Flow</button>
                  ) : (
                    <button onClick={() => setPlaying(false)} className="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-extrabold text-white" style={{ background: "#2563EB" }}><Pause size={15} fill="currentColor" /> Pause</button>
                  )}
                  <button onClick={replayFlow} className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-bold" style={{ borderColor: "var(--line)", background: "var(--card)" }}><RotateCcw size={14} /> Replay</button>
                  <div className="flex rounded-full p-0.5" style={{ background: "var(--chip)" }} aria-label="Playback speed">
                    {[0.5, 1, 2].map((s) => <button key={s} onClick={() => setSpeed(s)} aria-pressed={speed === s} className="rounded-full px-3 py-1.5 text-[13px] font-bold" style={speed === s ? { background: "var(--card)", boxShadow: "0 1px 4px rgba(0,0,0,.12)" } : { color: "var(--muted)" }}>{s}x</button>)}
                  </div>
                  <div className="min-w-[140px] flex-1">
                    <div className="flex items-center justify-between text-xs font-bold" style={{ color: "var(--muted)" }}><span>Progress</span><span style={{ color: "var(--ink)" }}>{activeIndex + 1} / {total}</span></div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--chip)" }}><div className="progress-fill h-full rounded-full transition-all duration-500" style={{ width: `${((activeIndex + 1) / total) * 100}%` }} /></div>
                  </div>
                </div>
                <p className="mt-3 text-[13px]" style={{ color: "var(--muted)" }}>Tap any box to pause and read its detail. The dot travels along the arrow — from one box to the next.</p>
                <div className="mt-3">
                  <Pipeline steps={current.steps} activeIndex={activeIndex} playing={playing} speed={speed} onSelect={selectStep} />
                </div>
              </div>
              <DetailPanel step={selectedStep} index={activeIndex} total={total} />
            </section>
          )}

          {flow === "compare" && (
            <section className="mt-5">
              <div className="mb-3"><div className="text-[11px] font-extrabold tracking-[0.18em] uppercase" style={{ color: "var(--blue)" }}>FLOW 05 — NORMAL VS CELEBRITY</div><h1 className="text-[clamp(22px,3vw,30px)] leading-tight font-extrabold">Same write. Different scale.</h1><p className="mt-1 max-w-3xl text-sm leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>Both start with the same DB insert. Pick one lane at a time. Tap any box to pause and compare cost, order, and failure.</p></div>
              <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Compare lanes">
                <button type="button" role="tab" aria-selected={compareLane === "normal"} onClick={() => pickCompareLane("normal")} className="rounded-full px-4 py-2 text-[13px] font-extrabold" style={compareLane === "normal" ? { background: "var(--blue)", color: "#fff" } : { background: "var(--chip)", color: "var(--muted)" }}>Normal</button>
                <button type="button" role="tab" aria-selected={compareLane === "celebrity"} onClick={() => pickCompareLane("celebrity")} className="rounded-full px-4 py-2 text-[13px] font-extrabold" style={compareLane === "celebrity" ? { background: "var(--blue)", color: "#fff" } : { background: "var(--chip)", color: "var(--muted)" }}>Celebrity — Virat Kohli</button>
              </div>
              <div className="mt-3 rounded-2xl border p-3 sm:p-4" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  {!comparePlaying ? <button onClick={playFlow} className="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-extrabold text-white" style={{ background: "#2563EB" }}><Play size={15} fill="currentColor" /> Play Flow</button> : <button onClick={pauseCompare} className="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-extrabold text-white" style={{ background: "#2563EB" }}><Pause size={15} fill="currentColor" /> Pause</button>}
                  <button onClick={replayFlow} className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-bold" style={{ borderColor: "var(--line)", background: "var(--card)" }}><RotateCcw size={14} /> Replay</button>
                  <div className="flex rounded-full p-0.5" style={{ background: "var(--chip)" }} aria-label="Playback speed">{[0.5, 1, 2].map((s) => <button key={s} onClick={() => setCompareSpeed(s)} aria-pressed={compareSpeed === s} className="rounded-full px-3 py-1.5 text-[13px] font-bold" style={compareSpeed === s ? { background: "var(--card)", boxShadow: "0 1px 4px rgba(0,0,0,.12)" } : { color: "var(--muted)" }}>{s}x</button>)}</div>
                  <div className="min-w-[140px] flex-1"><div className="flex items-center justify-between text-xs font-bold" style={{ color: "var(--muted)" }}><span>Progress</span><span style={{ color: "var(--ink)" }}>{compareActiveIndex + 1} / {compareSteps.length}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--chip)" }}><div className="progress-fill h-full rounded-full transition-all duration-500" style={{ width: `${((compareActiveIndex + 1) / compareSteps.length) * 100}%` }} /></div></div>
                </div>
                <p className="mt-3 text-[13px]" style={{ color: "var(--muted)" }}>Tap any box to pause and read its detail. The dot travels along the arrow — from one box to the next.</p>
                <div className="mt-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2"><h3 className="text-[15px] font-extrabold">{compareLane === "normal" ? "Normal User" : "Celebrity — Virat Kohli"}</h3><span className="text-xs font-bold" style={{ color: "var(--muted)" }}>{compareLane === "normal" ? "100 followers · Push is cheap" : "256M followers · Read-time assembly"}</span></div>
                  <Pipeline steps={compareSteps} activeIndex={compareActiveIndex} playing={comparePlaying} speed={compareSpeed} onSelect={selectCompareStep} />
                </div>
              </div>
              <DetailPanel step={compareDetail} index={compareActiveIndex} total={compareSteps.length} />
              <p className="mt-3 flex items-start gap-2 text-sm leading-6" style={{ color: "var(--muted)" }}><ShieldCheck size={17} className="mt-1 shrink-0" style={{ color: "var(--blue)" }} /><span>Celebrity scale never changes the source of truth. It only changes whether the system pays the cost at publish time or at view time.</span></p>
            </section>
          )}

          <section className="mt-6">
            <div className="overflow-hidden rounded-2xl border" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
              <div className="grid lg:grid-cols-[1fr_1.4fr]">
                <div className="p-5"><div className="text-xs font-extrabold tracking-widest uppercase" style={{ color: "var(--blue)" }}>Key idea</div><h2 className="mt-2 text-[clamp(20px,2.5vw,26px)] leading-tight font-extrabold">Postgres decides.<br />Redis accelerates.<br /><span style={{ color: "var(--blue)" }}>Fanout follows scale.</span></h2><p className="mt-3 text-sm leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>Write once to the database. Cache only after that commit. Choose fanout on write for small audiences and fanout on read for massive audiences.</p></div>
                <div className="p-5" style={{ background: "var(--card-2)" }}>
                  <h3 className="font-extrabold">Redis TTL table</h3>
                  <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead><tr className="border-b text-xs tracking-wider" style={{ borderColor: "var(--line)", color: "var(--muted)" }}><th className="py-2 pr-3">KEY</th><th className="py-2 pr-3">TTL / EXPIRY</th><th className="py-2">WHY</th></tr></thead><tbody>{ttlRows.map((r) => <tr key={r.key} className="border-b align-top" style={{ borderColor: "var(--line)" }}><td className="py-2.5 pr-3 font-mono text-[13px] font-bold [overflow-wrap:anywhere]" style={{ color: "var(--blue)" }}>{r.key}</td><td className="py-2.5 pr-3 font-bold [overflow-wrap:anywhere]">{r.value}</td><td className="py-2.5 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{r.note}</td></tr>)}</tbody></table></div>
                  <p className="mt-3 text-xs leading-5" style={{ color: "var(--muted)" }}>Example: <code className="mono" style={{ color: "var(--ink)" }}>SET story:meta:7781 {"{...}"} EXAT expires_at</code> — cache disappears exactly when the story expires.</p>
                </div>
              </div>
            </div>
          <section className="mt-6 rounded-2xl border p-4 sm:p-5" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
            <h2 className="text-[18px] font-extrabold">Saved explorer notes</h2>
            <p className="mt-1 text-sm leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>Save a short note about the flow you are viewing. Notes are stored and shown again on reload.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="explorer-note">Explorer note</label>
              <input id="explorer-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} placeholder="Write a note about this flow…" className="min-w-0 flex-1 rounded-full border px-4 py-2.5 text-sm [overflow-wrap:anywhere]" style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--ink)" }} />
              <button type="button" onClick={addNote} disabled={notesBusy || !noteText.trim()} className="shrink-0 rounded-full px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50" style={{ background: "#2563EB" }}>{notesBusy ? "Saving…" : "Add note"}</button>
            </div>
            {notesStatus && <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{notesStatus}</p>}
            {notes.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
                    <span className="min-w-0 text-sm leading-6 [overflow-wrap:anywhere]"><b>{n.value?.flow || "Flow"}:</b> {n.value?.text || ""}</span>
                    <button type="button" onClick={() => deleteNote(n.id)} disabled={notesBusy} className="shrink-0 rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-50" style={{ borderColor: "var(--line)" }}>Delete</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>No saved notes yet.</p>
            )}
          </section>
            <p className="mt-4 text-center text-xs" style={{ color: "var(--muted)" }}>Reference explorer · Tap a box to explain it. Play the flow to show it in order.</p>
          </section>
        </main>
      </div>
    </div>
  );
}
