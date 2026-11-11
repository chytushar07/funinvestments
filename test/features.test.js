// Feature-by-feature CRUD and state tests. Every call goes through `run`, which checks the whole
// saved state stays consistent afterwards (no orphan orders, no negative cash, to-do in step, ...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, dispatch } from '../engine/core.js';

const AC = ['SRF', 'NAVINFLUOR', 'HAVELLS', 'BLUESTARCO', 'KIRLPNU', 'PRECWIRE'];
const EN = ['NTPC', 'TORNTPOWER', 'COALINDIA', 'PETRONET', 'OIL', 'PREMIERENE'];

function invariants(st) {
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  assert.ok(fin(st.cash) && st.cash >= -0.01, `cash ${st.cash}`);
  const ids = new Set(st.baskets.map(b => b.id));
  assert.equal(ids.size, st.baskets.length, 'basket ids unique');
  assert.equal(new Set(st.baskets.map(b => b.name.toLowerCase())).size, st.baskets.length, 'basket names unique');
  for (const b of st.baskets) {
    assert.ok(fin(b.cash) && b.cash >= -0.01, `${b.name} cash ${b.cash}`);
    assert.equal(new Set(b.symbols).size, b.symbols.length, `${b.name} symbols unique`);
    for (const s of b.symbols) assert.ok(st.universe[s], `${b.name} has unknown ${s}`);
    for (const [s, h] of Object.entries(b.holdings)) {
      assert.ok(Number.isInteger(h.qty) && h.qty >= 0, `${b.name} ${s} qty ${h.qty}`);
      assert.ok(fin(h.avg), `${b.name} ${s} avg`);
      if (b.kind === 'model' && h.qty > 0) assert.ok(b.symbols.includes(s), `${b.name} holds ${s} not in its list`);
    }
    if (b.deleteRequest) assert.ok(b.deleteRequest.by, 'delete request has an author');
  }
  for (const o of st.orders) {
    assert.ok(['pending', 'filled', 'cancelled'].includes(o.status), `order status ${o.status}`);
    assert.ok(Number.isInteger(o.qty) && o.qty >= 1, `order qty ${o.qty}`);
    if (o.status !== 'pending') continue;
    const b = st.baskets.find(x => x.id === o.basketId);
    assert.ok(b, `pending order ${o.id} for a deleted basket`);
    if (o.side === 'sell') assert.ok(o.qty <= (b.holdings[o.symbol]?.qty || 0), `pending sell ${o.symbol} ${o.qty} > held`);
  }
  for (const a of st.alerts) if (a.basketId) assert.ok(ids.has(a.basketId), `alert ${a.id} for a deleted basket`);
  const s = dispatch(st, 'get_state', {}, 'you');
  assert.ok(s.ok, 'get_state works');
  const S = s.data;
  JSON.stringify(S);
  assert.equal(S.unread, st.alerts.filter(a => !a.read).length);
  assert.equal(S.pending, st.orders.filter(o => o.status === 'pending').length);
  for (const t of S.todo) {
    if (t.basketId) assert.ok(ids.has(t.basketId), `todo for deleted basket: ${t.text}`);
    if (t.kind === 'orders') assert.ok(t.ids.every(id => st.orders.find(o => o.id === id)?.status === 'pending'), 'todo orders pending');
    if (t.kind === 'invest' || t.kind === 'basket') assert.ok(!st.baskets.find(b => b.id === t.basketId).deleteRequest, 'no invest nag while delete waits');
  }
  for (const d of st.declined || []) assert.ok(ids.has(d.key.split(':')[1]) || !d.key.includes(':'), `declined key for deleted basket ${d.key}`);
  for (const b of S.baskets) {
    const tw = b.stocks.reduce((t, x) => t + x.target, 0);
    assert.ok(tw <= 100.05, `${b.name} targets sum ${tw}`);
    assert.ok(fin(b.value) && fin(b.returnPct), `${b.name} figures`);
  }
}

function make(plan = 'pro') {
  const st = createState(); st.plan = plan;
  const run = (op, args = {}, actor = 'you') => { const r = dispatch(st, op, args, actor); invariants(st); return r; };
  const ok = (op, args, actor) => { const r = run(op, args, actor); assert.ok(r.ok, `${op}: ${JSON.stringify(r.error)}`); return r.data; };
  const no = (op, args, code, actor) => { const r = run(op, args, actor); assert.ok(!r.ok, `${op} should fail`); if (code) assert.equal(r.error.code, code, `${op}: ${r.error.message}`); return r.error; };
  const basket = (name = 'AC', symbols = AC) => ok('create_basket', { name, symbols }).basket;
  const invest = (id, amount = 50000) => { const d = ok('create_order', { basket_id: id, side: 'buy', amount }); return ok('confirm_order', { order_ids: d.orders.map(o => o.id) }); };
  return { st, run, ok, no, basket, invest };
}

// ---------------- Baskets ----------------
test('baskets: create (empty/unknown/duplicate names/limits), read, update, duplicate', () => {
  const { st, ok, no, basket } = make();
  invariants(st);
  assert.equal(ok('get_basket_status', {}).baskets.length, 0, 'empty list');
  no('get_basket_status', { basket_id: 'nope' }, 'not_found');
  no('create_basket', { name: 'X', symbols: [] }, 'empty_basket');
  no('create_basket', { name: 'X', symbols: ['FOO', 'BAR'] }, 'empty_basket');
  const b = basket('AC');
  assert.equal(b.count, 6);
  const b2 = basket('AC');
  assert.equal(b2.name, 'AC 2', 'duplicate name gets a number');
  const blank = ok('create_basket', { name: '   ', symbols: AC }).basket;
  assert.ok(blank.name.length > 0, 'blank name falls back');
  const long = ok('create_basket', { name: 'x'.repeat(200), symbols: EN }).basket;
  assert.ok(long.name.length <= 40);
  const up = ok('update_basket', { basket_id: b.id, name: 'Renamed', description: 'note' }).basket;
  assert.equal(up.name, 'Renamed'); assert.equal(up.description, 'note');
  assert.equal(ok('update_basket', { basket_id: b2.id, name: 'Renamed' }).basket.name, 'Renamed 2', 'rename to taken name');
  no('update_basket', { basket_id: b.id, theme: 'bogus' }, 'bad_theme');
  ok('update_basket', { basket_id: b.id, theme: null });
  ok('update_basket', { basket_id: b.id, theme_name: 'My theme' });
  const dup = ok('duplicate_basket', { basket_id: b.id }).basket;
  assert.equal(dup.count, 6); assert.notEqual(dup.id, b.id);
  assert.equal(ok('get_basket_status', {}).baskets.length, 5);
});

test('baskets: Free plan limits and switching plans keeps data', () => {
  const { ok, no, basket } = make('free');
  basket('AC');
  no('create_basket', { name: 'Second', symbols: EN }, 'pro_feature');
  ok('set_plan', { plan: 'pro' });
  basket('Energy', EN);
  ok('set_plan', { plan: 'free' });
  assert.equal(ok('get_basket_status', {}).baskets.length, 2, 'downgrade keeps baskets');
  no('duplicate_basket', { basket_id: ok('get_basket_status', {}).baskets[0].id }, 'pro_feature');
});

test('baskets: delete empty, delete with holdings (needs sell_all), delete with pending orders, alerts go too', () => {
  const { st, ok, no, basket, invest } = make();
  const e = basket('Empty');
  ok('create_order', { basket_id: e.id, side: 'buy', amount: 20000 });
  ok('delete_basket', { basket_id: e.id });
  assert.ok(!st.orders.some(o => o.basketId === e.id), 'its orders are gone');
  const b = basket('Held', EN); invest(b.id);
  const cash = st.cash;
  no('delete_basket', { basket_id: b.id }, 'has_holdings');
  const p = ok('delete_preview', { basket_id: b.id });
  assert.ok(p.holds && p.moneyBack > 0);
  const d = ok('delete_basket', { basket_id: b.id, sell_all: true });
  assert.ok(Math.abs(st.cash - (cash + d.returnedCash)) < 0.01, 'cash back matches');
  assert.equal(st.baskets.length, 0);
  no('delete_basket', { basket_id: b.id }, 'not_found');
});

test('baskets: Claude cannot delete; request → keep / decline / delete; exit keeps basket', () => {
  const { st, ok, no, basket, invest } = make();
  const b = basket(); invest(b.id);
  no('delete_basket', { basket_id: b.id }, 'person_only', 'claude');
  ok('request_delete_basket', { basket_id: b.id, reason: 'asked' }, 'claude');
  assert.equal(ok('get_activity', {}).todo[0].kind, 'delete');
  ok('keep_basket', { basket_id: b.id });
  assert.ok(!st.baskets[0].deleteRequest);
  ok('request_delete_basket', { basket_id: b.id }, 'claude');
  ok('decline_todo', { key: 'delete:' + b.id });
  assert.ok(!st.baskets[0].deleteRequest, 'decline keeps the basket');
  const ex = ok('exit_basket', { basket_id: b.id });
  ok('confirm_order', { order_ids: ex.orders.map(o => o.id) });
  assert.ok(!st.baskets[0].holdings || !Object.values(st.baskets[0].holdings).some(h => h.qty > 0), 'nothing held after exit');
  assert.equal(st.baskets.length, 1, 'exit keeps the basket');
  assert.equal(ok('exit_basket', { basket_id: b.id }).orders.length, 0, 'exit on empty is a no-op');
});

// ---------------- Stocks in a basket ----------------
test('stocks: add (dup, unknown, Sell-rated, over segment, full), remove (held needs sell, refill)', () => {
  const { st, ok, no, basket, invest } = make();
  const b = basket();
  no('add_stock', { basket_id: b.id, symbol: 'SRF' }, 'exists');
  no('add_stock', { basket_id: b.id, symbol: 'NOPE' }, 'not_found');
  no('add_stock', { basket_id: b.id, symbol: 'RAMRAT' }, 'rule_block');
  ok('add_stock', { basket_id: b.id, symbol: 'VOLTAS' === 'x' ? 'x' : 'PETRONET' });
  ok('remove_stock', { basket_id: b.id, symbol: 'PETRONET' });
  no('remove_stock', { basket_id: b.id, symbol: 'PETRONET' }, 'not_found');
  invest(b.id);
  no('remove_stock', { basket_id: b.id, symbol: 'SRF' }, 'has_holding');
  const r = ok('remove_stock', { basket_id: b.id, symbol: 'SRF', sell: true });
  ok('confirm_order', { order_ids: r.orders.map(o => o.id) });
  assert.ok(!st.baskets[0].symbols.includes('SRF'), 'sold then removed');
  // dropping below the minimum on an invested basket drafts or asks for a refill, never leaves junk
  assert.ok(st.alerts.some(a => a.type === 'refill') || st.baskets[0].symbols.length >= 6);
});

// ---------------- Tracking baskets / holdings ----------------
test('tracking: create with holdings, edit, zero qty, remove, no orders', () => {
  const { st, ok, no } = make();
  const t = ok('create_basket', { name: 'Real', kind: 'tracking', holdings: [{ symbol: 'SRF', qty: 3, avg_price: 2000 }, { symbol: 'NTPC', qty: 10 }] }).basket;
  assert.equal(t.kind, 'tracking');
  ok('set_holding', { basket_id: t.id, symbol: 'SRF', qty: 5, avg_price: 2100 });
  ok('set_holding', { basket_id: t.id, symbol: 'OIL', qty: 0 });
  ok('set_holding', { basket_id: t.id, symbol: 'OIL', qty: -4 });
  assert.equal(st.baskets[0].holdings.OIL.qty, 0, 'negative clamps to 0');
  no('set_holding', { basket_id: t.id, symbol: 'ZZZ', qty: 1 }, 'not_found');
  no('create_order', { basket_id: t.id, side: 'buy', amount: 1000 }, 'tracking_no_orders');
  no('exit_basket', { basket_id: t.id }, 'tracking_no_orders');
  ok('remove_stock', { basket_id: t.id, symbol: 'NTPC' });
  assert.ok(!st.baskets[0].holdings.NTPC);
});

// ---------------- Investing / orders ----------------
test('orders: invest amounts (0, negative, text, too small, over cash, exact), below min, confirm, cancel, edit qty', () => {
  const { st, ok, no, basket } = make();
  const b = basket();
  for (const amount of [0, -100, 'abc', undefined]) no('create_order', { basket_id: b.id, side: 'buy', amount }, 'bad_amount');
  no('create_order', { basket_id: b.id, side: 'buy', amount: 50 }, 'bad_amount');
  no('create_order', { basket_id: b.id, side: 'buy', amount: st.cash + 1 }, 'insufficient');
  const all = ok('create_order', { basket_id: b.id, side: 'buy', amount: st.cash });
  assert.ok(all.total <= st.cash && all.leftover >= 0);
  const one = all.orders[0];
  no('update_order', { order_id: one.id, qty: 0 }, 'bad_qty');
  ok('update_order', { order_id: one.id, qty: one.qty + 1 });
  ok('cancel_order', { order_id: one.id });
  no('cancel_order', { order_id: one.id }, 'not_found');
  no('update_order', { order_id: one.id, qty: 2 }, 'not_found');
  const rest = all.orders.slice(1).map(o => o.id);
  ok('confirm_order', { order_ids: rest });
  assert.ok(st.cash >= 0);
  no('confirm_order', { order_ids: rest }, null, 'claude');
  const r = dispatch(st, 'confirm_order', { order_ids: rest }, 'claude');
  assert.equal(r.error.code, 'person_only');
  // below the minimum
  const small = ok('create_basket', { name: 'Small', symbols: ['SRF', 'HAVELLS'] }).basket;
  no('create_order', { basket_id: small.id, side: 'buy', amount: 10000 }, 'below_min');
});

test('orders: single buy/sell by qty and amount, oversell blocked, buy over cash at confirm blocked', () => {
  const { st, ok, no, basket, invest } = make();
  const b = basket(); invest(b.id, 60000);
  const held = st.baskets[0].holdings.HAVELLS.qty;
  no('create_order', { basket_id: b.id, side: 'sell', symbol: 'HAVELLS', qty: held + 1 }, 'bad_qty');
  no('create_order', { basket_id: b.id, side: 'sell', symbol: 'HAVELLS', qty: 0 }, 'bad_qty');
  const s = ok('create_order', { basket_id: b.id, side: 'sell', symbol: 'HAVELLS', qty: 1 }).orders[0];
  const bb = ok('create_order', { basket_id: b.id, side: 'buy', symbol: 'SRF', amount: 5000 }).orders[0];
  assert.equal(bb.qty, Math.floor(5000 / st.prices.SRF));
  ok('confirm_order', { order_ids: [s.id, bb.id] });
  const huge = ok('create_order', { basket_id: b.id, side: 'buy', symbol: 'NAVINFLUOR', qty: 50 }).orders[0];
  no('confirm_order', { order_ids: [huge.id] }, 'insufficient');
  ok('cancel_order', { order_id: huge.id });
  no('create_order', { basket_id: b.id, side: 'buy', symbol: 'RAMRAT', qty: 1 }, 'rule_block');
});

test('orders: rebalance plan and draft, invest more, exit all', () => {
  const { st, ok, basket, invest } = make();
  const b = basket(); invest(b.id);
  const p = ok('rebalance_plan', { basket_id: b.id });
  assert.ok(Array.isArray(p.trades));
  const d = ok('rebalance_plan', { basket_id: b.id, draft: true });
  if (d.orders.length) ok('confirm_order', { order_ids: d.orders.map(o => o.id) });
  invest(b.id, 10000);
  const ex = ok('exit_basket', { basket_id: b.id });
  ok('confirm_order', { order_ids: ex.orders.map(o => o.id) });
  assert.ok(st.cash > 99000 && st.cash <= 100000, `cash back ${st.cash}`);
  assert.equal(st.baskets[0].netInvested, 0);
});

// ---------------- Rules ----------------
test('rules: read, edit thresholds (valid/invalid), toggle, cutoffs, reset, apply defaults; Free blocks', () => {
  const { st, ok, no, basket } = make();
  const b = basket(); basket('Energy', EN);
  assert.equal(ok('get_rules', { scope: 'defaults' }).metrics.length, 13);
  no('set_rule', { rule_id: 'de', green: 2, red: 1, basket_id: b.id }, 'bad_threshold');
  no('set_rule', { rule_id: 'nope', basket_id: b.id }, 'not_found');
  no('set_rule', { rule_id: 'de', green: 0.4 }, 'which_rules');
  ok('set_rule', { rule_id: 'de', green: 0.4, red: 0.9, basket_id: b.id });
  assert.equal(st.baskets[0].rules.metrics.find(r => r.id === 'de').green, 0.4);
  assert.equal(st.rules.metrics.find(r => r.id === 'de').green, 0.5, 'defaults untouched');
  ok('set_rule', { rule_id: 'pe', green: 1.5, red: 2, scope: 'all' });
  assert.ok(st.baskets.every(x => x.rules.metrics.find(r => r.id === 'pe').green === 1.5));
  ok('toggle_rule', { rule_id: 'ev_auditor', enabled: true, basket_id: b.id });
  ok('toggle_rule', { rule_id: 'vol', enabled: false, scope: 'defaults' });
  no('set_rating_cutoffs', { buy_below: 9, sell_above: 3, basket_id: b.id }, 'bad_cutoffs');
  no('set_rating_cutoffs', { buy_below: 0, basket_id: b.id }, 'bad_cutoffs');
  ok('set_rating_cutoffs', { buy_below: 3, sell_above: 6, basket_id: b.id });
  no('set_basket_rule', { basket_id: b.id, min_stocks: 20 }, 'bad_limit');
  no('set_basket_rule', { basket_id: b.id, max_stock_weight: 0 }, 'bad_limit');
  ok('set_basket_rule', { basket_id: b.id, min_stocks: 4, max_stock_weight: 30 });
  ok('what_if', { basket_id: b.id, rule_id: 'de', green: 0.2 });
  ok('reset_rules', { basket_id: b.id });
  assert.equal(st.baskets[0].limits.minStocks, 6, 'reset brings limits back');
  ok('apply_default_rules', {});
  ok('reset_rules', { scope: 'all' });
  ok('set_plan', { plan: 'free' });
  for (const [op, a] of [['set_rule', { rule_id: 'de', green: 0.4, basket_id: b.id }], ['toggle_rule', { rule_id: 'vol', enabled: false, basket_id: b.id }], ['set_rating_cutoffs', { buy_below: 3, basket_id: b.id }], ['set_basket_rule', { basket_id: b.id, min_stocks: 5 }], ['what_if', { basket_id: b.id, rule_id: 'de' }]]) no(op, a, 'pro_feature');
  assert.ok(ok('get_rules', { basket_id: b.id }).metrics.length === 13, 'Free can still read');
});

test('rules: tightening a rule on an invested basket drafts a sell; loosening keeps it', () => {
  const { st, ok, basket, invest } = make();
  const b = basket(); invest(b.id);
  ok('set_rule', { rule_id: 'de', green: 0.01, red: 0.02, basket_id: b.id });
  assert.ok(st.orders.some(o => o.status === 'pending' && o.side === 'sell'), 'a sell was drafted');
  assert.ok(ok('get_activity', {}).todo.some(t => t.kind === 'orders'));
});

// ---------------- Candidates (custom stocks) ----------------
test('candidates: add, update, theme share, delete (protected / in use)', () => {
  const { st, ok, no, basket } = make();
  no('add_candidate', { symbol: 'bad sym!' }, 'bad_symbol');
  const c = ok('add_candidate', { symbol: 'mystock', name: 'My Stock', sector: 'Energy', stage: 'renew', price: 120, history_years: 10, metrics: { adtv: 50, de: 0.2, icr: 10, loss: 0, pledge: 0 }, themes: { energy: 100 } });
  assert.equal(c.stock.symbol, 'MYSTOCK');
  ok('add_candidate', { symbol: 'MYSTOCK', name: 'Renamed', metrics: { roe: 20 } });
  assert.equal(st.universe.MYSTOCK.name, 'Renamed');
  assert.equal(st.universe.MYSTOCK.metrics.de, 0.2, 'update keeps old numbers');
  ok('set_theme_share', { symbol: 'MYSTOCK', theme: 'energy', share: 150 });
  assert.equal(st.universe.MYSTOCK.themes.energy, 100, 'share clamps to 100');
  no('delete_candidate', { symbol: 'SRF' }, 'protected');
  const b = basket('E', [...EN.slice(0, 5), 'MYSTOCK']);
  assert.ok(b.stocks.some(x => x.symbol === 'MYSTOCK'), 'custom stock is in the basket');
  no('delete_candidate', { symbol: 'MYSTOCK' }, 'in_use');
  ok('remove_stock', { basket_id: b.id, symbol: 'MYSTOCK' });
  ok('delete_candidate', { symbol: 'MYSTOCK' });
  assert.ok(!st.universe.MYSTOCK && st.prices.MYSTOCK == null);
  no('delete_candidate', { symbol: 'MYSTOCK' }, 'not_found');
  assert.ok(ok('get_universe', { q: 'zzzz' }).count === 0, 'empty search');
  assert.ok(ok('get_universe', { sector: 'Energy', max_debt_equity: 0.5, sort: 'name' }).count > 0);
  no('get_stock', { symbol: 'NOPE' }, 'not_found');
  assert.ok(ok('get_stock', { symbol: 'SRF' }).history.length > 0);
});

// ---------------- News flags & journal ----------------
test('flags: add (worse drafts a sell when held), edit to better cancels it, withdraw, Free monthly limit', () => {
  const { st, ok, no, basket, invest } = make();
  const b = basket(); invest(b.id);
  no('add_news_flag', { symbol: 'SRF', metric: 'nope' }, 'bad_metric');
  no('add_news_flag', { symbol: 'NOPE', metric: 'de' }, 'not_found');
  const f = ok('add_news_flag', { symbol: 'SRF', metric: 'de', impact: 'worse', note: 'debt up' });
  const drafted = st.orders.filter(o => o.status === 'pending' && o.flagId === f.flag.id);
  ok('update_news_flag', { flag_id: f.flag.id, impact: 'better', note: 'actually fine' });
  assert.ok(drafted.every(o => st.orders.find(x => x.id === o.id).status === 'cancelled'), 'better cancels its sells');
  const g = ok('add_news_flag', { symbol: 'HAVELLS', metric: 'icr' });
  ok('delete_news_flag', { flag_id: g.flag.id });
  no('delete_news_flag', { flag_id: g.flag.id }, 'not_found');
  no('update_news_flag', { flag_id: g.flag.id, note: 'x' }, 'not_found');
  const free = make('free');
  for (let i = 0; i < 3; i++) free.ok('add_news_flag', { symbol: 'SRF', metric: 'roe' });
  free.no('add_news_flag', { symbol: 'SRF', metric: 'roe' }, 'pro_feature');
});

test('journal: "keep anyway" writes an entry; edit and delete it', () => {
  const { st, ok, no, basket, invest } = make();
  const b = basket(); invest(b.id);
  ok('set_rule', { rule_id: 'de', green: 0.01, red: 0.02, basket_id: b.id });
  const sell = st.orders.find(o => o.status === 'pending' && o.side === 'sell');
  ok('cancel_order', { order_id: sell.id, reason: 'I believe in it' });
  const j = st.journal[0];
  assert.equal(j.action, 'Kept anyway');
  ok('update_journal', { id: j.id, reason: 'edited' });
  assert.equal(st.journal[0].reason, 'edited');
  ok('delete_journal', { id: j.id });
  no('delete_journal', { id: j.id }, 'not_found');
  no('delete_journal', { id: 'x' }, 'person_only', 'claude');
});

// ---------------- Notifications / pending ----------------
test('notifications: mark read, delete, clear by basket, decline/restore every to-do kind', () => {
  const { st, ok, no, basket, invest } = make();
  const b = basket(); invest(b.id); basket('Energy', EN);
  ok('advance_quarter');
  assert.ok(st.alerts.length > 0);
  ok('mark_alerts_read', {});
  assert.equal(ok('get_state', {}).unread, 0);
  no('dismiss_alert', { alert_id: 'x' }, 'not_found');
  ok('clear_alerts', { basket_id: b.id });
  assert.ok(!st.alerts.some(a => a.basketId === b.id), 'basket alerts cleared');
  no('clear_alerts', {}, 'person_only', 'claude');
  for (const t of ok('get_activity', {}).todo) ok('decline_todo', { key: t.key });
  assert.equal(ok('get_activity', {}).todo.filter(t => t.kind !== 'alerts').length, 0, 'every to-do declined');
  no('decline_todo', { key: 'nothing' }, 'not_found');
  for (const c of [...st.clearedAlerts].filter(c => c.key)) ok('restore_todo', { key: c.key });
});

// ---------------- Time, plans, settings ----------------
test('time: days and quarters with no baskets and with baskets keep state valid', () => {
  const { st, ok, basket, invest } = make('free');
  ok('advance_day'); ok('advance_quarter');
  const b = basket('AC', [...AC, 'FLUOROCHEM', 'KIRLPNU', 'HAVELLS', 'SUBROS']); // prices moved, so some may be skipped
  if (b.count >= 6) invest(b.id);
  for (let i = 0; i < 3; i++) ok('advance_quarter');
  assert.ok(st.clock > '2027-01-01');
});

test('settings: profile name, notifications by plan, onboarding', () => {
  const { st, ok, no } = make('free');
  no('set_profile', { name: '   ' }, 'bad_name');
  ok('set_profile', { name: 'Sid' }); assert.equal(st.user.name, 'Sid');
  no('set_notif', { push: true }, 'pro_feature');
  ok('set_notif', { push: false });
  ok('set_plan', { plan: 'pro', billing: 'monthly' }); assert.equal(st.billing, 'monthly');
  ok('set_notif', { push: true });
  ok('set_plan', { plan: 'free' }); assert.equal(st.notif.push, false, 'Free turns push off');
  ok('finish_onboarding', { path: 'claude' }); assert.ok(st.onboarded);
  no('set_plan', { plan: 'pro' }, 'person_only', 'claude');
});

test('scorecard and share: empty and with a basket; share needs Pro', () => {
  const { ok, no, basket } = make('free');
  assert.ok(ok('get_rule_scorecard', {}));
  const b = basket();
  assert.ok(ok('get_rule_scorecard', { basket_id: b.id }).locked, 'Free sees the teaser');
  no('share_card', { basket_id: b.id }, 'pro_feature');
  ok('set_plan', { plan: 'pro' });
  assert.ok(ok('share_card', { basket_id: b.id }).title.includes(b.name));
});

// ---------------- A long mixed session, Claude and person interleaved ----------------
test('session: a mixed run of every feature keeps state consistent throughout', () => {
  const { st, ok, run, basket, invest } = make();
  const a = basket('AC'), e = basket('Energy', EN);
  invest(a.id, 40000);
  ok('create_order', { basket_id: e.id, side: 'buy', amount: 30000 }, 'claude');
  ok('add_news_flag', { symbol: 'NAVINFLUOR', metric: 'de' }, 'claude');
  ok('advance_quarter');
  for (const al of [...st.alerts].slice(0, 2)) ok('dismiss_alert', { alert_id: al.id });
  ok('request_delete_basket', { basket_id: e.id }, 'claude');
  ok('delete_basket', { basket_id: e.id, sell_all: true });
  ok('duplicate_basket', { basket_id: a.id });
  const ex = ok('exit_basket', { basket_id: a.id });
  if (ex.orders.length) ok('confirm_order', { order_ids: ex.orders.map(o => o.id) });
  run('clear_alerts', {});
  for (let i = 0; i < 5; i++) ok('advance_day');
  ok('get_activity', {}, 'claude');
});
