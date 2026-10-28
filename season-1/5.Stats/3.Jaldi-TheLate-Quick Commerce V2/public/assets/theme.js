// Light / dark theme for both pages. A classic script in <head>, right after the Tailwind CDN (and after a page's
// own tailwind.config), so the class is set before the first paint and there is no white flash.
// Colors live in assets/theme.css as CSS variables; Tailwind gets them here, so every existing class
// (bg-white, text-stone-500, bg-brand-700 ...) follows the theme without a dark: variant on each element.
(() => {
  const KEY = "jaldi.theme"; // same "jaldi." prefix as the store helper in common.js
  const root = document.documentElement;
  const saved = localStorage.getItem(KEY);
  const apply = (dark) => {
    root.classList.toggle("dark", dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0c0c0b" : "#f7f6f2");
  };
  apply(saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);

  const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
  const scale = (name, steps) => Object.fromEntries(steps.map((s) => [s, v(`${name}-${s}`)]));
  const ALL = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const colors = {
    white: v("white"),
    paper: v("paper"),
    brand: scale("brand", ALL.slice(0, 10)),
    ...Object.fromEntries(["stone", "slate", "green", "rose", "amber", "blue"].map((n) => [n, scale(n, ALL)])),
  };
  const cfg = window.tailwind?.config ?? {};
  cfg.darkMode = "class";
  cfg.theme ??= {};
  cfg.theme.extend ??= {};
  cfg.theme.extend.colors = { ...cfg.theme.extend.colors, ...colors };
  window.tailwind.config = cfg;

  // any element with data-theme-toggle flips the theme and remembers the choice
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("[data-theme-toggle]")) return;
    const dark = !root.classList.contains("dark");
    localStorage.setItem(KEY, dark ? "dark" : "light");
    apply(dark);
    window.dispatchEvent(new CustomEvent("themechange", { detail: { dark } }));
  });
})();
