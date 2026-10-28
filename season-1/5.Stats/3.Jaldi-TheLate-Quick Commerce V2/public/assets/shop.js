import { debounce, esc, fetchJson, icon, rupees, sessionId, store, tileStyle } from "./common.js";

const $ = (id) => document.getElementById(id);
const SID = sessionId();
const PER_PAGE = 24;
// one search box, many languages: the placeholder and the "try" chips cycle through these
const EXAMPLES = ["doodh", "दूध", "mujhe chai peeni hai", "பால்", "amul doodh 60 se kam", "maccharaa", "pulav khana hai"];

const state = {
  q: new URLSearchParams(location.search).get("q") ?? "",
  category: null,
  page: 1,
  ignore: [],
  result: null,
  categories: [],
  location: store.get("location"),
  cart: store.get("cart", {}),
};

const tryChip = (q) => `<button data-try="${esc(q)}" class="try">${esc(q)}</button>`;

// ---------------- location ----------------

const locationLabel = () => (state.location ? `${state.location.area}, ${state.location.city}` : "Choose your location");

function renderLocation() {
  $("locationText").textContent = locationLabel();
  $("locationBtn").title = state.location ? `${locationLabel()} ${state.location.pincode}` : "";
  $("locationBtnMobile").innerHTML = `${icon("bolt", "text-brand-700")} 10 min · ${esc(locationLabel())} ${icon("expand_more", "text-stone-400")}`;
  $("heroStore").textContent = state.location?.storeName ? `Delivery in 10 minutes from ${state.location.storeName}` : "Delivery in 10 minutes";
}

function openLocation() {
  $("locationModal").classList.remove("hidden");
  $("locationMsg").textContent = "";
  $("areaInput").focus();
  loadCities();
}

function closeLocation() {
  if (state.location) $("locationModal").classList.add("hidden");
}

async function setLocation(query) {
  try {
    const loc = await fetchJson(`/locations/resolve?${new URLSearchParams(query)}`);
    state.location = { pincode: loc.pincode, area: loc.area, city: loc.city, storeId: loc.store?.id ?? null, storeName: loc.store?.name ?? null, serviceable: loc.serviceable };
    store.set("location", state.location);
    renderLocation();
    $("locationModal").classList.add("hidden");
    state.page = 1;
    runSearch();
  } catch (err) {
    $("locationMsg").textContent = err.message;
  }
}

const areaRow = (p) => `
  <button class="w-full text-left px-2.5 py-2.5 rounded-xl hover:bg-stone-50 flex items-center gap-3 transition" data-pin="${esc(p.pin)}">
    <span class="w-9 h-9 shrink-0 rounded-xl bg-stone-100 text-stone-500 flex items-center justify-center">${icon("location_on")}</span>
    <span class="flex-1 min-w-0"><span class="block font-medium truncate">${esc(p.area)}</span><span class="block text-xs text-stone-500 tabular">${esc(p.city)} · ${esc(p.pin)}</span></span>
    ${p.serviceable === false ? '<span class="text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 ring-1 ring-amber-200">coming soon</span>' : icon("chevron_right", "text-stone-300")}
  </button>`;

async function loadCities() {
  if ($("cityChips").dataset.loaded) return;
  const cities = await fetchJson("/locations/cities").catch(() => []);
  $("cityChips").dataset.loaded = "1";
  $("cityChips").innerHTML = cities
    .map((c) => `<button class="text-sm font-medium px-3 py-1.5 rounded-full ring-1 ring-stone-200 hover:ring-brand-300 hover:bg-brand-50 hover:text-brand-800 transition" data-city="${esc(c.name)}">${esc(c.name)}</button>`)
    .join("");
  $("cityChips").onclick = (e) => {
    const name = e.target.closest("[data-city]")?.dataset.city;
    const city = cities.find((c) => c.name === name);
    if (city) $("areaResults").innerHTML = city.areas.map((a) => areaRow({ pin: a.pin, area: a.area, city: city.name })).join("");
  };
}

$("areaInput").addEventListener(
  "input",
  debounce(async () => {
    const q = $("areaInput").value.trim();
    if (!q) return ($("areaResults").innerHTML = "");
    const rows = await fetchJson(`/locations/search?q=${encodeURIComponent(q)}`).catch(() => []);
    $("areaResults").innerHTML = rows.length ? rows.map(areaRow).join("") : '<p class="px-2.5 py-3 text-sm text-stone-500">No area found. We cover 8 cities for now.</p>';
  }, 200),
);
$("areaResults").addEventListener("click", (e) => {
  const pin = e.target.closest("[data-pin]")?.dataset.pin;
  if (pin) setLocation({ pincode: pin });
});
$("detectBtn").addEventListener("click", () => {
  if (!navigator.geolocation) return ($("locationMsg").textContent = "This browser can't share its location. Search your area instead.");
  $("locationMsg").textContent = "Finding you...";
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocation({ lat: pos.coords.latitude.toFixed(4), lng: pos.coords.longitude.toFixed(4) }),
    () => ($("locationMsg").textContent = "Location permission denied. Search your area instead."),
    { timeout: 8000 },
  );
});
$("locationBtn").addEventListener("click", openLocation);
$("locationBtnMobile").addEventListener("click", openLocation);
$("locationClose").addEventListener("click", closeLocation);
$("locationModal").addEventListener("click", (e) => {
  if (e.target === $("locationModal")) closeLocation();
});

// ---------------- categories ----------------

async function loadCategories() {
  const data = await fetchJson("/products/categories").catch(() => ({ categories: [] }));
  state.categories = [...data.categories].sort((a, b) => Number(b.core) - Number(a.core));
  renderChips();
}

function renderChips() {
  const chip = (key, label, iconName) => {
    const active = state.category === key;
    const tile = key ? tileStyle(key, key) : "background:#1c1917;color:#fff";
    return `<button data-cat="${esc(key ?? "")}" aria-pressed="${active}" class="group shrink-0 flex flex-col items-center gap-2 w-[76px] pt-1 transition duration-300 ease-out hover:-translate-y-0.5">
      <span class="w-[60px] h-[60px] rounded-[20px] flex items-center justify-center text-[28px] transition duration-300 ease-spring group-hover:scale-105 ${active ? "ring-2 ring-brand-600 ring-offset-2 ring-offset-paper shadow-lift" : "shadow-soft"}" style="${tile}">${icon(iconName)}</span>
      <span class="text-[11.5px] leading-tight text-center clamp-2 ${active ? "font-semibold text-brand-800" : "font-medium text-stone-600"}">${esc(label)}</span></button>`;
  };
  $("chips").innerHTML = chip(null, "All", "storefront") + state.categories.slice(0, 30).map((c) => chip(c.key, c.label, c.icon)).join("");
}

function selectCategory(key) {
  state.category = key || null;
  state.q = "";
  $("searchInput").value = "";
  state.page = 1;
  state.ignore = [];
  renderChips();
  runSearch();
}

$("chips").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cat]");
  if (btn) selectCategory(btn.dataset.cat);
});

// ---------------- search ----------------

const categoryLabel = (key) => state.categories.find((c) => c.key === key)?.label ?? key;

const skeleton = () => `<div class="bg-white rounded-[22px] p-2.5 shadow-soft ring-1 ring-stone-200/60">
  <div class="skeleton aspect-square rounded-[16px]"></div>
  <div class="px-1 pt-3 space-y-2"><div class="skeleton h-3 w-12 rounded"></div><div class="skeleton h-3.5 w-full rounded"></div><div class="skeleton h-3.5 w-2/3 rounded"></div>
  <div class="flex justify-between items-center pt-3"><div class="skeleton h-4 w-12 rounded"></div><div class="skeleton h-9 w-16 rounded-xl"></div></div></div></div>`;

// the start page shows the hero; a search or a category hides it
const syncHero = () => $("hero").classList.toggle("hidden", Boolean(state.q || state.category));

async function runSearch() {
  syncHero();
  if (!state.location) return openLocation();
  const params = new URLSearchParams({ q: state.q, page: String(state.page), perPage: String(PER_PAGE), pincode: state.location.pincode, sessionId: SID });
  if (state.category) params.set("category", state.category);
  if (state.ignore.length) params.set("ignore", state.ignore.join(","));
  history.replaceState(null, "", state.q ? `/?q=${encodeURIComponent(state.q)}` : "/");
  $("results").innerHTML = Array.from({ length: 12 }, skeleton).join("");
  $("status").innerHTML = "";
  $("pager").innerHTML = "";
  try {
    state.result = await fetchJson(`/search?${params}`, { headers: { "x-session-id": SID } });
    render(true);
  } catch (err) {
    $("results").innerHTML = "";
    const text = err.status === 503 ? "The search index is warming up. Is Typesense running and the index built? (pnpm typesense:up, pnpm reindex)" : err.message;
    $("status").innerHTML = `<div class="anim-rise flex items-start gap-3 bg-white rounded-2xl shadow-soft ring-1 ring-rose-100 p-5">
      <span class="w-10 h-10 shrink-0 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-xl">${icon("cloud_off")}</span>
      <div><p class="font-semibold">Search is not available right now</p><p class="text-sm text-stone-600 mt-0.5">${esc(text)}</p></div></div>`;
  }
}

function renderStatus(r, animate) {
  const enter = animate ? "anim-rise" : "";
  if (r.unserviceable) {
    return `<div class="${enter} flex flex-col sm:flex-row items-start gap-5 bg-white rounded-[28px] shadow-soft ring-1 ring-stone-200/70 p-7">
      <span class="w-14 h-14 shrink-0 rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100 flex items-center justify-center text-3xl">${icon("storefront")}</span>
      <div class="max-w-[52ch]"><h1 class="text-xl font-semibold tracking-tight">We don't deliver to ${esc(state.location.area)} yet</h1>
      <p class="text-stone-600 mt-1.5 text-pretty">We noted your search. Searches from areas like yours decide where the next dark store opens.</p>
      <button id="changeLoc" class="mt-4 inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-800 transition">${icon("location_on")} Change location</button></div></div>`;
  }
  const title = r.q ? `Results for “${esc(r.q)}”` : state.category ? esc(categoryLabel(state.category)) : "Popular near you";
  const from = state.location?.storeName ? `From the ${esc(state.location.storeName)} store` : "";
  const chips = (r.filters ?? [])
    .map(
      (f) =>
        `<button data-drop="${esc(f.kind)}" title="Remove this filter" class="inline-flex items-center gap-1 text-xs font-medium bg-brand-50 text-brand-800 ring-1 ring-brand-200 rounded-full pl-2.5 pr-1.5 py-1 hover:bg-brand-100 transition">${esc(f.label)}${icon("close", "text-[14px]")}</button>`,
    )
    .join("");
  const note = (ic, text) => `<span class="inline-flex items-center gap-1 text-xs text-stone-600 bg-white/70 ring-1 ring-stone-200/80 rounded-full px-2.5 py-1">${icon(ic, "text-[15px] text-stone-400")}${esc(text)}</span>`;
  const notes = [
    r.corrected && note("spellcheck", `Showing results for “${r.corrected}”`),
    r.rewrite && note("translate", `Also searched as “${r.rewrite}”`),
    r.filtersRelaxed && note("tune", "No exact match for your filters, showing the closest"),
    r.vectorUsed && note("auto_awesome", "AI search"),
  ].filter(Boolean);
  return `<div class="${enter}">
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <div class="min-w-0">${from ? `<p class="text-xs font-medium text-stone-500">${from}</p>` : ""}<h1 class="mt-0.5 text-2xl sm:text-[28px] font-semibold tracking-[-0.025em] text-balance">${title}</h1></div>
      <p class="text-xs text-stone-500 tabular">${r.total} results · ${r.tookMs} ms</p>
    </div>
    ${chips || notes.length ? `<div class="mt-3 flex flex-wrap items-center gap-2">${chips}${notes.join("")}</div>` : ""}
  </div>`;
}

const stepper = (i, qty) =>
  qty
    ? `<div class="flex items-center rounded-xl bg-brand-700 text-white text-sm font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]">
        <button data-dec="${i}" aria-label="One less" class="w-8 h-9 rounded-l-xl hover:bg-brand-800 active:scale-95 transition">−</button><span class="min-w-[1.25rem] text-center tabular">${qty}</span><button data-add="${i}" aria-label="One more" class="w-8 h-9 rounded-r-xl hover:bg-brand-800 active:scale-95 transition">+</button></div>`
    : `<button data-add="${i}" class="h-9 px-4 rounded-xl text-sm font-semibold text-brand-700 bg-white ring-1 ring-brand-600 hover:bg-brand-700 hover:text-white active:scale-95 transition duration-200 ease-out">Add</button>`;

const card = (h, i, animate) => {
  const qty = state.cart[h.id]?.qty ?? 0;
  const off = h.mrp > h.price ? Math.round((1 - h.price / h.mrp) * 100) : 0;
  return `<article data-i="${i}" tabindex="0" aria-label="${esc(h.name)}" class="${animate ? "anim-rise " : ""}group relative bg-white rounded-[22px] p-2.5 flex flex-col cursor-pointer shadow-soft ring-1 ring-stone-200/60 transition duration-300 ease-out hover:-translate-y-1 hover:shadow-lift hover:ring-brand-200"${animate ? ` style="animation-delay:${Math.min(i, 14) * 35}ms"` : ""}>
    <div class="relative aspect-square rounded-[16px] overflow-hidden flex flex-col items-center justify-center" style="${tileStyle(h.category, h.brand)}">
      <span class="text-[64px] transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:-rotate-3">${icon(h.icon)}</span>
      <span class="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70 max-w-full truncate px-3">${esc(h.brand)}</span>
      ${off ? `<span class="absolute top-0 left-0 rounded-br-[12px] bg-brand-700 text-white text-[10.5px] font-semibold tabular px-2 py-1">${off}% off</span>` : ""}
    </div>
    <div class="flex flex-col flex-1 px-1 pt-2.5">
      <span class="inline-flex items-center gap-0.5 self-start text-[10.5px] font-semibold text-stone-600 bg-stone-100 rounded-md px-1.5 py-0.5">${icon("bolt", "text-[12px] text-brand-700")}10 min</span>
      <h3 class="mt-1.5 text-[13.5px] font-medium leading-snug text-stone-900 clamp-2 min-h-[2.6em]">${esc(h.name)}</h3>
      <p class="mt-0.5 text-xs text-stone-500">${esc(h.size)}</p>
      <div class="mt-auto pt-3 flex items-end justify-between gap-2">
        <div class="leading-tight"><div class="text-[14px] font-semibold tabular">${rupees(h.price)}</div>${off ? `<div class="text-[11px] text-stone-400 line-through tabular">${rupees(h.mrp)}</div>` : ""}</div>
        ${stepper(i, qty)}
      </div>
    </div>
  </article>`;
};

/** animate = a fresh result (cards cascade in); a cart change redraws quietly */
function render(animate = false) {
  const r = state.result;
  $("status").innerHTML = renderStatus(r, animate);
  $("changeLoc")?.addEventListener("click", openLocation);
  if (r.unserviceable) {
    $("results").innerHTML = "";
    $("pager").innerHTML = "";
    return;
  }
  if (!r.hits.length) {
    const title = r.outOfStock ? `Out of stock at ${state.location.storeName ?? "your store"}` : r.q ? `Nothing found for “${r.q}”` : "Nothing here yet";
    const text = r.outOfStock ? "Other stores have it. We are restocking this one." : "Try another word, or another language. These work well:";
    $("results").innerHTML = `<div class="${animate ? "anim-rise " : ""}col-span-full bg-white rounded-[28px] shadow-soft ring-1 ring-stone-200/70 px-6 py-14 text-center">
      <div class="mx-auto w-16 h-16 rounded-2xl bg-stone-100 text-stone-400 flex items-center justify-center text-4xl">${icon(r.outOfStock ? "inventory_2" : "search_off")}</div>
      <h2 class="mt-5 text-lg font-semibold tracking-tight text-balance">${esc(title)}</h2>
      <p class="mt-1 text-sm text-stone-600">${esc(text)}</p>
      ${r.outOfStock ? "" : `<div class="mt-5 flex flex-wrap justify-center gap-2">${EXAMPLES.slice(0, 4).map(tryChip).join("")}</div>`}
    </div>`;
    $("pager").innerHTML = "";
    return;
  }
  $("results").innerHTML = r.hits.map((h, i) => card(h, i, animate)).join("");
  const pages = Math.min(5, Math.ceil(r.total / r.perPage));
  $("pager").innerHTML =
    pages > 1
      ? Array.from({ length: pages }, (_, i) => {
          const n = i + 1;
          const current = n === r.page;
          return `<button data-page="${n}" aria-current="${current ? "page" : "false"}" class="w-10 h-10 rounded-xl text-sm font-semibold tabular transition active:scale-95 ${current ? "bg-stone-900 text-white shadow-soft" : "bg-white text-stone-700 ring-1 ring-stone-200 hover:ring-brand-300 hover:text-brand-800"}">${n}</button>`;
        }).join("")
      : "";
}

$("status").addEventListener("click", (e) => {
  const kind = e.target.closest("[data-drop]")?.dataset.drop;
  if (!kind) return;
  state.ignore = [...new Set([...state.ignore, kind])];
  runSearch();
});
$("pager").addEventListener("click", (e) => {
  const page = Number(e.target.closest("[data-page]")?.dataset.page);
  if (!page) return;
  state.page = page;
  runSearch();
  scrollTo({ top: 0, behavior: "smooth" });
});
// example chips: hero and empty states
document.addEventListener("click", (e) => {
  const q = e.target.closest("[data-try]")?.dataset.try;
  if (!q) return;
  searchFor(q);
  scrollTo({ top: 0, behavior: "smooth" });
});

// ---------------- events + cart ----------------

const sendEvent = (type, hit, position) =>
  fetch("/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-id": SID },
    body: JSON.stringify({ type, q: state.q, productId: hit.id, position, sessionId: SID, pincode: state.location?.pincode }),
    keepalive: true,
  }).catch(() => {});

const positionOf = (i) => (state.result.page - 1) * state.result.perPage + i + 1;

function changeQty(hit, delta, position) {
  const item = state.cart[hit.id] ?? { name: hit.name, price: hit.price, size: hit.size, icon: hit.icon, brand: hit.brand, category: hit.category, qty: 0 };
  item.qty += delta;
  if (item.qty <= 0) delete state.cart[hit.id];
  else state.cart[hit.id] = item;
  store.set("cart", state.cart);
  if (delta > 0 && position) sendEvent("add", hit, position);
  renderCart(delta > 0);
}

function openFromCard(i) {
  const hits = state.result?.hits ?? [];
  sendEvent("click", hits[i], positionOf(i));
  openProduct(hits[i], positionOf(i));
}

$("results").addEventListener("click", (e) => {
  const hits = state.result?.hits ?? [];
  const add = e.target.closest("[data-add]");
  const dec = e.target.closest("[data-dec]");
  if (add || dec) {
    const i = Number((add ?? dec).dataset.add ?? (add ?? dec).dataset.dec);
    changeQty(hits[i], add ? 1 : -1, positionOf(i));
    render();
    return;
  }
  const cardEl = e.target.closest("[data-i]");
  if (cardEl) openFromCard(Number(cardEl.dataset.i));
});
$("results").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("[data-i]")) openFromCard(Number(e.target.dataset.i));
});

function closeProduct() {
  $("productModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (state.result) render();
}

function openProduct(h, position) {
  const modal = $("productModal");
  const off = h.mrp > h.price ? Math.round((1 - h.price / h.mrp) * 100) : 0;
  const action = () => {
    const qty = state.cart[h.id]?.qty ?? 0;
    return qty
      ? `<div class="flex items-center rounded-2xl bg-brand-700 text-white font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]"><button data-m="-1" aria-label="One less" class="w-11 h-11 rounded-l-2xl hover:bg-brand-800 active:scale-95 transition">−</button><span class="min-w-[1.5rem] text-center tabular">${qty}</span><button data-m="1" aria-label="One more" class="w-11 h-11 rounded-r-2xl hover:bg-brand-800 active:scale-95 transition">+</button></div>`
      : '<button data-m="1" class="h-11 px-7 rounded-2xl bg-brand-700 hover:bg-brand-800 text-white font-semibold active:scale-95 transition shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]">Add to cart</button>';
  };
  // phones: a full page (back bar on top, price + add pinned at the bottom); wide screens: a centred card
  modal.innerHTML = `<div role="dialog" aria-modal="true" aria-label="${esc(h.name)}" class="pm-panel bg-white w-full sm:max-w-md h-[100dvh] sm:h-auto sm:max-h-[90vh] flex flex-col sm:rounded-[28px] shadow-float overflow-hidden">
    <div class="sm:hidden flex items-center gap-1 px-2 pb-2 border-b border-stone-100" style="padding-top:max(10px, env(safe-area-inset-top))">
      <button data-close aria-label="Back" class="w-10 h-10 shrink-0 rounded-xl text-stone-700 hover:bg-stone-100 flex items-center justify-center transition">${icon("arrow_back", "text-[22px]")}</button>
      <span class="text-sm font-semibold truncate">${esc(h.name)}</span>
    </div>
    <div class="flex-1 overflow-y-auto px-5 pt-5 sm:px-6 sm:pt-6">
      <div class="relative aspect-square sm:aspect-[16/11] rounded-[20px] overflow-hidden flex flex-col items-center justify-center" style="${tileStyle(h.category, h.brand)}">
        <span class="text-[112px] sm:text-[96px]">${icon(h.icon)}</span>
        <span class="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">${esc(h.brand)}</span>
        ${off ? `<span class="absolute top-0 left-0 rounded-br-[14px] bg-brand-700 text-white text-xs font-semibold tabular px-2.5 py-1.5">${off}% off</span>` : ""}
        <button data-close aria-label="Close" class="hidden sm:flex absolute top-3 right-3 w-9 h-9 rounded-xl bg-white/80 backdrop-blur text-stone-500 hover:text-stone-800 items-center justify-center transition">${icon("close")}</button>
      </div>
      <p class="mt-5 text-xs font-medium text-stone-500">${esc(categoryLabel(h.category))}</p>
      <h3 class="mt-0.5 text-xl font-semibold tracking-tight text-balance">${esc(h.name)}</h3>
      <p class="mt-1 text-sm text-stone-500">${esc(h.size)}</p>
      <div class="mt-4 mb-5 flex items-center gap-2 text-sm text-stone-600 bg-paper rounded-2xl px-3.5 py-2.5">${icon("bolt", "text-brand-700")} Delivery in 10 minutes${state.location?.storeName ? ` from ${esc(state.location.storeName)}` : ""}</div>
    </div>
    <div class="pm-bar flex items-center justify-between gap-3 px-5 sm:px-6 pt-4 border-t border-stone-100 sm:border-0 sm:pt-1 bg-white">
      <div class="leading-tight"><span class="text-2xl font-semibold tabular">${rupees(h.price)}</span>${off ? `<span class="ml-2 text-stone-400 line-through tabular">${rupees(h.mrp)}</span><div class="mt-0.5 text-xs font-semibold text-brand-700">You save ${rupees(h.mrp - h.price)}</div>` : ""}</div>
      <div id="pmAction">${action()}</div>
    </div></div>`;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  modal.onclick = (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) return closeProduct();
    const m = e.target.closest("[data-m]");
    if (!m) return;
    changeQty(h, Number(m.dataset.m), position);
    // only the button changes: redrawing the panel would replay its entrance
    modal.querySelector("#pmAction").innerHTML = action();
  };
}

function renderCart(bump = false) {
  const items = Object.entries(state.cart);
  const count = items.reduce((s, [, it]) => s + it.qty, 0);
  const total = items.reduce((s, [, it]) => s + it.qty * it.price, 0);
  $("cartText").textContent = count ? `${count} item${count > 1 ? "s" : ""} · ${rupees(total)}` : "Cart";
  const badge = $("cartBadge");
  badge.textContent = count;
  badge.classList.toggle("hidden", !count);
  if (bump) {
    // restart the bump: drop the class, force a reflow, add it again
    $("cartBtn").classList.remove("anim-bump");
    void $("cartBtn").offsetWidth;
    $("cartBtn").classList.add("anim-bump");
  }
  $("cartItems").innerHTML = items.length
    ? items
        .map(
          ([id, it]) => `<div class="flex items-center gap-3 bg-white rounded-2xl p-2.5 shadow-soft ring-1 ring-stone-200/60">
          <span class="w-14 h-14 shrink-0 rounded-xl flex items-center justify-center text-2xl" style="${tileStyle(it.category, it.brand)}">${icon(it.icon)}</span>
          <div class="flex-1 min-w-0"><div class="text-sm font-medium clamp-2 leading-snug">${esc(it.name)}</div><div class="mt-0.5 text-xs text-stone-500 tabular">${rupees(it.price)} each</div></div>
          <div class="flex flex-col items-end gap-1.5">
            <div class="flex items-center rounded-lg bg-brand-700 text-white text-xs font-semibold"><button data-cart-dec="${esc(id)}" aria-label="One less" class="w-7 h-7 rounded-l-lg hover:bg-brand-800 transition">−</button><span class="min-w-[1rem] text-center tabular">${it.qty}</span><button data-cart-inc="${esc(id)}" aria-label="One more" class="w-7 h-7 rounded-r-lg hover:bg-brand-800 transition">+</button></div>
            <span class="text-sm font-semibold tabular">${rupees(it.qty * it.price)}</span>
          </div></div>`,
        )
        .join("") + `<div class="flex justify-between items-baseline px-1 pt-4"><span class="text-sm text-stone-600">Item total</span><span class="text-xl font-semibold tabular">${rupees(total)}</span></div>`
    : `<div class="text-center py-16">
        <div class="mx-auto w-16 h-16 rounded-2xl bg-white shadow-soft text-stone-300 flex items-center justify-center text-4xl">${icon("shopping_bag")}</div>
        <p class="mt-4 font-semibold">Your cart is empty</p><p class="mt-1 text-sm text-stone-500">Add something and it shows up here.</p>
        <button data-close-cart class="mt-5 h-10 px-5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold transition active:scale-95">Start shopping</button></div>`;
}

const openCart = () => {
  $("cartScrim").classList.remove("hidden");
  $("cartPanel").classList.remove("hidden");
};
const closeCart = () => {
  $("cartScrim").classList.add("hidden");
  $("cartPanel").classList.add("hidden");
};
$("cartBtn").addEventListener("click", openCart);
$("cartClose").addEventListener("click", closeCart);
$("cartScrim").addEventListener("click", closeCart);
$("cartItems").addEventListener("click", (e) => {
  if (e.target.closest("[data-close-cart]")) return closeCart();
  const inc = e.target.closest("[data-cart-inc]")?.dataset.cartInc;
  const dec = e.target.closest("[data-cart-dec]")?.dataset.cartDec;
  const id = inc ?? dec;
  if (!id || !state.cart[id]) return;
  changeQty({ id, ...state.cart[id] }, inc ? 1 : -1, null);
  if (state.result) render();
});

// Escape closes the top-most layer (the dialog handles its own)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.body.classList.contains("search-open")) closeSheet();
  else if (!$("productModal").classList.contains("hidden")) closeProduct();
  else if (!$("cartPanel").classList.contains("hidden")) closeCart();
  else if (!$("locationModal").classList.contains("hidden")) closeLocation();
});

// ---------------- typing: suggestions ----------------

const input = $("searchInput");
const box = $("suggestBox");

let shownFor = null; // the text the dropdown was last filled for

// phones: the search opens as a full-screen sheet; it stays open when the keyboard goes away
const phone = matchMedia("(max-width: 639px)");
const sheetOpen = () => document.body.classList.contains("search-open");
const openSheet = () => {
  if (phone.matches) document.body.classList.add("search-open");
};
const closeSheet = () => {
  document.body.classList.remove("search-open");
  box.classList.add("hidden");
  input.blur();
};
// the list may show while the sheet is open, even with the keyboard down
const searchActive = () => document.activeElement === input || sheetOpen();

/** product name with the typed part marked */
const highlight = (name, q) => {
  const at = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return esc(name);
  return `${esc(name.slice(0, at))}<mark class="bg-transparent text-brand-700 font-semibold">${esc(name.slice(at, at + q.length))}</mark>${esc(name.slice(at + q.length))}`;
};

const productRow = (p, q = "") => `<button data-name="${esc(p.name)}" class="w-full text-left px-2.5 py-2 rounded-xl hover:bg-stone-50 flex items-center gap-3 transition">
  <span class="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-xl" style="${tileStyle(p.category, p.brand)}">${icon(p.icon)}</span>
  <span class="flex-1 min-w-0"><span class="block text-sm font-medium truncate">${highlight(p.name, q)}</span><span class="block text-xs text-stone-500">${esc(p.size)}</span></span>
  <span class="text-sm font-semibold tabular text-stone-700">${rupees(p.price)}</span></button>`;

async function suggest() {
  const q = input.value.trim();
  $("clearBtn").classList.toggle("hidden", !q);
  if (q.length < 2) return showStartPanel();
  if (!state.location) return box.classList.add("hidden");
  const data = await fetchJson(`/search/suggest?q=${encodeURIComponent(q)}&pincode=${state.location.pincode}`).catch(() => ({ products: [] }));
  if (input.value.trim() !== q) return;
  box.innerHTML = data.products.length
    ? `<div class="p-1.5">${data.products.map((p) => productRow(p, q)).join("")}</div>`
    : `<div class="px-4 py-3.5 text-sm text-stone-500 flex items-center gap-2">${icon("keyboard_return", "text-stone-400")} Press Enter to search “${esc(q)}”</div>`;
  shownFor = q;
  if (searchActive()) box.classList.remove("hidden");
}

// ---------------- empty box: own recent searches, trending categories, popular products ----------------
// Never other shoppers' searches: those are private. Recent searches stay in this browser only.

const RECENT_MAX = 5;
const POPULAR_TTL_MS = 60_000;
const recentSearches = () => store.get("recent", []);
const remember = (q) => {
  if (q) store.set("recent", [q, ...recentSearches().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX));
};

let popularCache = null; // { pincode, at, products, categories }

async function showStartPanel() {
  const pincode = state.location?.pincode ?? "";
  if (!popularCache || popularCache.pincode !== pincode || Date.now() - popularCache.at > POPULAR_TTL_MS) {
    const data = await fetchJson(`/search/popular${pincode ? `?pincode=${pincode}` : ""}`).catch(() => ({ products: [], categories: [] }));
    popularCache = { pincode, at: Date.now(), products: data.products ?? [], categories: data.categories ?? [] };
  }
  // the shopper may have typed or left while we waited
  if (input.value.trim().length >= 2 || !searchActive()) return;

  const recent = recentSearches();
  const chip = (q) =>
    `<span class="inline-flex items-center max-w-full rounded-full bg-stone-100 hover:bg-stone-200/70 text-sm transition">
      <button data-q="${esc(q)}" title="${esc(q)}" class="inline-flex items-center gap-1 min-w-0 pl-3 pr-1 py-1.5">${icon("history", "text-stone-400 text-base shrink-0")}<span class="truncate max-w-[220px]">${esc(q)}</span></button>
      <button data-remove-recent="${esc(q)}" aria-label="Remove ${esc(q)} from recent searches" title="Remove" class="w-6 h-6 mr-1 rounded-full text-stone-400 hover:text-rose-600 hover:bg-white transition">×</button></span>`;
  const section = (title, body, action = "") =>
    `<div class="px-4 pt-4 pb-1.5"><div class="flex justify-between items-center mb-2.5"><span class="text-xs font-semibold text-stone-500">${title}</span>${action}</div>${body}</div>`;

  const cats = popularCache.categories.map((c) => ({ ...c, info: state.categories.find((x) => x.key === c.key) })).filter((c) => c.info);
  const catChip = (c) =>
    `<button data-pick-cat="${esc(c.key)}" class="inline-flex items-center gap-1.5 rounded-full ring-1 ring-stone-200 pl-1 pr-3 py-1 text-sm hover:ring-brand-300 hover:bg-brand-50 transition"><span class="w-7 h-7 rounded-full flex items-center justify-center text-sm" style="${tileStyle(c.key, c.key)}">${icon(c.info.icon)}</span>${esc(c.info.label)}</button>`;
  const city = state.location?.city;
  const catTitle = cats.some((c) => c.real) ? `Trending${city ? ` in ${esc(city)}` : ""}` : "Shop by category";

  box.innerHTML =
    [
      recent.length ? section("Your recent searches", `<div class="flex flex-wrap gap-2">${recent.map(chip).join("")}</div>`, `<button data-clear-recent class="text-xs font-semibold text-brand-700 hover:underline">Clear</button>`) : "",
      cats.length ? section(catTitle, `<div class="flex flex-wrap gap-2">${cats.map(catChip).join("")}</div>`) : "",
      popularCache.products.length ? section("Popular near you", `<div class="-mx-2.5">${popularCache.products.map((p) => productRow(p)).join("")}</div>`) : "",
    ].join("") + '<div class="h-2"></div>';
  shownFor = null;
  box.classList.toggle("hidden", !recent.length && !cats.length && !popularCache.products.length);
}

input.addEventListener("input", debounce(suggest, 150));
// back in the box: the same text shows the last list at once, other text (or none) gets a fresh one
input.addEventListener("focus", () => {
  openSheet();
  const q = input.value.trim();
  if (q.length >= 2 && q === shownFor) box.classList.remove("hidden");
  else suggest();
});

const searchFor = (q) => {
  state.q = q.trim();
  input.value = state.q;
  $("clearBtn").classList.toggle("hidden", !state.q);
  state.category = null;
  state.page = 1;
  state.ignore = [];
  remember(state.q);
  closeSheet();
  renderChips();
  runSearch();
};

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchFor(input.value);
  if (e.key === "Escape") closeSheet();
});
box.addEventListener("mousedown", (e) => {
  // one search: gone at once (easy to get back by searching again), the focus stays so the panel redraws
  const removeOne = e.target.closest("[data-remove-recent]")?.dataset.removeRecent;
  if (removeOne !== undefined) {
    e.preventDefault();
    store.set("recent", recentSearches().filter((r) => r !== removeOne));
    return void showStartPanel();
  }
  // all of them: ask first
  if (e.target.closest("[data-clear-recent]")) {
    e.preventDefault();
    box.classList.add("hidden");
    const dialog = $("clearRecentDialog");
    dialog.returnValue = ""; // Escape keeps the old value, so start clean
    dialog.addEventListener(
      "close",
      () => {
        if (dialog.returnValue === "confirm") store.remove("recent");
        input.focus(); // back in the box: the panel redraws without them
      },
      { once: true },
    );
    return void dialog.showModal();
  }
  const cat = e.target.closest("[data-pick-cat]")?.dataset.pickCat;
  if (cat) {
    closeSheet();
    return void selectCategory(cat);
  }
  const q = e.target.closest("[data-q]")?.dataset.q ?? e.target.closest("[data-name]")?.dataset.name;
  if (q) searchFor(q);
});
input.addEventListener("blur", () =>
  setTimeout(() => {
    if (!sheetOpen()) box.classList.add("hidden");
  }, 150),
);
$("searchBack").addEventListener("click", closeSheet);
// leaving phone width with the sheet open: back to the normal dropdown
phone.addEventListener("change", () => {
  if (!phone.matches) document.body.classList.remove("search-open");
});
$("clearBtn").addEventListener("click", () => searchFor(""));

// the placeholder walks through languages while the box is idle
let exampleAt = 0;
setInterval(() => {
  if (document.activeElement === input || input.value) return;
  exampleAt = (exampleAt + 1) % EXAMPLES.length;
  input.placeholder = `Search “${EXAMPLES[exampleAt]}”`;
}, 2600);

// ---------------- start ----------------

input.value = state.q;
input.placeholder = `Search “${EXAMPLES[0]}”`;
$("clearBtn").classList.toggle("hidden", !state.q);
renderLocation();
renderCart();
loadCategories();
syncHero();
if (!state.location) openLocation();
else runSearch();
