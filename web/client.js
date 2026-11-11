// Two doors, one engine. Server mode: website calls /api/<op>, Claude calls /mcp.
// Standalone mode (no server, e.g. a shared link): the same engine runs in the browser.
import { createState, dispatch } from './engine/core.js';
import { TOOLS } from './engine/tools.js';

const KEY = 'fi_state_v4';
let mode = 'local', st = null, rev = 0, apiKey = 'fi_demo_7f3a9c21';

function loadLocal() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s.v === createState().v) return s; } } catch { /* storage blocked */ }
  return createState();
}
function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }

export async function init() {
  try {
    const r = await fetch('api/ping', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j.mode === 'server') { mode = 'server'; rev = j.rev; return mode; } }
  } catch { /* standalone */ }
  st = loadLocal();
  return mode;
}
export const getMode = () => mode;
export const getTools = () => TOOLS;

export async function call(op, args = {}) {
  if (mode === 'server') {
    const r = await fetch(`api/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args }) });
    if (!r.ok) throw new Error(`Server error ${r.status}`);
    const j = await r.json(); rev = j.rev; return j;
  }
  if (op === 'reset') { st = createState(); saveLocal(); return { ok: true, data: {} }; }
  const res = dispatch(st, op, structuredClone(args), 'you');
  saveLocal(); rev++;
  return res;
}

// What Claude does through MCP. In server mode this is a real JSON-RPC call to /mcp.
export async function claudeCall(tool, args = {}) {
  if (mode === 'server') {
    const r = await fetch('mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: tool, arguments: args } }) });
    const j = await r.json();
    if (j.error) return { ok: false, error: j.error };
    const res = j.result;
    return res.isError ? { ok: false, error: res.structuredContent?.error } : { ok: true, data: res.structuredContent };
  }
  if (!TOOLS.some(t => t.name === tool)) return { ok: false, error: { code: 'unknown_tool', message: `Unknown tool ${tool}` } };
  const res = dispatch(st, tool, structuredClone(args), 'claude');
  saveLocal(); rev++;
  return res;
}

export function setApiKey(k) { apiKey = k; }

// Server mode: notice changes made by Claude from outside the page.
export async function changedSince(knownRev) {
  if (mode !== 'server') return false;
  try { const r = await fetch('api/rev', { cache: 'no-store' }); const j = await r.json(); return j.rev !== knownRev ? j.rev : false; } catch { return false; }
}
export const currentRev = () => rev;
// Standalone mode: another tab of this browser changed the saved state. Load it so this tab never shows (or overwrites it with) old data.
export function onExternalChange(cb) {
  window.addEventListener('storage', e => { if (mode === 'local' && e.key === KEY) { st = loadLocal(); rev++; cb(); } });
}
