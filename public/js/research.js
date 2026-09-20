/**
 * Desk research pack — technicals, regime, model card, lead-lag.
 * Language: aligned / counter / elevated / depressed / shock / KEEP / WEAK / KILL.
 * Forbidden trade calls excluded; use aligned / counter / elevated / depressed / shock / KEEP / WEAK / KILL.
 */
import { DESK_FX_BASKET_IDS } from "./compare-lib.js";


/** Extract ascending {t,v}[] values. */
export function seriesValues(series) {
  if (!Array.isArray(series)) return [];
  return series
    .filter((p) => p && typeof p.v === "number" && Number.isFinite(p.v))
    .slice()
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder RSI(period). */
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] =
    avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] =
      avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** MACD(12,26,9) → { macd, signal, hist } arrays (null-padded). */
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = emaSeries(values, fast);
  const emaSlow = emaSeries(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const macdVals = macdLine.map((v) => (v == null ? 0 : v));
  // Build signal only on defined macd segment
  const firstIdx = macdLine.findIndex((v) => v != null);
  const signalArr = new Array(values.length).fill(null);
  const histArr = new Array(values.length).fill(null);
  if (firstIdx < 0) return { macd: macdLine, signal: signalArr, hist: histArr };

  const segment = [];
  const segIdx = [];
  for (let i = firstIdx; i < macdLine.length; i++) {
    if (macdLine[i] == null) continue;
    segment.push(macdLine[i]);
    segIdx.push(i);
  }
  const sigSeg = emaSeries(segment, signal);
  for (let j = 0; j < segIdx.length; j++) {
    const i = segIdx[j];
    signalArr[i] = sigSeg[j];
    if (sigSeg[j] != null) histArr[i] = macdLine[i] - sigSeg[j];
  }
  return { macd: macdLine, signal: signalArr, hist: histArr };
}

function slopeSign(arr, lookback = 3) {
  const last = arr[arr.length - 1];
  if (last == null) return null;
  const i0 = Math.max(0, arr.length - 1 - lookback);
  let prev = null;
  for (let i = i0; i < arr.length - 1; i++) {
    if (arr[i] != null) prev = arr[i];
  }
  if (prev == null) return null;
  if (last > prev) return "rising";
  if (last < prev) return "falling";
  return "flat";
}

/**
 * Multi-horizon technical strip for a price series.
 * @param {{t:string,v:number}[]} series
 * @param {string} label
 */
export function buildTechnicals(series, label = "series") {
  const pts = seriesValues(series);
  const values = pts.map((p) => p.v);
  const n = values.length;
  const sma5 = sma(values, 5);
  const sma10 = sma(values, 10);
  const sma20 = sma(values, 20);
  const sma50 = sma(values, 50);
  const rsi14 = rsi(values, 14);
  const macdObj = macd(values, 12, 26, 9);

  const last = n ? values[n - 1] : null;
  const lastSma20 = sma20[n - 1];
  const lastSma50 = sma50[n - 1];
  const lastRsi = rsi14[n - 1];
  const lastHist = macdObj.hist[n - 1];
  const ma20Slope = slopeSign(sma20, 3);
  const ma50Slope = slopeSign(sma50, 3);

  const regimeTags = [];
  if (last != null && lastSma20 != null) {
    const side = last >= lastSma20 ? "above" : "below";
    const slope = ma20Slope ? ` (${ma20Slope})` : "";
    regimeTags.push(`${side} MA20${slope}`);
  }
  if (last != null && lastSma50 != null) {
    const side = last >= lastSma50 ? "above" : "below";
    const slope = ma50Slope ? ` (${ma50Slope})` : "";
    regimeTags.push(`${side} MA50${slope}`);
  }
  if (lastRsi != null) {
    if (lastRsi >= 70) regimeTags.push(`RSI ${lastRsi.toFixed(1)} (elevated)`);
    else if (lastRsi <= 30) regimeTags.push(`RSI ${lastRsi.toFixed(1)} (depressed)`);
    else regimeTags.push(`RSI ${lastRsi.toFixed(1)}`);
  }
  if (lastHist != null) {
    regimeTags.push(
      lastHist >= 0 ? "MACD hist ≥ 0" : "MACD hist < 0"
    );
  }

  // Desk summary: count indicators aligned with short trend (price vs MA20)
  const trendUp = last != null && lastSma20 != null ? last >= lastSma20 : null;
  let aligned = 0;
  let counter = 0;
  let scored = 0;
  const pushAlign = (cond) => {
    if (cond == null || trendUp == null) return;
    scored += 1;
    if (cond === trendUp) aligned += 1;
    else counter += 1;
  };
  if (last != null && lastSma20 != null) pushAlign(last >= lastSma20);
  if (last != null && lastSma50 != null) pushAlign(last >= lastSma50);
  if (ma20Slope === "rising" || ma20Slope === "falling") {
    pushAlign(ma20Slope === "rising");
  }
  if (lastHist != null) pushAlign(lastHist >= 0);
  if (lastRsi != null) {
    // mid RSI is neutral — only count extremes as counter/aligned loosely
    if (lastRsi >= 55) pushAlign(true);
    else if (lastRsi <= 45) pushAlign(false);
  }

  const summary =
    scored === 0
      ? "desk technical (daily): insufficient history"
      : `desk technical (daily): ${aligned}/${scored} aligned with trend · ${counter} counter` +
        (trendUp == null
          ? ""
          : trendUp
            ? " · trend reference: above MA20"
            : " · trend reference: below MA20");

  return {
    label,
    n,
    asOf: pts[n - 1]?.t || null,
    last,
    sma: {
      5: lastFinite(sma5),
      10: lastFinite(sma10),
      20: lastFinite(sma20),
      50: lastFinite(sma50),
    },
    smaSeries: { sma20, sma50, values, dates: pts.map((p) => p.t) },
    rsi14: lastRsi != null ? Number(lastRsi.toFixed(2)) : null,
    macdHist: lastHist != null ? Number(lastHist.toFixed(6)) : null,
    regimeTags,
    ma20Slope,
    ma50Slope,
    summary,
    aligned,
    counter,
    scored,
  };
}

function lastFinite(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null && Number.isFinite(arr[i])) return Number(arr[i].toFixed(6));
  }
  return null;
}

/** Log returns for vol. */
function logReturns(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > 0 && values[i - 1] > 0) {
      out.push(Math.log(values[i] / values[i - 1]));
    }
  }
  return out;
}

function realizedVol(logRets, window) {
  if (logRets.length < window) return null;
  const slice = logRets.slice(-window);
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  let ss = 0;
  for (const r of slice) ss += (r - mean) ** 2;
  const daily = Math.sqrt(ss / Math.max(1, slice.length - 1));
  // annualize ~252
  return Number((daily * Math.sqrt(252) * 100).toFixed(2));
}

function stdev(arr) {
  if (arr.length < 2) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  let ss = 0;
  for (const x of arr) ss += (x - mean) ** 2;
  return Math.sqrt(ss / (arr.length - 1));
}

/** Desk regime breadth peers = DESK_FX_BASKET (RBI ETCD + top majors), not full FX dump. */
const KEY_FX_PEERS = DESK_FX_BASKET_IDS;

/**
 * Regime dashboard from snapshot + history (no extra fetch).
 */
export function buildRegime(snap, history) {
  const usdPts = seriesValues(history?.series?.USDINR);
  const usdVals = usdPts.map((p) => p.v);
  const usdLog = logReturns(usdVals);

  const cards = [];
  const table = [];

  const vol7 = realizedVol(usdLog, 7);
  const vol30 = realizedVol(usdLog, Math.min(30, usdLog.length));
  cards.push({
    id: "usdinr-vol",
    title: "USDINR realized vol",
    primary: vol7 != null ? `${vol7}%` : "—",
    secondary:
      vol30 != null
        ? `7d ${vol7 ?? "—"}% · 30d ${vol30}% ann.`
        : "insufficient history",
  });

  // Shock: |1d Δ| > 2σ of trailing 20d simple returns
  let shock = false;
  let shockDetail = "—";
  if (usdVals.length >= 22) {
    const rets = [];
    for (let i = 1; i < usdVals.length; i++) {
      rets.push((usdVals[i] - usdVals[i - 1]) / usdVals[i - 1]);
    }
    const trail = rets.slice(-21, -1); // prior 20 excluding today
    const lastRet = rets[rets.length - 1];
    const s = stdev(trail);
    if (s != null && s > 0) {
      shock = Math.abs(lastRet) > 2 * s;
      shockDetail = `|1d| ${(Math.abs(lastRet) * 100).toFixed(2)}% vs 2σ ${(2 * s * 100).toFixed(2)}%`;
    }
  }
  cards.push({
    id: "shock",
    title: "USDINR shock flag",
    primary: shock ? "Shock" : "Calm",
    secondary: shockDetail,
    flag: shock,
  });

  // Breadth: % of KEY FX peers whose session Δ% has same sign as USDINR
  const usdRow = (snap.fx || []).find((r) => r.pair === "USDINR");
  const usdChg = usdRow?.changePct;
  let sameSign = 0;
  let peerN = 0;
  const peerRows = [];
  for (const code of KEY_FX_PEERS) {
    if (code === "USD") continue;
    const row = (snap.fx || []).find((r) => r.pair === `${code}INR`);
    const chg = row?.changePct;
    if (typeof chg !== "number" || typeof usdChg !== "number") {
      peerRows.push({ code, changePct: chg ?? null, aligned: null });
      continue;
    }
    peerN += 1;
    const aligned =
      chg === 0 || usdChg === 0
        ? null
        : Math.sign(chg) === Math.sign(usdChg);
    if (aligned) sameSign += 1;
    peerRows.push({ code, changePct: chg, aligned });
  }
  const breadthPct =
    peerN > 0 ? Number(((sameSign / peerN) * 100).toFixed(0)) : null;
  const breadthLabel =
    breadthPct == null
      ? "—"
      : breadthPct >= 60
        ? "usd-aligned"
        : breadthPct <= 40
          ? "diverging"
          : "mixed";
  cards.push({
    id: "breadth",
    title: "FX breadth vs USDINR",
    primary: breadthPct != null ? `${breadthPct}%` : "—",
    secondary:
      breadthPct != null
        ? `${sameSign}/${peerN} same-sign · ${breadthLabel}`
        : "session Δ% unavailable",
  });

  table.push({
    series: "USDINR",
    vol7d: vol7,
    vol30d: vol30,
    shock: shock ? "Shock" : "Calm",
    note: shockDetail,
  });

  return {
    cards,
    table,
    peerRows,
    breadthPct,
    breadthLabel,
    shock,
    method:
      "Regime from desk series only. Realized vol = σ of log returns × √252. Shock when |1d simple return| > 2σ of trailing 20d. Breadth = % of desk FX basket peers (RBI ETCD USD/EUR/GBP/JPY + CNY/AED/SGD/CHF/AUD/CAD) session Δ% with same sign as USDINR (usd-aligned vs diverging).",
  };
}

/**
 * Realized vol card for selected vs USD when history exists.
 */
export function buildSelectedRegime(history, codeRaw) {
  const code = String(codeRaw || "").toUpperCase();
  if (!code || code === "USD") {
    return { code, vol7: null, vol30: null, note: "vs-USD N/A for USD" };
  }
  const a = history?.series?.[`${code}INR`];
  const usd = history?.series?.USDINR;
  if (!a?.length || !usd?.length) {
    return { code, vol7: null, vol30: null, note: "history thin" };
  }
  const mapU = new Map(usd.map((p) => [p.t, p.v]));
  const cross = [];
  for (const p of a) {
    const u = mapU.get(p.t);
    if (p.v > 0 && u > 0) cross.push(p.v / u);
  }
  const lr = logReturns(cross);
  return {
    code,
    vol7: realizedVol(lr, 7),
    vol30: realizedVol(lr, Math.min(30, lr.length)),
    note: `${code} vs USD cross · ann. vol`,
  };
}

/**
 * Forward-test candidate rules — KEEP / WEAK / KILL (not trade signals).
 */
export function buildModelCard(series, label = "USDINR") {
  const pts = seriesValues(series);
  const values = pts.map((p) => p.v);
  const n = values.length;
  const sma20 = sma(values, 20);
  const rsi14 = rsi(values, 14);
  const horizon = 5;

  const rules = [];

  const evalRule = (name, predicate) => {
    let hits = 0;
    let sumFwd = 0;
    let count = 0;
    for (let i = 0; i < n - horizon; i++) {
      if (!predicate(i)) continue;
      const a = values[i];
      const b = values[i + horizon];
      if (!(a > 0) || !(b > 0)) continue;
      const fwd = ((b - a) / a) * 100;
      count += 1;
      sumFwd += fwd;
      // "hit" = forward move continues in the direction implied by the observation
      // For close>SMA20 we observe whether next-5d is positive (continuation)
      if (name.startsWith("close > SMA20") && fwd > 0) hits += 1;
      else if (name.startsWith("close < SMA20") && fwd < 0) hits += 1;
      else if (name.includes("RSI") && name.includes("> 70") && fwd < 0) hits += 1;
      else if (name.includes("RSI") && name.includes("< 30") && fwd > 0) hits += 1;
      else if (name.includes("MA20 slope +") && fwd > 0) hits += 1;
      else if (name.includes("MA20 slope −") && fwd < 0) hits += 1;
      else if (
        !name.startsWith("close") &&
        !name.includes("RSI") &&
        !name.includes("MA20 slope")
      ) {
        /* generic: positive fwd */
        if (fwd > 0) hits += 1;
      }
    }
    const hitRate = count ? hits / count : null;
    const meanFwd = count ? sumFwd / count : null;
    let verdict = "KILL";
    if (count < 6) verdict = "KILL";
    else if (hitRate != null && hitRate >= 0.58) verdict = "KEEP";
    else if (hitRate != null && hitRate >= 0.52) verdict = "WEAK";
    else verdict = "KILL";
    // worse than naive (~50%) → KILL already; small-n → KILL
    return {
      rule: name,
      n: count,
      hitRate: hitRate != null ? Number((hitRate * 100).toFixed(1)) : null,
      meanNext5d: meanFwd != null ? Number(meanFwd.toFixed(3)) : null,
      verdict,
    };
  };

  rules.push(
    evalRule("close > SMA20 ⇒ next 5d change", (i) => {
      return sma20[i] != null && values[i] > sma20[i];
    })
  );
  rules.push(
    evalRule("close < SMA20 ⇒ next 5d change", (i) => {
      return sma20[i] != null && values[i] < sma20[i];
    })
  );
  rules.push(
    evalRule("RSI(14) > 70 (elevated) ⇒ next 5d", (i) => {
      return rsi14[i] != null && rsi14[i] > 70;
    })
  );
  rules.push(
    evalRule("RSI(14) < 30 (depressed) ⇒ next 5d", (i) => {
      return rsi14[i] != null && rsi14[i] < 30;
    })
  );
  rules.push(
    evalRule("MA20 slope + ⇒ next 5d", (i) => {
      if (i < 3 || sma20[i] == null || sma20[i - 3] == null) return false;
      return sma20[i] > sma20[i - 3];
    })
  );
  rules.push(
    evalRule("MA20 slope − ⇒ next 5d", (i) => {
      if (i < 3 || sma20[i] == null || sma20[i - 3] == null) return false;
      return sma20[i] < sma20[i - 3];
    })
  );

  return {
    label,
    n,
    horizon,
    rules,
    footnote:
      "kx-style validation on daily history only. Hit rate = share of triggers where next-5d move matches the observation’s implied direction. KEEP if n≥6 and hit≥58%; WEAK if ≥52%; else KILL (incl. small-n or ~50%/worse). Not a trade signal — desk research only.",
  };
}

/**
 * Lead-lag corr(USDINR_t, other_t+k) for k in -5..+5.
 */
export function buildLeadLag(history, opts = {}) {
  const usd = seriesValues(history?.series?.USDINR);
  if (usd.length < 10) {
    return {
      rows: [],
      note: "USDINR history too short for lead-lag",
      hardAssetNote: "hard-asset daily history not yet stored",
    };
  }

  const hardKeys = ["XAU", "BRENT", "WTI", "BTC", "COPPER", "WHEAT", "NATGAS", "CRYPTO_INDEX"];
  const hasHard = hardKeys.some(
    (k) =>
      Array.isArray(history?.hardAssets?.[k]) &&
      history.hardAssets[k].length >= 5
  );
  const hardAssetNote = hasHard
    ? null
    : "hard-asset daily history not yet stored";

  const peers = opts.peers || ["EUR", "GBP", "JPY", "CNY"];
  const targets = [];

  for (const code of peers) {
    const s = seriesValues(history?.series?.[`${code}INR`]);
    if (s.length >= 10) targets.push({ id: code, label: `${code}INR`, series: s });
  }
  if (hasHard) {
    for (const k of hardKeys) {
      const s = seriesValues(history.hardAssets[k]);
      if (s.length >= 5) targets.push({ id: k, label: k, series: s });
    }
  }

  const usdRet = dailyRetMap(usd);
  const lags = [];
  for (let k = -5; k <= 5; k++) lags.push(k);

  // Date-label columns from USDINR session calendar near end of window.
  // Anchor so −5…+5 all map to real dates when history is long enough.
  const usdDates = usd.map((p) => p.t).filter(Boolean).sort();
  const baseIdx = Math.max(0, usdDates.length - 1 - 5);
  const lagHeaders = lags.map((k) => {
    const i = baseIdx + k;
    const date = i >= 0 && i < usdDates.length ? usdDates[i] : null;
    let label;
    if (k === 0) {
      label = date ? `0 · ${date}` : "0 · same day";
    } else if (k < 0) {
      label = date ? `lead ${-k}d · ${date}` : `t${k}`;
    } else {
      label = date ? `lag ${k}d · ${date}` : `t+${k}`;
    }
    return { lag: k, date, label };
  });

  const rows = [];
  for (const tgt of targets) {
    const otherRet = dailyRetMap(tgt.series);
    const cells = {};
    let best = { lag: 0, corr: null };
    for (const k of lags) {
      const { xs, ys } = alignLagged(usdRet, otherRet, k);
      const c = pearson(xs, ys, 8);
      cells[k] = c;
      if (c != null && (best.corr == null || Math.abs(c) > Math.abs(best.corr))) {
        best = { lag: k, corr: c };
      }
    }
    let role = "coincident";
    if (best.corr != null) {
      if (best.lag < 0) role = "lead"; // other leads USDINR (other at t+k with k<0 ⇒ other earlier)
      else if (best.lag > 0) role = "lag";
    }
    rows.push({
      id: tgt.id,
      label: tgt.label,
      cells,
      bestLag: best.lag,
      bestCorr: best.corr,
      role,
    });
  }

  const winFrom = usdDates[0] || null;
  const winTo = usdDates[usdDates.length - 1] || null;

  return {
    lags,
    lagHeaders,
    windowFrom: winFrom,
    windowTo: winTo,
    rows,
    note:
      "Columns are day lags of the other series vs selected: −5 = other leads by 5 sessions, 0 = same day, +5 = other lags by 5. Headers show illustrative USDINR session dates from the history window.",
    hardAssetNote,
    method:
      "Lead-lag from stored history only. corr(USDINR_t, other_t+k) on daily % returns. Negative lag ⇒ other series leads USDINR. FX peers always attempted; hard assets only when hardAssets history exists.",
  };
}

function dailyRetMap(pts) {
  const m = new Map();
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].v;
    const b = pts[i].v;
    if (a > 0 && b > 0) m.set(pts[i].t, ((b - a) / a) * 100);
  }
  return m;
}

function alignLagged(usdRet, otherRet, k) {
  // k: corr(usd_t, other_{t+k})
  const xs = [];
  const ys = [];
  const usdDates = [...usdRet.keys()].sort();
  const otherDates = [...otherRet.keys()].sort();
  const otherIdx = new Map(otherDates.map((d, i) => [d, i]));
  for (const t of usdDates) {
    const xi = otherIdx.get(t);
    if (xi == null) continue;
    const yj = xi + k;
    if (yj < 0 || yj >= otherDates.length) continue;
    const yt = otherDates[yj];
    const x = usdRet.get(t);
    const y = otherRet.get(yt);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }
  return { xs, ys };
}

function pearson(xs, ys, minN = 8) {
  const n = Math.min(xs.length, ys.length);
  if (n < minN) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (!(vx > 0) || !(vy > 0)) return null;
  return Number((cov / Math.sqrt(vx * vy)).toFixed(4));
}

/** Build technicals for selected: INR-per-1 series and vs-USD cross when possible. */
export function buildCompareTechnicals(history, codeRaw) {
  const code = String(codeRaw || "").toUpperCase();
  const out = { code, primary: null, vsUsd: null };
  if (!history?.series) return out;

  if (code === "INR") {
    // INR per 1 USD inverted sense — use USDINR as the desk series
    out.primary = buildTechnicals(history.series.USDINR, "USDINR (INR soft when up)");
    return out;
  }

  const key = `${code}INR`;
  if (history.series[key]) {
    out.primary = buildTechnicals(history.series[key], key);
  }

  if (code !== "USD" && history.series.USDINR && history.series[key]) {
    const a = seriesValues(history.series[key]);
    const usd = seriesValues(history.series.USDINR);
    const mapU = new Map(usd.map((p) => [p.t, p.v]));
    const cross = [];
    for (const p of a) {
      const u = mapU.get(p.t);
      if (p.v > 0 && u > 0) cross.push({ t: p.t, v: p.v / u });
    }
    if (cross.length >= 5) {
      out.vsUsd = buildTechnicals(cross, `${code} per 1 USD`);
    }
  } else if (code === "USD") {
    out.vsUsd = null;
  }

  return out;
}
