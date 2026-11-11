// Plain-language explanations behind every ⓘ button. Short, no jargon, one example where it helps.
import { html } from './vendor/preact-htm.js';
import { openSheet } from './store.js';

export const GLOSSARY = {
  // ---- statuses & scoring ----
  status: { t: 'Buy, Hold, Sell', b: 'What this basket\'s rules say about a stock. They are your rules, not advice.', list: ['✓ Buy: passes the rules. Fine to buy or keep.', '= Hold: some warning signs. Keep it, but don\'t add more (at most 10% of the basket).', '✕ Sell: breaks a must-pass rule or has too many warnings. The app prepares a sell for you to confirm.'] },
  warnings: { t: 'Warnings', b: 'Each rule shows green, amber or red. Amber adds 1 warning, red adds 2.', list: ['0–3 warnings: Buy', '4–8 warnings: Hold', 'More than 8: Sell'] },
  mustpass: { t: 'Must-pass rule ★', b: 'The 5 most important safety rules. A single red on any of them means Sell, however good the rest looks.', list: ['Daily trading', 'Owner shares pledged', 'Debt vs equity', 'Interest cover', 'Loss-making years'] },
  // ---- the 13 rules ----
  adtv: { t: 'Daily trading', b: 'The average value of shares bought and sold each day. Low trading means it can be hard to sell without moving the price.', ex: '₹10 crore a day or more is comfortable. Under ₹2 crore is risky.' },
  pledge: { t: 'Owner shares pledged', b: 'The share of the owners\' (promoters\') stake they have used as security for loans. If the price falls, lenders can sell these shares, pushing it down further.', ex: 'Under 10% is fine. Over 25% is a red flag.' },
  de: { t: 'Debt vs equity', b: 'How much the company has borrowed compared with the money shareholders have put in. Higher means more risk if business slows.', ex: '0.5 means ₹50 of debt for every ₹100 of shareholders\' money.' },
  icr: { t: 'Interest cover', b: 'How many times the company\'s operating profit could pay its yearly interest bill.', ex: '5× means profit is five times the interest. Under 2.5× is tight.' },
  loss: { t: 'Loss-making years', b: 'How many of the last 5 years ended in a loss.', ex: '0 is best. 2 or more is a red flag.' },
  vol: { t: 'Price swings', b: 'How much the share price moves up and down over a year (volatility). Bigger swings mean a bumpier ride.', ex: 'Under 35% a year is calm. Over 50% is very jumpy.' },
  beta: { t: 'Market sensitivity', b: 'How strongly the stock tends to move when the whole market moves (beta).', ex: '1.0 moves like the market. 1.5 tends to move 50% more.' },
  dd: { t: 'Biggest fall', b: 'The largest drop from a high point to a low point over the last 5 years.', ex: '−45% means it once lost almost half its value before recovering.' },
  cash: { t: 'Profit to cash', b: 'How much of the reported profit actually arrives as cash over 5 years. Profit that never turns into cash can be a warning sign.', ex: '0.8× means ₹80 of cash for every ₹100 of profit.' },
  roe: { t: 'Return on equity', b: 'Yearly profit as a percentage of the shareholders\' money in the company (ROE), averaged over 5 years.', ex: '15% means ₹15 profit a year for every ₹100 of shareholders\' money.' },
  margin: { t: 'Margin swings', b: 'How much the company\'s profit margin has jumped around. Stable margins usually mean a steadier business.', ex: 'Under 3 percentage points is steady.' },
  pe: { t: 'Price vs usual', b: 'Today\'s price-to-earnings ratio (P/E) compared with its own 5-year typical level. Above 1 means more expensive than usual.', ex: '1.3× means it costs 30% more than usual for the same profit.' },
  peg: { t: 'Price vs growth', b: 'The P/E ratio divided by how fast profit is growing (PEG). It checks whether a high price is backed by growth.', ex: 'Under 2 is reasonable. Over 3.5 looks expensive.' },
  // events
  ev_surv: { t: 'Exchange watchlist', b: 'NSE sometimes puts stocks with unusual price moves on a special-watch list (ASM or GSM). Trading gets restricted.' },
  ev_auditor: { t: 'Auditor quit', b: 'The company\'s auditor resigned. This can signal accounting problems.' },
  ev_late: { t: 'Late results', b: 'The company filed its quarterly results late.' },
  ev_rating: { t: 'Credit rating cut', b: 'A rating agency lowered its view of the company\'s ability to repay debt.' },
  // ---- money & basket ----
  democlock: { t: 'Demo date', b: 'This is a practice app, so the date moves only when you move it. Jump ahead to see what your rules do as time passes.', list: ['+1 day: one trading day passes and the daily rule checks run.', '+1 quarter: about three months pass and new quarterly results arrive.'] },
  practice: { t: 'Practice money', b: 'Every account starts with ₹1,00,000 of pretend money. Orders fill at the last closing price, but no real shares are bought.' },
  nifty: { t: 'Nifty 50', b: 'India\'s main stock market index: the 50 largest listed companies. "vs Nifty 50" shows whether you did better or worse than simply owning the whole market.' },
  invested: { t: 'Money put in', b: 'The total you have spent buying the shares now in this basket.' },
  return: { t: 'Return', b: 'How much the basket has gained or lost compared with the money you put in.' },
  vsnifty: { t: 'vs Nifty 50', b: 'Your basket\'s return minus the market\'s return over the same time, in percentage points.', ex: '+3 points means you beat the market by 3%.' },
  offtarget: { t: 'Off target', b: 'As prices move, some stocks grow to a bigger share of the basket than planned. This shows the largest gap, in percentage points.', ex: 'At 5 points or more, the app suggests rebalancing.' },
  rebalance: { t: 'Rebalance', b: 'Buying and selling small amounts to bring every stock back to its planned share of the basket.' },
  segment: { t: 'Segment', b: 'The part of the industry a company works in, like Power or Oil & gas. Limiting each segment stops the basket from depending on one area.' },
  theme: { t: 'Theme share', b: 'How much of a company\'s business comes from the basket\'s theme. A company with only 5% of its sales from air conditioners isn\'t really an AC stock.', ex: 'Default: needs at least 20%.' },
  limits: { t: 'Basket limits', b: 'Rules for the basket as a whole: how many stocks it holds and the most any one stock or segment can take.' },
  replacement: { t: 'Replacement', b: 'When a basket drops below its minimum number of stocks, the app picks the next best stock: Buy-rated stocks first, then Hold-rated ones, and keeps cash if nothing fits.' },
  cooldown: { t: 'Cool-down', b: 'A stock sold by the rules can\'t come back for 90 days. This stops buying and selling the same stock back and forth.' },
  newsflag: { t: 'News flag', b: 'Your note that a news story may change one of the numbers, like a jump in borrowing. If it hits a must-pass rule, the app prepares a sell. The next quarterly results confirm or clear it.' },
  keepanyway: { t: 'Keep anyway', b: 'You chose not to follow a rule. Your reason is saved in the decision journal so you can later see whether overriding helped.' },
  tracking: { t: 'Tracking basket', b: 'Your real shares, typed in by you. The rules check them and send alerts, but the app never places orders. You sell in your own broker.' },
  exit: { t: 'Exit basket', b: 'Sells every share in the basket at the last price and returns the money to your practice cash. The basket, its stocks and rules stay, so you can invest again later.' },
  // ---- Claude ----
  claudestatus: { t: 'Connected or not', b: 'Connected means Claude has reached this app at least once through your link. "Last used" is the last time it did.', list: ['Not connected: finish the steps, then ask Claude one question.', 'Check status looks again right now.', 'If you remove FunInvestments inside Claude, this still shows the last time it was used.'] },
  claudesaved: { t: 'Claude and this app', b: 'Nothing is lost when a chat ends. Baskets, orders and everything Claude did stay saved here.', list: ['Home shows your next step.', 'Activity shows what Claude did.', 'Claude can prepare orders. Only you can confirm them, delete baskets or clear alerts.'] },
  privatespace: { t: 'Your private space', b: 'Nobody else can see your baskets. This browser remembers your space. The link opens it on another device.', list: ['Anyone with the link can open and change your space, so share it with no one.', 'Clearing this browser\'s site data without saving the link starts a new, empty space.'] },
  claudeurl: { t: 'Your connector URL', b: 'This link lets Claude read and prepare things in your FunInvestments. It works like a password, so share it with no one.', list: ['Paste it into "Remote MCP server URL" in Claude.', 'Leave Advanced settings empty.'] },
  // ---- scorecard ----
  backtest: { t: 'Past test', b: 'We applied this basket\'s rules every June from 2018 to 2025 using past numbers, then checked how each stock did over the next 12 months. All data here is mock.' },
  goodexits: { t: 'Good exit calls', b: 'Of all the stocks the rules said to remove, how many then did worse than the Nifty 50 over the next year. Those exits saved you from underperformance.', ex: '28 of 73 means 28 removals were right and 45 stocks did better after being dropped.' },
  keptbeat: { t: 'Kept stocks beat the market', b: 'In how many years the stocks the rules kept (Buy and Hold) did better on average than the Nifty 50 over the next 12 months.' },
  lossavoided: { t: 'Biggest loss avoided', b: 'The worst 12-month fall among the stocks the rules removed. Not holding it is the loss you avoided.' },
  grew: { t: '₹100 grew to', b: 'If you had put ₹100 into the kept stocks each June (equal amounts) and rolled it over every year, compared with ₹100 in the Nifty 50 index including dividends.' },
  rightpct: { t: 'Right %', b: 'The share of stocks removed by this rule that then did worse than the market. Higher means the rule is good at spotting trouble.' },
  typical: { t: 'Typical', b: 'The middle result (median): half the stocks did better, half did worse.' },
  // ---- About page ----
  twice: { t: 'Daily checks', b: 'Prices and trading move every day, so the app does not act on one bad day.', list: ['First time a daily must-pass number breaks its limit: you get a heads-up, nothing else.', 'Still broken at the next check: the stock is rated Sell and a sell is prepared for you.', 'Back in range: the count resets.', 'Free checks other status changes weekly, Pro daily. A must-pass break always alerts at once.'] },
  results: { t: 'Quarterly results', b: 'Companies report new numbers every three months. When they arrive, every rule is checked again with the new numbers.', list: ['A must-pass rule breaks: the stock is rated Sell and a sell is prepared.', 'You confirm the sell, or keep the stock and note your reason.', 'If the basket drops below its minimum, the app suggests the next best stock.', 'Open news flags on that number are confirmed or cleared.'] },
  claude: { t: 'Connect Claude', b: 'Optional. Claude can research stocks, build baskets and prepare orders in your account. Only you can confirm an order.', list: ['Open Claude Connectors and add a custom connector.', 'Paste the name and URL from Settings.', 'Ask Claude: "What\'s pending in FunInvestments?"', 'Nothing is lost when a chat ends. Everything Claude did stays saved here.'] },
  plandemo: { t: 'Free and Pro', b: 'The plan switch is a demo. No payment is taken, and you can switch back anytime.', list: ['Urgent alerts are on every plan, never behind a paywall.', 'Pro is ₹499 a month, ₹1,349 a quarter or ₹4,499 a year, for unlimited baskets.'] },
};

export function Info({ k, label, extra }) {
  const g = GLOSSARY[k];
  if (!g) return null;
  return html`<button type="button" class="info" aria-label=${`What is ${label || g.t}?`} onClick=${e => { e.stopPropagation(); e.preventDefault(); openSheet({ type: 'info', k, extra }); }}>i</button>`;
}

export function InfoSheet({ s }) {
  const g = GLOSSARY[s.k];
  if (!g) return null;
  return html`<div class="stack" style="gap:12px"><h2>${g.t}</h2>
    <p style="margin:0;line-height:1.55">${g.b}</p>
    ${g.list && html`<ul class="info-list">${g.list.map(x => html`<li key=${x}>${x}</li>`)}</ul>`}
    ${g.ex && html`<div class="why" style="margin:0"><span><b>Example.</b> ${g.ex}</span></div>`}
    ${s.extra && html`<div class="why" style="margin:0">${s.extra.map(x => html`<span key=${x}>${x}</span>`)}</div>`}</div>`;
}
