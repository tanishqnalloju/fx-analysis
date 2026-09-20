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

export function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text ?? "—";
}

export async function loadSnapshot() {
  try {
    const res = await fetch("/api/snapshot", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) return { data, via: "api" };
    }
  } catch {
    /* fall through */
  }
  const res = await fetch("/data/snapshot.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`snapshot fetch failed (${res.status})`);
  return { data: await res.json(), via: "baked" };
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

/** Parse location.hash → { tab, code } */
export function parseHash() {
  const raw = (location.hash || "#desk").replace(/^#/, "").trim();
  const parts = raw.split("/").filter(Boolean);
  const tab = (parts[0] || "desk").toLowerCase();
  if (tab === "compare") {
    const code = parts[1] ? parts[1].toUpperCase() : null;
    return { tab: "compare", code };
  }
  if (tab === "slip" || tab === "rank" || tab === "slip-rank") {
    return { tab: "slip", code: null };
  }
  return { tab: "desk", code: null };
}

export function setHash(tab, code) {
  let h = `#${tab}`;
  if (tab === "compare" && code) h = `#compare/${String(code).toUpperCase()}`;
  if (location.hash !== h) {
    history.replaceState(null, "", h);
  } else if (!location.hash) {
    history.replaceState(null, "", h);
  }
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
