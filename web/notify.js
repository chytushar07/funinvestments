// Notifications: browser alerts (Notification API) + in-app toasts. No server push needed:
// the page checks for changes every few seconds (also while the tab is in the background),
// and anything new since the last check is announced once.
//   • Urgent alerts (a must-pass rule breaks): every plan, always on.
//   • Everything else (status changes, drafts, what Claude prepared): Pro "browser alerts" switch.
import { store, go, toast, openSheet } from './store.js';

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
    n.onclick = () => { try { window.focus(); } catch { /* ignore */ } if (typeof route === 'function') route(); else if (route) go(route); n.close(); };
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
  const fresh = alerts.filter(a => num(a.id) > last.a && !a.settled).reverse(); // a settled alert has nothing left to do
  const freshC = acts.filter(a => num(a.id) > last.c).reverse();
  last = { a: Math.max(last.a, topA), c: Math.max(last.c, topC) }; save();
  const pushAll = !!S.notif?.push, visible = document.visibilityState === 'visible';
  // Pick what to announce first, then cap it, so a burst of small alerts can't push out an urgent one.
  // An alert with orders waiting opens their review straight away (tap Review, then Sell or Keep anyway).
  const open = a => { const ids = a.action?.kind === 'orders' ? a.action.ids.filter(id => store.S?.orders.find(o => o.id === id)?.status === 'pending') : []; return ids.length ? () => openSheet({ type: 'review', ids }) : 'alerts'; };
  for (const a of fresh.filter(x => x.critical || pushAll).slice(-3)) {
    const to = open(a);
    const shown = browser(a.critical ? '⚠ A must-pass rule broke' : 'FunInvestments', a.text, 'alert-' + a.id, to);
    if (a.critical && (visible || !shown)) toast(a.text, typeof to === 'function' ? { action: 'Review', run: to } : { action: 'Review', go: 'alerts' });
  }
  for (const a of freshC.slice(-2)) {
    const shown = pushAll && browser('Claude prepared something', a.text + ' · confirm it in FunInvestments', 'claude-' + a.id, 'orders');
    const ids = (a.orderIds || []).filter(id => store.S?.orders.find(o => o.id === id)?.status === 'pending');
    if (visible && !shown) toast(`Claude: ${a.text}`, ids.length ? { action: 'Review', run: () => openSheet({ type: 'review', ids }) } : { action: 'Review', go: 'orders' });
  }
}

export const wantsBackground = () => permission() === 'granted';
