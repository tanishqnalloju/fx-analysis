/**
 * Compare tab — <select> dropdown of full FX universe + key-basket legs.
 * Deep-link via /compare or /compare/USD (path routes; defaults to USD).
 */
import {
  buildCompare,
  majorPickerCodes,
  listUnavailableHints,
  KEY_BASKET_IDS,
  isKeyBasket,
  buildCorrelations,
  eventsInRange,
} from "./compare-lib.js";
import {
  $,
  escapeHtml,
  formatNum,
  formatPct,
  chgClass,
  setText,
  loadCompare,
  loadHistory,
  loadEvents,
  themeTokens,
} from "./util.js";
import {
  drawSpark,
  drawSparkWithMA,
  disposeSparkHost,
  disposeSpark,
  relativeIndexSeriesDated,
  levelIndexSeriesDated,
  sharedIndexBand,
} from "./charts.js";
import {
  buildCompareTechnicals,
  buildModelCard,
  buildLeadLag,
  buildSelectedRegime,
} from "./research.js";

const KEY_LEG_SET = new Set(KEY_BASKET_IDS);

/** Keep API/client payloads aligned: legs & ranking restricted to key basket. */
function filterToKeyBasket(data) {
  if (!data) return data;
  const legs = (data.legs || []).filter(
    (l) => KEY_LEG_SET.has(String(l.id || "").toUpperCase())
  );
  const ranking = (data.ranking || []).filter(
    (r) => KEY_LEG_SET.has(String(r.id || "").toUpperCase())
  );
  const maxAbs = Math.max(...ranking.map((r) => Math.abs(r.score || 0)), 1e-9);
  for (const r of ranking) {
    r.normalized = Number(((r.score || 0) / maxAbs).toFixed(4));
  }
  return { ...data, legs, ranking };
}

function fillKpis(data) {
  const { kpi, code } = data;

  if (kpi?.vsInr) {
    setText("cmpKpiInrLbl", kpi.vsInr.label);
    setText("cmpKpiInr", formatNum(kpi.vsInr.value));
    setText(
      "cmpKpiInrSub",
      [
        kpi.vsInr.unit,
        kpi.vsInr.inverse != null
          ? `inv ${formatNum(kpi.vsInr.inverse)} ${kpi.vsInr.inverseUnit || ""}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    );
  }
  if (kpi?.vsUsd) {
    setText("cmpKpiUsdLbl", kpi.vsUsd.label);
    setText("cmpKpiUsd", formatNum(kpi.vsUsd.value));
    setText(
      "cmpKpiUsdSub",
      [
        kpi.vsUsd.unit,
        kpi.vsUsd.inverse != null ? `inv ${formatNum(kpi.vsUsd.inverse)}` : "",
        kpi.vsUsd.nativeNote || "",
      ]
        .filter(Boolean)
        .join(" · ")
    );
  } else {
    setText("cmpKpiUsd", "—");
    setText("cmpKpiUsdSub", "USD not in snapshot");
  }
  if (kpi?.vsGold) {
    setText("cmpKpiGoldLbl", kpi.vsGold.label);
    setText("cmpKpiGold", formatNum(kpi.vsGold.value, 8));
    const goldBits = [kpi.vsGold.unit];
    if (kpi.vsGold.inverse != null) {
      goldBits.push(`inv ${formatNum(kpi.vsGold.inverse)} ${code}/oz`);
    }
    if (kpi.vsGold.usdPerOz != null) goldBits.push(`$${formatNum(kpi.vsGold.usdPerOz)}/oz`);
    if (kpi.vsGold.inrPerOz != null) goldBits.push(`₹${formatNum(kpi.vsGold.inrPerOz)}/oz`);
    setText("cmpKpiGoldSub", goldBits.join(" · "));
  } else {
    setText("cmpKpiGold", "—");
    setText("cmpKpiGoldSub", "gold not in snapshot");
  }
}

function fillLegs(legs) {
  const body = $("cmpLegsBody");
  if (!body) return;
  body.innerHTML = "";
  if (!legs?.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No basket legs</td></tr>`;
    return;
  }
  for (const leg of legs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(leg.label || leg.id)}</strong>
        <div class="muted tiny">${escapeHtml(leg.kind || "")}</div>
      </td>
      <td class="mono">${escapeHtml(formatNum(leg.unitsPerSelected))}
        <div class="muted tiny">${escapeHtml(leg.quoteNote || "")}</div>
      </td>
      <td class="mono">${escapeHtml(formatNum(leg.selectedPerUnit))}
        <div class="muted tiny">${escapeHtml(leg.inverseNote || "")}</div>
      </td>
      <td class="mono ${chgClass(leg.deltaPct)}">${escapeHtml(formatPct(leg.deltaPct))}</td>
      <td class="muted">${escapeHtml(leg.unit || "")}</td>
    `;
    body.appendChild(tr);
  }
}

function drawRankCanvas(ranking) {
  const canvas = $("cmpRankCanvas");
  if (!canvas) return;
  const items = ranking || [];
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = canvas.clientHeight || 200;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const tok = themeTokens();
  if (!items.length) {
    ctx.fillStyle = tok.muted;
    ctx.font = "11px JetBrains Mono, IBM Plex Mono, monospace";
    ctx.fillText("No ranking data", 12, 24);
    return;
  }

  const padL = 8;
  const padR = 8;
  const padT = 16;
  const padB = 28;
  const n = items.length;
  const gap = 6;
  const barW = Math.max(10, (cssW - padL - padR - gap * (n - 1)) / n);
  const plotH = cssH - padT - padB;
  const zeroY = padT + plotH / 2;

  ctx.strokeStyle = tok.border;
  ctx.beginPath();
  ctx.moveTo(padL, zeroY);
  ctx.lineTo(cssW - padR, zeroY);
  ctx.stroke();

  for (let i = 0; i < n; i++) {
    const score = Number(items[i].normalized) || 0;
    const x = padL + i * (barW + gap);
    const h = Math.abs(score) * (plotH / 2);
    const y = score >= 0 ? zeroY - h : zeroY;
    ctx.fillStyle = score >= 0 ? tok.ok : tok.danger;
    ctx.fillRect(x, y, barW, Math.max(2, h));

    ctx.fillStyle = tok.muted;
    ctx.font = "10px JetBrains Mono, IBM Plex Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(items[i].id || "").slice(0, 5), x + barW / 2, cssH - 8);

    if (n <= 16) {
      ctx.fillStyle = tok.text;
      ctx.font = "9px JetBrains Mono, IBM Plex Mono, monospace";
      ctx.fillText(formatPct(items[i].score), x + barW / 2, Math.max(12, y - 4));
    }
  }
}

function fillRanking(ranking) {
  const list = $("cmpRankBars");
  if (list) {
    list.innerHTML = "";
    if (!ranking?.length) {
      list.innerHTML = `<div class="muted">No session Δ% pairs available for ranking.</div>`;
    } else {
      for (const r of ranking) {
        const row = document.createElement("div");
        row.className = "rank-row";
        const pct = Math.round(Math.abs(r.normalized || 0) * 100);
        const side = (r.score || 0) >= 0 ? "strong" : "weak";
        row.innerHTML = `
          <div class="rank-label">${escapeHtml(r.label || r.id)}</div>
          <div class="rank-track">
            <div class="rank-mid"></div>
            <div class="rank-fill ${side}" style="width:${pct}%;${
              (r.score || 0) >= 0 ? "left:50%" : `right:50%;left:auto`
            }"></div>
          </div>
          <div class="rank-score mono ${chgClass(r.score)}">${escapeHtml(formatPct(r.score))}</div>
        `;
        list.appendChild(row);
      }
    }
  }
  drawRankCanvas(ranking);
}

function fillNarrative(data) {
  setText("cmpNarrative", data.narrative || "—");
  setText("cmpMethodNote", data.method || "");
  const ul = $("cmpMissingNotes");
  if (ul) {
    ul.innerHTML = "";
    for (const note of data.missingNotes || []) {
      const li = document.createElement("li");
      li.textContent = note;
      ul.appendChild(li);
    }
  }
}


function fillCorrelations(corr) {
  const body = $("cmpCorrBody");
  if (!body) return;
  body.innerHTML = "";
  if (!corr?.rows?.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No correlation window</td></tr>`;
    setText("cmpCorrNote", "History required for correlations.");
    setText("cmpCorrMethod", "");
    return;
  }
  for (const row of corr.rows) {
    const tr = document.createElement("tr");
    const rho =
      row.corr == null
        ? "—"
        : row.corr.toFixed(2);
    const barW =
      row.corr == null ? 0 : Math.round(Math.abs(row.corr) * 80);
    tr.innerHTML = `
      <td>${escapeHtml(row.label || row.id)}</td>
      <td class="mono ${row.corr == null ? "muted" : chgClass(row.corr)}">${escapeHtml(rho)}${
        barW
          ? `<span class="corr-bar" style="width:${barW}px;opacity:${0.35 + Math.abs(row.corr || 0) * 0.65}"></span>`
          : ""
      }</td>
      <td class="mono muted">${row.n || "—"}</td>
      <td class="muted tiny">${escapeHtml(row.note || (row.from && row.to ? `${row.from}→${row.to}` : ""))}</td>
    `;
    body.appendChild(tr);
  }
  setText(
    "cmpCorrNote",
    `Window ≈ ${corr.window} daily returns · scored ${corr.scoredCount}/${corr.rows.length} · ${corr.code}`
  );
  setText("cmpCorrMethod", corr.method || "");
}

/**
 * Populate <select> (+ optional datalist filter) with full selectable universe.
 */
function renderPicker(snap, code, onPick) {
  const codes = majorPickerCodes(snap);
  const select = $("compareSelect");
  const datalist = $("compareCodeList");
  const filterInput = $("compareFilter");

  if (select) {
    const prev = select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select FX / asset…";
    select.appendChild(placeholder);

    // Group: key basket first, then rest
    const key = codes.filter((c) => isKeyBasket(c));
    const rest = codes.filter((c) => !isKeyBasket(c));

    if (key.length) {
      const og = document.createElement("optgroup");
      og.label = "Key basket";
      for (const c of key) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        og.appendChild(opt);
      }
      select.appendChild(og);
    }
    if (rest.length) {
      const og = document.createElement("optgroup");
      og.label = "Full universe";
      for (const c of rest) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        og.appendChild(opt);
      }
      select.appendChild(og);
    }

    if (code && codes.includes(code)) {
      select.value = code;
    } else if (prev && codes.includes(prev) && !code) {
      select.value = "";
    } else {
      select.value = code && codes.includes(code) ? code : "";
    }

    if (!select.dataset.bound) {
      select.dataset.bound = "1";
      select.addEventListener("change", () => {
        const v = select.value;
        if (v) onPick?.(v);
      });
    }
  }

  if (datalist) {
    datalist.innerHTML = "";
    for (const c of codes) {
      const opt = document.createElement("option");
      opt.value = c;
      datalist.appendChild(opt);
    }
  }

  if (filterInput && !filterInput.dataset.bound) {
    filterInput.dataset.bound = "1";
    filterInput.addEventListener("change", () => {
      const v = (filterInput.value || "").trim().toUpperCase();
      if (v && codes.includes(v)) {
        filterInput.value = v;
        onPick?.(v);
      }
    });
    filterInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = (filterInput.value || "").trim().toUpperCase();
        if (v && codes.includes(v)) onPick?.(v);
      }
    });
  }
  if (filterInput && code) filterInput.value = code;

  const unavailHost = $("compareUnavailable");
  if (unavailHost) {
    const hints = listUnavailableHints(snap).slice(0, 6);
    if (hints.length) {
      unavailHost.innerHTML =
        `<span class="muted">Not on ECB:</span> ` +
        hints
          .map(
            (u) =>
              `<span class="unavail-chip" title="${escapeHtml(u.reason)}">${escapeHtml(u.code)}</span>`
          )
          .join(" ");
    } else {
      unavailHost.innerHTML = "";
    }
  }

  setText(
    "compareHint",
    `${codes.length} codes · dropdown = full universe · legs = key basket (${KEY_BASKET_IDS.join(", ")})`
  );
}

/**
 * History spark grid: selected vs each key-basket FX leg.
 */
function renderEventLegend(events, calendar, hostId) {
  const el = $(hostId);
  if (!el) return;
  if (!events?.length) {
    el.innerHTML = calendar?.label
      ? `<span class="muted">${escapeHtml(calendar.label)}</span>`
      : "";
    return;
  }
  el.innerHTML = `
    <span class="muted">${escapeHtml(calendar?.label || "events")}:</span>
    <span class="ev-rbi">RBI</span>
    <span class="ev-fomc">FOMC</span>
    <span class="ev-oil">Oil</span>
    <span class="muted">· ${events.length} in window</span>
  `;
}

function renderHistoryCharts(data, history, calendar) {
  const host = $("cmpSparkGrid");
  const note = $("cmpSparkNote");
  if (!host) return;
  disposeSparkHost(host);
  host.innerHTML = "";

  const code = data.code;
  const series = history?.series || {};
  const selKey = `${code}INR`;
  const selSeries = series[selKey];
  const inRange = eventsInRange(calendar, history?.from, history?.to);
  renderEventLegend(inRange, calendar, "cmpEventLegend");

  const hardIds = new Set(["XAU", "BTC", "BRENT", "WTI"]);
  if (data.kind === "hard" || hardIds.has(code)) {
    if (note) {
      note.textContent = `${code}: level only / no history yet (hard-asset history not invented).`;
    }
    host.innerHTML = `<div class="spark-empty muted">level only / no history yet</div>`;
    return;
  }

  if (!selSeries || selSeries.length < 2) {
    if (note) note.textContent = `No Frankfurter history for ${code} yet.`;
    host.innerHTML = `<div class="spark-empty muted">no history for ${escapeHtml(code)}</div>`;
    return;
  }

  const prefer = ["USD", "EUR", "GBP", "JPY", "CNY", "INR"];
  const legIds = (data.legs || [])
    .filter((l) => l.kind === "fx")
    .map((l) => l.id);
  const ordered = prefer.filter((id) => legIds.includes(id));

  const prepared = [];
  const seriesList = [];
  for (const legId of ordered) {
    let values = [];
    let dates = [];
    let emptyMsg = "no history";
    if (legId === "INR") {
      const d = levelIndexSeriesDated(selSeries);
      values = d.values;
      dates = d.dates;
    } else {
      const legSeries = series[`${legId}INR`];
      const d = relativeIndexSeriesDated(selSeries, legSeries);
      values = d.values;
      dates = d.dates;
      if (!values.length) emptyMsg = "no overlap";
    }
    if (values.length >= 2) seriesList.push(values);
    prepared.push({ legId, values, dates, emptyMsg });
  }

  const band = sharedIndexBand(seriesList);

  if (note) {
    note.textContent = `Lightweight Charts · relative index (start=100), fixed y-band ±${band.half.toFixed(1)} so spikes don’t dominate: ${code} vs key-basket legs · ${history.from || ""}→${history.to || ""} · ${history.dayCount || selSeries.length} days · gold history still missing · markers: ${calendar?.label || "none"}`;
  }

  for (const { legId, values, dates, emptyMsg } of prepared) {
    const card = document.createElement("div");
    card.className = "spark-card";
    const canvas = document.createElement("div");
    canvas.className = "lwc-spark";
    canvas.setAttribute("aria-label", `${code} vs ${legId}`);

    let endDelta = "";
    let endNum = null;
    if (values.length) {
      const last = values[values.length - 1];
      if (Number.isFinite(last)) {
        endNum = last - 100;
        endDelta = `${endNum > 0 ? "+" : ""}${endNum.toFixed(2)}`;
      }
    }
    const deltaHtml = endDelta
      ? `<span class="spark-delta ${chgClass(endNum)}">${escapeHtml(endDelta)}</span>`
      : "";

    card.innerHTML = `<div class="spark-label">${escapeHtml(code)}/${escapeHtml(legId)}${deltaHtml}</div>`;
    card.appendChild(canvas);
    host.appendChild(card);
    requestAnimationFrame(() =>
      drawSpark(canvas, values, {
        emptyMsg,
        dates,
        events: inRange,
        scaleMode: band.scaleMode,
        yMin: band.yMin,
        yMax: band.yMax,
      })
    );
  }
}

function fillTechnicals(techBundle) {
  const strip = $("cmpTechStrip");
  const summary = $("cmpTechSummary");
  const note = $("cmpTechNote");
  const techHost = $("cmpTechSpark");
  if (!strip) return;

  const primary = techBundle?.primary;
  strip.innerHTML = "";
  if (!primary || primary.n < 5) {
    if (summary) summary.textContent = "Insufficient daily history for technical strip.";
    if (note) note.textContent = "Need multi-day series in history.json.";
    if (techHost) drawSparkWithMA(techHost, [], { emptyMsg: "no history" });
    return;
  }

  if (summary) summary.textContent = primary.summary;

  const cells = [
    ["SMA5", primary.sma?.[5]],
    ["SMA10", primary.sma?.[10]],
    ["SMA20", primary.sma?.[20]],
    ["SMA50", primary.sma?.[50]],
    ["RSI(14)", primary.rsi14],
    ["MACD hist", primary.macdHist],
  ];
  for (const [lbl, val] of cells) {
    const div = document.createElement("div");
    div.className = "tech-cell";
    const disp =
      val == null
        ? "—"
        : lbl.startsWith("RSI")
          ? Number(val).toFixed(1)
          : lbl.startsWith("MACD")
            ? Number(val).toFixed(4)
            : formatNum(val);
    div.innerHTML = `<div class="lbl">${escapeHtml(lbl)}</div><div class="num mono">${escapeHtml(String(disp))}</div>`;
    strip.appendChild(div);
  }

  const tags = document.createElement("div");
  tags.className = "tech-tags";
  for (const tag of primary.regimeTags || []) {
    const span = document.createElement("span");
    span.className = "tech-tag";
    span.textContent = tag;
    tags.appendChild(span);
  }
  strip.appendChild(tags);

  if (techBundle.vsUsd?.summary) {
    const vs = document.createElement("div");
    vs.className = "tech-vs muted tiny";
    vs.textContent = `vs-USD: ${techBundle.vsUsd.summary}`;
    strip.appendChild(vs);
  }

  if (techHost && primary.smaSeries) {
    disposeSpark(techHost);
    drawSparkWithMA(techHost, primary.smaSeries.values, {
      ma20: primary.smaSeries.sma20,
      ma50: primary.smaSeries.sma50,
      dates: primary.smaSeries.dates,
      emptyMsg: "no history",
    });
  }
  if (note) {
    note.textContent = `Lightweight Charts · ${primary.label} · n=${primary.n} · as-of ${primary.asOf || "—"} · MA20 cyan · MA50 amber · desk summary only (not a trade signal)`;
  }
}

function fillModelCard(model) {
  const body = $("cmpModelBody");
  if (!body) return;
  body.innerHTML = "";
  if (!model?.rules?.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">Insufficient history for model card</td></tr>`;
    setText("cmpModelFoot", "");
    return;
  }
  for (const r of model.rules) {
    const tr = document.createElement("tr");
    const vClass =
      r.verdict === "KEEP" ? "verdict-keep" : r.verdict === "WEAK" ? "verdict-weak" : "verdict-kill";
    tr.innerHTML = `
      <td>${escapeHtml(r.rule)}</td>
      <td class="mono">${r.n}</td>
      <td class="mono">${r.hitRate != null ? escapeHtml(String(r.hitRate)) + "%" : "—"}</td>
      <td class="mono ${chgClass(r.meanNext5d)}">${r.meanNext5d != null ? escapeHtml(formatPct(r.meanNext5d)) : "—"}</td>
      <td class="mono ${vClass}">${escapeHtml(r.verdict)}</td>
    `;
    body.appendChild(tr);
  }
  setText("cmpModelFoot", model.footnote || "");
}

function fillLeadLag(ll) {
  const head = $("cmpLeadHead");
  const body = $("cmpLeadBody");
  if (!head || !body) return;
  const lags = ll?.lags || [];
  head.innerHTML = `<tr><th>Series</th>${lags
    .map((k) => `<th class="mono">${k}</th>`)
    .join("")}<th>Role</th></tr>`;
  body.innerHTML = "";
  if (!ll?.rows?.length) {
    body.innerHTML = `<tr><td colspan="${lags.length + 2}" class="muted">${escapeHtml(
      ll?.note || "No lead-lag window"
    )}</td></tr>`;
  } else {
    for (const row of ll.rows) {
      const tr = document.createElement("tr");
      const cells = lags
        .map((k) => {
          const c = row.cells?.[k];
          const txt = c == null ? "—" : c.toFixed(2);
          const cls = c == null ? "muted" : chgClass(c);
          const hi = row.bestLag === k && c != null ? " lead-best" : "";
          return `<td class="mono ${cls}${hi}">${escapeHtml(txt)}</td>`;
        })
        .join("");
      tr.innerHTML = `
        <td>${escapeHtml(row.label)}</td>
        ${cells}
        <td class="muted tiny">${escapeHtml(row.role || "")}</td>
      `;
      body.appendChild(tr);
    }
  }
  const bits = [ll?.note || ""];
  if (ll?.hardAssetNote) bits.push(ll.hardAssetNote);
  setText("cmpLeadNote", bits.filter(Boolean).join(" · "));
  setText("cmpLeadMethod", ll?.method || "");
}

/**
 * @param {object} snap
 * @param {string|null} code
 * @param {(code: string) => void} onPick — hash navigation callback
 */
export async function renderCompare(snap, code, onPick) {
  renderPicker(snap, code, onPick);

  const view = $("compareView");
  const hint = $("compareHint");

  // Never leave Compare on an empty pick-a-code dead end — default USD
  if (!code) code = "USD";

  const result = await loadCompare(code, snap);
  if (result.error === "not_found") {
    if (view) view.hidden = true;
    const reason = result.body?.reason || "not in snapshot";
    setText("cmpStatus", `Unknown / unavailable “${code}” — ${reason}. Pick one above.`);
    const unavailHost = $("compareUnavailable");
    if (unavailHost) {
      unavailHost.innerHTML = `<span class="unavail-chip">${escapeHtml(code)} · ${escapeHtml(reason)}</span>`;
    }
    return;
  }

  let data = result.data;
  if (!data.selectable?.length) data.selectable = majorPickerCodes(snap);
  data = filterToKeyBasket(data);

  // Keep select in sync with hash / deep-link
  const select = $("compareSelect");
  if (select && select.value !== data.code) select.value = data.code;
  const filterInput = $("compareFilter");
  if (filterInput) filterInput.value = data.code;

  if (view) view.hidden = false;
  setText(
    "cmpStatus",
    `Compare ${data.code} via ${result.via} · ${data.asOf || ""} · ${data.legs?.length || 0} key-basket legs`
  );

  fillKpis(data);
  fillLegs(data.legs);
  fillRanking(data.ranking);
  fillNarrative(data);

  const [histLoaded, evLoaded] = await Promise.all([loadHistory(), loadEvents()]);
  const corr = buildCorrelations(histLoaded.data, data.code);
  fillCorrelations(corr);
  renderHistoryCharts(data, histLoaded.data, evLoaded.data);

  const tech = buildCompareTechnicals(histLoaded.data, data.code);
  fillTechnicals(tech);
  const modelSeries =
    data.code === "INR"
      ? histLoaded.data?.series?.USDINR
      : histLoaded.data?.series?.[`${data.code}INR`];
  const model = buildModelCard(modelSeries || [], data.code === "INR" ? "USDINR" : `${data.code}INR`);
  const ll = buildLeadLag(histLoaded.data);
  fillLeadLag(ll);
  const selVol = buildSelectedRegime(histLoaded.data, data.code);
  if (selVol?.vol7 != null || selVol?.vol30 != null) {
    const note = $("cmpTechNote");
    if (note && selVol.vol7 != null) {
      note.textContent += ` · ${selVol.code} vs-USD vol 7d ${selVol.vol7}% / 30d ${selVol.vol30 ?? "—"}%`;
    }
  }

  window.__compareData = data;
  window.__compareCorr = corr;
  window.__compareTech = tech;
  window.__compareModel = model;
  const onResize = () => {
    drawRankCanvas(data.ranking);
    renderHistoryCharts(data, histLoaded.data, evLoaded.data);
    fillTechnicals(tech);
  };
  window.removeEventListener("resize", window.__cmpResize);
  window.__cmpResize = onResize;
  window.addEventListener("resize", onResize);
}

/** Client-only compute (used by validate smoke / offline). */
export { buildCompare };
