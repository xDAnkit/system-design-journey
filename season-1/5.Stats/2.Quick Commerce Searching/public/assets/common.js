// Small helpers shared by the shop and the admin pages. Plain ES modules, no build step.

/** Escape text before it goes into HTML: queries and product names are user input. */
export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Stable hue from a string, so a brand always gets the same colour */
export const hue = (s) => {
  let h = 0;
  for (const ch of String(s ?? "")) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};

/** Product tile: soft lit background from the category, icon colour from the brand (calm, never neon) */
export const tileStyle = (category, brand) => {
  const h = hue(category);
  return `background:radial-gradient(120% 100% at 30% 15%,hsl(${h} 55% 97%),hsl(${h} 38% 89%));color:hsl(${hue(brand || category)} 42% 32%)`;
};

export const icon = (name, cls = "") => `<span class="material-symbols-rounded ${cls}">${esc(name)}</span>`;

export const rupees = (n) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const num = (n) => Number(n ?? 0).toLocaleString("en-IN");
export const percent = (x, digits = 1) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`);

export const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

export const store = {
  get: (key, fallback = null) => {
    try {
      const raw = localStorage.getItem(`jaldi.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set: (key, value) => localStorage.setItem(`jaldi.${key}`, JSON.stringify(value)),
  remove: (key) => localStorage.removeItem(`jaldi.${key}`),
};

/** Random id kept in the browser: unique visitors without any login */
export const sessionId = () => {
  let id = store.get("session");
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, "");
    store.set("session", id);
  }
  return id;
};

/** fetch JSON; throws an Error with the API's message on a non-2xx answer */
export async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}
