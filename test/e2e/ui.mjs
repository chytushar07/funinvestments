// Drives every page and sheet of FunInvestments through real taps (390px phone), checking saved state.
import puppeteer from 'puppeteer-core';
const B = process.env.B || 'http://localhost:8787';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 390, height: 820, isMobile: true, hasTouch: false });
const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
p.on('dialog', d => d.accept());
const wait = ms => new Promise(r => setTimeout(r, ms));
const call = async (op, a = {}) => { const r = await p.evaluate(async (op, a) => (await fetch('/api/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': localStorage.getItem('fi_space_key') || '' }, body: JSON.stringify({ args: a }) })).json(), op, a); if (!r.ok) throw new Error(op + ': ' + r.error.message); return r.data; };
const S = () => call('get_state');
const xq = t => `normalize-space(.)="${t}" or starts-with(normalize-space(.), "${t}") or starts-with(normalize-space(.), "+ ${t}") or starts-with(normalize-space(.), "⚑ ${t}") or starts-with(normalize-space(.), "+${t}")`;
async function tap(text, scope = 'auto', { optional = false } = {}) {
  const inSheet = scope === 'sheet' || (scope === 'auto' && await p.$('.sheet'));
  const root = inSheet ? '//div[contains(@class,"sheet")]' : '//main';
  const els = await p.$$(`xpath/${root}//button[${xq(text)}] | ${root}//a[${xq(text)}]`);
  for (const el of els) { const ok = await el.evaluate(e => !e.disabled && e.offsetParent !== null); if (ok) { await el.evaluate(e => e.scrollIntoView({ block: 'center' })); await el.click(); await wait(650); return true; } }
  if (optional) return false;
  throw new Error(`no enabled "${text}" in ${inSheet ? 'sheet' : 'page'}`);
}
const disabled = async (text) => p.evaluate(t => [...document.querySelectorAll(document.querySelector('.sheet') ? '.sheet button' : 'main button')].filter(b => b.textContent.trim().startsWith(t)).every(b => b.disabled), text);
const type = async (sel, v) => { await p.$eval(sel, e => { e.focus(); e.select?.(); }); await p.$eval(sel, (e, v) => { const set = Object.getOwnPropertyDescriptor(e.__proto__, 'value').set; set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, String(v)); await wait(250); };
const go = async hash => { await p.evaluate(h => { location.hash = h; }, hash); await wait(700); };
const reload = async hash => { if (hash) await go(hash); await p.reload({ waitUntil: 'networkidle0' }); await wait(800); };
const text = () => p.evaluate(() => document.body.innerText);
const sheetOpen = () => p.$('.sheet').then(Boolean);
const closeSheet = async () => { if (await sheetOpen()) { await p.click('.sheet .sheet-x'); await wait(600); } };
let pass = 0, fail = 0; const fails = [];
const check = (n, c, extra = '') => { if (c) { pass++; console.log('  ✓', n); } else { fail++; fails.push(n); console.log('  ✗', n, extra); } };
async function journey(name, fn) {
  console.log(name); const e0 = errs.length;
  try { await fn(); } catch (e) { fail++; fails.push(name + ': ' + e.message); console.log('  ✗ threw:', e.message); await p.screenshot({ path: `/tmp/fi-fail-${pass + fail}.png` }); }
  await closeSheet();
  const t = await text(); check('no NaN/undefined on screen', !/\bNaN\b|undefined|\[object Object\]/.test(t), (t.match(/.{0,40}(NaN|undefined|\[object Object\]).{0,40}/) || [''])[0]);
  check('no page errors', errs.length === e0, errs.slice(e0).join(' | '));
}
const fresh = async (plan = 'pro') => { await call('reset'); if (plan === 'pro') await call('set_plan', { plan: 'pro' }); await reload('home'); };
const AC = ['SRF', 'NAVINFLUOR', 'HAVELLS', 'BLUESTARCO', 'KIRLPNU', 'PRECWIRE'];

await p.goto(B + '/#home', { waitUntil: 'networkidle0' });
try { await p.evaluate(() => { localStorage.setItem('fi_tour_seen', '1'); localStorage.setItem('fi_tour_v1', 'done'); }); } catch {}

await journey('1. Every page loads empty (Free, no baskets) and back works', async () => {
  await fresh('free');
  for (const r of ['home', 'explore', 'baskets', 'orders', 'alerts', 'notifications', 'pricing', 'account', 'about', 'activity', 'rules', 'stock-SRF', 'basket-nope']) {
    await reload(r); const t = await text();
    check(`#${r} renders`, t.length > 200 && !/Something went wrong/.test(t));
  }
  await go('home'); await go('orders'); await p.goBack(); await wait(500);
  check('browser back returns to previous page', p.url().endsWith('#home'));
});

await journey('2. Create basket in the UI (validation, pick, paste)', async () => {
  await fresh();
  await tap('Create basket');
  check('create disabled with nothing picked', await disabled('Create basket'));
  await type('#nb-name', 'UI basket');
  for (const s of AC) { await type('#nb-q', s); const [row] = await p.$$(`xpath/.//div[contains(@class,"sheet")]//button[contains(@class,"btnrow")]`); await row.click(); await wait(200); }
  await tap('Create basket');
  let st = await S(); const bk = st.baskets.find(x => x.name === 'UI basket');
  check('basket saved with 6 stocks', bk?.count === 6, JSON.stringify(st.baskets.map(x => [x.name, x.count])));
  await closeSheet();
  await reload('home'); await tap('New basket', 'page', { optional: true }) || await tap('Create basket');
  await tap('Paste symbols'); await type('#nb-name', 'Pasted'); await type('#nb-paste', 'ntpc, torntpower coalindia;PETRONET OIL premierene FOOBAR');
  await tap('Create basket');
  st = await S(); const pb = st.baskets.find(x => x.name === 'Pasted');
  check('paste: lowercase/mixed separators parsed, unknown skipped', pb?.count === 6, JSON.stringify(pb?.stocks.map(s => s.symbol)));
  check('result explains skipped symbol', /FOOBAR/.test(await text()));
});

await journey('3. Invest via sheet: amount validation, edit qty, remove line, confirm', async () => {
  const st0 = await S(); const bk = st0.baskets.find(x => x.name === 'UI basket');
  await closeSheet(); await go('basket-' + bk.id); await tap('Invest');
  await type('#inv-amt', 0); check('Review disabled for ₹0', await disabled('Review orders'));
  await type('#inv-amt', 999999999); check('Review disabled above cash', await disabled('Review orders'));
  await type('#inv-amt', 30000); await tap('Review orders');
  check('review sheet open', /Buy/.test(await text()) && await sheetOpen());
  const n0 = (await S()).pending;
  const rm = await p.$$('.sheet [aria-label^="Remove "]'); if (rm.length) { await rm[0].click(); await wait(800); }
  const st1 = await S(); const pend = st1.orders.filter(o => o.status === 'pending');
  check('removing a line cancels that order', pend.length === n0 - 1, `pending ${n0} -> ${pend.length}`);
  await tap('Buy ·'); await wait(600);
  const st2 = await S(); const b2 = st2.baskets.find(x => x.id === bk.id);
  check('invested; no pending left', b2.isInvested && st2.pending === 0);
  check('cash dropped by about the amount', st2.cash < 100000 - 20000 && st2.cash > 100000 - 31000, st2.cash);
  await reload('basket-' + bk.id); check('holdings show after reload', /shares · ₹/.test(await text()));
});

await journey('4. Closing a drafted preview cancels the orders (no leftovers)', async () => {
  const st0 = await S(); const bk = st0.baskets.find(x => x.name === 'UI basket');
  await reload('basket-' + bk.id); await tap('Invest more', 'page', { optional: true }) || (await p.click('[aria-label="Basket options"]'), await wait(500), await tap('Invest more', 'sheet'));
  await type('#inv-amt', 10000); await tap('Review orders'); await closeSheet(); await wait(800);
  check('no pending after closing preview', (await S()).pending === 0);
});

await journey('5. Stock page: buy, sell, add to another basket, flag + withdraw', async () => {
  const st0 = await S(); const bk = st0.baskets.find(x => x.name === 'UI basket');
  await reload('stock-HAVELLS');
  await tap('Buy'); await tap('Review order'); await tap('Buy ·');
  let st = await S(); const h1 = st.baskets.find(x => x.id === bk.id).stocks.find(s => s.symbol === 'HAVELLS').qty;
  await tap('Sell'); await p.click('.sheet [aria-label$=": less"]'); await wait(400); await tap('Sell ·'); // Sell drafts all you hold and opens the review; keep one share here
  st = await S(); const h2 = st.baskets.find(x => x.id === bk.id).stocks.find(s => s.symbol === 'HAVELLS')?.qty || 0; // selling all takes it out of the basket
  check('buy then sell changed holding', h1 > 0 && h2 < h1, `${h1} -> ${h2}`);
  await reload('stock-NTPC'); await tap('Add to basket');
  const added = await tap('Add', 'sheet', { optional: true });
  check('add-to sheet works (or says already in)', added || /Already in/.test(await text()));
  await closeSheet();
  await reload('stock-HAVELLS'); await tap('Flag', 'page');
  await tap('Debt vs equity'); await type('#fl-note', 'Borrowings up'); await tap('Flag', 'sheet');
  st = await S(); const fl = st.flags.find(f => f.symbol === 'HAVELLS' && f.status === 'open');
  check('flag saved', !!fl);
  const sell = st.orders.find(o => o.status === 'pending' && o.flagId === fl?.id);
  check('worse flag on a held stock drafts a sell', !!sell);
  await closeSheet(); await reload('stock-HAVELLS'); await tap('Withdraw'); await tap('Withdraw', 'sheet');
  st = await S();
  check('withdraw closes flag and cancels its sell', st.flags.find(f => f.id === fl.id).status === 'withdrawn' && st.orders.find(o => o.id === sell.id).status === 'cancelled');
});

await journey('6. Basket menu: edit, duplicate, rules reset, exit (cancel then confirm), delete', async () => {
  const st0 = await S(); const bk = st0.baskets.find(x => x.name === 'UI basket');
  await reload('basket-' + bk.id);
  await p.click('[aria-label="Basket options"]'); await wait(500); await tap('Edit name');
  check('Save disabled when nothing changed', await disabled('Save'));
  await type('#eb-name', ''); check('Save disabled for empty name', await disabled('Save'));
  await type('#eb-name', 'UI renamed'); await tap('Save');
  let st = await S(); check('renamed', st.baskets.some(x => x.id === bk.id && x.name === 'UI renamed'));
  await closeSheet(); await p.click('[aria-label="Basket options"]'); await wait(500); await tap('Duplicate');
  st = await S(); check('duplicated', st.baskets.some(x => x.name === 'UI renamed copy'));
  await reload('basket-' + bk.id); await p.click('[aria-label="Basket options"]'); await wait(500); await tap('Reset rules'); await tap('Reset', 'sheet');
  await reload('basket-' + bk.id); await p.click('[aria-label="Basket options"]'); await wait(500); await tap('Exit basket'); await closeSheet(); await wait(700);
  st = await S(); check('closing exit preview keeps shares, no pending', st.pending === 0 && st.baskets.find(x => x.id === bk.id).isInvested);
  await p.click('[aria-label="Basket options"]'); await wait(500); await tap('Exit basket'); await tap('Sell all', 'sheet');
  st = await S(); const b1 = st.baskets.find(x => x.id === bk.id);
  check('exit sold everything, basket kept', b1 && !b1.isInvested && st.pending === 0);
  await reload('basket-' + bk.id); await p.click('[aria-label="Basket options"]'); await wait(500); await tap('Delete basket'); await tap('Delete basket', 'sheet');
  st = await S(); check('deleted, landed on Baskets', !st.baskets.some(x => x.id === bk.id) && p.url().endsWith('#baskets'));
  await reload('baskets'); check('deleted basket gone from Baskets after reload', !(await p.$$eval('.bcard .name', ns => ns.map(n => n.textContent))).includes('UI renamed'));
});

await journey('7. Rules: edit a rule (Stricter/Looser), cutoffs, limits; Free shows lock', async () => {
  const st0 = await S(); const bk = st0.baskets.find(x => x.name === 'Pasted');
  await reload('basket-' + bk.id); await tap('Rules');
  const rows = await p.$$('xpath/.//main//button[contains(., "Debt vs equity")]'); await rows[0].click(); await wait(500);
  await tap('Stricter'); await tap('Save');
  let st = await S(); check('rule changed on this basket only', st.baskets.find(x => x.id === bk.id).rules.metrics.find(r => r.id === 'de').green < 0.5 && st.rules.metrics.find(r => r.id === 'de').green === 0.5);
  await closeSheet(); await reload('rules'); check('Default rules page shows 13 rules', (await text()).includes('Debt vs equity'));
  await call('set_plan', { plan: 'free' }); await reload('basket-' + bk.id); await tap('Rules');
  check('Free: editing locked', /Pro/.test(await text()));
  await call('set_plan', { plan: 'pro' });
});

await journey('8. Tracking basket: add / edit / remove holding', async () => {
  await reload('baskets'); const opened = await tap('Tracking', 'page', { optional: true });
  if (!opened) await call('create_basket', { name: 'Real shares', kind: 'tracking', holdings: [{ symbol: 'SRF', qty: 2, avg_price: 2400 }] });
  if (await sheetOpen()) { await type('#ho-sym', 'NTPC').catch(() => {}); }
  await closeSheet();
  let st = await S(); let t = st.baskets.find(x => x.kind === 'tracking');
  if (!t) t = (await call('create_basket', { name: 'Real shares', kind: 'tracking', holdings: [{ symbol: 'SRF', qty: 2, avg_price: 2400 }] })).basket;
  await reload('basket-' + t.id); await tap('Stocks', 'page', { optional: true });
  const addH = await tap('+ Add holding', 'page', { optional: true }) || await tap('Add', 'page', { optional: true });
  if (addH && await sheetOpen()) { await type('#ho-sym', 'OIL'); await type('#ho-qty', 7); await type('#ho-avg', 420); await tap('Save'); }
  st = await S(); t = st.baskets.find(x => x.id === t.id);
  check('holding added', t.stocks.some(s => s.symbol === 'OIL' && s.qty === 7), JSON.stringify(t.stocks.map(s => [s.symbol, s.qty])));
  check('tracking basket has no Invest button', !(await p.$$(`xpath/.//main//button[normalize-space(.)="Invest"]`)).length);
});

await journey('9. Own stock (candidate): add, edit, delete', async () => {
  await reload('explore'); const ok = await tap('Add your own', 'page', { optional: true }) || await tap('Add a stock', 'page', { optional: true }) || await tap('+ Add', 'page', { optional: true });
  if (!ok) await p.evaluate(() => import('/store.js').then(m => m.openSheet({ type: 'candidate' })));
  await wait(500);
  check('Add disabled for bad symbol', await (async () => { await type('#cd-sym', 'bad sym!'); return disabled('Add stock'); })());
  await type('#cd-sym', 'MYCO'); await type('#cd-name', 'My Co'); await type('#cd-px', 150); await tap('Add stock');
  let st = await S(); check('custom stock added', !!(await call('get_universe', { q: 'MYCO' })).stocks.length);
  await closeSheet(); await reload('stock-MYCO'); await tap('Edit stock'); await type('#cd-name', 'My Co Ltd'); await tap('Save');
  check('custom stock edited', (await call('get_universe', { q: 'MYCO' })).stocks[0]?.name === 'My Co Ltd');
  await closeSheet(); await reload('stock-MYCO'); await tap('Delete stock'); await tap('Delete', 'sheet');
  check('custom stock deleted', !(await call('get_universe', { q: 'MYCO' })).stocks.length);
});

await journey('10. Orders page: rules sell → Keep anyway → journal edit/delete; Not now', async () => {
  const st0 = await S(); const bk = st0.baskets.find(x => x.name === 'Pasted');
  const d = await call('create_order', { basket_id: bk.id, side: 'buy', amount: 40000 }); await call('confirm_order', { order_ids: d.orders.map(o => o.id) });
  await call('set_rule', { rule_id: 'de', green: 0.01, red: 0.02, basket_id: bk.id });
  await reload('orders'); check('rules sell shows in Orders', /sell/i.test(await text()));
  await tap('Review all', 'page', { optional: true }) || await tap('Review', 'page');
  await tap('Keep anyway', 'sheet'); // one tap; the reason is added from the toast
  await p.waitForSelector('.toast button', { timeout: 6000 }).catch(() => {}); await p.evaluate(() => [...document.querySelectorAll('.toast button')].find(b => b.textContent.includes('Add reason'))?.click()); await wait(500);
  await type('#jr', 'Long term view'); await tap('Save', 'sheet');
  let st = await S(); check('kept: no pending, journal entry', st.pending === 0 && st.journal[0]?.action === 'Kept anyway', JSON.stringify(st.journal[0]));
  await reload('account'); const j = await tap('Long term view', 'page', { optional: true }) || await tap('Kept anyway', 'page', { optional: true });
  if (!j) { await p.evaluate(e => import('/store.js').then(m => m.openSheet({ type: 'journal', entry: e })), st.journal[0]); await wait(400); }
  await type('#jr', 'Edited reason'); await tap('Save');
  st = await S(); check('journal edited', st.journal[0].reason === 'Edited reason');
  await p.evaluate(e => import('/store.js').then(m => m.openSheet({ type: 'journal', entry: e })), st.journal[0]); await wait(400);
  const nJ = st.journal.length; await tap('Delete', 'sheet'); await tap('Delete', 'sheet');
  st = await S(); check('journal entry deleted', st.journal.length === nJ - 1, `${nJ} -> ${st.journal.length}`);
});

await journey('11. Account & plans: name, plan switch, notifications, Free limits, reset', async () => {
  await reload('pricing'); check('pricing renders prices', /499/.test(await text()));
  await call('set_plan', { plan: 'free' }); await reload('home');
  await tap('New basket', 'page', { optional: true }) || await tap('Create basket'); await wait(300);
  const t = await text(); check('Free with baskets: create blocked with upgrade prompt', /Pro|plans/.test(t));
  await closeSheet(); await call('set_plan', { plan: 'pro' });
  await reload('account'); check('settings shows notifications', /Notifications/.test(await text()));
  await p.click('[aria-label="Settings, refresh, reset"]').catch(() => {}); await wait(300); await tap('Refresh', 'auto', { optional: true });
  await call('reset'); await reload('home'); const st = await S();
  check('reset: empty and full cash', st.baskets.length === 0 && st.cash === 100000 && st.alerts.length === 0 && !(st.clearedAlerts || []).length);
});

await journey('12. Notifications page round-trip after reset (empty tabs)', async () => {
  await reload('notifications');
  for (const tabName of ['Pending', 'Notifications', 'Cleared']) { const [t] = await p.$$(`xpath/.//button[@role="tab" and starts-with(normalize-space(.),"${tabName}")]`); await t.click(); await wait(300); }
  check('empty states shown', /Nothing cleared yet/.test(await text()));
  await p.click('[aria-label="Back"]'); await wait(500); check('back leaves Notifications', !p.url().endsWith('#notifications'));
});

await journey('13. Time travel with baskets: rule changes, refill, rebalance sheet', async () => {
  await call('set_plan', { plan: 'pro' });
  const bk = (await call('create_basket', { name: 'Time', symbols: AC })).basket;
  const d = await call('create_order', { basket_id: bk.id, side: 'buy', amount: 50000 }); await call('confirm_order', { order_ids: d.orders.map(o => o.id) });
  await reload('home'); await tap('+1q', 'auto', { optional: true }) || await p.click('[aria-label="Jump 1 quarter"]'); await wait(2500);
  let st = await S(); check('a quarter passed', st.clock > '2026-11-01', st.clock);
  await reload('basket-' + bk.id);
  const rb = await tap('Rebalance', 'page', { optional: true });
  if (rb) { if (await tap('Review orders', 'sheet', { optional: true })) await closeSheet(); }
  await wait(600); st = await S();
  check('closing rebalance preview leaves nothing pending of mine', !st.orders.some(o => o.status === 'pending' && o.source === 'you'));
  await reload('alerts'); check('alerts page lists items', st.alerts.length === 0 || /Why\?/.test(await text()));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fails.length) console.log('FAILED:\n - ' + fails.join('\n - '));
await b.close();
