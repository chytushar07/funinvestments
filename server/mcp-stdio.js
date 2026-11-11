#!/usr/bin/env node
// MCP over stdio for Claude Desktop / Claude Code.
// Forwards every call to the running website server so Claude and the website share one state.
// If the server isn't running, it falls back to a local engine with its own saved state.
//
// Claude config example:
//   { "mcpServers": { "funinvestments": { "command": "node", "args": ["/path/to/server/mcp-stdio.js"],
//     "env": { "FI_URL": "http://localhost:8787", "FI_KEY": "fi_demo_7f3a9c21" } } } }
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, dispatch } from '../engine/core.js';
import { mcpHandle } from './server.js';

const URL_ = process.env.FI_URL || 'http://localhost:8787';
const KEY = process.env.FI_KEY || 'fi_demo_7f3a9c21';
const LOCAL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'state-stdio.json');

async function remote(msg) {
  const r = await fetch(`${URL_}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY }, body: JSON.stringify(msg) });
  if (r.status === 202) return null;
  return r.json();
}
let local = null;
function localHandle(msg) {
  if (!local) { try { local = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { local = createState(); } }
  const out = mcpHandle(msg, (name, args) => dispatch(local, name, args, 'claude'));
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(local));
  return out;
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  let out;
  try { out = await remote(msg); } catch { out = localHandle(msg); }
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
});
