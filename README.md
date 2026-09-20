# FX Analysis · INR real-strength

Cloudflare Worker + **path-routed research desk** for INR real-strength, currency compare, and slip-vs-USD (“Everywhere?”).

**Domain:** https://fx-analysis.tanishqnalloju.com  
**Worker:** `fx-analysis` · `workers_dev: false` · custom domain via Workers Domains API (no zone routes) · leave `inr-dash` untouched

## Paths

| Path | Purpose |
|------|---------|
| `/` | Short story + today’s verdict |
| `/desk` | Full board (KPIs, slip flags, rupee vs majors, gold/oil INR, yields, shock day) |
| `/compare` · `/compare/USD` | Compare tool (defaults to **USD**) |
| `/slip` | Everywhere? · Slip vs USD |
| `/how` | Methodology, sources, assumptions, validation card |
| `/notes/YYYY-MM-DD` | Snapshot-generated daily takeaway (no invented backfill) |
| `/api/health` · `/api/snapshot` · `/api/history` · `/api/compare` | JSON API |

Worker serves the SPA shell for the HTML paths (unique title / meta / OG / canonical per view). `sitemap.xml` + `robots.txt` included.

## Hard rules

- Snapshot-only — nothing invented client-side
- Prefer ECB/Frankfurter; higher XXXINR = weaker INR
- No fake REER/NEER/gold/oil history — **REER panel hidden** until a sourced feed exists
- Public UI avoids insider tokens (KV cron labels, `notOnEcb`, `changePct`, KEEP/WEAK/KILL) — those live on `/how` where needed

## Data

- KV `fx-analysis-data` binding `DATA` — keys `snapshot`, `history`, `meta`
- Cron `30 3 * * *` UTC
- Gold/oil USD prints carried from prior KV (never invented); BTC via Coinbase when fetch succeeds

## Scripts

```bash
export PATH="/home/box/.local/node/bin:$PATH"
cd /workspace/inr-real
npm install
npm run validate
npm run build
npm run deploy
```

Daily-note emitter: `public/js/takeaway.js` (`buildDailyTakeaway`) — also used by Desk and `/notes/…`.

## Deploy notes

Deploy with `routes: []`. Attach hostname via Workers Domains API:

`PUT /accounts/{id}/workers/domains/{domainId}` → `fx-analysis.tanishqnalloju.com` → service `fx-analysis`.

Domain id (current): `8f191372d591fead537e37d6912a6df3eea38486`.
