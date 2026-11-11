// Rule edits show everywhere at once: every place a rating, count or value is shown reads the new rules
// from the next snapshot (get_state for the website, get_universe / get_basket_status for Claude).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, dispatch } from '../engine/core.js';
import { scoreStock } from '../engine/rules.js';

const ok = r => { assert.ok(r.ok, JSON.stringify(r.error)); return r.data; };
const AC = ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'PRECWIRE'];
const word = { pass: 'Buy', watch: 'Hold', remove: 'Sell' };

// Every rating the website shows, from one snapshot.
function shown(st) {
  const s = ok(dispatch(st, 'get_state', {}, 'you'));
  return {
    explore: Object.fromEntries(s.universe.map(u => [u.symbol, u.status])),
    baskets: Object.fromEntries(s.baskets.map(b => [b.id, { tags: Object.fromEntries(b.stocks.map(x => [x.symbol, x.status])), counts: b.counts, value: b.value, here: b.rateHere }])),
    s,
  };
}
function consistent(st) {
  const { explore, baskets, s } = shown(st);
  // Explore / Home search / pickers: the default rules, live
  for (const u of Object.values(st.universe)) assert.equal(explore[u.symbol], scoreStock(u, s.rules).status, `explore ${u.symbol}`);
  // Claude sees the same
  for (const x of ok(dispatch(st, 'get_universe', {}, 'claude')).stocks) assert.equal(x.status, explore[x.symbol], `get_universe ${x.symbol}`);
  for (const b of st.baskets) {
    const v = baskets[b.id];
    // tags = the rating the basket rules last decided; counts add up; stock page agrees
    for (const sym of b.symbols) {
      assert.equal(v.tags[sym], b.statusPrev[sym], `${b.name} tag ${sym}`);
      assert.equal(ok(dispatch(st, 'get_stock', { symbol: sym, basket_id: b.id }, 'you')).stock.status, v.tags[sym], `stock page ${sym}`);
    }
    assert.equal(v.counts.pass + v.counts.watch + v.counts.remove, b.symbols.length);
    const value = b.cash + Object.entries(b.holdings).reduce((t, [k, h]) => t + h.qty * st.prices[k], 0);
    assert.ok(Math.abs(v.value - value) < 0.01, `${b.name} value`);
    const cs = ok(dispatch(st, 'get_basket_status', { basket_id: b.id }, 'claude')).basket;
    assert.deepEqual(cs.counts, v.counts, 'Claude sees the same counts');
  }
  return shown(st);
}

test('default rules stricter → Explore, stock pages, pickers and Claude change at once; baskets keep their own rules until applied', () => {
  const st = createState(); st.plan = 'pro';
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: AC }, 'you')).basket;
  const o = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 90000 }, 'you'));
  ok(dispatch(st, 'confirm_order', { order_ids: o.orders.map(x => x.id) }, 'you'));
  const before = consistent(st);
  const r = ok(dispatch(st, 'set_rule', { scope: 'defaults', rule_id: 'de', green: 0.3, red: 0.6 }, 'you'));
  const mid = consistent(st);
  assert.ok(r.changed.stock_ratings.length > 0);
  for (const c of r.changed.stock_ratings) { assert.equal(word[before.explore[c.symbol]], c.from); assert.equal(word[mid.explore[c.symbol]], c.to); }
  assert.equal(mid.explore.PRECWIRE, 'remove');
  assert.deepEqual(mid.baskets[b.id].tags, before.baskets[b.id].tags, 'basket keeps its own rules');
  // apply to existing baskets → tags, counts, sells, value
  ok(dispatch(st, 'apply_default_rules', {}, 'you'));
  const after = consistent(st);
  assert.equal(after.baskets[b.id].tags.PRECWIRE, 'remove');
  assert.ok(st.orders.some(x => x.status === 'pending' && x.symbol === 'PRECWIRE' && x.side === 'sell'));
  // confirming the sell changes the value and the basket
  ok(dispatch(st, 'confirm_order', { order_ids: st.orders.filter(x => x.status === 'pending' && x.side === 'sell').map(x => x.id) }, 'you'));
  const sold = consistent(st);
  assert.ok(!('PRECWIRE' in sold.baskets[b.id].tags));
  // reset
  ok(dispatch(st, 'reset_rules', { scope: 'all' }, 'you'));
  const back = consistent(st);
  assert.deepEqual(back.explore, before.explore, 'Explore back to the original ratings');
});

test('a basket\'s own rules → its tags, counts, picker ratings and alerts; other baskets and Explore untouched', () => {
  const st = createState(); st.plan = 'pro';
  const a = ok(dispatch(st, 'create_basket', { name: 'A', symbols: AC }, 'you')).basket;
  const b = ok(dispatch(st, 'create_basket', { name: 'B', symbols: AC }, 'you')).basket;
  const before = consistent(st);
  ok(dispatch(st, 'set_rule', { basket_id: a.id, rule_id: 'de', green: 0.3, red: 0.6 }, 'you'));
  const after = consistent(st);
  assert.deepEqual(after.explore, before.explore);
  assert.deepEqual(after.baskets[b.id].tags, before.baskets[b.id].tags);
  assert.ok(!st.baskets.find(x => x.id === a.id).symbols.includes('PRECWIRE'), 'not invested: taken out');
  assert.equal(after.baskets[a.id].here.PRECWIRE.status, 'remove', 'its Add picker rates by its own rules');
  assert.ok('PRECWIRE' in after.baskets[b.id].tags, 'B still has it');
  assert.ok(st.alerts.some(x => x.basketId === a.id && /Precision Wires/.test(x.text)));
});

test('stocks the user added: right tag and basket value at add time and after a rule edit', () => {
  const st = createState(); st.plan = 'pro';
  ok(dispatch(st, 'add_candidate', { symbol: 'MYCO', name: 'My Co', sector: 'Capital goods', stage: 'parts', themes: { ac: 50 }, price: 200, metrics: { adtv: 30, pledge: 0, de: 0.4, icr: 12, loss: 0, vol: 25, beta: 0.9, dd: 20, cash: 1, roe: 18, margin: 1, pe: 25, peg: 1.2 } }, 'claude'));
  const b = ok(dispatch(st, 'create_basket', { name: 'AC', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'MYCO'] }, 'you')).basket;
  ok(dispatch(st, 'add_stock', { basket_id: b.id, symbol: 'KIRLPNU' }, 'you'));
  let s = consistent(st);
  assert.equal(s.baskets[b.id].tags.MYCO, 'pass'); assert.equal(s.baskets[b.id].tags.KIRLPNU, scoreStock(st.universe.KIRLPNU, st.rules, { theme: 'ac' }).status);
  const o = ok(dispatch(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 90000 }, 'you'));
  ok(dispatch(st, 'confirm_order', { order_ids: o.orders.map(x => x.id) }, 'you'));
  consistent(st);
  ok(dispatch(st, 'set_rule', { basket_id: b.id, rule_id: 'de', green: 0.2, red: 0.35 }, 'you'));
  s = consistent(st);
  assert.equal(s.baskets[b.id].tags.MYCO, 'remove', 'the added stock follows the stricter rule');
  // updating the candidate's numbers re-checks it too
  ok(dispatch(st, 'reset_rules', { basket_id: b.id }, 'you'));
  ok(dispatch(st, 'add_candidate', { symbol: 'MYCO', metrics: { de: 0.1 } }, 'claude'));
  consistent(st);
});
