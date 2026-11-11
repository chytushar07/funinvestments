// MCP (JSON-RPC 2.0) handler shared by every host: Node server, Cloudflare Worker, stdio bridge.
import { TOOLS } from './tools.js';

export const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const INSTRUCTIONS = 'FunInvestments: a rules-based guardian for the user\'s own stock baskets. Practice money only, mock data. At the start of every conversation call get_activity to see what was done before and what the user still needs to do. You can prepare orders; the user confirms them in the FunInvestments website. Explain things in plain words. Stock ratings: pass is shown as Buy, watch as Hold, remove as Sell. They are what the user\'s own rules say, not advice, so use those words.';

// call(name, args) → { ok, data } | { ok: false, error }
export function mcpHandle(msg, call) {
  const { id, method, params } = msg || {};
  const reply = result => ({ jsonrpc: '2.0', id, result });
  if (!method) return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid request' } };
  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'funinvestments', title: 'FunInvestments', version: '0.2.0' }, instructions: INSTRUCTIONS });
  }
  if (method.startsWith('notifications/')) return null;
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === 'tools/call') {
    const name = params?.name;
    if (!TOOLS.some(t => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool ${name}` } };
    const res = call(name, params.arguments || {});
    return reply({ content: [{ type: 'text', text: JSON.stringify(res.ok ? res.data : res.error, null, 1) }], structuredContent: res.ok ? res.data : { error: res.error }, isError: !res.ok });
  }
  if (method === 'resources/list') return reply({ resources: [] });
  if (method === 'prompts/list') return reply({ prompts: [] });
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// Key from /mcp/<key>, Authorization: Bearer <key>, x-api-key, or ?key=
export function keyFrom(pathname, headers, searchParams) {
  const m = pathname.match(/^\/mcp\/([^/]+)\/?$/);
  return m?.[1] || headers.get?.('x-api-key') || headers['x-api-key'] || String(headers.get?.('authorization') || headers.authorization || '').replace(/^Bearer\s+/i, '') || searchParams?.get('key') || '';
}

export function sameKey(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const READ_OPS = new Set(['get_activity', 'get_state', 'get_stock', 'get_basket_status', 'get_universe', 'get_alerts', 'get_refill_plan', 'get_rule_scorecard', 'get_orders', 'get_rules', 'what_if', 'delete_preview']);

export const wrapIndex = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>${body}</html>`;
