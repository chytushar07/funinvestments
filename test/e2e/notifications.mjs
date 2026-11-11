import puppeteer from 'puppeteer-core';
const B = process.env.B || 'http://localhost:8787';
const K = process.env.K || 'fi_demo_7f3a9c21';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 390, height: 800, deviceScaleFactor: 1 });
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
const wait = ms => new Promise(r => setTimeout(r, ms));
const call = (op, a = {}) => p.evaluate(async (op, a) => { const r = await (await fetch('/api/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': localStorage.getItem('fi_space_key') || '' }, body: JSON.stringify({ args: a }) })).json(); if (!r.ok) throw new Error(op + ': ' + JSON.stringify(r.error)); return r.data; }, op, a);
const claude = (name, args = {}) => p.evaluate(async ([name, args, K]) => { const r = await (await fetch('/mcp/' + K, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json(); return r; }, [name, args, K]);
const S = () => call('get_state');
const clickText = async (txt, sel = 'button') => { const [el] = await p.$$(`xpath/.//${sel}[normalize-space(.)="${txt}" or starts-with(normalize-space(.), "${txt}")]`); if (!el) throw new Error('no button: ' + txt); await el.click(); await wait(700); };
const tab = lab => clickText(lab, 'button[@role="tab"]');
const visible = async txt => p.evaluate(t => document.body.innerText.includes(t), txt);
const reload = async (hash = "home") => { await p.goto(`${B}/#${hash}`, { waitUntil: "networkidle0" }); await p.reload({ waitUntil: "networkidle0" }); await wait(700); };
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };
const step = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { fail++; console.log('  ✗ threw:', e.message); } };

await reload();
const setup = async () => { await call('reset'); await call('set_plan', { plan: 'pro' }); };
const AC = ['SRF','NAVINFLUOR','FLUOROCHEM','HAVELLS','BLUESTARCO','KIRLPNU','PRECWIRE'];
const investAll = async (id, amt = 50000) => { const o = (await call('create_order', { basket_id: id, side: 'buy', amount: amt })).orders; await call('confirm_order', { order_ids: o.map(x => x.id) }); };

await step('A. Bell badge, opening Notifications marks read (persists after reload)', async () => {
  await setup(); const bk = (await call('create_basket', { name: 'AC', symbols: AC })).basket; await investAll(bk.id); await call('advance_quarter');
  await reload(); const st = await S();
  check(`unread > 0 (${st.unread})`, st.unread > 0);
  check('badge shows count', await p.$eval('[aria-label^="Notifications"]', e => e.getAttribute('aria-label')).then(l => l.includes('unread')));
  await p.click('[aria-label^="Notifications"]'); await wait(2200);
  check('url is #notifications', p.url().endsWith('#notifications'));
  check('unread 0 after opening', (await S()).unread === 0);
  await reload(); check('badge gone after reload', !(await p.$eval('[aria-label^="Notifications"]', e => e.getAttribute('aria-label'))).includes('unread'));
});

await step('B/C. Delete plain notification, then one with a waiting order', async () => {
  await reload('notifications'); await tab('Notifications');
  let st = await S(); const plain = st.alerts.find(a => a.action?.kind !== 'orders'); const withOrd = st.alerts.find(a => a.action?.kind === 'orders');
  const nA = st.alerts.length, nC = st.clearedAlerts.length;
  const del = async id => { const i = (await S()).alerts.findIndex(a => a.id === id); const btns = await p.$$('.notif-item [aria-label="Delete notification"]'); await btns[i].click(); await wait(900); };
  await del(plain.id);
  st = await S(); check('plain: removed, no dialog, archived', st.alerts.length === nA - 1 && st.clearedAlerts.length === nC + 1 && !st.alerts.some(a => a.id === plain.id));
  check('Pending had the order todo before', st.todo.some(t => t.kind === 'orders'));
  await del(withOrd.id);
  check('confirm dialog appears', await visible('It also cancels its'));
  await clickText('Delete both'); await wait(500);
  st = await S();
  check('order cancelled', withOrd.action.ids.every(id => st.orders.find(o => o.id === id).status === 'cancelled'));
  check('no pending orders / no order todo', st.pending === 0 && !st.todo.some(t => t.kind === 'orders'));
  check('archived with cancelled order', st.clearedAlerts[0].id === withOrd.id && st.clearedAlerts[0].cancelled.length === withOrd.action.ids.length);
  await reload('notifications'); await tab('Cleared'); check('Cleared tab shows "Cancelled with it" after reload', await visible('Cancelled with it'));
});

await step('D. Clear all (with a Claude-drafted sell attached) cancels and archives', async () => {
  await setup(); const bk = (await call('create_basket', { name: 'AC', symbols: AC })).basket; await investAll(bk.id); await call('advance_quarter');
  await reload('notifications'); await tab('Notifications');
  const before = await S(); const linked = before.alerts.filter(a => a.action?.kind === 'orders').flatMap(a => a.action.ids).filter(id => before.orders.find(o => o.id === id)?.status === 'pending');
  await clickText('Clear all');
  check('dialog mentions orders', linked.length ? await visible('cancels the') : true);
  await clickText('Clear all', 'button[contains(@class,"dangerfill")]'); await wait(600);
  const st = await S(); check('no alerts left', st.alerts.length === 0); check('all archived', st.clearedAlerts.length >= before.alerts.length);
  check('linked orders cancelled', linked.every(id => st.orders.find(o => o.id === id).status === 'cancelled'));
  await reload('notifications'); await tab('Notifications'); check('empty state after reload', await visible('No notifications'));
});

await step('E. Decline / Restore a reminder; Home next step follows', async () => {
  await setup(); const bk = (await call('create_basket', { name: 'Fresh', symbols: AC })).basket;
  await reload(); check('Home next step: Invest', await visible('Invest in Fresh'));
  await reload('notifications'); await tab('Pending'); await clickText('Decline'); await wait(400);
  let st = await S(); check('invest todo hidden', !st.todo.some(t => t.kind === 'invest'));
  await reload(); check('Home next step gone', !(await visible('YOUR NEXT STEP')) && !(await p.evaluate(() => !!document.querySelector('.nextstep'))));
  await reload('notifications'); await tab('Cleared'); check('Declined entry with Restore', await visible('Declined: Invest in Fresh') && await visible('Restore'));
  await clickText('Restore'); st = await S(); check('restored to todo', st.todo.some(t => t.kind === 'invest'));
  check('Cleared entry removed', !st.clearedAlerts.some(c => c.key === 'invest:' + bk.id));
  // decline again, then invest: decline should be pruned, exit brings reminder back
  await call('decline_todo', { key: 'invest:' + bk.id }); await investAll(bk.id);
  st = await S(); check('declined key pruned after investing', !(st.todo.some(t => t.kind === 'invest')));
  const ex = await call('exit_basket', { basket_id: bk.id }); await call('confirm_order', { order_ids: ex.orders.map(o => o.id) });
  st = await S(); check('after exit, Invest reminder returns', st.todo.some(t => t.kind === 'invest' && t.basketId === bk.id));
});

await step('F. Decline Claude-drafted orders', async () => {
  await setup(); const bk = (await call('create_basket', { name: 'AC', symbols: AC })).basket;
  const r = await claude('create_order', { basket_id: bk.id, side: 'buy', amount: 30000 }); check('Claude drafted orders via MCP', !r.error && !r.result?.isError);
  await reload('notifications'); await tab('Pending'); check('Pending shows Confirm orders', await visible('Confirm'));
  await clickText('Decline'); check('confirm dialog', await visible('waiting order')); await clickText('Decline', 'button[contains(@class,"danger") or contains(@class,"dangerfill")]');
  const st = await S(); check('all cancelled, no order todo', st.pending === 0 && !st.todo.some(t => t.kind === 'orders'));
});

const delReq = async (invested) => { await setup(); const bk = (await call('create_basket', { name: 'Railway', symbols: AC })).basket; if (invested) await investAll(bk.id); await claude('request_delete_basket', { basket_id: bk.id, reason: 'You asked to delete it' }); await reload(); return bk; };

await step('G. Delete request → Decline keeps basket', async () => {
  const bk = await delReq(true); check('Home shows Delete Railway?', await visible('Delete Railway?'));
  await reload('notifications'); await tab('Pending'); await clickText('Decline'); await wait(300);
  if (await visible('The basket is kept')) await clickText('Decline', 'button[contains(@class,"btn") and contains(@class,"block") or contains(@class,"primary")]');
  const st = await S(); check('request cleared, basket kept', st.baskets.some(b => b.id === bk.id && !b.deleteRequest) && !st.todo.some(t => t.kind === 'delete'));
});

await step('H. Delete request → Review → Only sell, keep the basket (the reported bug)', async () => {
  const bk = await delReq(true);
  await clickText('Review'); await wait(500); await clickText('Only sell, keep the basket'); await wait(800);
  await clickText('Sell all'); await wait(800);
  const st = await S(); const b2 = st.baskets.find(b => b.id === bk.id);
  check('sold: basket empty, cash back', b2 && !b2.isInvested && st.cash > 99000);
  check('delete request cleared (no stuck next step)', !b2.deleteRequest && !st.todo.some(t => t.kind === 'delete'));
  await reload(); check('Home no longer shows Delete Railway?', !(await visible('Delete Railway?')));
});

await step('I. Delete request → Review → Sell everything and delete', async () => {
  const bk = await delReq(true); const cash0 = (await S()).cash;
  await clickText('Review'); await wait(500); await clickText('Sell everything and delete'); await wait(800);
  const st = await S(); check('basket gone', !st.baskets.some(b => b.id === bk.id));
  check('no todo / alerts / pending for it', !st.todo.some(t => t.basketId === bk.id) && !st.alerts.some(a => a.basketId === bk.id) && !st.orders.some(o => o.basketId === bk.id && o.status === 'pending'));
  check('cash returned', st.cash > cash0 + 40000);
  await reload(); check('Home clean', !(await visible('Delete Railway?')));
});

await step('J. Delete request on an empty (already sold) basket → Delete basket', async () => {
  const bk = await delReq(false);
  await clickText('Review'); await wait(500); await clickText('Delete basket'); await wait(800);
  const st = await S(); check('basket gone, no todo', !st.baskets.some(b => b.id === bk.id) && !st.todo.some(t => t.kind === 'delete'));
});

await step('K. Exit from basket menu while delete requested still lets you finish deleting', async () => {
  const bk = await delReq(true); const ex = await call('exit_basket', { basket_id: bk.id }); await call('confirm_order', { order_ids: ex.orders.map(o => o.id) });
  let st = await S(); check('request still there (you did not say keep)', st.todo.some(t => t.kind === 'delete'));
  await reload(); await clickText('Review'); await wait(500); check('now a plain delete', await visible('Delete basket'));
  await clickText('Delete basket'); await wait(800); st = await S(); check('deleted cleanly', !st.baskets.length && !st.todo.length);
});

await step('L. Live sync: a Claude action shows up without reloading', async () => {
  await setup(); const bk = (await call('create_basket', { name: 'AC', symbols: AC })).basket; await reload();
  await claude('create_order', { basket_id: bk.id, side: 'buy', amount: 20000 }); await wait(4000);
  check('Home next step updated live to Confirm orders', await visible('Confirm'));
});

console.log(`\n${pass} passed, ${fail} failed`); if (errs.length) console.log('Page errors:', [...new Set(errs)].slice(0, 5));
await b.close();
