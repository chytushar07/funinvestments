// Stock data. 55 original NSE symbols across two themes (AC value chain, Energy) plus ~605 more real, listed NSE
// equities (engine/universe.js) across 13 themes. Prices and day changes are real NSE closes of 9 Nov 2026.
// Price history and yearly returns are REAL (engine/realhistory.js, NSE bhavcopies 2018-2026, split/bonus adjusted).
// Rule metrics: real where engine/universe.js has them (price-based ones from NSE data, fundamentals from public
// screener.in pages); every other value is generated (seeded, so stable between runs) and marked mock per stock.
// AC data stays shaped after the user's research doc so its statuses and the past-test story match it;
// the June snapshots of rule metrics used by the past test are generated too (returns are real).

import { DEFAULT_RULES } from './rules.js';
import { THEMES, STAGES } from './themes.js';
import { MORE_STOCKS, EXTRA_THEMES, ORIG_REAL } from './universe.js';
import { REAL_DATES, REAL_NIFTY, REAL_FIRST, REAL_PX } from './realhistory.js';
export { THEMES, STAGES };

export function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// symbol, name, sector, segment, theme share {theme: %}, first June in history, price, prev close,
// today's profile (red / amber metrics), loss years ago (0 = latest year), history years
const S = (symbol, name, sector, stage, themes, from, price, prev, red = [], amber = [], lossAgo = null, historyYears = 10, extra = {}) =>
  ({ symbol, name, sector, stage, themes, from, price, prev, red, amber, lossAgo, historyYears, ...extra });

export const STOCKS = [
  // ---- AC value chain (doc) ----
  S('SRF', 'SRF', 'Chemicals', 'raw', { ac: 30 }, 2018, 2459.7, 2470.0, [], ['peg']),
  S('NAVINFLUOR', 'Navin Fluorine', 'Chemicals', 'raw', { ac: 35 }, 2018, 9115.0, 9065.0, [], ['vol', 'margin', 'peg']),
  S('FLUOROCHEM', 'Gujarat Fluorochemicals', 'Chemicals', 'raw', { ac: 30 }, 2018, 4574.5, 4578.3, [], ['roe', 'margin', 'peg']),
  S('RAMRAT', 'Ram Ratna Wires', 'Metals', 'raw', { ac: 35 }, 2018, 517.8, 527.35, ['de'], ['vol']),
  S('HINDALCO', 'Hindalco', 'Metals', 'raw', { ac: 5 }, 2018, 960.0, 953.0, [], ['margin']),
  S('CHEMPLASTS', 'Chemplast Sanmar', 'Chemicals', 'raw', { ac: 5 }, 2018, 237.83, 213.41, [], ['vol']),
  S('PRECWIRE', 'Precision Wires', 'Metals', 'parts', { ac: 40 }, 2018, 418.55, 407.9, [], ['de', 'vol', 'peg']),
  S('AMBER', 'Amber Enterprises', 'Consumer durables', 'parts', { ac: 85 }, 2018, 6230.0, 6354.0, ['icr', 'roe', 'pe', 'peg'], ['vol', 'beta', 'cash']),
  S('PGEL', 'PG Electroplast', 'Consumer durables', 'parts', { ac: 60 }, 2018, 564.0, 543.05, ['cash', 'pe'], ['icr', 'vol', 'beta', 'dd', 'margin', 'peg']),
  S('EPACK', 'EPACK Durable', 'Consumer durables', 'parts', { ac: 80 }, 2024, 157.15, 158.3, ['icr', 'vol', 'dd', 'roe'], ['beta', 'cash', 'margin', 'peg'], null, 2.6),
  S('KRN', 'KRN Heat Exchanger', 'Capital goods', 'parts', { ac: 95 }, 2025, 967.4, 978.5, ['vol', 'cash'], [], null, 2),
  S('SUBROS', 'Subros', 'Auto parts', 'parts', { ac: 55 }, 2018, 604.95, 612.5, ['roe'], ['margin', 'peg', 'vol']),
  S('HIRECT', 'Hind Rectifiers', 'Capital goods', 'parts', { ac: 30 }, 2018, 913.35, 913.55, ['de'], ['adtv', 'vol']),
  S('CUBEXTUB', 'Cubex Tubings', 'Metals', 'parts', { ac: 60 }, 2018, 191.35, 195.25, ['adtv', 'dd'], ['vol']),
  S('TRITONV', 'Triton Valves', 'Auto parts', 'parts', { ac: 45 }, 2018, 1138.3, 1074.85, ['adtv', 'dd'], ['vol']),
  S('KSHINTL', 'KSH International', 'Metals', 'parts', { ac: 40 }, 2025, 992.5, 1013.7, ['vol', 'cash'], ['beta'], null, 1),
  S('VOLTAS', 'Voltas', 'Consumer durables', 'brands', { ac: 75 }, 2018, 1090.1, 1056.5, ['cash', 'roe'], ['peg']),
  S('BLUESTARCO', 'Blue Star', 'Consumer durables', 'brands', { ac: 85 }, 2018, 1577.5, 1567.0, ['peg'], ['cash']),
  S('HAVELLS', 'Havells (Lloyd)', 'Consumer durables', 'brands', { ac: 25 }, 2018, 1159.5, 1123.0, [], ['dd', 'peg']),
  S('WHIRLPOOL', 'Whirlpool of India', 'Consumer durables', 'brands', { ac: 35 }, 2018, 837.7, 835.2, ['dd', 'roe', 'peg'], ['cash']),
  S('LGEINDIA', 'LG Electronics India', 'Consumer durables', 'brands', { ac: 30 }, 2026, 1793.8, 1772.2, [], [], null, 1),
  S('JCHAC', 'Bosch Home Comfort', 'Consumer durables', 'brands', { ac: 95 }, 2018, 1432.2, 1444.4, ['pledge', 'icr', 'loss'], []),
  S('IFBIND', 'IFB Industries', 'Consumer durables', 'brands', { ac: 15 }, 2018, 1103.3, 1121.8, [], ['roe']),
  S('MIRCELECTR', 'MIRC Electronics (Onida)', 'Consumer durables', 'brands', { ac: 30 }, 2018, 38.22, 37.73, ['adtv', 'dd'], ['vol']),
  S('KIRLPNU', 'Kirloskar Pneumatic', 'Capital goods', 'commercial', { ac: 40 }, 2018, 630.3, 639.5, [], ['vol', 'margin']),
  S('ICEMAKE', 'Ice Make Refrigeration', 'Capital goods', 'commercial', { ac: 90 }, 2018, 681.1, 699.4, ['adtv', 'de', 'icr', 'pe'], ['vol', 'beta', 'margin', 'peg']),
  S('THERMAX', 'Thermax', 'Capital goods', 'commercial', { ac: 10 }, 2018, 2785.9, 2839.8, [], ['pe']),
  S('TRITURBINE', 'Triveni Turbine', 'Capital goods', 'commercial', { ac: 10 }, 2018, 503.0, 499.2, [], ['pe']),
  S('HONAUT', 'Honeywell Automation', 'Capital goods', 'commercial', { ac: 15 }, 2018, 30100.0, 30765.0, [], ['peg']),
  S('AVL', 'Aditya Vision', 'Retail', 'retail', { ac: 45 }, 2022, 520.65, 522.0, ['cash'], ['vol', 'beta', 'pe']),
  S('EMIL', 'Electronics Mart India', 'Retail', 'retail', { ac: 35 }, 2023, 142.93, 146.07, ['de', 'icr'], []),
  S('FEDDERS', 'Fedders Electric (delisted)', 'Consumer durables', 'brands', { ac: 80 }, 2018, 0, 0, [], [], null, 10, { delisted: 2020 }),
  // ---- Energy ----
  S('RELIANCE', 'Reliance Industries', 'Energy', 'oilgas', { energy: 100 }, 2018, 1324.4, 1324.0, [], ['pe'], []),
  S('ONGC', 'ONGC', 'Energy', 'oilgas', { energy: 100 }, 2018, 233.5, 234.8, [], ['margin', 'vol'], []),
  S('IOC', 'Indian Oil', 'Energy', 'oilgas', { energy: 100 }, 2018, 146.85, 145.1, ['margin', 'roe'], [], []),
  S('BPCL', 'Bharat Petroleum', 'Energy', 'oilgas', { energy: 100 }, 2018, 316.0, 317.6, ['margin'], ['roe'], []),
  S('HINDPETRO', 'Hindustan Petroleum', 'Energy', 'oilgas', { energy: 100 }, 2018, 385.75, 383.6, ['margin'], ['roe', 'de'], [3]),
  S('GAIL', 'GAIL (India)', 'Energy', 'oilgas', { energy: 100 }, 2018, 188.0, 184.72, [], ['margin'], []),
  S('OIL', 'Oil India', 'Energy', 'oilgas', { energy: 100 }, 2018, 439.0, 444.5, [], ['vol'], []),
  S('PETRONET', 'Petronet LNG', 'Energy', 'oilgas', { energy: 100 }, 2018, 320.45, 314.5, [], [], []),
  S('NTPC', 'NTPC', 'Energy', 'power', { energy: 100 }, 2018, 328.75, 322.7, [], ['de'], []),
  S('POWERGRID', 'Power Grid', 'Energy', 'power', { energy: 100 }, 2018, 257.95, 261.35, [], ['de'], []),
  S('TATAPOWER', 'Tata Power', 'Energy', 'power', { energy: 100 }, 2018, 360.0, 353.4, ['de'], ['pe'], []),
  S('ADANIPOWER', 'Adani Power', 'Energy', 'power', { energy: 100 }, 2018, 206.0, 204.4, ['vol', 'dd'], ['de'], [4]),
  S('NHPC', 'NHPC', 'Energy', 'power', { energy: 100 }, 2018, 80.39, 81.04, [], ['de', 'roe'], []),
  S('SJVN', 'SJVN', 'Energy', 'power', { energy: 100 }, 2018, 57.72, 57.51, ['pe', 'peg'], ['vol'], []),
  S('JSWENERGY', 'JSW Energy', 'Energy', 'power', { energy: 100 }, 2018, 523.15, 524.0, ['de'], ['pe', 'peg'], []),
  S('TORNTPOWER', 'Torrent Power', 'Energy', 'power', { energy: 100 }, 2018, 1236.0, 1274.2, [], ['pe', 'peg'], []),
  S('CESC', 'CESC', 'Energy', 'power', { energy: 100 }, 2018, 128.94, 131.0, [], ['de', 'roe', 'icr'], []),
  S('NLCINDIA', 'NLC India', 'Energy', 'power', { energy: 100 }, 2018, 243.13, 241.56, [], ['de', 'roe'], []),
  S('ADANIGREEN', 'Adani Green Energy', 'Energy', 'renew', { energy: 100 }, 2018, 1448.9, 1417.0, ['de', 'icr', 'pe'], ['vol'], []),
  S('SUZLON', 'Suzlon Energy', 'Energy', 'renew', { energy: 100 }, 2018, 38.91, 39.0, ['dd'], ['vol', 'beta'], [3, 4]),
  S('INOXWIND', 'Inox Wind', 'Energy', 'renew', { energy: 100 }, 2018, 66.69, 65.38, ['dd', 'vol'], ['beta'], [2, 3, 4]),
  S('WAAREEENER', 'Waaree Energies', 'Energy', 'renew', { energy: 100 }, 2025, 2444.0, 2439.0, ['vol'], ['pe'], [], 2),
  S('PREMIERENE', 'Premier Energies', 'Energy', 'renew', { energy: 100 }, 2025, 886.0, 885.0, [], ['vol', 'pe'], [], 2),
  S('COALINDIA', 'Coal India', 'Energy', 'coal', { energy: 100 }, 2018, 401.5, 401.0, [], [], []),
];

// ---------- the wider universe (real NSE equities) ----------
const JUNES = REAL_DATES.junes.map(d => +d.slice(0, 4)); // 2018 … 2026
const firstYear = first => { const i = REAL_DATES.junes.findIndex(d => d >= first); return i < 0 ? 2027 : JUNES[i]; };
const parseThemes = t => Object.fromEntries(t.split(' ').filter(Boolean).map(x => { const [k, v] = x.split(':'); return [k, +v]; }));
export const NEW_STOCKS = MORE_STOCKS.map(([symbol, name, sector, stage, themes, price, prev, first, historyYears, real, lossAgo, lender]) =>
  ({ symbol, name, sector, stage, themes: parseThemes(themes), from: firstYear(first), price, prev, historyYears, real, lossAgo, lender: !!lender, isNew: true }));
export const ALL_STOCKS = [...STOCKS, ...NEW_STOCKS];

// Real adjusted closes: on the first trading day of each June (2018 … 2026), and of each of the last 36 months.
const PX = {};
for (const [sym, v] of Object.entries(REAL_PX)) {
  const [j, m] = v.split('|').map(x => x.split(',').map(n => (n === '' ? null : +n)));
  PX[sym] = { j, m };
}
// Real June-to-June return in %, or null when the stock wasn't listed (or didn't trade) on both dates.
export function realNext12(sym, year) {
  const p = PX[sym]; const i = JUNES.indexOf(year);
  if (!p || i < 0 || !p.j[i] || !p.j[i + 1]) return null;
  return Math.round((p.j[i + 1] / p.j[i] - 1) * 1000) / 10;
}
export const HAS_REAL_HISTORY = sym => !!PX[sym];
export const REAL_FIRST_DAY = REAL_FIRST;

export const NIFTY_SEED = REAL_NIFTY.months.at(-1); // Nifty 50 close, 9 Nov 2026
export const NIFTY_PREV = 25030.35; // 6 Nov 2026

// ---------- metric generation ----------
function sampleValue(rule, bandName, r) {
  if (rule.id === 'loss') return bandName === 'green' ? 0 : bandName === 'amber' ? 1 : 2 + Math.floor(r() * 2);
  const { good, bad, green, red } = rule;
  let lo, hi;
  if (bandName === 'green') { lo = good; hi = green; }
  else if (bandName === 'amber') { lo = green; hi = red; }
  else { lo = red; hi = bad; }
  const v = lo + (hi - lo) * (0.15 + r() * 0.7);
  return Math.round(v * 100) / 100;
}

export function genMetrics(profile, r) {
  const m = {};
  for (const rule of DEFAULT_RULES) {
    const b = profile.red.includes(rule.id) ? 'red' : profile.amber.includes(rule.id) ? 'amber' : 'green';
    m[rule.id] = sampleValue(rule, b, r);
  }
  return m;
}

// ---------- history (June snapshots 2018–2025) ----------
export const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
// Nifty 50 June-to-June return + its dividend yield (≈ total return index), real.
const NIFTY_TRI = REAL_NIFTY.tr;
const KEPT_AVG = { 2018: 26, 2019: 27, 2020: 68, 2021: 22, 2022: 6, 2023: 56, 2024: 21, 2025: 26 };
const REMOVED_AVG = { 2018: -29, 2019: -30, 2020: 179, 2021: 17, 2022: 98, 2023: 116, 2024: 11, 2025: 23 };
const REMOVED_BEAT = { 2018: 1, 2019: 4, 2020: 10, 2021: 8, 2022: 11, 2023: 9, 2024: 4, 2025: 3 };
const NAMED = {
  2018: { KIRLPNU: 13, FEDDERS: -84 }, 2019: { JCHAC: 30, CUBEXTUB: 9, FEDDERS: -100 },
  2020: { PGEL: 794, KIRLPNU: 241, FLUOROCHEM: 190 }, 2021: { PGEL: 107, RAMRAT: 44 },
  2022: { ICEMAKE: 244, RAMRAT: 231, PRECWIRE: 120 }, 2023: { AVL: 175, EMIL: 174, CUBEXTUB: 166 },
  2024: { HIRECT: 88, AMBER: 51 }, 2025: { MIRCELECTR: 167, HIRECT: 78 },
};
const KEPT = {
  2018: [['SRF', 'HAVELLS', 'VOLTAS', 'BLUESTARCO', 'WHIRLPOOL'], ['NAVINFLUOR', 'SUBROS']],
  2019: [['SRF', 'HAVELLS', 'VOLTAS', 'WHIRLPOOL'], ['BLUESTARCO', 'NAVINFLUOR', 'AMBER']],
  2020: [['SRF', 'HAVELLS', 'NAVINFLUOR', 'VOLTAS'], ['BLUESTARCO', 'WHIRLPOOL', 'AMBER', 'SUBROS']],
  2021: [['SRF', 'HAVELLS', 'NAVINFLUOR'], ['VOLTAS', 'BLUESTARCO', 'WHIRLPOOL', 'FLUOROCHEM', 'KIRLPNU']],
  2022: [['SRF', 'HAVELLS', 'NAVINFLUOR'], ['FLUOROCHEM', 'KIRLPNU', 'BLUESTARCO', 'VOLTAS', 'WHIRLPOOL', 'SUBROS']],
  2023: [['SRF', 'HAVELLS', 'KIRLPNU', 'FLUOROCHEM'], ['NAVINFLUOR', 'BLUESTARCO', 'VOLTAS', 'WHIRLPOOL', 'SUBROS', 'PGEL', 'AMBER']],
  2024: [['SRF', 'HAVELLS', 'KIRLPNU'], ['FLUOROCHEM', 'NAVINFLUOR', 'BLUESTARCO', 'VOLTAS', 'WHIRLPOOL', 'SUBROS', 'PGEL', 'AVL', 'EPACK', 'EMIL']],
  2025: [['SRF', 'HAVELLS', 'KIRLPNU', 'BLUESTARCO'], ['FLUOROCHEM', 'NAVINFLUOR', 'VOLTAS', 'WHIRLPOOL', 'SUBROS', 'AVL', 'KRN', 'KSHINTL', 'PGEL', 'EPACK', 'PRECWIRE', 'TRITONV']],
};
const SMALL = new Set(['CUBEXTUB', 'TRITONV', 'ICEMAKE', 'MIRCELECTR', 'HIRECT', 'RAMRAT', 'AVL', 'EMIL', 'KSHINTL', 'SUZLON', 'INOXWIND']);
const NONCRIT = DEFAULT_RULES.filter(r => !r.critical).map(r => r.id);

function pick(arr, n, r) {
  const a = [...arr]; const out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(r() * a.length), 1)[0]);
  return out;
}
function eligible(stock, year) {
  if (stock.from > year) return false;
  if (stock.delisted && year >= stock.delisted) return false;
  return true;
}
function profileFor(cls, sym, r) {
  if (cls === 'pass') return { red: [], amber: pick(NONCRIT, Math.floor(r() * 4), r) };
  if (cls === 'lowac') return { red: [], amber: pick(NONCRIT, Math.floor(r() * 2), r) };
  if (cls === 'watch') {
    const reds = pick(NONCRIT, 1 + Math.floor(r() * 2), r);
    const target = 4 + Math.floor(r() * 4);
    const left = Math.max(0, target - reds.length * 2);
    return { red: reds, amber: pick(NONCRIT.filter(x => !reds.includes(x)), left, r) };
  }
  if (sym === 'FEDDERS') return { red: ['de', 'loss', 'icr'], amber: ['vol'] };
  if (SMALL.has(sym)) return { red: ['adtv', 'dd'], amber: pick(['vol', 'beta', 'margin'], 1, r) };
  return { red: [r() < 0.5 ? 'de' : 'icr'], amber: pick(NONCRIT, 2, r) };
}
function fitMean(values, fixed, target, nifty, beatFlags) {
  const n = values.length;
  for (let pass = 0; pass < 4; pass++) {
    const D = target * n - values.reduce((a, b) => a + b, 0);
    if (Math.abs(D) < 0.01) break;
    const free = values.map((_, i) => i).filter(i => !fixed[i]);
    const order = D > 0 ? [free.filter(i => beatFlags[i]), free.filter(i => !beatFlags[i])] : [free.filter(i => !beatFlags[i]), free.filter(i => beatFlags[i])];
    let rem = D;
    for (const group of order) {
      if (!group.length || Math.abs(rem) < 0.01) continue;
      const per = rem / group.length;
      for (const i of group) {
        let v = values[i] + per;
        if (beatFlags[i]) v = Math.max(v, nifty + 1); else v = Math.min(Math.max(v, -95), nifty - 1);
        rem -= v - values[i]; values[i] = v;
      }
    }
  }
  return values.map(v => Math.round(v * 10) / 10);
}
const themesOf = st => ({ ...st.themes, ...(EXTRA_THEMES[st.symbol] || {}) });
const alsoIn = (st, main) => Object.keys(themesOf(st)).filter(t => t !== main);

export function buildHistory() {
  const hist = {};
  for (const y of YEARS) {
    const r = rng('hist' + y);
    const [P, W] = KEPT[y];
    const rows = [];
    // AC: exact to the research doc.
    for (const st of STOCKS.filter(s => s.themes.ac != null)) {
      if (!eligible(st, y)) continue;
      const cls = st.themes.ac < 20 ? 'lowac' : P.includes(st.symbol) ? 'pass' : W.includes(st.symbol) ? 'watch' : 'removed';
      const histYears = (st.symbol === 'KRN' || st.symbol === 'KSHINTL') ? 1 : 10;
      rows.push({ symbol: st.symbol, theme: 'ac', alsoIn: alsoIn(st, 'ac'), cls, metrics: genMetrics(profileFor(cls, st.symbol, r), r), themes: themesOf(st), historyYears: histYears, next12: 0 });
    }
    const nifty = NIFTY_TRI[y];
    const ac = rows;
    const kept = ac.filter(x => x.cls === 'pass' || x.cls === 'watch');
    const kv = kept.map(() => KEPT_AVG[y] + (r() - 0.5) * 50);
    const shift = KEPT_AVG[y] - kv.reduce((a, b) => a + b, 0) / kv.length;
    kept.forEach((x, i) => { x.next12 = Math.round(Math.max(-85, kv[i] + shift) * 10) / 10; });
    const rem = ac.filter(x => x.cls === 'removed');
    const named = NAMED[y] || {};
    const beatTarget = Math.min(REMOVED_BEAT[y], rem.length);
    let beatCount = rem.filter(x => named[x.symbol] !== undefined && named[x.symbol] > nifty).length;
    const vals = [], fixed = [], beat = [];
    for (const x of rem) {
      if (named[x.symbol] !== undefined) { vals.push(named[x.symbol]); fixed.push(true); beat.push(named[x.symbol] > nifty); continue; }
      const b = beatCount < beatTarget; if (b) beatCount++;
      vals.push(b ? nifty + 3 + r() * 60 : Math.max(-90, nifty - 4 - r() * 35)); fixed.push(false); beat.push(b);
    }
    const fitted = fitMean(vals, fixed, REMOVED_AVG[y], nifty, beat);
    rem.forEach((x, i) => { x.next12 = fitted[i]; });
    for (const x of ac.filter(x => x.cls === 'lowac')) x.next12 = Math.round((nifty + (r() - 0.5) * 30) * 10) / 10;
    // Energy: generated, seeded.
    const re = rng('energy' + y);
    for (const st of STOCKS.filter(s => s.themes.energy != null)) {
      if (!eligible(st, y)) continue;
      const u = re();
      const cls = u < 0.42 ? 'pass' : u < 0.72 ? 'watch' : 'removed';
      const bias = cls === 'pass' ? 7 : cls === 'watch' ? 3 : -5;
      const spread = cls === 'removed' ? 70 : 40;
      let ret = nifty + bias + (re() - 0.5) * spread;
      if (cls === 'removed' && re() < 0.12) ret += 80 + re() * 120; // the odd risky winner
      rows.push({ symbol: st.symbol, theme: 'energy', alsoIn: alsoIn(st, 'energy'), cls, metrics: genMetrics(profileFor(cls, st.symbol, re), re), themes: themesOf(st), historyYears: 10, next12: Math.round(Math.max(-90, ret) * 10) / 10 });
    }
    // The real June-to-June return replaces the shaped one wherever NSE data has both Junes.
    for (const x of rows) { const real = realNext12(x.symbol, y); if (real != null) { x.next12 = real; x.real = true; } }
    // The wider universe: a seeded June snapshot of the rule metrics, and the real return of the next 12 months.
    for (const st of NEW_STOCKS) {
      const next12 = realNext12(st.symbol, y);
      if (st.from > y || next12 == null) continue;
      const rr = rng('hist' + y + st.symbol);
      const u = rr();
      const cls = u < 0.5 ? 'pass' : u < 0.8 ? 'watch' : 'removed';
      const metrics = genMetrics(profileFor(cls, st.symbol, rr), rr);
      const main = STAGE_THEME[st.stage] && st.themes[STAGE_THEME[st.stage]] != null ? STAGE_THEME[st.stage] : Object.keys(st.themes)[0];
      const listedYears = Math.round(Math.min(10, (Date.parse(REAL_DATES.junes[JUNES.indexOf(y)]) - Date.parse(REAL_FIRST[st.symbol] || '2018-01-01')) / 31557600000) * 10) / 10;
      rows.push({ symbol: st.symbol, theme: main, alsoIn: Object.keys(st.themes).filter(t => t !== main), cls, metrics, na: st.lender ? LENDER_NA : undefined, themes: st.themes, historyYears: Math.max(listedYears, 0.1), next12, real: true });
    }
    hist[y] = rows;
  }
  return { years: YEARS, rows: hist, nifty: NIFTY_TRI };
}

const STAGE_THEME = Object.fromEntries(STAGES.map(x => [x.id, x.theme]));
// Banks and other lenders: debt/equity, interest cover and profit-to-cash don't mean the same for them, so those rules don't apply.
export const LENDER_NA = ['de', 'icr', 'cash'];

function monthLabel(y, m) { const t = y * 12 + 5 + m; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; }

export function buildPriceHistory(history) {
  const out = {};
  const series = (seedPrice, getRet, r) => {
    const pts = [{ t: '2026-08', p: seedPrice }, { t: '2026-07', p: seedPrice * 0.98 }];
    let p = seedPrice * 0.97;
    pts.push({ t: '2026-06', p });
    for (let y = 2025; y >= 2018; y--) {
      const ret = getRet(y);
      if (ret === null) break;
      const end = p, start = end / Math.max(0.01, 1 + ret / 100);
      for (let m = 11; m >= 0; m--) {
        const base = start * Math.pow(end / start, m / 12);
        pts.push({ t: monthLabel(y, m), p: Math.round(base * (1 + (r() - 0.5) * 0.06) * 100) / 100 });
      }
      p = start;
    }
    return pts.reverse();
  };
  // Real monthly closes (last 36 months, then the latest day) when NSE data matches today's price; else a seeded series.
  const label = (d, i, n) => (i === n - 1 ? d : d.slice(0, 7));
  const real = (seedPrice, m) => {
    if (!m || !m.at(-1) || Math.abs(m.at(-1) / seedPrice - 1) > 0.05) return null;
    const n = m.length;
    return m.map((p, i) => (p ? { t: label(REAL_DATES.months[i], i, n), p } : null)).filter(Boolean);
  };
  for (const st of ALL_STOCKS) {
    if (st.delisted) continue;
    const pts = real(st.price, PX[st.symbol]?.m);
    if (pts) { out[st.symbol] = pts; continue; }
    const r = rng('px' + st.symbol);
    out[st.symbol] = series(st.price, y => { const row = history.rows[y].find(x => x.symbol === st.symbol); return row ? row.next12 : null; }, r);
  }
  out.NIFTY = REAL_NIFTY.months.map((p, i, a) => ({ t: label(REAL_DATES.months[i], i, a.length), p }));
  return out;
}

// Mock quarterly filings that arrive while the demo clock runs.
export const FILINGS = [
  { date: '2026-10-14', symbol: 'PRECWIRE', changes: { de: 2.1, icr: 2.2 }, note: 'Q2 filing: borrowings up to ₹1,475 cr' },
  { date: '2026-10-22', symbol: 'SUBROS', changes: { roe: 11.5 }, note: 'Q2 filing: ROE improves' },
  { date: '2026-10-28', symbol: 'TATAPOWER', changes: { de: 0.95 }, note: 'Q2 filing: debt reduced' },
  { date: '2026-11-05', symbol: 'VOLTAS', changes: { cash: 0.62 }, note: 'Q2 filing: cash conversion improves' },
];

function lossAgoFor(st, lossMetric) {
  if (st.lossAgo) return st.lossAgo;
  return Array.from({ length: lossMetric }, (_, i) => i); // most recent years first
}

// Mock values for a new stock where no real number was found: shaped by sector and kind of company.
const PSU = new Set('SBIN BANKBARODA BANKINDIA MAHABANK CANBK CENTRALBK INDIANB IOB PNB UCOBANK UNIONBANK IDBI LICI GICRE NIACL PFC RECLTD IRFC IREDA HUDCO IFCI BEL HAL BDL BEML MIDHANI COCHINSHIP GRSE MAZDOCK RVNL IRCON RITES IRCTC RAILTEL CONCOR NBCC ENGINERSIN BHEL NMDC NSLNISP SAIL NATIONALUM HINDCOPPER MOIL GMDCLTD GAIL CHENNPETRO MRPL NTPCGREEN SJVN NHPC NLCINDIA COALINDIA BHARATCOAL CMPDI SCI MMTC ITI HFCL FACT GNFC KIOCL HINDZINC'.split(' '));
function mockFor(st, id, r) {
  const u = r();
  if (id === 'pledge') { // most owners pledge nothing; a few pledge a lot
    if (PSU.has(st.symbol) || u < 0.82) return 0;
    if (u < 0.93) return Math.round(r() * 1000) / 100;
    if (u < 0.97) return Math.round((10 + r() * 15) * 100) / 100;
    return Math.round((25 + r() * 30) * 100) / 100;
  }
  if (id === 'loss') return u < 0.9 ? 0 : 1;
  let pGreen = 0.8, pRed = 0.04;
  if (st.sector === 'IT' && (id === 'de' || id === 'roe' || id === 'icr')) { pGreen = 0.9; pRed = 0.02; }
  if (PSU.has(st.symbol) && (id === 'pe' || id === 'peg')) { pGreen = 0.85; pRed = 0.03; }
  if ((st.real?.adtv ?? 100) < 10 && (id === 'margin' || id === 'cash')) { pGreen = 0.5; pRed = 0.15; }
  const band = u < pGreen ? 'green' : u < 1 - pRed ? 'amber' : 'red';
  return sampleValue(DEFAULT_RULES.find(x => x.id === id), band, r);
}
const METRIC_IDS = DEFAULT_RULES.map(x => x.id);

export function buildUniverse() {
  const u = {};
  for (const st of STOCKS) {
    if (st.delisted) continue;
    const r = rng('today' + st.symbol);
    const metrics = genMetrics({ red: st.red, amber: st.amber }, r);
    if (st.lossAgo) metrics.loss = st.lossAgo.filter(a => a < 5).length;
    let mock = [...METRIC_IDS], lossAgo = lossAgoFor(st, metrics.loss);
    // Energy names: real numbers replace the generated ones wherever they exist. AC names keep the values
    // shaped after the user's research doc (their story and the past test depend on them), all marked mock.
    const real = ORIG_REAL[st.symbol];
    if (real && st.themes.energy != null) {
      Object.assign(metrics, real[0]);
      mock = mock.filter(id => real[0][id] == null);
      if (real[1]) lossAgo = real[1];
    }
    u[st.symbol] = {
      symbol: st.symbol, name: st.name, sector: st.sector, stage: st.stage, themes: themesOf(st),
      historyYears: st.historyYears, metrics, lossAgo, events: {}, source: 'default', mock,
    };
  }
  // Demo story: the 14 Oct results push Precision Wires' debt up. It starts from its real debt/equity.
  // Demo story: debt is 0.82× before the October filing (sample number, so it stays marked as sample).
  u.PRECWIRE.metrics.de = 0.82;
  for (const st of NEW_STOCKS) {
    const r = rng('today' + st.symbol);
    const metrics = {}; const mock = [];
    const na = st.lender ? LENDER_NA : [];
    for (const id of METRIC_IDS) {
      const v = mockFor(st, id, r); // always drawn, so the seeded sequence doesn't depend on which values are real
      if (na.includes(id)) { metrics[id] = null; continue; }
      if (st.real[id] != null) metrics[id] = st.real[id];
      else { metrics[id] = v; mock.push(id); }
    }
    const lossAgo = st.lossAgo || Array.from({ length: metrics.loss || 0 }, (_, i) => i);
    u[st.symbol] = {
      symbol: st.symbol, name: st.name, sector: st.sector, stage: st.stage, themes: { ...st.themes },
      historyYears: st.historyYears, metrics, lossAgo, events: {}, source: 'default', mock, ...(na.length ? { na } : {}),
    };
  }
  return u;
}

export const SEED_PRICES = Object.fromEntries(ALL_STOCKS.filter(s => !s.delisted).map(s => [s.symbol, s.price]));
export const SEED_PREV = Object.fromEntries(ALL_STOCKS.filter(s => !s.delisted).map(s => [s.symbol, s.prev]));
export const BASE_SYMBOLS = Object.keys(SEED_PRICES);
