import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, dispatch, refillPlan, execute, HISTORY } from '../engine/core.js';
import { scoreStock, defaultRuleSet, band, DEFAULT_RULES } from '../engine/rules.js';
import { backtest } from '../engine/scorecard.js';
import { TOOLS, PARITY } from '../engine/tools.js';

const ok = r => { assert.ok(r.ok, JSON.stringify(r.error)); return r.data; };
const AC = ['SRF', 'NAVINFLUOR', 'FLUOROCHEM', 'HAVELLS', 'BLUESTARCO', 'KIRLPNU', 'PRECWIRE'];
const invest = (st, id, amount = 50000) => ok(dispatch(st, 'confirm_order', { order_ids: ok(dispatch(st, 'create_order', { basket_id: id, side: 'buy', amount }, 'you')).orders.map(o => o.id) }, 'you'));

test('rules: bands respect direction', () => {
  const de = DEFAULT_RULES.find(r => r.id === 'de');
  assert.equal(band(de, 0.5), 'green'); assert.equal(band(de, 0.8), 'amber'); assert.equal(band(de, 1.2), 'red');
  const icr = DEFAULT_RULES.find(r => r.id === 'icr');
  assert.equal(band(icr, 5), 'green'); assert.equal(band(icr, 3), 'amber'); assert.equal(band(icr, 2), 'red');
  assert.equal(band(de, null), 'missing');
});

test('rules: critical red removes, points decide watch, buffer holds pass, theme share only inside a theme', () => {
  const rs = defaultRuleSet();
  const base = { themes: { ac: 50 }, historyYears: 10, metrics: { adtv: 50, pledge: 0, de: 0.2, icr: 20, loss: 0, vol: 20, beta: 1, dd: -20, cash: 1, roe: 20, margin: 1, pe: 1, peg: 1 } };
  assert.equal(scoreStock(base, rs).status, 'pass');
  assert.equal(scoreStock({ ...base, metrics: { ...base.metrics, de: 2 } }, rs).status, 'remove');
  const four = { ...base, metrics: { ...base.metrics, vol: 60, roe: 5 } };
  assert.equal(scoreStock(four, rs).status, 'watch');
  assert.equal(scoreStock(four, rs, { prevStatus: 'pass' }).status, 'pass', 'buffer');
  const low = { ...base, themes: { ac: 10 } };
  assert.equal(scoreStock(low, rs).status, 'pass', 'no theme → no theme rule');
  assert.equal(scoreStock(low, rs, { theme: 'ac', minTheme: 20 }).status, 'remove');
  assert.equal(scoreStock({ ...base, historyYears: 1 }, rs).status, 'watch');
});

test('mock data: AC statuses match the research doc (with the AC theme rule)', () => {
  const st = createState();
  const s = sym => scoreStock(st.universe[sym], st.rules, { theme: 'ac', minTheme: 20 }).status;
  for (const p of ['SRF', 'HAVELLS', 'KIRLPNU', 'BLUESTARCO', 'FLUOROCHEM', 'NAVINFLUOR']) assert.equal(s(p), 'pass', p);
  for (const w of ['LGEINDIA', 'KRN', 'AVL', 'KSHINTL', 'SUBROS', 'VOLTAS', 'WHIRLPOOL']) assert.equal(s(w), 'watch', w);
  for (const r of ['RAMRAT', 'HIRECT', 'EMIL', 'AMBER', 'JCHAC', 'PGEL', 'EPACK', 'ICEMAKE', 'HINDALCO', 'IFBIND']) assert.equal(s(r), 'remove', r);
});

test('backtest: default AC rules reproduce the doc yearly figures', () => {
  const bt = backtest(defaultRuleSet(), HISTORY, {}, { theme: 'ac', minTheme: 20 });
  const y = Object.fromEntries(bt.years.map(r => [r.year, r]));
  assert.equal(y[2018].keptAvg, 26); assert.equal(y[2018].removedAvg, -29);
  assert.equal(y[2020].removedAvg, 179); assert.equal(y[2022].removedRight, 0);
  assert.equal(bt.summary.keptBeatYears, 7);
  assert.equal(bt.summary.worstAvoided.symbol, 'FEDDERS');
});

test('universe: energy + profitable filter', () => {
  const st = createState();
  const u = ok(dispatch(st, 'get_universe', { sector: 'Energy', profitable_years: 3 }, 'claude'));
  assert.ok(u.count > 10);
  assert.ok(!u.stocks.some(s => s.symbol === 'INOXWIND'), 'Inox Wind had a loss 2 years ago');
  assert.ok(u.stocks.some(s => s.symbol === 'SUZLON'), 'Suzlon profitable last 3 years');
});

test('per-basket rules: an energy basket with strict loss rule', () => {
  const st = createState(); st.plan = 'pro';
  const b = ok(dispatch(st, 'create_basket', { name: 'Profitable energy', symbols: ['NTPC', 'SUZLON', 'COALINDIA', 'PETRONET', 'GAIL', 'POWERGRID'], rules: { loss: { green: 0, red: 0 } } }, 'claude'));
  assert.equal(b.basket.theme, 'energy');
  assert.ok(b.skipped.some(s => s.symbol === 'SUZLON'));
  assert.equal(b.basket.rules.metrics.find(r => r.id === 'loss').red, 0);
  assert.equal(st.rules.metrics.find(r => r.id === 'loss').red, 1, 'default rules untouched');
});

test('execute: slippage and liquidity cap', () => {
  const f = execute({ symbol: 'X', side: 'buy', qty: 10 }, { price: 100 }, 50);
  assert.equal(f.price, 100.1); assert.equal(f.value, 1001);
  assert.throws(() => execute({ symbol: 'X', side: 'buy', qty: 1e6 }, { price: 100 }, 1), /5%/);
});

test('demo: create → invest → news → sell → refill (stage cap + cool-down)', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'AC basket', symbols: AC }, 'claude'));
  assert.equal(b.basket.count, 6);
  assert.deepEqual(b.skipped.map(x => x.symbol), ['FLUOROCHEM']);
  const id = b.basket.id;
  const inv = ok(dispatch(st, 'create_order', { basket_id: id, side: 'buy', amount: 50000 }, 'claude'));
  assert.equal(dispatch(st, 'confirm_order', { order_ids: inv.orders.map(o => o.id) }, 'claude').error.code, 'person_only');
  ok(dispatch(st, 'confirm_order', { order_ids: inv.orders.map(o => o.id) }, 'you'));
  const fl = ok(dispatch(st, 'add_news_flag', { symbol: 'PRECWIRE', metric: 'de', impact: 'worse' }, 'claude'));
  assert.equal(fl.drafted_orders[0].tag, 'news_only');
  ok(dispatch(st, 'confirm_order', { order_id: fl.drafted_orders[0].id }, 'you'));
  const plan = ok(dispatch(st, 'get_refill_plan', { basket_id: id }, 'claude'));
  assert.equal(plan.count, 5);
  assert.ok(plan.skipped.some(s => s.symbol === 'PRECWIRE' && /cool-down/.test(s.why)));
  assert.ok(plan.skipped.some(s => s.symbol === 'FLUOROCHEM' && /limit/.test(s.why)));
  assert.equal(plan.pendingOrders.length, 1);
});

test('news flag is confirmed by the next filing; a wrong guess is cleared', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you')).basket;
  invest(st, b.id);
  ok(dispatch(st, 'add_news_flag', { symbol: 'PRECWIRE', metric: 'de', impact: 'worse' }, 'claude'));
  ok(dispatch(st, 'add_news_flag', { symbol: 'SUBROS', metric: 'roe', impact: 'worse' }, 'claude'));
  ok(dispatch(st, 'advance_quarter', {}, 'you'));
  assert.equal(st.flags.find(f => f.symbol === 'PRECWIRE').status, 'confirmed');
  assert.equal(st.flags.find(f => f.symbol === 'SUBROS').status, 'cleared');
});

test('scheduler drafts a sell when a held stock turns Sell; two strikes for daily metrics', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you')).basket;
  invest(st, b.id);
  ok(dispatch(st, 'advance_quarter', {}, 'you'));
  const sell = st.orders.find(o => o.symbol === 'PRECWIRE' && o.side === 'sell');
  assert.ok(sell && sell.status === 'pending' && sell.source === 'rules');
  const st2 = createState();
  ok(dispatch(st2, 'create_basket', { name: 'AC', symbols: AC }, 'you'));
  st2.universe.SRF.metrics.adtv = 1;
  ok(dispatch(st2, 'advance_day', {}, 'you'));
  assert.equal(st2.baskets[0].statusPrev.SRF, 'pass', 'strike 1 only');
  ok(dispatch(st2, 'advance_day', {}, 'you'));
  assert.ok(!st2.baskets[0].symbols.includes('SRF'), 'acts on strike 2');
});

test('CRUD: baskets', () => {
  const st = createState(); st.plan = 'pro';
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you')).basket;
  assert.equal(ok(dispatch(st, 'update_basket', { basket_id: b.id, name: 'Renamed', description: 'note' }, 'claude')).basket.name, 'Renamed');
  assert.equal(dispatch(st, 'update_basket', { basket_id: b.id, theme: 'nope' }, 'you').error.code, 'bad_theme');
  const d = ok(dispatch(st, 'duplicate_basket', { basket_id: b.id }, 'you')).basket;
  assert.equal(d.count, b.count);
  invest(st, b.id);
  const cashBefore = st.cash;
  assert.equal(dispatch(st, 'delete_basket', { basket_id: b.id }, 'claude').error.code, 'person_only');
  assert.equal(dispatch(st, 'delete_basket', { basket_id: b.id }, 'you').error.code, 'has_holdings', 'never deletes shares silently');
  const del = ok(dispatch(st, 'delete_basket', { basket_id: b.id, sell_all: true }, 'you'));
  assert.ok(del.returnedCash > 40000);
  assert.ok(Math.abs(st.cash - (cashBefore + del.returnedCash)) < 1);
  assert.equal(st.baskets.length, 1);
});

test('CRUD: basket stocks, orders, holdings', () => {
  const st = createState(); st.plan = 'pro';
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you')).basket;
  ok(dispatch(st, 'remove_stock', { basket_id: b.id, symbol: 'SRF' }, 'you'));
  assert.ok(!st.baskets[0].symbols.includes('SRF'));
  assert.equal(st.baskets[0].symbols.length, 6, 'refill added a replacement (not invested yet)');
  const o = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 50000 }, 'you')).orders;
  assert.equal(ok(dispatch(st, 'update_order', { order_id: o[0].id, qty: 2 }, 'you')).order.qty, 2);
  ok(dispatch(st, 'cancel_order', { order_id: o[1].id }, 'you'));
  ok(dispatch(st, 'confirm_order', { order_ids: o.map(x => x.id) }, 'you'));
  assert.equal(st.orders.find(x => x.id === o[1].id).status, 'cancelled');
  assert.equal(dispatch(st, 'remove_stock', { basket_id: b.id, symbol: o[0].symbol }, 'you').error.code, 'has_holding');
  const sell = ok(dispatch(st, 'remove_stock', { basket_id: b.id, symbol: o[0].symbol, sell: true }, 'you')).orders[0];
  ok(dispatch(st, 'confirm_order', { order_id: sell.id }, 'you'));
  assert.ok(!st.baskets[0].symbols.includes(o[0].symbol));
  const t = ok(dispatch(st, 'create_basket', { name: 'Mine', kind: 'tracking', holdings: [{ symbol: 'VOLTAS', qty: 10, avg_price: 1200 }] }, 'you')).basket;
  ok(dispatch(st, 'set_holding', { basket_id: t.id, symbol: 'VOLTAS', qty: 25, avg_price: 1100 }, 'you'));
  assert.equal(st.baskets.find(x => x.id === t.id).holdings.VOLTAS.qty, 25);
  ok(dispatch(st, 'remove_stock', { basket_id: t.id, symbol: 'VOLTAS' }, 'you'));
  assert.equal(st.baskets.find(x => x.id === t.id).holdings.VOLTAS, undefined);
});

test('CRUD: flags, alerts, candidates, journal, rules reset', () => {
  const st = createState(); st.plan = 'pro';
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you')).basket;
  invest(st, b.id);
  const f = ok(dispatch(st, 'add_news_flag', { symbol: 'PRECWIRE', metric: 'de', impact: 'worse' }, 'you'));
  ok(dispatch(st, 'update_news_flag', { flag_id: f.flag.id, note: 'edited' }, 'you'));
  const w = ok(dispatch(st, 'delete_news_flag', { flag_id: f.flag.id }, 'you'));
  assert.equal(w.cancelledOrders, 1);
  const a = st.alerts[0].id;
  ok(dispatch(st, 'dismiss_alert', { alert_id: a }, 'you'));
  assert.ok(!st.alerts.some(x => x.id === a));
  ok(dispatch(st, 'clear_alerts', {}, 'you')); assert.equal(st.alerts.length, 0);
  ok(dispatch(st, 'add_candidate', { symbol: 'TESTCO', name: 'Test', sector: 'Energy', themes: { energy: 100 } }, 'claude'));
  ok(dispatch(st, 'add_candidate', { symbol: 'TESTCO', name: 'Test Co 2' }, 'you'));
  assert.equal(st.universe.TESTCO.name, 'Test Co 2');
  assert.equal(dispatch(st, 'delete_candidate', { symbol: 'SRF' }, 'you').error.code, 'protected');
  ok(dispatch(st, 'delete_candidate', { symbol: 'TESTCO' }, 'you'));
  const f2 = ok(dispatch(st, 'add_news_flag', { symbol: 'PRECWIRE', metric: 'de', impact: 'worse' }, 'you'));
  ok(dispatch(st, 'cancel_order', { order_id: f2.drafted_orders[0].id, reason: 'one-off' }, 'you'));
  const j = st.journal[0];
  ok(dispatch(st, 'update_journal', { id: j.id, reason: 'capex debt' }, 'you'));
  ok(dispatch(st, 'delete_journal', { id: j.id }, 'you'));
  ok(dispatch(st, 'set_rule', { basket_id: b.id, rule_id: 'de', green: 0.3, red: 0.6 }, 'you'));
  ok(dispatch(st, 'reset_rules', { basket_id: b.id }, 'you'));
  assert.equal(st.baskets[0].rules.metrics.find(r => r.id === 'de').red, 1);
});

test('plans: free gates apply to both doors the same way; safety is never gated', () => {
  for (const actor of ['you', 'claude']) {
    const st = createState();
    const b = ok(dispatch(st, 'create_basket', { name: 'A', symbols: AC }, actor)).basket;
    assert.equal(dispatch(st, 'create_basket', { name: 'B', symbols: ['VOLTAS'] }, actor).error.code, 'pro_feature');
    assert.equal(dispatch(st, 'set_rule', { basket_id: b.id, rule_id: 'de', green: 0.4, red: 0.9 }, actor).error.code, 'pro_feature');
    assert.equal(dispatch(st, 'toggle_rule', { basket_id: b.id, rule_id: 'ev_surv', enabled: true }, actor).error.code, 'pro_feature');
    for (let i = 0; i < 3; i++) ok(dispatch(st, 'add_news_flag', { symbol: 'SRF', metric: 'peg', impact: 'better' }, actor));
    assert.equal(dispatch(st, 'add_news_flag', { symbol: 'SRF', metric: 'peg', impact: 'better' }, actor).error.code, 'pro_feature');
    assert.equal(ok(dispatch(st, 'get_rule_scorecard', { basket_id: b.id }, actor)).locked, true);
    st.universe.SRF.metrics.de = 3;
    ok(dispatch(st, 'advance_day', {}, actor));
    assert.ok(st.alerts.some(a => a.critical && a.symbol === 'SRF'));
  }
});

test('parity: every MCP tool gives the same result as the website door', () => {
  const run = actor => {
    const st = createState(); st.plan = 'pro';
    const out = {};
    const c = (op, a) => { const r = dispatch(st, op, a, actor); out[op] = r.ok ? strip(r.data) : r.error.code; return r; };
    c('get_universe', { sector: 'Energy', profitable_years: 2 });
    c('add_candidate', { symbol: 'TESTCO', name: 'Test Co', stage: 'power', themes: { energy: 100 }, metrics: { adtv: 20 } });
    const b = c('create_basket', { name: 'AC', symbols: AC }).data.basket;
    c('update_basket', { basket_id: b.id, description: 'x' });
    c('add_stock', { basket_id: b.id, symbol: 'SUBROS' });
    c('remove_stock', { basket_id: b.id, symbol: 'SUBROS' });
    c('get_basket_status', { basket_id: b.id });
    c('set_rule', { basket_id: b.id, rule_id: 'de', green: 0.45, red: 0.95 });
    c('toggle_rule', { basket_id: b.id, rule_id: 'peg', enabled: false });
    c('set_rating_cutoffs', { basket_id: b.id, buy_below: 3, sell_above: 7 });
    c('get_rules', { basket_id: b.id });
    c('apply_default_rules', { basket_id: b.id });
    c('reset_rules', { basket_id: b.id });
    c('set_basket_rule', { basket_id: b.id, max_stage_weight: 45 });
    const ord = c('create_order', { basket_id: b.id, side: 'buy', amount: 50000 });
    c('cancel_order', { order_id: ord.data.orders[0].id });
    c('get_alerts', {});
    c('get_refill_plan', { basket_id: b.id });
    c('add_news_flag', { symbol: 'PRECWIRE', metric: 'de', impact: 'worse', note: 'x' });
    c('get_rule_scorecard', { basket_id: b.id });
    c('exit_basket', { basket_id: b.id });
    c('request_delete_basket', { basket_id: b.id, reason: 'x' });
    c('get_activity', {});
    return out;
  };
  const a = run('you'), b = run('claude');
  for (const t of TOOLS) {
    assert.ok(PARITY[t.name], `website path for ${t.name}`);
    assert.ok(t.name in a, `exercised ${t.name}`);
    assert.deepEqual(a[t.name], b[t.name], t.name);
  }
});
function strip(x) { return JSON.parse(JSON.stringify(x, (k, v) => (['source', 'edited_by', 'editedBy', 'createdAt', 'confirmedBy', 'activity', 'by', 'detail'].includes(k) ? undefined : v))); }

test('refill ladder holds cash and asks for new stocks when nothing fits', () => {
  const st = createState();
  ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you'));
  const basket = st.baskets[0];
  basket.limits.minStocks = 8; basket.limits.maxStageWeight = 15;
  const plan = refillPlan(st, basket);
  assert.ok(plan.short > 0);
  assert.match(plan.prompt, /add_candidate/);
});

test('exit basket: sells everything, cancels pending orders, returns cash, keeps the basket', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you')).basket;
  invest(st, b.id);
  const pendingBuy = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', symbol: 'SRF', qty: 1 }, 'you')).orders[0];
  const ex = ok(dispatch(st, 'exit_basket', { basket_id: b.id }, 'claude'));
  assert.equal(st.orders.find(o => o.id === pendingBuy.id).status, 'cancelled');
  assert.equal(ex.orders.length, Object.values(st.baskets[0].holdings).filter(h => h.qty > 0).length, 'one sell per holding');
  assert.equal(dispatch(st, 'confirm_order', { order_ids: ex.orders.map(o => o.id) }, 'claude').error.code, 'person_only');
  const r = ok(dispatch(st, 'confirm_order', { order_ids: ex.orders.map(o => o.id) }, 'you'));
  assert.equal(r.exits.length, 1);
  assert.ok(Math.abs(st.cash - 100000) < 1500, 'practice cash is back near the start');
  const view = ok(dispatch(st, 'get_basket_status', { basket_id: b.id }, 'you')).basket;
  assert.equal(view.isInvested, false); assert.equal(view.count, 6); assert.equal(view.cash, 0);
  assert.equal(st.orders.filter(o => o.basketId === b.id && o.status === 'pending').length, 0, 'no replacement drafted after an exit');
});

test('activity: every Claude call is logged in plain words; to-do shows what the user must do', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Energy', symbols: ['NTPC', 'POWERGRID', 'COALINDIA', 'PETRONET', 'GAIL', 'PREMIERENE'] }, 'claude')).basket;
  ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 50000 }, 'claude'));
  dispatch(st, 'delete_basket', { basket_id: b.id }, 'claude');
  dispatch(st, 'get_basket_status', {}, 'you'); // the website's own reads are not Claude activity
  const act = ok(dispatch(st, 'get_activity', {}, 'claude'));
  assert.equal(act.activity.length, 3, 'create, order, refused delete (get_activity logs after it runs)');
  assert.match(act.activity[2].text, /Created basket "Energy"/);
  assert.equal(act.activity[1].kind, 'needs_you');
  assert.equal(act.activity[0].ok, false);
  assert.ok(act.activity[0].at && act.activity[0].clock);
  const todo = act.todo[0];
  assert.equal(todo.kind, 'orders'); assert.equal(todo.by, 'Claude'); assert.match(todo.text, /Confirm \d+ orders in Energy/);
  assert.equal(st.activity[0].tool, 'get_activity');
});

test('create_basket keeps every segment within its limit of the final basket', () => {
  const st = createState();
  const u = ok(dispatch(st, 'get_universe', { theme: 'energy', profitable_years: 2 }, 'claude')).stocks.filter(x => x.status !== 'remove').map(x => x.symbol);
  const b = ok(dispatch(st, 'create_basket', { name: 'E', symbols: u }, 'claude'));
  const seg = {};
  for (const s of b.basket.stocks) seg[s.stage] = (seg[s.stage] || 0) + 1;
  for (const n of Object.values(seg)) assert.ok(n / b.basket.count <= 0.4 + 1e-9, JSON.stringify(seg));
  assert.ok(b.skipped.filter(x => /Basket full/.test(x.why)).length > 0);
  assert.equal(b.basket.count, 8);
});

test('Claude connection status: only Claude calls connect; every call stamps when it was last seen', () => {
  const st = createState();
  let s = ok(dispatch(st, 'get_state', {}, 'you'));
  assert.equal(s.claudeConnected, false); assert.equal(s.lastClaudeCall, null);
  ok(dispatch(st, 'create_basket', { name: 'Mine', symbols: ['NTPC', 'POWERGRID', 'COALINDIA', 'PETRONET', 'GAIL', 'PREMIERENE'] }, 'you'));
  assert.equal(ok(dispatch(st, 'get_state', {}, 'you')).claudeConnected, false, 'the website\'s own actions never count');
  ok(dispatch(st, 'get_activity', {}, 'claude'));
  s = ok(dispatch(st, 'get_state', {}, 'you'));
  assert.equal(s.claudeConnected, true); assert.equal(s.lastClaudeCall.op, 'get_activity');
  assert.ok(!Number.isNaN(Date.parse(s.lastClaudeCall.time)));
  // A refused (person-only) call still proves Claude reached the app.
  const st2 = createState();
  assert.equal(dispatch(st2, 'clear_alerts', {}, 'claude').error.code, 'person_only');
  s = ok(dispatch(st2, 'get_state', {}, 'you'));
  assert.equal(s.claudeConnected, true); assert.equal(s.lastClaudeCall.op, 'clear_alerts');
});

test('activity: the user\'s own actions are logged as "you", look-ups never crowd out actions, settled drafts stop asking', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Energy', symbols: ['NTPC', 'POWERGRID', 'COALINDIA', 'PETRONET', 'GAIL', 'PREMIERENE'] }, 'you')).basket;
  const drafted = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 50000 }, 'claude')).orders;
  let S = ok(dispatch(st, 'get_state', {}, 'you'));
  assert.equal(S.activity[0].actor, 'claude'); assert.equal(S.activity[0].pending, true, 'Claude\'s draft still waits for the user');
  assert.equal(S.activity[1].actor, 'you'); assert.match(S.activity[1].text, /Created basket "Energy"/);
  ok(dispatch(st, 'confirm_order', { order_ids: drafted.map(o => o.id) }, 'you'));
  dispatch(st, 'confirm_order', { order_ids: ['nope'] }, 'you'); // nothing filled: not logged
  dispatch(st, 'add_stock', { basket_id: b.id, symbol: 'NOSUCH' }, 'you'); // a failed tap is a toast, not history
  ok(dispatch(st, 'set_plan', { plan: 'pro' }, 'you')); ok(dispatch(st, 'get_stock', { symbol: 'NTPC' }, 'you'));
  S = ok(dispatch(st, 'get_state', {}, 'you'));
  assert.equal(S.activity.length, 3, 'create, draft, confirm');
  assert.equal(S.activity[0].actor, 'you'); assert.equal(S.activity[0].kind, 'change'); assert.match(S.activity[0].text, /^Bought \d+ stocks \(₹[\d,]+\) in "Energy"$/);
  assert.equal(S.activity[1].pending, false, 'the draft is settled once confirmed');
  for (let i = 0; i < 400; i++) dispatch(st, 'get_universe', {}, 'claude');
  assert.ok(st.activity.length <= 300);
  S = ok(dispatch(st, 'get_state', {}, 'you'));
  assert.equal(S.activity.filter(a => a.kind !== 'read').length, 3, 'actions survive a flood of look-ups');
  assert.ok(S.activity.filter(a => a.kind === 'read').length <= 20);
  const tool = ok(dispatch(st, 'get_activity', { limit: 500 }, 'claude')).activity;
  for (const k of ['id', 'at', 'clock', 'actor', 'tool', 'ok', 'text', 'kind']) assert.ok(k in tool[0], `get_activity keeps ${k}`);
  assert.ok(tool.some(a => a.actor === 'you'));
});

test('to-do: most urgent first, and an alert stops being a to-do once its order is confirmed or cancelled', () => {
  const st = createState();
  const todo = () => ok(dispatch(st, 'get_state', {}, 'you')).todo;
  const a = ok(dispatch(st, 'create_basket', { name: 'Energy', symbols: ['NTPC', 'POWERGRID', 'COALINDIA', 'PETRONET', 'GAIL', 'RELIANCE'] }, 'you')).basket;
  assert.deepEqual(todo().map(t => t.kind), ['basket'], '5 of the 6 fit the segment limit: one short of the minimum');
  for (const x of st.baskets) x.limits.minStocks = 5;
  assert.deepEqual(todo().map(t => t.kind), ['invest']);
  invest(st, a.id);
  for (const o of st.orders.filter(o => o.status === 'pending')) ok(dispatch(st, 'cancel_order', { order_id: o.id }, 'you'));
  assert.deepEqual(todo(), [], 'invested and nothing waiting');
  const flag = ok(dispatch(st, 'add_news_flag', { symbol: 'PETRONET', metric: 'de', impact: 'worse', note: 'Borrowing jumped' }, 'you'));
  assert.equal(flag.drafted_orders.length, 1);
  let t = todo();
  assert.deepEqual(t.map(x => x.kind), ['orders', 'flags'], 'the urgent alert is covered by its sell order, not listed twice');
  assert.equal(t[0].priority, 0); assert.deepEqual(t[0].ids, [flag.drafted_orders[0].id]);
  ok(dispatch(st, 'set_plan', { plan: 'pro' }, 'you'));
  const b = ok(dispatch(st, 'create_basket', { name: 'Second', symbols: ['NTPC', 'POWERGRID', 'COALINDIA', 'GAIL', 'RELIANCE', 'ONGC'] }, 'you')).basket;
  for (const x of st.baskets) x.limits.minStocks = Math.min(x.limits.minStocks, x.symbols.length);
  ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 20000 }, 'claude'));
  t = todo();
  assert.deepEqual(t.map(x => [x.kind, x.basketId]).slice(0, 2), [['orders', a.id], ['orders', b.id]], 'a sell the rules or news asked for comes before a plain buy');
  assert.deepEqual(t.map(x => x.priority), [...t.map(x => x.priority)].sort((x, y) => x - y));
  ok(dispatch(st, 'cancel_order', { order_id: flag.drafted_orders[0].id, reason: 'Wait for results' }, 'you'));
  t = todo();
  assert.ok(!t.some(x => x.kind === 'alerts'), 'kept anyway: the alert about that order is settled');
  assert.ok(!t.some(x => x.kind === 'orders' && x.ids.includes(flag.drafted_orders[0].id)));
  assert.match(st.activity[0].text, /^Kept Petronet LNG anyway$/);
});

test('activity text uses singular for one stock', () => {
  const st = createState();
  ok(dispatch(st, 'create_basket', { name: 'Solo', symbols: ['SRF'] }, 'you'));
  const a = ok(dispatch(st, 'get_activity', {}, 'you')).activity.find(x => /Created basket "Solo"/.test(x.text));
  assert.match(a.text, /with 1 stock(?!s)/);
});

test('rules can be edited per basket, as defaults, or everywhere (and with no baskets)', () => {
  const st = createState();
  // No baskets: toggling goes to the defaults instead of failing
  // On Free rules are read-only: anyone can read them, nobody can edit them (website or Claude)
  let r = dispatch(st, 'get_rules', {}, 'claude');
  assert.equal(r.ok, true); assert.equal(r.data.scope, 'defaults'); assert.equal(r.data.metrics.length, 13);
  for (const actor of ['claude', 'you']) {
    for (const [op, a] of [['toggle_rule', { rule_id: 'vol', enabled: false }], ['set_rule', { rule_id: 'de', green: 0.5, red: 1 }], ['reset_rules', { scope: 'defaults' }], ['apply_default_rules', {}]]) {
      r = dispatch(st, op, a, actor);
      assert.equal(r.ok, false, `${op} by ${actor} on Free`); assert.equal(r.error.code, 'pro_feature'); assert.match(r.error.free_alternative, /read-only/);
    }
  }
  dispatch(st, 'set_plan', { plan: 'pro' }, 'you');
  // Pro, no baskets: a switch goes to the default rules
  r = dispatch(st, 'toggle_rule', { rule_id: 'vol', enabled: false }, 'you');
  assert.equal(r.ok, true); assert.equal(r.data.scope, 'defaults'); assert.equal(st.rules.metrics.find(x => x.id === 'vol').enabled, false);
  r = dispatch(st, 'set_rule', { rule_id: 'de', green: 0.4, red: 0.9 }, 'claude');
  assert.equal(r.ok, true); assert.equal(st.rules.metrics.find(x => x.id === 'de').green, 0.4);
  // New baskets start with the edited defaults
  const b1 = dispatch(st, 'create_basket', { name: 'One', symbols: ['NTPC', 'POWERGRID', 'COALINDIA', 'ONGC', 'GAIL', 'PETRONET'] }, 'you').data.basket;
  const b2 = dispatch(st, 'create_basket', { name: 'Two', symbols: ['SRF', 'HAVELLS', 'BLUESTARCO', 'VOLTAS', 'KIRLPNU', 'NAVINFLUOR'] }, 'you').data.basket;
  const rulesOf = id => st.baskets.find(b => b.id === id).rules;
  assert.equal(rulesOf(b1.id).metrics.find(x => x.id === 'de').green, 0.4);
  // One basket only
  dispatch(st, 'set_rule', { basket_id: b1.id, rule_id: 'roe', green: 20, red: 12 }, 'you');
  assert.equal(rulesOf(b1.id).metrics.find(x => x.id === 'roe').green, 20);
  assert.notEqual(rulesOf(b2.id).metrics.find(x => x.id === 'roe').green, 20);
  // Everywhere
  r = dispatch(st, 'toggle_rule', { scope: 'all', rule_id: 'beta', enabled: false }, 'claude');
  assert.equal(r.ok, true);
  for (const rs of [st.rules, rulesOf(b1.id), rulesOf(b2.id)]) assert.equal(rs.metrics.find(x => x.id === 'beta').enabled, false);
  // Copy defaults onto baskets, then reset defaults
  dispatch(st, 'apply_default_rules', {}, 'you');
  assert.notEqual(rulesOf(b1.id).metrics.find(x => x.id === 'roe').green, 20);
  dispatch(st, 'reset_rules', { scope: 'defaults' }, 'you');
  assert.equal(st.rules.metrics.find(x => x.id === 'vol').enabled, true);
});

test('plan switch: Free caps a Pro basket without breaking it, turns off every-change alerts, Pro restores', () => {
  const st = createState();
  ok(dispatch(st, 'set_plan', { plan: 'pro' }, 'you'));
  ok(dispatch(st, 'set_notif', { push: true }, 'you'));
  const b = ok(dispatch(st, 'create_basket', { name: 'Big', symbols: [...AC, 'LGEINDIA', 'KRN', 'AVL'] }, 'you')).basket;
  assert.ok(b.count > 8);
  ok(dispatch(st, 'set_plan', { plan: 'free' }, 'you'));
  const S = ok(dispatch(st, 'get_state', {}, 'you'));
  assert.equal(S.notif.push, false, 'every-change alerts are Pro');
  assert.equal(S.baskets[0].limits.maxStocks, 8); assert.equal(S.baskets[0].overPlanMax, true);
  ok(dispatch(st, 'set_plan', { plan: 'pro' }, 'you'));
  assert.equal(ok(dispatch(st, 'get_state', {}, 'you')).baskets[0].limits.maxStocks, 12, 'Pro gets its 12 back');
  // A basket created on Free can grow past 8 after upgrading
  const st2 = createState();
  const b2 = ok(dispatch(st2, 'create_basket', { name: 'Small', symbols: AC }, 'you')).basket;
  ok(dispatch(st2, 'set_plan', { plan: 'pro' }, 'you'));
  for (const sym of ['LGEINDIA', 'KRN', 'AVL', 'SUBROS']) dispatch(st2, 'add_stock', { basket_id: b2.id, symbol: sym }, 'you');
  assert.ok(ok(dispatch(st2, 'get_state', {}, 'you')).baskets[0].count > 8, 'past the Free cap of 8 on Pro');
  assert.ok(b2.count <= 8);
});

test('invest: whole-share rounding never drafts more than the amount, and confirm never half-fills', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'All in', symbols: AC }, 'you')).basket;
  const d = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 100000 }, 'you'));
  const total = d.orders.reduce((t, o) => t + o.estValue * 1.001, 0);
  assert.ok(total <= 100000 + 0.01, `drafted ${total}`);
  ok(dispatch(st, 'confirm_order', { order_ids: d.orders.map(o => o.id) }, 'you'));
  // Too much for the cash left: refused up front, nothing filled
  const d2 = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', symbol: 'SRF', qty: 1 }, 'you'));
  ok(dispatch(st, 'update_order', { order_id: d2.orders[0].id, qty: 500 }, 'you'));
  const r = dispatch(st, 'confirm_order', { order_ids: [d2.orders[0].id] }, 'you');
  assert.equal(r.ok, false); assert.equal(r.error.code, 'insufficient');
  assert.equal(st.orders.find(o => o.id === d2.orders[0].id).status, 'pending');
});

test('delete basket removes its orders, alerts and journal; remove_stock reports an automatic replacement', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Gone', symbols: AC }, 'you')).basket;
  ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 20000 }, 'you'));
  ok(dispatch(st, 'delete_basket', { basket_id: b.id }, 'you'));
  assert.equal(st.orders.filter(o => o.basketId === b.id).length, 0);
  assert.equal(ok(dispatch(st, 'get_state', {}, 'you')).todo.length, 0);
  const b2 = ok(dispatch(st, 'create_basket', { name: 'Six', symbols: AC.slice(0, 6) }, 'you')).basket;
  const r = ok(dispatch(st, 'remove_stock', { basket_id: b2.id, symbol: 'SRF' }, 'you'));
  assert.ok(r.basket.count >= 6, 'uninvested basket refilled at once');
  assert.equal(r.refilled.length, r.basket.count - (b2.count - 1));
  assert.ok(r.refilled.length >= 1);
});

// ---- Money bugs from the owner's phone recording ----
const SIX = ['SRF', 'HAVELLS', 'KIRLPNU', 'NAVINFLUOR', 'BLUESTARCO', 'PRECWIRE'];
test('invest sizing: whole shares sized to each part, a too-dear stock is reported not dropped silently, totals agree', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Six', symbols: SIX }, 'you')).basket;
  assert.equal(b.count, 6);
  const d = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 50000 }, 'you'));
  // Navin Fluorine is ₹9,115 a share, more than its ₹8,333 part: listed with the reason
  assert.ok(d.skipped.some(x => x.symbol === 'NAVINFLUOR' && /One share costs/.test(x.why)), JSON.stringify(d.skipped));
  assert.equal(d.orders.length + d.skipped.length, 6, 'every stock is either bought or explained');
  const sum = d.orders.reduce((t, o) => t + o.estValue, 0);
  assert.ok(Math.abs(sum - d.total) < 1, 'total shown = sum of orders');
  assert.ok(d.total > 45000 && d.total <= 50000, `invests close to the amount: ${d.total}`);
  for (const o of d.orders) assert.ok(o.estValue <= 50000 / 5 + 1, `${o.symbol} sized to its part`);
  // Below the minimum: investing is refused with the reason
  const st2 = createState();
  const s2 = ok(dispatch(st2, 'create_basket', { name: 'Three', symbols: SIX.slice(0, 3) }, 'you')).basket;
  assert.equal(dispatch(st2, 'create_order', { basket_id: s2.id, side: 'buy', amount: 50000 }, 'you').error.code, 'below_min');
});

test('rebalance: nothing to do right after investing; real drift drafts buys and sells that move toward target', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Six', symbols: SIX }, 'you')).basket;
  invest(st, b.id, 50000);
  let v = ok(dispatch(st, 'get_basket_status', { basket_id: b.id }, 'you')).basket;
  assert.equal(v.needsRebalance, false, `fresh basket is on target (drift ${v.drift})`);
  assert.equal(ok(dispatch(st, 'rebalance_plan', { basket_id: b.id, draft: true }, 'you')).orders.length, 0);
  // One stock doubles: now it is far over target
  st.prices.SRF *= 2.2;
  v = ok(dispatch(st, 'get_basket_status', { basket_id: b.id }, 'you')).basket;
  assert.equal(v.needsRebalance, true);
  const r = ok(dispatch(st, 'rebalance_plan', { basket_id: b.id, draft: true }, 'you'));
  assert.ok(r.orders.some(o => o.symbol === 'SRF' && o.side === 'sell'));
  ok(dispatch(st, 'confirm_order', { order_ids: r.orders.map(o => o.id) }, 'you'));
  const after = ok(dispatch(st, 'rebalance_plan', { basket_id: b.id }, 'you'));
  assert.ok(after.max < r.max, `closer to target: ${r.max} → ${after.max}`);
});

test('exit P/L compares like with like: basket cash from earlier sells counts as money back', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Six', symbols: SIX }, 'you')).basket;
  invest(st, b.id, 50000);
  const sym = Object.keys(st.baskets[0].holdings)[0];
  const s1 = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'sell', symbol: sym, qty: 1 }, 'you'));
  ok(dispatch(st, 'confirm_order', { order_ids: s1.orders.map(o => o.id) }, 'you'));
  assert.ok(st.baskets[0].cash > 0);
  const ex = ok(dispatch(st, 'exit_basket', { basket_id: b.id }, 'you'));
  assert.ok(Math.abs(ex.estimatedProceeds - ex.costBasis) < ex.costBasis * 0.01, `same day: ~no profit or loss (${ex.estimatedProceeds} vs ${ex.costBasis})`);
  const r = ok(dispatch(st, 'confirm_order', { order_ids: ex.orders.map(o => o.id) }, 'you'));
  assert.ok(Math.abs(r.exits[0].profit) < ex.costBasis * 0.01);
  assert.ok(Math.abs(st.cash - 100000) < 500);
});

test('delete with holdings needs an explicit sell-all; preview shows money back; old duplicate names are numbered', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Six', symbols: SIX }, 'you')).basket;
  invest(st, b.id, 50000);
  const pv = ok(dispatch(st, 'delete_preview', { basket_id: b.id }, 'you'));
  assert.equal(pv.holds, true); assert.ok(pv.moneyBack > 45000);
  assert.equal(dispatch(st, 'delete_basket', { basket_id: b.id }, 'you').error.code, 'has_holdings');
  assert.equal(st.baskets.length, 1);
  const d = ok(dispatch(st, 'delete_basket', { basket_id: b.id, sell_all: true }, 'you'));
  assert.ok(Math.abs(d.returnedCash - pv.moneyBack) < 50);
  assert.ok(Math.abs(st.cash - 100000) < 500);
  const old = createState(); delete old.namesUnique;
  old.baskets = [{ name: 'My basket' }, { name: 'My basket' }, { name: 'My basket' }].map((x, i) => ({ ...x, id: 'b' + i, kind: 'tracking', symbols: [], holdings: {}, cash: 0, limits: { minStocks: 6, maxStocks: 12 }, rules: old.rules, statusPrev: {}, strikes: {}, removedAt: {} }));
  ok(dispatch(old, 'get_state', {}, 'you'));
  assert.deepEqual(old.baskets.map(x => x.name), ['My basket', 'My basket 2', 'My basket 3']);
});

test('rebalance never sells a stock the person kept anyway after a rules Sell', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Six', symbols: SIX }, 'you')).basket;
  invest(st, b.id, 50000);
  ok(dispatch(st, 'advance_quarter', {}, 'you')); // Precision Wires results: debt 2.1× → Sell, sell drafted
  const sell = st.orders.find(o => o.symbol === 'PRECWIRE' && o.status === 'pending');
  assert.ok(sell, 'rules drafted a sell');
  ok(dispatch(st, 'cancel_order', { order_id: sell.id, reason: 'Keep' }, 'you'));
  const r = ok(dispatch(st, 'rebalance_plan', { basket_id: b.id }, 'you'));
  assert.ok(!r.trades.some(t => t.symbol === 'PRECWIRE'));
  assert.ok(!r.rows.some(x => x.symbol === 'PRECWIRE'));
});

test('rating cutoffs: Pro edits Buy/Hold/Sell by warnings for defaults, a basket or all; Free and bad values refused', () => {
  const st = createState();
  const b = ok(dispatch(st, 'create_basket', { name: 'Six', symbols: SIX }, 'you')).basket;
  assert.equal(dispatch(st, 'set_rating_cutoffs', { scope: 'defaults', buy_below: 3, sell_above: 6 }, 'claude').error.code, 'pro_feature');
  assert.equal(dispatch(st, 'set_rating_cutoffs', { scope: 'defaults', buy_below: 3, sell_above: 6 }, 'you').error.code, 'pro_feature');
  st.plan = 'pro';
  assert.equal(dispatch(st, 'set_rating_cutoffs', { scope: 'defaults', buy_below: 7, sell_above: 5 }, 'claude').error.code, 'bad_cutoffs');
  // Default: Navin Fluorine (3 warnings) is Buy. With "Buy below 3" it becomes Hold in the default ratings only.
  const nf = () => ok(dispatch(st, 'get_universe', { q: 'Navin' }, 'you')).stocks[0].status;
  assert.equal(nf(), 'pass');
  const r = ok(dispatch(st, 'set_rating_cutoffs', { scope: 'defaults', buy_below: 3, sell_above: 6 }, 'claude'));
  assert.match(r.cutoffs.meaning, /fewer than 3/);
  assert.equal(nf(), 'watch');
  assert.equal(ok(dispatch(st, 'get_rules', { scope: 'defaults' }, 'claude')).cutoffs.buy_below, 3);
  assert.equal(ok(dispatch(st, 'get_rules', { basket_id: b.id }, 'claude')).cutoffs.buy_below, 4, 'basket keeps its own');
  ok(dispatch(st, 'set_rating_cutoffs', { scope: 'all', buy_below: 2, sell_above: 6 }, 'claude'));
  assert.equal(st.baskets[0].rules.cutoffs.buyBelow, 2);
  // A second basket makes "which rules?" ambiguous without scope or basket_id
  ok(dispatch(st, 'create_basket', { name: 'Two', symbols: SIX }, 'you'));
  assert.equal(dispatch(st, 'set_rating_cutoffs', { buy_below: 4 }, 'claude').error.code, 'which_rules');
  assert.equal(dispatch(st, 'set_rule', { rule_id: 'de', green: 0.4 }, 'claude').error.code, 'which_rules');
  assert.equal(dispatch(st, 'get_basket_status', { basket_id: 'nope' }, 'claude').error.code, 'not_found');
  assert.equal(dispatch(st, 'add_stock', { symbol: 'NTPC' }, 'claude').error.code, 'which_basket');
  ok(dispatch(st, 'reset_rules', { scope: 'all' }, 'claude'));
  assert.equal(nf(), 'pass');
});

test('Claude asks to delete a basket; the person confirms or keeps it', () => {
  const st = createState();
  dispatch(st, 'set_plan', { plan: 'pro' }, 'you');
  const b = dispatch(st, 'create_basket', { name: 'Gone soon', symbols: AC }, 'claude').data.basket;
  assert.equal(dispatch(st, 'delete_basket', { basket_id: b.id }, 'claude').error.code, 'person_only');
  const r = dispatch(st, 'request_delete_basket', { basket_id: b.id, reason: 'You asked to start over' }, 'claude');
  assert.ok(r.ok);
  const s1 = dispatch(st, 'get_state', {}, 'you').data;
  assert.equal(s1.todo[0].kind, 'delete');
  assert.equal(s1.baskets.find(x => x.id === b.id).deleteRequest.by, 'claude');
  assert.equal(s1.activity[0].kind, 'needs_you');
  dispatch(st, 'keep_basket', { basket_id: b.id }, 'you');
  assert.ok(!dispatch(st, 'get_state', {}, 'you').data.todo.some(t => t.kind === 'delete'));
  dispatch(st, 'request_delete_basket', { basket_id: b.id }, 'claude');
  assert.ok(dispatch(st, 'delete_basket', { basket_id: b.id }, 'you').ok);
  assert.ok(!dispatch(st, 'get_state', {}, 'you').data.todo.some(t => t.kind === 'delete'));
});

test('exit on a basket with no shares never silently cancels waiting buys', () => {
  const st = createState();
  dispatch(st, 'set_plan', { plan: 'pro' }, 'you');
  const b = dispatch(st, 'create_basket', { name: 'Fresh', symbols: AC }, 'claude').data.basket;
  const o = dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 50000 }, 'claude').data.orders;
  const r = dispatch(st, 'exit_basket', { basket_id: b.id }, 'claude');
  assert.equal(r.error.code, 'nothing_held');
  assert.equal(st.orders.filter(x => x.status === 'pending').length, o.length);
  assert.ok(dispatch(st, 'cancel_order', { order_id: o[0].id }, 'claude').ok);
});

test('the return right after buying says it is the trading cost', () => {
  const st = createState();
  dispatch(st, 'set_plan', { plan: 'pro' }, 'you');
  const b = dispatch(st, 'create_basket', { name: 'Cost', symbols: AC }, 'you').data.basket;
  const o = dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 50000 }, 'you').data.orders;
  dispatch(st, 'confirm_order', { order_ids: o.map(x => x.id) }, 'you');
  const v = dispatch(st, 'get_basket_status', { basket_id: b.id }, 'you').data.basket;
  assert.ok(v.pnl < 0 && v.costs > 0);
  assert.ok(Math.abs(v.pnl + v.costs) < 1, `pnl ${v.pnl} vs costs ${v.costs}`);
  assert.match(v.pnlNote, /trading cost/);
});

test('alerts: deleting a notification also cancels its waiting orders; clear all does the same', () => {
  const st = createState(); st.plan = 'pro';
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you')).basket;
  invest(st, b.id);
  st.universe.SRF.metrics.de = 2; // must-pass rule breaks → Sell drafted with an alert
  ok(dispatch(st, 'advance_day', {}, 'you'));
  const al = st.alerts.find(a => a.action?.kind === 'orders');
  assert.ok(al, 'an alert with a drafted order');
  const ids = al.action.ids;
  assert.ok(ids.every(id => st.orders.find(o => o.id === id).status === 'pending'));
  const r = ok(dispatch(st, 'dismiss_alert', { alert_id: al.id }, 'you'));
  assert.equal(r.cancelled.length, ids.length);
  assert.ok(ids.every(id => st.orders.find(o => o.id === id).status === 'cancelled'));
  assert.ok(!st.alerts.some(a => a.id === al.id));
  assert.ok(!ok(dispatch(st, 'get_activity', {}, 'you')).todo.some(t => t.kind === 'orders' && t.ids.some(id => ids.includes(id))));
  assert.match(st.activity[0].text, /Deleted notification .* cancelled/);
  const kept = ok(dispatch(st, 'get_state', {}, 'you')).clearedAlerts[0];
  assert.equal(kept.id, al.id); assert.equal(kept.cancelled.length, ids.length);
  // A plain alert deletes without touching orders
  const before = st.orders.filter(o => o.status === 'pending').length;
  const left = st.alerts.length, archived = st.clearedAlerts.length;
  ok(dispatch(st, 'clear_alerts', {}, 'you'));
  assert.equal(st.alerts.length, 0);
  assert.equal(st.clearedAlerts.length, archived + left);
  assert.ok(st.orders.filter(o => o.status === 'pending').length <= before);
});
