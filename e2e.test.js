// End-to-end API test: setup → login → upload → page save → publish → public fetch → protections.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-test-'));
const port = 3900 + Math.floor(Math.random() * 90);
const base = `http://localhost:${port}`;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: port, DATA_DIR: dir }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
async function call(method, url, body, { raw = false, headers = {} } = {}) {
  const res = await fetch(base + url, { method, headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), cookie, ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, body: j, headers: res.headers };
}
// 1x1 transparent PNG and a tiny GIF
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const form = (name, buf, type) => { const f = new FormData(); f.append('files', new Blob([buf], { type }), name); return f; };

let passed = 0;
const ok = (name, fn) => fn().then(() => { passed++; console.log('  ✓', name); }).catch((e) => { console.error('  ✗', name, '\n', e); process.exitCode = 1; });

try {
  for (let i = 0; i < 40; i++) { try { await fetch(base + '/api/me'); break; } catch { await sleep(100); } }
  console.log('Profile Builder e2e');

  await ok('first run needs setup; editor API is private', async () => {
    assert.equal((await call('GET', '/api/me')).body.needsSetup, true);
    assert.equal((await call('GET', '/api/pages')).status, 401);
  });
  await ok('owner setup + login', async () => {
    assert.equal((await call('POST', '/api/setup', { username: 'owner', password: 'short' })).status, 400);
    assert.equal((await call('POST', '/api/setup', { username: 'owner', password: 'password123' })).status, 200);
    assert.equal((await call('GET', '/api/me')).body.user.username, 'owner');
  });
  let png, gif, page;
  await ok('upload PNG + GIF; reject fake and SVG files', async () => {
    png = (await call('POST', '/api/assets', form('sticker.png', PNG, 'image/png'))).body.assets[0];
    gif = (await call('POST', '/api/assets', form('wiggle.gif', GIF, 'image/gif'))).body.assets[0];
    assert.equal(png.kind, 'image'); assert.equal(gif.kind, 'gif');
    const bad = await call('POST', '/api/assets', form('evil.png', Buffer.from('<svg onload=alert(1)>'), 'image/png'));
    assert.equal(bad.status, 400);
    const bad2 = await call('POST', '/api/assets', form('x.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'));
    assert.equal(bad2.status, 400);
    assert.equal((await call('GET', '/api/assets')).body.assets.length, 2);
  });
  await ok('uploaded files are public and served with safe headers (GIF intact)', async () => {
    const r = await fetch(`${base}/f/${gif.id}`);
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/gif');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), GIF);
  });
  await ok('create page, autosave doc with image + text, survives reload', async () => {
    page = (await call('POST', '/api/pages', { title: 'Hello World' })).body.page;
    assert.equal(page.slug, 'hello-world');
    const doc = { settings: { bg: '#ffeeee', width: 960, height: 800 }, elements: [
      { id: 'a1', type: 'image', assetId: png.id, x: 40, y: 40, w: 200, h: 200 },
      { id: 't1', type: 'text', text: '<script>alert(1)</script> Hi & bye', x: 300, y: 60, w: 300, h: 40, size: 30, color: 'red; background:url(javascript:1)' },
      { id: 'l1', type: 'link', text: 'bad', href: 'javascript:alert(1)', x: 0, y: 0, w: 100, h: 30 },
    ] };
    const put = await call('PUT', `/api/pages/${page.id}`, { doc, rev: page.rev });
    assert.equal(put.status, 200);
    const got = (await call('GET', `/api/pages/${page.id}`)).body.page;
    assert.equal(got.doc.elements.length, 3);
    assert.equal(got.doc.elements[1].color, '#111111', 'malicious colour replaced');
    assert.equal(got.doc.elements[2].href, '', 'javascript: link removed');
    page = got;
  });
  await ok('stale revision is rejected (no silent overwrite)', async () => {
    const r = await call('PUT', `/api/pages/${page.id}`, { doc: page.doc, rev: 1 });
    assert.equal(r.status, 409);
  });
  await ok('unpublished page is not public', async () => {
    assert.equal((await call('GET', '/p/hello-world')).status, 404);
  });
  await ok('publish → public URL works without login and is escaped', async () => {
    assert.equal((await call('POST', `/api/pages/${page.id}/publish`)).status, 200);
    const saved = cookie; cookie = '';
    const r = await call('GET', '/p/hello-world');
    assert.equal(r.status, 200);
    assert.match(r.body, new RegExp(`/f/${png.id}`));
    assert.ok(!r.body.includes('<script>alert(1)'), 'text escaped');
    assert.match(r.body, /&lt;script&gt;/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(r.body, /width=device-width/);
    assert.equal((await call('GET', `/preview/${page.id}`)).status, 401);
    cookie = saved;
  });
  await ok('editing a published page does not change what visitors see until republish', async () => {
    const doc = { ...page.doc, elements: page.doc.elements.concat([{ id: 'n1', type: 'text', text: 'NEWTEXT', x: 0, y: 300, w: 200, h: 30 }]) };
    const cur = (await call('GET', `/api/pages/${page.id}`)).body.page;
    await call('PUT', `/api/pages/${page.id}`, { doc, rev: cur.rev });
    assert.ok(!(await call('GET', '/p/hello-world')).body.includes('NEWTEXT'));
    const meta = (await call('GET', '/api/pages')).body.pages[0];
    assert.equal(meta.hasChanges, true);
    await call('POST', `/api/pages/${page.id}/publish`);
    assert.ok((await call('GET', '/p/hello-world')).body.includes('NEWTEXT'));
    assert.equal((await call('GET', '/p/hello-world')).status, 200);
  });
  await ok('slug is unique and can change without recreating page', async () => {
    const p2 = (await call('POST', '/api/pages', { title: 'Hello World' })).body.page;
    assert.equal(p2.slug, 'hello-world-2');
    const cur = (await call('GET', `/api/pages/${p2.id}`)).body.page;
    assert.equal((await call('PUT', `/api/pages/${p2.id}`, { slug: 'hello-world', rev: cur.rev })).status, 400);
    assert.equal((await call('PUT', `/api/pages/${p2.id}`, { slug: 'api', rev: cur.rev })).status, 400);
    assert.equal((await call('PUT', `/api/pages/${p2.id}`, { slug: 'my-own', rev: cur.rev })).status, 200);
  });
  await ok('templates create pages; user templates can be saved', async () => {
    const t = (await call('GET', '/api/templates')).body;
    assert.ok(t.builtin.length >= 7);
    const p = (await call('POST', '/api/pages', { title: 'From tpl', templateId: 'scrapbook' })).body.page;
    assert.ok(p.doc.elements.length > 5);
    const mine = await call('POST', '/api/templates', { name: 'Mine', doc: p.doc });
    assert.equal(mine.status, 200);
    assert.equal((await call('GET', '/api/templates')).body.mine.length, 1);
  });
  await ok('duplicate page is an unpublished copy', async () => {
    const d = (await call('POST', `/api/pages/${page.id}/duplicate`)).body.page;
    assert.equal(d.published, false); assert.notEqual(d.slug, page.slug);
  });
  await ok('deleting an asset used by a published page is blocked, then needs explicit confirmation', async () => {
    const r1 = await call('DELETE', `/api/assets/${png.id}`);
    assert.equal(r1.status, 409); assert.ok(r1.body.usage.some((u) => u.published));
    const r2 = await call('DELETE', `/api/assets/${png.id}?force=1`);
    assert.equal(r2.status, 409); assert.equal(r2.body.needsPublishedConfirm, true);
    assert.equal((await fetch(`${base}/f/${png.id}`)).status, 200, 'still served');
  });
  await ok('unused assets are listed and deletable freely', async () => {
    const un = (await call('GET', '/api/assets-unused')).body.assets;
    assert.ok(un.some((a) => a.id === gif.id));
    assert.equal((await call('DELETE', `/api/assets/${gif.id}`)).status, 200);
    assert.equal((await fetch(`${base}/f/${gif.id}`)).status, 404);
  });
  await ok('forced delete of published asset works after confirmation', async () => {
    assert.equal((await call('DELETE', `/api/assets/${png.id}?force=published`)).status, 200);
  });
  await ok('rename + collections', async () => {
    const a = (await call('POST', '/api/assets', form('b.png', PNG, 'image/png'))).body.assets[0];
    await call('POST', '/api/folders', { name: 'Stickers' });
    const r = await call('PATCH', `/api/assets/${a.id}`, { name: 'Renamed', folder: 'Stickers' });
    assert.equal(r.body.asset.name, 'Renamed'); assert.equal(r.body.asset.folder, 'Stickers');
    assert.ok((await call('GET', '/api/assets')).body.folders.includes('Stickers'));
  });
  await ok('custom HTML block is served only in a locked-down sandbox CSP, never inline in the page', async () => {
    const cur = (await call('GET', `/api/pages/${page.id}`)).body.page;
    const doc = { ...cur.doc, elements: [{ id: 'h1', type: 'html', code: '<b id=x>hi</b><script>1</script>', x: 0, y: 0, w: 200, h: 100 }] };
    await call('PUT', `/api/pages/${page.id}`, { doc, rev: cur.rev });
    await call('POST', `/api/pages/${page.id}/publish`);
    const saved = cookie; cookie = '';
    const pub = await call('GET', '/p/hello-world');
    assert.ok(!pub.body.includes('<b id=x>'), 'html code not inlined in the public page');
    assert.match(pub.body, /sandbox="allow-scripts"/);
    const emb = await call('GET', `/embed-html/${page.id}/h1`);
    assert.equal(emb.status, 200);
    assert.match(emb.headers.get('content-security-policy'), /sandbox allow-scripts/);
    assert.match(emb.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.equal((await call('GET', `/embed-html/${page.id}/h1?draft=1`)).status, 404, 'draft embeds need login');
    cookie = saved;
  });
  await ok('embed urls: https only, known providers normalised', async () => {
    const cur = (await call('GET', `/api/pages/${page.id}`)).body.page;
    const doc = { ...cur.doc, elements: [
      { id: 'e1', type: 'embed', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', x: 0, y: 0, w: 300, h: 200 },
      { id: 'e2', type: 'embed', url: 'javascript:alert(1)', x: 0, y: 0, w: 300, h: 200 },
      { id: 'e3', type: 'embed', url: 'http://insecure.example', x: 0, y: 0, w: 300, h: 200 },
    ] };
    await call('PUT', `/api/pages/${page.id}`, { doc, rev: cur.rev });
    const g = (await call('GET', `/api/pages/${page.id}`)).body.page.doc.elements;
    assert.equal(g[1].url, ''); assert.equal(g[2].url, '');
    await call('POST', `/api/pages/${page.id}/publish`);
    assert.match((await call('GET', '/p/hello-world')).body, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  });
  await ok('owner/editor model: max 5 users, editors cannot see others’ pages', async () => {
    for (const n of ['ed1', 'ed2', 'ed3', 'ed4']) assert.equal((await call('POST', '/api/users', { username: n, password: 'password123' })).status, 200);
    assert.equal((await call('POST', '/api/users', { username: 'ed5', password: 'password123' })).status, 400);
    await call('POST', '/api/logout'); cookie = '';
    assert.equal((await call('POST', '/api/login', { username: 'ed1', password: 'wrong-password' })).status, 401);
    assert.equal((await call('POST', '/api/login', { username: 'ed1', password: 'password123' })).status, 200);
    assert.equal((await call('GET', `/api/pages/${page.id}`)).status, 404);
    assert.equal((await call('GET', '/api/users')).status, 403);
    cookie = '';
    assert.equal((await call('POST', '/api/login', { username: 'owner', password: 'password123' })).status, 200);
  });
  await ok('page deletion removes it and its public URL', async () => {
    assert.equal((await call('DELETE', `/api/pages/${page.id}`)).status, 200);
    assert.equal((await call('GET', '/p/hello-world')).status, 404);
  });
  await ok('data persists across a server restart', async () => {
    const before = (await call('GET', '/api/pages')).body.pages.length;
    srv.kill(); await sleep(400);
    const srv2 = spawn('node', ['server.js'], { env: { ...process.env, PORT: port, DATA_DIR: dir }, stdio: 'inherit' });
    for (let i = 0; i < 40; i++) { try { await fetch(base + '/api/me'); break; } catch { await sleep(100); } }
    const cur = await call('GET', '/api/pages');
    assert.equal(cur.status, 200, 'session survived');
    assert.equal(cur.body.pages.length, before);
    srv2.kill();
  });
} finally {
  srv.kill();
  console.log(`\n${passed} checks passed${process.exitCode ? ' — SOME FAILED' : ''}`);
  fs.rmSync(dir, { recursive: true, force: true });
}
