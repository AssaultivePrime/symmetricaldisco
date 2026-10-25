// Small UI helpers: element builder, icons, toasts, dialogs.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div', {class:'x', onclick:fn, style:{...}}, child, 'text') */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  redo: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  shapes: '<rect x="3" y="12" width="9" height="9" rx="1"/><circle cx="16.5" cy="7.5" r="4.5"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  left: '<polyline points="15 18 9 12 15 6"/>',
  right: '<polyline points="9 18 15 12 9 6"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  bold: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>',
  italic: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
  underline: '<path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/>',
  'align-left': '<line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/>',
  'align-center': '<line x1="18" y1="10" x2="6" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="18" y1="18" x2="6" y2="18"/>',
  'align-right': '<line x1="21" y1="10" x2="7" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="7" y2="18"/>',
  'align-justify': '<line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/>',
  group: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M7 11v4a2 2 0 0 0 2 2h4" stroke-dasharray="2 2"/>',
  ungroup: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  front: '<polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/>',
  back2: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  'a-left': '<line x1="4" y1="2" x2="4" y2="22"/><rect x="8" y="6" width="12" height="4"/><rect x="8" y="14" width="7" height="4"/>',
  'a-center': '<line x1="12" y1="2" x2="12" y2="22"/><rect x="5" y="6" width="14" height="4"/><rect x="8" y="14" width="8" height="4"/>',
  'a-right': '<line x1="20" y1="2" x2="20" y2="22"/><rect x="4" y="6" width="12" height="4"/><rect x="9" y="14" width="7" height="4"/>',
  'a-top': '<line x1="2" y1="4" x2="22" y2="4"/><rect x="6" y="8" width="4" height="12"/><rect x="14" y="8" width="4" height="7"/>',
  'a-middle': '<line x1="2" y1="12" x2="22" y2="12"/><rect x="6" y="5" width="4" height="14"/><rect x="14" y="8" width="4" height="8"/>',
  'a-bottom': '<line x1="2" y1="20" x2="22" y2="20"/><rect x="6" y="4" width="4" height="12"/><rect x="14" y="9" width="4" height="7"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  divider: '<line x1="3" y1="12" x2="21" y2="12"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
};
export function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
/** Icon button with tooltip + aria-label */
export function iconBtn(name, label, onclick, extra = {}) {
  return h('button', { class: 'ib ' + (extra.class || ''), title: label, 'aria-label': label, type: 'button', html: icon(name, extra.size || 18), onclick, disabled: extra.disabled });
}

export const uid = () => 'e' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}
export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/* ---------- toast ---------- */
let toastHost;
export function toast(msg, kind = 'info', ms = 3800) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
}

/* ---------- dialogs ---------- */
export function modal({ title, body, actions = [], wide = false, onClose, className = '' }) {
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const box = h('div', { class: `modal ${wide ? 'wide' : ''} ${className}` });
  const close = (result) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    prevFocus?.focus?.();
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  if (title) box.append(h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'ib', 'aria-label': 'Close', title: 'Close', html: icon('x'), onclick: () => close() })));
  box.append(h('div', { class: 'modal-body' }, body));
  if (actions.length) {
    box.append(h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
      class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''} ${a.ghost ? 'ghost' : ''}`, type: 'button',
      onclick: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false) close(a.value); },
    }, a.label))));
  }
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !wide) close(); });
  document.body.append(overlay);
  setTimeout(() => (box.querySelector('[autofocus]') || box.querySelector('input,textarea,select,.btn.primary'))?.focus(), 30);
  return { close, box };
}
export function confirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: typeof message === 'string' ? h('p', {}, message) : message,
      actions: [{ label: cancelLabel, ghost: true, value: false }, { label: confirmLabel, primary: !danger, danger, value: true }],
      onClose: (r) => { if (!done) { done = true; resolve(!!r); } },
    });
  });
}
export function promptDialog({ title, label, value = '', confirmLabel = 'Save', placeholder = '', multiline = false }) {
  return new Promise((resolve) => {
    const input = multiline ? h('textarea', { rows: 4, placeholder, autofocus: true }, value) : h('input', { type: 'text', value, placeholder, autofocus: true });
    let result = null;
    const m = modal({
      title,
      body: h('label', { class: 'field-col' }, label ? h('span', {}, label) : null, input),
      actions: [{ label: 'Cancel', ghost: true }, { label: confirmLabel, primary: true, onClick: () => { result = input.value; } }],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { result = input.value; m.close(); } });
    setTimeout(() => input.select?.(), 40);
  });
}

/* ---------- popover menu ---------- */
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
/** items: [{label, icon, onClick, danger, disabled, sep}] */
export function showMenu(x, y, items) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it.sep) { m.append(h('div', { class: 'sep' })); continue; }
    m.append(h('button', {
      class: 'menu-item ' + (it.danger ? 'danger' : ''), role: 'menuitem', type: 'button', disabled: it.disabled,
      onclick: () => { closeMenu(); it.onClick?.(); },
    }, it.icon ? h('span', { class: 'mi', html: icon(it.icon, 16) }) : h('span', { class: 'mi' }), h('span', { class: 'ml' }, it.label), it.hint ? h('span', { class: 'mh' }, it.hint) : null));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  m.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  openMenu = m;
  setTimeout(() => {
    const off = (e) => { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc, true); } };
    const esc = (e) => { if (e.key === 'Escape') { closeMenu(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc, true); } };
    document.addEventListener('pointerdown', off, true);
    document.addEventListener('keydown', esc, true);
  });
  return m;
}
export function menuBelow(btn, items) {
  const r = btn.getBoundingClientRect();
  return showMenu(r.left, r.bottom + 4, items);
}
