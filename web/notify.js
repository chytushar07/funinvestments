// Notifications: browser alerts (Notification API) + in-app toasts. No server push needed:
// the page checks for changes every few seconds (also while the tab is in the background),
// and anything new since the last check is announced once.
//   • Urgent alerts (a must-pass rule breaks): every plan, always on.
//   • Everything else (status changes, drafts, what Claude prepared): Pro "browser alerts" switch.
import { store, go, toast } from './store.js';

const KEY = 'fi_notified_v1';
const num = id => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
let last = null; // { a: highest alert number announced, c: highest Claude activity number announced }

export const supported = () => typeof window !== 'undefined' && 'Notification' in window;
export const permission = () => (supported() ? Notification.permission : 'unsupported');
export async function askPermission() {
  if (!supported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}

function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(last)); } catch { /* storage off: in-memory only */ } }

function browser(title, body, tag, route) {
  if (permission() !== 'granted') return false;
  try {
    const n = new Notification(title, { body, tag, icon: 'favicon.svg', badge: 'favicon.svg' });
    n.onclick = () => { try { window.focus(); } catch { /* ignore */ } if (route) go(route); n.close(); };
    return true;
  } catch { return false; } // some browsers (e.g. Android Chrome) only allow notifications from a service worker
}

export function test() {
  const ok = browser('FunInvestments · test alert', 'Alerts are working. You will see one when a rule breaks or Claude prepares something for you.', 'fi-test', 'alerts');
  if (!ok) toast(permission() === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser\'s site settings.' : 'In-app alert works. Allow browser notifications to get them outside the app too.', { action: 'Alerts', go: 'alerts' });
  return ok;
}

// Called after every fresh snapshot.
export function check(S) {
  if (!S) return;
  const alerts = S.alerts || [], acts = (S.activity || []).filter(a => a.actor === 'claude' && a.kind === 'needs_you');
  const topA = Math.max(0, ...alerts.map(a => num(a.id))), topC = Math.max(0, ...acts.map(a => num(a.id)));
  if (!last) { last = load() || { a: topA, c: topC }; if (last.a > topA || last.c > topC) last = { a: topA, c: topC }; save(); return; } // first look: nothing is "new"
  const fresh = alerts.filter(a => num(a.id) > last.a).reverse();
  const freshC = acts.filter(a => num(a.id) > last.c).reverse();
  last = { a: Math.max(last.a, topA), c: Math.max(last.c, topC) }; save();
  const pushAll = !!S.notif?.push, visible = document.visibilityState === 'visible';
  for (const a of fresh.slice(-3)) {
    if (!a.critical && !pushAll) continue;
    const shown = browser(a.critical ? '⚠ A must-pass rule broke' : 'FunInvestments', a.text, 'alert-' + a.id, 'alerts');
    if (a.critical && (visible || !shown)) toast(a.text, { action: 'Review', go: 'alerts' });
  }
  for (const a of freshC.slice(-2)) {
    const shown = pushAll && browser('Claude prepared something', a.text + ' · confirm it in FunInvestments', 'claude-' + a.id, 'orders');
    if (visible && !shown) toast(`Claude: ${a.text}`, { action: 'Review', go: 'orders' });
  }
}

export const wantsBackground = () => permission() === 'granted';
