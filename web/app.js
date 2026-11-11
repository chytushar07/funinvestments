// FunInvestments website shell: routing, layout, toast, sheets. Rendered with Preact so only what
// changed updates (no full-page refresh). No AI: every number comes from the engine.
import { html, render, useState, useEffect } from './vendor/preact-htm.js';
import * as api from './client.js';
import { store, refresh, act, go } from './store.js';
import { I, Logo, short } from './lib.js';
import { Home, Explore, Stock, Baskets, Basket, Orders, Alerts, Pricing, Account, About, Activity } from './pages.js';
import { Tour } from './tour.js';
import { SheetHost } from './sheets.js';

function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const [r, ...rest] = h.split('-');
  if (r === 'basket' && rest.length) return { route: 'basket', param: rest.join('-') };
  if (r === 'stock' && rest.length) return { route: 'stock', param: rest.join('-') };
  const known = ['home', 'explore', 'baskets', 'orders', 'alerts', 'pricing', 'account', 'about', 'activity'];
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
  ['about', 'About', I.about, 0],
];

function TopBar() {
  const S = store.S;
  return html`<div class="topbar">
    <button class="brand" onClick=${() => go('home')} aria-label="FunInvestments home"><${Logo}/><span>FunInvestments</span></button>
    <span class="spacer"></span>
    <span class="clock" data-tour="clock" title="Demo clock: move time forward to run the daily rule checks"><span class="num">${short(S.clock)}</span>
      <button onClick=${() => act('advance_day', {}, { ok: d => `${short(d.clock)} · ${d.filings.length ? `filing: ${d.filings.map(f => f.symbol).join(', ')}` : 'checks run'}` })} aria-label="Advance 1 day">+1d</button>
      <button onClick=${() => act('advance_quarter', {}, { ok: d => `${short(d.clock)} · ${d.filings.length} filings · ${d.changes.length} changes` })} aria-label="Advance 1 quarter">+1q</button></span>
    <button class="iconbtn" onClick=${() => go('account')} aria-label="Settings">${I.user}</button>
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
    alerts: () => html`<${Alerts}/>`, pricing: () => html`<${Pricing}/>`, account: () => html`<${Account}/>`, about: () => html`<${About}/>`, activity: () => html`<${Activity}/>`,
  }[route]();
  const t = store.ui.toast;
  return html`<div class="shell">
    <nav class="rail" aria-label="Main">
      <button class="brand" onClick=${() => go('home')}><${Logo}/><div>FunInvestments<small>by Tushar</small></div></button>
      ${nav.map(([r, l, ic, n]) => html`<button key=${r} data-tour=${'nav-' + r} class="navlink ${active === r ? 'on' : ''}" aria-current=${active === r ? 'page' : null} onClick=${() => go(r)}>${ic}${l}${n ? html`<span class="count">${n}</span>` : null}</button>`)}
      <div class="foot">
        ${S.plan === 'free' ? html`<button class="btn small primary block" onClick=${() => go('pricing')}>Try Pro</button>` : html`<span class="tag claude" style="align-self:flex-start">Pro</span>`}
        <button class="navlink ${route === 'account' ? 'on' : ''}" onClick=${() => go('account')}>${I.user}Settings</button></div>
    </nav>
    <main class="main" id="main"><div class="col">
      <${TopBar}/>
      ${store.netError && html`<div class="card row between" role="alert"><span>Can't reach the server.</span><button class="btn small" onClick=${refresh}>Retry</button></div>`}
      ${page}
      <p class="disclaimer">For learning only · Practice money, no real trades · Not investment advice · All prices and metrics are mock data</p>
    </div></main>
    <nav class="bottomnav" aria-label="Main">${nav.map(([r, l, ic, n]) => html`<button key=${r} data-tour=${'nav-' + r} class=${active === r ? 'on' : ''} aria-current=${active === r ? 'page' : null} onClick=${() => go(r)}>${ic}${l}${n ? html`<span class="dot-badge">${n}</span>` : null}</button>`)}</nav>
    <${SheetHost}/>
    <${Tour}/>
    ${t && html`<div class="toast ${t.err ? 'err' : ''}" role="status" key=${t.at}><span>${t.text}</span>${t.action && html`<button onClick=${() => go(t.go)}>${t.action}</button>`}</div>`}
  </div>`;
}

(async function boot() {
  render(html`<${App}/>`, document.getElementById('app'));
  await api.init();
  await refresh();
  // Server mode: show changes Claude makes from outside the page.
  setInterval(async () => { if (document.hidden) return; const r = await api.changedSince(api.currentRev()); if (r) await refresh(); }, 2500);
})();
