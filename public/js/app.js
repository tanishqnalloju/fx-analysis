/**
 * FX Analysis — path-routed SPA.
 * Views: / · /desk · /compare[/CODE] · /slip · /how · /notes/YYYY-MM-DD
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
import { renderCompare } from "./compare.js";
import { renderSlip } from "./slip.js";
import { renderHome } from "./home.js";
import { renderHow } from "./how.js";
import { buildDailyTakeaway, buildSlipSummaryFlags, buildRealStrengthBlurb, buildFreshnessLine } from "./takeaway.js";
import { buildRegime } from "./research.js";

const VIEWS = ["home", "desk", "compare", "slip", "how", "notes"];

let snap = null;
let via = null;
let activeView = "home";
let compareCode = "USD";

function findHard(id) {
  return (snap?.hardAssets || []).find((h) => String(h.id || "").toUpperCase() === id) || null;
}

function updateBoardAsOf(health) {
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

  setText(
    "loadStatus",
    `Loaded via ${via} · as-of ${snap.asOf || "—"}`
  );
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

  if (view === "home") await renderHome(snap);
  else if (view === "desk") await renderDesk(snap);
  else if (view === "compare") {
    await renderCompare(snap, compareCode, (picked) => {
      showView("compare", picked, { push: true });
    });
  } else if (view === "slip") await renderSlip(snap);
  else if (view === "how") await renderHow(snap);
  else if (view === "notes") await renderNotes(code);
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
    history.replaceState(null, "", view === "compare" ? `/compare/${code || "USD"}` : view === "home" ? "/" : `/${view}`);
  }
}

async function main() {
  bindThemeToggle();
  bindNav();
  const status = $("loadStatus");
  if (status) {
    status.hidden = false;
    status.textContent = "Loading board snapshot…";
  }
  try {
    const [loaded, healthLoaded] = await Promise.all([loadSnapshot(), loadHealth()]);
    snap = loaded.data;
    via = loaded.via;
    updateBoardAsOf(healthLoaded.data);
    const { view, code } = parseRoute();
    await showView(view, code);
    onSchemeChange(() => {
      if (!snap) return;
      const r = parseRoute();
      showView(activeView, activeView === "compare" ? compareCode : activeView === "notes" ? r.code : null);
    });
  } catch (err) {
    if (status) status.textContent = `Failed to load snapshot: ${err.message || err}`;
    console.error(err);
  }
}

main();
