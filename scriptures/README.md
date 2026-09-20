# Scriptures / methodology

How the **FX Analysis** desk interprets the baked snapshot (Desk · Compare · Slip/Rank tabs).

## FX strength

- Snapshot FX rows are **INR per 1 foreign unit** (e.g. USDINR, EURINR, SGDINR) across the full **Frankfurter/ECB** universe (~30 codes).
- Optional **FloatRates** extras (e.g. AED) appear only when that fetch succeeds and the code is **not** on Frankfurter — prefer Frankfurter when both exist. Extras are labeled `notOnEcb`.
- **Higher USDINR (and higher XXXINR) = weaker INR** in FX terms: more rupees buy one unit of foreign currency.
- Session Δ% for Frankfurter pairs is prior ECB business day → latest from the refresh timeseries. Client never invents moves.
- Currencies not on ECB (and not merged from FloatRates) are labeled unavailable in Compare (e.g. AED if FloatRates failed).

## Hard assets

- Hard assets (gold, Brent, WTI, BTC) report both **USD** and **INR** prices.
- INR cost is typically `usdPrice × USDINR` for the same session.
- **Higher INR cost of hard assets** means weaker real purchasing power of the rupee versus those assets.
- **No invented hard-asset history** — charts say “level only / no history yet” when only a point print exists.

## History

- `public/data/history.json` stores multi-day Frankfurter/ECB INR-cross series (`USDINR`, `EURINR`, …).
- Compare sparks: selected vs each basket leg as a relative index (start=100).
- Slip matrix prefers multi-day FX moves when history is present; hard legs fall back to session Δ% or blank.

## Real-strength legs (Desk)

- `realStrength` is **desk commentary**, not a formal REER, CPI basket, or **PPP** index.
- Optional live FX overlay (Frankfurter/ECB `latest?from=USD`) refreshes **all** available USD rates → INR pairs and recomputes INR hard prices; USD hard prints stay baked until refresh.

## Compare / Slip

- Cross rates via **INR bridge**: units of X per 1 S = `inrPer[S] / inrPer[X]` (or hard `inrPrice`).
- Ranking / slip scores ≈ Δ%selected − Δ%leg. Missing Δ% → blank cell — never invented.
- Compare picker is searchable across the full FX + hard-asset universe.
- Slip shows a scrollable full-matrix heatmap plus per-currency sparks vs USD (and vs gold when history exists).

## Refresh

```bash
npm run refresh   # Frankfurter currencies+latest+history, optional FloatRates, Coinbase BTC
npm run validate
npm run build
```

## Do not invent

- Missing EM FX stay omitted or labeled unavailable.
- Copper/wheat/natgas/crypto-index noted only if absent.
- Hard-asset multi-day series are never fabricated.
