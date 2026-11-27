import { useEffect, useState } from "react";
import { ArrowRight, Boxes, Check, Layers, Play } from "lucide-react";
import CoreElements from "./core/CoreElements";
import FeaturesExplorer from "./features/FeaturesExplorer";
import TechStack from "./tech/TechStack";

type Mode = "home" | "core" | "features" | "tech";

type Track = {
  id: Exclude<Mode, "home">;
  kicker: string;
  title: string;
  sub: string;
  points: string[];
  route: string;
};

const TRACK_ICONS = {
  core: Layers,
  features: Play,
  tech: Boxes,
} as const;

const TRACKS: Track[] = [
  {
    id: "core",
    kicker: "TRACK 1",
    title: "Core Elements",
    sub: "The story system at a glance: the 4-step journey, the full 7-column tree, and the Meta One premium block.",
    points: [
      "Story journey in 4 steps",
      "The complete system tree",
      "Meta One premium features",
    ],
    route: "#/core",
  },
  {
    id: "features",
    kicker: "TRACK 2",
    title: "Features",
    sub: "Nine animated flows with DB and cache at every step, from create to the Plus-only features.",
    points: [
      "Play any flow step by step",
      "DB and cache at every step",
      "Normal vs celebrity scale",
    ],
    route: "#/features",
  },
  {
    id: "tech",
    kicker: "PHASE 3",
    title: "Technologies",
    sub: "The full stack on one map: seven layers, which tech sits in each, and the scale problem it removes.",
    points: [
      "Seven layers, one job each",
      "Read path vs write path",
      "MongoDB vs ScyllaDB call",
    ],
    route: "#/tech",
  },
];

function readModeFromHash(): Mode {
  if (typeof window === "undefined") return "home";
  const hash = window.location.hash;
  if (hash.startsWith("#/core")) return "core";
  if (hash.startsWith("#/features")) return "features";
  if (hash.startsWith("#/tech")) return "tech";
  return "home";
}

export default function App() {
  const [mode, setMode] = useState<Mode>(readModeFromHash);

  useEffect(() => {
    // One listener for in-page links and one for the browser back and forward buttons.
    const sync = () => setMode(readModeFromHash());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const openTrack = (id: Exclude<Mode, "home">, route: string) => {
    setMode(id);
    if (window.location.hash !== route) window.location.hash = route;
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const goHome = () => {
    setMode("home");
    if (window.location.hash) window.location.hash = "";
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  if (mode === "core") return <CoreElements onExit={goHome} />;
  if (mode === "features") return <FeaturesExplorer onExit={goHome} />;
  if (mode === "tech") return <TechStack onExit={goHome} />;

  return (
    <div className="min-h-[100dvh] w-full overflow-x-clip bg-[#F8FAFC] text-[#1E293B]">
      <main className="mx-auto flex min-h-[100dvh] max-w-[1100px] flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
        <header className="max-w-[720px]">
          <p className="text-[11px] font-bold tracking-[0.2em] text-slate-500">
            INSTAGRAM STORY SYSTEM
          </p>
          <h1 className="mt-2 text-[32px] font-black leading-tight tracking-tight text-[#0F172A] sm:text-[44px]">
            How Story Works
          </h1>
          <p className="mt-3 text-[16px] leading-relaxed text-slate-600">
            Pick one track. Core Elements shows the whole system on one page.
            Features walks through each flow. Technologies shows the stack and
            why each piece is there.
          </p>
        </header>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TRACKS.map((track) => {
            const TrackIcon = TRACK_ICONS[track.id];
            return (
              <button
                key={track.id}
                type="button"
                onClick={() => openTrack(track.id, track.route)}
                aria-label={`Open ${track.title}`}
                className="group flex h-full flex-col rounded-[18px] border-2 border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-[#0F172A] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A] sm:p-6"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-bold tracking-[0.18em] text-slate-500">
                    {track.kicker}
                  </span>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F1F5F9] text-[#0F172A]">
                    <TrackIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                </span>

                <span className="mt-3 block text-[24px] font-black leading-tight text-[#0F172A]">
                  {track.title}
                </span>
                <span className="mt-2 block text-[14.5px] leading-relaxed text-slate-600">
                  {track.sub}
                </span>

                <span className="mt-4 block space-y-1.5">
                  {track.points.map((point) => (
                    <span key={point} className="flex items-start gap-2 text-[14px] text-slate-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0F172A]" aria-hidden="true" />
                      {point}
                    </span>
                  ))}
                </span>

                <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-bold text-[#0F172A]">
                  Open {track.title}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-8 text-[12.5px] leading-relaxed text-slate-500">
          All three tracks read the same system. Core Elements is the map,
          Features is the walkthrough, Technologies is the stack list.
        </p>
      </main>
    </div>
  );
}
