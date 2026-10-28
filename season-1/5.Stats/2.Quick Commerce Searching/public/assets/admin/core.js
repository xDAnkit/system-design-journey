// Admin plumbing: API calls with the admin key, filters kept in the URL, tables, KPI tiles, charts.
import { esc, fetchJson, num, percent, store } from "../common.js";

// ---------- API ----------

const askKey = () => {
  const key = prompt("Admin key (ADMIN_KEY in .env; in dev the default is dev-admin-key)");
  if (!key) return false;
  store.set("adminKey", key.trim());
  return true;
};

/** fetch JSON with the admin key; on 401 it asks for the key and tries again */
export async function api(path, options = {}) {
  const method = options.method ?? "GET";
  // Fastify rejects an empty body with a JSON content type, so writes always send one
  const body = method === "GET" ? undefined : (options.body ?? "{}");
  try {
    return await fetchJson(path, { ...options, method, body, headers: { "x-admin-key": store.get("adminKey") ?? "" } });
  } catch (err) {
    if (err.status === 401 && askKey()) return api(path, options);
    throw err;
  }
}

// ---------- URL state ----------

export const params = () => new URLSearchParams(location.search);

/** range + city from the top bar, the same on every page */
export const filters = () => {
  const p = params();
  return { range: p.get("range") || "7d", from: p.get("from") || "", to: p.get("to") || "", city: p.get("city") || "" };
};

/** query string with the current filters plus page params; empty values are left out */
export const query = (extra = {}) => {
  const f = filters();
  const out = new URLSearchParams({ range: f.range });
  if (f.range === "custom") {
    if (f.from) out.set("from", f.from);
    if (f.to) out.set("to", f.to);
  }
  if (f.city) out.set("city", f.city);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== "") out.set(k, String(v));
  return out.toString();
};

/** a link inside the admin that keeps the filters */
export const href = (path, extra) => `${path}?${query(extra)}`;

/** the current page's params (sort, page, q...) plus changes, filters kept */
export const withParams = (changes) => {
  const p = Object.fromEntries(params());
  return href(location.pathname, { ...p, ...changes });
};

export const navigate = (url) => {
  history.pushState(null, "", url);
  window.dispatchEvent(new Event("admin:navigate"));
};

// ---------- formatting ----------

export const fmt = {
  num: (v) => (v === null || v === undefined ? "–" : num(Math.round(v))),
  pct: (v, digits) => percent(v, digits),
  dec: (v) => (v === null || v === undefined ? "–" : Number(v).toFixed(1)),
  ms: (v) => (v === null || v === undefined ? "–" : `${num(v)} ms`),
  date: (v) => (v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "–"),
};

// ---------- building blocks ----------

export const card = (title, body, extra = "") =>
  `<section class="bg-white rounded-2xl border border-slate-200 p-5 ${extra}">${title ? `<h2 class="font-bold text-slate-800 mb-3">${title}</h2>` : ""}${body}</section>`;

export const empty = (text = "No data for this range yet.") => `<p class="text-sm text-slate-500 py-6 text-center">${esc(text)}</p>`;

export const pill = (text, tone = "slate") => {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-green-100 text-green-800",
    red: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-900",
    blue: "bg-blue-100 text-blue-800",
  };
  return `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone] ?? tones.slate}">${esc(text)}</span>`;
};

/**
 * KPI tile. change: { value, kind: "pct" | "pts", goodWhen: "up" | "down" }.
 * The arrow and the words carry the meaning, the colour only helps.
 */
export function kpi(label, value, change) {
  let delta = `<div class="text-xs text-slate-400 mt-1">&nbsp;</div>`;
  if (change && change.value !== null && change.value !== undefined) {
    const v = change.value;
    const up = v > 0;
    const good = v === 0 ? null : up === ((change.goodWhen ?? "up") === "up");
    const text = change.kind === "pts" ? `${Math.abs(v * 100).toFixed(1)} pts` : `${Math.abs(v * 100).toFixed(0)}%`;
    const tone = good === null ? "text-slate-500" : good ? "text-green-800" : "text-rose-700";
    delta = `<div class="text-xs mt-1 ${tone}">${v === 0 ? "no change" : `${up ? "▲" : "▼"} ${text}`} <span class="text-slate-400">vs previous period</span></div>`;
  }
  return `<div class="bg-white rounded-2xl border border-slate-200 p-4">
    <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">${esc(label)}</div>
    <div class="text-2xl font-extrabold mt-1 tabular-nums">${value}</div>${delta}</div>`;
}

export const kpiGrid = (tiles) => `<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">${tiles.join("")}</div>`;

/**
 * Table. columns: [{ key, label, render?(row), sort?: true, right?: true }]
 * sort: { by, order } turns sortable headers into links (the server sorts).
 */
export function table(columns, rows, sort) {
  if (!rows?.length) return empty();
  const head = columns
    .map((c) => {
      const align = c.right ? "text-right" : "text-left";
      if (!c.sort || !sort) return `<th class="px-3 py-2 ${align} font-semibold">${esc(c.label)}</th>`;
      const active = sort.by === c.key;
      const next = active && sort.order === "desc" ? "asc" : "desc";
      const arrow = active ? (sort.order === "desc" ? " ↓" : " ↑") : "";
      return `<th class="px-3 py-2 ${align} font-semibold"><a class="hover:text-green-700 ${active ? "text-green-800" : ""}" href="${withParams({ sort: c.key, order: next, page: 1 })}">${esc(c.label)}${arrow}</a></th>`;
    })
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr class="border-t border-slate-100 hover:bg-slate-50">${columns
          .map((c) => `<td class="px-3 py-2 ${c.right ? "text-right tabular-nums" : ""}">${c.render ? c.render(r) : esc(r[c.key])}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="text-xs uppercase tracking-wide text-slate-500">${head}</thead><tbody>${body}</tbody></table></div>`;
}

export function pager(total, page, limit) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return `<p class="text-xs text-slate-500 mt-3">${num(total)} rows</p>`;
  const btn = (p, label, on) =>
    on ? `<a href="${withParams({ page: p })}" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-100">${label}</a>` : `<span class="px-3 py-1 rounded-lg border border-slate-100 text-slate-300">${label}</span>`;
  return `<div class="flex items-center gap-2 mt-3 text-sm">${btn(page - 1, "‹ Prev", page > 1)}<span class="text-slate-600">Page ${page} of ${num(pages)} · ${num(total)} rows</span>${btn(page + 1, "Next ›", page < pages)}</div>`;
}

export const errorBox = (err) =>
  `<div class="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl p-5"><b>Could not load this page.</b><p class="text-sm mt-1">${esc(err?.message ?? err)}</p>
   <p class="text-xs mt-2 text-rose-700">Is the API running with Mongo, Redis and Typesense up? Check <a class="underline" href="/ready">/ready</a>.</p></div>`;

// ---------- charts (Chart.js from the CDN, global "Chart") ----------

// Validated categorical slots 1-3 (dataviz reference palette); status red only for "no store / zero" states.
export const COLORS = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", critical: "#d03b3b", grid: "#eceae6", ink: "#52514e" };
const SERIES = [COLORS.blue, COLORS.orange, COLORS.aqua];

let charts = [];
export const destroyCharts = () => {
  for (const c of charts) c.destroy();
  charts = [];
};

const baseOptions = (legend) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { display: legend, position: "bottom", labels: { usePointStyle: true, boxWidth: 8, color: COLORS.ink } },
    tooltip: { padding: 10, boxPadding: 4, usePointStyle: true },
  },
  scales: {
    x: { grid: { display: false }, ticks: { color: COLORS.ink, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
    y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: COLORS.ink, precision: 0 } },
  },
});

/** series: [{ label, data }] on one y axis; the legend shows when there are 2+ series */
export function lineChart(canvasId, labels, series) {
  const el = document.getElementById(canvasId);
  if (!el || !window.Chart) return;
  const chart = new window.Chart(el, {
      type: "line",
      data: {
        labels,
        datasets: series.map((s, i) => ({ label: s.label, data: s.data, borderColor: SERIES[i], backgroundColor: SERIES[i], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25 })),
      },
      options: baseOptions(series.length > 1),
    });
  charts.push(chart);
  return chart;
}

export function barChart(canvasId, labels, data, { horizontal = false, label = "Searches" } = {}) {
  const el = document.getElementById(canvasId);
  if (!el || !window.Chart) return;
  const options = baseOptions(false);
  if (horizontal) {
    options.indexAxis = "y";
    options.interaction = { mode: "nearest", axis: "y", intersect: false };
    options.scales = { x: options.scales.y, y: { ...options.scales.x, ticks: { ...options.scales.x.ticks, autoSkip: false } } };
  }
  const chart = new window.Chart(el, { type: "bar", data: { labels, datasets: [{ label, data, backgroundColor: COLORS.blue, borderRadius: 4, maxBarThickness: 28 }] }, options });
  charts.push(chart);
  return chart;
}

/** form[data-filter]: submit puts its fields in the URL (page back to 1); an empty field drops the param */
export function bindFilterForm(root) {
  root.querySelector("form[data-filter]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const changes = { page: "" };
    for (const input of e.target.elements) {
      if (!input.name) continue;
      changes[input.name] = input.type === "checkbox" ? (input.checked ? input.value : "") : input.value.trim();
    }
    navigate(withParams(changes));
  });
}

export const chartBox = (id, height = 260) => `<div style="height:${height}px"><canvas id="${id}"></canvas></div>`;

/** "2026-10-27" -> "27 Oct", hour labels stay as they are */
export const dayLabel = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : s);
