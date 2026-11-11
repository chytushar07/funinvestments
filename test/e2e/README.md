# End-to-end tests

Browser and connector checks for every feature. They need a running server and Chrome:

```bash
npm start &                       # http://localhost:8787
npm i --no-save puppeteer-core@23
node test/e2e/ui.mjs              # every page and sheet through real taps (phone size)
node test/e2e/notifications.mjs   # bell, notifications, pending, decline/restore, delete requests
node test/e2e/mcp.mjs             # every Claude (MCP) tool, empty and with data
node test/e2e/prompts.mjs         # Claude prompt library: Home picks, #prompts page, Copy
```

Set `B` to test another address and `CHROME` for a different Chrome path. They reset the demo data.
The engine-level CRUD and state tests run with `npm test` (`test/features.test.js`).
