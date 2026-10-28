// Admin pages that change things: add product (tag preview + editor), AI suggested tags, settings.
import { esc, fetchJson, icon, store } from "../common.js";
import { api, bindFilterForm, card, fmt, href, params, pill, table, pager } from "./core.js";

const LANGS = ["Hindi", "Marathi", "Bengali", "Assamese", "Gujarati", "Punjabi", "Odia", "Tamil", "Telugu", "Kannada", "Malayalam", "Urdu"];
const GROUPS = [["en", "English"], ["hinglish", "Hinglish"], ...LANGS.map((l) => [`native.${l}`, l]), ["typos", "Typos"], ["ai", "AI words"]];

const inputCls = "w-full border border-slate-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-green-600";
const btnCls = "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 font-semibold disabled:opacity-50";
const btn = { primary: `${btnCls} bg-green-700 hover:bg-green-800 text-white`, light: `${btnCls} bg-slate-100 hover:bg-slate-200 text-slate-800`, danger: `${btnCls} bg-rose-50 hover:bg-rose-100 text-rose-700` };

const blankTags = () => ({ en: [], hinglish: [], native: {}, typos: [], ai: [] });

const copyTags = (t) => ({
  en: [...(t?.en ?? [])],
  hinglish: [...(t?.hinglish ?? [])],
  native: Object.fromEntries(Object.entries(t?.native ?? {}).map(([k, v]) => [k, [...v]])),
  typos: [...(t?.typos ?? [])],
  ai: [...(t?.ai ?? [])],
});

export const tagCount = (t) => (t ? t.en.length + t.hinglish.length + t.typos.length + t.ai.length + Object.values(t.native ?? {}).reduce((s, v) => s + v.length, 0) : 0);

/** Chips per tag group: × removes, typing + Enter (or comma) adds. onChange runs after every edit. */
export function tagEditor(root, initial, onChange = () => {}) {
  let tags = copyTags(initial ?? blankTags());
  const listOf = (key) => (key.startsWith("native.") ? (tags.native[key.slice(7)] ??= []) : tags[key]);

  const draw = () => {
    root.innerHTML = GROUPS.map(
      ([key, label]) => `<div class="py-2 border-t border-slate-100 first:border-0 flex gap-3 items-start">
        <div class="w-24 shrink-0 text-xs font-semibold text-slate-500 pt-1">${label}</div>
        <div class="flex flex-wrap items-center gap-1.5 flex-1">
          ${listOf(key)
            .map(
              (t, i) =>
                `<span class="inline-flex items-center gap-1 bg-slate-100 rounded-full pl-2.5 pr-1 py-0.5 text-sm">${esc(t)}<button type="button" data-remove="${key}" data-i="${i}" class="w-5 h-5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50" aria-label="Remove ${esc(t)}">×</button></span>`,
            )
            .join("")}
          <input data-add="${key}" aria-label="Add ${label} tag" class="min-w-[110px] flex-1 text-sm outline-none border-b border-dashed border-slate-300 focus:border-green-600 px-1 py-0.5" placeholder="add + Enter" />
        </div></div>`,
    ).join("");
  };

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b) return;
    listOf(b.dataset.remove).splice(Number(b.dataset.i), 1);
    draw();
    onChange();
  });
  root.addEventListener("keydown", (e) => {
    const input = e.target.closest("[data-add]");
    if (!input || (e.key !== "Enter" && e.key !== ",")) return;
    e.preventDefault();
    const key = input.dataset.add;
    const list = listOf(key);
    for (const v of input.value.split(",").map((s) => s.trim().toLowerCase())) if (v && !list.includes(v)) list.push(v);
    draw();
    onChange();
    root.querySelector(`[data-add="${key}"]`)?.focus();
  });
  draw();

  return {
    get: () => {
      const out = copyTags(tags);
      for (const [lang, list] of Object.entries(out.native)) if (!list.length) delete out.native[lang];
      return out;
    },
    set: (t) => {
      tags = copyTags(t ?? blankTags());
      draw();
    },
  };
}

/** Approve / reject buttons inside root; after a click, refresh() redraws the page */
export function bindSuggestionActions(root, refresh) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-approve],[data-reject]");
    if (!b) return;
    b.disabled = true;
    const id = b.dataset.approve ?? b.dataset.reject;
    try {
      await api(`/analytics/suggestions/${id}/${b.dataset.approve ? "approve" : "reject"}`, { method: "POST" });
      await refresh();
    } catch (err) {
      b.disabled = false;
      alert(err.message);
    }
  });
}

const statusPill = (s) => pill(s.status === "active" ? `live (${s.activatedBy ?? "clicks"})` : s.status === "rejected" ? `rejected (${s.rejectedBy ?? "admin"})` : "candidate", s.status === "active" ? "green" : s.status === "rejected" ? "red" : "amber");
const aiPill = (s) => `<span title="${esc(s.aiReason ?? "")}">${pill(`AI: ${s.aiCheck}`, s.aiCheck === "yes" ? "green" : s.aiCheck === "no" ? "red" : "slate")}</span>`;
const actions = (s) =>
  `<div class="flex gap-1 justify-end">${s.status !== "active" ? `<button data-approve="${s._id}" class="text-xs font-semibold px-2 py-1 rounded-lg bg-green-50 text-green-800 hover:bg-green-100">Approve</button>` : ""}${
    s.status !== "rejected" ? `<button data-reject="${s._id}" class="text-xs font-semibold px-2 py-1 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100">Reject</button>` : ""
  }</div>`;

/** columns for a suggestions table; without.product / without.query hide the column the page already shows */
export const suggestionColumns = (without = {}) =>
  [
    !without.query && { key: "q", label: "Search", render: (s) => `<a class="text-green-800 hover:underline" href="${href("/admin/searches/detail", { q: s.q })}">${esc(s.qDisplay || s.q)}</a>` },
    !without.product && { key: "productName", label: "Product", render: (s) => `<a class="hover:underline" href="${href(`/admin/products/${s.productId}`)}">${esc(s.productName)}</a>` },
    { key: "aiCheck", label: "AI check", render: aiPill },
    { key: "searches", label: "Searches", right: true, render: (s) => fmt.num(s.searches) },
    { key: "clicks", label: "Clicks", right: true, render: (s) => fmt.num(s.clicks) },
    { key: "sessions", label: "Sessions", right: true, render: (s) => fmt.num(s.sessions) },
    { key: "adds", label: "Adds", right: true, render: (s) => fmt.num(s.adds) },
    { key: "status", label: "Status", render: statusPill },
    { key: "_id", label: "", right: true, render: actions },
  ].filter(Boolean);

// ---------- /admin/suggestions ----------

export async function suggestions(el) {
  const draw = async () => {
    const p = params();
    const status = p.get("status") ?? "candidate";
    const page = Number(p.get("page") ?? 1);
    const d = await api(`/analytics/suggestions?${new URLSearchParams({ ...(status !== "all" ? { status } : {}), ...(p.get("q") ? { q: p.get("q") } : {}), page: String(page), limit: "25" })}`);
    const tab = (key, label) =>
      `<a href="${href("/admin/suggestions", { status: key, q: p.get("q") })}" class="px-3 py-1.5 rounded-lg text-sm font-semibold ${status === key ? "bg-green-700 text-white" : "bg-slate-100 hover:bg-slate-200"}">${label}</a>`;
    el.innerHTML = `<div class="space-y-4">
      ${card(
        "",
        `<p class="text-sm text-slate-600">A search found a product <b>only by meaning</b> (vector match, no keyword match). That pair becomes a <b>candidate</b>.
         The AI checks if it makes sense. It goes <b>live</b> as a search tag after enough real clicks from different shoppers, or right away when you approve it.</p>`,
      )}
      ${card(
        "",
        `<div class="flex flex-wrap gap-2 items-center mb-3">${tab("candidate", "Candidates")}${tab("active", "Live")}${tab("rejected", "Rejected")}${tab("all", "All")}
          <form data-filter class="ml-auto flex gap-2"><input name="q" value="${esc(p.get("q") ?? "")}" placeholder="Search text contains..." class="${inputCls} !py-1.5 text-sm" /><button class="${btn.light} !py-1.5 text-sm">Filter</button></form></div>
         ${table(suggestionColumns(), d.rows)}${pager(d.total, d.page, d.limit)}`,
      )}</div>`;
    bindFilterForm(el);
  };
  bindSuggestionActions(el, draw);
  await draw();
}

// ---------- /admin/products/new ----------

export async function addProduct(el) {
  const [{ aisles, categories }, stores] = await Promise.all([api("/products/categories"), fetchJson("/locations/stores")]);
  const cats = new Map(categories.map((c) => [c.key, c]));
  const cities = [...new Set(stores.map((s) => s.city))];

  el.innerHTML = `<div class="grid lg:grid-cols-5 gap-4 items-start">
    <form id="productForm" class="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
      <h2 class="font-bold">Product</h2>
      <label class="block text-sm font-medium">Name *<input name="name" required minlength="2" maxlength="120" class="${inputCls} mt-1" placeholder="Amul Taaza Toned Milk" /></label>
      <label class="block text-sm font-medium">Brand<input name="brand" maxlength="60" class="${inputCls} mt-1" placeholder="Amul" /></label>
      <label class="block text-sm font-medium">Category *
        <select name="category" required class="${inputCls} mt-1"><option value="">Pick one (the tag preview can guess it)</option>
          ${aisles.map((a) => `<optgroup label="${esc(a.label)}">${a.categories.map((k) => `<option value="${esc(k)}">${esc(cats.get(k)?.label ?? k)}</option>`).join("")}</optgroup>`).join("")}
        </select></label>
      <div class="grid grid-cols-3 gap-2">
        <label class="block text-sm font-medium">Size<input name="size" maxlength="30" class="${inputCls} mt-1" placeholder="500 ml" /></label>
        <label class="block text-sm font-medium">Price ₹ *<input name="price" required type="number" min="0" max="100000" step="0.01" class="${inputCls} mt-1" /></label>
        <label class="block text-sm font-medium">MRP ₹<input name="mrp" type="number" min="0" max="100000" step="0.01" class="${inputCls} mt-1" /></label>
      </div>
      <fieldset class="text-sm"><legend class="font-medium">In stock in (dark stores of these cities)</legend>
        <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1">${cities.map((c) => `<label class="inline-flex items-center gap-1.5"><input type="checkbox" name="city" value="${esc(c)}" checked class="accent-green-700" />${esc(c)}</label>`).join("")}</div>
      </fieldset>
      <p id="formMsg" class="text-sm text-rose-700"></p>
      <button id="saveBtn" class="${btn.primary} w-full justify-center">${icon("cloud_upload")} Save product</button>
      <div id="progress" class="hidden"></div>
    </form>
    <section class="lg:col-span-3 bg-white rounded-2xl border border-slate-200 p-5">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="font-bold mr-auto">Search tags</h2>
        <button type="button" id="rulesBtn" class="${btn.light} text-sm">${icon("bolt")} Quick tags (rules)</button>
        <button type="button" id="aiBtn" class="${btn.primary} text-sm">${icon("auto_awesome")} Generate with AI</button>
      </div>
      <p id="tagInfo" class="text-xs text-slate-500 mt-2">Fill the name and leave the field: dictionary tags show up. "Generate with AI" adds the LLM (2-6 s).
        Changing the name, brand or category makes fresh tags. Saved tags are used as they are, the worker skips the LLM for them.</p>
      <div id="tagEditor" class="mt-3"></div>
    </section></div>`;

  const form = el.querySelector("#productForm");
  // form.name is the form's own name attribute, so fields go through namedItem
  const field = (n) => form.elements.namedItem(n);
  const info = el.querySelector("#tagInfo");
  const msg = el.querySelector("#formMsg");
  let preview = null; // { name, tagsFor } of the tags in the editor
  let seq = 0; // only the newest preview may fill the editor
  let guessedCategory = false; // the category came from a preview, not from the admin
  const editor = tagEditor(el.querySelector("#tagEditor"), null);
  const IDLE = info.textContent;

  // old tags go first, so tags of one title never mix with another
  const runPreview = async (mode) => {
    const mine = ++seq;
    editor.set(null);
    preview = null;
    const name = field("name").value.trim();
    if (name.length < 2) return void (info.textContent = IDLE);
    // only the AI button waits: leaving the name field by clicking it must not swallow the click
    const aiBtn = el.querySelector("#aiBtn");
    if (mode === "full") aiBtn.disabled = true;
    info.textContent = mode === "full" ? "Asking the AI..." : "Making tags...";
    try {
      const r = await api("/products/preview-tags", { method: "POST", body: JSON.stringify({ name, brand: field("brand").value.trim() || undefined, category: field("category").value || undefined, mode }) });
      if (mine !== seq) return;
      editor.set(r.tags);
      preview = { name, tagsFor: r.tagsFor };
      if (!field("category").value && r.category && cats.has(r.category)) {
        field("category").value = r.category;
        guessedCategory = true;
      }
      field("brand").placeholder = r.brand ? `${r.brand} (detected)` : "Amul";
      const parts = [`${tagCount(r.tags)} tags in ${fmt.ms(r.ms)}`, r.llmUsed ? "dictionary + AI" : "dictionary only"];
      if (r.corrected && r.corrected.toLowerCase() !== name.toLowerCase()) parts.push(`spelling read as "${r.corrected}"`);
      if (r.category) parts.push(`category: ${cats.get(r.category)?.label ?? r.category}`);
      if (r.llmError) parts.push(`AI failed: ${r.llmError}`);
      info.textContent = parts.join(" · ");
    } catch (err) {
      if (mine === seq) info.textContent = `Preview failed: ${err.message}`;
    } finally {
      if (mode === "full") aiBtn.disabled = false;
    }
  };

  // "change" fires when the admin leaves a field they edited
  field("name").addEventListener("change", () => {
    // a guessed category belongs to the old name; a category the admin picked stays
    if (guessedCategory) field("category").value = "";
    guessedCategory = false;
    runPreview("rules");
  });
  field("brand").addEventListener("change", () => runPreview("rules"));
  field("category").addEventListener("change", () => {
    guessedCategory = false;
    runPreview("rules");
  });
  el.querySelector("#rulesBtn").addEventListener("click", () => runPreview("rules"));
  el.querySelector("#aiBtn").addEventListener("click", () => runPreview("full"));

  let timer = null;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    const picked = [...form.querySelectorAll('input[name="city"]:checked')].map((c) => c.value);
    if (!picked.length) return void (msg.textContent = "Pick at least one city.");
    const name = field("name").value.trim();
    const tags = editor.get();
    const body = {
      name,
      brand: field("brand").value.trim(),
      category: field("category").value,
      size: field("size").value.trim(),
      price: Number(field("price").value),
      ...(field("mrp").value ? { mrp: Number(field("mrp").value) } : {}),
      // all cities = leave it out, the API puts the product in every store
      ...(picked.length < cities.length ? { storeIds: stores.filter((s) => picked.includes(s.city)).map((s) => s.id) } : {}),
      // tags made for another title would be thrown away by the worker anyway
      ...(tagCount(tags) && preview?.name === name ? { tags, tagsFor: preview.tagsFor } : {}),
    };
    const save = el.querySelector("#saveBtn");
    save.disabled = true;
    try {
      const { id } = await api("/products", { method: "POST", body: JSON.stringify(body) });
      track(id);
    } catch (err) {
      msg.textContent = err.message;
      save.disabled = false;
    }
  });

  // wait until the product is searchable (GET /products/:id), then say so in plain words
  const progress = el.querySelector("#progress");
  const show = (tone, ic, text, links = "") => {
    const tones = { busy: "bg-slate-50 text-slate-700", done: "bg-green-50 text-green-900", fail: "bg-rose-50 text-rose-800", slow: "bg-amber-50 text-amber-900" };
    progress.classList.remove("hidden");
    progress.innerHTML = `<div class="rounded-xl p-4 text-sm ${tones[tone]}"><p class="flex items-center gap-2 font-semibold">${icon(ic, tone === "busy" ? "animate-spin" : "")} ${text}</p>${links ? `<p class="mt-2">${links}</p>` : ""}</div>`;
  };
  const link = (url, text, newTab = false) => `<a class="underline font-medium" href="${url}"${newTab ? ' target="_blank"' : ""}>${text}</a>`;
  const track = (id) => {
    let tries = 0;
    const tick = async () => {
      tries++;
      const product = await api(`/products/${id}`).catch(() => null); // 404 until it is saved
      if (product?.status === "indexed") {
        return show("done", "check_circle", "Product added. Shoppers can find it now.", [link(href(`/admin/products/${id}`), "View product"), link(`/?q=${encodeURIComponent(product.name)}`, "Find it in the shop", true), link("/admin/products/new", "Add another")].join(" · "));
      }
      if (product?.status === "failed") return show("fail", "error", "Could not finish adding this product.", link(href(`/admin/products/${id}`), "View product"));
      if (tries > 120) return show("slow", "schedule", "This is taking longer than usual. It will show up in Products when it is ready.");
      timer = setTimeout(tick, 1500);
    };
    show("busy", "progress_activity", "Adding your product...");
    tick();
  };

  return () => clearTimeout(timer);
}

// ---------- /admin/settings ----------

const MODEL_HINTS = { ollama: "gemma3:4b", anthropic: "claude-haiku-5-5", openai: "", gemini: "" };

export async function settings(el) {
  const draw = async () => {
    const s = await api("/settings/ai");
    const providers = Object.keys(MODEL_HINTS);
    const ix = s.searchIndex;
    el.innerHTML = `<div class="grid lg:grid-cols-2 gap-4 items-start">
      ${card(
        "Admin key",
        `<p class="text-sm text-slate-600 mb-2">Sent as the <code>x-admin-key</code> header. Kept only in this browser.</p>
         <form id="keyForm" class="flex gap-2"><input name="key" type="password" value="${esc(store.get("adminKey") ?? "")}" class="${inputCls}" placeholder="ADMIN_KEY from .env" /><button class="${btn.primary}">Save</button></form>`,
      )}
      ${card(
        "AI model for tags and query rewrite",
        `<dl class="text-sm grid grid-cols-3 gap-y-1 mb-4">
          <dt class="text-slate-500">In use</dt><dd class="col-span-2 font-semibold">${esc(s.llm.provider)} · ${esc(s.llm.model)} ${s.overridden ? pill("set here", "blue") : pill("from .env")}</dd>
          <dt class="text-slate-500">.env default</dt><dd class="col-span-2">${esc(s.envLlm.provider)} · ${esc(s.envLlm.model)}</dd>
          <dt class="text-slate-500">Fallback</dt><dd class="col-span-2">${s.fallback ? `${esc(s.fallback.provider)} · ${esc(s.fallback.model)}` : "none"}</dd>
        </dl>
        <form id="aiForm" class="grid grid-cols-5 gap-2 items-end">
          <label class="col-span-2 text-sm font-medium">Provider<select name="provider" class="${inputCls} mt-1">
            ${providers.map((p) => `<option value="${p}" ${p === s.llm.provider ? "selected" : ""} ${s.configuredProviders.includes(p) ? "" : "disabled"}>${p}${s.configuredProviders.includes(p) ? "" : " (no key in .env)"}</option>`).join("")}
          </select></label>
          <label class="col-span-3 text-sm font-medium">Model<input name="model" required maxlength="100" value="${esc(s.llm.model)}" class="${inputCls} mt-1" /></label>
          <div class="col-span-5 flex gap-2 mt-1"><button class="${btn.primary}">Switch model</button>
            <button type="button" id="resetAi" class="${btn.light}" ${s.overridden ? "" : "disabled"}>Back to .env</button></div>
          <p id="aiMsg" class="col-span-5 text-sm"></p>
        </form>
        <p class="text-xs text-slate-500 mt-3">The API and every worker pick up a switch within 10 seconds, no restart.</p>`,
      )}
      ${card(
        "Embeddings and search index",
        `<dl class="text-sm grid grid-cols-3 gap-y-1">
          <dt class="text-slate-500">Embed model</dt><dd class="col-span-2 font-semibold">${esc(s.embed.id)}${s.embed.dims ? ` · ${s.embed.dims} dims` : ""}</dd>
          <dt class="text-slate-500">Index</dt><dd class="col-span-2">${ix ? esc(ix.collection) : "not created yet"}</dd>
          <dt class="text-slate-500">Index vectors</dt><dd class="col-span-2">${ix ? `${esc(ix.embedModel)} · ${ix.dims} dims` : "–"}</dd>
        </dl>
        ${
          !ix
            ? `<p class="text-sm mt-3 bg-amber-50 text-amber-900 rounded-xl p-3">${icon("warning")} No search index yet. Run <code>pnpm seed:products</code>, then <code>pnpm reindex</code>.</p>`
            : ix.needsReindex
              ? `<p class="text-sm mt-3 bg-amber-50 text-amber-900 rounded-xl p-3">${icon("warning")} The embed model in .env is not the one in the index, so search runs keyword only. Run <code>pnpm reindex</code>.</p>`
              : `<p class="text-sm mt-3 text-green-800">${icon("check_circle")} Index and .env use the same embed model.</p>`
        }
        <p class="text-xs text-slate-500 mt-3">Embeddings change only in .env (AI_EMBED_PROVIDER / AI_EMBED_MODEL) followed by <code>pnpm reindex</code>: old and new vectors cannot be mixed.</p>`,
      )}</div>`;

    el.querySelector("#keyForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const key = e.target.key.value.trim();
      if (key) store.set("adminKey", key);
      else store.remove("adminKey");
      draw();
    });
    const aiForm = el.querySelector("#aiForm");
    const aiMsg = el.querySelector("#aiMsg");
    aiForm.provider.addEventListener("change", () => (aiForm.model.value = aiForm.provider.value === s.llm.provider ? s.llm.model : MODEL_HINTS[aiForm.provider.value]));
    aiForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/settings/ai", { method: "PUT", body: JSON.stringify({ provider: aiForm.provider.value, model: aiForm.model.value.trim() }) });
        await draw();
      } catch (err) {
        aiMsg.className = "col-span-5 text-sm text-rose-700";
        aiMsg.textContent = err.message;
      }
    });
    el.querySelector("#resetAi").addEventListener("click", async () => {
      await api("/settings/ai", { method: "DELETE" }).catch((err) => alert(err.message));
      await draw();
    });
  };
  await draw();
}
