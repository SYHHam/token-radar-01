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
by 2^0.6027, about 1.52 times. The category multiplier changed in version 3.
It used to come from each category's median cap/TVL ratio. Now it comes from
each category's median log residual after the TVL curve, because a raw ratio
mixes up what a category is worth with how big its protocols usually are.
The multiplier is still pulled halfway toward 1, since each median rests on
as few as 5 comps.

Age is still out. A joint fit puts its coefficient at -0.004, near zero, and
the number swings widely across folds, so age is shown on every row but does
not move the value. Version 1 charged young protocols for being young, and
the blind test caught it. The dashboard shows the measured coefficient and
says why it is left out.

It validates four ways, and shows the numbers: leave-one-out, walk-forward
over listing cohorts (3 folds, pooled), a blind newest-20% test, and a hash
holdout (a fixed fifth of comps by slug hash), each against a flat-multiple
baseline. Leave-one-out gains 11.8% on log error (3.17x median miss against
a flat 4.48x). Walk-forward gains 15.0% (2.54x against 4.61x). The blind
test gains 8.1% (2.48x against 4.06x), up from 6.1% in version 2. The hash
holdout gains 2.3% (3.71x against 4.86x). The leave-one-out 80% interval
covers 84.8% of comps, against 80% nominal. The dashboard also shows an
ablation table, one row per piece of the model on the same splits, so a
reader can see what each part earns. Residual-based categories beat the
raw-ratio version on every split. The snapshot carries no token-launch
dates, so these tests measure generalisation across listing cohorts, not a
historical backtest. The dashboard says so.

Uncertainty sits on every row: 200 bootstrap refits give a P10 to P90 fitted
value, a P10 to P90 rank range, a top-20 probability and a farm probability.
The dashboard adds a residual plot and a per-category table. Lending misses
widest and runs high; RWA is the tightest fit. The widest misses are
versioned comps: Aave V2 carries the whole AAVE market cap against one
version's TVL, so it sits far above the curve, and the Huber fit downweights
those points instead of chasing them.

Every row carries a farm plan that is costed and netted. The deposit is sized
by TVL tier, gas is charged on the protocol's cheapest chain, and the plan
shows cash and economic cost over 90 days, an expected net under a stated
reference scenario (30% chance, 5% of implied value, split over the estimated
farmers), a break-even implied value and a break-even distribution chance,
and a verdict: farm, thin or skip. The split is 39 farm, 53 thin, 106 skip.
Skip rows now get a monitor-only plan instead of a deposit plan: no capital
in, a monthly check, and the value and chance that would flip the verdict.
The detail view adds a scenario grid, net at a 10%, 30% and 50% distribution
chance, so the verdict can be read against its own assumptions. Value is not
farmability: the biggest launches are the most crowded, so the farmable edge
sits below the floor. All 40 watchlist rows skip. The best of them, Yuzu
Money, nets -$5.18 over 90 days, the median -$44.56, and Yuzu Money would
need a 33.5% distribution chance to break even, against the 30% the reference
scenario assumes. Even at a $100 deposit and 2 hours of time, only 9 of the
40 turn positive, the best by +$11.97, and none reaches farm. The dashboard
shows the same arithmetic live, so the numbers there always match the board.

Rank 1 is Sentora Curator at $134.9M of implied value. Rank 198 is Granite
at $2.40M.

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
- `lib/model.ts`: the audit, the fitted curve, the four validation tests,
  the ablation table, the bootstrap bands and the costed farm plans.
- `dashboard/`: `index.html`, `app.css`, `app.js`: the board, the watchlist
  at a glance, the model and validation evidence, the comps curve, the
  residual plot, filters, and a detail view per protocol. Static, no network.
- `screenshots/`: the board, a protocol detail view and a filtered view.
- `vendor/makefun-board.ts`: make.fun's dossier library, copied unchanged.
