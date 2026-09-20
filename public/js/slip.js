/**
 * Everywhere? · Slip vs USD — FX matrix + heatmap + history sparks.
 * Defaults to key basket; optional “show all” for full Frankfurter universe.
 * “If it slips vs USD, does it slip everywhere?”
 */
import {
  buildSlipMatrix,
  buildCorrelations,
  eventsInRange,
} from "./compare-lib.js";
import {
  $,
  escapeHtml,
  formatPct,
  chgClass,
  setText,
  loadHistory,
  loadEvents,
  themeTokens,
} from "./util.js";
import {
  drawSpark,
  disposeSparkHost,
  relativeIndexSeriesDated,
  levelIndexSeriesDated,
  sharedIndexBand,
  heatColor,
} from "./charts.js";

/** Default: key basket for readability. Persisted in-session only. */
let showAllCurrencies = false;

function cellClass(score) {
  if (score == null || !Number.isFinite(score)) return "slip-na";
  if (score <= -0.05) return "slip-soft";
  if (score >= 0.05) return "slip-hard";
  return "slip-flat";
}

function renderMatrix(matrix) {
  const table = $("slipMatrix");
  if (!table) return;
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  if (!thead || !tbody) return;

  let maxAbs = 0.05;
  for (const row of matrix.rows) {
    for (const l of matrix.legs) {
      const v = row.cells[l.id];
      if (v != null && Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
    }
  }

  thead.innerHTML = "";
  const hr = document.createElement("tr");
  hr.innerHTML = `<th>Currency</th><th>move %</th>${matrix.legs
    .map((l) => `<th>${escapeHtml(l.label)}</th>`)
    .join("")}<th>Flags</th>`;
  thead.appendChild(hr);

  tbody.innerHTML = "";
  for (const row of matrix.rows) {
    const tr = document.createElement("tr");
    const flagHtml = row.flags.length
      ? row.flags
          .map(
            (f) =>
              `<span class="slip-flag slip-flag-${escapeHtml(f.severity)}">${escapeHtml(f.label)}</span>`
          )
          .join(" ")
      : `<span class="muted">—</span>`;
    const move = row.movePct != null ? row.movePct : row.sessionChg;
    const cellHtml = matrix.legs
      .map((l) => {
        const v = row.cells[l.id];
        const bg = heatColor(v, maxAbs);
        return `<td class="mono ${cellClass(v)}" style="background:${bg}">${escapeHtml(formatPct(v))}</td>`;
      })
      .join("");
    const diverge = row.flags.some((f) => f.severity === "diverge");
    tr.className = diverge ? "slip-row-diverge" : "";
    tr.innerHTML = `
      <td><strong>${escapeHtml(row.code)}</strong>
        <div class="muted tiny">${escapeHtml(row.moveBasis || "—")}</div>
      </td>
      <td class="mono ${chgClass(move)}">${escapeHtml(formatPct(move))}</td>
      ${cellHtml}
      <td class="slip-flags">${flagHtml}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderLadders(matrix) {
  const host = $("slipLadders");
  if (!host) return;
  host.innerHTML = "";
  for (const leg of matrix.legs) {
    const ladder = matrix.ladders[leg.id] || [];
    const card = document.createElement("div");
    card.className = "slip-ladder-card";
    let body = `<div class="slip-ladder-title">${escapeHtml(leg.label)}</div>`;
    if (!ladder.length) {
      body += `<div class="muted">No scores for this leg</div>`;
    } else {
      body += `<ol class="slip-ladder-list">`;
      const show = ladder.slice(0, showAllCurrencies ? 20 : 12);
      for (const e of show) {
        const pct = Math.round(Math.abs(e.normalized || 0) * 100);
        const side = (e.score || 0) >= 0 ? "strong" : "weak";
        body += `
          <li class="slip-ladder-row">
            <span class="mono">${escapeHtml(e.code)}</span>
            <span class="rank-track slip-mini-track">
              <span class="rank-mid"></span>
              <span class="rank-fill ${side}" style="width:${pct}%;${
                (e.score || 0) >= 0 ? "left:50%" : "right:50%;left:auto"
              }"></span>
            </span>
            <span class="mono ${chgClass(e.score)}">${escapeHtml(formatPct(e.score))}</span>
          </li>`;
      }
      if (ladder.length > show.length) {
        body += `<li class="muted">+${ladder.length - show.length} more</li>`;
      }
      body += `</ol>`;
    }
    card.innerHTML = body;
    host.appendChild(card);
  }
}

/**
 * Per-currency sparks vs USD and vs gold (when history exists).
 */
function formatEndDelta(values) {
  if (!values?.length) return "";
  const last = values[values.length - 1];
  if (!Number.isFinite(last)) return "";
  const d = last - 100;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}`;
}

function renderSlipSparks(matrix, history, calendar) {
  const host = $("slipSparkGrid");
  const note = $("slipSparkNote");
  if (!host) return;
  disposeSparkHost(host);
  host.innerHTML = "";

  const series = history?.series || {};
  const usdSeries = series.USDINR;
  const hasFxHist = !!usdSeries && usdSeries.length >= 2;
  const goldHist = history?.hardAssets?.XAU;
  const inRange = eventsInRange(calendar, history?.from, history?.to);

  const legend = $("slipEventLegend");
  if (legend) {
    legend.innerHTML = inRange.length
      ? `<span class="muted">${escapeHtml(calendar?.label || "events")}:</span>
         <span class="ev-rbi">RBI</span>
         <span class="ev-fomc">FOMC</span>
         <span class="ev-oil">Oil</span>
         <span class="muted">· ${inRange.length} in window</span>`
      : calendar?.label
        ? `<span class="muted">${escapeHtml(calendar.label)}</span>`
        : "";
  }

  if (!hasFxHist) {
    if (note) {
      note.textContent =
        "No FX history loaded — sparks unavailable. Matrix uses session Δ% only.";
    }
    host.innerHTML = `<div class="spark-empty muted">no history yet</div>`;
    return;
  }

  const codes = matrix.currencies.filter((c) => c !== "INR");
  const cards = [];
  const usdSeriesList = [];

  for (const code of codes) {
    const codeSeries = series[`${code}INR`];
    let vsUsd = { values: [], dates: [] };
    if (code === "USD") {
      vsUsd = levelIndexSeriesDated(usdSeries);
    } else {
      vsUsd = relativeIndexSeriesDated(codeSeries, usdSeries);
    }
    if (vsUsd.values.length >= 2) usdSeriesList.push(vsUsd.values);
    cards.push({ code, codeSeries, vsUsd });
  }

  const band = sharedIndexBand(usdSeriesList);

  if (note) {
    const goldNote =
      goldHist?.length >= 2 ? "history present" : "gold history still missing";
    note.textContent = `Lightweight Charts · each FX vs USD — relative index (start=100), fixed y-band ±${band.half.toFixed(1)} so spikes don’t dominate; ${goldNote}. ${history.from || ""}→${history.to || ""}.`;
  }

  for (const { code, codeSeries, vsUsd } of cards) {
    const card = document.createElement("div");
    card.className = "spark-card spark-card-slip";
    const cUsd = document.createElement("div");
    cUsd.className = "lwc-spark lwc-spark-slip";
    cUsd.setAttribute("aria-label", `${code} vs USD`);
    const cGold = document.createElement("div");
    cGold.className = "lwc-spark lwc-spark-slip";
    cGold.setAttribute("aria-label", `${code} vs gold`);

    const endDelta = formatEndDelta(vsUsd.values);
    const endNum = vsUsd.values.length ? vsUsd.values[vsUsd.values.length - 1] - 100 : null;
    const deltaHtml = endDelta
      ? `<span class="spark-delta ${chgClass(endNum)}">${escapeHtml(endDelta)}</span>`
      : "";

    card.innerHTML = `<div class="spark-label">${escapeHtml(code)}${deltaHtml}</div>
      <div class="spark-pair"><span class="muted">vs USD</span></div>`;
    card.appendChild(cUsd);
    const goldLabel = document.createElement("div");
    goldLabel.className = "spark-pair";
    goldLabel.innerHTML = `<span class="muted">vs gold</span>`;
    card.appendChild(goldLabel);
    card.appendChild(cGold);
    host.appendChild(card);

    requestAnimationFrame(() => {
      const tok = themeTokens();
      drawSpark(cUsd, vsUsd.values, {
        color: tok.cyan,
        emptyMsg: codeSeries ? "no overlap" : "no series",
        dates: vsUsd.dates,
        events: inRange,
        scaleMode: band.scaleMode,
        yMin: band.yMin,
        yMax: band.yMax,
      });
      if (Array.isArray(goldHist) && goldHist.length >= 2 && codeSeries) {
        const g = relativeIndexSeriesDated(codeSeries, goldHist);
        drawSpark(cGold, g.values, {
          color: tok.accent,
          emptyMsg: "no overlap",
          dates: g.dates,
          events: inRange,
          scaleMode: "robust",
        });
      } else {
        drawSpark(cGold, [], { emptyMsg: "level only / no history yet" });
      }
    });
  }
}

function fillSlipCorrelations(matrix, history) {
  const body = $("slipCorrBody");
  if (!body) return;
  body.innerHTML = "";
  const codes = (matrix.currencies || []).filter((c) => c !== "INR");
  if (!codes.length || !history?.series) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No history for correlations</td></tr>`;
    return;
  }
  for (const code of codes) {
    const corr = buildCorrelations(history, code);
    const peer = (corr.rows || []).find((r) => r.id === "peers");
    const tr = document.createElement("tr");
    const rho = peer?.corr == null ? "—" : peer.corr.toFixed(2);
    tr.innerHTML = `
      <td><strong>${escapeHtml(code)}</strong></td>
      <td class="mono ${peer?.corr == null ? "muted" : chgClass(peer.corr)}">${escapeHtml(rho)}</td>
      <td class="mono muted">${peer?.n ?? "—"}</td>
      <td class="muted tiny">${escapeHtml(peer?.note || (peer?.from && peer?.to ? `${peer.from}→${peer.to}` : ""))}</td>
    `;
    body.appendChild(tr);
  }
  setText(
    "slipCorrNote",
    `Pearson ρ of daily vs-USD returns vs EUR/GBP/JPY/CNY peer basket · window ≈ 20`
  );
}

function bindUniverseToggle(_snap, remount) {
  const toggle = $("slipShowAll");
  if (!toggle) return;
  // Rebind on each mount so remount closes over the latest snap (AbortController
  // drops the previous listener — dataset.bound alone broke after SPA remounts).
  if (toggle._slipToggleAbort) {
    try {
      toggle._slipToggleAbort.abort();
    } catch {
      /* ignore */
    }
  }
  const ac = new AbortController();
  toggle._slipToggleAbort = ac;
  toggle.checked = showAllCurrencies;
  toggle.addEventListener(
    "change",
    () => {
      showAllCurrencies = !!toggle.checked;
      remount();
    },
    { signal: ac.signal }
  );
}

/** Stale-render guard when toggle remounts while history is still loading. */
let slipRenderGen = 0;

/** Render Everywhere? · Slip vs USD from snapshot (+ optional history). */
export async function renderSlip(snap) {
  const gen = ++slipRenderGen;
  const remount = () => renderSlip(snap);
  bindUniverseToggle(snap, remount);

  const toggle = $("slipShowAll");
  if (toggle) toggle.checked = showAllCurrencies;

  const [histLoaded, evLoaded] = await Promise.all([loadHistory(), loadEvents()]);
  if (gen !== slipRenderGen) return;
  const history = histLoaded.data;
  const matrix = buildSlipMatrix(snap, history, {
    keyBasketOnly: !showAllCurrencies,
  });
  window.__slipMatrix = matrix;

  const badge = $("slipHistoryBadge");
  if (badge) {
    badge.textContent = matrix.historyLabel;
    badge.classList.toggle("warn", !!matrix.historyLimited);
    badge.classList.toggle("live", !matrix.historyLimited);
  }

  const scope = showAllCurrencies
    ? `full universe (${matrix.rows.length})`
    : `desk+Asia basket (${matrix.rows.length} · ${matrix.currencies.join("/")})`;

  setText(
    "slipStatus",
    `Slip matrix · ${scope} · ${matrix.scoredCells}/${matrix.totalCells} cells scored · ${matrix.asOf || ""}`
  );
  setText("slipNarrative", matrix.narrative);
  setText("slipMethod", matrix.method);

  renderMatrix(matrix);
  renderLadders(matrix);
  fillSlipCorrelations(matrix, history);
  renderSlipSparks(matrix, history, evLoaded.data);
}

export { buildSlipMatrix };
