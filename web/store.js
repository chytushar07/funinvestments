// App store: one snapshot from the engine + UI state (sheet, toast). No AI anywhere.
import * as api from './client.js';

export const store = { S: null, rev: 0, ui: { sheet: null, toast: null }, render: null, netError: null };
const emit = () => store.render?.(n => n + 1);

let seq = 0;
// Fetch the snapshot. Only the newest request may land, so a slow background poll can never
// overwrite the fresher state that followed an action. Resolves true when the snapshot is current.
export async function refresh() {
  const mine = ++seq;
  let done = false;
  try {
    const r = await api.call('get_state');
    if (mine !== seq) return true;
    if (r.ok) { store.S = r.data; store.rev++; store.netError = null; done = true; }
  } catch (e) { if (mine !== seq) return false; store.netError = e.message; }
  emit();
  return done;
}

let busy = false;
// Run an engine operation. Shows errors, refreshes the snapshot, never double-submits.
export async function act(op, args = {}, { ok, quiet } = {}) {
  if (busy) return null;
  busy = true;
  let r;
  try { r = await api.call(op, args); }
  catch (e) { busy = false; toast(`Can't reach the server · ${e.message}`, { err: true }); return null; }
  busy = false;
  if (!r.ok) { showError(r.error); await refresh(); return r; }
  if (ok) toast(typeof ok === 'function' ? ok(r.data) : ok);
  if (!quiet) await refresh();
  return r;
}
export const read = async (op, args = {}) => { try { return await api.call(op, args); } catch (e) { return { ok: false, error: { message: e.message } }; } };

export function showError(e) {
  if (e?.code === 'pro_feature') { api.call('track_event', { name: 'upgrade_moment_shown', props: { feature: e.feature } }); toast(e.message, { action: 'See plans', go: 'pricing' }); }
  else toast(e?.message || 'Something went wrong', { err: true });
}

let toastTimer;
export function toast(text, opts = {}) {
  store.ui = { ...store.ui, toast: { text, ...opts, at: Date.now() } };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { store.ui = { ...store.ui, toast: null }; emit(); }, opts.err ? 5000 : 3200);
  emit();
}
export function openSheet(sheet) { store.ui = { ...store.ui, sheet }; emit(); }
export function closeSheet() { store.ui = { ...store.ui, sheet: null }; emit(); }
export const go = hash => { if (store.ui.sheet) closeSheet(); if (location.hash === '#' + hash) emit(); else location.hash = hash; };

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { openSheet({ type: 'copy', text }); }
}
export function confirmDialog({ title, body, confirm = 'Confirm', danger = false, onConfirm }) {
  openSheet({ type: 'confirm', title, body, confirm, danger, onConfirm });
}
