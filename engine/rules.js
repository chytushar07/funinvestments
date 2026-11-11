// Rules engine: 13 metrics + optional event rules → points → Buy (pass) / Hold (watch) / Sell (remove).
// Plain, deterministic code. No AI.

export const DEFAULT_RULES = [
  { id: 'adtv',   label: 'Daily trading',   long: 'Average value traded per day', unit: '₹ cr', dir: 'higher', green: 10,  red: 2,   critical: true,  cadence: 'daily',     good: 200, bad: 0.2 },
  { id: 'pledge', label: 'Owner shares pledged', long: 'Owner (promoter) shares pledged for loans',         unit: '%',    dir: 'lower',  green: 10,  red: 25,  critical: true,  cadence: 'quarterly', good: 0,   bad: 60 },
  { id: 'de',     label: 'Debt vs equity',   long: 'Debt compared with shareholders\' money',                  unit: '×',    dir: 'lower',  green: 0.5, red: 1.0, critical: true,  cadence: 'quarterly', good: 0,   bad: 3 },
  { id: 'icr',    label: 'Interest cover',  long: 'How many times profit covers interest',               unit: '×',    dir: 'higher', green: 5,   red: 2.5, critical: true,  cadence: 'quarterly', good: 40,  bad: 0.5 },
  { id: 'loss',   label: 'Loss-making years',      long: 'Years with a loss, out of the last 5',            unit: 'yrs',  dir: 'lower',  green: 0,   red: 1,   critical: true,  cadence: 'quarterly', good: 0,   bad: 4 },
  { id: 'vol',    label: 'Price swings',      long: 'How much the price swings in a year',              unit: '%',    dir: 'lower',  green: 35,  red: 50,  critical: false, cadence: 'daily',     good: 18,  bad: 80 },
  { id: 'beta',   label: 'Market sensitivity',            long: 'How strongly it moves with the market',                   unit: '',     dir: 'lower',  green: 1.2, red: 1.5, critical: false, cadence: 'daily',     good: 0.6, bad: 2.2 },
  { id: 'dd',     label: 'Biggest fall',      long: 'Biggest drop from a peak in 5 years',             unit: '%',    dir: 'higher', green: -45, red: -60, critical: false, cadence: 'daily',     good: -15, bad: -90 },
  { id: 'cash',   label: 'Profit to cash', long: 'How much profit turns into real cash',        unit: '×',    dir: 'higher', green: 0.8, red: 0.5, critical: false, cadence: 'quarterly', good: 1.4, bad: 0.1 },
  { id: 'roe',    label: 'Return on equity',             long: 'Profit made on shareholders\' money',             unit: '%',    dir: 'higher', green: 15,  red: 10,  critical: false, cadence: 'quarterly', good: 30,  bad: -5 },
  { id: 'margin', label: 'Margin swings',    long: 'How much profit margins jump around',          unit: 'pts',  dir: 'lower',  green: 3,   red: 6,   critical: false, cadence: 'quarterly', good: 0.5, bad: 12 },
  { id: 'pe',     label: 'Price vs usual',     long: 'Today\'s valuation vs its usual level',         unit: '×',    dir: 'lower',  green: 1.3, red: 1.7, critical: false, cadence: 'daily',     good: 0.7, bad: 2.8 },
  { id: 'peg',    label: 'Price vs growth',             long: 'Valuation compared with growth',                    unit: '',     dir: 'lower',  green: 2,   red: 3.5, critical: false, cadence: 'daily',     good: 0.8, bad: 6 },
];

// Optional event rules (Pro). Boolean events on a stock.
export const EVENT_RULES = [
  { id: 'ev_surv',    label: 'Exchange watchlist', long: 'NSE put it on a special-watch list (ASM/GSM)', critical: true },
  { id: 'ev_auditor', label: 'Auditor quit',      long: 'The company\'s auditor resigned',          critical: true },
  { id: 'ev_late',    label: 'Late results',      long: 'Quarterly results filed late',        critical: false },
  { id: 'ev_rating',  label: 'Credit rating cut',        long: 'A rating agency downgraded its debt',   critical: false },
];

export const STATUS_LIMITS = { acMin: 20, watchFrom: 4, removeAbove: 8, passBufferTo: 4, minHistory: 3, missingWatch: 3 };

// Rating cutoffs: Buy with fewer than buyBelow warnings, Sell with more than sellAbove, Hold in between.
export const DEFAULT_CUTOFFS = { buyBelow: STATUS_LIMITS.watchFrom, sellAbove: STATUS_LIMITS.removeAbove };
export const cutoffsOf = ruleSet => ({ ...DEFAULT_CUTOFFS, ...(ruleSet?.cutoffs || {}) });

export function defaultRuleSet() {
  return {
    cutoffs: { ...DEFAULT_CUTOFFS },
    metrics: DEFAULT_RULES.map(r => ({ ...r, enabled: true, source: 'default' })),
    events: EVENT_RULES.map(r => ({ ...r, enabled: false, source: 'default' })),
  };
}

export function band(rule, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'missing';
  if (rule.dir === 'higher') {
    if (v >= rule.green) return 'green';
    if (v < rule.red) return 'red';
    return 'amber';
  }
  if (v <= rule.green) return 'green';
  if (v > rule.red) return 'red';
  return 'amber';
}

export function fmtThreshold(rule, which) {
  const t = rule[which];
  if (rule.id === 'loss') return which === 'green' ? `${rule.green}` : `≥ ${rule.red + 1}`;
  const op = rule.dir === 'higher' ? (which === 'green' ? '≥' : '<') : (which === 'green' ? '≤' : '>');
  return `${op} ${t}${rule.unit === '%' || rule.unit === '×' ? rule.unit : ''}`;
}

// Score one stock. opts.prevStatus enables the Pass buffer (anti-churn).
// opts.theme / opts.minTheme apply the basket's theme-share rule (e.g. AC share of business ≥ 20%).
export function scoreStock(stock, ruleSet, opts = {}) {
  const res = { points: 0, criticalReds: [], reds: [], ambers: [], missing: [], events: [], bands: {}, status: 'pass', reasons: [] };
  for (const r of ruleSet.metrics) {
    if (!r.enabled) continue;
    const b = band(r, stock.metrics?.[r.id]);
    res.bands[r.id] = b;
    if (b === 'missing') { res.missing.push(r.id); continue; }
    if (b === 'red') { res.points += 2; res.reds.push(r.id); if (r.critical) res.criticalReds.push(r.id); }
    if (b === 'amber') { res.points += 1; res.ambers.push(r.id); }
  }
  for (const e of ruleSet.events) {
    if (!e.enabled || !stock.events?.[e.id]) continue;
    res.events.push(e.id);
    if (e.critical) res.criticalReds.push(e.id); else { res.points += 2; res.reds.push(e.id); }
  }
  const L = STATUS_LIMITS;
  const C = cutoffsOf(ruleSet);
  const theme = opts.theme || null;
  const minTheme = opts.minTheme ?? L.acMin;
  const share = theme ? stock.themes?.[theme] : undefined;
  res.themeShare = share ?? null;
  const missingCount = res.missing.length + (theme && share == null ? 1 : 0);
  if (theme && share != null && share < minTheme) {
    res.status = 'remove'; res.reasons.push(`Only ${share}% of its business is in this theme (needs ${minTheme}%)`); res.lowTheme = true;
  } else if (res.criticalReds.length) {
    res.status = 'remove'; res.reasons.push(`Fails a must-pass rule: ${res.criticalReds.map(labelOf).join(', ')}`);
  } else if (res.points > C.sellAbove) {
    res.status = 'remove'; res.reasons.push(`${res.points} warnings (more than ${C.sellAbove})`);
  } else {
    const watchWhy = [];
    if (res.points >= C.buyBelow) watchWhy.push(`${res.points} warnings`);
    if ((stock.historyYears ?? 10) < L.minHistory) watchWhy.push('Less than 3 years of price history');
    if (missingCount >= L.missingWatch) watchWhy.push(`${missingCount} numbers missing`);
    if (watchWhy.length) {
      const onlyPoints = watchWhy.length === 1 && res.points === C.buyBelow;
      if (opts.prevStatus === 'pass' && onlyPoints) { res.status = 'pass'; res.reasons.push(`Stays Buy until ${C.buyBelow + 1} warnings (avoids flip-flopping)`); res.buffered = true; }
      else { res.status = 'watch'; res.reasons.push(...watchWhy); }
    } else {
      res.status = 'pass'; res.reasons.push(res.points ? `${res.points} warning${res.points > 1 ? 's' : ''}` : 'No warnings');
    }
  }
  res.missingCount = missingCount;
  return res;
}

const LABELS = Object.fromEntries([...DEFAULT_RULES, ...EVENT_RULES].map(r => [r.id, r.label]));
export function labelOf(id) { return LABELS[id] || id; }
