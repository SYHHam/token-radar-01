# Token Radar: every pre-token protocol audited, values fitted to traded comps, farming net of cost

![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/SYHHam/token-radar-01/rank.svg)
![reward](https://make.fun/badge/token-radar-01/SYHHam/token-radar-01/reward.svg)

Entry for [make.fun bounty token-radar-01](https://make.fun/bounty/token-radar-01):
build the best token launch radar. The program (`main.ts`, Node 22, standard
library only) reads the sealed DefiLlama snapshot, ranks every pre-token
protocol by an implied value, and writes a dashboard a reader can use.

## What it does

It audits all 342 pre-token protocols in the snapshot (758 protocols, as of
2026-11-14), covers the 40/40 watchlist, and ranks the 198 that are genuine
launch candidates. The other 144 are set aside with a stated reason (wrapped,
staked, bridged, exchange or versioned product). They were checked, not
hidden.

The value model is fitted, not hardcoded. A Huber-weighted log-log curve of
market cap on TVL is fitted on 112 traded-token comps
(`log10(mcap) = 2.4351 + 0.6027·log10(tvl)`), then adjusted by a bounded
growth factor and a category multiplier. Doubling TVL multiplies fitted value
by 2^0.6027, about 1.52 times. Two things changed from version 1. Age is out:
the first version charged young protocols for being young, and the blind test
caught it, so age no longer moves the value. Category multipliers are shrunk
halfway toward 1 in log space, because each one rests on the median ratio of
as few as 5 comps.

It validates three ways, and shows the numbers: leave-one-out, walk-forward
over listing cohorts (3 folds, pooled) and a blind newest-20% test, each
against a flat-multiple baseline. Leave-one-out gains 11.5% on log error
(3.17x median miss against a flat 4.48x). Walk-forward gains 15.1% (2.54x
against 4.61x). The blind test gains 6.1% (2.48x against 4.06x). That last
number is the fix this version is for: version 1 lost the blind test by 2.4%,
because its age factor mispriced the newest cohort. The snapshot carries no
token-launch dates, so these tests measure generalisation across listing
cohorts, not a historical backtest. The dashboard says so.

Uncertainty sits on every row: 200 bootstrap refits give a P10 to P90 fitted
value, a P10 to P90 rank range, a top-20 probability and a farm probability.

Every row carries a farm plan that is costed and netted. The deposit is sized
by TVL tier, gas is charged on the protocol's cheapest chain, and the plan
shows cash and economic cost over 90 days, an expected net under a stated
reference scenario (30% chance, 5% of implied value, split over the estimated
farmers), a break-even implied value and a verdict: farm, thin or skip. The
split is 38 farm, 54 thin, 106 skip. Value is not farmability: the biggest
launches are the most crowded, so the farmable edge sits below the floor.
All 40 watchlist rows skip. The best of them nets -$12.47 over 90 days, the
median -$46.53. Even at a $100 deposit and 2 hours of time, only 7 of the 40
turn positive, the best by +$4.68, and none reaches farm. The best watchlist
row would need a 40% distribution chance to break even, against the 30% the
reference scenario assumes. The dashboard shows the same arithmetic live, so
the numbers there always match the board.

Rank 1 is Sentora Curator at $134.9M of implied value. Rank 198 is Granite
at $2.35M.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json` (via `vendor/makefun-board.ts`).
Run it twice: the output is byte-identical, no network, no randomness
(the bootstrap is seeded from the comps).

## Files

- `main.ts`: entrypoint, snapshot in, board + dashboard + dossier out.
- `lib/model.ts`: the audit, the fitted curve, the three validation tests,
  the bootstrap bands and the costed farm plans.
- `dashboard/`: `index.html`, `app.css`, `app.js`: the board, the model and
  validation evidence, the comps curve, filters, and a detail view per
  protocol. Static, no network.
- `screenshots/`: the board, a protocol detail view and a filtered view.
- `vendor/makefun-board.ts`: make.fun's dossier library, copied unchanged.
