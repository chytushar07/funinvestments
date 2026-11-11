// MCP tool definitions. Each tool is a thin wrapper over the SAME engine op the website uses.
const sym = { type: 'string', description: 'NSE symbol, e.g. PRECWIRE' };
const basketId = { type: 'string', description: 'Basket id from get_basket_status (optional when the user has one basket)' };
const METRICS = ['adtv', 'pledge', 'de', 'icr', 'loss', 'vol', 'beta', 'dd', 'cash', 'roe', 'margin', 'pe', 'peg'];
const EVENTS = ['ev_surv', 'ev_auditor', 'ev_late', 'ev_rating'];
const THEMES = ['ac', 'energy'];
const STAGES = ['raw', 'parts', 'brands', 'commercial', 'retail', 'oilgas', 'power', 'renew', 'coal'];
const ruleOverride = { type: 'object', properties: { green: { type: 'number' }, red: { type: 'number' }, enabled: { type: 'boolean' }, critical: { type: 'boolean' } } };

export const TOOLS = [
  { name: 'get_activity', group: 'Stocks', description: 'Start here in every new chat. Returns what happened recently in FunInvestments (with times): what Claude did, and what the user did in the website (actor \'you\'), plus the user\'s to-do list: orders waiting for confirmation, urgent alerts, baskets that need stocks, news flags waiting for results. Use it to pick up where the last chat stopped.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'How many recent actions, default 30' } } } },
  { name: 'get_universe', group: 'Stocks', description: 'Search the stocks FunInvestments covers, scored by the default rules. Filter by text, sector (e.g. "Energy"), theme (ac | energy), segment, status, profitable_years (no loss in each of the last N years), max_debt_equity, min_traded_value_cr and max_warnings. Each stock includes loss years in last 5, debt/equity and traded value.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, sector: { type: 'string' }, theme: { type: 'string', enum: THEMES }, stage: { type: 'string', enum: STAGES }, status: { type: 'string', enum: ['pass', 'watch', 'remove'] }, profitable_years: { type: 'integer', minimum: 1, maximum: 5 }, max_debt_equity: { type: 'number', description: 'e.g. 0.5' }, min_traded_value_cr: { type: 'number', description: 'Daily traded value, ₹ crore' }, max_warnings: { type: 'integer' }, sort: { type: 'string', enum: ['points', 'gainers', 'losers', 'movers', 'name'] }, limit: { type: 'integer' } } } },
  { name: 'add_candidate', group: 'Stocks', description: 'Add or update a stock in the universe with whatever metrics you researched. Missing numbers count against it (3+ missing → Hold, status watch).',
    inputSchema: { type: 'object', required: ['symbol'], properties: {
      symbol: sym, name: { type: 'string' }, sector: { type: 'string' }, stage: { type: 'string', enum: STAGES },
      themes: { type: 'object', description: 'Theme share of business, %, e.g. {"ac": 40}', additionalProperties: { type: 'number' } }, price: { type: 'number' },
      metrics: { type: 'object', properties: Object.fromEntries(METRICS.map(m => [m, { type: 'number' }])) } } } },
  { name: 'create_basket', group: 'Baskets', description: 'Create a basket from NSE symbols with its own rules. Stocks that fail the basket rules, would push a segment over its limit, or exceed the plan stock limit (8 Free, 12 Pro) are skipped and listed with the reason. If a tool returns pro_feature, tell the user the free_alternative. theme is inferred when all stocks share one. rules overrides the 13 default rules for this basket (thresholds are Pro). kind "tracking" imports real holdings for alerts only.',
    inputSchema: { type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, description: { type: 'string' }, symbols: { type: 'array', items: { type: 'string' } },
      theme: { type: ['string', 'null'], enum: [...THEMES, null] }, min_theme: { type: 'number', description: 'Min theme share %, default 20' },
      rules: { type: 'object', description: 'Per-rule overrides, e.g. {"loss": {"green": 0, "red": 0}}. Changing green/red thresholds needs Pro; enabled true/false works on Free.', properties: Object.fromEntries([...METRICS, ...EVENTS].map(m => [m, ruleOverride])) },
      kind: { type: 'string', enum: ['model', 'tracking'], default: 'model' },
      holdings: { type: 'array', description: 'Tracking only', items: { type: 'object', properties: { symbol: { type: 'string' }, qty: { type: 'number' }, avg_price: { type: 'number' } } } } } } },
  { name: 'update_basket', group: 'Baskets', description: 'Rename a basket or change its description or theme.',
    inputSchema: { type: 'object', properties: { basket_id: basketId, name: { type: 'string' }, description: { type: 'string' }, theme: { type: ['string', 'null'], enum: [...THEMES, null] } } } },
  { name: 'add_stock', group: 'Baskets', description: 'Add one stock to a basket (blocked if the basket rules rate it Sell, status remove, over the stock limit or the segment cap).',
    inputSchema: { type: 'object', required: ['symbol'], properties: { basket_id: basketId, symbol: sym } } },
  { name: 'remove_stock', group: 'Baskets', description: 'Remove a stock from a basket. If the user holds it, pass sell=true to draft a sell that the user confirms.',
    inputSchema: { type: 'object', required: ['symbol'], properties: { basket_id: basketId, symbol: sym, sell: { type: 'boolean' } } } },
  { name: 'exit_basket', group: 'Baskets', description: 'Exit a basket: drafts sell orders for every holding and cancels its pending orders. The user confirms the sells in the website; the money then returns to practice cash. The basket and its rules stay.',
    inputSchema: { type: 'object', properties: { basket_id: basketId } } },
  { name: 'get_basket_status', group: 'Baskets', description: 'Basket value, each stock\'s rating (Buy = pass, Hold = watch, Sell = remove), points, weights, flags and the basket rules. Omit basket_id to list all baskets.',
    inputSchema: { type: 'object', properties: { basket_id: basketId } } },
  { name: 'set_rule', group: 'Rules', description: 'Change a rule\'s green/red thresholds in one basket (Pro).',
    inputSchema: { type: 'object', required: ['rule_id'], properties: { basket_id: basketId, rule_id: { type: 'string', enum: METRICS }, green: { type: 'number' }, red: { type: 'number' }, critical: { type: 'boolean' } } } },
  { name: 'toggle_rule', group: 'Rules', description: 'Turn a rule on or off in one basket. Event rules (ev_*) are Pro.',
    inputSchema: { type: 'object', required: ['rule_id', 'enabled'], properties: { basket_id: basketId, rule_id: { type: 'string', enum: [...METRICS, ...EVENTS] }, enabled: { type: 'boolean' } } } },
  { name: 'set_basket_rule', group: 'Rules', description: 'Change basket limits: stock count, weight caps, theme share (Pro).',
    inputSchema: { type: 'object', properties: { basket_id: basketId, min_stocks: { type: 'integer' }, max_stocks: { type: 'integer' }, max_stock_weight: { type: 'number' }, max_stage_weight: { type: 'number' }, max_watch_weight: { type: 'number' }, drift_trigger: { type: 'number' }, min_theme: { type: 'number' } } } },
  { name: 'create_order', group: 'Orders', description: 'Draft paper orders. Buy with amount and no symbol splits across the basket by target weights. Orders stay pending until the user confirms them in the website.',
    inputSchema: { type: 'object', required: ['side'], properties: { basket_id: basketId, side: { type: 'string', enum: ['buy', 'sell'] }, amount: { type: 'number', description: '₹' }, symbol: sym, qty: { type: 'integer' }, reason: { type: 'string' } } } },
  { name: 'get_alerts', group: 'Orders', description: 'One-line alerts with the numbers behind them.',
    inputSchema: { type: 'object', properties: { basket_id: basketId, unread_only: { type: 'boolean' }, limit: { type: 'integer' } } } },
  { name: 'get_refill_plan', group: 'Orders', description: 'If a basket is below its minimum: the refill ladder (Buy-rated → Hold-rated → cash) with skipped stocks and why.',
    inputSchema: { type: 'object', properties: { basket_id: basketId } } },
  { name: 'add_news_flag', group: 'News', description: 'Flag a metric a news item likely affects. A "worse" flag on a critical metric drafts an unconfirmed sell. The next filing confirms or clears it.',
    inputSchema: { type: 'object', required: ['symbol', 'metric', 'impact'], properties: { symbol: sym, metric: { type: 'string', enum: [...METRICS, ...EVENTS] }, impact: { type: 'string', enum: ['worse', 'better'] }, note: { type: 'string', description: 'One line: what the news says' }, url: { type: 'string' } } } },
  { name: 'get_rule_scorecard', group: 'News', description: 'How a basket\'s rules did every June 2018–2025 (mock backtest) plus live decisions. Free: latest year only.',
    inputSchema: { type: 'object', properties: { basket_id: basketId, view: { type: 'string', enum: ['summary', 'log'] } } } },
];

// Website path for each tool (parity map).
export const PARITY = {
  get_activity: 'Home → Your next step + Recent activity',
  get_universe: 'Home / Explore → search + filter chips',
  add_candidate: 'Explore → + Add stock',
  create_basket: 'Home → Create basket → pick stocks → Create',
  update_basket: 'Basket → ⋯ → Edit',
  add_stock: 'Stock → Add to basket',
  remove_stock: 'Basket → Stocks → Edit → ✕',
  exit_basket: 'Basket → Exit basket → Confirm',
  get_basket_status: 'Basket → Overview',
  set_rule: 'Basket → Rules → tap rule → slider → Save',
  toggle_rule: 'Basket → Rules → switch',
  set_basket_rule: 'Basket → Rules → Limits → steppers',
  create_order: 'Basket → Invest ₹ → amount → Confirm',
  get_alerts: 'Alerts tab',
  get_refill_plan: 'Alert → Review',
  add_news_flag: 'Stock → Flag news',
  get_rule_scorecard: 'Basket → Scorecard',
};
