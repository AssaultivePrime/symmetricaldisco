// The editor: canvas (DOM-based, freeform), history, autosave, selection, drag/resize/rotate, publish & preview.
import { h, icon, iconBtn, uid, clamp, round, debounce, toast, modal, confirmDialog, promptDialog, showMenu, menuBelow, closeMenu, timeAgo } from './ui.js';
import { api } from './api.js';
import { store, createTray, DRAG_TYPE, pickAsset } from './tray.js';
import { createProps, EMOJI } from './props.js';
import { elementStyle, elementInner, bgStyle, docHeight } from '/shared/render.js';

const MIN = 12;
const OFF_SHADOW = () => ({ on: false, x: 3, y: 4, blur: 8, color: 'rgba(0,0,0,0.35)' });
const FILTERS = () => ({ brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0, hue: 0 });
const TEXT_BASE = () => ({ w: 320, h: 40, text: 'Double-click to edit', font: 'Inter', size: 28, color: '#111111', bold: false, italic: false, underline: false, align: 'left', ls: 0, lh: 1.3, outlineW: 0, outlineColor: '#000000', shadow: { ...OFF_SHADOW(), x: 2, y: 2, blur: 4 }, bg: '', pad: 0, radius: 0 });
const DEFAULTS = {
  image: () => ({ w: 300, h: 300, assetId: '', alt: '', fit: 'cover', posX: 50, posY: 50, borderW: 0, borderColor: '#ffffff', borderStyle: 'solid', radius: 0, shadow: OFF_SHADOW(), filters: FILTERS(), href: '' }),
  text: TEXT_BASE,
  link: () => ({ ...TEXT_BASE(), text: 'My link', href: 'https://', w: 240, h: 46, size: 20, bold: true, align: 'center', bg: '#222222', color: '#ffffff', pad: 10, radius: 999 }),
  shape: () => ({ kind: 'rect', w: 180, h: 180, fill: '#ff7aa8', stroke: '#111111', strokeW: 0, strokeStyle: 'solid', radius: 0, shadow: OFF_SHADOW(), href: '' }),
  divider: () => ({ w: 400, h: 24, style: 'solid', color: '#111111', thickness: 3 }),
  emoji: () => ({ w: 90, h: 90, char: '⭐', shadow: OFF_SHADOW(), href: '' }),
  audio: () => ({ w: 360, h: 84, assetId: '', title: '', theme: 'light' }),
  embed: () => ({ w: 480, h: 270, url: '' }),
  html: () => ({ w: 320, h: 140, code: '<div style="padding:14px;font-family:system-ui,sans-serif;text-align:center">Hello from a custom HTML block 👋</div>' }),
};
const REFRESH_KEYS = new Set(['kind', 'assetId', 'locked', 'groupId', 'bg']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mountEditor(root, pageId, { goHome, goEdit }) {
  root.replaceChildren(h('div', { class: 'center-msg' }, 'Loading your page…'));
  let data;
  try {
    data = await api('/pages/' + pageId);
    await store.load();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'center-msg' }, h('p', {}, e.status === 404 ? 'That page doesn’t exist (or isn’t yours).' : e.message), h('button', { class: 'btn primary', onclick: goHome }, 'Back to my pages')));
    return () => {};
  }

  /* ============================================================ state */
  const S = {
    page: data.page, doc: data.page.doc, sel: new Set(), zoom: 1, panX: 0, panY: 0, snap: true,
    dirty: false, version: 0, space: false, clipN: 0, addN: 0,
  };
  delete S.page.doc;
  S.doc.settings ||= {}; S.doc.elements ||= [];
  const disposers = [];
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); disposers.push(() => target.removeEventListener(ev, fn, opts)); };
  const byId = (id) => S.doc.elements.find((e) => e.id === id);
  const selected = () => S.doc.elements.filter((e) => S.sel.has(e.id));
  const pageW = () => S.doc.settings.width;
  const pageH = () => docHeight(S.doc);

  /* ============================================================ history */
  const hist = { stack: [JSON.stringify(S.doc)], i: 0, lastKey: null, lastAt: 0 };
  function commit(key) {
    const j = JSON.stringify(S.doc);
    if (j === hist.stack[hist.i]) return;
    const t = Date.now();
    if (key && key === hist.lastKey && t - hist.lastAt < 900 && hist.i > 0) { hist.stack[hist.i] = j; hist.stack.length = hist.i + 1; }
    else {
      hist.stack.length = hist.i + 1; hist.stack.push(j); hist.i++;
      if (hist.stack.length > 150) { hist.stack.shift(); hist.i--; }
    }
    hist.lastKey = key; hist.lastAt = t;
    markDirty(); syncUndo(); refreshUsed();
  }
  function restore(j) {
    S.doc = JSON.parse(j);
    S.sel = new Set([...S.sel].filter((id) => byId(id)));
    renderAll(); props.refresh(); markDirty(); syncUndo(); refreshUsed();
  }
  function undo() { if (hist.i > 0) { endTextEdit(); hist.i--; hist.lastKey = null; restore(hist.stack[hist.i]); } }
  function redo() { if (hist.i < hist.stack.length - 1) { endTextEdit(); hist.i++; hist.lastKey = null; restore(hist.stack[hist.i]); } }

  /* ============================================================ autosave */
  let saveTimer, retryTimer, retryDelay = 1000, inFlight = false, again = false, conflict = false, lastFailed = false, backupTimer;
  const pendingMeta = {};
  const hasPending = () => Object.keys(pendingMeta).length > 0;
  function setStatus(kind, msg) {
    statusEl.className = 'status ' + kind;
    statusEl.title = msg || '';
    statusEl.replaceChildren(
      kind === 'saved' ? h('span', { html: icon('check', 14) }) : kind === 'error' ? h('span', { class: 'dot' }) : h('span', { class: 'spin' }),
      kind === 'saved' ? 'Saved' : kind === 'error' ? 'Not saved – click to retry' : 'Saving…');
  }
  function markDirty() {
    S.version++; S.dirty = true; setStatus('saving');
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => { try { localStorage.setItem('pb_bk_' + pageId, JSON.stringify({ rev: S.page.rev, doc: S.doc, at: Date.now() })); } catch { /* quota */ } }, 400);
    updatePublishBtn();
  }
  function queueMeta(patch) {
    Object.assign(pendingMeta, patch); S.dirty = true; setStatus('saving');
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
  }
  async function save() {
    if (conflict) return;
    if (inFlight) { again = true; return; }
    if (!S.dirty && !hasPending()) return;
    inFlight = true; lastFailed = false; setStatus('saving');
    const v = S.version, meta = { ...pendingMeta };
    try {
      const res = await api('/pages/' + pageId, { method: 'PUT', body: { doc: S.doc, rev: S.page.rev, ...meta } });
      Object.assign(S.page, res.page);
      for (const k of Object.keys(meta)) if (pendingMeta[k] === meta[k]) delete pendingMeta[k];
      if (S.version === v && !hasPending()) { S.dirty = false; try { localStorage.removeItem('pb_bk_' + pageId); } catch { /* */ } }
      retryDelay = 1000; setStatus(S.dirty ? 'saving' : 'saved');
    } catch (e) {
      lastFailed = true;
      if (e.status === 409) { conflict = true; setStatus('error', e.message); showConflict(e.message); }
      else if (e.status === 400 && meta.slug) { delete pendingMeta.slug; toast(e.message, 'error'); S.dirty = S.version !== v || S.dirty; setStatus('error', e.message); }
      else { setStatus('error', e.message); clearTimeout(retryTimer); retryTimer = setTimeout(save, retryDelay); retryDelay = Math.min(30000, retryDelay * 2); }
    } finally {
      inFlight = false;
      if (again && !conflict) { again = false; clearTimeout(saveTimer); saveTimer = setTimeout(save, 120); }
      updatePublishBtn();
    }
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    for (let i = 0; i < 4; i++) {
      while (inFlight) await sleep(40);
      if (!S.dirty && !hasPending()) return true;
      await save();
      if (lastFailed) return false;
    }
    return !S.dirty;
  }
  function showConflict(msg) {
    if (conflictEl.isConnected) return;
    conflictEl.replaceChildren(h('span', {}, '⚠ ' + msg + ' '),
      h('button', { class: 'btn small', onclick: () => location.reload() }, 'Load latest (discard my changes here)'),
      h('button', { class: 'btn small', onclick: async () => {
        try { const d = await api('/pages/' + pageId); S.page.rev = d.page.rev; conflict = false; conflictEl.remove(); S.dirty = true; save(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Keep my version'));
    wrapper.prepend(conflictEl);
  }
  on(window, 'beforeunload', (e) => { if (S.dirty || inFlight || hasPending()) { e.preventDefault(); e.returnValue = ''; } });
  on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

  /* ============================================================ rendering */
  const nodes = new Map();
  let editing = null; // { el, n }
  const isText = (e) => e.type === 'text' || e.type === 'link';

  function renderEl(el) {
    let n = nodes.get(el.id);
    if (!n) { n = h('div', { class: 'el', dataset: { id: el.id } }); nodes.set(el.id, n); pageEl.insertBefore(n, selEl); }
    n.style.cssText = elementStyle(el, true) + `z-index:${S.doc.elements.indexOf(el) + 1};`;
    if (isText(el)) n.style.minHeight = '0';
    const inner = elementInner(el, { editor: true });
    if (!(editing && editing.n === n) && n._inner !== inner) {
      n.innerHTML = inner; n._inner = inner;
      n.querySelectorAll('img').forEach((img) => { img.addEventListener('error', () => { img.replaceWith(h('div', { class: 'ph broken' }, 'Image missing')); }, { once: true }); });
    }
    n.dataset.type = el.type;
    n.classList.toggle('locked', !!el.locked);
    n.classList.toggle('selected', S.sel.has(el.id));
    if (isText(el)) { const hh = n.offsetHeight; if (hh && Math.abs(hh - el.h) > 0.5) { el.h = hh; n.style.minHeight = ''; n.style.cssText = elementStyle(el, true) + `z-index:${S.doc.elements.indexOf(el) + 1};min-height:0;`; } }
    return n;
  }
  function renderAll() {
    const ids = new Set(S.doc.elements.map((e) => e.id));
    for (const [id, n] of nodes) if (!ids.has(id)) { n.remove(); nodes.delete(id); }
    S.doc.elements.forEach(renderEl);
    applyPage(); updateSelection();
    emptyEl.style.display = S.doc.elements.length ? 'none' : 'flex';
  }
  function applyPage() {
    pageEl.style.width = pageW() + 'px'; pageEl.style.height = pageH() + 'px';
    pageEl.style.cssText += bgStyle(S.doc.settings);
    pageEl.style.width = pageW() + 'px'; pageEl.style.height = pageH() + 'px';
    pageDim.textContent = `${pageW()} × ${Math.round(pageH())}`;
  }
  const usedIds = () => { const s = new Set(); S.doc.elements.forEach((e) => e.assetId && s.add(e.assetId)); if (S.doc.settings.bgAsset) s.add(S.doc.settings.bgAsset); return s; };
  const refreshUsed = debounce(() => tray.refresh(), 300);

  /* ---------- geometry helpers ---------- */
  function corners(e) {
    const r = ((e.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => { const lx = (sx * e.w) / 2, ly = (sy * e.h) / 2; return [cx + lx * c - ly * s, cy + lx * s + ly * c]; });
  }
  function aabb(e) {
    const cs = corners(e), xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  function bboxOf(els) {
    const bs = els.map(aabb), x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  }
  function pagePoint(e) {
    const r = pageEl.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
  }
  const viewCenter = () => { const r = ws.getBoundingClientRect(); return pagePoint({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }); };

  /* ---------- selection overlay ---------- */
  const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function updateSelection() {
    nodes.forEach((n, id) => n.classList.toggle('selected', S.sel.has(id)));
    const els = selected();
    if (!els.length || editing) { selEl.style.display = 'none'; return; }
    selEl.style.display = 'block';
    if (els.length === 1) {
      const e = els[0];
      Object.assign(selEl.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px', transform: `rotate(${e.rot || 0}deg)` });
      const sideOnly = isText(e) || e.type === 'audio' || e.type === 'divider';
      selEl.className = 'sel single' + (e.locked ? ' locked' : '');
      selEl.querySelectorAll('.h').forEach((hd) => { hd.style.display = e.locked || (sideOnly && !['e', 'w'].includes(hd.dataset.dir)) ? 'none' : ''; });
      selEl.querySelector('.rot').style.display = e.locked ? 'none' : '';
    } else {
      const b = bboxOf(els);
      Object.assign(selEl.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px', transform: 'none' });
      selEl.className = 'sel multi';
    }
  }
  function select(ids, { add = false } = {}) {
    if (!add) S.sel = new Set();
    for (const id of ids) S.sel.add(id);
    updateSelection(); props.refresh();
  }
  const groupIds = (el) => (el.groupId ? S.doc.elements.filter((x) => x.groupId === el.groupId).map((x) => x.id) : [el.id]);
  function clearSelection() { if (S.sel.size) { S.sel = new Set(); updateSelection(); props.refresh(); } }

  /* ============================================================ element actions */
  function makeEl(type, extra = {}) {
    return { id: uid(), type, x: 0, y: 0, rot: 0, opacity: 1, locked: false, groupId: '', ...DEFAULTS[type](), ...extra };
  }
  function addEl(type, extra = {}, { at, edit = false } = {}) {
    const el = makeEl(type, extra);
    let c = at || viewCenter();
    if (!at) { const j = (S.addN++ % 6) * 16; c = { x: c.x + j, y: c.y + j }; }
    el.x = clamp(c.x - el.w / 2, -el.w / 2, pageW() - el.w / 2); el.y = Math.max(-el.h / 2, c.y - el.h / 2);
    S.doc.elements.push(el);
    renderEl(el); S.sel = new Set([el.id]); renderAll(); props.refresh();
    commit('add');
    if (edit) startTextEdit(el, { selectAll: true });
    return el;
  }
  function loadDims(url) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 300, h: 300 }); i.src = url; });
  }
  async function placeAsset(a, at, targetNode) {
    if (targetNode) {
      const t = byId(targetNode.dataset.id);
      if (t && t.type === 'image' && !t.assetId && a.kind !== 'audio') { select([t.id]); set({ assetId: a.id }, 'fill'); return; }
      if (t && t.type === 'audio' && !t.assetId && a.kind === 'audio') { select([t.id]); set({ assetId: a.id, title: t.title || a.name }, 'fill'); return; }
    }
    if (a.kind === 'audio') return addEl('audio', { assetId: a.id, title: a.name }, { at });
    const d = await loadDims(a.url);
    const maxW = Math.min(380, pageW() * 0.45), maxH = 420;
    const k = Math.min(1, maxW / d.w, maxH / d.h);
    return addEl('image', { assetId: a.id, w: Math.max(24, Math.round(d.w * k)), h: Math.max(24, Math.round(d.h * k)), alt: a.name }, { at });
  }
  function set(patch, key) {
    const els = selected();
    if (!els.length) return;
    for (const e of els) Object.assign(e, patch);
    els.forEach(renderEl); updateSelection();
    Object.keys(patch).some((k) => REFRESH_KEYS.has(k)) ? props.refresh() : props.sync();
    commit(key);
  }
  function setNested(name, patch, key) {
    const els = selected();
    for (const e of els) e[name] = { ...(e[name] || {}), ...patch };
    els.forEach(renderEl); props.sync(); commit(key);
  }
  function setSettings(patch, key) {
    Object.assign(S.doc.settings, patch);
    applyPage(); updateSelection();
    ['bgAsset', 'autoExpand', 'cursorAsset', 'bgSize'].some((k) => k in patch) ? props.refresh() : props.sync();
    commit(key || 'settings');
  }
  function cloneEls(els, dx = 20, dy = 20) {
    const gmap = {};
    return els.map((e) => {
      const c = JSON.parse(JSON.stringify(e));
      c.id = uid(); c.x += dx; c.y += dy;
      if (c.groupId) c.groupId = gmap[c.groupId] ||= uid();
      return c;
    });
  }
  function duplicate() {
    const els = selected(); if (!els.length) return;
    const cs = cloneEls(els); S.doc.elements.push(...cs);
    S.sel = new Set(cs.map((c) => c.id)); renderAll(); props.refresh(); commit('dup');
  }
  function remove() {
    const els = selected(); if (!els.length) return;
    S.doc.elements = S.doc.elements.filter((e) => !S.sel.has(e.id));
    S.sel = new Set(); renderAll(); props.refresh(); commit('del');
    toast(els.length > 1 ? `Deleted ${els.length} items. Ctrl+Z to undo.` : 'Deleted. Ctrl+Z to undo.', 'info', 2200);
  }
  function copy() {
    const els = selected(); if (!els.length) return false;
    try { localStorage.setItem('pb_clip', JSON.stringify(els)); } catch { /* */ }
    S.clipN = 0; return true;
  }
  function pasteEls(at) {
    let src; try { src = JSON.parse(localStorage.getItem('pb_clip') || 'null'); } catch { /* */ }
    if (!Array.isArray(src) || !src.length) return false;
    S.clipN++;
    let cs = cloneEls(src, 0, 0);
    if (at) { const b = bboxOf(cs); cs.forEach((c) => { c.x += at.x - (b.x + b.w / 2); c.y += at.y - (b.y + b.h / 2); }); }
    else cs.forEach((c) => { c.x += 24 * S.clipN; c.y += 24 * S.clipN; });
    S.doc.elements.push(...cs.slice(0, 500 - S.doc.elements.length));
    S.sel = new Set(cs.map((c) => c.id)); renderAll(); props.refresh(); commit('paste');
    return true;
  }
  function layer(op) {
    const els = S.doc.elements, ids = S.sel;
    if (!ids.size) return;
    const sel = els.filter((e) => ids.has(e.id)), rest = els.filter((e) => !ids.has(e.id));
    if (op === 'front') S.doc.elements = [...rest, ...sel];
    else if (op === 'back') S.doc.elements = [...sel, ...rest];
    else if (op === 'forward') { for (let i = els.length - 2; i >= 0; i--) if (ids.has(els[i].id) && !ids.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]]; }
    else for (let i = 1; i < els.length; i++) if (ids.has(els[i].id) && !ids.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
    renderAll(); commit('layer');
  }
  function toggleLock() {
    const els = selected(); if (!els.length) return;
    const lock = !els.every((e) => e.locked);
    els.forEach((e) => (e.locked = lock)); renderAll(); props.refresh(); commit('lock');
    toast(lock ? 'Locked. It can’t be moved until you unlock it.' : 'Unlocked.', 'info', 1800);
  }
  function group() { const els = selected(); if (els.length < 2) return; const g = uid(); els.forEach((e) => (e.groupId = g)); props.refresh(); commit('group'); toast('Grouped – they now move together.', 'info', 1800); }
  function ungroup() { const els = selected(); const gs = new Set(els.map((e) => e.groupId).filter(Boolean)); if (!gs.size) return; S.doc.elements.forEach((e) => gs.has(e.groupId) && (e.groupId = '')); props.refresh(); commit('ungroup'); }
  function align(dir) {
    const els = selected().filter((e) => !e.locked); if (els.length < 2) return;
    const b = bboxOf(els);
    for (const e of els) {
      const a = aabb(e);
      if (dir === 'left') e.x += b.x - a.x; if (dir === 'right') e.x += b.x + b.w - (a.x + a.w); if (dir === 'center') e.x += b.x + b.w / 2 - (a.x + a.w / 2);
      if (dir === 'top') e.y += b.y - a.y; if (dir === 'bottom') e.y += b.y + b.h - (a.y + a.h); if (dir === 'middle') e.y += b.y + b.h / 2 - (a.y + a.h / 2);
    }
    els.forEach(renderEl); updateSelection(); commit('align');
  }
  function nudge(dx, dy) {
    const els = selected().filter((e) => !e.locked); if (!els.length) return;
    els.forEach((e) => { e.x += dx; e.y += dy; renderEl(e); }); updateSelection(); props.sync(); commit('nudge');
  }

  /* ---------- text editing ---------- */
  function startTextEdit(el, { selectAll = false } = {}) {
    if (el.locked || !isText(el)) return;
    endTextEdit();
    const n = renderEl(el);
    editing = { el, n };
    n.textContent = el.text;
    n.contentEditable = 'plaintext-only';
    if (n.contentEditable !== 'plaintext-only') n.contentEditable = 'true';
    n.classList.add('editing');
    updateSelection();
    n.focus();
    const sel = getSelection(), r = document.createRange();
    r.selectNodeContents(n); if (!selectAll) r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
    const read = () => (n.contentEditable === 'plaintext-only' ? n.textContent : n.innerText).replace(/ /g, ' ');
    const onInput = () => { el.text = read(); const hh = n.offsetHeight; el.h = hh; props.sync(); markDirtyText(); };
    const onPaste = (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); n.blur(); } e.stopPropagation(); };
    const onBlur = () => endTextEdit();
    n.addEventListener('input', onInput); n.addEventListener('paste', onPaste); n.addEventListener('keydown', onKey); n.addEventListener('blur', onBlur);
    editing.off = () => { n.removeEventListener('input', onInput); n.removeEventListener('paste', onPaste); n.removeEventListener('keydown', onKey); n.removeEventListener('blur', onBlur); };
    editing.read = read;
  }
  function markDirtyText() { commit('text'); }
  function endTextEdit() {
    if (!editing) return;
    const { el, n, off, read } = editing;
    editing = null; off();
    el.text = read(); n.contentEditable = 'false'; n.classList.remove('editing');
    n._inner = null; renderEl(el); updateSelection(); props.sync(); commit('text');
  }

  /* ============================================================ view (zoom / pan) */
  function applyView() {
    world.style.transform = `translate(${S.panX}px,${S.panY}px) scale(${S.zoom})`;
    world.style.setProperty('--z', S.zoom);
    zoomLabel.textContent = Math.round(S.zoom * 100) + '%';
  }
  function zoomAt(z, cx, cy) {
    z = clamp(z, 0.1, 4); const k = z / S.zoom;
    S.panX = cx - (cx - S.panX) * k; S.panY = cy - (cy - S.panY) * k; S.zoom = z; applyView();
  }
  function zoomCenter(z) { const r = ws.getBoundingClientRect(); zoomAt(z, r.width / 2, r.height / 2); }
  function fitView() {
    const r = ws.getBoundingClientRect();
    S.zoom = clamp(Math.min(1, (r.width - 80) / pageW()), 0.1, 1);
    S.panX = (r.width - pageW() * S.zoom) / 2; S.panY = 64; applyView();
  }

  /* ============================================================ UI construction */
  const props = createProps({
    selected, doc: () => S.doc, set, setNested, setSettings, layer, duplicate, remove, toggleLock, group, ungroup, align,
  });
  const tray = createTray({
    getUsedIds: usedIds, onAdd: (a) => placeAsset(a),
    onCollapse: () => setTrayCollapsed(true),
  });

  const statusEl = h('button', { class: 'status saved', type: 'button', title: '', onclick: () => { retryDelay = 1000; save(); } });
  const titleInput = h('input', { class: 'title-input', type: 'text', value: S.page.title, 'aria-label': 'Page title', maxLength: 80,
    oninput: () => { S.page.title = titleInput.value; queueMeta({ title: titleInput.value }); },
    onblur: () => { if (!titleInput.value.trim()) { titleInput.value = 'Untitled'; S.page.title = 'Untitled'; queueMeta({ title: 'Untitled' }); } },
    onkeydown: (e) => { if (e.key === 'Enter') titleInput.blur(); e.stopPropagation(); } });
  const undoBtn = iconBtn('undo', 'Undo  (Ctrl+Z)', undo), redoBtn = iconBtn('redo', 'Redo  (Ctrl+Shift+Z)', redo);
  const zoomLabel = h('button', { class: 'zoom-label', type: 'button', title: 'Reset to 100%', onclick: () => zoomCenter(1) }, '100%');
  const snapBtn = iconBtn('grid', 'Snap to guides', () => { S.snap = !S.snap; snapBtn.classList.toggle('on', S.snap); snapBtn.setAttribute('aria-pressed', S.snap); toast(S.snap ? 'Snapping on – hold Alt while dragging to ignore it.' : 'Snapping off.', 'info', 1800); });
  snapBtn.classList.add('on'); snapBtn.setAttribute('aria-pressed', 'true');
  const publishBtn = h('button', { class: 'btn primary publish', type: 'button', onclick: openPublish });
  const syncUndo = () => { undoBtn.disabled = hist.i === 0; redoBtn.disabled = hist.i >= hist.stack.length - 1; };
  function updatePublishBtn() {
    const p = S.page;
    publishBtn.replaceChildren(h('span', { html: icon('globe', 16) }), p.published ? (p.hasChanges || S.dirty || changedSincePublish() ? 'Publish updates' : 'Published') : 'Publish');
    publishBtn.classList.toggle('live', !!p.published && !(p.hasChanges || S.dirty || changedSincePublish()));
    pubDot.style.display = p.published ? '' : 'none';
  }
  let publishedJson = null; // doc JSON as of last publish in this session
  const changedSincePublish = () => publishedJson != null && publishedJson !== JSON.stringify(S.doc);
  const pubDot = h('span', { class: 'live-dot', title: 'This page is live' });

  const moreBtn = iconBtn('more', 'More', () => menuBelow(moreBtn, [
    { label: 'Page settings', icon: 'edit', onClick: clearSelection },
    { label: 'Save as my template…', icon: 'bookmark', onClick: saveTemplate },
    { label: 'Duplicate this page', icon: 'copy', onClick: dupPage },
    { sep: true },
    { label: 'Keyboard shortcuts', icon: 'help', onClick: showShortcuts },
    { label: 'Show the quick tour', icon: 'help', onClick: () => showTour() },
  ]));

  const topbar = h('header', { class: 'topbar' },
    iconBtn('back', 'Back to my pages', async () => { await leave(); }),
    h('div', { class: 'title-wrap' }, pubDot, titleInput), statusEl,
    h('span', { class: 'spacer' }),
    undoBtn, redoBtn, h('span', { class: 'vsep' }),
    iconBtn('minus', 'Zoom out  (Ctrl −)', () => zoomCenter(S.zoom / 1.2)), zoomLabel, iconBtn('plus', 'Zoom in  (Ctrl +)', () => zoomCenter(S.zoom * 1.2)),
    iconBtn('fit', 'Fit page to screen  (Ctrl 0)', fitView), snapBtn,
    h('span', { class: 'vsep' }),
    h('button', { class: 'btn', type: 'button', onclick: openPreview, title: 'See how it looks on desktop and phone', html: icon('eye', 16) + ' Preview' }),
    moreBtn, publishBtn,
  );

  // canvas
  const pageEl = h('div', { class: 'page', 'aria-label': 'Page canvas' });
  const selEl = h('div', { class: 'sel' },
    ...HANDLE_DIRS.map((d) => h('div', { class: 'h h-' + d, dataset: { dir: d } })), h('div', { class: 'rot', title: 'Rotate  (hold Shift for 15° steps)' }), h('div', { class: 'lock-badge', html: icon('lock', 12) }));
  const guidesEl = h('div', { class: 'guides' });
  const marqueeEl = h('div', { class: 'marquee' });
  const emptyEl = h('div', { class: 'page-empty' }, h('div', {}, h('b', {}, 'A blank page — yours to fill'), h('p', {}, 'Drag an image from the tray on the left, or add text with the toolbar above.'), h('p', { class: 'sub' }, 'Tip: you can also drop pictures straight from your computer.')));
  const pageDim = h('div', { class: 'page-dim' });
  pageEl.append(emptyEl, selEl, guidesEl, marqueeEl);
  const world = h('div', { class: 'world' }, pageDim, pageEl);
  const ws = h('main', { class: 'workspace', tabindex: -1 }, world);

  // add toolbar
  function popover(btn, content) {
    const r = btn.getBoundingClientRect();
    const m = showMenu(r.left, r.bottom + 6, [{ label: '' }]);
    m.className = 'menu popover'; m.replaceChildren(content);
    const r2 = m.getBoundingClientRect(); m.style.left = clamp(r.left, 6, innerWidth - r2.width - 6) + 'px';
  }
  const addBtn = (ic, label, fn, title) => h('button', { class: 'add-b', type: 'button', title: title || label, onclick: fn, html: icon(ic, 18) + `<span>${label}</span>` });
  const shapeBtn = addBtn('shapes', 'Shapes', () => popover(shapeBtn, h('div', { class: 'shape-grid' }, [['rect', '▬', 'Rectangle'], ['ellipse', '●', 'Circle'], ['triangle', '▲', 'Triangle'], ['star', '★', 'Star'], ['heart', '♥', 'Heart'], ['frame', '▢', 'Frame']].map(([kind, g, t]) =>
    h('button', { type: 'button', class: 'shape-b', title: t, 'aria-label': t, onclick: () => { closeMenu(); addEl('shape', kind === 'frame' ? { kind, strokeW: 8, w: 240, h: 240 } : { kind, w: kind === 'rect' ? 240 : 180, h: kind === 'rect' ? 150 : 180 }); } }, g)))), 'Shapes and frames');
  const emojiBtn = addBtn('smile', 'Stickers', () => popover(emojiBtn, h('div', { class: 'emoji-pop' }, h('div', { class: 'emoji-grid' }, EMOJI.map((c) => h('button', { type: 'button', class: 'emoji-b', onclick: () => { closeMenu(); addEl('emoji', { char: c }); } }, c))), h('p', { class: 'small-note' }, 'Tip: after adding, you can type any emoji in the side panel.'))), 'Emoji stickers');
  const divBtn = addBtn('divider', 'Divider', () => popover(divBtn, h('div', { class: 'div-pop' }, [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double'], ['wavy', 'Wavy']].map(([style, l]) =>
    h('button', { type: 'button', class: 'menu-item', onclick: () => { closeMenu(); addEl('divider', { style }); } }, h('span', { class: 'div-prev', style: { borderTopStyle: style === 'wavy' ? 'solid' : style } }), l)))), 'Divider line');
  const addbar = h('div', { class: 'addbar', role: 'toolbar', 'aria-label': 'Add to page' },
    addBtn('type', 'Text', () => addEl('text', {}, { edit: true }), 'Add a text box'),
    addBtn('type', 'Heading', () => addEl('text', { text: 'Big heading', w: 520, size: 60, font: 'DM Serif Display', h: 70 }, { edit: true }), 'Add a heading'),
    addBtn('link', 'Link', () => addEl('link', {}, { edit: true }), 'Add a clickable link button'),
    addBtn('image', 'Image', async () => { const a = await pickAsset(); if (a) placeAsset(a); }, 'Add an image from your assets'),
    shapeBtn, emojiBtn, divBtn,
    addBtn('music', 'Music', async () => { const a = await pickAsset({ kinds: ['audio'], title: 'Choose audio' }); a ? placeAsset(a) : null; }, 'Add a music player'),
    addBtn('play', 'Embed', async () => {
      const url = await promptDialog({ title: 'Embed a video or music', label: 'Paste a YouTube, Spotify or Vimeo link', placeholder: 'https://…', confirmLabel: 'Add' });
      if (url?.trim()) addEl('embed', { url: url.trim() });
    }, 'Embed YouTube, Spotify, Vimeo…'),
    addBtn('code', 'HTML', () => addEl('html'), 'Custom HTML block (sandboxed)'),
  );
  ws.append(addbar, h('div', { class: 'hintbar' }, 'Double-click text to edit · Space + drag to pan · Ctrl + scroll to zoom'));

  const conflictEl = h('div', { class: 'banner' });
  const trayWrap = h('div', { class: 'tray-wrap' }, tray.el, h('button', { class: 'tray-rail', type: 'button', title: 'Open assets', onclick: () => setTrayCollapsed(false), html: icon('right', 16) + '<span>Assets</span>' }));
  const resizer = h('div', { class: 'resizer', role: 'separator', 'aria-label': 'Resize tray', title: 'Drag to resize' });
  const propsWrap = h('div', { class: 'props-wrap' }, props);
  const mainEl = h('div', { class: 'ed-main' }, trayWrap, resizer, ws, propsWrap);
  const wrapper = h('div', { class: 'ed' }, topbar, mainEl);
  root.replaceChildren(wrapper);

  function setTrayCollapsed(c) { trayWrap.classList.toggle('collapsed', c); resizer.style.display = c ? 'none' : ''; try { localStorage.setItem('pb_tray_c', c ? '1' : '0'); } catch { /* */ } }
  try { const w = +localStorage.getItem('pb_tray_w'); if (w) mainEl.style.setProperty('--tray-w', clamp(w, 200, 560) + 'px'); if (localStorage.getItem('pb_tray_c') === '1') setTrayCollapsed(true); } catch { /* */ }
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault(); const sx = e.clientX, w0 = trayWrap.getBoundingClientRect().width;
    const mv = (ev) => mainEl.style.setProperty('--tray-w', clamp(w0 + ev.clientX - sx, 200, 560) + 'px');
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); try { localStorage.setItem('pb_tray_w', Math.round(trayWrap.getBoundingClientRect().width)); } catch { /* */ } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });

  /* ============================================================ pages: leave / duplicate / templates */
  async function leave() {
    endTextEdit();
    const ok = await flushSave();
    if (!ok && !(await confirmDialog({ title: 'Changes not saved', message: 'Your latest changes could not be saved yet. Leave anyway and lose them?', confirmLabel: 'Leave anyway', danger: true }))) return;
    goHome();
  }
  async function dupPage() {
    if (!(await flushSave())) return toast('Save failed – try again in a moment.', 'error');
    try { const d = await api(`/pages/${pageId}/duplicate`, { method: 'POST' }); toast('Duplicated. You’re now editing the copy.'); goEdit(d.page.id); } catch (e) { toast(e.message, 'error'); }
  }
  async function saveTemplate() {
    const name = await promptDialog({ title: 'Save as my template', label: 'Template name', value: S.page.title, confirmLabel: 'Save template' });
    if (!name?.trim()) return;
    try { await api('/templates', { method: 'POST', body: { name, doc: S.doc } }); toast('Template saved. You’ll find it when you create a new page.'); } catch (e) { toast(e.message, 'error'); }
  }

  /* ============================================================ pointer interactions */
  let drag = null;
  const endDrag = () => { if (!drag) return; window.removeEventListener('pointermove', drag.move); window.removeEventListener('pointerup', drag.up); window.removeEventListener('pointercancel', drag.up); drag = null; ws.classList.remove('panning'); };
  function beginDrag(move, up) {
    const d = { move, up: (e) => { endDrag(); up?.(e); } };
    drag = d;
    window.addEventListener('pointermove', d.move); window.addEventListener('pointerup', d.up); window.addEventListener('pointercancel', d.up);
  }

  on(ws, 'pointerdown', (e) => {
    if (e.button === 2) return;
    closeMenu();
    if (editing && editing.n.contains(e.target)) return;
    if (editing) endTextEdit();
    if (e.target.closest('.addbar, .zoombox')) return;
    if (e.button === 1 || S.space) return startPan(e);
    const handle = e.target.closest?.('.h, .rot');
    if (handle) return startHandle(e, handle);
    const node = e.target.closest?.('.el');
    if (node) return startMove(e, node);
    startMarquee(e);
  });
  function startPan(e) {
    e.preventDefault(); ws.classList.add('panning');
    const sx = e.clientX, sy = e.clientY, px = S.panX, py = S.panY;
    beginDrag((ev) => { S.panX = px + ev.clientX - sx; S.panY = py + ev.clientY - sy; applyView(); });
  }

  const guides = [];
  function clearGuides() { guidesEl.replaceChildren(); guides.length = 0; }
  function drawGuides(vx, hy) {
    guidesEl.replaceChildren();
    if (vx != null) guidesEl.append(h('div', { class: 'guide v', style: { left: vx + 'px' } }));
    if (hy != null) guidesEl.append(h('div', { class: 'guide hh', style: { top: hy + 'px' } }));
  }
  function snapMove(b0, dx, dy, moving, altKey) {
    if (!S.snap || altKey) { drawGuides(); return { dx, dy }; }
    const thr = 7 / S.zoom, W = pageW(), H = pageH();
    const tx = [0, W / 2, W], ty = [0, H / 2, H];
    for (const o of S.doc.elements) { if (moving.has(o.id)) continue; const a = aabb(o); tx.push(a.x, a.x + a.w / 2, a.x + a.w); ty.push(a.y, a.y + a.h / 2, a.y + a.h); }
    const b = { x: b0.x + dx, y: b0.y + dy, w: b0.w, h: b0.h };
    let bx = null, by = null;
    for (const x of [b.x, b.x + b.w / 2, b.x + b.w]) for (const t of tx) { const d = t - x; if (Math.abs(d) < thr && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, line: t }; }
    for (const y of [b.y, b.y + b.h / 2, b.y + b.h]) for (const t of ty) { const d = t - y; if (Math.abs(d) < thr && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, line: t }; }
    drawGuides(bx?.line, by?.line);
    return { dx: dx + (bx?.d || 0), dy: dy + (by?.d || 0) };
  }

  function startMove(e, node) {
    const el = byId(node.dataset.id); if (!el) return;
    const ids = groupIds(el);
    if (e.shiftKey) {
      const all = ids.every((id) => S.sel.has(id));
      ids.forEach((id) => (all ? S.sel.delete(id) : S.sel.add(id)));
      updateSelection(); props.refresh(); return;
    }
    const wasSelected = S.sel.has(el.id);
    if (!wasSelected) { S.sel = new Set(ids); updateSelection(); props.refresh(); }
    const movable = selected().filter((x) => !x.locked);
    const start = pagePoint(e);
    const orig = movable.map((x) => ({ el: x, x: x.x, y: x.y }));
    const b0 = movable.length ? bboxOf(movable) : null;
    const moving = new Set(movable.map((x) => x.id));
    let moved = false;
    beginDrag((ev) => {
      if (!movable.length) return;
      const p = pagePoint(ev); let dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * S.zoom < 3) return;
      moved = true;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      ({ dx, dy } = snapMove(b0, dx, dy, moving, ev.altKey));
      for (const o of orig) { o.el.x = o.x + dx; o.el.y = o.y + dy; renderEl(o.el); }
      updateSelection(); props.sync();
      if (S.doc.settings.autoExpand) applyPage();
    }, () => {
      clearGuides();
      if (moved) commit('move');
      else if (wasSelected && S.sel.size > 1) { S.sel = new Set(ids); updateSelection(); props.refresh(); }
    });
  }

  function startHandle(e, hd) {
    const el = selected()[0]; if (!el || selected().length !== 1 || el.locked) return;
    e.preventDefault(); e.stopPropagation();
    if (hd.classList.contains('rot')) {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      return beginDrag((ev) => {
        const p = pagePoint(ev);
        let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (a > 180) a -= 360;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        else { const n = Math.round(a / 45) * 45; if (Math.abs(a - n) < 3) a = n; }
        el.rot = round(a, 1); renderEl(el); updateSelection(); props.sync();
      }, () => commit('rotate'));
    }
    const dir = hd.dataset.dir;
    const hx = dir.includes('e') ? 1 : dir.includes('w') ? -1 : 0, hy = dir.includes('s') ? 1 : dir.includes('n') ? -1 : 0;
    const o = { x: el.x, y: el.y, w: el.w, h: el.h };
    const rad = ((el.rot || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const p0 = pagePoint(e);
    const proportional = (el.type === 'image' || el.type === 'emoji' || (el.type === 'shape' && el.kind !== 'frame' && el.kind !== 'rect' && el.kind !== 'ellipse')) && hx && hy;
    const textual = isText(el);
    beginDrag((ev) => {
      const p = pagePoint(ev), dx = p.x - p0.x, dy = p.y - p0.y;
      const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
      let nw = o.w + hx * lx, nh = o.h + hy * ly;
      if ((proportional !== ev.shiftKey) && hx && hy) {
        const sx = nw / o.w, sy = nh / o.h, s = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
        nw = o.w * s; nh = o.h * s;
      }
      nw = hx ? Math.max(MIN, nw) : o.w; nh = hy && !textual ? Math.max(MIN, nh) : o.h;
      const cxl = (hx * (nw - o.w)) / 2, cyl = (hy * (nh - o.h)) / 2;
      const cx = o.x + o.w / 2 + cxl * cos - cyl * sin, cy = o.y + o.h / 2 + cxl * sin + cyl * cos;
      el.w = round(nw, 1); el.h = round(nh, 1); el.x = round(cx - nw / 2, 1); el.y = round(cy - nh / 2, 1);
      renderEl(el); updateSelection(); props.sync();
      if (S.doc.settings.autoExpand) applyPage();
    }, () => commit('resize'));
  }

  function startMarquee(e) {
    const additive = e.shiftKey;
    const base = additive ? new Set(S.sel) : new Set();
    if (!additive) clearSelection();
    const p0 = pagePoint(e); let moved = false;
    beginDrag((ev) => {
      const p = pagePoint(ev), x = Math.min(p0.x, p.x), y = Math.min(p0.y, p.y), w = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y);
      if (!moved && Math.hypot(w, h) * S.zoom < 4) return;
      moved = true;
      Object.assign(marqueeEl.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      const hit = new Set(base);
      for (const el of S.doc.elements) {
        const a = aabb(el);
        if (a.x < x + w && a.x + a.w > x && a.y < y + h && a.y + a.h > y) groupIds(el).forEach((id) => hit.add(id));
      }
      S.sel = hit; updateSelection();
    }, () => { marqueeEl.style.display = 'none'; if (moved) props.refresh(); });
  }

  on(ws, 'dblclick', (e) => {
    const node = e.target.closest?.('.el'); if (!node) return;
    const el = byId(node.dataset.id); if (!el || el.locked) return;
    if (isText(el)) startTextEdit(el);
    else if (el.type === 'image') pickAsset({ kinds: ['image', 'gif'], title: el.assetId ? 'Replace image' : 'Choose an image' }).then((a) => { if (a) { select([el.id]); set({ assetId: a.id }, 'img'); } });
    else if (el.type === 'audio') pickAsset({ kinds: ['audio'], title: 'Choose audio' }).then((a) => { if (a) { select([el.id]); set({ assetId: a.id, title: el.title || a.name }, 'audio'); } });
  });

  on(ws, 'wheel', (e) => {
    e.preventDefault();
    const r = ws.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(S.zoom * Math.exp(-e.deltaY * 0.0018), e.clientX - r.left, e.clientY - r.top);
    else { S.panX -= e.deltaX; S.panY -= e.deltaY; applyView(); }
  }, { passive: false });

  /* ---------- drag & drop from tray / desktop ---------- */
  const hasDrop = (e) => { const t = [...(e.dataTransfer?.types || [])]; return t.includes(DRAG_TYPE) || t.includes('Files'); };
  let dropNode = null;
  on(ws, 'dragover', (e) => {
    if (!hasDrop(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; ws.classList.add('drop');
    const n = e.target.closest?.('.el'); const el = n && byId(n.dataset.id);
    const target = el && ((el.type === 'image' || el.type === 'audio') && !el.assetId) ? n : null;
    if (target !== dropNode) { dropNode?.classList.remove('drop-target'); dropNode = target; dropNode?.classList.add('drop-target'); }
  });
  on(ws, 'dragleave', (e) => { if (!ws.contains(e.relatedTarget)) { ws.classList.remove('drop'); dropNode?.classList.remove('drop-target'); dropNode = null; } });
  on(ws, 'drop', async (e) => {
    ws.classList.remove('drop'); dropNode?.classList.remove('drop-target');
    const target = dropNode; dropNode = null;
    if (!hasDrop(e)) return;
    e.preventDefault();
    const p = pagePoint(e), aid = e.dataTransfer.getData(DRAG_TYPE);
    if (aid) { const a = store.byId(aid); if (a) placeAsset(a, p, target); return; }
    const files = [...(e.dataTransfer.files || [])]; let i = 0;
    tray.upload(files, (a) => placeAsset(a, { x: p.x + 26 * i, y: p.y + 26 * i++ }));
  });
  on(document, 'paste', (e) => {
    if (e.target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^(image|audio)\//.test(f.type));
    if (files.length) { e.preventDefault(); tray.upload(files.map((f) => (f.name && /\.\w+$/.test(f.name) ? f : new File([f], 'pasted-' + Date.now() + '.' + (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg'), { type: f.type }))), (a) => placeAsset(a)); return; }
    if (pasteEls()) e.preventDefault();
  });

  /* ---------- context menu ---------- */
  on(ws, 'contextmenu', (e) => {
    e.preventDefault();
    if (e.target.closest('.addbar, .zoombox')) return;
    const node = e.target.closest?.('.el');
    if (node) { const el = byId(node.dataset.id); if (el && !S.sel.has(el.id)) select(groupIds(el)); }
    const els = selected(), has = els.length > 0, p = pagePoint(e);
    const locked = has && els.every((x) => x.locked);
    showMenu(e.clientX, e.clientY, has ? [
      { label: 'Duplicate', icon: 'copy', hint: 'Ctrl+D', onClick: duplicate },
      { label: 'Copy', hint: 'Ctrl+C', onClick: copy },
      { label: 'Paste', hint: 'Ctrl+V', onClick: () => pasteEls(p) },
      { sep: true },
      { label: 'Bring to front', icon: 'front', onClick: () => layer('front') },
      { label: 'Send to back', icon: 'back2', onClick: () => layer('back') },
      { sep: true },
      { label: locked ? 'Unlock' : 'Lock in place', icon: locked ? 'unlock' : 'lock', onClick: toggleLock },
      els.length > 1 ? { label: 'Group', icon: 'group', hint: 'Ctrl+G', onClick: group } : null,
      els.some((x) => x.groupId) ? { label: 'Ungroup', icon: 'ungroup', onClick: ungroup } : null,
      { sep: true },
      { label: 'Delete', icon: 'trash', danger: true, hint: 'Del', onClick: remove },
    ].filter(Boolean) : [
      { label: 'Paste here', hint: 'Ctrl+V', onClick: () => pasteEls(p) },
      { label: 'Add text here', icon: 'type', onClick: () => addEl('text', {}, { at: p, edit: true }) },
      { label: 'Add image…', icon: 'image', onClick: async () => { const a = await pickAsset(); if (a) placeAsset(a, p); } },
      { sep: true },
      { label: 'Select all', hint: 'Ctrl+A', onClick: () => select(S.doc.elements.map((x) => x.id)) },
    ]);
  });

  /* ---------- keyboard ---------- */
  const typing = (t) => t?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]');
  on(document, 'keydown', (e) => {
    if (document.querySelector('.overlay')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === ' ' && !typing(e.target)) { S.space = true; ws.classList.add('can-pan'); e.preventDefault(); return; }
    if (typing(e.target)) return;
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 'd') { e.preventDefault(); duplicate(); }
    else if (mod && k === 'c') { if (copy()) e.preventDefault(); }
    else if (mod && k === 'x') { if (copy()) { e.preventDefault(); remove(); } }
    else if (mod && k === 'a') { e.preventDefault(); select(S.doc.elements.map((x) => x.id)); }
    else if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroup() : group(); }
    else if (mod && k === '0') { e.preventDefault(); fitView(); }
    else if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomCenter(S.zoom * 1.2); }
    else if (mod && k === '-') { e.preventDefault(); zoomCenter(S.zoom / 1.2); }
    else if (mod && k === ']') { e.preventDefault(); layer('front'); }
    else if (mod && k === '[') { e.preventDefault(); layer('back'); }
    else if (!mod && k === ']') layer('forward');
    else if (!mod && k === '[') layer('backward');
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (S.sel.size) { e.preventDefault(); remove(); } }
    else if (e.key === 'Escape') clearSelection();
    else if (e.key === 'Enter' && S.sel.size === 1) { const el = selected()[0]; if (isText(el)) { e.preventDefault(); startTextEdit(el); } }
    else if (e.key.startsWith('Arrow') && S.sel.size) {
      e.preventDefault(); const d = e.shiftKey ? 10 : 1;
      nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
    }
  });
  on(document, 'keyup', (e) => { if (e.key === ' ') { S.space = false; ws.classList.remove('can-pan'); } });

  /* ============================================================ preview */
  async function openPreview() {
    endTextEdit();
    await flushSave();
    const widths = { desktop: '100%', tablet: '768px', phone: '390px' };
    const frame = h('iframe', { class: 'preview-frame', title: 'Page preview', src: `/preview/${pageId}?t=${Date.now()}` });
    const setDev = (d) => { frame.style.width = widths[d]; devBtns.forEach(([k, b]) => b.classList.toggle('on', k === d)); };
    const devBtns = [['desktop', 'monitor', 'Desktop'], ['tablet', 'tablet', 'Tablet'], ['phone', 'phone', 'Phone']].map(([k, ic, l]) => [k, h('button', { class: 'seg-b', type: 'button', title: l, onclick: () => setDev(k), html: icon(ic, 17) + ' ' + l })]);
    modal({
      title: 'Preview', wide: true, className: 'preview-modal',
      body: h('div', { class: 'preview' }, h('div', { class: 'preview-bar' }, h('div', { class: 'seg' }, devBtns.map(([, b]) => b)), h('span', { class: 'spacer' }),
        h('a', { class: 'btn small', href: `/preview/${pageId}`, target: '_blank', rel: 'noopener', html: icon('external', 14) + ' Open in new tab' })),
        h('div', { class: 'preview-stage' }, frame)),
    });
    setDev('desktop');
  }

  /* ============================================================ publish */
  async function openPublish() {
    endTextEdit();
    if (!(await flushSave())) return toast('Couldn’t save your latest changes. Fix that first, then publish.', 'error');
    const p = S.page;
    const origSlug = p.slug;
    const prefix = location.host + '/p/';
    const slugIn = h('input', { type: 'text', value: p.slug, maxLength: 40, 'aria-label': 'Page address', autocapitalize: 'off', spellcheck: false });
    const descIn = h('textarea', { rows: 3, maxLength: 300, placeholder: 'A short sentence shown when someone shares your link', 'aria-label': 'Description for sharing' }, p.description || '');
    let thumb = p.thumbnail || '';
    const thumbBox = h('div', { class: 'thumb-row' });
    const renderThumb = () => thumbBox.replaceChildren(
      thumb && store.byId(thumb) ? h('img', { src: '/f/' + thumb, alt: '' }) : h('div', { class: 'ph-mini' }, 'Auto'),
      h('div', { class: 'btnrow wrap' }, h('button', { class: 'btn small', type: 'button', onclick: async () => { const a = await pickAsset({ kinds: ['image', 'gif'], title: 'Preview image for sharing' }); if (a) { thumb = a.id; renderThumb(); } } }, thumb ? 'Change…' : 'Choose image…'),
        thumb ? h('button', { class: 'btn small', type: 'button', onclick: () => { thumb = ''; renderThumb(); } }, 'Remove') : null));
    renderThumb();
    const state = !p.published ? 'Not published yet — only you can see it.' : (p.hasChanges || changedSincePublish()) ? 'Live, with newer edits that visitors can’t see yet.' : 'Live and up to date.';
    const body = h('div', { class: 'pub' },
      h('p', { class: 'pub-state' + (p.published ? ' live' : '') }, state),
      h('label', { class: 'field-col' }, h('span', {}, 'Page address'), h('div', { class: 'slug' }, h('span', {}, prefix), slugIn)),
      h('label', { class: 'field-col' }, h('span', {}, 'Description for sharing'), descIn),
      h('div', { class: 'field-col' }, h('span', {}, 'Preview image for sharing'), thumbBox),
      p.published ? h('div', { class: 'linkrow' }, h('input', { type: 'text', readOnly: true, value: `${location.origin}/p/${p.slug}`, 'aria-label': 'Public link' }),
        h('button', { class: 'btn small', type: 'button', onclick: () => { navigator.clipboard?.writeText(`${location.origin}/p/${p.slug}`); toast('Link copied.'); } }, 'Copy'),
        h('a', { class: 'btn small', href: `/p/${p.slug}`, target: '_blank', rel: 'noopener' }, 'Open')) : null,
    );
    const m = modal({
      title: p.published ? 'Publish settings' : 'Publish your page', body,
      actions: [
        p.published ? { label: 'Unpublish', ghost: true, danger: true, onClick: async () => {
          if (!(await confirmDialog({ title: 'Unpublish this page?', message: 'The link will stop working until you publish again. Your design stays safe.', confirmLabel: 'Unpublish', danger: true }))) return false;
          try { Object.assign(S.page, (await api(`/pages/${pageId}/unpublish`, { method: 'POST' })).page); publishedJson = null; updatePublishBtn(); toast('Unpublished.'); } catch (e) { toast(e.message, 'error'); return false; }
        } } : null,
        { label: 'Cancel', ghost: true },
        { label: p.published ? 'Publish updates' : 'Publish', primary: true, onClick: async () => {
          const newSlug = slugIn.value.trim().toLowerCase();
          if (p.published && newSlug !== origSlug && !(await confirmDialog({ title: 'Change the address?', message: `Anyone with the old link (/p/${origSlug}) will no longer find this page.`, confirmLabel: 'Change address', danger: true }))) return false;
          queueMeta({ slug: newSlug, description: descIn.value, thumbnail: thumb });
          if (!(await flushSave()) || S.page.slug !== newSlug) { slugIn.focus(); return false; }
          try {
            const res = await api(`/pages/${pageId}/publish`, { method: 'POST' });
            Object.assign(S.page, res.page); publishedJson = JSON.stringify(S.doc); updatePublishBtn();
            setTimeout(() => showPublished(res.url), 80);
          } catch (e) { toast(e.message, 'error'); return false; }
        } },
      ].filter(Boolean),
    });
    return m;
  }
  function showPublished(path) {
    const full = location.origin + path;
    modal({
      title: '🎉 Your page is live',
      body: h('div', { class: 'pub' }, h('p', {}, 'Anyone with this link can see it — no account needed.'),
        h('div', { class: 'linkrow' }, h('input', { type: 'text', readOnly: true, value: full, 'aria-label': 'Public link', autofocus: true }),
          h('button', { class: 'btn small primary', type: 'button', onclick: () => { navigator.clipboard?.writeText(full).then(() => toast('Link copied.')); } }, 'Copy link')),
        h('p', { class: 'small-note' }, 'You can keep editing. Visitors only see changes when you press “Publish updates”.')),
      actions: [{ label: 'Close', ghost: true }, { label: 'Open my page', primary: true, onClick: () => { window.open(path, '_blank', 'noopener'); return false; } }],
    });
  }

  /* ============================================================ help */
  function showShortcuts() {
    const rows = [['Undo / Redo', 'Ctrl+Z / Ctrl+Shift+Z'], ['Duplicate', 'Ctrl+D'], ['Copy / Cut / Paste', 'Ctrl+C / X / V'], ['Delete', 'Delete or Backspace'], ['Select all', 'Ctrl+A'], ['Group / Ungroup', 'Ctrl+G / Ctrl+Shift+G'],
      ['Nudge (×10)', 'Arrow keys (+Shift)'], ['Layer up / down', '] and ['], ['To front / back', 'Ctrl+] / Ctrl+['], ['Edit text', 'Double-click or Enter'], ['Pan', 'Space + drag, or scroll'], ['Zoom', 'Ctrl + scroll, Ctrl +/−'], ['Fit page', 'Ctrl+0'], ['Straight-line move', 'Hold Shift while dragging'], ['Ignore snapping', 'Hold Alt while dragging'], ['Rotate in 15° steps', 'Hold Shift on rotate handle'], ['Resize freely / proportionally', 'Hold Shift on a corner']];
    modal({ title: 'Keyboard shortcuts', body: h('table', { class: 'keys' }, rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, h('kbd', {}, b))))), actions: [{ label: 'Done', primary: true }] });
  }
  function showTour() {
    const steps = [
      ['1', 'Fill your tray', 'Drop pictures, GIFs or music into the Assets tray on the left. They stay there so you can reuse them on any page.', 'upload'],
      ['2', 'Drag onto the page', 'Drag a thumbnail onto the page. Move it, resize it from the corners, rotate it with the little handle on top. Right-click for more.', 'move'],
      ['3', 'Add words & stickers', 'Use the toolbar above the page for text, links, shapes and emoji. Double-click text to type.', 'type'],
      ['4', 'Preview and publish', 'Check it on a phone with Preview, then hit Publish for a link you can share. Your work saves automatically.', 'globe'],
    ];
    let i = 0;
    const box = h('div', { class: 'tour' });
    const m = modal({ title: 'Welcome! Here’s how it works', body: box, actions: [] });
    const render = () => {
      const [n, t, d, ic] = steps[i];
      box.replaceChildren(h('div', { class: 'tour-ic', html: icon(ic, 34) }), h('div', { class: 'tour-n' }, `Step ${n} of ${steps.length}`), h('h3', {}, t), h('p', {}, d),
        h('div', { class: 'tour-dots' }, steps.map((_, k) => h('i', { class: k === i ? 'on' : '' }))),
        h('div', { class: 'tour-actions' }, i > 0 ? h('button', { class: 'btn ghost', onclick: () => { i--; render(); } }, 'Back') : h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Skip'),
          h('button', { class: 'btn primary', onclick: () => { if (i < steps.length - 1) { i++; render(); } else m.close(); } }, i < steps.length - 1 ? 'Next' : 'Start creating')));
    };
    render();
    try { localStorage.setItem('pb_onboarded', '1'); } catch { /* */ }
  }

  /* ============================================================ boot */
  renderAll(); applyView(); props.refresh(); syncUndo(); updatePublishBtn(); setStatus('saved');
  requestAnimationFrame(fitView);
  on(window, 'resize', () => { /* keep current view */ });
  publishedJson = S.page.published && !S.page.hasChanges ? JSON.stringify(S.doc) : null;

  // recover unsaved local backup (e.g. the tab crashed mid-save)
  try {
    const bk = JSON.parse(localStorage.getItem('pb_bk_' + pageId) || 'null');
    if (bk && bk.rev === S.page.rev && JSON.stringify(bk.doc) !== JSON.stringify(S.doc)) {
      confirmDialog({ title: 'Restore unsaved changes?', message: `We found changes from ${timeAgo(new Date(bk.at).toISOString())} that never finished saving. Restore them?`, confirmLabel: 'Restore', cancelLabel: 'Discard' }).then((ok) => {
        if (ok) { S.doc = bk.doc; renderAll(); props.refresh(); commit('restore'); toast('Restored.'); } else localStorage.removeItem('pb_bk_' + pageId);
      });
    } else localStorage.removeItem('pb_bk_' + pageId);
  } catch { /* */ }
  try { if (!localStorage.getItem('pb_onboarded') && !S.doc.elements.length) setTimeout(showTour, 350); } catch { /* */ }

  return () => {
    endDrag(); closeMenu();
    clearTimeout(saveTimer); clearTimeout(retryTimer); clearTimeout(backupTimer);
    disposers.forEach((f) => f());
  };
}
