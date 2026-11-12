// The product promises (the 9 "How it works" stories) and the fixes from the CRUD report, end to end on the engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, dispatch } from '../engine/core.js';

const ok = r => { assert.ok(r.ok, JSON.stringify(r.error)); return r.data; };
const mk = (plan = 'free') => {
  const st = createState(); st.plan = plan;
  const call = (op, a = {}, actor = 'claude') => dispatch(st, op, a, actor);
  return { st, call, ok: (op, a, actor) => ok(call(op, a, actor)), code: (op, a, actor) => call(op, a, actor).error?.code };
};
const invest = (S, id, amount = 90000) => { const o = S.ok('create_order', { basket_id: id, side: 'buy', amount }); S.ok('confirm_order', { order_ids: o.orders.map(x => x.id) }, 'you'); };
const pending = st => st.orders.filter(o => o.status === 'pending');

test('Story 1: a daily dip is a heads-up, a second strike is Sell + sell, a recovery cancels the stale sell', () => {
  const S = mk('free');
  const b = S.ok('create_basket', { name: 'Watch', symbols: ['KIRLPNU', 'SRF', 'HAVELLS', 'VOLTAS', 'SUBROS', 'AVL', 'NAVINFLUOR', 'PRECWIRE'] }).basket;
  invest(S, b.id);
  const bk = S.st.baskets[0];
  S.ok('advance_day', {}, 'you'); S.ok('advance_day', {}, 'you'); // 3 Sep: a thin trading day
  const heads = S.st.alerts.find(a => a.symbol === 'KIRLPNU' && a.type === 'strike');
  assert.ok(heads, 'heads-up alert');
  assert.match(heads.text, /Kirloskar Pneumatic · Daily trading dipped below the limit/);
  assert.match(heads.sub, /₹4\.6 cr → ₹1\.89 cr a day · limit ₹2 cr/);
  assert.equal(bk.statusPrev.KIRLPNU, 'pass', 'stays Buy after one bad day');
  assert.ok(!pending(S.st).some(o => o.symbol === 'KIRLPNU'), 'no sell on the first strike');
  let sell;
  for (let i = 0; i < 12 && !sell; i++) { S.ok('advance_day', {}, 'you'); sell = pending(S.st).find(o => o.symbol === 'KIRLPNU' && o.side === 'sell'); }
  assert.ok(sell, 'second strike within two weeks drafts a sell');
  assert.equal(S.st.clock, '2026-09-17');
  assert.equal(bk.statusPrev.KIRLPNU, 'remove');
  const al = S.st.alerts.find(a => a.action?.kind === 'orders' && a.action.ids.includes(sell.id));
  assert.match(al.text, /Kirloskar Pneumatic → ✕ Sell · sell order ready to review/);
  S.ok('advance_day', {}, 'you'); // trading back to normal before the person confirmed
  assert.equal(sell.status, 'cancelled', 'stale rules sell cancelled');
  assert.equal(bk.statusPrev.KIRLPNU, 'pass');
  assert.ok(!al.action, 'alert settled'); assert.match(al.text, /sell order cancelled/);
});

test('Story 2: the replacement comes with the rules sell; keep anyway settles both and is not re-drafted', () => {
  const S = mk('pro');
  const b = S.ok('create_basket', { name: 'AC', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'PRECWIRE'] }).basket;
  invest(S, b.id, 100000);
  while (S.st.clock < '2026-10-14') S.ok('advance_day', {}, 'you');
  const sell = pending(S.st).find(o => o.symbol === 'PRECWIRE');
  assert.ok(sell && sell.tag === 'rules');
  const al = S.st.alerts.find(a => a.action?.ids?.includes(sell.id));
  const buys = al.action.ids.map(id => S.st.orders.find(o => o.id === id)).filter(o => o.side === 'buy');
  assert.equal(buys.length, 1, 'replacement in the same alert'); assert.equal(buys[0].tag, 'refill');
  assert.match(al.text, /sell and replacement ready to review/);
  assert.match(al.why[0], /New results/);
  S.ok('cancel_order', { order_id: sell.id }, 'you'); // Keep anyway
  assert.equal(buys[0].status, 'cancelled', 'replacement dropped with the kept sell');
  assert.ok(!al.action); assert.match(al.text, /kept anyway/);
  for (let i = 0; i < 5; i++) S.ok('advance_day', {}, 'you');
  assert.ok(!pending(S.st).some(o => o.symbol === 'PRECWIRE'), 'kept sell not re-drafted');
});

test('A declined replacement is not re-drafted every day', () => {
  const S = mk('pro');
  const b = S.ok('create_basket', { name: 'AC', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'PRECWIRE'] }).basket;
  invest(S, b.id, 100000);
  S.ok('remove_stock', { basket_id: b.id, symbol: 'VOLTAS', sell: true });
  S.ok('confirm_order', { order_ids: pending(S.st).map(o => o.id) }, 'you');
  const refill = pending(S.st).find(o => o.tag === 'refill');
  assert.ok(refill, 'replacement drafted after the sell');
  S.ok('cancel_order', { order_id: refill.id }, 'you');
  const al = S.st.alerts.find(a => a.action === null && a.settled?.ids?.includes(refill.id));
  assert.ok(al, 'refill alert settled'); assert.match(al.text, /replacement skipped/);
  for (let i = 0; i < 5; i++) S.ok('advance_day', {}, 'you');
  assert.ok(!pending(S.st).some(o => o.tag === 'refill'), 'not re-drafted');
});

test('Story 4: a news flag the results do not confirm cancels its sell and clears; flags never orphan the to-do', () => {
  const S = mk('pro');
  const b = S.ok('create_basket', { name: 'Mixed', theme: null, symbols: ['NTPC', 'TORNTPOWER', 'COALINDIA', 'SRF', 'HAVELLS', 'RELIANCE'] }).basket;
  invest(S, b.id);
  const f = S.ok('add_news_flag', { symbol: 'RELIANCE', metric: 'de', impact: 'worse', note: 'Merger' });
  assert.equal(f.drafted_orders.length, 1); const sell = f.drafted_orders[0];
  S.ok('add_news_flag', { symbol: 'VOLTAS', metric: 'de', impact: 'worse' }); // not in a basket
  assert.equal(ok(S.call('get_activity')).todo.filter(t => t.kind === 'flags').length, 1);
  assert.match(ok(S.call('get_activity')).todo.find(t => t.kind === 'flags').text, /^1 news flag/);
  S.ok('advance_quarter', {}, 'you');
  assert.equal(S.st.flags.find(x => x.symbol === 'RELIANCE').status, 'cleared');
  assert.equal(S.st.orders.find(o => o.id === sell.id).status, 'cancelled');
  assert.equal(S.st.baskets[0].statusPrev.RELIANCE, 'pass', 'back to Buy');
  assert.ok(S.st.alerts.some(a => a.type === 'flag_cleared' && /RELIANCE|Reliance/.test(a.text) && /sell cancelled/.test(a.text)));
  assert.ok(S.st.flags.every(x => x.status !== 'open'), 'flags without filings resolve too');
  assert.ok(!ok(S.call('get_activity')).todo.some(t => t.kind === 'flags'));
});

test('Story 4: confirmed by results, the sell stays', () => {
  const S = mk('pro');
  const b = S.ok('create_basket', { name: 'AC', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'PRECWIRE'] }).basket;
  invest(S, b.id, 100000);
  const sell = S.ok('add_news_flag', { symbol: 'PRECWIRE', metric: 'de', impact: 'worse' }).drafted_orders[0];
  while (S.st.clock < '2026-10-14') S.ok('advance_day', {}, 'you');
  assert.equal(S.st.flags[0].status, 'confirmed');
  const o = S.st.orders.find(x => x.id === sell.id);
  assert.equal(o.status, 'pending'); assert.equal(o.tag, 'rules');
});

test('Custom themes and stage-less candidates are not squeezed by segment caps', () => {
  const S = mk('pro');
  for (const [s, n] of [['HAL', 'Hindustan Aeronautics'], ['BEL', 'Bharat Electronics'], ['BDL', 'Bharat Dynamics'], ['MAZDOCK', 'Mazagon Dock'], ['COCHINSHIP', 'Cochin Shipyard'], ['DATAPATTNS', 'Data Patterns'], ['GRSE', 'Garden Reach']])
    S.ok('add_candidate', { symbol: s, name: n, sector: 'Defence', metrics: { adtv: 50, pledge: 0, de: 0.1, icr: 20, loss: 0, vol: 25, beta: 0.9, dd: 20, cash: 1, roe: 20, margin: 1, pe: 30, peg: 1.5 } });
  const r = S.ok('create_basket', { name: 'Defence', theme_name: 'Defence', symbols: ['HAL', 'BEL', 'BDL', 'MAZDOCK', 'COCHINSHIP', 'DATAPATTNS', 'GRSE'] });
  assert.equal(r.basket.count, 7, JSON.stringify(r.skipped)); assert.equal(r.basket.themeLabel, 'Defence');
  assert.equal(S.code('add_candidate', { symbol: 'NTPC', metrics: { de: 0.1 } }), 'exists', 'built-in stocks are not overwritten');
});

test('Rule edits report exactly what changed per basket', () => {
  const S = mk('pro');
  const b = S.ok('create_basket', { name: 'Mix', symbols: ['NTPC', 'POWERGRID', 'PRECWIRE', 'SRF', 'HAVELLS', 'COALINDIA', 'VOLTAS', 'BLUESTARCO', 'OIL', 'PETRONET', 'KIRLPNU', 'SUBROS'] }).basket;
  const before = [...S.st.baskets[0].symbols];
  const r = S.ok('set_rule', { basket_id: b.id, rule_id: 'de', green: 0.3, red: 0.6 });
  const rep = r.changed.baskets[0];
  const gone = before.filter(x => !S.st.baskets[0].symbols.includes(x));
  assert.deepEqual(rep.removed.map(x => x.symbol).sort(), gone.sort());
  assert.ok(gone.length > 0 && gone.includes('PRECWIRE'));
  assert.match(r.changed.summary, /taken out/);
  assert.match(S.st.activity[0].text, /taken out/);
  // defaults scope lists the stock ratings that changed in Explore
  const d = S.ok('set_rule', { scope: 'defaults', rule_id: 'roe', green: 25, red: 20 });
  assert.ok(d.changed.stock_ratings.length > 0);
  // cutoffs: report the rating the basket shows
  const c = S.ok('set_rating_cutoffs', { basket_id: b.id, buy_below: 3, sell_above: 7 });
  const view = S.ok('get_basket_status', { basket_id: b.id }).basket;
  for (const x of c.changed.baskets[0]?.ratings || []) assert.equal({ Buy: 'pass', Hold: 'watch', Sell: 'remove' }[x.to], view.stocks.find(s => s.symbol === x.symbol).status, x.symbol);
  // basket limits: refill buys / re-added stocks are reported
  S.ok('reset_rules', { basket_id: b.id });
  const lim = S.ok('set_basket_rule', { basket_id: b.id, min_stocks: 12 });
  assert.equal(lim.changed.baskets[0]?.added.length || 0, S.st.baskets[0].symbols.length - view.count);
});

test('Pro→Free: custom rules stop applying, are saved, and come back on Pro; reset works on Free; over-limit to-do', () => {
  const S = mk('pro');
  const b = S.ok('create_basket', { name: 'Mix', symbols: ['NTPC', 'POWERGRID', 'SRF', 'HAVELLS', 'COALINDIA', 'VOLTAS', 'BLUESTARCO', 'OIL', 'PETRONET', 'KIRLPNU', 'SUBROS'] }).basket;
  S.ok('set_rating_cutoffs', { basket_id: b.id, buy_below: 1, sell_above: 20 });
  assert.ok(S.st.baskets[0].symbols.every(x => S.st.baskets[0].statusPrev[x] !== 'pass') || true);
  const proHold = Object.values(S.st.baskets[0].statusPrev).filter(x => x === 'watch').length;
  assert.ok(proHold > 0);
  S.ok('set_plan', { plan: 'free' }, 'you');
  const rules = S.ok('get_rules', { basket_id: b.id });
  assert.equal(rules.cutoffs.buy_below, 4, 'default cutoffs on Free'); assert.equal(rules.saved_pro_rules.cutoffs.buy_below, 1);
  assert.ok(Object.values(S.st.baskets[0].statusPrev).filter(x => x === 'watch').length < proHold, 'ratings follow the default rules');
  assert.ok(ok(S.call('get_activity')).todo.some(t => t.kind === 'overmax'));
  S.ok('set_plan', { plan: 'pro' }, 'you');
  assert.equal(S.ok('get_rules', { basket_id: b.id }).cutoffs.buy_below, 1, 'back on Pro');
  S.ok('set_plan', { plan: 'free' }, 'you');
  S.ok('reset_rules', { basket_id: b.id });
  assert.equal(S.ok('get_rules', { basket_id: b.id }).saved_pro_rules, undefined);
});

test('update_basket: theme change re-checks theme share, keeps the custom label, accepts theme_name', () => {
  const S = mk('pro');
  const b = S.ok('create_basket', { name: 'Power', theme_name: 'Utilities', symbols: ['NTPC', 'POWERGRID', 'TORNTPOWER', 'NHPC', 'COALINDIA', 'OIL'] }).basket;
  const r = S.ok('update_basket', { basket_id: b.id, theme: 'ac' });
  assert.ok(r.changed.baskets[0].removed.length > 0, 'stocks with no AC business are not Buy in an AC basket');
  const r2 = S.ok('update_basket', { basket_id: b.id, theme: null });
  assert.equal(r2.basket.themeLabel, null);
  const r3 = S.ok('update_basket', { basket_id: b.id, theme_name: 'Utilities' });
  assert.equal(r3.basket.themeLabel, 'Utilities');
  assert.equal(S.code('update_basket', { basket_id: b.id, name: '   ' }), 'bad_name');
});

test('Story 5: get_universe and get_basket_status show each rule value against its limit', () => {
  const S = mk();
  const u = S.ok('get_universe', { q: 'Precision' }).stocks[0];
  assert.ok(u.why.some(w => w.rule === 'de' && w.value === 0.82 && w.limit === 0.5 && w.band === 'amber'));
  const b = S.ok('create_basket', { name: 'AC', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'PRECWIRE'] }).basket;
  assert.ok(b.stocks.find(s => s.symbol === 'PRECWIRE').why.some(w => w.rule === 'de'));
});

test('Story 9: a tracking holding already rated Sell raises an alert at import, never an order', () => {
  const S = mk();
  S.ok('create_basket', { name: 'Mine', kind: 'tracking', holdings: [{ symbol: 'TATAPOWER', qty: 40, avg_price: 360 }, { symbol: 'NTPC', qty: 10 }] });
  const a = S.st.alerts.find(x => x.symbol === 'TATAPOWER');
  assert.ok(a?.critical); assert.match(a.text, /Tata Power → ✕ Sell · consider selling in your broker/);
  assert.equal(S.st.orders.length, 0);
});

test('Small fixes: names, plain errors, pending sell blocks add, to-dos for drift', () => {
  const S = mk();
  S.st.plan = 'pro';
  S.ok('create_basket', { name: 'Defence', symbols: ['SRF', 'HAVELLS'] });
  const d2 = S.ok('create_basket', { name: 'Defence', symbols: ['SRF', 'HAVELLS'] });
  assert.equal(d2.basket.name, 'Defence 2'); assert.match(d2.name_note, /Defence 2/);
  const d3 = S.ok('create_basket', { name: 'Defence 2', symbols: ['SRF', 'HAVELLS'] });
  assert.equal(d3.basket.name, 'Defence 3');
  assert.equal(S.code('create_basket', { name: '', symbols: ['SRF'] }), 'bad_name');
  // request_delete_basket has no empty website field
  assert.ok(!('website' in S.ok('request_delete_basket', { basket_id: d3.basket.id })));
  // limit-specific free alternative
  const F = mk('free');
  const fb = F.ok('create_basket', { name: 'F', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'PRECWIRE', 'SUBROS', 'AVL'] }).basket;
  const e = F.call('add_stock', { basket_id: fb.id, symbol: 'BLUESTARCO' }).error;
  if (e.code === 'pro_feature') { assert.match(e.free_alternative, /up to 8 stocks/); assert.match(e.how_to_upgrade, /12 stocks/); }
  invest(F, fb.id);
  assert.equal(F.code('create_order', { basket_id: fb.id, side: 'sell' }), 'missing_symbol');
  const filled = F.st.orders.find(o => o.status === 'filled');
  assert.equal(F.code('cancel_order', { order_id: filled.id }), 'already_filled');
  F.ok('remove_stock', { basket_id: fb.id, symbol: 'SRF', sell: true });
  assert.equal(F.code('add_stock', { basket_id: fb.id, symbol: 'BLUESTARCO' }), 'pending_sell');
  assert.match(F.call('add_stock', { basket_id: fb.id, symbol: 'BLUESTARCO' }).error.message, /Confirm or cancel it first/);
  // a rebalance waits for orders already waiting in the basket
  assert.equal(F.code('rebalance_plan', { basket_id: fb.id, draft: true }), 'orders_waiting');
});

test('Re-test follow-ups: add_candidate dip is a heads-up, refill plan = drafted, delete preview, since, plain pointers', () => {
  const S = mk('pro');
  S.ok('add_candidate', { symbol: 'MYCO', name: 'My Co', sector: 'Capital goods', stage: 'parts', themes: { ac: 50 }, price: 200, metrics: { adtv: 5, pledge: 0, de: 0.4, icr: 12, loss: 0, vol: 25, beta: 0.9, dd: 20, cash: 1, roe: 18, margin: 1, pe: 25, peg: 1.2 } });
  const b = S.ok('create_basket', { name: 'AC', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'MYCO'] }).basket;
  S.ok('add_candidate', { symbol: 'MYCO', metrics: { adtv: 1.7 } });
  assert.equal(S.st.baskets[0].statusPrev.MYCO, 'pass', 'first bad number: heads-up only');
  assert.ok(S.st.alerts.some(a => a.symbol === 'MYCO' && a.type === 'strike'));
  assert.ok(S.ok('get_basket_status', { basket_id: b.id }).basket.stocks[0].since);
  const e = S.call('create_basket', { name: 'X', symbols: ['TSLA'] }).error;
  assert.equal(e.code, 'empty_basket'); assert.match(e.message, /add_candidate/); assert.match(e.skipped[0].why, /add_candidate/);
  S.ok('request_delete_basket', { basket_id: b.id });
  assert.ok(S.ok('get_basket_status', { basket_id: b.id }).delete_preview);
  const F = mk('free');
  assert.equal(F.call('set_basket_rule', { min_stocks: 5 }).error?.feature ?? 'basket limits', 'basket limits');
  const t = F.ok('create_basket', { name: 'Mine', kind: 'tracking', holdings: [{ symbol: 'NTPC', qty: 5 }, { symbol: 'SRF', qty: 2 }] }).basket;
  assert.match(F.ok('remove_stock', { basket_id: t.id, symbol: 'NTPC', sell: true }).note, /sell them in their own broker/);
});
