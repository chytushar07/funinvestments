// FunInvestments engine: one backend, two doors.
// The website (actor "you") and MCP/Claude (actor "claude") both call dispatch().
// Plain deterministic code. No AI anywhere.
import { defaultRuleSet, scoreStock, band, labelOf, DEFAULT_RULES, fmtThreshold } from './rules.js';
import { buildHistory, buildPriceHistory, buildUniverse, SEED_PRICES, SEED_PREV, NIFTY_SEED, NIFTY_PREV, FILINGS, STOCKS, STAGES, THEMES } from './data.js';
import { MockProvider } from './market.js';
import { backtest } from './scorecard.js';

export const HISTORY = buildHistory();
export const PRICE_HISTORY = buildPriceHistory(HISTORY);
const NAMES = Object.fromEntries(STOCKS.map(s => [s.symbol, s.name]));
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.id, s.label]));
const THEME_LABEL = Object.fromEntries(THEMES.map(t => [t.id, t.label]));

// Pro prices in ₹ (one source for the website, tooltips and Claude's upgrade hint)
export const PRICES = { monthly: 499, quarterly: 1349, yearly: 4499 };
export const PRICE_TEXT = 'Pro is ₹499/month, ₹1,349/quarter or ₹4,499/year, for unlimited baskets';
export const PLANS = {
  free: { label: 'Free', maxBaskets: 1, maxTracking: 1, maxStocks: 8, flagsPerMonth: 3, checks: 'weekly' },
  pro: { label: 'Pro', maxBaskets: Infinity, maxTracking: Infinity, maxStocks: 12, flagsPerMonth: Infinity, checks: 'daily' },
};
export const DEFAULT_LIMITS = { minStocks: 6, maxStocks: 12, maxStockWeight: 20, maxStageWeight: 40, maxWatchWeight: 10, driftTrigger: 5, minTheme: 20 };
export const COOLDOWN_DAYS = 90;
export const SLIPPAGE = 0.001;
export const LIQUIDITY_CAP = 0.05;

export class ApiError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}
const FREE_ALTERNATIVE = {
  'more baskets': 'On Free you have 1 basket: add the stocks to the existing basket, or exit and delete it first.',
  'more tracking baskets': 'On Free you have 1 tracking basket: add holdings to it instead.',
  'custom thresholds': 'On Free, create the basket with the default rules; turning rules on or off is free.',
  'edit thresholds': 'On Free, keep the default limits; you can still turn rules on or off.',
  'Claude editing your rules': 'On Free the user turns rules on or off themselves in the website: Settings → Default rules, or a basket → ⚙ Edit rules. With Pro, Claude can change default and basket rules.',
  'event rules': 'Company-event rules need Pro; the 13 core rules work on Free.',
  'basket limits': 'On Free, basket limits stay at their defaults.',
  'what-if': 'Previewing rule changes needs Pro.',
  'share card': 'Sharing rule results needs Pro.',
  'push and email alerts': 'On Free, urgent alerts still arrive as browser notifications; other alerts show in the app.',
};
const proError = feature => new ApiError('pro_feature', `Pro feature: ${feature}`, {
  upgrade: '#pricing', feature,
  free_alternative: FREE_ALTERNATIVE[feature] || (feature.startsWith('more than') ? 'Free allows fewer of these; Pro removes the limit.' : 'Available on Free in a simpler form.'),
  how_to_upgrade: PRICE_TEXT + '. In this demo the user can switch plans on the FunInvestments Home page (no payment).',
});

// ---------------- state ----------------
export function createState() {
  return {
    v: 4, seq: 1, clock: '2026-09-01', tradingDay: 0, plan: 'free',
    user: { name: 'Tushar', apiKey: 'fi_demo_7f3a9c21' },
    cash: 100000, startingCash: 100000,
    rules: defaultRuleSet(), universe: buildUniverse(),
    prices: { ...SEED_PRICES }, prevPrices: { ...SEED_PREV }, nifty: NIFTY_SEED, niftyPrev: NIFTY_PREV,
    baskets: [], orders: [], alerts: [], flags: [], journal: [], decisions: [], events: [], activity: [],
    filings: FILINGS.map(f => ({ ...f, applied: false })),
    notif: { push: false, email: false, critical: true },
    onboarded: false, claudeConnected: false, lastClaudeCall: null,
  };
}
export function provider(st) { const p = new MockProvider(st); Object.defineProperty(st, '__priceHistory', { value: PRICE_HISTORY, enumerable: false, configurable: true }); return p; }

const nid = (st, p) => `${p}${st.seq++}`;
const isPro = st => st.plan === 'pro';
const plan = st => PLANS[st.plan];
const r2 = v => Math.round(v * 100) / 100;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const fmtINR = v => '₹' + Math.round(v).toLocaleString('en-IN');
const monthKey = d => d.slice(0, 7);
const upper = s => String(s ?? '').trim().toUpperCase();

export function track(st, name, props = {}) {
  st.events.push({ name, props, at: st.clock, i: st.events.length });
  if (st.events.length > 500) st.events.shift();
}

// Score a stock inside a basket (its rules + theme) or against the default rules.
function scoreIn(st, b, sym, prev) {
  const u = st.universe[sym];
  if (!u) return null;
  if (!b) return scoreStock(u, st.rules);
  return scoreStock(u, b.rules, { prevStatus: prev, theme: b.theme, minTheme: b.limits.minTheme });
}
function getBasket(st, id) {
  const b = st.baskets.find(x => x.id === id) || (st.baskets.length === 1 && !id ? st.baskets[0] : null);
  if (!b) throw new ApiError('not_found', id ? `No basket "${id}"` : 'Pass basket_id (get_basket_status lists them)');
  return b;
}

// Which rule sets an edit touches. scope: 'basket' (one basket), 'defaults' (the rules new baskets start with,
// also used to rate stocks in Explore) or 'all' (defaults + every basket). With no scope: a named basket, else
// the only basket, else the defaults, so a user with no baskets can still change their rules.
function ruleTargets(st, a) {
  const scope = a.scope || (a.basket_id || st.baskets.length === 1 ? 'basket' : 'defaults');
  if (scope === 'defaults') return { scope, sets: [st.rules], baskets: [] };
  if (scope === 'all') return { scope, sets: [st.rules, ...st.baskets.map(b => b.rules)], baskets: [...st.baskets] };
  if (scope !== 'basket') throw new ApiError('bad_scope', 'scope must be basket, defaults or all');
  const b = getBasket(st, a.basket_id);
  return { scope, sets: [b.rules], baskets: [b] };
}
const scopeText = (t, st) => t.scope === 'defaults' ? 'default rules (new baskets + stock ratings)' : t.scope === 'all' ? `default rules and all ${t.baskets.length} basket${t.baskets.length === 1 ? '' : 's'}` : `"${t.baskets[0].name}"`;
function addAlert(st, a) {
  const alert = { id: nid(st, 'a'), date: st.clock, read: false, critical: false, ...a };
  st.alerts.unshift(alert);
  if (st.alerts.length > 300) st.alerts.length = 300;
  return alert;
}
function logDecision(st, d) { st.decisions.unshift({ id: nid(st, 'd'), date: st.clock, price: st.prices[d.symbol], nifty: st.nifty, ...d }); if (st.decisions.length > 500) st.decisions.length = 500; }
function inferTheme(st, symbols) {
  for (const t of THEMES) if (symbols.length && symbols.every(s => st.universe[s]?.themes?.[t.id] != null)) return t.id;
  return null;
}
function profitableYears(u) {
  const ago = u.lossAgo || [];
  let n = 0; while (n < 5 && !ago.includes(n)) n++;
  return n;
}
function candidatesFor(st, b) {
  if (b.theme) return Object.values(st.universe).filter(u => u.themes?.[b.theme] != null);
  const sectors = new Set(b.symbols.map(s => st.universe[s]?.sector));
  return Object.values(st.universe).filter(u => sectors.has(u.sector));
}

// ---------------- weights & refill ----------------
export function targetWeights(st, basket, symbols = basket.symbols) {
  const L = basket.limits;
  const statuses = Object.fromEntries(symbols.map(s => [s, scoreIn(st, basket, s, basket.statusPrev[s])?.status || 'watch']));
  const active = symbols.filter(s => statuses[s] !== 'remove');
  const w = {};
  if (!active.length) return { weights: w, cash: 100, statuses };
  const eq = 100 / active.length;
  for (const s of active) w[s] = Math.min(eq, statuses[s] === 'watch' ? L.maxWatchWeight : L.maxStockWeight);
  let left = 100 - Object.values(w).reduce((a, b) => a + b, 0);
  for (let i = 0; i < 5 && left > 0.01; i++) {
    const room = active.filter(s => statuses[s] === 'pass' && w[s] < L.maxStockWeight);
    if (!room.length) break;
    const per = left / room.length;
    for (const s of room) { const add = Math.min(per, L.maxStockWeight - w[s]); w[s] += add; left -= add; }
  }
  for (const s of active) w[s] = r2(w[s]);
  return { weights: w, cash: r2(Math.max(0, left)), statuses };
}
function stageWeights(st, weights) {
  const out = {};
  for (const [s, w] of Object.entries(weights)) { const g = st.universe[s]?.stage || 'other'; out[g] = r2((out[g] || 0) + w); }
  return out;
}

export function refillPlan(st, basket) {
  const L = basket.limits;
  const need = L.minStocks - basket.symbols.length;
  const res = { needed: Math.max(0, need), picks: [], skipped: [], short: 0 };
  if (need <= 0) return res;
  const held = new Set(basket.symbols);
  const cands = candidatesFor(st, basket)
    .filter(u => !held.has(u.symbol) && st.prices[u.symbol] != null)
    .map(u => ({ u, s: scoreIn(st, basket, u.symbol) }))
    .filter(x => x.s.status !== 'remove');
  const cooled = c => basket.removedAt[c.u.symbol] && daysBetween(basket.removedAt[c.u.symbol], st.clock) < COOLDOWN_DAYS;
  let current = [...basket.symbols];
  for (const tier of ['pass', 'watch']) {
    const list = cands.filter(c => c.s.status === tier)
      .sort((a, b) => a.s.points - b.s.points || (b.u.metrics.adtv ?? 0) - (a.u.metrics.adtv ?? 0));
    for (const c of list) {
      if (res.picks.length >= need) break;
      if (cooled(c)) { res.skipped.push({ symbol: c.u.symbol, name: c.u.name, tier, why: 'Sold in the last 90 days (cool-down)' }); continue; }
      const trial = [...current, c.u.symbol];
      const sw = stageWeights(st, targetWeights(st, basket, trial).weights);
      if ((sw[c.u.stage] || 0) > L.maxStageWeight + 0.01) { res.skipped.push({ symbol: c.u.symbol, name: c.u.name, tier, why: `${STAGE_LABEL[c.u.stage] || c.u.stage} already at its ${L.maxStageWeight}% limit` }); continue; }
      res.picks.push({ symbol: c.u.symbol, name: c.u.name, tier, points: c.s.points, stage: c.u.stage, why: tier === 'pass' ? `Buy · ${c.s.points} warnings` : `Hold · ${c.s.points} warnings · max ${L.maxWatchWeight}% of basket` });
      current = trial;
    }
  }
  res.short = need - res.picks.length;
  if (res.short > 0) res.prompt = `Find ${res.short} more ${basket.theme ? THEME_LABEL[basket.theme] + ' ' : ''}stock${res.short > 1 ? 's' : ''} for my "${basket.name}" basket in FunInvestments and add them with add_candidate.`;
  return res;
}

function basketValue(st, b) {
  let v = b.cash;
  for (const [s, h] of Object.entries(b.holdings)) v += h.qty * (st.prices[s] ?? h.avg);
  return v;
}
const invested = b => Object.values(b.holdings).some(h => h.qty > 0);

function ensureRefill(st, b) {
  if (b.kind !== 'model' || b.symbols.length >= b.limits.minStocks) return null;
  if (st.orders.some(o => o.basketId === b.id && o.status === 'pending' && o.tag === 'refill')) return null;
  const p = refillPlan(st, b);
  const why = [...p.picks.map(x => `Pick ${x.name}: ${x.why}`), ...p.skipped.slice(0, 3).map(x => `Skipped ${x.name}: ${x.why}`)];
  const orders = [];
  if (!invested(b)) {
    for (const x of p.picks) { b.symbols.push(x.symbol); b.statusPrev[x.symbol] = scoreIn(st, b, x.symbol).status; logDecision(st, { basketId: b.id, symbol: x.symbol, action: 'refill_add', trigger: x.why, source: 'rules' }); }
  } else if (p.picks.length) {
    const value = basketValue(st, b);
    const tw = targetWeights(st, b, [...b.symbols, ...p.picks.map(x => x.symbol)]);
    let budget = b.cash + st.cash;
    for (const x of p.picks) {
      const px = st.prices[x.symbol];
      const qty = Math.floor(Math.min(budget, (value * (tw.weights[x.symbol] || 0)) / 100) / px);
      if (qty < 1) continue;
      budget -= qty * px;
      orders.push(makeOrder(st, { basketId: b.id, symbol: x.symbol, side: 'buy', qty, source: 'rules', tag: 'refill', addOnFill: true, reason: `Replacement: ${x.why}` }));
    }
  }
  if (p.picks.length || p.short) {
    addAlert(st, {
      basketId: b.id, type: 'refill',
      text: p.picks.length ? `${b.name} has ${b.symbols.length} stock${b.symbols.length === 1 ? '' : 's'} (needs ${b.limits.minStocks}) · replacement ${invested(b) ? 'ready to review' : 'added'}` : `${b.name} has ${b.symbols.length} stock${b.symbols.length === 1 ? '' : 's'} (needs ${b.limits.minStocks}) · find new ones`,
      why: [...why, ...(p.short ? [`${p.short} slot(s) kept as cash for now`] : [])],
      action: orders.length ? { kind: 'orders', ids: orders.map(o => o.id) } : p.short ? { kind: 'claude', prompt: p.prompt } : null,
    });
  }
  return { plan: p, orders };
}

// ---------------- orders ----------------
function makeOrder(st, o) {
  const px = st.prices[o.symbol];
  const order = { id: nid(st, 'o'), status: 'pending', createdAt: st.clock, estPrice: px, estValue: r2(px * o.qty), name: st.universe[o.symbol]?.name || o.symbol, tag: o.tag || 'manual', ...o };
  st.orders.unshift(order);
  return order;
}

// The ONLY fill path. Swap the body for a broker API in v2.
export function execute(order, quote, adtvCr) {
  if (!quote) throw new ApiError('no_quote', `No price for ${order.symbol}`);
  const price = r2(quote.price * (order.side === 'buy' ? 1 + SLIPPAGE : 1 - SLIPPAGE));
  const value = r2(price * order.qty);
  const cap = (adtvCr ?? 0) * 1e7 * LIQUIDITY_CAP;
  if (adtvCr != null && value > cap) throw new ApiError('liquidity', `Order is above 5% of ${order.symbol}'s daily traded value (${fmtINR(cap)})`);
  return { price, value };
}

// ---------------- checks (scheduler) ----------------
const DAILY_RULES = new Set(DEFAULT_RULES.filter(r => r.cadence === 'daily').map(r => r.id));
const STATUS_LABEL = { pass: '✓ Buy', watch: '= Hold', remove: '✕ Sell' };
const STATUS_WORD = { pass: 'Buy', watch: 'Hold', remove: 'Sell' };

export function checkBasket(st, b, kind) {
  const changes = [];
  for (const sym of [...b.symbols]) {
    const prev = b.statusPrev[sym];
    const s = scoreIn(st, b, sym, prev);
    if (!s) continue;
    const toRemove = s.status === 'remove' && prev !== 'remove';
    if (toRemove && !s.lowTheme && s.criticalReds.length && s.criticalReds.every(id => DAILY_RULES.has(id)) && kind !== 'rules') {
      b.strikes[sym] = (b.strikes[sym] || 0) + 1;
      if (b.strikes[sym] < 2) {
        addAlert(st, { basketId: b.id, symbol: sym, type: 'strike', text: `${st.universe[sym].name} · ${labelOf(s.criticalReds[0])} dipped below the limit`, why: [`First time below the limit. The app acts only if it happens again at the next check, to avoid reacting to one bad day.`] });
        continue;
      }
    } else if (!toRemove) b.strikes[sym] = 0;
    if (s.status === prev) continue;
    if (!isPro(st) && kind === 'daily' && !toRemove) continue; // Free: weekly, except critical
    b.statusPrev[sym] = s.status;
    b.strikes[sym] = 0;
    const name = st.universe[sym].name;
    changes.push({ symbol: sym, from: prev, to: s.status });
    logDecision(st, { basketId: b.id, symbol: sym, action: `status_${s.status}`, from: prev, trigger: s.reasons[0], source: 'rules' });
    const why = [s.reasons.join(' · '), ...ruleLines(st, b, sym).filter(l => l.band === 'red' || l.band === 'amber').map(l => `${l.label}: ${l.valueText} (${l.band})`)];
    if (s.status === 'remove') {
      const h = b.holdings[sym];
      if (b.kind === 'tracking') addAlert(st, { basketId: b.id, symbol: sym, type: 'critical', critical: true, text: `${name} → ✕ Sell · consider selling in your broker`, why });
      else if (h && h.qty > 0) {
        let order = st.orders.find(o => o.basketId === b.id && o.symbol === sym && o.side === 'sell' && o.status === 'pending');
        if (order) { order.tag = 'rules'; order.reason = `Rules: ${s.reasons[0]}`; order.removeAfter = true; }
        else order = makeOrder(st, { basketId: b.id, symbol: sym, side: 'sell', qty: h.qty, source: 'rules', tag: 'rules', removeAfter: true, reason: `Rules: ${s.reasons[0]}` });
        addAlert(st, { basketId: b.id, symbol: sym, type: 'critical', critical: true, text: `${name} → ✕ Sell · sell order ready to review`, why, action: { kind: 'orders', ids: [order.id] } });
      } else {
        removeFromBasket(st, b, sym, s.reasons[0], 'rules');
        addAlert(st, { basketId: b.id, symbol: sym, type: 'critical', critical: true, text: `${name} → ✕ Sell · taken out of the basket`, why });
      }
    } else addAlert(st, { basketId: b.id, symbol: sym, type: 'status', text: `${name} ${STATUS_LABEL[prev] || '—'} → ${STATUS_LABEL[s.status]}`, why });
  }
  if (b.kind === 'model' && invested(b)) {
    const d = drift(st, b);
    const busy = st.orders.some(o => o.basketId === b.id && o.status === 'pending');
    if (!busy && d.max > b.limits.driftTrigger && (!b.lastDrift || daysBetween(b.lastDrift, st.clock) >= 28)) {
      b.lastDrift = st.clock;
      addAlert(st, { basketId: b.id, type: 'drift', text: `${b.name} is ${d.max.toFixed(1)} points off its target mix · rebalance`, why: d.rows.filter(r => Math.abs(r.diff) > 1).map(r => `${r.name}: ${r.actual}% of the basket (target ${r.target}%)`), action: { kind: 'rebalance', basketId: b.id } });
    }
  }
  ensureRefill(st, b);
  return changes;
}

function removeFromBasket(st, b, sym, why, source) {
  b.symbols = b.symbols.filter(s => s !== sym);
  b.removedAt[sym] = st.clock;
  delete b.statusPrev[sym];
  delete b.strikes[sym];
  logDecision(st, { basketId: b.id, symbol: sym, action: 'removed', trigger: why, source });
}

export function drift(st, b) {
  const value = basketValue(st, b) || 1;
  const tw = targetWeights(st, b);
  const rows = b.symbols.map(s => {
    const actual = r2(((b.holdings[s]?.qty || 0) * st.prices[s] / value) * 100);
    const target = tw.weights[s] || 0;
    return { symbol: s, name: st.universe[s]?.name, actual, target, diff: r2(actual - target) };
  });
  return { rows, max: rows.reduce((m, r) => Math.max(m, Math.abs(r.diff)), 0), cashTarget: tw.cash };
}

function ruleLines(st, b, sym) {
  const u = st.universe[sym];
  const rules = b ? b.rules : st.rules;
  return rules.metrics.map(r => {
    const v = u.metrics[r.id];
    return { id: r.id, label: r.label, value: v, valueText: v == null ? '—' : `${v}${r.unit === '%' ? '%' : r.unit === '×' ? '×' : r.unit === '₹ cr' ? ' cr' : ''}`, band: r.enabled ? band(r, v) : 'off', green: fmtThreshold(r, 'green'), red: fmtThreshold(r, 'red'), critical: r.critical, enabled: r.enabled };
  });
}

function nextWeekday(d) {
  const x = new Date(d + 'T00:00:00Z');
  do { x.setUTCDate(x.getUTCDate() + 1); } while ([0, 6].includes(x.getUTCDay()));
  return x.toISOString().slice(0, 10);
}

function applyFilings(st) {
  const applied = [];
  for (const f of st.filings) {
    if (f.applied || f.date > st.clock) continue;
    f.applied = true;
    const u = st.universe[f.symbol];
    if (!u) continue;
    const before = { ...u.metrics };
    Object.assign(u.metrics, f.changes);
    applied.push(f);
    let resolved = false;
    for (const fl of st.flags.filter(x => x.symbol === f.symbol && x.status === 'open')) {
      const rule = DEFAULT_RULES.find(r => r.id === fl.metric);
      if (!rule || !(fl.metric in f.changes)) continue;
      const rank = { green: 0, amber: 1, red: 2, missing: 1 };
      const worse = rank[band(rule, u.metrics[fl.metric])] > rank[band(rule, before[fl.metric])] || band(rule, u.metrics[fl.metric]) === 'red';
      const confirmed = fl.impact === 'worse' ? worse : !worse;
      Object.assign(fl, { status: confirmed ? 'confirmed' : 'cleared', resolvedAt: st.clock, filing: f.note });
      if (!confirmed) for (const o of st.orders.filter(o => o.status === 'pending' && o.flagId === fl.id)) Object.assign(o, { status: 'cancelled', cancelReason: 'Flag cleared by filing' });
      resolved = true;
      addAlert(st, { symbol: f.symbol, type: confirmed ? 'flag_confirmed' : 'flag_cleared', critical: confirmed && rule.critical, text: `${u.name} · news ${confirmed ? 'confirmed' : 'not confirmed'} by latest results`, why: [f.note, `${rule.label}: ${before[fl.metric]} → ${u.metrics[fl.metric]}`] });
    }
    if (!resolved && st.baskets.some(b => b.symbols.includes(f.symbol))) {
      addAlert(st, { symbol: f.symbol, type: 'filing', text: `${u.name} · new quarterly results`, why: [f.note, ...Object.entries(f.changes).map(([k, v]) => `${labelOf(k)}: ${before[k]} → ${v}`)] });
    }
  }
  return applied;
}

function runDay(st, prov) {
  st.clock = nextWeekday(st.clock);
  st.tradingDay++;
  prov.step(st.clock);
  const filings = applyFilings(st);
  const weekly = st.tradingDay % 5 === 0;
  const kind = filings.length ? 'filing' : (isPro(st) || weekly ? 'full' : 'daily');
  const changes = [];
  for (const b of st.baskets) changes.push(...checkBasket(st, b, kind).map(c => ({ ...c, basket: b.name })));
  return { filings, changes };
}

// ---------------- views ----------------
const chg = (st, sym) => (st.prices[sym] && st.prevPrices[sym] ? r2(((st.prices[sym] - st.prevPrices[sym]) / st.prevPrices[sym]) * 100) : 0);

function stockView(st, sym, b) {
  const u = st.universe[sym];
  const s = scoreIn(st, b, sym, b?.statusPrev?.[sym]);
  const px = st.prices[sym];
  const h = b?.holdings?.[sym];
  return {
    symbol: sym, name: u.name, sector: u.sector, stage: u.stage, stageLabel: STAGE_LABEL[u.stage] || u.stage, themes: u.themes, source: u.source,
    status: b?.statusPrev?.[sym] && b.statusPrev[sym] !== s.status ? b.statusPrev[sym] : s.status,
    liveStatus: s.status, points: s.points, reasons: s.reasons, criticalReds: s.criticalReds, reds: s.reds, ambers: s.ambers, missing: s.missing, themeShare: s.themeShare,
    price: px, changePct: chg(st, sym), profitableYears: profitableYears(u),
    qty: h?.qty || 0, avg: h?.avg || null, value: h ? r2(h.qty * px) : 0,
    flags: st.flags.filter(f => f.symbol === sym && f.status === 'open').map(f => ({ id: f.id, metric: f.metric, label: labelOf(f.metric), impact: f.impact })),
  };
}

export function basketView(st, b) {
  const value = basketValue(st, b);
  const tw = targetWeights(st, b);
  const stocks = b.symbols.map(s => { const v = stockView(st, s, b); return { ...v, target: tw.weights[s] || 0, weight: value ? r2((v.value / value) * 100) : 0 }; });
  const inv = b.netInvested || 0;
  const pnl = r2(value - inv);
  const ret = inv > 0 ? r2((pnl / inv) * 100) : 0;
  const niftyRet = b.niftyAtInvest ? r2(((st.nifty - b.niftyAtInvest) / b.niftyAtInvest) * 100) : 0;
  const isInv = invested(b);
  return {
    id: b.id, name: b.name, description: b.description || '', kind: b.kind, theme: b.theme, themeLabel: b.theme ? THEME_LABEL[b.theme] : null,
    source: b.source, editedBy: b.editedBy || null, createdAt: b.createdAt, updatedAt: b.updatedAt || b.createdAt,
    value: r2(value), cash: r2(b.cash), invested: r2(inv), realized: r2(b.realized || 0), isInvested: isInv, pnl, returnPct: ret, niftyPct: niftyRet, vsNifty: r2(ret - niftyRet),
    count: b.symbols.length, limits: b.limits, rules: b.rules,
    counts: { pass: stocks.filter(s => s.status === 'pass').length, watch: stocks.filter(s => s.status === 'watch').length, remove: stocks.filter(s => s.status === 'remove').length },
    stageWeights: stageWeights(st, Object.fromEntries(stocks.map(s => [s.symbol, isInv ? s.weight : s.target]))),
    targetCash: tw.cash, stocks,
    belowMin: b.kind === 'model' && b.symbols.length < b.limits.minStocks,
    pendingOrders: st.orders.filter(o => o.basketId === b.id && o.status === 'pending').length,
    unread: st.alerts.filter(a => a.basketId === b.id && !a.read).length,
    drift: isInv ? drift(st, b).max : 0,
  };
}

function universeList(st, a = {}) {
  const q = String(a.q || '').trim().toLowerCase();
  const py = a.profitable_years != null ? Number(a.profitable_years) : null;
  const list = Object.values(st.universe).map(u => {
    const s = scoreStock(u, st.rules);
    const byTheme = Object.fromEntries(Object.keys(u.themes || {}).map(t => { const x = scoreStock(u, st.rules, { theme: t, minTheme: DEFAULT_LIMITS.minTheme }); return [t, { status: x.status, points: x.points, reason: x.reasons[0] }]; }));
    return {
      symbol: u.symbol, name: u.name, sector: u.sector, stage: u.stage, stageLabel: STAGE_LABEL[u.stage] || u.stage, themes: u.themes, byTheme,
      status: s.status, points: s.points, reasons: s.reasons, price: st.prices[u.symbol], changePct: chg(st, u.symbol),
      profitableYears: profitableYears(u), lossYears5: u.metrics.loss, debtEquity: u.metrics.de, tradedValueCr: u.metrics.adtv,
      source: u.source, inBaskets: st.baskets.filter(b => b.symbols.includes(u.symbol)).map(b => b.id),
    };
  })
    .filter(x => !q || x.name.toLowerCase().includes(q) || x.symbol.toLowerCase().includes(q) || (x.sector || '').toLowerCase().includes(q))
    .filter(x => !a.status || (a.theme ? x.byTheme?.[a.theme]?.status : x.status) === a.status)
    .filter(x => !a.stage || x.stage === a.stage)
    .filter(x => !a.sector || (x.sector || '').toLowerCase() === String(a.sector).toLowerCase())
    .filter(x => !a.theme || x.themes?.[a.theme] != null)
    .filter(x => py == null || x.profitableYears >= py)
    .filter(x => a.max_debt_equity == null || (x.debtEquity != null && x.debtEquity <= Number(a.max_debt_equity)))
    .filter(x => a.min_traded_value_cr == null || (x.tradedValueCr != null && x.tradedValueCr >= Number(a.min_traded_value_cr)))
    .filter(x => a.max_warnings == null || x.points <= Number(a.max_warnings));
  const order = { pass: 0, watch: 1, remove: 2 };
  const sorts = {
    gainers: (x, y) => y.changePct - x.changePct, losers: (x, y) => x.changePct - y.changePct,
    movers: (x, y) => Math.abs(y.changePct) - Math.abs(x.changePct), name: (x, y) => x.name.localeCompare(y.name),
    points: (x, y) => order[x.status] - order[y.status] || x.points - y.points,
  };
  return list.sort(sorts[a.sort] || sorts.points);
}

function cloneRules(r) { return JSON.parse(JSON.stringify(r)); }
function applyRuleOverrides(st, rules, overrides, actor) {
  for (const [id, o] of Object.entries(overrides || {})) {
    const r = rules.metrics.find(x => x.id === id) || rules.events.find(x => x.id === id);
    if (!r) throw new ApiError('not_found', `No rule "${id}"`);
    if ((o.green != null || o.red != null) && !isPro(st)) throw proError('custom thresholds');
    if (r.id.startsWith('ev_') && o.enabled && !isPro(st)) throw proError('event rules');
    if (o.green != null || o.red != null) {
      const g = o.green != null ? Number(o.green) : r.green, rd = o.red != null ? Number(o.red) : r.red;
      if (r.dir === 'higher' ? !(g >= rd) : !(g <= rd)) throw new ApiError('bad_threshold', `${r.label}: green can't be ${r.dir === 'higher' ? 'below' : 'above'} red`);
      r.green = g; r.red = rd;
    }
    if (o.enabled != null) r.enabled = !!o.enabled;
    if (o.critical != null) r.critical = !!o.critical;
    r.source = actor;
  }
}

function newBasket(st, { name, kind, theme, description, symbols, actor, rules, limits }) {
  const P = plan(st);
  const b = {
    id: nid(st, 'b'), name, kind, theme: theme || null, description: description || '', source: actor, createdAt: st.clock, updatedAt: st.clock,
    symbols, holdings: {}, cash: 0, netInvested: 0, niftyAtInvest: null,
    limits: { ...DEFAULT_LIMITS, ...(limits || {}), maxStocks: Math.min(limits?.maxStocks ?? DEFAULT_LIMITS.maxStocks, P.maxStocks) },
    rules: rules || cloneRules(st.rules), statusPrev: {}, strikes: {}, removedAt: {},
  };
  for (const s of symbols) b.statusPrev[s] = scoreIn(st, b, s).status;
  return b;
}
function checkBasketCount(st, kind) {
  const P = plan(st);
  const n = st.baskets.filter(b => b.kind === kind).length;
  if (kind === 'model' && n >= P.maxBaskets) throw proError('more baskets');
  if (kind === 'tracking' && n >= P.maxTracking) throw proError('more tracking baskets');
}
const cleanName = (v, fallback) => { const s = String(v ?? '').trim().slice(0, 40); return s || fallback; };

// ---------------- operations ----------------
const OPS = {
  // ---- Baskets: create / read / update / delete ----
  create_basket(st, a, actor) {
    const kind = a.kind === 'tracking' ? 'tracking' : 'model';
    checkBasketCount(st, kind);
    let input = (a.symbols || []).map(upper).filter(Boolean);
    if (kind === 'tracking' && a.holdings) input = a.holdings.map(h => upper(h.symbol));
    input = [...new Set(input)];
    const theme = a.theme === undefined ? inferTheme(st, input.filter(s => st.universe[s])) : (THEMES.some(t => t.id === a.theme) ? a.theme : null);
    const rules = cloneRules(st.rules);
    applyRuleOverrides(st, rules, a.rules, actor);
    const probe = newBasket(st, { name: 'probe', kind, theme, symbols: [], actor, rules, limits: a.min_theme != null ? { minTheme: Number(a.min_theme) } : null });
    st.seq--; // probe id not used
    const skipped = [], eligible = [];
    const maxStocks = probe.limits.maxStocks;
    for (const sym of input) {
      const u = st.universe[sym];
      if (!u) { skipped.push({ symbol: sym, why: 'Not in our stock list · add it in Explore' }); continue; }
      const s = scoreIn(st, probe, sym);
      if (kind === 'model' && s.status === 'remove') { skipped.push({ symbol: sym, name: u.name, why: `Fails this basket's rules · ${s.reasons[0]}` }); continue; }
      eligible.push(sym);
    }
    // Pick in order while keeping every segment within its limit of the FINAL basket size.
    // The size isn't known up front, so shrink the assumed size until the pick is consistent.
    const pick = size => {
      const out = [], over = [], full = [];
      for (const sym of eligible) {
        if (out.length >= maxStocks) { full.push(sym); continue; }
        const stage = st.universe[sym].stage;
        const count = out.filter(x => st.universe[x].stage === stage).length + 1;
        if (kind === 'model' && (count / size) * 100 > probe.limits.maxStageWeight + 0.01) { over.push(sym); continue; }
        out.push(sym);
      }
      return { out, over, full };
    };
    let size = Math.max(Math.min(maxStocks, eligible.length), DEFAULT_LIMITS.minStocks);
    let res = pick(size);
    for (let i = 0; i < 12 && res.out.length < size && res.out.length >= DEFAULT_LIMITS.minStocks; i++) { size = res.out.length; res = pick(size); }
    const final = res.out;
    for (const sym of res.over) skipped.push({ symbol: sym, name: st.universe[sym].name, why: `Too much in ${STAGE_LABEL[st.universe[sym].stage]} (limit ${probe.limits.maxStageWeight}% of basket)` });
    for (const sym of res.full) skipped.push({ symbol: sym, name: st.universe[sym].name, why: isPro(st) ? `Basket full (${maxStocks} stocks max)` : `Basket full (${maxStocks} stocks max on Free; 12 on Pro)` });
    if (!final.length) throw new ApiError('empty_basket', 'No stocks could be added', { skipped });
    const b = newBasket(st, { name: cleanName(a.name, kind === 'tracking' ? 'My holdings' : 'My basket'), kind, theme, description: String(a.description || '').slice(0, 140), symbols: final, actor, rules, limits: probe.limits });
    if (kind === 'tracking' && a.holdings) {
      for (const h of a.holdings) { const sym = upper(h.symbol); if (final.includes(sym)) b.holdings[sym] = { qty: Math.max(0, Number(h.qty) || 0), avg: Number(h.avg_price) || st.prices[sym] }; }
      b.netInvested = r2(Object.values(b.holdings).reduce((t, h) => t + h.qty * h.avg, 0));
      b.niftyAtInvest = st.nifty;
    }
    st.baskets.push(b);
    for (const s of final) logDecision(st, { basketId: b.id, symbol: s, action: 'added', trigger: `${STATUS_WORD[b.statusPrev[s]] || 'Rated'} at creation`, source: actor });
    st.onboarded = true;
    track(st, 'basket_created', { source: actor, kind, n: final.length, theme });
    const bt = basketBacktest(st, b).summary;
    return { basket: basketView(st, b), skipped, backtest: { removalsRight: bt.removalsRight, removalsTotal: bt.removalsTotal, years: `${bt.fromYear}–${bt.toYear}` } };
  },

  update_basket(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    if (a.name != null) b.name = cleanName(a.name, b.name);
    if (a.description != null) b.description = String(a.description).slice(0, 140);
    let rescore = false;
    if (a.theme !== undefined) { const t = a.theme === null || a.theme === '' ? null : a.theme; if (t && !THEMES.some(x => x.id === t)) throw new ApiError('bad_theme', `Theme must be one of ${THEMES.map(x => x.id).join(', ')} or null`); b.theme = t; rescore = true; }
    b.editedBy = actor; b.updatedAt = st.clock;
    if (rescore) checkBasket(st, b, 'rules');
    return { basket: basketView(st, b) };
  },

  duplicate_basket(st, a, actor) {
    const src = getBasket(st, a.basket_id);
    checkBasketCount(st, src.kind);
    const b = newBasket(st, { name: cleanName(a.name, `${src.name} copy`), kind: src.kind, theme: src.theme, description: src.description, symbols: [...src.symbols], actor, rules: cloneRules(src.rules), limits: { ...src.limits } });
    st.baskets.push(b);
    track(st, 'basket_duplicated', {});
    return { basket: basketView(st, b) };
  },

  delete_basket(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    let returned = b.cash;
    if (b.kind === 'model') {
      const prov = provider(st);
      for (const [sym, h] of Object.entries(b.holdings)) {
        if (!(h.qty > 0)) continue;
        let value;
        try { value = execute({ symbol: sym, side: 'sell', qty: h.qty }, prov.getQuote(sym), null).value; } catch { value = h.qty * (st.prices[sym] ?? h.avg); }
        returned += value;
        logDecision(st, { basketId: b.id, symbol: sym, action: 'sold', trigger: 'Basket deleted', source: actor, qty: h.qty });
      }
      st.cash = r2(st.cash + returned);
    }
    for (const o of st.orders) if (o.basketId === b.id && o.status === 'pending') Object.assign(o, { status: 'cancelled', cancelReason: 'Basket deleted' });
    st.alerts = st.alerts.filter(x => x.basketId !== b.id);
    st.baskets = st.baskets.filter(x => x.id !== b.id);
    track(st, 'basket_deleted', { kind: b.kind });
    return { deleted: b.id, name: b.name, returnedCash: b.kind === 'model' ? r2(returned) : 0, cash: st.cash };
  },

  // Exit = sell everything in the basket. Drafts sells; a person confirms. Cash returns to practice cash.
  exit_basket(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    if (b.kind === 'tracking') throw new ApiError('tracking_no_orders', 'Tracking baskets hold your real shares. Sell them in your broker.');
    for (const o of st.orders) if (o.basketId === b.id && o.status === 'pending') Object.assign(o, { status: 'cancelled', cancelReason: 'Replaced by exit' });
    const group = nid(st, 'g');
    const orders = Object.entries(b.holdings).filter(([, h]) => h.qty > 0)
      .map(([sym, h]) => makeOrder(st, { basketId: b.id, symbol: sym, side: 'sell', qty: h.qty, source: actor, tag: 'exit', group, reason: `Exit ${b.name}: sell all` }));
    if (!orders.length) {
      const back = b.cash; st.cash = r2(st.cash + back); b.cash = 0; b.netInvested = 0; b.niftyAtInvest = null;
      return { orders: [], returnedCash: r2(back), note: 'Nothing to sell. Any basket cash went back to practice cash.' };
    }
    track(st, 'exit_drafted', { source: actor, n: orders.length });
    return { orders, estimatedProceeds: r2(orders.reduce((t, o) => t + o.estValue, 0) + b.cash), costBasis: r2(b.netInvested), note: 'Pending. Confirm in the website to sell everything.' };
  },

  add_stock(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    const sym = upper(a.symbol);
    const u = st.universe[sym];
    if (!u) throw new ApiError('not_found', `${sym} is not in the universe. Add it with add_candidate.`);
    if (b.symbols.includes(sym)) throw new ApiError('exists', `${u.name} is already in ${b.name}`);
    const max = Math.min(b.limits.maxStocks, plan(st).maxStocks);
    if (b.symbols.length >= max) throw isPro(st) ? new ApiError('limit', `Max ${max} stocks`) : proError(`more than ${max} stocks`);
    const s = scoreIn(st, b, sym);
    if (b.kind === 'model' && s.status === 'remove') throw new ApiError('rule_block', `${u.name} is rated ✕ Sell here: ${s.reasons[0]}`);
    if (b.kind === 'model') {
      const sw = stageWeights(st, targetWeights(st, b, [...b.symbols, sym]).weights);
      if ((sw[u.stage] || 0) > b.limits.maxStageWeight + 0.01 && b.symbols.length + 1 >= b.limits.minStocks) throw new ApiError('rule_block', `${STAGE_LABEL[u.stage]} would be ${sw[u.stage]}% (cap ${b.limits.maxStageWeight}%)`);
    }
    if (b.kind === 'tracking') b.holdings[sym] = b.holdings[sym] || { qty: 0, avg: st.prices[sym] };
    b.symbols.push(sym); b.statusPrev[sym] = s.status; b.editedBy = actor; b.updatedAt = st.clock;
    logDecision(st, { basketId: b.id, symbol: sym, action: 'added', trigger: `${STATUS_WORD[s.status]} · ${s.points} warning${s.points === 1 ? '' : 's'}`, source: actor });
    return { basket: basketView(st, b) };
  },

  remove_stock(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    const sym = upper(a.symbol);
    if (!b.symbols.includes(sym)) throw new ApiError('not_found', `${sym} isn't in ${b.name}`);
    const h = b.holdings[sym];
    if (b.kind === 'model' && h?.qty > 0) {
      if (!a.sell) throw new ApiError('has_holding', 'You hold this stock. Sell it to remove it.');
      let order = st.orders.find(o => o.basketId === b.id && o.symbol === sym && o.side === 'sell' && o.status === 'pending');
      if (order) { order.qty = h.qty; order.removeAfter = true; order.estValue = r2(order.qty * st.prices[sym]); }
      else order = makeOrder(st, { basketId: b.id, symbol: sym, side: 'sell', qty: h.qty, source: actor, tag: 'manual', removeAfter: true, reason: 'Sell and remove' });
      return { orders: [order], note: 'Sell drafted. Confirm it to remove the stock.' };
    }
    if (b.kind === 'tracking') delete b.holdings[sym];
    removeFromBasket(st, b, sym, a.reason || 'Removed by you', actor);
    b.editedBy = actor; b.updatedAt = st.clock;
    for (const o of st.orders) if (o.basketId === b.id && o.symbol === sym && o.status === 'pending') Object.assign(o, { status: 'cancelled', cancelReason: 'Stock removed' });
    ensureRefill(st, b);
    return { basket: basketView(st, b) };
  },

  set_holding(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    if (b.kind !== 'tracking') throw new ApiError('not_tracking', 'Holdings are edited only in tracking baskets. Use orders for paper baskets.');
    const sym = upper(a.symbol);
    if (!st.universe[sym]) throw new ApiError('not_found', `Unknown symbol ${sym}`);
    const qty = Math.max(0, Math.floor(Number(a.qty) || 0));
    const avg = Number(a.avg_price) > 0 ? Number(a.avg_price) : st.prices[sym];
    if (!b.symbols.includes(sym)) { b.symbols.push(sym); b.statusPrev[sym] = scoreIn(st, b, sym).status; }
    b.holdings[sym] = { qty, avg: r2(avg) };
    b.netInvested = r2(Object.values(b.holdings).reduce((t, h) => t + h.qty * h.avg, 0));
    if (!b.niftyAtInvest) b.niftyAtInvest = st.nifty;
    b.editedBy = actor; b.updatedAt = st.clock;
    return { basket: basketView(st, b) };
  },

  get_basket_status(st, a) {
    if (!a.basket_id && st.baskets.length !== 1) return { baskets: st.baskets.map(b => basketView(st, b)), cash: st.cash, asOf: st.clock, mock: true };
    return { basket: basketView(st, getBasket(st, a.basket_id)), cash: st.cash, asOf: st.clock, mock: true };
  },

  get_universe(st, a) { const stocks = universeList(st, a); return { count: stocks.length, stocks: stocks.slice(0, a.limit || 200), filters: { sectors: [...new Set(Object.values(st.universe).map(u => u.sector))], themes: THEMES }, asOf: st.clock, mock: true }; },

  // ---- Universe candidates: create / update / delete ----
  add_candidate(st, a, actor) {
    const sym = upper(a.symbol);
    if (!/^[A-Z0-9&-]{2,20}$/.test(sym)) throw new ApiError('bad_symbol', 'Use an NSE symbol, e.g. VOLTAS');
    const ex = st.universe[sym];
    const metrics = {};
    for (const r of DEFAULT_RULES) { const v = a.metrics?.[r.id]; metrics[r.id] = v == null || v === '' ? (ex?.metrics[r.id] ?? null) : Number(v); }
    const themes = { ...(ex?.themes || {}) };
    if (a.themes) for (const [k, v] of Object.entries(a.themes)) if (v === null || v === '') delete themes[k]; else themes[k] = Number(v);
    if (a.ac_share != null && a.ac_share !== '') themes.ac = Number(a.ac_share);
    st.universe[sym] = {
      symbol: sym, name: String(a.name || ex?.name || sym).slice(0, 60), sector: a.sector || ex?.sector || 'Other', stage: a.stage || ex?.stage || 'parts', themes,
      historyYears: a.history_years ?? ex?.historyYears ?? 3, metrics, lossAgo: ex?.lossAgo || [], events: ex?.events || {}, source: ex?.source === 'default' ? 'default' : actor,
    };
    if (st.prices[sym] == null || a.price) { st.prices[sym] = Number(a.price) || st.prices[sym] || 100; st.prevPrices[sym] = st.prevPrices[sym] ?? st.prices[sym]; }
    track(st, ex ? 'candidate_updated' : 'candidate_added', { source: actor });
    for (const b of st.baskets) if (b.symbols.includes(sym)) checkBasket(st, b, 'rules');
    const s = scoreStock(st.universe[sym], st.rules);
    return { stock: { symbol: sym, name: st.universe[sym].name, status: s.status, points: s.points, reasons: s.reasons, missing: s.missingCount }, note: s.missingCount >= 3 ? 'Missing numbers → Hold until filled' : undefined };
  },

  delete_candidate(st, a) {
    const sym = upper(a.symbol);
    const u = st.universe[sym];
    if (!u) throw new ApiError('not_found', 'Unknown symbol');
    if (u.source === 'default') throw new ApiError('protected', 'Built-in stocks can\'t be deleted');
    if (st.baskets.some(b => b.symbols.includes(sym))) throw new ApiError('in_use', 'Remove it from your baskets first');
    delete st.universe[sym]; delete st.prices[sym]; delete st.prevPrices[sym];
    return { deleted: sym };
  },

  set_theme_share(st, a, actor) {
    const u = st.universe[upper(a.symbol)];
    if (!u) throw new ApiError('not_found', 'Unknown symbol');
    const theme = a.theme || 'ac';
    if (a.share === '' || a.share == null) delete u.themes[theme]; else u.themes[theme] = Math.max(0, Math.min(100, Number(a.share)));
    for (const b of st.baskets) if (b.symbols.includes(u.symbol)) checkBasket(st, b, 'rules');
    return { stock: universeList(st).find(x => x.symbol === u.symbol), editedBy: actor };
  },

  // ---- Rules (per basket) ----
  set_rule(st, a, actor) {
    if (!isPro(st)) throw proError('edit thresholds');
    const t = ruleTargets(st, a);
    if (!t.sets[0].metrics.some(x => x.id === a.rule_id)) throw new ApiError('not_found', `No rule "${a.rule_id}"`);
    const before = t.baskets.map(b => statusesSnapshot(st, b));
    for (const rs of t.sets) applyRuleOverrides(st, rs, { [a.rule_id]: { green: a.green, red: a.red, critical: a.critical } }, actor);
    track(st, 'rule_threshold_edited', { rule: a.rule_id, source: actor, scope: t.scope });
    const changed = [];
    t.baskets.forEach((b, i) => { b.updatedAt = st.clock; checkBasket(st, b, 'rules'); changed.push(...diffStatuses(before[i], statusesSnapshot(st, b))); });
    return { scope: t.scope, applied_to: scopeText(t, st), rule: t.sets[0].metrics.find(x => x.id === a.rule_id), changed };
  },
  toggle_rule(st, a, actor) {
    const t = ruleTargets(st, a);
    const find = rs => rs.metrics.find(x => x.id === a.rule_id) || rs.events.find(x => x.id === a.rule_id);
    if (!find(t.sets[0])) throw new ApiError('not_found', `No rule "${a.rule_id}"`);
    if (a.rule_id.startsWith('ev_') && !isPro(st)) throw proError('event rules');
    const before = t.baskets.map(b => statusesSnapshot(st, b));
    for (const rs of t.sets) { const r = find(rs); r.enabled = !!a.enabled; r.source = actor; }
    const changed = [];
    t.baskets.forEach((b, i) => { b.updatedAt = st.clock; checkBasket(st, b, 'rules'); changed.push(...diffStatuses(before[i], statusesSnapshot(st, b))); });
    return { scope: t.scope, applied_to: scopeText(t, st), rule: find(t.sets[0]), changed };
  },
  reset_rules(st, a, actor) {
    if (a.scope === 'defaults' || (!a.basket_id && !a.scope && st.baskets.length !== 1)) { st.rules = defaultRuleSet(); return { scope: 'defaults', rules: st.rules }; }
    const b = getBasket(st, a.basket_id);
    b.rules = cloneRules(st.rules); b.limits = { ...DEFAULT_LIMITS, maxStocks: Math.min(DEFAULT_LIMITS.maxStocks, plan(st).maxStocks) };
    b.editedBy = actor; b.updatedAt = st.clock;
    checkBasket(st, b, 'rules');
    return { basket: basketView(st, b) };
  },
  // Copy the default rules onto every basket (switches and limits of each rule; basket size limits stay).
  // Read the default rules or one basket's rules (scope like set_rule).
  get_rules(st, a) {
    const scope = a.scope || (a.basket_id ? 'basket' : 'defaults');
    const pick = rs => ({ metrics: rs.metrics.map(r => ({ id: r.id, label: r.label, long: r.long, unit: r.unit, better: r.dir, green: r.green, red: r.red, enabled: r.enabled, must_pass: !!r.critical, edited_by: r.source })), events: rs.events.map(r => ({ id: r.id, label: r.label, enabled: r.enabled })) });
    if (scope === 'defaults') return { scope, note: 'New baskets start with these; they also rate stocks on Home and Explore.', ...pick(st.rules), can_edit_limits: isPro(st) };
    const b = getBasket(st, a.basket_id);
    return { scope: 'basket', basket: { id: b.id, name: b.name }, ...pick(b.rules), limits: b.limits, can_edit_limits: isPro(st) };
  },
  apply_default_rules(st, a, actor) {
    const list = a.basket_id ? [getBasket(st, a.basket_id)] : st.baskets;
    for (const b of list) { b.rules = cloneRules(st.rules); b.editedBy = actor; b.updatedAt = st.clock; checkBasket(st, b, 'rules'); }
    return { baskets_updated: list.length };
  },

  set_basket_rule(st, a, actor) {
    if (!isPro(st)) throw proError('basket limits');
    const b = getBasket(st, a.basket_id);
    const map = { min_stocks: 'minStocks', max_stocks: 'maxStocks', max_stock_weight: 'maxStockWeight', max_stage_weight: 'maxStageWeight', max_watch_weight: 'maxWatchWeight', drift_trigger: 'driftTrigger', min_theme: 'minTheme' };
    const next = { ...b.limits };
    for (const [k, f] of Object.entries(map)) if (a[k] != null) next[f] = Number(a[k]);
    if (next.minStocks < 1 || next.minStocks > next.maxStocks || next.maxStocks > 12) throw new ApiError('bad_limit', 'Stocks: 1 ≤ min ≤ max ≤ 12');
    for (const f of ['maxStockWeight', 'maxStageWeight', 'maxWatchWeight']) if (!(next[f] > 0 && next[f] <= 100)) throw new ApiError('bad_limit', 'Weights must be 1–100%');
    if (!(next.minTheme >= 0 && next.minTheme <= 100)) throw new ApiError('bad_limit', 'Theme share must be 0–100%');
    b.limits = next; b.editedBy = actor; b.updatedAt = st.clock;
    checkBasket(st, b, 'rules');
    return { basket: basketView(st, b) };
  },

  what_if(st, a) {
    if (!isPro(st)) throw proError('what-if');
    const b = getBasket(st, a.basket_id);
    if (!b.rules.metrics.some(x => x.id === a.rule_id)) throw new ApiError('not_found', 'No rule');
    const alt = { ...b, rules: cloneRules(b.rules) };
    const ar = alt.rules.metrics.find(x => x.id === a.rule_id);
    if (a.green != null) ar.green = Number(a.green);
    if (a.red != null) ar.red = Number(a.red);
    if (a.enabled != null) ar.enabled = !!a.enabled;
    const changes = [];
    for (const u of candidatesFor(st, b)) {
      const s0 = scoreIn(st, b, u.symbol).status, s1 = scoreIn(st, alt, u.symbol).status;
      if (s0 !== s1) changes.push({ symbol: u.symbol, name: u.name, from: s0, to: s1, inBasket: b.symbols.includes(u.symbol) });
    }
    return { changes, backtest: { before: basketBacktest(st, b).summary, after: basketBacktest(st, alt).summary } };
  },

  // ---- Orders: create / update / confirm / cancel ----
  create_order(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    if (b.kind === 'tracking') throw new ApiError('tracking_no_orders', 'Tracking baskets don\'t place orders. Use your broker.');
    const side = a.side === 'sell' ? 'sell' : 'buy';
    const out = [];
    const group = nid(st, 'g');
    if (side === 'buy' && !a.symbol) {
      const amount = Number(a.amount);
      if (!(amount > 0)) throw new ApiError('bad_amount', 'Enter an amount');
      if (amount > st.cash + b.cash) throw new ApiError('insufficient', `Paper cash is ${fmtINR(st.cash + b.cash)}`);
      const tw = targetWeights(st, b);
      for (const [sym, w] of Object.entries(tw.weights)) {
        const qty = Math.round((amount * w) / 100 / st.prices[sym]);
        if (qty < 1) continue;
        out.push(makeOrder(st, { basketId: b.id, symbol: sym, side, qty, source: actor, tag: 'invest', group, reason: `Invest ${fmtINR(amount)} · ${w}% of basket` }));
      }
      if (!out.length) throw new ApiError('bad_amount', 'Amount too small for one share of each');
      track(st, 'invest_drafted', { amount, source: actor });
    } else {
      const sym = upper(a.symbol);
      if (!st.universe[sym]) throw new ApiError('not_found', `Unknown symbol ${sym}`);
      const held = b.holdings[sym]?.qty || 0;
      const qty = a.qty != null ? Math.floor(Number(a.qty)) : a.amount ? Math.floor(Number(a.amount) / st.prices[sym]) : side === 'sell' ? held : 0;
      if (!(qty >= 1)) throw new ApiError('bad_qty', 'Quantity must be at least 1');
      if (side === 'sell' && qty > held) throw new ApiError('bad_qty', `You hold ${held}`);
      if (side === 'buy' && !b.symbols.includes(sym)) {
        if (b.symbols.length >= b.limits.maxStocks) throw new ApiError('limit', `Max ${b.limits.maxStocks} stocks`);
        if (scoreIn(st, b, sym).status === 'remove') throw new ApiError('rule_block', `${st.universe[sym].name} is rated ✕ Sell in this basket`);
      }
      out.push(makeOrder(st, { basketId: b.id, symbol: sym, side, qty, source: actor, tag: 'manual', group, addOnFill: side === 'buy' && !b.symbols.includes(sym), removeAfter: side === 'sell' && qty === held && !!a.remove_after, reason: a.reason || (side === 'sell' ? 'Sell' : 'Buy') }));
    }
    return { orders: out, note: 'Pending. A person confirms them in the FunInvestments website (Orders).' };
  },

  update_order(st, a, actor) {
    const o = st.orders.find(x => x.id === a.order_id);
    if (!o || o.status !== 'pending') throw new ApiError('not_found', 'No pending order with that id');
    const qty = Math.floor(Number(a.qty));
    if (!(qty >= 1)) throw new ApiError('bad_qty', 'Quantity must be at least 1');
    if (o.side === 'sell') { const held = st.baskets.find(b => b.id === o.basketId)?.holdings[o.symbol]?.qty || 0; if (qty > held) throw new ApiError('bad_qty', `You hold ${held}`); o.removeAfter = o.removeAfter && qty === held; }
    o.qty = qty; o.estPrice = st.prices[o.symbol]; o.estValue = r2(qty * o.estPrice); o.editedBy = actor;
    return { order: o };
  },

  confirm_order(st, a, actor) {
    if (actor !== 'you') throw new ApiError('person_only', 'Only a person can confirm orders, in the website.');
    const ids = a.order_ids || (a.order_id ? [a.order_id] : st.orders.filter(o => o.group === a.group && o.status === 'pending').map(o => o.id));
    const prov = provider(st);
    const filled = [];
    for (const id of ids) {
      const o = st.orders.find(x => x.id === id);
      if (!o || o.status !== 'pending') continue;
      const b = st.baskets.find(x => x.id === o.basketId);
      if (!b) { Object.assign(o, { status: 'cancelled', cancelReason: 'Basket deleted' }); continue; }
      const f = execute(o, prov.getQuote(o.symbol), st.universe[o.symbol]?.metrics.adtv);
      if (o.side === 'buy') {
        if (f.value > st.cash + b.cash + 0.01) throw new ApiError('insufficient', `Need ${fmtINR(f.value)}, have ${fmtINR(st.cash + b.cash)}`);
        const fromBasket = Math.min(b.cash, f.value); b.cash = r2(b.cash - fromBasket); st.cash = r2(st.cash - (f.value - fromBasket));
        const h = b.holdings[o.symbol] || { qty: 0, avg: 0 };
        h.avg = r2((h.qty * h.avg + f.value) / (h.qty + o.qty)); h.qty += o.qty; b.holdings[o.symbol] = h;
        b.netInvested = r2((b.netInvested || 0) + (f.value - fromBasket));
        if (!b.niftyAtInvest) b.niftyAtInvest = st.nifty;
        if (o.addOnFill && !b.symbols.includes(o.symbol)) { b.symbols.push(o.symbol); b.statusPrev[o.symbol] = scoreIn(st, b, o.symbol).status; }
      } else {
        const h = b.holdings[o.symbol];
        if (!h || h.qty < o.qty) { Object.assign(o, { status: 'cancelled', cancelReason: 'Not enough shares' }); continue; }
        h.qty -= o.qty; b.cash = r2(b.cash + f.value);
        if (h.qty <= 0) delete b.holdings[o.symbol];
        if (o.removeAfter && !b.holdings[o.symbol]) removeFromBasket(st, b, o.symbol, o.reason, o.source);
      }
      Object.assign(o, { status: 'filled', fill: { ...f, at: st.clock }, confirmedBy: actor });
      logDecision(st, { basketId: b.id, symbol: o.symbol, action: o.side === 'buy' ? 'bought' : 'sold', trigger: o.reason, source: o.source, qty: o.qty });
      filled.push(o);
      track(st, 'order_confirmed', { side: o.side, tag: o.tag, source: o.source });
    }
    const exits = [];
    for (const b of st.baskets) {
      if (!filled.some(o => o.basketId === b.id)) continue;
      const exited = filled.some(o => o.basketId === b.id && o.tag === 'exit') && !invested(b) && !st.orders.some(o => o.basketId === b.id && o.status === 'pending' && o.tag === 'exit');
      if (exited) {
        const back = r2(b.cash), profit = r2(back - (b.netInvested || 0));
        st.cash = r2(st.cash + back); b.cash = 0; b.netInvested = 0; b.niftyAtInvest = null;
        b.realized = r2((b.realized || 0) + profit);
        logDecision(st, { basketId: b.id, symbol: null, basketName: b.name, action: 'exited', trigger: `Sold all · ${fmtINR(back)} back · ${profit >= 0 ? 'profit' : 'loss'} ${fmtINR(Math.abs(profit))}`, source: actor });
        exits.push({ basketId: b.id, name: b.name, returnedCash: back, profit });
      } else ensureRefill(st, b);
    }
    return { filled, cash: st.cash, exits };
  },

  cancel_order(st, a, actor) {
    const o = st.orders.find(x => x.id === a.order_id);
    if (!o || o.status !== 'pending') throw new ApiError('not_found', 'No pending order with that id');
    Object.assign(o, { status: 'cancelled', cancelReason: a.reason || 'Cancelled' });
    if (o.source === 'rules' || o.tag === 'news_only' || o.tag === 'rules') {
      st.journal.unshift({ id: nid(st, 'j'), date: st.clock, basketId: o.basketId, symbol: o.symbol, name: o.name, action: o.side === 'sell' ? 'Kept anyway' : 'Skipped buy', rule: o.reason, reason: a.reason || '', priceThen: st.prices[o.symbol] });
      logDecision(st, { basketId: o.basketId, symbol: o.symbol, action: 'override', trigger: o.reason, source: actor, note: a.reason });
      track(st, 'override_recorded', { tag: o.tag });
    }
    return { order: o };
  },

  get_orders(st, a) { return { orders: st.orders.filter(o => !a.basket_id || o.basketId === a.basket_id).filter(o => !a.status || o.status === a.status) }; },

  // ---- Alerts: read / mark / dismiss / clear ----
  get_alerts(st, a) {
    const list = st.alerts.filter(x => !a.basket_id || x.basketId === a.basket_id).filter(x => !a.unread_only || !x.read);
    return { alerts: list.slice(0, a.limit || 50), unread: st.alerts.filter(x => !x.read).length };
  },
  mark_alerts_read(st, a) { for (const x of st.alerts) if (!a.ids || a.ids.includes(x.id)) x.read = true; return { ok: true }; },
  dismiss_alert(st, a) { const n = st.alerts.length; st.alerts = st.alerts.filter(x => x.id !== a.alert_id); if (n === st.alerts.length) throw new ApiError('not_found', 'No such alert'); return { dismissed: a.alert_id }; },
  clear_alerts(st, a) { const n = st.alerts.length; st.alerts = st.alerts.filter(x => a.basket_id && x.basketId !== a.basket_id); return { cleared: n - st.alerts.length }; },

  get_refill_plan(st, a) {
    const b = getBasket(st, a.basket_id);
    const p = refillPlan(st, b);
    return { basket: b.name, count: b.symbols.length, min: b.limits.minStocks, ...p, pendingOrders: st.orders.filter(o => o.basketId === b.id && o.status === 'pending' && o.tag === 'refill') };
  },

  rebalance_plan(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    const d = drift(st, b);
    if (!a.draft) return d;
    const value = basketValue(st, b);
    const orders = [];
    for (const r of d.rows) {
      const delta = Math.floor((value * r.target) / 100 / st.prices[r.symbol]) - (b.holdings[r.symbol]?.qty || 0);
      if (Math.abs(delta) < 1) continue;
      orders.push(makeOrder(st, { basketId: b.id, symbol: r.symbol, side: delta > 0 ? 'buy' : 'sell', qty: Math.abs(delta), source: actor, tag: 'rebalance', reason: `Rebalance to ${r.target}% of basket` }));
    }
    return { ...d, orders };
  },

  // ---- News flags: create / update / withdraw ----
  add_news_flag(st, a, actor) {
    const sym = upper(a.symbol);
    const u = st.universe[sym];
    if (!u) throw new ApiError('not_found', `Unknown symbol ${sym}`);
    const rule = DEFAULT_RULES.find(r => r.id === a.metric) || st.rules.events.find(r => r.id === a.metric);
    if (!rule) throw new ApiError('bad_metric', `Unknown metric "${a.metric}"`);
    const impact = a.impact === 'better' ? 'better' : 'worse';
    const used = st.flags.filter(f => monthKey(f.date) === monthKey(st.clock) && f.status !== 'withdrawn').length;
    if (used >= plan(st).flagsPerMonth) throw proError(`more than ${plan(st).flagsPerMonth} news flags a month`);
    const flag = { id: nid(st, 'f'), symbol: sym, name: u.name, metric: rule.id, metricLabel: rule.label, impact, note: String(a.note || '').slice(0, 240), url: a.url || '', source: actor, status: 'open', date: st.clock };
    st.flags.unshift(flag);
    const drafted = [];
    for (const b of st.baskets) {
      if (!b.symbols.includes(sym)) continue;
      const h = b.holdings[sym];
      const critical = b.rules.metrics.find(r => r.id === rule.id)?.critical ?? rule.critical;
      if (impact === 'worse' && critical && b.kind === 'model' && h?.qty > 0 && !st.orders.some(o => o.basketId === b.id && o.symbol === sym && o.side === 'sell' && o.status === 'pending')) {
        drafted.push(makeOrder(st, { basketId: b.id, symbol: sym, side: 'sell', qty: h.qty, source: actor, tag: 'news_only', flagId: flag.id, removeAfter: true, reason: `Based on news, not yet in results: ${rule.label} likely worse` }));
      }
      addAlert(st, {
        basketId: b.id, symbol: sym, type: 'news', critical: critical && impact === 'worse',
        text: `${u.name} · news: ${rule.label} likely ${impact}${drafted.some(o => o.basketId === b.id) ? ' · sell order ready to review' : ''}`,
        why: [flag.note || 'News flag', `Now: ${u.metrics[rule.id] ?? '—'} (${band(rule, u.metrics[rule.id])})`, 'The next quarterly results will confirm or clear it'],
        action: drafted.some(o => o.basketId === b.id) ? { kind: 'orders', ids: drafted.filter(o => o.basketId === b.id).map(o => o.id) } : null,
      });
    }
    track(st, 'news_flag_added', { source: actor, metric: rule.id });
    return { flag, drafted_orders: drafted };
  },

  update_news_flag(st, a, actor) {
    const f = st.flags.find(x => x.id === a.flag_id);
    if (!f || f.status !== 'open') throw new ApiError('not_found', 'No open flag with that id');
    if (a.note != null) f.note = String(a.note).slice(0, 240);
    if (a.impact) {
      f.impact = a.impact === 'better' ? 'better' : 'worse';
      if (f.impact === 'better') for (const o of st.orders.filter(o => o.status === 'pending' && o.flagId === f.id)) Object.assign(o, { status: 'cancelled', cancelReason: 'Flag changed to better' });
    }
    f.editedBy = actor;
    return { flag: f };
  },

  delete_news_flag(st, a) {
    const f = st.flags.find(x => x.id === a.flag_id);
    if (!f || f.status !== 'open') throw new ApiError('not_found', 'No open flag with that id');
    f.status = 'withdrawn'; f.resolvedAt = st.clock;
    const cancelled = st.orders.filter(o => o.status === 'pending' && o.flagId === f.id);
    for (const o of cancelled) Object.assign(o, { status: 'cancelled', cancelReason: 'Flag withdrawn' });
    return { flag: f, cancelledOrders: cancelled.length };
  },

  // ---- Journal: update / delete ----
  update_journal(st, a) { const j = st.journal.find(x => x.id === a.id); if (!j) throw new ApiError('not_found', 'No such entry'); j.reason = String(a.reason || '').slice(0, 200); return { entry: j }; },
  delete_journal(st, a) { const n = st.journal.length; st.journal = st.journal.filter(x => x.id !== a.id); if (n === st.journal.length) throw new ApiError('not_found', 'No such entry'); return { deleted: a.id }; },

  // ---- Scorecard ----
  get_rule_scorecard(st, a) {
    const b = a.basket_id ? getBasket(st, a.basket_id) : st.baskets.find(x => x.kind === 'model') || null;
    const bt = b ? basketBacktest(st, b) : backtest(st.rules, HISTORY, NAMES, { theme: 'ac', minTheme: DEFAULT_LIMITS.minTheme });
    const live = st.decisions.filter(d => !b || d.basketId === b.id).slice(0, 100)
      .map(d => ({ ...d, name: d.symbol ? st.universe[d.symbol]?.name || NAMES[d.symbol] || d.symbol : 'Whole basket', movePct: d.price && st.prices[d.symbol] ? r2(((st.prices[d.symbol] - d.price) / d.price) * 100) : null }));
    track(st, 'scorecard_viewed', { view: a.view || 'summary', plan: st.plan });
    const scope = b ? { basketId: b.id, basket: b.name, theme: b.theme ? THEME_LABEL[b.theme] : 'Basket sectors' } : { basket: null, theme: 'AC value chain (default rules)' };
    if (!bt.years.length) return { ...scope, locked: false, empty: true, years: [], live };
    if (!isPro(st)) {
      const last = bt.years.at(-1);
      return { ...scope, locked: true, years: [last], summary: { year: last.year, removalsRight: last.removedRight, removalsTotal: last.removed, keptBeat: last.keptBeat, kept: last.kept }, teaser: { years: bt.years.length, rules: bt.byRule.length, decisions: bt.log.length }, upgrade: '#pricing', live: live.slice(0, 5) };
    }
    const journal = st.journal.filter(j => !b || j.basketId === b.id).map(j => ({ ...j, movePct: j.priceThen ? r2(((st.prices[j.symbol] - j.priceThen) / j.priceThen) * 100) : null }));
    const kept = journal.filter(j => j.movePct != null && j.action === 'Kept anyway');
    return {
      ...scope, locked: false, view: a.view || 'summary', summary: bt.summary, years: bt.years, byRule: bt.byRule,
      log: a.view === 'log' ? bt.log.slice(0, a.limit || 400) : undefined, live, journal,
      overrides: { count: kept.length, helped: kept.filter(j => j.movePct > 0).length, hurt: kept.filter(j => j.movePct <= 0).length },
    };
  },

  share_card(st, a) {
    if (!isPro(st)) throw proError('share card');
    const b = getBasket(st, a.basket_id);
    const bt = basketBacktest(st, b);
    track(st, 'share_card_created', {});
    return {
      title: `${b.name}: rules tested`, rules: b.rules.metrics.filter(r => r.enabled).length, years: `${bt.summary.fromYear}–${bt.summary.toYear}`,
      removalsRight: bt.summary.removalsRight, removalsTotal: bt.summary.removalsTotal,
      topRules: bt.byRule.filter(r => r.removed).slice(0, 3).map(r => ({ label: r.label, removed: r.removed, hitRate: r.hitRate })),
      disclaimer: 'Backtest on mock data. Rule statistics only, not returns or advice. Educational tool · Paper trades only.',
    };
  },

  // ---- Activity & to-dos (lets a new Claude chat pick up where the last one stopped) ----
  get_activity(st, a) {
    return { activity: activityView(st, (st.activity || []).slice(0, a.limit || 30)), todo: todoList(st), asOf: st.clock };
  },

  // ---- App state & settings ----
  get_state(st) {
    const needs = [];
    for (const b of st.baskets) for (const s of b.symbols) {
      const v = stockView(st, s, b);
      const pending = st.orders.some(o => o.symbol === s && o.basketId === b.id && o.status === 'pending');
      if (v.flags.length || v.status === 'remove' || pending || v.status !== v.liveStatus) needs.push({ symbol: s, name: v.name, stage: v.stage, status: v.liveStatus, flag: v.flags[0]?.label || null, basketId: b.id, pending });
    }
    return {
      clock: st.clock, plan: st.plan, planInfo: PLANS[st.plan], prices: PRICES, billing: st.billing || null, user: st.user, cash: st.cash, startingCash: st.startingCash,
      nifty: st.nifty, niftyChange: r2(((st.nifty - st.niftyPrev) / st.niftyPrev) * 100),
      baskets: st.baskets.map(b => basketView(st, b)), orders: st.orders.slice(0, 150), alerts: st.alerts.slice(0, 150),
      unread: st.alerts.filter(a => !a.read).length, pending: st.orders.filter(o => o.status === 'pending').length,
      flags: st.flags.slice(0, 100), journal: st.journal.slice(0, 100), rules: st.rules, needs: dedupe(needs),
      universe: universeList(st, { sort: 'points' }),
      decisions: st.decisions.slice(0, 80).map(d => ({ ...d, name: d.symbol ? st.universe[d.symbol]?.name || NAMES[d.symbol] || d.symbol : 'Whole basket' })),
      flagsThisMonth: st.flags.filter(f => monthKey(f.date) === monthKey(st.clock) && f.status !== 'withdrawn').length,
      nextFiling: st.filings.find(f => !f.applied) || null, notif: st.notif, eventsCount: st.events.length,
      onboarded: st.onboarded, claudeConnected: st.claudeConnected, lastClaudeCall: st.lastClaudeCall,
      activity: activityView(st, recentActivity(st)), todo: todoList(st),
      provider: 'Mock provider (seeded from NSE closes, 9 Nov 2026)', stages: STAGES, themes: THEMES, defaultLimits: DEFAULT_LIMITS,
    };
  },
  get_stock(st, a) {
    const sym = upper(a.symbol);
    if (!st.universe[sym]) throw new ApiError('not_found', 'Unknown symbol');
    const b = a.basket_id ? st.baskets.find(x => x.id === a.basket_id) : st.baskets.find(x => x.symbols.includes(sym));
    const u = st.universe[sym];
    return {
      stock: stockView(st, sym, b), rules: ruleLines(st, b, sym), basketId: b?.id || null, basketName: b?.name || null, theme: b?.theme || null,
      history: (PRICE_HISTORY[sym] || []).slice(-36), lossAgo: u.lossAgo || [], themes: u.themes, isCustom: u.source !== 'default',
      flags: st.flags.filter(f => f.symbol === sym), orders: st.orders.filter(o => o.symbol === sym).slice(0, 10),
      inBaskets: st.baskets.filter(x => x.symbols.includes(sym)).map(x => ({ id: x.id, name: x.name, qty: x.holdings[sym]?.qty || 0 })),
    };
  },
  set_plan(st, a) {
    st.plan = a.plan === 'pro' ? 'pro' : 'free';
    for (const b of st.baskets) b.limits.maxStocks = Math.min(12, PLANS[st.plan].maxStocks);
    st.billing = st.plan === 'pro' ? (PRICES[a.billing] ? a.billing : 'yearly') : null;
    track(st, st.plan === 'pro' ? 'pro_started' : 'pro_ended', { billing: st.billing || 'none' });
    return { plan: st.plan };
  },
  set_notif(st, a) {
    for (const k of ['push', 'email']) if (a[k] != null) { if (a[k] && !isPro(st)) throw proError('push and email alerts'); st.notif[k] = !!a[k]; }
    return { notif: st.notif };
  },
  set_profile(st, a) { const n = String(a.name || '').trim(); if (!n) throw new ApiError('bad_name', 'Name can\'t be empty'); st.user.name = n.slice(0, 40); return { user: st.user }; },
  finish_onboarding(st, a) { st.onboarded = true; track(st, 'onboarding_path_chosen', { path: a.path }); return { ok: true }; },
  track_event(st, a) { track(st, a.name, a.props || {}); return { ok: true }; },
  advance_day(st) { const r = runDay(st, provider(st)); return { clock: st.clock, ...r }; },
  advance_quarter(st) {
    const prov = provider(st);
    const filings = [], changes = [];
    for (let i = 0; i < 63; i++) { const r = runDay(st, prov); filings.push(...r.filings); changes.push(...r.changes); }
    return { clock: st.clock, filings, changes };
  },
};

// What the user should do next, most urgent first: orders with a sell the rules or news asked for,
// then other orders, urgent alerts that have no order to confirm, baskets short of stocks,
// baskets not invested yet, and last the news flags that only wait for results.
function todoList(st) {
  const out = [];
  const bname = id => st.baskets.find(b => b.id === id)?.name || 'a basket';
  const groups = {};
  for (const o of st.orders.filter(o => o.status === 'pending')) (groups[o.basketId] ||= []).push(o);
  for (const [bid, os] of Object.entries(groups)) {
    const who = [os.some(o => o.source === 'claude') && 'Claude', os.some(o => o.source === 'rules') && 'the rules', os.some(o => o.source === 'you') && 'you'].filter(Boolean);
    const by = who[0] || 'you';
    const sells = os.filter(o => o.side === 'sell').length, buys = os.length - sells;
    const urgentSell = os.some(o => o.side === 'sell' && (o.source === 'rules' || o.tag === 'rules' || o.tag === 'news_only'));
    out.push({ kind: 'orders', priority: urgentSell ? 0 : 1, basketId: bid, ids: os.map(o => o.id), by,
      text: `Confirm ${os.length} order${os.length > 1 ? 's' : ''} in ${bname(bid)}`, detail: `${[buys && `${buys} buy`, sells && `${sells} sell`].filter(Boolean).join(', ')} · prepared by ${who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : by}` });
  }
  // An urgent alert that came with an order is covered by that order (above) while it waits, and is settled once the order is confirmed or cancelled.
  const urgent = st.alerts.filter(a => a.critical && !a.read && a.action?.kind !== 'orders');
  if (urgent.length) out.push({ kind: 'alerts', priority: 2, text: `Read ${urgent.length} urgent alert${urgent.length > 1 ? 's' : ''}`, detail: urgent[0].text });
  for (const b of st.baskets) if (b.kind === 'model' && b.symbols.length < b.limits.minStocks && !groups[b.id]) out.push({ kind: 'basket', priority: 3, basketId: b.id, text: `${b.name} needs ${b.limits.minStocks - b.symbols.length} more stock${b.limits.minStocks - b.symbols.length > 1 ? 's' : ''}`, detail: 'Add stocks or ask Claude to find some' });
  for (const b of st.baskets) if (b.kind === 'model' && !invested(b) && !groups[b.id] && b.symbols.length >= b.limits.minStocks) out.push({ kind: 'invest', priority: 4, basketId: b.id, text: `Invest in ${b.name}`, detail: 'Not invested yet' });
  const flags = st.flags.filter(f => f.status === 'open');
  if (flags.length) out.push({ kind: 'flags', priority: 5, text: `${flags.length} news flag${flags.length > 1 ? 's' : ''} waiting for results`, detail: flags.map(f => `${f.name}: ${f.metricLabel}`).join(' · ') });
  return out.sort((a, b) => a.priority - b.priority);
}

const READ_LABEL = { get_universe: 'Looked through the stock list', get_basket_status: 'Checked basket status', get_alerts: 'Read your alerts', get_refill_plan: 'Checked replacement options', get_rule_scorecard: 'Read the past test', get_activity: 'Caught up on recent activity' };
const ids = os => (os || []).map(o => o.id);
function activitySummary(st, op, a, res) {
  const d = res.ok ? res.data : null;
  const bn = id => st.baskets.find(b => b.id === id)?.name || (st.baskets.length === 1 ? st.baskets[0].name : 'basket');
  if (!res.ok) return { text: `Tried to ${op.replace(/_/g, ' ')}: ${res.error.message}`, kind: 'error' };
  switch (op) {
    case 'create_basket': return { text: `Created basket "${d.basket.name}" with ${d.basket.count} stock${d.basket.count === 1 ? '' : 's'}${d.skipped.length ? ` (${d.skipped.length} skipped: rules, limits or plan)` : ''}`, kind: 'change', basketId: d.basket.id };
    case 'update_basket': return { text: `Edited basket "${d.basket.name}"`, kind: 'change', basketId: d.basket.id };
    case 'add_stock': return { text: `Added ${st.universe[upper(a.symbol)]?.name || a.symbol} to "${d.basket.name}"`, kind: 'change', basketId: d.basket.id };
    case 'remove_stock': return d.orders ? { text: `Prepared a sale of ${st.universe[upper(a.symbol)]?.name || a.symbol}`, kind: 'needs_you', orderIds: ids(d.orders) } : { text: `Removed ${st.universe[upper(a.symbol)]?.name || a.symbol} from "${d.basket.name}"`, kind: 'change' };
    case 'exit_basket': return { text: d.orders.length ? `Prepared exit of "${bn(a.basket_id)}": ${d.orders.length} sell orders` : `Exit of "${bn(a.basket_id)}": nothing to sell`, kind: d.orders.length ? 'needs_you' : 'change', orderIds: ids(d.orders) };
    case 'create_order': return { text: `Prepared ${d.orders.length} ${d.orders[0]?.side || ''} order${d.orders.length > 1 ? 's' : ''} for "${bn(d.orders[0]?.basketId)}" (about ${fmtINR(d.orders.reduce((t, o) => t + o.estValue, 0))})`, kind: 'needs_you', basketId: d.orders[0]?.basketId, orderIds: ids(d.orders) };
    case 'add_news_flag': return { text: `Flagged news on ${d.flag.name}: ${d.flag.metricLabel} likely ${d.flag.impact}${d.drafted_orders.length ? ' · sell prepared' : ''}`, kind: d.drafted_orders.length ? 'needs_you' : 'change', orderIds: ids(d.drafted_orders) };
    case 'set_rule': return { text: `Changed "${d.rule.label}" limits in ${d.applied_to}`, kind: 'change' };
    case 'toggle_rule': return { text: `Turned "${d.rule.label}" ${d.rule.enabled ? 'on' : 'off'} in ${d.applied_to}`, kind: 'change' };
    case 'set_basket_rule': return { text: `Changed basket limits of "${d.basket.name}"`, kind: 'change' };
    case 'add_candidate': return { text: `Added ${d.stock.name} (${d.stock.symbol}) to the stock list`, kind: 'change' };
    // ---- things only the person does in the website ----
    case 'confirm_order': {
      if (!d.filled.length) return null;
      const buys = d.filled.filter(o => o.side === 'buy'), sells = d.filled.filter(o => o.side === 'sell');
      const part = (os, verb) => os.length && `${verb} ${os.length === 1 ? os[0].name : `${os.length} stocks`} (${fmtINR(os.reduce((t, o) => t + (o.fill?.value ?? o.estValue), 0))})`;
      const where = [...new Set(d.filled.map(o => o.basketId))];
      return { text: d.exits.length ? `Exited "${d.exits[0].name}": ${fmtINR(d.exits[0].returnedCash)} back as cash` : `${[part(buys, 'Bought'), part(sells, 'Sold')].filter(Boolean).join(', ')}${where.length === 1 ? ` in "${bn(where[0])}"` : ''}`, kind: 'change', basketId: where[0] };
    }
    case 'cancel_order': return { text: d.order.side === 'sell' && (d.order.source === 'rules' || d.order.tag === 'news_only' || d.order.tag === 'rules') ? `Kept ${d.order.name} anyway` : d.order.source === 'rules' ? `Skipped the suggested ${d.order.side} of ${d.order.name}` : `Cancelled the ${d.order.side} order for ${d.order.name}`, kind: 'change', basketId: d.order.basketId };
    case 'delete_basket': return { text: `Deleted basket "${d.name || a.name || 'basket'}"`, kind: 'change' };
    case 'duplicate_basket': return { text: `Copied a basket as "${d.basket.name}"`, kind: 'change', basketId: d.basket.id };
    case 'reset_rules': return { text: d.scope === 'defaults' ? 'Reset the default rules to the original 13' : `Reset the rules of "${bn(a.basket_id)}" to default`, kind: 'change' };
    case 'apply_default_rules': return { text: `Applied the default rules to ${d.baskets_updated} basket${d.baskets_updated === 1 ? '' : 's'}`, kind: 'change' };
    case 'delete_news_flag': return { text: 'Removed a news flag', kind: 'change' };
    case 'advance_day': case 'advance_quarter': {
      const f = new Set(d.filings.map(x => x.symbol)).size, c = d.changes.length; // a tick that changed nothing in the user's baskets is not news
      return c ? { text: `Rules check: ${c} status change${c === 1 ? '' : 's'} in your baskets${f ? ` · new results for ${f} compan${f === 1 ? 'y' : 'ies'}` : ''}`, kind: 'change', actor: 'rules' } : null;
    }
    default: return { text: READ_LABEL[op] || op.replace(/_/g, ' '), kind: 'read' };
  }
}

function basketBacktest(st, b) {
  return backtest(b.rules, HISTORY, NAMES, b.theme ? { theme: b.theme, minTheme: b.limits.minTheme } : { symbols: new Set(candidatesFor(st, b).map(u => u.symbol)) });
}
function statusesSnapshot(st, b) { return Object.fromEntries(candidatesFor(st, b).map(u => [u.symbol, scoreIn(st, b, u.symbol).status])); }
function diffStatuses(a, b) { return Object.keys(b).filter(k => a[k] !== b[k]).map(k => ({ symbol: k, from: a[k], to: b[k] })); }
function dedupe(list) { const seen = new Set(); return list.filter(x => (seen.has(x.symbol) ? false : seen.add(x.symbol))); }

export const OP_NAMES = Object.keys(OPS);
// Destructive or money-moving actions stay with the person, in the website.
// Rule editing through Claude (default rules and basket rules) is a Pro feature. The website keeps free switches.
export const CLAUDE_PRO_RULES = new Set(['set_rule', 'toggle_rule', 'reset_rules', 'apply_default_rules', 'set_basket_rule']);
export const PERSON_ONLY = new Set(['confirm_order', 'set_plan', 'delete_basket', 'delete_candidate', 'delete_journal', 'clear_alerts']);

export function dispatch(st, op, args = {}, actor = 'you') {
  const fn = OPS[op];
  if (!fn) return { ok: false, error: { code: 'unknown_op', message: `Unknown operation ${op}` } };
  // Any call from Claude, even a refused one, proves the connector works: stamp when it was last seen.
  if (actor === 'claude') { st.lastClaudeCall = { op, at: st.clock, time: new Date().toISOString() }; st.claudeConnected = true; }
  if (actor === 'claude' && PERSON_ONLY.has(op)) { const res = { ok: false, error: { code: 'person_only', message: 'Only a person can do this, in the website.' } }; logActivity(st, op, args, res); return res; }
  try {
    if (actor === 'claude' && CLAUDE_PRO_RULES.has(op) && !isPro(st)) throw proError('Claude editing your rules');
    const res = { ok: true, data: fn(st, args || {}, actor) };
    if (actor === 'claude' || USER_LOGGED.has(op)) logActivity(st, op, args, res, actor);
    return res;
  } catch (e) {
    const res = e instanceof ApiError ? (() => { const { code, message, ...rest } = e; return { ok: false, error: { code, message, ...rest } }; })() : { ok: false, error: { code: 'internal', message: e.message } };
    if (actor === 'claude') logActivity(st, op, args, res);
    return res;
  }
}
// The activity log is "what happened": every Claude call (look-ups included, kind 'read') and the
// person's own meaningful website actions (actor 'you'). Website reads, settings and failed taps are not logged.
const USER_LOGGED = new Set(['create_basket', 'update_basket', 'duplicate_basket', 'delete_basket', 'exit_basket', 'add_stock', 'remove_stock', 'add_candidate',
  'set_rule', 'toggle_rule', 'reset_rules', 'apply_default_rules', 'set_basket_rule', 'confirm_order', 'cancel_order', 'add_news_flag', 'delete_news_flag', 'advance_day', 'advance_quarter']);
function logActivity(st, op, args, res, actor = 'claude') {
  st.activity ||= [];
  let sum;
  try { sum = activitySummary(st, op, args || {}, res); } catch { sum = { text: op.replace(/_/g, ' '), kind: res.ok ? 'change' : 'error' }; }
  if (!sum || (actor !== 'claude' && sum.kind === 'read')) return;
  // The person's own drafts go straight to their review sheet and to-do list; the log records the confirm instead.
  if (actor !== 'claude' && sum.kind === 'needs_you') { if (op !== 'add_news_flag') return; sum.kind = 'change'; }
  st.activity.unshift({ id: `c${(st.actSeq = (st.actSeq || 0) + 1)}`, at: new Date().toISOString(), clock: st.clock, actor, tool: op, ok: res.ok, ...sum });
  // Keep the log bounded; look-ups go first so they never push real actions out.
  while (st.activity.length > 300) { const i = st.activity.findLastIndex(x => x.kind === 'read'); st.activity.splice(i < 0 ? st.activity.length - 1 : i, 1); }
}
// Snapshot for the website: recent actions plus a few look-ups, newest first.
function recentActivity(st) {
  let acts = 0, reads = 0;
  return (st.activity || []).filter(x => (x.kind === 'read' ? reads++ < 20 : acts++ < 60));
}
// "needs_you" entries say whether the orders they prepared are still waiting (pending) or already settled.
function activityView(st, list) {
  return list.map(x => (x.kind === 'needs_you' && x.orderIds ? { ...x, pending: x.orderIds.some(id => st.orders.some(o => o.id === id && o.status === 'pending')) } : x));
}
