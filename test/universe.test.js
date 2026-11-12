// The wider universe (~660 real NSE stocks): size, themes, paging, ratings that follow the rules, storage budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, dispatch, packState, unpackState } from '../engine/core.js';
import { ALL_STOCKS, THEMES, STAGES } from '../engine/data.js';
import { TOOLS } from '../engine/tools.js';

const ok = (st, op, a = {}, who = 'you') => { const r = dispatch(st, op, a, who); assert.ok(r.ok, `${op}: ${JSON.stringify(r.error)}`); return r.data; };
const all = (st, a = {}) => { const out = []; let offset = 0; for (;;) { const p = ok(st, 'get_universe', { ...a, offset, limit: 100 }, 'claude'); out.push(...p.stocks); if (p.next_offset == null) return out; offset = p.next_offset; } };

test('universe: about 660 stocks, unique symbols, the original 55 kept', () => {
  const st = createState();
  const syms = Object.keys(st.universe);
  assert.ok(syms.length >= 650 && syms.length <= 670, `count ${syms.length}`);
  assert.equal(new Set(ALL_STOCKS.map(s => s.symbol)).size, ALL_STOCKS.length, 'no duplicate symbols');
  for (const s of ['SRF', 'PRECWIRE', 'VOLTAS', 'RELIANCE', 'COALINDIA', 'HDFCBANK', 'TCS', 'HAL', 'IRFC', 'MARUTI', 'ULTRACEMCO']) assert.ok(st.universe[s], s);
  assert.equal(st.universe.PRECWIRE.stage, 'parts'); assert.equal(st.universe.PRECWIRE.themes.ac, 40);
  for (const u of Object.values(st.universe)) {
    assert.ok(st.prices[u.symbol] > 0, `${u.symbol} price`);
    assert.ok(STAGES.some(x => x.id === u.stage), `${u.symbol} segment ${u.stage}`);
    assert.ok(Object.keys(u.themes).length >= 1 && Object.keys(u.themes).every(t => THEMES.some(x => x.id === t)), `${u.symbol} themes`);
  }
});

test('universe: every stock is rated, and the mix looks like a real market', () => {
  const st = createState();
  const list = all(st);
  assert.equal(list.length, Object.keys(st.universe).length);
  const n = { pass: 0, watch: 0, remove: 0 };
  for (const x of list) { assert.ok(['pass', 'watch', 'remove'].includes(x.status), x.symbol); n[x.status]++; }
  assert.ok(n.pass > n.remove && n.watch > 0 && n.remove > 0, JSON.stringify(n));
});

test('universe: every theme has members and 3–6 segments; theme filter and theme-share rating', () => {
  const st = createState();
  for (const t of THEMES) {
    const segs = STAGES.filter(x => x.theme === t.id);
    assert.ok(segs.length >= 3 && segs.length <= 6, `${t.id} segments ${segs.length}`);
    const p = ok(st, 'get_universe', { theme: t.id, limit: 100 }, 'claude');
    assert.ok(p.count >= 10, `${t.id} has ${p.count}`);
    assert.ok(p.stocks.every(x => x.themes[t.id] != null), `${t.id} filter`);
  }
  const some = Object.values(st.universe).filter(u => Object.keys(u.themes).length > 1);
  assert.ok(some.length > 50, 'many stocks span two themes');
  // A stock with a small share of the theme is rated Sell inside it.
  const low = all(st, { theme: 'energy' }).find(x => x.themes.energy < 20);
  assert.ok(low && low.status === 'remove' && /share|business/i.test(low.why), 'low theme share → Sell in that theme');
});

test('get_universe pages: default 25, limit/offset, next_offset, filters listed once', () => {
  const st = createState();
  const p1 = ok(st, 'get_universe', {}, 'claude');
  assert.equal(p1.stocks.length, 25); assert.equal(p1.offset, 0); assert.equal(p1.next_offset, 25);
  assert.ok(p1.filters.themes.length === THEMES.length && p1.filters.sectors.length > 10);
  const p2 = ok(st, 'get_universe', { offset: 25 }, 'claude');
  assert.ok(!p2.filters, 'filters only on the first page');
  assert.ok(!p2.stocks.some(x => p1.stocks.some(y => y.symbol === x.symbol)), 'pages do not overlap');
  assert.equal(ok(st, 'get_universe', { limit: 500 }, 'claude').stocks.length, 100, 'capped at 100');
  assert.ok(JSON.stringify(p1).length < 20000, 'a page stays small for Claude');
  const tool = TOOLS.find(t => t.name === 'get_universe');
  for (const w of ['offset', 'limit', 'theme', 'sector', 'stage']) assert.ok(tool.inputSchema.properties[w], w);
  assert.equal(ok(st, 'get_universe', { q: 'hdfc bank' }, 'claude').stocks[0]?.symbol, 'HDFCBANK');
  assert.ok(ok(st, 'get_universe', { stage: 'psubank', limit: 100 }, 'claude').stocks.every(x => x.stage === 'psubank'));
});

test('default rules: a stricter limit changes every rating at once; reset brings them back', () => {
  const st = createState();
  ok(st, 'set_plan', { plan: 'pro' });
  const sells = () => ok(st, 'get_universe', { status: 'remove', limit: 1 }, 'claude').count;
  const before = sells();
  const homeBefore = ok(st, 'get_state').highlights.ratings.remove;
  ok(st, 'set_rule', { scope: 'defaults', rule_id: 'de', green: 0.2, red: 0.5 });
  assert.ok(sells() > before, `Sell count up: ${before} → ${sells()}`);
  assert.ok(ok(st, 'get_state').highlights.ratings.remove > homeBefore, 'Home counts follow');
  const de = ok(st, 'get_stock', { symbol: 'RELIANCE' }).rules.find(r => r.id === 'de');
  assert.equal(de.red, '> 0.5×', 'stock page shows the new limit');
  ok(st, 'reset_rules', { scope: 'defaults' });
  assert.equal(sells(), before);
});

test('banks: debt/equity, interest cover and cash rules do not apply', () => {
  const st = createState();
  const d = ok(st, 'get_stock', { symbol: 'HDFCBANK' });
  for (const id of ['de', 'icr', 'cash']) assert.equal(d.rules.find(r => r.id === id).band, 'na', id);
  assert.ok(!d.stock.reasons.some(r => /Debt vs equity/.test(r)));
});

test('storage: a heavy space saves far below the 128 KiB Durable Object limit and loads back the same', () => {
  const st = createState();
  ok(st, 'set_plan', { plan: 'pro' });
  const sets = [['SRF', 'NAVINFLUOR', 'HAVELLS', 'BLUESTARCO', 'KIRLPNU', 'PRECWIRE'], ['COALINDIA', 'PETRONET', 'GAIL', 'PREMIERENE', 'WAAREEENER', 'ADANIPOWER'],
    ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE'], ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'PERSISTENT'], ['HAL', 'BEL', 'BDL', 'MAZDOCK', 'COCHINSHIP', 'DATAPATTNS']];
  for (const [i, s] of sets.entries()) {
    const b = ok(st, 'create_basket', { name: 'B' + i, symbols: s }).basket;
    if (b.count >= 6) { const o = ok(st, 'create_order', { basket_id: b.id, side: 'buy', amount: 15000 }); ok(st, 'confirm_order', { order_ids: o.orders.map(x => x.id) }); }
  }
  ok(st, 'add_candidate', { symbol: 'MYCO', name: 'My Co', price: 50, themes: { infra: 60 } });
  for (let i = 0; i < 30; i++) ok(st, 'advance_day');
  const packed = JSON.stringify(packState(st));
  assert.ok(packed.length < 100 * 1024, `packed ${packed.length} bytes`);
  assert.ok(packed.length < JSON.stringify(st).length / 3, 'much smaller than the full state');
  assert.ok(!packed.includes('"HINDUNILVR"'), 'untouched stocks are not stored');
  const back = unpackState(JSON.parse(packed));
  assert.equal(JSON.stringify(ok(back, 'get_state').baskets), JSON.stringify(ok(st, 'get_state').baskets));
  assert.equal(back.prices.TCS, st.prices.TCS); assert.ok(back.universe.MYCO);
  assert.ok(JSON.stringify(ok(st, 'get_state')).length < 120000, 'the polled snapshot stays small');
});

test('storage: a save from before the wider universe still loads, with all stocks', () => {
  const st = createState();
  ok(st, 'create_basket', { name: 'Old', symbols: ['SRF', 'HAVELLS', 'KIRLPNU', 'BLUESTARCO', 'NAVINFLUOR', 'PRECWIRE'] });
  const old = JSON.parse(JSON.stringify(st));
  for (const k of Object.keys(old.universe)) if (!['SRF', 'HAVELLS', 'KIRLPNU', 'BLUESTARCO', 'NAVINFLUOR', 'PRECWIRE', 'VOLTAS'].includes(k)) { delete old.universe[k]; delete old.prices[k]; delete old.prevPrices[k]; }
  old.prices.SRF = 1234;
  const back = unpackState(old);
  assert.equal(Object.keys(back.universe).length, Object.keys(st.universe).length);
  assert.equal(back.prices.SRF, 1234);
  assert.equal(ok(back, 'get_state').baskets[0].count, 6);
});

test('a basket in a new theme works end to end (create, rate, past test)', () => {
  const st = createState();
  ok(st, 'set_plan', { plan: 'pro' });
  const r = ok(st, 'create_basket', { name: 'Banks', theme: 'bank', symbols: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'BAJFINANCE', 'CHOLAFIN'] }, 'claude');
  assert.equal(r.basket.theme, 'bank'); assert.equal(r.basket.themeLabel, 'Banking & finance');
  assert.ok(r.basket.count >= 4);
  assert.ok(r.backtest.mine.years >= 5, 'past test of the picked stocks runs on real returns');
  const sc = ok(st, 'get_rule_scorecard', { basket_id: r.basket.id }, 'claude');
  assert.ok(sc.years.length >= 1);
  const auto = ok(st, 'create_basket', { name: 'x', symbols: ['TCS', 'INFY', 'WIPRO'] }, 'claude');
  assert.equal(auto.basket.theme, 'it', 'theme inferred from the stocks');
});
