#!/usr/bin/env node
/**
 * Refresh FX snapshot + daily history from Frankfurter/ECB (+ optional FloatRates extras).
 * Never invents prices. Prefer Frankfurter when both sources have a code.
 *
 * Writes:
 *   public/data/snapshot.json
 *   public/data/history.json
 * Updates scriptures notes inside snapshot.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchTreasuryYields } from "../src/yields.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapPath = join(root, "public/data/snapshot.json");
const histPath = join(root, "public/data/history.json");

const FRANK_BASE = "https://api.frankfurter.app"; // redirects to frankfurter.dev
const FLOAT_URL = "https://www.floatrates.com/daily/usd.json";
const COINBASE_BTC = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const HISTORY_DAYS = 40; // ~30-45 calendar days → ~25-30 ECB business days

const HARD_IDS = ["XAU", "BRENT", "WTI", "BTC"];

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
      headers: { Accept: "application/json", "User-Agent": "fx-analysis-refresh/1.3" },
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
      headers: { Accept: "text/csv,text/plain,*/*", "User-Agent": "fx-analysis-refresh/1.3" },
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
  // JPY and other low-unit currencies need more precision
  if (code === "JPY" || rate < 1) return Number(rate.toFixed(6));
  if (rate < 10) return Number(rate.toFixed(5));
  if (rate < 100) return Number(rate.toFixed(4));
  return Number(rate.toFixed(4));
}

/** USD→foreign rates map → INR per 1 foreign (incl. USDINR). */
function usdMapToInrPer(usdRates, usdInr) {
  const out = { USD: usdInr };
  for (const [code, perUsd] of Object.entries(usdRates)) {
    if (code === "INR" || code === "USD") continue;
    if (typeof perUsd !== "number" || !(perUsd > 0)) continue;
    out[code] = usdInr / perUsd;
  }
  return out;
}

function loadPriorSnapshot() {
  if (!existsSync(snapPath)) return null;
  try {
    return JSON.parse(readFileSync(snapPath, "utf8"));
  } catch {
    return null;
  }
}

function pctChange(prev, next) {
  if (!(typeof prev === "number" && prev > 0 && typeof next === "number" && next > 0)) return null;
  return Number((((next - prev) / prev) * 100).toFixed(4));
}

async function main() {
  const skipped = [];
  const notes = [];
  const prior = loadPriorSnapshot();

  console.log("refresh: fetching Frankfurter currencies…");
  const currencies = await fetchJson(`${FRANK_BASE}/currencies`, { label: "frankfurter/currencies" });
  const frankCodes = Object.keys(currencies)
    .map((c) => c.toUpperCase())
    .sort();
  console.log(`  frankfurter universe: ${frankCodes.length} codes`);

  console.log("refresh: fetching Frankfurter latest (USD base)…");
  const latest = await fetchJson(`${FRANK_BASE}/latest?from=USD`, { label: "frankfurter/latest" });
  if (!latest?.rates?.INR) throw new Error("Frankfurter latest missing INR");
  const usdInr = Number(latest.rates.INR);
  const asOfDate = latest.date || isoDateUTC();
  const asOf = `${asOfDate}T00:00:00Z`;

  const toCodes = frankCodes.filter((c) => c !== "USD");
  const start = daysAgo(HISTORY_DAYS);
  const end = asOfDate;
  const toParam = toCodes.join(",");

  console.log(`refresh: fetching Frankfurter timeseries ${start}..${end} (${toCodes.length} codes)…`);
  const seriesRaw = await fetchJson(
    `${FRANK_BASE}/${start}..${end}?from=USD&to=${toParam}`,
    { timeoutMs: 60000, label: "frankfurter/timeseries" }
  );
  const dayMap = seriesRaw?.rates || {};
  const days = Object.keys(dayMap).sort();
  console.log(`  history business days: ${days.length} (${days[0] || "?"} → ${days[days.length - 1] || "?"})`);

  // Build INR-per series per code
  const series = {};
  for (const day of days) {
    const usdRates = dayMap[day];
    const dayInr = usdRates?.INR;
    if (typeof dayInr !== "number" || !(dayInr > 0)) continue;
    const inrPer = usdMapToInrPer(usdRates, dayInr);
    for (const [code, rate] of Object.entries(inrPer)) {
      const key = `${code}INR`;
      if (!series[key]) series[key] = [];
      const v = roundRate(code, rate);
      if (v != null) series[key].push({ t: day, v });
    }
  }

  // Latest INR-per from latest endpoint (prefer over last history day)
  const latestInrPer = usdMapToInrPer(latest.rates, usdInr);

  // changePct: last history point vs previous business day (same source)
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
    const chg =
      prevInrPer && prevInrPer[code] != null
        ? pctChange(prevInrPer[code], latestInrPer[code])
        : null;
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

  // Optional FloatRates extras (codes NOT in Frankfurter)
  let floatMerged = 0;
  try {
    console.log("refresh: fetching FloatRates extras…");
    const floatData = await fetchJson(FLOAT_URL, { label: "floatrates", timeoutMs: 25000 });
    const floatInr = floatData?.inr?.rate != null ? Number(floatData.inr.rate) : usdInr;
    for (const entry of Object.values(floatData || {})) {
      const code = String(entry?.code || entry?.alphaCode || "").toUpperCase();
      if (!code || code === "USD" || code === "INR") continue;
      if (frankSet.has(code)) continue; // prefer Frankfurter
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
    notes.push(`FloatRates extras merged: ${floatMerged} codes not on Frankfurter/ECB`);
    console.log(`  floatrates extras merged: ${floatMerged}`);
  } catch (e) {
    notes.push(`FloatRates skipped: ${e.message || e}`);
    skipped.push({ code: "FLOATRATES", reason: String(e.message || e) });
    console.warn(`  floatrates failed: ${e.message || e}`);
  }

  // Hard assets: keep gold/oil from prior snapshot (no invent); refresh BTC via Coinbase
  const priorHard = new Map(
    (prior?.hardAssets || []).map((h) => [String(h.id || "").toUpperCase(), h])
  );

  let btcUsd = priorHard.get("BTC")?.usdPrice ?? null;
  let btcChg = priorHard.get("BTC")?.changePct ?? null;
  let btcSource = priorHard.get("BTC")?.source || "prior snapshot";
  try {
    console.log("refresh: fetching Coinbase BTC-USD…");
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
    skipped.push({ code: "BTC", reason: `coinbase failed: ${e.message || e}; kept prior` });
    console.warn(`  coinbase failed: ${e.message || e}`);
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

  // US Treasury yields (never invent)
  console.log("refresh: fetching U.S. Treasury yield curve CSV…");
  let yields = {
    asOf: null,
    us2y: null,
    us10y: null,
    us10yMinus2y: null,
    source: "U.S. Treasury Daily Treasury Yield Curve Rates (home.treasury.gov)",
    note: "not fetched",
  };
  let yieldRows = [];
  try {
    const ty = await fetchTreasuryYields(fetchText);
    yields = ty.yields;
    yieldRows = ty.rows || [];
    for (const n of ty.notes || []) notes.push(n);
    console.log(
      `  yields asOf=${yields.asOf || "—"} 2y=${yields.us2y ?? "—"} 10y=${yields.us10y ?? "—"} rows=${yieldRows.length}`
    );
  } catch (e) {
    notes.push(`treasury yields failed: ${e.message || e}`);
    yields.note = `fetch failed: ${e.message || e}`;
    skipped.push({ code: "US_TREASURY", reason: String(e.message || e) });
    console.warn(`  treasury failed: ${e.message || e}`);
  }

  // Merge US2Y / US10Y into history series when present
  for (const r of yieldRows) {
    if (!series.US2Y) series.US2Y = [];
    if (!series.US10Y) series.US10Y = [];
    const i2 = series.US2Y.findIndex((p) => p.t === r.t);
    const pt2 = { t: r.t, v: r.us2y };
    if (i2 >= 0) series.US2Y[i2] = pt2;
    else series.US2Y.push(pt2);
    const i10 = series.US10Y.findIndex((p) => p.t === r.t);
    const pt10 = { t: r.t, v: r.us10y };
    if (i10 >= 0) series.US10Y[i10] = pt10;
    else series.US10Y.push(pt10);
  }
  if (series.US2Y) series.US2Y.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (series.US10Y) series.US10Y.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  // Real-strength narrative (desk commentary from available prints)
  const usdRow = fx.find((r) => r.pair === "USDINR");
  const fxSoft = (fx.filter((r) => typeof r.changePct === "number" && r.changePct > 0).length || 0);
  const fxHard = (fx.filter((r) => typeof r.changePct === "number" && r.changePct < 0).length || 0);
  const brent = hardAssets.find((h) => h.id === "BRENT");
  const gold = hardAssets.find((h) => h.id === "XAU");
  const btc = hardAssets.find((h) => h.id === "BTC");

  const summaryParts = [
    `ECB/Frankfurter USDINR ${usdInr} as-of ${asOfDate} covering ${fx.filter((r) => r.provider === "frankfurter").length} FX codes` +
      (floatMerged ? ` + ${floatMerged} FloatRates extras` : "") +
      ".",
  ];
  if (fxSoft || fxHard) {
    summaryParts.push(
      `Session vs prior ECB day: ${fxSoft} pairs higher INR/foreign (softer INR), ${fxHard} lower.`
    );
  }
  if (brent) {
    summaryParts.push(
      `Brent ${brent.usdPrice} USD/bbl → ₹${brent.inrPrice}/bbl via USDINR.`
    );
  }
  if (gold) {
    summaryParts.push(`Gold ${gold.usdPrice} USD/oz → ₹${gold.inrPrice}/oz.`);
  }
  if (btc) {
    summaryParts.push(`BTC ${btc.usdPrice} USD → ₹${btc.inrPrice}.`);
  }

  const realStrength = {
    summary: summaryParts.join(" "),
    legs: [
      {
        lens: `FX basket (Frankfurter/ECB · ${fx.filter((r) => r.provider === "frankfurter").length} codes)`,
        verdict: fxSoft > fxHard ? "weaker" : fxHard > fxSoft ? "stronger" : "mixed",
        detail: `USDINR ${usdInr}. Higher XXXINR = weaker INR in FX terms. History: ${days.length} ECB business days baked.`,
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
    `Frankfurter/ECB currencies: ${frankCodes.join(", ")} (${frankCodes.length}) — https://api.frankfurter.app/currencies`,
    `Frankfurter/ECB latest from USD as-of ${asOfDate}: USDINR ${usdInr}; ${fx.filter((r) => r.provider === "frankfurter").length} INR-cross pairs`,
    `Frankfurter/ECB timeseries ${start}..${end}: ${days.length} business days stored in history.json`,
    floatMerged
      ? `FloatRates extras (not on ECB): ${fx.filter((r) => r.provider === "floatrates").map((r) => r.pair.replace(/INR$/, "")).join(", ")}`
      : "FloatRates extras: none or fetch failed",
    gold
      ? `Gold ${gold.usdPrice} USD/oz — prior snapshot retained; INR recomputed`
      : "Gold: not fetched this run",
    brent
      ? `Brent ${brent.usdPrice} / WTI ${hardAssets.find((h) => h.id === "WTI")?.usdPrice ?? "—"} USD/bbl — prior snapshot retained; INR recomputed`
      : "Oil: not fetched this run",
    btc ? `BTC ${btc.usdPrice} USD — ${btcSource}` : "BTC: unavailable",
    "INR hard-asset prices = usdPrice × USDINR (same session FX)",
    "Live overlay: Worker fetches Frankfurter latest?from=USD (all rates) and converts to INR pairs",
    yields.us10y != null
      ? `UST yields 2y ${yields.us2y}% / 10y ${yields.us10y}% / curve ${yields.us10yMinus2y}% as-of ${yields.asOf} — ${yields.source}`
      : `UST yields: unavailable (${yields.note || "fetch failed"}) — not invented`,
  ];

  const assumptions = [
    "Prefer Frankfurter/ECB when a code exists in both Frankfurter and FloatRates",
    "FloatRates extras are labeled notOnEcb — never treated as ECB reference",
    "Hard-asset multi-day history is not invented; charts show “level only / no history yet” when absent",
    "AED and other non-ECB codes appear only if FloatRates (or another sourced feed) succeeds",
    "changePct for Frankfurter pairs is prior ECB business day → latest; FloatRates extras have null changePct unless sourced",
    "realStrength is narrative desk commentary, not a formal PPP or REER index",
    "Higher USDINR / XXXINR means weaker INR in FX terms",
    "US Treasury yields from official CSV when fetch succeeds; never invented",
    ...notes.map((n) => `refresh note: ${n}`),
  ];

  // Common unavailable examples for UI labeling (not in fx)
  const presentCodes = new Set(fx.map((r) => r.pair.replace(/INR$/, "")));
  const commonWanted = ["AED", "SAR", "QAR", "KWD", "BHD", "OMR", "PKR", "BDT", "LKR", "NPR", "VND", "TWD"];
  const unavailableExamples = commonWanted
    .filter((c) => !presentCodes.has(c) && !frankSet.has(c))
    .map((c) => ({
      code: c,
      reason: frankSet.has(c) ? "on ECB but missing from latest" : "not on ECB/Frankfurter",
    }));

  const snapshot = {
    asOf,
    timezoneNote: `UTC; Frankfurter/ECB reference date ${asOfDate}; refresh ${new Date().toISOString()}`,
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
      historyDays: days.length,
      historyFrom: days[0] || start,
      historyTo: days[days.length - 1] || end,
      skipped,
      unavailableExamples,
    },
  };

  const history = {
    asOf,
    source: "Frankfurter / ECB",
    from: days[0] || start,
    to: days[days.length - 1] || end,
    dayCount: days.length,
    series,
    // Intentionally omit hardAssets history — do not invent
    hardAssets: {},
    notes: [
      "FX series are INR per 1 foreign (e.g. USDINR, EURINR) from ECB/Frankfurter USD crosses.",
      "Hard-asset history not present — charts must say level only / no history yet.",
      series.US10Y?.length
        ? `US2Y/US10Y appended from Treasury CSV (${series.US10Y.length} points).`
        : "US Treasury yield history not present this run.",
      floatMerged
        ? `FloatRates extras (${floatMerged}) are snapshot-only; no fabricated history series.`
        : "No FloatRates extras in this refresh.",
    ],
  };

  writeFileSync(snapPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  writeFileSync(histPath, JSON.stringify(history, null, 2) + "\n", "utf8");

  console.log("refresh ok");
  console.log(`  snapshot.fx=${fx.length} (frankfurter=${fx.filter((r) => r.provider === "frankfurter").length} float=${floatMerged})`);
  console.log(`  hardAssets=${hardAssets.map((h) => h.id).join(",")}`);
  console.log(`  history series keys=${Object.keys(series).length} days=${days.length}`);
  console.log(`  yields 2y=${yields.us2y ?? "—"} 10y=${yields.us10y ?? "—"} asOf=${yields.asOf || "—"}`);
  console.log(`  skipped=${skipped.length}`);
  if (skipped.length) {
    for (const s of skipped.slice(0, 20)) console.log(`    · ${s.code}: ${s.reason}`);
  }
  if (unavailableExamples.length) {
    console.log(`  unavailable examples (not in snapshot): ${unavailableExamples.map((u) => u.code).join(", ")}`);
  }
}

main().catch((e) => {
  console.error("refresh FAIL:", e.message || e);
  process.exit(1);
});
