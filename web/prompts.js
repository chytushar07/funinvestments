// The Claude prompt library: what to paste into Claude, picked from what the user has right now.
// Pure data + pickPrompts(S) (testable in node) + the PromptLibrary component.
// Every prompt only asks for things the FunInvestments tools can do. Orders, deletes and plan changes
// are always "prepare… I'll confirm": Claude can't confirm them, the user does that in the app.
import { html, useState } from './vendor/preact-htm.js';

export const CATEGORIES = [
  { id: 'start', label: 'Get started' },
  { id: 'build', label: 'Build a basket' },
  { id: 'check', label: 'Check and explain' },
  { id: 'invest', label: 'Invest and rebalance' },
  { id: 'alerts', label: 'Alerts and notifications' },
  { id: 'news', label: 'News and results' },
  { id: 'rules', label: 'Rules' },
  { id: 'exit', label: 'Exit and clean up' },
  { id: 'track', label: 'Track real shares' },
  { id: 'past', label: 'Past test' },
  { id: 'plan', label: 'Plan and upgrade' },
];

// Words for the themes we know. Any other theme in S.themes gets the generic line.
const THEME_TEXT = {
  ac: 'Build an AC value chain basket in FunInvestments with stocks my rules rate Buy. Keep each value-chain stage under 40%.',
  energy: 'Build a basket of energy companies that were profitable in each of the last 2 years and that my rules rate Buy.',
};
const themeText = label => `Build a ${label} basket in FunInvestments: 6–8 stocks my rules rate Buy, no single stock over 20%.`;

// ---------- State → the facts and names the prompts use ----------
export function promptContext(S, { tools, basketId } = {}) {
  const has = new Set(tools ? tools.map(t => (typeof t === 'string' ? t : t.name)) : []);
  const all = [...(S.baskets || [])];
  const scope = basketId ? all.filter(b => b.id === basketId) : all;
  const models = all.filter(b => b.kind === 'model'), tracking = all.filter(b => b.kind === 'tracking');
  const sModels = scope.filter(b => b.kind === 'model'), sTracking = scope.filter(b => b.kind === 'tracking');
  const pro = S.plan === 'pro';
  const pi = S.planInfo || (pro ? { maxBaskets: Infinity, maxTracking: Infinity, flagsPerMonth: Infinity } : { maxBaskets: 1, maxTracking: 1, flagsPerMonth: 3 });
  const exitedIds = new Set((S.decisions || []).filter(d => d.action === 'exited').map(d => d.basketId));
  const isExited = b => b.kind === 'model' && !b.isInvested && !b.pendingOrders && (exitedIds.has(b.id) || (b.realized || 0) !== 0);
  const alerts = S.alerts || [];
  const pending = (S.orders || []).filter(o => o.status === 'pending' && scope.some(b => b.id === o.basketId));
  const invested = sModels.filter(b => b.isInvested);
  const below = sModels.find(b => b.belowMin && !b.deleteRequest);
  const built = sModels.find(b => !b.belowMin && !b.isInvested && !isExited(b) && !b.deleteRequest && !b.pendingOrders);
  const drifted = invested.find(b => b.needsRebalance);
  const exited = sModels.find(b => isExited(b) && !b.deleteRequest);
  const delReq = scope.find(b => b.deleteRequest);
  const pendingB = pending.length ? scope.find(b => b.id === pending[0].basketId) : null;
  const status = s => s.liveStatus || s.status;
  const mine = [...sModels, ...sTracking].flatMap(b => (b.stocks || []).map(s => ({ s, b })));
  const sell = mine.find(x => status(x.s) === 'remove'), hold = mine.find(x => status(x.s) === 'watch');
  const urgent = alerts.filter(a => a.critical && !a.read && (!basketId || a.basketId === basketId));
  const unread = basketId ? alerts.filter(a => !a.read && a.basketId === basketId).length : S.unread ?? alerts.filter(a => !a.read).length;
  const openFlags = (S.flags || []).filter(f => f.status === 'open' && (!basketId || mine.some(x => x.s.symbol === f.symbol)));
  const uName = sym => (S.universe || []).find(u => u.symbol === sym)?.name || mine.find(x => x.s.symbol === sym)?.s.name || sym;
  const next = S.nextFiling && !S.nextFiling.applied ? S.nextFiling : null;
  const nextMine = !!next && mine.some(x => x.s.symbol === next.symbol && !isExited(x.b));
  const result = alerts.find(a => ['filing', 'flag_confirmed', 'flag_cleared'].includes(a.type) && !a.read && a.symbol && (!basketId || mine.some(x => x.s.symbol === a.symbol)));
  const soft = basketId ? null : (S.todo || []).find(t => !['orders', 'delete'].includes(t.kind));
  const connected = !!S.claudeConnected;
  const usedClaude = connected && (S.activity || []).some(a => a.actor === 'claude' && a.kind !== 'read');
  const main = drifted || invested[0] || below || built || exited || sModels[0] || sTracking[0] || null;
  const stockPool = mine.length ? mine.map(x => x.s.name) : (S.universe || []).slice(0, 2).map(u => u.name);
  const theme = main?.themeLabel || S.themes?.[0]?.label || 'AC value chain';
  const fmtDate = d => { try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }); } catch { return d; } };
  const need = below ? below.limits.minStocks - below.count : 0;
  const v = {
    basket: main?.name || 'my basket', theme,
    stock: sell?.s.name || hold?.s.name || stockPool[0] || 'Precision Wires', stock2: stockPool.find(n => n !== (sell?.s.name || hold?.s.name || stockPool[0])) || 'Blue Star',
    sellStock: sell?.s.name || 'a Sell-rated stock', sellBasket: sell?.b.name || main?.name || 'my basket',
    holdStock: hold?.s.name || 'a Hold-rated stock', holdBasket: hold?.b.name || main?.name || 'my basket',
    below: below?.name || 'my basket', n: need || 'a few', nStocks: need === 1 ? 'stock' : 'stocks', belowTheme: below?.themeLabel ? below.themeLabel + ' ' : '',
    built: built?.name || 'my basket', invested: invested[0]?.name || 'my basket', drift: drifted?.name || invested[0]?.name || 'my basket',
    exited: exited?.name || 'my old basket', pendingBasket: pendingB?.name || 'my basket', pendingN: pending.length,
    delBasket: delReq?.name || 'that basket', alert: urgent[0]?.text || 'my urgent alert', unread: unread || 'my',
    flagStock: openFlags[0]?.name || uName(openFlags[0]?.symbol) || 'that stock', resultStock: result ? uName(result.symbol) : 'that company',
    nextStock: next ? uName(next.symbol) : 'the next company', nextDate: next ? fmtDate(next.date) : 'soon',
    track: sTracking[0]?.name || 'my real shares', trackStock: sTracking[0]?.stocks?.[0]?.name || 'one stock', todo: soft?.text || 'a reminder',
    unused: exited?.name || sModels.find(b => !b.isInvested && !b.pendingOrders)?.name || 'a basket I don\'t use',
  };
  return {
    S, v, names: all.map(b => b.name).sort((a, b) => b.length - a.length), has, hasTools: has.size > 0, basketId: basketId || null, pro, connected, usedClaude, fresh: all.length === 0,
    models: models.length, tracking: tracking.length, sModels: sModels.length, sTracking: sTracking.length,
    below: !!below, built: !!built, invested: invested.length, drifted: !!drifted, exited: !!exited, delReq: !!delReq,
    pending: pending.length, urgent: urgent.length, unread, alerts: alerts.length, openFlags: openFlags.length,
    sell: !!sell, sellHeld: !!(sell && sell.b.isInvested && sell.s.qty > 0), hold: !!hold, next: !!next, nextMine, result: !!result, soft: !!soft,
    canNewBasket: pro || models.length < pi.maxBaskets, canNewTracking: pro || tracking.length < pi.maxTracking,
    canFlag: pro || (S.flagsThisMonth || 0) < pi.flagsPerMonth,
  };
}

// ---------- The library ----------
// score(c): how relevant right now (0 = only in the full list). show(c): false = leave out entirely.
// pro: needs Pro. block(c): a plan limit that would make it fail (shown locked, never picked).
const NEW_BASKET = c => (c.canNewBasket ? null : 'Free has 1 practice basket');
const P = [
  // Get started
  { id: 'start-where', cat: 'start', title: 'Where do I stand?', text: 'Open FunInvestments and tell me where things stand: my baskets, practice money, and anything waiting for me.',
    score: c => (!c.connected ? 60 : c.usedClaude ? 5 : 30) },
  { id: 'start-how', cat: 'start', title: 'How does this work?', text: 'Explain FunInvestments in plain words: baskets, the 13 rules, what Buy, Hold and Sell mean, and what practice money and the demo date are.',
    score: c => (c.fresh ? 50 : 3) },
  { id: 'start-first', cat: 'start', title: 'Build my first basket', text: 'Help me build my first FunInvestments basket. Ask me one question about what I like, then suggest 6–8 stocks my rules rate Buy.',
    show: c => c.models === 0, block: NEW_BASKET, score: c => (c.fresh ? 70 : 20) },
  { id: 'start-pickup', cat: 'start', title: 'Pick up where we stopped', text: 'Pick up where we left off in FunInvestments: what changed since our last chat, and what\'s still on my list?',
    show: c => !c.fresh, score: c => (c.usedClaude ? 35 : 8) },

  // Build a basket (themes are added from S.themes below)
  { id: 'build-lowdebt', cat: 'build', title: 'Low-debt basket', text: 'Find stocks with debt under half their equity that my rules rate Buy, and build a basket called "Low debt" from the best 6–8.', needs: ['create_basket', 'get_universe'],
    block: NEW_BASKET, score: c => (c.fresh ? 30 : 6) },
  { id: 'build-profit', cat: 'build', title: 'Consistent profit', text: 'Build a basket of companies with no loss year in the last 5 years and the fewest warnings on my rules.', needs: ['create_basket', 'get_universe'],
    block: NEW_BASKET, score: c => (c.fresh ? 25 : 5) },
  { id: 'build-own', cat: 'build', title: 'My own theme', text: 'Help me build a basket around my own idea. Ask me the theme first, then pick stocks FunInvestments rates Buy, and add any missing company with its numbers.', needs: ['create_basket'],
    block: NEW_BASKET, score: c => (c.fresh ? 20 : 4) },
  { id: 'build-research', cat: 'build', title: 'Add a stock I researched', text: 'Research {stock2} and add it to FunInvestments with all 13 numbers and its theme share, then tell me its rating.', needs: ['add_candidate'], score: () => 3 },
  { id: 'build-copy', cat: 'build', title: 'Copy a basket to try changes', text: 'Make a copy of {basket} called "{basket} test" so I can try other stocks without touching the original.', needs: ['duplicate_basket'],
    show: c => c.sModels > 0, block: NEW_BASKET, score: () => 4 },

  // Check and explain
  { id: 'check-sell', cat: 'check', title: 'Why did {sellStock} turn Sell?', text: 'Why did {sellStock} turn Sell in {sellBasket}? Which rules failed, and since when?', needs: ['get_basket_status'],
    score: c => (c.sell ? 80 : 0) },
  { id: 'check-hold', cat: 'check', title: 'Why is {holdStock} Hold?', text: 'Why is {holdStock} rated Hold in {holdBasket}? Show its warnings and what would make it Buy again.', needs: ['get_basket_status'],
    score: c => (c.hold ? 45 : 0) },
  { id: 'check-basket', cat: 'check', title: 'Check {basket}', text: 'Check my {basket} basket: any stock close to Sell, any segment over its limit, and how it\'s doing against Nifty 50.', needs: ['get_basket_status'],
    show: c => c.sModels > 0, score: c => (c.invested ? 55 : c.sModels ? 15 : 0) },
  { id: 'check-changed', cat: 'check', title: 'What changed since yesterday?', text: 'What changed in FunInvestments since yesterday? Any rating moves, new alerts or orders waiting for me?', needs: ['get_activity'],
    show: c => !c.fresh, score: c => (c.invested ? (c.usedClaude ? 40 : 25) : 5) },
  { id: 'check-compare', cat: 'check', title: 'Compare two stocks', text: 'Compare {stock} and {stock2} on my rules: warnings, debt, profit years, and which one fits {basket} better.', needs: ['get_universe'], score: () => 6 },
  { id: 'check-buylist', cat: 'check', title: 'What rates Buy today?', text: 'Which {theme} stocks rate Buy on my rules today? Give me the 5 with the fewest warnings.', needs: ['get_universe'],
    score: c => (c.fresh ? 15 : 4) },
  { id: 'check-stock', cat: 'check', title: 'Explain one stock', text: 'Explain {stock} in plain words: what it does, its rating, and the one rule closest to turning it Sell.', any: ['get_stock', 'get_universe'], score: () => 5 },

  // Invest and rebalance
  { id: 'invest-fill', cat: 'invest', title: 'Add {n} more to {below}', text: 'My {below} basket needs {n} more {nStocks}. Find {n} {belowTheme}{nStocks} my rules rate Buy and add them.', needs: ['add_stock', 'get_universe'],
    score: c => (c.below ? 90 : 0), show: c => c.below },
  { id: 'invest-refill', cat: 'invest', title: 'Why is {below} short?', text: 'Show the refill plan for {below}: which stocks could fill it and why the others were skipped.', needs: ['get_refill_plan'],
    show: c => c.below, score: c => (c.below ? 40 : 0) },
  { id: 'invest-first', cat: 'invest', title: 'Invest in {built}', text: 'Prepare buy orders to invest ₹50,000 in {built}, split by target weights. I\'ll confirm them in the app.', needs: ['create_order'],
    score: c => (c.built ? 75 : 0), show: c => c.built },
  { id: 'invest-pending', cat: 'invest', title: 'Explain my waiting orders', text: 'Explain the {pendingN} orders waiting in {pendingBasket}: what each one does and why. I\'ll confirm or cancel them in the app.', any: ['get_activity', 'get_orders'],
    show: c => c.pending > 0, score: c => (c.pending ? 85 : 0) },
  { id: 'invest-cancel', cat: 'invest', title: 'Drop orders I don\'t want', text: 'Cancel the waiting orders in {pendingBasket} that you prepared; I\'ve changed my mind.', needs: ['cancel_order'],
    show: c => c.pending > 0, score: c => (c.pending ? 20 : 0) },
  { id: 'invest-rebalance', cat: 'invest', title: 'Rebalance {drift}?', text: 'Has {drift} drifted from its target weights? If it has, prepare the orders to bring it back and tell me why each one. I\'ll confirm them in the app.', any: ['rebalance_basket', 'create_order'],
    show: c => c.invested > 0, score: c => (c.drifted ? 70 : c.invested ? 8 : 0) },
  { id: 'invest-more', cat: 'invest', title: 'Add money to {invested}', text: 'Prepare orders to add ₹20,000 to {invested}, split by target weights. I\'ll confirm them in the app.', needs: ['create_order'],
    show: c => c.invested > 0, score: c => (c.invested ? 18 : 0) },

  // Alerts and notifications
  { id: 'alerts-urgent', cat: 'alerts', title: 'Explain my urgent alert', text: 'Explain my urgent FunInvestments alert, "{alert}", in plain words. What happens if I do nothing?', any: ['get_alerts', 'get_notifications'],
    show: c => c.urgent > 0, score: c => (c.urgent ? 92 : 0) },
  { id: 'alerts-today', cat: 'alerts', title: 'What needs me today?', text: 'What needs me today in FunInvestments? Urgent things first, one line each.', needs: ['get_activity'],
    show: c => !c.basketId, score: c => (c.urgent || c.pending ? 50 : c.soft ? 30 : c.fresh ? 0 : 10) },
  { id: 'alerts-unread', cat: 'alerts', title: 'Sum up unread notifications', text: 'Sum up my {unread} unread FunInvestments notifications in plain words, newest first.', any: ['get_notifications', 'get_alerts'],
    show: c => c.alerts > 0, score: c => (c.unread > 0 ? 55 : 0) },
  { id: 'alerts-markread', cat: 'alerts', title: 'Mark all as read', text: 'Mark all my FunInvestments notifications as read.', needs: ['mark_notifications_read'],
    show: c => c.alerts > 0, score: c => (c.unread >= 3 ? 30 : 0) },
  { id: 'alerts-clear', cat: 'alerts', title: 'Clear what\'s handled', text: 'Delete the FunInvestments notifications I\'ve already handled. Keep anything still waiting on an order.', any: ['clear_notifications', 'delete_notification'],
    show: c => c.alerts > 0, score: c => (c.alerts > 5 ? 15 : 0) },
  { id: 'alerts-decline', cat: 'alerts', title: 'Hide a reminder for now', text: 'Hide the reminder "{todo}" from my FunInvestments to-do list for now.', needs: ['decline_pending'],
    show: c => c.soft, score: c => (c.soft ? 12 : 0) },

  // News and results
  { id: 'news-flag', cat: 'news', title: 'Flag a news story', text: 'Here\'s a news story about {stock} (pasted below). Flag the FunInvestments number it likely makes worse or better, and tell me what the next results would confirm.', needs: ['add_news_flag'],
    block: c => (c.canFlag ? null : 'Free has 3 news flags a month'), score: c => (c.invested ? 10 : 2) },
  { id: 'news-open', cat: 'news', title: 'My open news flags', text: 'Which of my news flags are still waiting for results, and what will the next results decide?', any: ['get_basket_status', 'get_activity'],
    show: c => c.openFlags > 0, score: c => (c.openFlags ? 60 : 0) },
  { id: 'news-result', cat: 'news', title: 'What did {resultStock}\'s results change?', text: '{resultStock} just posted results. What changed in its numbers, and did its rating move in my baskets?', needs: ['get_alerts'],
    show: c => c.result, score: c => (c.result ? 62 : 0) },
  { id: 'news-next', cat: 'news', title: '{nextStock} reports on {nextDate}', text: '{nextStock} reports results on {nextDate}. Which of my rules could those results change for it?', needs: ['get_basket_status'],
    show: c => c.nextMine, score: c => (c.nextMine ? 42 : 0) },
  { id: 'news-withdraw', cat: 'news', title: 'Withdraw a news flag', text: 'Withdraw my news flag on {flagStock}; the story turned out to be wrong.', any: ['delete_news_flag', 'withdraw_news_flag', 'update_news_flag'],
    show: c => c.openFlags > 0, score: c => (c.openFlags ? 14 : 0) },

  // Rules
  { id: 'rules-explain', cat: 'rules', title: 'Explain my rules', text: 'Explain the 13 rules on {basket} in plain words, and which ones warn most often in it.', needs: ['get_rules'], show: c => c.sModels > 0,
    score: c => (c.sModels ? (c.pro ? 10 : 25) : 3) },
  { id: 'rules-defaults', cat: 'rules', title: 'Explain the 13 default rules', text: 'Explain the 13 FunInvestments default rules in plain words, and which one turns the most stocks Sell.', needs: ['get_rules'],
    show: c => c.sModels === 0, score: c => (c.fresh ? 10 : 2) },
  { id: 'rules-whypro', cat: 'rules', title: 'What would Pro let me change?', text: 'On my Free plan, which rules could I change with Pro, and what would you change for {basket}? Don\'t change anything yet.', needs: ['get_rules'],
    show: c => !c.pro && c.sModels > 0, score: c => (c.sModels ? 22 : 6) },
  { id: 'rules-debt', cat: 'rules', pro: true, title: 'Stricter debt for {basket}', text: 'Make the debt rule stricter for {basket} only: warn above 0.5 debt/equity, red above 1. Then tell me which ratings change.', needs: ['set_rule'],
    score: c => (c.sModels ? 20 : 0) },
  { id: 'rules-cutoffs', cat: 'rules', pro: true, title: 'Change Buy cutoffs everywhere', text: 'Change my rating cutoffs for every basket: Buy below 3 warnings, Sell above 7. List the stocks whose rating changes.', needs: ['set_rating_cutoffs'],
    show: c => !c.basketId, score: c => (c.models ? 12 : 4) },
  { id: 'rules-apply', cat: 'rules', pro: true, title: 'Apply my defaults to all baskets', text: 'Copy my default rules onto every basket, and list what changes in each one.', needs: ['apply_default_rules'],
    show: c => !c.basketId, score: c => (c.models > 1 ? 14 : 2) },
  { id: 'rules-toggle', cat: 'rules', pro: true, title: 'Turn one rule off for {basket}', text: 'Turn off the "Price swings" rule for {basket} only and show which ratings change.', needs: ['toggle_rule'],
    score: c => (c.sModels ? 6 : 0) },
  { id: 'rules-limits', cat: 'rules', pro: true, title: 'Change {basket}\'s limits', text: 'Let {basket} hold up to 12 stocks with no single stock over 15%.', needs: ['set_basket_rule'],
    score: c => (c.sModels ? 5 : 0) },
  { id: 'rules-reset', cat: 'rules', pro: true, title: 'Reset {basket} to my defaults', text: 'Reset the rules of {basket} to my current default rules and tell me what that undoes.', needs: ['reset_rules'],
    show: c => c.sModels > 0, score: () => 3 },

  // Exit and clean up
  { id: 'exit-delreq', cat: 'exit', title: 'Before I delete {delBasket}', text: 'Before I confirm deleting {delBasket}: what would I get back, and what\'s the profit or loss?', needs: ['get_basket_status'],
    show: c => c.delReq, score: c => (c.delReq ? 86 : 0) },
  { id: 'exit-weak', cat: 'exit', title: 'Sell {sellStock}', text: 'Remove {sellStock} from {sellBasket} and prepare the sell. I\'ll confirm it in the app.', needs: ['remove_stock'],
    show: c => c.sell, score: c => (c.sellHeld ? 65 : c.sell ? 20 : 0) },
  { id: 'exit-reinvest', cat: 'exit', title: 'Re-invest in {exited}', text: 'I sold {exited}. Check its stocks again on my rules, and if they still rate Buy, prepare buy orders for ₹50,000. I\'ll confirm them in the app.', needs: ['create_order', 'get_basket_status'],
    show: c => c.exited, score: c => (c.exited ? 66 : 0) },
  { id: 'exit-review', cat: 'exit', title: 'How did {exited} do?', text: 'Review {exited}: what I made or lost, which rules sold what, and whether they were right.', any: ['get_rule_scorecard', 'get_basket_status'],
    show: c => c.exited, score: c => (c.exited ? 58 : 0) },
  { id: 'exit-basket', cat: 'exit', title: 'Exit {invested}', text: 'Prepare sells for everything in {invested}. I\'ll confirm them in the app.', needs: ['exit_basket'],
    show: c => c.invested > 0, score: c => (c.invested ? 4 : 0) },
  { id: 'exit-delete', cat: 'exit', title: 'Delete a basket I don\'t use', text: 'Ask to delete {unused}. I\'ll confirm it in the app.', needs: ['request_delete_basket'],
    show: c => c.sModels > 0 && !c.delReq, score: c => (c.exited ? 30 : 2) },

  // Track real shares
  { id: 'track-check', cat: 'track', title: 'Check {track}', text: 'Check {track}: which of my real shares do my rules rate Sell or Hold, and why?', needs: ['get_basket_status'],
    show: c => c.sTracking > 0, score: c => (c.sTracking ? 68 : 0) },
  { id: 'track-update', cat: 'track', title: 'Update a holding', text: 'I bought more {trackStock}: update {track} to 20 shares at today\'s price.', needs: ['set_holding'],
    show: c => c.sTracking > 0, score: c => (c.sTracking ? 16 : 0) },
  { id: 'track-new', cat: 'track', title: 'Track shares I own', text: 'Track my real shares in FunInvestments (alerts only, no orders). Here they are as SYMBOL, QTY, AVG PRICE:', needs: ['create_basket'],
    show: c => !c.basketId, block: c => (c.canNewTracking ? null : 'Free tracks 1 set of real shares'), score: c => (c.tracking ? 2 : c.fresh ? 12 : 9) },

  // Past test
  { id: 'past-last', cat: 'past', title: 'How did my rules do last year?', text: 'How did the rules on {basket} do in the last past test year? Which stocks would they have sold, and were they right?', needs: ['get_rule_scorecard'],
    show: c => !c.pro && c.sModels > 0, score: c => (c.invested ? 14 : 6) },
  { id: 'past-since', cat: 'past', pro: true, title: 'How did my rules do since 2018?', text: 'How did the rules on {basket} do every June from 2018 to 2025? Which rule caught the most real problems?', needs: ['get_rule_scorecard'],
    show: c => c.sModels > 0, score: c => (c.invested ? 26 : c.sModels ? 12 : 0) },
  { id: 'past-bestrule', cat: 'past', pro: true, title: 'Which rule helps most?', text: 'From the past test of {basket}, which rule sold stocks most correctly, and which one could I switch off?', needs: ['get_rule_scorecard'],
    show: c => c.sModels > 0, score: () => 5 },

  // Plan and upgrade
  { id: 'plan-pro', cat: 'plan', title: 'What do I get with Pro?', text: 'What would Pro add for me in FunInvestments? Give me the price and the link to start it; I\'ll decide in the app.', needs: ['get_upgrade_link'],
    show: c => !c.pro && !c.basketId, score: c => (!c.canNewBasket ? 32 : c.models ? 10 : 2) },
  { id: 'plan-limits', cat: 'plan', title: 'Where am I near a Free limit?', text: 'What can I do on my Free FunInvestments plan, and where am I close to a limit?', needs: ['get_activity'],
    show: c => !c.pro && !c.basketId, score: c => (c.models ? 6 : 1) },
  { id: 'plan-use', cat: 'plan', title: 'Make the most of Pro', text: 'I\'m on Pro. Suggest 3 things in FunInvestments I\'m not using yet, like my own rules, more baskets or the full past test.', needs: ['get_rules'],
    show: c => c.pro && !c.basketId, score: c => (c.models ? 7 : 3) },
];

function themePrompts(S) {
  return (S.themes || []).map(t => ({
    id: 'build-' + t.id, cat: 'build', title: `${t.label} basket`, text: THEME_TEXT[t.id] || themeText(t.label), needs: ['create_basket', 'get_universe'],
    block: NEW_BASKET, score: c => (c.fresh ? (t.id === 'ac' || t.id === 'energy' ? 40 : 18) : 3), theme: t.id,
  }));
}
export function library(S) { const tp = themePrompts(S); return [...P.filter(p => p.cat === 'start'), ...tp, ...P.filter(p => p.cat !== 'start')]; }

export const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
const toolsOk = (p, c) => !c.hasTools || ((p.needs || []).every(t => c.has.has(t)) && (!p.any || p.any.some(t => c.has.has(t))));

// Every prompt that fits this user, filled with their names. locked: a reason the plan blocks it (never copyable).
export function listPrompts(S, opts = {}) {
  const c = promptContext(S, opts);
  return library(S).filter(p => toolsOk(p, c) && (!p.show || p.show(c))).map((p, i) => ({
    id: p.id, cat: p.cat, pro: !!p.pro, order: i, title: fill(p.title, c.v), text: fill(p.text, c.v),
    locked: p.pro && !c.pro ? 'Pro' : (p.block && p.block(c)) || null, score: p.score ? p.score(c) : 0,
    basket: c.names.find(n => fill(p.title + ' ' + p.text, c.v).includes(n)) || null,
  }));
}

// The top prompts for right now: most relevant first, never one the plan blocks, at most 2 per category.
// Not connected to Claude yet: the first card is how to connect (kind 'connect'), then 2 starters.
export function pickPrompts(S, opts = {}) {
  const c = promptContext(S, opts);
  const connectCard = !c.connected && !opts.basketId && !opts.noConnect;
  const max = (opts.max || 3) - (connectCard ? 1 : 0);
  const per = {};
  const out = listPrompts(S, opts).filter(p => !p.locked && p.score > 0).sort((a, b) => b.score - a.score || a.order - b.order)
    .filter(p => ((per[p.cat] = (per[p.cat] || 0) + 1) <= 2)).slice(0, max);
  return connectCard ? [{ id: 'connect', kind: 'connect', cat: 'start', title: 'Connect Claude first', text: 'Add FunInvestments as a connector in Claude once. Then paste any prompt below.' }, ...out] : out;
}

// ---------- Copy ----------
async function copyText(text) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back below */ }
  if (!ok) {
    try {
      const t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove();
    } catch { ok = false; }
  }
  const st = await import('./store.js');
  if (ok) st.toast('Copied · paste it in Claude'); else st.openSheet({ type: 'copy', text });
}
const goTo = async h => (await import('./store.js')).go(h);

// ---------- Component ----------
export const CAT_TAG = { start: 'Start', build: 'Build', check: 'Check', invest: 'Invest', alerts: 'Notifications', news: 'News', rules: 'Rules', exit: 'Exit', track: 'Tracking', past: 'Past test', plan: 'Plan' };
// Tags are labels only (no filtering): category, Pro, and the basket the prompt is about.
function Tags({ p }) {
  return html`<span class="plib-tags">${p.kind !== 'connect' && html`<span class="ptag">${CAT_TAG[p.cat]}${p.pro ? ' · Pro' : ''}</span>`}${p.basket && html`<span class="ptag b">${p.basket}</span>`}</span>`;
}
function Row({ p, onConnect }) {
  if (p.kind === 'connect') return html`<div class="plib-row connect"><div class="grow"><div class="t">${p.title}</div><div class="x">${p.text}</div></div><button class="btn small primary" onClick=${onConnect}>Connect</button></div>`;
  return html`<div class="plib-row ${p.locked ? 'locked' : ''}" data-prompt=${p.id}><div class="grow"><div class="t">${p.title}</div><div class="x">${p.text}</div>
    <div class="plib-meta"><${Tags} p=${p}/>${p.locked && p.locked !== 'Pro' && html`<span class="why">${p.locked}</span>`}</div></div>
    ${p.locked ? html`<button class="linkbtn" onClick=${() => goTo('pricing')}>See plans</button>` : html`<button class="btn small ghost" aria-label=${'Copy prompt: ' + p.title} onClick=${() => copyText(p.text)}>Copy</button>`}</div>`;
}

// A few picks for the current state plus one quiet link to the full page (Home, Settings, basket page).
export function PromptPicks({ S, tools, basketId, max = 3, onConnect, link = true, noConnect }) {
  const picks = pickPrompts(S, { tools, basketId, max, noConnect });
  const connect = onConnect || (() => goTo('account'));
  if (!picks.length && !link) return null;
  return html`<div class="plib">${picks.length > 0 && html`<div class="plib-rows">${picks.map(p => html`<${Row} key=${p.id} p=${p} onConnect=${connect}/>`)}</div>`}
    ${link && html`<button class="linkbtn plib-all" onClick=${() => goTo('prompts')}>See all prompts ›</button>`}</div>`;
}

// The prompt library page (#prompts): "Suggested for you", then every category ordered by relevance,
// a few prompts each with "Show N more". No filters.
const SHOW = 3;
export function PromptsPage({ S, tools, onBack }) {
  const [more, setMore] = useState({});
  const sug = pickPrompts(S, { tools, max: 5 });
  const seen = new Set(sug.map(p => p.id));
  const all = listPrompts(S, { tools }).filter(p => !seen.has(p.id));
  const rank = (a, b) => (!!a.locked - !!b.locked) || b.score - a.score || a.order - b.order;
  const cats = CATEGORIES.map(cat => { const items = all.filter(p => p.cat === cat.id).sort(rank); return { ...cat, items, top: items.length ? Math.max(...items.map(p => (p.locked ? -1 : p.score))) : -2 }; })
    .filter(c => c.items.length).sort((a, b) => b.top - a.top || CATEGORIES.indexOf(CATEGORIES.find(x => x.id === a.id)) - CATEGORIES.indexOf(CATEGORIES.find(x => x.id === b.id)));
  return html`<div class="plib-page">
    <div class="row" style="margin-top:4px">${onBack && html`<button class="iconbtn" onClick=${onBack} aria-label="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>`}<h1>Ask Claude</h1></div>
    <p class="muted" style="font-size:13.5px;margin:6px 2px 0">Copy a prompt and paste it in Claude. Claude prepares; you confirm every order here.</p>
    <section class="section"><h2>Suggested for you</h2><div class="plib-rows">${sug.map(p => html`<${Row} key=${p.id} p=${p} onConnect=${() => goTo('account')}/>`)}</div></section>
    ${cats.map(cat => { const open = more[cat.id]; const shown = open ? cat.items : cat.items.slice(0, SHOW); const rest = cat.items.length - SHOW;
      return html`<section class="section plib-cat" id=${'pc-' + cat.id} key=${cat.id}><h2>${cat.label} <span class="faint">${cat.items.length}</span></h2>
        <div class="plib-rows">${shown.map(p => html`<${Row} key=${p.id} p=${p}/>`)}</div>
        ${rest > 0 && html`<button class="linkbtn plib-show" onClick=${() => setMore({ ...more, [cat.id]: !open })}>${open ? 'Show less' : `Show ${rest} more`}</button>`}</section>`; })}
    ${S.plan !== 'pro' && html`<p class="faint" style="font-size:12.5px;margin:18px 2px 0">Prompts marked Pro change rules or run the full past test. On Free, Claude explains instead. <button class="linkbtn" style="font-size:12.5px" onClick=${() => goTo('pricing')}>See plans</button></p>`}
  </div>`;
}

// One prompt's text for this user (used by other screens' "Copy a prompt for Claude" links).
export function promptText(S, id, opts = {}) { return listPrompts(S, opts).find(p => p.id === id)?.text || null; }
export { copyText as copyPrompt };
