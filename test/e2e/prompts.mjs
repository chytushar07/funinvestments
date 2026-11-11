// Claude prompt library: Home shows 3 picks + "See all prompts", the #prompts page shows
// "Suggested for you" + categories with "Show N more", tags but no filter controls, Copy gives a toast.
import puppeteer from 'puppeteer-core';
const B = process.env.B || 'http://localhost:8787';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 412, height: 915, isMobile: true });
const errs = []; p.on('pageerror', e => errs.push(e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
const call = async (op, a = {}) => { const r = await p.evaluate(async (op, a) => (await fetch('/api/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': localStorage.getItem('fi_space_key') || '' }, body: JSON.stringify({ args: a }) })).json(), op, a); if (!r.ok) throw new Error(op + ': ' + r.error.message); return r.data; };
const open = async hash => { await p.evaluate(h => { location.hash = h; }, hash); await p.reload({ waitUntil: 'networkidle0' }); await wait(700); };
let fail = 0; const check = (n, c, x = '') => { console.log(c ? '  ✓' : '  ✗', n, c ? '' : x); if (!c) fail++; };
const count = sel => p.$$eval(sel, e => e.length);
const titles = sel => p.$$eval(sel, e => e.map(x => x.textContent.trim()));
const AC = ['SRF', 'NAVINFLUOR', 'HAVELLS', 'BLUESTARCO', 'KIRLPNU', 'PRECWIRE'];

await p.goto(B + '/#home', { waitUntil: 'networkidle0' });
await p.evaluate(() => localStorage.setItem('fi_tour_seen', '1'));
const ctx = b.defaultBrowserContext(); await ctx.overridePermissions(B, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);

console.log('fresh Free');
await call('reset'); await open('home');
check('Home shows exactly 3 picks', (await count('#with-claude .plib-row')) === 3);
check('Home has one "See all prompts" link', (await titles('#with-claude .plib-all')).join() === 'See all prompts ›');
check('first card is Connect when Claude is not connected', (await titles('#with-claude .plib-row .t'))[0] === 'Connect Claude first');
await p.click('#with-claude .plib-all'); await wait(700);
check('link opens #prompts', (await p.evaluate(() => location.hash)) === '#prompts');
check('page has "Suggested for you"', (await titles('.plib-page h2')).some(t => t.startsWith('Suggested for you')));
check('page has categories', (await count('.plib-cat')) >= 6);
check('no filter controls (inputs, selects, chips)', (await count('.plib-page input, .plib-page select, .plib-page .chip, .plib-page [role=tab]')) === 0);
check('tags are labels, not buttons', (await count('.plib-page button.ptag')) === 0 && (await count('.plib-page .ptag')) > 0);
check('Free sees no copyable Pro prompt', (await p.$$eval('.plib-row', rs => rs.filter(r => /· Pro/.test(r.textContent) && r.querySelector('.btn.ghost')).length)) === 0);
const before = await count('.plib-row');
await p.click('.plib-show'); await wait(300);
check('"Show N more" expands a category', (await count('.plib-row')) > before);
await p.click('.plib-page .plib-row .btn.ghost'); await wait(300);
check('Copy shows the toast', /Copied · paste it in Claude/.test(await p.$eval('.toast', e => e.textContent).catch(() => '')));
check('no unfilled placeholders', !(await p.evaluate(() => /\{\w+\}/.test(document.body.innerText))));

console.log('invested Pro basket');
await call('set_plan', { plan: 'pro' });
const bk = (await call('create_basket', { name: 'AC value chain', symbols: AC })).basket;
const d = await call('create_order', { basket_id: bk.id, side: 'buy', amount: 50000 }); await call('confirm_order', { order_ids: d.orders.map(o => o.id) });
await open('prompts');
const sug = await p.$$eval('.plib-page section:first-of-type .plib-row .t', e => e.map(x => x.textContent));
check('suggested names the basket', sug.some(t => t.includes('AC value chain')), sug.join(' | '));
check('Pro rule prompts are copyable', (await p.$$eval('.plib-row', rs => rs.filter(r => /Rules · Pro/.test(r.textContent) && r.querySelector('.btn.ghost')).length)) > 0);
await open('basket-' + bk.id);
check('basket page: quiet "Ask Claude" fold with ≤2 picks + link', (await count('.plib-ask')) === 1 && (await count('.plib-ask .plib-row')) <= 2 && (await count('.plib-ask .plib-all')) === 1);
await open('about');
check('Explore app: at most 3 picks + link', (await count('.plib-row')) <= 3 && (await count('.plib-all')) === 1);

console.log('sold basket');
await call('set_plan', { plan: 'free' });
const ex = await call('exit_basket', { basket_id: bk.id }); await call('confirm_order', { order_ids: ex.orders.map(o => o.id) });
await open('prompts');
const sugC = await p.$$eval('.plib-page section:first-of-type .plib-row .t', e => e.map(x => x.textContent));
check('sold: re-invest and review on top', sugC.slice(0, 2).some(t => /Re-invest in AC value chain/.test(t)) && sugC.some(t => /How did AC value chain do/.test(t)), sugC.join(' | '));
check('no page errors', errs.length === 0, errs.join(' | '));
await b.close();
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
