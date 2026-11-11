// About page stories: each card expands into a tiny "how it looks" example built from the
// app's real UI pieces (alert row, order row, status pill, rule row). Static, illustrative only:
// no engine calls, no state changes. Numbers are examples; limits are the default rule limits.
import { html } from './vendor/preact-htm.js';
import { go } from './store.js';
import { Pill, Src, Avatar, Chg, I } from './lib.js';
import { Info } from './glossary.js';

// ---- small static look-alikes of real rows ----
const Ord = ({ side, name, sub, src }) => html`<div class="li"><span class="side ${side}">${side.toUpperCase()}</span><span class="grow"><span class="t">${name}</span><span class="s">${sub}</span></span><${Src} s=${src}/></div>`;
const Al = ({ ic = '', sym, text, sub, btn }) => html`<div class="alert"><span class="ic ${ic}" aria-hidden="true">${sym}</span><div style="flex:1;min-width:0"><div class="t" style="font-weight:700">${text}</div>${sub && html`<div class="faint" style="font-size:12px;margin-top:2px">${sub}</div>`}</div>${btn && html`<span class="btn small" aria-hidden="true">${btn}</span>`}</div>`;
const Num = ({ band, label, k, star, limit, was, now, bad }) => html`<div class="li"><span class="dot ${band}" aria-label=${band}></span><span class="grow"><span class="t">${label}${star ? html` <span class="star" title="Must-pass rule">★</span>` : ''} <${Info} k=${k}/></span><span class="s num">${limit}</span></span><span class="num" style="white-space:nowrap">${was && html`<span class="faint">${was} → </span>`}<b class=${bad ? 'down' : 'up'}>${now}</b></span></div>`;
const Fake = ({ primary, children }) => html`<span class="btn small ${primary ? 'primary' : 'ghost'}" aria-hidden="true">${children}</span>`;
const Step = ({ n, cap, children }) => html`<li><div class="cap"><span class="n" aria-hidden="true">${n}</span><span>${cap}</span></div>${children && html`<div class="ex">${children}</div>`}</li>`;

// ---- the stories ----
const browse = () => html`
  <${Step} n="1" cap="Every stock shows its status">
    <div class="li"><${Avatar} name="NTPC" stage="power"/><span class="grow"><span class="t">NTPC</span><span class="s num">₹328.75 · <${Chg} v=${0.8}/></span></span><${Pill} s="pass"/></div></${Step}>
  <${Step} n="2" cap="Tap it to see why">
    <${Num} band="green" label="Return on equity" k="roe" limit="good ≥ 15%" was="" now="18.9%"/>
    <${Num} band="amber" label="Debt vs equity" k="de" star limit="good ≤ 0.5× · bad > 1.0×" was="" now="0.65×" bad/></${Step}>`;

const build = () => html`
  <${Step} n="1" cap="Pick 6 or more stocks, or ask Claude">
    <div class="li"><div class="stack-logos">${[['NTPC', 'power'], ['Reliance Industries', 'oilgas'], ['Coal India', 'coal'], ['Power Grid', 'power']].map(([n, s]) => html`<${Avatar} key=${n} name=${n} stage=${s}/>`)}<span class="avatar more">+2</span></div><span class="grow"><span class="t">Energy six</span><span class="s">6 stocks</span></span><${Src} s="claude"/></div></${Step}>
  <${Step} n="2" cap="Your rules score each one">
    <div class="li" style="gap:6px"><${Pill} s="pass" n=${5}/><${Pill} s="watch" n=${1}/><span class="grow"></span><${Info} k="status"/></div></${Step}>
  <${Step} n="3" cap="Invest practice money">
    <${Ord} side="buy" name="NTPC" sub="50 sh · Invest ₹1,00,000 · 17% of basket" src="you"/></${Step}>`;

const watch = () => html`
  <${Step} n="1" cap="One bad day is only a heads-up">
    <${Al} sym="1" text="Hind Rectifiers · Daily trading dipped below the limit" sub="₹4.6 cr → ₹1.7 cr a day · limit ₹2 cr"/></${Step}>
  <${Step} n="2" cap="Back in range at the next check: stays Buy">
    <div class="li"><span class="dot green" aria-label="green"></span><span class="grow"><span class="t">Daily trading <span class="star" title="Must-pass rule">★</span> <${Info} k="adtv"/></span><span class="s num">₹1.7 cr → ₹5.1 cr</span></span><${Pill} s="pass"/></div></${Step}>
  <${Step} n="3" cap="Below again: Sell, and a sell is prepared">
    <${Al} ic="crit" sym="✕" text="Hind Rectifiers → ✕ Sell · sell order ready to review" btn="Review"/></${Step}>`;

const results = () => html`
  <${Step} n="1" cap="New numbers arrive: one up, one past the limit">
    <${Num} band="green" label="Return on equity" k="roe" limit="good ≥ 15%" was="21%" now="▲ 23%"/>
    <${Num} band="red" label="Debt vs equity" k="de" star limit="bad > 1.0×" was="0.8×" now="▲ 2.1×" bad/></${Step}>
  <${Step} n="2" cap="It breaks a must-pass rule, so a sell is prepared">
    <div class="li" style="gap:6px"><span class="grow"><span class="t">Precision Wires</span></span><${Pill} s="pass"/><span class="faint" aria-hidden="true">→</span><${Pill} s="remove"/></div>
    <${Ord} side="sell" name="Precision Wires" sub="23 sh · Rules: Fails a must-pass rule: Debt vs equity" src="rules"/></${Step}>
  <${Step} n="3" cap="You decide. A replacement is suggested.">
    <div class="li" style="gap:8px"><${Fake} primary>Confirm</${Fake}><${Fake}>Keep anyway</${Fake}><${Info} k="keepanyway"/></div>
    <${Ord} side="buy" name="Blue Star" sub="6 sh · Replacement: Buy · 2 warnings" src="rules"/></${Step}>`;

const confirm = () => html`
  <${Step} n="1" cap="A prepared order waits for you">
    <${Ord} side="buy" name="Voltas" sub="4 sh · pending · 12 Nov" src="claude"/>
    <div class="li" style="gap:8px"><${Fake} primary>Confirm</${Fake}><${Fake}>Cancel</${Fake}></div></${Step}>
  <${Step} n="2" cap="Confirmed: filled at the last closing price">
    <${Ord} side="buy" name="Voltas" sub="4 sh · filled ₹1,091.19 · 12 Nov" src="claude"/></${Step}>`;

const flag = () => html`
  <${Step} n="1" cap="Reliance announces a merger. You or Claude flag it.">
    <div class="li"><span class="grow"><span class="t">⚑ Debt vs equity <span class="star" title="Must-pass rule">★</span> likely worse</span><span class="s">Merger may add debt · 12 Nov</span></span><${Src} s="claude"/></div></${Step}>
  <${Step} n="2" cap="Must-pass rule and you hold it: a sell waits">
    <${Ord} side="sell" name="Reliance Industries" sub="12 sh · Based on news, not yet in results" src="claude"/></${Step}>
  <${Step} n="3" cap="The next quarterly results decide">
    <div class="li"><span class="dot red" aria-label="red"></span><span class="grow"><span class="t">Confirmed · sell stays</span><span class="s num">0.3× → 1.2× · limit 1.0×</span></span><${Pill} s="remove"/></div>
    <div class="li"><span class="dot green" aria-label="green"></span><span class="grow"><span class="t">Not confirmed · sell cancelled</span><span class="s num">0.3× → 0.3× · no change</span></span><${Pill} s="pass"/></div></${Step}>`;

const exit = () => html`
  <${Step} n="1" cap="Exit basket prepares a sell for every stock">
    <${Ord} side="sell" name="NTPC" sub="50 sh · Exit Energy six: sell all" src="you"/>
    <${Ord} side="sell" name="Coal India" sub="38 sh · Exit Energy six: sell all" src="you"/></${Step}>
  <${Step} n="2" cap="Confirm, and the money is back as cash">
    <div class="li"><span class="grow"><span class="t">Practice cash</span><span class="s">Basket and rules stay</span></span><b class="num">₹1,02,340</b></div></${Step}>`;

const past = () => html`
  <${Step} n="1" cap="Your rules, replayed every June since 2018">
    <div class="li"><span class="grow"><span class="t">Good exit calls <${Info} k="goodexits"/></span><span class="s">dropped stocks that then lagged</span></span><b class="num">36 <span class="muted" style="font-weight:600">of 86</span></b></div></${Step}>
  <${Step} n="2" cap="Each call is checked a year later">
    <div class="li"><span class="mono faint">2024</span><span class="grow"><span class="t">Cubex Tubings · Dropped</span><span class="s">Fails a must-pass rule: Daily trading</span></span><${Chg} v=${-24} d=${0}/><span class="ok" aria-label="Right">✓</span></div>
    <div class="li"><span class="mono faint">2025</span><span class="grow"><span class="t">Blue Star · Kept</span><span class="s">Buy · 2 warnings</span></span><${Chg} v=${42} d=${0}/><span class="ok" aria-label="Right">✓</span></div></${Step}>`;

const track = () => html`
  <${Step} n="1" cap="Type in the shares you own">
    <div class="li"><${Avatar} name="Tata Power" stage="power"/><span class="grow"><span class="t">Tata Power</span><span class="s num">40 sh · bought at ₹360</span></span><span class="tag">Tracking</span></div></${Step}>
  <${Step} n="2" cap="The rules alert you. You sell in your own broker.">
    <${Al} ic="crit" sym="✕" text="Tata Power → ✕ Sell · consider selling in your broker"/></${Step}>`;

// id, emoji, title, one line, glossary key for the "i", story, [link label, route]
export const STORIES = [
  { id: 'browse', e: '🔍', t: 'Browse and search', d: '55 stocks, each checked by 13 rules.', info: 'warnings', body: browse, link: ['Explore', 'explore'] },
  { id: 'build', e: '🧺', t: 'Build baskets', d: 'By hand, paste symbols, or ask Claude.', info: 'limits', body: build, link: ['Baskets', 'baskets'] },
  { id: 'watch', e: '🛡️', t: 'Rules watch every day', d: 'Each stock is rated Buy, Hold or Sell.', info: 'twice', body: watch, link: ['Alerts', 'alerts'] },
  { id: 'results', e: '📊', t: 'Results come out', d: 'New numbers re-check every stock.', info: 'results', body: results, link: ['Alerts', 'alerts'] },
  { id: 'confirm', e: '✅', t: 'You confirm every order', d: 'Nothing is bought or sold without you.', info: 'practice', body: confirm, link: ['Orders', 'orders'] },
  { id: 'flag', e: '📰', t: 'Flag news', d: 'Mark a number a story may change.', info: 'newsflag', body: flag, link: ['Pick a stock', 'explore'] },
  { id: 'exit', e: '🚪', t: 'Exit anytime', d: 'Sell one stock or the whole basket.', info: 'exit', body: exit, link: ['Baskets', 'baskets'] },
  { id: 'past', e: '📈', t: 'See if your rules work', d: 'A past test of every year since 2018.', info: 'backtest', body: past, link: ['Baskets', 'baskets'] },
  { id: 'track', e: '👛', t: 'Track real shares', d: 'Alerts for shares you hold elsewhere.', info: 'tracking', body: track, link: ['Baskets', 'baskets'] },
];

// One expandable card. `tag` is the user's own condition (plan limit, what is waiting), shown on the card.
export function Story({ s, tag, hot }) {
  return html`<details class="canitem story" name="about-story" data-story=${s.id}>
    <summary><span class="emo" aria-hidden="true">${s.e}</span>
      <div class="sum"><span class="row" style="gap:6px"><b>${s.t}</b>${tag && html`<span class="tag ${hot ? 'claude' : ''}">${tag}</span>`}</span><p>${s.d} <${Info} k=${s.info} label=${s.t}/></p></div>
      <span class="chev" aria-hidden="true">${I.chev}</span></summary>
    <div class="story-body"><ol class="steps">${s.body()}</ol>
      <div class="row between"><span class="mocktag" title="Made-up numbers to show how it looks">Example</span><button class="linkbtn" style="font-size:12.5px" onClick=${() => go(s.link[1])}>${s.link[0]} ›</button></div></div></details>`;
}
