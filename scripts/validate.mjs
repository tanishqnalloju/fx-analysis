#!/usr/bin/env node
/**
 * Validate public/data/snapshot.json (+ history.json when present).
 * Smoke-tests compare-lib (buildCompare + buildSlipMatrix).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "public/data/snapshot.json");
const histPath = join(root, "public/data/history.json");

function fail(msg) {
  console.error(`validate FAIL: ${msg}`);
  process.exit(1);
}

let snap;
try {
  snap = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  fail(`cannot read/parse ${path}: ${e.message}`);
}

if (!snap.asOf || typeof snap.asOf !== "string") fail("missing asOf string");
if (!Array.isArray(snap.fx) || snap.fx.length === 0) fail("fx[] required and non-empty");
if (!Array.isArray(snap.hardAssets) || snap.hardAssets.length === 0)
  fail("hardAssets[] required and non-empty");
if (!snap.realStrength || typeof snap.realStrength.summary !== "string" || !snap.realStrength.summary)
  fail("realStrength.summary required");
if (!Array.isArray(snap.scriptures) || snap.scriptures.length === 0)
  fail("scriptures[] required and non-empty");

// Exhaustive universe: expect ~30 Frankfurter codes (USD + ~29 crosses)
if (snap.fx.length < 20) {
  fail(`fx[] too small (${snap.fx.length}); expected full Frankfurter universe (~30)`);
}

for (const [i, row] of snap.fx.entries()) {
  if (!row || typeof row !== "object") fail(`fx[${i}] not an object`);
  if (!row.pair) fail(`fx[${i}].pair missing`);
  if (!row.source) fail(`fx[${i}].source missing`);
  const rate = Number(row.rate);
  if (!Number.isFinite(rate) || rate <= 0)
    fail(`fx[${i}].rate must be finite number > 0 (got ${row.rate})`);
}

for (const [i, row] of snap.hardAssets.entries()) {
  if (!row || typeof row !== "object") fail(`hardAssets[${i}] not an object`);
  if (!row.id && !row.name) fail(`hardAssets[${i}] needs id or name`);
  if (!row.source) fail(`hardAssets[${i}].source missing`);
  const usd = Number(row.usdPrice);
  const inr = Number(row.inrPrice);
  if (!Number.isFinite(usd) || usd <= 0)
    fail(`hardAssets[${i}].usdPrice must be finite > 0`);
  if (!Number.isFinite(inr) || inr <= 0)
    fail(`hardAssets[${i}].inrPrice must be finite > 0`);
}

let history = null;
if (existsSync(histPath)) {
  try {
    history = JSON.parse(readFileSync(histPath, "utf8"));
  } catch (e) {
    fail(`cannot parse history.json: ${e.message}`);
  }
  if (!history.series || typeof history.series !== "object") fail("history.series required");
  const keys = Object.keys(history.series);
  if (keys.length < 10) fail(`history.series too small (${keys.length})`);
  const usdinr = history.series.USDINR;
  if (!Array.isArray(usdinr) || usdinr.length < 5) {
    fail("history.series.USDINR must have multi-day points");
  }
  for (const [i, p] of usdinr.entries()) {
    if (!p?.t || typeof p.v !== "number" || !(p.v > 0)) fail(`USDINR[${i}] invalid`);
  }
  // Hard-asset history must not be invented with fake series
  if (history.hardAssets && Object.keys(history.hardAssets).length) {
    for (const [k, arr] of Object.entries(history.hardAssets)) {
      if (!Array.isArray(arr) || arr.length < 2) {
        fail(`hardAssets.${k} present but not a multi-point series — omit instead of inventing`);
      }
    }
  }
} else {
  console.warn("validate WARN: history.json missing — run npm run refresh");
}

const libPath = join(root, "public/js/compare-lib.js");
const { buildCompare, listSelectableCodes, buildSlipMatrix, majorPickerCodes, KEY_BASKET_IDS, buildCorrelations } = await import(
  pathToFileURL(libPath).href
);
const researchPath = join(root, "public/js/research.js");
const {
  buildTechnicals,
  buildRegime,
  buildModelCard,
  buildLeadLag,
  buildCompareTechnicals,
} = await import(pathToFileURL(researchPath).href);

const codes = listSelectableCodes(snap);
if (!codes.includes("USD") || !codes.includes("INR")) {
  fail(`compare selectable missing USD/INR: ${codes.join(",")}`);
}
if (codes.length < 20) {
  fail(`selectable too small (${codes.length}); expected full universe`);
}

const picker = majorPickerCodes(snap);
if (picker.length !== codes.length) {
  fail(`majorPickerCodes length ${picker.length} != selectable ${codes.length}`);
}

for (const code of ["USD", "EUR", "INR", "JPY", "SGD", "AUD"]) {
  if (!codes.includes(code)) continue;
  const cmp = buildCompare(snap, code);
  if (!cmp) fail(`buildCompare(${code}) returned null`);
  if (cmp.code !== code) fail(`buildCompare(${code}).code mismatch`);
  if (!cmp.kpi?.vsInr || !(cmp.kpi.vsInr.value > 0)) fail(`buildCompare(${code}) missing vsInr`);
  if (!Array.isArray(cmp.legs) || cmp.legs.length === 0) fail(`buildCompare(${code}) empty legs`);
  if (code === "USD") {
    const usdInr = snap.fx.find((r) => r.pair === "USDINR")?.rate;
    if (Math.abs(cmp.kpi.vsInr.value - usdInr) > 1e-6) {
      fail(`USD vs INR ${cmp.kpi.vsInr.value} != USDINR ${usdInr}`);
    }
  }
  if (code === "INR" && cmp.kpi.vsUsd) {
    const usdInr = snap.fx.find((r) => r.pair === "USDINR")?.rate;
    const expected = 1 / usdInr;
    if (Math.abs(cmp.kpi.vsUsd.value - expected) > 1e-6) {
      fail(`INR vs USD ${cmp.kpi.vsUsd.value} != 1/USDINR ${expected}`);
    }
  }
}

const bogus = buildCompare(snap, "ZZZNOPE");
if (bogus != null) fail("buildCompare(unknown) should be null");

const slip = buildSlipMatrix(snap, history);
if (!slip || !Array.isArray(slip.rows) || !slip.rows.length) {
  fail("buildSlipMatrix returned empty rows");
}
// Full universe rows (beyond the old 5-6)
if (slip.rows.length < 15) {
  fail(`slip rows too few (${slip.rows.length}); expected full FX matrix`);
}
if (!slip.ladders?.usd || !slip.legs?.length) {
  fail("buildSlipMatrix missing ladders/legs");
}

if (history?.series?.USDINR?.length >= 2) {
  if (slip.historyLimited) {
    fail("buildSlipMatrix should not be historyLimited when history.json has series");
  }
  if (!String(slip.historyLabel || "").toLowerCase().includes("history")) {
    fail("historyLabel should mention history when series present");
  }
} else {
  if (!slip.historyLimited || !String(slip.historyLabel || "").includes("ASSUMPTION")) {
    fail("buildSlipMatrix must label ASSUMPTION / limited history without multi-day series");
  }
}

// EUR vs USD: with history, score uses multi-day moves; with session-only, Δ% diff
const eurRow = slip.rows.find((r) => r.code === "EUR");
if (eurRow && !history?.series?.EURINR) {
  const eurChg = snap.fx.find((r) => r.pair === "EURINR")?.changePct;
  const usdChg = snap.fx.find((r) => r.pair === "USDINR")?.changePct;
  if (eurChg != null && usdChg != null) {
    const expected = Number((eurChg - usdChg).toFixed(4));
    if (Math.abs((eurRow.cells.usd ?? NaN) - expected) > 1e-6) {
      fail(`EUR vs USD slip ${eurRow.cells.usd} != ${expected}`);
    }
  }
}


// Key basket: compare legs must not dump full floatrates tail
const usdCmp = buildCompare(snap, "USD");
if (usdCmp) {
  const legIds = usdCmp.legs.map((l) => l.id);
  const unexpected = legIds.filter((id) => !KEY_BASKET_IDS.includes(id));
  if (unexpected.length) fail(`USD compare legs outside key basket: ${unexpected.join(",")}`);
  if (legIds.length > KEY_BASKET_IDS.length) fail(`too many compare legs: ${legIds.length}`);
}

// Correlations smoke (peers should score when history present)
if (history?.series?.EURINR && history?.series?.USDINR) {
  const corr = buildCorrelations(history, "EUR");
  if (!corr?.rows?.length) fail("buildCorrelations empty");
  const peer = corr.rows.find((r) => r.id === "peers");
  if (!peer) fail("buildCorrelations missing peers row");
  // gold/oil may be null — that is correct when hard history absent
}

// events.json curated calendar
const evPath = join(root, "public/data/events.json");
if (!existsSync(evPath)) fail("public/data/events.json missing");
const events = JSON.parse(readFileSync(evPath, "utf8"));
if (!Array.isArray(events.events) || events.events.length < 3) fail("events.json needs curated events");
if (!String(events.label || "").toUpperCase().includes("ASSUMPTION")) {
  fail("events.json must be labeled ASSUMPTION / manual");
}

// refresh script must exist
if (!existsSync(join(root, "scripts/refresh.mjs"))) {
  fail("scripts/refresh.mjs missing");
}
if (!existsSync(join(root, "public/js/charts.js"))) {
  fail("public/js/charts.js missing");
}

// Research pack smoke
if (history?.series?.USDINR) {
  const tech = buildTechnicals(history.series.USDINR, "USDINR");
  if (!tech.summary || !String(tech.summary).includes("desk technical")) {
    fail("buildTechnicals missing desk technical summary");
  }
  const regime = buildRegime(snap, history);
  if (!regime.cards?.length) fail("buildRegime empty cards");
  const model = buildModelCard(history.series.USDINR, "USDINR");
  if (!model.rules?.length) fail("buildModelCard empty rules");
  for (const r of model.rules) {
    if (!["KEEP", "WEAK", "KILL"].includes(r.verdict)) fail(`bad verdict ${r.verdict}`);
  }
  const ll = buildLeadLag(history);
  if (!ll.rows?.length && !ll.note) fail("buildLeadLag empty");
  const ct = buildCompareTechnicals(history, "EUR");
  if (!ct.primary) fail("buildCompareTechnicals(EUR) missing primary");
}

// Forbidden trade-language in UI copy
const uiFiles = [
  "public/index.html",
  "public/js/desk.js",
  "public/js/compare.js",
  "public/js/research.js",
  "public/js/slip.js",
  "public/js/app.js",
];
const forbidden = [/\bBuy\b/, /\bSell\b/, /Strong Buy/i, /Strong Sell/i];
for (const rel of uiFiles) {
  const fp = join(root, rel);
  if (!existsSync(fp)) continue;
  const body = readFileSync(fp, "utf8");
  for (const re of forbidden) {
    if (re.test(body)) fail(`${rel} contains forbidden trade language matching ${re}`);
  }
}

if (!existsSync(join(root, "public/js/research.js"))) fail("public/js/research.js missing");
if (!existsSync(join(root, "src/yields.js"))) fail("src/yields.js missing");

// Yields: if present must be structured; nulls ok when fetch failed
if (snap.yields) {
  if (typeof snap.yields !== "object") fail("snap.yields must be object");
  if (!snap.yields.source) fail("snap.yields.source required when yields present");
  if (snap.yields.us10y != null && typeof snap.yields.us10y !== "number") {
    fail("snap.yields.us10y must be number or null");
  }
}

console.log(`validate ok: ${path}`);
console.log(`  asOf=${snap.asOf} fx=${snap.fx.length} hard=${snap.hardAssets.length} scriptures=${snap.scriptures.length}`);
console.log(`  compare selectable=${codes.length} codes smoke=ok`);
console.log(
  `  slip rows=${slip.rows.length} scored=${slip.scoredCells}/${slip.totalCells} historyLimited=${slip.historyLimited}`
);
if (history) {
  console.log(
    `  history series=${Object.keys(history.series).length} days=${history.dayCount || history.series.USDINR?.length} ${history.from}→${history.to}`
  );
  if (history.series.US10Y) {
    console.log(`  history US10Y pts=${history.series.US10Y.length} US2Y pts=${history.series.US2Y?.length || 0}`);
  } else {
    console.log("  history US10Y: absent (hard-asset / yield history may be missing)");
  }
}
if (snap.yields?.us10y != null) {
  console.log(`  yields 2y=${snap.yields.us2y} 10y=${snap.yields.us10y} curve=${snap.yields.us10yMinus2y} asOf=${snap.yields.asOf}`);
} else {
  console.log("  yields: absent or null (ok if Treasury fetch failed)");
}
console.log("  research pack: technicals/regime/model/lead-lag smoke=ok");
