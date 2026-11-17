# Token Radar — every pre-token protocol audited, values fitted to traded comps, farming net of cost

![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/SYHHam/token-radar-01/rank.svg)
![reward](https://make.fun/badge/token-radar-01/SYHHam/token-radar-01/reward.svg)

Entry for [make.fun bounty token-radar-01](https://make.fun/bounty/token-radar-01):
build the best token launch radar. The program (`main.ts`, Node 22, standard
library only) reads the sealed DefiLlama snapshot, ranks every pre-token
protocol by an implied value, and writes a dashboard a reader can use.

## What it does

- **Audits all 342 pre-token protocols** in the snapshot (758 protocols,
  as of 2026-11-14), covers the **40/40 watchlist**, and ranks the 198 that
  are genuine launch candidates. The other 144 are set aside with a stated
  reason (wrapped, staked, bridged, exchange or versioned product) — audited,
  not hidden.
- **Fits the value model, it does not hardcode it.** A Huber-weighted
  log-log curve of market cap on TVL is fitted on 112 traded-token comps
  (`log10(mcap) = a + b·log10(tvl)`), then adjusted by bounded growth, age
  and category factors. Doubling TVL multiplies fitted value by 2^b.
- **Validates three ways, and shows the numbers:** leave-one-out,
  walk-forward over listing cohorts (3 folds, pooled) and a blind newest-20%
  test, each against a flat-multiple baseline. The snapshot carries no
  token-launch dates, so these tests measure generalisation across listing
  cohorts, not a historical backtest — the dashboard says so.
- **Uncertainty on every row:** 200 bootstrap refits give a P10–P90 fitted
  value, a P10–P90 rank range, a top-20 probability and a farm probability.
- **Farm plans costed and netted:** every row carries a deposit sized by TVL
  tier, gas on its cheapest chain, cash and economic cost over 90 days, an
  expected net under a stated reference scenario (30% chance, 5% of implied
  value, split over the estimated farmers), a break-even implied value and a
  verdict — **farm / thin / skip**. Value is not farmability: the biggest
  launches are the most crowded, so the farmable edge sits below the floor.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json` (via `vendor/makefun-board.ts`).
Run it twice: the output is byte-identical, no network, no randomness
(the bootstrap is seeded from the comps).

## Files

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the audit, the fitted curve, the three validation tests,
  the bootstrap bands and the costed farm plans.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the board, the model and
  validation evidence, the comps curve, filters, and a detail view per
  protocol. Static, no network.
- `screenshots/` — the board, a protocol detail view and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied unchanged.
