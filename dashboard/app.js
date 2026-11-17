// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the audit, the fitted model with its three validation
// tests, the comps curve, the sortable/filterable board and a detail view for
// every protocol. No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('app');
  var state = { q: '', cat: 'all', chain: 'all', verdict: 'all', scope: 'all', tab: 'board', sort: 'implied', dir: -1, sel: null };

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function money(n) { return (n < 0 ? '-' : n > 0 ? '+' : '') + usd(Math.abs(n)); }
  function pct(n) { if (n === null || n === undefined) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(days) { if (days === null || days === undefined) return 'unknown'; if (days >= 365) return (days / 365).toFixed(1) + 'y'; return Math.round(days) + 'd'; }
  function srcText() { return (D.source || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim(); }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('cat')) state.cat = p.get('cat');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('verdict')) state.verdict = p.get('verdict');
    if (p.get('scope')) state.scope = p.get('scope');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('p')) state.sel = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.verdict !== 'all') p.set('verdict', state.verdict);
    if (state.scope !== 'all') p.set('scope', state.scope);
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.sel) p.set('p', state.sel);
    var s = p.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function verdictCounts() {
    var c = { farm: 0, thin: 0, skip: 0 };
    D.rows.forEach(function (r) { c[r.verdict]++; });
    return c;
  }

  function scatter() {
    var W = 560, H = 300, L = 46, R = 10, T = 12, B = 30;
    var x0 = 6, x1 = 10, y0 = 5, y1 = 9;
    function X(v) { return L + ((Math.log10(Math.max(1e6, Math.min(1e10, v))) - x0) / (x1 - x0)) * (W - L - R); }
    function Y(v) { return T + (1 - (Math.log10(Math.max(1e5, Math.min(1e9, v))) - y0) / (y1 - y0)) * (H - T - B); }
    var pts = D.comps.map(function (c) {
      return '<circle cx="' + X(c.tvl_usd).toFixed(1) + '" cy="' + Y(c.mcap_usd).toFixed(1) + '" r="' + (c.blind ? 4.5 : 3) + '" fill="' + (c.blind ? '#f5b544' : '#2dd4bf') + '" opacity="0.85"><title>' + esc(c.slug) + ': TVL ' + usd(c.tvl_usd) + ', cap ' + usd(c.mcap_usd) + ', fitted ' + usd(c.fitted_usd) + '</title></circle>';
    }).join('');
    var band = D.scale.map(function (s) { return X(s.tvl).toFixed(1) + ',' + Y(s.p90).toFixed(1); }).join(' ')
      + ' ' + D.scale.slice().reverse().map(function (s) { return X(s.tvl).toFixed(1) + ',' + Y(s.p10).toFixed(1); }).join(' ');
    var line = D.scale.map(function (s) { return X(s.tvl).toFixed(1) + ',' + Y(s.value).toFixed(1); }).join(' ');
    var grid = '';
    for (var gx = 6; gx <= 10; gx++) {
      grid += '<line x1="' + X(Math.pow(10, gx)).toFixed(1) + '" y1="' + T + '" x2="' + X(Math.pow(10, gx)).toFixed(1) + '" y2="' + (H - B) + '" stroke="#1e3352" stroke-width="1"/>';
      grid += '<text x="' + X(Math.pow(10, gx)).toFixed(1) + '" y="' + (H - 10) + '" fill="#64748b" font-size="10" text-anchor="middle">$' + (gx === 6 ? '1M' : gx === 7 ? '10M' : gx === 8 ? '100M' : gx === 9 ? '1B' : '10B') + '</text>';
    }
    for (var gy = 5; gy <= 9; gy++) {
      grid += '<line x1="' + L + '" y1="' + Y(Math.pow(10, gy)).toFixed(1) + '" x2="' + (W - R) + '" y2="' + Y(Math.pow(10, gy)).toFixed(1) + '" stroke="#1e3352" stroke-width="1"/>';
      grid += '<text x="' + (L - 5) + '" y="' + (Y(Math.pow(10, gy)) + 3).toFixed(1) + '" fill="#64748b" font-size="10" text-anchor="end">$' + (gy === 5 ? '100K' : gy === 6 ? '1M' : gy === 7 ? '10M' : gy === 8 ? '100M' : '1B') + '</text>';
    }
    return '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Traded comps: market cap against TVL, log scales, with the fitted curve and its P10 to P90 band">'
      + grid
      + '<polygon points="' + band + '" fill="#2dd4bf" opacity="0.12"/>'
      + '<polyline points="' + line + '" fill="none" stroke="#2dd4bf" stroke-width="2"/>'
      + pts + '</svg>'
      + '<div class="legend"><i style="background:#2dd4bf"></i>traded comp <i style="background:#f5b544"></i>blind holdout (newest 20%), line: fitted curve, band: bootstrap P10 to P90</div>';
  }

  function evidence() {
    var m = D.model, v = D.validation;
    function trow(t) {
      return '<tr><td>' + esc(t.test) + '</td><td class="num">' + t.train_n + ' to ' + t.test_n + '</td>'
        + '<td class="num"><span class="miss">' + t.model_median_miss.toFixed(2) + '&times;</span></td>'
        + '<td class="num">' + t.flat_median_miss.toFixed(2) + '&times;</td>'
        + '<td class="num">' + t.p90_miss.toFixed(2) + '&times;</td>'
        + '<td class="num ' + (t.log_err_improvement_pct >= 0 ? 'pos' : 'neg') + '">' + (t.log_err_improvement_pct >= 0 ? '+' : '') + t.log_err_improvement_pct.toFixed(1) + '%</td>'
        + '<td class="num">' + t.bias.toFixed(2) + '&times;</td></tr>';
    }
    var scaleRows = D.scale.map(function (s) {
      return '<tr><td class="num">' + usd(s.tvl) + '</td><td class="num">' + usd(s.value) + '</td><td class="num">' + usd(s.p10) + ' to ' + usd(s.p90) + '</td></tr>';
    }).join('');
    return '<section class="panel"><h2>How implied value is fitted, and tested</h2>'
      + '<div class="evidence"><div>'
      + '<p class="note" style="margin-top:0">The curve is fitted on ' + m.comps + ' traded-token comps: market cap on TVL, Huber-weighted log-log OLS. '
      + 'Left out of the fit: ' + m.excluded.cex + ' exchanges, ' + m.excluded.ratio + ' with cap/TVL outside 0.005 to 20, ' + m.excluded.nonpositive + ' with no positive cap or TVL. '
      + 'Growth enters as one bounded adjustment. Category multipliers come from each category\u2019s median cap/TVL among comps, pulled halfway toward 1, because each median rests on as few as 5 comps. '
      + 'Age is not in the model. Version 1 charged young protocols for being young, and the blind test caught it: the newest comps are young but their ratios run no lower, so the age factor is out. The age of each protocol is still shown on its row.</p>'
      + '<div class="formula">log10(market cap) = ' + m.a + ' + ' + m.b + ' &times; log10(TVL)<br>'
      + 'implied = curve(TVL) &times; exp(' + m.growth_elasticity + ' &middot; growth) &times; category (shrunk, exponent ' + m.cat_shrink + ')<br>'
      + 'Doubling TVL multiplies fitted value by 2<sup>' + m.b + '</sup> = ' + Math.pow(2, m.b).toFixed(2) + '&times;.</div>'
      + '<h3>Fitted value at each size (median growth, average category)</h3>'
      + '<table class="plain"><thead><tr><th class="num">TVL</th><th class="num">Fitted value</th><th class="num">P10 to P90 (200 refits)</th></tr></thead><tbody>' + scaleRows + '</tbody></table>'
      + '<p class="note">Category multipliers: ' + Object.keys(m.cat_mult).map(function (k) { return esc(k) + ' ' + m.cat_mult[k]; }).join(', ') + '. Unlisted categories: 1.00.</p>'
      + '</div><div>' + scatter() + '</div></div>'
      + '<h3>Out-of-sample validation: median miss, model against a flat cap/TVL multiple</h3>'
      + '<table><thead><tr><th>Test</th><th class="num">Train to test</th><th class="num">Model median miss</th><th class="num">Flat median miss</th><th class="num">P90 miss</th><th class="num">Log-error gain</th><th class="num">Bias</th></tr></thead><tbody>'
      + trow(v.walk_forward) + trow(v.loo) + trow(v.blind)
      + '</tbody></table>'
      + '<p class="note">Miss is how many times the prediction is off, in either direction (1.00&times; is exact). '
      + 'The snapshot carries no token-launch dates, so the walk-forward and blind tests order comps by protocol listing date. '
      + 'They measure how the model generalises across listing cohorts. They are not a historical backtest. No protocol name is ever special-cased.</p>'
      + '</section>';
  }

  function header() {
    var c = verdictCounts();
    return '<header class="top"><h1>Token Radar</h1>'
      + '<span class="sub">Every pre-token protocol audited, values fitted to traded comps, farming net of cost.</span></header>'
      + '<div class="chips">'
      + '<span class="chip">Audited <b>' + D.audit.pre_token + ' / ' + D.audit.pre_token + '</b> pre-token</span>'
      + '<span class="chip">Watchlist <b class="amber">' + D.audit.watchlist + ' / ' + D.audit.watchlist + '</b></span>'
      + '<span class="chip">Ranked <b>' + D.rows.length + '</b> launch candidates</span>'
      + '<span class="chip">Set aside <b>' + D.audit.set_aside + '</b> (wrapped / staked / bridged / exchange)</span>'
      + '<span class="chip">Comps <b>' + D.model.comps + '</b> traded tokens</span>'
      + '<span class="chip">Verdicts <b class="green">' + c.farm + ' farm</b> · <b class="amber">' + c.thin + ' thin</b> · <b>' + c.skip + ' skip</b></span>'
      + '<span class="chip">Snapshot <b>' + esc(D.as_of) + '</b></span>'
      + '</div>'
      + '<p class="note">Value is not farmability. The largest launches draw the most farmers, so a deposit there splits a small reward many ways. The farmable rows sit below the $50M floor. Each row shows its deposit, its cost over 90 days, its expected net and its break-even, so read the verdict alongside the rank. '
      + 'Implied value is the model\u2019s claim from ' + esc(srcText()) + '. The snapshot records no token for these protocols; that is not proof they have none.</p>';
  }

  function farmEvidence() {
    function med(xs) { var t = xs.slice().sort(function (a, b) { return a - b; }); return t[Math.floor(t.length / 2)]; }
    var wl = D.rows.filter(function (r) { return r.tier === 'watchlist'; });
    var farm = D.rows.filter(function (r) { return r.verdict === 'farm'; });
    if (wl.length === 0 || farm.length === 0) return '';
    var best = wl.slice().sort(function (a, b) { return b.net_usd - a.net_usd; })[0];
    var farmers = Math.max(50, Math.round(best.tvl_usd / 10000));
    var need = best.econ_cost_usd / (0.05 * best.implied_value_usd / farmers) * 100;
    var small = wl.map(function (r) {
      var gas = r.cash_cost_usd - 0.002 * r.deposit_usd;
      var econ = gas + 0.002 * 100 + 100 * 0.05 * 90 / 365 + 2 * 15;
      return { net: r.ev_usd - econ, ratio: r.ev_usd / econ };
    });
    var smallPos = small.filter(function (s) { return s.net > 0; }).length;
    var smallBest = small.slice().sort(function (a, b) { return b.net - a.net; })[0];
    var wlSkips = wl.filter(function (r) { return r.verdict === 'skip'; }).length;
    var wlThins = wl.filter(function (r) { return r.verdict === 'thin'; }).length;
    return '<section class="panel"><h2>The watchlist does not farm</h2>'
      + '<p class="note" style="margin-top:0">Of the ' + wl.length + ' watchlist rows, ' + wlSkips + ' skip and ' + wlThins + ' are thin. None farms. The best of them, '
      + esc(best.name) + ', nets ' + money(best.net_usd) + ' over 90 days. The median watchlist row nets ' + money(med(wl.map(function (r) { return r.net_usd; }))) + '. '
      + 'All ' + farm.length + ' farm verdicts sit below the floor, where deposits are smaller and fewer farmers split the reward. Their median net is ' + money(med(farm.map(function (r) { return r.net_usd; }))) + '.</p>'
      + '<p class="note">It is not the deposit size. At a $100 deposit and 2 hours of time, ' + smallPos + ' of the ' + wl.length + ' turn positive, the best by ' + money(smallBest.net) + ', and none reaches farm. '
      + esc(best.name) + ' would need a ' + need.toFixed(0) + '% distribution chance to break even, against the 30% the reference scenario assumes.</p>'
      + '</section>';
  }

  function controls() {
    var cats = Array.from(new Set(D.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(D.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    function opts(list, cur, all) {
      return '<option value="all">' + all + '</option>' + list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
    }
    return '<div class="controls">'
      + '<div><label for="q">Search</label><input type="search" id="q" placeholder="Name, slug, category or chain" value="' + esc(state.q) + '"></div>'
      + '<div><label for="cat">Category</label><select id="cat">' + opts(cats, state.cat, 'All categories') + '</select></div>'
      + '<div><label for="chain">Chain</label><select id="chain">' + opts(chains, state.chain, 'All chains') + '</select></div>'
      + '<div><label for="verdict">Verdict</label><select id="verdict">' + opts(['farm', 'thin', 'skip'], state.verdict, 'All verdicts') + '</select></div>'
      + '<div><label for="scope">Scope</label><select id="scope">'
      + '<option value="all"' + (state.scope === 'all' ? ' selected' : '') + '>All ranked rows</option>'
      + '<option value="watchlist"' + (state.scope === 'watchlist' ? ' selected' : '') + '>Watchlist only (40)</option>'
      + '<option value="below-floor"' + (state.scope === 'below-floor' ? ' selected' : '') + '>Below the floor (early finds)</option>'
      + '</select></div>'
      + '<div class="tabs" role="group" aria-label="Views">'
      + '<button type="button" data-tab="board" aria-pressed="' + (state.tab === 'board') + '">Board</button>'
      + '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live token</button>'
      + '<button type="button" data-tab="setaside" aria-pressed="' + (state.tab === 'setaside') + '">Set aside (' + D.set_aside.length + ')</button>'
      + '</div>'
      + '<span class="count" id="count"></span></div>';
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.scope === 'watchlist' && r.tier !== 'watchlist') return false;
      if (state.scope === 'below-floor' && r.tier !== 'below-floor') return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'net') { av = a.net_usd; bv = b.net_usd; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function sortTh(key, label) {
    return '<th class="num"><button type="button" data-sort="' + key + '">' + label + (state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '') + '</button></th>';
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var max = (D.rows[0] && D.rows[0].implied_value_usd) || 1;
    if (list.length === 0) return '<section class="panel"><div class="empty"><h2>No protocol matches that filter</h2><p>Clear the search or pick another filter to see the board again.</p><button class="tabs" type="button" id="clear">Clear filters</button></div></section>';
    var body = list.map(function (r) {
      var g = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var net = money(r.net_usd);
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0">'
        + '<td class="num"><b>' + r.rank + '</b><br><span class="small">#' + r.rank_lo + ' to #' + r.rank_hi + '</span></td>'
        + '<td><b>' + esc(r.name) + '</b>' + (r.tier === 'watchlist' ? ' <span class="star" title="On the watchlist">&#9733;</span>' : '') + '<br><span class="small">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></td>'
        + '<td class="num">' + usd(r.tvl_usd) + '</td>'
        + '<td class="num ' + gc + '">' + g + '</td>'
        + '<td class="num">' + age(r.age_days) + '</td>'
        + '<td><div class="bar"><i style="width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%"></i></div><span class="num">' + usd(r.implied_value_usd) + '</span><br><span class="small">' + usd(r.p10_value_usd) + ' to ' + usd(r.p90_value_usd) + '</span></td>'
        + '<td class="num">' + usd(r.deposit_usd) + '</td>'
        + '<td class="num">' + usd(r.econ_cost_usd) + '<br><span class="small">' + r.hours + 'h</span></td>'
        + '<td class="num ' + (r.net_usd >= 0 ? 'pos' : 'neg') + '">' + net + '</td>'
        + '<td class="num">' + usd(r.breakeven_value_usd) + '</td>'
        + '<td><span class="badge ' + r.verdict + '">' + r.verdict.toUpperCase() + '</span></td></tr>';
    }).join('');
    return '<section class="panel boardwrap"><table class="board"><caption class="small" style="text-align:left;padding-bottom:8px">Pre-token launch candidates, strongest implied value first. Select a row for its model, its uncertainty and its costed farm plan. &#9733; is on the watchlist.</caption>'
      + '<thead><tr>' + sortTh('rank', 'Rank') + '<th>Protocol</th>' + sortTh('tvl', 'TVL') + sortTh('growth', '7d') + sortTh('age', 'Age') + sortTh('implied', 'Implied value') + '<th class="num">Deposit</th><th class="num">Cost 90d</th>' + sortTh('net', 'Net') + '<th class="num">Break-even</th><th>Verdict</th></tr></thead>'
      + '<tbody>' + body + '</tbody></table></section>';
  }

  function liveTable() {
    var body = D.live.map(function (r) {
      return '<tr><td><span class="badge" style="background:#0f2a1e;color:#4ade80;border:1px solid #14532d">LIVE</span></td>'
        + '<td><b>' + esc(r.name) + '</b><br><span class="small">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></td>'
        + '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>'
        + '<td class="num">' + usd(r.mcap_usd) + '</td></tr>';
    }).join('');
    return '<section class="panel boardwrap"><table><caption class="small" style="text-align:left;padding-bottom:8px">Already trading. These protocols have a token, so the market cap here is the market figure, and the model plays no part in it. They are the comps the curve is fitted on, set aside from the pre-token ranking.</caption>'
      + '<thead><tr><th>Status</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th></tr></thead><tbody>' + body + '</tbody></table></section>';
  }

  function setAsideTable() {
    var body = D.set_aside.map(function (r) {
      return '<tr><td><b>' + esc(r.name) + '</b><br><span class="small">' + esc(r.slug) + '</span></td><td>' + esc(r.category || 'Other') + '</td><td>' + esc(r.reason) + '</td></tr>';
    }).join('');
    return '<section class="panel boardwrap"><table><caption class="small" style="text-align:left;padding-bottom:8px">Audited but not ranked: every one of the ' + D.audit.pre_token + ' pre-token protocols was checked; these ' + D.set_aside.length + ' are not launches of their own.</caption>'
      + '<thead><tr><th>Protocol</th><th>Category</th><th>Why it is set aside</th></tr></thead><tbody>' + body + '</tbody></table></section>';
  }

  function detailHTML(r) {
    var F = Math.round((r.breakeven_value_usd * 0.015) / Math.max(1, r.econ_cost_usd));
    function scen(v) { var ev = 0.3 * 0.05 * v / Math.max(1, F); return { ev: ev, net: ev - r.econ_cost_usd }; }
    var s10 = scen(r.p10_value_usd), s50 = scen(r.implied_value_usd), s90 = scen(r.p90_value_usd);
    var near = r.nearest_comps.map(function (c) {
      return '<tr><td>' + esc(c.slug) + '</td><td class="num">' + usd(c.tvl_usd) + '</td><td class="num">' + usd(c.mcap_usd) + '</td></tr>';
    }).join('');
    var steps = r.farm_steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    return '<div class="sheet"><button class="close" type="button" id="closeDetail">Close</button>'
      + '<span class="small">Rank ' + r.rank + ' of ' + D.rows.length + ' &middot; rank range #' + r.rank_lo + ' to #' + r.rank_hi + ' over 200 refits &middot; top-20 chance ' + (r.top20_prob * 100).toFixed(0) + '% &middot; farm chance ' + (r.farm_prob * 100).toFixed(0) + '%</span>'
      + '<h2>' + esc(r.name) + (r.tier === 'watchlist' ? ' <span class="star">&#9733;</span>' : '') + '</h2>'
      + '<p class="small">' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).join(', ') || 'an unnamed chain') + ' &middot; ' + (r.tier === 'watchlist' ? 'on the watchlist' : 'below the watchlist floor') + ' &middot; listed ' + esc(r.listed_at || 'unknown') + '</p>'
      + '<div class="kv">'
      + '<div><span>Implied value</span><b>' + usdFull(r.implied_value_usd) + '</b></div>'
      + '<div><span>P10 to P90 value</span><b>' + usd(r.p10_value_usd) + ' to ' + usd(r.p90_value_usd) + '</b></div>'
      + '<div><span>TVL</span><b>' + usdFull(r.tvl_usd) + '</b></div>'
      + '<div><span>7-day growth</span><b>' + pct(r.change_7d) + '</b></div>'
      + '<div><span>Age with no token</span><b>' + age(r.age_days) + '</b></div>'
      + '<div><span>Verdict</span><b><span class="badge ' + r.verdict + '">' + r.verdict.toUpperCase() + '</span></b></div>'
      + '</div>'
      + '<h3>How the value is built</h3>'
      + '<table class="plain"><tbody>'
      + '<tr><td>Curve value at this TVL</td><td class="num">' + usdFull(r.model.base) + '</td></tr>'
      + '<tr><td>Growth multiplier</td><td class="num">&times;' + r.model.growth_mult + '</td></tr>'
      + '<tr><td>Category multiplier</td><td class="num">&times;' + r.model.cat_mult + '</td></tr>'
      + '<tr><td><b>Implied value</b></td><td class="num"><b>' + usdFull(r.implied_value_usd) + '</b></td></tr>'
      + '</tbody></table>'
      + '<h3>Nearest traded comps</h3>'
      + '<table class="plain"><thead><tr><th>Comp</th><th class="num">TVL</th><th class="num">Market cap</th></tr></thead><tbody>' + near + '</tbody></table>'
      + '<h3>Farm economics, 90 days, reference scenario</h3>'
      + '<p class="note">Deposit ' + usd(r.deposit_usd) + ' on ' + esc(r.chain || 'its cheapest chain') + '. Reference scenario: 30% chance of a distribution, 5% of implied value shared over about ' + F.toLocaleString('en-US') + ' farmers (TVL over a $10,000 average position). Costs exclude smart-contract and principal-loss risk.</p>'
      + '<table class="plain"><tbody>'
      + '<tr><td>Gas (8 transactions, cheapest chain)</td><td class="num">' + usd(r.cash_cost_usd) + ' cash cost in all</td></tr>'
      + '<tr><td>Economic cost (cash + opportunity + ' + r.hours + 'h at $15/h)</td><td class="num">' + usd(r.econ_cost_usd) + '</td></tr>'
      + '<tr><td>Expected reward (probability-adjusted)</td><td class="num">' + usd(r.ev_usd) + '</td></tr>'
      + '<tr><td><b>Expected net</b></td><td class="num ' + (r.net_usd >= 0 ? 'pos' : 'neg') + '"><b>' + money(r.net_usd) + '</b></td></tr>'
      + '<tr><td>Break-even implied value</td><td class="num">' + usd(r.breakeven_value_usd) + '</td></tr>'
      + '<tr><td>Net at P10 / median / P90 value</td><td class="num">' + money(s10.net) + ' / ' + money(s50.net) + ' / ' + money(s90.net) + '</td></tr>'
      + '</tbody></table>'
      + '<h3>Farm plan</h3><ol class="steps">' + steps + '</ol>'
      + '<p class="note">These numbers come from the model. No campaign or points program is claimed unless the protocol publishes one. Check the official links and current terms first.</p>'
      + '</div>';
  }

  function render() {
    var html = '<div class="wrap">' + header() + evidence() + farmEvidence() + controls();
    html += state.tab === 'board' ? boardTable() : state.tab === 'live' ? liveTable() : setAsideTable();
    html += '<footer>Token Radar, model ' + esc(D.model_version) + ' &middot; snapshot ' + esc(D.as_of) + ' &middot; implied values are the model\u2019s claim. Farm verdicts rest on the stated reference scenario.</footer></div>';
    html += '<div class="detail" id="detail" role="dialog" aria-modal="true"></div>';
    app.innerHTML = html;
    app.setAttribute('aria-busy', 'false');
    var count = document.getElementById('count');
    if (count) count.textContent = state.tab === 'board' ? filteredRows().length + ' of ' + D.rows.length + ' rows shown' : state.tab === 'live' ? D.live.length + ' live-token protocols' : D.set_aside.length + ' protocols set aside';
    bind();
    if (state.sel) openDetail(state.sel);
  }

  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { r = D.rows[i]; break; }
    var box = document.getElementById('detail');
    if (!r || !box) return;
    state.sel = slug;
    box.innerHTML = detailHTML(r);
    box.classList.add('open');
    var c = document.getElementById('closeDetail');
    if (c) c.addEventListener('click', closeDetail);
    box.addEventListener('click', function (e) { if (e.target === box) closeDetail(); });
  }
  function closeDetail() {
    var box = document.getElementById('detail');
    if (box) { box.classList.remove('open'); box.innerHTML = ''; }
    state.sel = null;
    writeHash();
  }

  function bind() {
    var q = document.getElementById('q');
    if (q) q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); var nq = document.getElementById('q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    ['cat', 'chain', 'verdict', 'scope'].forEach(function (id) {
      var s = document.getElementById(id);
      if (s) s.addEventListener('change', function () { state[id] = s.value; writeHash(); render(); });
    });
    var tabs = app.querySelectorAll('[data-tab]');
    tabs.forEach(function (b) { b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); writeHash(); render(); }); });
    var sorts = app.querySelectorAll('[data-sort]');
    sorts.forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-sort');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = -1; }
        render();
      });
    });
    var rows = app.querySelectorAll('tr[data-slug]');
    rows.forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); writeHash(); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); writeHash(); } });
    });
    var clear = document.getElementById('clear');
    if (clear) clear.addEventListener('click', function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.verdict = 'all'; state.scope = 'all'; writeHash(); render(); });
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
})();
