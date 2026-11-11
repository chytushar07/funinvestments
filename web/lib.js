// Shared helpers and small components.
import { html } from './vendor/preact-htm.js';

export const inr = v => (v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN'));
export const inr2 = v => (v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const pct = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}%`);
export const cls = v => (v > 0 ? 'up' : v < 0 ? 'down' : 'muted');
export const dateLabel = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const short = d => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
export const initials = n => (n || '?').replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const shortName = n => (n || '').replace(/\s*\(.*\)/, '').split(' ').slice(0, 2).join(' ');
// What a basket's rules say about a stock. Internal ids stay pass / watch / remove.
export const STATUS = { pass: ['✓', 'Buy'], watch: ['=', 'Hold'], remove: ['✕', 'Sell'] };

export const Pill = ({ s, n }) => (s ? html`<span class="pill ${s}"><span aria-hidden="true">${STATUS[s][0]}</span>${n != null ? `${n} ` : ''}${STATUS[s][1]}</span>` : null);
export const Src = ({ s, edited }) => (s === 'claude' ? html`<span class="tag claude">${edited ? 'Edited by Claude' : 'By Claude'}</span>` : s === 'you' ? html`<span class="tag">${edited ? 'Edited by you' : 'By you'}</span>` : s === 'rules' ? html`<span class="tag">By rules</span>` : null);
export const Avatar = ({ name, stage, cls: c = '' }) => html`<span class="avatar st-${stage || 'parts'} ${c}" aria-hidden="true">${initials(name)}</span>`;
export const Mock = () => html`<span class="mocktag" title="All prices and metrics are mock data">Mock data</span>`;
export const Chg = ({ v, d = 2 }) => html`<span class="${cls(v)} num">${pct(v, d)}</span>`;

export const I = {
  home: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z"/></svg>`,
  baskets: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16l-1.5 10.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z"/><path d="M8.5 9 12 3.5 15.5 9"/></svg>`,
  bell: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`,
  orders: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h3.5"/></svg>`,
  user: html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5"/></svg>`,
  back: html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  search: html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>`,
  more: html`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  spark: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/></svg>`,
  about: html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/></svg>`,
  x: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  chev: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`,
};
export const Logo = () => html`<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.5 5 6.6v8.1c0 7 4.7 12.5 11 14.8 6.3-2.3 11-7.8 11-14.8V6.6z" fill="var(--brand)"/><path d="M10.4 18.6l3.7-3.7 2.9 2.9 5.2-5.7" fill="none" stroke="var(--brand-ink)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22.4" cy="11.3" r="1.7" fill="var(--brand-ink)"/></svg>`;

export function Sparkline({ pts }) {
  if (!pts?.length) return null;
  const W = 600, H = 70, ys = pts.map(p => p.p), min = Math.min(...ys), max = Math.max(...ys);
  const x = i => (i / (pts.length - 1)) * (W - 8) + 4, y = v => H - 6 - ((v - min) / (max - min || 1)) * (H - 14);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join('');
  const c = ys.at(-1) >= ys[0] ? 'var(--up)' : 'var(--down)';
  return html`<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price, last ${pts.length} months, mock">
    <path d="${d}L${x(pts.length - 1)},${H}L${x(0)},${H}Z" fill=${c} opacity=".1"/><path d=${d} fill="none" stroke=${c} stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

export function Stepper({ value, onChange, min = 0, max = 9999, step = 1, unit = '', label }) {
  return html`<span class="stepper" role="group" aria-label=${label}>
    <button type="button" aria-label="Less" disabled=${value <= min} onClick=${() => onChange(Math.max(min, value - step))}>−</button>
    <span>${value}${unit}</span>
    <button type="button" aria-label="More" disabled=${value >= max} onClick=${() => onChange(Math.min(max, value + step))}>+</button></span>`;
}

export function Switch({ id, checked, onChange, label, disabled }) {
  return html`<label class="switch"><input type="checkbox" id=${id} checked=${checked} disabled=${disabled} aria-label=${label} onChange=${e => onChange(e.target.checked)}/><span></span></label>`;
}

export function Empty({ title, children }) {
  return html`<div class="empty"><b>${title}</b>${children}</div>`;
}
