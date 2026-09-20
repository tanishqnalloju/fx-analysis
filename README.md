# FX Analysis · INR real-strength

Cloudflare Worker + **single-page tabbed desk** for INR real-strength, currency compare, and slip/rank — full **Frankfurter/ECB** FX universe + daily history.

**Domain:** https://fx-analysis.tanishqnalloju.com  
**Worker:** `fx-analysis` · `workers_dev: false` · custom domain only

## Tabs (one `index.html`)

| Tab | Hash | Purpose |
|-----|------|---------|
| **Desk** | `#desk` | FX basket + hard assets + real-strength legs |
| **Compare** | `#compare` / `#compare/USD` | Searchable picker (all FX codes) + KPIs + ranking + history sparks vs basket legs |
| **Slip / Rank** | `#slip` | Full-matrix heatmap + sparks vs USD/gold + rank ladders |

Deep-links are **hash-only** — no `/compare/{code}` HTML routes as primary UX.

## Data source (KV + cron)

- **KV namespace** `fx-analysis-data` binding `DATA` — keys `snapshot`, `history`, `meta`
- **Cron** `30 3 * * *` UTC (≈ 09:00 IST) — Worker refreshes Frankfurter/FloatRates/BTC into KV
- Gold/oil USD prints are **carried from prior KV** (never invented); BTC via Coinbase
- `/api/*` reads **KV first**, falls back to baked `public/data/*.json`; first request seeds KV if empty
- Optional: `npm run seed-kv` uploads current baked files once via CF API
- Manual refresh: `GET /api/refresh?key=` (or `X-Refresh-Key`) matching wrangler secret `REFRESH_KEY`

## API

| Route | Purpose |
|-------|---------|
| `GET /api/health` | Liveness + `asOf` + `lastRefresh` + dataSource |
| `GET /api/snapshot` | KV/baked snapshot + optional Frankfurter live FX overlay |
| `GET /api/history` | KV/baked multi-day Frankfurter series |
| `GET /api/compare?code=USD` | Comparison JSON (+ live overlay). **404** if unknown |
| `GET /api/meta` | KV meta (`lastRefresh`, counts) |
| `GET /api/refresh?key=` | Protected one-shot refresh → KV (secret required) |

`run_worker_first`: `/api/*` only (SPA tabs are client-side).

## Scripts

```bash
export PATH="/home/box/.local/node/bin:$PATH"
cd /workspace/inr-real
npm install
npm run refresh    # local: pull Frankfurter FX + ~40d history → public/data
npm run seed-kv    # upload public/data snapshot+history into KV once
npm run validate   # snapshot + history schema + compare/slip helpers
npm run build      # critical files + wrangler domain checks
npm run check      # validate then build
npm run deploy     # wrangler deploy (cron + KV binding)
```

Do **not** invent prices. Daily rates are written by the Worker cron into KV; bot redeploy is optional.

## Layout

- `public/index.html` — tabbed shell
- `public/js/app.js` — entry + hash routing
- `public/js/desk.js` / `compare.js` / `slip.js` — tab modules
- `public/js/compare-lib.js` — pure cross-rate + slip matrix helpers
- `public/js/charts.js` — TradingView Lightweight Charts sparks (vendored ESM)
- `public/vendor/lightweight-charts.mjs` — standalone LWC production bundle
- `public/js/util.js` — format / fetch helpers
- `public/css/desk.css` — Terminal Amber dark + light quant (`prefers-color-scheme`)
- `public/data/snapshot.json` — baked session data (all FX)
- `public/data/history.json` — multi-day INR-cross series
- `scripts/refresh.mjs` — data refresh pipeline
- `src/worker.js` — scheduled cron + KV; `/api/snapshot|history|health|compare|meta|refresh`
- `scripts/seed-kv.mjs` — one-shot KV upload of baked JSON
- `scriptures/README.md` — methodology

## Notes

- Prefer Frankfurter/ECB; FloatRates extras only for codes **not** on ECB when fetch succeeds.
- Hard-asset history is never invented — charts say **level only / no history yet**.
- Copper/wheat/natgas/crypto-index noted only if absent.

## Deploy notes

Account API token may lack **zone Workers Routes** permission (`Authentication error [code: 10000]` on `/zones/.../workers/routes`). Workaround:

1. Deploy with `routes` temporarily omitted from `wrangler.jsonc` (keeps KV + cron), **or** set cron via `PUT /accounts/{id}/workers/scripts/fx-analysis/schedules` with body `[{"cron":"30 3 * * *"}]`.
2. Re-attach custom domain: `PUT /accounts/{id}/workers/domains/{domainId}` with hostname `fx-analysis.tanishqnalloju.com` → service `fx-analysis`.

Domain id (current): `8f191372d591fead537e37d6912a6df3eea38486`. Keep `routes` + `custom_domain` in committed config.

## Research pack (v1.4)

Desk tab: US Treasury yield strip (2y / 10y / curve) + regime dashboard (realized vol, shock flag, FX breadth).
Compare tab: multi-horizon technical strip (SMA/RSI/MACD), model card (KEEP/WEAK/KILL), lead-lag heatmap.
Sources: Frankfurter/ECB history + Treasury daily yield CSV. Hard-asset daily history and REER/NEER are **not** invented when absent.
Language: aligned / counter / elevated / depressed / shock — no buy/sell trade calls.

