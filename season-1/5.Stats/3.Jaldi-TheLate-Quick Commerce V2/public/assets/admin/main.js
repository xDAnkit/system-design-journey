// Admin router: /admin/* paths -> page functions. Filters (range, city) live in the URL, so every view is a link.
import { esc, fetchJson, store } from "../common.js";
import { destroyCharts, errorBox, filters, href, navigate, withParams } from "./core.js";
import * as insights from "./insights.js";
import * as manage from "./manage.js";

// [path, title, page, nav key, shows the date/city filters]
const ROUTES = [
  [/^\/admin\/?$/, "Overview", insights.overview, "overview", true],
  [/^\/admin\/searches\/?$/, "Searches", insights.searches, "searches", true],
  [/^\/admin\/searches\/detail\/?$/, "Search detail", insights.searchDetail, "searches", true],
  [/^\/admin\/products\/?$/, "Products", insights.products, "products", true],
  [/^\/admin\/products\/new\/?$/, "Add product", manage.addProduct, "add", false],
  [/^\/admin\/products\/([a-f0-9]{24})\/?$/, "Product", insights.productDetail, "products", true],
  [/^\/admin\/locations\/?$/, "Locations", insights.locations, "locations", true],
  [/^\/admin\/locations\/city\/?$/, "City", insights.cityDetail, "locations", true],
  [/^\/admin\/suggestions\/?$/, "AI suggested tags", manage.suggestions, "suggestions", false],
  [/^\/admin\/settings\/?$/, "Settings", manage.settings, "settings", false],
];

const NAV = [
  ["overview", "/admin", "dashboard", "Overview"],
  ["searches", "/admin/searches", "search", "Searches"],
  ["products", "/admin/products", "inventory_2", "Products"],
  ["add", "/admin/products/new", "add_circle", "Add product"],
  ["locations", "/admin/locations", "location_on", "Locations"],
  ["suggestions", "/admin/suggestions", "auto_awesome", "AI suggested tags"],
  ["settings", "/admin/settings", "settings", "Settings"],
];

const $ = (id) => document.getElementById(id);
const view = $("view");
let cleanup = null;
let renderId = 0;

function drawNav(active) {
  $("nav").innerHTML = NAV.map(
    ([key, path, ic, label]) =>
      `<a href="${href(path)}" class="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold ${key === active ? "bg-green-700 text-white" : "text-slate-700 hover:bg-slate-100"}">
        <span class="material-symbols-rounded text-xl">${ic}</span>${label}</a>`,
  ).join("");
  $("keyState").textContent = store.get("adminKey") ? "Admin key saved" : "No admin key yet";
}

function syncFilters(show) {
  $("filters").classList.toggle("hidden", !show);
  const f = filters();
  $("range").value = f.range;
  $("from").value = f.from;
  $("to").value = f.to;
  $("city").value = f.city;
  $("customDates").classList.toggle("hidden", f.range !== "custom");
}

async function render() {
  const id = ++renderId;
  cleanup?.();
  cleanup = null;
  destroyCharts();

  const route = ROUTES.find(([re]) => re.test(location.pathname));
  if (!route) {
    view.innerHTML = `<p class="text-slate-600">Page not found. <a class="text-green-800 underline" href="/admin">Go to the overview</a></p>`;
    return;
  }
  const [re, title, page, nav, showFilters] = route;
  document.title = `${title} · Jaldi admin`;
  $("title").textContent = title;
  drawNav(nav);
  syncFilters(showFilters);
  // a fresh element per visit: listeners a page puts on it go away with it
  const el = document.createElement("div");
  el.innerHTML = `<div class="text-slate-400 py-10 text-center">Loading...</div>`;
  view.replaceChildren(el);
  try {
    const done = await page(el, location.pathname.match(re));
    if (id !== renderId) return done?.(); // the user already moved on
    cleanup = done ?? null;
  } catch (err) {
    if (id === renderId) el.innerHTML = errorBox(err);
  }
}

// links inside the admin change the view without a page load
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith("/admin")) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
});
window.addEventListener("popstate", render);
window.addEventListener("admin:navigate", render);
window.addEventListener("themechange", render);

// top bar filters
const applyFilters = () => {
  const range = $("range").value;
  if (range === "custom" && (!$("from").value || !$("to").value)) {
    $("customDates").classList.remove("hidden");
    return; // wait for both dates
  }
  navigate(withParams({ range, from: range === "custom" ? $("from").value : "", to: range === "custom" ? $("to").value : "", city: $("city").value, page: "" }));
};
for (const id of ["range", "from", "to", "city"]) $(id).addEventListener("change", applyFilters);

fetchJson("/locations/cities")
  .then((cities) => {
    $("city").innerHTML = `<option value="">All cities</option>${cities.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("")}`;
    $("city").value = filters().city;
  })
  .catch(() => {});

render();
