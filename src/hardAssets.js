/**
 * Sourced hard-asset prints for FX Analysis.
 * Yahoo futures (HG=F / ZW=F / NG=F) + Coinbase BTC+ETH spot proxy.
 * Never invents prices — callers must omit on fetch failure.
 */

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const COINBASE_BTC = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const COINBASE_ETH = "https://api.coinbase.com/v2/prices/ETH-USD/spot";

const YAHOO_SPECS = [
  {
    id: "COPPER",
    symbol: "HG=F",
    name: "Copper (COMEX)",
    unit: "USD/lb",
    /** Yahoo HG=F is already USD/lb */
    toUsd: (px) => px,
  },
  {
    id: "WHEAT",
    symbol: "ZW=F",
    name: "Wheat (CBOT SRW)",
    unit: "USD/bu",
    /** Yahoo ZW=F quotes USc/bu (USX) — convert to USD/bu */
    toUsd: (px, meta) => {
      const ccy = String(meta?.currency || "").toUpperCase();
      if (ccy === "USX" || px > 50) return px / 100;
      return px;
    },
  },
  {
    id: "NATGAS",
    symbol: "NG=F",
    name: "Natural gas (NYMEX)",
    unit: "USD/MMBtu",
    toUsd: (px) => px,
  },
];

function isoFromUnix(sec) {
  if (!Number.isFinite(sec)) return null;
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function pctChange(prev, next) {
  if (!(typeof prev === "number" && prev > 0 && typeof next === "number" && next > 0)) {
    return null;
  }
  return Number((((next - prev) / prev) * 100).toFixed(4));
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, label?: string, userAgent?: string }} [opts]
 */
async function fetchJson(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const label = opts.label || url;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": opts.userAgent || "fx-analysis-worker/1.5",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Parse Yahoo chart JSON → { price, prevClose, asOfDate, history[{t,v}], source }
 */
function parseYahooChart(json, spec) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("yahoo chart missing result");
  const meta = result.meta || {};
  const rawPx = Number(meta.regularMarketPrice);
  if (!Number.isFinite(rawPx) || !(rawPx > 0)) throw new Error("yahoo price invalid");

  const usdPrice = Number(spec.toUsd(rawPx, meta).toFixed(6));

  const ts = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const history = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (!Number.isFinite(c) || !(c > 0)) continue;
    const t = isoFromUnix(ts[i]);
    if (!t) continue;
    history.push({ t, v: Number(spec.toUsd(c, meta).toFixed(6)) });
  }

  // Prefer last two session closes for Δ% — Yahoo chartPreviousClose on
  // futures can be a contract-roll artifact, not the prior session.
  let changePct = null;
  if (history.length >= 2) {
    changePct = pctChange(history[history.length - 2].v, history[history.length - 1].v);
  } else {
    const prevRaw = meta.previousClose ?? meta.chartPreviousClose ?? null;
    if (typeof prevRaw === "number" && prevRaw > 0) {
      changePct = pctChange(spec.toUsd(prevRaw, meta), usdPrice);
    }
  }

  const asOfDate =
    isoFromUnix(meta.regularMarketTime) ||
    (history.length ? history[history.length - 1].t : null);

  return {
    id: spec.id,
    name: spec.name,
    unit: spec.unit,
    usdPrice,
    changePct,
    asOfDate,
    history,
    source: `Yahoo Finance ${spec.symbol} (${spec.name})`,
    symbol: spec.symbol,
  };
}

/**
 * Fetch Yahoo futures hard assets.
 * @returns {Promise<{ assets: object[], skipped: object[], notes: string[] }>}
 */
export async function fetchYahooHardAssets(opts = {}) {
  const assets = [];
  const skipped = [];
  const notes = [];
  const range = opts.range || "3mo";
  const ua = opts.userAgent;

  for (const spec of YAHOO_SPECS) {
    const url = `${YAHOO_CHART}/${encodeURIComponent(spec.symbol)}?interval=1d&range=${range}`;
    try {
      const json = await fetchJson(url, {
        timeoutMs: opts.timeoutMs ?? 25000,
        label: `yahoo/${spec.symbol}`,
        userAgent: ua,
      });
      const parsed = parseYahooChart(json, spec);
      assets.push(parsed);
      notes.push(
        `${spec.id} ${parsed.usdPrice} ${spec.unit} via Yahoo ${spec.symbol}` +
          (parsed.changePct != null ? ` Δ% ${parsed.changePct}` : "")
      );
    } catch (e) {
      skipped.push({
        code: spec.id,
        reason: `yahoo ${spec.symbol} failed: ${e.message || e}`,
      });
      notes.push(`${spec.id}: Yahoo ${spec.symbol} omitted — ${e.message || e}`);
    }
  }
  return { assets, skipped, notes };
}

/**
 * Equal-weight BTC+ETH USD spot proxy via Coinbase (honest label — not a Bloomberg index).
 * @returns {Promise<{ asset: object|null, historyHint: null, skipped: object[], notes: string[] }>}
 */
export async function fetchCryptoIndexProxy(opts = {}) {
  const skipped = [];
  const notes = [];
  const ua = opts.userAgent;
  try {
    const [btcJson, ethJson] = await Promise.all([
      fetchJson(COINBASE_BTC, {
        timeoutMs: opts.timeoutMs ?? 15000,
        label: "coinbase/btc",
        userAgent: ua,
      }),
      fetchJson(COINBASE_ETH, {
        timeoutMs: opts.timeoutMs ?? 15000,
        label: "coinbase/eth",
        userAgent: ua,
      }),
    ]);
    const btc = Number(btcJson?.data?.amount);
    const eth = Number(ethJson?.data?.amount);
    if (!(btc > 0 && eth > 0)) {
      skipped.push({
        code: "CRYPTO_INDEX",
        reason: "coinbase BTC/ETH amount invalid",
      });
      return { asset: null, skipped, notes };
    }
    // Equal-weight index rebased so level ≈ average of the two USD spots
    // (desk proxy — not a published crypto index).
    const usdPrice = Number(((btc + eth) / 2).toFixed(4));
    notes.push(
      `CRYPTO_INDEX = equal-weight BTC+ETH Coinbase spot proxy ((${btc}+${eth})/2 = ${usdPrice})`
    );
    return {
      asset: {
        id: "CRYPTO_INDEX",
        name: "BTC+ETH spot proxy",
        unit: "USD (eq-wt)",
        usdPrice,
        changePct: null, // filled by caller vs prior when available
        btcUsd: btc,
        ethUsd: eth,
        source: "Coinbase spot BTC-USD + ETH-USD equal-weight proxy (not a published index)",
      },
      skipped,
      notes,
    };
  } catch (e) {
    skipped.push({
      code: "CRYPTO_INDEX",
      reason: `coinbase proxy failed: ${e.message || e}`,
    });
    notes.push(`CRYPTO_INDEX omitted: ${e.message || e}`);
    return { asset: null, skipped, notes };
  }
}

/**
 * Merge dated {t,v} points into a hardAssets history series (USD levels).
 */
export function mergeHardHistorySeries(existing, points, { cutoffDate } = {}) {
  const arr = Array.isArray(existing) ? [...existing] : [];
  for (const p of points || []) {
    if (!p?.t || !(typeof p.v === "number" && p.v > 0)) continue;
    const idx = arr.findIndex((x) => x.t === p.t);
    if (idx >= 0) arr[idx] = { t: p.t, v: p.v };
    else arr.push({ t: p.t, v: p.v });
  }
  arr.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (cutoffDate) return arr.filter((p) => p.t >= cutoffDate);
  return arr;
}

export { YAHOO_SPECS, COINBASE_BTC, COINBASE_ETH, pctChange };
