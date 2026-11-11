// Pages. Every number comes from the engine snapshot (store.S) or a read op.
import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { store, act, read, go, openSheet, copy, toast, confirmDialog } from './store.js';
import * as api from './client.js';
import { inr, inr2, pct, cls, short, dateLabel, shortName, STATUS, Pill, Src, Avatar, Mock, Chg, I, Sparkline, Stepper, Switch, Empty } from './lib.js';
import { Info } from './glossary.js';
import { exitBasket } from './sheets.js';
import { startTour, tourSeen } from './tour.js';
import { STORIES, Story } from './stories.js';
const warn = n => `${n} warning${n === 1 ? '' : 's'}`;
export const ago = iso => { if (!iso) return ''; const s = Math.max(0, (Date.now() - new Date(iso)) / 1000); if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`; };

// What the user should do next (orders to confirm, urgent alerts, baskets to fix).
function doTodo(t) {
  if (t.kind === 'orders') openSheet({ type: 'review', ids: t.ids });
  else if (t.kind === 'alerts' || t.kind === 'flags') go('alerts');
  else if (t.kind === 'invest') openSheet({ type: 'invest', id: t.basketId });
  else if (t.basketId) go('basket-' + t.basketId);
}
const TODO_BTN = { orders: 'Review', alerts: 'Open', basket: 'Fix', invest: 'Invest', flags: 'See' };
export function NextStep() {
  const S = store.S;
  const t = S.todo?.[0];
  if (!t) return null;
  return html`<section class="card nextstep" aria-label="Your next step">
    <div class="ns-main"><div class="row"><span class="eyebrow">Your next step</span>${S.todo.length > 1 && html`<button class="linkbtn" onClick=${() => go('activity')}>+${S.todo.length - 1} more</button>`}</div>
      <b>${t.text}</b><span class="ns-d muted">${t.detail}</span></div>
    <button class="btn small primary" onClick=${() => doTodo(t)}>${TODO_BTN[t.kind] || 'Open'}</button></section>`;
}
// One line of "what happened". Look-ups (kind 'read') change nothing, so they render quieter than real actions.
const ACT_IC = { needs_you: '!', error: '✕', change: '✓' };
export function ActivityRow({ a, compact }) {
  if (a.kind === 'read') return html`<div class="li act-read"><span class="act-ic read" aria-hidden="true">${I.search}</span><span class="grow">${a.text}${a.n > 1 ? html` <span class="faint">×${a.n}</span>` : null}</span><span class="faint">${ago(a.at)}</span></div>`;
  const waiting = a.kind === 'needs_you' && a.pending !== false; // a draft that was confirmed or cancelled no longer asks for an OK
  const k = a.kind === 'needs_you' && !waiting ? 'change' : a.kind;
  return html`<div class="li ${compact ? 'act-compact' : ''}"><span class="act-ic ${k}" aria-hidden="true">${ACT_IC[k] || '·'}</span>
    <span class="grow"><span class="t">${a.text}</span><span class="s">${ago(a.at)}${compact ? '' : ` · demo date ${short(a.clock)}`}${waiting ? ' · needs your OK' : ''}</span></span><${Src} s=${a.actor}/></div>`;
}
const isAction = a => a.kind !== 'read';
// Home: the latest things that really happened, by you, Claude or the rules. Look-ups and refused attempts stay on the Activity page.
export function RecentActivity({ limit = 3 }) {
  const list = (store.S.activity || []).filter(a => a.kind === 'change' || a.kind === 'needs_you');
  if (!list.length) return null;
  return html`<section class="section recent"><div class="section-head"><h2>Recent activity</h2><button class="linkbtn" onClick=${() => go('activity')}>See all</button></div>
    <div class="card list">${list.slice(0, limit).map(a => html`<${ActivityRow} key=${a.id} a=${a} compact/>`)}</div></section>`;
}

const ACT_FILTERS = {
  actions: ['Actions', isAction], needs_you: ['Needs you', a => a.kind === 'needs_you' && a.pending !== false], you: ['By you', a => isAction(a) && a.actor === 'you'],
  claude: ['By Claude', a => isAction(a) && a.actor === 'claude'], read: ['Looked up', a => !isAction(a)], error: ['Refused or failed', a => a.kind === 'error'],
};
// The same look-up several times in a row is one quiet line with a count.
const mergeReads = list => list.reduce((out, a) => { const p = out.at(-1); if (p && p.kind === 'read' && a.kind === 'read' && p.tool === a.tool) p.n++; else out.push({ ...a, n: 1 }); return out; }, []);
export function Activity() {
  const S = store.S;
  const [f, setF] = useState('actions');
  const all = S.activity || [];
  const chips = Object.entries(ACT_FILTERS).filter(([k, [, test]]) => k === 'actions' || k === f || all.some(test));
  const list = mergeReads(all.filter(ACT_FILTERS[f][1]));
  return html`<div>
    <div class="row" style="margin-top:4px"><button class="iconbtn" onClick=${() => history.back()} aria-label="Back">${I.back}</button><h1>Activity</h1></div>
    <section class="section"><h2>To do</h2>
      ${S.todo?.length ? html`<div class="card list" style="padding:2px 16px">${S.todo.map((t, i) => html`<div class="li" key=${t.kind + (t.basketId || '') + i}><span class="grow"><span class="t">${t.text}</span><span class="s">${t.detail}</span></span><button class="btn small ${i ? '' : 'primary'}" onClick=${() => doTodo(t)}>${TODO_BTN[t.kind] || 'Open'}</button></div>`)}</div>`
      : html`<span class="muted">Nothing waiting for you.</span>`}</section>
    <section class="section"><div class="section-head"><h2>What happened</h2>${S.lastClaudeCall?.time && html`<span class="faint" style="font-size:12.5px">Claude · ${ago(S.lastClaudeCall.time)}</span>`}</div>
      ${all.length > 0 && html`<div class="chips">${chips.map(([v, [l]]) => html`<button key=${v} class="chip ${f === v ? 'on' : ''}" aria-pressed=${f === v} onClick=${() => setF(v)}>${l}</button>`)}</div>`}
      ${list.length ? html`<div class="card list" style="padding:2px 16px">${list.map(a => html`<${ActivityRow} key=${a.id} a=${a}/>`)}</div>`
      : all.length ? html`<${Empty} title=${f === 'actions' ? 'No actions yet' : 'Nothing in this filter'}>${f === 'actions' && html`<span class="muted">Claude has only looked things up so far.</span><button class="btn small" onClick=${() => setF('read')}>See look-ups</button>`}</${Empty}>`
      : html`<${Empty} title="Nothing yet"><span class="muted">What you and Claude do shows up here.</span>${!S.claudeConnected && html`<button class="btn small" onClick=${() => go('account')}>Connect Claude</button>`}</${Empty}>`}</section>
  </div>`;
}

const byPoints = (a, b) => ({ pass: 0, watch: 1, remove: 2 }[a.status] - { pass: 0, watch: 1, remove: 2 }[b.status]) || a.points - b.points;
export const explore = { q: '', sector: '', status: '', theme: '', profitable: false, sort: 'points', focus: false };
const basketTab = {};
const stageLabel = id => store.S.stages.find(s => s.id === id)?.label || id;
const stageColor = id => `var(--s-${id})`;
// In a theme context (AC, Energy) show the status with that theme's share rule applied.
const themed = (list, theme) => list.map(x => (theme && x.byTheme?.[theme] ? { ...x, status: x.byTheme[theme].status, points: x.byTheme[theme].points } : x));

// ---------- shared pieces ----------
export function StockTile({ s }) {
  return html`<button class="tile-s" onClick=${() => go('stock-' + s.symbol)}>
    <div class="row between"><${Avatar} name=${s.name} stage=${s.stage}/><${Pill} s=${s.status}/></div>
    <div class="nm">${s.name}</div>
    <div><div class="price">${inr2(s.price)}</div><${Chg} v=${s.changePct}/></div></button>`;
}
function HRow({ title, sub, items, onAll, right, info, tour }) {
  return html`<section class="section" data-tour=${tour}>
    <div class="section-head"><div><h2>${title}${info ? html` <${Info} k=${info}/>` : null}</h2>${sub && html`<div class="faint" style="font-size:12.5px;margin-top:2px">${sub}</div>`}</div>${right || html`<button class="linkbtn" onClick=${onAll}>See all</button>`}</div>
    <div class="hscroll">${items.map(s => html`<${StockTile} key=${s.symbol} s=${s}/>`)}
      <button class="tile-s more" onClick=${onAll}><span class="plus">${I.chev}</span>See all</button></div></section>`;
}
function seeAll(patch) { Object.assign(explore, { q: '', sector: '', status: '', theme: '', profitable: false, sort: 'points', focus: false }, patch); go('explore'); }

export function BasketCard({ b, compact }) {
  const logos = b.stocks.slice(0, 5);
  return html`<button class="bcard ${compact ? 'compact' : ''}" onClick=${() => go('basket-' + b.id)}>
    <div class="top"><span class="name">${b.name}</span><${Src} s=${b.source}/>${b.kind === 'tracking' && html`<span class="tag">Tracking</span>`}<span style="flex:1"></span>${b.unread ? html`<span class="dot-badge" style="position:static">${b.unread}</span>` : null}</div>
    ${!compact && b.description && html`<div class="muted" style="font-size:13px;margin-top:-6px">${b.description}</div>`}
    <div class="row between"><div class="stack-logos">${logos.map(s => html`<${Avatar} key=${s.symbol} name=${s.name} stage=${s.stage}/>`)}${b.count > 5 && html`<span class="avatar more">+${b.count - 5}</span>`}</div><span class="muted" style="font-size:13px">${b.count} stock${b.count === 1 ? '' : 's'}${b.themeLabel ? ` · ${b.themeLabel}` : ''}</span></div>
    <div class="figs">
      <div class="fig"><div class="k">Value</div><div class="v">${b.isInvested ? inr(b.value) : '—'}</div></div>
      <div class="fig"><div class="k">Return</div><div class="v ${cls(b.returnPct)}">${b.isInvested ? pct(b.returnPct) : '—'}</div></div>
      <div class="fig"><div class="k">vs Nifty 50</div><div class="v ${cls(b.vsNifty)}">${b.isInvested ? `${b.vsNifty > 0 ? '+' : ''}${b.vsNifty.toFixed(1)} pts` : '—'}</div></div>
    </div>
    <div class="row wrap" style="gap:6px">${b.counts.pass ? html`<${Pill} s="pass" n=${b.counts.pass}/>` : null}${b.counts.watch ? html`<${Pill} s="watch" n=${b.counts.watch}/>` : null}${b.counts.remove ? html`<${Pill} s="remove" n=${b.counts.remove}/>` : null}${b.belowMin && html`<span class="tag">Below min</span>`}${b.pendingOrders ? html`<span class="tag claude">${b.pendingOrders} pending</span>` : null}</div>
  </button>`;
}

function newBasket(preset = {}) {
  const S = store.S;
  const models = S.baskets.filter(b => b.kind === 'model').length;
  if (S.plan === 'free' && models >= S.planInfo.maxBaskets) { api.call('track_event', { name: 'upgrade_moment_shown', props: { feature: 'more baskets' } }); toast('Free plan: 1 basket. Pro has unlimited.', { action: 'See plans', go: 'pricing' }); return; }
  openSheet({ type: 'new', ...preset });
}
export { newBasket };

const PROMPTS = [
  { t: 'Profitable energy companies', p: 'Using FunInvestments, build a basket of energy companies that were profitable in each of the last 2 years. Use my default rules, and make "loss years" strict for this basket.' },
  { t: 'AC value chain, moderate risk', p: 'Read my AC research and create a FunInvestments basket with the stocks that pass my rules. Keep each value-chain stage under 40%.' },
  { t: 'Low-debt power utilities', p: 'In FunInvestments, find power companies with debt/equity under 0.5 and create a basket called "Low-debt power". Then invest ₹50,000.' },
];

// ---------- Home ----------
export function Home() {
  const S = store.S;
  const [mov, setMov] = useState('gainers');
  const U = S.universe;
  const movers = [...U].sort((a, b) => (mov === 'gainers' ? b.changePct - a.changePct : a.changePct - b.changePct)).slice(0, 10);
  const energy = themed(U.filter(x => x.themes?.energy != null), 'energy').sort(byPoints).slice(0, 10);
  const ac = themed(U.filter(x => x.themes?.ac != null), 'ac').sort(byPoints).slice(0, 10);
  const passing = U.filter(x => x.status === 'pass').sort((a, b) => a.points - b.points).slice(0, 10);
  const models = S.baskets;
  const total = S.cash + S.baskets.filter(b => b.kind === 'model').reduce((t, b) => t + b.value, 0);
  const usedClaude = S.claudeConnected && (S.activity || []).some(a => a.actor === 'claude' && a.kind !== 'read'); // already built something with Claude: no how-to line needed
  return html`<div>
    <${PlanSwitch} home/>
    <${NextStep}/>
    ${!tourSeen() && html`<div class="card tour-invite"><div><b>New here?</b><div class="muted" style="font-size:13px">Take the 1-minute tour.</div></div><button class="btn small primary" onClick=${startTour}>Start tour</button></div>`}
    <button class="searchbar" data-tour="search" onClick=${() => seeAll({ focus: true })}>${I.search}<span>Search ${U.length} stocks</span></button>
    ${models.length ? html`<section class="section">
      <div class="section-head"><div><h2>Your baskets</h2><div class="faint num" style="font-size:12.5px;margin-top:2px">Practice portfolio ${inr(total)} · cash ${inr(S.cash)}</div></div><button class="linkbtn" onClick=${() => go('baskets')}>See all</button></div>
      <div class="hscroll">${models.map(b => html`<div class="hb" key=${b.id}><${BasketCard} b=${b} compact/></div>`)}
        <button class="tile-s more newtile" data-tour="create" onClick=${() => newBasket()}><span class="plus">+</span>New basket</button></div></section>`
    : html`<section class="hero-mini card" data-tour="create">
      <div><span class="eyebrow">Your baskets · your rules</span><h1 style="margin-top:6px">Pick stocks. Set rules. We watch them daily.</h1></div>
      <div class="row wrap" style="gap:10px"><button class="btn primary" onClick=${() => newBasket()}>Create basket</button><button class="btn ghost" onClick=${() => document.getElementById('with-claude')?.scrollIntoView({ behavior: 'smooth' })}>${I.spark} With Claude</button></div>
      <div class="row wrap muted" style="font-size:12.5px;gap:12px"><span>₹1,00,000 practice money <${Info} k="practice"/></span><span>13 safety rules</span><span>Past test 2018–2025</span></div></section>`}

    <${RecentActivity}/>
    <${HRow} tour="movers" title="Top movers today" items=${movers} onAll=${() => seeAll({ sort: mov })}
      right=${html`<div class="seg small">${[['gainers', 'Gainers'], ['losers', 'Losers']].map(([v, l]) => html`<button key=${v} class=${mov === v ? 'on' : ''} onClick=${() => setMov(v)}>${l}</button>`)}</div>`}/>
    <${HRow} title="Energy" sub="Oil & gas · power · renewables · coal" items=${energy} onAll=${() => seeAll({ theme: 'energy' })}/>
    <${HRow} title="AC value chain" items=${ac} onAll=${() => seeAll({ theme: 'ac' })}/>
    <${HRow} title="Pass the default rules" info="status" items=${passing} onAll=${() => seeAll({ status: 'pass' })}/>

    <section class="section" id="with-claude" data-tour="claude">
      <div class="section-head"><div><h2>Build with Claude</h2>${!S.claudeConnected && html`<div class="faint" style="font-size:12.5px;margin-top:2px">Claude researches. The basket lands here with its rules.</div>`}</div>${S.claudeConnected ? html`<span class="tag claude">Connected</span>` : html`<button class="linkbtn" onClick=${() => go('account')}>Connect</button>`}</div>
      ${(() => { const list = html`<div class="prompts">${PROMPTS.map(x => html`<div class="prompt" key=${x.t}><b>${x.t}</b><p>${x.p}</p><button class="btn small ghost" onClick=${() => copy(x.p)}>Copy prompt</button></div>`)}</div>`; return usedClaude ? html`<details class="cfold"><summary>Prompt ideas</summary>${list}</details>` : list; })()}
      ${!usedClaude && html`<p class="faint" style="font-size:12.5px;margin:0">${S.claudeConnected ? 'Paste a prompt into Claude. You confirm every order here.' : html`Connect once in <button class="linkbtn" style="font-size:12.5px" onClick=${() => go('account')}>Settings → Connect Claude</button>, then paste a prompt into Claude.`}</p>`}
    </section>
  </div>`;
}

// ---------- Explore ----------
export function Explore() {
  const S = store.S;
  const [, setV] = useState(0);
  const [sel, setSel] = useState(null); // Set when selecting
  const inputRef = useRef();
  useEffect(() => { if (explore.focus) { inputRef.current?.focus(); explore.focus = false; } }, []);
  const upd = patch => { Object.assign(explore, patch); setV(v => v + 1); };
  const sectors = [...new Set(S.universe.map(x => x.sector))].sort();
  const q = explore.q.trim().toLowerCase();
  let list = themed(S.universe, explore.theme).filter(x => !q || x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q) || x.sector.toLowerCase().includes(q))
    .filter(x => !explore.sector || x.sector === explore.sector).filter(x => !explore.theme || x.themes?.[explore.theme] != null)
    .filter(x => !explore.status || x.status === explore.status).filter(x => !explore.profitable || x.profitableYears >= 2);
  const sorts = { points: byPoints, gainers: (a, b) => b.changePct - a.changePct, losers: (a, b) => a.changePct - b.changePct, name: (a, b) => a.name.localeCompare(b.name) };
  list = [...list].sort(sorts[explore.sort] || byPoints);
  const toggle = sym => { const n = new Set(sel); n.has(sym) ? n.delete(sym) : n.add(sym); setSel(n); };
  return html`<div>
    <div class="row between" style="margin-top:4px"><h1>Explore</h1><div class="row" style="gap:8px">
      <button data-tour="select" class="btn small ${sel ? 'primary' : 'ghost'}" onClick=${() => setSel(sel ? null : new Set())}>${sel ? 'Done' : 'Select'}</button>
      <button class="btn small ghost" onClick=${() => openSheet({ type: 'candidate' })}>+ Add stock</button></div></div>
    <label class="searchbar input-like" style="margin-top:14px">${I.search}<input ref=${inputRef} id="ex-q" placeholder="Search name, symbol or sector" value=${explore.q} onInput=${e => upd({ q: e.target.value })} aria-label="Search stocks"/>${explore.q && html`<button class="iconlink" aria-label="Clear search" onClick=${() => upd({ q: '' })}>${I.x}</button>`}</label>
    <div class="chips" style="margin-top:12px">
      ${[['', 'All'], ...S.themes.map(t => [t.id, t.label])].map(([v, l]) => html`<button key=${'t' + v} class="chip ${explore.theme === v ? 'on' : ''}" onClick=${() => upd({ theme: v, sector: '' })}>${l}</button>`)}
      <button class="chip ${explore.profitable ? 'on' : ''}" onClick=${() => upd({ profitable: !explore.profitable })}>Profitable 2+ yrs</button>
    </div>
    <div class="chips" style="margin-top:8px">
      ${[['', 'Any status'], ['pass', '✓ Pass'], ['watch', '! Watch'], ['remove', '✕ Remove']].map(([v, l]) => html`<button key=${'s' + v} class="chip ${explore.status === v ? 'on' : ''}" onClick=${() => upd({ status: v })}>${l}</button>`)}
      <select class="chip select" aria-label="Sector" value=${explore.sector} onChange=${e => upd({ sector: e.target.value })}><option value="">All sectors</option>${sectors.map(s => html`<option key=${s} value=${s}>${s}</option>`)}</select>
      <select class="chip select" aria-label="Sort" value=${explore.sort} onChange=${e => upd({ sort: e.target.value })}><option value="points">Sort: rules</option><option value="gainers">Sort: gainers</option><option value="losers">Sort: losers</option><option value="name">Sort: A–Z</option></select>
    </div>
    <div class="row between" style="margin-top:12px"><span class="muted" style="font-size:13px">${list.length} stock${list.length === 1 ? '' : 's'} · checked with the default rules${explore.theme ? ' and theme share' : ''} <${Info} k="status"/></span><${Mock}/></div>
    ${list.length ? html`<div class="grid2" style="margin-top:10px">${list.map(s => sel
      ? html`<button key=${s.symbol} class="scard ${sel.has(s.symbol) ? 'picked' : ''}" aria-pressed=${sel.has(s.symbol)} onClick=${() => toggle(s.symbol)}>
          <div class="row between"><${Avatar} name=${s.name} stage=${s.stage}/><span class="check">${sel.has(s.symbol) ? '✓' : ''}</span></div>
          <div class="nm">${s.name}</div><div class="row between"><${Pill} s=${s.status}/><span class="pts">${warn(s.points)}</span></div></button>`
      : html`<${StockCard} key=${s.symbol} s=${s}/>`)}</div>`
    : html`<${Empty} title="No stocks match"><span class="muted">Clear a filter or add a stock.</span><button class="btn small" onClick=${() => upd({ q: '', sector: '', status: '', theme: '', profitable: false })}>Clear filters</button></${Empty}>`}
    ${sel && html`<div class="selectbar"><span><b>${sel.size}</b> selected</span><button class="btn primary" disabled=${!sel.size} onClick=${() => { newBasket({ preset: [...sel] }); }}>Create basket</button></div>`}
  </div>`;
}

export function StockCard({ s, b }) {
  return html`<button class="scard" onClick=${() => go('stock-' + s.symbol)}>
    <div class="row between"><${Avatar} name=${s.name} stage=${s.stage}/><${Pill} s=${s.status}/></div>
    <div class="nm">${s.name}</div>
    <div><div class="price">${inr2(s.price)}</div><${Chg} v=${s.changePct}/></div>
    <div class="foot"><span class="pts">${warn(s.points)}${b && b.isInvested ? ` · ${s.weight.toFixed(0)}%` : ''}</span>${s.flags?.length ? html`<span class="flagdot">⚑ Flag</span>` : html`<span class="faint" style="font-size:11.5px">${s.sector || ''}</span>`}</div></button>`;
}

// ---------- Stock ----------
export function Stock({ symbol }) {
  const S = store.S;
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { read('get_stock', { symbol }).then(r => (r.ok ? (setD(r.data), setErr(null)) : setErr(r.error?.message))); }, [symbol, store.rev]);
  if (err) return html`<${Empty} title="Stock not found"><button class="btn small" onClick=${() => go('explore')}>Explore stocks</button></${Empty}>`;
  if (!d) return html`<div class="stack" style="margin-top:20px"><div class="sk" style="height:60px"></div><div class="sk" style="height:200px"></div></div>`;
  const s = d.stock;
  const model = d.inBaskets.find(x => S.baskets.find(b => b.id === x.id)?.kind === 'model');
  const held = d.inBaskets.find(x => x.qty > 0);
  const openFlags = d.flags.filter(f => f.status === 'open');
  return html`<div>
    <div class="row" style="margin-top:4px"><button class="iconbtn" onClick=${() => history.back()} aria-label="Back">${I.back}</button><${Avatar} name=${s.name} stage=${s.stage}/>
      <div style="min-width:0"><h1 style="font-size:20px">${s.name}</h1><div class="row wrap" style="gap:6px"><span class="mono muted">${s.symbol}</span><span class="faint" style="font-size:12.5px">${s.sector} · ${s.stageLabel}</span>${d.isCustom && html`<${Src} s=${s.source}/>`}</div></div></div>
    <section class="stack" style="gap:4px;margin-top:16px"><div class="big num">${inr2(s.price)}</div><div class="row wrap"><span style="font-weight:700"><${Chg} v=${s.changePct}/> today</span><${Mock}/></div></section>
    <div class="card stack" style="margin-top:14px;gap:10px">
      <div class="row between"><span class="row" style="gap:6px"><${Pill} s=${s.liveStatus}/><${Info} k="status"/></span><span class="pts">${warn(s.points)} · ${d.basketName ? `rules of ${d.basketName}` : 'default rules'}</span></div>
      ${!/^(No warnings|\d+ warnings?)$/.test(s.reasons.join(' · ')) && html`<div class="muted" style="font-size:13px">${s.reasons.join(' · ')}</div>`}
      <${Sparkline} pts=${d.history}/>
      <div class="row between faint" style="font-size:11.5px"><span>${d.history[0]?.t || ''}</span><span>Profit in ${s.profitableYears === 5 ? 'all 5' : s.profitableYears} of the last 5 years · mock</span></div>
    </div>
    <div class="row wrap" data-tour="actions" style="margin-top:14px;gap:8px">
      <button class="btn primary" style="flex:2" onClick=${() => openSheet({ type: 'addto', symbol: s.symbol, name: s.name })}>Add to basket</button>
      ${model && html`<button class="btn" style="flex:1" onClick=${() => openSheet({ type: 'trade', side: 'buy', symbol: s.symbol, basketId: model.id })}>Buy</button>`}
      ${held && model && html`<button class="btn" style="flex:1" onClick=${() => openSheet({ type: 'trade', side: 'sell', symbol: s.symbol, basketId: held.id, held: held.qty })}>Sell</button>`}
      <button class="btn ghost" style="flex:1" onClick=${() => openSheet({ type: 'flag', symbol: s.symbol, name: s.name })}>⚑ Flag</button>
    </div>
    ${d.inBaskets.length > 0 && html`<div class="row wrap" style="gap:6px;margin-top:12px"><span class="faint" style="font-size:12.5px">In</span>${d.inBaskets.map(x => html`<button key=${x.id} class="chip" onClick=${() => go('basket-' + x.id)}>${x.name}${x.qty ? ` · ${x.qty} sh` : ''}</button>`)}</div>`}
    ${openFlags.length > 0 && html`<section class="section"><h2>News flags <${Info} k="newsflag"/></h2><div class="card list" style="padding:2px 16px">${openFlags.map(f => html`<div class="li" key=${f.id}><span class="grow"><span class="t">⚑ ${f.metricLabel} likely ${f.impact}</span><span class="s">${f.note || 'No note'} · ${short(f.date)}</span></span>
      <button class="btn small ghost" onClick=${() => openSheet({ type: 'flag', symbol: s.symbol, name: s.name, flag: f })}>Edit</button>
      <button class="btn small ghost" onClick=${() => confirmDialog({ title: 'Withdraw this flag?', body: 'Any unconfirmed sell it drafted is cancelled.', confirm: 'Withdraw', danger: true, onConfirm: () => act('delete_news_flag', { flag_id: f.id }, { ok: 'Flag withdrawn' }) })}>Withdraw</button></div>`)}</div></section>`}
    <section class="section" data-tour="why"><div class="section-head"><h2>Why this status?</h2><span class="faint" style="font-size:12px">Good · bad · its number</span></div>
      <div class="card list" style="padding:2px 16px">${d.rules.map(r => html`<div class="li" key=${r.id}><span class="dot ${r.band}" aria-label=${r.band}></span><span class="grow"><span class="t">${r.label}${r.critical ? html` <span class="star" title="Must-pass rule">★</span>` : ''} <${Info} k=${r.id}/></span><span class="s num">good ${r.green} · bad ${r.red}${r.enabled ? '' : ' · rule off'}</span></span><b class="num">${r.valueText}</b></div>`)}</div></section>
    <${ThemeShares} d=${d}/>
    ${d.isCustom && html`<div class="row wrap" style="margin-top:14px;gap:8px"><button class="btn ghost" style="flex:1" onClick=${() => openSheet({ type: 'candidate', symbol: s.symbol })}>Edit stock</button>
      <button class="btn ghost danger" style="flex:1" onClick=${() => confirmDialog({ title: `Delete ${s.symbol}?`, body: 'It leaves your universe. It must not be in any basket.', confirm: 'Delete', danger: true, onConfirm: async () => { const r = await act('delete_candidate', { symbol: s.symbol }, { ok: 'Deleted' }); if (r?.ok) go('explore'); } })}>Delete stock</button></div>`}
    ${d.orders.length > 0 && html`<section class="section"><h2>Orders</h2><div class="card list" style="padding:2px 16px">${d.orders.map(o => html`<${OrderRow} key=${o.id} o=${o}/>`)}</div></section>`}
  </div>`;
}

function ThemeShares({ d }) {
  const S = store.S;
  const [vals, setVals] = useState({});
  const entries = S.themes.filter(t => d.themes[t.id] != null || d.theme === t.id);
  if (!entries.length) return null;
  return html`<section class="section"><div class="section-head"><h2>Theme share <${Info} k="theme"/></h2><span class="faint" style="font-size:12px">Under ${S.defaultLimits.minTheme}% = Remove in that theme</span></div>
    <div class="card list" style="padding:2px 16px">${entries.map(t => html`<div class="li" key=${t.id}><span class="grow"><span class="t">${t.label}</span><span class="s">% of its business · you can edit</span></span>
      <input class="input num" style="width:84px;padding:8px 10px" id=${'ts-' + t.id} type="number" min="0" max="100" value=${vals[t.id] ?? d.themes[t.id] ?? ''} onInput=${e => setVals({ ...vals, [t.id]: e.target.value })} aria-label="${t.label} share percent"/>
      <button class="btn small" disabled=${vals[t.id] == null} onClick=${async () => { const r = await act('set_theme_share', { symbol: d.stock.symbol, theme: t.id, share: vals[t.id] }, { ok: 'Saved' }); if (r?.ok) setVals({}); }}>Save</button></div>`)}</div></section>`;
}

// A draft's reason is only worth a line when it says more than the BUY / SELL tag already does.
export const orderWhy = (o, short) => { const r = (o.reason || '').trim(); return /^(buy|sell)$/i.test(r) ? '' : short ? r.replace(/^Based on news, not yet in results:\s*/, '') : r; };
export function OrderRow({ o }) {
  return html`<div class="li"><span class="side ${o.side}">${o.side.toUpperCase()}</span><span class="grow"><span class="t">${o.name}</span><span class="s">${o.qty} sh · ${o.status === 'filled' ? `filled ${inr2(o.fill.price)}` : o.status === 'cancelled' ? (o.cancelReason || 'Cancelled') : 'pending'} · ${short(o.createdAt)}</span></span><${Src} s=${o.source}/></div>`;
}

// ---------- Baskets ----------
export function Baskets() {
  const S = store.S;
  const models = S.baskets.filter(b => b.kind === 'model');
  const tracking = S.baskets.filter(b => b.kind === 'tracking');
  const total = S.cash + models.reduce((t, b) => t + b.value, 0);
  return html`<div>
    <div class="row between" style="margin-top:4px"><h1>Baskets</h1><button data-tour="newbasket" class="btn small primary" onClick=${() => newBasket()}>+ New</button></div>
    <section class="stack" style="gap:4px;margin-top:14px"><span class="eyebrow">Practice portfolio <${Info} k="practice"/></span><div class="big num">${inr(total)}</div>
      <div class="row wrap muted" style="font-size:13px"><span>Cash ${inr(S.cash)}</span><span>·</span><span>Nifty 50 <span class="num">${S.nifty.toLocaleString('en-IN')}</span> <${Chg} v=${S.niftyChange}/> <${Info} k="nifty"/></span><${Mock}/></div></section>
    ${S.needs.length > 0 && html`<section class="section"><h2>Needs attention</h2><div class="chips">${S.needs.map(n => html`<button key=${n.symbol} class="attn" onClick=${() => go('stock-' + n.symbol)}><${Avatar} name=${n.name} stage=${n.stage}/><span><b>${shortName(n.name)}</b><span>${n.flag ? `⚑ ${n.flag}` : n.pending ? 'Order pending' : STATUS[n.status][1]}</span></span></button>`)}</div></section>`}
    <section class="section"><h2>Practice baskets</h2>
      ${models.length ? models.map(b => html`<${BasketCard} key=${b.id} b=${b}/>`) : html`<${Empty} title="No baskets yet"><span class="muted">Pick stocks on Home or Explore.</span><button class="btn primary small" onClick=${() => newBasket()}>Create basket</button></${Empty}>`}</section>
    <section class="section"><div class="section-head"><h2>Tracking <${Info} k="tracking"/></h2><span class="faint" style="font-size:12.5px">Your real shares · alerts only</span></div>
      ${tracking.map(b => html`<${BasketCard} key=${b.id} b=${b}/>`)}
      <button class="newcard" onClick=${() => { if (S.plan === 'free' && tracking.length >= 1) { toast('Free plan: 1 tracking basket', { action: 'See plans', go: 'pricing' }); return; } openSheet({ type: 'tracking' }); }}><span class="plus">⇣</span><span>Track real holdings<br/><span class="faint" style="font-weight:600;font-size:12.5px">Paste SYMBOL, QTY, AVG · no orders</span></span></button></section>
  </div>`;
}

// ---------- Basket ----------
export function Basket({ id }) {
  const S = store.S;
  const b = S.baskets.find(x => x.id === id);
  const [tab, setTabState] = useState(basketTab[id] || 'overview');
  const setTab = t => { basketTab[id] = t; setTabState(t); };
  if (!b) return html`<${Empty} title="This basket is gone"><span class="muted">It may have been deleted.</span><button class="btn small" onClick=${() => go('baskets')}>All baskets</button></${Empty}>`;
  const tabs = ['overview', 'stocks', 'rules', 'scorecard'];
  return html`<div>
    <div class="row" style="margin-top:4px"><button class="iconbtn" onClick=${() => go('baskets')} aria-label="Back to baskets">${I.back}</button>
      <div style="min-width:0;flex:1"><h1 style="font-size:22px">${b.name}</h1><div class="row wrap" style="gap:6px;margin-top:3px"><${Src} s=${b.source}/>${b.editedBy && b.editedBy !== b.source && html`<${Src} s=${b.editedBy} edited/>`}${b.themeLabel && html`<span class="tag">${b.themeLabel}</span>`}${b.kind === 'tracking' && html`<span class="tag">Tracking</span>`}</div></div>
      <button class="iconbtn" aria-label="Basket options" onClick=${() => openSheet({ type: 'basketmenu', id: b.id })}>${I.more}</button></div>
    ${b.description && html`<p class="muted" style="margin:10px 0 0;font-size:13.5px">${b.description}</p>`}
    <section class="stack" style="margin-top:16px;gap:6px">
      <div class="big num">${b.isInvested ? inr(b.value) : `${b.count} stocks`}</div>
      <div class="row wrap" style="font-size:13.5px">${b.isInvested ? html`<span class="${cls(b.pnl)} num">${b.pnl >= 0 ? '+' : '−'}${inr(Math.abs(b.pnl))} (${pct(b.returnPct)})</span><span class="muted">vs Nifty 50 <b class=${cls(b.vsNifty)}>${b.vsNifty > 0 ? '+' : ''}${b.vsNifty.toFixed(1)} points</b> <${Info} k="vsnifty"/></span>` : html`<span class="muted">${b.realized ? `Not invested · last exit ${b.realized >= 0 ? 'profit' : 'loss'} ${inr(Math.abs(b.realized))}` : 'Not invested yet'}</span>`}<${Mock}/></div>
    </section>
    <div class="tabs" data-tour="tabs" role="tablist" style="margin-top:16px">${tabs.map(t => html`<button key=${t} role="tab" aria-selected=${tab === t} class=${tab === t ? 'on' : ''} onClick=${() => setTab(t)}>${t[0].toUpperCase() + t.slice(1)}</button>`)}</div>
    ${tab === 'stocks' ? html`<${BasketStocks} b=${b}/>` : tab === 'rules' ? html`<${BasketRules} b=${b}/>` : tab === 'scorecard' ? html`<${Scorecard} b=${b}/>` : html`<${BasketOverview} b=${b} setTab=${setTab}/>`}
  </div>`;
}

function BasketOverview({ b, setTab }) {
  const S = store.S;
  const sw = Object.entries(b.stageWeights).filter(([, w]) => w > 0).sort((x, y) => y[1] - x[1]);
  const pending = S.orders.filter(o => o.basketId === b.id && o.status === 'pending');
  const refill = pending.filter(o => o.tag === 'refill');
  let cta;
  if (b.kind === 'tracking') cta = html`<button class="btn block" onClick=${() => setTab('stocks')}>Edit holdings</button>`;
  else if (refill.length) cta = html`<button class="btn primary block" onClick=${() => openSheet({ type: 'review', ids: refill.map(o => o.id) })}>Review replacement</button>`;
  else if (pending.length) cta = html`<button class="btn primary block" onClick=${() => openSheet({ type: 'review', ids: pending.map(o => o.id) })}>Review ${pending.length} order${pending.length > 1 ? 's' : ''}</button>`;
  else if (b.isInvested && b.drift > b.limits.driftTrigger) cta = html`<button class="btn primary block" onClick=${() => openSheet({ type: 'rebalance', id: b.id })}>Rebalance</button>`;
  else cta = html`<button class="btn primary block" onClick=${() => openSheet({ type: 'invest', id: b.id })}>Invest ₹</button>`;
  const acts = S.decisions.filter(d => d.basketId === b.id).slice(0, 8);
  const journal = S.journal.filter(j => j.basketId === b.id);
  const label = { added: 'Added', removed: 'Taken out', bought: 'Bought', sold: 'Sold', override: 'Kept anyway', refill_add: 'Replacement added', exited: 'Exited basket (sold all)', status_pass: '→ ✓ Pass', status_watch: '→ ! Watch', status_remove: '→ ✕ Remove' };
  return html`<div class="stack" style="margin-top:16px">
    <div class="row wrap" style="gap:6px">${['pass', 'watch', 'remove'].filter(k => b.counts[k]).map(k => html`<${Pill} key=${k} s=${k} n=${b.counts[k]}/>`)}${b.belowMin && html`<span class="tag">Below ${b.limits.minStocks} stocks</span>`}</div>
    ${b.kind === 'model' && html`<div class="card stack" style="gap:12px">
      <div class="row between"><span class="eyebrow">Where the money is <${Info} k="segment"/></span><span class="faint" style="font-size:12px">${b.isInvested ? 'Now' : 'Planned'}</span></div>
      <div class="wbar" role="img" aria-label=${sw.map(([s, w]) => `${stageLabel(s)} ${w}%`).join(', ')}>${sw.map(([s, w]) => html`<span key=${s} style="width:${w}%;background:${stageColor(s)}" title="${stageLabel(s)} ${w}%"></span>`)}</div>
      <div class="legend">${sw.map(([s, w]) => html`<span key=${s}><i style="background:${stageColor(s)}"></i>${stageLabel(s)} <b class="num">${w.toFixed(0)}%</b></span>`)}</div>
      <div class="faint" style="font-size:12px">Limits: ${b.limits.maxStageWeight}% a segment · ${b.limits.maxStockWeight}% a stock · ${b.limits.maxWatchWeight}% a Watch stock <${Info} k="limits"/></div></div>`}
    <div class="tiles">
      <div class="tile"><span class="k">${b.kind === 'tracking' ? 'What you paid' : 'Money put in'} <${Info} k="invested"/></span><span class="v">${inr(b.invested)}</span></div>
      <div class="tile"><span class="k">${b.kind === 'tracking' ? 'Worth now' : 'Cash in basket'}</span><span class="v">${inr(b.kind === 'tracking' ? b.value : b.cash)}</span></div>
      <div class="tile"><span class="k">Stocks</span><span class="v">${b.count}<span class="muted" style="font-size:14px"> / ${b.limits.minStocks}–${b.limits.maxStocks}</span></span></div>
      <div class="tile"><span class="k">Off target <${Info} k="offtarget"/></span><span class="v">${b.isInvested && b.kind === 'model' ? b.drift.toFixed(1) + ' points' : '—'}</span></div></div>
    ${b.belowMin && !refill.length && html`<div class="card stack" style="gap:8px"><b>Needs ${b.limits.minStocks - b.count} more stock${b.limits.minStocks - b.count > 1 ? 's' : ''} <${Info} k="replacement"/></b><span class="muted" style="font-size:13px">No other stock passes this basket's rules and limits right now.</span>
      <div class="row wrap"><button class="btn small" onClick=${() => go('explore')}>Find stocks</button><button class="btn small ghost" onClick=${() => copy(`Find more ${b.themeLabel || ''} stocks for my "${b.name}" basket in FunInvestments and add them with add_candidate.`)}>Copy prompt for Claude</button></div></div>`}
    ${cta}
    ${b.kind === 'model' && b.isInvested && html`<div class="row" style="gap:8px"><button class="btn ghost" style="flex:1" onClick=${() => exitBasket(b)}>Exit basket · sell everything</button><${Info} k="exit"/></div>`}
    ${journal.length > 0 && html`<section class="section"><h2>Decision journal <${Info} k="keepanyway"/></h2><div class="card list" style="padding:2px 16px">${journal.map(j => html`<div class="li" key=${j.id}><span class="grow"><span class="t">${j.name} · ${j.action}</span><span class="s">${j.reason || 'No reason'} · ${short(j.date)}</span></span>
      <button class="btn small ghost" onClick=${() => openSheet({ type: 'journal', entry: j })}>Edit</button></div>`)}</div></section>`}
    <section class="section"><h2>Recent activity</h2>${acts.length ? html`<div class="card list" style="padding:2px 16px">${acts.map(d => html`<div class="li" key=${d.id}><span class="grow"><span class="t">${d.name} · ${label[d.action] || d.action}</span><span class="s">${d.trigger || ''} · ${short(d.date)}</span></span><${Src} s=${d.source}/></div>`)}</div>` : html`<span class="muted">Nothing yet.</span>`}</section>
  </div>`;
}

function BasketStocks({ b }) {
  const [edit, setEdit] = useState(false);
  const [all, setAll] = useState(false);
  const list = all || edit ? b.stocks : b.stocks.slice(0, 7);
  const remove = s => {
    if (b.kind === 'model' && s.qty > 0) {
      confirmDialog({ title: `Sell and remove ${shortName(s.name)}?`, body: `You hold ${s.qty} shares. A sell is drafted; the stock leaves the basket once you confirm it.`, confirm: 'Draft sell', onConfirm: async () => { const r = await act('remove_stock', { basket_id: b.id, symbol: s.symbol, sell: true }, { quiet: true }); if (r?.ok) { await import('./store.js').then(m => m.refresh()); openSheet({ type: 'review', ids: r.data.orders.map(o => o.id) }); } } });
    } else confirmDialog({ title: `Remove ${shortName(s.name)}?`, body: b.kind === 'tracking' ? 'Its holding row is deleted from this tracking basket.' : 'It leaves this basket. If that takes the basket below its minimum, the app suggests a replacement.', confirm: 'Remove', danger: true, onConfirm: () => act('remove_stock', { basket_id: b.id, symbol: s.symbol }, { ok: 'Removed' }) });
  };
  if (b.kind === 'tracking') {
    return html`<div class="stack" style="margin-top:16px">
      <div class="card list" style="padding:2px 16px">${b.stocks.map(s => html`<div class="li" key=${s.symbol}><${Avatar} name=${s.name} stage=${s.stage}/><span class="grow"><span class="t">${s.name}</span><span class="s num">${s.qty} sh · avg ${inr2(s.avg)} · now ${inr2(s.price)}</span></span><${Pill} s=${s.status}/>
        <button class="btn small ghost" onClick=${() => openSheet({ type: 'holding', id: b.id, symbol: s.symbol, qty: s.qty, avg: s.avg })}>Edit</button>
        <button class="iconlink" aria-label="Remove ${s.name}" onClick=${() => remove(s)}>${I.x}</button></div>`)}</div>
      <button class="btn block" onClick=${() => openSheet({ type: 'holding', id: b.id })}>+ Add holding</button></div>`;
  }
  return html`<div style="margin-top:16px">
    <div class="row between"><span class="muted" style="font-size:13px">${b.count} of ${b.limits.maxStocks} max</span><div class="row" style="gap:8px"><button class="btn small ${edit ? 'primary' : 'ghost'}" onClick=${() => setEdit(!edit)}>${edit ? 'Done' : 'Edit'}</button><button class="btn small ghost" onClick=${() => openSheet({ type: 'addstocks', id: b.id })}>+ Add</button></div></div>
    <div class="grid2" style="margin-top:12px">
      ${list.map(s => html`<div class="cardwrap" key=${s.symbol}><${StockCard} s=${s} b=${b}/>${edit && html`<button class="removex" aria-label="Remove ${s.name}" onClick=${() => remove(s)}>${I.x}</button>`}</div>`)}
      ${!edit && !all && b.stocks.length > 7 && html`<button class="scard more" onClick=${() => setAll(true)}>See ${b.stocks.length - 7} more</button>`}
    </div></div>`;
}

function BasketRules({ b }) {
  const S = store.S;
  const pro = S.plan === 'pro';
  const L = b.limits;
  const [lim, setLim] = useState(null);
  const cur = lim || L;
  const steps = [['minStocks', 'min_stocks', 'Fewest stocks', 1, 1, 12, ''], ['maxStocks', 'max_stocks', 'Most stocks', 1, 1, 12, ''], ['maxStockWeight', 'max_stock_weight', 'Max in one stock', 5, 5, 100, '%'], ['maxStageWeight', 'max_stage_weight', 'Max in one segment', 5, 5, 100, '%'], ['maxWatchWeight', 'max_watch_weight', 'Max in a Watch stock', 5, 5, 100, '%'], ['driftTrigger', 'drift_trigger', 'Rebalance when off by', 1, 1, 30, ' pts'], ['minTheme', 'min_theme', 'Min theme share', 5, 0, 100, '%']];
  const dirty = lim && Object.keys(L).some(k => lim[k] !== L[k]);
  return html`<div class="stack" style="margin-top:14px">
    <div class="row between"><span class="eyebrow">13 safety rules · this basket only <${Info} k="warnings"/></span>${pro ? html`<button class="linkbtn" onClick=${() => confirmDialog({ title: 'Reset rules to default?', body: 'Thresholds, switches and limits go back to the defaults for this basket.', confirm: 'Reset', onConfirm: () => act('reset_rules', { basket_id: b.id }, { ok: 'Rules reset' }) })}>Reset</button>` : html`<button class="linkbtn" onClick=${() => go('pricing')}>Edit with Pro</button>`}</div>
    <div class="card list" style="padding:2px 16px">${b.rules.metrics.map(r => {
      const red = b.stocks.filter(s => s.reds.includes(r.id)).length, amber = b.stocks.filter(s => s.ambers.includes(r.id)).length;
      const dot = !r.enabled ? 'off' : red ? 'red' : amber ? 'amber' : 'green';
      const thr = r.id === 'loss' ? `${r.green} · > ${r.red}` : `${r.dir === 'higher' ? '≥' : '≤'} ${r.green} · ${r.dir === 'higher' ? '<' : '>'} ${r.red}`;
      return html`<div class="li" key=${r.id}>
        <button class="grow row ruleopen" onClick=${() => openSheet({ type: 'rule', id: b.id, rule: r.id })}>
          <span class="dot ${dot}" aria-label=${dot}></span>
          <span class="grow" style="min-width:0"><span class="t">${r.label}${r.critical ? html` <span class="star" title="Must-pass rule">★</span>` : ''}</span>
          <span class="s"><span class="num">good ${thr.replace(' · ', ' · bad ')}${r.unit === '%' ? '%' : r.unit === '×' ? '×' : ''}</span>${red || amber ? ` · ${[red && `${red} red`, amber && `${amber} amber`].filter(Boolean).join(', ')}` : ''}${r.source === 'claude' ? ' · By Claude' : r.source === 'you' ? ' · By you' : ''}</span></span></button>
        <${Info} k=${r.id}/>
        <${Switch} id=${`rt-${b.id}-${r.id}`} checked=${r.enabled} label="${r.label} on" onChange=${v => act('toggle_rule', { basket_id: b.id, rule_id: r.id, enabled: v }, { ok: v ? `${r.label} on` : `${r.label} off` })}/></div>`;
    })}</div>
    <div class="faint" style="font-size:12px">★ Must-pass: one red means Remove <${Info} k="mustpass"/></div>
    ${b.kind === 'model' && html`<div class="row between" style="margin-top:8px"><span class="eyebrow">Basket limits <${Info} k="limits"/></span>${pro ? null : html`<span class="lock">Pro</span>`}</div>
      <div class="card list" style="padding:2px 16px">${steps.map(([k, , label, step, min, max, unit]) => html`<div class="li" key=${k}><span class="grow t">${label}${k === 'minTheme' && b.themeLabel ? html` <span class="faint" style="font-weight:600">(${b.themeLabel})</span>` : ''}</span>
        <${Stepper} label=${label} value=${cur[k]} min=${min} max=${max} step=${step} unit=${unit} onChange=${v => { if (!pro) { toast('Pro feature: basket limits', { action: 'See plans', go: 'pricing' }); return; } setLim({ ...cur, [k]: v }); }}/></div>`)}</div>
      ${dirty && html`<div class="row" style="gap:8px"><button class="btn primary" style="flex:1" onClick=${async () => { const args = { basket_id: b.id }; for (const [k, a] of steps) args[a] = lim[k]; const r = await act('set_basket_rule', args, { ok: 'Limits saved' }); if (r?.ok) setLim(null); }}>Save limits</button><button class="btn ghost" onClick=${() => setLim(null)}>Undo</button></div>`}`}
    <div class="row between" style="margin-top:8px"><span class="eyebrow">Company events</span>${pro ? null : html`<span class="lock">Pro</span>`}</div>
    <div class="card list" style="padding:2px 16px">${b.rules.events.map(e => html`<div class="li" key=${e.id}><span class="grow"><span class="t">${e.label}${e.critical ? html` <span class="star">★</span>` : ''}</span></span><${Info} k=${e.id}/>
      <${Switch} id=${`ev-${b.id}-${e.id}`} checked=${e.enabled} label="${e.label} on" onChange=${v => act('toggle_rule', { basket_id: b.id, rule_id: e.id, enabled: v }, { ok: v ? 'On' : 'Off' })}/></div>`)}</div>
  </div>`;
}

// ---------- Scorecard (per basket) ----------
function Scorecard({ b }) {
  const [sc, setSc] = useState(null);
  const [view, setView] = useState('year');
  const [limit, setLimit] = useState(40);
  useEffect(() => { read('get_rule_scorecard', { basket_id: b.id, view: view === 'log' ? 'log' : 'summary' }).then(r => r.ok && setSc(r.data)); }, [b.id, view, store.rev]);
  const seg = html`<div class="seg">${[['year', 'By year'], ['rule', 'By rule'], ['log', 'Every decision']].map(([v, l]) => html`<button key=${v} class=${view === v ? 'on' : ''} onClick=${() => setView(v)}>${l}</button>`)}</div>`;
  const head = html`<div class="stack" style="margin-top:14px;gap:10px"><p class="muted" style="margin:0;font-size:13.5px">Past test: how this basket's rules did every June, 2018–2025. <${Info} k="backtest"/> <${Mock}/></p>${seg}</div>`;
  if (!sc) return html`${head}<div class="tiles" style="margin-top:14px"><div class="sk" style="height:84px"></div><div class="sk" style="height:84px"></div></div>`;
  if (sc.empty) return html`${head}<${Empty} title="No history for these stocks"><span class="muted">Past tests cover the AC and Energy stocks.</span></${Empty}>`;
  if (sc.locked) {
    const y = sc.years[0];
    return html`${head}<div class="tiles" style="margin-top:14px">
      <div class="tile"><span class="k">Good exit calls · ${y.year} <${Info} k="goodexits"/></span><span class="v">${y.removedRight} of ${y.removed}</span><span class="faint" style="font-size:12px">dropped stocks that then lagged the Nifty 50</span></div>
      <div class="tile"><span class="k">Kept stocks that beat the market · ${y.year}</span><span class="v">${y.keptBeat} of ${y.kept}</span></div></div>
      <div class="locked" style="margin-top:14px"><div class="blur"><${YearChart} years=${[2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((yr, i) => ({ year: yr, keptAvg: 20 + i * 4, removedAvg: 30 - i * 3, nifty: 10 }))}/></div>
      <div class="over"><div class="card stack" style="gap:10px"><b>${sc.teaser.years} years · ${sc.teaser.rules} rules · ${sc.teaser.decisions} decisions</b><span class="muted" style="font-size:13px">See how these rules did every year since 2018.</span><button class="btn primary" onClick=${() => { api.call('track_event', { name: 'upgrade_clicked', props: { feature: 'scorecard depth' } }); go('pricing'); }}>Unlock 2018–2025</button></div></div></div>`;
  }
  const s = sc.summary;
  return html`${head}
    <div class="tiles" style="margin-top:14px">
      <div class="tile"><span class="k">Good exit calls <${Info} k="goodexits"/></span><span class="v">${s.removalsRight}<span class="muted" style="font-size:15px"> of ${s.removalsTotal}</span></span><span class="faint" style="font-size:12px">dropped stocks that then lagged the Nifty 50</span></div>
      <div class="tile"><span class="k">Kept stocks beat the market <${Info} k="keptbeat"/></span><span class="v">${s.keptBeatYears}<span class="muted" style="font-size:15px"> of ${s.yearsCount} years</span></span></div>
      <div class="tile"><span class="k">Biggest loss avoided <${Info} k="lossavoided"/></span><span class="v down">${pct(s.worstAvoided?.ret, 0)}</span><span class="faint" style="font-size:12px">${shortName(s.worstAvoided?.name || '')} · from June ${s.worstAvoided?.year || ''}</span></div>
      <div class="tile"><span class="k">₹100 from 2018 grew to <${Info} k="grew"/></span><span class="v">₹${s.growth.kept}</span><span class="faint" style="font-size:12px">kept stocks · Nifty 50: ₹${s.growth.nifty}</span></div></div>
    ${view === 'year' && html`<div class="card" style="margin-top:14px"><div class="row between wrap" style="gap:8px"><b>Average return in the 12 months after each June</b><div class="legend"><span><i style="background:var(--c-kept)"></i>Kept stocks</span><span><i style="background:var(--c-removed)"></i>Dropped stocks</span><span><i style="background:var(--c-nifty)"></i>Nifty 50</span></div></div><${YearChart} years=${sc.years}/></div>
      <div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>June</th><th>Pass</th><th>Watch</th><th>Dropped</th><th>Kept stocks' return</th><th>Dropped stocks' return</th><th>Nifty 50</th><th>Good exit calls</th><th>Did the rules help?</th></tr></thead><tbody>
      ${sc.years.map(y => html`<tr key=${y.year}><td>${y.year}</td><td>${y.pass}</td><td>${y.watch}</td><td>${y.removed}</td><td class=${cls(y.keptAvg)}>${pct(y.keptAvg, 0)}</td><td class=${cls(y.removedAvg)}>${pct(y.removedAvg, 0)}</td><td>${pct(y.nifty, 0)}</td><td>${y.removedRight} of ${y.removed}</td><td>${y.better === 'kept' ? html`<span class="ok">Yes ✓</span>` : html`<span class="no">No ✕</span>`}</td></tr>`)}</tbody></table></div>`}
    ${view === 'rule' && html`<div class="tablewrap" style="margin-top:14px"><table><thead><tr><th>Rule</th><th>Stocks dropped</th><th>Right %</th><th>Worst</th><th>Typical</th><th>Best</th><th>Biggest loss avoided</th></tr></thead><tbody>
      ${sc.byRule.map(r => html`<tr key=${r.id}><td>${r.label}${r.critical ? ' ★' : ''}</td><td>${r.removed}</td><td>${r.hitRate == null ? '—' : r.hitRate + '%'}</td><td class=${cls(r.worst)}>${pct(r.worst, 0)}</td><td class=${cls(r.median)}>${pct(r.median, 0)}</td><td class=${cls(r.best)}>${pct(r.best, 0)}</td><td>${r.worstAvoided ? `${shortName(r.worstAvoided.name)} ${r.worstAvoided.year}` : '—'}</td></tr>`)}</tbody></table></div>
      <p class="faint" style="font-size:12px;margin:8px 0 0">Right % = stocks this rule dropped that then did worse than the Nifty 50 over the next 12 months <${Info} k="rightpct"/>. Typical = the middle result <${Info} k="typical"/>.</p>`}
    ${view === 'log' && html`<div class="card list" style="margin-top:14px;padding:2px 16px">${(sc.log || []).slice(0, limit).map((l, i) => html`<div class="li" key=${i}><span class="mono faint">${l.year}</span><span class="grow"><span class="t">${l.name} · ${l.action === 'keep' ? 'Kept' : 'Dropped'}</span><span class="s">${l.trigger}</span></span><span class="num ${cls(l.next12)}">${pct(l.next12, 0)}</span><span class=${l.correct ? 'ok' : 'no'} aria-label=${l.correct ? 'Right' : 'Wrong'}>${l.correct ? '✓' : '✕'}</span></div>`)}</div>
      ${(sc.log || []).length > limit && html`<button class="btn block" style="margin-top:10px" onClick=${() => setLimit(limit + 40)}>See more</button>`}`}
    ${sc.overrides?.count > 0 && html`<div class="card row between" style="margin-top:14px"><span>Times you kept a stock anyway: ${sc.overrides.helped} helped · ${sc.overrides.hurt} hurt</span><span class="faint" style="font-size:12px">compared with its price now</span></div>`}
    <button class="btn block" style="margin-top:16px" onClick=${async () => { const r = await read('share_card', { basket_id: b.id }); if (!r.ok) { (await import('./store.js')).showError(r.error); return; } openSheet({ type: 'share', data: r.data }); }}>Share rule stats</button>`;
}

export function YearChart({ years }) {
  const ref = useRef();
  const [tip, setTip] = useState(null);
  const W = 620, H = 250, L = 44, R = 8, T = 12, B = 28;
  const vals = years.flatMap(y => [y.keptAvg ?? 0, y.removedAvg ?? 0, y.nifty]);
  const span = Math.max(...vals) - Math.min(0, ...vals);
  const step = span > 400 ? 200 : span > 200 ? 100 : span > 80 ? 50 : 20;
  const lo = Math.floor(Math.min(0, ...vals) / step) * step, hi = Math.ceil(Math.max(...vals) / step) * step;
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const gw = (W - L - R) / years.length, bw = Math.min(16, gw * 0.24);
  const ticks = []; for (let v = lo; v <= hi; v += step) ticks.push(v);
  const bar = (x, v, c, k) => { const y0 = y(0), y1 = y(v ?? 0); return html`<rect key=${k} x=${x} y=${Math.min(y0, y1)} width=${bw} height=${Math.max(1, Math.abs(y1 - y0))} rx="3" fill=${c}/>`; };
  return html`<div class="chartwrap" ref=${ref} onMouseLeave=${() => setTip(null)}>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average next-12-month return per June: kept, removed, Nifty TRI">
      ${ticks.map(v => html`<g key=${v}><line class=${v === 0 ? 'zero' : 'grid'} x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)}/><text x=${L - 6} y=${y(v) + 4} text-anchor="end">${v}%</text></g>`)}
      ${years.map((d, i) => { const gx = L + i * gw, cx = gx + gw / 2, x0 = cx - bw * 1.5 - 2; return html`<g key=${d.year}>${bar(x0, d.keptAvg, 'var(--c-kept)', 'k')}${bar(x0 + bw + 2, d.removedAvg, 'var(--c-removed)', 'r')}${bar(x0 + 2 * bw + 4, d.nifty, 'var(--c-nifty)', 'n')}
        <text x=${cx} y=${H - 8} text-anchor="middle">${d.year}</text>
        <rect x=${gx} y=${T} width=${gw} height=${H - T - B} fill="transparent" onMouseEnter=${() => setTip({ d, x: (cx / W) * 100 })} onClick=${() => setTip({ d, x: (cx / W) * 100 })}/></g>`; })}
    </svg>
    ${tip && html`<div class="tip" style="left:clamp(0px, calc(${tip.x}% - 100px), calc(100% - 210px));top:4px"><b>June ${tip.d.year}</b><br/>Kept ${pct(tip.d.keptAvg, 0)} · Dropped ${pct(tip.d.removedAvg, 0)} · Nifty 50 ${pct(tip.d.nifty, 0)}</div>`}</div>`;
}

// ---------- Orders ----------
export function Orders() {
  const S = store.S;
  const [f, setF] = useState('all');
  const pending = S.orders.filter(o => o.status === 'pending');
  const done = S.orders.filter(o => o.status !== 'pending').filter(o => f === 'all' || o.status === f);
  const bname = id => S.baskets.find(b => b.id === id)?.name || 'Deleted basket';
  return html`<div>
    <div class="row between" style="margin-top:4px"><h1>Orders</h1><span class="tag">Practice money <${Info} k="practice"/></span></div>
    <section class="section"><div class="section-head"><h2>Pending ${pending.length ? html`<span class="faint">${pending.length}</span>` : ''}</h2>${pending.length > 1 && html`<button class="linkbtn" onClick=${() => openSheet({ type: 'review', ids: pending.map(o => o.id) })}>Review all</button>`}</div>
      ${pending.length ? pending.map(o => html`<button key=${o.id} class="ocard" onClick=${() => openSheet({ type: 'review', ids: o.group && o.tag === 'invest' ? pending.filter(x => x.group === o.group).map(x => x.id) : [o.id] })}>
        <span class="side ${o.side}">${o.side.toUpperCase()}</span>
        <span style="flex:1;min-width:0"><span style="font-weight:800;display:block">${o.name}</span><span class="muted" style="font-size:12.5px">${o.qty} sh · ~${inr(o.estValue)} · ${bname(o.basketId)}</span>${orderWhy(o) && html`<span class="faint" style="font-size:12px;display:block">${orderWhy(o)}</span>`}</span><${Src} s=${o.source}/></button>`)
      : html`<${Empty} title="No pending orders"><span class="muted">Drafts from you, the rules or Claude wait here for your OK.</span></${Empty}>`}</section>
    ${S.orders.some(o => o.status !== 'pending') && html`<section class="section"><div class="section-head"><h2>History</h2><div class="seg small">${[['all', 'All'], ['filled', 'Filled'], ['cancelled', 'Cancelled']].map(([v, l]) => html`<button key=${v} class=${f === v ? 'on' : ''} onClick=${() => setF(v)}>${l}</button>`)}</div></div>
      ${done.length ? html`<div class="card list" style="padding:2px 16px">${done.slice(0, 60).map(o => html`<${OrderRow} key=${o.id} o=${o}/>`)}</div>` : html`<span class="muted">None.</span>`}</section>`}
  </div>`;
}

// ---------- Alerts ----------
export function Alerts() {
  const S = store.S;
  const [f, setF] = useState('all');
  const [open, setOpen] = useState({});
  useEffect(() => { const t = setTimeout(() => { if (store.S.unread) read('mark_alerts_read', {}).then(() => import('./store.js').then(m => m.refresh())); }, 1500); return () => clearTimeout(t); }, []);
  const list = S.alerts.filter(a => f === 'all' || (f === 'critical' ? a.critical : f === 'news' ? ['news', 'flag_confirmed', 'flag_cleared', 'filing'].includes(a.type) : ['refill', 'drift'].includes(a.type)));
  const icon = a => (a.critical ? ['crit', '✕'] : ['news', 'flag_confirmed', 'flag_cleared', 'filing'].includes(a.type) ? ['news', '⚑'] : a.type === 'refill' ? ['refill', '↻'] : a.type === 'drift' ? ['', '⇄'] : a.type === 'strike' ? ['', '1'] : ['', '•']);
  const bname = id => S.baskets.find(b => b.id === id)?.name;
  return html`<div>
    <div class="row between" style="margin-top:4px"><h1>Alerts</h1>${S.alerts.length > 0 && html`<button class="linkbtn" onClick=${() => confirmDialog({ title: 'Clear all alerts?', body: 'This removes every alert. Orders and baskets are not affected.', confirm: 'Clear all', danger: true, onConfirm: () => act('clear_alerts', {}, { ok: 'Cleared' }) })}>Clear all</button>`}</div>
    <div class="chips" style="margin-top:14px">${[['all', 'All'], ['critical', 'Urgent'], ['news', 'News'], ['refill', 'Replacements']].map(([v, l]) => html`<button key=${v} class="chip ${f === v ? 'on' : ''}" onClick=${() => setF(v)}>${l}</button>`)}</div>
    ${list.length ? html`<div style="margin-top:6px">${list.map(a => {
      const [ic, sym] = icon(a);
      const orders = a.action?.kind === 'orders' ? a.action.ids.filter(id => S.orders.find(o => o.id === id)?.status === 'pending') : [];
      return html`<div key=${a.id} class="alert ${a.read ? '' : 'unread'}"><span class="ic ${ic}" aria-hidden="true">${sym}</span>
        <div style="flex:1;min-width:0"><div class="t" style="font-weight:700">${a.text}</div>
          <div class="row wrap" style="gap:10px;font-size:12px;margin-top:2px"><span class="faint">${short(a.date)}${bname(a.basketId) ? ' · ' + bname(a.basketId) : ''}</span>${a.why?.length > 0 && html`<button class="linkbtn" style="font-size:12.5px" aria-expanded=${!!open[a.id]} onClick=${() => setOpen({ ...open, [a.id]: !open[a.id] })}>${open[a.id] ? 'Hide' : 'Why?'}</button>`}</div>
          ${open[a.id] && html`<div class="why">${a.why.map((w, i) => html`<span key=${i}>${w}</span>`)}</div>`}</div>
        <div class="row" style="gap:6px;align-items:flex-start">
          ${orders.length > 0 && html`<button class="btn small" onClick=${() => openSheet({ type: 'review', ids: orders })}>Review</button>`}
          ${a.action?.kind === 'rebalance' && S.baskets.some(b => b.id === a.action.basketId) && html`<button class="btn small" onClick=${() => openSheet({ type: 'rebalance', id: a.action.basketId })}>Rebalance</button>`}
          ${a.action?.kind === 'claude' && html`<button class="btn small" onClick=${() => copy(a.action.prompt)}>Copy prompt</button>`}
          <button class="iconlink" aria-label="Dismiss alert" onClick=${() => act('dismiss_alert', { alert_id: a.id })}>${I.x}</button></div></div>`;
    })}</div>`
    : html`<${Empty} title="All quiet"><span class="muted">Alerts appear when a stock's status changes, new results come out, or a basket needs a replacement stock.</span></${Empty}>`}
  </div>`;
}

// ---------- Pricing ----------
export function Pricing() {
  const S = store.S;
  const [billing, setBilling] = useState('yearly');
  const y = billing === 'yearly', pro = S.plan === 'pro';
  return html`<div>
    <div class="row" style="margin-top:4px"><button class="iconbtn" onClick=${() => history.back()} aria-label="Back">${I.back}</button><h1>Plans</h1></div>
    <div class="row between wrap" style="margin-top:16px;gap:10px"><div class="seg">${[['monthly', 'Monthly'], ['yearly', 'Yearly']].map(([v, l]) => html`<button key=${v} class=${billing === v ? 'on' : ''} onClick=${() => setBilling(v)}>${l}</button>`)}</div>${y && html`<span class="tag claude">Save ₹389</span>`}</div>
    <div class="plans" style="margin-top:14px">
      <div class="plan"><div><b>Free</b><div class="big" style="font-size:28px">₹0</div></div>
        <ul><li>1 basket · 8 stocks</li><li>1 tracking basket</li><li>13 safety rules per basket</li><li>Weekly checks</li><li class="safety">Urgent alerts instantly</li><li>₹1,00,000 practice money</li><li>3 news flags a month</li><li>Past test: latest year</li><li>Connect Claude</li></ul>
        ${pro ? html`<button class="btn ghost block" onClick=${() => act('set_plan', { plan: 'free' }, { ok: 'Back on Free' })}>Switch to Free</button>` : html`<button class="btn ghost block" disabled>Current plan</button>`}</div>
      <div class="plan pro"><div class="row between"><b>Pro</b><span class="tag claude">Popular</span></div>
        <div><span class="big" style="font-size:28px">${y ? '₹1,999' : '₹199'}</span><span class="muted"> / ${y ? 'year' : 'month'}</span></div>
        <ul><li>Unlimited baskets · 12 stocks</li><li>Change any rule's limits</li><li>Company events + basket limits</li><li>Daily checks</li><li>Unlimited news flags</li><li>Full past test 2018–2025</li><li>Preview a rule change first</li><li>See if your overrides helped</li><li>Phone + email alerts</li><li>Share your rule results</li></ul>
        ${pro ? html`<button class="btn block" disabled>You're on Pro</button>` : html`<button class="btn primary block" onClick=${async () => { const r = await act('set_plan', { plan: 'pro', billing }, { ok: 'Pro is on · mock checkout' }); if (r?.ok) history.back(); }}>Start Pro</button>`}</div>
    </div>
    <p class="faint" style="font-size:12px;text-align:center;margin-top:12px">Prototype · mock checkout · no payment taken</p></div>`;
}

// ---------- Account ----------
export function Account() {
  const S = store.S;
  const [name, setName] = useState(S.user.name);
  const server = api.getMode() === 'server';
  const pro = S.plan === 'pro';
  return html`<div>
    <div class="row" style="margin-top:4px"><button class="iconbtn" onClick=${() => history.back()} aria-label="Back">${I.back}</button><h1>Settings</h1></div>
    <section class="section"><div class="card stack" style="gap:12px">
      <div class="field"><label for="pf-name">Name</label><div class="row"><input class="input" id="pf-name" value=${name} onInput=${e => setName(e.target.value)}/><button class="btn small" disabled=${name.trim() === S.user.name || !name.trim()} onClick=${() => act('set_profile', { name }, { ok: 'Saved' })}>Save</button></div></div>
      <div class="row between"><span>Plan · <b>${pro ? 'Pro' : 'Free'}</b></span><button class="linkbtn" onClick=${() => go('pricing')}>See plans</button></div></div></section>
    <${ConnectClaude}/>
    <section class="section"><h2>Notifications</h2><div class="card list" style="padding:2px 16px">
      <div class="li"><span class="grow"><span class="t">Urgent alerts</span><span class="s">Always on, every plan</span></span><${Switch} id="nt-crit" checked=${true} disabled=${true} label="Critical alerts" onChange=${() => {}}/></div>
      <div class="li"><span class="grow"><span class="t">Push</span><span class="s">${pro ? 'Status changes and drafts' : html`<span class="lock">Pro</span>`}</span></span><${Switch} id="nt-push" checked=${S.notif.push} label="Push" onChange=${v => act('set_notif', { push: v })}/></div>
      <div class="li"><span class="grow"><span class="t">Email</span><span class="s">${pro ? 'Weekly digest' : html`<span class="lock">Pro</span>`}</span></span><${Switch} id="nt-email" checked=${S.notif.email} label="Email" onChange=${v => act('set_notif', { email: v })}/></div></div></section>
    <section class="section"><h2>Demo</h2><div class="card stack" style="gap:10px">
      <dl class="kv"><dt>Demo date <${Info} k="democlock"/></dt><dd>${dateLabel(S.clock)}</dd><dt>Next results</dt><dd>${S.nextFiling ? `${S.nextFiling.symbol} · ${short(S.nextFiling.date)}` : '—'}</dd><dt>Prices</dt><dd>Mock data</dd><dt>Saved</dt><dd>${server ? 'Online' : 'In this browser'}</dd></dl>
      <button class="btn small ghost danger" style="align-self:flex-start" onClick=${() => confirmDialog({ title: 'Start the demo over?', body: 'This erases every basket, order, alert, news flag and the activity log, and puts back ₹1,00,000 of practice money. It can\'t be undone.', confirm: 'Reset demo', danger: true, onConfirm: async () => { const r = await act('reset', {}, { ok: 'Demo reset · fresh start' }); if (r?.ok) go('home'); } })}>Reset demo</button></div></section>
  </div>`;
}

// ---------- Plan switch (demo) ----------
export function PlanSwitch({ big, home, rail }) {
  const S = store.S;
  const set = p => { if (p !== S.plan) act('set_plan', { plan: p }, { ok: p === 'pro' ? 'Pro is on · demo, no payment' : 'Back on Free' }); };
  return html`<div class="plan-switch ${big ? 'big' : ''} ${home ? 'home' : ''} ${rail ? 'in-rail' : ''}" data-tour="plan">
    <span class="muted" style="font-size:12.5px">Plan <span class="faint">(demo)</span></span>
    <div class="seg small" role="radiogroup" aria-label="Plan">${[['free', 'Free'], ['pro', 'Pro']].map(([v, l]) => html`<button key=${v} role="radio" aria-checked=${S.plan === v} class=${S.plan === v ? 'on' : ''} onClick=${() => set(v)}>${l}</button>`)}</div>
    <button class="linkbtn" style="font-size:12.5px" onClick=${() => go('about')}>Compare</button></div>`;
}

// ---------- About ----------
// The cards and their expandable examples live in stories.js.
const PLAN_ROWS = [
  ['Baskets', '1', 'Unlimited'], ['Stocks per basket', '8', '12'], ['Tracking baskets (real shares)', '1', 'Unlimited'],
  ['13 safety rules', true, true], ['Change any rule\'s limits', false, true], ['Company events (auditor quits, rating cuts…)', false, true],
  ['Rule checks', 'Weekly', 'Daily'], ['Urgent alerts the moment a must-pass rule breaks', true, true], ['News flags', '3 a month', 'Unlimited'],
  ['Past test', 'Latest year', '2018–2025'], ['Preview a rule change first', false, true], ['See if your overrides helped', false, true],
  ['Phone and email alerts', false, true], ['Share your rule results', false, true], ['Connect Claude', true, true], ['Practice money', '₹1,00,000', '₹1,00,000'],
];
const PLAN_SHORT = ['Baskets', 'Stocks per basket', 'Rule checks', 'News flags', 'Past test', 'Change any rule\'s limits'];
const cell = v => (v === true ? html`<span class="ok" aria-label="Included">✓</span>` : v === false ? html`<span class="faint" aria-label="Not included">—</span>` : v);
const toConnect = () => { go('account'); setTimeout(() => document.getElementById('connect-claude')?.scrollIntoView({ behavior: 'smooth' }), 150); };

function ClaudeRow() {
  const S = store.S;
  return S.claudeConnected
    ? html`<div class="li"><span class="grow"><span class="t withic">${I.spark} Claude connected</span><span class="s">${S.lastClaudeCall?.time ? `Last active ${ago(S.lastClaudeCall.time)}` : 'Ready when you are'}</span></span><button class="linkbtn" onClick=${() => go('activity')}>Activity</button></div>`
    : html`<div class="li"><span class="grow"><span class="t withic">${I.spark} Claude not connected <${Info} k="claude"/></span><span class="s">Optional. It researches, you confirm.</span></span><button class="btn small" onClick=${toConnect}>Connect</button></div>`;
}

export function About() {
  const S = store.S, P = S.planInfo, pro = S.plan === 'pro';
  const [all, setAll] = useState(false);
  const first = S.baskets.length === 0, seen = tourSeen();
  const models = S.baskets.filter(b => b.kind === 'model').length, tracking = S.baskets.length - models;
  const t = S.todo?.[0];
  const openFlags = S.flags.filter(f => f.status === 'open').length;
  const flagsLeft = Math.max(0, P.flagsPerMonth - (S.flagsThisMonth || 0));
  // What applies to this user right now, shown as a small tag on the card.
  const tags = first ? {} : {
    build: !pro && `${models} of ${P.maxBaskets} used`, track: !pro && `${tracking} of ${P.maxTracking} used`,
    watch: pro ? 'Daily' : 'Weekly', results: S.nextFiling && `Next ${short(S.nextFiling.date)}`,
    confirm: S.pending > 0 && `${S.pending} waiting`, flag: openFlags ? `${openFlags} open` : !pro && `${flagsLeft} left`,
    past: pro ? '2018–2025' : 'Latest year',
  };
  const hot = { confirm: S.pending > 0, flag: openFlags > 0 };
  const rank = id => (first ? 0 : hot[id] ? 0 : ['watch', 'results', 'confirm', 'flag'].includes(id) ? 1 : 2);
  const stories = STORIES.map((s, i) => [s, i]).sort((a, b) => rank(a[0].id) - rank(b[0].id) || a[1] - b[1]).map(x => x[0]);
  const rows = all ? PLAN_ROWS : PLAN_ROWS.filter(r => PLAN_SHORT.includes(r[0]));
  return html`<div>
    <div class="row between" style="margin-top:4px"><h1>About</h1>${!first && html`<button class="btn small ghost" onClick=${startTour}>Take tour</button>`}</div>
    ${first ? html`<p class="muted" style="margin:8px 0 0;line-height:1.5">Stick to your own investing rules. The app watches; you decide.</p>
      <section class="card nextstep" aria-label="Start here"><span class="eyebrow">Start here</span>
        <div class="row between" style="gap:12px"><div style="min-width:0"><b>${seen ? 'Create your first basket' : 'New here? Take the tour'}</b><div class="muted" style="font-size:13px">${seen ? 'Pick stocks yourself or ask Claude.' : 'A quick walk around the app.'}</div></div>
          <button class="btn small primary" onClick=${seen ? () => newBasket() : startTour}>${seen ? 'Create basket' : 'Start tour'}</button></div>
        <button class="linkbtn" style="align-self:flex-start;font-size:12.5px;padding:0" onClick=${seen ? startTour : () => newBasket()}>${seen ? 'Take the tour again' : 'Skip, create a basket'}</button></section>`
    : html`<section class="section"><div class="section-head"><h2>Where you are</h2>${S.todo.length > 1 && html`<button class="linkbtn" onClick=${() => go('activity')}>+${S.todo.length - 1} more</button>`}</div>
      <div class="card list" style="padding:2px 16px">
        <div class="li"><span class="grow"><span class="t">${t ? t.text : 'All caught up'}</span><span class="s">${t ? t.detail : 'Your rules are watching.'}</span></span>${t && html`<button class="btn small primary" onClick=${() => doTodo(t)}>${TODO_BTN[t.kind] || 'Open'}</button>`}</div>
        <div class="li"><span class="grow"><span class="t">${pro ? 'Pro' : 'Free'} plan</span><span class="s">${pro ? `${models} basket${models === 1 ? '' : 's'} · daily checks · unlimited flags` : `${models} of ${P.maxBaskets} basket · weekly checks · ${flagsLeft} flag${flagsLeft === 1 ? '' : 's'} left`}</span></span><button class="linkbtn" onClick=${() => go('pricing')}>${pro ? 'Plans' : 'See Pro'}</button></div>
        <${ClaudeRow}/></div></section>`}
    <section class="section"><div class="section-head"><h2>How it works</h2><span class="faint" style="font-size:12px">Tap for an example</span></div>
      <div class="can">${stories.map(s => html`<${Story} key=${s.id} s=${s} tag=${tags[s.id]} hot=${hot[s.id]}/>`)}</div></section>
    <section class="section about-plans"><div class="section-head"><h2>Free and Pro <${Info} k="plandemo"/></h2><${PlanSwitch}/></div>
      <div class="tablewrap"><table class="plans-table"><thead><tr><th>Feature</th><th class=${pro ? '' : 'cur'}>Free</th><th class=${pro ? 'cur' : ''}>Pro</th></tr></thead>
        <tbody>${rows.map(([f, a, b]) => html`<tr key=${f}><td>${f}</td><td class=${pro ? '' : 'cur'}>${cell(a)}</td><td class=${pro ? 'cur' : ''}>${cell(b)}</td></tr>`)}</tbody></table></div>
      <div class="row between"><button class="linkbtn" aria-expanded=${all} onClick=${() => setAll(!all)}>${all ? 'Show less' : `All ${PLAN_ROWS.length} features`}</button><button class="linkbtn" onClick=${() => go('pricing')}>Prices ›</button></div></section>
    <${ConnectCard}/>
  </div>`;
}

// ---------- Settings → Connect Claude: 4 simple steps, one button each ----------
const CLAUDE_CONNECTORS = 'https://claude.ai/new#customize/connectors';
const ONLINE_APP = 'https://funinvestments.green-sound-dc01.workers.dev/';
const CLAUDE_NEW = 'https://claude.ai/new';
const FIRST_ASK = "What's pending in FunInvestments?";

// Connection status, shown the same way everywhere. Connected = Claude has reached this app at
// least once (the engine stamps every Claude call). "Check status" re-reads the snapshot now.
import { refresh } from './store.js';
export function ClaudeStatus({ steps = '1–4' }) {
  const S = store.S;
  const hosted = api.getMode() === 'server';
  const on = hosted && S.claudeConnected;
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (busy) return;
    setBusy(true);
    await Promise.all([refresh(), new Promise(r => setTimeout(r, 450))]);
    setBusy(false);
    const N = store.S;
    if (store.netError) toast("Can't check · no connection", { err: true });
    else toast(N.claudeConnected ? `Connected · last used ${ago(N.lastClaudeCall?.time)}` : `Not connected yet · finish steps ${steps}`);
  };
  return html`<div class="cstatus">
    <span class="tag ${on ? 'claude' : ''}">${on ? 'Connected' : 'Not connected'}</span>
    <span class="grow muted">${!hosted ? html`Claude connects to the <a href=${ONLINE_APP} target="_blank" rel="noopener">online app</a>.` : busy ? 'Checking…' : on ? html`<button class="linkbtn" onClick=${() => go('activity')}>Last used ${ago(S.lastClaudeCall?.time)}</button>` : `Finish steps ${steps}`} <${Info} k="claudestatus"/></span>
    ${hosted && html`<button class="btn small ghost" disabled=${busy} onClick=${check}>Check status</button>`}</div>`;
}
// Steps stay one tap away once Claude is connected.
const SetupFold = ({ children }) => html`<details class="cfold"><summary>Setup steps</summary>${children}</details>`;

// About's "Connect Claude" card: same 4 steps; the Connect button gives way to the status once connected.
const HOW = [['1', 'Open Claude Connectors', '+ → Add custom connector.'], ['2', 'Paste name and URL', 'From Settings → Connect Claude, then Add.'], ['3', 'Ask Claude', '"What\'s pending in FunInvestments?"'], ['4', 'Confirm here', 'Claude prepares; you confirm orders.']];
export function ConnectCard() {
  const S = store.S;
  const on = api.getMode() === 'server' && S.claudeConnected;
  const how = html`<div class="howto">${HOW.map(([n, t, d]) => html`<div class="howstep" key=${n}><span class="n">${n}</span><b>${t}</b><span class="muted">${d}</span></div>`)}</div>`;
  return html`<section class="section"><div class="section-head"><h2>${I.spark} Connect Claude</h2>${!on && html`<button class="btn small primary" onClick=${() => { go('account'); setTimeout(() => document.getElementById('connect-claude')?.scrollIntoView({ behavior: 'smooth' }), 150); }}>Connect</button>`}</div>
    <${ClaudeStatus} steps="1–3"/>
    ${on ? html`<${SetupFold}>${how}<//>` : how}
    <p class="muted" style="margin:0;font-size:13.5px">Claude's work stays saved in <button class="linkbtn" style="font-size:13.5px" onClick=${() => go('activity')}>Activity</button>. <${Info} k="claudesaved"/></p></section>`;
}

function useConnector() {
  const S = store.S;
  const hosted = api.getMode() === 'server';
  const base = hosted ? location.origin + location.pathname.replace(/[^/]*$/, '') : '';
  return { hosted, url: hosted ? base + 'mcp/' + S.user.apiKey : '', base };
}

export function ConnectSteps({ compact }) {
  const S = store.S;
  const { hosted, url } = useConnector();
  const [test, setTest] = useState(null);
  const runTest = async () => {
    setTest({ state: 'run' });
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      const j = await r.json();
      setTest(j.result ? { state: 'ok' } : { state: 'bad', msg: j.error?.message || `error ${r.status}` });
    } catch (e) { setTest({ state: 'bad', msg: e.message }); }
  };
  const step = (n, title, body, cta, done) => html`<div class="cstep ${done ? 'done' : ''}">
    <span class="n" aria-hidden="true">${done ? '✓' : n}</span>
    <div class="grow" style="min-width:0"><b>${title}</b>${body && html`<div class="muted" style="font-size:13px;margin-top:2px">${body}</div>`}</div>
    ${cta}</div>`;
  if (!hosted) return html`<div class="card stack" style="gap:10px">
    <span class="muted" style="font-size:13.5px">This copy runs only in your browser, so Claude can't reach it.</span>
    <a class="btn primary" href=${ONLINE_APP} target="_blank" rel="noopener">Open online app</a></div>`;
  const short = url.replace(S.user.apiKey, S.user.apiKey.slice(0, 6) + '…');
  const field = (label, shown, value) => html`<div class="cfield"><span class="faint">${label}</span>
    <div class="row" style="gap:8px"><div class="codebox" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shown}</div>
    <button class="btn small" aria-label=${`Copy ${label}`} onClick=${() => copy(value)}>Copy</button></div></div>`;
  return html`<div class="csteps">
    ${step(1, 'Open Connectors in Claude', html`Click <b>+</b> → <b>Add custom connector</b>.`, html`<a class="btn small primary" href=${CLAUDE_CONNECTORS} target="_blank" rel="noopener">Open Claude</a>`)}
    ${step(2, 'Fill in two boxes, then Add', html`<div class="stack" style="gap:8px;margin-top:8px">
        ${field('Name', 'FunInvestments', 'FunInvestments')}
        ${field('Remote MCP server URL', short, url)}
        <span class="faint" style="font-size:12px">Keep this URL private. <${Info} k="claudeurl"/></span></div>`, null)}
    ${step(3, 'Check it works', test?.state === 'ok' ? html`<span class="up">Link works</span>` : test?.state === 'bad' ? html`<span class="down">Not working: ${test.msg}</span>` : test?.state === 'run' ? 'Checking…' : compact ? null : 'FunInvestments should be switched on in your Connectors list.',
      html`<button class="btn small" onClick=${runTest}>Test</button>`, test?.state === 'ok')}
    ${step(4, 'Ask Claude', html`Start a new chat and ask: <span class="codebox inline">${FIRST_ASK}</span>`, html`<button class="btn small" onClick=${() => { copy(FIRST_ASK); window.open?.(CLAUDE_NEW, '_blank', 'noopener'); }}>Copy & open</button>`, S.claudeConnected)}
  </div>`;
}

export function ConnectClaude() {
  const S = store.S;
  const { hosted, url, base } = useConnector();
  const [show, setShow] = useState(false);
  const tools = api.getTools();
  const cc = `claude mcp add --transport http funinvestments ${url}`;
  const desktop = JSON.stringify({ mcpServers: { funinvestments: { command: 'node', args: ['/path/to/funinvestments/server/mcp-stdio.js'], env: { FI_URL: base.replace(/\/$/, ''), FI_KEY: S.user.apiKey } } } }, null, 2);
  const hide = t => (show ? t : t.split(S.user.apiKey).join(S.user.apiKey.slice(0, 6) + '••••••'));
  return html`<section class="section" id="connect-claude"><div class="section-head"><h2>${I.spark} Connect Claude</h2></div>
    <${ClaudeStatus}/>
    ${hosted && S.claudeConnected ? html`<${SetupFold}><${ConnectSteps}/><//>` : html`<${ConnectSteps}/>`}
    ${hosted && html`<details class="card"><summary class="muted" style="cursor:pointer;font-size:13.5px">More options</summary>
      <div class="stack" style="gap:12px;margin-top:12px">
        <div class="field"><label>Your link</label><div class="row"><div class="codebox" style="flex:1">${hide(url)}</div><button class="btn small ghost" onClick=${() => setShow(!show)}>${show ? 'Hide' : 'Show'}</button></div></div>
        <div class="field"><label>Claude Code (terminal)</label><div class="row"><div class="codebox" style="flex:1">${hide(cc)}</div><button class="btn small" onClick=${() => copy(cc)}>Copy</button></div></div>
        <div class="field"><label>Claude Desktop config</label><div class="row" style="align-items:flex-start"><pre class="codebox" style="flex:1;margin:0;white-space:pre-wrap">${hide(desktop)}</pre><button class="btn small" onClick=${() => copy(desktop)}>Copy</button></div></div>
        <span class="faint" style="font-size:12px">${tools.length} tools · Claude prepares, you confirm. <${Info} k="claudesaved"/></span>
      </div></details>`}
  </section>`;
}
