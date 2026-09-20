/**
 * FX Analysis — path-routed SPA.
 * Views: / · /desk · /compare[/CODE] · /slip · /how · /notes/YYYY-MM-DD
 *
 * Critical path: util + home + desk + how + takeaway + research only.
 * compare / slip (and charts / LWC) load on demand so a SyntaxError in those
 * modules cannot leave the board stuck on "Loading board snapshot…".
 */
import {
  $,
  setText,
  loadSnapshot,
  loadHealth,
  parseRoute,
  setPath,
  applyViewMeta,
  extractStamp,
  shortStamp,
  onSchemeChange,
  bindThemeToggle,
  loadHistory,
} from "./util.js";
import { renderDesk } from "./desk.js";
import { renderHome } from "./home.js";
import { renderHow } from "./how.js";
import {
  buildDailyTakeaway,
  buildSlipSummaryFlags,
  buildFreshnessLine,
} from "./takeaway.js";
import { buildRegime } from "./research.js";

const VIEWS = ["home", "desk", "compare", "slip", "how", "notes"];

let snap = null;
let via = null;
let activeView = "home";
let compareCode = "USD";

/** Lazy module handles — never on the / /desk critical path. */
let compareMod = null;
let slipMod = null;

async function getCompareMod() {
  if (!compareMod) compareMod = await import("./compare.js");
  return compareMod;
}

async function getSlipMod() {
  if (!slipMod) slipMod = await import("./slip.js");
  return slipMod;
}

function findHard(id) {
  return (snap?.hardAssets || []).find((h) => String(h.id || "").toUpperCase() === id) || null;
}

function setLoadStatus(text, { hide = false } = {}) {
  const status = $("loadStatus");
  if (!status) return;
  if (hide) {
    status.hidden = true;
    status.textContent = "";
    return;
  }
  status.hidden = false;
  status.textContent = text;
}

function revealShellOnError(msg) {
  setLoadStatus(msg);
  // Unhide a usable shell so the user is not stuck on chrome-only Loading.
  const home = $("panel-home");
  const desk = $("panel-desk");
  if (home) home.hidden = false;
  if (desk) desk.hidden = true;
  const hint = $("homeVerdict1");
  if (hint && (!hint.textContent || hint.textContent === "—")) {
    hint.textContent = msg;
  }
}

function updateBoardAsOf(_health) {
  const fxDate = (snap.asOf || "").slice(0, 10) || "—";
  setText("asOfFx", fxDate);
  setText("asOfBadge", `FX ${fxDate}`);

  const gold = findHard("XAU");
  const brent = findHard("BRENT");
  const hardStamp = extractStamp(gold?.source) || extractStamp(brent?.source) || fxDate;
  setText("asOfHard", hardStamp ? shortStamp(hardStamp) : "session");

  const btc = findHard("BTC");
  const btcStamp = extractStamp(btc?.source);
  setText("asOfBtc", btcStamp ? shortStamp(btcStamp) : "—");

  const y = snap?.yields;
  setText(
    "asOfYields",
    y?.asOf && y.us10y != null ? `${y.asOf}` : "—"
  );

  const liveBadge = $("liveBadge");
  if (liveBadge) {
    liveBadge.textContent = "snapshot";
    liveBadge.classList.remove("live");
  }

  const board = $("boardFreshness");
  if (board) board.textContent = buildFreshnessLine(snap);

  // Short as-of line; health is optional and must never block this.
  setLoadStatus(`as-of ${snap.asOf || "—"} · via ${via}`);
}

function setActiveNav(view) {
  document.querySelectorAll("[data-view]").forEach((btn) => {
    const v = btn.getAttribute("data-view");
    const on = v === view || (view === "notes" && v === "desk");
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-current", on ? "page" : "false");
  });
  for (const v of ["home", "desk", "compare", "slip", "how", "notes"]) {
    const panel = $(`panel-${v}`);
    if (panel) panel.hidden = v !== view;
  }
  activeView = view;
}

async function renderNotes(dateStr) {
  const hist = await loadHistory();
  const regime = buildRegime(snap, hist.data);
  const slip = buildSlipSummaryFlags(snap, hist.data);
  const take = buildDailyTakeaway(snap, hist.data, regime, slip);
  const pre = $("notesBody");
  if (pre) pre.textContent = take.text;
  setText("notesTitle", `INR takeaway · ${take.asOfDate}`);
  const warn = $("notesWarn");
  if (warn) {
    const want = (dateStr || "").slice(0, 10);
    if (want && want !== take.asOfDate) {
      warn.hidden = false;
      warn.textContent = `Requested ${want}; board as-of is ${take.asOfDate}. Notes are generated only from the current snapshot — no backfill invented.`;
    } else {
      warn.hidden = true;
      warn.textContent = "";
    }
  }
}

async function showView(view, code, { push = false } = {}) {
  if (!snap) return;
  if (!VIEWS.includes(view)) view = "home";
  if (view === "compare") {
    compareCode = (code || "USD").toUpperCase();
    code = compareCode;
  }
  setActiveNav(view);
  applyViewMeta(view, view === "compare" ? compareCode : view === "notes" ? code : null);
  setPath(view, view === "compare" ? compareCode : view === "notes" ? code : null, {
    replace: !push,
  });

  try {
    if (view === "home") await renderHome(snap);
    else if (view === "desk") await renderDesk(snap);
    else if (view === "compare") {
      const mod = await getCompareMod();
      await mod.renderCompare(snap, compareCode, (picked) => {
        showView("compare", picked, { push: true });
      });
    } else if (view === "slip") {
      const mod = await getSlipMod();
      await mod.renderSlip(snap);
    } else if (view === "how") await renderHow(snap);
    else if (view === "notes") await renderNotes(code);
  } catch (err) {
    console.error("showView failed", view, err);
    setLoadStatus(`View error (${view}): ${err?.message || err}`);
    // Keep the panel visible even if render partially failed.
    const panel = $(`panel-${view}`);
    if (panel) panel.hidden = false;
  }
}

function bindNav() {
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const view = btn.getAttribute("data-view");
      if (view === "compare") showView("compare", compareCode || "USD", { push: true });
      else showView(view, null, { push: true });
    });
  });

  window.addEventListener("popstate", () => {
    const { view, code } = parseRoute();
    showView(view, code, { push: false });
  });

  // One-shot hash → path migration
  if (location.hash) {
    const { view, code } = parseRoute();
    history.replaceState(
      null,
      "",
      view === "compare"
        ? `/compare/${code || "USD"}`
        : view === "home"
          ? "/"
          : `/${view}`
    );
  }
}

async function main() {
  try {
    bindThemeToggle();
    bindNav();
  } catch (err) {
    console.error("bind failed", err);
    revealShellOnError(`Init failed: ${err?.message || err}`);
    // Continue — snapshot may still hydrate panels.
  }

  setLoadStatus("Loading board snapshot…");

  // Health must never block hydration (fire-and-forget with short timeout).
  let healthData = null;
  const healthPromise = Promise.race([
    loadHealth().catch(() => ({ data: null, via: "none" })),
    new Promise((resolve) => setTimeout(() => resolve({ data: null, via: "timeout" }), 2000)),
  ]).then((h) => {
    healthData = h?.data ?? null;
    return h;
  });

  try {
    const loaded = await loadSnapshot();
    snap = loaded.data;
    via = loaded.via;
    // Prefer health if it already resolved; do not await a stall.
    await Promise.race([healthPromise, new Promise((r) => setTimeout(r, 50))]);
    updateBoardAsOf(healthData);
    const { view, code } = parseRoute();
    await showView(view, code);
    onSchemeChange(() => {
      if (!snap) return;
      const r = parseRoute();
      showView(
        activeView,
        activeView === "compare" ? compareCode : activeView === "notes" ? r.code : null
      );
    });
  } catch (err) {
    console.error(err);
    revealShellOnError(`Failed to load snapshot: ${err?.message || err}`);
  }
}

main().catch((err) => {
  console.error("main crashed", err);
  revealShellOnError(`App failed: ${err?.message || err}`);
});
