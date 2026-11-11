# FunInvestments by Tushar — Product, Design & Engineering Briefs

Educational tool · Paper trades only · Not investment advice · All metrics are mock data.

---

## Stage 1 — CEO one-pager

**The user.** A DIY investor, 25–40, who already buys on Groww or Zerodha and follows a method
(a theme, a screen, a checklist). Uses Claude for research.

**The painful moment.** Three months after buying, a company's borrowings jump. They hear about it
late, can't remember their own rules, and either panic-sell or freeze. They never learn whether
their rules helped.

**The job.** "Keep me honest to my own rules, and show me whether they work."

**The loop we win on.** Build basket → Rules watch it → Act (confirm or override) → See if rules worked.

**What we will NOT build in v1, and why**
| Not building | Why |
|---|---|
| Real orders / broker link | SEBI algo rules and broker approval; paper fills prove the loop first |
| Ready-made baskets for others | Needs SEBI Research Analyst registration |
| AI inside the app | Users bring Claude; we stay deterministic and cost nothing per thought |
| Charts/technical trading, F&O | Different user, different product |
| Social feed, chat, community | Not the loop |
| Live licensed data | Cost decision after demand is proven; data sits behind one interface |

**Three wow moments in the first 2 minutes**
1. One sentence in Claude (or a pasted ticker list) becomes a scored basket: ✓ Pass / ! Watch / ✕ Remove.
2. Paste a news headline → the app flags Debt/Equity and drafts a sell for you to confirm.
3. The Scorecard shows how your exact rules would have done every June, 2018–2025, on day one.

**One metric per screen**
| Screen | Metric | Type |
|---|---|---|
| Onboarding | First basket created < 2 min | Activation |
| Baskets | Weekly active baskets | Retention |
| Basket › Overview | First paper invest | Activation |
| Basket › Rules | Thresholds edited (upgrade moment) | Conversion |
| Basket › Activity | Journal entries per user | Retention (history) |
| Explore | Candidates added | Activation |
| Alerts | Alert → action within 24 h | Retention |
| Orders | Drafts confirmed or overridden | Retention |
| Scorecard | Scorecard depth unlocks; share cards | Conversion, Sharing |
| Pricing | Free → Pro | Conversion |
| Settings › Claude | Claude connected | Activation, Growth |

---

## Stage 2 — Design brief

**Identity.** Name: FunInvestments. Mark: a rounded shield with a rising spark — "a guardian with a grin".
Palette: deep slate ink with a coral brand accent (fun) and calm neutrals (trust). Status uses its own
hues — sky (Pass), amber (Watch), orchid (Remove) — never the price green/red.
Type: Manrope (UI and big numbers, tabular figures) + JetBrains Mono (tickers, data).

**Patterns from Groww** (patterns only, no brand): dark first, big numbers, rounded cards, bottom nav
(Baskets · Alerts · Orders · Scorecard), top tabs inside a basket (Overview · Stocks · Rules · Activity),
"Needs attention" chip strip, 2-column stock cards, "See more" card, bottom sheets with one big button.

**Patterns from smallcase:** basket card with stacked logos, count, value and change vs Nifty; weight
bar coloured by value-chain stage; Invest ₹ → preview → Confirm; rebalance old vs new weights.

**Less-text rules.** Labels ≤ 3 words, buttons ≤ 2 words, one-line alerts, details behind "Why?",
one primary action per screen, "By Claude" / "By you" tags, "Mock data" on every price and chart.

**Desktop.** Bottom nav becomes a left rail; a right-hand "Claude door" panel shows MCP tool calls.

---

## Stage 3 — Engineering brief

- **One backend, two doors.** `engine/api.js` exposes one `call(op, args, actor)` used by the website
  (actor `you`) and by MCP (actor `claude`). MCP tools are thin wrappers (`server/tools.js`).
- **Engine is plain JS, no AI**, runs in Node and in the browser. Website works standalone
  (browser engine + localStorage) or against the server (`/api`), so Claude changes show live.
- **Data interface** `engine/market.js`: `getQuote`, `getFundamentals`, `getHistory`. Mock provider now.
- **execute(order)** is the only fill path: last close ± 0.1% slippage, capped at 5% of daily traded value.
- **MCP:** stdio server (`server/mcp-stdio.js`) and HTTP JSON-RPC mock endpoint (`POST /mcp`), per-user
  API key header in the prototype.
- **Scheduler:** `advance_day` / `advance_quarter` demo controls run checks; quarterly filings come from a
  mock event queue.
- **Tests:** `node --test` — rules engine, refill ladder, backtest, scorecard maths, parity.

---

## Parity checklist

| Claude (MCP tool) | Website path | Taps | Test |
|---|---|---|---|
| create_basket | Baskets → + New → name → pick stocks | 3 | parity.test.js |
| add_stock | Basket → Stocks → + Add → tap | 3 | parity.test.js |
| get_basket_status | Basket Overview | 1 | parity.test.js |
| get_universe | Explore → filter chips | 1 | parity.test.js |
| add_candidate | Explore → + Add → pick symbol | 3 | parity.test.js |
| set_rule | Rules → tap rule → slider → Save | 3 | parity.test.js |
| toggle_rule | Rules → switch | 1 | parity.test.js |
| set_basket_rule | Rules → Basket limits → steppers | 2 | parity.test.js |
| create_order | Basket → Invest ₹ → amount → Confirm | 3 | parity.test.js |
| get_alerts | Alerts tab | 1 | parity.test.js |
| get_refill_plan | Alert → See refill → Confirm | 3 | parity.test.js |
| add_news_flag | Stock → Flag news → metric + impact | 3 | parity.test.js |
| get_rule_scorecard | Scorecard tab | 1 | parity.test.js |

**By design, only a person can confirm an order.** Claude drafts; the website confirms. This is the one
intentional non-parity and it is a safety rule.

**Where Claude "thinks", the website offers a manual version** (badge: "Faster with Claude"):
research → paste tickers / CSV; news → pick metric + impact; new candidates → symbol search;
theme relevance → enter AC %; "Why?" → template text from numbers.

---

## Feature → metric map

| Feature | Metric |
|---|---|
| Two-door onboarding | Activation: first basket < 2 min |
| Day-one backtest | Activation: scorecard viewed day 1; Conversion: unlocks |
| Paper invest | Activation: first invest |
| Alerts + drafts | Retention: alert → action rate |
| Decision journal / overrides | Retention: history depth (6-month lock-in) |
| Tracking basket (CSV holdings) | Retention: weekly return visits |
| Pro gates (2nd basket, thresholds, depth, daily, 4th flag) | Conversion: upgrade-moment → Pro |
| Share card (rule stats only) | Sharing: cards created → visits |
| Claude connector | Growth: connector installs |

## Analytics event plan

| Event | Props | Metric |
|---|---|---|
| onboarding_path_chosen | path: claude/hand | Activation |
| basket_created | source, n_stocks, ms_since_signup | Activation |
| claude_connected | — | Activation, Growth |
| invest_drafted / order_confirmed | amount, source | Activation |
| alert_raised / alert_actioned | type, hours_to_action | Retention |
| news_flag_added | source, metric | Retention |
| override_recorded | rule | Retention |
| rule_threshold_edited | rule | Conversion |
| upgrade_moment_shown / upgrade_clicked / pro_started | moment | Conversion |
| scorecard_viewed | view, plan | Conversion |
| share_card_created | — | Sharing |
| scheduler_check_run | basket, kind | Health |

Events are stored in `state.events` and printed to the console in the prototype.

---

## Assumptions and self-created rules

1. "Correct": an added/kept stock is correct if it beat Nifty 50 TRI over the next 12 months; a removal is correct if the stock lagged it.
2. Basket defaults: min 6, max 12, 20% per stock, 40% per value-chain stage, 10% per Watch stock, rebalance at 5-point drift.
3. Rules apply to all of a user's baskets in v1 (one rule set per user).
   Hosted on Cloudflare, each visitor gets a private space (signed key, own Durable Object); the original owner key opens the original shared space.
4. Anti-churn: a Pass stock drops to Watch only at 5+ points (buffer); daily metrics (traded value, volatility) need 2 consecutive breaching checks; a removed stock can't be refilled for 90 days.
5. Event rules (Pro): surveillance listing and auditor exit = critical red; late results and rating downgrade = red (2 points).
6. News flags: a "worse" flag on a critical metric drafts a sell marked "Based on news, not yet in results". The next filing confirms (status recomputes) or clears (draft cancelled).
7. Refill ladder: Pass by fewest points → Watch by fewest points (capped 10%) → hold cash + "Ask Claude for candidates". Stage cap checked at every step.
8. Fills: last close ± 0.1%, max 5% of the stock's daily traded value. Corporate actions ignored.
9. Free: 1 basket (≤ 8 stocks) + 1 Tracking basket, default thresholds, weekly checks, critical alerts instant, ₹1,00,000 paper money, 3 news flags/month, 2025 scorecard summary. Pro: everything else.
10. Mock data: 32 NSE AC value-chain symbols (verified on NSE). Prices seeded from closes on 9 Nov 2026; every metric, filing and history value is mock, shaped after the user's research doc (statuses and yearly group averages match it). Demo clock starts 1 Sep 2026, before Precision Wires' September filing.
11. Missing AC share counts as a missing number (3+ missing → Watch).

---

## v2 roadmap

1. **Broker API**: route `execute(order)` to a SEBI-compliant broker API (static IP, strategy ID, per-order confirmation; stay under 10 orders/second).
2. **SEBI**: legal review; Research Analyst registration only if we ever publish baskets; keep shared scorecards factual.
3. **Licensed live data**: prices, volumes, fundamentals, pledges, surveillance lists behind the existing data interface.
4. **OAuth** for the MCP connector; listing in the Claude connector directory.
5. Push/email delivery, payments (Razorpay), multi-device sync, real holdings import from brokers.
