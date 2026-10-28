// Read-only dashboard pages: overview, searches, products, locations and their drill-downs.
import { esc, fetchJson, icon, rupees } from "../common.js";
import { COLORS, api, barChart, bindFilterForm, card, chartBox, dayLabel, empty, filters, fmt, href, kpi, kpiGrid, lineChart, pager, params, pill, query, table } from "./core.js";
import { bindSuggestionActions, suggestionColumns, tagCount, tagEditor } from "./manage.js";

const SCRIPT_LABELS = {
  Roman: "Roman (English, Hinglish)",
  Devanagari: "Devanagari (Hindi, Marathi)",
  Bengali: "Bengali, Assamese",
  Gurmukhi: "Gurmukhi (Punjabi)",
};
const scriptLabel = (s) => SCRIPT_LABELS[s] ?? s;

const queryLink = (q, text) => `<a class="text-green-800 font-medium hover:underline" href="${href("/admin/searches/detail", { q })}">${esc(text || q)}</a>`;
const productLink = (id, name) => `<a class="font-medium hover:underline" href="${href(`/admin/products/${id}`)}">${esc(name || id)}</a>`;
const cityLink = (name) => `<a class="text-green-800 font-medium hover:underline" href="${href("/admin/locations/city", { name })}">${esc(name)}</a>`;
const ratio = (a, b) => (b > 0 ? a / b : 0);

/** searches / clicks / adds over days (or hours for one day); only the series the API sent */
function trendChart(id, trend, keys = ["searches", "clicks", "adds"]) {
  const present = keys.filter((k) => trend.length && k in trend[0]);
  lineChart(
    id,
    trend.map((t) => dayLabel(t.label)),
    present.map((k) => ({ label: k[0].toUpperCase() + k.slice(1), data: trend.map((t) => t[k]) })),
  );
}

const queryColumns = [
  { key: "_id", label: "Search", render: (r) => queryLink(r._id, r.qDisplay) },
  { key: "searches", label: "Searches", right: true, render: (r) => fmt.num(r.searches) },
  { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
  { key: "ctr", label: "CTR", right: true, render: (r) => fmt.pct(ratio(r.clicks, r.searches)) },
  { key: "adds", label: "Adds", right: true, render: (r) => fmt.num(r.adds) },
];

const productColumns = [
  { key: "name", label: "Product", render: (r) => productLink(r._id, r.name) },
  { key: "brand", label: "Brand" },
  { key: "impressions", label: "Shown", right: true, render: (r) => fmt.num(r.impressions) },
  { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
  { key: "adds", label: "Adds", right: true, render: (r) => fmt.num(r.adds) },
];

// ---------- /admin ----------

export async function overview(el) {
  const d = await api(`/analytics/overview?${query()}`);
  const k = d.kpis;
  const c = d.change;
  const latency = k.p50LatencyMs !== null ? `≤${k.p50LatencyMs} / ≤${k.p95LatencyMs} ms` : fmt.ms(k.avgLatencyMs);

  el.innerHTML = `<div class="space-y-4">
    ${kpiGrid([
      kpi("Searches", fmt.num(k.searches), { value: c.searches }),
      kpi("Unique visitors", fmt.num(k.visitors), { value: c.visitors }),
      kpi("Zero-result rate", fmt.pct(k.zeroRate), { value: c.zeroRate, kind: "pts", goodWhen: "down" }),
      kpi("Click rate (CTR)", fmt.pct(k.ctr), { value: c.ctr, kind: "pts" }),
      kpi("Adds to cart", fmt.num(k.adds), { value: c.adds }),
      kpi("Searches with no store", fmt.num(k.unserviceable), { value: c.unserviceable, goodWhen: "down" }),
      kpi("Out-of-stock searches", fmt.num(k.outOfStock)),
      kpi(k.p50LatencyMs !== null ? "Latency p50 / p95" : "Avg latency", latency),
      kpi("Tags learned from clicks", fmt.num(k.learnedTags)),
      kpi("Suggestions to review", `<a class="hover:underline text-green-800" href="${href("/admin/suggestions", { status: "candidate" })}">${fmt.num(k.pendingSuggestions)}</a>`),
    ])}
    <div class="grid xl:grid-cols-3 gap-4">
      ${card(d.range.hourly ? "Searches per hour" : "Searches, clicks and adds per day", chartBox("trendChart"), "xl:col-span-2")}
      ${card("Searches by script", d.scripts.length ? chartBox("scriptChart") : empty())}
    </div>
    ${card(`Live: searches per minute, last hour <span class="text-xs font-normal text-slate-500">(refreshes every 15 s)</span>`, chartBox("liveChart", 140))}
    <div class="grid xl:grid-cols-3 gap-4">
      ${card(`Top searches <a class="text-xs font-normal text-green-800 ml-2" href="${href("/admin/searches")}">all →</a>`, table(queryColumns, d.topQueries))}
      ${card(`Top products <a class="text-xs font-normal text-green-800 ml-2" href="${href("/admin/products")}">all →</a>`, table(productColumns.filter((col) => col.key !== "brand"), d.topProducts))}
      ${card(
        `Searches with zero results <a class="text-xs font-normal text-green-800 ml-2" href="${href("/admin/searches", { zeroOnly: "true", sort: "zero" })}">all →</a>`,
        table(
          [
            { key: "_id", label: "Search", render: (r) => queryLink(r._id, r.qDisplay) },
            { key: "zero", label: "Zero results", right: true, render: (r) => fmt.num(r.zero) },
            { key: "searches", label: "Searches", right: true, render: (r) => fmt.num(r.searches) },
          ],
          d.zeroQueries,
        ),
      )}
    </div></div>`;

  trendChart("trendChart", d.trend);
  barChart(
    "scriptChart",
    d.scripts.map((s) => scriptLabel(s.script)),
    d.scripts.map((s) => s.searches),
    { horizontal: true },
  );

  const minuteLabel = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const first = await api("/analytics/live").catch(() => []);
  const live = barChart("liveChart", first.map((m) => minuteLabel(m.minute)), first.map((m) => m.searches));
  const timer = setInterval(async () => {
    const rows = await api("/analytics/live").catch(() => null);
    if (!rows || !live) return;
    live.data.labels = rows.map((m) => minuteLabel(m.minute));
    live.data.datasets[0].data = rows.map((m) => m.searches);
    live.update("none");
  }, 15_000);
  return () => clearInterval(timer);
}

// ---------- /admin/searches ----------

const SCRIPTS = ["Roman", "Devanagari", "Bengali", "Gujarati", "Gurmukhi", "Odia", "Tamil", "Telugu", "Kannada", "Malayalam", "Urdu", "Other"];

export async function searches(el) {
  const p = params();
  const d = await api(`/analytics/searches?${query({ sort: p.get("sort"), order: p.get("order"), page: p.get("page"), q: p.get("q"), script: p.get("script"), zeroOnly: p.get("zeroOnly") })}`);
  const sort = { by: d.sort, order: d.order };
  el.innerHTML = card(
    "",
    `<form data-filter class="flex flex-wrap gap-2 items-center mb-4">
      <input name="q" value="${esc(p.get("q") ?? "")}" placeholder="Search text contains..." class="border border-slate-300 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-600" />
      <select name="script" class="border border-slate-300 rounded-xl px-3 py-1.5 text-sm"><option value="">Any script</option>${SCRIPTS.map((s) => `<option value="${s}" ${p.get("script") === s ? "selected" : ""}>${esc(scriptLabel(s))}</option>`).join("")}</select>
      <label class="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="zeroOnly" value="true" ${p.get("zeroOnly") === "true" ? "checked" : ""} class="accent-green-700" /> Only with zero results</label>
      <button class="bg-slate-100 hover:bg-slate-200 rounded-xl px-4 py-1.5 text-sm font-semibold">Apply</button>
    </form>
    ${table(
      [
        { key: "_id", label: "Search", render: (r) => queryLink(r._id, r.qDisplay) },
        { key: "script", label: "Script", render: (r) => esc(scriptLabel(r.script ?? "Roman")) },
        { key: "searches", label: "Searches", right: true, sort: true, render: (r) => fmt.num(r.searches) },
        { key: "zero", label: "Zero results", right: true, sort: true, render: (r) => fmt.num(r.zero) },
        { key: "clicks", label: "Clicks", right: true, sort: true, render: (r) => fmt.num(r.clicks) },
        { key: "ctr", label: "CTR", right: true, sort: true, render: (r) => fmt.pct(r.ctr) },
        { key: "adds", label: "Adds", right: true, sort: true, render: (r) => fmt.num(r.adds) },
        { key: "avgResults", label: "Avg results", right: true, sort: true, render: (r) => fmt.dec(r.avgResults) },
        { key: "outOfStock", label: "Out of stock", right: true, sort: true, render: (r) => fmt.num(r.outOfStock) },
      ],
      d.rows,
      sort,
    )}
    ${pager(d.total, d.page, d.limit)}`,
  );
  bindFilterForm(el);
}

// ---------- /admin/searches/detail?q= ----------

export async function searchDetail(el) {
  const q = params().get("q") ?? "";
  if (!q) {
    el.innerHTML = empty("Pick a search from the Searches page.");
    return;
  }
  const draw = async () => {
    const d = await api(`/analytics/searches/detail?${query({ q })}`);
    const k = d.kpis;
    el.innerHTML = `<div class="space-y-4">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-2xl font-extrabold">"${esc(q)}"</h2>
        <a class="text-sm text-green-800 underline" target="_blank" href="/?q=${encodeURIComponent(q)}">Search it in the shop ↗</a>
        <span class="text-sm text-slate-600">${d.rewrite ? `${icon("auto_awesome", "text-amber-500")} AI rewrite: <b>${esc(d.rewrite)}</b>` : "No AI rewrite for this search"}</span>
      </div>
      ${kpiGrid([
        kpi("Searches", fmt.num(k.searches), { value: d.change.searches }),
        kpi("Click rate (CTR)", fmt.pct(k.ctr)),
        kpi("Zero-result rate", fmt.pct(k.zeroRate)),
        kpi("Adds to cart", fmt.num(k.adds)),
        kpi("Avg results", fmt.dec(k.avgResults)),
      ])}
      <div class="grid xl:grid-cols-3 gap-4">
        ${card("Searches and clicks per day", chartBox("qTrend"), "xl:col-span-2")}
        ${card(
          "People also search",
          table(
            [
              { key: "q", label: "Similar search (by meaning)", render: (r) => queryLink(r.q) },
              { key: "count", label: "Searches", right: true, render: (r) => fmt.num(r.count) },
              { key: "distance", label: "Closeness", right: true, render: (r) => fmt.pct(Math.max(0, 1 - r.distance), 0) },
            ],
            d.similar,
          ),
        )}
      </div>
      <div class="grid xl:grid-cols-2 gap-4">
        ${card(
          "Products clicked from this search",
          table(
            [
              { key: "name", label: "Product", render: (r) => productLink(r._id, r.name) },
              { key: "brand", label: "Brand" },
              { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
              { key: "adds", label: "Adds", right: true, render: (r) => fmt.num(r.adds) },
            ],
            d.products,
          ),
        )}
        ${card(
          "Where it is searched",
          table(
            [
              { key: "_id", label: "City", render: (r) => cityLink(r._id) },
              { key: "searches", label: "Searches", right: true, render: (r) => fmt.num(r.searches) },
              { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
              { key: "zero", label: "Zero results", right: true, render: (r) => fmt.num(r.zero) },
              { key: "outOfStock", label: "Out of stock", right: true, render: (r) => fmt.num(r.outOfStock) },
            ],
            d.cities,
          ),
        )}
      </div>
      ${card("AI suggested tags for this search", table(suggestionColumns({ query: true }), d.suggestions))}
    </div>`;
    trendChart("qTrend", d.trend, ["searches", "clicks"]);
  };
  bindSuggestionActions(el, draw);
  await draw();
}

// ---------- /admin/products ----------

export async function products(el) {
  const p = params();
  const [d, cats] = await Promise.all([
    api(`/analytics/products?${query({ sort: p.get("sort"), order: p.get("order"), page: p.get("page"), q: p.get("q"), category: p.get("category") })}`),
    api("/products/categories"),
  ]);
  const labels = new Map(cats.categories.map((c) => [c.key, c.label]));
  el.innerHTML = `<div class="space-y-4">
    ${card(
      "",
      `<div class="flex flex-wrap gap-3 items-start">
        <div class="relative flex-1 min-w-[260px]">
          <input id="finder" autocomplete="off" placeholder="Find any product in the catalog (opens its page)..." class="w-full border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-green-600" />
          <div id="finderBox" class="hidden absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"></div>
        </div>
        <a href="/admin/products/new" class="inline-flex items-center gap-1.5 bg-green-700 hover:bg-green-800 text-white rounded-xl px-4 py-2 font-semibold">${icon("add")} Add product</a>
      </div>`,
    )}
    ${card(
      "Product performance in search",
      `<form data-filter class="flex flex-wrap gap-2 items-center mb-4">
        <input name="q" value="${esc(p.get("q") ?? "")}" placeholder="Name contains..." class="border border-slate-300 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-600" />
        <select name="category" class="border border-slate-300 rounded-xl px-3 py-1.5 text-sm"><option value="">All categories</option>
          ${cats.aisles.map((a) => `<optgroup label="${esc(a.label)}">${a.categories.map((k) => `<option value="${esc(k)}" ${p.get("category") === k ? "selected" : ""}>${esc(labels.get(k) ?? k)}</option>`).join("")}</optgroup>`).join("")}
        </select>
        <button class="bg-slate-100 hover:bg-slate-200 rounded-xl px-4 py-1.5 text-sm font-semibold">Apply</button>
      </form>
      ${table(
        [
          ...productColumns.slice(0, 2),
          { key: "category", label: "Category", render: (r) => esc(labels.get(r.category) ?? r.category) },
          { key: "impressions", label: "Shown", right: true, sort: true, render: (r) => fmt.num(r.impressions) },
          { key: "clicks", label: "Clicks", right: true, sort: true, render: (r) => fmt.num(r.clicks) },
          { key: "ctr", label: "CTR", right: true, sort: true, render: (r) => fmt.pct(r.ctr) },
          { key: "adds", label: "Adds", right: true, sort: true, render: (r) => fmt.num(r.adds) },
          { key: "addRate", label: "Add rate", right: true, sort: true, render: (r) => fmt.pct(r.addRate) },
          { key: "avgPosition", label: "Avg position", right: true, sort: true, render: (r) => (r.avgPosition === null ? "–" : fmt.dec(r.avgPosition)) },
        ],
        d.rows,
        { by: d.sort, order: d.order },
      )}
      ${pager(d.total, d.page, d.limit)}`,
    )}</div>`;
  bindFilterForm(el);

  // catalog finder: keyword prefix search, it sends no analytics event
  const finder = el.querySelector("#finder");
  const box = el.querySelector("#finderBox");
  let seq = 0;
  finder.addEventListener("input", async () => {
    const text = finder.value.trim();
    const mine = ++seq;
    if (!text) return box.classList.add("hidden");
    const res = await fetchJson(`/search/suggest?q=${encodeURIComponent(text)}`).catch(() => ({ products: [] }));
    if (mine !== seq) return;
    box.innerHTML = res.products.length
      ? res.products.map((h) => `<a href="${href(`/admin/products/${h.id}`)}" class="flex justify-between gap-3 px-3 py-2 hover:bg-slate-50 text-sm"><span>${esc(h.name)} <span class="text-slate-400">${esc(h.size)}</span></span><span class="text-slate-500">${rupees(h.price)}</span></a>`).join("")
      : `<p class="px-3 py-2 text-sm text-slate-500">No product found (is Typesense indexed?)</p>`;
    box.classList.remove("hidden");
  });
  finder.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 200));
}

// ---------- /admin/products/:id ----------

const TAG_GROUPS = [
  ["en", "English"],
  ["hinglish", "Hinglish"],
  ["typos", "Typos"],
  ["ai", "AI words"],
];

function tagsView(tags, suggested) {
  const chips = (list, tone = "bg-slate-100") => list.map((t) => `<span class="inline-block ${tone} rounded-full px-2.5 py-0.5 text-sm">${esc(t)}</span>`).join(" ");
  const row = (label, list, tone) => (list?.length ? `<div class="py-1.5 flex gap-3"><div class="w-24 shrink-0 text-xs font-semibold text-slate-500 pt-1">${esc(label)}</div><div class="flex flex-wrap gap-1.5">${chips(list, tone)}</div></div>` : "");
  return [
    ...TAG_GROUPS.slice(0, 2).map(([k, l]) => row(l, tags?.[k])),
    ...Object.entries(tags?.native ?? {}).map(([lang, list]) => row(lang, list)),
    ...TAG_GROUPS.slice(2).map(([k, l]) => row(l, tags?.[k])),
    row("Learned", suggested, "bg-green-100 text-green-900"),
  ].join("") || empty("No tags yet. The enrich worker makes them.");
}

const STATUS_TONE = { indexed: "green", failed: "red", pending: "amber", enriched: "blue" };

export async function productDetail(el, match) {
  const id = match[1];
  const draw = async () => {
    const d = await api(`/analytics/products/${id}?${query()}`);
    const pr = d.product;
    const k = d.kpis;
    el.innerHTML = `<div class="space-y-4">
      <div class="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap gap-5 items-start">
        <div class="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center text-4xl text-slate-600">${icon(pr.icon)}</div>
        <div class="flex-1 min-w-[240px]">
          <h2 class="text-2xl font-extrabold">${esc(pr.name)}</h2>
          <p class="text-sm text-slate-600 mt-1">${esc(pr.brand || "No brand")} · ${esc(pr.category)} · ${esc(pr.size || "no size")} · <b>${rupees(pr.price)}</b>${pr.mrp > pr.price ? ` <s class="text-slate-400">${rupees(pr.mrp)}</s>` : ""}</p>
          <p class="text-sm mt-2 flex flex-wrap gap-2 items-center">${pill(pr.status, STATUS_TONE[pr.status])} ${pill(`tags: ${pr.tagsSource}`)} ${pill(`${pr.stores.length} dark stores`)} ${pr.popularity ? pill(`popularity ${fmt.num(pr.popularity)}`) : ""}</p>
          ${pr.error ? `<p class="text-sm text-rose-700 mt-2">${esc(pr.error)}</p>` : ""}
        </div>
        <a class="text-sm text-green-800 underline" target="_blank" href="/?q=${encodeURIComponent(pr.name)}">Search it in the shop ↗</a>
      </div>
      ${kpiGrid([
        kpi("Shown in results", fmt.num(k.impressions), { value: d.change.impressions }),
        kpi("Clicks", fmt.num(k.clicks), { value: d.change.clicks }),
        kpi("CTR", fmt.pct(k.ctr)),
        kpi("Adds to cart", fmt.num(k.adds)),
        kpi("Avg position", k.avgPosition === null ? "–" : fmt.dec(k.avgPosition)),
      ])}
      <div class="grid xl:grid-cols-3 gap-4">
        ${card("Clicks and adds per day", chartBox("pTrend"), "xl:col-span-2")}
        ${card(
          "Searches that led here",
          table(
            [
              { key: "_id", label: "Search", render: (r) => queryLink(r._id, r.qDisplay) },
              { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
              { key: "adds", label: "Adds", right: true, render: (r) => fmt.num(r.adds) },
            ],
            d.queries,
          ),
        )}
      </div>
      <div class="grid xl:grid-cols-3 gap-4 items-start">
        <section class="xl:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
          <div class="flex items-center gap-2 mb-2"><h2 class="font-bold mr-auto">Search tags <span class="text-xs font-normal text-slate-500">${tagCount(pr.tags)} tags${pr.tagsFor ? ` · made for "${esc(pr.tagsFor)}"` : ""}</span></h2>
            <button id="editTags" class="text-sm font-semibold bg-slate-100 hover:bg-slate-200 rounded-xl px-3 py-1.5">${icon("edit")} Edit tags</button></div>
          <div id="tagsBox">${tagsView(pr.tags, pr.suggestedTags)}</div>
        </section>
        ${card(
          "By city",
          table(
            [
              { key: "_id", label: "City", render: (r) => cityLink(r._id) },
              { key: "impressions", label: "Shown", right: true, render: (r) => fmt.num(r.impressions) },
              { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
              { key: "adds", label: "Adds", right: true, render: (r) => fmt.num(r.adds) },
            ],
            d.cities,
          ),
        )}
      </div>
      ${card("AI suggested tags for this product", table(suggestionColumns({ product: true }), d.suggestions))}
    </div>`;
    trendChart("pTrend", d.trend, ["clicks", "adds"]);

    el.querySelector("#editTags").addEventListener("click", () => {
      const box = el.querySelector("#tagsBox");
      box.innerHTML = `<div id="editor"></div>
        <div class="flex items-center gap-2 mt-3"><button id="saveTags" class="bg-green-700 hover:bg-green-800 text-white rounded-xl px-4 py-2 font-semibold text-sm">Save tags</button>
        <button id="cancelTags" class="bg-slate-100 hover:bg-slate-200 rounded-xl px-4 py-2 font-semibold text-sm">Cancel</button>
        <span id="tagsMsg" class="text-sm text-slate-600"></span></div>`;
      const editor = tagEditor(box.querySelector("#editor"), pr.tags);
      box.querySelector("#cancelTags").addEventListener("click", draw);
      box.querySelector("#saveTags").addEventListener("click", async () => {
        const msg = box.querySelector("#tagsMsg");
        try {
          // same title: the worker keeps these tags and skips the LLM, only re-indexes
          await api(`/products/${id}`, { method: "PUT", body: JSON.stringify({ tags: editor.get(), tagsFor: pr.tagsFor || undefined }) });
          msg.textContent = "Queued. The index worker updates search in a few seconds.";
          setTimeout(draw, 2500);
        } catch (err) {
          msg.className = "text-sm text-rose-700";
          msg.textContent = err.message;
        }
      });
    });
  };
  bindSuggestionActions(el, draw);
  await draw();
}

// ---------- /admin/locations ----------

export async function locations(el) {
  const d = await api(`/analytics/locations?${query()}`);
  const f = filters();
  el.innerHTML = `<div class="space-y-4">
    ${f.city ? `<p class="text-sm text-slate-600">This page always shows every city. Click a city for its own page.</p>` : ""}
    ${card(
      "Where searches come from",
      `<div id="map" class="h-[420px] rounded-xl overflow-hidden border border-slate-200 z-0"></div>
       <div class="flex flex-wrap gap-4 text-xs text-slate-600 mt-2">
         <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-full" style="background:${COLORS.blue}"></span>Searches from an area a dark store serves</span>
         <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded-full" style="background:${COLORS.critical}"></span>${icon("block")} Searches from an area with no store</span>
         <span class="inline-flex items-center gap-1.5">${icon("storefront", "text-slate-800")} Dark store</span>
         <span>Circle size = number of searches</span>
       </div>`,
    )}
    ${card(
      "Cities",
      table(
        [
          { key: "city", label: "City", render: (r) => cityLink(r.city) },
          { key: "searches", label: "Searches", right: true, render: (r) => fmt.num(r.searches) },
          { key: "growth", label: "Growth", right: true, render: (r) => (r.growth === null ? "–" : `${r.growth > 0 ? "▲" : r.growth < 0 ? "▼" : ""} ${fmt.pct(Math.abs(r.growth), 0)}`) },
          { key: "visitors", label: "Visitors", right: true, render: (r) => fmt.num(r.visitors) },
          { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
          { key: "adds", label: "Adds", right: true, render: (r) => fmt.num(r.adds) },
          { key: "zero", label: "Zero results", right: true, render: (r) => fmt.num(r.zero) },
          { key: "unserviceable", label: "No store", right: true, render: (r) => fmt.num(r.unserviceable) },
          { key: "outOfStock", label: "Out of stock", right: true, render: (r) => fmt.num(r.outOfStock) },
        ],
        d.cities,
      ),
    )}
    <div class="grid xl:grid-cols-2 gap-4">
      ${card(
        `Where to open the next store <span class="text-xs font-normal text-slate-500">(searches from areas no store serves)</span>`,
        table(
          [
            { key: "area", label: "Area", render: (r) => `${esc(r.area)} <span class="text-slate-400">${esc(r.pincode)}</span>` },
            { key: "city", label: "City", render: (r) => cityLink(r.city) },
            { key: "unserviceable", label: "Searches", right: true, render: (r) => fmt.num(r.unserviceable) },
          ],
          d.unserviceable,
        ),
      )}
      ${card(
        `What to stock <span class="text-xs font-normal text-slate-500">(searched in a store that does not have it)</span>`,
        table(
          [
            { key: "q", label: "Search", render: (r) => queryLink(r.q, r.qDisplay) },
            { key: "city", label: "City", render: (r) => cityLink(r.city) },
            { key: "outOfStock", label: "Out of stock", right: true, render: (r) => fmt.num(r.outOfStock) },
            { key: "searches", label: "Searches", right: true, render: (r) => fmt.num(r.searches) },
          ],
          d.outOfStock,
        ),
      )}
    </div>
    ${card(
      "Dark stores",
      table(
        [
          { key: "name", label: "Store" },
          { key: "city", label: "City", render: (r) => cityLink(r.city) },
          { key: "searches", label: "Searches", right: true, render: (r) => fmt.num(r.searches) },
          { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
          { key: "adds", label: "Adds", right: true, render: (r) => fmt.num(r.adds) },
          { key: "zero", label: "Zero results", right: true, render: (r) => fmt.num(r.zero) },
          { key: "outOfStock", label: "Out of stock", right: true, render: (r) => fmt.num(r.outOfStock) },
        ],
        d.stores,
      ),
    )}</div>`;

  if (!window.L) return;
  const map = window.L.map("map", { scrollWheelZoom: false });
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
  const volume = (p) => p.searches + p.unserviceable;
  const max = Math.max(1, ...d.pincodes.map(volume));
  const points = [];
  for (const p of d.pincodes) {
    if (!volume(p)) continue;
    const color = p.serviceable ? COLORS.blue : COLORS.critical;
    window.L.circleMarker([p.lat, p.lng], { radius: 5 + 18 * Math.sqrt(volume(p) / max), color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 0.7 })
      .bindTooltip(`<b>${esc(p.area)}</b>, ${esc(p.city)} ${esc(p.pincode)}<br>${fmt.num(p.searches)} searches${p.serviceable ? "" : `<br>${fmt.num(p.unserviceable)} with no store here`}`)
      .addTo(map);
    points.push([p.lat, p.lng]);
  }
  const storeIcon = window.L.divIcon({ className: "", html: `<span class="material-symbols-rounded text-slate-900 text-xl drop-shadow">storefront</span>`, iconSize: [20, 20], iconAnchor: [10, 10] });
  for (const s of d.storesList) {
    window.L.marker([s.lat, s.lng], { icon: storeIcon }).bindTooltip(`<b>${esc(s.name)}</b><br>${esc(s.city)} · serves ${s.pincodes} pincodes`).addTo(map);
    points.push([s.lat, s.lng]);
  }
  if (points.length) map.fitBounds(points, { padding: [20, 20] });
  else map.setView([22.5, 79], 5);
  return () => map.remove();
}

// ---------- /admin/locations/city?name= ----------

export async function cityDetail(el) {
  const name = params().get("name") ?? "";
  const d = await api(`/analytics/locations/city?${query({ name })}`);
  el.innerHTML = `<div class="space-y-4">
    <h2 class="text-2xl font-extrabold">${esc(d.city)}</h2>
    ${card(filters().range === "today" || filters().range === "yesterday" ? "Searches per hour" : "Searches, clicks and adds per day", chartBox("cTrend"))}
    <div class="grid xl:grid-cols-2 gap-4">
      ${card("Top searches", table(queryColumns, d.topQueries))}
      ${card("Top products", table(productColumns, d.topProducts))}
    </div>
    ${card(
      "Areas",
      table(
        [
          { key: "_id", label: "Pincode" },
          { key: "area", label: "Area" },
          { key: "searches", label: "Searches", right: true, render: (r) => fmt.num(r.searches) },
          { key: "clicks", label: "Clicks", right: true, render: (r) => fmt.num(r.clicks) },
          { key: "unserviceable", label: "No store", right: true, render: (r) => (r.unserviceable ? `${icon("block", "text-rose-700")} ${fmt.num(r.unserviceable)}` : "0") },
        ],
        d.pincodes,
      ),
    )}</div>`;
  trendChart("cTrend", d.trend);
}
