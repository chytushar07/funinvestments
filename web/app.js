// FunInvestments website shell: routing, layout, toast, sheets. Rendered with Preact so only what
// changed updates (no full-page refresh). No AI: every number comes from the engine.
import { html, render, useState, useEffect } from './vendor/preact-htm.js';
import * as notify from './notify.js';
import * as api from './client.js';
import { store, refresh, act, go, toast, openSheet, confirmDialog } from './store.js';
import { I, Logo, short } from './lib.js';
import { Home, Explore, Stock, Baskets, Basket, Orders, Alerts, Pricing, Account, About, Activity, PlanSwitch, DefaultRules } from './pages.js';
import { Tour } from './tour.js';
import { SheetHost } from './sheets.js';

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const [r, ...rest] = h.split('-');
  if (r === 'basket' && rest.length) return { route: 'basket', param: rest.join('-') };
  if (r === 'stock' && rest.length) return { route: 'stock', param: rest.join('-') };
  const known = ['home', 'explore', 'baskets', 'orders', 'alerts', 'pricing', 'account', 'about', 'activity', 'rules'];
  return { route: known.includes(r) ? r : 'home', param: null };
}

function useRoute() {
  const [r, setR] = useState(parseHash());
  useEffect(() => {
    const on = () => { setR(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

const NAV = S => [
  ['home', 'Home', I.home, 0],
  ['baskets', 'Baskets', I.baskets, 0],
  ['orders', 'Orders', I.orders, S.pending],
  ['alerts', 'Alerts', I.bell, S.unread],
  ['about', 'Explore app', I.compass, 0],
];

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const JUMP = {
  advance_day: d => `Now ${short(d.clock)} · ${d.filings.length ? `new results: ${[...new Set(d.filings.map(f => f.symbol))].slice(0, 3).join(', ')}` : 'daily checks run'}`,
  advance_quarter: d => { const f = new Set(d.filings.map(x => x.symbol)).size, c = d.changes.length; return [`Now ${short(d.clock)}`, f && `${count(f, 'company', 'companies')} reported`, c ? count(c, 'status change', 'status changes') : 'no status changes'].filter(Boolean).join(' · '); },
};
const refreshNow = async () => { if (await refresh()) toast('Up to date'); };
const resetDemo = () => confirmDialog({ title: 'Start the demo over?', body: 'This erases every basket, order, alert, news flag and the activity log, and puts back ₹1,00,000 of practice money. It can\'t be undone.', confirm: 'Reset demo', danger: true,
  onConfirm: async () => { const r = await act('reset', {}, { ok: 'Demo reset · fresh start' }); if (r?.ok) go('home'); } });

function TopBar() {
  const S = store.S;
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!menu) return;
    const off = e => { if (!e.target.closest?.('.topmenu')) setMenu(false); };
    const key = e => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('click', off); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', off); document.removeEventListener('keydown', key); };
  }, [menu]);
  const jump = async op => { if (busy) return; setBusy(op); await act(op, {}, { ok: JUMP[op] }); setBusy(null); };
  const pick = fn => () => { setMenu(false); fn(); };
  return html`<div class="topbar">
    <button class="brand" onClick=${() => go('home')} aria-label="FunInvestments home"><${Logo}/><span>FunInvestments</span></button>
    <span class="spacer"></span>
    <div class="clock" data-tour="clock" role="group" aria-label="Demo date" aria-busy=${!!busy}>
      <button class="clock-date" title="Demo date: this is a practice app, so you move time yourself. Tap to learn more." aria-label=${`Demo date ${short(S.clock)}. What is this?`} onClick=${() => openSheet({ type: 'info', k: 'democlock' })}>
        <span class="clock-k">Demo date</span><span class="num">${short(S.clock)}</span></button>
      <button class="clock-step ${busy === 'advance_day' ? 'busy' : ''}" disabled=${!!busy} title="Jump 1 day: the daily rule checks run" aria-label="Jump 1 day" onClick=${() => jump('advance_day')}>+1<span class="u-s">d</span><span class="u-l"> day</span></button>
      <button class="clock-step ${busy === 'advance_quarter' ? 'busy' : ''}" disabled=${!!busy} title="Jump 1 quarter: new quarterly results arrive" aria-label="Jump 1 quarter" onClick=${() => jump('advance_quarter')}>+1<span class="u-s">q</span><span class="u-l"> quarter</span></button></div>
    <div class="topmenu">
      <button class="iconbtn" aria-haspopup="menu" aria-expanded=${menu} aria-label="Settings, refresh, reset" onClick=${() => setMenu(!menu)}>${I.user}</button>
      ${menu && html`<div class="topmenu-pop" role="menu">
        <button class="menuitem" role="menuitem" onClick=${pick(() => go('account'))}>Settings</button>
        <button class="menuitem" role="menuitem" onClick=${pick(refreshNow)}>Refresh</button>
        <button class="menuitem danger" role="menuitem" onClick=${pick(resetDemo)}>Reset demo</button></div>`}</div>
  </div>`;
}

function App() {
  const [, setTick] = useState(0);
  store.render = setTick;
  const { route, param } = useRoute();
  const S = store.S;
  if (!S) return html`<div class="shell"><main class="main"><div class="col" style="padding-top:24px"><div class="sk" style="height:44px"></div><div class="sk" style="height:180px;margin-top:18px"></div><div class="sk" style="height:180px;margin-top:12px"></div></div></main></div>`;
  const nav = NAV(S);
  const active = route === 'basket' ? 'baskets' : route === 'stock' || route === 'explore' || route === 'activity' ? 'home' : route;
  const page = {
    home: () => html`<${Home}/>`, explore: () => html`<${Explore}/>`, stock: () => html`<${Stock} key=${param} symbol=${param}/>`,
    baskets: () => html`<${Baskets}/>`, basket: () => html`<${Basket} key=${param} id=${param}/>`, orders: () => html`<${Orders}/>`,
    alerts: () => html`<${Alerts}/>`, pricing: () => html`<${Pricing}/>`, account: () => html`<${Account}/>`, about: () => html`<${About}/>`, activity: () => html`<${Activity}/>`, rules: () => html`<${DefaultRules}/>`,
  }[route]();
  const t = store.ui.toast;
  return html`<div class="shell">
    <nav class="rail" aria-label="Main">
      <button class="brand" onClick=${() => go('home')}><${Logo}/><div>FunInvestments<small>by Tushar</small></div></button>
      ${nav.map(([r, l, ic, n]) => html`<button key=${r} data-tour=${'nav-' + r} class="navlink ${active === r ? 'on' : ''} ${r === 'about' ? 'explorebtn' : ''}" aria-current=${active === r ? 'page' : null} onClick=${() => go(r)}>${ic}${l}${n ? html`<span class="count">${n}</span>` : null}</button>`)}
      <div class="foot">
        <${PlanSwitch} rail/>
        <button class="navlink ${route === 'account' ? 'on' : ''}" onClick=${() => go('account')}>${I.user}Settings</button></div>
    </nav>
    <main class="main" id="main"><div class="col">
      <${TopBar}/>
      ${store.netError && html`<div class="card row between" role="alert"><span>Can't reach the server.</span><button class="btn small" onClick=${refresh}>Retry</button></div>`}
      ${page}
      <p class="disclaimer">For learning only · Practice money, no real trades · Not investment advice · All prices and metrics are mock data</p>
    </div></main>
    <nav class="bottomnav" aria-label="Main">${nav.map(([r, l, ic, n]) => html`<button key=${r} data-tour=${'nav-' + r} class="${active === r ? 'on' : ''} ${r === 'about' ? 'explorebtn' : ''}" aria-current=${active === r ? 'page' : null} onClick=${() => go(r)}>${ic}${l}${n ? html`<span class="dot-badge">${n}</span>` : null}</button>`)}</nav>
    <${SheetHost}/>
    <${Tour}/>
    ${t && html`<div class="toast ${t.err ? 'err' : ''}" role="status" key=${t.at}><span>${t.text}</span>${t.action && html`<button onClick=${() => go(t.go)}>${t.action}</button>`}</div>`}
  </div>`;
}

(async function boot() {
  store.onState = notify.check;
  render(html`<${App}/>`, document.getElementById('app'));
  await api.init();
  await refresh();
  // Server mode: show changes Claude makes from outside the page.
  // In the background the page keeps checking (every ~15 s) only if browser alerts are allowed, so alerts still arrive.
  let tick = 0;
  const sync = async () => { tick++; if (document.hidden && !(notify.wantsBackground() && tick % 6 === 0)) return; const r = await api.changedSince(api.currentRev()); if (r) await refresh(); };
  setInterval(sync, 2500);
  document.addEventListener('visibilitychange', sync); // back on this tab: catch up at once, not after the next tick
  api.onExternalChange(refresh);
})();
