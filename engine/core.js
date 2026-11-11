// FunInvestments engine: one backend, two doors.
// The website (actor "you") and MCP/Claude (actor "claude") both call dispatch().
// Plain deterministic code. No AI anywhere.
import { defaultRuleSet, scoreStock, band, labelOf, DEFAULT_RULES, fmtThreshold, cutoffsOf, DEFAULT_CUTOFFS } from './rules.js';
import { buildHistory, buildPriceHistory, buildUniverse, SEED_PRICES, SEED_PREV, NIFTY_SEED, NIFTY_PREV, FILINGS, STOCKS, STAGES, THEMES } from './data.js';
import { MockProvider } from './market.js';
import { backtest } from './scorecard.js';
import { stepDailyMetrics, pinStoryData, STRIKE_WINDOW, usualOf } from './daily.js';

export const HISTORY = buildHistory();
export const PRICE_HISTORY = buildPriceHistory(HISTORY);
const NAMES = Object.fromEntries(STOCKS.map(s => [s.symbol, s.name]));
const STAGE_LABEL = { ...Object.fromEntries(STAGES.map(s => [s.id, s.label])), other: 'Other' };
const STAGE_THEME = Object.fromEntries(STAGES.map(s => [s.id, s.theme]));
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
const FREE_RULES_TEXT = 'On Free every basket is rated with the 13 default rules and the default rating cutoffs (Buy below 4 warnings, Sell above 8), read-only; reset_rules still works. Pro lets the user (and Claude) switch rules on or off and change their limits and cutoffs, for the default rules and each basket.';
const FREE_ALTERNATIVE = {
  'more baskets': 'On Free you have 1 basket: add the stocks to the existing basket, or exit and delete it first.',
  'more tracking baskets': 'On Free you have 1 tracking basket: add holdings to it instead.',
  'custom thresholds': 'On Free, create the basket without custom rules; it uses the 13 default rules.',
  'edit thresholds': FREE_RULES_TEXT,
  'edit rules': FREE_RULES_TEXT,
  'Claude editing your rules': FREE_RULES_TEXT,
  'event rules': 'Company-event rules need Pro; the 13 core rules work on Free.',
  'basket limits': 'On Free, basket limits (stock count, weight caps, theme share) stay at their defaults.',
  'what-if': 'Previewing rule changes needs Pro.',
  'share card': 'Sharing rule results needs Pro.',
  'push and email alerts': 'On Free, urgent alerts still arrive as browser notifications; other alerts show in the app.',
};
// What Pro adds for each refused feature, so the upgrade hint matches the limit that was hit.
const PRO_GIVES = {
  'more baskets': 'unlimited baskets', 'more tracking baskets': 'unlimited tracking baskets',
  'basket limits': 'editable basket limits (stock count, weight caps, theme share)', 'what-if': 'rule previews', 'share card': 'share cards',
  'push and email alerts': 'push and email alerts', 'event rules': 'company-event rules',
};
const proGives = f => PRO_GIVES[f] || (/stocks$/.test(f) ? 'up to 12 stocks per basket' : /news flags/.test(f) ? 'unlimited news flags' : /rules|thresholds/.test(f) ? 'editable rules, limits and rating cutoffs' : 'more');
function limitAlternative(feature) {
  let m = feature.match(/^more than (\d+) stocks$/);
  if (m) return `A Free basket holds up to ${m[1]} stocks (Pro: 12). Remove or swap a stock to make room: remove_stock, then add_stock.`;
  m = feature.match(/^more than (\d+) news flags a month$/);
  if (m) return `Free allows ${m[1]} news flags a month; the count starts again next month. Withdraw an open flag you no longer need, or wait for the results to settle one.`;
  return null;
}
const proError = feature => new ApiError('pro_feature', `Pro feature: ${feature}`, {
  upgrade: '#pricing', feature,
  free_alternative: FREE_ALTERNATIVE[feature] || limitAlternative(feature) || 'Available on Free in a simpler form.',
  how_to_upgrade: `${PRICE_TEXT.replace('for unlimited baskets', `for ${proGives(feature)}`)}. In this demo the user can switch plans on the FunInvestments Home page (no payment).`,
});
const SAVED_PRO_RULES = 'Your Pro rules are saved and come back when you upgrade.';

// ---------------- state ----------------
export function createState() {
  return {
    v: 4, seq: 1, clock: '2026-09-01', tradingDay: 0, plan: 'free',
    user: { name: 'Tushar', apiKey: 'fi_demo_7f3a9c21' },
    cash: 100000, startingCash: 100000,
    rules: defaultRuleSet(), universe: pinStoryData(buildUniverse()), dailyV1: true,
    prices: { ...SEED_PRICES }, prevPrices: { ...SEED_PREV }, nifty: NIFTY_SEED, niftyPrev: NIFTY_PREV,
    baskets: [], orders: [], alerts: [], clearedAlerts: [], flags: [], journal: [], decisions: [], events: [], activity: [],
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
// Free always rates with the 13 default rules and the default cutoffs. Custom rules (defaults or a basket's)
// are Pro: on Free they stay saved, unused, and apply again on Pro.
const FREE_RULES = defaultRuleSet();
export const rulesOf = (st, rs) => (isPro(st) ? rs : FREE_RULES);
const ruleKey = rs => JSON.stringify({ c: cutoffsOf(rs), m: rs.metrics.map(r => [r.id, r.green, r.red, !!r.enabled, !!r.critical]), e: rs.events.map(r => [r.id, !!r.enabled]) });
const FREE_KEY = ruleKey(FREE_RULES);
const isCustomRules = rs => !!rs && ruleKey(rs) !== FREE_KEY;
// True when the person is on Free and has Pro rules waiting (default rules or any basket's).
const savedProRules = st => !isPro(st) && (isCustomRules(st.rules) || st.baskets.some(b => isCustomRules(b.rules)));

function scoreIn(st, b, sym, prev) {
  const u = st.universe[sym];
  if (!u) return null;
  if (!b) return scoreStock(u, rulesOf(st, st.rules));
  return scoreStock(u, rulesOf(st, b.rules), { prevStatus: prev, theme: b.theme, minTheme: b.limits.minTheme });
}
// What the basket shows for a stock: its last checked rating (statusPrev), else the live one.
const shownStatus = (st, b, sym) => b.statusPrev[sym] || scoreIn(st, b, sym)?.status;
// Segment caps (no segment over 40% by default) apply to known segments: in an AC or Energy basket only to
// that theme's segments, in a basket with no theme to every known segment. A basket with the person's own theme
// (themeName, e.g. "Defence") and a stock with no known segment ("other") have no segment cap.
const capped = (b, stage) => !b.themeName && !!STAGE_THEME[stage] && (!b.theme || STAGE_THEME[stage] === b.theme);
// Rules values against their limits, compactly, for the amber and red rules: why a stock has its rating.
function whyOf(st, u, rs, s) {
  const out = [];
  for (const r of rs.metrics) {
    if (!r.enabled) continue;
    const bd = band(r, u.metrics?.[r.id]);
    if (bd === 'red' || bd === 'amber') out.push({ rule: r.id, label: r.label, value: u.metrics[r.id], limit: bd === 'red' ? r.red : r.green, band: bd, must_pass: !!r.critical });
  }
  if (s?.lowTheme) out.unshift({ rule: 'theme', label: 'Share of business in the theme', value: s.themeShare ?? 0, limit: s.minTheme, band: 'red', must_pass: true });
  for (const e of s?.events || []) out.push({ rule: e, label: labelOf(e), value: true, limit: false, band: 'red', must_pass: !!rs.events.find(x => x.id === e)?.critical });
  return out;
}
function getBasket(st, id) {
  const b = st.baskets.find(x => x.id === id) || (st.baskets.length === 1 && !id ? st.baskets[0] : null);
  const list = st.baskets.map(x => `${x.name} (${x.id})`).join(', ');
  if (!b) throw new ApiError(id ? 'not_found' : 'which_basket', id ? `No basket "${id}". ${st.baskets.length ? `The baskets are: ${list}.` : 'There are no baskets yet.'}` : st.baskets.length ? `Which basket? Pass basket_id, one of: ${list}.` : 'There are no baskets yet. Create one first (create_basket), or check the user is in the same space (get_activity → website).');
  return b;
}

// Which rule sets an edit touches. scope: 'basket' (one basket), 'defaults' (the rules new baskets start with,
// also used to rate stocks in Explore) or 'all' (defaults + every basket). With no scope: a named basket, else
// the only basket, else the defaults, so a user with no baskets can still change their rules.
function ruleTargets(st, a) {
  if (!a.scope && !a.basket_id && st.baskets.length > 1) throw new ApiError('which_rules', `Say which rules: scope "defaults" (new baskets + stock ratings), "all" (defaults and every basket), or a basket_id, one of: ${st.baskets.map(x => `${x.name} (${x.id})`).join(', ')}.`);
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

// Why a stock can't be added to a basket right now (same checks as add_stock), for the Add buttons.
function addBlocks(st, b) {
  const out = {};
  const max = Math.min(b.limits.maxStocks, plan(st).maxStocks);
  const full = b.symbols.length >= max;
  for (const u of Object.values(st.universe)) {
    if (b.symbols.includes(u.symbol)) continue;
    if (full) { out[u.symbol] = `Basket is full (${max} max${isPro(st) ? '' : ' on Free'})`; continue; }
    const s = scoreIn(st, b, u.symbol);
    if (s.status === 'remove') { out[u.symbol] = `Rated Sell here: ${s.reasons[0]}`; continue; }
    if (capped(b, u.stage) && b.symbols.length + 1 >= b.limits.minStocks) {
      const sw = stageWeights(st, targetWeights(st, b, [...b.symbols, u.symbol]).weights);
      if ((sw[u.stage] || 0) > b.limits.maxStageWeight + 0.01) out[u.symbol] = `Over the ${b.limits.maxStageWeight}% ${STAGE_LABEL[u.stage] || u.stage} limit`;
    }
  }
  return out;
}

// symbols: the stocks that stay (a stock with a rules sell waiting is on its way out).
export function refillPlan(st, basket, symbols = staying(st, basket)) {
  const L = basket.limits;
  const need = L.minStocks - symbols.length;
  const res = { needed: Math.max(0, need), picks: [], skipped: [], short: 0 };
  if (need <= 0) return res;
  const held = new Set(basket.symbols);
  const cands = candidatesFor(st, basket)
    .filter(u => !held.has(u.symbol) && st.prices[u.symbol] != null)
    .map(u => ({ u, s: scoreIn(st, basket, u.symbol) }))
    .filter(x => x.s.status !== 'remove');
  const cooled = c => basket.removedAt[c.u.symbol] && daysBetween(basket.removedAt[c.u.symbol], st.clock) < COOLDOWN_DAYS;
  let current = [...symbols];
  for (const tier of ['pass', 'watch']) {
    const list = cands.filter(c => c.s.status === tier)
      .sort((a, b) => a.s.points - b.s.points || (b.u.metrics.adtv ?? 0) - (a.u.metrics.adtv ?? 0));
    for (const c of list) {
      if (res.picks.length >= need) break;
      if (cooled(c)) { res.skipped.push({ symbol: c.u.symbol, name: c.u.name, tier, why: 'Sold in the last 90 days (cool-down)' }); continue; }
      const trial = [...current, c.u.symbol];
      const sw = stageWeights(st, targetWeights(st, basket, trial).weights);
      if (capped(basket, c.u.stage) && (sw[c.u.stage] || 0) > L.maxStageWeight + 0.01) { res.skipped.push({ symbol: c.u.symbol, name: c.u.name, tier, why: `${STAGE_LABEL[c.u.stage] || c.u.stage} already at its ${L.maxStageWeight}% limit` }); continue; }
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

// Stocks on their way out: a rules-made sell that removes the stock is waiting for the person.
const outgoing = (st, b) => st.orders.filter(o => o.basketId === b.id && o.status === 'pending' && o.side === 'sell' && o.removeAfter && o.tag === 'rules').map(o => o.symbol);
const staying = (st, b) => { const out = outgoing(st, b); return b.symbols.filter(s => !out.includes(s)); };
const quarterOf = d => `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

// Keeps a basket at its minimum number of stocks. A not-yet-invested basket gets the picks added at once;
// an invested one gets replacement buys to review. When the rules prepare a sell that would take the basket
// below its minimum, the replacement is prepared at the same time, so the person sees both together.
// A replacement the person declined is not drafted again until something changes: the next quarter, or the
// basket dropping further.
// A replacement drafted for a sell that is no longer waiting (kept anyway, or the stock recovered) is not needed.
function dropStaleRefills(st, b, out = outgoing(st, b)) {
  for (const o of st.orders) if (o.basketId === b.id && o.status === 'pending' && o.tag === 'refill' && o.replaces?.length && !o.replaces.some(x => out.includes(x))) cancelOrder(st, o, 'The sell it replaced was cancelled');
}
function ensureRefill(st, b) {
  if (b.kind !== 'model') return null;
  const out = outgoing(st, b);
  const stay = b.symbols.filter(s => !out.includes(s));
  dropStaleRefills(st, b, out);
  if (stay.length >= b.limits.minStocks) { delete b.refillDeclined; return null; }
  if (st.orders.some(o => o.basketId === b.id && o.status === 'pending' && o.tag === 'refill')) return null;
  const dec = b.refillDeclined;
  if (dec && dec.q === quarterOf(st.clock) && stay.length >= dec.count) return null;
  if (dec) delete b.refillDeclined;
  const p = refillPlan(st, b, stay);
  const why = [...p.picks.map(x => `Pick ${x.name}: ${x.why}`), ...p.skipped.slice(0, 3).map(x => `Skipped ${x.name}: ${x.why}`)];
  const orders = [];
  const names = out.map(s => st.universe[s]?.name || s);
  if (!invested(b)) {
    for (const x of p.picks) { b.symbols.push(x.symbol); b.statusPrev[x.symbol] = scoreIn(st, b, x.symbol).status; logDecision(st, { basketId: b.id, symbol: x.symbol, action: 'refill_add', trigger: x.why, source: 'rules' }); }
  } else if (p.picks.length) {
    const value = basketValue(st, b);
    const tw = targetWeights(st, b, [...stay, ...p.picks.map(x => x.symbol)]);
    let budget = b.cash + st.cash + out.reduce((t, s) => t + (b.holdings[s]?.qty || 0) * (st.prices[s] || 0) * (1 - SLIPPAGE), 0);
    for (const x of p.picks) {
      const px = st.prices[x.symbol];
      const qty = Math.floor(Math.min(budget, (value * (tw.weights[x.symbol] || 0)) / 100) / buyPx(px));
      if (qty < 1) { why.push(`${x.name} not drafted: one share costs more than its part of the basket`); continue; }
      budget -= qty * px;
      orders.push(makeOrder(st, { basketId: b.id, symbol: x.symbol, side: 'buy', qty, source: 'rules', tag: 'refill', addOnFill: true, replaces: out.length ? out : undefined, reason: `Replacement${names.length ? ` for ${names.join(', ')}` : ''}: ${x.why}` }));
    }
  }
  const count = `${b.name} has ${stay.length} stock${stay.length === 1 ? '' : 's'}${out.length ? ` after the sell of ${names.join(', ')}` : ''} (needs ${b.limits.minStocks})`;
  const text = orders.length ? `${count} · replacement ready to review` : p.picks.length && !invested(b) ? `${count} · replacement added` : p.short ? `${count} · find new ones` : null;
  // The replacement for a rules sell is shown with that sell: same alert, same review (sell first, then the buy).
  const sellAlert = orders.length && out.length ? st.alerts.find(a => a.basketId === b.id && a.action?.kind === 'orders' && a.action.ids.some(id => st.orders.find(o => o.id === id && o.status === 'pending' && o.side === 'sell' && out.includes(o.symbol)))) : null;
  if (sellAlert) {
    sellAlert.action = { kind: 'orders', ids: [...sellAlert.action.ids, ...orders.map(o => o.id)] };
    sellAlert.text = sellAlert.text.replace(/ · sell order ready to review$/, ' · sell and replacement ready to review');
    sellAlert.why = [...(sellAlert.why || []), `${count}. Replacement: ${orders.map(o => `buy ${o.qty} ${o.name}`).join(', ')}`, ...why];
    return { orders };
  }
  // One "find new ones" alert per basket is enough: it is kept up to date, never repeated.
  if (text && orders.length === 0) st.alerts = st.alerts.filter(a => !(a.basketId === b.id && a.type === 'refill' && !a.action?.ids && !a.settled));
  if (text) {
    addAlert(st, {
      basketId: b.id, type: 'refill', text,
      why: [...why, ...(p.short ? [`${p.short} slot(s) kept as cash for now`] : [])],
      action: orders.length ? { kind: 'orders', ids: orders.map(o => o.id) } : p.short ? { kind: 'claude', prompt: p.prompt } : null,
    });
  }
  return { plan: p, orders };
}

// ---------------- orders ----------------
function cancelOrder(st, o, reason) { Object.assign(o, { status: 'cancelled', cancelReason: reason, cancelledAt: st.clock }); return o; }

// An alert that pointed at orders is settled once none of them waits any more: its text says what happened
// ("kept anyway", "sold", "sell cancelled") and it no longer asks for a review.
function settleText(os) {
  const main = os.filter(o => o.tag !== 'refill'), refills = os.filter(o => o.tag === 'refill');
  if (main.length && refills.length) return settleText(main) + (refills.every(o => o.status === 'filled') ? ' · replacement bought' : '');
  const filled = os.filter(o => o.status === 'filled');
  if (filled.length === os.length) return os.every(o => o.side === 'sell') ? 'sold' : os.every(o => o.side === 'buy') ? (os.some(o => o.tag === 'refill') ? 'replacement bought' : 'bought') : 'done';
  if (filled.length) return 'partly done';
  const r = os[0].cancelReason || '';
  if (/^Back to /.test(r)) return `${r.split(' before')[0].replace('Back to', 'back to')} · sell order cancelled`;
  if (/not confirmed|Flag cleared/i.test(r)) return 'news not confirmed by results · sell order cancelled';
  if (/withdrawn/i.test(r)) return 'flag withdrawn · sell order cancelled';
  if (/exit/i.test(r)) return 'replaced by the exit';
  if (/replaced was cancelled/.test(r)) return 'not needed: the sell was kept';
  if (/Stock removed|Basket deleted/.test(r)) return 'cancelled';
  if (os.every(o => o.side === 'sell') && os.some(o => o.source === 'rules' || o.tag === 'rules' || o.tag === 'news_only')) return 'kept anyway';
  if (os.some(o => o.tag === 'refill')) return 'replacement skipped';
  return 'cancelled';
}
function settleOrderAlerts(st) {
  for (const al of st.alerts) {
    if (al.action?.kind !== 'orders') continue;
    const os = al.action.ids.map(id => st.orders.find(o => o.id === id)).filter(Boolean);
    if (os.some(o => o.status === 'pending')) continue;
    const how = os.length ? settleText(os) : 'cancelled';
    const base = al.text.replace(/ · (sell order|replacement|sell and replacement) ready to review$/, '');
    al.text = /^back to /.test(how) ? `${base.replace(/ → ✕ Sell$/, '')} is ${how}` : `${base} · ${how}`;
    al.settled = { how, at: st.clock, ids: al.action.ids };
    al.action = null; al.read = true; al.critical = false; // settled: nothing urgent is left to do
  }
}

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

// A Sell that comes only from daily numbers (trading value, swings, sensitivity, biggest fall, price vs usual,
// price vs growth): without them the stock would not be Sell. One such check is a heads-up; see STRIKE_WINDOW.
function dailyOnlySell(st, b, s) {
  if (s.status !== 'remove' || s.lowTheme || s.events.length) return false;
  if (s.criticalReds.some(id => !DAILY_RULES.has(id))) return false;
  const dailyPts = s.reds.filter(id => DAILY_RULES.has(id)).length * 2 + s.ambers.filter(id => DAILY_RULES.has(id)).length;
  return s.criticalReds.length > 0 || s.points - dailyPts <= cutoffsOf(rulesOf(st, b.rules)).sellAbove;
}
const fmtVal = (id, v) => { const r = DEFAULT_RULES.find(x => x.id === id); return v == null ? '—' : r?.unit === '₹ cr' ? `₹${v} cr` : `${v}${r?.unit === '%' ? '%' : r?.unit === '×' ? '×' : ''}`; };

function trackingSellAlert(st, b, sym) {
  const s = scoreIn(st, b, sym);
  addAlert(st, { basketId: b.id, symbol: sym, type: 'critical', critical: true, text: `${st.universe[sym].name} → ✕ Sell · consider selling in your broker`,
    why: [`Rated Sell by your rules when you added it: ${s.reasons.join(' · ')}`, ...ruleLines(st, b, sym).filter(l => l.band === 'red').map(l => `${l.label}: ${l.valueText} (limit ${l.red})`), 'This is a tracking basket: the app places no orders. Sell in your own broker if you agree.'] });
}
export function checkBasket(st, b, kind) {
  const changes = [];
  b.strikeAt ||= {};
  for (const sym of [...b.symbols]) {
    const prev = b.statusPrev[sym];
    const s = scoreIn(st, b, sym, prev);
    if (!s) continue;
    const u = st.universe[sym];
    const toRemove = s.status === 'remove' && prev !== 'remove';
    // Daily numbers: the first bad check is a heads-up and the stock keeps its rating. A second bad check
    // within STRIKE_WINDOW trading days (even after a day back in range) makes it Sell.
    if (toRemove && kind !== 'rules' && dailyOnlySell(st, b, s)) {
      const last = b.strikeAt[sym];
      if (last == null || st.tradingDay - last > STRIKE_WINDOW) {
        b.strikeAt[sym] = st.tradingDay;
        const id = [...s.criticalReds, ...s.reds.filter(x => DAILY_RULES.has(x))][0];
        const r = DEFAULT_RULES.find(x => x.id === id);
        const usual = usualOf(u, id);
        addAlert(st, { basketId: b.id, symbol: sym, type: 'strike', text: `${u.name} · ${labelOf(id)} ${r?.dir === 'higher' ? 'dipped below' : 'went above'} the limit`,
          sub: `${usual !== u.metrics[id] ? `${fmtVal(id, usual)} → ` : ''}${fmtVal(id, u.metrics[id])}${id === 'adtv' ? ' a day' : ''} · limit ${fmtVal(id, rulesOf(st, b.rules).metrics.find(x => x.id === id)?.red)}`,
          why: [`${labelOf(id)}: ${fmtVal(id, u.metrics[id])} today${usual !== u.metrics[id] ? `, usually ${fmtVal(id, usual)}` : ''}.`, `First bad check, so it stays ${STATUS_WORD[prev] || 'as rated'}. If it is past the limit again at a check within ${STRIKE_WINDOW} trading days, it becomes Sell${b.holdings[sym]?.qty > 0 && b.kind === 'model' ? ' and a sell order is prepared' : ''}.`] });
        continue;
      }
    }
    if (s.status === prev) continue;
    // A stock back to Buy/Hold while a rules-made sell still waits: that sell is stale, cancel it (on Free too).
    const staleSells = s.status !== 'remove' ? st.orders.filter(o => o.basketId === b.id && o.symbol === sym && o.side === 'sell' && o.status === 'pending' && o.tag === 'rules') : [];
    if (!isPro(st) && kind === 'daily' && !toRemove && !staleSells.length) continue; // Free: weekly, except critical
    b.statusPrev[sym] = s.status;
    delete b.strikeAt[sym];
    const name = u.name;
    changes.push({ symbol: sym, from: prev, to: s.status });
    logDecision(st, { basketId: b.id, symbol: sym, action: `status_${s.status}`, from: prev, trigger: s.reasons[0], source: 'rules' });
    const filing = (st._filedToday || {})[sym];
    const why = [...(filing ? [`New results: ${filing}`] : []), s.reasons.join(' · '), ...ruleLines(st, b, sym).filter(l => l.band === 'red' || l.band === 'amber').map(l => `${l.label}: ${l.valueText} (${l.band}, limit ${l.band === 'red' ? l.red : l.green})`)];
    if (s.status === 'remove') {
      const h = b.holdings[sym];
      if (b.kind === 'tracking') addAlert(st, { basketId: b.id, symbol: sym, type: 'critical', critical: true, text: `${name} → ✕ Sell · consider selling in your broker`, why });
      else if (h && h.qty > 0) {
        let order = st.orders.find(o => o.basketId === b.id && o.symbol === sym && o.side === 'sell' && o.status === 'pending');
        if (order) { order.tag = 'rules'; order.reason = `Rules: ${s.reasons[0]}`; order.removeAfter = true; delete order.flagId; }
        else order = makeOrder(st, { basketId: b.id, symbol: sym, side: 'sell', qty: h.qty, source: 'rules', tag: 'rules', removeAfter: true, reason: `Rules: ${s.reasons[0]}` });
        addAlert(st, { basketId: b.id, symbol: sym, type: 'critical', critical: true, text: `${name} → ✕ Sell · sell order ready to review`, why, action: { kind: 'orders', ids: [order.id] } });
      } else {
        removeFromBasket(st, b, sym, s.reasons[0], 'rules');
        addAlert(st, { basketId: b.id, symbol: sym, type: 'critical', critical: true, text: `${name} → ✕ Sell · taken out of the basket`, why });
      }
    } else {
      for (const o of staleSells) cancelOrder(st, o, `Back to ${STATUS_WORD[s.status]} before it was confirmed`);
      addAlert(st, { basketId: b.id, symbol: sym, type: 'status', text: `${name} ${STATUS_LABEL[prev] || '—'} → ${STATUS_LABEL[s.status]}${staleSells.length ? ' · sell order cancelled' : ''}`, why });
    }
  }
  if (b.kind === 'model' && invested(b)) {
    const d = rebalanceTrades(st, b);
    const busy = st.orders.some(o => o.basketId === b.id && o.status === 'pending');
    // One balance alert per basket, kept up to date (never a new one every month), gone once the basket is back in balance.
    const old = st.alerts.filter(x => x.basketId === b.id && x.type === 'drift');
    if (!d.needed || busy) { if (old.length) st.alerts = st.alerts.filter(x => !(x.basketId === b.id && x.type === 'drift')); }
    else if ((!b.lastDrift || daysBetween(b.lastDrift, st.clock) >= 28 || old.length)) {
      b.lastDrift = st.clock;
      const top = [...d.rows].sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))[0];
      const text = top ? `${top.name} is now ${Math.round(top.actual)}% of ${b.name} (planned ${Math.round(top.target)}%). Rebalance to even it out.` : `${b.name} has drifted from its plan. Rebalance to even it out.`;
      const why = ['Prices moved, so some stocks now take a bigger or smaller share of the basket than you planned.', ...d.rows.filter(r => Math.abs(r.diff) > 1).map(r => `${r.name}: ${Math.round(r.actual)}% now, planned ${Math.round(r.target)}%`)];
      const keep = old[0];
      if (keep && keep.text === text) { /* nothing new to say */ }
      else {
        st.alerts = st.alerts.filter(x => !(x.basketId === b.id && x.type === 'drift'));
        addAlert(st, { basketId: b.id, type: 'drift', text, why, action: { kind: 'rebalance', basketId: b.id } });
      }
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

// Whole-share sizing. Splits `amount` across the basket's target weights; a stock whose single share
// costs more than its part is left out (with the reason) and its part goes to the others.
const buyPx = px => px * (1 + SLIPPAGE);
export function sizePlan(st, b, amount, symbols = b.symbols) {
  const all = targetWeights(st, b, symbols);
  const skipped = [];
  for (const sym of symbols) if (all.statuses[sym] === 'remove') skipped.push({ symbol: sym, name: st.universe[sym]?.name || sym, why: 'Rated Sell by this basket\'s rules, so it isn\'t bought' });
  let set = symbols.filter(x => all.statuses[x] !== 'remove');
  for (let guard = 0; guard < 20 && set.length; guard++) {
    const tw = targetWeights(st, b, set);
    const tooDear = set.filter(x => tw.weights[x] > 0 && buyPx(st.prices[x]) > (amount * tw.weights[x]) / 100);
    if (!tooDear.length) {
      const rows = set.map(x => { const part = (amount * (tw.weights[x] || 0)) / 100; const qty = Math.floor(part / buyPx(st.prices[x])); return { symbol: x, name: st.universe[x]?.name || x, weight: tw.weights[x] || 0, part: r2(part), qty, est: r2(qty * st.prices[x]) }; }).filter(r => r.qty >= 1);
      return { rows, skipped, weights: tw.weights, total: r2(rows.reduce((t, r) => t + r.est, 0)) };
    }
    // Leave out the most expensive one first, then size again (its part goes to the rest).
    const worst = tooDear.sort((x, y) => st.prices[y] - st.prices[x])[0];
    skipped.push({ symbol: worst, name: st.universe[worst]?.name || worst, why: `One share costs ${fmtINR(st.prices[worst])}, more than its ${fmtINR((amount * tw.weights[worst]) / 100)} share of the amount` });
    set = set.filter(x => x !== worst);
  }
  return { rows: [], skipped, weights: {}, total: 0 };
}

// How far the basket is from its target mix. Targets only count stocks the basket can really hold:
// a stock that is not held and whose one share is more than its part is left out (its part goes to the rest).
export function drift(st, b) {
  // A held stock the rules rate Sell is the rules' business (a sell order, or "keep anyway"), not rebalancing's:
  // it is left out of the mix and of the value the targets are shared from.
  const sellHeld = b.symbols.filter(s => (b.holdings[s]?.qty || 0) > 0 && scoreIn(st, b, s, b.statusPrev[s])?.status === 'remove');
  const value = (basketValue(st, b) - sellHeld.reduce((t, s) => t + b.holdings[s].qty * (st.prices[s] ?? 0), 0)) || 1;
  const held = b.symbols.filter(s => (b.holdings[s]?.qty || 0) > 0);
  let set = b.symbols.filter(s => !sellHeld.includes(s));
  let tw = targetWeights(st, b, set);
  for (let i = 0; i < 20; i++) {
    const out = set.filter(s => !held.includes(s) && tw.weights[s] > 0 && st.prices[s] > (value * tw.weights[s]) / 100);
    if (!out.length) break;
    set = set.filter(s => !out.includes(s)); tw = targetWeights(st, b, set);
  }
  const rows = b.symbols.filter(s => !sellHeld.includes(s)).map(s => {
    const actual = r2(((b.holdings[s]?.qty || 0) * st.prices[s] / value) * 100);
    const target = set.includes(s) ? tw.weights[s] || 0 : 0;
    return { symbol: s, name: st.universe[s]?.name, actual, target, diff: r2(actual - target), price: st.prices[s], held: b.holdings[s]?.qty || 0 };
  });
  return { rows, max: rows.reduce((m, r) => Math.max(m, Math.abs(r.diff)), 0), cashTarget: tw.cash, value };
}
// The trades that bring a basket back to its targets, in whole shares. A row moves only when
// a whole number of shares really gets it closer (no 1-share churn from rounding).
export function rebalanceTrades(st, b) {
  const d = drift(st, b);
  const trades = [];
  for (const r of d.rows) {
    if (!r.price) continue;
    const want = Math.round((d.value * r.target) / 100 / r.price);
    const delta = want - r.held;
    if (!delta) continue;
    const after = Math.abs(((want * r.price) / d.value) * 100 - r.target);
    if (Math.abs(r.diff) - after < 1) continue; // under 1 point better: not worth a trade
    trades.push({ symbol: r.symbol, name: r.name, side: delta > 0 ? 'buy' : 'sell', qty: Math.abs(delta), target: r.target, actual: r.actual, est: r2(Math.abs(delta) * r.price) });
  }
  return { ...d, trades, needed: d.max > b.limits.driftTrigger && trades.length > 0 };
}

function ruleLines(st, b, sym) {
  const u = st.universe[sym];
  const rules = rulesOf(st, b ? b.rules : st.rules);
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

// A news flag is settled by the stock's next results. "Worse" is confirmed when the number really moved the
// wrong way and is now past the red limit; then a news-based sell stays (it becomes a rules sell). Otherwise the
// flag is cleared, its sell cancelled and the stock keeps its rating. A stock with no results due is settled at
// the next quarter (63 trading days after the flag) on the numbers it has then.
const FLAG_DAYS = 63;
function resolveFlag(st, fl, source, before) {
  const u = st.universe[fl.symbol];
  const rule = rulesOf(st, st.rules).metrics.find(r => r.id === fl.metric);
  const now = u?.metrics?.[fl.metric], was = fl.value !== undefined ? fl.value : before && fl.metric in before ? before[fl.metric] : now;
  let confirmed = false;
  if (fl.metric.startsWith('ev_')) confirmed = fl.impact === 'worse' ? !!u?.events?.[fl.metric] : !u?.events?.[fl.metric];
  else if (rule && now != null) {
    const worse = was == null ? band(rule, now) === 'red' : rule.dir === 'higher' ? now < was : now > was;
    const better = was != null && (rule.dir === 'higher' ? now > was : now < was);
    confirmed = fl.impact === 'worse' ? worse && band(rule, now) === 'red' : better;
  }
  Object.assign(fl, { status: confirmed ? 'confirmed' : 'cleared', resolvedAt: st.clock, filing: source });
  const orders = st.orders.filter(o => o.status === 'pending' && o.flagId === fl.id);
  for (const o of orders) {
    if (confirmed) Object.assign(o, { tag: 'rules', source: 'rules', reason: `Confirmed by results: ${rule?.label || labelOf(fl.metric)}${rule ? ' ' + fmtVal(fl.metric, now) : ''}` });
    else cancelOrder(st, o, 'News not confirmed by results');
  }
  const label = rule?.label || labelOf(fl.metric);
  const back = !confirmed && orders.length ? (() => { const b = st.baskets.find(x => x.id === orders[0].basketId); const w = b ? STATUS_LABEL[shownStatus(st, b, fl.symbol)] : null; return w ? ` · sell cancelled, stays ${w}` : ' · sell cancelled'; })() : '';
  addAlert(st, { symbol: fl.symbol, basketId: orders[0]?.basketId, type: confirmed ? 'flag_confirmed' : 'flag_cleared', critical: confirmed && !!rule?.critical && fl.impact === 'worse',
    text: `${u?.name || fl.symbol} · news ${confirmed ? 'confirmed' : 'not confirmed'} by ${source ? 'latest results' : 'a quarter of results'}${confirmed && orders.length ? ' · sell stays' : back}`,
    why: [source || 'No new results within a quarter, so the flag is settled on the numbers as they are.', `${label}: ${fmtVal(fl.metric, was)} when flagged → ${fmtVal(fl.metric, now)} now${rule ? ` (bad past ${fmtVal(fl.metric, rule.red)})` : ''}`] });
}

function applyFilings(st) {
  const applied = [];
  const filed = {}; // today's results by symbol, for the "why" of status alerts (not saved)
  Object.defineProperty(st, '_filedToday', { value: filed, enumerable: false, configurable: true, writable: true });
  for (const f of st.filings) {
    if (f.applied || f.date > st.clock) continue;
    f.applied = true;
    const u = st.universe[f.symbol];
    if (!u) continue;
    const before = { ...u.metrics };
    Object.assign(u.metrics, f.changes);
    applied.push(f);
    const moved = Object.entries(f.changes).map(([k, v]) => `${labelOf(k)} ${fmtVal(k, before[k])} → ${fmtVal(k, v)}`);
    filed[f.symbol] = `${f.note} (${moved.join(', ')})`;
    const open = st.flags.filter(x => x.symbol === f.symbol && x.status === 'open' && x.date <= f.date);
    for (const fl of open) resolveFlag(st, fl, f.note, before);
    if (!open.length && st.baskets.some(b => b.symbols.includes(f.symbol))) {
      addAlert(st, { symbol: f.symbol, type: 'filing', text: `${u.name} · new quarterly results`, why: [f.note, ...moved] });
    }
  }
  for (const fl of st.flags.filter(x => x.status === 'open')) {
    const age = fl.day != null ? st.tradingDay - fl.day : Math.round(daysBetween(fl.date, st.clock) * 5 / 7);
    if (age >= FLAG_DAYS) resolveFlag(st, fl, null);
  }
  return applied;
}

function runDay(st, prov) {
  st.clock = nextWeekday(st.clock);
  st.tradingDay++;
  prov.step(st.clock);
  stepDailyMetrics(st, st.clock);
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
    why: whyOf(st, u, rulesOf(st, b ? b.rules : st.rules), s),
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
    id: b.id, name: b.name, description: b.description || '', kind: b.kind, theme: b.theme, themeLabel: b.theme ? THEME_LABEL[b.theme] : b.themeName || null,
    source: b.source, editedBy: b.editedBy || null, createdAt: b.createdAt, updatedAt: b.updatedAt || b.createdAt,
    value: r2(value), cash: r2(b.cash), invested: r2(inv), realized: r2(b.realized || 0), isInvested: isInv, pnl, returnPct: ret, costs: isInv ? r2(b.costs || 0) : 0, deleteRequest: b.deleteRequest || null,
    pnlNote: isInv && (b.costs || 0) > 0 ? (Math.abs(pnl + (b.costs || 0)) < Math.max(1, (b.costs || 0) * 0.5) ? `This is the 0.1% trading cost (${fmtINR(b.costs)}), not a price move` : `Includes ${fmtINR(b.costs)} of trading costs (0.1% per trade)`) : null, niftyPct: niftyRet, vsNifty: r2(ret - niftyRet),
    count: b.symbols.length, limits: { ...b.limits, maxStocks: Math.min(b.limits.maxStocks, plan(st).maxStocks) }, rules: rulesOf(st, b.rules), savedProRules: !isPro(st) && isCustomRules(b.rules),
    overPlanMax: b.kind === 'model' && b.symbols.length > Math.min(b.limits.maxStocks, plan(st).maxStocks),
    counts: { pass: stocks.filter(s => s.status === 'pass').length, watch: stocks.filter(s => s.status === 'watch').length, remove: stocks.filter(s => s.status === 'remove').length },
    stageWeights: stageWeights(st, Object.fromEntries(stocks.map(s => [s.symbol, isInv ? s.weight : s.target]))),
    targetCash: tw.cash, stocks,
    belowMin: b.kind === 'model' && b.symbols.length < b.limits.minStocks,
    refillShort: b.kind === 'model' && b.symbols.length < b.limits.minStocks ? refillPlan(st, b).short : 0,
    pendingOrders: st.orders.filter(o => o.basketId === b.id && o.status === 'pending').length,
    unread: st.alerts.filter(a => a.basketId === b.id && !a.read).length,
    ...(() => { if (!isInv || b.kind !== 'model') return { drift: 0, needsRebalance: false }; const rb = rebalanceTrades(st, b); return { drift: r2(rb.max), needsRebalance: rb.needed }; })(),
    held: Object.values(b.holdings).filter(h => h.qty > 0).length,
    addBlock: b.kind === 'model' ? addBlocks(st, b) : {},
    // How this basket's own rules (and theme) rate stocks not in it, for its "Add stocks" picker.
    rateHere: b.kind === 'model' ? Object.fromEntries(Object.keys(st.universe).filter(x => !b.symbols.includes(x)).map(x => { const r = scoreIn(st, b, x); return [x, { status: r.status, points: r.points, reason: r.reasons[0] || null }]; })) : {},
  };
}

function universeList(st, a = {}) {
  const q = String(a.q || '').trim().toLowerCase();
  const py = a.profitable_years != null ? Number(a.profitable_years) : null;
  const R = rulesOf(st, st.rules);
  const list = Object.values(st.universe).map(u => {
    const s = scoreStock(u, R);
    const byTheme = Object.fromEntries(Object.keys(u.themes || {}).map(t => { const x = scoreStock(u, R, { theme: t, minTheme: DEFAULT_LIMITS.minTheme }); return [t, { status: x.status, points: x.points, reason: x.reasons[0] }]; }));
    return {
      symbol: u.symbol, name: u.name, sector: u.sector, stage: u.stage, stageLabel: STAGE_LABEL[u.stage] || u.stage, themes: u.themes, byTheme,
      status: s.status, points: s.points, reasons: s.reasons, price: st.prices[u.symbol], changePct: chg(st, u.symbol),
      profitableYears: profitableYears(u), lossYears5: u.metrics.loss, debtEquity: u.metrics.de, tradedValueCr: u.metrics.adtv,
      source: u.source, inBaskets: st.baskets.filter(b => b.symbols.includes(u.symbol)).map(b => b.id),
      why: whyOf(st, u, R, s),
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
    if (!isPro(st)) throw proError('custom thresholds');
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
  const b = {
    id: nid(st, 'b'), name, kind, theme: theme || null, description: description || '', source: actor, createdAt: st.clock, updatedAt: st.clock,
    symbols, holdings: {}, cash: 0, netInvested: 0, niftyAtInvest: null,
    limits: { ...DEFAULT_LIMITS, ...(limits || {}) }, // maxStocks is the basket's own limit; the plan caps it where it is used
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
// No name at all gets the fallback; a name that is only spaces is a mistake and is refused.
const cleanName = (v, fallback) => { if (v == null) return fallback; const s = String(v).trim().slice(0, 40); if (!s) throw new ApiError('bad_name', 'The name can\'t be empty. Give the basket a name, e.g. "Defence".'); return s; };
// Two baskets never share a name ("My basket", "My basket 2", …) so lists can tell them apart. A name that already
// ends in a number counts on from it ("Defence 2" taken → "Defence 3", never "Defence 2 2").
const uniqueName = (st, name, exceptId) => {
  const taken = new Set(st.baskets.filter(b => b.id !== exceptId).map(b => b.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const base = name.replace(/ \d+$/, '');
  let i = 2; while (taken.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
};
const nameNote = (asked, got) => (asked != null && String(asked).trim().toLowerCase() !== got.toLowerCase() ? `"${String(asked).trim()}" is already used, so it is called "${got}".` : undefined);

// ---------------- operations ----------------
const OPS = {
  // ---- Baskets: create / read / update / delete ----
  create_basket(st, a, actor) {
    const kind = a.kind === 'tracking' ? 'tracking' : 'model';
    checkBasketCount(st, kind);
    let input = (a.symbols || []).map(upper).filter(Boolean);
    if (kind === 'tracking' && a.holdings) input = a.holdings.map(h => upper(h.symbol));
    input = [...new Set(input)];
    const themeName = !THEMES.some(t => t.id === a.theme) && a.theme_name ? String(a.theme_name).trim().slice(0, 30) : '';
    const theme = themeName ? null : a.theme === undefined ? inferTheme(st, input.filter(s => st.universe[s])) : (THEMES.some(t => t.id === a.theme) ? a.theme : null);
    const rules = cloneRules(st.rules);
    applyRuleOverrides(st, rules, a.rules, actor);
    const probe = newBasket(st, { name: 'probe', kind, theme, symbols: [], actor, rules, limits: a.min_theme != null ? { minTheme: Number(a.min_theme) } : null });
    st.seq--; // probe id not used
    if (themeName) probe.themeName = themeName;
    const skipped = [], eligible = [];
    const maxStocks = Math.min(probe.limits.maxStocks, plan(st).maxStocks);
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
        if (kind === 'model' && capped(probe, stage) && (count / size) * 100 > probe.limits.maxStageWeight + 0.01) { over.push(sym); continue; }
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
    const b = newBasket(st, { name: uniqueName(st, cleanName(a.name, kind === 'tracking' ? 'My holdings' : 'My basket')), kind, theme, description: String(a.description || '').slice(0, 140), symbols: final, actor, rules, limits: probe.limits });
    if (kind === 'tracking' && a.holdings) {
      for (const h of a.holdings) { const sym = upper(h.symbol); if (final.includes(sym)) b.holdings[sym] = { qty: Math.max(0, Number(h.qty) || 0), avg: Number(h.avg_price) || st.prices[sym] }; }
      b.netInvested = r2(Object.values(b.holdings).reduce((t, h) => t + h.qty * h.avg, 0));
      b.niftyAtInvest = st.nifty;
    }
    if (themeName) b.themeName = themeName;
    st.baskets.push(b);
    // Shares you already own that your rules rate Sell: say so at once (you sell them in your own broker).
    if (kind === 'tracking') for (const s of final) if (b.statusPrev[s] === 'remove') trackingSellAlert(st, b, s);
    for (const s of final) logDecision(st, { basketId: b.id, symbol: s, action: 'added', trigger: `${STATUS_WORD[b.statusPrev[s]] || 'Rated'} at creation`, source: actor });
    st.onboarded = true;
    track(st, 'basket_created', { source: actor, kind, n: final.length, theme });
    const bt = basketBacktest(st, b).summary;
    // The person's own stocks, kept or dropped by these rules each June (what they actually picked),
    // plus the wider test of the same rules on every stock we track in the theme.
    const mine = backtest(b.rules, HISTORY, NAMES, { symbols: new Set(b.symbols) }).summary;
    return { basket: basketView(st, b), skipped, name_note: nameNote(a.name, b.name), backtest: { removalsRight: bt.removalsRight, removalsTotal: bt.removalsTotal, years: `${bt.fromYear}–${bt.toYear}`,
      mine: { stocks: b.symbols.length, grew: mine.growth.kept, nifty: mine.growth.nifty, beatYears: mine.keptBeatYears, years: mine.yearsCount } } };
  },

  update_basket(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    if (a.name != null) b.name = uniqueName(st, cleanName(a.name, b.name), b.id);
    const snap = snapRules(st, [b], false);
    if (a.description != null) b.description = String(a.description).slice(0, 140);
    let rescore = false;
    if (a.theme !== undefined) { const t = a.theme === null || a.theme === '' ? null : a.theme; if (t && !THEMES.some(x => x.id === t)) throw new ApiError('bad_theme', `Theme must be one of ${THEMES.map(x => x.id).join(', ')} or null`); b.theme = t; if (t) delete b.themeName; rescore = true; }
    if (a.theme_name !== undefined) { const n = String(a.theme_name || '').trim().slice(0, 30); if (n) { b.themeName = n; if (b.theme) { b.theme = null; rescore = true; } } else delete b.themeName; }
    b.editedBy = actor; b.updatedAt = st.clock;
    if (rescore) checkBasket(st, b, 'rules');
    return { basket: basketView(st, b), name_note: a.name != null ? nameNote(a.name, b.name) : undefined, ...(rescore ? { changed: ruleReport(st, snap) } : {}) };
  },

  duplicate_basket(st, a, actor) {
    const src = getBasket(st, a.basket_id);
    checkBasketCount(st, src.kind);
    const b = newBasket(st, { name: uniqueName(st, cleanName(a.name, `${src.name} copy`)), kind: src.kind, theme: src.theme, description: src.description, symbols: [...src.symbols], actor, rules: cloneRules(src.rules), limits: { ...src.limits } });
    st.baskets.push(b);
    track(st, 'basket_duplicated', {});
    return { basket: basketView(st, b) };
  },

  delete_basket(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    const holds = b.kind === 'model' && invested(b);
    if (holds && !a.sell_all) throw new ApiError('has_holdings', `${b.name} still holds shares. Sell everything and delete (pass sell_all: true), or keep it.`);
    const cost = r2(b.netInvested || 0);
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
    // Everything that belonged to the basket goes with it: orders (pending and past), alerts and journal notes.
    st.orders = st.orders.filter(o => o.basketId !== b.id);
    st.alerts = st.alerts.filter(x => x.basketId !== b.id);
    st.journal = st.journal.filter(j => j.basketId !== b.id);
    st.baskets = st.baskets.filter(x => x.id !== b.id);
    track(st, 'basket_deleted', { kind: b.kind });
    return { deleted: b.id, name: b.name, returnedCash: b.kind === 'model' ? r2(returned) : 0, profit: holds ? r2(returned - cost) : 0, cash: st.cash };
  },

  // Claude (or anyone) can ask for a basket to be deleted; the person confirms or keeps it in the website.
  get_upgrade_link(st, a) {
    const billing = ['monthly', 'quarterly', 'yearly'].includes(a.billing) ? a.billing : 'yearly';
    const per = { monthly: 'month', quarterly: 'quarter', yearly: 'year' }[billing];
    return { plan: st.plan, billing, price: PRICES[billing], priceText: `${fmtINR(PRICES[billing])} a ${per}`, prices: { ...PRICES },
      note: st.plan === 'pro' ? 'The user is already on Pro.' : `Give the user the link. They tap Start Pro there; you cannot upgrade them or take payment. Pro is ${fmtINR(PRICES.monthly)}/month, ${fmtINR(PRICES.quarterly)}/quarter or ${fmtINR(PRICES.yearly)}/year.` };
  },
  request_delete_basket(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    b.deleteRequest = { by: actor, at: st.clock, reason: String(a.reason || '').slice(0, 200) };
    const p = OPS.delete_preview(st, a);
    return { requested: b.id, name: b.name, preview: p, note: p.holds ? `Waiting for the user: in the website they choose "Sell everything and delete" (about ${fmtINR(p.moneyBack)} back, ${p.profit >= 0 ? 'profit' : 'loss'} ${fmtINR(Math.abs(p.profit))}) or "Keep it".` : 'Waiting for the user to tap Delete (or Keep it) in the website.' };
  },
  keep_basket(st, a) { const b = getBasket(st, a.basket_id); delete b.deleteRequest; return { kept: b.id, name: b.name }; },

  // What deleting would do, so the person sees it in ₹ before choosing.
  delete_preview(st, a) {
    const b = getBasket(st, a.basket_id);
    let back = b.cash;
    for (const [sym, h] of Object.entries(b.holdings)) if (h.qty > 0 && b.kind === 'model') back += h.qty * (st.prices[sym] ?? h.avg) * (1 - SLIPPAGE);
    const holds = b.kind === 'model' && invested(b);
    return { name: b.name, holds, holdings: Object.values(b.holdings).filter(h => h.qty > 0).length, moneyBack: r2(back), cost: r2(b.netInvested || 0), profit: holds ? r2(back - (b.netInvested || 0)) : 0, pending: st.orders.filter(o => o.basketId === b.id && o.status === 'pending').length };
  },

  // Exit = sell everything in the basket. Drafts sells; a person confirms. Cash returns to practice cash.
  exit_basket(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    if (b.kind === 'tracking') throw new ApiError('tracking_no_orders', 'Tracking baskets hold your real shares. Sell them in your broker.');
    const held = Object.entries(b.holdings).filter(([, h]) => h.qty > 0);
    const pend = st.orders.filter(o => o.basketId === b.id && o.status === 'pending');
    if (!held.length && pend.length) throw new ApiError('nothing_held', `${b.name} holds no shares yet, so there is nothing to sell. It has ${pend.length} order${pend.length > 1 ? 's' : ''} waiting for the user to confirm; to drop ${pend.length > 1 ? 'them' : 'it'}, use cancel_order or the user taps "Not now" in the website. To remove the basket, use request_delete_basket.`);
    for (const o of pend) Object.assign(o, { status: 'cancelled', cancelReason: 'Replaced by exit' });
    const group = nid(st, 'g');
    const orders = held
      .map(([sym, h]) => makeOrder(st, { basketId: b.id, symbol: sym, side: 'sell', qty: h.qty, source: actor, tag: 'exit', group, reason: `Exit ${b.name}: sell all` }));
    if (!orders.length) {
      const back = b.cash; st.cash = r2(st.cash + back); b.cash = 0; b.netInvested = 0; b.niftyAtInvest = null;
      return { orders: [], returnedCash: r2(back), note: 'Nothing to sell. Any basket cash went back to practice cash.' };
    }
    track(st, 'exit_drafted', { source: actor, n: orders.length });
    return { orders, cancelled: pend.length, estimatedProceeds: r2(orders.reduce((t, o) => t + o.estValue, 0) + b.cash), costBasis: r2(b.netInvested), note: `Pending. Confirm in the website to sell everything.${pend.length ? ` ${pend.length} earlier order${pend.length > 1 ? 's were' : ' was'} cancelled.` : ''}` };
  },

  add_stock(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    const sym = upper(a.symbol);
    const u = st.universe[sym];
    if (!u) throw new ApiError('not_found', `${sym} is not in the universe. Add it with add_candidate.`);
    if (b.symbols.includes(sym)) throw new ApiError('exists', `${u.name} is already in ${b.name}`);
    const max = Math.min(b.limits.maxStocks, plan(st).maxStocks);
    if (b.symbols.length >= max) {
      const leaving = st.orders.filter(o => o.basketId === b.id && o.status === 'pending' && o.side === 'sell' && o.removeAfter);
      if (leaving.length && b.symbols.length - leaving.length < max) throw new ApiError('pending_sell', `${b.name} is full (${max} stocks) until the sell of ${leaving.map(o => o.name).join(', ')} goes through. Confirm or cancel it first (the user confirms in the website), then add ${u.name}.`, { orders: leaving.map(o => o.id) });
      throw isPro(st) ? new ApiError('limit', `Max ${max} stocks`) : proError(`more than ${max} stocks`);
    }
    const s = scoreIn(st, b, sym);
    if (b.kind === 'model' && s.status === 'remove') throw new ApiError('rule_block', `${u.name} is rated ✕ Sell here: ${s.reasons[0]}`);
    if (b.kind === 'model') {
      const sw = stageWeights(st, targetWeights(st, b, [...b.symbols, sym]).weights);
      if (capped(b, u.stage) && (sw[u.stage] || 0) > b.limits.maxStageWeight + 0.01 && b.symbols.length + 1 >= b.limits.minStocks) throw new ApiError('rule_block', `Over the ${b.limits.maxStageWeight}% ${STAGE_LABEL[u.stage]} limit (it would be ${Math.round(sw[u.stage])}%)`);
    }
    if (b.kind === 'tracking') b.holdings[sym] = b.holdings[sym] || { qty: 0, avg: st.prices[sym] };
    b.symbols.push(sym); b.statusPrev[sym] = s.status; b.editedBy = actor; b.updatedAt = st.clock;
    logDecision(st, { basketId: b.id, symbol: sym, action: 'added', trigger: `${STATUS_WORD[s.status]} · ${s.points} warning${s.points === 1 ? '' : 's'}`, source: actor });
    if (b.kind === 'tracking' && s.status === 'remove') trackingSellAlert(st, b, sym);
    return { basket: basketView(st, b) };
  },

  remove_stock(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    const sym = upper(a.symbol);
    if (!b.symbols.includes(sym)) throw new ApiError('not_found', `${sym} isn't in ${b.name}`);
    const h = b.holdings[sym];
    if (b.kind === 'model' && h?.qty > 0) {
      if (!a.sell) throw new ApiError('has_holding', `${st.universe[sym]?.name || sym} is held (${h.qty} shares). To take it out, sell it: remove_stock with sell: true drafts the sell, and the stock leaves the basket once the user confirms it.`);
      let order = st.orders.find(o => o.basketId === b.id && o.symbol === sym && o.side === 'sell' && o.status === 'pending');
      if (order) { order.qty = h.qty; order.removeAfter = true; order.estValue = r2(order.qty * st.prices[sym]); }
      else order = makeOrder(st, { basketId: b.id, symbol: sym, side: 'sell', qty: h.qty, source: actor, tag: 'manual', removeAfter: true, reason: 'Sell and remove' });
      return { orders: [order], note: 'Sell drafted. Confirm it to remove the stock.' };
    }
    if (b.kind === 'tracking') delete b.holdings[sym];
    removeFromBasket(st, b, sym, a.reason || 'Removed by you', actor);
    b.editedBy = actor; b.updatedAt = st.clock;
    for (const o of st.orders) if (o.basketId === b.id && o.symbol === sym && o.status === 'pending') Object.assign(o, { status: 'cancelled', cancelReason: 'Stock removed' });
    const before = new Set(b.symbols);
    ensureRefill(st, b);
    const refilled = b.symbols.filter(x => !before.has(x)).map(x => st.universe[x]?.name || x);
    return { basket: basketView(st, b), refilled };
  },

  set_holding(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    if (b.kind !== 'tracking') throw new ApiError('not_tracking', 'Holdings are edited only in tracking baskets. Use orders for paper baskets.');
    const sym = upper(a.symbol);
    if (!st.universe[sym]) throw new ApiError('not_found', `Unknown symbol ${sym}`);
    const qty = Math.max(0, Math.floor(Number(a.qty) || 0));
    const avg = Number(a.avg_price) > 0 ? Number(a.avg_price) : st.prices[sym];
    if (!b.symbols.includes(sym)) { b.symbols.push(sym); b.statusPrev[sym] = scoreIn(st, b, sym).status; if (b.statusPrev[sym] === 'remove') trackingSellAlert(st, b, sym); }
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
    if (ex?.source === 'default') throw new ApiError('exists', `${ex.name} (${sym}) is already in the stock list, with numbers from the data provider; they can't be overwritten. Use it as it is (add_stock), or flag news that may change a number (add_news_flag).`);
    const metrics = {};
    for (const r of DEFAULT_RULES) { const v = a.metrics?.[r.id]; metrics[r.id] = v == null || v === '' ? (ex?.metrics[r.id] ?? null) : Number(v); }
    const themes = { ...(ex?.themes || {}) };
    if (a.themes) for (const [k, v] of Object.entries(a.themes)) if (v === null || v === '') delete themes[k]; else themes[k] = Number(v);
    if (a.ac_share != null && a.ac_share !== '') themes.ac = Number(a.ac_share);
    st.universe[sym] = {
      symbol: sym, name: String(a.name || ex?.name || sym).slice(0, 60), sector: a.sector || ex?.sector || 'Other', stage: a.stage || ex?.stage || 'other', themes,
      historyYears: a.history_years ?? ex?.historyYears ?? 3, metrics, lossAgo: ex?.lossAgo || [], events: ex?.events || {}, source: ex?.source === 'default' ? 'default' : actor,
    };
    if (st.prices[sym] == null || a.price) { st.prices[sym] = Number(a.price) || st.prices[sym] || 100; st.prevPrices[sym] = st.prevPrices[sym] ?? st.prices[sym]; }
    track(st, ex ? 'candidate_updated' : 'candidate_added', { source: actor });
    const holders = st.baskets.filter(b => b.symbols.includes(sym));
    const snap = snapRules(st, holders, false);
    for (const b of holders) checkBasket(st, b, 'rules');
    const s = scoreStock(st.universe[sym], rulesOf(st, st.rules));
    return { updated: !!ex, stock: { symbol: sym, name: st.universe[sym].name, status: s.status, rating: STATUS_WORD[s.status], points: s.points, reasons: s.reasons, missing: s.missing, why: whyOf(st, st.universe[sym], rulesOf(st, st.rules), s) }, note: s.missing.length >= 3 ? 'Missing numbers → Hold until filled' : undefined, ...(holders.length ? { changed: ruleReport(st, snap) } : {}) };
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
    const snap = snapRules(st, t.baskets, t.scope !== 'basket');
    for (const rs of t.sets) applyRuleOverrides(st, rs, { [a.rule_id]: { green: a.green, red: a.red, critical: a.critical } }, actor);
    track(st, 'rule_threshold_edited', { rule: a.rule_id, source: actor, scope: t.scope });
    for (const b of t.baskets) { b.updatedAt = st.clock; checkBasket(st, b, 'rules'); }
    return { scope: t.scope, applied_to: scopeText(t, st), rule: t.sets[0].metrics.find(x => x.id === a.rule_id), changed: ruleReport(st, snap) };
  },
  toggle_rule(st, a, actor) {
    if (!isPro(st)) throw proError('edit rules');
    const t = ruleTargets(st, a);
    const find = rs => rs.metrics.find(x => x.id === a.rule_id) || rs.events.find(x => x.id === a.rule_id);
    if (!find(t.sets[0])) throw new ApiError('not_found', `No rule "${a.rule_id}"`);
    if (a.rule_id.startsWith('ev_') && !isPro(st)) throw proError('event rules');
    const snap = snapRules(st, t.baskets, t.scope !== 'basket');
    for (const rs of t.sets) { const r = find(rs); r.enabled = !!a.enabled; r.source = actor; }
    for (const b of t.baskets) { b.updatedAt = st.clock; checkBasket(st, b, 'rules'); }
    return { scope: t.scope, applied_to: scopeText(t, st), rule: find(t.sets[0]), changed: ruleReport(st, snap) };
  },
  // Allowed on Free too: it is the way back to the default rules (and drops saved Pro rules).
  reset_rules(st, a, actor) {
    if (!a.scope && !a.basket_id && st.baskets.length > 1) throw new ApiError('which_rules', `Say which rules to reset: scope "defaults", or a basket_id, one of: ${st.baskets.map(x => `${x.name} (${x.id})`).join(', ')}.`);
    if (a.scope === 'all') { st.rules = defaultRuleSet(); for (const b of st.baskets) { b.rules = cloneRules(st.rules); b.limits = { ...DEFAULT_LIMITS }; delete b.limitsBy; b.updatedAt = st.clock; checkBasket(st, b, 'rules'); } return { scope: 'all', baskets_reset: st.baskets.length }; }
    if (a.scope === 'defaults' || (!a.basket_id && !a.scope && st.baskets.length === 0)) { st.rules = defaultRuleSet(); return { scope: 'defaults', rules: st.rules }; }
    const b = getBasket(st, a.basket_id);
    const snap = snapRules(st, [b], false);
    b.rules = cloneRules(st.rules); b.limits = { ...DEFAULT_LIMITS }; delete b.limitsBy;
    b.editedBy = actor; b.updatedAt = st.clock;
    checkBasket(st, b, 'rules');
    return { basket: basketView(st, b), changed: ruleReport(st, snap) };
  },
  // Rating cutoffs: Buy below N warnings, Sell above M, Hold in between (Pro). Same scopes as set_rule.
  set_rating_cutoffs(st, a, actor) {
    if (!isPro(st)) throw proError('edit rules');
    const t = ruleTargets(st, a);
    const cur = cutoffsOf(t.sets[0]);
    const buy = a.buy_below != null ? Number(a.buy_below) : cur.buyBelow, sell = a.sell_above != null ? Number(a.sell_above) : cur.sellAbove;
    if (!Number.isInteger(buy) || !Number.isInteger(sell) || buy < 1 || sell > 26) throw new ApiError('bad_cutoffs', 'Use whole numbers: buy_below at least 1, sell_above at most 26.');
    if (buy > sell) throw new ApiError('bad_cutoffs', `buy_below (${buy}) can't be more than sell_above (${sell}). Buy = fewer than buy_below warnings, Sell = more than sell_above, Hold in between.`);
    const snap = snapRules(st, t.baskets, t.scope !== 'basket');
    for (const rs of t.sets) rs.cutoffs = { buyBelow: buy, sellAbove: sell, source: actor };
    for (const b of t.baskets) { b.updatedAt = st.clock; checkBasket(st, b, 'rules'); }
    track(st, 'rating_cutoffs_edited', { source: actor, scope: t.scope });
    return { scope: t.scope, applied_to: scopeText(t, st), cutoffs: { buy_below: buy, sell_above: sell, meaning: `Buy: fewer than ${buy} warnings · Hold: ${buy}–${sell} · Sell: more than ${sell}` }, changed: ruleReport(st, snap) };
  },
  // Copy the default rules onto every basket (switches and limits of each rule; basket size limits stay).
  // Read the default rules or one basket's rules (scope like set_rule).
  get_rules(st, a) {
    const scope = a.scope || (a.basket_id ? 'basket' : 'defaults');
    const pick = rs => ({ cutoffs: (c => ({ buy_below: c.buyBelow, sell_above: c.sellAbove, meaning: `Buy: fewer than ${c.buyBelow} warnings · Hold: ${c.buyBelow}–${c.sellAbove} · Sell: more than ${c.sellAbove} (also Sell when a must-pass rule is red)` }))(cutoffsOf(rs)), metrics: rs.metrics.map(r => ({ id: r.id, label: r.label, long: r.long, unit: r.unit, better: r.dir, green: r.green, red: r.red, enabled: r.enabled, must_pass: !!r.critical, edited_by: r.source })), events: rs.events.map(r => ({ id: r.id, label: r.label, enabled: r.enabled })) });
    const saved = rs => (!isPro(st) && isCustomRules(rs) ? { saved_pro_rules: pick(rs), saved_note: `On Free the 13 default rules and default cutoffs apply. ${SAVED_PRO_RULES} reset_rules drops them.` } : {});
    if (scope === 'defaults') return { scope, note: 'New baskets start with these; they also rate stocks on Home and Explore.', ...pick(rulesOf(st, st.rules)), ...saved(st.rules), can_edit_limits: isPro(st) };
    const b = getBasket(st, a.basket_id);
    return { scope: 'basket', basket: { id: b.id, name: b.name }, ...pick(rulesOf(st, b.rules)), ...saved(b.rules), limits: b.limits, can_edit_limits: isPro(st) };
  },
  apply_default_rules(st, a, actor) {
    if (!isPro(st)) throw proError('edit rules');
    const list = a.basket_id ? [getBasket(st, a.basket_id)] : [...st.baskets];
    const snap = snapRules(st, list, false);
    for (const b of list) { b.rules = cloneRules(st.rules); b.editedBy = actor; b.updatedAt = st.clock; checkBasket(st, b, 'rules'); }
    return { baskets_updated: list.length, changed: ruleReport(st, snap) };
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
    const snap = snapRules(st, [b], false);
    b.limits = next; b.limitsBy = actor; b.editedBy = actor; b.updatedAt = st.clock;
    checkBasket(st, b, 'rules');
    const warn = [];
    if (next.maxStockWeight * Math.min(next.maxStocks, b.symbols.length || next.maxStocks) < 100) warn.push(`With at most ${next.maxStockWeight}% per stock and ${b.symbols.length} stocks, about ${Math.round(100 - next.maxStockWeight * b.symbols.length)}% of the basket stays as cash.`);
    return { basket: basketView(st, b), changed: ruleReport(st, snap), ...(warn.length ? { warnings: warn } : {}) };
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
      if (b.symbols.length < b.limits.minStocks) throw new ApiError('below_min', `${b.name} has ${b.symbols.length} stock${b.symbols.length === 1 ? '' : 's'}. Add ${b.limits.minStocks - b.symbols.length} more before investing (a basket needs at least ${b.limits.minStocks}).`);
      const plan = sizePlan(st, b, amount);
      for (const r of plan.rows) out.push(makeOrder(st, { basketId: b.id, symbol: r.symbol, side, qty: r.qty, source: actor, tag: 'invest', group, reason: `Invest ${fmtINR(amount)} · about ${fmtINR(r.part)} here` }));
      if (!out.length) throw new ApiError('bad_amount', `${fmtINR(amount)} is too little for one share of these stocks`, { skipped: plan.skipped });
      track(st, 'invest_drafted', { amount, source: actor });
      return { orders: out, skipped: plan.skipped, total: plan.total, leftover: r2(amount - plan.total), note: 'Pending. A person confirms them in the FunInvestments website (Orders).' };
    } else {
      const sym = upper(a.symbol);
      if (!sym) throw new ApiError('missing_symbol', side === 'sell' ? 'Which stock? A sell needs a symbol. To sell everything in the basket use exit_basket.' : 'Which stock? Pass a symbol, or an amount with no symbol to invest across the basket.');
      if (!st.universe[sym]) throw new ApiError('not_found', `Unknown symbol ${sym}`);
      const held = b.holdings[sym]?.qty || 0;
      const qty = a.qty != null ? Math.floor(Number(a.qty)) : a.amount ? Math.floor(Number(a.amount) / st.prices[sym]) : side === 'sell' ? held : 0;
      if (!(qty >= 1)) throw new ApiError('bad_qty', 'Quantity must be at least 1');
      if (side === 'sell' && qty > held) throw new ApiError('bad_qty', `You hold ${held}`);
      if (side === 'buy' && !b.symbols.includes(sym)) {
        const max = Math.min(b.limits.maxStocks, plan(st).maxStocks);
        if (b.symbols.length >= max) throw isPro(st) ? new ApiError('limit', `Max ${max} stocks`) : proError(`more than ${max} stocks`);
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
    // Check the money first, so a confirm never fills half the orders and then fails.
    const need = {};
    for (const id of ids) { const o = st.orders.find(x => x.id === id && x.status === 'pending'); if (o && o.side === 'buy') need[o.basketId] = (need[o.basketId] || 0) + o.qty * (st.prices[o.symbol] || 0) * (1 + SLIPPAGE); }
    const sells = {};
    for (const id of ids) { const o = st.orders.find(x => x.id === id && x.status === 'pending'); if (o && o.side === 'sell') sells[o.basketId] = (sells[o.basketId] || 0) + o.qty * (st.prices[o.symbol] || 0) * (1 - SLIPPAGE); }
    const totalNeed = Object.entries(need).reduce((t, [bid, v]) => t + Math.max(0, v - (st.baskets.find(b => b.id === bid)?.cash || 0) - (sells[bid] || 0)), 0);
    if (totalNeed > st.cash + 0.5) throw new ApiError('insufficient', `These buys need about ${fmtINR(totalNeed)} of practice cash; you have ${fmtINR(st.cash)}. Lower a quantity or cancel an order.`);
    const filled = [];
    const sideOf = id => st.orders.find(x => x.id === id)?.side === 'sell' ? 0 : 1; // sells first: their cash pays for the buys
    for (const id of [...ids].sort((x, y) => sideOf(x) - sideOf(y))) {
      const o = st.orders.find(x => x.id === id);
      if (!o || o.status !== 'pending') continue;
      const b = st.baskets.find(x => x.id === o.basketId);
      if (!b) { Object.assign(o, { status: 'cancelled', cancelReason: 'Basket deleted' }); continue; }
      const q = prov.getQuote(o.symbol), f = execute(o, q, st.universe[o.symbol]?.metrics.adtv);
      b.costs = r2((b.costs || 0) + Math.abs(f.value - q.price * o.qty)); // the 0.1% trading cost, kept so the return can say what it includes
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
        st.cash = r2(st.cash + back); b.cash = 0; b.netInvested = 0; b.niftyAtInvest = null; b.costs = 0;
        b.realized = r2((b.realized || 0) + profit);
        logDecision(st, { basketId: b.id, symbol: null, basketName: b.name, action: 'exited', trigger: `Sold all · ${fmtINR(back)} back · ${profit >= 0 ? 'profit' : 'loss'} ${fmtINR(Math.abs(profit))}`, source: actor });
        exits.push({ basketId: b.id, name: b.name, returnedCash: back, profit });
      } else ensureRefill(st, b);
    }
    return { filled, cash: st.cash, exits };
  },

  cancel_order(st, a, actor) {
    const o = st.orders.find(x => x.id === a.order_id);
    if (o?.status === 'filled') throw new ApiError('already_filled', `${o.name}: this ${o.side} was already confirmed and filled on ${o.fill?.at || 'an earlier day'}, so it can't be cancelled. To undo it, prepare the opposite order (create_order).`);
    if (o?.status === 'cancelled') throw new ApiError('already_cancelled', `${o.name}: this ${o.side} was already cancelled (${o.cancelReason || 'cancelled'}).`);
    if (!o || o.status !== 'pending') throw new ApiError('not_found', 'No order with that id. get_orders lists them.');
    Object.assign(o, { status: 'cancelled', cancelReason: a.reason || 'Cancelled', cancelledAt: st.clock, cancelledBy: actor });
    // A declined replacement is not drafted again this quarter unless the basket loses another stock.
    const ob = st.baskets.find(x => x.id === o.basketId);
    if (o.tag === 'refill' && ob) ob.refillDeclined = { q: quarterOf(st.clock), count: staying(st, ob).length };
    else if (ob && o.side === 'sell') dropStaleRefills(st, ob); // a kept stock no longer needs its replacement
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
  // Deleting a notification also deletes its action: any order it drafted that is still waiting is cancelled,
  // so Orders, the to-do list and the basket all stay in step with what the person sees.
  dismiss_alert(st, a, actor) {
    const al = st.alerts.find(x => x.id === a.alert_id);
    if (!al) throw new ApiError('not_found', 'No such alert');
    const cancelled = dropAlertActions(st, [al], actor);
    archiveAlerts(st, [al], actor, cancelled);
    st.alerts = st.alerts.filter(x => x.id !== a.alert_id);
    return { dismissed: a.alert_id, text: al.text, cancelled };
  },
  clear_alerts(st, a, actor) {
    const gone = st.alerts.filter(x => !a.basket_id || x.basketId === a.basket_id);
    const cancelled = dropAlertActions(st, gone, actor);
    archiveAlerts(st, gone, actor, cancelled);
    st.alerts = st.alerts.filter(x => !gone.includes(x));
    return { cleared: gone.length, cancelled };
  },

  // Decline something on the to-do list. Orders are cancelled, a delete request keeps the basket,
  // reminders (invest, add stocks, urgent alerts, news flags) are hidden until restored. Each decline is kept under Cleared.
  decline_todo(st, a, actor) {
    const t = todoList(st).find(x => x.key === a.key);
    if (!t) throw new ApiError('not_found', 'That item is no longer pending');
    let cancelled = [];
    if (t.kind === 'orders') {
      for (const id of t.ids) { const o = st.orders.find(x => x.id === id && x.status === 'pending'); if (!o) continue; OPS.cancel_order(st, { order_id: id, reason: 'Declined' }, actor); cancelled.push({ id: o.id, name: o.name, side: o.side, qty: o.qty }); }
    } else if (t.kind === 'delete') OPS.keep_basket(st, { basket_id: t.basketId });
    else {
      if (t.kind === 'alerts') for (const x of st.alerts) if (x.critical) x.read = true;
      st.declined = [...(st.declined || []).filter(d => d.key !== t.key), { key: t.key, at: st.clock }];
    }
    const restorable = !['orders', 'delete'].includes(t.kind) && t.kind !== 'alerts';
    archiveAlerts(st, [{ id: nid(st, 'a'), type: 'declined', date: st.clock, basketId: t.basketId, text: `Declined: ${t.text}`, why: [t.detail], key: restorable ? t.key : null }], actor, []);
    st.clearedAlerts[0].cancelled = cancelled;
    return { declined: t.key, text: t.text, cancelled };
  },
  restore_todo(st, a) {
    st.declined = (st.declined || []).filter(d => d.key !== a.key);
    st.clearedAlerts = (st.clearedAlerts || []).filter(x => x.key !== a.key);
    return { restored: a.key };
  },

  // ---- Notifications (website bell: Pending / Notifications / Cleared), for Claude too ----
  get_notifications(st, a) {
    const tab = a.tab || 'notifications';
    if (tab === 'pending') {
      const hidden = new Set((st.declined || []).map(d => d.key));
      return { tab, pending: todoList(st), declined: todoListRaw(st).filter(t => hidden.has(t.key) && t.kind !== 'orders' && t.kind !== 'delete').map(t => ({ ...t, declined: true })), note: 'decline_pending {key} declines one (orders are cancelled, a delete request keeps the basket, reminders are hidden); restore_pending {key} brings a declined reminder back.' };
    }
    if (tab === 'cleared') return { tab, cleared: (st.clearedAlerts || []).filter(x => !a.basket_id || x.basketId === a.basket_id).slice(0, a.limit || 50), note: 'Deleted notifications and declined items, newest first. restore_pending {key} brings back a declined reminder; restore_notification {alert_id} puts a deleted notification back.' };
    if (tab !== 'notifications') throw new ApiError('bad_tab', 'tab must be pending, notifications or cleared');
    const list = st.alerts.filter(x => !a.basket_id || x.basketId === a.basket_id).filter(x => !a.unread_only || !x.read);
    return { tab, notifications: list.slice(0, a.limit || 50), unread: st.alerts.filter(x => !x.read).length, total: list.length };
  },
  restore_alert(st, a) {
    const i = (st.clearedAlerts || []).findIndex(x => x.id === a.alert_id && x.type !== 'declined');
    if (i < 0) throw new ApiError('not_found', 'No deleted notification with that id (get_notifications tab "cleared").');
    const [al] = st.clearedAlerts.splice(i, 1);
    const { clearedAt, clearedBy, cancelled, basketName, ...back } = al;
    // Orders cancelled with it stay cancelled: the notification comes back as information only.
    st.alerts.unshift({ ...back, action: back.action?.kind === 'orders' ? null : back.action, read: true });
    return { restored: al.id, text: al.text, note: cancelled?.length ? `${cancelled.length} order${cancelled.length > 1 ? 's' : ''} cancelled with it stay cancelled.` : undefined };
  },
  get_news_flags(st, a) {
    const list = st.flags.filter(f => !a.status || f.status === a.status).filter(f => !a.symbol || f.symbol === upper(a.symbol));
    return { flags: list.slice(0, a.limit || 50), open: st.flags.filter(f => f.status === 'open').length, thisMonth: st.flags.filter(f => monthKey(f.date) === monthKey(st.clock) && f.status !== 'withdrawn').length, perMonth: isPro(st) ? null : plan(st).flagsPerMonth };
  },
  get_journal(st, a) {
    const list = st.journal.filter(j => !a.basket_id || j.basketId === a.basket_id).map(j => ({ ...j, movePct: j.priceThen && st.prices[j.symbol] ? r2(((st.prices[j.symbol] - j.priceThen) / j.priceThen) * 100) : null }));
    return { entries: list.slice(0, a.limit || 50), note: 'Decisions the user made against the rules (kept anyway, skipped buys), with how the price moved since.' };
  },
  get_settings(st) {
    return { plan: st.plan, billing: st.billing || null, planInfo: { ...PLANS[st.plan], maxBaskets: PLANS[st.plan].maxBaskets === Infinity ? 'unlimited' : PLANS[st.plan].maxBaskets, maxTracking: PLANS[st.plan].maxTracking === Infinity ? 'unlimited' : PLANS[st.plan].maxTracking, flagsPerMonth: PLANS[st.plan].flagsPerMonth === Infinity ? 'unlimited' : PLANS[st.plan].flagsPerMonth },
      notifications: { urgent: true, every_change: !!st.notif.push, email: !!st.notif.email, note: 'Urgent alerts (a must-pass rule breaks) are always on. "Every change" and email are Pro.' }, cash: r2(st.cash), asOf: st.clock };
  },

  get_refill_plan(st, a) {
    const b = getBasket(st, a.basket_id);
    const p = refillPlan(st, b);
    return { basket: b.name, count: b.symbols.length, min: b.limits.minStocks, ...p, pendingOrders: st.orders.filter(o => o.basketId === b.id && o.status === 'pending' && o.tag === 'refill') };
  },

  rebalance_plan(st, a, actor) {
    const b = getBasket(st, a.basket_id);
    if (b.kind === 'tracking') throw new ApiError('tracking_no_orders', 'Tracking baskets don\'t place orders.');
    const d = rebalanceTrades(st, b);
    if (!a.draft) return d;
    const orders = d.trades.map(t => makeOrder(st, { basketId: b.id, symbol: t.symbol, side: t.side, qty: t.qty, source: actor, tag: 'rebalance', reason: `Rebalance to ${t.target}% of basket` }));
    return { ...d, orders, note: orders.length ? undefined : 'Nothing to do: the basket is as close to its targets as whole shares allow.' };
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
    const flag = { id: nid(st, 'f'), symbol: sym, name: u.name, metric: rule.id, metricLabel: rule.label, impact, note: String(a.note || '').slice(0, 240), url: a.url || '', source: actor, status: 'open', date: st.clock, day: st.tradingDay, value: rule.id.startsWith('ev_') ? !!u.events?.[rule.id] : u.metrics[rule.id] ?? null };
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
    return { plan: st.plan, baskets: st.baskets.map(b => ({ id: b.id, name: b.name, kind: b.kind, stocks: b.symbols.length, invested: invested(b) })), cash: r2(st.cash),
      activity: activityView(st, (st.activity || []).slice(0, a.limit || 30)), todo: todoList(st), asOf: st.clock,
      ...(st.baskets.length ? {} : { note: 'No baskets in this space yet. If the user has baskets on the website, they are in another browser space: share the website link below.' }) };
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
      baskets: st.baskets.map(b => basketView(st, b)), orders: st.orders.slice(0, 150), alerts: st.alerts.slice(0, 150), clearedAlerts: (st.clearedAlerts || []).slice(0, 100),
      unread: st.alerts.filter(a => !a.read).length, pending: st.orders.filter(o => o.status === 'pending').length,
      flags: st.flags.slice(0, 100), journal: st.journal.slice(0, 100), rules: rulesOf(st, st.rules), savedProRules: savedProRules(st), needs: dedupe(needs),
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
    const before = st.plan;
    st.plan = a.plan === 'pro' ? 'pro' : 'free';
    // Older saves capped a Free basket's own limit at 8; on Pro it gets the normal 12 unless the person set it.
    if (st.plan === 'pro') for (const b of st.baskets) if (!b.limitsBy && b.limits.maxStocks < DEFAULT_LIMITS.maxStocks) b.limits.maxStocks = DEFAULT_LIMITS.maxStocks;
    // "Every change" alerts are Pro: switching to Free turns them off (urgent alerts stay on).
    if (st.plan === 'free') { st.notif.push = false; st.notif.email = false; }
    st.billing = st.plan === 'pro' ? (PRICES[a.billing] ? a.billing : 'yearly') : null;
    // Pro rules stop or start applying with the plan: re-check every basket now so ratings follow.
    if (st.plan !== before) for (const b of st.baskets) checkBasket(st, b, 'rules');
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

// Deleted notifications are kept (newest first) so the Notifications page can show what was cleared and what went with it.
function archiveAlerts(st, alerts, actor, cancelled) {
  st.clearedAlerts ||= [];
  const byId = Object.fromEntries(cancelled.map(c => [c.id, c]));
  for (const al of alerts) st.clearedAlerts.unshift({ ...al, basketName: st.baskets.find(b => b.id === al.basketId)?.name || al.basketName || null, read: true, clearedAt: st.clock, clearedBy: actor,
    cancelled: al.action?.kind === 'orders' ? al.action.ids.map(id => byId[id]).filter(Boolean) : [] });
  if (st.clearedAlerts.length > 200) st.clearedAlerts.length = 200;
}
function dropAlertActions(st, alerts, actor) {
  const out = [];
  for (const al of alerts) {
    if (al.action?.kind !== 'orders') continue;
    const waiting = al.action.ids.map(id => st.orders.find(x => x.id === id && x.status === 'pending')).filter(Boolean);
    for (const o of waiting) if (o.status === 'pending') OPS.cancel_order(st, { order_id: o.id, reason: 'Notification deleted' }, actor);
    for (const o of waiting) out.push({ id: o.id, name: o.name, side: o.side, qty: o.qty });
  }
  return out;
}
// What the user should do next, most urgent first: orders with a sell the rules or news asked for,
// then other orders, urgent alerts that have no order to confirm, baskets short of stocks,
// baskets not invested yet, and last the news flags that only wait for results.
function todoListRaw(st) {
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
  for (const b of st.baskets) if (b.deleteRequest) out.push({ kind: 'delete', priority: 1, basketId: b.id, by: b.deleteRequest.by, text: `Delete ${b.name}?`, detail: `${b.deleteRequest.by === 'claude' ? 'Claude asked' : 'Asked'}${b.deleteRequest.reason ? `: ${b.deleteRequest.reason}` : ''}${invested(b) ? ' · it still holds shares' : ''}` });
  // An urgent alert that came with an order is covered by that order (above) while it waits, and is settled once the order is confirmed or cancelled.
  const urgent = st.alerts.filter(a => a.critical && !a.read && a.action?.kind !== 'orders');
  if (urgent.length) out.push({ kind: 'alerts', priority: 2, text: `Read ${urgent.length} urgent alert${urgent.length > 1 ? 's' : ''}`, detail: urgent[0].text });
  for (const b of st.baskets) if (b.kind === 'model' && !b.deleteRequest && b.symbols.length < b.limits.minStocks && !groups[b.id]) out.push({ kind: 'basket', priority: 3, basketId: b.id, text: `${b.name} needs ${b.limits.minStocks - b.symbols.length} more stock${b.limits.minStocks - b.symbols.length > 1 ? 's' : ''}`, detail: 'Add stocks or ask Claude to find some' });
  for (const b of st.baskets) { const max = Math.min(b.limits.maxStocks, plan(st).maxStocks); if (b.kind === 'model' && !b.deleteRequest && b.symbols.length > max) out.push({ kind: 'overmax', priority: 3, basketId: b.id, text: `${b.name} has ${b.symbols.length} stocks, Free allows ${max}`, detail: `It keeps them, but no stock can be added until it has fewer than ${max}. Remove ${b.symbols.length - max + 1} to add one, or go Pro (12).` }); }
  for (const b of st.baskets) if (b.kind === 'model' && !b.deleteRequest && !invested(b) && !groups[b.id] && b.symbols.length >= b.limits.minStocks) out.push({ kind: 'invest', priority: 4, basketId: b.id, text: `Invest in ${b.name}`, detail: 'Not invested yet' });
  // Only flags on stocks in a basket wait on something the person cares about; the rest settle on their own.
  for (const b of st.baskets) {
    if (b.kind !== 'model' || b.deleteRequest || groups[b.id] || !invested(b)) continue;
    // Stocks in the basket the rules rate Buy or Hold that were never bought (one share cost more than its part).
    const unbought = b.symbols.filter(x => !(b.holdings[x]?.qty > 0) && shownStatus(st, b, x) !== 'remove');
    const rb = rebalanceTrades(st, b);
    if (rb.needed) out.push({ kind: 'rebalance', priority: 4, basketId: b.id, text: `Rebalance ${b.name}`, detail: `${rb.trades.length} trade${rb.trades.length > 1 ? 's' : ''} bring it back to its plan (drifted ${Math.round(rb.max)} points)` });
    else if (unbought.length && rb.trades.some(t => unbought.includes(t.symbol))) out.push({ kind: 'unbought', priority: 4, basketId: b.id, text: `${unbought.length} stock${unbought.length > 1 ? 's' : ''} in ${b.name} not bought yet`, detail: `${unbought.map(x => st.universe[x]?.name || x).join(', ')} · a rebalance buys ${unbought.length > 1 ? 'them' : 'it'}` });
  }
  const flags = st.flags.filter(f => f.status === 'open' && st.baskets.some(b => b.symbols.includes(f.symbol)));
  if (flags.length) out.push({ kind: 'flags', priority: 5, text: `${flags.length} news flag${flags.length > 1 ? 's' : ''} waiting for results`, detail: flags.map(f => `${f.name}: ${f.metricLabel}`).join(' · ') });
  for (const t of out) t.key = t.kind + (t.basketId ? ':' + t.basketId : '');
  return out.sort((a, b) => a.priority - b.priority);
}
function todoList(st) {
  const hidden = new Set((st.declined || []).map(d => d.key));
  return todoListRaw(st).filter(t => t.kind === 'orders' || t.kind === 'delete' || !hidden.has(t.key));
}

// A rule edit says what it did; if it prepared orders the person still has to confirm them.
const ruleAct = (text, ch) => {
  const ids = (ch?.baskets || []).flatMap(x => [...x.sells_drafted, ...x.buys_drafted].map(o => o.id));
  return { text: ch && ch.summary !== 'No basket stock or rating changed' ? `${text} · ${ch.summary}` : text, kind: ids.length ? 'needs_you' : 'change', ...(ids.length ? { orderIds: ids } : {}) };
};
const READ_LABEL = { get_universe: 'Looked through the stock list', get_basket_status: 'Checked basket status', get_alerts: 'Read your alerts', get_refill_plan: 'Checked replacement options', get_rule_scorecard: 'Read the past test', get_activity: 'Caught up on recent activity', get_rules: 'Read your rules', get_orders: 'Checked orders', get_state: 'Checked the app', get_upgrade_link: 'Shared the link to Pro plans', get_notifications: 'Read your notifications', get_news_flags: 'Read your news flags', get_journal: 'Read your decision journal', get_settings: 'Checked your plan and notification settings', get_stock: 'Looked at a stock', what_if: 'Previewed a rule change', share_card: 'Made a share card of the rules' };
const ids = os => (os || []).map(o => o.id);
function activitySummary(st, op, a, res) {
  const d = res.ok ? res.data : null;
  const bn = id => st.baskets.find(b => b.id === id)?.name || (st.baskets.length === 1 ? st.baskets[0].name : 'basket');
  if (!res.ok) return { text: `Tried to ${op.replace(/_/g, ' ')}: ${res.error.message}`, kind: 'error' };
  switch (op) {
    case 'create_basket': return { text: `Created basket "${d.basket.name}" with ${d.basket.count} stock${d.basket.count === 1 ? '' : 's'}${d.skipped.length ? ` (${d.skipped.length} skipped: rules, limits or plan)` : ''}`, kind: 'change', basketId: d.basket.id };
    case 'add_stock': return { text: `Added ${st.universe[upper(a.symbol)]?.name || a.symbol} to "${d.basket.name}"`, kind: 'change', basketId: d.basket.id };
    case 'remove_stock': return d.orders ? { text: `Prepared a sale of ${st.universe[upper(a.symbol)]?.name || a.symbol}`, kind: 'needs_you', orderIds: ids(d.orders) } : { text: `Removed ${st.universe[upper(a.symbol)]?.name || a.symbol} from "${d.basket.name}"`, kind: 'change' };
    case 'exit_basket': return { text: d.orders.length ? `Prepared exit of "${bn(a.basket_id)}": ${d.orders.length} sell orders${d.cancelled ? ` (${d.cancelled} earlier order${d.cancelled > 1 ? 's' : ''} cancelled)` : ''}` : `Exit of "${bn(a.basket_id)}": nothing to sell`, kind: d.orders.length ? 'needs_you' : 'change', orderIds: ids(d.orders) };
    case 'create_order': return { text: `Prepared ${d.orders.length} ${d.orders[0]?.side || ''} order${d.orders.length > 1 ? 's' : ''} for "${bn(d.orders[0]?.basketId)}" (about ${fmtINR(d.orders.reduce((t, o) => t + o.estValue, 0))})`, kind: 'needs_you', basketId: d.orders[0]?.basketId, orderIds: ids(d.orders) };
    case 'add_news_flag': return { text: `Flagged news on ${d.flag.name}: ${d.flag.metricLabel} likely ${d.flag.impact}${d.drafted_orders.length ? ' · sell prepared' : ''}`, kind: d.drafted_orders.length ? 'needs_you' : 'change', orderIds: ids(d.drafted_orders) };
    case 'set_rule': return ruleAct(`Changed "${d.rule.label}" limits in ${d.applied_to}`, d.changed);
    case 'toggle_rule': return ruleAct(`Turned "${d.rule.label}" ${d.rule.enabled ? 'on' : 'off'} in ${d.applied_to}`, d.changed);
    case 'set_rating_cutoffs': return ruleAct(`Set rating cutoffs in ${d.applied_to}: ${d.cutoffs.meaning}`, d.changed);
    case 'set_basket_rule': return ruleAct(`Changed basket limits of "${d.basket.name}"`, d.changed);
    case 'add_candidate': return { text: `${d.updated ? 'Updated' : 'Added'} ${d.stock.name} (${d.stock.symbol}) ${d.updated ? 'in' : 'to'} the stock list · rated ${d.stock.rating}`, kind: 'change' };
    // ---- things only the person does in the website ----
    case 'confirm_order': {
      if (!d.filled.length) return null;
      const buys = d.filled.filter(o => o.side === 'buy'), sells = d.filled.filter(o => o.side === 'sell');
      const part = (os, verb) => os.length && `${verb} ${os.length === 1 ? os[0].name : `${os.length} stocks`} (${fmtINR(os.reduce((t, o) => t + (o.fill?.value ?? o.estValue), 0))})`;
      const where = [...new Set(d.filled.map(o => o.basketId))];
      return { text: d.exits.length ? `Exited "${d.exits[0].name}": ${fmtINR(d.exits[0].returnedCash)} back as cash` : `${[part(buys, 'Bought'), part(sells, 'Sold')].filter(Boolean).join(', ')}${where.length === 1 ? ` in "${bn(where[0])}"` : ''}`, kind: 'change', basketId: where[0] };
    }
    case 'decline_todo': return { text: `Declined "${d.text}"${d.cancelled.length ? ` · cancelled ${d.cancelled.length} order${d.cancelled.length > 1 ? 's' : ''}` : ''}`, kind: 'change' };
    case 'dismiss_alert': return { text: `Deleted notification "${d.text}"${d.cancelled.length ? ` and cancelled ${d.cancelled.length} waiting order${d.cancelled.length > 1 ? 's' : ''}` : ''}`, kind: 'change' };
    case 'clear_alerts': return { text: `Cleared ${d.cleared} notification${d.cleared === 1 ? '' : 's'}${d.cancelled.length ? ` and cancelled ${d.cancelled.length} waiting order${d.cancelled.length > 1 ? 's' : ''}` : ''}`, kind: 'change' };
    case 'cancel_order': return { text: d.order.side === 'sell' && (d.order.source === 'rules' || d.order.tag === 'news_only' || d.order.tag === 'rules') ? `Kept ${d.order.name} anyway` : d.order.source === 'rules' ? `Skipped the suggested ${d.order.side} of ${d.order.name}` : `Cancelled the ${d.order.side} order for ${d.order.name}`, kind: 'change', basketId: d.order.basketId };
    case 'request_delete_basket': return { text: `Asked you to delete "${d.name}"`, kind: 'needs_you', basketId: d.requested };
    case 'keep_basket': return { text: `Kept "${d.name}"`, kind: 'change', basketId: d.kept };
    case 'delete_basket': return { text: `Deleted basket "${d.name || a.name || 'basket'}"`, kind: 'change' };
    case 'duplicate_basket': return { text: `Copied a basket as "${d.basket.name}"`, kind: 'change', basketId: d.basket.id };
    case 'reset_rules': return { text: d.scope === 'all' ? `Reset the default rules and all ${d.baskets_reset} baskets` : d.scope === 'defaults' ? 'Reset the default rules to the original 13' : `Reset the rules of "${bn(a.basket_id)}" to default`, kind: 'change' };
    case 'apply_default_rules': return ruleAct(`Applied the default rules to ${d.baskets_updated} basket${d.baskets_updated === 1 ? '' : 's'}`, d.changed);
    case 'delete_news_flag': return { text: `Withdrew the news flag on ${d.flag.name}${d.cancelledOrders ? ` · cancelled ${d.cancelledOrders} sell` : ''}`, kind: 'change' };
    case 'update_news_flag': return { text: `Edited the news flag on ${d.flag.name}: ${d.flag.metricLabel} likely ${d.flag.impact}`, kind: 'change' };
    case 'update_order': return { text: `Changed the ${d.order.side} of ${d.order.name} to ${d.order.qty} share${d.order.qty === 1 ? '' : 's'} (still waiting for you)`, kind: 'needs_you', orderIds: [d.order.id], basketId: d.order.basketId };
    case 'rebalance_plan': return d.orders ? (d.orders.length ? { text: `Prepared a rebalance of "${bn(a.basket_id)}": ${d.orders.length} order${d.orders.length > 1 ? 's' : ''}`, kind: 'needs_you', orderIds: ids(d.orders), basketId: a.basket_id } : { text: `Checked "${bn(a.basket_id)}": nothing to rebalance`, kind: 'read' }) : { text: 'Checked how far a basket drifted from its plan', kind: 'read' };
    case 'set_holding': return { text: `Set ${st.universe[upper(a.symbol)]?.name || a.symbol} in "${d.basket.name}" to ${Math.max(0, Math.floor(Number(a.qty) || 0))} shares`, kind: 'change', basketId: d.basket.id };
    case 'update_journal': return { text: `Edited the note on "${d.entry.action}" for ${d.entry.name}`, kind: 'change' };
    case 'delete_journal': return { text: 'Deleted a decision-journal note', kind: 'change' };
    case 'delete_candidate': return { text: `Removed ${d.deleted} from the stock list`, kind: 'change' };
    case 'mark_alerts_read': return { text: `Marked ${a.ids?.length ? `${a.ids.length} notification${a.ids.length > 1 ? 's' : ''}` : 'all notifications'} as read`, kind: 'change' };
    case 'restore_todo': return { text: 'Brought a declined item back to Pending', kind: 'change' };
    case 'restore_alert': return { text: `Restored notification "${d.text}"`, kind: 'change' };
    case 'set_notif': return { text: `Notifications: every change ${d.notif.push ? 'on' : 'off'}, email ${d.notif.email ? 'on' : 'off'} (urgent alerts always on)`, kind: 'change' };
    case 'update_basket': return { text: `Edited basket "${d.basket.name}"${d.changed && d.changed.summary !== 'No basket stock or rating changed' ? ` · ${d.changed.summary}` : ''}`, kind: 'change', basketId: d.basket.id };
    case 'advance_day': case 'advance_quarter': {
      const f = new Set(d.filings.map(x => x.symbol)).size, c = d.changes.length; // a tick that changed nothing in the user's baskets is not news
      return c ? { text: `Rules check: ${c} status change${c === 1 ? '' : 's'} in your baskets${f ? ` · new results for ${f} compan${f === 1 ? 'y' : 'ies'}` : ''}`, kind: 'change', actor: 'rules' } : null;
    }
    default: return { text: READ_LABEL[op] || op.replace(/_/g, ' '), kind: 'read' };
  }
}

function basketBacktest(st, b) {
  return backtest(rulesOf(st, b.rules), HISTORY, NAMES, b.theme ? { theme: b.theme, minTheme: b.limits.minTheme } : { symbols: new Set(candidatesFor(st, b).map(u => u.symbol)) });
}
// What a rule edit really did, per basket: rating changes as the basket shows them, stocks taken out or added
// (refill), orders drafted or cancelled; and, for the default rules, the stock ratings that changed in Explore.
function snapRules(st, baskets, defaults) {
  return {
    baskets: baskets.map(b => ({ b, sym: [...b.symbols], status: Object.fromEntries(b.symbols.map(x => [x, shownStatus(st, b, x)])), pending: new Set(st.orders.filter(o => o.basketId === b.id && o.status === 'pending').map(o => o.id)) })),
    universe: defaults ? Object.fromEntries(Object.values(st.universe).map(u => [u.symbol, scoreStock(u, rulesOf(st, st.rules)).status])) : null,
  };
}
function ruleReport(st, before) {
  const nm = x => st.universe[x]?.name || x;
  const o2 = o => ({ id: o.id, side: o.side, symbol: o.symbol, name: o.name, qty: o.qty, tag: o.tag, reason: o.reason });
  const baskets = before.baskets.filter(x => st.baskets.includes(x.b)).map(({ b, sym, status, pending }) => {
    const ratings = b.symbols.filter(x => sym.includes(x) && status[x] !== shownStatus(st, b, x)).map(x => ({ symbol: x, name: nm(x), from: STATUS_WORD[status[x]] || status[x], to: STATUS_WORD[shownStatus(st, b, x)] }));
    const removed = sym.filter(x => !b.symbols.includes(x)).map(x => ({ symbol: x, name: nm(x), was: STATUS_WORD[status[x]] || status[x] }));
    const added = b.symbols.filter(x => !sym.includes(x)).map(x => ({ symbol: x, name: nm(x), status: STATUS_WORD[shownStatus(st, b, x)], why: 'Added to keep the basket at its minimum number of stocks' }));
    const now = st.orders.filter(o => o.basketId === b.id);
    const drafted = now.filter(o => o.status === 'pending' && !pending.has(o.id)).map(o2);
    const cancelled = now.filter(o => pending.has(o.id) && o.status === 'cancelled').map(o2);
    return { basket_id: b.id, name: b.name, ratings, removed, added, sells_drafted: drafted.filter(o => o.side === 'sell'), buys_drafted: drafted.filter(o => o.side === 'buy'), orders_cancelled: cancelled };
  });
  const out = { baskets: baskets.filter(x => x.ratings.length || x.removed.length || x.added.length || x.sells_drafted.length || x.buys_drafted.length || x.orders_cancelled.length) };
  if (before.universe) {
    const R = rulesOf(st, st.rules);
    out.stock_ratings = Object.values(st.universe).filter(u => before.universe[u.symbol] && before.universe[u.symbol] !== scoreStock(u, R).status)
      .map(u => ({ symbol: u.symbol, name: u.name, from: STATUS_WORD[before.universe[u.symbol]], to: STATUS_WORD[scoreStock(u, R).status] }));
  }
  const n = k => out.baskets.reduce((t, x) => t + x[k].length, 0);
  const bits = [n('ratings') && `${n('ratings')} rating${n('ratings') > 1 ? 's' : ''} changed`, n('removed') && `${n('removed')} taken out`, n('added') && `${n('added')} added`,
    n('sells_drafted') && `${n('sells_drafted')} sell${n('sells_drafted') > 1 ? 's' : ''} prepared`, n('buys_drafted') && `${n('buys_drafted')} replacement buy${n('buys_drafted') > 1 ? 's' : ''} prepared`,
    n('orders_cancelled') && `${n('orders_cancelled')} waiting order${n('orders_cancelled') > 1 ? 's' : ''} cancelled`, out.stock_ratings?.length && `${out.stock_ratings.length} stock rating${out.stock_ratings.length > 1 ? 's' : ''} changed in Explore`].filter(Boolean);
  out.summary = bits.length ? bits.join(', ') : 'No basket stock or rating changed';
  out.needs_user = n('sells_drafted') + n('buys_drafted') > 0 ? 'Orders were prepared: the user reviews and confirms them in the website.' : undefined;
  return out;
}
function statusesSnapshot(st, b) { return Object.fromEntries(candidatesFor(st, b).map(u => [u.symbol, scoreIn(st, b, u.symbol).status])); }
function diffStatuses(a, b) { return Object.keys(b).filter(k => a[k] !== b[k]).map(k => ({ symbol: k, from: a[k], to: b[k] })); }
function dedupe(list) { const seen = new Set(); return list.filter(x => (seen.has(x.symbol) ? false : seen.add(x.symbol))); }

export const OP_NAMES = Object.keys(OPS);
// Destructive or money-moving actions stay with the person, in the website.
// Editing rules (default or basket, switches or limits) is a Pro feature, in the website and through Claude.
export const CLAUDE_PRO_RULES = new Set(['set_rating_cutoffs', 'set_rule', 'toggle_rule', 'apply_default_rules', 'set_basket_rule']);
// What only the person can do, and why. Claude has no tool for these (the website has them).
export const PERSON_ONLY_REASONS = {
  confirm_order: 'Orders move (practice) money, so the user confirms every one in the website. Claude prepares orders (create_order, rebalance_basket, exit_basket) and can cancel or resize them while they wait.',
  set_plan: 'Upgrading or paying is the user\'s own choice. Claude gives them get_upgrade_link and they tap Start Pro.',
  delete_basket: 'Deleting a basket can\'t be undone and may sell everything in it. Claude asks with request_delete_basket; the user taps Delete or Keep it.',
  keep_basket: 'Keeping a basket is the user\'s answer to a delete request (often Claude\'s own). Claude can still withdraw its request with decline_pending.',
  reset: 'Wipes the whole space (baskets, orders, history). Only the user can do that, in Settings.',
  set_profile: 'The user\'s own name on their profile.',
};
export const PERSON_ONLY = new Set(Object.keys(PERSON_ONLY_REASONS));

// Older saves could hold several baskets with the same name: number them once (My basket, My basket 2, …).
// A declined reminder stops being "declined" once its reason is gone (basket deleted, invested, or filled up),
// so if the same situation comes back later it shows again instead of staying silently hidden.
function pruneDeclined(st) {
  if (!st.declined?.length) return;
  const live = new Set(todoListRaw(st).map(t => t.kind + (t.basketId ? ':' + t.basketId : '')));
  st.declined = st.declined.filter(d => live.has(d.key));
  for (const c of st.clearedAlerts || []) if (c.key && !st.declined.some(d => d.key === c.key)) c.key = null;
}
function migrate(st) {
  // Daily numbers move a little each day now (engine/daily.js); the "Rules watch every day" story stock gets its
  // story level once. Older news flags had no starting value: they are settled on the numbers before their results.
  if (!st.dailyV1) { if (st.universe) pinStoryData(st.universe); st.dailyV1 = true; }
  if (!st.driftOnce && st.alerts) { // older spaces piled up one balance alert a month: keep only the newest per basket
    const seen = new Set();
    st.alerts = st.alerts.filter(a => a.type !== 'drift' || (!seen.has(a.basketId) && seen.add(a.basketId)));
    st.driftOnce = true;
  }
  if (st.namesUnique) return;
  const seen = new Set();
  for (const b of st.baskets || []) {
    let n = b.name, i = 2;
    while (seen.has(n.toLowerCase())) n = `${b.name} ${i++}`;
    b.name = n; seen.add(n.toLowerCase());
  }
  st.namesUnique = true;
}

export function dispatch(st, op, args = {}, actor = 'you') {
  migrate(st);
  const fn = OPS[op];
  if (!fn) return { ok: false, error: { code: 'unknown_op', message: `Unknown operation ${op}` } };
  // Any call from Claude, even a refused one, proves the connector works: stamp when it was last seen.
  if (actor === 'claude') { st.lastClaudeCall = { op, at: st.clock, time: new Date().toISOString() }; st.claudeConnected = true; }
  if (actor === 'claude' && PERSON_ONLY.has(op)) { const res = { ok: false, error: { code: 'person_only', message: `Only the user can do this, in the website. ${PERSON_ONLY_REASONS[op]}` } }; logActivity(st, op, args, res); return res; }
  try {
    if (actor === 'claude' && CLAUDE_PRO_RULES.has(op) && !isPro(st)) throw proError('Claude editing your rules');
    const res = { ok: true, data: fn(st, args || {}, actor) };
    settleOrderAlerts(st);
    pruneDeclined(st);
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
const USER_LOGGED = new Set(['keep_basket', 'create_basket', 'update_basket', 'duplicate_basket', 'delete_basket', 'exit_basket', 'add_stock', 'remove_stock', 'add_candidate',
  'set_rule', 'set_rating_cutoffs', 'toggle_rule', 'reset_rules', 'apply_default_rules', 'set_basket_rule', 'confirm_order', 'cancel_order', 'dismiss_alert', 'clear_alerts', 'decline_todo', 'add_news_flag', 'delete_news_flag', 'advance_day', 'advance_quarter']);
function logActivity(st, op, args, res, actor = 'claude') {
  st.activity ||= [];
  let sum;
  try { sum = activitySummary(st, op, args || {}, res); } catch { sum = { text: op.replace(/_/g, ' '), kind: res.ok ? 'change' : 'error' }; }
  if (!sum || (actor !== 'claude' && sum.kind === 'read')) return;
  // The person's own drafts go straight to their review sheet and to-do list; the log records the confirm instead.
  if (actor !== 'claude' && sum.kind === 'needs_you') { if (op !== 'add_news_flag' && !CLAUDE_PRO_RULES.has(op)) return; sum.kind = 'change'; }
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
  return list.map(x => x.kind !== 'needs_you' ? x
    : x.orderIds ? { ...x, pending: x.orderIds.some(id => st.orders.some(o => o.id === id && o.status === 'pending')) }
    : x.tool === 'request_delete_basket' ? { ...x, pending: !!st.baskets.find(b => b.id === x.basketId)?.deleteRequest } : x);
}
