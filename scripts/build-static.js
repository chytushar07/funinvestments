// Builds ./dist for static hosting (Cloudflare Workers assets or GitHub Pages):
// the website files, the engine (used by the browser), and a full index.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wrapIndex } from '../engine/mcp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'web'), dist, { recursive: true });
fs.cpSync(path.join(root, 'engine'), path.join(dist, 'engine'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), wrapIndex(fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8')));
console.log('Built', path.relative(root, dist));
