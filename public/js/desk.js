/**
 * Desk tab — FX basket + hard assets + real-strength legs from snapshot.
 */
import {
  $,
  escapeHtml,
  formatInr,
  formatPct,
  formatRate,
  chgClass,
  setText,
  loadHistory,
  themeTokens,
} from "./util.js";
import { buildRegime } from "./research.js";
import { DESK_FX_BASKET_IDS, filterDeskFxRows } from "./compare-lib.js";

function findFx(fx, pair) {
  return (fx || []).find((r) => r.pair === pair) || null;
}

function findHard(hard, id) {
  return (hard || []).find((r) => r.id === id) || null;
}

function fillKpis(snap) {
  const usd = findFx(snap.fx, "USDINR");
  const brent = findHard(snap.hardAssets, "BRENT");
  const gold = findHard(snap.hardAssets, "XAU");
  const btc = findHard(snap.hardAssets, "BTC");

  setText("kpiUsdInr", usd ? formatRate(usd.rate) : "—");
  const usdChg = $("kpiUsdInrChg");
  if (usdChg) {
    usdChg.textContent = usd ? `Δ ${formatPct(usd.changePct)}` : "";
    usdChg.className = `sublbl ${chgClass(usd?.changePct)}`;
  }

  setText("kpiBrentInr", brent ? formatInr(brent.inrPrice) : "—");
  const brentChg = $("kpiBrentChg");
  if (brentChg) {
    brentChg.textContent = brent
      ? `Δ ${formatPct(brent.changePct)}${brent.usdPrice != null ? ` · $${formatRate(brent.usdPrice)}` : ""}`
      : "";
    brentChg.className = `sublbl ${chgClass(brent?.changePct)}`;
  }

  setText("kpiGoldInr", gold ? formatInr(gold.inrPrice) : "—");
  const goldUsd = $("kpiGoldUsd");
  if (goldUsd) {
    goldUsd.textContent =
      gold && gold.usdPrice != null ? `$${formatRate(gold.usdPrice)} / oz` : "";
  }

  setText("kpiBtcInr", btc ? formatInr(btc.inrPrice) : "—");
  const btcChg = $("kpiBtcChg");
  if (btcChg) {
    btcChg.textContent = btc
      ? `Δ ${formatPct(btc.changePct)}${btc.usdPrice != null ? ` · $${formatRate(btc.usdPrice)}` : ""}`
      : "";
    btcChg.className = `sublbl ${chgClass(btc?.changePct)}`;
  }
}

function fillFxTable(fx) {
  const body = $("fxBody");
  if (!body) return;
  body.innerHTML = "";
  // Desk shows RBI ETCD INR pairs + top majors only (not full Frankfurter dump)
  const rows = filterDeskFxRows(fx);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No desk FX rows in snapshot</td></tr>`;
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.pair ?? "—")}</td>
      <td class="mono">${escapeHtml(formatRate(row.rate))}</td>
      <td class="mono ${chgClass(row.changePct)}">${escapeHtml(formatPct(row.changePct))}</td>
      <td class="muted">${escapeHtml(row.note || row.source || "")}</td>
    `;
    body.appendChild(tr);
  }
}

function fillHardTable(hard) {
  const body = $("hardBody");
  if (!body) return;
  body.innerHTML = "";
  if (!hard?.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No hard-asset rows in snapshot</td></tr>`;
    return;
  }
  for (const row of hard) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.name || row.id || "—")}</td>
      <td class="mono">${row.usdPrice != null ? "$" + escapeHtml(formatRate(row.usdPrice)) : "—"}</td>
      <td class="mono">${escapeHtml(formatInr(row.inrPrice))}</td>
      <td class="mono ${chgClass(row.changePct)}">${escapeHtml(formatPct(row.changePct))}</td>
      <td class="muted">${escapeHtml(row.unit || "")}</td>
    `;
    body.appendChild(tr);
  }
}

function fillStrength(rs) {
  setText("strengthSummary", rs?.summary || "—");
  const legsEl = $("legs");
  if (!legsEl) return;
  legsEl.innerHTML = "";
  for (const leg of rs?.legs || []) {
    const div = document.createElement("div");
    div.className = "leg";
    const verdict = (leg.verdict || "").toLowerCase();
    div.innerHTML = `
      <div class="leg-head">
        <span class="leg-lens">${escapeHtml(leg.lens || "—")}</span>
        <span class="verdict ${escapeHtml(verdict)}">${escapeHtml(leg.verdict || "—")}</span>
      </div>
      <div class="leg-detail">${escapeHtml(leg.detail || "")}</div>
    `;
    legsEl.appendChild(div);
  }
}

function fillSourcesAndAssumptions(snap) {
  const sourcesList = $("sourcesList");
  if (sourcesList) {
    sourcesList.innerHTML = "";
    const items = snap.scriptures || [];
    for (const s of items) {
      const li = document.createElement("li");
      li.textContent = s;
      sourcesList.appendChild(li);
    }
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No scriptures in snapshot";
      sourcesList.appendChild(li);
    }
  }

  const assumptions = snap.assumptions || [];
  const panel = $("assumptionsPanel");
  const list = $("assumptionsList");
  if (panel && list) {
    list.innerHTML = "";
    if (assumptions.length) {
      panel.hidden = false;
      for (const a of assumptions) {
        const li = document.createElement("li");
        li.textContent = a;
        list.appendChild(li);
      }
    } else {
      panel.hidden = true;
    }
  }

  setText("timezoneNote", snap.timezoneNote || "");
}


function fillYields(snap) {
  const y = snap?.yields;
  const note = $("yieldNote");
  if (!y || y.us2y == null || y.us10y == null) {
    setText("yield2y", "—");
    setText("yield10y", "—");
    setText("yieldCurve", "—");
    setText("yieldAsOf", "—");
    if (note) {
      note.textContent =
        (y?.note || "Yields unavailable") +
        " · source: U.S. Treasury daily yield curve CSV (never invented).";
    }
    return;
  }
  setText("yield2y", `${Number(y.us2y).toFixed(2)}%`);
  setText("yield10y", `${Number(y.us10y).toFixed(2)}%`);
  const curve = y.us10yMinus2y != null ? y.us10yMinus2y : y.us10y - y.us2y;
  setText("yieldCurve", `${Number(curve).toFixed(2)}%`);
  setText("yieldAsOf", y.asOf || "—");
  if (note) {
    note.textContent = `Source: ${y.source || "U.S. Treasury"} · as-of ${y.asOf || "—"}`;
  }
}

function fillRegime(snap, history) {
  const regime = buildRegime(snap, history);
  const host = $("regimeCards");
  if (host) {
    host.innerHTML = "";
    for (const c of regime.cards || []) {
      const div = document.createElement("div");
      div.className = "regime-card" + (c.flag ? " regime-shock" : "");
      div.innerHTML = `
        <div class="regime-title">${escapeHtml(c.title)}</div>
        <div class="regime-primary mono">${escapeHtml(String(c.primary))}</div>
        <div class="regime-secondary muted tiny">${escapeHtml(c.secondary || "")}</div>
      `;
      host.appendChild(div);
    }
  }
  const body = $("regimeBody");
  if (body) {
    body.innerHTML = "";
    for (const row of regime.table || []) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.series)}</td>
        <td class="mono">${row.vol7d != null ? escapeHtml(String(row.vol7d)) + "%" : "—"}</td>
        <td class="mono">${row.vol30d != null ? escapeHtml(String(row.vol30d)) + "%" : "—"}</td>
        <td class="mono ${row.shock === "shock" ? "chg-up" : "muted"}">${escapeHtml(row.shock || "—")}</td>
        <td class="muted tiny">${escapeHtml(row.note || "")}</td>
      `;
      body.appendChild(tr);
    }
    // peer breadth detail rows
    for (const p of regime.peerRows || []) {
      const tr = document.createElement("tr");
      const align =
        p.aligned == null ? "—" : p.aligned ? "usd-aligned" : "diverging";
      tr.innerHTML = `
        <td class="muted">${escapeHtml(p.code)}INR</td>
        <td class="mono" colspan="2">${escapeHtml(formatPct(p.changePct))}</td>
        <td class="mono muted" colspan="2">${escapeHtml(align)}</td>
      `;
      body.appendChild(tr);
    }
  }
  setText("regimeMethod", regime.method || "");
}

/** Wire REER/NEER slots from history when present — never invent. */
async function fillReer() {
  const hist = await loadHistory();
  const series = hist.data?.series || {};
  const neer = series.NEER || series.neer || hist.data?.reer?.NEER;
  const reer = series.REER || series.reer || hist.data?.reer?.REER;

  const setSlot = (valId, noteId, seriesArr, label) => {
    const el = $(valId);
    const note = $(noteId);
    if (!el) return;
    if (Array.isArray(seriesArr) && seriesArr.length >= 2) {
      const last = seriesArr[seriesArr.length - 1];
      el.textContent = typeof last.v === "number" ? String(last.v) : "—";
      if (note) {
        note.textContent = `${label} · ${seriesArr[0]?.t || "?"}→${last?.t || "?"} · ${seriesArr.length} pts`;
      }
    } else {
      el.textContent = "—";
      if (note) note.textContent = "awaiting series — not invented";
    }
  };

  setSlot("reerNeer", "reerNeerNote", neer, "NEER");
  setSlot("reerReer", "reerReerNote", reer, "REER");
}

function drawBars(canvas, items, { valueKey, labelKey, colorPositive, colorNegative, relative }) {
  if (!canvas || !items?.length) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const n = items.length;
  const gap = 10;
  const barW = Math.max(12, (cssW - padL - padR - gap * (n - 1)) / n);
  const plotH = cssH - padT - padB;

  let values = items.map((it) => {
    const v = Number(it[valueKey]);
    return Number.isFinite(v) ? v : 0;
  });

  if (relative) {
    const max = Math.max(...values.map(Math.abs), 1e-9);
    values = values.map((v) => (v / max) * 100);
  }

  const maxAbs = Math.max(...values.map(Math.abs), 0.01);
  const zeroY = relative ? cssH - padB : padT + plotH * (maxAbs / (2 * maxAbs));
  const signed = !relative;

  for (let i = 0; i < n; i++) {
    const v = values[i];
    const x = padL + i * (barW + gap);
    let y, h;
    if (signed) {
      const scale = plotH / (2 * maxAbs);
      h = Math.abs(v) * scale;
      y = v >= 0 ? zeroY - h : zeroY;
    } else {
      const scale = plotH / maxAbs;
      h = Math.max(2, Math.abs(v) * scale);
      y = cssH - padB - h;
    }
    const tok = themeTokens();
    ctx.fillStyle = v >= 0 ? colorPositive || tok.danger : colorNegative || tok.ok;
    ctx.fillRect(x, y, barW, h);

    ctx.fillStyle = tok.muted;
    ctx.font = "11px JetBrains Mono, IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(items[i][labelKey] || "").slice(0, 8), x + barW / 2, cssH - 8);

    ctx.fillStyle = tok.text;
    ctx.font = "10px JetBrains Mono, IBM Plex Mono, monospace";
    const raw = items[i][valueKey];
    const tip =
      raw == null || !Number.isFinite(Number(raw))
        ? "—"
        : signed
          ? formatPct(raw)
          : formatInr(raw, { compact: true });
    ctx.fillText(tip, x + barW / 2, Math.max(10, y - 4));
  }

  if (signed) {
    ctx.strokeStyle = themeTokens().border;
    ctx.beginPath();
    ctx.moveTo(padL, zeroY);
    ctx.lineTo(cssW - padR, zeroY);
    ctx.stroke();
  }
}

function drawCharts(snap) {
  const deskSet = new Set(DESK_FX_BASKET_IDS);
  const fxItems = filterDeskFxRows(snap.fx)
    .filter((r) => deskSet.has(String(r.pair || "").replace(/INR$/i, "").toUpperCase()))
    .map((r) => ({
    label: r.pair?.replace("INR", "") || "?",
    changePct: r.changePct,
  }));
  const tok = themeTokens();
  drawBars($("fxBars"), fxItems, {
    valueKey: "changePct",
    labelKey: "label",
    colorPositive: tok.danger,
    colorNegative: tok.ok,
    relative: false,
  });

  const hardItems = (snap.hardAssets || []).map((r) => ({
    label: r.id || r.name || "?",
    inrPrice: r.inrPrice,
  }));
  drawBars($("hardBars"), hardItems, {
    valueKey: "inrPrice",
    labelKey: "label",
    colorPositive: tok.cyan,
    colorNegative: tok.cyan,
    relative: true,
  });
}

let _resizeBound = null;

/** Render desk tab from snapshot. */
export async function renderDesk(snap) {
  fillKpis(snap);
  fillYields(snap);
  fillFxTable(snap.fx);
  fillHardTable(snap.hardAssets);
  fillStrength(snap.realStrength);
  fillSourcesAndAssumptions(snap);
  const hist = await loadHistory();
  fillRegime(snap, hist.data);
  fillReer();
  drawCharts(snap);

  // as-of yields cell (shared strip)
  const y = snap?.yields;
  const asOfY = document.getElementById("asOfYields");
  if (asOfY) {
    asOfY.textContent =
      y?.asOf && y.us10y != null ? `${y.asOf} · 10y ${Number(y.us10y).toFixed(2)}%` : "—";
  }

  if (_resizeBound) window.removeEventListener("resize", _resizeBound);
  _resizeBound = () => drawCharts(snap);
  window.addEventListener("resize", _resizeBound);
}
