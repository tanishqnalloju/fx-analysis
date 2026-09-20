/**
 * Pure compare math from a snapshot. Used by browser (compare.js).
 * Worker duplicates a thin inline version (no public/ import bundling).
 *
 * Snapshot fx: INR per 1 foreign (e.g. USDINR = 95.75).
 * Hard assets: usdPrice + inrPrice.
 */

/** Key basket for Compare legs / Slip default — peers + home + hard assets. */
export const KEY_BASKET_IDS = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CNY",
  "INR",
  "XAU",
  "BTC",
  "BRENT",
  "WTI",
];

/**
 * Desk FX basket (INR per 1 foreign) — RBI ETCD INR pairs + top India-relevant majors.
 * Max 10. Desk UI must NOT dump the full Frankfurter/FloatRates universe.
 * RBI ETCD permitted INR pairs: USD-INR, EUR-INR, GBP-INR, JPY-INR
 * (Source: RBI FEMA directions on exchange-traded currency derivatives).
 * Also: EUR-USD, GBP-USD, USD-JPY exist on ETCD but are not INR desk legs.
 */
export const DESK_FX_BASKET_IDS = [
  // RBI ETCD INR set
  "USD",
  "EUR",
  "GBP",
  "JPY",
  // Top India-relevant add-ons (majors / trade partners)
  "CNY",
  "AED",
  "SGD",
  "CHF",
  "AUD",
  "CAD",
];

/** Pair ids for Desk table order: USDINR, EURINR, … */
export const DESK_FX_PAIR_IDS = DESK_FX_BASKET_IDS.map((c) => `${c}INR`);

/** Asia peers for Slip default basket (when present in snapshot). */
export const ASIA_PEER_IDS = ["KRW", "TWD", "IDR", "VND", "THB"];

/**
 * Default Slip FX universe when “Show all” is unchecked:
 * Desk FX basket + INR + Asia peers (intersection with snapshot only).
 */
export const SLIP_DEFAULT_FX_IDS = [
  ...DESK_FX_BASKET_IDS,
  "INR",
  ...ASIA_PEER_IDS,
];

const DESK_FX_PAIR_SET = new Set(DESK_FX_PAIR_IDS);

/**
 * Filter + order snapshot fx[] to Desk basket.
 * Skips missing/null/non-finite rate and available === false.
 * @param {object[]} fx
 * @returns {object[]}
 */
export function filterDeskFxRows(fx) {
  const byPair = new Map();
  for (const row of fx || []) {
    if (!row?.pair) continue;
    byPair.set(String(row.pair).toUpperCase(), row);
  }
  const out = [];
  for (const pair of DESK_FX_PAIR_IDS) {
    const row = byPair.get(pair);
    if (!row) continue;
    if (row.available === false) continue;
    const rate = Number(row.rate);
    if (!Number.isFinite(rate)) continue;
    out.push(row);
  }
  return out;
}

/** @param {string} pairOrCode */
export function isDeskFxPair(pairOrCode) {
  const s = String(pairOrCode || "").toUpperCase();
  if (DESK_FX_PAIR_SET.has(s)) return true;
  if (DESK_FX_BASKET_IDS.includes(s)) return true;
  return false;
}

const KEY_BASKET_SET = new Set(KEY_BASKET_IDS);

const KEY_FX_LABELS = {
  INR: "Indian rupee",
  USD: "US dollar",
  EUR: "Euro",
  GBP: "Pound sterling",
  JPY: "Japanese yen",
  CNY: "Chinese yuan",
};

const KEY_HARD_META = {
  XAU: { label: "Gold", unit: "oz" },
  BTC: { label: "Bitcoin", unit: "BTC" },
  BRENT: { label: "Brent crude", unit: "bbl" },
  WTI: { label: "WTI crude", unit: "bbl" },
};

/** @param {string} code */
export function isKeyBasket(code) {
  return KEY_BASKET_SET.has(String(code || "").toUpperCase());
}

/** @param {object} snap */
export function buildInrPerMap(snap) {
  const inrPer = { INR: 1 };
  for (const row of snap.fx || []) {
    if (!row?.pair || typeof row.rate !== "number" || !(row.rate > 0)) continue;
    const pair = String(row.pair).toUpperCase();
    if (pair.endsWith("INR") && pair.length > 3) {
      const code = pair.slice(0, -3);
      inrPer[code] = row.rate;
    }
  }
  return inrPer;
}

/** @param {object} snap */
export function listSelectableCodes(snap) {
  const inrPer = buildInrPerMap(snap);
  const codes = new Set(Object.keys(inrPer));
  // Hard assets as selectable with unit notes
  for (const h of snap.hardAssets || []) {
    if (h?.id) codes.add(String(h.id).toUpperCase());
  }
  return [...codes].sort((a, b) => {
    const maj = ["INR", "USD", "EUR", "GBP", "JPY", "CNY", "XAU", "BTC", "BRENT", "WTI"];
    const ia = maj.indexOf(a);
    const ib = maj.indexOf(b);
    if (ia >= 0 || ib >= 0) {
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });
}

function findHard(snap, id) {
  const want = String(id).toUpperCase();
  return (snap.hardAssets || []).find((h) => String(h.id || "").toUpperCase() === want) || null;
}

function fxChangePct(snap, code) {
  if (code === "INR") return 0;
  const pair = `${code}INR`;
  const row = (snap.fx || []).find((r) => String(r.pair).toUpperCase() === pair);
  if (row && typeof row.changePct === "number" && Number.isFinite(row.changePct)) {
    return row.changePct;
  }
  return null;
}

function hardChangePct(h) {
  if (h && typeof h.changePct === "number" && Number.isFinite(h.changePct)) return h.changePct;
  return null;
}

/**
 * Resolve INR-per-1-unit for selected code (FX or hard asset).
 * @returns {{ inrPerUnit: number, unitLabel: string, kind: string } | null}
 */
export function resolveSelected(snap, codeRaw) {
  const code = String(codeRaw || "").toUpperCase();
  if (!code) return null;
  const inrPer = buildInrPerMap(snap);

  if (inrPer[code] != null) {
    return {
      code,
      inrPerUnit: inrPer[code],
      unitLabel: code === "INR" ? "INR" : `1 ${code}`,
      kind: "fx",
      changePct: fxChangePct(snap, code),
    };
  }

  const hard = findHard(snap, code);
  if (hard && typeof hard.inrPrice === "number" && hard.inrPrice > 0) {
    const unit =
      code === "XAU"
        ? "oz gold"
        : code === "BRENT" || code === "WTI"
          ? "bbl"
          : code === "BTC"
            ? "BTC"
            : hard.unit || hard.name || code;
    return {
      code,
      inrPerUnit: hard.inrPrice,
      unitLabel: unit,
      kind: "hard",
      changePct: hardChangePct(hard),
      hard,
    };
  }
  return null;
}

function roundNice(n) {
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs === 0) return 0;
  if (abs >= 1000) return Number(n.toFixed(2));
  if (abs >= 100) return Number(n.toFixed(3));
  if (abs >= 1) return Number(n.toFixed(6));
  if (abs >= 1e-4) return Number(n.toFixed(8));
  return Number(n.toPrecision(4));
}

/**
 * Build comparison payload for selected code.
 * @param {object} snap
 * @param {string} codeRaw
 */
export function buildCompare(snap, codeRaw) {
  const selected = resolveSelected(snap, codeRaw);
  if (!selected) return null;

  const inrPer = buildInrPerMap(snap);
  const S = selected.inrPerUnit;
  const sChg = selected.changePct;

  const legs = [];
  const missing = [];

  // INR always first if selected is not INR-as-self-only view still show
  const pushFxLeg = (code, label) => {
    const ip = inrPer[code];
    if (ip == null || !(ip > 0)) return;
    const unitsOfLegPerS = S / ip; // units of code per 1 selected
    const unitsOfSPerLeg = ip / S;
    const lChg = fxChangePct(snap, code);
    let deltaPct = null;
    if (sChg != null && lChg != null) deltaPct = Number((sChg - lChg).toFixed(4));
    legs.push({
      id: code,
      label: label || code,
      kind: "fx",
      unit: code,
      // units of X per 1 selected
      unitsPerSelected: roundNice(unitsOfLegPerS),
      // inverse: units of selected per 1 X
      selectedPerUnit: roundNice(unitsOfSPerLeg),
      quoteNote: `units of ${code} per 1 ${selected.code}`,
      inverseNote: `units of ${selected.code} per 1 ${code}`,
      deltaPct,
      strengthScore: deltaPct, // + = selected strengthened vs this leg (session)
    });
  };

  const pushHardLeg = (id, label, unitShort) => {
    const h = findHard(snap, id);
    if (!h || !(h.inrPrice > 0)) {
      missing.push(`${label || id} not in snapshot`);
      return;
    }
    const unitsOfLegPerS = S / h.inrPrice;
    const unitsOfSPerLeg = h.inrPrice / S;
    const lChg = hardChangePct(h);
    let deltaPct = null;
    if (sChg != null && lChg != null) deltaPct = Number((sChg - lChg).toFixed(4));
    legs.push({
      id: String(id).toUpperCase(),
      label: label || h.name || id,
      kind: "hard",
      unit: unitShort || h.unit || id,
      unitsPerSelected: roundNice(unitsOfLegPerS),
      selectedPerUnit: roundNice(unitsOfSPerLeg),
      quoteNote: `${unitShort || "units"} per 1 ${selected.code}`,
      inverseNote: `${selected.code} per 1 ${unitShort || id}`,
      deltaPct,
      strengthScore: deltaPct,
      usdPrice: h.usdPrice ?? null,
      inrPrice: h.inrPrice,
      changePct: h.changePct ?? null,
    });
  };

  // Key basket only (exclude long-tail floatrates from legs/charts)
  for (const code of KEY_BASKET_IDS) {
    if (code === selected.code) continue;
    if (KEY_HARD_META[code]) {
      const m = KEY_HARD_META[code];
      pushHardLeg(code, m.label, m.unit);
    } else {
      pushFxLeg(code, KEY_FX_LABELS[code] || code);
    }
  }

  // Optional commodities not in snapshot — note only, do not invent
  const presentHard = new Set((snap.hardAssets || []).map((h) => String(h.id || "").toUpperCase()));
  for (const opt of [
    ["COPPER", "copper"],
    ["WHEAT", "wheat"],
    ["NATGAS", "natgas"],
    ["CRYPTO_INDEX", "crypto-index"],
  ]) {
    if (!presentHard.has(opt[0])) {
      missing.push(`${opt[1]} not in snapshot`);
    }
  }

  // KPI strip: vs INR, vs USD, vs gold
  const kpi = {
    vsInr: {
      label: "vs INR",
      value: roundNice(S),
      unit: `INR per 1 ${selected.code}`,
      inverse: selected.code === "INR" ? null : roundNice(1 / S),
      inverseUnit: selected.code === "INR" ? null : `${selected.code} per 1 INR`,
    },
    vsUsd: null,
    vsGold: null,
  };
  if (inrPer.USD > 0) {
    const usdPerS = S / inrPer.USD;
    kpi.vsUsd = {
      label: "vs USD",
      value: roundNice(usdPerS),
      unit: `USD per 1 ${selected.code}`,
      inverse: roundNice(inrPer.USD / S),
      inverseUnit: `${selected.code} per 1 USD`,
      nativeNote: selected.kind === "fx" ? null : `via INR bridge (USDINR ${inrPer.USD})`,
    };
  }
  const gold = findHard(snap, "XAU");
  if (gold?.inrPrice > 0) {
    const ozPerS = S / gold.inrPrice;
    kpi.vsGold = {
      label: "vs gold",
      value: roundNice(ozPerS),
      unit: `oz gold per 1 ${selected.code}`,
      inverse: roundNice(gold.inrPrice / S),
      inverseUnit: `${selected.code} per 1 oz`,
      inrPerOz: gold.inrPrice,
      usdPerOz: gold.usdPrice ?? null,
    };
  }

  // Relative-strength ranking: session Δ% of cross (selected vs leg)
  // +score = selected strengthened vs that leg this session
  const ranking = legs
    .filter((l) => l.strengthScore != null && Number.isFinite(l.strengthScore))
    .map((l) => ({
      id: l.id,
      label: l.label,
      score: l.strengthScore,
      kind: l.kind,
    }))
    .sort((a, b) => b.score - a.score);

  // Normalize for bars: score / maxAbs → -1..1 (caller may also re-normalize)
  const maxAbs = Math.max(...ranking.map((r) => Math.abs(r.score)), 1e-9);
  for (const r of ranking) {
    r.normalized = Number((r.score / maxAbs).toFixed(4));
  }

  const narrative = buildNarrative(selected, kpi, ranking, legs);

  return {
    code: selected.code,
    kind: selected.kind,
    unitLabel: selected.unitLabel,
    asOf: snap.asOf || null,
    live: !!snap.live,
    liveAsOf: snap.liveAsOf || null,
    selected: {
      code: selected.code,
      inrPerUnit: roundNice(selected.inrPerUnit),
      unitLabel: selected.unitLabel,
      changePct: selected.changePct,
    },
    kpi,
    legs,
    ranking,
    narrative,
    missingNotes: missing,
    selectable: listSelectableCodes(snap),
    method:
      "Cross rates via INR bridge: units of X per 1 S = inrPer[S] / inrPer[X] (FX) or inrPer[S] / hard.inrPrice. Ranking scores ≈ Δ%S − Δ%leg (session relative strength; + = selected strengthened vs leg).",
  };
}

function buildNarrative(selected, kpi, ranking, legs) {
  const code = selected.code;
  const parts = [];

  // Weakness vs USD?
  const vsUsd = ranking.find((r) => r.id === "USD");
  const vsGold = ranking.find((r) => r.id === "XAU");
  const vsBrent = ranking.find((r) => r.id === "BRENT");
  const vsWti = ranking.find((r) => r.id === "WTI");
  const peerIds = new Set(["EUR", "GBP", "JPY", "CNY", "INR"]);
  const peers = ranking.filter((r) => peerIds.has(r.id) && r.id !== code);

  const weakThresh = -0.05; // session score %
  const strongThresh = 0.05;

  const describe = (r) => {
    if (!r) return null;
    if (r.score <= weakThresh) return "weaker";
    if (r.score >= strongThresh) return "stronger";
    return "flat";
  };

  if (code === "USD") {
    parts.push("Selected is USD — USD-relative weakness is N/A; ranking is vs peers, gold, oil, BTC.");
  } else if (vsUsd) {
    const d = describe(vsUsd);
    parts.push(
      `Vs USD (session): ${code} looks ${d} (cross Δ% ≈ ${vsUsd.score.toFixed(2)}%).`
    );
  } else if (kpi.vsUsd) {
    parts.push(
      `Vs USD (level): 1 ${code} ≈ ${kpi.vsUsd.value} USD (no session Δ% for ranking).`
    );
  }

  const oilGold = [vsGold, vsBrent, vsWti].filter(Boolean);
  if (vsUsd && oilGold.length) {
    const usdWeak = (vsUsd.score ?? 0) <= weakThresh;
    const alsoWeak = oilGold.filter((r) => (r.score ?? 0) <= weakThresh);
    const alsoStrong = oilGold.filter((r) => (r.score ?? 0) >= strongThresh);
    if (usdWeak) {
      if (alsoWeak.length >= 1) {
        parts.push(
          `Weakness vs USD also shows vs ${alsoWeak.map((r) => r.label).join(", ")} — not purely USD-specific.`
        );
      } else if (alsoStrong.length >= 1) {
        parts.push(
          `Weak vs USD but stronger/flat vs ${alsoStrong.map((r) => r.label).join(", ")} — move looks more USD-specific (or commodity-led).`
        );
      } else {
        parts.push(
          `Weak vs USD; gold/oil ranking scores are near flat or unavailable — treat as mostly FX/USD-side.`
        );
      }
    } else {
      const weakHard = oilGold.filter((r) => (r.score ?? 0) <= weakThresh);
      if (weakHard.length) {
        parts.push(
          `Not broadly weak vs USD, but softer vs ${weakHard.map((r) => r.label).join(", ")} (commodity print).`
        );
      }
    }
  }

  if (peers.length) {
    const weakPeers = peers.filter((r) => r.score <= weakThresh).map((r) => r.id);
    const strongPeers = peers.filter((r) => r.score >= strongThresh).map((r) => r.id);
    if (weakPeers.length || strongPeers.length) {
      const bits = [];
      if (strongPeers.length) bits.push(`stronger vs ${strongPeers.join("/")}`);
      if (weakPeers.length) bits.push(`weaker vs ${weakPeers.join("/")}`);
      parts.push(`FX peers: ${bits.join("; ")}.`);
    } else {
      parts.push("FX peers: session cross moves are modest / mixed.");
    }
  }

  const scored = ranking.length;
  const unscored = legs.length - scored;
  if (unscored > 0) {
    parts.push(
      `${unscored} basket leg(s) lack session Δ% on both sides — omitted from ranking bars (levels still in table).`
    );
  }

  if (!parts.length) {
    parts.push(
      `Level cross rates for ${code} via INR bridge. Ranking needs session Δ% on selected and legs.`
    );
  }

  return parts.join(" ");
}

export function majorPickerCodes(snap) {
  // Full universe — Prefer majors first, then all remaining FX + hard assets
  const all = listSelectableCodes(snap);
  const prefer = ["USD", "EUR", "GBP", "JPY", "CNY", "INR", "XAU", "BTC", "BRENT", "WTI"];
  const out = [];
  for (const c of prefer) {
    if (all.includes(c)) out.push(c);
  }
  for (const c of all) {
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * Codes present in snapshot FX (excl synthetic INR which is always selectable).
 */
export function listFxCodes(snap) {
  const inrPer = buildInrPerMap(snap);
  return Object.keys(inrPer)
    .filter((c) => c !== "INR")
    .sort((a, b) => {
      const maj = ["USD", "EUR", "GBP", "JPY", "CNY"];
      const ia = maj.indexOf(a);
      const ib = maj.indexOf(b);
      if (ia >= 0 || ib >= 0) {
        if (ia < 0) return 1;
        if (ib < 0) return -1;
        return ia - ib;
      }
      return a.localeCompare(b);
    });
}

/**
 * Unavailable / not-on-ECB examples for picker labeling.
 */
export function listUnavailableHints(snap) {
  const present = new Set(listSelectableCodes(snap));
  const examples = snap?.meta?.unavailableExamples || [];
  const out = [];
  for (const u of examples) {
    if (u?.code && !present.has(u.code)) out.push(u);
  }
  // Always surface AED if missing (common Gulf quote)
  if (!present.has("AED") && !out.some((u) => u.code === "AED")) {
    out.unshift({ code: "AED", reason: "not on ECB/Frankfurter" });
  }
  return out;
}

/* ---------- Slip / Rank matrix (session and/or multi-day history) ---------- */

/**
 * Session changePct for a currency code (INR per 1 foreign). INR → 0.
 * Hard assets use hard.changePct when present.
 */
function sessionChg(snap, code) {
  const c = String(code || "").toUpperCase();
  if (c === "INR") return 0;
  const fx = fxChangePct(snap, c);
  if (fx != null) return fx;
  const h = findHard(snap, c);
  return hardChangePct(h);
}

/**
 * Multi-day % move from history series CODEINR (first→last).
 * Returns null if history missing / too short. Never invents.
 */
function historyMovePct(history, code) {
  if (!history?.series) return null;
  const c = String(code || "").toUpperCase();
  if (c === "INR") return 0;
  const key = `${c}INR`;
  const s = history.series[key];
  if (!Array.isArray(s) || s.length < 2) return null;
  const a = s[0]?.v;
  const b = s[s.length - 1]?.v;
  if (!(typeof a === "number" && a > 0 && typeof b === "number" && b > 0)) return null;
  return Number((((b - a) / a) * 100).toFixed(4));
}

/**
 * Prefer multi-day history move when available; else session Δ%.
 */
function effectiveChg(snap, history, code) {
  const h = historyMovePct(history, code);
  if (h != null) return { value: h, basis: "history" };
  const s = sessionChg(snap, code);
  if (s != null) return { value: s, basis: "session" };
  return { value: null, basis: null };
}

/**
 * Relative score: selected vs leg ≈ Δ%selected − Δ%leg.
 */
function relScoreWith(snap, history, selectedCode, legCode) {
  const a = effectiveChg(snap, history, selectedCode);
  const b = effectiveChg(snap, history, legCode);
  if (a.value == null || b.value == null) return null;
  return Number((a.value - b.value).toFixed(4));
}

function peerScoreWith(snap, history, selectedCode, peerCodes) {
  const scores = [];
  for (const p of peerCodes) {
    if (p === selectedCode) continue;
    const s = relScoreWith(snap, history, selectedCode, p);
    if (s != null) scores.push(s);
  }
  if (!scores.length) return null;
  const avg = scores.reduce((x, y) => x + y, 0) / scores.length;
  return Number(avg.toFixed(4));
}

function oilScoreWith(snap, history, selectedCode) {
  const b = relScoreWith(snap, history, selectedCode, "BRENT");
  const w = relScoreWith(snap, history, selectedCode, "WTI");
  if (b != null && w != null) return Number(((b + w) / 2).toFixed(4));
  return b != null ? b : w;
}

/**
 * Filter slip/compare currency lists to key basket when requested.
 * @param {string[]} codes
 * @param {boolean} [keyOnly]
 */
export function filterCurrencyUniverse(codes, keyOnly = false) {
  if (!keyOnly) return codes;
  const set = new Set(codes.map((c) => String(c).toUpperCase()));
  // Desk FX + INR + Asia peers (order preserved); only codes present in snapshot
  const out = [];
  const seen = new Set();
  for (const c of SLIP_DEFAULT_FX_IDS) {
    if (!set.has(c) || KEY_HARD_META[c] || seen.has(c)) continue;
    out.push(c);
    seen.add(c);
  }
  return out;
}

/**
 * Build slip/rank matrix answering: if it slips vs USD, does it slip everywhere?
 * @param {object} snap
 * @param {object|null} [history]
 * @param {{ keyBasketOnly?: boolean }} [opts]
 */
export function buildSlipMatrix(snap, history = null, opts = {}) {
  const inrPer = buildInrPerMap(snap);
  // Full FX universe from snapshot (+ INR); optional key-basket filter for readability
  const allFx = ["INR", ...listFxCodes(snap)].filter(
    (c, i, arr) => arr.indexOf(c) === i && (c === "INR" || inrPer[c] != null)
  );
  const fxCodes = opts.keyBasketOnly ? filterCurrencyUniverse(allFx, true) : allFx;
  const peerCodes = ["EUR", "GBP", "JPY", "CNY"].filter((c) => inrPer[c] != null);

  const hasFxHistory =
    !!history?.series &&
    Object.keys(history.series).some((k) => Array.isArray(history.series[k]) && history.series[k].length >= 2);

  const legDefs = [
    { id: "usd", label: "vs USD", kind: "fx" },
    { id: "peers", label: "vs peers", kind: "fx" },
    { id: "gold", label: "vs gold", kind: "hard" },
    { id: "oil", label: "vs oil", kind: "hard" },
    { id: "btc", label: "vs BTC", kind: "hard" },
  ];

  const rows = [];
  let scoredCells = 0;
  let totalCells = 0;
  let historyBasisCount = 0;

  for (const code of fxCodes) {
    const cells = {
      usd: code === "USD" ? null : relScoreWith(snap, history, code, "USD"),
      peers: peerScoreWith(snap, history, code, peerCodes),
      gold: relScoreWith(snap, history, code, "XAU"),
      oil: oilScoreWith(snap, history, code),
      btc: relScoreWith(snap, history, code, "BTC"),
    };
    for (const k of Object.keys(cells)) {
      totalCells += 1;
      if (cells[k] != null) scoredCells += 1;
    }

    const chgInfo = effectiveChg(snap, history, code);
    if (chgInfo.basis === "history") historyBasisCount += 1;

    const usdSoft = cells.usd != null && cells.usd <= -0.05;
    const usdHard = cells.usd != null && cells.usd >= 0.05;
    const goldHard = cells.gold != null && cells.gold >= 0.05;
    const goldSoft = cells.gold != null && cells.gold <= -0.05;
    const oilHard = cells.oil != null && cells.oil >= 0.05;
    const oilSoft = cells.oil != null && cells.oil <= -0.05;
    const peersSoft = cells.peers != null && cells.peers <= -0.05;
    const peersHard = cells.peers != null && cells.peers >= 0.05;

    const flags = [];
    if (usdSoft && (goldHard || oilHard)) {
      flags.push({
        id: "usd-soft-hard-asset",
        label: "USD-soft but gold/oil-hard",
        severity: "diverge",
      });
    }
    if (usdHard && (goldSoft || oilSoft)) {
      flags.push({
        id: "usd-hard-asset-soft",
        label: "USD-hard but soft vs gold/oil",
        severity: "diverge",
      });
    }
    if (usdSoft && peersSoft) {
      flags.push({
        id: "broad-soft",
        label: "slips vs USD and peers",
        severity: "broad",
      });
    }
    if (usdSoft && peersHard) {
      flags.push({
        id: "usd-specific",
        label: "USD-soft but peer-hard — USD-specific?",
        severity: "diverge",
      });
    }
    if (usdSoft && !peersSoft && cells.peers != null && !peersHard) {
      flags.push({
        id: "mostly-usd",
        label: "soft vs USD; peers near flat",
        severity: "note",
      });
    }

    rows.push({
      code,
      sessionChg: sessionChg(snap, code),
      movePct: chgInfo.value,
      moveBasis: chgInfo.basis,
      cells,
      flags,
    });
  }

  const ladders = {};
  for (const leg of legDefs) {
    const entries = rows
      .map((r) => ({
        code: r.code,
        score: r.cells[leg.id],
      }))
      .filter((e) => e.score != null);
    entries.sort((a, b) => b.score - a.score);
    const maxAbs = Math.max(...entries.map((e) => Math.abs(e.score)), 1e-9);
    for (const e of entries) {
      e.normalized = Number((e.score / maxAbs).toFixed(4));
    }
    ladders[leg.id] = entries;
  }

  const historyLimited = !hasFxHistory;
  const coverage = totalCells ? scoredCells / totalCells : 0;
  const dayCount = history?.dayCount || (hasFxHistory ? Object.values(history.series)[0]?.length : 0) || 0;

  let narrative = "";
  if (historyLimited) {
    narrative =
      "ASSUMPTION / limited history: matrix uses only session Δ% fields from the current snapshot (no multi-day series). ";
  } else {
    narrative = `History-aware slip: FX relative moves use Frankfurter/ECB multi-day series (${dayCount || "n"} business days) when present; hard assets without history fall back to session Δ% or blank. `;
  }
  narrative +=
    "Score ≈ Δ%currency − Δ%leg (+ = currency strengthened vs that leg). ";
  if (coverage < 0.5) {
    narrative +=
      "Many cells are blank because hard-asset or FX Δ% is missing — treat ranks as provisional. ";
  }

  const divergeRows = rows.filter((r) =>
    r.flags.some((f) => f.severity === "diverge")
  );
  if (divergeRows.length) {
    narrative += `Divergence highlights: ${divergeRows
      .map((r) => `${r.code} (${r.flags.filter((f) => f.severity === "diverge").map((f) => f.label).join("; ")})`)
      .join(" · ")}. `;
  } else {
    narrative +=
      "No strong USD-vs-hard-asset divergences flagged at the ±0.05% threshold (or scores unavailable). ";
  }

  return {
    asOf: snap.asOf || null,
    live: !!snap.live,
    currencies: fxCodes,
    allCurrencies: allFx,
    keyBasketOnly: !!opts.keyBasketOnly,
    legs: legDefs,
    rows,
    ladders,
    historyLimited,
    historyLabel: historyLimited
      ? "ASSUMPTION · limited history (single session Δ%)"
      : `history · ${dayCount || "multi"} ECB days` +
        (history?.from && history?.to ? ` (${history.from}→${history.to})` : ""),
    coverage,
    scoredCells,
    totalCells,
    historyBasisCount,
    narrative: narrative.trim(),
    method: historyLimited
      ? "Slip scores from snapshot changePct only: FX = INR-per-1 Δ%; hard = asset Δ% when present. peers = avg vs EUR/GBP/JPY/CNY. oil = Brent and/or WTI. No invented history."
      : "Slip scores prefer multi-day Frankfurter/ECB FX moves (first→last in history.json); hard assets use session Δ% only when no hard history (never invented). peers = avg vs EUR/GBP/JPY/CNY.",
  };
}


/* ---------- Event calendar + correlations (client) ---------- */

/**
 * Pearson correlation of two equal-length number arrays. null if < minN.
 */
export function pearsonCorr(xs, ys, minN = 8) {
  const n = Math.min(xs?.length || 0, ys?.length || 0);
  if (n < minN) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    k += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  if (k < minN) return null;
  const cov = sxy - (sx * sy) / k;
  const vx = sxx - (sx * sx) / k;
  const vy = syy - (sy * sy) / k;
  if (!(vx > 0) || !(vy > 0)) return null;
  return Number((cov / Math.sqrt(vx * vy)).toFixed(4));
}

/** Daily % returns from {t,v}[] series (aligned by order). */
function dailyReturns(series) {
  if (!Array.isArray(series) || series.length < 2) return [];
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]?.v;
    const b = series[i]?.v;
    if (!(a > 0) || !(b > 0)) {
      out.push({ t: series[i]?.t, r: null });
    } else {
      out.push({ t: series[i].t, r: ((b - a) / a) * 100 });
    }
  }
  return out;
}

/**
 * Align returns of series A and B by date; return parallel arrays.
 */
function alignedReturns(seriesA, seriesB) {
  const ra = dailyReturns(seriesA);
  const rb = dailyReturns(seriesB);
  const mapB = new Map(rb.filter((p) => p.r != null).map((p) => [p.t, p.r]));
  const xs = [];
  const ys = [];
  const dates = [];
  for (const p of ra) {
    if (p.r == null) continue;
    const y = mapB.get(p.t);
    if (y == null) continue;
    xs.push(p.r);
    ys.push(y);
    dates.push(p.t);
  }
  return { xs, ys, dates };
}

/**
 * Cross (units of USD per 1 code) series via INR bridge: CODEINR / USDINR.
 */
function vsUsdCrossSeries(history, code) {
  const c = String(code || "").toUpperCase();
  if (!history?.series) return [];
  if (c === "USD") return (history.series.USDINR || []).map((p) => ({ t: p.t, v: 1 }));
  const a = history.series[`${c}INR`];
  const usd = history.series.USDINR;
  if (!a?.length || !usd?.length) return [];
  const mapU = new Map(usd.map((p) => [p.t, p.v]));
  const out = [];
  for (const p of a) {
    const u = mapU.get(p.t);
    if (!(p.v > 0) || !(u > 0)) continue;
    out.push({ t: p.t, v: p.v / u });
  }
  return out;
}

function peerBasketVsUsd(history, peerCodes) {
  const peers = peerCodes.filter((c) => c !== "USD");
  if (!peers.length || !history?.series?.USDINR) return [];
  const dates = history.series.USDINR.map((p) => p.t);
  const crosses = peers.map((c) => {
    const s = vsUsdCrossSeries(history, c);
    return new Map(s.map((p) => [p.t, p.v]));
  });
  const out = [];
  for (const t of dates) {
    const vals = [];
    for (const m of crosses) {
      const v = m.get(t);
      if (v > 0) vals.push(v);
    }
    if (vals.length < Math.min(2, peers.length)) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    out.push({ t, v: avg });
  }
  return out;
}

/**
 * Rolling / window correlations for selected FX code vs USD-relative peers, gold, oil.
 * Never invents hard-asset series — returns null + note when absent.
 *
 * @param {object|null} history
 * @param {string} codeRaw
 * @param {{ window?: number }} [opts]
 */
export function buildCorrelations(history, codeRaw, opts = {}) {
  const code = String(codeRaw || "").toUpperCase();
  const window = opts.window || 20;
  const peers = ["EUR", "GBP", "JPY", "CNY"];
  const sel = vsUsdCrossSeries(history, code);
  const missing = [];

  const corrVs = (label, otherSeries, noteIfMissing) => {
    if (!otherSeries?.length) {
      missing.push(noteIfMissing);
      return { id: label, label, corr: null, n: 0, note: noteIfMissing };
    }
    const { xs, ys, dates } = alignedReturns(sel, otherSeries);
    // use last `window` overlapping returns when available
    const slice = Math.min(window, xs.length);
    const xw = xs.slice(-slice);
    const yw = ys.slice(-slice);
    const corr = pearsonCorr(xw, yw, Math.min(8, Math.floor(window / 2)));
    return {
      id: label,
      label,
      corr,
      n: xw.length,
      from: dates.slice(-slice)[0] || null,
      to: dates.slice(-slice).at(-1) || null,
      note: corr == null ? "insufficient overlap" : null,
    };
  };

  const rows = [];
  if (code === "USD") {
    rows.push({
      id: "usd",
      label: "vs USD",
      corr: null,
      n: 0,
      note: "selected is USD — vs-USD corr N/A",
    });
  } else {
    // self vs USD is definitionally the series; show corr of sel vs peer basket instead as primary
    rows.push({
      id: "usd-self",
      label: "vs USD (level series)",
      corr: null,
      n: sel.length,
      note: "selected series is already vs-USD cross; see peers / gold / oil",
    });
  }

  rows.push(
    corrVs("peers", peerBasketVsUsd(history, peers), "peer basket history thin")
  );

  const goldHist = history?.hardAssets?.XAU;
  rows.push(
    corrVs(
      "gold",
      Array.isArray(goldHist) && goldHist.length >= 2 ? goldHist : null,
      "gold history absent — level only / not invented"
    )
  );

  const brent = history?.hardAssets?.BRENT;
  const wti = history?.hardAssets?.WTI;
  let oil = null;
  if (Array.isArray(brent) && brent.length >= 2) oil = brent;
  else if (Array.isArray(wti) && wti.length >= 2) oil = wti;
  rows.push(
    corrVs("oil", oil, "oil history absent — level only / not invented")
  );

  const scored = rows.filter((r) => r.corr != null);
  return {
    code,
    window,
    rows,
    scoredCount: scored.length,
    missingNotes: missing,
    method:
      "Pearson corr of daily % returns on overlapping dates. Selected series = CODEINR/USDINR cross. Peers = avg EUR/GBP/JPY/CNY vs-USD crosses. Gold/oil only when hardAssets history present (never invented).",
  };
}

/**
 * Filter curated events to those falling inside [from,to] (inclusive YYYY-MM-DD).
 * @param {{ events?: object[] }} calendar
 * @param {string|null} from
 * @param {string|null} to
 */
export function eventsInRange(calendar, from, to) {
  const list = calendar?.events || [];
  if (!from || !to) return list.slice();
  return list.filter((e) => e?.date && e.date >= from && e.date <= to);
}
