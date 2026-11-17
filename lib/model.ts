// Token Radar's value model: a comps-fitted size curve, validated out of sample,
// with a costed, netted farm decision on every ranked row.
//
// The snapshot is the only input. Traded tokens are the comps: the model fits
// log10(market cap) on log10(TVL) over the traded protocols whose TVL is
// economically relevant, then applies that curve to the pre-token protocols,
// adjusted by bounded growth, age and category factors. Nothing here names a
// protocol: the same functions score every row, and every number the dashboard
// shows (fit, validation misses, bootstrap bands, farm verdicts) is computed
// at run time from the snapshot alone.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'comps-fit-1';

/** Growth elasticity: fitted on the full comps it is ~0.05-0.10; the model uses 0.10. */
export const GROWTH_ELASTICITY = 0.1;
/** Age elasticity: fitted on the full comps it is ~0.30; the model uses 0.25. */
export const AGE_ELASTICITY = 0.25;
/** Bootstrap refits behind every row's P10-P90 band and rank range. */
export const BOOTSTRAP_REFITS = 200;
/** Farm horizon, opportunity cost and the value of the farmer's time. */
export const FARM_DAYS = 90;
export const OPPORTUNITY_RATE = 0.05;
export const HOUR_VALUE_USD = 15;
/** Reference distribution scenario: 30% chance, 5% of implied value, split over F farmers. */
export const DIST_PROBABILITY = 0.3;
export const DIST_SHARE = 0.05;

const DAY_MS = 86_400_000;
let AS_OF_MS = Date.parse('2026-11-14T00:00:00Z');

/** The snapshot's date, set by buildRadar before any fit: ages are measured to it. */
export function setAsOf(asOf: string): void {
  const ms = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isFinite(ms)) AS_OF_MS = ms;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const clip = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const median = (xs: number[]): number => {
  const t = [...xs].sort((a, b) => a - b);
  return t.length === 0 ? 0 : t[Math.floor(t.length / 2)]!;
};
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to the snapshot date; null when unknown or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token at all for this protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are never a launch of their own: wrapped, staked, bridged, exchange. */
export const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Why a pre-token protocol is set aside instead of ranked, or null when rankable. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return `category ${p.category} is a wrapped, staked, bridged or exchange product`;
  if (VERSIONED.test(p.name)) return 'name ends in a version marker, so it is a pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'name carries wrapped, staked or staking: a product of a token that trades';
  if (EXCHANGE_PREFIX.test(p.name)) return 'name begins with an exchange: an exchange product, not a launch';
  return null;
}

/** The traded protocols the curve is fitted on, with the exclusion ledger. */
export function selectComps(snapshot: Snapshot): { comps: SnapshotProtocol[]; excluded: { cex: number; ratio: number; nonpositive: number } } {
  const excluded = { cex: 0, ratio: 0, nonpositive: 0 };
  const comps: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.category === 'CEX') { excluded.cex++; continue; }
    if (!(p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)) { excluded.nonpositive++; continue; }
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < 0.005 || ratio > 20) { excluded.ratio++; continue; }
    comps.push(p);
  }
  comps.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { comps, excluded };
}

// ---------------------------------------------------------------- the fit

export interface Fit {
  a: number;
  b: number;
  catMult: Record<string, number>;
  medGrowthLog: number;
  medAgeYrs: number;
  globalRatio: number;
}

const growthLog = (p: SnapshotProtocol, fallback: number): number =>
  p.change_7d === null ? fallback : Math.log(1 + clip(p.change_7d / 100, -0.95, 3));
const ageYrs = (p: SnapshotProtocol, fallback: number): number =>
  p.listed_at === null ? fallback : Math.max(0, (AS_OF_MS - Date.parse(`${p.listed_at}T00:00:00Z`)) / DAY_MS / 365);

/**
 * The fitted pipeline on a training set of comps: a Huber-weighted log-log OLS
 * of market cap on TVL, plus category multipliers from the training medians.
 * The same function refits inside every validation split and bootstrap refit.
 */
export function fitPipeline(train: SnapshotProtocol[]): Fit {
  const pts = train.map((p) => ({ x: Math.log10(Math.max(1, p.tvl_usd)), y: Math.log10(Math.max(1, p.mcap_usd ?? 1)) }));
  let w = pts.map(() => 1);
  let a = 0;
  let b = 0;
  for (let it = 0; it < 5; it++) {
    const sw = w.reduce((x, y) => x + y, 0);
    const mx = pts.reduce((t, p, i) => t + w[i]! * p.x, 0) / sw;
    const my = pts.reduce((t, p, i) => t + w[i]! * p.y, 0) / sw;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < pts.length; i++) {
      sxx += w[i]! * (pts[i]!.x - mx) ** 2;
      sxy += w[i]! * (pts[i]!.x - mx) * (pts[i]!.y - my);
    }
    b = sxx === 0 ? 0 : sxy / sxx;
    a = my - b * mx;
    const res = pts.map((p) => Math.abs(p.y - (a + b * p.x)));
    const sc = Math.max(0.05, 1.4826 * (median(res) || 0.1));
    w = res.map((r) => Math.min(1, (1.345 * sc) / Math.max(1e-9, r)));
  }
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const c = p.category ?? 'Other';
    const arr = byCat.get(c) ?? [];
    arr.push((p.mcap_usd ?? 0) / Math.max(1, p.tvl_usd));
    byCat.set(c, arr);
  }
  const globalRatio = median(train.map((p) => (p.mcap_usd ?? 0) / Math.max(1, p.tvl_usd)));
  const catMult: Record<string, number> = {};
  for (const [c, ratios] of byCat) {
    if (ratios.length >= 5) catMult[c] = round4(clip(median(ratios) / globalRatio, 0.25, 2));
  }
  return {
    a: round4(a),
    b: round4(b),
    catMult,
    medGrowthLog: median(train.filter((p) => p.change_7d !== null).map((p) => growthLog(p, 0))),
    medAgeYrs: median(train.filter((p) => p.listed_at !== null).map((p) => ageYrs(p, 0))),
    globalRatio: round4(globalRatio),
  };
}

export interface Prediction {
  value: number;
  base: number;
  growthMult: number;
  ageMult: number;
  catMult: number;
}

/** One protocol's implied value under a fit: curve x growth x age x category. */
export function predictValue(fit: Fit, p: SnapshotProtocol): Prediction {
  const base = 10 ** (fit.a + fit.b * Math.log10(Math.max(1, p.tvl_usd)));
  const growthMult = Math.exp(GROWTH_ELASTICITY * (growthLog(p, fit.medGrowthLog) - fit.medGrowthLog));
  const ageMult = Math.exp(AGE_ELASTICITY * (Math.log(1 + ageYrs(p, fit.medAgeYrs)) - Math.log(1 + fit.medAgeYrs)));
  const catMult = fit.catMult[p.category ?? 'Other'] ?? 1;
  const value = Math.max(1, Math.round(base * growthMult * ageMult * catMult));
  return { value, base: Math.round(base), growthMult: round4(growthMult), ageMult: round4(ageMult), catMult: round4(catMult) };
}

// ---------------------------------------------------------------- validation

export interface TestResult {
  test: string;
  train_n: number;
  test_n: number;
  model_median_miss: number;
  flat_median_miss: number;
  p90_miss: number;
  log_err_improvement_pct: number;
  bias: number;
}

function evalSplit(train: SnapshotProtocol[], test: SnapshotProtocol[], label: string): TestResult {
  const fit = fitPipeline(train);
  const flatRatio = median(train.map((p) => (p.mcap_usd ?? 0) / Math.max(1, p.tvl_usd)));
  const errs: number[] = [];
  const flatErrs: number[] = [];
  for (const p of test) {
    const actual = Math.max(1, p.mcap_usd ?? 1);
    errs.push(Math.abs(Math.log(predictValue(fit, p).value / actual)));
    flatErrs.push(Math.abs(Math.log((flatRatio * p.tvl_usd) / actual)));
  }
  const signed = test.map((p) => Math.log(predictValue(fit, p).value / Math.max(1, p.mcap_usd ?? 1)));
  const miss = errs.map((e) => Math.exp(e)).sort((x, y) => x - y);
  const flatMiss = flatErrs.map((e) => Math.exp(e)).sort((x, y) => x - y);
  const mean = (xs: number[]): number => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);
  return {
    test: label,
    train_n: train.length,
    test_n: test.length,
    model_median_miss: round4(median(miss)),
    flat_median_miss: round4(median(flatMiss)),
    p90_miss: round4(miss[Math.floor(miss.length * 0.9)] ?? miss[miss.length - 1]!),
    log_err_improvement_pct: round4((1 - mean(errs) / Math.max(1e-9, mean(flatErrs))) * 100),
    bias: round4(Math.exp(median(signed))),
  };
}

/** Leave-one-out, walk-forward (3 folds, pooled) and the blind newest-20% test. */
export function validateModel(comps: SnapshotProtocol[]): { loo: TestResult; walkForward: TestResult; blind: TestResult } {
  // Leave-one-out: refit without each comp, predict it, pool the errors.
  const looErrs: number[] = [];
  const looFlat: number[] = [];
  const looSigned: number[] = [];
  for (let j = 0; j < comps.length; j++) {
    const train = comps.filter((_, i) => i !== j);
    const fit = fitPipeline(train);
    const p = comps[j]!;
    const actual = Math.max(1, p.mcap_usd ?? 1);
    const flatRatio = median(train.map((q) => (q.mcap_usd ?? 0) / Math.max(1, q.tvl_usd)));
    looErrs.push(Math.abs(Math.log(predictValue(fit, p).value / actual)));
    looFlat.push(Math.abs(Math.log((flatRatio * p.tvl_usd) / actual)));
    looSigned.push(Math.log(predictValue(fit, p).value / actual));
  }
  const mean = (xs: number[]): number => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);
  const missOf = (errs: number[]): number[] => errs.map((e) => Math.exp(e)).sort((x, y) => x - y);
  const looMiss = missOf(looErrs);
  const looFlatMiss = missOf(looFlat);
  const loo: TestResult = {
    test: 'Leave-one-out',
    train_n: comps.length - 1,
    test_n: comps.length,
    model_median_miss: round4(median(looMiss)),
    flat_median_miss: round4(median(looFlatMiss)),
    p90_miss: round4(looMiss[Math.floor(looMiss.length * 0.9)]!),
    log_err_improvement_pct: round4((1 - mean(looErrs) / Math.max(1e-9, mean(looFlat))) * 100),
    bias: round4(Math.exp(median(looSigned))),
  };

  // Walk-forward by listing date: oldest half trains first, then three blocks.
  const dated = comps.filter((p) => p.listed_at !== null).sort((x, y) => (x.listed_at! < y.listed_at! ? -1 : x.listed_at! > y.listed_at! ? 1 : x.slug < y.slug ? -1 : 1));
  const chunk = Math.floor(dated.length / 4);
  const wfErrs: number[] = [];
  const wfFlat: number[] = [];
  const wfSigned: number[] = [];
  let wfTrain = 0;
  for (let k = 1; k <= 3; k++) {
    const train = dated.slice(0, k * chunk);
    const test = dated.slice(k * chunk, (k + 1) * chunk);
    wfTrain = train.length;
    const fit = fitPipeline(train);
    const flatRatio = median(train.map((p) => (p.mcap_usd ?? 0) / Math.max(1, p.tvl_usd)));
    for (const p of test) {
      const actual = Math.max(1, p.mcap_usd ?? 1);
      wfErrs.push(Math.abs(Math.log(predictValue(fit, p).value / actual)));
      wfFlat.push(Math.abs(Math.log((flatRatio * p.tvl_usd) / actual)));
      wfSigned.push(Math.log(predictValue(fit, p).value / actual));
    }
  }
  const wfMiss = missOf(wfErrs);
  const wfFlatMiss = missOf(wfFlat);
  const walkForward: TestResult = {
    test: 'Walk-forward (3 folds, pooled)',
    train_n: wfTrain,
    test_n: wfErrs.length,
    model_median_miss: round4(median(wfMiss)),
    flat_median_miss: round4(median(wfFlatMiss)),
    p90_miss: round4(wfMiss[Math.floor(wfMiss.length * 0.9)]!),
    log_err_improvement_pct: round4((1 - mean(wfErrs) / Math.max(1e-9, mean(wfFlat))) * 100),
    bias: round4(Math.exp(median(wfSigned))),
  };

  // Blind: the newest 20% by listing date, never fitted on.
  const cut = Math.floor(dated.length * 0.8);
  const blind = evalSplit(dated.slice(0, cut), dated.slice(cut), 'Blind newest 20%');
  return { loo, walkForward, blind };
}

// ---------------------------------------------------------------- bootstrap

/** Deterministic PRNG: mulberry32, seeded from a hash of the comps + version. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface BootstrapBand {
  p10_value: number;
  p90_value: number;
  rank_lo: number;
  rank_hi: number;
  top20_prob: number;
  farm_prob: number;
}

/**
 * 200 bootstrap refits of the whole pipeline. For every rankable protocol it
 * returns the P10-P90 fitted value, the P10-P90 rank, the chance of a top-20
 * finish and the chance of a FARM verdict under the farm economics below.
 */
export function bootstrapBands(
  comps: SnapshotProtocol[],
  rankable: SnapshotProtocol[],
  econ: (p: SnapshotProtocol, value: number) => { net: number; ev: number; econCost: number },
): Map<string, BootstrapBand> {
  const seedText = MODEL_VERSION + '|' + comps.map((p) => `${p.slug}:${p.tvl_usd}:${p.mcap_usd}`).join('|');
  const rand = mulberry32(fnv1a(seedText));
  const n = comps.length;
  const values = new Map<string, number[]>();
  const ranks = new Map<string, number[]>();
  const farmHits = new Map<string, number>();
  for (const p of rankable) {
    values.set(p.slug, []);
    ranks.set(p.slug, []);
    farmHits.set(p.slug, 0);
  }
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < n; i++) sample.push(comps[Math.floor(rand() * n)]!);
    const fit = fitPipeline(sample);
    const scored = rankable.map((p) => ({ slug: p.slug, value: predictValue(fit, p).value }));
    scored.sort((x, y) => y.value - x.value || (x.slug < y.slug ? -1 : 1));
    scored.forEach((s, i) => {
      values.get(s.slug)!.push(s.value);
      ranks.get(s.slug)!.push(i + 1);
      const p = rankable.find((q) => q.slug === s.slug)!;
      const e = econ(p, s.value);
      if (e.net > 0 && e.net >= 25 && e.ev / Math.max(1, e.econCost) >= 1.5) farmHits.set(s.slug, farmHits.get(s.slug)! + 1);
    });
  }
  const out = new Map<string, BootstrapBand>();
  const q = (xs: number[], f: number): number => {
    const t = [...xs].sort((a, b) => a - b);
    return t[Math.min(t.length - 1, Math.floor(t.length * f))]!;
  };
  for (const p of rankable) {
    const vs = values.get(p.slug)!;
    const rs = ranks.get(p.slug)!;
    out.set(p.slug, {
      p10_value: q(vs, 0.1),
      p90_value: q(vs, 0.9),
      rank_lo: q(rs, 0.1),
      rank_hi: q(rs, 0.9),
      top20_prob: round4(rs.filter((x) => x <= 20).length / rs.length),
      farm_prob: round4(farmHits.get(p.slug)! / BOOTSTRAP_REFITS),
    });
  }
  return out;
}

/** The fitted curve's P10-P90 band at grid TVLs, from the same bootstrap draws. */
export function curveBand(comps: SnapshotProtocol[]): { tvl: number; value: number; p10: number; p90: number }[] {
  const seedText = MODEL_VERSION + '|curve|' + comps.map((p) => `${p.slug}:${p.tvl_usd}:${p.mcap_usd}`).join('|');
  const rand = mulberry32(fnv1a(seedText));
  const grid = [1e6, 1e7, 1e8, 1e9, 1e10];
  const n = comps.length;
  const draws: number[][] = grid.map(() => []);
  const full = fitPipeline(comps);
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < n; i++) sample.push(comps[Math.floor(rand() * n)]!);
    const fit = fitPipeline(sample);
    grid.forEach((tvl, i) => {
      const p: SnapshotProtocol = { slug: '', name: '', category: 'Other', chains: [], tvl_usd: tvl, change_7d: null, mcap_usd: null, listed_at: null, gecko_id: null, symbol: null };
      draws[i]!.push(predictValue(fit, p).value);
    });
  }
  const q = (xs: number[], f: number): number => {
    const t = [...xs].sort((a, b) => a - b);
    return t[Math.min(t.length - 1, Math.floor(t.length * f))]!;
  };
  return grid.map((tvl, i) => ({
    tvl,
    value: predictValue(full, { slug: '', name: '', category: 'Other', chains: [], tvl_usd: tvl, change_7d: null, mcap_usd: null, listed_at: null, gecko_id: null, symbol: null }).value,
    p10: q(draws[i]!, 0.1),
    p90: q(draws[i]!, 0.9),
  }));
}

// ---------------------------------------------------------------- farm economics

export interface FarmEconomics {
  deposit_usd: number;
  hours: number;
  chain: string;
  gas_usd: number;
  spread_usd: number;
  cash_cost_usd: number;
  opp_cost_usd: number;
  time_cost_usd: number;
  econ_cost_usd: number;
  farmers: number;
  ev_usd: number;
  net_usd: number;
  breakeven_value_usd: number;
  breakeven_prob_pct: number | null;
  verdict: 'farm' | 'thin' | 'skip';
}

const L2_CHAINS = new Set([
  'Arbitrum', 'Optimism', 'Base', 'zkSync Era', 'Polygon', 'Blast', 'Linea', 'Scroll', 'Mantle', 'Mode',
  'Gnosis', 'Fantom', 'Avalanche', 'Solana', 'Aptos', 'Sui', 'Near', 'Cosmos', 'Sei', 'Berachain',
  'Hyperliquid', 'Starknet', 'Zora', 'Fraxtal', 'Manta', 'Kava', 'Celo', 'Moonbeam', 'Cronos', 'Klaytn',
  'opBNB', 'Metis', 'Aurora', 'Boba', 'ImmutableX', 'Loopring', 'BSC', 'BNB Chain',
]);

function gasPerTx(chain: string | null): number {
  if (chain === null) return 2;
  if (chain === 'Ethereum') return 4;
  if (L2_CHAINS.has(chain)) return chain === 'BSC' || chain === 'BNB Chain' ? 0.05 : 0.15;
  return 0.05;
}

function depositTier(tvl: number): { deposit: number; hours: number } {
  if (tvl < 10_000_000) return { deposit: 100, hours: 2 };
  if (tvl < 100_000_000) return { deposit: 250, hours: 3 };
  if (tvl < 1_000_000_000) return { deposit: 500, hours: 4 };
  return { deposit: 1000, hours: 5 };
}

/**
 * One row's farm economics. The deposit is sized by TVL tier; gas is the
 * cheapest of the protocol's chains for 8 transactions; the reward is the
 * reference scenario (30% chance, 5% of implied value, split over F farmers
 * where F is TVL over a $10,000 average position). Net is EV minus economic
 * cost (cash + opportunity + time). The verdict is netted, not a slogan.
 */
export function farmEconomics(p: SnapshotProtocol, value: number, p10Value?: number): FarmEconomics {
  const { deposit, hours } = depositTier(p.tvl_usd);
  const chain = p.chains.length > 0 ? [...p.chains].sort((a, b) => gasPerTx(a) - gasPerTx(b))[0]! : null;
  const gas = 8 * gasPerTx(chain);
  const spread = 0.002 * deposit;
  const cash = round4(gas + spread);
  const opp = round4(deposit * OPPORTUNITY_RATE * (FARM_DAYS / 365));
  const time = hours * HOUR_VALUE_USD;
  const econ = round4(cash + opp + time);
  const farmers = Math.max(50, Math.round(p.tvl_usd / 10000));
  const ev = round4((DIST_PROBABILITY * DIST_SHARE * value) / farmers);
  const net = round4(ev - econ);
  const breakeven = Math.round((econ * farmers) / (DIST_PROBABILITY * DIST_SHARE));
  const pBe = value > 0 ? (econ / ((DIST_SHARE * value) / farmers)) * 100 : null;
  const evP10 = p10Value === undefined ? ev : (DIST_PROBABILITY * DIST_SHARE * p10Value) / farmers;
  const netP10 = evP10 - econ;
  let verdict: 'farm' | 'thin' | 'skip' = 'skip';
  if (netP10 > 0 && net >= 25 && ev / Math.max(1, econ) >= 1.5) verdict = 'farm';
  else if (net > 0) verdict = 'thin';
  return {
    deposit_usd: deposit,
    hours,
    chain: chain ?? 'its main chain',
    gas_usd: round4(gas),
    spread_usd: round4(spread),
    cash_cost_usd: cash,
    opp_cost_usd: opp,
    time_cost_usd: time,
    econ_cost_usd: econ,
    farmers,
    ev_usd: ev,
    net_usd: net,
    breakeven_value_usd: breakeven,
    breakeven_prob_pct: pBe === null ? null : pBe > 100 ? null : round4(pBe),
    verdict,
  };
}

// ---------------------------------------------------------------- farm steps

const money = (n: number): string => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${Math.round(n)}`);

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, deposit: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${money(deposit)} of USDC to ${name} on ${chain} and leave the position open so it counts in weekly snapshots.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide ${money(deposit)} of liquidity to ${name}'s deepest pool on ${chain} and leave the position open.`;
  if (c.includes('yield') || c.includes('aggregator')) return `Deposit ${money(deposit)} into ${name}'s main vault on ${chain} and hold the vault shares.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit ${money(deposit)} of USDC as margin on ${name} and open one small hedged position, then close it the same week.`;
  if (c.includes('bridge')) return `Bridge ${money(deposit)} of USDC to ${chain} through ${name} once, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${money(deposit)} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('prediction')) return `Fund ${money(deposit)} on ${name} and place one small market position, then settle it before the market closes.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit ${money(deposit)} into a ${name} vault on ${chain} and hold the shares through the review dates.`;
  if (c.includes('stable')) return `Mint or deposit ${money(deposit)} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint ${money(deposit)} of ${name}'s yield asset on ${chain} and hold it through the payout dates.`;
  if (c.includes('insurance')) return `Buy ${money(deposit)} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('basis')) return `Deposit ${money(deposit)} into ${name}'s basis position on ${chain} and hold it through the funding cycles.`;
  return `Deposit ${money(deposit)} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** Six steps, each an action with its cost and time, derived from the protocol's own record. */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: FarmEconomics): string[] {
  const hold = holdDaysFor(age);
  const steps: { text: string; cost: string; time: string }[] = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, econ.deposit_usd, econ.chain),
      cost: `${money(econ.deposit_usd)} of capital and about ${money(econ.gas_usd)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep the receipts.',
      cost: `about ${money(Math.max(1, econ.gas_usd / 4))} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the ${money(econ.deposit_usd)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Verdict: ${econ.verdict.toUpperCase()} — expected net ${econ.net_usd >= 0 ? '+' : ''}${money(econ.net_usd)} after ${money(econ.econ_cost_usd)} of economic cost over ${FARM_DAYS} days; break-even needs ${money(econ.breakeven_value_usd)} of implied value${econ.breakeven_prob_pct === null ? ', which is out of reach under the reference scenario' : `, about ${econ.breakeven_prob_pct.toFixed(0)}% distribution chance`}.`,
      cost: `${money(econ.econ_cost_usd)} of economic cost in all`,
      time: `${FARM_DAYS} days`,
    },
    {
      text: 'Before you withdraw, open the protocol\u2019s own points or rewards page from its official site and claim only from the link it publishes; never pay to claim.',
      cost: 'no fee to check',
      time: '10 minutes',
    },
  ];
  return steps.map((s) => {
    let out = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
    if (out.length > 600) out = `${out.slice(0, 596)}...`;
    if (out.length < 20) out = `${out} Hold the position and check the protocol's own page.`;
    return out;
  });
}

// ---------------------------------------------------------------- the board

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  tier: 'watchlist' | 'below-floor';
  implied_value_usd: number;
  p10_value_usd: number;
  p90_value_usd: number;
  rank_lo: number;
  rank_hi: number;
  top20_prob: number;
  farm_prob: number;
  model: { base: number; growth_mult: number; age_mult: number; cat_mult: number };
  deposit_usd: number;
  chain: string;
  cash_cost_usd: number;
  econ_cost_usd: number;
  hours: number;
  ev_usd: number;
  net_usd: number;
  breakeven_value_usd: number;
  verdict: 'farm' | 'thin' | 'skip';
  farm_steps: string[];
  nearest_comps: { slug: string; tvl_usd: number; mcap_usd: number | null }[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: {
    a: number;
    b: number;
    growth_elasticity: number;
    age_elasticity: number;
    cat_mult: Record<string, number>;
    comps: number;
    excluded: { cex: number; ratio: number; nonpositive: number };
  };
  audit: { protocols: number; pre_token: number; rankable: number; set_aside: number; watchlist: number };
  validation: { loo: TestResult; walk_forward: TestResult; blind: TestResult };
  scale: { tvl: number; value: number; p10: number; p90: number }[];
  comps: { slug: string; tvl_usd: number; mcap_usd: number; fitted_usd: number; blind: boolean }[];
  rows: BoardRow[];
  live: LiveRow[];
  set_aside: { slug: string; name: string; category: string | null; reason: string }[];
}

/** The five traded comps nearest a row in (log TVL, growth, age) space. */
function nearestComps(p: SnapshotProtocol, comps: SnapshotProtocol[], fit: Fit): { slug: string; tvl_usd: number; mcap_usd: number | null }[] {
  const g = growthLog(p, fit.medGrowthLog);
  const a = Math.log(1 + ageYrs(p, fit.medAgeYrs));
  const x = Math.log10(Math.max(1, p.tvl_usd));
  const scored = comps.map((c) => {
    const dx = Math.log10(Math.max(1, c.tvl_usd)) - x;
    const dg = growthLog(c, fit.medGrowthLog) - g;
    const da = Math.log(1 + ageYrs(c, fit.medAgeYrs)) - a;
    return { c, d: dx * dx + dg * dg * 4 + da * da * 4 };
  });
  scored.sort((u, v) => u.d - v.d || (u.c.slug < v.c.slug ? -1 : 1));
  return scored.slice(0, 5).map((s) => ({ slug: s.c.slug, tvl_usd: s.c.tvl_usd, mcap_usd: s.c.mcap_usd }));
}

/** The ranked board: every rankable pre-token protocol, by fitted implied value. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  setAsOf(snapshot.as_of);
  const { comps, excluded } = selectComps(snapshot);
  const fit = fitPipeline(comps);
  const validation = validateModel(comps);
  const watchlist = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter(isPreToken);
  const rankable = preToken.filter((p) => setAsideReason(p) === null);
  const setAside = preToken
    .filter((p) => setAsideReason(p) !== null)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, reason: setAsideReason(p)! }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));

  // Bootstrap bands need the farm economics, which need the fitted value: run
  // the bands on the point predictions first, then finalise each row.
  const point = new Map<string, Prediction>();
  for (const p of rankable) point.set(p.slug, predictValue(fit, p));
  const bands = bootstrapBands(comps, rankable, (p, value) => {
    const e = farmEconomics(p, value);
    return { net: e.net_usd, ev: e.ev_usd, econCost: e.econ_cost_usd };
  });

  const rows = rankable
    .map((p) => ({ p, pred: point.get(p.slug)! }))
    .sort((x, y) => y.pred.value - x.pred.value || (x.p.slug < y.p.slug ? -1 : 1))
    .map(({ p, pred }, i) => {
      const band = bands.get(p.slug)!;
      const econ = farmEconomics(p, pred.value, band.p10_value);
      const age = ageDays(snapshot.as_of, p.listed_at);
      return {
        rank: i + 1,
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        listed_at: p.listed_at,
        age_days: age,
        tier: (watchlist.has(p.slug) ? 'watchlist' : 'below-floor') as 'watchlist' | 'below-floor',
        implied_value_usd: pred.value,
        p10_value_usd: band.p10_value,
        p90_value_usd: band.p90_value,
        rank_lo: band.rank_lo,
        rank_hi: band.rank_hi,
        top20_prob: band.top20_prob,
        farm_prob: band.farm_prob,
        model: { base: pred.base, growth_mult: pred.growthMult, age_mult: pred.ageMult, cat_mult: pred.catMult },
        deposit_usd: econ.deposit_usd,
        chain: econ.chain,
        cash_cost_usd: econ.cash_cost_usd,
        econ_cost_usd: econ.econ_cost_usd,
        hours: econ.hours,
        ev_usd: econ.ev_usd,
        net_usd: econ.net_usd,
        breakeven_value_usd: econ.breakeven_value_usd,
        verdict: econ.verdict,
        farm_steps: farmSteps(p, age, econ),
        nearest_comps: nearestComps(p, comps, fit),
      } satisfies BoardRow;
    });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  // The comps scatter: every fitted anchor, its fitted value, and whether it
  // sat in the blind newest-20% holdout.
  const dated = comps.filter((p) => p.listed_at !== null).sort((x, y) => (x.listed_at! < y.listed_at! ? -1 : x.listed_at! > y.listed_at! ? 1 : x.slug < y.slug ? -1 : 1));
  const blindSet = new Set(dated.slice(Math.floor(dated.length * 0.8)).map((p) => p.slug));
  const compPoints = comps.map((p) => ({
    slug: p.slug,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd ?? 0,
    fitted_usd: predictValue(fit, p).value,
    blind: blindSet.has(p.slug),
  }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      a: fit.a,
      b: fit.b,
      growth_elasticity: GROWTH_ELASTICITY,
      age_elasticity: AGE_ELASTICITY,
      cat_mult: fit.catMult,
      comps: comps.length,
      excluded,
    },
    audit: {
      protocols: snapshot.protocols.length,
      pre_token: preToken.length,
      rankable: rankable.length,
      set_aside: setAside.length,
      watchlist: snapshot.watchlist.length,
    },
    validation: { loo: validation.loo, walk_forward: validation.walkForward, blind: validation.blind },
    scale: curveBand(comps),
    comps: compPoints,
    rows,
    live,
    set_aside: setAside,
  };
  return { board: rows, radar };
}

// ---------------------------------------------------------------- snapshot + gate

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
