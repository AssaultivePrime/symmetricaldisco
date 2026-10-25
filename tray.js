// Asset store + asset tray UI + asset picker dialog.
import { api, uploadFile, ApiError } from './api.js';
import { h, icon, iconBtn, toast, modal, confirmDialog, promptDialog, showMenu, menuBelow, fmtBytes } from './ui.js';

export const DRAG_TYPE = 'application/x-pb-asset';
const OK_EXT = /\.(png|jpe?g|webp|gif|mp3|ogg|wav)$/i;

/* ------------------------------------------------------------------ store (shared by tray + pickers) */
export const store = {
  assets: [], folders: [], used: 0, quota: 0, loaded: false, listeners: new Set(),
  async load() {
    const d = await api('/assets');
    Object.assign(this, { assets: d.assets, folders: d.folders, used: d.used, quota: d.quota, loaded: true });
    this.emit();
  },
  byId(id) { return this.assets.find((a) => a.id === id); },
  add(a) { this.assets.unshift(a); this.used += a.size; this.emit(); },
  patch(a) { const i = this.assets.findIndex((x) => x.id === a.id); if (i >= 0) this.assets[i] = a; this.emit(); },
  remove(id) { const a = this.byId(id); if (a) this.used -= a.size; this.assets = this.assets.filter((x) => x.id !== id); this.emit(); },
  emit() { this.listeners.forEach((fn) => fn()); },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
};

/** Upload a list of files with progress rows. onRow(row) lets the UI render; resolves with uploaded assets. */
export async function uploadFiles(files, { folder = '', onRow, onDone } = {}) {
  const results = [];
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      const row = { id: Math.random().toString(36).slice(2), name: file.name, progress: 0, error: '', file };
      onRow?.(row, 'add');
      if (!OK_EXT.test(file.name)) { row.error = 'Unsupported type. Use PNG, JPG, WebP, GIF, MP3, OGG or WAV.'; onRow?.(row, 'update'); continue; }
      const isAudio = /\.(mp3|ogg|wav)$/i.test(file.name);
      if (file.size > (isAudio ? 25 : 15) * 1048576) { row.error = `Too large (max ${isAudio ? 25 : 15} MB).`; onRow?.(row, 'update'); continue; }
      try {
        const a = await uploadFile(file, { folder, onProgress: (p) => { row.progress = p; onRow?.(row, 'update'); } });
        store.add(a);
        results.push(a);
        onRow?.(row, 'done');
        onDone?.(a);
      } catch (e) {
        row.error = e.message; onRow?.(row, 'update');
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return results;
}

/** Delete with usage protection. Resolves true if deleted. */
export async function deleteAsset(asset) {
  const attempt = async (force) => {
    try {
      await api(`/assets/${asset.id}${force ? '?force=' + force : ''}`, { method: 'DELETE' });
      store.remove(asset.id);
      toast(`Deleted “${asset.name}”.`);
      return true;
    } catch (e) {
      if (e.status === 409) return e;
      toast(e.message, 'error');
      return false;
    }
  };
  const usageList = (usage) => h('ul', { class: 'usage' }, usage.map((u) => h('li', {}, h('b', {}, u.title), u.published ? h('span', { class: 'tag live' }, 'published') : h('span', { class: 'tag' }, 'draft'))));
  const first = await attempt(null);
  if (first === true || first === false) return first;
  const ok1 = await confirmDialog({
    title: 'This asset is in use',
    message: h('div', {}, h('p', {}, `“${asset.name}” is used on:`), usageList(first.data.usage), h('p', {}, 'If you delete it, those spots will show a broken image.')),
    confirmLabel: 'Delete anyway', danger: true,
  });
  if (!ok1) return false;
  const second = await attempt('1');
  if (second === true || second === false) return second;
  const ok2 = await confirmDialog({
    title: 'Used by a published page',
    message: h('div', {}, h('p', {}, 'Visitors would see a broken image on:'), usageList(second.data.usage.filter((u) => u.published)), h('p', {}, h('b', {}, 'This cannot be undone.'))),
    confirmLabel: 'Delete from published pages too', danger: true,
  });
  if (!ok2) return false;
  const third = await attempt('published');
  return third === true;
}

const sortFns = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
  name: (a, b) => a.name.localeCompare(b.name),
  size: (a, b) => b.size - a.size,
};
const KIND_LABEL = { image: 'Images', gif: 'GIFs', audio: 'Audio' };

function thumb(a) {
  if (a.kind === 'audio') return h('div', { class: 'thumb audio', html: icon('music', 28) });
  return h('img', { class: 'thumb', src: a.url, alt: a.name, loading: 'lazy', draggable: false });
}

/* ------------------------------------------------------------------ tray */
export function createTray({ onAdd, getUsedIds, onCollapse }) {
  let q = '', kind = 'all', folder = '', sort = 'newest';
  const rows = new Map();
  const el = h('aside', { class: 'tray', 'aria-label': 'Asset tray' });
  const fileInput = h('input', { type: 'file', multiple: true, accept: '.png,.jpg,.jpeg,.webp,.gif,.mp3,.ogg,.wav,image/*,audio/*', hidden: true, onchange: () => { startUpload([...fileInput.files]); fileInput.value = ''; } });
  const uploadsEl = h('div', { class: 'uploads' });
  const toolsEl = h('div', { class: 'tray-tools' });
  const gridEl = h('div', { class: 'tray-grid', role: 'list' });
  const footEl = h('div', { class: 'tray-foot' });
  const searchInput = h('input', { type: 'search', placeholder: 'Search assets…', 'aria-label': 'Search assets', oninput: () => { q = searchInput.value.toLowerCase(); renderGrid(); } });

  const menuBtn = iconBtn('more', 'More actions', () => menuBelow(menuBtn, [
    { label: 'New collection…', icon: 'folder', onClick: newCollection },
    { label: 'Remove unused assets…', icon: 'trash', onClick: cleanUnused },
  ]));
  el.append(
    h('div', { class: 'tray-head' },
      h('h3', {}, 'Assets'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small primary', type: 'button', title: 'Upload images, GIFs or audio', onclick: () => fileInput.click(), html: icon('upload', 15) + ' Upload' }),
      menuBtn,
      iconBtn('left', 'Collapse tray', () => onCollapse?.()),
    ),
    uploadsEl, toolsEl, gridEl, footEl, fileInput,
  );

  async function newCollection() {
    const name = await promptDialog({ title: 'New collection', label: 'Name (e.g. Stickers, Backgrounds)', confirmLabel: 'Create' });
    if (!name?.trim()) return;
    try { await api('/folders', { method: 'POST', body: { name } }); await store.load(); folder = name.trim().slice(0, 40); renderAll(); } catch (e) { toast(e.message, 'error'); }
  }
  async function cleanUnused() {
    let list;
    try { list = (await api('/assets-unused')).assets; } catch (e) { return toast(e.message, 'error'); }
    if (!list.length) return toast('Every asset is used on a page. Nothing to clean up.');
    const ok = await confirmDialog({
      title: `Remove ${list.length} unused asset${list.length > 1 ? 's' : ''}?`,
      message: h('div', {}, h('p', {}, 'These are not used on any page (draft or published):'), h('div', { class: 'mini-grid' }, list.slice(0, 24).map((a) => thumb(a)))),
      confirmLabel: 'Remove them', danger: true,
    });
    if (!ok) return;
    let n = 0;
    for (const a of list) { try { await api(`/assets/${a.id}`, { method: 'DELETE' }); store.remove(a.id); n++; } catch { /* in use meanwhile */ } }
    toast(`Removed ${n} unused asset${n === 1 ? '' : 's'}.`);
  }

  function startUpload(files, cb) {
    if (!files.length) return Promise.resolve([]);
    return uploadFiles(files, {
      folder, onDone: cb,
      onRow: (row, ev) => {
        let node = rows.get(row.id);
        if (ev === 'done') { node?.remove(); rows.delete(row.id); return; }
        if (!node) { node = h('div', { class: 'up-row' }); rows.set(row.id, node); uploadsEl.append(node); }
        node.className = 'up-row' + (row.error ? ' err' : '');
        node.replaceChildren(
          h('div', { class: 'up-name' }, row.name),
          row.error
            ? h('div', { class: 'up-msg' }, row.error, ' ', h('button', { class: 'link', onclick: () => { node.remove(); rows.delete(row.id); } }, 'Dismiss'))
            : h('div', { class: 'bar' }, h('i', { style: { width: Math.round(row.progress * 100) + '%' } })),
        );
      },
    });
  }

  function filtered() {
    return store.assets
      .filter((a) => (kind === 'all' || a.kind === kind) && (!folder || a.folder === folder) && (!q || a.name.toLowerCase().includes(q)))
      .sort(sortFns[sort]);
  }

  function renderTools() {
    const counts = { all: store.assets.length };
    for (const a of store.assets) counts[a.kind] = (counts[a.kind] || 0) + 1;
    if (kind !== 'all' && !counts[kind]) kind = 'all';
    const chips = ['all', 'image', 'gif', 'audio'].filter((k) => k === 'all' || counts[k]).map((k) =>
      h('button', { class: 'chip' + (kind === k ? ' on' : ''), type: 'button', onclick: () => { kind = k; renderAll(); } }, k === 'all' ? 'All' : KIND_LABEL[k], h('small', {}, counts[k] || 0)));
    toolsEl.replaceChildren(
      h('div', { class: 'search', html: icon('search', 15) }, searchInput),
      store.assets.length ? h('div', { class: 'chips' }, chips) : null,
      store.assets.length ? h('div', { class: 'sel-row' },
        store.folders.length ? h('select', { 'aria-label': 'Collection', onchange: (e) => { folder = e.target.value; renderGrid(); } },
          h('option', { value: '' }, 'All collections'), store.folders.map((f) => h('option', { value: f, selected: f === folder }, f))) : null,
        h('select', { 'aria-label': 'Sort', onchange: (e) => { sort = e.target.value; renderGrid(); } },
          [['newest', 'Newest'], ['oldest', 'Oldest'], ['name', 'Name A–Z'], ['size', 'Largest']].map(([v, l]) => h('option', { value: v, selected: v === sort }, l))),
      ) : null,
    );
  }

  function assetMenu(a, x, y) {
    showMenu(x, y, [
      { label: 'Add to page', icon: 'plus', onClick: () => onAdd?.(a) },
      { label: 'Rename…', icon: 'edit', onClick: async () => {
        const name = await promptDialog({ title: 'Rename asset', value: a.name, confirmLabel: 'Rename' });
        if (!name?.trim()) return;
        try { store.patch((await api(`/assets/${a.id}`, { method: 'PATCH', body: { name } })).asset); } catch (e) { toast(e.message, 'error'); }
      } },
      { label: 'Move to collection…', icon: 'folder', onClick: () => moveDialog(a) },
      { sep: true },
      { label: 'Delete…', icon: 'trash', danger: true, onClick: () => deleteAsset(a) },
    ]);
  }
  function moveDialog(a) {
    const sel = h('select', {}, h('option', { value: '' }, '— None —'), store.folders.map((f) => h('option', { value: f, selected: f === a.folder }, f)), h('option', { value: '__new' }, '+ New collection…'));
    modal({
      title: 'Move to collection', body: h('label', { class: 'field-col' }, h('span', {}, 'Collection'), sel),
      actions: [{ label: 'Cancel', ghost: true }, { label: 'Move', primary: true, onClick: async () => {
        let f = sel.value;
        if (f === '__new') { f = (await promptDialog({ title: 'New collection', label: 'Name', confirmLabel: 'Create' }))?.trim() || ''; if (!f) return false; await api('/folders', { method: 'POST', body: { name: f } }); }
        try { store.patch((await api(`/assets/${a.id}`, { method: 'PATCH', body: { folder: f } })).asset); await store.load(); } catch (e) { toast(e.message, 'error'); }
      } }],
    });
  }

  function renderGrid() {
    const list = filtered();
    const used = getUsedIds?.() || new Set();
    if (!store.assets.length) {
      gridEl.className = 'tray-grid empty';
      gridEl.replaceChildren(h('div', { class: 'empty-state' },
        h('div', { class: 'big', html: icon('image', 40) }),
        h('b', {}, 'Your sticker box is empty'),
        h('p', {}, 'Drag images, GIFs or music here — or click Upload. Everything you add stays here to reuse on any page.'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => fileInput.click() }, 'Choose files')));
    } else if (!list.length) {
      gridEl.className = 'tray-grid empty';
      gridEl.replaceChildren(h('div', { class: 'empty-state' }, h('p', {}, 'Nothing matches. Try another search or filter.')));
    } else {
      gridEl.className = 'tray-grid';
      gridEl.replaceChildren(...list.map((a) => {
        const node = h('div', {
          class: 'asset', role: 'listitem', draggable: true, tabindex: 0, title: `${a.name}\nDrag onto the page, or double-click to add`,
          ondragstart: (e) => { e.dataTransfer.setData(DRAG_TYPE, a.id); e.dataTransfer.setData('text/plain', a.name); e.dataTransfer.effectAllowed = 'copy'; node.classList.add('dragging'); },
          ondragend: () => node.classList.remove('dragging'),
          ondblclick: () => onAdd?.(a),
          onkeydown: (e) => { if (e.key === 'Enter') onAdd?.(a); },
          oncontextmenu: (e) => { e.preventDefault(); assetMenu(a, e.clientX, e.clientY); },
        },
        thumb(a),
        used.has(a.id) ? h('span', { class: 'badge', title: 'Used on this page', html: icon('check', 11) }) : null,
        h('button', { class: 'mini add', type: 'button', title: 'Add to page', 'aria-label': `Add ${a.name} to page`, html: icon('plus', 14), onclick: (e) => { e.stopPropagation(); onAdd?.(a); } }),
        h('button', { class: 'mini more', type: 'button', title: 'More', 'aria-label': `More actions for ${a.name}`, html: icon('more', 14), onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); assetMenu(a, r.left, r.bottom + 4); } }),
        h('div', { class: 'aname' }, a.name));
        return node;
      }));
    }
    footEl.replaceChildren(
      h('div', { class: 'quota' }, h('i', { style: { width: Math.min(100, (store.used / (store.quota || 1)) * 100) + '%' } })),
      h('span', {}, `${store.assets.length} item${store.assets.length === 1 ? '' : 's'} · ${fmtBytes(store.used)} of ${fmtBytes(store.quota)}`),
    );
  }
  function renderAll() { renderTools(); renderGrid(); }

  // Drag files from the computer onto the tray
  el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('dragover'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('dragover'); });
  el.addEventListener('drop', (e) => {
    el.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) { e.preventDefault(); startUpload([...e.dataTransfer.files]); }
  });

  store.on(renderAll);
  renderAll();
  return { el, refresh: renderGrid, upload: startUpload, openFileDialog: () => fileInput.click() };
}

/* ------------------------------------------------------------------ picker dialog */
/** Pick an asset of the given kinds. Resolves with asset or null. */
export function pickAsset({ kinds = ['image', 'gif'], title = 'Choose an image' } = {}) {
  return new Promise((resolve) => {
    let picked = null, q = '';
    const grid = h('div', { class: 'tray-grid picker-grid' });
    const input = h('input', { type: 'search', placeholder: 'Search…', oninput: () => { q = input.value.toLowerCase(); render(); } });
    const fileInput = h('input', { type: 'file', hidden: true, accept: kinds.includes('audio') ? '.mp3,.ogg,.wav,audio/*' : '.png,.jpg,.jpeg,.webp,.gif,image/*', onchange: async () => {
      const [a] = await uploadFiles([...fileInput.files]); fileInput.value = '';
      if (a && kinds.includes(a.kind)) { picked = a; m.close(a); }
    } });
    const m = modal({
      title, wide: true, className: 'picker',
      body: h('div', {}, h('div', { class: 'picker-bar' }, h('div', { class: 'search', html: icon('search', 15) }, input), h('button', { class: 'btn small', type: 'button', onclick: () => fileInput.click(), html: icon('upload', 15) + ' Upload new' }), fileInput), grid),
      actions: [{ label: 'Cancel', ghost: true }],
      onClose: (r) => resolve(r?.id ? r : picked),
    });
    function render() {
      const list = store.assets.filter((a) => kinds.includes(a.kind) && (!q || a.name.toLowerCase().includes(q))).sort(sortFns.newest);
      grid.replaceChildren(...(list.length ? list.map((a) => h('button', { class: 'asset pick', type: 'button', title: a.name, onclick: () => { picked = a; m.close(a); } }, thumb(a), h('div', { class: 'aname' }, a.name)))
        : [h('div', { class: 'empty-state' }, h('p', {}, kinds.includes('audio') ? 'No audio yet — upload an MP3, OGG or WAV.' : 'No images yet — upload one to get started.'))]));
    }
    render();
  });
}
export { ApiError };
