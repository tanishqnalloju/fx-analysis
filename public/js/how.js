/**
 * `/how` — methodology, assumptions, long sources, integrity (once).
 * Insider tokens (KEEP/WEAK/KILL, cron internals) live here only.
 */
import { $, escapeHtml, setText, loadHistory } from "./util.js";
import { buildModelCard } from "./research.js";

export async function renderHow(snap) {
  setText(
    "howIntegrity",
    "Integrity: every public number comes from the Worker snapshot (Frankfurter/ECB preferred, FloatRates extras only when not on ECB, hard-asset USD prints carried when present, BTC via Coinbase when fetch succeeds). The client never invents prices, REER/NEER, or hard-asset history."
  );

  setText(
    "howQuote",
    "FX quotes are INR per 1 foreign unit (USDINR, EURINR, …). Crosses use an INR bridge: units of X per 1 S = inrPer[S] / inrPer[X]. Higher XXXINR ⇒ weaker INR in FX terms. JPY is shown as ₹ per 100 JPY on the desk (per-1 secondary)."
  );

  setText(
    "howDelta",
    "Session Δ is the percent change of the INR-per-1 rate (or hard-asset print) versus the prior observation stored in the snapshot. Oil and gold INR = usdPrice × USDINR when a USD print exists."
  );

  setText(
    "howSourcesLead",
    "Prefer Frankfurter/ECB. FloatRates fills codes absent from ECB and may lag. US Treasury 2y/10y from the daily CSV when fetch succeeds. Gold/oil USD prints are carried from the prior validated snapshot — never invented. Multi-day hard-asset history is omitted until a sourced feed exists (REER/NEER panel stays hidden for the same reason)."
  );

  const list = $("howAssumptions");
  if (list) {
    list.innerHTML = "";
    for (const a of snap.assumptions || []) {
      const li = document.createElement("li");
      li.textContent = a;
      list.appendChild(li);
    }
    if (!(snap.assumptions || []).length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No assumptions array in snapshot.";
      list.appendChild(li);
    }
  }

  const sources = $("howSources");
  if (sources) {
    sources.innerHTML = "";
    for (const s of snap.scriptures || []) {
      const li = document.createElement("li");
      li.textContent = s;
      sources.appendChild(li);
    }
  }

  setText("howTimezone", snap.timezoneNote || "");

  // Model card / KEEP·WEAK·KILL — /how only
  const hist = await loadHistory();
  const series = hist.data?.series?.USDINR;
  const host = $("howModelBody");
  const foot = $("howModelFoot");
  if (host) {
    host.innerHTML = "";
    if (series?.length) {
      const model = buildModelCard(series, "USDINR");
      for (const r of model.rules || []) {
        const tr = document.createElement("tr");
        const vClass =
          r.verdict === "KEEP" ? "verdict-keep" : r.verdict === "WEAK" ? "verdict-weak" : "verdict-kill";
        tr.innerHTML = `
          <td>${escapeHtml(r.rule)}</td>
          <td class="mono">${r.n}</td>
          <td class="mono">${r.hitRate != null ? escapeHtml(String(r.hitRate)) + "%" : "—"}</td>
          <td class="mono">${r.meanNext5d != null ? escapeHtml(String(r.meanNext5d)) + "%" : "—"}</td>
          <td class="mono ${vClass}">${escapeHtml(r.verdict)}</td>
        `;
        host.appendChild(tr);
      }
      if (foot) foot.textContent = model.footnote || "";
    } else {
      host.innerHTML = `<tr><td colspan="5" class="muted">Insufficient history</td></tr>`;
      if (foot) foot.textContent = "";
    }
  }

  setText(
    "howCronNote",
    "Board refresh: scheduled Worker job writes KV daily (~03:30 UTC). Public UI shows series freshness (live / T−1 / stale), not internal cron labels."
  );
}
