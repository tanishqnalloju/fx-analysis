/**
 * Cloudflare Worker — FX Analysis desk API
 * Scheduled cron writes snapshot/history/meta into KV (source of truth).
 * GET /api/* reads KV first, falls back to baked ASSETS public/data/*.json.
 * Live Frankfurter overlay still applied on /api/snapshot + /api/compare.
 */

import { fetchTreasuryYields } from "./yields.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Refresh-Key",
};

const FRANK_BASE = "https://api.frankfurter.app";
const FLOAT_URL = "https://www.floatrates.com/daily/usd.json";
const COINBASE_BTC = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const HARD_IDS = ["XAU", "BRENT", "WTI", "BTC"];
const HISTORY_DAYS = 40;
const KV_KEYS = { snapshot: "snapshot", history: "history", meta: "meta" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

function isoDateUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDateUTC(d);
}

async function fetchJson(url, { timeoutMs = 20000, label = url } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "fx-analysis-worker/1.4",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, { timeoutMs = 25000, label = url } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "text/csv,text/plain,*/*",
        "User-Agent": "fx-analysis-worker/1.4",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function roundRate(code, rate) {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (code === "JPY" || rate < 1) return Number(rate.toFixed(6));
  if (rate < 10) return Number(rate.toFixed(5));
  if (rate < 100) return Number(rate.toFixed(4));
  return Number(rate.toFixed(4));
}

function usdMapToInrPer(usdRates, usdInr) {
  const out = { USD: usdInr };
  for (const [code, perUsd] of Object.entries(usdRates || {})) {
    if (code === "INR" || code === "USD") continue;
    if (typeof perUsd !== "number" || !(perUsd > 0)) continue;
    out[code] = usdInr / perUsd;
  }
  return out;
}

function pctChange(prev, next) {
  if (!(typeof prev === "number" && prev > 0 && typeof next === "number" && next > 0)) {
    return null;
  }
  return Number((((next - prev) / prev) * 100).toFixed(4));
}

/* ---------- baked ASSETS helpers ---------- */

async function loadBakedAsset(env, request, path) {
  if (!env.ASSETS) return null;
  try {
    const base = request?.url || "https://fx-analysis.tanishqnalloju.com/";
    const assetUrl = new URL(path, base);
    const res = await env.ASSETS.fetch(new Request(assetUrl));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function loadBakedSnapshot(env, request) {
  return loadBakedAsset(env, request, "/data/snapshot.json");
}

async function loadBakedHistory(env, request) {
  return loadBakedAsset(env, request, "/data/history.json");
}

/* ---------- KV helpers ---------- */

async function kvGetJson(env, key) {
  if (!env.DATA) return null;
  try {
    const raw = await env.DATA.get(key, "json");
    return raw ?? null;
  } catch {
    return null;
  }
}

async function kvPutJson(env, key, value) {
  if (!env.DATA) throw new Error("DATA KV binding missing");
  await env.DATA.put(key, JSON.stringify(value));
}

/**
 * Seed KV from baked ASSETS if empty. Safe to call on every request.
 */
async function ensureKvSeeded(env, request) {
  if (!env.DATA) return { seeded: false, reason: "no DATA binding" };
  const existing = await kvGetJson(env, KV_KEYS.snapshot);
  if (existing?.fx?.length) {
    return { seeded: false, reason: "already present" };
  }
  const snap = await loadBakedSnapshot(env, request);
  const hist = await loadBakedHistory(env, request);
  if (!snap) return { seeded: false, reason: "no baked snapshot" };
  await kvPutJson(env, KV_KEYS.snapshot, snap);
  if (hist) await kvPutJson(env, KV_KEYS.history, hist);
  const meta = {
    lastRefresh: new Date().toISOString(),
    source: "seed-from-assets",
    asOf: snap.asOf || null,
    fxCount: snap.fx?.length ?? 0,
    historySeries: hist ? Object.keys(hist.series || {}).length : 0,
  };
  await kvPutJson(env, KV_KEYS.meta, meta);
  return { seeded: true, meta };
}

async function loadSnapshotBase(env, request) {
  await ensureKvSeeded(env, request);
  const fromKv = await kvGetJson(env, KV_KEYS.snapshot);
  if (fromKv?.fx?.length) return { ...fromKv, dataSource: "kv" };
  const baked = await loadBakedSnapshot(env, request);
  if (baked) return { ...baked, dataSource: "assets" };
  return null;
}

async function loadHistoryBase(env, request) {
  await ensureKvSeeded(env, request);
  const fromKv = await kvGetJson(env, KV_KEYS.history);
  if (fromKv?.series) return { ...fromKv, dataSource: "kv" };
  const baked = await loadBakedHistory(env, request);
  if (baked) return { ...baked, dataSource: "assets" };
  return null;
}

/* ---------- live FX overlay (request path) ---------- */

async function fetchFrankfurterFx() {
  const url = `${FRANK_BASE}/latest?from=USD`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.rates?.INR) return null;
    const usdInr = data.rates.INR;
    const out = {
      asOf: data.date ? `${data.date}T00:00:00Z` : undefined,
      usdInr,
      pairs: [
        {
          pair: "USDINR",
          rate: usdInr,
          source: "Frankfurter / ECB reference",
          note: "INR per 1 USD (live overlay)",
        },
      ],
    };
    for (const [code, perUsd] of Object.entries(data.rates)) {
      if (code === "INR" || code === "USD") continue;
      if (typeof perUsd !== "number" || perUsd === 0) continue;
      const rate = usdInr / perUsd;
      const digits = code === "JPY" || rate < 1 ? 6 : rate < 10 ? 5 : 4;
      out.pairs.push({
        pair: `${code}INR`,
        rate: Number(rate.toFixed(digits)),
        source: "Frankfurter / ECB reference",
        note:
          code === "JPY"
            ? "INR per 1 JPY (derived from USD cross; not per-100)"
            : `INR per 1 ${code} (derived from USD cross)`,
      });
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function mergeLiveFx(baked, live) {
  if (!baked || !live?.pairs?.length) {
    return { ...baked, live: false };
  }
  const byPair = new Map(live.pairs.map((p) => [p.pair, p]));
  const seen = new Set();
  const fx = (baked.fx || []).map((row) => {
    seen.add(row.pair);
    const liveRow = byPair.get(row.pair);
    if (!liveRow) return row;
    return {
      ...row,
      rate: liveRow.rate,
      source: liveRow.source,
      note: liveRow.note || row.note,
      changePct: row.changePct,
      liveOverlay: true,
    };
  });
  for (const p of live.pairs) {
    if (seen.has(p.pair)) continue;
    fx.push({
      ...p,
      changePct: null,
      liveOverlay: true,
      available: true,
      provider: "frankfurter",
    });
  }

  const usdInr =
    byPair.get("USDINR")?.rate ??
    baked.fx.find((r) => r.pair === "USDINR")?.rate;

  const hardAssets = (baked.hardAssets || []).map((h) => {
    if (typeof usdInr !== "number" || typeof h.usdPrice !== "number") return h;
    return {
      ...h,
      inrPrice: Number((h.usdPrice * usdInr).toFixed(2)),
    };
  });

  return {
    ...baked,
    live: true,
    liveSource: "Frankfurter/ECB",
    liveAsOf: live.asOf || null,
    asOf: live.asOf || baked.asOf,
    timezoneNote: `${baked.timezoneNote || ""} · live FX overlay Frankfurter/ECB (all rates)`.trim(),
    fx,
    hardAssets,
    assumptions: [
      ...(baked.assumptions || []),
      "Live FX overlay from Frankfurter/ECB applied to all available USD rates → INR pairs; hard-asset USD prints remain from KV/baked snapshot until cron refresh",
    ],
  };
}

/* ---------- compare compute ---------- */

function buildInrPerMap(snap) {
  const inrPer = { INR: 1 };
  for (const row of snap.fx || []) {
    if (!row?.pair || typeof row.rate !== "number" || !(row.rate > 0)) continue;
    const pair = String(row.pair).toUpperCase();
    if (pair.endsWith("INR") && pair.length > 3) {
      inrPer[pair.slice(0, -3)] = row.rate;
    }
  }
  return inrPer;
}

function listSelectableCodes(snap) {
  const inrPer = buildInrPerMap(snap);
  const codes = new Set(Object.keys(inrPer));
  for (const h of snap.hardAssets || []) {
    if (h?.id) codes.add(String(h.id).toUpperCase());
  }
  const maj = ["INR", "USD", "EUR", "GBP", "JPY", "CNY", "XAU", "BTC", "BRENT", "WTI"];
  return [...codes].sort((a, b) => {
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

function resolveSelected(snap, codeRaw) {
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

function buildNarrative(selected, kpi, ranking, legs) {
  const code = selected.code;
  const parts = [];
  const vsUsd = ranking.find((r) => r.id === "USD");
  const vsGold = ranking.find((r) => r.id === "XAU");
  const vsBrent = ranking.find((r) => r.id === "BRENT");
  const vsWti = ranking.find((r) => r.id === "WTI");
  const peerIds = new Set(["EUR", "GBP", "JPY", "CNY", "INR"]);
  const peers = ranking.filter((r) => peerIds.has(r.id) && r.id !== code);
  const weakThresh = -0.05;
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
    parts.push(
      `Vs USD (session): ${code} looks ${describe(vsUsd)} (cross Δ% ≈ ${vsUsd.score.toFixed(2)}%).`
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

function buildCompare(snap, codeRaw) {
  const selected = resolveSelected(snap, codeRaw);
  if (!selected) return null;

  const inrPer = buildInrPerMap(snap);
  const S = selected.inrPerUnit;
  const sChg = selected.changePct;
  const legs = [];
  const missing = [];

  const pushFxLeg = (code, label) => {
    const ip = inrPer[code];
    if (ip == null || !(ip > 0)) return;
    const unitsOfLegPerS = S / ip;
    const unitsOfSPerLeg = ip / S;
    const lChg = fxChangePct(snap, code);
    let deltaPct = null;
    if (sChg != null && lChg != null) deltaPct = Number((sChg - lChg).toFixed(4));
    legs.push({
      id: code,
      label: label || code,
      kind: "fx",
      unit: code,
      unitsPerSelected: roundNice(unitsOfLegPerS),
      selectedPerUnit: roundNice(unitsOfSPerLeg),
      quoteNote: `units of ${code} per 1 ${selected.code}`,
      inverseNote: `units of ${selected.code} per 1 ${code}`,
      deltaPct,
      strengthScore: deltaPct,
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

  // Key basket only (peers + home + hard) — full universe remains in selectable
  const KEY_BASKET = [
    ["INR", "fx", "Indian rupee"],
    ["USD", "fx", "US dollar"],
    ["EUR", "fx", "Euro"],
    ["GBP", "fx", "Pound sterling"],
    ["JPY", "fx", "Japanese yen"],
    ["CNY", "fx", "Chinese yuan"],
    ["XAU", "hard", "Gold", "oz"],
    ["BTC", "hard", "Bitcoin", "BTC"],
    ["BRENT", "hard", "Brent crude", "bbl"],
    ["WTI", "hard", "WTI crude", "bbl"],
  ];
  for (const row of KEY_BASKET) {
    const [code, kind, label, unit] = row;
    if (code === selected.code) continue;
    if (kind === "hard") pushHardLeg(code, label, unit);
    else pushFxLeg(code, label);
  }

  const presentHard = new Set(
    (snap.hardAssets || []).map((h) => String(h.id || "").toUpperCase())
  );
  for (const opt of [
    ["COPPER", "copper"],
    ["WHEAT", "wheat"],
    ["NATGAS", "natgas"],
    ["CRYPTO_INDEX", "crypto-index"],
  ]) {
    if (!presentHard.has(opt[0])) missing.push(`${opt[1]} not in snapshot`);
  }

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

  const ranking = legs
    .filter((l) => l.strengthScore != null && Number.isFinite(l.strengthScore))
    .map((l) => ({
      id: l.id,
      label: l.label,
      score: l.strengthScore,
      kind: l.kind,
    }))
    .sort((a, b) => b.score - a.score);

  const maxAbs = Math.max(...ranking.map((r) => Math.abs(r.score)), 1e-9);
  for (const r of ranking) {
    r.normalized = Number((r.score / maxAbs).toFixed(4));
  }

  const narrative = buildNarrative(selected, kpi, ranking, legs);

  const unavailable = (snap.meta?.unavailableExamples || []).map(
    (u) => `${u.code}: ${u.reason}`
  );

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
    missingNotes: [...missing, ...unavailable.map((u) => `unavailable · ${u}`)],
    selectable: listSelectableCodes(snap),
    method:
      "Cross rates via INR bridge: units of X per 1 S = inrPer[S] / inrPer[X] (FX) or inrPer[S] / hard.inrPrice. Ranking scores ≈ Δ%S − Δ%leg (session relative strength; + = selected strengthened vs leg).",
  };
}

async function loadSnapshotForApi(env, request) {
  const base = await loadSnapshotBase(env, request);
  if (!base) return null;
  const live = await fetchFrankfurterFx();
  if (live) return mergeLiveFx(base, live);
  return { ...base, live: false };
}

/* ---------- scheduled / manual refresh (KV write) ---------- */

function mergeSeriesPoint(seriesArr, t, v) {
  const arr = Array.isArray(seriesArr) ? [...seriesArr] : [];
  const idx = arr.findIndex((p) => p.t === t);
  if (idx >= 0) arr[idx] = { t, v };
  else arr.push({ t, v });
  arr.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  // keep ~HISTORY_DAYS*1.5 calendar window of points
  const cutoff = daysAgo(HISTORY_DAYS + 15);
  return arr.filter((p) => p.t >= cutoff);
}

function priorSeriesValue(history, pair, beforeDate) {
  const pts = history?.series?.[pair];
  if (!Array.isArray(pts) || !pts.length) return null;
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].t < beforeDate && typeof pts[i].v === "number") return pts[i].v;
  }
  return null;
}

/**
 * Build fresh snapshot + merge history; write KV keys snapshot, history, meta.
 * Gold/oil USD prints carried from prior KV (never invented). BTC via Coinbase.
 */
export async function refreshAndStore(env, { request = null } = {}) {
  const skipped = [];
  const notes = [];
  const started = new Date().toISOString();

  let prior = await kvGetJson(env, KV_KEYS.snapshot);
  if (!prior?.fx?.length) {
    prior = await loadBakedSnapshot(env, request);
  }
  let priorHistory = await kvGetJson(env, KV_KEYS.history);
  if (!priorHistory?.series) {
    priorHistory = (await loadBakedHistory(env, request)) || {
      series: {},
      hardAssets: {},
      notes: [],
    };
  }

  const currencies = await fetchJson(`${FRANK_BASE}/currencies`, {
    label: "frankfurter/currencies",
  });
  const frankCodes = Object.keys(currencies)
    .map((c) => c.toUpperCase())
    .sort();

  const latest = await fetchJson(`${FRANK_BASE}/latest?from=USD`, {
    label: "frankfurter/latest",
  });
  if (!latest?.rates?.INR) throw new Error("Frankfurter latest missing INR");
  const usdInr = Number(latest.rates.INR);
  const asOfDate = latest.date || isoDateUTC();
  const asOf = `${asOfDate}T00:00:00Z`;

  // Optional short timeseries for changePct + backfill when history thin
  const toCodes = frankCodes.filter((c) => c !== "USD");
  const start = daysAgo(HISTORY_DAYS);
  const end = asOfDate;
  let dayMap = {};
  let days = [];
  try {
    const seriesRaw = await fetchJson(
      `${FRANK_BASE}/${start}..${end}?from=USD&to=${toCodes.join(",")}`,
      { timeoutMs: 55000, label: "frankfurter/timeseries" }
    );
    dayMap = seriesRaw?.rates || {};
    days = Object.keys(dayMap).sort();
    notes.push(`Frankfurter timeseries ${start}..${end}: ${days.length} business days`);
  } catch (e) {
    notes.push(`Frankfurter timeseries skipped: ${e.message || e}`);
    skipped.push({ code: "TIMESERIES", reason: String(e.message || e) });
  }

  const latestInrPer = usdMapToInrPer(latest.rates, usdInr);

  // Merge timeseries into history (append/overwrite by date)
  const series = { ...(priorHistory.series || {}) };
  for (const day of days) {
    const usdRates = dayMap[day];
    const dayInr = usdRates?.INR;
    if (typeof dayInr !== "number" || !(dayInr > 0)) continue;
    const inrPer = usdMapToInrPer(usdRates, dayInr);
    for (const [code, rate] of Object.entries(inrPer)) {
      const key = `${code}INR`;
      const v = roundRate(code, rate);
      if (v == null) continue;
      series[key] = mergeSeriesPoint(series[key], day, v);
    }
  }
  // Always upsert latest endpoint values for asOfDate
  for (const [code, rateRaw] of Object.entries(latestInrPer)) {
    const v = roundRate(code, rateRaw);
    if (v == null) continue;
    const key = `${code}INR`;
    series[key] = mergeSeriesPoint(series[key], asOfDate, v);
  }

  // changePct from prior ECB day in merged series (or timeseries)
  const prevDay = days.length >= 2 ? days[days.length - 2] : null;
  const prevInrPer = prevDay
    ? usdMapToInrPer(dayMap[prevDay], dayMap[prevDay].INR)
    : null;

  const fx = [];
  const frankSet = new Set(frankCodes);
  for (const code of Object.keys(latestInrPer).sort((a, b) => {
    const maj = ["USD", "EUR", "GBP", "JPY", "CNY"];
    const ia = maj.indexOf(a);
    const ib = maj.indexOf(b);
    if (ia >= 0 || ib >= 0) {
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  })) {
    const rate = roundRate(code, latestInrPer[code]);
    if (rate == null) {
      skipped.push({ code, reason: "invalid rate" });
      continue;
    }
    let chg = null;
    if (prevInrPer && prevInrPer[code] != null) {
      chg = pctChange(prevInrPer[code], latestInrPer[code]);
    } else {
      const prevV = priorSeriesValue({ series }, `${code}INR`, asOfDate);
      chg = pctChange(prevV, latestInrPer[code]);
    }
    fx.push({
      pair: `${code}INR`,
      rate,
      changePct: chg,
      source: "Frankfurter / ECB reference",
      note:
        code === "JPY"
          ? "INR per 1 JPY (not per-100)"
          : `INR per 1 ${code}`,
      available: true,
      provider: "frankfurter",
    });
  }

  let floatMerged = 0;
  try {
    const floatData = await fetchJson(FLOAT_URL, {
      label: "floatrates",
      timeoutMs: 25000,
    });
    const floatInr =
      floatData?.inr?.rate != null ? Number(floatData.inr.rate) : usdInr;
    for (const entry of Object.values(floatData || {})) {
      const code = String(entry?.code || entry?.alphaCode || "").toUpperCase();
      if (!code || code === "USD" || code === "INR") continue;
      if (frankSet.has(code)) continue;
      const perUsd = Number(entry.rate);
      if (!Number.isFinite(perUsd) || !(perUsd > 0)) {
        skipped.push({ code, reason: "floatrates invalid rate" });
        continue;
      }
      const rate = roundRate(code, floatInr / perUsd);
      if (rate == null) continue;
      fx.push({
        pair: `${code}INR`,
        rate,
        changePct: null,
        source: "FloatRates (extra; not on ECB/Frankfurter)",
        note: `INR per 1 ${code} · FloatRates only (not ECB)`,
        available: true,
        provider: "floatrates",
        notOnEcb: true,
      });
      floatMerged += 1;
    }
    notes.push(`FloatRates extras merged: ${floatMerged}`);
  } catch (e) {
    notes.push(`FloatRates skipped: ${e.message || e}`);
    skipped.push({ code: "FLOATRATES", reason: String(e.message || e) });
  }

  // Hard assets: keep gold/oil from prior; refresh BTC via Coinbase — never invent
  const priorHard = new Map(
    (prior?.hardAssets || []).map((h) => [String(h.id || "").toUpperCase(), h])
  );

  let btcUsd = priorHard.get("BTC")?.usdPrice ?? null;
  let btcChg = priorHard.get("BTC")?.changePct ?? null;
  let btcSource = priorHard.get("BTC")?.source || "prior snapshot";
  try {
    const btcJson = await fetchJson(COINBASE_BTC, { label: "coinbase/btc" });
    const amt = Number(btcJson?.data?.amount);
    if (Number.isFinite(amt) && amt > 0) {
      if (typeof btcUsd === "number" && btcUsd > 0) {
        btcChg = pctChange(btcUsd, amt);
      }
      btcUsd = amt;
      btcSource = `Coinbase spot BTC-USD (${new Date().toISOString()})`;
    } else {
      skipped.push({ code: "BTC", reason: "coinbase amount invalid; kept prior" });
    }
  } catch (e) {
    skipped.push({
      code: "BTC",
      reason: `coinbase failed: ${e.message || e}; kept prior`,
    });
  }

  const hardAssets = [];
  for (const id of HARD_IDS) {
    if (id === "BTC") {
      if (!(typeof btcUsd === "number" && btcUsd > 0)) {
        skipped.push({ code: "BTC", reason: "no usable BTC price" });
        continue;
      }
      hardAssets.push({
        id: "BTC",
        name: "Bitcoin",
        unit: "USD",
        usdPrice: Number(btcUsd.toFixed(2)),
        inrPrice: Number((btcUsd * usdInr).toFixed(2)),
        changePct: btcChg,
        source: btcSource,
      });
      continue;
    }
    const prev = priorHard.get(id);
    if (!prev || !(typeof prev.usdPrice === "number" && prev.usdPrice > 0)) {
      skipped.push({
        code: id,
        reason: "no prior hard-asset USD print — not invented; omitted until sourced",
      });
      continue;
    }
    hardAssets.push({
      id,
      name: prev.name || id,
      unit: prev.unit || (id === "XAU" ? "USD/oz" : "USD/bbl"),
      usdPrice: prev.usdPrice,
      inrPrice: Number((prev.usdPrice * usdInr).toFixed(2)),
      changePct: prev.changePct ?? null,
      source:
        (prev.source || "prior snapshot") +
        ` · INR recomputed × USDINR ${usdInr} (Frankfurter ${asOfDate})`,
    });
  }

  // US Treasury yields (scheduled refresh — never invent)
  let yields = {
    asOf: null,
    us2y: null,
    us10y: null,
    us10yMinus2y: null,
    source: "U.S. Treasury Daily Treasury Yield Curve Rates (home.treasury.gov)",
    note: "not fetched",
  };
  try {
    const ty = await fetchTreasuryYields(fetchText);
    yields = ty.yields;
    for (const n of ty.notes || []) notes.push(n);
    for (const r of ty.rows || []) {
      series.US2Y = mergeSeriesPoint(series.US2Y, r.t, r.us2y);
      series.US10Y = mergeSeriesPoint(series.US10Y, r.t, r.us10y);
    }
  } catch (e) {
    notes.push(`treasury yields failed: ${e.message || e}`);
    yields.note = `fetch failed: ${e.message || e}`;
    skipped.push({ code: "US_TREASURY", reason: String(e.message || e) });
  }

  const usdRow = fx.find((r) => r.pair === "USDINR");
  const fxSoft = fx.filter((r) => typeof r.changePct === "number" && r.changePct > 0).length;
  const fxHard = fx.filter((r) => typeof r.changePct === "number" && r.changePct < 0).length;
  const brent = hardAssets.find((h) => h.id === "BRENT");
  const gold = hardAssets.find((h) => h.id === "XAU");
  const btc = hardAssets.find((h) => h.id === "BTC");
  const frankFxCount = fx.filter((r) => r.provider === "frankfurter").length;

  const seriesDayCount = Math.max(
    0,
    ...Object.values(series).map((arr) => (Array.isArray(arr) ? arr.length : 0))
  );
  const allTs = Object.values(series)
    .flatMap((arr) => (Array.isArray(arr) ? arr.map((p) => p.t) : []))
    .filter(Boolean)
    .sort();
  const histFrom = allTs[0] || start;
  const histTo = allTs[allTs.length - 1] || end;

  const realStrength = {
    summary: [
      `ECB/Frankfurter USDINR ${usdInr} as-of ${asOfDate} covering ${frankFxCount} FX codes` +
        (floatMerged ? ` + ${floatMerged} FloatRates extras` : "") +
        ".",
      fxSoft || fxHard
        ? `Session vs prior ECB day: ${fxSoft} pairs higher INR/foreign (softer INR), ${fxHard} lower.`
        : null,
      brent ? `Brent ${brent.usdPrice} USD/bbl → ₹${brent.inrPrice}/bbl via USDINR.` : null,
      gold ? `Gold ${gold.usdPrice} USD/oz → ₹${gold.inrPrice}/oz.` : null,
      btc ? `BTC ${btc.usdPrice} USD → ₹${btc.inrPrice}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    legs: [
      {
        lens: `FX basket (Frankfurter/ECB · ${frankFxCount} codes)`,
        verdict: fxSoft > fxHard ? "weaker" : fxHard > fxSoft ? "stronger" : "mixed",
        detail: `USDINR ${usdInr}. Higher XXXINR = weaker INR in FX terms. History: ~${seriesDayCount} points in KV.`,
      },
      {
        lens: "Gold (XAU)",
        verdict: gold ? "mixed" : "unavailable",
        detail: gold
          ? `Gold ${gold.usdPrice} USD/oz carried from prior validated print; INR recomputed. No multi-day gold history invented.`
          : "Gold not in snapshot — omitted (do not invent).",
      },
      {
        lens: "Oil (Brent / WTI)",
        verdict: brent ? "weaker" : "unavailable",
        detail: brent
          ? `Brent/WTI USD prints carried from prior; INR barrel cost = usd × USDINR. No multi-day oil history invented.`
          : "Oil not in snapshot — omitted.",
      },
      {
        lens: "BTC",
        verdict: btc ? "mixed" : "unavailable",
        detail: btc
          ? `BTC ${btc.usdPrice} USD (${btcSource}). INR = USD × USDINR.`
          : "BTC unavailable.",
      },
    ],
  };

  const scriptures = [
    `Frankfurter/ECB currencies: ${frankCodes.join(", ")} (${frankCodes.length})`,
    `Frankfurter/ECB latest from USD as-of ${asOfDate}: USDINR ${usdInr}; ${frankFxCount} INR-cross pairs`,
    `History KV series ${histFrom}..${histTo} (~${Object.keys(series).length} pairs)`,
    floatMerged
      ? `FloatRates extras: ${fx
          .filter((r) => r.provider === "floatrates")
          .map((r) => r.pair.replace(/INR$/, ""))
          .join(", ")}`
      : "FloatRates extras: none or fetch failed",
    gold
      ? `Gold ${gold.usdPrice} USD/oz — prior KV/snapshot retained; INR recomputed`
      : "Gold: not fetched this run",
    brent
      ? `Brent ${brent.usdPrice} / WTI ${hardAssets.find((h) => h.id === "WTI")?.usdPrice ?? "—"} USD/bbl — prior retained; INR recomputed`
      : "Oil: not fetched this run",
    btc ? `BTC ${btc.usdPrice} USD — ${btcSource}` : "BTC: unavailable",
    "Worker cron refresh stores snapshot/history/meta in KV; bot redeploy optional",
    yields.us10y != null
      ? `UST yields 2y ${yields.us2y}% / 10y ${yields.us10y}% / curve ${yields.us10yMinus2y}% as-of ${yields.asOf}`
      : `UST yields: unavailable (${yields.note || "fetch failed"}) — not invented`,
  ];

  const assumptions = [
    "Prefer Frankfurter/ECB when a code exists in both Frankfurter and FloatRates",
    "FloatRates extras are labeled notOnEcb — never treated as ECB reference",
    "Hard-asset multi-day history is not invented; gold/oil USD prints carried from prior KV",
    "changePct for Frankfurter pairs is prior ECB business day → latest",
    "realStrength is narrative desk commentary, not a formal PPP or REER index",
    "Higher USDINR / XXXINR means weaker INR in FX terms",
    "US Treasury yields from official CSV when fetch succeeds; never invented",
    ...notes.map((n) => `refresh note: ${n}`),
  ];

  const presentCodes = new Set(fx.map((r) => r.pair.replace(/INR$/, "")));
  const commonWanted = [
    "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "PKR", "BDT", "LKR", "NPR", "VND", "TWD",
  ];
  const unavailableExamples = commonWanted
    .filter((c) => !presentCodes.has(c) && !frankSet.has(c))
    .map((c) => ({
      code: c,
      reason: "not on ECB/Frankfurter",
    }));

  const snapshot = {
    asOf,
    timezoneNote: `UTC; Frankfurter/ECB reference date ${asOfDate}; worker refresh ${started}`,
    live: false,
    fx,
    hardAssets,
    yields,
    realStrength,
    scriptures,
    assumptions,
    meta: {
      frankfurterCodes: frankCodes,
      frankfurterCount: frankCodes.length,
      floatRatesExtras: floatMerged,
      historyDays: seriesDayCount,
      historyFrom: histFrom,
      historyTo: histTo,
      skipped,
      unavailableExamples,
      refreshedBy: "worker",
    },
  };

  const history = {
    asOf,
    source: "Frankfurter / ECB",
    from: histFrom,
    to: histTo,
    dayCount: seriesDayCount,
    series,
    hardAssets: {},
    notes: [
      "FX series are INR per 1 foreign from ECB/Frankfurter USD crosses.",
      "Hard-asset history not present — charts must say level only / no history yet.",
      series.US10Y?.length
        ? `US2Y/US10Y from Treasury CSV (${series.US10Y.length} points).`
        : "US Treasury yield history not present this run.",
      floatMerged
        ? `FloatRates extras (${floatMerged}) are snapshot-only; no fabricated history series.`
        : "No FloatRates extras in this refresh.",
      `Last worker refresh: ${started}`,
    ],
  };

  const meta = {
    lastRefresh: started,
    asOf,
    asOfDate,
    fxCount: fx.length,
    frankfurterCount: frankFxCount,
    floatRatesExtras: floatMerged,
    hardAssets: hardAssets.map((h) => h.id),
    historySeries: Object.keys(series).length,
    historyFrom: histFrom,
    historyTo: histTo,
    cron: "30 3 * * *",
    cronNote: "03:30 UTC daily ≈ after ECB / before IST morning (~09:00 IST)",
    skippedCount: skipped.length,
    yieldsAsOf: yields.asOf || null,
    us10y: yields.us10y ?? null,
  };

  await kvPutJson(env, KV_KEYS.snapshot, snapshot);
  await kvPutJson(env, KV_KEYS.history, history);
  await kvPutJson(env, KV_KEYS.meta, meta);

  return { ok: true, meta, usdInr: usdRow?.rate ?? usdInr };
}

function refreshKeyAllowed(request, env) {
  const secret = env.REFRESH_KEY;
  if (!secret) return false;
  const url = new URL(request.url);
  const q = url.searchParams.get("key") || "";
  const header = request.headers.get("X-Refresh-Key") || "";
  return q === secret || header === secret;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      refreshAndStore(env).catch((err) => {
        console.error("scheduled refresh failed:", err?.message || err);
      })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Protected manual refresh (GET or POST) — requires REFRESH_KEY secret
    if (path === "/api/refresh" && (request.method === "GET" || request.method === "POST")) {
      if (!refreshKeyAllowed(request, env)) {
        return json({ error: "unauthorized" }, 401);
      }
      try {
        const result = await refreshAndStore(env, { request });
        return json(result);
      } catch (e) {
        return json({ error: "refresh failed", message: String(e.message || e) }, 500);
      }
    }

    if (path === "/api/health" && request.method === "GET") {
      await ensureKvSeeded(env, request);
      const meta = await kvGetJson(env, KV_KEYS.meta);
      const snap = await loadSnapshotBase(env, request);
      return json({
        ok: true,
        asOf: snap?.asOf ?? null,
        service: "fx-analysis",
        fxCount: snap?.fx?.length ?? 0,
        dataSource: snap?.dataSource ?? null,
        lastRefresh: meta?.lastRefresh ?? null,
        kv: !!env.DATA,
        cron: "30 3 * * *",
      });
    }

    if (path === "/api/snapshot" && request.method === "GET") {
      const snap = await loadSnapshotForApi(env, request);
      if (!snap) return json({ error: "snapshot unavailable" }, 503);
      return json(snap);
    }

    if (path === "/api/history" && request.method === "GET") {
      const hist = await loadHistoryBase(env, request);
      if (!hist) return json({ error: "history unavailable" }, 503);
      return json(hist);
    }

    if (path === "/api/meta" && request.method === "GET") {
      await ensureKvSeeded(env, request);
      const meta = await kvGetJson(env, KV_KEYS.meta);
      return json(meta || { lastRefresh: null, note: "no meta in KV yet" });
    }

    let compareCode = null;
    if (path === "/api/compare" && request.method === "GET") {
      compareCode = (url.searchParams.get("code") || "").trim().toUpperCase();
    } else {
      const m = path.match(/^\/api\/compare\/([A-Za-z0-9_]+)$/);
      if (m && request.method === "GET") compareCode = m[1].toUpperCase();
    }

    if (compareCode !== null && path.startsWith("/api/compare")) {
      if (!compareCode) {
        const snap = await loadSnapshotForApi(env, request);
        return json(
          {
            error: "missing code query param",
            hint: "GET /api/compare?code=USD",
            selectable: snap ? listSelectableCodes(snap) : [],
          },
          400
        );
      }
      const snap = await loadSnapshotForApi(env, request);
      if (!snap) return json({ error: "snapshot unavailable" }, 503);
      const payload = buildCompare(snap, compareCode);
      if (!payload) {
        const unavail = (snap.meta?.unavailableExamples || []).find(
          (u) => u.code === compareCode
        );
        const frank = snap.meta?.frankfurterCodes || [];
        const reason = unavail
          ? unavail.reason
          : frank.length && !frank.includes(compareCode)
            ? "not on ECB/Frankfurter (and not in FloatRates extras)"
            : "unknown currency or asset code";
        return json(
          {
            error: "unknown currency or asset code",
            code: compareCode,
            reason,
            selectable: listSelectableCodes(snap),
            unavailableExamples: snap.meta?.unavailableExamples || [],
          },
          404
        );
      }
      return json(payload);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return json({ error: "Not found", path }, 404);
  },
};
