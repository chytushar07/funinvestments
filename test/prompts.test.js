// The Claude prompt library: state-aware picks, plan gating, categories and placeholders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, dispatch } from '../engine/core.js';
import { TOOLS } from '../engine/tools.js';
import { CATEGORIES, library, listPrompts, pickPrompts, promptContext } from '../web/prompts.js';

const AC = ['SRF', 'NAVINFLUOR', 'HAVELLS', 'BLUESTARCO', 'KIRLPNU', 'PRECWIRE'];
const tools = TOOLS;
function world({ plan = 'free', claude = true } = {}) {
  const st = createState();
  const ok = (op, a = {}, actor = 'you') => { const r = dispatch(st, op, a, actor); assert.ok(r.ok, `${op}: ${r.error?.message}`); return r.data; };
  if (plan === 'pro') ok('set_plan', { plan: 'pro' });
  if (claude) ok('get_activity', {}, 'claude');
  const S = () => dispatch(st, 'get_state', {}, 'you').data;
  const basket = (name = 'AC value chain', symbols = AC) => ok('create_basket', { name, symbols }).basket;
  const invest = id => { const d = ok('create_order', { basket_id: id, side: 'buy', amount: 50000 }); ok('confirm_order', { order_ids: d.orders.map(o => o.id) }); };
  return { st, ok, S, basket, invest };
}
const ids = picks => picks.map(p => p.id);
const PRO_ONLY = new Set(library({ themes: [] }).filter(p => p.pro).map(p => p.id));

// Every state's picks: 3, none locked, no Pro-only on Free, no unfilled placeholder, and the expected ones on top.
function check(name, S, expectTop, { connectFirst = false } = {}) {
  const picks = pickPrompts(S, { tools });
  assert.equal(picks.length, 3, `${name}: 3 picks`);
  for (const p of picks) {
    assert.ok(!p.locked, `${name}: ${p.id} is locked`);
    if (S.plan !== 'pro') assert.ok(!PRO_ONLY.has(p.id), `${name}: Free got Pro prompt ${p.id}`);
    assert.ok(!/\{\w+\}/.test(p.title + p.text), `${name}: unfilled ${p.title} / ${p.text}`);
  }
  if (connectFirst) assert.equal(picks[0].kind, 'connect', `${name}: connect card first`);
  for (const id of expectTop) assert.ok(ids(picks).includes(id), `${name}: expected ${id} in ${ids(picks)}`);
  return picks;
}

test('fresh Free (not connected): connect card, then first-basket starters', () => {
  const { S } = world({ claude: false });
  check('fresh free', S(), ['start-first'], { connectFirst: true });
});
test('fresh Pro (connected): build ideas, no connect card', () => {
  const { S } = world({ plan: 'pro' });
  const p = check('fresh pro', S(), ['start-first']);
  assert.ok(!p.some(x => x.kind === 'connect'));
});
test('basket below minimum: add N more, with names filled', () => {
  const w = world();
  w.basket('AC value chain', AC.slice(0, 4));
  const p = check('below', w.S(), ['invest-fill']);
  assert.equal(p[0].title, 'Add 2 more to AC value chain');
  assert.match(p[0].text, /needs 2 more stocks/);
});
test('built but not invested: invest it', () => {
  const w = world(); w.basket();
  check('built', w.S(), ['invest-first']);
});
test('invested Pro basket: check it; Pro rule ideas allowed', () => {
  const w = world({ plan: 'pro' }); const b = w.basket(); w.invest(b.id);
  check('invested', w.S(), ['check-basket']);
  assert.ok(listPrompts(w.S(), { tools }).some(p => p.id === 'rules-debt' && !p.locked));
});
test('exited basket: re-invest, review, delete', () => {
  const w = world(); const b = w.basket(); w.invest(b.id);
  const ex = w.ok('exit_basket', { basket_id: b.id }); w.ok('confirm_order', { order_ids: ex.orders.map(o => o.id) });
  check('exited', w.S(), ['exit-reinvest', 'exit-review']);
});
test('tracking basket: check my real shares', () => {
  const w = world();
  w.ok('create_basket', { name: 'Real shares', kind: 'tracking', holdings: [{ symbol: 'SRF', qty: 3, avg_price: 2000 }] });
  const p = check('tracking', w.S(), ['track-check']);
  assert.equal(p.find(x => x.id === 'track-check').title, 'Check Real shares');
});
test('pending order: explain, then confirm in the app (never ask Claude to confirm)', () => {
  const w = world(); const b = w.basket();
  w.ok('create_order', { basket_id: b.id, side: 'buy', amount: 30000 }, 'claude');
  const p = check('pending', w.S(), ['invest-pending']);
  assert.match(p[0].text, /I'll confirm or cancel them in the app/);
});
test('urgent alert: explain the alert first', () => {
  const w = world(); const b = w.basket(); w.invest(b.id);
  w.st.alerts.unshift({ id: 'a_x', date: w.st.clock, read: false, critical: true, basketId: b.id, symbol: 'PRECWIRE', type: 'status', text: 'Precision Wires turned Sell' });
  const p = check('urgent', w.S(), ['alerts-urgent']);
  assert.equal(p[0].id, 'alerts-urgent');
  assert.match(p[0].text, /Precision Wires turned Sell/);
});
test('Claude not connected with a basket: connect card first, plus 2 relevant prompts', () => {
  const w = world({ claude: false }); w.basket();
  check('not connected', w.S(), ['invest-first'], { connectFirst: true });
});
test('unread notifications: sum them up', () => {
  const w = world(); const b = w.basket(); w.invest(b.id);
  for (let i = 0; i < 3; i++) w.st.alerts.unshift({ id: 'a_u' + i, date: w.st.clock, read: false, critical: false, basketId: b.id, type: 'info', text: 'Note ' + i });
  check('unread', w.S(), ['alerts-unread']);
});

test('Free never gets a prompt the plan blocks: Pro rule edits and a 2nd basket are locked', () => {
  const w = world(); w.basket();
  const all = listPrompts(w.S(), { tools });
  for (const p of all.filter(p => PRO_ONLY.has(p.id))) assert.equal(p.locked, 'Pro', p.id);
  for (const p of all.filter(p => p.cat === 'build' && p.id !== 'build-research')) assert.ok(p.locked, `${p.id} should be locked at the Free basket limit`);
  for (const p of pickPrompts(w.S(), { tools, max: 5 })) assert.ok(!p.locked);
});

test('every prompt has a known category, and placeholders resolve in every state', () => {
  const cats = new Set(CATEGORIES.map(c => c.id));
  const w = world();
  const states = [w.S()];
  const b = w.basket(); states.push(w.S()); w.invest(b.id); states.push(w.S());
  const S0 = { plan: 'free', baskets: [], themes: [{ id: 'banking', label: 'Banking' }] };
  states.push(S0);
  for (const p of library(states[1])) assert.ok(cats.has(p.cat), `${p.id} category ${p.cat}`);
  const lib = library(states[1]);
  assert.equal(new Set(lib.map(p => p.id)).size, lib.length, 'ids unique');
  assert.ok(lib.length >= 40 && lib.length <= 70, `library size ${lib.length}`);
  for (const S of states) for (const p of listPrompts(S, {})) assert.ok(!/\{\w+\}/.test(p.title + p.text), `unfilled: ${p.title} / ${p.text}`);
});

test('prompts only use tools Claude has; orders and deletes are always "I\'ll confirm"', () => {
  const names = new Set(TOOLS.map(t => t.name));
  const S = world({ plan: 'pro' }).S();
  const c = promptContext(S, { tools });
  for (const p of library(S)) {
    const ok = (p.needs || []).every(t => names.has(t)) && (!p.any || p.any.some(t => names.has(t)));
    const listed = listPrompts(S, { tools }).some(x => x.id === p.id);
    if (!ok) assert.ok(!listed, `${p.id} listed without its tools`);
    if ((p.needs || []).concat(p.any || []).some(t => ['create_order', 'exit_basket', 'request_delete_basket', 'remove_stock', 'rebalance_basket'].includes(t)) && /order|sell|delete|buy/i.test(p.text) && !/explain|review|before/i.test(p.title))
      assert.match(p.text, /I'll confirm|Cancel the waiting/, `${p.id}: must leave confirmation to the user`);
    assert.ok(!/confirm (the|my|these) orders|upgrade me|switch (me )?to pro/i.test(p.text), `${p.id} asks Claude to do what only the user can`);
  }
  assert.ok(c.hasTools);
});

test('basket page picks stay on that basket', () => {
  const w = world({ plan: 'pro' }); const a = w.basket(); w.invest(a.id);
  const b = w.basket('Energy', ['NTPC', 'TORNTPOWER', 'COALINDIA', 'PETRONET']);
  const p = pickPrompts(w.S(), { tools, basketId: b.id, max: 2 });
  assert.equal(p[0].id, 'invest-fill');
  assert.ok(p.every(x => !x.text.includes('AC value chain')), JSON.stringify(p));
});
