/**
 * Desk — ordered board from snapshot only.
 * 1 headline/verdict/as-of · 2 KPIs · 3 slip flags · 4 rupee vs majors ·
 * 5 gold/oil INR · 6 yields · 7 shock day · 8 link to /how
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
  loadEvents,
  themeTokens,
} from "./util.js";
import { buildRegime } from "./research.js";
import { DESK_FX_BASKET_IDS, filterDeskFxRows } from "./compare-lib.js";
import {
  buildRealStrengthBlurb,
  buildSlipSummaryFlags,
  buildDailyTakeaway,
  formatPairRate,
  filterAsiaPeerRows,
} from "./takeaway.js";

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
  const goldChg = $("kpiGoldChg");
  if (goldChg) {
    goldChg.textContent = gold
      ? `Δ ${formatPct(gold.changePct)}${gold.usdPrice != null ? ` · $${formatRate(gold.usdPrice)}` : ""}`
      : "";
    goldChg.className = `sublbl ${chgClass(gold?.changePct)}`;
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

function fillFxRow(tbody, row) {
  const tr = document.createElement("tr");
  const fmt = formatPairRate(row.pair, row.rate);
  const rateHtml = fmt.secondary
    ? `<div class="mono">${escapeHtml(fmt.primary)}</div><div class="muted tiny mono">${escapeHtml(fmt.secondary)}</div>`
    : `<span class="mono">${escapeHtml(fmt.primary)}</span>`;
  // Public note: strip notOnEcb / provider jargon
  let note = row.note || "";
  note = note.replace(/\s*·\s*FloatRates only \(not ECB\)/gi, "");
  note = note.replace(/notOnEcb/gi, "");
  if (row.provider === "floatrates" && !/FloatRates/i.test(note)) {
    note = (note ? note + " · " : "") + "non-ECB print";
  }
  tr.innerHTML = `
    <td>${escapeHtml(row.pair ?? "—")}</td>
    <td>${rateHtml}</td>
    <td class="mono ${chgClass(row.changePct)}">${escapeHtml(formatPct(row.changePct))}</td>
    <td class="muted">${escapeHtml(note || row.source || "")}</td>
  `;
  tbody.appendChild(tr);
}

function fillFxTable(fx) {
  const body = $("fxBody");
  if (!body) return;
  body.innerHTML = "";
  const rows = filterDeskFxRows(fx);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No desk FX rows in snapshot</td></tr>`;
    return;
  }
  for (const row of rows) fillFxRow(body, row);

  const asiaPanel = $("asiaPeersPanel");
  const asiaBody = $("asiaBody");
  const asia = filterAsiaPeerRows(fx).filter(
    (r) => !DESK_FX_BASKET_IDS.includes(String(r.pair || "").replace(/INR$/i, "").toUpperCase())
  );
  if (asiaPanel && asiaBody) {
    asiaBody.innerHTML = "";
    if (asia.length) {
      asiaPanel.hidden = false;
      for (const row of asia) fillFxRow(asiaBody, row);
    } else {
      asiaPanel.hidden = true;
    }
  }
}

function fillHardTable(hard) {
  const body = $("hardBody");
  if (!body) return;
  body.innerHTML = "";
  // Prefer gold/oil first; include BTC in table only
  const order = ["XAU", "BRENT", "WTI", "BTC", "COPPER", "WHEAT", "NATGAS", "CRYPTO_INDEX"];
  const byId = new Map((hard || []).map((h) => [String(h.id || "").toUpperCase(), h]));
  const rows = [
    ...order.map((id) => byId.get(id)).filter(Boolean),
    ...[...byId.values()].filter((h) => !order.includes(String(h.id || "").toUpperCase())),
  ];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No hard-asset rows in snapshot</td></tr>`;
    return;
  }
  for (const row of rows) {
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

function fillSlipFlags(slip) {
  setText("slipFlagsLine", slip.line || "—");
  const chips = $("slipFlagsChips");
  if (!chips) return;
  chips.innerHTML = "";
  for (const f of slip.flags || []) {
    const span = document.createElement("span");
    span.className = `slip-flag slip-flag-${escapeHtml(f.severity || "note")}`;
    span.textContent = f.label;
    chips.appendChild(span);
  }
}

function fillStrength(strength) {
  setText("strengthLabel", strength.label || "MIXED");
  setText("strengthSummary", strength.sentence1 || "—");
  setText("strengthSummary2", strength.sentence2 || "");
  setText("deskVerdictLine", `${strength.label}: ${strength.sentence1}`);
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
    note.textContent = `Source: ${y.source || "U.S. Treasury"} · as-of ${y.asOf || "—"} · context only`;
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
      let primary = String(c.primary);
      // Spell Calm correctly (title case for public board)
      if (primary.toLowerCase() === "calm") primary = "Calm";
      if (primary.toLowerCase() === "shock") primary = "Shock";
      div.innerHTML = `
        <div class="regime-title">${escapeHtml(c.title)}</div>
        <div class="regime-primary mono">${escapeHtml(primary)}</div>
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
      let shock = row.shock || "—";
      if (String(shock).toLowerCase() === "calm") shock = "Calm";
      if (String(shock).toLowerCase() === "shock") shock = "Shock";
      tr.innerHTML = `
        <td>${escapeHtml(row.series)}</td>
        <td class="mono">${row.vol7d != null ? escapeHtml(String(row.vol7d)) + "%" : "—"}</td>
        <td class="mono">${row.vol30d != null ? escapeHtml(String(row.vol30d)) + "%" : "—"}</td>
        <td class="mono ${shock === "Shock" ? "chg-up" : "muted"}">${escapeHtml(shock)}</td>
        <td class="muted tiny">${escapeHtml(row.note || "")}</td>
      `;
      body.appendChild(tr);
    }
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
  return regime;
}

function fillEvents(calendar) {
  const panel = $("eventStripPanel");
  const host = $("eventStrip");
  if (!panel || !host) return;
  const events = calendar?.events || [];
  if (!events.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  host.innerHTML = "";
  const sorted = [...events].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const ev of sorted.slice(-8)) {
    const div = document.createElement("div");
    div.className = "event-chip";
    div.innerHTML = `<span class="mono">${escapeHtml(ev.date || "")}</span> <strong>${escapeHtml(ev.label || ev.id || "")}</strong>`;
    host.appendChild(div);
  }
  setText("eventStripNote", calendar.label || "Curated calendar");
}

function fillTakeaway(take) {
  const pre = $("takeawayPre");
  if (pre) pre.textContent = take.text;
  const link = $("takeawayNoteLink");
  if (link && take.asOfDate) {
    link.href = `/notes/${take.asOfDate}`;
    link.textContent = `Open as /notes/${take.asOfDate}`;
  }
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

  // Gold & oil only — BTC not on this bar chart
  const hardItems = (snap.hardAssets || [])
    .filter((r) => ["XAU", "BRENT", "WTI"].includes(String(r.id || "").toUpperCase()))
    .map((r) => ({
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

function fillImportHorizon(history) {
  const wrap = $("importHorizon");
  const note = $("importHorizonNote");
  if (!wrap) return;
  const ha = history?.hardAssets || {};
  const has =
    (Array.isArray(ha.XAU) && ha.XAU.length >= 2) ||
    (Array.isArray(ha.BRENT) && ha.BRENT.length >= 2);
  if (!has) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  if (note) {
    note.textContent =
      "Hard-asset history present — 30/90/365 INR cost windows can be shown when series are sourced.";
  }
}

let _resizeBound = null;

/** Render desk tab from snapshot. */
export async function renderDesk(snap) {
  fillKpis(snap);
  fillFxTable(snap.fx);
  fillHardTable(snap.hardAssets);
  fillYields(snap);

  const [hist, ev] = await Promise.all([loadHistory(), loadEvents()]);
  const regime = fillRegime(snap, hist.data);
  const strength = buildRealStrengthBlurb(snap, regime);
  fillStrength(strength);
  const slip = buildSlipSummaryFlags(snap, hist.data);
  fillSlipFlags(slip);
  const take = buildDailyTakeaway(snap, hist.data, regime, slip);
  fillTakeaway(take);
  fillEvents(ev.data);
  fillImportHorizon(hist.data);
  drawCharts(snap);

  if (_resizeBound) window.removeEventListener("resize", _resizeBound);
  _resizeBound = () => drawCharts(snap);
  window.addEventListener("resize", _resizeBound);
}
