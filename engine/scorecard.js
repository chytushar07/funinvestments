// Day-one backtest + Rule Scorecard. Re-runs the user's CURRENT rules on every June snapshot.
// "Correct" (default, editable later): kept stock beat Nifty 50 TRI over the next 12 months;
// removal was correct if the stock lagged it.
import { scoreStock, band, labelOf } from './rules.js';

const avg = a => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : null);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);

export function backtest(ruleSet, history, names = {}, opts = {}) {
  const { theme = null, minTheme, symbols = null } = opts;
  const keep = row => (theme ? row.theme === theme : symbols ? symbols.has(row.symbol) || row.theme === opts.fallbackTheme : true);
  const years = [];
  const log = [];
  const ruleHits = {};
  let keptGrowth = 100, niftyGrowth = 100;
  for (const y of history.years) {
    const nifty = history.nifty[y];
    const kept = [], removed = [];
    let pass = 0, watch = 0, low = 0;
    for (const row of history.rows[y]) {
      if (!keep(row)) continue;
      const s = scoreStock(row, ruleSet, { theme, minTheme });
      if (s.lowTheme) { low++; continue; }
      const isKept = s.status !== 'remove';
      if (s.status === 'pass') pass++; else if (s.status === 'watch') watch++;
      const correct = isKept ? row.next12 > nifty : row.next12 < nifty;
      (isKept ? kept : removed).push(row.next12);
      const trigger = isKept ? `${s.status === 'pass' ? 'Pass' : 'Watch'} · ${s.points} pts` : s.reasons[0];
      log.push({ year: y, symbol: row.symbol, name: names[row.symbol] || row.symbol, action: isKept ? 'keep' : 'remove', status: s.status, points: s.points, trigger, next12: row.next12, nifty, correct });
      if (!isKept) {
        for (const id of s.reds) {
          (ruleHits[id] ||= []).push({ ret: row.next12, nifty, year: y, symbol: row.symbol });
        }
      }
    }
    const keptAvg = avg(kept), removedAvg = avg(removed);
    if (keptAvg == null && !removed.length) continue;
    if (keptAvg != null) keptGrowth *= 1 + keptAvg / 100;
    niftyGrowth *= 1 + nifty / 100;
    years.push({
      year: y, universe: kept.length + removed.length + low, pass, watch, removed: removed.length, lowTheme: low,
      keptAvg: r1(keptAvg), removedAvg: r1(removedAvg), nifty,
      keptBeat: kept.filter(v => v > nifty).length, kept: kept.length,
      removedRight: removed.filter(v => v < nifty).length,
      better: keptAvg == null ? '—' : removedAvg == null || keptAvg >= removedAvg ? 'kept' : 'removed',
    });
  }
  const byRule = ruleSet.metrics.filter(r => r.enabled).map(r => {
    const hits = ruleHits[r.id] || [];
    const rets = hits.map(h => h.ret);
    const worst = hits.reduce((w, h) => (!w || h.ret < w.ret ? h : w), null);
    const best = hits.reduce((b, h) => (!b || h.ret > b.ret ? h : b), null);
    return {
      id: r.id, label: r.label, critical: r.critical, removed: hits.length,
      worst: r1(worst?.ret), median: r1(median(rets)), best: r1(best?.ret),
      hitRate: hits.length ? Math.round((hits.filter(h => h.ret < h.nifty).length / hits.length) * 100) : null,
      worstAvoided: worst ? { symbol: worst.symbol, name: names[worst.symbol] || worst.symbol, year: worst.year, ret: worst.ret } : null,
      missedBest: best ? { symbol: best.symbol, name: names[best.symbol] || best.symbol, year: best.year, ret: best.ret } : null,
    };
  }).sort((a, b) => b.removed - a.removed);
  const removals = log.filter(l => l.action === 'remove');
  const worst = removals.reduce((w, l) => (!w || l.next12 < w.next12 ? l : w), null);
  return {
    years, byRule, log: log.sort((a, b) => b.year - a.year || a.symbol.localeCompare(b.symbol)),
    summary: {
      fromYear: years[0]?.year, toYear: years.at(-1)?.year,
      removalsRight: removals.filter(l => l.correct).length, removalsTotal: removals.length,
      keptBeatYears: years.filter(y => y.keptAvg != null && y.keptAvg > y.nifty).length, yearsCount: years.length,
      keptRight: log.filter(l => l.action === 'keep' && l.correct).length, keptTotal: log.filter(l => l.action === 'keep').length,
      growth: { kept: Math.round(keptGrowth), nifty: Math.round(niftyGrowth) },
      worstAvoided: worst ? { symbol: worst.symbol, name: worst.name, year: worst.year, ret: worst.next12 } : null,
    },
  };
}

export { band, labelOf };
