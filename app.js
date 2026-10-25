// App shell: auth, page list ("My pages"), template picker, account menu, hash router.
import { h, icon, iconBtn, toast, modal, confirmDialog, promptDialog, showMenu, menuBelow, timeAgo } from './ui.js';
import { api } from './api.js';
import { mountEditor } from './editor.js';
import { elementStyle, elementInner, bgStyle, docHeight } from '/shared/render.js';

const root = document.getElementById('app');
let me = null, cleanup = null;

const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
async function route() {
  cleanup?.(); cleanup = null;
  const m = location.hash.match(/^#\/edit\/([\w-]+)/);
  if (!me) return;
  if (m) { cleanup = await mountEditor(root, m[1], { goHome: () => go('#/'), goEdit: (id) => go('#/edit/' + id) }); return; }
  renderHome();
}
window.addEventListener('hashchange', route);

async function boot() {
  let st;
  try { st = await api('/me'); } catch { root.replaceChildren(h('div', { class: 'center-msg' }, 'Can’t reach the server.')); return; }
  if (st.user) { me = st.user; route(); } else renderAuth(st.needsSetup);
}

/* ------------------------------------------------------------------ auth */
function renderAuth(setup) {
  const user = h('input', { type: 'text', autocomplete: 'username', required: true, autofocus: true, placeholder: 'username' });
  const pass = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, placeholder: setup ? 'at least 8 characters' : 'password' });
  const err = h('div', { class: 'form-err', role: 'alert' });
  const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { const d = await api(setup ? '/setup' : '/login', { method: 'POST', body: { username: user.value, password: pass.value } }); me = d.user; if (!location.hash.startsWith('#/edit/')) location.hash = '#/'; route(); }
    catch (ex) { err.textContent = ex.message; }
  } },
  h('div', { class: 'logo' }, '✿'), h('h1', {}, setup ? 'Welcome! Let’s set up your studio' : 'Sign in'),
  h('p', { class: 'sub' }, setup ? 'Create the owner account. You can add up to 4 more editors later.' : 'Your pages are waiting.'),
  h('label', { class: 'field-col' }, h('span', {}, 'Username'), user), h('label', { class: 'field-col' }, h('span', {}, 'Password'), pass), err,
  h('button', { class: 'btn primary wide', type: 'submit' }, setup ? 'Create account' : 'Sign in'));
  root.replaceChildren(h('div', { class: 'auth' }, form));
}

/* ------------------------------------------------------------------ home */
async function renderHome() {
  root.replaceChildren(h('div', { class: 'center-msg' }, 'Loading…'));
  let pages;
  try { pages = (await api('/pages')).pages; } catch (e) { if (e.status === 401) { me = null; return renderAuth(false); } root.replaceChildren(h('div', { class: 'center-msg' }, e.message)); return; }
  const acct = iconBtn('user', 'Account', () => menuBelow(acct, [
    { label: `Signed in as ${me.username}`, disabled: true },
    { sep: true },
    me.role === 'owner' ? { label: 'People…', icon: 'user', onClick: peopleDialog } : null,
    { label: 'Change password…', onClick: passwordDialog },
    { label: 'Sign out', onClick: async () => { await api('/logout', { method: 'POST' }); me = null; renderAuth(false); } },
  ].filter(Boolean)));
  const grid = h('div', { class: 'cards' },
    h('button', { class: 'card new', type: 'button', onclick: newPageDialog }, h('div', { class: 'plus', html: icon('plus', 34) }), h('b', {}, 'New page'), h('small', {}, 'Start blank or from a template')),
    pages.map(pageCard));
  root.replaceChildren(h('div', { class: 'home' },
    h('header', { class: 'home-head' }, h('div', { class: 'brand' }, h('span', { class: 'logo sm' }, '✿'), 'Profile Builder'), h('span', { class: 'spacer' }), acct),
    h('main', {}, h('h1', {}, 'My pages'),
      pages.length ? null : h('p', { class: 'sub' }, 'Nothing here yet. Make your first page — it only takes a minute.'), grid)));
}
function pageCard(p) {
  const menu = iconBtn('more', 'Page options', (e) => { e.stopPropagation(); menuBelow(menu, [
    { label: 'Edit', icon: 'edit', onClick: () => go('#/edit/' + p.id) },
    p.published ? { label: 'Open public page', icon: 'external', onClick: () => window.open('/p/' + p.slug, '_blank', 'noopener') } : null,
    p.published ? { label: 'Copy link', icon: 'link', onClick: () => { navigator.clipboard?.writeText(`${location.origin}/p/${p.slug}`); toast('Link copied.'); } } : null,
    { label: 'Rename…', icon: 'edit', onClick: async () => { const t = await promptDialog({ title: 'Rename page', value: p.title, confirmLabel: 'Rename' }); if (t?.trim()) { try { await api('/pages/' + p.id, { method: 'PUT', body: { title: t } }); renderHome(); } catch (ex) { toast(ex.message, 'error'); } } } },
    { label: 'Duplicate', icon: 'copy', onClick: async () => { try { await api(`/pages/${p.id}/duplicate`, { method: 'POST' }); renderHome(); } catch (ex) { toast(ex.message, 'error'); } } },
    p.published ? { label: 'Unpublish', onClick: async () => { await api(`/pages/${p.id}/unpublish`, { method: 'POST' }); renderHome(); } } : null,
    { sep: true },
    { label: 'Delete…', icon: 'trash', danger: true, onClick: async () => {
      if (await confirmDialog({ title: `Delete “${p.title}”?`, message: p.published ? 'This page is live. Its link will stop working. This can’t be undone.' : 'This can’t be undone. Your uploaded assets are kept.', confirmLabel: 'Delete page', danger: true })) { await api('/pages/' + p.id, { method: 'DELETE' }); renderHome(); }
    } },
  ].filter(Boolean)); }, { class: 'card-menu' });
  const thumb = h('div', { class: 'card-thumb' }, h('iframe', { src: `/preview/${p.id}`, tabindex: -1, 'aria-hidden': 'true', loading: 'lazy', title: '' }));
  return h('div', { class: 'card', tabindex: 0, role: 'link', 'aria-label': `Edit ${p.title}`, onclick: () => go('#/edit/' + p.id), onkeydown: (e) => { if (e.key === 'Enter') go('#/edit/' + p.id); } },
    thumb, menu,
    h('div', { class: 'card-info' }, h('b', {}, p.title),
      h('small', {}, p.published ? h('span', { class: 'tag live' }, p.hasChanges ? 'live · unpublished edits' : 'live') : h('span', { class: 'tag' }, 'draft'), ' ', timeAgo(p.updatedAt))));
}

/* ------------------------------------------------------------------ new page / templates */
function miniPreview(doc) {
  const s = doc.settings, H = docHeight(doc), w = s.width, box = h('div', { class: 'mini-prev' });
  const page = h('div', { style: { position: 'relative', width: w + 'px', height: H + 'px', overflow: 'hidden', transformOrigin: 'top left' } });
  page.style.cssText += bgStyle(s);
  for (const el of doc.elements) {
    const n = h('div', { html: elementInner(el, { editor: true, pageId: '' }) });
    n.style.cssText = elementStyle(el, true); n.style.pointerEvents = 'none'; page.append(n);
  }
  box.append(page);
  requestAnimationFrame(() => { const k = box.clientWidth / w; page.style.transform = `scale(${k})`; box.style.height = H * k + 'px'; });
  return box;
}
async function newPageDialog() {
  let tpl;
  try { tpl = await api('/templates'); } catch (e) { return toast(e.message, 'error'); }
  const ref = {};
  const create = async (templateId, title) => {
    try { const d = await api('/pages', { method: 'POST', body: { templateId, title } }); ref.m.close(); go('#/edit/' + d.page.id); } catch (e) { toast(e.message, 'error'); }
  };
  const tile = (t, mine) => h('div', { class: 'tpl' },
    h('button', { class: 'tpl-b', type: 'button', onclick: () => create(t.id, t.name), title: t.description || t.name }, miniPreview(t.doc), h('b', {}, t.name), t.description ? h('small', {}, t.description) : null),
    mine ? h('button', { class: 'mini del', type: 'button', title: 'Delete template', 'aria-label': 'Delete template', html: icon('trash', 14), onclick: async (e) => { e.stopPropagation(); if (await confirmDialog({ title: 'Delete template?', message: `“${t.name}” will be removed. Pages made from it are not affected.`, confirmLabel: 'Delete', danger: true })) { await api('/templates/' + t.id, { method: 'DELETE' }); ref.m.close(); newPageDialog(); } } }) : null);
  const m = modal({ title: 'Start a new page', wide: true, className: 'tpl-modal', body: h('div', {},
    h('p', { class: 'sub' }, 'Pick a starting point — everything can be moved, changed or deleted.'),
    h('div', { class: 'tpl-grid' },
      h('div', { class: 'tpl' }, h('button', { class: 'tpl-b blank', type: 'button', onclick: () => create(null, 'My page') }, h('div', { class: 'blank-prev', html: icon('plus', 30) }), h('b', {}, 'Blank canvas'), h('small', {}, 'Start from nothing'))),
      tpl.mine.map((t) => tile(t, true)), tpl.builtin.map((t) => tile(t, false)))) });
  ref.m = m;
}

/* ------------------------------------------------------------------ account dialogs */
async function passwordDialog() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'at least 8 characters' }), err = h('div', { class: 'form-err' });
  modal({ title: 'Change password', body: h('div', {}, h('label', { class: 'field-col' }, h('span', {}, 'Current password'), cur), h('label', { class: 'field-col' }, h('span', {}, 'New password'), nw), err),
    actions: [{ label: 'Cancel', ghost: true }, { label: 'Change', primary: true, onClick: async () => { try { await api('/me/password', { method: 'POST', body: { current: cur.value, password: nw.value } }); toast('Password changed.'); } catch (e) { err.textContent = e.message; return false; } } }] });
}
async function peopleDialog() {
  const body = h('div', {});
  const draw = async () => {
    const { users, max } = await api('/users');
    const u = h('input', { type: 'text', placeholder: 'username', autocomplete: 'off' }), p = h('input', { type: 'text', placeholder: 'temporary password (8+)', autocomplete: 'off' }), err = h('div', { class: 'form-err' });
    body.replaceChildren(
      h('ul', { class: 'people' }, users.map((x) => h('li', {}, h('b', {}, x.username), h('span', { class: 'tag' }, x.role), x.role !== 'owner' ? h('button', { class: 'btn small danger', onclick: async () => { if (await confirmDialog({ title: `Remove ${x.username}?`, message: 'They lose access. Their pages and assets stay on the server.', confirmLabel: 'Remove', danger: true })) { await api('/users/' + x.id, { method: 'DELETE' }); draw(); } } }, 'Remove') : null))),
      users.length < max ? h('div', { class: 'add-user' }, h('h4', {}, 'Add an editor'), h('div', { class: 'two' }, u, p), err,
        h('button', { class: 'btn primary small', onclick: async () => { try { await api('/users', { method: 'POST', body: { username: u.value, password: p.value } }); draw(); } catch (e) { err.textContent = e.message; } } }, 'Add editor'),
        h('p', { class: 'small-note' }, 'Editors can build and publish their own pages. Share the password with them yourself.')) : h('p', { class: 'small-note' }, `You’ve reached the limit of ${max} people.`));
  };
  modal({ title: 'People', body, actions: [{ label: 'Done', primary: true }] });
  draw();
}

boot();
