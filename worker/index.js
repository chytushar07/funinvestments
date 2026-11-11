// FunInvestments on Cloudflare Workers (free plan).
// - Static website: served from ./dist by Workers Static Assets (free, unlimited).
// - /api/*, /mcp, /healthz: handled here and forwarded to ONE Durable Object that holds the
//   state and saves it in its built-in SQLite storage, so nothing is lost between Claude chats.
import { DurableObject } from 'cloudflare:workers';
import { createState, dispatch } from '../engine/core.js';
import { mcpHandle, keyFrom, sameKey, READ_OPS } from '../engine/mcp.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization, x-api-key, mcp-session-id, mcp-protocol-version', 'access-control-expose-headers': 'mcp-session-id' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } });
const randomKey = () => 'fi_' + [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

export class Store extends DurableObject {
  async load() {
    if (this.state) return;
    // Key: the FI_API_KEY secret if set, otherwise generated once and saved.
    let key = this.env.FI_API_KEY;
    if (!key) { key = await this.ctx.storage.get('apiKey'); if (!key) { key = randomKey(); await this.ctx.storage.put('apiKey', key); } }
    this.key = key;
    const saved = await this.ctx.storage.get('state');
    const fresh = createState();
    this.state = saved && saved.v === fresh.v ? saved : fresh;
    this.state.user.apiKey = key;
    this.rev = (await this.ctx.storage.get('rev')) || 1;
  }
  async save() { this.rev++; await this.ctx.storage.put({ state: this.state, rev: this.rev }); }

  async run(op, args, actor) {
    if (op === 'reset') { this.state = createState(); this.state.user.apiKey = this.key; await this.save(); return { ok: true, data: { reset: true } }; }
    const res = dispatch(this.state, op, args, actor);
    if (!READ_OPS.has(op) || actor === 'claude') await this.save();
    return res;
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET,POST,DELETE' } });
    if (p === '/healthz') return json({ ok: true });
    if (p === '/api/ping') return json({ ok: true, rev: this.rev, mode: 'server', hosted: true });
    if (p === '/api/rev') return json({ rev: this.rev });
    if (p.startsWith('/api/') && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch { /* empty body */ }
      const res = await this.run(p.slice(5), body.args || {}, 'you');
      return json({ ...res, rev: this.rev });
    }
    if (p === '/mcp' || p.startsWith('/mcp/')) {
      if (!sameKey(keyFrom(p, request.headers, url.searchParams), this.key)) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or wrong API key. Use /mcp/<key> or Authorization: Bearer <key>.' } }, 401);
      if (request.method === 'GET') {
        if ((request.headers.get('accept') || '').includes('text/event-stream')) return new Response(null, { status: 405, headers: { allow: 'POST', ...CORS } });
        return json({ name: 'funinvestments', transport: 'streamable-http (POST JSON-RPC)' });
      }
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST', ...CORS } });
      let msg;
      try { msg = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
      const calls = [];
      const call = (name, args) => { const r = dispatch(this.state, name, args, 'claude'); calls.push(name); return r; };
      const session = request.headers.get('mcp-session-id') || crypto.randomUUID();
      const out = Array.isArray(msg) ? msg.map(m => mcpHandle(m, call)).filter(Boolean) : mcpHandle(msg, call);
      if (calls.length) await this.save();
      if (!out || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202, headers: CORS });
      return json(out, 200, { 'mcp-session-id': session });
    }
    return json({ error: 'Not found' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const p = new URL(request.url).pathname;
    if (p === '/healthz' || p.startsWith('/api/') || p === '/mcp' || p.startsWith('/mcp/')) {
      return env.STORE.get(env.STORE.idFromName('main')).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
