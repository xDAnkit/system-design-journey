import React, { useCallback, useEffect, useState } from "react";
import {
  Database,
  Sparkles,
  UserRound,
  Users,
  BarChart3,
  Zap,
  Archive,
  Crown,
  Eye,
  Search,
  Clock3,
  Star,
  ListChecks,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronRight,
  Heart,
  MessageCircle,
  Share2,
  Trash2,
  Music2,
  Tag,
  Link2,
  HelpCircle,
  Flame,
  Snowflake,
  Globe,
  Smartphone,
  Cloud,
  Timer,
  Copy,
  Play,
  AtSign,
  Bell,
} from "lucide-react";

type Detail = {
  id: string;
  title: string;
  kicker: string;
  visualTitle: string;
  visual: string[];
  bullets: string[];
  example: string;
};
const DETAILS: Detail[] = [
  {
    id: "basics-overview",
    title: "Basics / Story Banane Ke Liye Kya Chahiye",
    kicker: "BASICS • 01",
    visualTitle: "Six-stage flow",
    visual: ["Client", "API", "Media", "DB", "Cache"],
    bullets: [
      "Client captures and edits the story.",
      "API + Media + DB save it safely.",
      "Cache + Fanout deliver it fast to the right audience.",
    ],
    example:
      "Example: You post a photo. It goes Client → API → Media → DB → Cache, then reaches your followers.",
  },
  {
    id: "db-schema",
    title: "DB Schema",
    kicker: "BASICS • 01",
    visualTitle: "How the tables connect",
    visual: ["Users", "Stories", "Media", "Views", "Highlights"],
    bullets: [
      "Every story belongs to one author.",
      "Media, views and highlights stay in their own tables.",
      "Expiry and archive status live on the story row.",
    ],
    example:
      "Example: One author posts a story. It gets one row in Stories, one row in Media, and one view row per viewer.",
  },
  {
    id: "media-storage",
    title: "Media Storage",
    kicker: "BASICS • 01",
    visualTitle: "Storage pipeline",
    visual: ["Upload", "Validate", "Transcode", "Store", "Deliver"],
    bullets: [
      "Uploads are checked before a story goes live.",
      "Compressed and thumbnail versions keep the feed fast.",
      "The original is preserved for highlights.",
    ],
    example:
      "Example: You upload a video. A small preview loads first, then the full video follows.",
  },
  {
    id: "endpoints",
    title: "Endpoints",
    kicker: "BASICS • 01",
    visualTitle: "API surface",
    visual: ["Create", "Feed", "View", "Reply", "Delete"],
    bullets: [
      "Create and delete are author-only.",
      "Reads respect visibility and blocks.",
      "Feed reads are cached because they are read most.",
    ],
    example:
      "Example: The app calls POST /stories to publish, then GET /stories/feed to show it.",
  },
  {
    id: "story-type",
    title: "Story Type — Public / Private / Close Friends",
    kicker: "BASICS • 01",
    visualTitle: "Audience selector",
    visual: ["Public", "Private", "Close Friends"],
    bullets: [
      "Public reaches followers and discovery.",
      "Private limits the story to approved followers.",
      "Close Friends narrows it to one named list.",
    ],
    example:
      "Example: Choose Close Friends for a personal story, Public for a wide story.",
  },
  {
    id: "music",
    title: "Music",
    kicker: "EXTRA FEATURES • 02",
    visualTitle: "Music attachment",
    visual: ["Story", "Track", "Player"],
    bullets: [
      "Music is referenced by track ID, not re-uploaded.",
      "Playback starts with the story and stops when it ends.",
      "Availability is checked before publish.",
    ],
    example:
      "Example: You add a song to a story. The song plays with the story, but is not saved inside the video.",
  },
  {
    id: "tags",
    title: "Tags",
    kicker: "EXTRA FEATURES • 02",
    visualTitle: "Tag layer",
    visual: ["Media", "Tag", "Person"],
    bullets: [
      "Each tag stores a person, a position and a label.",
      "Tapped tags open the tagged profile or place.",
      "Authors can edit tags inside the edit window.",
    ],
    example:
      "Example: You tag a friend in a photo. Viewers can tap the tag to open that profile.",
  },
  {
    id: "links",
    title: "Links",
    kicker: "EXTRA FEATURES • 02",
    visualTitle: "Link sticker",
    visual: ["Story", "Link sticker", "Destination"],
    bullets: [
      "Links are validated before publish.",
      "Taps are counted separately from views.",
      "External destinations open outside the viewer.",
    ],
    example:
      "Example: You add one link sticker. Viewers tap it to open the page outside the story.",
  },
  {
    id: "questions-polls",
    title: "Questions / Polls",
    kicker: "EXTRA FEATURES • 02",
    visualTitle: "Interactive sticker",
    visual: ["Sticker", "Vote", "Author inbox"],
    bullets: [
      "Polls store options and a vote per viewer.",
      "Questions collect open text for the author.",
      "Results update live while the story is active.",
    ],
    example:
      "Example: You add a poll. Viewers vote, and you see the answers live.",
  },
  {
    id: "mention",
    title: "Mention",
    kicker: "EXTRA FEATURES • 02",
    visualTitle: "Mention flow",
    visual: [
      "Author",
      "Mention Service",
      "Notification + DM",
      "Mentioned user",
    ],
    bullets: [
      "Author tags @user in the story.",
      "Mention Service sends a notification and a DM.",
      "Mentioned user can reshare it with Add to Story.",
    ],
    example:
      "Example: You mention @aarav. Aarav gets a DM and can add your story to their own story.",
  },
  {
    id: "gif",
    title: "GIF",
    kicker: "EXTRA FEATURES • 02",
    visualTitle: "GIF sticker flow",
    visual: ["Search", "Sticker Service", "CDN", "Story overlay"],
    bullets: [
      "Search finds animated GIF stickers.",
      "Sticker Service returns a CDN URL for the GIF.",
      "Tapping adds the GIF as an overlay on the story.",
    ],
    example:
      "Example: You search “celebrate”, tap a GIF, and it plays on top of your story.",
  },
  {
    id: "delete-story",
    title: "Delete Story",
    kicker: "AUTHOR • 03",
    visualTitle: "Delete flow",
    visual: ["Author", "Delete", "Feed cleared", "Storage cleaned"],
    bullets: [
      "The story disappears from feeds as soon as delete succeeds.",
      "Views and media rows are cleaned up with the story.",
      "Highlights keep their own saved copy.",
    ],
    example:
      "Example: You delete a story. It leaves feeds at once, then its stored copies are cleared.",
  },
  {
    id: "edit-15-min",
    title: "Edit 15 min",
    kicker: "AUTHOR • 03",
    visualTitle: "Edit window",
    visual: ["Publish", "15 min edit", "Locked"],
    bullets: [
      "Edits are allowed for 15 minutes after publish.",
      "Caption, tags and stickers can change.",
      "After the window closes, the story is read-only.",
    ],
    example:
      "Example: You fix a typo in the caption within 15 minutes. The photo stays the same.",
  },
  {
    id: "highlights",
    title: "Highlights",
    kicker: "AUTHOR • 03",
    visualTitle: "Highlight collection",
    visual: ["Profile", "Highlight", "Saved stories"],
    bullets: [
      "A highlight is a named collection on the profile.",
      "Stories inside a highlight stay visible after expiry.",
      "Cover and order are chosen by the author.",
    ],
    example:
      "Example: You save a birthday story to a highlight. It stays on your profile after 24 hours.",
  },
  {
    id: "views",
    title: "Views",
    kicker: "AUDIENCE • 04",
    visualTitle: "View record",
    visual: ["Viewer", "Story", "View row"],
    bullets: [
      "The first view creates the view row.",
      "Later views update the same row and raise rewatch count.",
      "Authors see viewers; viewers see only their own view.",
    ],
    example:
      "Example: A friend watches your story twice. You see one viewer, with a rewatch count.",
  },
  {
    id: "likes",
    title: "Likes",
    kicker: "AUDIENCE • 04",
    visualTitle: "Like signal",
    visual: ["Viewer", "Heart", "Like count"],
    bullets: [
      "One like per viewer per story.",
      "Tapping again removes the like.",
      "Like totals are cached for the feed.",
    ],
    example:
      "Example: A viewer taps the heart once. Tapping again removes the like.",
  },
  {
    id: "replies",
    title: "Replies",
    kicker: "AUDIENCE • 04",
    visualTitle: "Reply thread",
    visual: ["Viewer", "Reply", "Author inbox"],
    bullets: [
      "A reply is tied to the story it answers.",
      "Authors can reply back without leaving the story.",
      "Replies survive after the story expires.",
    ],
    example:
      "Example: A viewer replies to your story. The reply lands in your inbox.",
  },
  {
    id: "share",
    title: "Share",
    kicker: "AUDIENCE • 04",
    visualTitle: "Share path",
    visual: ["Viewer", "Share", "New viewer"],
    bullets: [
      "Shares reference the original story.",
      "Visibility rules still apply to the new viewer.",
      "Share counts are tracked separately from views.",
    ],
    example:
      "Example: A viewer shares your story. The new viewer still follows the same visibility rules.",
  },
  {
    id: "navigation",
    title: "Navigation",
    kicker: "ANALYTICS • 05",
    visualTitle: "Navigation funnel",
    visual: ["Enter", "Forward / Back", "Next / Exit"],
    bullets: [
      "Forward taps show steady watching.",
      "Back taps show a moment worth re-checking.",
      "Exits show where attention ended.",
    ],
    example:
      "Example: Many viewers tap back on one frame. That frame is worth checking again.",
  },
  {
    id: "stats-demographics",
    title: "Stats Demographics",
    kicker: "ANALYTICS • 05",
    visualTitle: "Audience overview",
    visual: ["Views", "Aggregates", "Trends"],
    bullets: [
      "Age and region are shown only as totals.",
      "Small groups are hidden to protect privacy.",
      "Trends compare this story with recent stories.",
    ],
    example:
      "Example: You see total views by region, but never who exactly viewed from where.",
  },
  {
    id: "clicks",
    title: "Clicks",
    kicker: "ANALYTICS • 05",
    visualTitle: "Click map",
    visual: ["Story", "Sticker / Link", "Click"],
    bullets: [
      "Link clicks are counted once per viewer.",
      "Sticker taps show which element worked.",
      "Click-through rate compares clicks with views.",
    ],
    example:
      "Example: 100 people viewed, 10 tapped the link. That is a 10% click rate.",
  },
  {
    id: "instagram-plus",
    title: "Instagram Plus",
    kicker: "ANALYTICS • 05",
    visualTitle: "Premium bridge",
    visual: ["Core analytics", "Instagram Plus", "Meta One"],
    bullets: [
      "Core analytics stay free in the main flow.",
      "Plus adds rewatch, search and extended lifetime.",
      "Meta One is separate from the 7-column core flow.",
    ],
    example:
      "Example: Core analytics stay free. Plus adds rewatch, search and longer lifetime below.",
  },
  {
    id: "hot-reads-cache",
    title: "Hot Reads Cache",
    kicker: "CACHING • 06",
    visualTitle: "Hot cache",
    visual: ["Feed", "Cache", "Database"],
    bullets: [
      "Fresh and popular stories are cached first.",
      "Cache reads serve the feed and viewer list.",
      "Writes update the cache so counts stay fresh.",
    ],
    example:
      "Example: A story everyone is opening loads fast, because it lives in the cache.",
  },
  {
    id: "cache-manage",
    title: "Cache Manage",
    kicker: "CACHING • 06",
    visualTitle: "Cache controls",
    visual: ["Set", "Read", "Expire", "Evict"],
    bullets: [
      "Each cached story has a short lifetime.",
      "Expired entries are evicted automatically.",
      "Cache size and hit rate are monitored.",
    ],
    example:
      "Example: An old cached story expires and is removed, so the cache stays small.",
  },
  {
    id: "tombstone",
    title: "Tombstone",
    kicker: "CACHING • 06",
    visualTitle: "Tombstone marker",
    visual: ["Delete", "Tombstone", "Cache cleared"],
    bullets: [
      "Delete writes a tombstone before clearing the cache.",
      "Readers check the tombstone first.",
      "Tombstones expire once every cache copy is gone.",
    ],
    example:
      "Example: You delete a story. A small marker tells readers: do not show the old copy.",
  },
  {
    id: "archive-old-stories",
    title: "Archive Old Stories",
    kicker: "ARCHIVAL • 07",
    visualTitle: "Archive shelf",
    visual: ["Expired", "Archive", "Highlights"],
    bullets: [
      "Archived stories are visible only to the author.",
      "Media and views stay attached to the archive copy.",
      "Authors can restore a story to highlights.",
    ],
    example:
      "Example: An expired story moves to your archive. Only you can see it there.",
  },
  {
    id: "expire-24h",
    title: "Expire 24h",
    kicker: "ARCHIVAL • 07",
    visualTitle: "Expiry clock",
    visual: ["Publish", "24h live", "Archive"],
    bullets: [
      "Expiry time is set at publish.",
      "At expiry, the story leaves feeds and viewers.",
      "Expiry triggers archive, not deletion.",
    ],
    example:
      "Example: You post at 10 am. The story leaves the feed at 10 am next day, then goes to archive.",
  },
  {
    id: "highlights-copy",
    title: "Highlights Copy",
    kicker: "ARCHIVAL • 07",
    visualTitle: "Highlight copy",
    visual: ["Story", "Archive", "Highlight copy"],
    bullets: [
      "Saving to highlights copies the media reference.",
      "The copy keeps its own cover and order.",
      "Removing a highlight does not delete the archive.",
    ],
    example:
      "Example: You save a story to highlights. The original can expire, the copy stays.",
  },
  {
    id: "rewatch-count",
    title: "Rewatch Count",
    kicker: "META ONE • PREMIUM",
    visualTitle: "Rewatch signal",
    visual: ["First view", "Rewatch", "Total attention"],
    bullets: [
      "Rewatch counts sit beside first-view counts.",
      "High rewatch means the moment landed.",
      "Authors can compare rewatch across stories.",
    ],
    example:
      "Example: 50 people viewed, 12 came back. Rewatch shows the story landed.",
  },
  {
    id: "viewer-search",
    title: "Viewer Search",
    kicker: "META ONE • PREMIUM",
    visualTitle: "Viewer search",
    visual: ["Viewer list", "Search", "Person"],
    bullets: [
      "Search matches name and username.",
      "Results update as you type.",
      "Tapping a result opens that viewer.",
    ],
    example:
      "Example: You search a name in a long viewer list and find that viewer at once.",
  },
  {
    id: "extend-48h",
    title: "Extend to 48 Hours",
    kicker: "META ONE • PREMIUM",
    visualTitle: "Extended timeline",
    visual: ["0h", "24h", "48h", "Archive"],
    bullets: [
      "Extension is chosen before expiry.",
      "The new expiry is shown on the story.",
      "Highlights remain available after 48 hours.",
    ],
    example:
      "Example: A strong story gets one more day. It stays live for 48 hours, then archives.",
  },
  {
    id: "spotlight",
    title: "Story Spotlight",
    kicker: "META ONE • PREMIUM",
    visualTitle: "Spotlight shelf",
    visual: ["Story", "Spotlight", "Wider audience"],
    bullets: [
      "Spotlight stories are chosen weekly.",
      "Reach is measured separately.",
      "Authors see spotlight performance in analytics.",
    ],
    example:
      "Example: One strong story is picked for the week and reaches a wider audience.",
  },
  {
    id: "custom-lists",
    title: "Custom Lists",
    kicker: "META ONE • PREMIUM",
    visualTitle: "List picker",
    visual: ["Author", "List", "Audience"],
    bullets: [
      "Each list has its own name and members.",
      "A story can target one list at a time.",
      "Lists can be edited without republishing.",
    ],
    example:
      "Example: You make a list for work friends and share one story only with them.",
  },
  {
    id: "anonymous-preview",
    title: "Anonymous Preview",
    kicker: "META ONE • PREMIUM",
    visualTitle: "Private preview",
    visual: ["Author", "Preview", "No view recorded"],
    bullets: [
      "Preview uses the real layout and media.",
      "No view row is created.",
      "Authors can check stickers and links before sharing.",
    ],
    example:
      "Example: You preview a story as viewers see it, without appearing in the viewer list.",
  },
];
const BY_ID: Record<string, Detail> = Object.fromEntries(
  DETAILS.map((d) => [d.id, d]),
);
const byId = (id: string) => BY_ID[id];
type Column = {
  num: string;
  title: string;
  tint: string;
  icon: typeof Database;
  items: (Detail | null)[];
  headerId?: string;
};
const columns: Column[] = [
  {
    num: "01",
    title: "BASICS",
    tint: "#DBEAFE",
    icon: Database,
    headerId: "basics-overview",
    items: [
      byId("db-schema"),
      byId("media-storage"),
      byId("endpoints"),
      byId("story-type"),
    ],
  },
  {
    num: "02",
    title: "EXTRA FEATURES",
    tint: "#CCFBF1",
    icon: Sparkles,
    items: [
      byId("music"),
      byId("tags"),
      byId("links"),
      byId("questions-polls"),
      byId("mention"),
      byId("gif"),
    ],
  },
  {
    num: "03",
    title: "AUTHOR",
    tint: "#FEF3C7",
    icon: UserRound,
    items: [
      byId("delete-story"),
      byId("edit-15-min"),
      byId("highlights"),
      null,
    ],
  },
  {
    num: "04",
    title: "AUDIENCE",
    tint: "#DBEAFE",
    icon: Users,
    items: [byId("views"), byId("likes"), byId("replies"), byId("share")],
  },
  {
    num: "05",
    title: "ANALYTICS",
    tint: "#CCFBF1",
    icon: BarChart3,
    items: [
      byId("navigation"),
      byId("stats-demographics"),
      byId("clicks"),
      byId("instagram-plus"),
    ],
  },
  {
    num: "06",
    title: "CACHING",
    tint: "#FEF3C7",
    icon: Zap,
    items: [
      byId("hot-reads-cache"),
      byId("cache-manage"),
      byId("tombstone"),
      null,
    ],
  },
  {
    num: "07",
    title: "ARCHIVAL",
    tint: "#DBEAFE",
    icon: Archive,
    items: [
      byId("archive-old-stories"),
      byId("expire-24h"),
      byId("highlights-copy"),
      null,
    ],
  },
];
const metaOne: Detail[] = [
  byId("rewatch-count"),
  byId("viewer-search"),
  byId("extend-48h"),
  byId("spotlight"),
  byId("custom-lists"),
  byId("anonymous-preview"),
];
const metaIcons: Record<string, typeof Eye> = {
  "rewatch-count": Eye,
  "viewer-search": Search,
  "extend-48h": Clock3,
  spotlight: Star,
  "custom-lists": ListChecks,
  "anonymous-preview": EyeOff,
};
function readIdFromHash(): string | null {
  const m = window.location.hash.match(/^#\/page\/([a-z0-9-]+)$/);
  return m && BY_ID[m[1]] ? m[1] : null;
}
function CardButton({
  detail,
  onOpen,
}: {
  detail: Detail;
  onOpen: (id: string) => void;
}) {
  const label =
    detail.title === "Story Type — Public / Private / Close Friends"
      ? "Story Type\nPublic / Private / Close Friends"
      : detail.title === "Questions / Polls"
        ? "Questions / Polls"
        : detail.title === "Instagram Plus"
          ? "Instagram Plus\nsee below"
          : detail.title;
  return (
    <button
      type="button"
      onClick={() => onOpen(detail.id)}
      aria-label={`Open ${detail.title} detail page — route #/page/${detail.id}`}
      className="card-shadow group flex min-h-[92px] flex-1 cursor-pointer items-center justify-center rounded-[10px] border-[1.5px] border-slate-300 bg-white px-3 py-4 text-center transition hover:border-[#0F172A] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A] focus-visible:ring-offset-2"
    >
      <span className="flex w-full items-center justify-center gap-2">
        <span className="whitespace-pre-line text-[15px] font-medium leading-[1.45] text-[#1E293B] [overflow-wrap:anywhere]">
          {label}
        </span>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#0F172A]"
          aria-hidden="true"
        />
      </span>
    </button>
  );
}

/* ---------- HERO VISUALS ---------- */
function Shell({
  bg,
  label,
  children,
}: {
  bg: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-[22px] border-2 border-slate-900/10 shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
      style={{ background: bg }}
    >
      <div className="flex items-center justify-between px-4 pt-4 sm:px-7 sm:pt-5">
        <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-extrabold tracking-[0.18em] text-slate-900 shadow-sm">
          {label}
        </span>
        <span className="hidden rounded-full bg-slate-900 px-3 py-1 text-[11px] font-bold tracking-[0.14em] text-white sm:block">
          VIDEO SLIDE • 16:9
        </span>
      </div>
      <div className="px-4 pb-5 pt-3 sm:px-7 sm:pb-7">{children}</div>
    </section>
  );
}
function FlowArrow() {
  return (
    <ArrowRight
      className="mx-auto h-7 w-7 shrink-0 rotate-90 text-slate-900 sm:rotate-0"
      aria-hidden="true"
    />
  );
}
function Phone({
  sticker,
  tint = "linear-gradient(180deg,#F472B6,#7C3AED)",
}: {
  sticker: React.ReactNode;
  tint?: string;
}) {
  return (
    <div className="relative mx-auto w-[220px] shrink-0 overflow-hidden rounded-[32px] border-[6px] border-slate-900 bg-white shadow-2xl sm:w-[240px]">
      <div className="flex items-center justify-center gap-1 py-2">
        <span className="h-2 w-2 rounded-full bg-slate-900" />
        <span className="h-1.5 w-16 rounded-full bg-slate-900" />
      </div>
      <div
        className="relative mx-2 mb-3 flex h-[300px] items-center justify-center overflow-hidden rounded-[22px] p-3"
        style={{ background: tint }}
      >
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/25">
            <Play className="h-8 w-8 fill-white text-white" />
          </div>
          <p className="mt-3 text-[15px] font-extrabold text-white">STORY</p>
          <p className="text-[12px] font-medium text-white/90">
            15 sec • Tap to watch
          </p>
        </div>
        {sticker}
      </div>
      <div className="flex items-center justify-between px-4 pb-3 text-slate-400">
        <Heart className="h-5 w-5" />
        <MessageCircle className="h-5 w-5" />
        <Share2 className="h-5 w-5" />
      </div>
    </div>
  );
}
function GoldShell({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Shell
      bg="linear-gradient(135deg,#FFFBEB 0%,#FEF3C7 48%,#FDE68A 100%)"
      label={label}
    >
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        {children}
      </div>
    </Shell>
  );
}

function HeroVisual({ info }: { info: Detail }) {
  const id = info.id;
  if (id === "basics-overview")
    return (
      <Shell
        bg="linear-gradient(135deg,#EFF6FF,#DBEAFE)"
        label="BASICS • THE BIG PICTURE"
      >
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          {["CLIENT", "API", "MEDIA", "DB", "CACHE"].map((s, i) => (
            <React.Fragment key={s}>
              <div className="w-full max-w-[150px] rounded-2xl bg-white px-3 py-5 text-center shadow-lg sm:w-auto sm:flex-1">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white text-[18px] font-extrabold">
                  {i + 1}
                </div>
                <p className="mt-2 text-[17px] font-extrabold tracking-wide">
                  {s}
                </p>
                <p className="text-[11px] font-medium text-slate-500">
                  {["Capture", "Save", "Store", "Record", "Deliver"][i]}
                </p>
              </div>
              {i < 4 && <FlowArrow />}
            </React.Fragment>
          ))}
        </div>
        <p className="mt-5 text-center text-[22px] font-extrabold text-slate-900 sm:text-[26px]">
          One story. Five stops.{" "}
          <span className="text-blue-700">Then it reaches everyone.</span>
        </p>
      </Shell>
    );
  if (id === "db-schema") {
    const tables = [
      {
        n: "stories",
        c: "#0F172A",
        rows: [
          ["id", "PK"],
          ["user_id", "FK"],
          ["type", "—"],
          ["expires_at", "—"],
        ],
      },
      {
        n: "story_media",
        c: "#0E7490",
        rows: [
          ["id", "PK"],
          ["story_id", "FK"],
          ["media_url", "—"],
          ["order", "—"],
        ],
      },
      {
        n: "story_views",
        c: "#7C3AED",
        rows: [
          ["id", "PK"],
          ["story_id", "FK"],
          ["viewer_id", "FK"],
          ["viewed_at", "—"],
        ],
      },
      {
        n: "story_highlights",
        c: "#B45309",
        rows: [
          ["id", "PK"],
          ["user_id", "FK"],
          ["story_id", "FK"],
          ["title", "—"],
        ],
      },
    ];
    return (
      <Shell
        bg="linear-gradient(135deg,#F8FAFC,#E0E7FF)"
        label="DB SCHEMA • 4 TABLES • CONNECTED"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {tables.map((t) => (
            <div
              key={t.n}
              className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-200"
            >
              <div className="px-4 py-3 text-left" style={{ background: t.c }}>
                <p className="font-mono text-[18px] font-extrabold text-white">
                  {t.n}
                </p>
              </div>
              <div className="p-2">
                {t.rows.map(([col, k]) => (
                  <div
                    key={col}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="font-mono text-[15px] font-bold text-slate-800">
                      {col}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${k === "PK" ? "bg-blue-600 text-white" : k === "FK" ? "bg-amber-400 text-amber-950" : "bg-slate-100 text-slate-500"}`}
                    >
                      {k === "—" ? "FIELD" : k}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[13px] font-bold">
          <span className="rounded-full bg-blue-600 px-3 py-1.5 text-white">
            ● PK = UNIQUE ID
          </span>
          <span className="rounded-full bg-amber-400 px-3 py-1.5 text-amber-950">
            ● FK = LINKS TO ANOTHER TABLE
          </span>
          <span className="rounded-full bg-white px-3 py-1.5">
            stories.id ← everything connects here
          </span>
        </div>
      </Shell>
    );
  }
  if (id === "media-storage")
    return (
      <Shell
        bg="linear-gradient(135deg,#ECFEFF,#FEF3C7)"
        label="MEDIA STORAGE • UPLOAD → DELIVERY"
      >
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <div className="w-full max-w-[210px] rounded-2xl bg-white p-4 text-center shadow-lg">
            <Smartphone className="mx-auto h-10 w-10 text-pink-500" />
            <p className="mt-2 text-[18px] font-extrabold">UPLOAD</p>
            <p className="text-[13px] text-slate-500">Phone sends video</p>
            <p className="mt-2 text-2xl">⬆️</p>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[210px] rounded-2xl bg-amber-400 p-4 text-center shadow-lg">
            <Cloud className="mx-auto h-10 w-10 text-amber-950" />
            <p className="mt-2 text-[18px] font-extrabold">S3 BUCKET</p>
            <p className="text-[13px] text-amber-900">Original • Safe copy</p>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[210px] rounded-2xl bg-blue-600 p-4 text-center text-white shadow-lg">
            <Globe className="mx-auto h-10 w-10" />
            <p className="mt-2 text-[18px] font-extrabold">CDN EDGE</p>
            <p className="text-[13px] text-blue-100">Near you • Super fast</p>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[210px] rounded-2xl bg-white p-4 text-center shadow-lg">
            <Eye className="mx-auto h-10 w-10 text-violet-600" />
            <p className="mt-2 text-[18px] font-extrabold">PHONE</p>
            <p className="text-[13px] text-slate-500">Plays instantly</p>
          </div>
        </div>
        <p className="mt-5 text-center text-[22px] font-extrabold">
          Upload once.{" "}
          <span className="text-blue-700">Play everywhere — fast.</span>
        </p>
      </Shell>
    );
  if (id === "endpoints") {
    const pills = [
      { m: "POST", c: "bg-emerald-500", t: "Create story" },
      { m: "GET", c: "bg-blue-600", t: "Read feed" },
      { m: "PUT", c: "bg-amber-500", t: "Edit story" },
      { m: "DELETE", c: "bg-red-500", t: "Remove story" },
    ];
    return (
      <Shell
        bg="linear-gradient(135deg,#F0FDF4,#EFF6FF)"
        label="ENDPOINTS • ONE API, FOUR VERBS"
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <div className="grid w-full max-w-[280px] gap-3">
            {pills.map((p) => (
              <div
                key={p.m}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow"
              >
                <span
                  className={`rounded-xl px-4 py-2.5 text-[16px] font-black text-white ${p.c}`}
                >
                  {p.m}
                </span>
                <span className="text-[15px] font-bold">{p.t}</span>
                <ArrowRight className="ml-auto h-5 w-5" />
              </div>
            ))}
          </div>
          <div className="w-full max-w-[320px] rounded-[22px] bg-slate-900 p-6 text-center text-white shadow-2xl">
            <Database className="mx-auto h-12 w-12 text-emerald-300" />
            <p className="mt-2 text-[26px] font-black">API BOX</p>
            <p className="font-mono text-[14px] text-slate-300">
              /stories • /stories/feed
            </p>
            <p className="mt-3 inline-block rounded-full bg-emerald-400 px-3 py-1 text-[12px] font-extrabold text-emerald-950">
              ✓ CHECKS • SAVES • RETURNS
            </p>
          </div>
        </div>
      </Shell>
    );
  }
  if (id === "story-type")
    return (
      <Shell
        bg="linear-gradient(135deg,#FDF4FF,#EFF6FF)"
        label="STORY TYPE • WHO SEES IT?"
      >
        <div className="relative mx-auto flex h-[300px] max-w-[560px] items-center justify-center">
          <div className="absolute left-0 top-4 h-[190px] w-[190px] rounded-full bg-blue-500/70 sm:left-6 sm:h-[220px] sm:w-[220px]" />
          <div className="absolute right-0 top-4 h-[190px] w-[190px] rounded-full bg-pink-500/70 sm:right-6 sm:h-[220px] sm:w-[220px]" />
          <div className="absolute bottom-0 left-1/2 h-[190px] w-[190px] -translate-x-1/2 rounded-full bg-emerald-500/75 sm:h-[210px] sm:w-[210px]" />
          <div className="relative z-10 text-center">
            <p className="text-[22px] font-black leading-tight">
              YOU
              <br />
              CHOOSE
            </p>
            <p className="text-[13px] font-bold">One tap</p>
          </div>
          <span className="absolute left-2 top-2 z-10 rounded-full bg-white px-3 py-1 text-[13px] font-extrabold shadow sm:left-8">
            🌍 PUBLIC
          </span>
          <span className="absolute right-2 top-2 z-10 rounded-full bg-white px-3 py-1 text-[13px] font-extrabold shadow sm:right-8">
            👥 FOLLOWERS
          </span>
          <span className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-[13px] font-extrabold shadow">
            ⭐ CLOSE FRIENDS
          </span>
        </div>
        <p className="mt-3 text-center text-[20px] font-extrabold">
          Bigger circle = bigger audience.{" "}
          <span className="text-pink-600">Smaller = more private.</span>
        </p>
      </Shell>
    );
  if (id === "music")
    return (
      <Shell
        bg="linear-gradient(135deg,#FDF2F8,#EDE9FE)"
        label="MUSIC • STICKER ON STORY"
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <Phone
            sticker={
              <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-2xl bg-black/85 p-3 text-left text-white shadow-xl">
                <Music2 className="h-8 w-8 shrink-0 text-pink-300" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-extrabold">
                    Your favourite song
                  </p>
                  <p className="text-[11px] text-white/70">
                    ♪ Plays with story • Tap to hear
                  </p>
                </div>
                <span className="ml-auto rounded-full bg-pink-500 px-2 py-1 text-[10px] font-black">
                  MUSIC
                </span>
              </div>
            }
          />
          <div className="max-w-[300px] text-center sm:text-left">
            <p className="text-[30px] font-black leading-tight">
              Tap a song.
              <br />
              It rides along.
            </p>
            <p className="mt-2 text-[15px] font-medium text-slate-600">
              Not inside the video — linked by track ID. Stops when the story
              ends.
            </p>
            <span className="mt-3 inline-block rounded-full bg-slate-900 px-4 py-2 text-[13px] font-bold text-white">
              ♫ 0:00 ———●—— 0:15
            </span>
          </div>
        </div>
      </Shell>
    );
  if (id === "tags")
    return (
      <Shell
        bg="linear-gradient(135deg,#EFF6FF,#FEF3C7)"
        label="TAGS • TAP A PERSON"
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <Phone
            sticker={
              <>
                <div className="absolute left-4 top-24 rounded-full bg-white px-3 py-1.5 text-[12px] font-extrabold shadow-xl ring-2 ring-blue-500">
                  @friend • TAP
                </div>
                <div className="absolute bottom-20 right-3 rounded-full bg-amber-300 px-3 py-1.5 text-[12px] font-extrabold shadow-xl">
                  📍 Goa
                </div>
              </>
            }
            tint="linear-gradient(180deg,#38BDF8,#0EA5E9)"
          />
          <div className="max-w-[300px] text-center sm:text-left">
            <p className="flex items-center justify-center gap-2 text-[30px] font-black sm:justify-start">
              <Tag className="h-8 w-8 text-blue-600" /> Tap. Open.
            </p>
            <p className="mt-2 text-[15px] font-medium text-slate-600">
              Every tag = person + spot + label. One tap opens their profile.
            </p>
          </div>
        </div>
      </Shell>
    );
  if (id === "links")
    return (
      <Shell
        bg="linear-gradient(135deg,#EFF6FF,#F0FDF4)"
        label="LINKS • ONE TAP OUT"
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <Phone
            sticker={
              <div className="absolute inset-x-3 bottom-16 flex items-center gap-2 rounded-2xl bg-white p-3 text-left shadow-2xl">
                <Link2 className="h-7 w-7 shrink-0 text-blue-600" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-extrabold">
                    🔗 Visit my new video
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Opens outside the story
                  </p>
                </div>
                <ArrowRight className="ml-auto h-5 w-5 shrink-0" />
              </div>
            }
            tint="linear-gradient(180deg,#F59E0B,#EF4444)"
          />
          <div className="max-w-[300px] text-center sm:text-left">
            <p className="text-[30px] font-black leading-tight">
              One link.
              <br />
              One tap. Gone.
            </p>
            <p className="mt-2 text-[15px] font-medium text-slate-600">
              Link clicks are counted separately from views. Destination opens
              outside.
            </p>
          </div>
        </div>
      </Shell>
    );
  if (id === "questions-polls")
    return (
      <Shell
        bg="linear-gradient(135deg,#F5F3FF,#FEF3C7)"
        label="QUESTIONS / POLLS • ASK & VOTE"
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <Phone
            sticker={
              <div className="absolute inset-x-3 top-20 rounded-2xl bg-white p-3 text-left shadow-2xl">
                <p className="flex items-center gap-1.5 text-[13px] font-extrabold">
                  <HelpCircle className="h-4 w-4 text-violet-600" /> POLL •
                  Which one?
                </p>
                <div className="mt-2 space-y-2">
                  <div className="rounded-full bg-violet-600 px-3 py-2 text-[12px] font-bold text-white">
                    ☕ Morning story — 72%
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-2 text-[12px] font-bold">
                    🌙 Night story — 28%
                  </div>
                </div>
                <p className="mt-2 text-[11px] font-bold text-violet-600">
                  LIVE RESULTS • 128 votes
                </p>
              </div>
            }
            tint="linear-gradient(180deg,#8B5CF6,#EC4899)"
          />
          <div className="max-w-[300px] text-center sm:text-left">
            <p className="text-[30px] font-black leading-tight">
              Ask. Vote.
              <br />
              See it live.
            </p>
            <p className="mt-2 text-[15px] font-medium text-slate-600">
              Poll = one vote per viewer. Question = open answer to your inbox.
            </p>
          </div>
        </div>
      </Shell>
    );
  if (id === "mention")
    return (
      <Shell
        bg="linear-gradient(135deg,#EFF6FF,#FCE7F3)"
        label="MENTION • TAG SOMEONE IN YOUR STORY"
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <Phone
            sticker={
              <>
                <div className="absolute left-4 top-24 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-extrabold shadow-xl ring-2 ring-blue-500">
                  <AtSign className="h-3.5 w-3.5 text-blue-600" /> @aarav •
                  TAGGED
                </div>
                <div className="absolute bottom-20 right-3 rounded-full bg-blue-600 px-3 py-1.5 text-[12px] font-extrabold text-white shadow-xl">
                  Mentioned ✓
                </div>
              </>
            }
            tint="linear-gradient(180deg,#38BDF8,#EC4899)"
          />
          <div className="w-full max-w-[320px] space-y-3 text-left">
            <div className="rounded-2xl bg-white p-4 shadow-lg">
              <p className="flex items-center gap-2 text-[15px] font-black">
                <Bell className="h-5 w-5 text-blue-600" /> MENTION SERVICE
              </p>
              <p className="mt-1 text-[13px] font-medium text-slate-600">
                Author tags @user → service sends a notification + a DM.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-900 p-4 text-white shadow-lg">
              <p className="text-[15px] font-black">Add to Story</p>
              <p className="mt-1 text-[13px] text-slate-300">
                Mentioned user can reshare it in one tap.
              </p>
            </div>
            <p className="rounded-xl bg-white/80 px-3 py-2 text-[12px] font-bold text-slate-700">
              🔒 Privacy: only the mentioned user gets the DM. Viewers just see
              the tag.
            </p>
          </div>
        </div>
        <p className="mt-5 text-center text-[19px] font-extrabold">
          Author tags @user → Mention Service → Notification + DM →{" "}
          <span className="text-blue-700">Add to Story.</span>
        </p>
      </Shell>
    );
  if (id === "gif")
    return (
      <Shell
        bg="linear-gradient(135deg,#F5F3FF,#FEF3C7)"
        label="GIF • SEARCH • TAP • STICK IT ON"
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <Phone
            sticker={
              <>
                <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-full bg-white px-3 py-2 text-left shadow-xl">
                  <Search className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="text-[12px] font-bold text-slate-500">
                    Search GIFs… celebrate
                  </span>
                </div>
                <div className="absolute inset-x-3 top-14 grid grid-cols-3 gap-2">
                  {["🎉", "😂", "🔥", "❤️", "✨", "💃"].map((e, i) => (
                    <div
                      key={i}
                      className={`flex h-[44px] items-center justify-center rounded-xl bg-white/95 text-[22px] shadow ${i === 0 ? "ring-4 ring-amber-400" : ""}`}
                    >
                      {e}
                    </div>
                  ))}
                </div>
                <div className="absolute bottom-16 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-extrabold text-white shadow-xl">
                  GIF ADDED ✓
                </div>
              </>
            }
            tint="linear-gradient(180deg,#8B5CF6,#F59E0B)"
          />
          <div className="w-full max-w-[320px] space-y-3 text-left">
            <div className="rounded-2xl bg-white p-4 shadow-lg">
              <p className="text-[15px] font-black">STICKER SERVICE → CDN</p>
              <p className="mt-1 text-[13px] font-medium text-slate-600">
                Search goes to GIPHY / sticker service. It returns a CDN URL.
                The story stores the link, not the file.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-900 p-4 text-white shadow-lg">
              <p className="text-[15px] font-black">Tap to add</p>
              <p className="mt-1 text-[13px] text-slate-300">
                The GIF plays as an overlay on top of the story.
              </p>
            </div>
          </div>
        </div>
        <p className="mt-5 text-center text-[19px] font-extrabold">
          Search GIF → Sticker Service → CDN URL →{" "}
          <span className="text-violet-700">Overlay on Story.</span>
        </p>
      </Shell>
    );
  if (id === "delete-story")
    return (
      <Shell
        bg="linear-gradient(135deg,#FEF2F2,#F8FAFC)"
        label="DELETE • GONE IN 3 STEPS"
      >
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <div className="w-full max-w-[200px] rounded-2xl bg-white p-5 text-center shadow-lg">
            <Trash2 className="mx-auto h-12 w-12 text-red-500" />
            <p className="mt-2 text-[19px] font-black">1 • TRASH</p>
            <p className="text-[13px] text-slate-500">Author taps Delete</p>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[200px] rounded-t-[90px] rounded-b-2xl bg-slate-800 p-5 pt-8 text-center text-white shadow-lg">
            <p className="text-[28px]">🪦</p>
            <p className="mt-1 text-[19px] font-black">2 • TOMBSTONE</p>
            <p className="text-[13px] text-slate-300">“Do not show” marker</p>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[200px] rounded-2xl bg-red-600 p-5 text-center text-white shadow-lg">
            <p className="text-[34px] font-black">404</p>
            <p className="text-[19px] font-black">3 • GONE</p>
            <p className="text-[13px] text-red-100">Feed cleared</p>
          </div>
        </div>
      </Shell>
    );
  if (id === "edit-15-min")
    return (
      <Shell
        bg="linear-gradient(135deg,#F0FDF4,#FEF2F2)"
        label="EDIT • 15-MINUTE WINDOW"
      >
        <div className="mx-auto max-w-[640px]">
          <div className="flex justify-between text-[15px] font-extrabold">
            <span>0 min • Publish</span>
            <span className="text-emerald-700">15 min</span>
            <span className="text-red-600">After → Locked</span>
          </div>
          <div className="mt-3 flex h-[64px] overflow-hidden rounded-full shadow-lg ring-4 ring-white">
            <div className="flex w-[62%] items-center justify-center bg-emerald-500 text-[18px] font-black text-white">
              ✅ YOU CAN EDIT
            </div>
            <div className="flex flex-1 items-center justify-center bg-red-500 text-[16px] font-black text-white">
              🔒 403
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <span className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold shadow">
              ✏️ Caption
            </span>
            <span className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold shadow">
              🏷️ Tags
            </span>
            <span className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold shadow">
              ✨ Stickers
            </span>
            <span className="rounded-full bg-slate-900 px-3 py-1.5 text-[13px] font-bold text-white">
              Photo stays same
            </span>
          </div>
        </div>
      </Shell>
    );
  if (id === "highlights")
    return (
      <Shell
        bg="linear-gradient(135deg,#FFFBEB,#FCE7F3)"
        label="HIGHLIGHTS • STAY AFTER 24H"
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <Phone
            sticker={
              <div className="absolute inset-x-3 top-3 rounded-2xl bg-white/95 p-2 text-center shadow">
                <p className="text-[11px] font-black tracking-widest">
                  ✨ BIRTHDAY • SAVED
                </p>
              </div>
            }
            tint="linear-gradient(180deg,#F59E0B,#EC4899)"
          />
          <div className="w-full max-w-[340px] rounded-2xl bg-white p-4 shadow-xl">
            <p className="text-left text-[14px] font-black">
              On your profile, forever ↓
            </p>
            <div className="mt-3 flex justify-between gap-2">
              {["🎂", "✈️", "🎓", "💛"].map((e, i) => (
                <div key={i} className="text-center">
                  <div className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-linear-to-br from-amber-300 to-pink-400 text-[26px] ring-4 ring-amber-200">
                    {e}
                  </div>
                  <p className="mt-1 text-[11px] font-bold">
                    {["Birthday", "Travel", "College", "Best"][i]}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-xl bg-amber-50 p-2 text-[13px] font-bold text-amber-900">
              Story expires → Highlight stays ✨
            </p>
          </div>
        </div>
      </Shell>
    );
  if (["views", "likes", "replies", "share"].includes(id)) {
    const cfg: Record<
      string,
      {
        n: string;
        label: string;
        bg: string;
        icon: React.ReactNode;
        sub: string;
      }
    > = {
      views: {
        n: "1,248",
        label: "TOTAL VIEWS",
        bg: "linear-gradient(135deg,#EFF6FF,#DBEAFE)",
        icon: <Eye className="h-14 w-14 text-blue-600" />,
        sub: "One row per viewer",
      },
      likes: {
        n: "342",
        label: "LIKES",
        bg: "linear-gradient(135deg,#FDF2F8,#FCE7F3)",
        icon: <Heart className="h-14 w-14 fill-red-500 text-red-500" />,
        sub: "Tap again = unlike",
      },
      replies: {
        n: "58",
        label: "REPLIES",
        bg: "linear-gradient(135deg,#F0FDF4,#DCFCE7)",
        icon: <MessageCircle className="h-14 w-14 text-emerald-600" />,
        sub: "Goes to author inbox",
      },
      share: {
        n: "96",
        label: "SHARES",
        bg: "linear-gradient(135deg,#F5F3FF,#EDE9FE)",
        icon: <Share2 className="h-14 w-14 text-violet-600" />,
        sub: "Same rules, new viewer",
      },
    };
    const c = cfg[id];
    return (
      <Shell bg={c.bg} label={c.label}>
        <div className="flex flex-col items-center gap-4 py-3 text-center">
          <div className="flex h-[104px] w-[104px] items-center justify-center rounded-full bg-white shadow-xl">
            {c.icon}
          </div>
          <p className="text-[64px] font-black leading-none tracking-tight sm:text-[88px]">
            {c.n}
          </p>
          <p className="rounded-full bg-slate-900 px-4 py-1.5 text-[14px] font-extrabold tracking-[0.18em] text-white">
            {c.label}
          </p>
          <p className="text-[16px] font-bold text-slate-600">{c.sub}</p>
        </div>
      </Shell>
    );
  }
  if (id === "navigation")
    return (
      <Shell
        bg="linear-gradient(135deg,#EFF6FF,#FEF3C7)"
        label="NAVIGATION • WHERE DID THEY GO?"
      >
        <div className="mx-auto max-w-[620px] space-y-3">
          {[
            { l: "▶ NEXT / FORWARD", v: "68%", w: "92%", c: "bg-emerald-500" },
            { l: "◀ BACK / REWATCH", v: "22%", w: "58%", c: "bg-blue-600" },
            { l: "✕ EXITED", v: "10%", w: "32%", c: "bg-red-500" },
          ].map((r) => (
            <div key={r.l}>
              <div className="mb-1 flex justify-between text-[15px] font-extrabold">
                <span>{r.l}</span>
                <span>{r.v}</span>
              </div>
              <div className="h-[48px] overflow-hidden rounded-full bg-white shadow">
                <div
                  className={`flex h-full items-center justify-end pr-4 text-[15px] font-black text-white ${r.c}`}
                  style={{ width: r.w }}
                >
                  {r.v}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[18px] font-extrabold">
          Funnel narrows = attention ends here.
        </p>
      </Shell>
    );
  if (id === "stats-demographics")
    return (
      <Shell
        bg="linear-gradient(135deg,#F0FDF4,#EFF6FF)"
        label="STATS • WHO WATCHED? • TOTALS ONLY"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              t: "GENDER",
              rows: [
                ["Women", "62%", "bg-pink-500"],
                ["Men", "38%", "bg-blue-500"],
              ],
            },
            {
              t: "COUNTRY",
              rows: [
                ["India", "58%", "bg-orange-500"],
                ["Other", "42%", "bg-teal-500"],
              ],
            },
            {
              t: "AGE",
              rows: [
                ["18–24", "54%", "bg-violet-500"],
                ["25–34", "46%", "bg-emerald-500"],
              ],
            },
          ].map((g) => (
            <div key={g.t} className="rounded-2xl bg-white p-4 shadow-lg">
              <p className="text-[13px] font-black tracking-[0.16em] text-slate-500">
                {g.t}
              </p>
              <div className="mt-3 space-y-3">
                {g.rows.map(([l, v, c]) => (
                  <div key={l}>
                    <div className="flex justify-between text-[14px] font-bold">
                      <span>{l}</span>
                      <span>{v}</span>
                    </div>
                    <div className="mt-1 h-[22px] overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full ${c}`} style={{ width: v }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[15px] font-bold text-slate-600">
          🔒 No names. No single person. Only totals.
        </p>
      </Shell>
    );
  if (id === "clicks")
    return (
      <Shell
        bg="linear-gradient(135deg,#FFFBEB,#FEE2E2)"
        label="CLICKS • WHERE DID THEY TAP?"
      >
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center">
          <div className="relative mx-auto w-[230px] overflow-hidden rounded-[28px] border-[5px] border-slate-900 bg-linear-to-b from-sky-300 to-amber-200 p-3 shadow-2xl">
            <p className="rounded-xl bg-white p-2 text-center text-[12px] font-extrabold">
              STORY WITH LINK STICKER
            </p>
            <div className="relative mt-3 h-[220px]">
              <span className="absolute left-6 top-6 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/90 text-[13px] font-black text-white shadow-xl ring-4 ring-red-300">
                42
              </span>
              <span className="absolute bottom-10 right-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-500/90 text-[15px] font-black text-white shadow-xl ring-4 ring-orange-300">
                68 🔗
              </span>
              <span className="absolute left-10 bottom-4 flex h-8 w-8 items-center justify-center rounded-full bg-yellow-400 text-[11px] font-black shadow">
                9
              </span>
            </div>
          </div>
          <div className="max-w-[280px] text-center sm:text-left">
            <p className="text-[44px] font-black leading-none">
              10% <span className="text-[22px]">CTR</span>
            </p>
            <p className="mt-2 text-[15px] font-bold text-slate-600">
              100 viewed → 10 tapped the link.
              <br />
              Big dot = hot spot.
            </p>
            <span className="mt-3 inline-block rounded-full bg-red-500 px-4 py-2 text-[13px] font-extrabold text-white">
              🔥 LINK = HOTTEST
            </span>
          </div>
        </div>
      </Shell>
    );
  if (id === "instagram-plus")
    return (
      <GoldShell label="INSTAGRAM PLUS • PREMIUM BRIDGE">
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <span className="rounded-2xl bg-white px-5 py-4 text-[18px] font-black shadow">
            FREE
            <br />
            <span className="text-[13px] font-medium text-slate-500">
              Core analytics
            </span>
          </span>
          <ArrowRight className="h-8 w-8 rotate-90 sm:rotate-0" />
          <span className="rounded-2xl bg-slate-900 px-5 py-4 text-[18px] font-black text-amber-300 shadow-xl ring-4 ring-amber-300">
            PLUS • ₹99
            <span className="block text-[13px] font-medium text-white">
              Rewatch • Search • 48h
            </span>
          </span>
          <ArrowRight className="h-8 w-8 rotate-90 sm:rotate-0" />
          <span className="rounded-2xl bg-white px-5 py-4 text-[18px] font-black shadow">
            META ONE
            <br />
            <span className="text-[13px] font-medium text-slate-500">
              ₹549 • Full suite
            </span>
          </span>
        </div>
        <p className="text-[20px] font-extrabold">
          Free stays free. Plus goes further.
        </p>
      </GoldShell>
    );
  if (id === "hot-reads-cache")
    return (
      <Shell
        bg="linear-gradient(135deg,#FEF2F2,#FFFBEB)"
        label="HOT READS CACHE • REDIS"
      >
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <div className="w-full max-w-[240px] rounded-2xl bg-white p-4 text-center shadow">
            <Users className="mx-auto h-9 w-9 text-slate-700" />
            <p className="mt-1 font-black">FEED ASKS</p>
            <p className="text-[13px] text-slate-500">“Show me stories”</p>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[280px] rounded-2xl bg-red-600 p-5 text-center text-white shadow-2xl">
            <p className="flex items-center justify-center gap-2 text-[26px] font-black">
              <Flame className="h-8 w-8 fill-amber-300 text-amber-300" /> REDIS
            </p>
            <p className="mt-1 text-[13px] font-bold text-red-100">
              HOT • In memory • 12ms
            </p>
            <div className="mt-3 rounded-xl bg-white/15 p-2 text-[13px] font-bold">
              🔥 92% hits served here
            </div>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[220px] rounded-2xl bg-slate-100 p-4 text-center shadow">
            <Snowflake className="mx-auto h-9 w-9 text-blue-500" />
            <p className="mt-1 font-black">COLD DB</p>
            <p className="text-[13px] text-slate-500">Only if not in cache</p>
          </div>
        </div>
      </Shell>
    );
  if (id === "cache-manage")
    return (
      <Shell
        bg="linear-gradient(135deg,#EFF6FF,#FEF3C7)"
        label="CACHE MANAGE • SET • READ • EXPIRE • EVICT"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { e: "✍️", t: "SET", d: "Save it" },
            { e: "👀", t: "READ", d: "Serve fast" },
            { e: "⏰", t: "EXPIRE", d: "Time’s up" },
            { e: "🗑️", t: "EVICT", d: "Remove it" },
          ].map((s, i) => (
            <div
              key={s.t}
              className="rounded-2xl bg-white p-4 text-center shadow-lg"
            >
              <p className="text-[34px]">{s.e}</p>
              <p className="mt-1 text-[18px] font-black">
                {i + 1} • {s.t}
              </p>
              <p className="text-[13px] text-slate-500">{s.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[19px] font-extrabold">
          Small cache. Fresh data.{" "}
          <span className="text-blue-700">Old copies never stay.</span>
        </p>
      </Shell>
    );
  if (id === "tombstone")
    return (
      <Shell
        bg="linear-gradient(135deg,#F1F5F9,#FEE2E2)"
        label="TOMBSTONE • DO NOT SHOW"
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <div className="relative w-[210px] rounded-t-[110px] rounded-b-2xl bg-slate-800 px-4 pb-5 pt-10 text-center text-white shadow-2xl">
            <p className="text-[42px]">🪦</p>
            <p className="mt-1 text-[20px] font-black">DELETED</p>
            <p className="text-[12px] text-slate-300">Story #4821 • Gone</p>
            <span className="absolute -right-3 top-6 rotate-12 rounded-md border-4 border-red-500 px-2 py-1 text-[14px] font-black text-red-500 bg-white">
              DELETED
            </span>
          </div>
          <div className="max-w-[300px] text-center sm:text-left">
            <p className="text-[28px] font-black leading-tight">
              A tiny marker
              <br />
              stops an old copy.
            </p>
            <p className="mt-2 text-[15px] font-medium text-slate-600">
              Reader checks tombstone first → never shows deleted story.
            </p>
          </div>
        </div>
      </Shell>
    );
  if (id === "archive-old-stories")
    return (
      <Shell
        bg="linear-gradient(135deg,#EFF6FF,#FEF3C7)"
        label="ARCHIVE • ONLY YOU CAN SEE IT"
      >
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <div className="w-full max-w-[200px] rounded-2xl bg-white p-4 text-center shadow">
            <Clock3 className="mx-auto h-9 w-9 text-amber-500" />
            <p className="mt-1 text-[18px] font-black">24h LIVE</p>
            <p className="text-[13px] text-slate-500">Everyone sees it</p>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[230px] rounded-2xl bg-slate-900 p-4 text-center text-white shadow-xl">
            <Archive className="mx-auto h-9 w-9 text-amber-300" />
            <p className="mt-1 text-[18px] font-black">ARCHIVE BOX</p>
            <p className="text-[13px] text-slate-300">🔒 Only author</p>
          </div>
          <FlowArrow />
          <div className="w-full max-w-[200px] rounded-2xl bg-amber-300 p-4 text-center shadow">
            <Star className="mx-auto h-9 w-9 text-amber-900" />
            <p className="mt-1 text-[18px] font-black">HIGHLIGHT</p>
            <p className="text-[13px] text-amber-900">Restore anytime</p>
          </div>
        </div>
      </Shell>
    );
  if (id === "expire-24h")
    return (
      <Shell
        bg="linear-gradient(135deg,#FEF3C7,#FEE2E2)"
        label="EXPIRE 24H • COUNTDOWN"
      >
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <div className="relative flex h-[210px] w-[210px] items-center justify-center">
            <svg
              viewBox="0 0 200 200"
              className="absolute inset-0 h-full w-full -rotate-90"
            >
              <circle
                cx="100"
                cy="100"
                r="84"
                fill="white"
                stroke="#E2E8F0"
                strokeWidth="18"
              />
              <circle
                cx="100"
                cy="100"
                r="84"
                fill="none"
                stroke="#F59E0B"
                strokeWidth="18"
                strokeDasharray="528"
                strokeDashoffset="120"
                strokeLinecap="round"
              />
            </svg>
            <div className="relative text-center">
              <p className="text-[42px] font-black leading-none">04:12</p>
              <p className="mt-1 text-[13px] font-extrabold tracking-widest">
                HOURS LEFT
              </p>
            </div>
          </div>
          <div className="max-w-[280px] text-center sm:text-left">
            <p className="flex items-center justify-center gap-2 text-[28px] font-black sm:justify-start">
              <Timer className="h-8 w-8 text-amber-600" /> Then it moves.
            </p>
            <p className="mt-2 text-[15px] font-medium text-slate-600">
              10 AM today → 10 AM tomorrow. Not deleted — archived.
            </p>
            <span className="mt-3 inline-block rounded-full bg-slate-900 px-4 py-2 text-[13px] font-bold text-white">
              Publish → 24h → Archive
            </span>
          </div>
        </div>
      </Shell>
    );
  if (id === "highlights-copy")
    return (
      <Shell
        bg="linear-gradient(135deg,#FFFBEB,#FCE7F3)"
        label="HIGHLIGHTS COPY • ORIGINAL STAYS SAFE"
      >
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <div className="w-full max-w-[210px] rounded-2xl bg-white p-4 text-center shadow">
            <p className="text-[28px]">📸</p>
            <p className="mt-1 text-[17px] font-black">ORIGINAL</p>
            <p className="text-[13px] text-slate-500">In Archive</p>
          </div>
          <div className="flex flex-col items-center px-2">
            <Copy className="h-8 w-8" />
            <p className="mt-1 rounded-full bg-slate-900 px-3 py-1 text-[12px] font-bold text-white">
              COPY →
            </p>
          </div>
          <div className="w-full max-w-[210px] rounded-2xl bg-amber-300 p-4 text-center shadow">
            <p className="text-[28px]">⭐</p>
            <p className="mt-1 text-[17px] font-black">HIGHLIGHT COPY</p>
            <p className="text-[13px] text-amber-900">Own cover • Own order</p>
          </div>
        </div>
        <p className="mt-4 text-center text-[18px] font-extrabold">
          Delete the highlight ≠ delete the archive.
        </p>
      </Shell>
    );
  if (id === "rewatch-count")
    return (
      <GoldShell label="META ONE • REWATCH COUNT">
        <div className="flex items-end gap-6">
          <div className="text-center">
            <div className="flex h-[110px] w-[110px] items-center justify-center rounded-full bg-white text-[26px] font-black shadow-xl ring-8 ring-slate-200">
              50
            </div>
            <p className="mt-2 text-[13px] font-extrabold">FIRST VIEWS</p>
          </div>
          <div className="text-center">
            <div className="flex h-[150px] w-[150px] items-center justify-center rounded-full bg-slate-900 text-[34px] font-black text-amber-300 shadow-2xl ring-8 ring-amber-300">
              12 ↻
            </div>
            <p className="mt-2 text-[13px] font-extrabold">CAME BACK</p>
          </div>
        </div>
        <p className="text-[24px] font-black">
          They didn’t just watch. They came back.
        </p>
      </GoldShell>
    );
  if (id === "viewer-search")
    return (
      <GoldShell label="META ONE • VIEWER SEARCH">
        <div className="w-full max-w-[420px] rounded-2xl bg-white p-4 text-left shadow-xl">
          <div className="flex items-center gap-2 rounded-full bg-amber-50 px-4 py-3 ring-2 ring-amber-300">
            <Search className="h-5 w-5 text-amber-600" />
            <span className="text-[16px] font-bold">
              Search viewer… <span className="text-amber-600">| aarav</span>
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {["Aarav Sharma • @aarav", "Aaradhya • @aara"].map((n) => (
              <div
                key={n}
                className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-300 font-black">
                  A
                </span>
                <span className="text-[15px] font-bold">{n}</span>
                <span className="ml-auto text-[12px] font-bold text-emerald-600">
                  FOUND ✓
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[22px] font-black">
          Find one person in 1,000 viewers.
        </p>
      </GoldShell>
    );
  if (id === "extend-48h")
    return (
      <GoldShell label="META ONE • EXTEND TO 48 HOURS">
        <div className="w-full max-w-[560px]">
          <div className="flex justify-between text-[15px] font-extrabold">
            <span>0h</span>
            <span>24h • Normal end</span>
            <span className="text-amber-700">48h • PLUS ✨</span>
          </div>
          <div className="mt-2 flex h-[56px] overflow-hidden rounded-full shadow-lg">
            <div className="w-1/2 bg-white flex items-center justify-center font-black">
              LIVE • 24h
            </div>
            <div className="flex-1 bg-slate-900 text-amber-300 flex items-center justify-center font-black">
              + 24h MORE ✨
            </div>
          </div>
          <p className="mt-3 text-[19px] font-extrabold">
            One strong story. One more day.
          </p>
        </div>
      </GoldShell>
    );
  if (id === "spotlight")
    return (
      <GoldShell label="META ONE • STORY SPOTLIGHT">
        <div className="relative flex h-[150px] w-[150px] items-center justify-center rounded-full bg-slate-900 shadow-2xl ring-8 ring-amber-300">
          <Star className="h-16 w-16 fill-amber-300 text-amber-300" />
          <span className="absolute -right-3 -top-2 rounded-full bg-amber-400 px-2 py-1 text-[11px] font-black">
            WEEKLY PICK
          </span>
        </div>
        <p className="text-[26px] font-black leading-tight">
          One story. Chosen weekly.
          <br />
          Seen by a wider audience.
        </p>
      </GoldShell>
    );
  if (id === "custom-lists")
    return (
      <GoldShell label="META ONE • CUSTOM LISTS">
        <div className="grid w-full max-w-[520px] grid-cols-3 gap-3">
          {[
            { e: "💼", t: "Work Friends", n: "12 people" },
            { e: "👨‍👩‍👧", t: "Family", n: "8 people" },
            { e: "🏏", t: "Cricket Crew", n: "21 people" },
          ].map((l) => (
            <div
              key={l.t}
              className="rounded-2xl bg-white p-4 text-center shadow-lg"
            >
              <p className="text-[30px]">{l.e}</p>
              <p className="mt-1 text-[15px] font-black">{l.t}</p>
              <p className="text-[12px] font-medium text-slate-500">{l.n}</p>
            </div>
          ))}
        </div>
        <p className="text-[22px] font-black">
          One story → one list. No repost needed.
        </p>
      </GoldShell>
    );
  if (id === "anonymous-preview")
    return (
      <GoldShell label="META ONE • ANONYMOUS PREVIEW">
        <div className="flex items-center gap-4">
          <div className="flex h-[110px] w-[110px] items-center justify-center rounded-full bg-white shadow-xl">
            <EyeOff className="h-12 w-12 text-slate-900" />
          </div>
          <div className="text-left">
            <p className="text-[28px] font-black leading-tight">
              Preview like
              <br />a viewer.
            </p>
            <p className="mt-1 text-[14px] font-bold text-slate-600">
              No view recorded. No name shown.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-slate-900 px-4 py-2 text-[13px] font-bold text-white">
          👁️‍🗨️ 0 views added • Safe to check
        </span>
      </GoldShell>
    );
  return (
    <Shell
      bg="linear-gradient(135deg,#EFF6FF,#FEF3C7)"
      label={info.visualTitle.toUpperCase()}
    >
      <p className="py-10 text-center text-[24px] font-black">
        {info.visualTitle}
      </p>
    </Shell>
  );
}

function DetailPage({
  info,
  onOpen,
  onHome,
}: {
  info: Detail;
  onOpen: (id: string) => void;
  onHome: (toMeta?: boolean) => void;
}) {
  const idx = DETAILS.findIndex((d) => d.id === info.id);
  const prev = idx > 0 ? DETAILS[idx - 1] : null;
  const next = idx < DETAILS.length - 1 ? DETAILS[idx + 1] : null;
  const column =
    columns.find((c) => c.items.some((i) => i?.id === info.id))?.title ??
    (info.kicker.includes("META ONE")
      ? "Meta One"
      : info.kicker.includes("BASICS")
        ? "BASICS"
        : "Detail");
  return (
    <section
      aria-label={`${info.title} detail page`}
      className="mx-auto max-w-[920px] pb-4"
    >
      <nav
        aria-label="Breadcrumb"
        className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-slate-500"
      >
        <button
          type="button"
          onClick={() => onHome()}
          className="hover:text-[#0F172A] hover:underline"
        >
          Home Tree
        </button>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{column}</span>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="font-bold text-[#0F172A]">{info.title}</span>
      </nav>
      <p className="text-[12px] font-bold tracking-[0.16em] text-slate-500">
        {info.kicker}
      </p>
      <h2 className="mt-1 whitespace-pre-line text-[28px] font-black leading-[1.1] tracking-tight text-[#0F172A] [overflow-wrap:anywhere] sm:text-[38px]">
        {info.title}
      </h2>
      <div className="mt-5">
        <HeroVisual info={info} />
      </div>
      <section
        aria-label={`${info.title} key points`}
        className="mt-5 rounded-[18px] border border-slate-200 bg-white p-5 sm:p-6"
      >
        <h3 className="text-[13px] font-black tracking-[0.18em] text-slate-500">
          IN 3 POINTS
        </h3>
        <ul className="mt-3 space-y-2.5">
          {info.bullets.slice(0, 3).map((b) => (
            <li
              key={b}
              className="flex gap-3 text-[17px] font-medium leading-snug text-slate-800"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="[overflow-wrap:anywhere]">{b}</span>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-label={`${info.title} example`}
        className="mt-5 rounded-[18px] border border-amber-200 bg-[#FFFBEB] p-5 sm:p-6"
      >
        <h3 className="text-[13px] font-black tracking-[0.18em] text-amber-800">
          EXAMPLE
        </h3>
        <p className="mt-2 text-[16px] font-medium leading-snug text-slate-800 [overflow-wrap:anywhere]">
          {info.example.replace(/^Example:\s*/, "")}
        </p>
      </section>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {prev ? (
          <button
            type="button"
            onClick={() => onOpen(prev.id)}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-[14px] font-semibold text-[#0F172A] hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> {prev.title}
          </button>
        ) : (
          <span />
        )}
        {next && (
          <button
            type="button"
            onClick={() => onOpen(next.id)}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0F172A] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[#1E293B]"
          >
            {next.title} <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-[14px] border border-slate-200 bg-white px-5 py-4">
        <p className="text-[14px] font-semibold text-[#0F172A]">
          Finished here? Return to the full tree.
        </p>
        <button
          type="button"
          onClick={() => onHome()}
          className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-[#0F172A] px-5 py-2.5 text-[14px] font-bold text-[#0F172A] hover:bg-[#0F172A] hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Tree
        </button>
      </div>
    </section>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window !== "undefined" ? readIdFromHash() : null,
  );
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim().toLowerCase();
  const searchResults = trimmedQuery
    ? DETAILS.filter((d) => d.title.toLowerCase().includes(trimmedQuery))
    : [];
  const journeySteps = [
    {
      step: "STEP 1",
      title: "Create",
      sub: "Publish a story",
      target: "Basics page",
      id: "basics-overview",
    },
    {
      step: "STEP 2",
      title: "Audience Dekhta Hai",
      sub: "Views, likes and replies",
      target: "Audience — Views",
      id: "views",
    },
    {
      step: "STEP 3",
      title: "Author Manage Karta Hai",
      sub: "Edit, delete and highlights",
      target: "Author — Delete",
      id: "delete-story",
    },
    {
      step: "STEP 4",
      title: "Expire / Archive",
      sub: "24 hours, then archive",
      target: "Expire page",
      id: "expire-24h",
    },
  ];
  useEffect(() => {
    const onHash = () => {
      setSelectedId(readIdFromHash());
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const open = useCallback((id: string) => {
    if (BY_ID[id]) window.location.hash = `#/page/${id}`;
  }, []);
  const goHome = useCallback((scrollToMeta = false) => {
    if (window.location.hash) window.location.hash = "";
    else setSelectedId(null);
    if (scrollToMeta)
      window.setTimeout(
        () =>
          document
            .getElementById("meta-one")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        80,
      );
    else window.scrollTo({ top: 0, behavior: "auto" });
  }, []);
  const detail = selectedId ? BY_ID[selectedId] : null;
  return (
    <div
      data-safe-area-inset-root
      style={{
        boxSizing: "border-box",
        paddingTop: "var(--safe-area-inset-top)",
      }}
      className="min-h-[100dvh] w-full overflow-x-clip bg-white text-[#1E293B]"
    >
      <header
        data-safe-area-sticky-top
        style={{ top: "var(--safe-area-inset-top)" }}
        className="sticky z-20 border-b border-slate-200 bg-white"
      >
        <div className="mx-auto flex max-w-[1640px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          {detail ? (
            <>
              <button
                type="button"
                onClick={() => goHome()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-[14px] font-semibold text-[#0F172A] hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
              </button>
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-[0.16em] text-slate-500">
                  {detail.kicker}
                </p>
                <h1 className="truncate text-[17px] font-bold leading-tight text-[#0F172A] [overflow-wrap:anywhere]">
                  {detail.title}
                </h1>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => goHome()}
              className="min-w-0 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]"
            >
              <h1 className="text-[18px] font-bold leading-tight text-[#0F172A] [overflow-wrap:anywhere]">
                How Story Works
              </h1>
              <p className="text-[13px] text-slate-500">
                Instagram Story System
              </p>
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1640px] px-4 pb-10 pt-6 sm:px-6 sm:pt-8 lg:px-8">
        {!detail ? (
          <>
            <section
              aria-label="Part 1 — Search and Story Journey"
              className="mb-6 rounded-[16px] border border-slate-200 bg-white px-4 py-5 shadow-sm sm:px-6"
            >
              <p className="text-[11px] font-bold tracking-[0.18em] text-slate-500">
                PART 1 • START HERE
              </p>
              <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <h2 className="text-[26px] font-black leading-tight tracking-tight text-[#0F172A] sm:text-[32px]">
                    How Story Works
                  </h2>
                  <p className="mt-1 text-[15px] leading-relaxed text-slate-600">
                    Instagram Story System — search a topic, then follow the
                    journey left to right.
                  </p>
                </div>
                <div className="relative w-full shrink-0 lg:w-[420px]">
                  <label htmlFor="home-search" className="sr-only">
                    Search story topics
                  </label>
                  <div className="flex items-center gap-2 rounded-full border-2 border-slate-300 bg-white px-4 py-3 focus-within:border-[#0F172A]">
                    <Search
                      className="h-5 w-5 shrink-0 text-slate-500"
                      aria-hidden="true"
                    />
                    <input
                      id="home-search"
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search — try Mention, GIF, Views…"
                      className="w-full min-w-0 bg-transparent text-[16px] font-medium text-[#0F172A] outline-none placeholder:text-slate-400"
                    />
                  </div>
                  {trimmedQuery && (
                    <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-xl">
                      <p className="border-b border-slate-100 px-4 py-2.5 text-[12px] font-bold tracking-[0.12em] text-slate-500">
                        {searchResults.length} RESULT
                        {searchResults.length === 1 ? "" : "S"}
                      </p>
                      {searchResults.length > 0 ? (
                        <ul className="max-h-[320px] overflow-y-auto">
                          {searchResults.map((result) => (
                            <li
                              key={result.id}
                              className="border-b border-slate-100 last:border-b-0"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setQuery("");
                                  open(result.id);
                                }}
                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100"
                              >
                                <span className="min-w-0">
                                  <span className="block text-[12px] font-bold tracking-[0.12em] text-slate-500">
                                    {result.kicker}
                                  </span>
                                  <span className="mt-0.5 block text-[16px] font-bold leading-snug text-[#0F172A] [overflow-wrap:anywhere]">
                                    {result.title}
                                  </span>
                                </span>
                                <ArrowRight
                                  className="h-5 w-5 shrink-0 text-slate-400"
                                  aria-hidden="true"
                                />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-4 py-4 text-[15px] font-medium text-slate-600">
                          No card matches “{query.trim()}”. Try Mention, GIF,
                          Views or Cache.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-6 border-t border-slate-200 pt-5">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-[18px] font-bold text-[#0F172A]">
                    Story Journey
                  </h3>
                  <p className="text-[14px] text-slate-500">
                    Tap a step to open its page.
                  </p>
                </div>
                <ol className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
                  {journeySteps.map((item, i) => (
                    <React.Fragment key={item.id}>
                      <li className="flex-1">
                        <button
                          type="button"
                          onClick={() => open(item.id)}
                          aria-label={`Open ${item.target} — ${item.title}`}
                          className="group flex h-full min-h-[148px] w-full flex-col justify-between rounded-[14px] border-2 border-slate-200 bg-white px-5 py-4 text-left transition hover:border-[#0F172A] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]"
                        >
                          <span>
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#0F172A] text-[15px] font-black text-white">
                              {i + 1}
                            </span>
                            <span className="mt-3 block text-[11px] font-bold tracking-[0.16em] text-slate-500">
                              {item.step}
                            </span>
                            <span className="mt-1 block text-[20px] font-black leading-tight text-[#0F172A] [overflow-wrap:anywhere]">
                              {item.title}
                            </span>
                            <span className="mt-1 block text-[14px] leading-snug text-slate-600 [overflow-wrap:anywhere]">
                              {item.sub}
                            </span>
                          </span>
                          <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-[#0F172A]">
                            Open {item.target}{" "}
                            <ArrowRight
                              className="h-4 w-4 transition group-hover:translate-x-0.5"
                              aria-hidden="true"
                            />
                          </span>
                        </button>
                      </li>
                      {i < journeySteps.length - 1 && (
                        <li
                          aria-hidden="true"
                          className="hidden shrink-0 items-center lg:flex"
                        >
                          <ArrowRight className="h-7 w-7 text-slate-400" />
                        </li>
                      )}
                    </React.Fragment>
                  ))}
                </ol>
              </div>
            </section>
            <section
              aria-label="Part 2 — The complete story system tree"
              className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm sm:p-4 lg:p-5"
            >
              <p className="px-1 pb-2 text-[11px] font-bold tracking-[0.18em] text-slate-500">
                PART 2 • THE FULL TREE
              </p>
              <div className="mb-4 flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-display text-[18px] font-bold text-[#0F172A]">
                  The complete system at a glance
                </h2>
                <p className="text-[13px] text-slate-500">
                  7 columns &nbsp;•&nbsp; Equal gaps &nbsp;•&nbsp; Aligned
                  columns &nbsp;•&nbsp; Up to 6 cards in Extra Features
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 xl:gap-4">
                {columns.map((col) => {
                  const Icon = col.icon;
                  return (
                    <section
                      key={col.title}
                      aria-label={col.title}
                      className="flex min-w-0 flex-col gap-4"
                    >
                      {col.headerId ? (
                        <button
                          type="button"
                          onClick={() => open(col.headerId!)}
                          aria-label={`Open Basics — Story Banane Ke Liye Kya Chahiye detail page — route #/page/${col.headerId}`}
                          className="group relative flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] px-2 text-center ring-2 ring-transparent transition hover:ring-[#0F172A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]"
                          style={{ backgroundColor: col.tint }}
                        >
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#92400E] bg-[#FFD700] px-2.5 py-0.5 text-[10px] font-black tracking-[0.12em] text-[#0F172A] shadow-sm">
                            ★ START HERE
                          </span>
                          <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.18em] text-[#0F172A]">
                            <Icon className="h-4 w-4" aria-hidden="true" />{" "}
                            {col.num}{" "}
                            <span className="rounded-full bg-white px-2 py-0.5 text-[9px] tracking-wider">
                              OPEN BASICS PAGE
                            </span>
                          </span>
                          <span className="font-display text-[14px] font-extrabold leading-tight tracking-[0.04em] text-[#0F172A] [overflow-wrap:anywhere]">
                            {col.title}
                          </span>
                        </button>
                      ) : (
                        <div
                          className="flex h-[72px] flex-col items-center justify-center gap-1 rounded-[10px] px-2 text-center"
                          style={{ backgroundColor: col.tint }}
                        >
                          <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.18em] text-[#0F172A]">
                            <Icon className="h-4 w-4" aria-hidden="true" />{" "}
                            {col.num}
                          </span>
                          <h3 className="font-display text-[14px] font-extrabold leading-tight tracking-[0.04em] text-[#0F172A] [overflow-wrap:anywhere]">
                            {col.title}
                          </h3>
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-4">
                        {col.items.map((item, idx) =>
                          item ? (
                            <CardButton
                              key={item.id}
                              detail={item}
                              onOpen={open}
                            />
                          ) : (
                            <div
                              key={`${col.title}-spacer-${idx}`}
                              aria-hidden="true"
                              className="invisible flex min-h-[92px] flex-1 items-center justify-center rounded-[10px] px-3 py-4"
                            >
                              <span className="text-[15px]">Spacer</span>
                            </div>
                          ),
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-col gap-2 rounded-[10px] bg-[#F8FAFC] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                  <Check
                    className="h-4 w-4 shrink-0 text-[#0F172A]"
                    aria-hidden="true"
                  />
                  <span>
                    Analytics links downward: the{" "}
                    <strong className="text-[#0F172A]">Instagram Plus</strong>{" "}
                    block is separate from the core flow.
                  </span>
                </p>
                <span className="text-[12px] font-semibold tracking-[0.14em] text-slate-500">
                  ↓ &nbsp;SEE META ONE BELOW
                </span>
              </div>
            </section>
            <section
              id="meta-one"
              aria-label="Part 3 — META ONE premium block"
              className="mt-6 rounded-[20px] border-2 border-[#D4A017] bg-white p-5 shadow-sm sm:p-6"
            >
              <p className="pb-2 text-[11px] font-bold tracking-[0.18em] text-slate-500">
                PART 3 • PREMIUM
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-[0.16em] text-[#92400E]">
                    PREMIUM
                  </p>
                  <h2 className="mt-1 flex items-center gap-2 text-[20px] font-bold leading-tight text-[#0F172A] [overflow-wrap:anywhere]">
                    <Crown
                      className="h-5 w-5 text-[#D4A017]"
                      aria-hidden="true"
                    />{" "}
                    Meta One — Instagram Plus
                  </h2>
                  <p className="mt-1 text-[14px] leading-relaxed text-slate-600 [overflow-wrap:anywhere]">
                    Paid layer on Instagram, part of Meta One. Tap any feature
                    to open its own page.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <span className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[13px] font-semibold text-[#0F172A]">
                    Plus · Rs 99/mo
                  </span>
                  <span className="rounded-full border border-[#D4A017] bg-[#FFFBEB] px-3 py-1.5 text-[13px] font-semibold text-[#92400E]">
                    Meta One · Rs 549/mo
                  </span>
                </div>
              </div>
              <div
                className="my-5 h-px w-full bg-slate-200"
                aria-hidden="true"
              />
              <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {metaOne.map((item) => {
                  const Icon = metaIcons[item.id] ?? Eye;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => open(item.id)}
                      aria-label={`Open ${item.title} detail page — route #/page/${item.id}`}
                      className="group relative flex min-h-[192px] cursor-pointer flex-col items-center overflow-hidden rounded-[16px] border border-slate-200 bg-white px-4 pb-5 pt-6 text-center transition hover:border-[#D4A017] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A017]"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-[3px] bg-[#D4A017]"
                      />
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#FEF3C7] text-[#92400E]">
                        <Icon className="h-6 w-6" aria-hidden="true" />
                      </span>
                      <h3 className="mt-4 text-[15px] font-bold leading-snug text-[#0F172A] [overflow-wrap:anywhere]">
                        {item.title}
                      </h3>
                      <p className="mt-2 text-[13px] leading-[1.55] text-slate-600 [overflow-wrap:anywhere]">
                        {item.example.replace("Example: ", "")}
                      </p>
                      <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[#92400E]">
                        Open page{" "}
                        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-5 border-t border-slate-200 pt-4 text-center text-[11px] font-semibold tracking-[0.16em] text-slate-500">
                META ONE IS SEPARATE &nbsp;•&nbsp; NOT PART OF THE CORE 7-COLUMN
                FLOW &nbsp;•&nbsp; INSTAGRAM PLUS
              </p>
            </section>
          </>
        ) : (
          <DetailPage info={detail} onOpen={open} onHome={goHome} />
        )}
        <footer className="mt-6 flex flex-col gap-2 px-1 text-center text-[12.5px] leading-relaxed text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <span>Simple diagram — one idea at a time.</span>
          <span className="font-semibold text-slate-600">
            White &nbsp;•&nbsp; Generous whitespace &nbsp;•&nbsp; Large readable
            text
          </span>
        </footer>
      </main>
    </div>
  );
}
