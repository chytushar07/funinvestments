// FunInvestments server: website + REST (/api/<op>) + MCP Streamable HTTP endpoint (/mcp). One engine, one state.
// Local:  npm start  →  http://localhost:8787
// Hosted: set PORT (from the host), FI_API_KEY (your secret), optional DATA_DIR (persistent disk).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createState, dispatch } from '../engine/core.js';
import { TOOLS } from '../engine/tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const PORT = Number(process.env.PORT || 8787);
const HOSTED = !!process.env.FI_API_KEY || process.env.NODE_ENV === 'production';
const API_KEY = process.env.FI_API_KEY || (HOSTED ? 'fi_' + crypto.randomBytes(12).toString('hex') : 'fi_demo_7f3a9c21');

let state = load();
let rev = 1;
function fresh() { const s = createState(); s.user.apiKey = API_KEY; return s; }
function load() {
  try { const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); if (s.v !== createState().v) return fresh(); s.user.apiKey = API_KEY; return s; } catch { return fresh(); }
}
function save() {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state)); }
  catch (e) { console.error('Could not save state:', e.message); }
}

function run(op, args, actor) {
  if (op === 'reset') { state = fresh(); rev++; save(); return { ok: true, data: { reset: true } }; }
  const res = dispatch(state, op, args, actor);
  if (!READ_OPS.has(op) || actor === 'claude') { rev++; save(); } // Claude reads are logged as activity, so they're saved too
  return res;
}

import { mcpHandle, keyFrom, sameKey, READ_OPS, wrapIndex } from '../engine/mcp.js';
export { mcpHandle };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const base = p.startsWith('/engine/') ? ROOT : path.join(ROOT, 'web');
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    if (p === '/index.html') buf = Buffer.from(wrapIndex(buf));
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(buf);
  });
}

function body(req, limit = 1_000_000) {
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > limit) { req.destroy(); resolve({ __bad: true }); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({ __bad: true }); } });
  });
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization, x-api-key, mcp-session-id, mcp-protocol-version', 'access-control-expose-headers': 'mcp-session-id' };
const json = (res, code, obj, extra = {}) => res.writeHead(code, { 'content-type': 'application/json', ...CORS, ...extra }).end(JSON.stringify(obj));

async function handleMcp(req, res, url) {
  if (!sameKey(keyFrom(url.pathname, req.headers, url.searchParams), API_KEY)) return json(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or wrong API key. Use /mcp/<key> or Authorization: Bearer <key>.' } });
  if (req.method === 'GET') {
    // No server-initiated stream: spec allows 405 here.
    if ((req.headers.accept || '').includes('text/event-stream')) { res.writeHead(405, { allow: 'POST', ...CORS }).end(); return; }
    return json(res, 200, { name: 'funinvestments', transport: 'streamable-http (POST JSON-RPC)', tools: TOOLS.map(t => t.name) });
  }
  if (req.method === 'DELETE') { res.writeHead(405, { allow: 'POST', ...CORS }).end(); return; }
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST', ...CORS }).end(); return; }
  const msg = await body(req);
  if (msg.__bad) return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  const call = (name, args) => run(name, args, 'claude');
  const website = `${process.env.PUBLIC_URL || `http://${req.headers.host}`}/#key=${API_KEY}`;
  const session = req.headers['mcp-session-id'] || crypto.randomUUID();
  const hdr = { 'mcp-session-id': session };
  if (Array.isArray(msg)) {
    const out = msg.map(m => mcpHandle(m, call, { website })).filter(Boolean);
    if (!out.length) { res.writeHead(202, CORS).end(); return; }
    return json(res, 200, out, hdr);
  }
  const out = mcpHandle(msg, call, { website });
  if (!out) { res.writeHead(202, CORS).end(); return; }
  return json(res, 200, out, hdr);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...CORS, 'access-control-allow-methods': 'GET,POST,DELETE' }).end(); return; }
  if (url.pathname === '/healthz') return json(res, 200, { ok: true });
  if (url.pathname === '/api/ping') return json(res, 200, { ok: true, rev, mode: 'server', hosted: HOSTED });
  if (url.pathname === '/api/rev') return json(res, 200, { rev });
  if (url.pathname.startsWith('/api/') && req.method === 'POST') {
    const op = url.pathname.slice(5);
    const b = await body(req);
    return json(res, 200, { ...run(op, b.args || {}, 'you'), rev });
  }
  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return handleMcp(req, res, url);
  serveStatic(req, res);
});

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  server.listen(PORT, '0.0.0.0', () => {
    const base = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    console.log(`FunInvestments website   →  ${base}`);
    console.log(`MCP connector URL        →  ${base}/mcp/${API_KEY}`);
    if (HOSTED && !process.env.FI_API_KEY) console.log('No FI_API_KEY set: generated a key for this run. Set FI_API_KEY so it stays the same.');
  });
}
export { server };
