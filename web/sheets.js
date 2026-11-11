// Bottom sheets: every create / edit / delete flow lives here.
import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { store, act, read, go, goSheet, openSheet, closeSheet, copy, toast, confirmDialog, refresh } from './store.js';
import { inr, inr2, pct, cls, short, shortName, STATUS, Pill, Src, Avatar, I, Stepper, Logo } from './lib.js';
import { Info, InfoSheet } from './glossary.js';
import { orderWhy } from './pages.js';
export { exitBasket, deleteBasket, sellStock };

export function SheetHost() {
  const s = store.ui.sheet;
  const ref = useRef();
  useEffect(() => {
    if (!s) return;
    const prev = document.activeElement;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches; // on a phone, don't pop the keyboard over the sheet
    const el = ref.current?.querySelector(coarse ? 'button.primary' : 'input:not([type=checkbox]),textarea,select,button.primary');
    setTimeout(() => el?.focus?.(), 30);
    const onKey = e => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [s?.type, s?.id, s?.symbol]);
  if (!s) return null;
  const C = SHEETS[s.type];
  return html`<div class="scrim" onClick=${e => { if (e.target === e.currentTarget) dismiss(); }}>
    <div class="sheet" role="dialog" aria-modal="true" ref=${ref}><div class="grab"></div>
      <button class="iconlink sheet-x" aria-label="Close" onClick=${dismiss}>${I.x}</button>
      ${C ? html`<${C} s=${s}/>` : null}</div></div>`;
}

// Closing a preview of orders you drafted yourself cancels them (nothing half-done is left behind).
async function dismiss() {
  const s = store.ui.sheet;
  closeSheet();
  if (s?.type === 'review' && s.drafted) {
    for (const id of s.ids) { const o = store.S.orders.find(x => x.id === id); if (o?.status === 'pending' && o.source === 'you') await read('cancel_order', { order_id: id, reason: 'Preview closed' }); }
    await refresh();
  }
}

// Exit = sell everything. Drafts the sells and opens the review, which says what comes back and holds the
// one confirmation (closing it cancels the drafts), so no extra "are you sure" step in front of it.
async function exitBasket(b) {
  const r = await act('exit_basket', { basket_id: b.id }, { quiet: true });
  if (!r?.ok) return;
  await refresh();
  if (r.data.orders.length) openSheet({ type: 'review', drafted: true, ids: r.data.orders.map(o => o.id), exit: { name: b.name, cost: r.data.costBasis, cash: b.cash } });
  else toast(r.data.returnedCash ? `${inr(r.data.returnedCash)} back to practice cash` : 'Nothing to sell');
}

// Sell one stock you hold: drafts a sell of all of it and opens the review, where the quantity can be lowered.
async function sellStock(basketId, symbol, held) {
  const r = await act('create_order', { basket_id: basketId, side: 'sell', symbol, qty: held, remove_after: true, reason: 'Sell by you' }, { quiet: true });
  if (r?.ok) { await refresh(); openSheet({ type: 'review', ids: r.data.orders.map(o => o.id), drafted: true }); }
}

// Delete: an empty basket gets a plain confirm; one that holds shares says what selling gives back, in ₹.
async function deleteBasket(b) {
  const r = await read('delete_preview', { basket_id: b.id });
  if (!r.ok) { toast(r.error?.message || 'Something went wrong', { err: true }); return; }
  openSheet({ type: 'delete', id: b.id, p: r.data });
}


// − / + with an editable number. Defined once at module level so its buttons are never rebuilt
// between a finger going down and the tap landing (a redraw used to swallow taps).
function NumStep({ id, v, set, step, clamp, label }) {
  return html`<div class="numstep" role="group" aria-label=${label}>
    <button type="button" aria-label=${`${label}: less`} onClick=${() => set(x => clamp(x - step))}>−</button>
    <input id=${id} class="num" inputmode="decimal" value=${v} aria-label=${label} onChange=${e => { const n = parseFloat(e.target.value); if (!isNaN(n)) set(clamp(n)); else e.target.value = v; }}/>
    <button type="button" aria-label=${`${label}: more`} onClick=${() => set(x => clamp(x + step))}>+</button></div>`;
}

// Quantity: − / + and a number you can type. Keeps its own value so quick taps all count.
function QtyEdit({ value, max, onChange, label }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const set = n => { n = Math.max(1, Math.min(max ?? 99999, Math.floor(n) || 1)); setV(n); onChange(n); };
  return html`<div class="numstep qty" role="group" aria-label=${label}>
    <button type="button" aria-label=${`${label}: less`} disabled=${v <= 1} onClick=${() => setV(x => { const n = Math.max(1, x - 1); if (n !== x) onChange(n); return n; })}>−</button>
    <input class="num" inputmode="numeric" value=${v} aria-label=${label} onChange=${e => set(parseInt(e.target.value, 10))}/>
    <button type="button" aria-label=${`${label}: more`} disabled=${max != null && v >= max} onClick=${() => setV(x => { const n = Math.min(max ?? 99999, x + 1); if (n !== x) onChange(n); return n; })}>+</button></div>`;
}
const warnTxt = n => `${n} warning${n === 1 ? '' : 's'}`;
const SHEETS = {
  info: InfoSheet,
  // ---------- create basket ----------
  new({ s }) {
    const S = store.S;
    const [name, setName] = useState(s.draft?.name ?? s.name ?? '');
    const [desc, setDesc] = useState(s.draft?.desc || '');
    const [theme, setTheme] = useState(s.draft?.theme || 'auto');
    const [themeName, setThemeName] = useState(s.draft?.themeName || '');
    const [q, setQ] = useState('');
    const [mode, setMode] = useState('pick');
    const [paste, setPaste] = useState('');
    const [pick, setPick] = useState(new Set(s.draft?.pick || s.preset || []));
    const [result, setResult] = useState(null);
    const max = S.planInfo.maxStocks;
    if (result) {
      const minN = result.basket.limits?.minStocks || S.defaultLimits?.minStocks || 6, short = Math.max(0, minN - result.basket.count);
      const bt = result.backtest, pctRight = bt.removalsTotal ? Math.round(bt.removalsRight / bt.removalsTotal * 100) : 0;
      return html`<div class="stack" style="gap:14px"><h2>${short ? `${result.basket.name} created · add ${short} more` : `${result.basket.name} is ready`}</h2>
      ${short > 0 && html`<span class="muted" style="font-size:13px;margin-top:-6px">A basket needs at least ${minN} stocks, so no single stock gets too big. Add ${short} more yourself, or ask Claude to find some.</span>`}
      <div class="row wrap" style="gap:6px"><${Pill} s="pass" n=${result.basket.counts.pass}/>${result.basket.counts.watch ? html`<${Pill} s="watch" n=${result.basket.counts.watch}/>` : null}<span class="tag">${result.basket.count} stock${result.basket.count === 1 ? '' : 's'}</span>${result.basket.themeLabel && html`<span class="tag">${result.basket.themeLabel}</span>`}</div>
      ${result.skipped.length > 0 && html`<div class="card list" style="padding:2px 16px">${result.skipped.map(x => html`<div class="li" key=${x.symbol}><span class="grow"><span class="t">${x.name || x.symbol} · skipped</span><span class="s">${x.why}</span></span></div>`)}</div>`}
      ${bt.mine ? html`<div class="tile"><span class="k">Past test of your ${bt.mine.stocks} stocks, ${bt.years} <${Info} k="grew"/></span><span class="v">₹100 → ₹${bt.mine.grew}</span><span class="faint" style="font-size:12.5px">kept by these rules each June · Nifty 50: ₹${bt.mine.nifty} · beat the Nifty in ${bt.mine.beatYears} of ${bt.mine.years} years</span></div>` : null}
      <span class="faint" style="font-size:12px;margin-top:-6px">Same rules on every stock we track in this theme: when they said Sell, they were right ${bt.removalsRight} of ${bt.removalsTotal} times (${pctRight}%).</span>
      <div class="row" style="gap:8px">${short ? html`<button class="btn primary" style="flex:1" onClick=${() => goSheet('basket-' + result.basket.id, { type: 'addstocks', id: result.basket.id })}>Add ${short} more</button><button class="btn ghost" style="flex:1" onClick=${() => go('basket-' + result.basket.id)}>Open basket</button>`
        : html`<button class="btn primary" style="flex:1" onClick=${() => goSheet('basket-' + result.basket.id, { type: 'invest', id: result.basket.id })}>Invest practice money</button><button class="btn ghost" style="flex:1" onClick=${() => go('basket-' + result.basket.id)}>Open basket</button>`}</div></div>`;
    }
    const list = S.universe.filter(x => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.symbol.toLowerCase().includes(q.toLowerCase()) || x.sector.toLowerCase().includes(q.toLowerCase()));
    // Same segment cap the basket uses (40% by default): with 6 stocks that is 2 from one segment. Said while picking,
    // so a pick is never silently skipped at Create.
    const segCap = S.defaultLimits?.maxStageWeight || 40, minN = S.defaultLimits?.minStocks || 6;
    const segFull = x => { if (pick.has(x.symbol)) return null; const same = S.universe.filter(y => pick.has(y.symbol) && y.stage === x.stage).length; return ((same + 1) / Math.max(pick.size + 1, minN)) * 100 > segCap + 0.01 ? (S.stages.find(t => t.id === x.stage)?.label || x.stage) : null; };
    const toggle = sym => { const n = new Set(pick); const x = S.universe.find(y => y.symbol === sym); const seg = x && segFull(x); if (n.has(sym)) n.delete(sym); else if (seg) { toast(`Already ${S.universe.filter(y => pick.has(y.symbol) && y.stage === x.stage).length} from ${seg}: no segment can be over ${segCap}% of a ${Math.max(pick.size + 1, minN)}-stock basket. Pick another segment.`); return; } else if (n.size < max) n.add(sym); else { toast(`Max ${max} stocks${S.plan === 'free' ? ' on Free' : ''}`, S.plan === 'free' ? { action: 'See plans', go: 'pricing' } : {}); return; } setPick(n); };
    const symbols = mode === 'pick' ? [...pick] : paste.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
    const create = async () => {
      const themeArgs = theme === 'auto' ? {} : theme === 'new' ? (themeName.trim() ? { theme: null, theme_name: themeName.trim() } : {}) : { theme: theme === 'none' ? null : theme };
      const r = await act('create_basket', { name: name.trim() || 'My basket', description: desc, symbols, ...themeArgs }, { quiet: true });
      if (r?.ok) { await refresh(); setResult(r.data); } else if (r?.error?.skipped) toast(`${r.error.message}: ${r.error.skipped.map(x => `${x.symbol} (${x.why})`).join(', ')}`, { err: true });
    };
    const picked = S.universe.filter(x => pick.has(x.symbol));
    // Theme is detected from the picked stocks unless the person chooses one.
    const common = picked.length ? S.themes.find(t => picked.every(x => (x.themes || {})[t.id] > 0)) : null;
    const autoLabel = common ? `Auto · ${common.label} (detected)` : picked.length ? 'Auto · mixed stocks, no theme' : 'Auto · from the stocks you pick';
    const own = () => openSheet({ type: 'tracking', preset: [...pick], name: name.trim() || undefined });
    const trackFull = S.plan === 'free' && S.baskets.filter(b => b.kind === 'tracking').length >= S.planInfo.maxTracking;
    return html`<div class="stack" style="gap:14px"><h2>New basket</h2>
      <div class="kindpick" role="radiogroup" aria-label="Basket type"><button role="radio" aria-pressed="true" aria-checked="true"><b>Practice money</b><span>Buy with ₹1,00,000 practice cash</span></button>
        <button role="radio" aria-pressed="false" aria-checked="false" onClick=${() => (trackFull ? toast('Free plan: 1 tracking basket. Pro has unlimited.', { action: 'See plans', go: 'pricing' }) : own())}><b>I already own these</b><span>Track real shares · alerts only</span></button></div>
      <div class="field"><label for="nb-name">Name</label><input class="input" id="nb-name" placeholder="e.g. Profitable energy" maxlength="40" value=${name} onInput=${e => setName(e.target.value)}/></div>
      <details class="cfold nbmore" open=${theme === 'new' || !!desc || theme !== 'auto'}><summary>Note, theme and rules <span class="faint" style="font-weight:600">· ${theme === 'auto' ? autoLabel.replace('Auto · ', '') : 'set'}</span></summary><div class="stack" style="gap:14px;margin-top:10px">
      <div class="field"><label for="nb-desc">Note <span class="faint">(optional)</span></label><input class="input" id="nb-desc" placeholder="What this basket is for" maxlength="140" value=${desc} onInput=${e => setDesc(e.target.value)}/></div>
      <div class="field"><label for="nb-theme">Theme <${Info} k="theme"/></label>
        <select id="nb-theme" class="input quietsel" value=${theme} onChange=${e => setTheme(e.target.value)}>
          <option value="auto">${autoLabel}</option>${S.themes.map(t => html`<option key=${t.id} value=${t.id}>${t.label}</option>`)}<option value="none">No theme</option><option value="new">+ New theme…</option></select>
        ${theme === 'new' && html`<input class="input" id="nb-theme-name" maxlength="30" placeholder="Theme name, e.g. Railways" value=${themeName} onInput=${e => setThemeName(e.target.value)}/><span class="faint" style="font-size:12px">Your own label. Only AC value chain and Energy check each company's share of business.</span>`}</div>
      <div class="li rulesrow"><span class="grow"><span class="t">Rules</span><span class="s">${S.rules.metrics.filter(r => r.enabled).length} default rules</span></span>${S.plan === 'pro' ? html`<button class="linkbtn" onClick=${() => { store.ui.draftNew = { name, desc, theme, themeName, pick: [...pick] }; go('rules'); }}>Edit</button>` : html`<button class="linkbtn" onClick=${() => toast('Editing rules is a Pro feature', { action: 'See plans', go: 'pricing' })}>🔒 Edit</button>`}</div>
      </div></details>
      <div class="seg">${[['pick', 'Pick stocks'], ['paste', 'Paste symbols']].map(([v, l]) => html`<button key=${v} class=${mode === v ? 'on' : ''} onClick=${() => setMode(v)}>${l}</button>`)}</div>
      ${mode === 'pick' ? html`
        ${picked.length > 0 && html`<div class="picksum"><span><b>${picked.length} selected:</b> ${picked.map(x => shortName(x.name)).join(', ')}</span><button class="linkbtn" onClick=${() => picked.forEach(x => toggle(x.symbol))}>Clear</button></div>`}
        <input class="input" id="nb-q" placeholder="Search stocks or sector" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search stocks"/>
        <div class="card list pick" style="padding:2px 14px">${list.map(x => html`<button key=${x.symbol} class="li btnrow" aria-pressed=${pick.has(x.symbol)} onClick=${() => toggle(x.symbol)}>
          <${Avatar} name=${x.name} stage=${x.stage}/><span class="grow"><span class="t">${x.name}</span><span class="s">${(() => { const seg = segFull(x); return seg ? html`<span class="down">${seg} is full · pick another segment</span>` : `${x.sector} · ${warnTxt(x.points)} · profitable ${x.profitableYears} of 5 yrs`; })()}</span></span><${Pill} s=${x.status}/><span class="check">${pick.has(x.symbol) ? '✓' : ''}</span></button>`)}</div>
        <span class="muted" style="font-size:12.5px">${pick.size} picked · max ${max}. Stocks that fail this basket's rules are skipped and listed.</span>`
      : html`<textarea class="input" id="nb-paste" placeholder="NTPC, POWERGRID, COALINDIA, PETRONET, GAIL, RELIANCE" value=${paste} onInput=${e => setPaste(e.target.value)} aria-label="Symbols"></textarea>`}
      <div class="sticky-cta"><button class="btn primary block" disabled=${!symbols.length} onClick=${create}>Create basket${symbols.length ? ` · ${symbols.length}` : ''}</button></div></div>`;
  },

  // Track shares you own elsewhere: pick them like a new basket, then type quantity and the price you paid
  // (pre-filled with today's price). Paste stays as the fast way for a long list.
  tracking({ s }) {
    const S = store.S;
    const [name, setName] = useState(s.name || 'My holdings');
    const [q, setQ] = useState('');
    const [paste, setPaste] = useState(false);
    const [csv, setCsv] = useState('');
    const [rows, setRows] = useState(() => (s.preset || []).map(sym => ({ symbol: sym, qty: '', avg: S.universe.find(x => x.symbol === sym)?.price ?? '' })));
    const has = sym => rows.some(r => r.symbol === sym);
    const toggle = x => setRows(rs => (rs.some(r => r.symbol === x.symbol) ? rs.filter(r => r.symbol !== x.symbol) : [...rs, { symbol: x.symbol, qty: '', avg: x.price }]));
    const set = (sym, k, v) => setRows(rs => rs.map(r => (r.symbol === sym ? { ...r, [k]: v } : r)));
    const pasted = csv.split(/\n+/).map(l => l.split(/[,\t;]+/).map(x => x.trim())).filter(p => p[0]).map(([symbol, qty, avg]) => ({ symbol, qty, avg }));
    const list = paste ? pasted : rows;
    const ready = list.length > 0 && list.every(r => Number(r.qty) > 0);
    const create = async () => {
      const r = await act('create_basket', { name: name.trim() || 'My holdings', kind: 'tracking', holdings: list.map(x => ({ symbol: x.symbol, qty: Number(x.qty) || 0, avg_price: Number(x.avg) || undefined })) }, { quiet: true });
      if (r?.ok) { await refresh(); closeSheet(); toast(`${r.data.basket.count} holding${r.data.basket.count === 1 ? '' : 's'} tracked${r.data.skipped.length ? ` · ${r.data.skipped.length} skipped` : ''}`); go('basket-' + r.data.basket.id); }
    };
    const found = q.trim() ? S.universe.filter(x => !has(x.symbol) && (x.name.toLowerCase().includes(q.toLowerCase()) || x.symbol.toLowerCase().includes(q.toLowerCase()))).slice(0, 8) : [];
    const uname = sym => S.universe.find(x => x.symbol === sym)?.name || sym;
    return html`<div class="stack" style="gap:14px"><h2>Track shares you own <${Info} k="tracking"/></h2>
      <span class="muted" style="font-size:13px;margin-top:-6px">The rules watch them and alert you. No orders are placed here: you sell in your own broker.</span>
      <div class="field"><label for="tr-name">Name</label><input class="input" id="tr-name" value=${name} maxlength="40" onInput=${e => setName(e.target.value)}/></div>
      ${paste ? html`<div class="field"><label for="tr-csv">SYMBOL, QTY, PRICE PAID · one per line</label><textarea class="input" id="tr-csv" placeholder="TATAPOWER, 40, 360\nNTPC, 50, 310" value=${csv} onInput=${e => setCsv(e.target.value)}></textarea></div>`
      : html`${rows.length > 0 && html`<div class="card list" style="padding:2px 14px">${rows.map(r => html`<div class="li holdrow" key=${r.symbol}>
          <span class="grow" style="min-width:0"><span class="t">${uname(r.symbol)}</span><span class="s mono">${r.symbol}</span></span>
          <label class="mini"><span>Shares</span><input class="input num" type="number" inputmode="numeric" min="1" placeholder="0" aria-label=${`Shares of ${uname(r.symbol)}`} value=${r.qty} onInput=${e => set(r.symbol, 'qty', e.target.value)}/></label>
          <label class="mini"><span>Paid ₹</span><input class="input num" type="number" inputmode="decimal" min="0" step="0.05" aria-label=${`Price paid for ${uname(r.symbol)}`} value=${r.avg} onInput=${e => set(r.symbol, 'avg', e.target.value)}/></label>
          <button class="iconlink" aria-label=${`Remove ${uname(r.symbol)}`} onClick=${() => setRows(rs => rs.filter(x => x.symbol !== r.symbol))}>${I.x}</button></div>`)}</div>`}
        <input class="input" id="tr-q" placeholder=${rows.length ? 'Add another stock' : 'Search a stock you own, e.g. Tata Power'} value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search stocks"/>
        ${found.length > 0 && html`<div class="card list pick" style="padding:2px 14px">${found.map(x => html`<button key=${x.symbol} class="li btnrow" onClick=${() => { toggle(x); setQ(''); }}><${Avatar} name=${x.name} stage=${x.stage}/><span class="grow"><span class="t">${x.name}</span><span class="s num">${x.symbol} · ${inr2(x.price)}</span></span><${Pill} s=${x.status}/></button>`)}</div>`}`}
      <button class="linkbtn" style="align-self:flex-start;font-size:13px" onClick=${() => setPaste(!paste)}>${paste ? 'Pick stocks instead' : 'Paste a list instead'}</button>
      <div class="sticky-cta"><button class="btn primary block" disabled=${!ready} onClick=${create}>${list.length && !ready ? 'Add how many shares you own' : `Track ${list.length || ''} holding${list.length === 1 ? '' : 's'}`}</button></div></div>`;
  },

  // ---------- add a stock to one of your baskets ----------
  addto({ s }) {
    const S = store.S;
    if (!S.baskets.length) return html`<div class="stack" style="gap:14px"><h2>Add ${shortName(s.name)}</h2><span class="muted">You have no baskets yet.</span><button class="btn primary block" onClick=${() => openSheet({ type: 'new', preset: [s.symbol] })}>Create basket with it</button></div>`;
    return html`<div class="stack" style="gap:14px"><h2>Add ${shortName(s.name)} to</h2>
      <div class="card list" style="padding:2px 16px">${S.baskets.filter(b => b.kind === 'model').map(b => { const inIt = b.stocks.some(x => x.symbol === s.symbol); const need = Math.max(0, (b.limits?.minStocks || 6) - b.count); return html`<div class="li" key=${b.id}><span class="grow"><span class="t">${b.name}</span><span class="s">${!inIt && b.addBlock?.[s.symbol] ? html`<span class="down">Can't add: ${b.addBlock[s.symbol]}</span>` : html`${b.count} stocks${need ? html` · <b class="down">needs ${need} more</b>` : ''}${b.themeLabel ? ' · ' + b.themeLabel : ''}`}</span></span>
        ${inIt ? html`<span class="muted" style="font-size:13px">Already in ✓</span>` : b.addBlock?.[s.symbol] ? null : html`<button class="btn small ${need ? 'primary' : ''}" onClick=${() => act('add_stock', { basket_id: b.id, symbol: s.symbol }, { ok: `Added to ${b.name}` })}>Add</button>`}</div>`; })}</div>
      <button class="btn ghost block" onClick=${() => openSheet({ type: 'new', preset: [s.symbol] })}>+ New basket with it</button></div>`;
  },

  addstocks({ s }) {
    const S = store.S;
    const b = S.baskets.find(x => x.id === s.id);
    const [q, setQ] = useState('');
    if (!b) return null;
    const have = new Set(b.stocks.map(x => x.symbol));
    // Rate each stock the way this basket will (its theme's share rule), so a "Buy" here can be added.
    const rate = x => (b.rateHere?.[x.symbol] ? { ...x, ...b.rateHere[x.symbol], why: b.rateHere[x.symbol].reason } : x);
    const ord = { pass: 0, watch: 1, remove: 2 };
    const list = S.universe.filter(x => !have.has(x.symbol)).filter(x => !b.theme || x.themes?.[b.theme] != null || q).filter(x => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.symbol.toLowerCase().includes(q.toLowerCase()))
      .map(rate).sort((x, y) => !!b.addBlock?.[x.symbol] - !!b.addBlock?.[y.symbol] || ord[x.status] - ord[y.status] || x.points - y.points);
    const max = Math.min(b.limits.maxStocks, S.planInfo.maxStocks), need = Math.max(0, b.limits.minStocks - b.count), isFull = b.count >= max;
    return html`<div class="stack" style="gap:14px"><h2>Add to ${b.name}</h2>
      <span class="muted" style="font-size:13px;margin-top:-6px">${b.count} stock${b.count === 1 ? '' : 's'}${need ? html` · <b class="down">needs ${need} more</b>` : isFull ? ` · full (${max} max${S.plan === 'free' ? ' on Free' : ''})` : ` · room for ${max - b.count} more`}</span>
      <input class="input" id="as-q" placeholder=${b.theme ? `Search ${b.themeLabel} stocks (type to search all)` : 'Search stocks'} value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search"/>
      <div class="card list pick" style="padding:2px 14px">${list.map(x => html`<div class="li" key=${x.symbol}><${Avatar} name=${x.name} stage=${x.stage}/><span class="grow"><span class="t">${x.name}</span><span class=${b.addBlock?.[x.symbol] ? 's down' : 's'}>${b.addBlock?.[x.symbol] ? `Can't add: ${b.addBlock[x.symbol]}` : `${x.sector} · ${warnTxt(x.points)}`}</span></span><${Pill} s=${x.status}/>
        ${b.addBlock?.[x.symbol] ? null : html`<button class="btn small" onClick=${() => act('add_stock', { basket_id: b.id, symbol: x.symbol }, { ok: `${shortName(x.name)} added` })}>Add</button>`}</div>`)}</div>
      ${need === 0 && html`<button class="btn primary block" onClick=${closeSheet}>Done</button>`}
      <span class="faint" style="font-size:12px">Rated by this basket's own rules${b.theme ? ` and the ${b.themeLabel} share rule` : ''}.</span></div>`;
  },

  // ---------- orders ----------
  invest({ s }) {
    const S = store.S;
    const b = S.baskets.find(x => x.id === s.id);
    const [amt, setAmt] = useState(50000);
    if (!b) return null;
    const avail = S.cash + b.cash;
    const need = b.limits.minStocks - b.count;
    if (need > 0) return html`<div class="stack" style="gap:16px"><h2>Add ${need} more first</h2><p class="muted" style="margin:0">${b.name} has ${b.count} stock${b.count === 1 ? '' : 's'}. A basket needs at least ${b.limits.minStocks} before you invest, so no single stock gets too big.</p>
      <button class="btn primary block" onClick=${() => openSheet({ type: 'addstocks', id: b.id })}>Add ${need} more stock${need > 1 ? 's' : ''}</button></div>`;
    const draft = async () => { const r = await act('create_order', { basket_id: b.id, side: 'buy', amount: Number(amt) }, { quiet: true }); if (r?.ok) { await refresh(); openSheet({ type: 'review', ids: r.data.orders.map(o => o.id), drafted: true, skipped: r.data.skipped, amount: Number(amt) }); } };
    return html`<div class="stack" style="gap:16px"><h2>Invest in ${b.name}</h2>
      <div class="chips">${[10000, 25000, 50000].filter(v => v <= avail).map(v => html`<button key=${v} class="chip ${+amt === v ? 'on' : ''}" onClick=${() => setAmt(v)}>${inr(v)}</button>`)}</div>
      <div class="field"><label for="inv-amt">Amount</label><input class="input num" id="inv-amt" type="number" inputmode="numeric" min="1" value=${amt} onInput=${e => setAmt(e.target.value)}/></div>
      <p class="muted" style="margin:0;font-size:13.5px">${+amt > avail ? html`<span class="down">More than your practice cash (${inr(avail)}).</span>` : `Split in whole shares across ${b.count} stocks. You have ${inr(avail)} practice cash.`}</p>
      <div class="sticky-cta"><button class="btn primary block" disabled=${!(+amt > 0) || +amt > avail} onClick=${draft}>Review orders</button></div></div>`;
  },

  trade({ s }) {
    const S = store.S;
    const [qty, setQty] = useState(1);
    const u = S.universe.find(x => x.symbol === s.symbol);
    const draft = async () => {
      const r = await act('create_order', { basket_id: s.basketId, side: s.side, symbol: s.symbol, qty, remove_after: s.side === 'sell' && qty === s.held, reason: s.side === 'buy' ? 'Buy by you' : 'Sell by you' }, { quiet: true });
      if (r?.ok) { await refresh(); openSheet({ type: 'review', ids: r.data.orders.map(o => o.id), drafted: true }); }
    };
    return html`<div class="stack" style="gap:14px"><h2>${s.side === 'buy' ? 'Buy' : 'Sell'} ${u?.name}</h2>
      <div class="row between"><span class="muted">Quantity</span><${Stepper} label="Quantity" value=${qty} min=${1} max=${s.side === 'sell' ? s.held : 9999} onChange=${setQty}/></div>
      <dl class="kv"><dt>Price</dt><dd>${inr2(u?.price)}</dd><dt>Est. value</dt><dd>${inr((u?.price || 0) * qty)}</dd>${s.side === 'sell' && html`<dt>Holding</dt><dd>${s.held} sh</dd>`}<dt>Basket</dt><dd>${S.baskets.find(b => b.id === s.basketId)?.name}</dd></dl>
      <div class="sticky-cta"><button class="btn primary block" onClick=${draft}>Review order</button></div></div>`;
  },

  review({ s }) {
    const S = store.S;
    const [qty, setQty] = useState({}); // edits shown at once, saved in the background
    const orders = s.ids.map(id => S.orders.find(o => o.id === id)).filter(Boolean);
    const pending = orders.filter(o => o.status === 'pending');
    if (!pending.length) return html`<div class="stack" style="gap:16px"><h2>Nothing to confirm</h2><span class="muted">These orders are already done or cancelled.</span><button class="btn primary block" onClick=${closeSheet}>Close</button></div>`;
    const q = o => qty[o.id] ?? o.qty;
    const val = o => q(o) * o.estPrice * (o.side === 'buy' ? 1.001 : 0.999); // the fill price includes a 0.1% cost, so the totals match what you get
    const buys = pending.filter(o => o.side === 'buy'), sells = pending.filter(o => o.side === 'sell');
    const pay = buys.reduce((t, o) => t + val(o), 0), get = sells.reduce((t, o) => t + val(o), 0);
    const ruleSell = sells.some(o => o.tag === 'rules' || o.tag === 'news_only');
    const isExit = !!s.exit || pending.every(o => o.tag === 'exit');
    const back = get + (s.exit?.cash || 0);
    const n = pending.length, word = `${n} stock${n > 1 ? 's' : ''}`;
    const title = s.refill ? `Replacement: buy ${n === 1 ? pending[0].name : word}` : isExit ? `Sell everything in ${s.exit?.name || 'this basket'}` : buys.length && sells.length ? `Rebalance · ${word}` : sells.length ? `Sell ${n === 1 ? pending[0].name : word}` : `Buy ${n === 1 ? pending[0].name : word}`;
    const btn = isExit ? `Sell all · ${inr(get)}` : buys.length && sells.length ? `Confirm · buy ${inr(pay)}, sell ${inr(get)}` : sells.length ? `Sell · ${inr(get)}` : `Buy · ${inr(pay)}`;
    const over = pay - get > S.cash + (S.baskets.find(b => b.id === pending[0].basketId)?.cash || 0) + 1;
    const setQ = (o, v) => { setQty(x => ({ ...x, [o.id]: v })); act('update_order', { order_id: o.id, qty: v }, { quiet: true }); };
    const confirm = async () => {
      const r = await act('confirm_order', { order_ids: pending.map(o => o.id) }, { quiet: true });
      if (!r?.ok) return;
      closeSheet(); await refresh();
      const ex = r.data.exits?.[0];
      // Selling took the basket below its minimum: the replacement the rules drafted is the next thing to decide, so show it now.
      const bids = new Set(pending.map(o => o.basketId));
      const refill = store.S.orders.filter(o => o.status === 'pending' && o.tag === 'refill' && bids.has(o.basketId) && !s.ids.includes(o.id));
      if (!ex && refill.length) { openSheet({ type: 'review', ids: refill.map(o => o.id), refill: true }); toast(`Sold · replacement suggested: ${refill.map(o => shortName(o.name)).join(', ')}`); return; }
      toast(ex ? `Exited ${ex.name} · ${inr(ex.returnedCash)} back · ${ex.profit >= 0 ? 'profit' : 'loss'} ${inr(Math.abs(ex.profit))}` : `Done · practice cash ${inr(r.data.cash)}`);
    };
    const notNow = () => dismiss();
    // Keep anyway is one tap; the reason is optional and can be added from the toast (it lands in the decision journal).
    const keepAnyway = async () => {
      for (const o of pending) await read('cancel_order', { order_id: o.id, reason: '' });
      closeSheet(); await refresh();
      const j = store.S.journal?.find(x => x.symbol === pending[0].symbol && x.basketId === pending[0].basketId);
      toast(`Kept ${n === 1 ? shortName(pending[0].name) : word} · noted in the decision journal`, j ? { action: 'Add reason', run: () => openSheet({ type: 'journal', entry: j }) } : {});
    };
    return html`<div class="stack" style="gap:16px"><h2>${title}</h2>
      ${isExit && s.exit?.cost ? html`<p class="muted" style="margin:-6px 0 0">About ${inr(back)} back to practice cash · ${back - s.exit.cost >= 0 ? 'profit' : 'loss'} <b class=${cls(back - s.exit.cost)}>${inr(Math.abs(back - s.exit.cost))}</b> on ${inr(s.exit.cost)} put in. The basket and its rules stay.</p>` : null}
      ${pending.some(o => o.tag === 'news_only') && html`<p class="muted" style="margin:-6px 0 0">Based on news, not yet in results. The next quarterly results confirm or clear it. <${Info} k="newsflag"/></p>`}
      <div class="card list" style="padding:2px 16px">${pending.map(o => html`<div class="li orow" key=${o.id}>
        <span class="grow"><span class="t">${o.name}</span><span class="s">${o.side === 'sell' ? 'Sell' : 'Buy'} · ${inr2(o.estPrice)} a share · ${inr(val(o))}</span>${orderWhy(o, true) && !['invest', 'exit', 'rebalance'].includes(o.tag) ? html`<span class="s">${orderWhy(o, true)}</span>` : null}</span>
        ${o.tag === 'exit' ? html`<b class="num">${o.qty} sh</b>` : html`<${QtyEdit} label=${`Shares of ${o.name}`} value=${q(o)} max=${o.side === 'sell' ? o.qty : undefined} onChange=${v => setQ(o, v)}/>`}
        ${n > 1 && html`<button class="iconlink" aria-label=${`Remove ${o.name} from these orders`} onClick=${() => act('cancel_order', { order_id: o.id, reason: 'Removed by you' }, { quiet: true }).then(() => refresh())}>${I.x}</button>`}</div>`)}</div>
      ${s.skipped?.length > 0 && html`<div class="skipnote"><b>Not bought</b>${s.skipped.map(x => html`<span key=${x.symbol}>${x.name}: ${x.why}</span>`)}</div>`}
      ${s.amount ? html`<p class="faint" style="margin:0;font-size:12.5px">${inr(pay)} of ${inr(s.amount)} · the rest stays as practice cash.</p>` : null}
      ${over && html`<span class="down" style="font-size:13px">More than your practice cash (${inr(S.cash)}). Lower a quantity.</span>`}
      <div class="sticky-cta stack" style="gap:6px"><button class="btn primary block" disabled=${over} onClick=${confirm}>${btn}</button>
        ${ruleSell && html`<div class="row" style="gap:8px"><button class="btn" style="flex:1" onClick=${keepAnyway}>Keep anyway</button><${Info} k="keepanyway"/></div>`}
        <button class="linkbtn quietbtn" onClick=${notNow}>Not now</button></div></div>`;
  },

  rebalance({ s }) {
    const [d, setD] = useState(null);
    useEffect(() => { read('rebalance_plan', { basket_id: s.id }).then(r => r.ok && setD(r.data)); }, [s.id]);
    if (!d) return html`<h2>Rebalance</h2><div class="sk" style="height:120px"></div>`;
    if (!d.trades.length) return html`<div class="stack" style="gap:16px"><h2>Nothing to rebalance</h2><p class="muted" style="margin:0">The basket is as close to its targets as whole shares allow.</p><button class="btn primary block" onClick=${closeSheet}>OK</button></div>`;
    const draft = async () => { const r = await act('rebalance_plan', { basket_id: s.id, draft: true }, { quiet: true }); if (r?.ok) { await refresh(); if (r.data.orders.length) openSheet({ type: 'review', ids: r.data.orders.map(o => o.id), drafted: true }); else { closeSheet(); toast('Nothing to rebalance'); } } };
    return html`<div class="stack" style="gap:16px"><h2>Rebalance</h2><p class="muted" style="margin:-6px 0 0">Bring each stock back near its target share.</p>
      <div class="card list" style="padding:2px 16px">${d.trades.map(t => html`<div class="li" key=${t.symbol}><span class="side ${t.side}">${t.side.toUpperCase()}</span><span class="grow"><span class="t">${t.name}</span><span class="s">${t.qty} share${t.qty === 1 ? '' : 's'} · now ${t.actual.toFixed(0)}%, target ${t.target.toFixed(0)}%</span></span><b class="num">${inr(t.est)}</b></div>`)}</div>
      <div class="sticky-cta"><button class="btn primary block" onClick=${draft}>Review orders</button></div></div>`;
  },

  // ---------- flags ----------
  flag({ s }) {
    const S = store.S;
    const f = s.flag;
    const [metric, setMetric] = useState(f?.metric || 'de');
    const [impact, setImpact] = useState(f?.impact || 'worse');
    const [note, setNote] = useState(f?.note || '');
    const left = S.plan === 'pro' ? null : Math.max(0, 3 - S.flagsThisMonth);
    const save = async () => {
      const r = f ? await act('update_news_flag', { flag_id: f.id, note, impact }, { ok: 'Flag updated', quiet: true }) : await act('add_news_flag', { symbol: s.symbol, metric, impact, note }, { quiet: true });
      if (!r?.ok) return;
      await refresh();
      if (!f && r.data.drafted_orders.length) openSheet({ type: 'review', ids: r.data.drafted_orders.map(o => o.id) });
      else { closeSheet(); if (!f) toast('Flagged · next filing confirms or clears it'); }
    };
    return html`<div class="stack" style="gap:14px"><h2>${f ? 'Edit flag' : 'Flag news'}</h2>
      <span class="muted" style="font-size:13px">${s.name} · which number will the news move? <${Info} k="newsflag"/></span>
      <div class="chips" style="flex-wrap:wrap">${S.rules.metrics.map(r => html`<button key=${r.id} disabled=${!!f && f.metric !== r.id} class="chip ${metric === r.id ? 'on' : ''}" onClick=${() => setMetric(r.id)}>${r.label}${r.critical ? ' ★' : ''}</button>`)}</div>
      <div class="seg">${[['worse', 'Likely worse'], ['better', 'Likely better']].map(([v, l]) => html`<button key=${v} class=${impact === v ? 'on' : ''} onClick=${() => setImpact(v)}>${l}</button>`)}</div>
      <div class="field"><label for="fl-note">Headline</label><input class="input" id="fl-note" maxlength="240" placeholder="Borrowings jumped to ₹1,475 crore" value=${note} onInput=${e => setNote(e.target.value)}/></div>
      ${!f && html`<button class="btn small ghost" onClick=${() => copy(`Read this news and flag any FunInvestments metric it affects for ${s.symbol} with add_news_flag:`)}>${I.spark} Copy prompt for Claude</button>`}
      ${left != null && !f && html`<span class="faint" style="font-size:12px">${left} of 3 free flags left this month</span>`}
      <div class="sticky-cta"><button class="btn primary block" onClick=${save}>${f ? 'Save' : 'Flag'}</button></div></div>`;
  },

  // ---------- rules ----------
  rule({ s }) {
    const S = store.S;
    const def = s.scope === 'defaults';
    const b = def ? null : S.baskets.find(x => x.id === s.id);
    const r = (def ? S.rules : b?.rules)?.metrics.find(x => x.id === s.rule);
    const [all, setAll] = useState(false);
    const pro = S.plan === 'pro';
    const [g, setG] = useState(r?.green);
    const [rd, setRd] = useState(r?.red);
    const [wi, setWi] = useState(null);
    useEffect(() => {
      if (!pro || !r || def) return;
      const t = setTimeout(() => read('what_if', { basket_id: b.id, rule_id: r.id, green: g, red: rd }).then(x => x.ok && setWi(x.data)), 250);
      return () => clearTimeout(t);
    }, [g, rd]);
    useEffect(() => { if (!pro) read('track_event', { name: 'upgrade_moment_shown', props: { feature: 'edit thresholds' } }); }, []);
    if (!r) return null;
    // A step that suits the rule's scale: whole numbers for ₹ cr / % rules, finer for ratios.
    const span = Math.abs(r.green - r.red);
    const step = span >= 5 ? 1 : span >= 1 ? 0.5 : span >= 0.4 ? 0.1 : 0.05;
    const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    const fix = v => +(+v).toFixed(dec);
    const lo = Math.min(r.good, r.bad), hi = Math.max(r.good, r.bad);
    const clamp = v => fix(Math.min(hi, Math.max(lo, v)));
    const up = r.dir === 'higher'; // higher numbers are safer
    const valid = up ? g >= rd : g <= rd;
    const u = r.unit === '₹ cr' ? ' cr' : r.unit === 'yrs' ? ' yrs' : r.unit === 'pts' ? ' pts' : r.unit;
    const pre = r.unit === '₹ cr' ? '₹' : '';
    const val = v => `${pre}${v}${u}`;
    const goodTxt = `${up ? 'at or above' : 'at or below'} ${val(g)}`, badTxt = `${up ? 'below' : 'above'} ${val(rd)}`;
    const shift = k => { const d = (up ? 1 : -1) * k * step * 2; setG(clamp(g + d)); setRd(clamp(rd + d)); };
    const changed = g !== r.green || rd !== r.red;
    // Coloured scale: where green, amber and red sit between the rule's extremes.
    // Zoom the scale to the area around the limits so all three colours are visible.
    const sp = Math.max(Math.abs(g - rd), Math.abs(r.green - r.red), step);
    const vlo = Math.max(lo, Math.min(g, rd) - sp * 0.8), vhi = Math.min(hi, Math.max(g, rd) + sp * 0.8);
    const pos = v => Math.min(100, Math.max(0, ((v - vlo) / (vhi - vlo || 1)) * 100));
    const pg = pos(g), pr = pos(rd);
    const band = up
      ? `linear-gradient(90deg, var(--down) 0 ${pr}%, #E7A93B ${pr}% ${pg}%, var(--up) ${pg}% 100%)`
      : `linear-gradient(90deg, var(--up) 0 ${pg}%, #E7A93B ${pg}% ${pr}%, var(--down) ${pr}% 100%)`;
    return html`<div class="stack rulesheet" style="gap:14px"><div class="row between" style="gap:10px"><h2>${r.long}</h2>${r.critical && html`<span class="tag claude" style="flex:none">★ Must-pass</span>`}</div>
      <span class="muted" style="font-size:13px">${def ? 'Default rule for baskets you create from now on (it also rates stocks on Home and Explore). Your existing baskets keep their own rules unless you tick the box below.' : `This basket only: ${b.name}.`} <${Info} k=${r.id}/></span>
      <div class="rband"><div class="rbar" style=${`background:${band}`}></div>
        <div class="rlegend"><span><i class="g"></i>Good ${goodTxt}</span><span><i class="r"></i>Bad ${badTxt}</span></div></div>
      ${pro ? html`
        <div class="rrow"><div><b>Good (green)</b><span class="muted">${up ? 'at or above' : 'at or below'}</span></div><${NumStep} id="rs-g" v=${g} set=${setG} step=${step} clamp=${clamp} label="Good limit"/></div>
        <div class="rrow"><div><b>Bad (red)</b><span class="muted">${up ? 'below' : 'above'}</span></div><${NumStep} id="rs-r" v=${rd} set=${setRd} step=${step} clamp=${clamp} label="Bad limit"/></div>
        <div class="chips"><button class="chip" onClick=${() => shift(1)}>Stricter</button><button class="chip" onClick=${() => shift(-1)}>Looser</button>${changed && html`<button class="chip" onClick=${() => { setG(r.green); setRd(r.red); }}>Undo</button>`}</div>
        ${!valid && html`<span class="down" style="font-size:13px">Good can't be ${up ? 'below' : 'above'} bad.</span>`}
        ${!def && wi && valid ? html`<div class="card stack" style="gap:6px"><b>What changes</b><span class="muted" style="font-size:13px">${wi.changes.length ? wi.changes.slice(0, 6).map(c => `${shortName(c.name)} ${STATUS[c.from][1]} → ${STATUS[c.to][1]}${c.inBasket ? ' (in basket)' : ''}`).join(' · ') : 'No rating changes today'}</span>
          <span class="faint" style="font-size:12px">Past test, good exit calls: ${wi.backtest.before.removalsRight} of ${wi.backtest.before.removalsTotal} → ${wi.backtest.after.removalsRight} of ${wi.backtest.after.removalsTotal}</span></div>` : null}
        ${def && store.S.baskets.length > 0 && html`<label class="row" style="gap:10px;font-size:13.5px;cursor:pointer"><input type="checkbox" checked=${all} onChange=${e => setAll(e.target.checked)}/> Also apply to my ${store.S.baskets.length === 1 ? 'existing basket' : `${store.S.baskets.length} existing baskets`}</label>`}
        <div class="sticky-cta"><button class="btn primary block" disabled=${!valid || (!changed && !(def && all))} onClick=${async () => { const args = def ? { scope: all ? 'all' : 'defaults', rule_id: r.id, green: g, red: rd } : { basket_id: b.id, rule_id: r.id, green: g, red: rd }; const x = await act('set_rule', args, { quiet: true }); if (x?.ok) { closeSheet(); await refresh(); toast(`Saved${def ? ` to ${x.data.applied_to}` : ''} · ${x.data.changed.summary}`, x.data.changed.needs_user ? { action: 'Review', go: 'orders' } : {}); } }}>${changed ? (def && all ? 'Save and apply to my baskets' : 'Save') : def && all ? 'Apply to my baskets' : 'Change a limit to save'}</button></div>`
      : html`<div class="row between proline"><span>🔒 Editing rules is a Pro feature</span><button class="linkbtn" onClick=${() => go('pricing')}>See plans</button></div>`}
    </div>`;
  },

  // ---------- basket menu / edit / delete ----------
  basketmenu({ s }) {
    const b = store.S.baskets.find(x => x.id === s.id);
    if (!b) return null;
    const del = () => deleteBasket(b);
    const S = store.S, pro = S.plan === 'pro';
    const full = !pro && S.baskets.filter(x => x.kind === b.kind).length >= (b.kind === 'model' ? S.planInfo.maxBaskets : S.planInfo.maxTracking);
    const dup = async () => { if (full) { toast(`Free plan: 1 ${b.kind === 'model' ? '' : 'tracking '}basket. Pro has unlimited.`, { action: 'See plans', go: 'pricing' }); return; } const r = await act('duplicate_basket', { basket_id: b.id }, { ok: d => `Duplicated as ${d.basket.name}` }); if (r?.ok) go('basket-' + r.data.basket.id); };
    return html`<div class="stack" style="gap:6px"><h2 style="margin-bottom:6px">${b.name}</h2>
      ${b.kind === 'model' && html`<button class="menuitem" onClick=${() => { closeSheet(); setTimeout(() => window.dispatchEvent(new CustomEvent('fi-tab', { detail: { id: b.id, tab: 'rules' } })), 0); }}>⚙ Edit rules</button>`}
      <button class="menuitem" onClick=${() => openSheet({ type: 'editbasket', id: b.id })}>Edit name, note and theme</button>
      ${b.kind === 'model' && !b.belowMin && html`<button class="menuitem" onClick=${() => openSheet({ type: 'invest', id: b.id })}>${b.isInvested ? 'Invest more' : 'Invest'}</button>`}
      ${b.kind === 'model' && b.isInvested && html`<button class="menuitem" onClick=${() => exitBasket(b)}>Exit basket · sell everything</button>`}
      <button class="menuitem" onClick=${dup}>Duplicate${full ? html` <span class="faint" style="font-size:12px">🔒 Pro</span>` : ''}</button>
      ${pro && html`<button class="menuitem" onClick=${() => confirmDialog({ title: 'Reset rules to default?', body: 'Thresholds, switches and limits go back to your default rules for this basket.', confirm: 'Reset', onConfirm: () => act('reset_rules', { basket_id: b.id }, { ok: 'Rules reset' }) })}>Reset rules</button>`}
      <button class="menuitem danger" onClick=${del}>Delete basket</button></div>`;
  },

  delete({ s }) {
    const b = store.S.baskets.find(x => x.id === s.id), p = s.p;
    if (!b) return null;
    const req = b.deleteRequest;
    const keep = async () => { closeSheet(); if (req) await act('keep_basket', { basket_id: b.id }, { ok: `Kept ${b.name}` }); };
    const done = r => { if (r?.ok) { closeSheet(); go('baskets'); } };
    const sellDelete = async () => done(await act('delete_basket', { basket_id: b.id, sell_all: true }, { ok: d => `Sold and deleted · ${inr(d.returnedCash)} back to practice cash` }));
    const plainDelete = async () => done(await act('delete_basket', { basket_id: b.id }, { ok: 'Deleted' }));
    const why = req && html`<p class="muted" style="margin:0">${req.by === 'claude' ? 'Claude asked to delete it' : 'Asked to delete it'}${req.reason ? `: ${req.reason}` : '.'}</p>`;
    if (!p.holds) return html`<div class="stack" style="gap:16px"><h2>Delete ${b.name}?</h2>${why}
      <p class="muted" style="margin:0">${p.pending ? `Its ${p.pending} waiting order${p.pending === 1 ? '' : 's'} and its alerts go too.` : 'Its rules and alerts go too.'} This can't be undone.</p>
      <div class="sticky-cta stack" style="gap:6px"><button class="btn dangerfill block" onClick=${plainDelete}>Delete basket</button>
        <button class="linkbtn quietbtn" onClick=${keep}>Keep it</button></div></div>`;
    return html`<div class="stack" style="gap:16px"><h2>Delete ${b.name}?</h2>${why}
      <p class="muted" style="margin:0">It still holds ${p.holdings} stock${p.holdings === 1 ? '' : 's'}. To delete it, everything is sold at the last price first.</p>
      <dl class="kv"><dt>Money back (about)</dt><dd>${inr(p.moneyBack)}</dd><dt>${p.profit >= 0 ? 'Profit' : 'Loss'} (about)</dt><dd class=${cls(p.profit)}>${inr(Math.abs(p.profit))}</dd><dt>You put in</dt><dd>${inr(p.cost)}</dd></dl>
      <div class="sticky-cta stack" style="gap:6px"><button class="btn dangerfill block" onClick=${sellDelete}>Sell everything and delete</button>
        <button class="btn block" onClick=${keep}>Keep it</button>
        <button class="linkbtn quietbtn" onClick=${async () => { if (req) await act('keep_basket', { basket_id: b.id }, { quiet: true }); exitBasket(b); }}>Only sell, keep the basket</button></div></div>`;
  },

  editbasket({ s }) {
    const S = store.S;
    const b = S.baskets.find(x => x.id === s.id);
    const [name, setName] = useState(b?.name || '');
    const [desc, setDesc] = useState(b?.description || '');
    const [theme, setTheme] = useState(b?.theme || 'none');
    if (!b) return null;
    const changed = name.trim() !== b.name || desc !== b.description || (theme === 'none' ? null : theme) !== b.theme;
    const save = async () => { const r = await act('update_basket', { basket_id: b.id, name, description: desc, theme: theme === 'none' ? null : theme }, { ok: 'Saved', quiet: true }); if (r?.ok) { closeSheet(); await refresh(); } };
    return html`<div class="stack" style="gap:14px"><h2>Edit basket</h2>
      <div class="field"><label for="eb-name">Name</label><input class="input" id="eb-name" maxlength="40" value=${name} onInput=${e => setName(e.target.value)}/></div>
      ${!name.trim() && html`<span class="down" style="font-size:13px">Name can't be empty.</span>`}
      <div class="field"><label for="eb-desc">Note</label><input class="input" id="eb-desc" maxlength="140" value=${desc} onInput=${e => setDesc(e.target.value)}/></div>
      <div class="field"><label>Theme</label><div class="chips">${[...S.themes.map(t => [t.id, t.label]), ['none', 'None']].map(([v, l]) => html`<button key=${v} class="chip ${theme === v ? 'on' : ''}" onClick=${() => setTheme(v)}>${l}</button>`)}</div>
        <span class="faint" style="font-size:12px">Changing the theme re-scores stocks with its theme-share rule.</span></div>
      <div class="sticky-cta"><button class="btn primary block" disabled=${!changed || !name.trim()} onClick=${save}>Save</button></div></div>`;
  },

  holding({ s }) {
    const S = store.S;
    const [sym, setSym] = useState(s.symbol || '');
    const [qty, setQty] = useState(s.qty ?? '');
    const [avg, setAvg] = useState(s.avg ?? '');
    const known = S.universe.find(x => x.symbol === sym.trim().toUpperCase());
    const save = async () => { const r = await act('set_holding', { basket_id: s.id, symbol: sym, qty: Number(qty), avg_price: Number(avg) }, { ok: 'Holding saved', quiet: true }); if (r?.ok) { closeSheet(); await refresh(); } };
    return html`<div class="stack" style="gap:14px"><h2>${s.symbol ? 'Edit holding' : 'Add holding'}</h2>
      <div class="field"><label for="ho-sym">NSE symbol</label><input class="input mono" id="ho-sym" list="ho-list" value=${sym} disabled=${!!s.symbol} onInput=${e => setSym(e.target.value)}/>
        <datalist id="ho-list">${S.universe.map(x => html`<option key=${x.symbol} value=${x.symbol}>${x.name}</option>`)}</datalist>
        ${sym && !known && html`<span class="down" style="font-size:12.5px">Not in the universe. Add it in Explore first.</span>`}</div>
      <div class="row" style="gap:10px"><div class="field" style="flex:1"><label for="ho-qty">Quantity</label><input class="input num" id="ho-qty" type="number" min="0" value=${qty} onInput=${e => setQty(e.target.value)}/></div>
        <div class="field" style="flex:1"><label for="ho-avg">Avg price ₹</label><input class="input num" id="ho-avg" type="number" min="0" step="0.05" value=${avg} onInput=${e => setAvg(e.target.value)}/></div></div>
      <div class="sticky-cta"><button class="btn primary block" disabled=${!known || !(Number(qty) >= 0) || qty === ''} onClick=${save}>Save</button></div></div>`;
  },

  journal({ s }) {
    const [reason, setReason] = useState(s.entry.reason || '');
    return html`<div class="stack" style="gap:14px"><h2>${s.entry.name} · ${s.entry.action}</h2>
      <span class="muted" style="font-size:13px">${s.entry.rule}</span>
      <div class="field"><label for="jr">Reason</label><input class="input" id="jr" maxlength="200" value=${reason} onInput=${e => setReason(e.target.value)}/></div>
      <div class="row" style="gap:8px"><button class="btn primary" style="flex:1" onClick=${async () => { const r = await act('update_journal', { id: s.entry.id, reason }, { ok: 'Saved' }); if (r?.ok) closeSheet(); }}>Save</button>
        <button class="btn ghost danger" onClick=${() => confirmDialog({ title: 'Delete this journal entry?', body: 'The override itself stays in the activity log.', confirm: 'Delete', danger: true, onConfirm: () => act('delete_journal', { id: s.entry.id }, { ok: 'Deleted' }) })}>Delete</button></div></div>`;
  },

  // ---------- universe ----------
  candidate({ s }) {
    const S = store.S;
    const ex = s.symbol ? S.universe.find(x => x.symbol === s.symbol) : null;
    const [f, setF] = useState({ symbol: ex?.symbol || '', name: ex?.name || '', sector: ex?.sector || 'Energy', stage: ex?.stage || 'power', theme: Object.keys(ex?.themes || { energy: 1 })[0] || 'energy', share: Object.values(ex?.themes || {})[0] ?? 100, price: ex?.price || '', de: '', icr: '', adtv: '', loss: '' });
    const up = (k, v) => setF({ ...f, [k]: v });
    const save = async () => {
      const metrics = {}; for (const k of ['de', 'icr', 'adtv', 'loss']) if (f[k] !== '') metrics[k] = Number(f[k]);
      const r = await act('add_candidate', { symbol: f.symbol, name: f.name, sector: f.sector, stage: f.stage, themes: { [f.theme]: f.share }, price: f.price || undefined, metrics }, { quiet: true });
      if (r?.ok) { closeSheet(); await refresh(); toast(`${r.data.stock.symbol} ${ex ? 'updated' : 'added'} · ${STATUS[r.data.stock.status][1]}`); if (!ex) go('stock-' + r.data.stock.symbol); }
    };
    const sectors = [...new Set(S.universe.map(x => x.sector))].sort();
    return html`<div class="stack" style="gap:14px"><h2>${ex ? `Edit ${ex.symbol}` : 'Add stock'}</h2>
      <div class="row" style="gap:10px"><div class="field" style="flex:1"><label for="cd-sym">NSE symbol</label><input class="input mono" id="cd-sym" value=${f.symbol} disabled=${!!ex} onInput=${e => up('symbol', e.target.value.toUpperCase())} placeholder="VOEPL"/></div>
        <div class="field" style="width:120px"><label for="cd-px">Price ₹</label><input class="input num" id="cd-px" type="number" value=${f.price} onInput=${e => up('price', e.target.value)}/></div></div>
      <div class="field"><label for="cd-name">Name</label><input class="input" id="cd-name" value=${f.name} onInput=${e => up('name', e.target.value)}/></div>
      <div class="row" style="gap:10px"><div class="field" style="flex:1"><label for="cd-sec">Sector</label><select class="input" id="cd-sec" value=${f.sector} onChange=${e => up('sector', e.target.value)}>${sectors.map(x => html`<option key=${x}>${x}</option>`)}</select></div>
        <div class="field" style="flex:1"><label for="cd-stage">Segment</label><select class="input" id="cd-stage" value=${f.stage} onChange=${e => up('stage', e.target.value)}>${S.stages.map(x => html`<option key=${x.id} value=${x.id}>${x.label}</option>`)}</select></div></div>
      <div class="row" style="gap:10px"><div class="field" style="flex:1"><label for="cd-th">Theme</label><select class="input" id="cd-th" value=${f.theme} onChange=${e => up('theme', e.target.value)}>${S.themes.map(t => html`<option key=${t.id} value=${t.id}>${t.label}</option>`)}</select></div>
        <div class="field" style="width:120px"><label for="cd-sh">Share %</label><input class="input num" id="cd-sh" type="number" min="0" max="100" value=${f.share} onInput=${e => up('share', e.target.value)}/></div></div>
      <details class="card"><summary><b>Key numbers</b> <span class="faint" style="font-size:12.5px">optional · missing counts against it</span></summary>
        <div class="grid2" style="margin-top:12px">${[['de', 'Debt / equity'], ['icr', 'Interest cover'], ['adtv', 'Traded value ₹ cr'], ['loss', 'Loss years (5)']].map(([k, l]) => html`<div class="field" key=${k}><label for=${'cd-' + k}>${l}</label><input class="input num" id=${'cd-' + k} type="number" value=${f[k]} onInput=${e => up(k, e.target.value)}/></div>`)}</div></details>
      ${!ex && html`<button class="btn small ghost" onClick=${() => copy(`Research ${f.symbol || 'this stock'} and add it to FunInvestments with add_candidate, including all 13 metrics and its theme share.`)}>${I.spark} Copy prompt for Claude</button>`}
      <div class="sticky-cta"><button class="btn primary block" disabled=${!/^[A-Z0-9&-]{2,20}$/.test(f.symbol)} onClick=${save}>${ex ? 'Save' : 'Add stock'}</button></div></div>`;
  },

  // ---------- misc ----------
  share({ s }) {
    const c = s.data;
    const text = `${c.title} · ${c.rules} rules · past test ${c.years}\nGood exit calls: ${c.removalsRight} of ${c.removalsTotal} dropped stocks then lagged the Nifty 50\n${c.topRules.map(r => `${r.label}: ${r.removed} dropped · ${r.hitRate}% right`).join('\n')}\n${c.disclaimer}`;
    return html`<div class="stack" style="gap:14px"><h2>Share rule stats</h2>
      <div class="card stack" style="gap:10px;border-color:var(--brand)"><div class="row"><${Logo}/><b>${c.title}</b></div>
        <div class="big">${c.removalsRight} of ${c.removalsTotal}</div><span class="muted">good exit calls · ${c.rules} rules · past test ${c.years}</span>
        ${c.topRules.map(r => html`<div class="row between" key=${r.label}><span>${r.label}</span><span class="num">${r.removed} dropped · ${r.hitRate}% right</span></div>`)}
        <span class="faint" style="font-size:11.5px">${c.disclaimer}</span></div>
      <button class="btn primary block" onClick=${() => copy(text)}>Copy text</button></div>`;
  },
  confirm({ s }) {
    return html`<div class="stack" style="gap:14px"><h2>${s.title}</h2><p class="muted" style="margin:0">${s.body}</p>
      <div class="row" style="gap:8px"><button class="btn ghost" style="flex:1" onClick=${closeSheet}>Cancel</button>
        <button class="btn ${s.danger ? 'dangerfill' : 'primary'}" style="flex:1" onClick=${async () => { closeSheet(); await s.onConfirm(); }}>${s.confirm}</button></div></div>`;
  },
  copy({ s }) { return html`<div class="stack" style="gap:14px"><h2>Copy this</h2><textarea class="input" id="copy-box" readonly value=${s.text}></textarea><span class="muted" style="font-size:12.5px">Select the text and copy it.</span></div>`; },
};
