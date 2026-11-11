const B = process.env.B || 'http://localhost:8787', K = process.env.K || 'fi_demo_7f3a9c21';
const rpc = async (method, params) => (await (await fetch(`${B}/mcp/${K}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
const api = async (op, a = {}) => (await (await fetch(`${B}/api/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: a }) })).json());
const tools = (await rpc('tools/list', {})).result.tools;
console.log(tools.length, 'tools:', tools.map(t => t.name).join(' '));
let bad = 0;
const callAll = async (label, argsFor) => {
  for (const t of tools) {
    const r = await rpc('tools/call', { name: t.name, arguments: argsFor(t.name) });
    const txt = r.result?.content?.[0]?.text || JSON.stringify(r.error);
    const crash = r.error || /TypeError|ReferenceError|Cannot read|undefined is not|NaN/.test(txt);
    if (crash) { bad++; console.log(`  ✗ [${label}] ${t.name}: ${txt.slice(0, 160)}`); }
  }
  const st = await api('get_state'); if (!st.ok) { bad++; console.log('  ✗ state broken after', label); }
};
await api('reset');
await callAll('empty', () => ({}));
await api('reset'); await api('set_plan', { plan: 'pro' });
const bk = (await api('create_basket', { name: 'M', symbols: ['SRF','NAVINFLUOR','HAVELLS','BLUESTARCO','KIRLPNU','PRECWIRE'] })).data.basket;
const d = (await api('create_order', { basket_id: bk.id, side: 'buy', amount: 40000 })).data; await api('confirm_order', { order_ids: d.orders.map(o => o.id) });
const args = n => ({ basket_id: bk.id, symbol: 'HAVELLS', side: 'buy', amount: 5000, rule_id: 'de', green: 0.4, red: 0.9, enabled: true, metric: 'de', impact: 'worse', name: 'From Claude', symbols: ['NTPC','TORNTPOWER','COALINDIA','PETRONET','OIL','PREMIERENE'], buy_below: 3, sell_above: 7, scope: 'basket', reason: 'test', limit: 5 });
await callAll('with data', args);
const st = (await api('get_state')).data;
console.log('after Claude sweep: baskets', st.baskets.length, 'pending', st.pending, 'activity', st.activity.length, 'todo', st.todo.map(t => t.text).join(' | '));
console.log(bad ? `${bad} problems` : 'MCP sweep clean');
