# FunInvestments by Tushar

A rules-based guardian for your own stock baskets. Claude researches and explains; the website stores
the basket, checks your rules every day, and proves which rules worked.

Educational tool · Paper trades only · Not investment advice · All prices and metrics are mock data.

## Run it

```bash
npm start            # website + REST + MCP endpoint → http://localhost:8787
npm test             # rules, refill, backtest, CRUD, plans, parity (16 tests)
```

No dependencies. Node 18+.

## Connect Claude (MCP)

- **HTTP:** `POST http://localhost:8787/mcp` (JSON-RPC 2.0), header `x-api-key: fi_demo_7f3a9c21`.
- **Claude Desktop / Claude Code (stdio):**

```json
{ "mcpServers": { "funinvestments": {
  "command": "node", "args": ["/path/to/funinvestments/server/mcp-stdio.js"],
  "env": { "FI_URL": "http://localhost:8787", "FI_KEY": "fi_demo_7f3a9c21" } } } }
```

The stdio server forwards to the website server, so whatever Claude does appears in the website
within ~2 seconds. Then try: *"Build me a basket from my research"* (attach `research.txt`).

## Layout

| Path | What |
|---|---|
| `engine/rules.js` | 13 metrics + event rules → points → Pass / Watch / Remove |
| `engine/core.js` | One backend for both doors: baskets, scheduler, refill ladder, `execute(order)`, plans |
| `engine/scorecard.js` | Day-one backtest and Rule Scorecard |
| `engine/market.js` | Market-data interface (`getQuote`, `getFundamentals`, `getHistory`) — mock provider |
| `engine/data.js` | Mock data: 55 verified NSE symbols (AC value chain + Energy), history 2018–2025, mock filings |
| `engine/tools.js` | The 15 MCP tool schemas + parity map |
| `server/server.js` | Website, `/api/<op>`, `/mcp` |
| `server/mcp-stdio.js` | MCP over stdio |
| `web/` | The website (Preact + htm, vendored, no build). Runs standalone in the browser if no server |
| `PRODUCT.md` | CEO one-pager, design + engineering briefs, parity checklist, metric map, analytics plan, assumptions, v2 roadmap |

## What you can do in the website

- **Home**: browse stocks in horizontal rows (Top movers, Energy, AC value chain, Pass the rules), search, create a basket, and copy "Build with Claude" prompts.
- **Explore**: search, filter (theme, sector, status, profitable 2+ years), sort, **Select** several stocks → Create basket. Add, edit or delete your own stocks.
- **Basket**: Overview · Stocks · Rules · Scorecard. Each basket has its own 13 rules and limits. ⋯ menu: edit name/note/theme, duplicate, reset rules, delete (holdings are sold at the last price back to cash).
- **Stocks tab**: Edit → ✕ removes a stock (held stocks draft a sell first). Tracking baskets: add, edit, remove holdings.
- **Orders**: review drafts, change quantities, cancel one, confirm all, or "Keep anyway" with a reason (saved to the journal, editable).
- **Alerts**: Why?, act, dismiss one, clear all. **Stock page**: add to any basket, buy/sell, flag news, edit or withdraw a flag, set theme share.

Destructive actions (delete basket, delete stock, clear alerts) and confirming orders are website-only; Claude can't do them.

## Two-minute demo (by hand or via Claude)

1. Home → Energy → See all → Profitable 2+ yrs → Select → pick stocks → Create basket.
   Via Claude: copy the "Profitable energy companies" prompt on Home.
2. Invest ₹50,000 → change a quantity → Confirm.
3. Stock → ⚑ Flag → Debt / equity likely worse → a sell is drafted → Confirm or Keep anyway.
4. If the basket drops below its minimum, a refill is drafted (Orders / Alerts).
5. Basket → Scorecard → Unlock 2018–2025 (mock checkout).

`+1d` / `+1q` in the top bar run the scheduler. `+1q` brings in mock October filings that confirm
or clear news flags.

## Host it free on Cloudflare (website + MCP)

Cloudflare Workers runs the website and the MCP endpoint for free, without sleeping. Your baskets,
orders and Claude's activity are saved in a Durable Object (Cloudflare's built-in storage), so nothing
resets on restart. The free plan allows 100,000 requests a day, plenty for a prototype.

**1. Deploy from GitHub (one time, about 3 minutes)**
1. Sign in at dash.cloudflare.com (free account).
2. **Workers & Pages → Create → Import a repository** → connect GitHub → pick `funinvestments`.
3. Leave the settings as they are (`wrangler.jsonc` sets everything) → **Deploy**.
4. Open `https://funinvestments.<your-subdomain>.workers.dev`.

Every push to `main` redeploys automatically.

**2. Connect Claude**
1. Open claude.ai → **Customize → Connectors** (claude.ai/new#customize/connectors) → **+** → **Add custom connector**.
2. **Name:** `FunInvestments`. **Remote MCP server URL:** copy it from the website's **Settings → Connect Claude**. Click **Add**.
3. Make sure FunInvestments is switched on, then start a chat: "What's pending in FunInvestments?"

**Secret key.** The connector link contains a key. If you don't set one, the app makes one on first
start and saves it. To choose your own: Worker → Settings → Variables and Secrets → add secret
`FI_API_KEY`.

**From the command line instead:** `npm i -g wrangler && wrangler login && npm run cf:deploy`.
Local test: `npx wrangler dev` (uses `wrangler.jsonc`).

**Other hosts.** `npm start` runs the same app as a plain Node server (`server/server.js`); a
`Dockerfile` and `render.yaml` are included. Set `FI_API_KEY`, and `DATA_DIR` on a persistent disk.

**Nothing is lost between Claude chats.** Baskets, orders and every Claude action are saved on the
server. The `get_activity` tool lets a new chat pick up where the last one stopped, and the website
shows Claude's activity and your next step on Home and in Activity.

**Security (prototype):** the website has no login. Anyone with its address can use it and see the
connector URL in Settings. Share the address only with people you trust, or add your host's password
protection (Cloudflare Access works). One shared state for everyone (single-user prototype).
