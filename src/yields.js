/**
 * US Treasury daily yield curve helpers (CSV parse).
 * Never invent yields — return null fields when parse/fetch fails.
 */

const TREASURY_SOURCE =
  "U.S. Treasury Daily Treasury Yield Curve Rates (home.treasury.gov)";

/** MM/DD/YYYY → YYYY-MM-DD */
export function parseTreasuryDate(raw) {
  const m = String(raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

/**
 * Parse Treasury daily yield CSV text.
 * @returns {{ rows: { t: string, us2y: number, us10y: number }[], latest: object|null }}
 */
export function parseTreasuryYieldCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { rows: [], latest: null };

  const header = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const idxDate = header.findIndex((h) => /^date$/i.test(h));
  const idx2 = header.findIndex((h) => /^2\s*yr$/i.test(h));
  const idx10 = header.findIndex((h) => /^10\s*yr$/i.test(h));
  if (idxDate < 0 || idx2 < 0 || idx10 < 0) return { rows: [], latest: null };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    const t = parseTreasuryDate(cols[idxDate]);
    const us2y = Number(cols[idx2]);
    const us10y = Number(cols[idx10]);
    if (!t || !Number.isFinite(us2y) || !Number.isFinite(us10y)) continue;
    rows.push({
      t,
      us2y: Number(us2y.toFixed(4)),
      us10y: Number(us10y.toFixed(4)),
    });
  }
  rows.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const last = rows[rows.length - 1] || null;
  const latest = last
    ? {
        asOf: last.t,
        us2y: last.us2y,
        us10y: last.us10y,
        us10yMinus2y: Number((last.us10y - last.us2y).toFixed(4)),
        source: TREASURY_SOURCE,
      }
    : null;
  return { rows, latest };
}

export function treasuryCsvUrl(yyyymm) {
  // yyyymm like "202609"
  const year = String(yyyymm).slice(0, 4);
  return (
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/` +
    `daily-treasury-rates.csv/all/${yyyymm}?type=daily_treasury_yield_curve` +
    `&field_tdr_date_value=${year}&page&_format=csv`
  );
}

/**
 * Fetch Sep + Aug (or current month + prior) Treasury CSVs and merge.
 * @param {(url: string, opts?: object) => Promise<string>} fetchText
 */
export async function fetchTreasuryYields(fetchText, { now = new Date() } = {}) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  const cur = `${y}${String(m).padStart(2, "0")}`;
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const prev = `${prevY}${String(prevM).padStart(2, "0")}`;

  const byDate = new Map();
  const notes = [];
  for (const yyyymm of [prev, cur]) {
    const url = treasuryCsvUrl(yyyymm);
    try {
      const text = await fetchText(url, { label: `treasury/${yyyymm}` });
      const { rows } = parseTreasuryYieldCsv(text);
      if (!rows.length) {
        notes.push(`treasury ${yyyymm}: parsed 0 rows`);
        continue;
      }
      for (const r of rows) byDate.set(r.t, r);
      notes.push(`treasury ${yyyymm}: ${rows.length} rows`);
    } catch (e) {
      notes.push(`treasury ${yyyymm} failed: ${e.message || e}`);
    }
  }

  const rows = [...byDate.values()].sort((a, b) =>
    a.t < b.t ? -1 : a.t > b.t ? 1 : 0
  );
  const last = rows[rows.length - 1] || null;
  const yields = last
    ? {
        asOf: last.t,
        us2y: last.us2y,
        us10y: last.us10y,
        us10yMinus2y: Number((last.us10y - last.us2y).toFixed(4)),
        source: TREASURY_SOURCE,
      }
    : {
        asOf: null,
        us2y: null,
        us10y: null,
        us10yMinus2y: null,
        source: TREASURY_SOURCE,
        note: "fetch/parse failed — yields not invented",
      };

  return { yields, rows, notes };
}

export { TREASURY_SOURCE };
