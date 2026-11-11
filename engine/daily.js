// Daily numbers (trading value, price swings, market sensitivity, biggest fall, price vs usual, price vs growth)
// move a little every trading day. Deterministic and seeded by date + symbol, so a replay gives the same days.
//
// - Each daily number wobbles up to ±2% around its usual level, but never into another band by itself:
//   most stocks keep their rating day after day.
// - A stock whose daily trading is in the amber band (₹2–10 cr) has a "thin day" now and then (about 1 in 30),
//   when trading drops to 35–45% of usual. That can take it below the ₹2 cr must-pass limit for a day:
//   the first such day is only a heads-up; a second bad check within STRIKE_WINDOW trading days makes it Sell.
//   Thin days come in spells (THIN_SPELL_CHANCE right after one), so "below, back, below again" does happen.
// - When something else changes a number (new results, a researched candidate, a test), that value becomes
//   the new usual level.
import { DEFAULT_RULES, band } from './rules.js';
import { rng } from './data.js';

export const DAILY_IDS = DEFAULT_RULES.filter(r => r.cadence === 'daily').map(r => r.id);
const RULE = Object.fromEntries(DEFAULT_RULES.map(r => [r.id, r]));
// Two bad checks within this many trading days (two weeks) make a daily-number break count. Back in range
// in between does not reset it: "below, back, below again" within two weeks is two strikes.
export const STRIKE_WINDOW = 10;
export const THIN_DAY_CHANCE = 1 / 30;
// Thin trading comes in short spells: within STRIKE_WINDOW trading days of the first thin day, another one is
// more likely. The spell does not extend itself, so it ends after STRIKE_WINDOW days.
export const THIN_SPELL_CHANCE = 1 / 6;

// The "Rules watch every day" story uses Kirloskar Pneumatic: a Buy stock that trades about ₹4.6 cr a day,
// so a thin day (₹1.7 cr) dips below the ₹2 cr must-pass limit.
export const STORY_PINS = { KIRLPNU: { adtv: 4.6 } };
export function pinStoryData(universe) {
  for (const [sym, m] of Object.entries(STORY_PINS)) if (universe[sym]) Object.assign(universe[sym].metrics, m);
  return universe;
}

const round = v => Math.round(v * 100) / 100;

export function stepDailyMetrics(st, date) {
  for (const u of Object.values(st.universe)) {
    const d = (u.daily ||= { base: {}, last: {} });
    for (const id of DAILY_IDS) {
      const v = u.metrics?.[id];
      if (v == null || Number.isNaN(v)) { delete d.base[id]; delete d.last[id]; continue; }
      if (d.base[id] == null || d.last[id] !== v) d.base[id] = v; // changed elsewhere: that is the new usual level
      const base = d.base[id], rule = RULE[id];
      const r = rng(`daily|${date}|${u.symbol}|${id}`);
      let nv = round(base * (1 + (r() - 0.5) * 0.04));
      if (band(rule, nv) !== band(rule, base)) nv = base;
      const spell = d.thinDay != null && st.tradingDay - d.thinDay <= STRIKE_WINDOW;
      if (id === 'adtv' && band(rule, base) === 'amber' && rng(`thin|${date}|${u.symbol}`)() < (spell ? THIN_SPELL_CHANCE : THIN_DAY_CHANCE)) { nv = round(base * (0.35 + r() * 0.1)); if (!spell) d.thinDay = st.tradingDay; }
      u.metrics[id] = nv; d.last[id] = nv;
    }
  }
}

// The usual level of a daily number (before today's wobble or thin day), for alerts: "₹4.6 cr → ₹1.7 cr".
export const usualOf = (u, id) => u?.daily?.base?.[id] ?? u?.metrics?.[id];
