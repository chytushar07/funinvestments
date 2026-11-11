// Claude can do everything the website does, except the person-only decisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createState, dispatch, PERSON_ONLY, PERSON_ONLY_REASONS, OP_NAMES } from '../engine/core.js';
import { TOOLS, TOOL_OP, UI_ONLY, PARITY } from '../engine/tools.js';
import { mcpHandle, INSTRUCTIONS } from '../engine/mcp.js';

const webOps = () => {
  const src = fs.readdirSync(new URL('../web/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(new URL('../web/' + f, import.meta.url), 'utf8')).join('\n');
  return [...new Set([...src.matchAll(/\b(?:act|read)\('([a-z_]+)'/g)].map(m => m[1]))].sort();
};

test('every website action is a Claude tool, person-only (with a reason) or a tiny UI-only helper', () => {
  const toolOps = new Set(TOOLS.map(t => TOOL_OP[t.name] || t.name));
  const missing = webOps().filter(op => !toolOps.has(op) && !PERSON_ONLY.has(op) && !UI_ONLY[op]);
  assert.deepEqual(missing, [], `website ops with no tool: ${missing.join(', ')}`);
  for (const op of PERSON_ONLY) { assert.ok(PERSON_ONLY_REASONS[op]?.length > 20, `reason for ${op}`); assert.ok(!toolOps.has(op), `${op} must not be a tool`); }
  assert.ok(Object.keys(UI_ONLY).length <= 3, 'UI-only list stays tiny');
  for (const t of TOOLS) { assert.ok(OP_NAMES.includes(TOOL_OP[t.name] || t.name), `${t.name} maps to an engine op`); assert.ok(PARITY[t.name], `website path for ${t.name}`); }
  for (const op of ['confirm_order', 'set_plan', 'delete_basket', 'keep_basket', 'reset', 'set_profile']) assert.ok(PERSON_ONLY.has(op), op);
  assert.match(INSTRUCTIONS, /can't: confirm orders/);
});

test('every Claude write is logged as Claude, in plain words', () => {
  const st = createState(); st.plan = 'pro';
  const rpc = (name, args = {}) => { const r = mcpHandle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, (op, a) => dispatch(st, op, a, 'claude')); return r.result.structuredContent; };
  const b = rpc('create_basket', { name: 'AC', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'PRECWIRE'] }).basket;
  rpc('create_order', { basket_id: b.id, side: 'buy', amount: 90000 });
  dispatch(st, 'confirm_order', { order_ids: st.orders.filter(o => o.status === 'pending').map(o => o.id) }, 'you');
  const writes = [
    ['duplicate_basket', { basket_id: b.id }], ['rebalance_basket', { basket_id: b.id }], ['mark_notifications_read', {}],
    ['add_news_flag', { symbol: 'SRF', metric: 'roe', impact: 'worse' }], ['set_notifications', { push: true }],
  ];
  for (const [name, args] of writes) {
    const n = st.activity.length;
    const r = rpc(name, args);
    assert.ok(!r?.error, `${name}: ${JSON.stringify(r?.error)}`);
    const e = st.activity[0];
    assert.ok(st.activity.length > n, `${name} logged`);
    assert.equal(e.actor, 'claude'); assert.notEqual(e.kind, 'read', `${name} is a change`);
    assert.ok(!/_/.test(e.text), `plain words: ${e.text}`);
  }
  const fl = st.flags[0];
  for (const [name, args] of [['update_news_flag', { flag_id: fl.id, note: 'Results soon' }], ['delete_news_flag', { flag_id: fl.id }]]) {
    rpc(name, args); assert.equal(st.activity[0].actor, 'claude'); assert.ok(!/_/.test(st.activity[0].text), st.activity[0].text);
  }
  // person-only tools do not exist for Claude
  for (const name of ['confirm_order', 'set_plan', 'delete_basket', 'keep_basket', 'set_profile', 'reset']) {
    const r = mcpHandle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }, () => { throw new Error('must not run'); });
    assert.equal(r.error.code, -32602, name);
  }
});

test('notifications end to end via MCP: read, mark read, delete (cancels its sell), clear, restore, decline / restore pending', () => {
  const st = createState(); st.plan = 'pro';
  const rpc = (name, args = {}) => { const r = mcpHandle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, (op, a) => dispatch(st, op, a, 'claude')); return r.result; };
  const data = (name, args) => { const r = rpc(name, args); assert.ok(!r.isError, `${name}: ${r.content[0].text}`); return r.structuredContent; };
  const b = data('create_basket', { name: 'AC', symbols: ['SRF', 'NAVINFLUOR', 'HAVELLS', 'VOLTAS', 'KIRLPNU', 'PRECWIRE'] }).basket;
  // not invested: an "Invest" reminder waits
  let pend = data('get_notifications', { tab: 'pending' }).pending;
  const inv = pend.find(t => t.kind === 'invest');
  assert.ok(inv);
  data('decline_pending', { key: inv.key });
  assert.ok(!data('get_notifications', { tab: 'pending' }).pending.some(t => t.key === inv.key), 'declined');
  assert.ok(data('get_notifications', { tab: 'cleared' }).cleared.some(x => x.key === inv.key));
  data('restore_pending', { key: inv.key });
  assert.ok(data('get_notifications', { tab: 'pending' }).pending.some(t => t.key === inv.key), 'restored');
  // invest, then a must-pass break drafts a sell with a notification
  data('create_order', { basket_id: b.id, side: 'buy', amount: 90000 });
  dispatch(st, 'confirm_order', { order_ids: st.orders.filter(o => o.status === 'pending').map(o => o.id) }, 'you');
  st.universe.SRF.metrics.de = 3;
  dispatch(st, 'advance_day', {}, 'you');
  let n = data('get_notifications', { unread_only: true });
  assert.ok(n.unread > 0);
  const crit = n.notifications.find(a => a.action?.kind === 'orders');
  assert.ok(crit, 'sell notification');
  data('mark_notifications_read', { ids: [crit.id] });
  assert.ok(st.alerts.find(a => a.id === crit.id).read);
  const del = data('delete_notification', { alert_id: crit.id });
  assert.ok(del.cancelled.length >= 1, 'its waiting sell is cancelled');
  assert.ok(crit.action.ids.every(id => st.orders.find(o => o.id === id).status === 'cancelled'));
  assert.ok(data('get_notifications', { tab: 'cleared' }).cleared.some(x => x.id === crit.id));
  data('restore_notification', { alert_id: crit.id });
  assert.ok(data('get_notifications', {}).notifications.some(x => x.id === crit.id), 'back');
  const all = data('get_notifications', {}).total;
  const cl = data('clear_notifications', {});
  assert.equal(cl.cleared, all); assert.equal(data('get_notifications', {}).total, 0);
  // Claude can withdraw its own delete request; only the user deletes
  data('request_delete_basket', { basket_id: b.id });
  pend = data('get_notifications', { tab: 'pending' }).pending;
  const delReq = pend.find(t => t.kind === 'delete');
  data('decline_pending', { key: delReq.key });
  assert.ok(!st.baskets.find(x => x.id === b.id).deleteRequest);
  assert.equal(rpc('set_notifications', { push: true }).isError, false);
  st.plan = 'free';
  const r = rpc('set_notifications', { push: true });
  assert.equal(r.isError, true); assert.equal(r.structuredContent.error.code, 'pro_feature');
  assert.ok(st.activity.filter(x => x.actor === 'claude').every(x => !/_/.test(x.text)), 'plain text');
});
