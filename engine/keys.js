// Private spaces. Every visitor gets their own key, and the key is the address of their saved state:
// space "fiv_<id>_<signature>" lives in its own Durable Object. Keys are signed with a server secret, so
// nobody can invent one, and nobody can reach a space without holding its key (like a private link).
// The original owner key still opens the original shared space, named "main", so existing connectors keep working.
import { sameKey } from './mcp.js';

const enc = new TextEncoder();
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const KEY_RE = /^fiv_([0-9a-f]{24})_([0-9a-f]{20})$/;

async function sign(secret, id) {
  const k = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(id)))).slice(0, 20);
}

export async function mintKey(secret) {
  const id = hex(crypto.getRandomValues(new Uint8Array(12)));
  return `fiv_${id}_${await sign(secret, id)}`;
}

export async function verifyKey(secret, key) {
  const m = KEY_RE.exec(String(key || ''));
  return !!m && sameKey(m[2], await sign(secret, m[1]));
}

// Which space does this key open? 'main' (the original shared space), the key itself (a private space), or null.
export async function resolveSpace(key, { secret, legacyKey }) {
  if (!key) return null;
  if (legacyKey && sameKey(key, legacyKey)) return 'main';
  return (await verifyKey(secret, key)) ? String(key) : null;
}
