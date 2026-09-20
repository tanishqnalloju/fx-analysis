/**
 * Homepage `/` — short story + today’s verdict.
 */
import { $, escapeHtml, setText, formatRate, formatPct, chgClass } from "./util.js";
import { buildHomeVerdict, buildRealStrengthBlurb, SITE_ORIGIN } from "./takeaway.js";
import { buildRegime } from "./research.js";
import { loadHistory } from "./util.js";

function findFx(fx, pair) {
  return (fx || []).find((r) => r.pair === pair) || null;
}

export async function renderHome(snap) {
  const hist = await loadHistory();
  const regime = buildRegime(snap, hist.data);
  const strength = buildRealStrengthBlurb(snap, regime);
  const verdict = buildHomeVerdict(snap, regime, strength);
  const usd = findFx(snap.fx, "USDINR");

  setText("homeAsOf", verdict.asOf || "—");
  setText("homeUsdInr", usd ? formatRate(usd.rate) : "—");
  const chg = $("homeUsdChg");
  if (chg) {
    chg.textContent = usd ? formatPct(usd.changePct) : "—";
    chg.className = `home-chg mono ${chgClass(usd?.changePct)}`;
  }
  setText("homeShock", verdict.shock || "Calm");
  setText("homeLabel", verdict.label);
  setText("homeVerdict1", verdict.sentence1);
  setText("homeVerdict2", verdict.sentence2);
  setText("homeStrength1", strength.sentence1);
  setText("homeStrength2", strength.sentence2);

  const noteLink = $("homeNoteLink");
  if (noteLink && verdict.asOf) {
    noteLink.href = `/notes/${verdict.asOf}`;
    noteLink.textContent = `Daily note · ${verdict.asOf}`;
  }

  const quote = $("homeQuoteLesson");
  if (quote) {
    quote.innerHTML = escapeHtml(
      "Quote convention (used everywhere on this desk): rates are INR per 1 foreign unit (e.g. USDINR). A higher XXXINR means a weaker rupee in FX terms."
    );
  }

  setText("homeResearchLine", "Research / education only — snapshot numbers, nothing invented client-side.");
}
