/**
 * TradingView Lightweight Charts helpers for relative-index sparks / MA overlays.
 * Bars & heatmaps stay on canvas elsewhere. No invented series.
 */
import {
  createChart,
  LineSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
} from "../vendor/lightweight-charts.mjs";
import { themeTokens, rgbAlpha } from "./util.js";

/** @type {WeakMap<HTMLElement, { chart: import("../vendor/lightweight-charts.mjs").IChartApi }>} */
const chartByEl = new WeakMap();

/**
 * Percentile of a finite number array (linear interpolation).
 * @param {number[]} arr
 * @param {number} p 0..1
 */
export function percentile(arr, p) {
  const a = (arr || []).filter((v) => Number.isFinite(v)).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  if (a.length === 1) return a[0];
  const t = Math.max(0, Math.min(1, p)) * (a.length - 1);
  const i = Math.floor(t);
  const f = t - i;
  if (i >= a.length - 1) return a[a.length - 1];
  return a[i] * (1 - f) + a[i + 1] * f;
}

/**
 * Resolve y-scale for spark charts.
 * scaleMode:
 *   - "minmax" (default): auto min/max of series
 *   - "fixed": use opts.yMin / opts.yMax
 *   - "robust": p5–p95 of series (fallback median±3·MAD)
 * @returns {{ min: number, max: number, span: number }}
 */
export function resolveSparkScale(pts, opts = {}) {
  const mode = opts.scaleMode || "minmax";
  let min;
  let max;
  if (mode === "fixed" && Number.isFinite(opts.yMin) && Number.isFinite(opts.yMax) && opts.yMax > opts.yMin) {
    min = opts.yMin;
    max = opts.yMax;
  } else if (mode === "robust") {
    const p5 = percentile(pts, 0.05);
    const p95 = percentile(pts, 0.95);
    if (Number.isFinite(p5) && Number.isFinite(p95) && p95 > p5) {
      min = p5;
      max = p95;
    } else {
      const med = percentile(pts, 0.5);
      const mad = percentile(
        pts.map((v) => Math.abs(v - med)),
        0.5
      );
      const half = Math.max((mad || 0) * 3, 1e-6);
      min = med - half;
      max = med + half;
    }
  } else {
    min = Math.min(...pts);
    max = Math.max(...pts);
  }
  const span = max - min || 1;
  return { min, max, span };
}

/**
 * Shared fixed y-band around 100 for a grid of relative/level index sparks.
 * Uses robust abs deviation from 100 across all plotted values.
 * half = clamp(dev * 1.15, 1.5, 5) → [100-half, 100+half]
 * @param {number[][]} seriesList
 * @returns {{ yMin: number, yMax: number, half: number, scaleMode: "fixed" }}
 */
export function sharedIndexBand(seriesList) {
  const all = [];
  for (const s of seriesList || []) {
    for (const v of s || []) if (Number.isFinite(v)) all.push(v);
  }
  let dev = 1.5;
  if (all.length) {
    const absDev = all.map((v) => Math.abs(v - 100));
    const p90 = percentile(absDev, 0.9);
    const p5 = percentile(all, 0.05);
    const p95 = percentile(all, 0.95);
    const rangeHalf = Number.isFinite(p5) && Number.isFinite(p95) ? (p95 - p5) / 2 : NaN;
    const candidates = [p90, rangeHalf].filter((x) => Number.isFinite(x) && x >= 0);
    if (candidates.length) dev = Math.max(...candidates);
  }
  const half = Math.max(1.5, Math.min(5, dev * 1.15));
  return {
    scaleMode: "fixed",
    yMin: 100 - half,
    yMax: 100 + half,
    half,
  };
}

/**
 * Align two {t,v}[] series by date intersection; return relative index (start=100)
 * of a/b (units of B per 1 A ≈ aInr/bInr).
 */
export function relativeIndexSeries(seriesA, seriesB) {
  if (!seriesA?.length || !seriesB?.length) return [];
  const mapB = new Map(seriesB.map((p) => [p.t, p.v]));
  const cross = [];
  for (const p of seriesA) {
    const bv = mapB.get(p.t);
    if (!(p.v > 0) || !(bv > 0)) continue;
    cross.push({ t: p.t, v: p.v / bv });
  }
  if (cross.length < 2) return [];
  const base = cross[0].v;
  if (!(base > 0)) return [];
  return cross.map((p) => (p.v / base) * 100);
}

/** Simple level index (start=100) for a single series. */
export function levelIndexSeries(series) {
  if (!series?.length || series.length < 2) return [];
  const base = series[0].v;
  if (!(base > 0)) return [];
  return series.map((p) => (p.v / base) * 100);
}

/**
 * Multi-day % move from first→last of a series.
 */
export function seriesMovePct(series) {
  if (!series?.length || series.length < 2) return null;
  const a = series[0].v;
  const b = series[series.length - 1].v;
  if (!(a > 0) && !(b > 0)) return null;
  if (!(a > 0)) return null;
  return Number((((b - a) / a) * 100).toFixed(4));
}

/**
 * Like relativeIndexSeries but returns { values, dates } for event markers.
 */
export function relativeIndexSeriesDated(seriesA, seriesB) {
  if (!seriesA?.length || !seriesB?.length) return { values: [], dates: [] };
  const mapB = new Map(seriesB.map((p) => [p.t, p.v]));
  const cross = [];
  for (const p of seriesA) {
    const bv = mapB.get(p.t);
    if (!(p.v > 0) || !(bv > 0)) continue;
    cross.push({ t: p.t, v: p.v / bv });
  }
  if (cross.length < 2) return { values: [], dates: [] };
  const base = cross[0].v;
  if (!(base > 0)) return { values: [], dates: [] };
  return {
    values: cross.map((p) => (p.v / base) * 100),
    dates: cross.map((p) => p.t),
  };
}

/** Level index with dates. */
export function levelIndexSeriesDated(series) {
  if (!series?.length || series.length < 2) return { values: [], dates: [] };
  const base = series[0].v;
  if (!(base > 0)) return { values: [], dates: [] };
  return {
    values: series.map((p) => (p.v / base) * 100),
    dates: series.map((p) => p.t),
  };
}

export function heatColor(score, maxAbs = 1) {
  if (score == null || !Number.isFinite(score)) return "transparent";
  const tok = themeTokens();
  const t = Math.max(-1, Math.min(1, score / (maxAbs || 1)));
  if (t >= 0) {
    const a = 0.12 + Math.abs(t) * 0.45;
    return rgbAlpha(tok.okRgb, a.toFixed(3));
  }
  const a = 0.12 + Math.abs(t) * 0.45;
  return rgbAlpha(tok.dangerRgb, a.toFixed(3));
}

/** Dispose one LWC chart attached to an element. */
export function disposeSpark(el) {
  if (!el) return;
  const rec = chartByEl.get(el);
  if (rec?.chart) {
    try {
      rec.chart.remove();
    } catch {
      /* already gone */
    }
  }
  chartByEl.delete(el);
}

/**
 * Dispose all LWC sparks under a host (call before host.innerHTML = "").
 * @param {HTMLElement | null} host
 */
export function disposeSparkHost(host) {
  if (!host) return;
  if (host.classList?.contains("lwc-spark")) disposeSpark(host);
  host.querySelectorAll(".lwc-spark").forEach((el) => disposeSpark(el));
}

/**
 * Ensure host is a div.lwc-spark (replace canvas if callers still pass one).
 * @param {HTMLElement} el
 * @returns {HTMLElement | null}
 */
function ensureSparkHost(el) {
  if (!el) return null;
  if (el.tagName === "CANVAS") {
    const div = document.createElement("div");
    div.className = "lwc-spark";
    if (el.id) div.id = el.id;
    const aria = el.getAttribute("aria-label");
    if (aria) div.setAttribute("aria-label", aria);
    el.replaceWith(div);
    return div;
  }
  if (!el.classList.contains("lwc-spark")) el.classList.add("lwc-spark");
  return el;
}

function syntheticDate(i) {
  // Monotonic YYYY-MM-DD for ~28 pts when dates omitted
  const d = new Date(Date.UTC(2020, 0, 1 + i));
  return d.toISOString().slice(0, 10);
}

/**
 * @param {(number|null|undefined)[]} values
 * @param {string[]|undefined} dates
 * @param {{ sparse?: boolean }} [opts]
 */
function toLineData(values, dates, opts = {}) {
  const out = [];
  const n = values?.length || 0;
  for (let i = 0; i < n; i++) {
    const time = dates?.[i] && /^\d{4}-\d{2}-\d{2}/.test(dates[i]) ? dates[i].slice(0, 10) : syntheticDate(i);
    const v = values[i];
    if (v == null || !Number.isFinite(v)) {
      if (opts.sparse) out.push({ time });
      continue;
    }
    out.push({ time, value: v });
  }
  return out;
}

function lwcLayoutOptions(compact) {
  const tok = themeTokens();
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: tok.muted,
      fontFamily: "JetBrains Mono, IBM Plex Mono, monospace",
      fontSize: compact ? 9 : 11,
      attributionLogo: false,
    },
    grid: {
      vertLines: { visible: !compact, color: rgbAlpha(tok.mutedRgb, 0.18) },
      horzLines: { visible: !compact, color: rgbAlpha(tok.mutedRgb, 0.18) },
    },
    crosshair: {
      mode: CrosshairMode.Magnet,
      vertLine: {
        visible: true,
        labelVisible: !compact,
        color: rgbAlpha(tok.mutedRgb, 0.55),
        width: 1,
        style: 3,
      },
      horzLine: {
        visible: !compact,
        labelVisible: !compact,
        color: rgbAlpha(tok.mutedRgb, 0.45),
        width: 1,
        style: 3,
      },
    },
    rightPriceScale: {
      visible: !compact,
      borderVisible: false,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    },
    leftPriceScale: { visible: false },
    timeScale: {
      visible: !compact,
      borderVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      tickMarkMaxCharacterLength: 8,
    },
    handleScroll: !compact,
    handleScale: !compact,
  };
}

function showEmpty(el, msg) {
  disposeSpark(el);
  el.replaceChildren();
  const span = document.createElement("span");
  span.className = "lwc-empty muted";
  span.textContent = msg || "no history";
  el.appendChild(span);
}

function fixedAutoscale(min, max) {
  return () => ({
    priceRange: { minValue: min, maxValue: max },
  });
}

/**
 * Map calendar events onto series dates for LWC markers.
 * @param {string[]} dates
 * @param {{ date: string, label?: string, kind?: string }[]} events
 */
function buildMarkers(dates, events) {
  if (!dates?.length || !events?.length) return [];
  const tok = themeTokens();
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const markers = [];
  for (const ev of events) {
    let idx = dateIndex.get(ev.date);
    if (idx == null) {
      for (let i = dates.length - 1; i >= 0; i--) {
        if (dates[i] <= ev.date) {
          idx = i;
          break;
        }
      }
    }
    if (idx == null) continue;
    const time = dates[idx];
    const color =
      ev.kind === "oil"
        ? rgbAlpha(tok.warnRgb, 0.9)
        : ev.kind === "rbi"
          ? rgbAlpha(tok.cyanRgb, 0.9)
          : rgbAlpha(tok.mutedRgb, 0.85);
    markers.push({
      time,
      position: "aboveBar",
      color,
      shape: "circle",
      size: 0.6,
      text: ev.label ? String(ev.label).slice(0, 8) : "",
    });
  }
  return markers;
}


/**
 * Compact HTML tooltip overlay for spark hosts (LWC v5 crosshair has no labels when compact).
 * @param {HTMLElement} host
 * @returns {HTMLElement}
 */
function ensureSparkTooltip(host) {
  let tip = host.querySelector(":scope > .lwc-spark-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "lwc-spark-tip";
    tip.setAttribute("aria-hidden", "true");
    tip.hidden = true;
    host.appendChild(tip);
  }
  return tip;
}

function formatTipTime(time) {
  if (time == null) return "";
  if (typeof time === "string") return time.slice(0, 10);
  if (typeof time === "object" && time.year) {
    const m = String(time.month).padStart(2, "0");
    const d = String(time.day).padStart(2, "0");
    return `${time.year}-${m}-${d}`;
  }
  return String(time);
}

/**
 * @param {import("../vendor/lightweight-charts.mjs").IChartApi} chart
 * @param {HTMLElement} host
 * @param {{ series: object, label?: string }[]} seriesList
 * @param {{ indexMode?: boolean }} [opts]
 */
function attachSparkTooltip(chart, host, seriesList, opts = {}) {
  const tip = ensureSparkTooltip(host);
  const indexMode = opts.indexMode !== false;

  chart.subscribeCrosshairMove((param) => {
    if (
      !param ||
      param.time === undefined ||
      !param.point ||
      param.point.x < 0 ||
      param.point.y < 0 ||
      !host.clientWidth
    ) {
      tip.hidden = true;
      return;
    }

    const parts = [];
    for (const { series, label } of seriesList) {
      if (!series) continue;
      const d = param.seriesData?.get(series);
      const v = d && typeof d === "object" ? d.value : undefined;
      if (v == null || !Number.isFinite(v)) continue;
      let txt;
      if (indexMode) {
        const delta = v - 100;
        const sign = delta > 0 ? "+" : "";
        txt = `${v.toFixed(2)} (${sign}${delta.toFixed(2)})`;
      } else {
        txt = Number.isFinite(v) ? v.toFixed(v >= 100 ? 2 : 4) : String(v);
      }
      parts.push(label ? `${label} ${txt}` : txt);
    }
    if (!parts.length) {
      tip.hidden = true;
      return;
    }

    const date = formatTipTime(param.time);
    tip.replaceChildren();
    const dEl = document.createElement("span");
    dEl.className = "tip-date";
    dEl.textContent = date;
    const vEl = document.createElement("span");
    vEl.className = "tip-val";
    vEl.textContent = parts.join(" · ");
    tip.appendChild(dEl);
    tip.appendChild(vEl);
    tip.hidden = false;

    // Position inside host; flip left if near right edge
    const tw = tip.offsetWidth || 80;
    const th = tip.offsetHeight || 28;
    const maxX = Math.max(0, host.clientWidth - tw - 2);
    const maxY = Math.max(0, host.clientHeight - th - 2);
    let x = param.point.x + 10;
    let y = param.point.y + 8;
    if (x > maxX) x = Math.max(0, param.point.x - tw - 10);
    if (y > maxY) y = Math.max(0, param.point.y - th - 6);
    tip.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
    tip.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
  });
}

/**
 * Draw a relative-index / level spark with Lightweight Charts.
 * @param {HTMLElement} el  div.lwc-spark (or canvas — auto-replaced)
 * @param {number[]} values
 * @param {{
 *   color?: string,
 *   fill?: boolean,
 *   emptyMsg?: string,
 *   dates?: string[],
 *   events?: { date: string, label?: string, kind?: string }[],
 *   scaleMode?: "minmax" | "fixed" | "robust",
 *   yMin?: number,
 *   yMax?: number,
 *   compact?: boolean,
 * }} [opts]
 */
export function drawSpark(el, values, opts = {}) {
  const host = ensureSparkHost(el);
  if (!host) return;

  const tok = themeTokens();
  const pts = (values || []).filter((v) => Number.isFinite(v));
  if (pts.length < 2) {
    showEmpty(host, opts.emptyMsg || "no history");
    return;
  }

  disposeSpark(host);
  host.replaceChildren();

  const compact = opts.compact !== false;
  const { min, max } = resolveSparkScale(pts, opts);
  const color = opts.color || tok.cyan;
  const dates = opts.dates || [];
  // Align dates to filtered pts only when lengths match original values
  const raw = values || [];
  let useDates = dates;
  if (dates.length !== raw.length) {
    useDates = pts.map((_, i) => syntheticDate(i));
  } else {
    // keep dates for finite values only
    const paired = [];
    for (let i = 0; i < raw.length; i++) {
      if (Number.isFinite(raw[i])) paired.push({ t: dates[i], v: raw[i] });
    }
    useDates = paired.map((p) => p.t);
  }

  const chart = createChart(host, lwcLayoutOptions(compact));
  const series = chart.addSeries(LineSeries, {
    color,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: !compact,
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 3,
    autoscaleInfoProvider: fixedAutoscale(min, max),
  });

  const data = toLineData(pts, useDates);
  series.setData(data);

  const markers = buildMarkers(useDates, opts.events || []);
  if (markers.length) {
    try {
      createSeriesMarkers(series, markers);
    } catch {
      /* markers optional */
    }
  }

  chart.timeScale().fitContent();
  attachSparkTooltip(chart, host, [{ series, label: "" }], { indexMode: true });
  chartByEl.set(host, { chart, series });
}

/**
 * Price spark with MA20/MA50 overlays (2–3 line series).
 * @param {HTMLElement} el
 * @param {number[]} values
 * @param {{
 *   color?: string,
 *   ma20?: (number|null)[],
 *   ma50?: (number|null)[],
 *   dates?: string[],
 *   emptyMsg?: string,
 *   scaleMode?: "minmax" | "fixed" | "robust",
 *   yMin?: number,
 *   yMax?: number,
 * }} [opts]
 */
export function drawSparkWithMA(el, values, opts = {}) {
  const host = ensureSparkHost(el);
  if (!host) return;

  const tok = themeTokens();
  const pts = (values || []).map((v) => (Number.isFinite(v) ? v : null));
  const finite = pts.filter((v) => v != null);
  if (finite.length < 2) {
    showEmpty(host, opts.emptyMsg || "no history");
    return;
  }

  disposeSpark(host);
  host.replaceChildren();

  const extras = [...finite];
  for (const arr of [opts.ma20, opts.ma50]) {
    if (!arr) continue;
    for (const v of arr) if (Number.isFinite(v)) extras.push(v);
  }
  const { min, max } = resolveSparkScale(extras, opts);
  const color = opts.color || tok.cyan;
  const dates = opts.dates;

  const chart = createChart(host, {
    ...lwcLayoutOptions(false),
    layout: {
      ...lwcLayoutOptions(false).layout,
      fontSize: 11,
    },
  });

  const price = chart.addSeries(LineSeries, {
    color,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    autoscaleInfoProvider: fixedAutoscale(min, max),
  });
  price.setData(toLineData(pts, dates, { sparse: true }));

  const tipSeries = [{ series: price, label: "px" }];
  if (opts.ma20?.length) {
    const ma20 = chart.addSeries(LineSeries, {
      color: rgbAlpha(tok.cyanRgb, 0.95),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: fixedAutoscale(min, max),
    });
    ma20.setData(toLineData(opts.ma20, dates, { sparse: true }));
    tipSeries.push({ series: ma20, label: "MA20" });
  }
  if (opts.ma50?.length) {
    const ma50 = chart.addSeries(LineSeries, {
      color: rgbAlpha(tok.warnRgb, 0.9),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: fixedAutoscale(min, max),
    });
    ma50.setData(toLineData(opts.ma50, dates, { sparse: true }));
    tipSeries.push({ series: ma50, label: "MA50" });
  }

  chart.timeScale().fitContent();
  attachSparkTooltip(chart, host, tipSeries, { indexMode: false });
  chartByEl.set(host, { chart, series: price });
}
