#!/usr/bin/env node
/**
 * Assert critical project files exist (path-routed SPA).
 */
import { existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const required = [
  "public/index.html",
  "public/js/app.js",
  "public/js/desk.js",
  "public/js/home.js",
  "public/js/how.js",
  "public/js/takeaway.js",
  "public/js/compare.js",
  "public/js/slip.js",
  "public/js/compare-lib.js",
  "public/js/charts.js",
  "public/vendor/lightweight-charts.mjs",
  "public/js/util.js",
  "public/js/research.js",
  "public/css/desk.css",
  "public/sitemap.xml",
  "public/robots.txt",
  "src/yields.js",
  "public/data/snapshot.json",
  "public/data/history.json",
  "public/data/events.json",
  "scripts/refresh.mjs",
  "scripts/seed-kv.mjs",
  "src/worker.js",
  "wrangler.jsonc",
];

const vendorDir = join(root, "public/vendor");
const vendorDest = join(vendorDir, "lightweight-charts.mjs");
const vendorSrc = join(
  root,
  "node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs"
);
if (existsSync(vendorSrc)) {
  mkdirSync(vendorDir, { recursive: true });
  copyFileSync(vendorSrc, vendorDest);
} else if (!existsSync(vendorDest)) {
  console.error("build FAIL: lightweight-charts not installed and public/vendor/lightweight-charts.mjs missing");
  console.error("  run: npm install");
  process.exit(1);
}

const missing = required.filter((rel) => !existsSync(join(root, rel)));
if (missing.length) {
  console.error("build FAIL: missing files:");
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}

if (existsSync(join(root, "public/compare.html"))) {
  console.error("build FAIL: public/compare.html must not exist (SPA is path-routed via Worker)");
  process.exit(1);
}

const wrangler = readFileSync(join(root, "wrangler.jsonc"), "utf8");
if (!wrangler.includes("fx-analysis.tanishqnalloju.com")) {
  console.error("build FAIL: wrangler.jsonc must mention fx-analysis.tanishqnalloju.com");
  process.exit(1);
}
if (!/"workers_dev"\s*:\s*false/.test(wrangler)) {
  console.error("build FAIL: workers_dev must be false");
  process.exit(1);
}
if (wrangler.includes("inr-dash.tanishqnalloju.com")) {
  console.error("build FAIL: remove inr-dash primary route");
  process.exit(1);
}
if (!wrangler.includes('"/desk"') || !wrangler.includes('"/how"') || !wrangler.includes('"/slip"')) {
  console.error("build FAIL: run_worker_first must include SPA paths /, /desk, /compare, /slip, /how");
  process.exit(1);
}
if (!/"routes"\s*:\s*\[\s*\]/.test(wrangler)) {
  console.error("build FAIL: routes must be [] (custom domain via Workers Domains API)");
  process.exit(1);
}

const indexHtml = readFileSync(join(root, "public/index.html"), "utf8");
if (!indexHtml.includes("data-view") || !indexHtml.includes("FX Analysis")) {
  console.error("build FAIL: index.html must be path-routed FX Analysis shell");
  process.exit(1);
}
if (!indexHtml.includes("panel-home") || !indexHtml.includes("panel-how") || !indexHtml.includes("panel-notes")) {
  console.error("build FAIL: index.html missing home/how/notes panels");
  process.exit(1);
}
if (!indexHtml.includes("compareSelect") || !indexHtml.includes("compareFilter") || !indexHtml.includes("cmpSparkGrid")) {
  console.error("build FAIL: index.html missing compare dropdown / spark grid");
  process.exit(1);
}
if (!indexHtml.includes("asOfStrip") || !indexHtml.includes("howIntegrity")) {
  console.error("build FAIL: index.html missing as-of strip / how integrity");
  process.exit(1);
}
if (indexHtml.includes("reerPanel") || indexHtml.includes("id=\"reer")) {
  console.error("build FAIL: REER panel must stay hidden until sourced feed exists");
  process.exit(1);
}
if (indexHtml.includes("KV CRON") || indexHtml.includes("KV cron") || indexHtml.includes("asOfCron")) {
  console.error("build FAIL: public UI must not expose KV CRON labels");
  process.exit(1);
}
if (indexHtml.includes("cmpModelTable")) {
  console.error("build FAIL: KEEP/WEAK/KILL model card must not be on public Compare (move to /how)");
  process.exit(1);
}
if (!indexHtml.includes("howModelTable")) {
  console.error("build FAIL: /how must host validation model card");
  process.exit(1);
}
if (!indexHtml.includes("cmpCorrTable") || !indexHtml.includes("slipCorrTable")) {
  console.error("build FAIL: index.html missing correlation panels");
  process.exit(1);
}
if (!indexHtml.includes("slipSparkGrid")) {
  console.error("build FAIL: index.html missing slip spark grid");
  process.exit(1);
}
if (!indexHtml.includes("yieldStrip") || !indexHtml.includes("regimeCards")) {
  console.error("build FAIL: index.html missing yield strip / regime dashboard");
  process.exit(1);
}
if (!indexHtml.includes("Is the rupee weak only against the dollar?")) {
  console.error("build FAIL: homepage hero pattern missing");
  process.exit(1);
}
if (!indexHtml.includes("Everywhere?")) {
  console.error("build FAIL: Slip UI must be renamed Everywhere?");
  process.exit(1);
}

const chartsJs = readFileSync(join(root, "public/js/charts.js"), "utf8");
if (!chartsJs.includes("lightweight-charts") && !chartsJs.includes("createChart")) {
  console.error("build FAIL: charts.js must use TradingView Lightweight Charts");
  process.exit(1);
}
if (!chartsJs.includes("sharedIndexBand") || !chartsJs.includes("autoscaleInfoProvider")) {
  console.error("build FAIL: charts.js must keep sharedIndexBand + LWC fixed-scale autoscaleInfoProvider");
  process.exit(1);
}
if (!indexHtml.includes("cmpTechSpark") || !indexHtml.includes("lwc-spark")) {
  console.error("build FAIL: index.html must host LWC sparks (cmpTechSpark / lwc-spark)");
  process.exit(1);
}
if (!indexHtml.includes("cmpTechStrip") || !indexHtml.includes("cmpLeadTable")) {
  console.error("build FAIL: index.html missing compare technical/lead-lag panels");
  process.exit(1);
}

const worker = readFileSync(join(root, "src/worker.js"), "utf8");
if (!worker.includes("/api/history")) {
  console.error("build FAIL: worker must serve /api/history");
  process.exit(1);
}
if (!worker.includes("latest?from=USD")) {
  console.error("build FAIL: live overlay must fetch all Frankfurter USD rates");
  process.exit(1);
}
if (!worker.includes("scheduled") || !worker.includes("refreshAndStore")) {
  console.error("build FAIL: worker must export scheduled cron + refreshAndStore");
  process.exit(1);
}
if (!worker.includes("spaViewFromPath") || !worker.includes("serveSpa")) {
  console.error("build FAIL: worker must serve SPA paths");
  process.exit(1);
}
if (!worker.includes("/notes/")) {
  console.error("build FAIL: worker must serve /notes/YYYY-MM-DD");
  process.exit(1);
}
if (!worker.includes("fetchTreasuryYields") && !worker.includes("treasury")) {
  console.error("build FAIL: worker scheduled refresh must fetch Treasury yields");
  process.exit(1);
}
if (!worker.includes("yields")) {
  console.error("build FAIL: worker snapshot must include yields");
  process.exit(1);
}
if (!/"binding"\s*:\s*"DATA"/.test(wrangler) || !wrangler.includes("05be48d5b28d447d950d2b614e749df6")) {
  console.error("build FAIL: wrangler.jsonc must bind DATA KV namespace");
  process.exit(1);
}
if (!wrangler.includes("30 3 * * *")) {
  console.error("build FAIL: wrangler.jsonc triggers.crons must include 30 3 * * *");
  process.exit(1);
}

const appJs = readFileSync(join(root, "public/js/app.js"), "utf8");
if (!appJs.includes("parseRoute") || !appJs.includes("setPath")) {
  console.error("build FAIL: app.js must use path routing (parseRoute/setPath)");
  process.exit(1);
}

const takeaway = readFileSync(join(root, "public/js/takeaway.js"), "utf8");
if (!takeaway.includes("INR takeaway ·") || !takeaway.includes("buildDailyTakeaway")) {
  console.error("build FAIL: takeaway.js must emit exact daily template");
  process.exit(1);
}

const snap = JSON.parse(readFileSync(join(root, "public/data/snapshot.json"), "utf8"));
if (!Array.isArray(snap.fx) || snap.fx.length < 20) {
  console.error(`build FAIL: snapshot.fx too small (${snap.fx?.length}) — run npm run refresh`);
  process.exit(1);
}

const hist = JSON.parse(readFileSync(join(root, "public/data/history.json"), "utf8"));
if (!hist.series?.USDINR || hist.series.USDINR.length < 5) {
  console.error("build FAIL: history.json missing multi-day USDINR — run npm run refresh");
  process.exit(1);
}

console.log("build ok");
for (const rel of required) console.log(`  ✓ ${rel}`);
console.log(`  ✓ snapshot.fx=${snap.fx.length} history.days≈${hist.dayCount || hist.series.USDINR.length}`);
console.log("  ✓ path SPA · wrangler → fx-analysis.tanishqnalloju.com · REER hidden");
console.log("  ✓ KV DATA + cron 30 3 * * * UTC");
