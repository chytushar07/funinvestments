// Guided tour: walks a newcomer through the app step by step, moving between pages and
// spotlighting the thing to look at. Pure UI, no AI.
import { html, useState, useEffect } from './vendor/preact-htm.js';
import { store, go } from './store.js';

const firstBasket = () => store.S?.baskets.find(b => b.kind === 'model') || store.S?.baskets[0];

export const STEPS = [
  { route: 'home', sel: '[data-tour="search"]', t: 'Find any stock', b: () => `Search ${store.S?.universe.length || 55} Indian stocks by name, symbol or sector, like "Energy" or "Voltas".` },
  { route: 'home', sel: '[data-tour="movers"]', t: 'Browse stocks', b: 'Rows of stocks you can swipe through. Each card shows the price, today\'s change and a status: ✓ Pass, ! Watch or ✕ Remove. Tap a card to see why.' },
  { route: 'home', sel: '[data-tour="plan"]', t: 'Free or Pro', b: 'Switch plans here to see what Pro unlocks. It\'s a demo: no payment is taken.' },
  { route: 'home', sel: '[data-tour="create"]', t: 'Create a basket', b: 'A basket is a small group of stocks you invest in together, with its own safety rules. Pick stocks by hand here.' },
  { route: 'home', sel: '[data-tour="claude"]', t: 'Or let Claude build it', b: 'Copy a prompt into Claude after connecting it once. Claude researches and the basket appears here. Claude can prepare orders, but only you can confirm them.' },
  { route: 'explore', sel: '[data-tour="select"]', t: 'Pick several at once', b: 'In Explore, filter by theme, sector or "Profitable 2+ yrs", tap Select, choose stocks, then Create basket.' },
  { route: 'stock-NTPC', sel: '[data-tour="why"]', t: 'Why this status?', b: 'Every stock is checked against 13 safety rules: green is good, amber is a warning, red is a problem. Tap any ⓘ to learn what a number means.' },
  { route: 'stock-NTPC', sel: '[data-tour="actions"]', t: 'Act on a stock', b: 'Add it to a basket, buy or sell with practice money, or flag a news story. If news may break a must-pass rule, a sell is prepared for you to review.' },
  { route: () => (firstBasket() ? 'basket-' + firstBasket().id : 'baskets'), sel: () => (firstBasket() ? '[data-tour="tabs"]' : '[data-tour="newbasket"]'),
    t: () => (firstBasket() ? 'Inside a basket' : 'Your baskets live here'),
    b: () => (firstBasket() ? 'Overview shows value and where the money is. Stocks lets you add or remove. Rules lets you change this basket\'s rules. Scorecard is the past test: how these rules did every year since 2018. The ⋯ menu has edit, duplicate, exit (sell everything) and delete.' : 'Create a basket and it appears here, with its value, return and how it compares with the Nifty 50.') },
  { route: 'orders', sel: '[data-tour="nav-orders"]', t: 'Orders wait for you', b: 'Orders prepared by you, the rules or Claude wait here. Change a quantity, confirm, cancel, or keep a stock anyway with a reason.' },
  { route: 'alerts', sel: '[data-tour="nav-alerts"]', t: 'Alerts', b: 'You hear when a stock\'s status changes, new quarterly results arrive, or a basket needs a replacement. Tap "Why?" for the numbers behind it.' },
  { route: 'home', sel: '[data-tour="clock"]', t: 'Move time forward', b: 'This is a demo, so you move the date yourself. +1 day runs the daily rule checks. +1 quarter brings new quarterly results.' },
  { route: 'about', sel: '[data-tour="nav-about"]', t: 'Come back anytime', b: 'About lists everything you can do, compares Free and Pro, and restarts this tour.' },
];
const val = v => (typeof v === 'function' ? v() : v);

export function startTour() { store.ui = { ...store.ui, sheet: null, tour: 0 }; store.render?.(n => n + 1); try { localStorage.setItem('fi_tour_seen', '1'); } catch { /* ignore */ } }
export function tourSeen() { try { return localStorage.getItem('fi_tour_seen') === '1'; } catch { return false; } }
function setStep(i) { store.ui = { ...store.ui, tour: i }; store.render?.(n => n + 1); }
export function endTour() { setStep(null); }

function findVisible(sel) {
  for (const el of document.querySelectorAll(sel)) { const r = el.getBoundingClientRect(); if (r.width && r.height) return el; }
  return null;
}

export function Tour() {
  const i = store.ui.tour;
  const [rect, setRect] = useState(null);
  const step = i != null ? STEPS[i] : null;
  useEffect(() => {
    if (!step) return;
    const route = val(step.route);
    if (location.hash.replace('#', '') !== route) go(route);
    setRect(null);
    let tries = 0, el = null, timer;
    const place = () => { if (!el) return; const r = el.getBoundingClientRect(); const maxH = window.innerHeight * 0.42; setRect({ x: r.left, y: Math.max(r.top, 64), w: r.width, h: Math.min(r.height, maxH) }); };
    const find = () => {
      el = findVisible(val(step.sel));
      if (el) { const tall = el.getBoundingClientRect().height > window.innerHeight * 0.42; if (tall) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 72); else el.scrollIntoView({ block: 'center' }); setTimeout(place, 60); return; }
      if (tries++ < 30) timer = setTimeout(find, 100); else setRect({ none: true });
    };
    timer = setTimeout(find, 120);
    const on = () => place();
    window.addEventListener('resize', on); window.addEventListener('scroll', on, true);
    const key = e => { if (e.key === 'Escape') endTour(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft' && i > 0) setStep(i - 1); };
    document.addEventListener('keydown', key);
    return () => { clearTimeout(timer); window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true); document.removeEventListener('keydown', key); };
  }, [i]);
  if (!step) return null;
  const next = () => (i < STEPS.length - 1 ? setStep(i + 1) : endTour());
  const pad = 8;
  const vh = window.innerHeight, vw = window.innerWidth;
  const r = rect && !rect.none ? rect : null;
  const below = r ? r.y + r.h + 200 < vh || r.y < vh / 2 : true;
  const cardTop = r ? (below ? Math.min(vh - 230, r.y + r.h + pad + 10) : Math.max(12, r.y - pad - 210)) : vh / 2 - 100;
  const cardW = Math.min(360, vw - 32);
  const cardLeft = r ? Math.max(16, Math.min(vw - cardW - 16, r.x + r.w / 2 - cardW / 2)) : (vw - cardW) / 2;
  return html`<div class="tour" role="dialog" aria-modal="true" aria-label="App tour">
    ${r ? html`<div class="tour-spot" style="left:${r.x - pad}px;top:${r.y - pad}px;width:${r.w + pad * 2}px;height:${r.h + pad * 2}px"></div>` : html`<div class="tour-dim"></div>`}
    <div class="tour-card" style="top:${cardTop}px;left:${cardLeft}px;width:${cardW}px">
      <div class="row between"><span class="eyebrow">Step ${i + 1} of ${STEPS.length}</span><button class="linkbtn" onClick=${endTour}>Skip tour</button></div>
      <h2 style="margin:6px 0 4px">${val(step.t)}</h2>
      <p class="muted" style="margin:0;font-size:14px;line-height:1.5">${val(step.b)}</p>
      <div class="tour-dots" aria-hidden="true">${STEPS.map((_, k) => html`<span key=${k} class=${k === i ? 'on' : ''}></span>`)}</div>
      <div class="row" style="gap:8px;margin-top:12px">
        ${i > 0 && html`<button class="btn ghost small" onClick=${() => setStep(i - 1)}>Back</button>`}
        <button class="btn primary small" style="flex:1" onClick=${next}>${i < STEPS.length - 1 ? 'Next' : 'Done'}</button></div>
    </div></div>`;
}
