/**
 * FX Analysis — single-page tabbed desk entry.
 * Tabs: Desk | Compare | Slip/Rank. Hash deep-links: #desk #compare #compare/USD #slip
 */
import {
  $,
  setText,
  loadSnapshot,
  loadHealth,
  parseHash,
  setHash,
  extractStamp,
  shortStamp,
  onSchemeChange,
  bindThemeToggle,
} from "./util.js";
import { renderDesk } from "./desk.js";
import { renderCompare } from "./compare.js";
import { renderSlip } from "./slip.js";

const TABS = ["desk", "compare", "slip"];

let snap = null;
let via = null;
let activeTab = "desk";
let compareCode = null;

function findHard(id) {
  return (snap?.hardAssets || []).find((h) => String(h.id || "").toUpperCase() === id) || null;
}

function updateAsOfStrip(health) {
  const fxDate = (snap.asOf || "").slice(0, 10) || "—";
  setText("asOfFx", snap.live && snap.liveAsOf ? `${fxDate} · live` : fxDate);
  setText("asOfBadge", `FX ${fxDate}`);

  const gold = findHard("XAU");
  const brent = findHard("BRENT");
  const hardStamp =
    extractStamp(gold?.source) ||
    extractStamp(brent?.source) ||
    fxDate;
  setText(
    "asOfHard",
    hardStamp
      ? `${shortStamp(hardStamp)} · session`
      : "session print"
  );

  const btc = findHard("BTC");
  const btcStamp = extractStamp(btc?.source);
  setText("asOfBtc", btcStamp ? shortStamp(btcStamp) : "—");

  const cron =
    health?.lastRefresh ||
    extractStamp(snap.timezoneNote) ||
    (snap.timezoneNote || "").match(/refresh\s+(\S+)/i)?.[1] ||
    null;
  setText("asOfCron", cron ? shortStamp(cron) : "—");
}

function updateChrome(health) {
  if (!snap) return;
  const asOf = snap.asOf || "—";
  const liveBadge = $("liveBadge");
  if (liveBadge) {
    if (snap.live) {
      liveBadge.textContent = "live FX overlay";
      liveBadge.classList.add("live");
      liveBadge.classList.remove("warn");
    } else {
      liveBadge.textContent = "baked";
      liveBadge.classList.remove("live");
    }
  }
  updateAsOfStrip(health);
  setText(
    "loadStatus",
    `Loaded via ${via}${snap.live ? " · live overlay active" : " · baked snapshot"} · ${asOf}`
  );
}

function setActiveTabUi(tab) {
  for (const t of TABS) {
    const btn = document.querySelector(`[data-tab="${t}"]`);
    const panel = $(`panel-${t}`);
    if (btn) {
      btn.classList.toggle("active", t === tab);
      btn.setAttribute("aria-selected", t === tab ? "true" : "false");
    }
    if (panel) panel.hidden = t !== tab;
  }
  activeTab = tab;
  document.title =
    tab === "compare"
      ? `Compare${compareCode ? " " + compareCode : ""} · FX Analysis`
      : tab === "slip"
        ? "Slip / Rank · FX Analysis"
        : "FX Analysis · INR real-strength";
}

async function showTab(tab, code) {
  if (!snap) return;
  if (!TABS.includes(tab)) tab = "desk";
  compareCode = tab === "compare" ? code || null : compareCode;
  setActiveTabUi(tab);
  setHash(tab, tab === "compare" ? compareCode : null);

  if (tab === "desk") {
    await renderDesk(snap);
  } else if (tab === "compare") {
    await renderCompare(snap, compareCode, (picked) => {
      compareCode = picked;
      showTab("compare", picked);
    });
  } else if (tab === "slip") {
    await renderSlip(snap);
  }
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      if (tab === "compare") {
        showTab("compare", compareCode);
      } else {
        showTab(tab, null);
      }
    });
  });

  window.addEventListener("hashchange", () => {
    const { tab, code } = parseHash();
    showTab(tab, code);
  });
}

async function main() {
  const status = $("loadStatus");
  bindThemeToggle();
  bindTabs();
  try {
    const [loaded, healthLoaded] = await Promise.all([loadSnapshot(), loadHealth()]);
    snap = loaded.data;
    via = loaded.via;
    updateChrome(healthLoaded.data);
    const { tab, code } = parseHash();
    await showTab(tab, code);
    onSchemeChange(() => {
      if (!snap) return;
      showTab(activeTab, activeTab === "compare" ? compareCode : null);
    });
  } catch (err) {
    if (status) status.textContent = `Failed to load snapshot: ${err.message || err}`;
    console.error(err);
  }
}

main();
