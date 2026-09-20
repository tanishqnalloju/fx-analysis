/**
 * Daily takeaway + desk narrative helpers — snapshot-only, never invent.
 * Exact public template for INR takeaway notes.
 */

import { DESK_FX_BASKET_IDS, filterDeskFxRows, buildSlipMatrix } from "./compare-lib.js";

export const ASIA_PEER_IDS = ["KRW", "TWD", "IDR", "VND", "THB"];
export const SITE_ORIGIN = "https://fx-analysis.tanishqnalloju.com";

function findFx(fx, pair) {
  return (fx || []).find((r) => String(r.pair || "").toUpperCase() === pair) || null;
}

function findHard(hard, id) {
  const want = String(id).toUpperCase();
  return (hard || []).find((r) => String(r.id || "").toUpperCase() === want) || null;
}

/** Format INR per 1 foreign; JPY shows ₹/100 primary. */
export function formatPairRate(pair, rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return { primary: "—", secondary: null };
  const v = Number(rate);
  const code = String(pair || "").replace(/INR$/i, "").toUpperCase();
  if (code === "JPY") {
    const per100 = v * 100;
    return {
      primary: `₹${per100.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} / 100 JPY`,
      secondary: `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 6 })} per 1 JPY`,
    };
  }
  const digits = Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 10 ? 3 : Math.abs(v) >= 1 ? 4 : 6;
  return {
    primary: `₹${v.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) })}`,
    secondary: null,
  };
}

/** Asia peers present in snapshot with finite rates. */
export function filterAsiaPeerRows(fx) {
  const byPair = new Map();
  for (const row of fx || []) {
    if (!row?.pair) continue;
    byPair.set(String(row.pair).toUpperCase(), row);
  }
  const out = [];
  for (const code of ASIA_PEER_IDS) {
    const row = byPair.get(`${code}INR`);
    if (!row || row.available === false) continue;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    out.push(row);
  }
  return out;
}

/**
 * Real-strength: exactly two forwardable sentences + STRONGER|WEAKER|MIXED.
 */
export function buildRealStrengthBlurb(snap, regime) {
  const usd = findFx(snap.fx, "USDINR");
  const gold = findHard(snap.hardAssets, "XAU");
  const brent = findHard(snap.hardAssets, "BRENT");
  const rate = usd?.rate;
  const chg = usd?.changePct;
  const soft =
    typeof chg === "number" ? chg > 0 : null; /* higher USDINR = weaker INR */
  const breadth = regime?.breadthLabel || null;
  const shock = regime?.shock;

  let label = "MIXED";
  if (soft === true && (breadth === "usd-aligned" || breadth === "mixed")) label = "WEAKER";
  else if (soft === false && (breadth === "diverging" || breadth === "mixed" || breadth === "usd-aligned")) {
    label = soft === false && breadth === "usd-aligned" ? "STRONGER" : soft === false ? "STRONGER" : "MIXED";
  } else if (soft === false) label = "STRONGER";
  else if (soft === true) label = "WEAKER";

  // Refine with FX soft/hard counts from legs if present
  const legs = snap.realStrength?.legs || [];
  const weakerN = legs.filter((l) => String(l.verdict || "").toLowerCase() === "weaker").length;
  const strongerN = legs.filter((l) => String(l.verdict || "").toLowerCase() === "stronger").length;
  if (weakerN > strongerN + 1) label = "WEAKER";
  else if (strongerN > weakerN + 1) label = "STRONGER";
  else if (weakerN && strongerN) label = "MIXED";

  const asOf = (snap.asOf || "").slice(0, 10) || "—";
  const chgTxt =
    typeof chg === "number" ? `${chg > 0 ? "+" : ""}${chg.toFixed(2)}%` : "—";
  const sentence1 = `On ${asOf}, USDINR printed ${
    rate != null ? Number(rate).toLocaleString("en-IN", { maximumFractionDigits: 4 }) : "—"
  } (${chgTxt} session) — ${
    soft === true ? "a softer INR vs the dollar" : soft === false ? "a firmer INR vs the dollar" : "INR vs USD move unavailable"
  }${shock ? ", on a Shock day" : ", on a Calm day"}.`;

  const goldTxt =
    gold?.inrPrice != null
      ? `Gold cost about ₹${Number(gold.inrPrice).toLocaleString("en-IN", { maximumFractionDigits: 0 })}/oz`
      : "Gold INR print unavailable";
  const oilTxt =
    brent?.inrPrice != null
      ? `Brent about ₹${Number(brent.inrPrice).toLocaleString("en-IN", { maximumFractionDigits: 0 })}/bbl`
      : "Brent INR print unavailable";
  const breadthTxt =
    regime?.breadthPct != null
      ? `Desk breadth was ${regime.breadthLabel || "mixed"} versus USDINR`
      : "Desk breadth unavailable";
  const sentence2 = `${goldTxt}; ${oilTxt}. ${breadthTxt} — research commentary only, not an RBI REER.`;

  return { label, sentence1, sentence2, asOf };
}

/** One-line slip flags for Desk (INR / key basket). */
export function buildSlipSummaryFlags(snap, history) {
  const matrix = buildSlipMatrix(snap, history, { keyBasketOnly: true });
  const inr = (matrix.rows || []).find((r) => r.code === "INR");
  const flags = inr?.flags?.length
    ? inr.flags
    : softFlagsFromCells(inr?.cells);
  const lineParts = [];
  if (inr?.cells) {
    const c = inr.cells;
    const bit = (id, label) => {
      if (c[id] == null || !Number.isFinite(c[id])) return null;
      const v = c[id];
      const dir = v <= -0.05 ? "soft" : v >= 0.05 ? "firm" : "flat";
      return `${label} ${dir}`;
    };
    for (const [id, label] of [
      ["usd", "vs USD"],
      ["peers", "peers"],
      ["gold", "gold"],
      ["oil", "oil"],
      ["btc", "btc"],
    ]) {
      const b = bit(id, label);
      if (b) lineParts.push(b);
    }
  }
  return {
    flags: flags || [],
    line: lineParts.length ? lineParts.join(" · ") : "Slip scores unavailable for INR this session",
    cells: inr?.cells || null,
    historyLabel: matrix.historyLabel || "",
    narrative: matrix.narrative || "",
  };
}

function softFlagsFromCells(cells) {
  if (!cells) return [];
  const flags = [];
  if (cells.usd != null && cells.usd <= -0.05 && cells.peers != null && cells.peers <= -0.05) {
    flags.push({ id: "broad-soft", label: "slips vs USD and peers", severity: "broad" });
  } else if (cells.usd != null && cells.usd <= -0.05) {
    flags.push({ id: "usd-soft", label: "soft vs USD", severity: "note" });
  }
  return flags;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtInrPlain(n, digits = 0) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

/**
 * Exact daily takeaway template (plain text lines).
 */
export function buildDailyTakeaway(snap, history, regime, slipSummary) {
  const asOfDate = (snap.asOf || "").slice(0, 10) || "—";
  const usd = findFx(snap.fx, "USDINR");
  const gold = findHard(snap.hardAssets, "XAU");
  const brent = findHard(snap.hardAssets, "BRENT");
  const shockLabel = regime?.shock ? "Shock" : "Calm";

  let sameSign = 0;
  let peerN = 0;
  const usdChg = usd?.changePct;
  for (const code of DESK_FX_BASKET_IDS) {
    if (code === "USD") continue;
    const row = findFx(snap.fx, `${code}INR`);
    const chg = row?.changePct;
    if (typeof chg !== "number" || typeof usdChg !== "number") continue;
    peerN += 1;
    if (chg === 0 || usdChg === 0) continue;
    if (Math.sign(chg) === Math.sign(usdChg)) sameSign += 1;
  }
  const breadthAlign =
    peerN === 0
      ? "—"
      : sameSign / peerN >= 0.6
        ? "usd-aligned"
        : sameSign / peerN <= 0.4
          ? "diverging"
          : "mixed";

  const cells = slipSummary?.cells || {};
  const slipBit = (id) => {
    const v = cells[id];
    if (v == null || !Number.isFinite(v)) return "—";
    if (v <= -0.05) return "soft";
    if (v >= 0.05) return "firm";
    return "flat";
  };

  const freshness = buildFreshnessLine(snap);
  const rateTxt =
    usd?.rate != null
      ? Number(usd.rate).toLocaleString("en-IN", { maximumFractionDigits: 4 })
      : "—";

  const lines = [
    `INR takeaway · ${asOfDate}`,
    `USDINR ${rateTxt} (${fmtPct(usd?.changePct)}) · ${shockLabel}`,
    `Breadth: ${sameSign}/${peerN} desk peers same sign as USDINR (${breadthAlign})`,
    `Slip vs USD: ${slipBit("usd")} · peers ${slipBit("peers")} · gold ${slipBit("gold")} · oil ${slipBit("oil")} · btc ${slipBit("btc")}`,
    `Gold ${fmtInrPlain(gold?.inrPrice, 0)}/oz · Brent ${fmtInrPlain(brent?.inrPrice, 0)}/bbl`,
    freshness,
    `Research commentary only — not RBI REER. ${SITE_ORIGIN}/desk`,
  ];
  return { asOfDate, lines, text: lines.join("\n"), shockLabel, breadthAlign };
}

export function buildFreshnessLine(snap) {
  const fxDate = (snap.asOf || "").slice(0, 10) || "—";
  const parts = [`FX ${fxDate}`];
  const gold = findHard(snap.hardAssets, "XAU");
  const brent = findHard(snap.hardAssets, "BRENT");
  const btc = findHard(snap.hardAssets, "BTC");
  const stamp = (src) => {
    if (!src) return null;
    const m = String(src).match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  };
  const g = stamp(gold?.source);
  const o = stamp(brent?.source);
  const b = stamp(btc?.source);
  const y = snap.yields?.asOf || null;
  const age = (d) => {
    if (!d || d === "—") return "stale";
    if (d === fxDate) return "live";
    // T-1 heuristic
    try {
      const a = Date.parse(fxDate + "T00:00:00Z");
      const b2 = Date.parse(d + "T00:00:00Z");
      if (Number.isFinite(a) && Number.isFinite(b2)) {
        const diff = Math.round((a - b2) / 86400000);
        if (diff === 0) return "live";
        if (diff === 1) return "T−1";
      }
    } catch {
      /* ignore */
    }
    return "stale";
  };
  parts.push(`gold ${g || "session"} (${age(g || fxDate)})`);
  parts.push(`oil ${o || "session"} (${age(o || fxDate)})`);
  parts.push(`BTC ${b || "—"} (${b ? age(b) : "—"})`);
  if (y) parts.push(`UST ${y}`);
  return `Board: ${parts.join(" · ")}`;
}

/** Homepage short verdict (1–2 sentences). */
export function buildHomeVerdict(snap, regime, strength) {
  const usd = findFx(snap.fx, "USDINR");
  const asOf = (snap.asOf || "").slice(0, 10);
  const soft = typeof usd?.changePct === "number" ? usd.changePct > 0 : null;
  const shock = regime?.shock ? "Shock" : "Calm";
  const label = strength?.label || "MIXED";
  const s1 =
    soft == null
      ? `Session snapshot for ${asOf}: USDINR ${usd?.rate ?? "—"} · ${shock}.`
      : soft
        ? `Session snapshot for ${asOf}: USDINR ${Number(usd.rate).toLocaleString("en-IN", { maximumFractionDigits: 4 })} rose ${fmtPct(usd.changePct)} — INR softer vs the dollar (${shock}).`
        : `Session snapshot for ${asOf}: USDINR ${Number(usd.rate).toLocaleString("en-IN", { maximumFractionDigits: 4 })} eased ${fmtPct(usd.changePct)} — INR firmer vs the dollar (${shock}).`;
  const s2 = `Desk read: ${label}. Quotes are INR per 1 foreign unit; a higher USDINR means a weaker rupee.`;
  return { sentence1: s1, sentence2: s2, label, asOf, shock };
}

/** Desk FX rows = RBI basket + optional Asia peers when present. */
export function deskFxWithAsia(fx) {
  const core = filterDeskFxRows(fx);
  const asia = filterAsiaPeerRows(fx);
  const seen = new Set(core.map((r) => r.pair));
  const extra = asia.filter((r) => !seen.has(r.pair));
  return { core, asia: extra, all: [...core, ...extra] };
}
