// Two doors, one engine. Server mode: website calls /api/<op>, Claude calls /mcp.
// Standalone mode (no server, e.g. a shared link): the same engine runs in the browser.
import { createState, dispatch } from './engine/core.js';
import { TOOLS } from './engine/tools.js';

const KEY = 'fi_state_v4';
const SPACE_KEY = 'fi_space_key'; // this visitor's private-space key (hosted app only)
let mode = 'local', st = null, rev = 0, apiKey = 'fi_demo_7f3a9c21', spaceKey = '', space = 'shared';
const readSpaceKey = () => { try { return localStorage.getItem(SPACE_KEY) || ''; } catch { return ''; } };
const writeSpaceKey = k => { try { k ? localStorage.setItem(SPACE_KEY, k) : localStorage.removeItem(SPACE_KEY); } catch { /* storage blocked */ } };
const authHeaders = () => (spaceKey ? { 'x-api-key': spaceKey } : {});
// A link ending in #key=<key> opens that private space (how you move to another device). The key is removed from the address bar.
function keyFromLink() {
  const m = location.hash.match(/[#&]key=([\w-]+)/);
  if (!m) return '';
  // A link from Claude can also say where to land, e.g. #key=…&go=pricing&billing=monthly
  const to = (location.hash.match(/[#&]go=([\w-]+)/) || [])[1], bill = (location.hash.match(/[#&]billing=(monthly|quarterly|yearly)/) || [])[1];
  if (bill) { try { sessionStorage.setItem('fi_billing', bill); } catch { /* ignore */ } }
  try { history.replaceState(null, '', location.pathname + location.search + (to ? '#' + to : '')); } catch { /* ignore */ }
  if (to) setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 300); // the router already read the old hash
  return m[1];
}

function loadLocal() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s.v === createState().v) return s; } } catch { /* storage blocked */ }
  return createState();
}
function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } }

export async function init() {
  spaceKey = keyFromLink() || readSpaceKey();
  try {
    const r = await fetch('api/ping', { cache: 'no-store', headers: authHeaders() });
    if (r.ok) {
      const j = await r.json();
      if (j.mode === 'server') {
        mode = 'server'; rev = j.rev; space = j.space || 'shared';
        // First visit (or an old key): the server hands out a new private key. Remember it.
        if (j.key) { spaceKey = j.key; writeSpaceKey(spaceKey); } else if (spaceKey) writeSpaceKey(spaceKey);
        return mode;
      }
    }
  } catch { /* standalone */ }
  st = loadLocal();
  return mode;
}
export const getMode = () => mode;
export const getSpace = () => space;
export const getSpaceKey = () => spaceKey;
export const getTools = () => TOOLS;

export async function call(op, args = {}) {
  if (mode === 'server') {
    const r = await fetch(`api/${op}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ args }) });
    if (r.status === 401) { writeSpaceKey(''); throw new Error('Your private space expired. Reload the page to start a new one.'); }
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
  try { const r = await fetch('api/rev', { cache: 'no-store', headers: authHeaders() }); const j = await r.json(); return j.rev !== knownRev ? j.rev : false; } catch { return false; }
}
export const currentRev = () => rev;
// Standalone mode: another tab of this browser changed the saved state. Load it so this tab never shows (or overwrites it with) old data.
export function onExternalChange(cb) {
  window.addEventListener('storage', e => { if (mode === 'local' && e.key === KEY) { st = loadLocal(); rev++; cb(); } });
}
