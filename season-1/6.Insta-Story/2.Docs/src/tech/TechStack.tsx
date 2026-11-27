import React, { useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, Binary, Boxes, Braces, Check, ChevronRight, Cloud, Code2,
  Cpu, Database, FileJson, Filter, Gauge, Globe, Inbox, Moon, Network, Palette, Pause, Play, RotateCcw, Server,
  ShieldCheck, Sun, Waypoints, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Theme = "light" | "dark";

type Tone = "sky" | "violet" | "blue" | "indigo" | "amber" | "teal" | "pink" | "green";

type Accent = { text: string; soft: string; line: string };

// Every colour is a CSS token defined in tech.css, once for light and once for dark.
const ACCENTS: Record<Tone, Accent> = {
  sky: { text: "var(--acc-sky)", soft: "var(--acc-sky-soft)", line: "var(--acc-sky-line)" },
  violet: { text: "var(--acc-violet)", soft: "var(--acc-violet-soft)", line: "var(--acc-violet-line)" },
  blue: { text: "var(--acc-blue)", soft: "var(--acc-blue-soft)", line: "var(--acc-blue-line)" },
  indigo: { text: "var(--acc-indigo)", soft: "var(--acc-indigo-soft)", line: "var(--acc-indigo-line)" },
  amber: { text: "var(--acc-amber)", soft: "var(--acc-amber-soft)", line: "var(--acc-amber-line)" },
  teal: { text: "var(--acc-teal)", soft: "var(--acc-teal-soft)", line: "var(--acc-teal-line)" },
  pink: { text: "var(--acc-pink)", soft: "var(--acc-pink-soft)", line: "var(--acc-pink-line)" },
  green: { text: "var(--acc-green)", soft: "var(--acc-green-soft)", line: "var(--acc-green-line)" },
};

type Tech = { name: string; role: string };

type Layer = {
  id: string;
  label: string;
  tagline: string;
  tone: Tone;
  handoff: string;
  Icon: LucideIcon;
  techs: Tech[];
  what: string;
  why: string;
  breaks: string;
  scale: string;
};

const layers: Layer[] = [
  {
    id: "client",
    label: "Client",
    tagline: "Where the story is captured and played",
    tone: "sky",
    handoff: "HTTPS",
    Icon: Code2,
    techs: [
      { name: "JavaScript", role: "app logic" },
      { name: "CSS", role: "layout and theme" },
      { name: "REST over HTTPS", role: "one contract" },
    ],
    what: "The app draws the tray, plays the story, and sends one request per action.",
    why: "Plain JavaScript and CSS keep the payload small and the build simple. No framework tax on a screen that only lists and plays media.",
    breaks: "Rendering before data arrives shows empty trays and invites double taps.",
    scale: "The client stays thin. Every heavy job is pushed to a worker, so a slow phone never holds a server thread.",
  },
  {
    id: "edge",
    label: "Reverse Proxy",
    tagline: "One public door, plus an edge for media",
    tone: "violet",
    handoff: "forward",
    Icon: Globe,
    techs: [
      { name: "Nginx", role: "TLS, rate limit, buffering" },
      { name: "CDN", role: "media and static files" },
    ],
    what: "Nginx terminates TLS, applies rate limits, and forwards API calls. The CDN serves every media byte from the nearest edge node.",
    why: "Only JSON should cross the API. Images and video come from the edge, so one popular story never becomes API traffic.",
    breaks: "Without the edge, every replay pulls bytes from origin and the API pool pays for media it does not cache.",
    scale: "Edge nodes absorb read spikes. Origin sees one pull per cache miss per region, not one request per viewer.",
  },
  {
    id: "api",
    label: "API",
    tagline: "Every request lands here first",
    tone: "blue",
    handoff: "publish",
    Icon: Server,
    techs: [
      { name: "Node.js", role: "runtime" },
      { name: "Fastify", role: "HTTP framework" },
      { name: "REST", role: "API style" },
      { name: "Swagger", role: "living docs" },
    ],
    what: "Fastify turns one HTTP request into one validated action: read a story, write a change, or publish an event.",
    why: "Node.js keeps one language across API and workers. Fastify is fast and gives schema validation and serialization per route.",
    breaks: "One slow handler blocks the event loop, so every other request on that instance waits behind it.",
    scale: "Handlers stay stateless: session data lives in Redis, not in process memory. Any instance can serve any request.",
  },
  {
    id: "queue",
    label: "Event Queue",
    tagline: "Spikes land here, not in the database",
    tone: "amber",
    handoff: "consume",
    Icon: Inbox,
    techs: [
      { name: "Kafka", role: "durable event log" },
      { name: "Topics", role: "story.created, edited, deleted, viewed" },
    ],
    what: "Every story action becomes an event on a Kafka topic. The API publishes and returns, workers consume when they can.",
    why: "A replayable log turns a sudden burst into a steady line of work. Nothing is lost if a worker is busy or down.",
    breaks: "If the API wrote to storage directly, a traffic spike would become a database spike and a timeout.",
    scale: "Partition by user_id so one user's events stay in order. Throughput grows with partitions, not with machine size.",
  },
  {
    id: "worker",
    label: "Workers",
    tagline: "Slow work off the request path",
    tone: "teal",
    handoff: "read / write",
    Icon: Activity,
    techs: [
      { name: "Node.js", role: "consumer process" },
      { name: "Consumer groups", role: "parallel drain" },
      { name: "Idempotency keys", role: "safe retries" },
    ],
    what: "Consumers validate events, build media variants, write storage, refresh cache, and roll up view counts.",
    why: "Anything that takes more than a few milliseconds leaves the request path. The user's tap never waits for a transcode.",
    breaks: "A worker that is not idempotent writes twice when Kafka redelivers the same event.",
    scale: "Workers scale by count: more consumer instances on the same log, same code, no data migration.",
  },
  {
    id: "memory",
    label: "Memory Layer",
    tagline: "Answers that must not touch the database",
    tone: "pink",
    handoff: "fallback",
    Icon: Zap,
    techs: [
      { name: "Redis", role: "cache and counters" },
      { name: "HyperLogLog", role: "unique viewers" },
      { name: "Binary Fuse Filter", role: "seen before?" },
    ],
    what: "Redis holds hot story metadata with an expiry. HyperLogLog counts unique viewers in kilobytes. The fuse filter answers membership in one hash lookup.",
    why: "Each one replaces a database round trip with a memory read. Counting stops being a write-per-view problem.",
    breaks: "Cache without expiry serves deleted stories. A counter without a reset window grows forever.",
    scale: "Millions of uniques fit in a few KB per story, so counting stops being a storage problem. Membership checks never reach storage.",
  },
  {
    id: "storage",
    label: "Storage",
    tagline: "The only place that is true",
    tone: "green",
    handoff: "stored",
    Icon: Database,
    techs: [
      { name: "MongoDB", role: "source of truth" },
      { name: "ScyllaDB", role: "planned for hot events" },
      { name: "Object store", role: "media bytes" },
    ],
    what: "MongoDB keeps the canonical story document. Media bytes live in object storage, not in the row.",
    why: "One document per story matches the read pattern: story, owner, expiry, and view policy arrive in a single fetch.",
    breaks: "If media bytes sat in the database, every document would be megabytes and backups would crawl.",
    scale: "Shard by user_id when one cluster is not enough, or move only the hot event and counter tables to ScyllaDB.",
  },
];

const groups: { label: string; tone: Tone }[] = [
  { label: "Interface", tone: "sky" },
  { label: "Traffic", tone: "violet" },
  { label: "Runtime", tone: "blue" },
  { label: "Contract", tone: "indigo" },
  { label: "Throughput", tone: "amber" },
  { label: "Speed", tone: "pink" },
  { label: "Truth", tone: "green" },
];

const groupLabel = (tone: Tone) => groups.find((g) => g.tone === tone)?.label ?? "Other";

type Tile = { name: string; job: string; tone: Tone; Icon: LucideIcon; later?: boolean };

const tiles: Tile[] = [
  { name: "CSS", job: "Draws the tray, player, and theme", tone: "sky", Icon: Palette },
  { name: "JavaScript", job: "Runs the app logic in the browser", tone: "sky", Icon: Code2 },
  { name: "Nginx", job: "One public door: TLS, rate limit, buffering", tone: "violet", Icon: Globe },
  { name: "Node.js", job: "One runtime for the API and the workers", tone: "blue", Icon: Server },
  { name: "Fastify", job: "Turns a request into one validated action", tone: "blue", Icon: Cpu },
  { name: "REST", job: "The contract every client speaks", tone: "indigo", Icon: Braces },
  { name: "Swagger", job: "One spec that becomes docs and schemas", tone: "indigo", Icon: FileJson },
  { name: "Kafka", job: "Absorbs spikes in a replayable log", tone: "amber", Icon: Inbox },
  { name: "Node Workers", job: "Slow jobs run off the request path", tone: "amber", Icon: Activity },
  { name: "Redis", job: "Hot metadata in RAM with a hard expiry", tone: "pink", Icon: Zap },
  { name: "HyperLogLog", job: "Unique viewers in a few KB per story", tone: "pink", Icon: Binary },
  { name: "Binary Fuse Filter", job: "Seen-before check with no storage call", tone: "pink", Icon: Filter },
  { name: "MongoDB", job: "The one canonical story document", tone: "green", Icon: Database },
  { name: "Object Storage", job: "Media bytes, never inside the row", tone: "green", Icon: Cloud },
  { name: "ScyllaDB", job: "Hot events when MongoDB saturates", tone: "green", Icon: Boxes, later: true },
  { name: "CDN", job: "Media and static files from the nearest edge", tone: "violet", Icon: Network },
];

type FlowNode = { name: string; tech: string; note: string };

const readFlow: FlowNode[] = [
  { name: "Tap story", tech: "JavaScript", note: "One request: GET /stories/:id. No analytics work on this path." },
  { name: "Proxy", tech: "Nginx", note: "TLS ends here, rate limit applied, request forwarded to a healthy API instance." },
  { name: "Validate", tech: "Fastify", note: "Auth, ownership, and visibility checked in memory. No storage call yet." },
  { name: "Tombstone", tech: "Redis", note: "A deleted story must never flash on screen, so the tombstone is checked first." },
  { name: "Serve meta", tech: "Redis", note: "Hit: metadata returns from RAM with expiry set to the story deadline." },
  { name: "Media", tech: "CDN", note: "Poster and video come from the edge cache. Origin is pulled once per region, then shared." },
  { name: "Count unique", tech: "HyperLogLog", note: "PFADD viewer_id. Additive, idempotent, a few KB per story." },
  { name: "Emit view", tech: "Kafka", note: "story.viewed is published fire and forget. The player never waits." },
  { name: "On miss", tech: "MongoDB", note: "Cache miss only. Read the document, confirm it is live, then re-cache." },
];

const writeFlow: FlowNode[] = [
  { name: "Upload", tech: "JavaScript", note: "Media is compressed on device and sent straight to object storage with a short-lived token." },
  { name: "Proxy", tech: "Nginx", note: "Large uploads are buffered here so a slow network never ties up a Node.js instance." },
  { name: "Accept", tech: "Fastify", note: "Schema validation runs, then one event is published. The API writes nothing to storage." },
  { name: "Queue", tech: "Kafka", note: "story.created sits in the log with the user_id as key, so order is kept per user." },
  { name: "Consume", tech: "Node.js worker", note: "Worker validates, builds resized variants, and prepares one document write." },
  { name: "Store media", tech: "Object storage", note: "Variants are written once, keyed by story id and version." },
  { name: "Commit", tech: "MongoDB", note: "The canonical document is written here. Cache stays empty until this succeeds." },
  { name: "Warm cache", tech: "Redis", note: "Metadata is cached with EXAT set to the story expiry, so it dies exactly on time." },
];

const scaleCards: { q: string; a: string; how: string; Icon: LucideIcon }[] = [
  { q: "Read traffic grows", a: "Redis", how: "Hot metadata is served from memory. MongoDB sees misses only.", Icon: Zap },
  { q: "Write traffic spikes", a: "Kafka", how: "The burst lands in a log and drains at a steady rate the workers can hold.", Icon: Inbox },
  { q: "Counting millions of viewers", a: "HyperLogLog", how: "Unique counts live in a few KB per story instead of one row per view.", Icon: Binary },
  { q: "Has this viewer opened it?", a: "Binary Fuse Filter", how: "A membership test in RAM, with no storage round trip on the hot path.", Icon: Filter },
  { q: "Media traffic grows", a: "CDN", how: "One pull per region, then every viewer is served from the edge.", Icon: Network },
  { q: "One machine is not enough", a: "Nginx", how: "Many stateless API instances sit behind one proxy and one contract.", Icon: Globe },
  { q: "Every client must agree", a: "REST + Swagger", how: "One spec drives docs, request schemas, and client types.", Icon: Braces },
];

const mongoRows = ["Starts as the source of truth", "Document per story", "Shard by user_id later"];
const scyllaRows = ["Planned for hot event tables", "Partition per user", "Throughput with partition count"];

const cdnRows = [
  ["What is cached", "Story media (720p, thumb), static JS and CSS"],
  ["Cache key", "story id + variant"],
  ["TTL", "Set to the story expiry, never longer"],
  ["On delete", "Purge the key. The tombstone still blocks reads"],
  ["On edit", "New version key, so old bytes stay harmless"],
  ["On a miss", "One origin pull per region, then shared"],
];

type Section = { id: string; label: string };
const sections: Section[] = [
  { id: "layers", label: "Layers" },
  { id: "techgrid", label: "Tech jobs" },
  { id: "flows", label: "Flows" },
  { id: "cdn", label: "CDN" },
  { id: "scale", label: "Scale" },
  { id: "data", label: "Mongo vs Scylla" },
];

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Flow({ kicker, title, sub, nodes }: { kicker: string; title: string; sub: string; nodes: FlowNode[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (index < nodes.length - 1) setIndex(index + 1);
      else setPlaying(false);
    }, 1300 / speed);
    return () => clearTimeout(t);
  }, [playing, index, nodes.length, speed]);

  const active = nodes[index];

  return (
    <div className="rounded-2xl border p-4 sm:p-5" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.18em]" style={{ color: "var(--blue)" }}>{kicker}</div>
          <h3 className="mt-1 text-[17px] font-extrabold leading-tight">{title}</h3>
          <p className="mt-1 text-[13px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{sub}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => { if (index >= nodes.length - 1) setIndex(0); setPlaying(!playing); }}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold text-white"
            style={{ background: "#2563EB" }}
          >
            {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => { setIndex(0); setPlaying(true); }}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold"
            style={{ borderColor: "var(--line)" }}
          >
            <RotateCcw size={12} /> Replay
          </button>
          <div className="flex rounded-full p-0.5" style={{ background: "var(--chip)" }} role="group" aria-label="Playback speed">
            {[0.5, 1, 2].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                className="rounded-full px-2 py-1 text-[11.5px] font-bold"
                style={
                  speed === s
                    ? { background: "var(--card)", color: "var(--ink)", boxShadow: "0 1px 4px rgba(0,0,0,0.12)" }
                    : { color: "var(--muted)" }
                }
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="no-scrollbar mt-4 overflow-x-auto pb-1">
        <div className="flex min-w-max items-stretch gap-1.5">
          {nodes.map((n, i) => {
            const state = i < index ? "done" : i === index ? "active" : "next";
            return (
              <React.Fragment key={n.name}>
                <button
                  type="button"
                  onClick={() => { setIndex(i); setPlaying(false); }}
                  className="step-node w-[124px] shrink-0 rounded-xl border px-2.5 py-2 text-left"
                  style={{
                    borderWidth: state === "active" ? 2 : 1.5,
                    borderColor: state === "active" ? "var(--blue)" : "var(--line)",
                    background: state === "active" ? "var(--blue-soft)" : "var(--card)",
                    opacity: state === "next" ? 0.55 : 1,
                  }}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-extrabold" style={{ color: state === "active" ? "var(--blue)" : "var(--muted)" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {state === "done" && <Check size={12} strokeWidth={3} style={{ color: "var(--success)" }} />}
                  </span>
                  <span className="mt-1 block text-[13px] font-extrabold leading-4 [overflow-wrap:anywhere]">{n.name}</span>
                  <span className="mt-0.5 block text-[11px] font-semibold leading-4 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{n.tech}</span>
                </button>
                {i < nodes.length - 1 && (
                  <span className="flex w-4 shrink-0 items-center justify-center" aria-hidden="true">
                    <ArrowRight size={14} style={{ color: i < index ? "var(--blue)" : "var(--line)" }} />
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--card-2)" }}>
        <div className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: "var(--blue)" }}>
          Step {index + 1} of {nodes.length} · {active.name}
        </div>
        <p className="mt-1 text-[13.5px] leading-6 [overflow-wrap:anywhere]">{active.note}</p>
      </div>
    </div>
  );
}

export default function TechStack({ onExit }: { onExit: () => void }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [activeLayer, setActiveLayer] = useState<string>("api");
  const [tour, setTour] = useState(false);
  const [dir, setDir] = useState<"down" | "up">("down");
  const [filter, setFilter] = useState<Tone | "all">("all");
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const layer = layers.find((l) => l.id === activeLayer) ?? layers[0];
  const LayerIcon = layer.Icon;
  const layerIndex = layers.findIndex((l) => l.id === activeLayer);

  // Guided walk: one layer every 2s, then it stops on its own.
  useEffect(() => {
    if (!tour) return;
    const t = setTimeout(() => {
      if (layerIndex < layers.length - 1) setActiveLayer(layers[layerIndex + 1].id);
      else setTour(false);
    }, 2000);
    return () => clearTimeout(t);
  }, [tour, layerIndex]);

  const startTour = () => {
    if (layerIndex >= layers.length - 1) setActiveLayer(layers[0].id);
    setTour(!tour);
  };

  const replayTour = () => {
    setActiveLayer(layers[0].id);
    setTour(true);
  };

  // Pointer spotlight: written straight to the element, so no re-render per move.
  const moveSpotlight = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = canvasRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - box.left}px`);
    el.style.setProperty("--my", `${e.clientY - box.top}px`);
  };

  return (
    <div
      data-theme={theme}
      data-safe-area-inset-root
      style={{ boxSizing: "border-box", paddingTop: "var(--safe-area-inset-top)" }}
      className="features-root min-h-screen overflow-x-clip"
    >
      <div className="min-h-screen" style={{ background: "var(--surface)", color: "var(--ink)" }}>
        <header data-safe-area-sticky-top style={{ top: "var(--safe-area-inset-top)", background: "#0F172A" }} className="sticky z-30">
          <div className="mx-auto max-w-[1200px] px-2 sm:px-5">
            <div className="flex h-[60px] items-center gap-2">
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-black text-white" style={{ background: "#2563EB" }}>◉</span>
                <div className="leading-none">
                  <div className="whitespace-nowrap text-[13px] font-extrabold tracking-tight text-white sm:text-[14px]">Instagram Stories</div>
                  <div className="mt-0.5 hidden text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 sm:block">Phase 3 Technologies</div>
                </div>
              </div>
              <nav className="no-scrollbar flex flex-1 items-center justify-center gap-1 overflow-x-auto" aria-label="Jump to section">
                {sections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => scrollToId(s.id)}
                    className="shrink-0 rounded-full px-2.5 py-1.5 text-[12px] font-bold whitespace-nowrap sm:text-[13px]"
                    style={{ background: "rgba(255,255,255,0.10)", color: "#E2E8F0" }}
                  >
                    {s.label}
                  </button>
                ))}
              </nav>
              <button
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-bold text-white sm:px-2.5"
                style={{ background: "rgba(255,255,255,0.12)" }}
                aria-label="Toggle theme"
              >
                {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
                <span className="hidden sm:inline">{theme === "light" ? "Dark" : "Light"}</span>
              </button>
              <button
                type="button"
                onClick={onExit}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-bold text-white sm:px-2.5"
                style={{ background: "rgba(255,255,255,0.12)" }}
                aria-label="Back to all docs"
              >
                <ArrowLeft size={14} />
                <span className="hidden sm:inline">All docs</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
          <section>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.2em]" style={{ color: "var(--blue)" }}>PHASE 3 · STACK MAP</div>
            <h1 className="mt-2 text-[clamp(26px,4vw,40px)] font-black leading-tight tracking-tight">
              Seven layers. One job each.
            </h1>
            <p className="mt-2 max-w-3xl text-[14.5px] leading-7 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
              Every technology here answers one question. No layer does another layer's work, and that is why the system can grow
              one piece at a time. Tap a layer to see what it does, why it is there, and what breaks without it.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {layers.map((l) => {
                const LIcon = l.Icon;
                return (
                  <span
                    key={l.id}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold"
                    style={{ borderColor: "var(--line)", background: "var(--card)" }}
                  >
                    <LIcon size={13} style={{ color: ACCENTS[l.tone].text }} />
                    {l.label}
                  </span>
                );
              })}
            </div>
          </section>

          <section id="layers" className="mt-8 scroll-mt-24">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[20px] font-extrabold">The system map</h2>
              <span className="text-[12px] font-bold" style={{ color: "var(--muted)" }}>
                Walk it in order, or flip the arrows to see the response
              </span>
            </div>

            <div
              ref={canvasRef}
              onMouseMove={moveSpotlight}
              className="tech-canvas mt-3 overflow-hidden"
              style={{ border: "1px solid var(--tc-line)" }}
            >
              <div className="tech-hairlines" aria-hidden="true" />
              <div className="tech-spotlight" aria-hidden="true" />
              <div className="relative p-3 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={startTour}
                    className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-extrabold text-white transition hover:brightness-110"
                    style={{ background: "#2563EB" }}
                  >
                    {tour ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                    {tour ? "Pause walk" : "Walk the stack"}
                  </button>
                  <button
                    type="button"
                    onClick={replayTour}
                    className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-bold transition"
                    style={{ borderColor: "var(--tc-line)", color: "var(--tc-ink)", background: "var(--tc-card)" }}
                  >
                    <RotateCcw size={12} /> Replay
                  </button>
                  <div
                    className="flex items-center gap-0.5 rounded-full p-0.5"
                    style={{ background: "var(--tc-card-2)", border: "1px solid var(--tc-line)" }}
                    role="group"
                    aria-label="Flow direction"
                  >
                    {([["down", "Request ↓"], ["up", "Response ↑"]] as const).map(([value, text]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setDir(value)}
                        aria-pressed={dir === value}
                        className="rounded-full px-2.5 py-1 text-[11.5px] font-extrabold transition"
                        style={
                          dir === value
                            ? { background: "var(--tc-card)", color: "var(--tc-ink)", boxShadow: "0 1px 4px rgba(15,23,42,0.14)" }
                            : { color: "var(--tc-muted)" }
                        }
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                  <span
                    className="ml-auto rounded-full px-2.5 py-1 text-[10.5px] font-black uppercase tracking-[0.12em]"
                    style={{ background: "var(--tc-card-2)", color: "var(--tc-muted)" }}
                  >
                    Layer {layerIndex + 1} / {layers.length}
                  </span>
                </div>

                <div className="mb-4 h-1 overflow-hidden rounded-full" style={{ background: "var(--tc-card-2)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${((layerIndex + 1) / layers.length) * 100}%`,
                      background: `linear-gradient(90deg, ${ACCENTS.sky.text}, ${ACCENTS.blue.text}, ${ACCENTS.pink.text})`,
                    }}
                  />
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr] lg:items-start">
                  <div>
                    {layers.map((l, i) => {
                      const LIcon = l.Icon;
                      const a = ACCENTS[l.tone];
                      const isActive = l.id === activeLayer;
                      return (
                        <div key={l.id}>
                          <button
                            type="button"
                            onClick={() => setActiveLayer(l.id)}
                            aria-pressed={isActive}
                            data-active={isActive}
                            className="tech-row relative block w-full overflow-hidden rounded-2xl text-left"
                            style={{ ["--acc" as string]: a.text, ["--acc-soft" as string]: a.soft }}
                          >
                            <span className="absolute left-0 top-0 h-full w-[3px]" aria-hidden="true" style={{ background: a.text, opacity: isActive ? 1 : 0.4 }} />
                            <span className="flex items-start gap-3 py-3 pl-4 pr-3.5">
                              <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: a.soft, border: `1px solid ${a.line}`, color: a.text }}>
                                {isActive && <span className="tech-ring pointer-events-none absolute inset-0 rounded-xl" aria-hidden="true" />}
                                <LIcon size={17} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="text-[10px] font-black tracking-[0.14em]" style={{ color: a.text }}>L{i + 1}</span>
                                  <span className="text-[14.5px] font-extrabold leading-5" style={{ color: "var(--tc-ink)" }}>{l.label}</span>
                                  <span className="text-[11.5px] font-semibold leading-5 [overflow-wrap:anywhere]" style={{ color: "var(--tc-muted)" }}>{l.tagline}</span>
                                </span>
                                <span className="mt-2 flex flex-wrap gap-1.5">
                                  {l.techs.map((t) => (
                                    <span
                                      key={t.name}
                                      className="inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] leading-5"
                                      style={{ background: "var(--tc-card-2)", border: "1px solid var(--tc-line)" }}
                                    >
                                      <span className="font-extrabold" style={{ color: "var(--tc-ink)" }}>{t.name}</span>
                                      <span className="hidden font-semibold sm:inline" style={{ color: "var(--tc-muted)" }}>· {t.role}</span>
                                    </span>
                                  ))}
                                </span>
                              </span>
                              <ChevronRight
                                size={15}
                                className="mt-2.5 shrink-0 transition-transform"
                                style={{ color: isActive ? a.text : "var(--tc-line-strong)", transform: isActive ? "rotate(90deg)" : "none" }}
                              />
                            </span>
                          </button>

                          {i < layers.length - 1 && (
                            <div className="relative flex h-11 w-full items-center justify-center" aria-hidden="true">
                              <svg
                                width="20"
                                height="38"
                                viewBox="0 0 20 38"
                                className="overflow-visible transition-transform duration-300"
                                style={{ transform: dir === "up" ? "rotate(180deg)" : "none" }}
                              >
                                <line x1="10" y1="0" x2="10" y2="26" stroke="var(--tc-line-strong)" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" className="tech-dash" />
                                <path d="M3 25 L10 37 L17 25 Z" fill="var(--tc-line-strong)" />
                              </svg>
                              <span
                                className="tech-dot absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
                                style={{
                                  background: a.text,
                                  boxShadow: `0 0 8px 2px ${a.soft}`,
                                  animationDelay: `${i * 0.16}s`,
                                  animationDirection: dir === "up" ? "reverse" : "normal",
                                }}
                              />
                              <span className="absolute left-1/2 ml-4 text-[9.5px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--tc-muted)" }}>
                                {l.handoff}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div
                    key={layer.id}
                    className="tech-rise rounded-2xl border p-4"
                    style={{ borderColor: "var(--tc-line)", background: "var(--tc-card)", boxShadow: "var(--tc-shadow)" }}
                  >
                    <span className="mb-3 block h-[3px] w-12 rounded-full" style={{ background: ACCENTS[layer.tone].text }} />
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: ACCENTS[layer.tone].soft, border: `1px solid ${ACCENTS[layer.tone].line}`, color: ACCENTS[layer.tone].text }}>
                        <LayerIcon size={17} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: ACCENTS[layer.tone].text }}>Layer detail</div>
                        <h3 className="text-[17px] font-extrabold leading-tight" style={{ color: "var(--tc-ink)" }}>{layer.label}</h3>
                      </div>
                      <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black tracking-wider" style={{ background: "var(--tc-card-2)", color: "var(--tc-muted)" }}>
                        {layerIndex + 1} / {layers.length}
                      </span>
                    </div>

                    <dl className="mt-4 space-y-3">
                      <div>
                        <dt className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: "var(--tc-muted)" }}>What it does</dt>
                        <dd className="mt-0.5 text-[13px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--tc-ink)" }}>{layer.what}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: "var(--tc-muted)" }}>Why this one</dt>
                        <dd className="mt-0.5 text-[13px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--tc-ink)" }}>{layer.why}</dd>
                      </div>
                      <div className="rounded-xl border p-2.5" style={{ borderColor: "var(--danger-line)", background: "var(--danger-bg)" }}>
                        <dt className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: "var(--danger)" }}>
                          <AlertTriangle size={12} /> Without it
                        </dt>
                        <dd className="mt-1 text-[13px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--tc-ink)" }}>{layer.breaks}</dd>
                      </div>
                      <div className="rounded-xl border p-2.5" style={{ borderColor: ACCENTS[layer.tone].line, background: ACCENTS[layer.tone].soft }}>
                        <dt className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: ACCENTS[layer.tone].text }}>
                          <Gauge size={12} /> Scale effect
                        </dt>
                        <dd className="mt-1 text-[13px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--tc-ink)" }}>{layer.scale}</dd>
                      </div>
                    </dl>

                    <div className="mt-3.5 border-t pt-3" style={{ borderColor: "var(--tc-line)" }}>
                      <div className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: "var(--tc-muted)" }}>Used for</div>
                      <ul className="mt-1.5 space-y-1">
                        {layer.techs.map((t) => (
                          <li key={t.name} className="flex items-baseline gap-2 text-[12.5px] leading-5">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ACCENTS[layer.tone].text }} />
                            <span className="[overflow-wrap:anywhere]" style={{ color: "var(--tc-ink)" }}><b>{t.name}</b> <span style={{ color: "var(--tc-muted)" }}>· {t.role}</span></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="techgrid" className="mt-9 scroll-mt-24">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[20px] font-extrabold">Every tech, one job</h2>
              <span className="text-[12px] font-bold" style={{ color: "var(--muted)" }}>Tap a job to filter</span>
            </div>
            <p className="mt-1 text-[13.5px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
              Read this grid as a legend for the whole design. If a new tool does not replace one of these jobs, it is not needed yet.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter technologies by job">
              <button
                type="button"
                onClick={() => setFilter("all")}
                aria-pressed={filter === "all"}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-extrabold transition"
                style={
                  filter === "all"
                    ? { borderColor: "var(--ink)", background: "var(--ink)", color: "var(--surface)" }
                    : { borderColor: "var(--line)", background: "var(--card)", color: "var(--muted)" }
                }
              >
                All
                <span className="text-[10px] font-black opacity-70">{tiles.length}</span>
              </button>
              {groups.map((g) => {
                const a = ACCENTS[g.tone];
                const on = filter === g.tone;
                const count = tiles.filter((t) => t.tone === g.tone).length;
                return (
                  <button
                    key={g.label}
                    type="button"
                    onClick={() => setFilter(on ? "all" : g.tone)}
                    aria-pressed={on}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-extrabold transition"
                    style={
                      on
                        ? { borderColor: a.text, background: a.text, color: "var(--tech-on-accent)" }
                        : { borderColor: a.line, background: a.soft, color: a.text }
                    }
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor", opacity: on ? 0.85 : 1 }} />
                    {g.label}
                    <span className="text-[10px] font-black opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {tiles
                .filter((t) => filter === "all" || t.tone === filter)
                .map((t, i) => {
                  const a = ACCENTS[t.tone];
                  const TIcon = t.Icon;
                  return (
                    <div
                      key={`${filter}-${t.name}`}
                      className="tech-pop group relative overflow-hidden rounded-2xl border p-3.5 transition hover:-translate-y-0.5"
                      style={{
                        animationDelay: `${i * 35}ms`,
                        background: "var(--card)",
                        borderColor: "var(--line)",
                        boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
                      }}
                    >
                      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${a.text}, transparent)` }} />
                      <div className="flex items-start gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: a.soft, color: a.text, border: `1px solid ${a.line}` }}>
                          <TIcon size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-[14px] font-extrabold leading-5">{t.name}</span>
                            <span className="rounded-full px-1.5 py-px text-[9px] font-black uppercase tracking-[0.1em]" style={{ background: a.soft, color: a.text }}>{groupLabel(t.tone)}</span>
                            {t.later && (
                              <span className="rounded-full border px-1.5 py-px text-[9px] font-black uppercase tracking-[0.1em]" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>Later</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[12.5px] leading-5 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{t.job}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>

          <section id="flows" className="mt-9 scroll-mt-24">
            <h2 className="text-[20px] font-extrabold">How a request moves</h2>
            <p className="mt-1 text-[13.5px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
              Same seven layers, two directions. The read path avoids storage. The write path avoids the user waiting.
            </p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <Flow
                kicker="READ PATH"
                title="Open a story"
                sub="Fast, counted, and safe against deleted stories."
                nodes={readFlow}
              />
              <Flow
                kicker="WRITE PATH"
                title="Publish a story"
                sub="Media first, then the event, then the document, then the cache."
                nodes={writeFlow}
              />
            </div>
          </section>

          <section id="cdn" className="mt-9 scroll-mt-24">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[20px] font-extrabold">CDN cache</h2>
              <span className="text-[12px] font-bold" style={{ color: "var(--muted)" }}>Bytes wait at the edge, JSON comes from the API</span>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
              <div className="grid lg:grid-cols-[1fr_1.1fr]">
                <div className="p-5">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.18em]" style={{ color: "var(--acc-violet)" }}>Edge cache</div>
                  <h3 className="mt-1.5 text-[15.5px] font-extrabold leading-tight">One request, two outcomes</h3>

                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg border px-2 py-1 text-[11.5px] font-extrabold" style={{ borderColor: "var(--line)", background: "var(--card-2)" }}>Viewer</span>
                      <ArrowRight size={13} style={{ color: "var(--muted)" }} />
                      <span className="rounded-lg border px-2 py-1 text-[11.5px] font-extrabold" style={{ borderColor: "var(--acc-violet-line)", background: "var(--acc-violet-soft)", color: "var(--acc-violet)" }}>Edge node</span>
                      <ArrowRight size={13} style={{ color: "var(--muted)" }} />
                      <span className="rounded-lg border px-2 py-1 text-[11.5px] font-extrabold" style={{ borderColor: "var(--acc-green-line)", background: "var(--acc-green-soft)", color: "var(--acc-green)" }}>Hit, return now</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg border px-2 py-1 text-[11.5px] font-extrabold" style={{ borderColor: "var(--acc-violet-line)", background: "var(--acc-violet-soft)", color: "var(--acc-violet)" }}>Edge node</span>
                      <ArrowRight size={13} style={{ color: "var(--muted)" }} />
                      <span className="rounded-lg border px-2 py-1 text-[11.5px] font-extrabold" style={{ borderColor: "var(--line)", background: "var(--card-2)" }}>Origin</span>
                      <ArrowRight size={13} style={{ color: "var(--muted)" }} />
                      <span className="rounded-lg border px-2 py-1 text-[11.5px] font-extrabold" style={{ borderColor: "var(--acc-amber-line)", background: "var(--acc-amber-soft)", color: "var(--acc-amber)" }}>Miss, pull once</span>
                    </div>
                  </div>

                  <ul className="mt-3.5 space-y-1.5">
                    {[
                      "The API never carries media bytes",
                      "Access is checked before a signed URL is handed out",
                      "A delete purges the key, and the tombstone still blocks reads",
                    ].map((r) => (
                      <li key={r} className="flex items-start gap-2 text-[13px] leading-5">
                        <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--acc-violet)" }} />
                        <span className="[overflow-wrap:anywhere]">{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-5" style={{ background: "var(--card-2)" }}>
                  <h3 className="text-[13px] font-extrabold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Caching rules</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[400px] text-left text-[13px]">
                      <thead>
                        <tr className="border-b text-[11px] uppercase tracking-wider" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
                          <th className="py-2 pr-3">Question</th>
                          <th className="py-2">Answer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cdnRows.map(([q, a]) => (
                          <tr key={q} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                            <td className="py-2 pr-3 align-top font-extrabold">{q}</td>
                            <td className="py-2 align-top [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{a}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="scale" className="mt-9 scroll-mt-24">
            <h2 className="text-[20px] font-extrabold">Which tech answers which scale question</h2>
            <p className="mt-1 text-[13.5px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
              Scaling is not one switch. Each row below is one limit, and the tech that removes it.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border p-4" style={{ background: "#0F172A", borderColor: "#0F172A", color: "#fff" }}>
                <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: "#93C5FD" }}>
                  <Waypoints size={13} /> Rule
                </div>
                <p className="mt-2 text-[15px] font-extrabold leading-6">
                  Read scale, write scale, and count scale are three different problems.
                </p>
                <p className="mt-2 text-[13px] leading-6" style={{ color: "#CBD5E1" }}>
                  One tech per problem. Never one tech for all three.
                </p>
              </div>
              {scaleCards.map((c) => {
                const CIcon = c.Icon;
                return (
                  <div key={c.q} className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
                    <div className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "var(--blue-soft)" }}>
                        <CIcon size={15} style={{ color: "var(--blue)" }} />
                      </span>
                      <span className="text-[12px] font-bold leading-4 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{c.q}</span>
                    </div>
                    <div className="mt-2 text-[15px] font-extrabold leading-5">{c.a}</div>
                    <p className="mt-1 text-[13px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{c.how}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section id="data" className="mt-9 scroll-mt-24">
            <h2 className="text-[20px] font-extrabold">MongoDB or ScyllaDB</h2>
            <p className="mt-1 text-[13.5px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
              Both are on the table. Start on MongoDB, and move only the hot tables when the numbers ask for it.
            </p>

            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border-2 p-4 sm:p-5" style={{ background: "var(--card)", borderColor: "var(--blue)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "var(--blue-soft)" }}>
                      <Database size={16} style={{ color: "var(--blue)" }} />
                    </span>
                    <h3 className="text-[17px] font-extrabold">MongoDB</h3>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-[10.5px] font-extrabold" style={{ background: "#2563EB", color: "#fff" }}>NOW</span>
                </div>
                <p className="mt-2 text-[13.5px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
                  One document per story holds owner, expiry, visibility, and edit state. Reads match the document, so there is no join on the hot path.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {mongoRows.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-[13px] leading-5">
                      <Check size={14} className="mt-0.5 shrink-0" style={{ color: "#16A34A" }} />
                      <span className="[overflow-wrap:anywhere]">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border p-4 sm:p-5" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "var(--chip)" }}>
                      <Boxes size={16} style={{ color: "var(--muted)" }} />
                    </span>
                    <h3 className="text-[17px] font-extrabold">ScyllaDB</h3>
                  </div>
                  <span className="rounded-full border px-2 py-0.5 text-[10.5px] font-extrabold" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>NEXT</span>
                </div>
                <p className="mt-2 text-[13.5px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
                  A wide-row store built for very high write rates. It fits append-only events and counters that are always read by one partition key.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {scyllaRows.map((r) => (
                    <li key={r} className="flex items-start gap-2 text-[13px] leading-5">
                      <ArrowRight size={14} className="mt-0.5 shrink-0" style={{ color: "var(--muted)" }} />
                      <span className="[overflow-wrap:anywhere]">{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-2xl border p-4" style={{ background: "var(--card-2)", borderColor: "var(--line)" }}>
              <ShieldCheck size={17} className="mt-0.5 shrink-0" style={{ color: "var(--blue)" }} />
              <p className="text-[13.5px] leading-6 [overflow-wrap:anywhere]">
                <b>Decision:</b> the story document stays in MongoDB. Only high-volume view events and counters move to ScyllaDB, and only after
                Kafka volume grows past what one MongoDB cluster can absorb. The API contract does not change, so clients never notice.
              </p>
            </div>
          </section>

          <section className="mt-9">
            <div className="overflow-hidden rounded-2xl border" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
              <div className="grid lg:grid-cols-[1fr_1.25fr]">
                <div className="p-5">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.18em]" style={{ color: "var(--blue)" }}>Two contracts</div>
                  <h2 className="mt-2 text-[clamp(19px,2.4vw,24px)] font-extrabold leading-tight">REST describes the work.<br />Swagger proves it.</h2>
                  <p className="mt-2 text-[13.5px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
                    The REST contract is the only thing the client knows. Swagger turns that contract into a page and into request schemas
                    that Fastify enforces on every call.
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {[
                      "One spec, one source of truth",
                      "Validation and docs stay in sync",
                      "Breaking changes show up in review",
                    ].map((r) => (
                      <li key={r} className="flex items-start gap-2 text-[13px] leading-5">
                        <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--blue)" }} />
                        <span className="[overflow-wrap:anywhere]">{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-5" style={{ background: "var(--card-2)" }}>
                  <h3 className="text-[13px] font-extrabold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Surface</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-[13px]">
                      <thead>
                        <tr className="border-b text-[11px] uppercase tracking-wider" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
                          <th className="py-2 pr-3">Endpoint</th>
                          <th className="py-2 pr-3">Layer it touches</th>
                          <th className="py-2">Mode</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { e: "POST /stories", l: "Kafka → worker", m: "write" },
                          { e: "GET /stories/:id", l: "Redis → MongoDB", m: "read" },
                          { e: "PATCH /stories/:id", l: "Kafka → MongoDB", m: "write" },
                          { e: "DELETE /stories/:id", l: "Kafka → MongoDB", m: "write" },
                          { e: "GET /stories/:id/viewers", l: "Redis → MongoDB", m: "read" },
                          { e: "POST /stories/:id/extend", l: "MongoDB → Redis", m: "write" },
                        ].map((r) => (
                          <tr key={r.e} className="border-b align-top last:border-b-0" style={{ borderColor: "var(--line)" }}>
                            <td className="py-2 pr-3 font-mono text-[12px] font-bold [overflow-wrap:anywhere]" style={{ color: "var(--blue)" }}>{r.e}</td>
                            <td className="py-2 pr-3 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{r.l}</td>
                            <td className="py-2">
                              <span
                                className="rounded-full px-2 py-0.5 text-[10.5px] font-extrabold"
                                style={r.m === "read" ? { background: "var(--success-bg)", color: "var(--success)" } : { background: "var(--amber-bg)", color: "var(--amber-ink)" }}
                              >
                                {r.m}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border p-4 sm:p-5" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
            <h2 className="text-[17px] font-extrabold">What comes after this stack</h2>
            <p className="mt-1 text-[13.5px] leading-6 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>
              These are next, not now. Each one is added only when a measured limit is hit.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { t: "ScyllaDB", d: "Hot event and counter tables" },
                { t: "CDN", d: "Media from the nearest edge" },
                { t: "OpenTelemetry", d: "Traces across Nginx, Fastify, workers" },
                { t: "Read replicas", d: "Read fan-out before sharding" },
              ].map((r) => (
                <div key={r.t} className="rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--card-2)" }}>
                  <div className="text-[13.5px] font-extrabold">{r.t}</div>
                  <div className="mt-0.5 text-[12.5px] leading-5 [overflow-wrap:anywhere]" style={{ color: "var(--muted)" }}>{r.d}</div>
                </div>
              ))}
            </div>
          </section>

          <p className="mx-auto mt-6 max-w-3xl text-center text-[12.5px] leading-6" style={{ color: "var(--muted)" }}>
            Reference map. Tap a layer, play a flow, then read the same step in the Features page.
          </p>
        </main>
      </div>
    </div>
  );
}
