// FunInvestments on Cloudflare Workers (free plan).
// - Static website: served from ./dist by Workers Static Assets (free, unlimited).
// - /api/*, /mcp, /healthz: handled here. Every visitor gets a private space: a signed key (engine/keys.js)
//   names their own Durable Object, which saves their state in its built-in SQLite storage, so nothing is
//   lost between Claude chats and nobody sees anyone else's baskets. The original owner key still opens the
//   original shared space ("main"), so existing Claude connectors keep working.
import { DurableObject } from 'cloudflare:workers';
import { createState, dispatch } from '../engine/core.js';
import { mcpHandle, keyFrom, sameKey, READ_OPS } from '../engine/mcp.js';
import { mintKey, resolveSpace } from '../engine/keys.js';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization, x-api-key, mcp-session-id, mcp-protocol-version', 'access-control-expose-headers': 'mcp-session-id' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } });
const randomKey = () => 'fi_' + [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');

export class Store extends DurableObject {
  // The Worker passes the space key for a private space. Without it this is the original shared space.
  async load(space) {
    if (this.state) return;
    this.isMain = !space;
    // Private space: its key. Original space: the FI_API_KEY secret if set, otherwise generated once and saved.
    let key = space || this.env.FI_API_KEY;
    if (!key) { key = await this.ctx.storage.get('apiKey'); if (!key) { key = randomKey(); await this.ctx.storage.put('apiKey', key); } }
    this.key = key;
    const saved = await this.ctx.storage.get('state');
    const fresh = createState();
    this.state = saved && saved.v === fresh.v ? saved : fresh;
    this.state.user.apiKey = key;
    this.rev = (await this.ctx.storage.get('rev')) || 1;
  }
  // Called by the Worker (on the original space) to learn the signing secret and the original owner key.
  async identity() {
    await this.load();
    let secret = this.env.FI_SECRET || await this.ctx.storage.get('secret');
    if (!secret) { secret = randomKey() + randomKey(); await this.ctx.storage.put('secret', secret); }
    return { secret, legacyKey: this.key };
  }
  async save() { this.rev++; await this.ctx.storage.put({ state: this.state, rev: this.rev }); }

  async run(op, args, actor) {
    if (op === 'reset') { this.state = createState(); this.state.user.apiKey = this.key; await this.save(); return { ok: true, data: { reset: true } }; }
    const res = dispatch(this.state, op, args, actor);
    if (!READ_OPS.has(op) || actor === 'claude') await this.save();
    return res;
  }

  async fetch(request) {
    await this.load(request.headers.get('x-fi-space') || undefined);
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET,POST,DELETE' } });
    if (p === '/healthz') return json({ ok: true });
    if (p === '/api/ping') return json({ ok: true, rev: this.rev, mode: 'server', hosted: true, space: this.isMain ? 'shared' : 'private' });
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

// The signing secret and original owner key, fetched once from the original space and kept while this Worker instance lives.
let identity;
const who = async env => identity ||= await env.STORE.get(env.STORE.idFromName('main')).identity();
const NO_SPACE = { ok: false, error: { code: 'no_space', message: 'Open the website again to start your private space.' } };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/healthz') return json({ ok: true });
    if (p.startsWith('/api/') || p === '/mcp' || p.startsWith('/mcp/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET,POST,DELETE' } });
      const me = await who(env);
      const space = await resolveSpace(keyFrom(p, request.headers, url.searchParams), me);
      if (!space) {
        // A visitor with no (or an old) key gets a fresh private key; everything else needs a valid key.
        if (p === '/api/ping') return json({ ok: true, rev: 1, mode: 'server', hosted: true, space: 'private', key: await mintKey(me.secret) });
        if (p.startsWith('/mcp')) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or wrong API key. Use /mcp/<key> or Authorization: Bearer <key>.' } }, 401);
        return json(NO_SPACE, 401);
      }
      // Always set (never trust) the internal space header, so a visitor can't name someone else's space.
      const headers = new Headers(request.headers);
      headers.set('x-fi-space', space === 'main' ? '' : space);
      return env.STORE.get(env.STORE.idFromName(space)).fetch(new Request(request, { headers }));
    }
    // Revalidate app files on every load so a phone never keeps running an old version after a deploy.
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'no-cache');
    return out;
  },
};
