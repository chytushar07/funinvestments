// Bottom sheets: every create / edit / delete flow lives here.
import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { store, act, read, go, openSheet, closeSheet, copy, toast, confirmDialog, refresh } from './store.js';
import { inr, inr2, pct, cls, short, shortName, STATUS, Pill, Src, Avatar, I, Stepper, Logo } from './lib.js';
import { Info, InfoSheet } from './glossary.js';
import { orderWhy } from './pages.js';
export { exitBasket };

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

// Exit = sell everything. Explains, drafts the sells, then the person confirms in the review sheet.
function exitBasket(b) {
  confirmDialog({
    title: `Exit ${b.name}?`,
    body: `All ${b.stocks.filter(x => x.qty > 0).length} holdings are sold at the last price (about ${inr(b.value)}) and the money goes back to your practice cash. Pending orders for this basket are cancelled. The basket and its rules stay, so you can invest again later.`,
    confirm: 'Review sell orders',
    onConfirm: async () => { const r = await act('exit_basket', { basket_id: b.id }, { quiet: true }); if (!r?.ok) return; await refresh(); if (r.data.orders.length) openSheet({ type: 'review', ids: r.data.orders.map(o => o.id), exit: { name: b.name, cost: r.data.costBasis } }); else toast('Nothing to sell'); },
  });
}

const SHEETS = {
  info: InfoSheet,
  // ---------- create basket ----------
  new({ s }) {
    const S = store.S;
    const [name, setName] = useState(s.name || '');
    const [desc, setDesc] = useState('');
    const [theme, setTheme] = useState('auto');
    const [q, setQ] = useState('');
    const [mode, setMode] = useState('pick');
    const [paste, setPaste] = useState('');
    const [pick, setPick] = useState(new Set(s.preset || []));
    const [result, setResult] = useState(null);
    const max = S.planInfo.maxStocks;
    if (result) return html`<div class="stack" style="gap:14px"><h2>${result.basket.name} is ready</h2>
      <div class="row wrap" style="gap:6px"><${Pill} s="pass" n=${result.basket.counts.pass}/>${result.basket.counts.watch ? html`<${Pill} s="watch" n=${result.basket.counts.watch}/>` : null}<span class="tag">${result.basket.count} stocks</span>${result.basket.themeLabel && html`<span class="tag">${result.basket.themeLabel}</span>`}</div>
      ${result.skipped.length > 0 && html`<div class="card list" style="padding:2px 16px">${result.skipped.map(x => html`<div class="li" key=${x.symbol}><span class="grow"><span class="t">${x.name || x.symbol} · skipped</span><span class="s">${x.why}</span></span></div>`)}</div>`}
      <div class="tile"><span class="k">Past test ${result.backtest.years} <${Info} k="goodexits"/></span><span class="v">${result.backtest.removalsRight} of ${result.backtest.removalsTotal}</span><span class="faint" style="font-size:12.5px">stocks these rules dropped then did worse than the Nifty 50</span></div>
      <div class="row" style="gap:8px"><button class="btn primary" style="flex:1" onClick=${() => go('basket-' + result.basket.id)}>Open basket</button><button class="btn ghost" style="flex:1" onClick=${() => openSheet({ type: 'invest', id: result.basket.id })}>Invest ₹</button></div></div>`;
    const list = S.universe.filter(x => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.symbol.toLowerCase().includes(q.toLowerCase()) || x.sector.toLowerCase().includes(q.toLowerCase()));
    const toggle = sym => { const n = new Set(pick); if (n.has(sym)) n.delete(sym); else if (n.size < max) n.add(sym); else { toast(`Max ${max} stocks${S.plan === 'free' ? ' on Free' : ''}`, S.plan === 'free' ? { action: 'See plans', go: 'pricing' } : {}); return; } setPick(n); };
    const symbols = mode === 'pick' ? [...pick] : paste.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
    const create = async () => {
      const r = await act('create_basket', { name: name.trim() || 'My basket', description: desc, symbols, ...(theme === 'auto' ? {} : { theme: theme === 'none' ? null : theme }) }, { quiet: true });
      if (r?.ok) { await refresh(); setResult(r.data); } else if (r?.error?.skipped) toast(`${r.error.message}: ${r.error.skipped.map(x => `${x.symbol} (${x.why})`).join(', ')}`, { err: true });
    };
    const picked = S.universe.filter(x => pick.has(x.symbol));
    return html`<div class="stack" style="gap:14px"><h2>New basket</h2>
      <div class="field"><label for="nb-name">Name</label><input class="input" id="nb-name" placeholder="e.g. Profitable energy" maxlength="40" value=${name} onInput=${e => setName(e.target.value)}/></div>
      <div class="field"><label for="nb-desc">Note <span class="faint">(optional)</span></label><input class="input" id="nb-desc" placeholder="What this basket is for" maxlength="140" value=${desc} onInput=${e => setDesc(e.target.value)}/></div>
      <div class="field"><label>Theme <${Info} k="theme"/></label><div class="chips">${[['auto', 'Auto'], ...S.themes.map(t => [t.id, t.label]), ['none', 'None']].map(([v, l]) => html`<button key=${v} class="chip ${theme === v ? 'on' : ''}" onClick=${() => setTheme(v)}>${l}</button>`)}</div></div>
      <div class="seg">${[['pick', 'Pick stocks'], ['paste', 'Paste symbols']].map(([v, l]) => html`<button key=${v} class=${mode === v ? 'on' : ''} onClick=${() => setMode(v)}>${l}</button>`)}</div>
      ${mode === 'pick' ? html`
        ${picked.length > 0 && html`<div class="chips">${picked.map(x => html`<button key=${x.symbol} class="chip on" onClick=${() => toggle(x.symbol)} aria-label="Remove ${x.name}">${shortName(x.name)} ✕</button>`)}</div>`}
        <input class="input" id="nb-q" placeholder="Search stocks or sector" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search stocks"/>
        <div class="card list pick" style="padding:2px 14px">${list.map(x => html`<button key=${x.symbol} class="li btnrow" aria-pressed=${pick.has(x.symbol)} onClick=${() => toggle(x.symbol)}>
          <${Avatar} name=${x.name} stage=${x.stage}/><span class="grow"><span class="t">${x.name}</span><span class="s">${x.sector} · ${x.points} warnings · profitable ${x.profitableYears} of 5 yrs</span></span><${Pill} s=${x.status}/><span class="check">${pick.has(x.symbol) ? '✓' : ''}</span></button>`)}</div>
        <span class="muted" style="font-size:12.5px">${pick.size} picked · max ${max}. Stocks that fail this basket's rules are skipped and listed.</span>`
      : html`<textarea class="input" id="nb-paste" placeholder="NTPC, POWERGRID, COALINDIA, PETRONET, GAIL, RELIANCE" value=${paste} onInput=${e => setPaste(e.target.value)} aria-label="Symbols"></textarea>`}
      <div class="sticky-cta"><button class="btn primary block" disabled=${!symbols.length} onClick=${create}>Create basket${symbols.length ? ` · ${symbols.length}` : ''}</button></div></div>`;
  },

  tracking() {
    const [name, setName] = useState('My holdings');
    const [csv, setCsv] = useState('');
    const rows = csv.split(/\n+/).map(l => l.split(/[,\t;]+/).map(x => x.trim())).filter(p => p[0]);
    const create = async () => {
      const r = await act('create_basket', { name, kind: 'tracking', holdings: rows.map(([symbol, qty, avg]) => ({ symbol, qty: Number(qty) || 0, avg_price: Number(avg) || undefined })) }, { quiet: true });
      if (r?.ok) { await refresh(); closeSheet(); toast(`${r.data.basket.count} holdings tracked${r.data.skipped.length ? ` · ${r.data.skipped.length} skipped` : ''}`); go('basket-' + r.data.basket.id); }
    };
    return html`<div class="stack" style="gap:14px"><h2>Track real holdings <${Info} k="tracking"/></h2>
      <span class="muted" style="font-size:13px">Rules and alerts run on them. No orders are placed. Sell in your broker.</span>
      <div class="field"><label for="tr-name">Name</label><input class="input" id="tr-name" value=${name} maxlength="40" onInput=${e => setName(e.target.value)}/></div>
      <div class="field"><label for="tr-csv">SYMBOL, QTY, AVG PRICE · one per line</label><textarea class="input" id="tr-csv" placeholder="VOLTAS, 20, 1210\nNTPC, 50, 310" value=${csv} onInput=${e => setCsv(e.target.value)}></textarea></div>
      <div class="sticky-cta"><button class="btn primary block" disabled=${!rows.length} onClick=${create}>Track ${rows.length || ''} holding${rows.length === 1 ? '' : 's'}</button></div></div>`;
  },

  // ---------- add a stock to one of your baskets ----------
  addto({ s }) {
    const S = store.S;
    if (!S.baskets.length) return html`<div class="stack" style="gap:14px"><h2>Add ${shortName(s.name)}</h2><span class="muted">You have no baskets yet.</span><button class="btn primary block" onClick=${() => openSheet({ type: 'new', preset: [s.symbol] })}>Create basket with it</button></div>`;
    return html`<div class="stack" style="gap:14px"><h2>Add ${shortName(s.name)} to</h2>
      <div class="card list" style="padding:2px 16px">${S.baskets.map(b => { const inIt = b.stocks.some(x => x.symbol === s.symbol); return html`<div class="li" key=${b.id}><span class="grow"><span class="t">${b.name}</span><span class="s">${b.count} stocks${b.themeLabel ? ' · ' + b.themeLabel : ''}${b.kind === 'tracking' ? ' · tracking' : ''}</span></span>
        ${inIt ? html`<span class="tag">Added</span>` : html`<button class="btn small" onClick=${() => act('add_stock', { basket_id: b.id, symbol: s.symbol }, { ok: `Added to ${b.name}` })}>Add</button>`}</div>`; })}</div>
      <button class="btn ghost block" onClick=${() => openSheet({ type: 'new', preset: [s.symbol] })}>+ New basket with it</button></div>`;
  },

  addstocks({ s }) {
    const S = store.S;
    const b = S.baskets.find(x => x.id === s.id);
    const [q, setQ] = useState('');
    if (!b) return null;
    const have = new Set(b.stocks.map(x => x.symbol));
    const list = S.universe.filter(x => !have.has(x.symbol)).filter(x => !b.theme || x.themes?.[b.theme] != null || q).filter(x => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.symbol.toLowerCase().includes(q.toLowerCase()));
    return html`<div class="stack" style="gap:14px"><h2>Add to ${b.name}</h2>
      <input class="input" id="as-q" placeholder=${b.theme ? `Search ${b.themeLabel} stocks (type to search all)` : 'Search stocks'} value=${q} onInput=${e => setQ(e.target.value)} aria-label="Search"/>
      <div class="card list pick" style="padding:2px 14px">${list.map(x => html`<div class="li" key=${x.symbol}><${Avatar} name=${x.name} stage=${x.stage}/><span class="grow"><span class="t">${x.name}</span><span class="s">${x.sector} · ${x.points} warnings</span></span><${Pill} s=${x.status}/>
        <button class="btn small" onClick=${() => act('add_stock', { basket_id: b.id, symbol: x.symbol }, { ok: `${shortName(x.name)} added` })}>Add</button></div>`)}</div>
      <span class="faint" style="font-size:12px">${b.count} of ${b.limits.maxStocks} · status shown uses the default rules; this basket's own rules decide when you tap Add.</span></div>`;
  },

  // ---------- orders ----------
  invest({ s }) {
    const S = store.S;
    const b = S.baskets.find(x => x.id === s.id);
    const [amt, setAmt] = useState(50000);
    if (!b) return null;
    const avail = S.cash + b.cash;
    const draft = async () => { const r = await act('create_order', { basket_id: b.id, side: 'buy', amount: Number(amt) }, { quiet: true }); if (r?.ok) { await refresh(); openSheet({ type: 'review', ids: r.data.orders.map(o => o.id), drafted: true }); } };
    return html`<div class="stack" style="gap:14px"><h2>Invest in ${b.name}</h2>
      <div class="chips">${[10000, 25000, 50000].map(v => html`<button key=${v} class="chip ${+amt === v ? 'on' : ''}" onClick=${() => setAmt(v)}>${inr(v)}</button>`)}</div>
      <div class="field"><label for="inv-amt">Amount</label><input class="input num" id="inv-amt" type="number" inputmode="numeric" min="1" value=${amt} onInput=${e => setAmt(e.target.value)}/></div>
      ${+amt > avail && html`<span class="down" style="font-size:13px">More than your practice cash (${inr(avail)}).</span>`}
      <dl class="kv"><dt>Practice cash <${Info} k="practice"/></dt><dd>${inr(avail)}</dd><dt>How it's split</dt><dd>Equal shares · Hold stocks max ${b.limits.maxWatchWeight}%</dd></dl>
      <div class="sticky-cta"><button class="btn primary block" disabled=${!(+amt > 0) || +amt > avail} onClick=${draft}>Preview orders</button></div></div>`;
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
      <div class="sticky-cta"><button class="btn primary block" onClick=${draft}>Preview</button></div></div>`;
  },

  review({ s }) {
    const S = store.S;
    const [reason, setReason] = useState('');
    const orders = s.ids.map(id => S.orders.find(o => o.id === id)).filter(Boolean);
    const pending = orders.filter(o => o.status === 'pending');
    if (!pending.length) return html`<div class="stack" style="gap:14px"><h2>Nothing to confirm</h2><span class="muted">These orders are already filled or cancelled.</span><button class="btn primary block" onClick=${closeSheet}>Close</button></div>`;
    const total = pending.reduce((t, o) => t + o.estValue * (o.side === 'buy' ? 1 : -1), 0);
    const ruleSell = pending.some(o => o.side === 'sell' && (o.tag === 'rules' || o.tag === 'news_only'));
    const confirm = async () => {
      const r = await act('confirm_order', { order_ids: pending.map(o => o.id) }, { quiet: true });
      if (!r?.ok) return;
      closeSheet(); await refresh();
      const ex = r.data.exits?.[0];
      toast(ex ? `Exited ${ex.name} · ${inr(ex.returnedCash)} back to practice cash · ${ex.profit >= 0 ? 'profit' : 'loss'} ${inr(Math.abs(ex.profit))}` : `${r.data.filled.length} order${r.data.filled.length > 1 ? 's' : ''} done · practice cash ${inr(r.data.cash)}`);
    };
    const cancelAll = async keep => { for (const o of pending) await read('cancel_order', { order_id: o.id, reason: keep ? (reason || 'Kept anyway') : 'Cancelled by you' }); closeSheet(); await refresh(); toast(keep ? 'Kept · saved to journal' : 'Cancelled'); };
    const isExit = !!s.exit || pending.every(o => o.tag === 'exit');
    const proceeds = pending.filter(o => o.side === 'sell').reduce((t, o) => t + o.estValue, 0);
    return html`<div class="stack" style="gap:14px"><div class="row between"><h2>${isExit ? `Sell everything in ${s.exit?.name || 'this basket'}` : `Confirm ${pending.length} order${pending.length > 1 ? 's' : ''}`}</h2><${Src} s=${pending[0].source}/></div>
      ${isExit && html`<div class="tiles"><div class="tile"><span class="k">Money back (about)</span><span class="v">${inr(proceeds)}</span></div>${s.exit?.cost ? html`<div class="tile"><span class="k">Profit / loss (about)</span><span class="v ${cls(proceeds - s.exit.cost)}">${proceeds - s.exit.cost >= 0 ? '+' : '−'}${inr(Math.abs(proceeds - s.exit.cost))}</span></div>` : null}</div>`}
      ${pending.some(o => o.tag === 'news_only') && html`<div class="why" style="margin:0"><span><b>Based on news, not yet in results.</b> The next quarterly results confirm or clear it. <${Info} k="newsflag"/></span></div>`}
      <div class="card list" style="padding:2px 16px">${pending.map(o => html`<div class="li" key=${o.id}><span class="side ${o.side}">${o.side.toUpperCase()}</span><span class="grow"><span class="t">${o.name}</span><span class="s">× ${inr2(o.estPrice)}${orderWhy(o, o.tag === 'news_only') ? ` · ${orderWhy(o, o.tag === 'news_only')}` : ''}</span></span>
        ${o.tag === 'exit' ? html`<b class="num">${o.qty} sh</b>` : html`<${Stepper} label="Quantity for ${o.name}" value=${o.qty} min=${1} max=${o.side === 'sell' ? o.qty : 9999} onChange=${v => act('update_order', { order_id: o.id, qty: v })}/>`}
        <button class="iconlink" aria-label="Cancel ${o.name}" onClick=${() => act('cancel_order', { order_id: o.id, reason: 'Cancelled by you' }, { ok: 'Order cancelled' })}>${I.x}</button></div>`)}</div>
      <dl class="kv"><dt>${total >= 0 ? 'You pay (about)' : 'You get (about)'}</dt><dd>${inr(Math.abs(total))}</dd><dt>Practice cash now <${Info} k="practice"/></dt><dd>${inr(S.cash)}</dd><dt>Price used</dt><dd>Last close ± 0.1%</dd></dl>
      ${ruleSell && html`<div class="field"><label for="keep-reason">Keep anyway? Add a reason <${Info} k="keepanyway"/></label><input class="input" id="keep-reason" placeholder="e.g. Debt is for a new plant" value=${reason} onInput=${e => setReason(e.target.value)}/></div>`}
      <div class="sticky-cta stack" style="gap:8px"><button class="btn primary block" onClick=${confirm}>Confirm</button>
        <button class="btn ghost block" onClick=${() => cancelAll(ruleSell)}>${ruleSell ? 'Keep anyway' : 'Cancel all'}</button></div></div>`;
  },

  rebalance({ s }) {
    const [d, setD] = useState(null);
    useEffect(() => { read('rebalance_plan', { basket_id: s.id }).then(r => r.ok && setD(r.data)); }, [s.id]);
    if (!d) return html`<h2>Rebalance</h2><div class="sk" style="height:120px"></div>`;
    const draft = async () => { const r = await act('rebalance_plan', { basket_id: s.id, draft: true }, { quiet: true }); if (r?.ok) { await refresh(); if (r.data.orders.length) openSheet({ type: 'review', ids: r.data.orders.map(o => o.id), drafted: true }); else { closeSheet(); toast('Already on target'); } } };
    return html`<div class="stack" style="gap:14px"><h2>Rebalance</h2><div class="tablewrap"><table><thead><tr><th>Stock</th><th>Now</th><th>Target</th><th>Change</th></tr></thead><tbody>
      ${d.rows.map(r => html`<tr key=${r.symbol}><td>${shortName(r.name)}</td><td>${r.actual.toFixed(1)}%</td><td>${r.target.toFixed(1)}%</td><td class=${cls(-r.diff)}>${r.diff > 0 ? '−' : '+'}${Math.abs(r.diff).toFixed(1)}</td></tr>`)}</tbody></table></div>
      <div class="sticky-cta"><button class="btn primary block" onClick=${draft}>Draft orders</button></div></div>`;
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
    const lo0 = Math.min(r.good, r.bad), hi0 = Math.max(r.good, r.bad), step = (hi0 - lo0) > 50 ? 1 : (hi0 - lo0) > 5 ? 0.5 : 0.05;
    // Snap the range to whole steps so the slider only lands on round values (no "60.2").
    const lo = Math.floor(lo0 / step) * step, hi = Math.ceil(hi0 / step) * step;
    const valid = r.dir === 'higher' ? g >= rd : g <= rd;
    const unit = r.unit === '%' ? '%' : r.unit === '×' ? '×' : '';
    return html`<div class="stack" style="gap:14px"><div class="row between"><h2>${r.long}</h2>${r.critical && html`<span class="tag claude">★ Must-pass</span>`}</div>
      <span class="muted" style="font-size:13px">${def ? 'Default rule: new baskets start with it, and it rates stocks on Home and Explore.' : `Applies to ${b.name} only.`} <${Info} k=${r.id}/></span>
      ${!pro && html`<div class="card row between" style="gap:10px;padding:10px 12px;border-color:color-mix(in oklab,var(--brand) 45%,var(--line))"><span style="font-size:13px"><b>🔒 Limits are a Pro feature.</b> On Free you can switch this rule on or off. In this demo, tap Pro on Home to try it.</span><button class="btn small primary" onClick=${() => go('home')}>Try Pro</button></div>`}
      <div class="field"><label for="rs-g">Green ${r.dir === 'higher' ? 'at or above' : 'at or below'} <b class="num">${g}${unit}</b></label><input type="range" id="rs-g" min=${lo} max=${hi} step=${step} value=${g} disabled=${!pro} onInput=${e => setG(+Number(e.target.value).toFixed(2))}/></div>
      <div class="field"><label for="rs-r">Red ${r.dir === 'higher' ? 'below' : 'above'} <b class="num">${rd}${unit}</b></label><input type="range" id="rs-r" min=${lo} max=${hi} step=${step} value=${rd} disabled=${!pro} onInput=${e => setRd(+Number(e.target.value).toFixed(2))}/></div>
      ${!valid && html`<span class="down" style="font-size:13px">Green can't be ${r.dir === 'higher' ? 'below' : 'above'} red.</span>`}
      ${pro ? (wi && valid ? html`<div class="card stack" style="gap:6px"><b>What if</b><span class="muted" style="font-size:13px">${wi.changes.length ? wi.changes.slice(0, 6).map(c => `${shortName(c.name)} ${STATUS[c.from][1]} → ${STATUS[c.to][1]}${c.inBasket ? ' (in basket)' : ''}`).join(' · ') : 'No status changes today'}</span>
          <span class="faint" style="font-size:12px">Past test, good exit calls: ${wi.backtest.before.removalsRight} of ${wi.backtest.before.removalsTotal} → ${wi.backtest.after.removalsRight} of ${wi.backtest.after.removalsTotal}</span></div>` : null)
        : null}
      ${def && pro && store.S.baskets.length > 0 && html`<label class="row" style="gap:10px;font-size:13.5px;cursor:pointer"><input type="checkbox" checked=${all} onChange=${e => setAll(e.target.checked)}/> Also apply to all ${store.S.baskets.length} of my baskets</label>`}
      <div class="sticky-cta"><button class="btn primary block" disabled=${!pro || !valid || (g === r.green && rd === r.red)} onClick=${async () => { const args = def ? { scope: all ? 'all' : 'defaults', rule_id: r.id, green: g, red: rd } : { basket_id: b.id, rule_id: r.id, green: g, red: rd }; const x = await act('set_rule', args, { quiet: true }); if (x?.ok) { closeSheet(); await refresh(); toast(def ? `Saved to ${x.data.applied_to}` : `Saved · ${x.data.changed.length} status change${x.data.changed.length === 1 ? '' : 's'}`); } }}>Save</button></div></div>`;
  },

  // ---------- basket menu / edit / delete ----------
  basketmenu({ s }) {
    const b = store.S.baskets.find(x => x.id === s.id);
    if (!b) return null;
    const del = () => confirmDialog({
      title: `Delete ${b.name}?`,
      body: b.kind === 'model' && b.isInvested ? `Its holdings are sold at the last price and about ${inr(b.value)} goes back to your practice cash. Pending orders are cancelled. This can't be undone.` : 'Pending orders and alerts for it are removed. This can\'t be undone.',
      confirm: 'Delete basket', danger: true,
      onConfirm: async () => { const r = await act('delete_basket', { basket_id: b.id }, { ok: d => `Deleted${d.returnedCash ? ` · ${inr(d.returnedCash)} back to cash` : ''}` }); if (r?.ok) go('baskets'); },
    });
    const dup = async () => { const r = await act('duplicate_basket', { basket_id: b.id }, { ok: 'Duplicated' }); if (r?.ok) go('basket-' + r.data.basket.id); };
    return html`<div class="stack" style="gap:6px"><h2 style="margin-bottom:6px">${b.name}</h2>
      ${b.kind === 'model' && html`<button class="menuitem" onClick=${() => { closeSheet(); setTimeout(() => window.dispatchEvent(new CustomEvent('fi-tab', { detail: { id: b.id, tab: 'rules' } })), 0); }}>⚙ Edit rules</button>`}
      <button class="menuitem" onClick=${() => openSheet({ type: 'editbasket', id: b.id })}>Edit name, note and theme</button>
      ${b.kind === 'model' && html`<button class="menuitem" onClick=${() => openSheet({ type: 'invest', id: b.id })}>Invest ₹</button>`}
      ${b.kind === 'model' && b.isInvested && html`<button class="menuitem" onClick=${() => exitBasket(b)}>Exit basket · sell everything</button>`}
      <button class="menuitem" onClick=${dup}>Duplicate</button>
      <button class="menuitem" onClick=${() => confirmDialog({ title: 'Reset rules to default?', body: 'Thresholds, switches and limits go back to the defaults for this basket.', confirm: 'Reset', onConfirm: () => act('reset_rules', { basket_id: b.id }, { ok: 'Rules reset' }) })}>Reset rules</button>
      <button class="menuitem danger" onClick=${del}>Delete basket</button></div>`;
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
