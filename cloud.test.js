// Verifies cloud mode (Supabase REST + Storage) against a tiny fake Supabase server.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
const kv = {}, files = {};
const fake = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.headers.apikey !== 'k' || req.headers.authorization !== 'Bearer k') { res.writeHead(401); return res.end('no'); }
    const u = req.url;
    if (u.startsWith('/rest/v1/kv') && req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(kv.main ? [{ data: kv.main }] : [])); }
    if (u.startsWith('/rest/v1/kv') && req.method === 'POST') { const j = JSON.parse(body); kv[j.id] = j.data; res.writeHead(201); return res.end(); }
    const m = u.match(/^\/storage\/v1\/object\/assets\/(.+)$/);
    if (m && req.method === 'POST') { files[m[1]] = body; res.writeHead(200); return res.end('{}'); }
    if (m && req.method === 'DELETE') { delete files[m[1]]; res.writeHead(200); return res.end('{}'); }
    res.writeHead(404); res.end();
  });
}).listen(0);
await new Promise((r) => fake.once('listening', r));
const sbPort = fake.address().port, port = 4100 + Math.floor(Math.random() * 90), base = `http://localhost:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = () => spawn('node', ['server.js'], { env: { ...process.env, PORT: port, DATA_DIR: '/tmp/pb-cloud-' + port, SUPABASE_URL: `http://localhost:${sbPort}`, SUPABASE_SERVICE_KEY: 'k' }, stdio: 'inherit' });
const wait = async () => { for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/me'); return; } catch { await sleep(100); } } };
let srv = start(), cookie = '';
const call = async (m, u, b) => { const r = await fetch(base + u, { method: m, redirect: 'manual', headers: { cookie, ...(b && !(b instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: b instanceof FormData ? b : b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j, headers: r.headers }; };
try {
  await wait();
  (await call('POST', '/api/setup', { username: 'owner', password: 'password123' }));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const f = new FormData(); f.append('files', new Blob([PNG]), 'a.png');
  const up = await call('POST', '/api/assets', f); if (!up.body.assets) console.error(up); const a = up.body.assets[0];
  assert.equal(Object.keys(files).length, 1, 'file stored in Supabase');
  const r = await call('GET', `/f/${a.id}`);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), `http://localhost:${sbPort}/storage/v1/object/public/assets/${a.id}.png`);
  const p = (await call('POST', '/api/pages', { title: 'Cloud' })).body.page;
  await call('PUT', `/api/pages/${p.id}`, { rev: p.rev, doc: { settings: {}, elements: [{ id: 'i', type: 'image', assetId: a.id, x: 0, y: 0, w: 50, h: 50 }] } });
  await call('POST', `/api/pages/${p.id}/publish`);
  srv.kill(); await sleep(400); cookie = '';              // simulate the free host restarting with an empty disk
  srv = start(); await wait();
  const pub = await call('GET', '/p/cloud');
  assert.equal(pub.status, 200); assert.match(pub.body, new RegExp(`/f/${a.id}`));
  assert.match(pub.headers.get('content-security-policy'), new RegExp(`img-src 'self' data: http://localhost:${sbPort}`));
  await call('POST', '/api/login', { username: 'owner', password: 'password123' });
  assert.equal((await call('DELETE', `/api/assets/${a.id}?force=published`)).status, 200);
  await sleep(200); assert.equal(Object.keys(files).length, 0, 'file removed from Supabase');
  console.log('cloud mode ✓ (storage, redirect, restart persistence, delete)');
} catch (e) { console.error('cloud mode ✗', e); process.exitCode = 1; } finally { srv.kill(); fake.close(); }
