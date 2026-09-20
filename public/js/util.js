/**
 * Shared format / fetch helpers for FX Analysis tabs.
 * Never invent numbers — only render snapshot / API fields.
 */

export const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatInr(n, opts = {}) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  if (opts.compact !== false && abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (opts.compact !== false && abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return (
    "₹" +
    v.toLocaleString("en-IN", {
      maximumFractionDigits: abs >= 100 ? 2 : abs >= 1 ? 4 : 6,
      minimumFractionDigits: 0,
    })
  );
}

export function formatPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function formatRate(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
  return v.toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(2, digits),
  });
}

export function formatNum(n, digits) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);
  const d =
    digits != null
      ? digits
      : abs >= 1000
        ? 2
        : abs >= 100
          ? 3
          : abs >= 1
            ? 4
            : abs >= 1e-4
              ? 6
              : 8;
  return v.toLocaleString("en-IN", {
    maximumFractionDigits: d,
    minimumFractionDigits: Math.min(2, d),
  });
}

export function chgClass(n) {
  if (n == null || !Number.isFinite(Number(n))) return "chg-flat";
  const v = Number(n);
  if (v > 0) return "chg-up";
  if (v < 0) return "chg-down";
  return "chg-flat";
}

/**
 * Color class for relative-strength / slip scores.
 * Positive = selected strengthened vs leg → green (ok).
 * Opposite of chgClass, which is for INR-per-1 FX level Δ% (higher = weaker INR → red).
 */
export function strengthClass(n) {
  if (n == null || !Number.isFinite(Number(n))) return "strength-flat";
  const v = Number(n);
  if (v > 0) return "strength-up";
  if (v < 0) return "strength-down";
  return "strength-flat";
}

export function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text ?? "—";
}

/** Fetch JSON with a hard timeout so hydration cannot hang forever. */
async function fetchJsonTimed(url, ms = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadSnapshot() {
  // Prefer live API; race with 4s timeout, then fall back to baked snapshot.
  try {
    const res = await fetchJsonTimed("/api/snapshot", 4000);
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) return { data, via: "api" };
    }
  } catch {
    /* fall through to baked */
  }
  try {
    const res = await fetchJsonTimed("/data/snapshot.json", 4000);
    if (!res.ok) throw new Error(`snapshot fetch failed (${res.status})`);
    return { data: await res.json(), via: "baked" };
  } catch (err) {
    throw new Error(`snapshot unavailable: ${err?.message || err}`);
  }
}

let _historyCache = null;

export async function loadHistory() {
  if (_historyCache) return _historyCache;
  try {
    const res = await fetch("/api/history", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) {
        _historyCache = { data, via: "api" };
        return _historyCache;
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const res = await fetch("/data/history.json", { cache: "no-store" });
    if (res.ok) {
      _historyCache = { data: await res.json(), via: "baked" };
      return _historyCache;
    }
  } catch {
    /* none */
  }
  return { data: null, via: "none" };
}

export async function loadCompare(code, snapFallback) {
  const q = encodeURIComponent(code);
  try {
    const res = await fetch(`/api/compare?code=${q}`, { cache: "no-store" });
    if (res.status === 404) {
      const body = await res.json().catch(() => ({}));
      return { error: "not_found", body };
    }
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) return { data, via: "api" };
    }
  } catch {
    /* fall through */
  }
  let snap = snapFallback;
  let via = "client";
  if (!snap) {
    const loaded = await loadSnapshot();
    snap = loaded.data;
    via = `client/${loaded.via}`;
  } else {
    via = "client/cached";
  }
  const { buildCompare, majorPickerCodes } = await import("./compare-lib.js");
  const data = buildCompare(snap, code);
  if (!data) {
    return { error: "not_found", body: { selectable: majorPickerCodes(snap) } };
  }
  return { data, via };
}

/** Parse real path (preferred) or legacy hash → { view, code } */
export function parseRoute() {
  // Legacy hash deep-links still work once, then we normalize to paths
  const hash = (location.hash || "").replace(/^#/, "").trim();
  if (hash) {
    const parts = hash.split("/").filter(Boolean);
    const tab = (parts[0] || "").toLowerCase();
    if (tab === "compare") {
      return { view: "compare", code: parts[1] ? parts[1].toUpperCase() : "USD" };
    }
    if (tab === "slip" || tab === "rank" || tab === "slip-rank" || tab === "everywhere") {
      return { view: "slip", code: null };
    }
    if (tab === "how" || tab === "method" || tab === "methodology") {
      return { view: "how", code: null };
    }
    if (tab === "desk") return { view: "desk", code: null };
    if (tab === "home" || tab === "") return { view: "home", code: null };
  }

  const path = (location.pathname || "/").replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  const head = (parts[0] || "").toLowerCase();
  if (!head) return { view: "home", code: null };
  if (head === "desk") return { view: "desk", code: null };
  if (head === "compare") {
    return { view: "compare", code: parts[1] ? parts[1].toUpperCase() : "USD" };
  }
  if (head === "slip" || head === "everywhere") return { view: "slip", code: null };
  if (head === "how") return { view: "how", code: null };
  if (head === "notes" && parts[1]) return { view: "notes", code: parts[1] };
  return { view: "home", code: null };
}

/** @deprecated use parseRoute */
export function parseHash() {
  const r = parseRoute();
  return { tab: r.view === "home" ? "desk" : r.view, code: r.code };
}

export function pathFor(view, code) {
  if (view === "home" || view === "" || view == null) return "/";
  if (view === "compare") {
    const c = (code || "USD").toUpperCase();
    return `/compare/${c}`;
  }
  if (view === "notes" && code) return `/notes/${code}`;
  return `/${view}`;
}

export function setPath(view, code, { replace = true } = {}) {
  const next = pathFor(view, code);
  const cur = (location.pathname || "/") + (location.search || "");
  if (cur === next && !location.hash) return;
  if (replace) history.replaceState(null, "", next);
  else history.pushState(null, "", next);
}

/** @deprecated use setPath */
export function setHash(tab, code) {
  setPath(tab === "desk" && !code ? "desk" : tab, code);
}

/** SEO / social meta for a view */
export const VIEW_META = {
  home: {
    title: "Is the rupee weak only against the dollar? · FX Analysis",
    description:
      "Session snapshot of INR vs the dollar and majors — research desk, snapshot-only, no invented prices.",
  },
  desk: {
    title: "Desk · FX Analysis · INR real-strength",
    description:
      "INR desk board: KPIs, slip flags, rupee vs majors, gold and oil in rupees, yields, and shock/breadth.",
  },
  compare: {
    title: "Compare · FX Analysis",
    description:
      "Compare any FX code or hard asset vs INR, USD, gold, and the key basket — from the baked snapshot.",
  },
  slip: {
    title: "Everywhere? · Slip vs USD · FX Analysis",
    description:
      "If INR slips vs USD, does it slip vs peers, gold, oil, and BTC? Slip matrix from snapshot and ECB history.",
  },
  how: {
    title: "How this desk works · FX Analysis",
    description:
      "Methodology, quote convention, sources, assumptions, and integrity notes for the FX Analysis INR desk.",
  },
  notes: {
    title: "Daily note · FX Analysis",
    description: "Snapshot-generated INR takeaway note — research commentary only, not RBI REER.",
  },
};

export function applyViewMeta(view, code) {
  const base = VIEW_META[view] || VIEW_META.home;
  let title = base.title;
  let description = base.description;
  if (view === "compare" && code) {
    title = `Compare ${String(code).toUpperCase()} · FX Analysis`;
    description = `Cross-rates and relative strength for ${String(code).toUpperCase()} vs INR, USD, gold, and key peers.`;
  }
  if (view === "notes" && code) {
    title = `INR takeaway · ${code} · FX Analysis`;
  }
  document.title = title;
  const setMeta = (sel, attr, val) => {
    let el = document.querySelector(sel);
    if (!el && attr === "content") {
      /* skip create for unknown */
      return;
    }
    if (el) el.setAttribute(attr, val);
  };
  const ensure = (attrName, attrVal, content) => {
    let el = document.querySelector(`meta[${attrName}="${attrVal}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attrName, attrVal);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  };
  ensure("name", "description", description);
  ensure("property", "og:title", title);
  ensure("property", "og:description", description);
  ensure("property", "og:type", "website");
  const path = pathFor(view, code);
  const url = "https://fx-analysis.tanishqnalloju.com" + (path === "/" ? "/" : path);
  ensure("property", "og:url", url);
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", url);
}


let _eventsCache = null;
let _healthCache = null;

/** Curated event calendar (ASSUMPTION / manual). */
export async function loadEvents() {
  if (_eventsCache) return _eventsCache;
  try {
    const res = await fetch("/data/events.json", { cache: "no-store" });
    if (res.ok) {
      _eventsCache = { data: await res.json(), via: "baked" };
      return _eventsCache;
    }
  } catch {
    /* none */
  }
  return { data: null, via: "none" };
}

/** /api/health for last KV cron stamp; falls back to snapshot timezoneNote. */
export async function loadHealth() {
  if (_healthCache) return _healthCache;
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok !== false) {
        _healthCache = { data, via: "api" };
        return _healthCache;
      }
    }
  } catch {
    /* fall through */
  }
  return { data: null, via: "none" };
}

/** Extract ISO-ish stamp from hard-asset source strings. */
export function extractStamp(text) {
  if (!text) return null;
  const iso = String(text).match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/);
  if (iso) return iso[0].replace(/\.\d+Z$/, "Z");
  const day = String(text).match(/\d{4}-\d{2}-\d{2}/);
  return day ? day[0] : null;
}

/** Short display for as-of cells. */
export function shortStamp(s) {
  if (!s) return "—";
  const t = String(s);
  if (t.length >= 10 && t[4] === "-") return t.slice(0, 10) + (t.includes("T") ? " · " + t.slice(11, 16) + "Z" : "");
  return t.slice(0, 24);
}


/** Read a CSS custom property from :root (theme-aware). */
export function cssVar(name, fallback = "") {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Canvas / chart tokens — always read at draw time so light/dark switch. */
export function themeTokens() {
  return {
    bg: cssVar("--bg", "#111416"),
    paper: cssVar("--paper", "#15191e"),
    text: cssVar("--text", "#e7ebef"),
    muted: cssVar("--muted", "#9aa4ae"),
    border: cssVar("--border", "#303840"),
    accent: cssVar("--accent", "#d4a017"),
    cyan: cssVar("--cyan", "#5b9fb8"),
    ok: cssVar("--ok", "#3db87a"),
    danger: cssVar("--danger", "#e85d5d"),
    warn: cssVar("--warn", "#d4a017"),
    okRgb: cssVar("--ok-rgb", "61, 184, 122"),
    dangerRgb: cssVar("--danger-rgb", "232, 93, 93"),
    warnRgb: cssVar("--warn-rgb", "212, 160, 23"),
    cyanRgb: cssVar("--cyan-rgb", "91, 159, 184"),
    mutedRgb: cssVar("--muted-rgb", "154, 164, 174"),
  };
}

/** rgba() from a --*-rgb token + alpha. */
export function rgbAlpha(rgbCsv, alpha) {
  return `rgba(${rgbCsv}, ${alpha})`;
}

const THEME_KEY = "fxTheme";
const THEME_OPTS = new Set(["system", "light", "dark"]);
const _themeListeners = new Set();

function normalizeTheme(pref) {
  return THEME_OPTS.has(pref) ? pref : "system";
}

/** Stored preference: system | light | dark (default system). */
export function getThemePreference() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY) || "system");
  } catch {
    return "system";
  }
}

/** Resolved light/dark after applying system preference. */
export function resolvedTheme() {
  const pref = getThemePreference();
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

function applyThemeAttr(pref) {
  const t = normalizeTheme(pref);
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t === "system" ? "light dark" : t;
}

function notifyThemeListeners() {
  const resolved = resolvedTheme();
  for (const cb of _themeListeners) {
    try {
      cb(resolved);
    } catch (err) {
      console.error(err);
    }
  }
}

/** Persist + apply theme; notifies onSchemeChange listeners (charts redraw). */
export function setThemePreference(pref) {
  const t = normalizeTheme(pref);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore quota / private mode */
  }
  applyThemeAttr(t);
  syncThemeToggleUi(t);
  notifyThemeListeners();
  return t;
}

/** Sync segmented control aria-pressed state. */
export function syncThemeToggleUi(pref = getThemePreference()) {
  const t = normalizeTheme(pref);
  document.querySelectorAll("[data-theme-opt]").forEach((btn) => {
    const opt = btn.getAttribute("data-theme-opt");
    btn.setAttribute("aria-pressed", opt === t ? "true" : "false");
  });
}

/** Wire System | Light | Dark buttons once. */
export function bindThemeToggle() {
  applyThemeAttr(getThemePreference());
  syncThemeToggleUi();
  document.querySelectorAll("[data-theme-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const opt = btn.getAttribute("data-theme-opt");
      setThemePreference(opt);
    });
  });
}

/**
 * Fire callback when effective theme changes (OS prefers-color-scheme OR user toggle).
 * Returns an unsubscribe function.
 */
export function onSchemeChange(cb) {
  if (typeof cb !== "function") return () => {};
  _themeListeners.add(cb);
  let unmq = () => {};
  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (getThemePreference() !== "system") return;
      notifyThemeListeners();
    };
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else if (mq.addListener) mq.addListener(handler);
    unmq = () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else if (mq.removeListener) mq.removeListener(handler);
    };
  }
  return () => {
    _themeListeners.delete(cb);
    unmq();
  };
}
