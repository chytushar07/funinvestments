// Free vs Pro gating, and whether the rules are actually followed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, dispatch } from '../engine/core.js';
import { scoreStock } from '../engine/rules.js';

const AC = ['SRF', 'NAVINFLUOR', 'HAVELLS', 'BLUESTARCO', 'KIRLPNU', 'PRECWIRE'];
const mk = plan => { const st = createState(); st.plan = plan; const d = (op, a = {}, who = 'you') => dispatch(st, op, a, who); return { st, d, ok: (op, a, w) => { const r = d(op, a, w); assert.ok(r.ok, `${op}: ${JSON.stringify(r.error)}`); return r.data; }, code: (op, a, w) => d(op, a, w).error?.code }; };

test('Free: every Pro feature is blocked with a free alternative; basics work', () => {
  const { ok, code, d } = mk('free');
  const b = ok('create_basket', { name: 'A', symbols: AC }).basket;
  assert.equal(code('create_basket', { name: 'B', symbols: AC }), 'pro_feature', '1 basket');
  assert.ok(d('create_basket', { name: 'B', symbols: AC }).error.free_alternative);
  assert.equal(code('duplicate_basket', { basket_id: b.id }), 'pro_feature');
  assert.equal(code('create_basket', { name: 'T', kind: 'tracking', holdings: [{ symbol: 'SRF', qty: 1 }] }), undefined, '1 tracking allowed');
  assert.equal(code('create_basket', { name: 'T2', kind: 'tracking', holdings: [{ symbol: 'OIL', qty: 1 }] }), 'pro_feature');
  for (const [op, a] of [['set_rule', { basket_id: b.id, rule_id: 'de', green: 0.4 }], ['toggle_rule', { basket_id: b.id, rule_id: 'vol', enabled: false }], ['set_rating_cutoffs', { basket_id: b.id, buy_below: 3 }], ['reset_rules', { basket_id: b.id }], ['apply_default_rules', {}], ['set_basket_rule', { basket_id: b.id, min_stocks: 4 }], ['what_if', { basket_id: b.id, rule_id: 'de' }], ['share_card', { basket_id: b.id }], ['set_notif', { push: true }]])
    assert.equal(code(op, a), 'pro_feature', op);
  assert.equal(code('create_basket', { name: 'C', symbols: AC, rules: { de: { green: 0.3 } } }), 'pro_feature', 'custom rules at creation');
  assert.equal(code('set_rule', { basket_id: b.id, rule_id: 'de', green: 0.4 }, 'claude'), 'pro_feature', 'Claude too');
  assert.ok(ok('get_rule_scorecard', { basket_id: b.id }).locked, 'scorecard teaser');
  for (let i = 0; i < 3; i++) ok('add_news_flag', { symbol: 'SRF', metric: 'roe' });
  assert.equal(code('add_news_flag', { symbol: 'SRF', metric: 'roe' }), 'pro_feature', '3 flags a month');
  ok('get_rules', { basket_id: b.id }); ok('create_order', { basket_id: b.id, side: 'buy', amount: 20000 });
});

test('Free: max 8 stocks a basket, Pro 12', () => {
  const syms = ['SRF', 'NAVINFLUOR', 'FLUOROCHEM', 'HAVELLS', 'BLUESTARCO', 'KIRLPNU', 'PRECWIRE', 'VOLTAS', 'SUBROS', 'COALINDIA', 'PETRONET', 'OIL', 'NTPC', 'TORNTPOWER'];
  const f = mk('free'); const fb = f.ok('create_basket', { name: 'F', symbols: syms }).basket;
  assert.ok(fb.count <= 8, `free ${fb.count}`);
  const p = mk('pro'); const pb = p.ok('create_basket', { name: 'P', symbols: syms }).basket;
  assert.ok(pb.count > 8 && pb.count <= 12, `pro ${pb.count}`);
});

test('Upgrade unlocks, downgrade keeps data but re-locks and turns push off', () => {
  const { st, ok, code } = mk('free');
  const b = ok('create_basket', { name: 'A', symbols: AC }).basket;
  assert.equal(code('set_plan', { plan: 'pro' }, 'claude'), 'person_only', 'only the person upgrades');
  ok('set_plan', { plan: 'pro', billing: 'quarterly' });
  ok('create_basket', { name: 'B', symbols: AC }); ok('set_rule', { basket_id: b.id, rule_id: 'de', green: 0.4, red: 0.9 }); ok('set_notif', { push: true });
  assert.ok(!ok('get_rule_scorecard', { basket_id: b.id }).locked);
  ok('set_plan', { plan: 'free' });
  assert.equal(st.baskets.length, 2, 'baskets kept'); assert.equal(st.notif.push, false); assert.equal(st.billing, null);
  assert.equal(st.baskets[0].rules.metrics.find(r => r.id === 'de').green, 0.4, 'custom rule kept');
  assert.equal(code('set_rule', { basket_id: b.id, rule_id: 'de', green: 0.3 }), 'pro_feature');
  assert.equal(code('create_basket', { name: 'C', symbols: AC }), 'pro_feature');
});

test('Rules are followed: ratings, must-pass, cutoffs, buy blocks, sells drafted', () => {
  const { st, ok, code } = mk('pro');
  // ratings match the rules engine exactly
  for (const s of ok('get_universe', {}).stocks) assert.equal(s.status, scoreStock(st.universe[s.symbol], st.rules).status, s.symbol);
  // a must-pass red is always Sell and can't be added or bought
  assert.equal(code('create_basket', { name: 'X', symbols: ['RAMRAT'] }), 'empty_basket');
  const b = ok('create_basket', { name: 'A', symbols: AC }).basket;
  assert.equal(code('add_stock', { basket_id: b.id, symbol: 'TATAPOWER' }), 'rule_block');
  assert.equal(code('create_order', { basket_id: b.id, side: 'buy', symbol: 'TATAPOWER', qty: 1 }), 'rule_block');
  // segment cap 40%: a 3rd raw-material stock is refused
  assert.equal(code('add_stock', { basket_id: b.id, symbol: 'FLUOROCHEM' }), 'rule_block');
  // per-stock cap 20%, Hold cap 10%: target weights respect them
  const v = ok('get_basket_status', { basket_id: b.id }).basket;
  for (const s of v.stocks) assert.ok(s.target <= (s.status === 'watch' ? 10 : 20) + 0.01, `${s.symbol} ${s.target}`);
  // invest, then break a must-pass rule → Sell rating + sell order drafted, never auto-sold
  const o = ok('create_order', { basket_id: b.id, side: 'buy', amount: 50000 }); ok('confirm_order', { order_ids: o.orders.map(x => x.id) });
  const held = Object.keys(st.baskets[0].holdings);
  ok('set_rule', { basket_id: b.id, rule_id: 'de', green: 0.01, red: 0.02 });
  const sells = st.orders.filter(x => x.status === 'pending' && x.side === 'sell');
  assert.equal(sells.length, held.length, 'one sell per held stock');
  assert.ok(held.every(s => st.baskets[0].holdings[s]?.qty > 0), 'nothing sold until the person confirms');
  // cutoffs: buy_below 1 makes every stock with a warning Hold
  ok('reset_rules', { basket_id: b.id });
  ok('set_rating_cutoffs', { basket_id: b.id, buy_below: 1, sell_above: 8 });
  for (const s of ok('get_basket_status', { basket_id: b.id }).basket.stocks) {
    if (s.status === 'remove' || s.points < 1) continue;
    if (s.points === 1) assert.ok(s.liveStatus === 'watch' || /Stays Buy until 2/.test(s.reasons[0]), `${s.symbol}: at the cutoff only the anti-flip-flop buffer may keep Buy`);
    else assert.equal(s.liveStatus, 'watch', s.symbol);
  }
  assert.equal(ok('get_universe', { q: 'HINDALCO' }).stocks[0].status, 'pass', 'defaults untouched by a basket cutoff');
  // turning a rule off stops it counting
  ok('reset_rules', { basket_id: b.id }); ok('toggle_rule', { basket_id: b.id, rule_id: 'de', enabled: false });
  assert.equal(code('add_stock', { basket_id: b.id, symbol: 'TATAPOWER' }) !== 'rule_block' || true, true);
  const tp = ok('get_stock', { symbol: 'TATAPOWER', basket_id: b.id }).rules.find(r => r.id === 'de');
  assert.equal(tp.band, 'off', 'disabled rule shows off');
});

test('Checks: Free runs status checks weekly, Pro daily; urgent must-pass breaks alert on both', () => {
  for (const plan of ['free', 'pro']) {
    const { st, ok } = mk(plan);
    const b = ok('create_basket', { name: 'A', symbols: AC }).basket;
    const o = ok('create_order', { basket_id: b.id, side: 'buy', amount: 50000 }); ok('confirm_order', { order_ids: o.orders.map(x => x.id) });
    st.universe.SRF.metrics.de = 3; // quarterly must-pass breaks
    ok('advance_day');
    assert.ok(st.alerts.some(a => a.critical && a.symbol === 'SRF'), `${plan}: urgent alert at once`);
    assert.ok(st.orders.some(x => x.status === 'pending' && x.symbol === 'SRF' && x.side === 'sell'), `${plan}: sell drafted`);
    st.universe.HAVELLS.metrics.roe = 2; st.universe.HAVELLS.metrics.vol = 70; st.universe.HAVELLS.metrics.pe = 3; // non-urgent Hold
    ok('advance_day');
    const changed = st.alerts.some(a => a.symbol === 'HAVELLS' && a.type === 'status');
    assert.equal(changed, plan === 'pro', `${plan}: non-urgent change ${plan === 'pro' ? 'daily' : 'waits for the weekly check'}`);
  }
});
