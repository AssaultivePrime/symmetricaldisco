import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeDoc, pageHtml, esc, safeId, int } from './shared/render.js';
import { TEMPLATES } from './shared/templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_USERS = 5;
const QUOTA = (Number(process.env.USER_QUOTA_MB) || 500) * 1024 * 1024;
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_AUDIO = 25 * 1024 * 1024;
const SECURE = process.env.SECURE_COOKIES === '1';
const RESERVED = new Set(['api', 'p', 'f', 'preview', 'embed-html', 'public', 'shared', 'admin', 'login', 'static', 'assets', 'app', 'edit', 'new']);

for (const d of [DATA_DIR, UPLOAD_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

/* ------------------------------------------------------------------ database */
/* ---- optional cloud storage (Supabase): set SUPABASE_URL + SUPABASE_SERVICE_KEY.
   Without them everything is stored in ./data (fine locally, but free hosts wipe local disks). */
const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SB_BUCKET = process.env.SUPABASE_BUCKET || 'assets';
const CLOUD = !!(SB_URL && SB_KEY);
const sbHeaders = (extra = {}) => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...extra });
const sbPublicUrl = (name) => `${SB_URL}/storage/v1/object/public/${SB_BUCKET}/${name}`;
async function sbFail(res, what) { throw new Error(`Supabase ${what} failed (${res.status}): ${(await res.text()).slice(0, 200)}`); }
async function storePut(name, filePath, mime) {
  if (!CLOUD) { await fsp.rename(filePath, path.join(UPLOAD_DIR, name)); return; }
  const res = await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${name}`, { method: 'POST', headers: sbHeaders({ 'Content-Type': mime, 'x-upsert': 'true' }), body: await fsp.readFile(filePath) });
  if (!res.ok) await sbFail(res, 'upload');
  await fsp.unlink(filePath).catch(() => {});
}
async function storeDelete(name) {
  if (!CLOUD) return fsp.unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
  await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}/${name}`, { method: 'DELETE', headers: sbHeaders() }).catch(() => {});
}
async function dbLoad() {
  if (!CLOUD) return fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null;
  const res = await fetch(`${SB_URL}/rest/v1/kv?id=eq.main&select=data`, { headers: sbHeaders() });
  if (!res.ok) await sbFail(res, 'database read (did you run the SQL setup?)');
  const rows = await res.json();
  return rows[0]?.data || null;
}
async function dbWrite(json) {
  if (!CLOUD) { const tmp = DB_FILE + '.tmp'; await fsp.writeFile(tmp, JSON.stringify(json)); await fsp.rename(tmp, DB_FILE); return; }
  const res = await fetch(`${SB_URL}/rest/v1/kv`, { method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }), body: JSON.stringify({ id: 'main', data: json }) });
  if (!res.ok) await sbFail(res, 'database write');
}
let db = { users: [], sessions: {}, pages: [], assets: [], templates: [] };
{ const loaded = await dbLoad(); if (loaded) db = { ...db, ...loaded }; }
let saving = Promise.resolve();
function save() {
  // serialise writes (local: temp file + rename so a crash never leaves a half-written db)
  saving = saving.then(() => dbWrite(db)).catch((e) => console.error('db save failed', e));
  return saving;
}
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ auth */
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req) {
  const tok = parseCookies(req).sid;
  if (!tok) return null;
  const s = db.sessions[tokenHash(tok)];
  if (!s || s.exp < Date.now()) return null;
  return db.users.find((u) => u.id === s.userId) || null;
}
function startSession(res, user) {
  const tok = crypto.randomBytes(32).toString('hex');
  db.sessions[tokenHash(tok)] = { userId: user.id, exp: Date.now() + 30 * 864e5 };
  for (const [k, v] of Object.entries(db.sessions)) if (v.exp < Date.now()) delete db.sessions[k];
  res.setHeader('Set-Cookie', `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${SECURE ? '; Secure' : ''}`);
}
const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role });
const attempts = new Map();
function rateLimited(ip) {
  const t = Date.now(), list = (attempts.get(ip) || []).filter((x) => t - x < 600000);
  attempts.set(ip, list);
  return list.length >= 10;
}
const failed = (ip) => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);

function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  req.user = u;
  next();
}
const requireOwner = (req, res, next) => (req.user.role === 'owner' ? next() : res.status(403).json({ error: 'Owner only.' }));

/* ------------------------------------------------------------------ app */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  // basic CSRF defence on top of SameSite=Lax: reject cross-origin state-changing requests
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Bad origin.' }); } catch { return res.status(403).json({ error: 'Bad origin.' }); }
  }
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---- account endpoints */
app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  res.json({ user: u ? publicUser(u) : null, needsSetup: db.users.length === 0 });
});
app.post('/api/setup', wrap(async (req, res) => {
  if (db.users.length) return res.status(403).json({ error: 'Already set up.' });
  const u = makeUser(req.body, 'owner');
  if (u.error) return res.status(400).json({ error: u.error });
  db.users.push(u);
  startSession(res, u);
  await save();
  res.json({ user: publicUser(u) });
}));
function makeUser(b, role) {
  const username = String(b?.username || '').trim().toLowerCase();
  const password = String(b?.password || '');
  if (!/^[a-z0-9_.-]{2,30}$/.test(username)) return { error: 'Username: 2–30 letters, numbers, . _ -' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (db.users.some((x) => x.username === username)) return { error: 'That username is taken.' };
  const salt = rid(16);
  return { id: rid(), username, displayName: String(b?.displayName || username).slice(0, 40), role, salt, hash: hashPw(password, salt), folders: [], createdAt: now() };
}
app.post('/api/login', wrap(async (req, res) => {
  if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const u = db.users.find((x) => x.username === String(req.body?.username || '').trim().toLowerCase());
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(req.body?.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) { failed(req.ip); return res.status(401).json({ error: 'Wrong username or password.' }); }
  startSession(res, u);
  await save();
  res.json({ user: publicUser(u) });
}));
app.post('/api/logout', wrap(async (req, res) => {
  const tok = parseCookies(req).sid;
  if (tok) { delete db.sessions[tokenHash(tok)]; await save(); }
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
}));
app.post('/api/me/password', requireAuth, wrap(async (req, res) => {
  const u = req.user;
  if (hashPw(String(req.body?.current || ''), u.salt) !== u.hash) return res.status(400).json({ error: 'Current password is wrong.' });
  const pw = String(req.body?.password || '');
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  u.salt = rid(16); u.hash = hashPw(pw, u.salt);
  await save();
  res.json({ ok: true });
}));
app.get('/api/users', requireAuth, requireOwner, (req, res) => res.json({ users: db.users.map(publicUser), max: MAX_USERS }));
app.post('/api/users', requireAuth, requireOwner, wrap(async (req, res) => {
  if (db.users.length >= MAX_USERS) return res.status(400).json({ error: `This site is limited to ${MAX_USERS} users.` });
  const u = makeUser(req.body, 'editor');
  if (u.error) return res.status(400).json({ error: u.error });
  db.users.push(u);
  await save();
  res.json({ user: publicUser(u) });
}));
app.delete('/api/users/:id', requireAuth, requireOwner, wrap(async (req, res) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u || u.role === 'owner') return res.status(400).json({ error: "Can't remove that user." });
  db.users = db.users.filter((x) => x !== u);
  for (const [k, v] of Object.entries(db.sessions)) if (v.userId === u.id) delete db.sessions[k];
  await save();
  res.json({ ok: true });
}));

/* ---- assets */
const upload = multer({ dest: TMP_DIR, limits: { fileSize: MAX_AUDIO, files: 20 } });
function sniff(buf) {
  const s = (a, o = 0) => a.every((b, i) => buf[o + i] === b);
  const ascii = (o, str) => buf.slice(o, o + str.length).toString('latin1') === str;
  if (s([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png', kind: 'image' };
  if (s([0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg', kind: 'image' };
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { ext: 'gif', mime: 'image/gif', kind: 'gif' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { ext: 'webp', mime: 'image/webp', kind: 'image' };
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { ext: 'wav', mime: 'audio/wav', kind: 'audio' };
  if (ascii(0, 'OggS')) return { ext: 'ogg', mime: 'audio/ogg', kind: 'audio' };
  if (ascii(0, 'ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg', kind: 'audio' };
  return null;
}
const userBytes = (uid) => db.assets.filter((a) => a.ownerId === uid).reduce((n, a) => n + a.size, 0);
const publicAsset = (a) => ({ id: a.id, name: a.name, kind: a.kind, mime: a.mime, size: a.size, folder: a.folder || '', createdAt: a.createdAt, url: `/f/${a.id}` });

app.get('/api/assets', requireAuth, (req, res) => {
  res.json({
    assets: db.assets.filter((a) => a.ownerId === req.user.id).map(publicAsset),
    folders: [...new Set([...(req.user.folders || []), ...db.assets.filter((a) => a.ownerId === req.user.id && a.folder).map((a) => a.folder)])].sort(),
    used: userBytes(req.user.id), quota: QUOTA,
  });
});
app.post('/api/assets', requireAuth, (req, res, next) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 25 MB).' : err.message;
      return res.status(400).json({ error: msg, assets: [], errors: [{ name: '', error: msg }] });
    }
    next();
  });
}, wrap(async (req, res) => {
  const out = [], errors = [];
  const folder = String(req.body?.folder || '').slice(0, 40);
  for (const f of req.files || []) {
    try {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const fh = await fsp.open(f.path, 'r'); const buf = Buffer.alloc(16);
      await fh.read(buf, 0, 16, 0); await fh.close();
      const type = sniff(buf);
      if (!type) throw new Error('Not a supported file. Use PNG, JPG, WebP, GIF, MP3, OGG or WAV.');
      if (type.kind !== 'audio' && f.size > MAX_IMAGE) throw new Error('Images can be at most 15 MB.');
      if (userBytes(req.user.id) + f.size > QUOTA) throw new Error('Storage limit reached. Delete some assets first.');
      const id = rid();
      await storePut(`${id}.${type.ext}`, f.path, type.mime);
      const a = { id, ownerId: req.user.id, name: name.replace(/\.[^.]+$/, '').slice(0, 80) || 'untitled', kind: type.kind, mime: type.mime, ext: type.ext, size: f.size, folder, createdAt: now() };
      db.assets.push(a);
      out.push(publicAsset(a));
    } catch (e) {
      errors.push({ name: f.originalname, error: e.message });
      fsp.unlink(f.path).catch(() => {});
    }
  }
  await save();
  res.status(out.length || !errors.length ? 200 : 400).json({ assets: out, errors });
}));
app.patch('/api/assets/:id', requireAuth, wrap(async (req, res) => {
  const a = db.assets.find((x) => x.id === req.params.id && x.ownerId === req.user.id);
  if (!a) return res.status(404).json({ error: 'Asset not found.' });
  if (typeof req.body.name === 'string' && req.body.name.trim()) a.name = req.body.name.trim().slice(0, 80);
  if (typeof req.body.folder === 'string') a.folder = req.body.folder.trim().slice(0, 40);
  await save();
  res.json({ asset: publicAsset(a) });
}));
function assetUsage(assetId) {
  const uses = [];
  const inDoc = (d) => !!d && (d.settings.bgAsset === assetId || d.settings.cursorAsset === assetId || d.elements.some((e) => e.assetId === assetId));
  for (const p of db.pages) {
    const draft = inDoc(p.doc) || p.thumbnail === assetId;
    const pub = !!p.published && (inDoc(p.published.doc) || p.published.thumbnail === assetId);
    if (draft || pub) uses.push({ pageId: p.id, title: p.title, published: pub, draft });
  }
  return uses;
}
app.get('/api/assets-unused', requireAuth, (req, res) => {
  const unused = db.assets.filter((a) => a.ownerId === req.user.id && !assetUsage(a.id).length);
  res.json({ assets: unused.map(publicAsset) });
});
app.get('/api/assets/:id/usage', requireAuth, (req, res) => res.json({ usage: assetUsage(req.params.id) }));
app.delete('/api/assets/:id', requireAuth, wrap(async (req, res) => {
  const a = db.assets.find((x) => x.id === req.params.id && x.ownerId === req.user.id);
  if (!a) return res.status(404).json({ error: 'Asset not found.' });
  const usage = assetUsage(a.id);
  const force = req.query.force;
  if (usage.length && !force) return res.status(409).json({ error: 'This asset is used by one or more pages.', usage });
  if (usage.some((u) => u.published) && force !== 'published') return res.status(409).json({ error: 'This asset is used by a published page.', usage, needsPublishedConfirm: true });
  db.assets = db.assets.filter((x) => x !== a);
  await save();
  storeDelete(`${a.id}.${a.ext}`);
  res.json({ ok: true });
}));
app.post('/api/folders', requireAuth, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Give the collection a name.' });
  req.user.folders = [...new Set([...(req.user.folders || []), name])];
  await save();
  res.json({ ok: true });
}));
app.delete('/api/folders/:name', requireAuth, wrap(async (req, res) => {
  req.user.folders = (req.user.folders || []).filter((f) => f !== req.params.name);
  for (const a of db.assets) if (a.ownerId === req.user.id && a.folder === req.params.name) a.folder = '';
  await save();
  res.json({ ok: true });
}));

// Files are public by unguessable id so published pages can load them without a login.
app.get('/f/:id', (req, res) => {
  const a = db.assets.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).send('Not found');
  if (CLOUD) return res.set('Cache-Control', 'public, max-age=86400').redirect(302, sbPublicUrl(`${a.id}.${a.ext}`));
  res.set({ 'Content-Type': a.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.sendFile(path.join(UPLOAD_DIR, `${a.id}.${a.ext}`), { headers: { 'Content-Type': a.mime } });
});

/* ---- pages */
function slugify(s) { return String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
function uniqueSlug(base, exceptId) {
  let s = slugify(base) || 'page';
  if (s.length < 2) s += '-page';
  if (RESERVED.has(s)) s += '-1';
  let out = s, i = 2;
  while (db.pages.some((p) => p.slug === out && p.id !== exceptId)) out = `${s.slice(0, 36)}-${i++}`;
  return out;
}
const blankDoc = () => sanitizeDoc({ settings: {}, elements: [] });
const hasChanges = (p) => !!p.published && JSON.stringify(p.doc) !== JSON.stringify(p.published.doc);
const pageMeta = (p) => ({ id: p.id, title: p.title, slug: p.slug, description: p.description, thumbnail: p.thumbnail, published: !!p.published, publishedAt: p.published?.at || null, hasChanges: hasChanges(p), updatedAt: p.updatedAt, rev: p.rev });
const ownPage = (req) => db.pages.find((p) => p.id === req.params.id && p.ownerId === req.user.id);

app.get('/api/pages', requireAuth, (req, res) => res.json({ pages: db.pages.filter((p) => p.ownerId === req.user.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(pageMeta) }));
app.post('/api/pages', requireAuth, wrap(async (req, res) => {
  const title = String(req.body?.title || 'My profile').trim().slice(0, 80) || 'My profile';
  let doc = blankDoc();
  const tid = req.body?.templateId;
  if (tid) {
    const t = TEMPLATES.find((x) => x.id === tid) || db.templates.find((x) => x.id === tid && x.ownerId === req.user.id);
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    doc = sanitizeDoc(JSON.parse(JSON.stringify(t.doc)));
  }
  const p = { id: rid(), ownerId: req.user.id, title, slug: uniqueSlug(req.body?.slug || title), description: '', thumbnail: '', doc, rev: 1, createdAt: now(), updatedAt: now(), published: null };
  db.pages.push(p);
  await save();
  res.json({ page: { ...pageMeta(p), doc: p.doc } });
}));
app.get('/api/pages/:id', requireAuth, (req, res) => {
  const p = ownPage(req);
  if (!p) return res.status(404).json({ error: 'Page not found.' });
  res.json({ page: { ...pageMeta(p), doc: p.doc } });
});
app.put('/api/pages/:id', requireAuth, wrap(async (req, res) => {
  const p = ownPage(req);
  if (!p) return res.status(404).json({ error: 'Page not found.' });
  const b = req.body || {};
  if (b.rev != null && b.rev !== p.rev) return res.status(409).json({ error: 'This page was changed somewhere else (another tab or device). Reload to get the latest version.', rev: p.rev });
  let newSlug = null;
  if (typeof b.slug === 'string' && b.slug !== p.slug) {
    const s = slugify(b.slug);
    if (s.length < 2) return res.status(400).json({ error: 'The address needs at least 2 letters or numbers.' });
    if (RESERVED.has(s)) return res.status(400).json({ error: 'That address is reserved. Try another.' });
    if (db.pages.some((x) => x.slug === s && x.id !== p.id)) return res.status(400).json({ error: 'That address is already taken.' });
    newSlug = s;
  }
  // everything validated – now apply
  if (b.doc) p.doc = sanitizeDoc(b.doc);
  if (typeof b.title === 'string') p.title = b.title.trim().slice(0, 80) || 'Untitled';
  if (typeof b.description === 'string') p.description = b.description.slice(0, 300);
  if (typeof b.thumbnail === 'string') p.thumbnail = safeId(b.thumbnail);
  if (newSlug) p.slug = newSlug;
  p.rev += 1; p.updatedAt = now();
  await save();
  res.json({ page: pageMeta(p) });
}));
app.post('/api/pages/:id/duplicate', requireAuth, wrap(async (req, res) => {
  const p = ownPage(req);
  if (!p) return res.status(404).json({ error: 'Page not found.' });
  const title = `Copy of ${p.title}`.slice(0, 80);
  const c = { ...p, id: rid(), title, slug: uniqueSlug(title), doc: JSON.parse(JSON.stringify(p.doc)), rev: 1, createdAt: now(), updatedAt: now(), published: null };
  db.pages.push(c);
  await save();
  res.json({ page: pageMeta(c) });
}));
app.delete('/api/pages/:id', requireAuth, wrap(async (req, res) => {
  const p = ownPage(req);
  if (!p) return res.status(404).json({ error: 'Page not found.' });
  db.pages = db.pages.filter((x) => x !== p);
  await save();
  res.json({ ok: true });
}));
app.post('/api/pages/:id/publish', requireAuth, wrap(async (req, res) => {
  const p = ownPage(req);
  if (!p) return res.status(404).json({ error: 'Page not found.' });
  p.published = { doc: JSON.parse(JSON.stringify(p.doc)), title: p.title, description: p.description, thumbnail: p.thumbnail, at: now() };
  p.updatedAt = now();
  await save();
  res.json({ page: pageMeta(p), url: `/p/${p.slug}` });
}));
app.post('/api/pages/:id/unpublish', requireAuth, wrap(async (req, res) => {
  const p = ownPage(req);
  if (!p) return res.status(404).json({ error: 'Page not found.' });
  p.published = null;
  await save();
  res.json({ page: pageMeta(p) });
}));

/* ---- templates */
app.get('/api/templates', requireAuth, (req, res) => res.json({
  builtin: TEMPLATES.map(({ id, name, description, doc }) => ({ id, name, description, doc })),
  mine: db.templates.filter((t) => t.ownerId === req.user.id).map(({ id, name, doc }) => ({ id, name, doc })),
}));
app.post('/api/templates', requireAuth, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Give your template a name.' });
  const src = req.body?.pageId ? ownPage({ params: { id: req.body.pageId }, user: req.user }) : null;
  const doc = sanitizeDoc(req.body?.doc || src?.doc);
  const t = { id: rid(), ownerId: req.user.id, name, doc };
  db.templates.push(t);
  await save();
  res.json({ template: { id: t.id, name: t.name, doc: t.doc } });
}));
app.delete('/api/templates/:id', requireAuth, wrap(async (req, res) => {
  db.templates = db.templates.filter((t) => !(t.id === req.params.id && t.ownerId === req.user.id));
  await save();
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ public rendering */
const SB_ORIGIN = CLOUD ? ' ' + new URL(SB_URL).origin : '';
const PUBLIC_CSP = `default-src 'none'; img-src 'self' data:${SB_ORIGIN}; media-src 'self'${SB_ORIGIN}; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-src https:; base-uri 'none'; form-action 'none'`;
function siteUrl(req) { return `${req.protocol}://${req.get('host')}`; }

app.get('/p/:slug', (req, res) => {
  const p = db.pages.find((x) => x.slug === req.params.slug.toLowerCase() && x.published);
  if (!p) return res.status(404).type('html').send(notFoundHtml());
  const snap = p.published;
  res.set({ 'Content-Security-Policy': PUBLIC_CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': 'no-cache' });
  res.type('html').send(pageHtml({ page: { id: p.id, title: snap.title, description: snap.description, thumbnail: snap.thumbnail }, doc: snap.doc, siteUrl: siteUrl(req) }));
});
app.get('/preview/:id', requireAuth, (req, res) => {
  const p = ownPage(req);
  if (!p) return res.status(404).type('html').send(notFoundHtml());
  res.set({ 'Content-Security-Policy': PUBLIC_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.type('html').send(pageHtml({ page: p, doc: p.doc, siteUrl: siteUrl(req), draft: true }));
});
app.get('/embed-html/:pageId/:elId', (req, res) => {
  let p = db.pages.find((x) => x.id === req.params.pageId), doc;
  if (req.query.draft) {
    const u = currentUser(req);
    if (!p || !u || p.ownerId !== u.id) return res.status(404).send('Not found');
    doc = p.doc;
  } else {
    if (!p?.published) return res.status(404).send('Not found');
    doc = p.published.doc;
  }
  const el = doc.elements.find((e) => e.id === req.params.elId && e.type === 'html');
  if (!el) return res.status(404).send('Not found');
  // Opaque origin (sandbox without allow-same-origin), no network except https subresources, no navigation.
  res.set({
    'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; media-src https:; frame-src https:; connect-src 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
  });
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent;font-family:system-ui,sans-serif}</style>${el.code}`);
});
const notFoundHtml = () => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f4f0;color:#333;text-align:center}h1{font-size:64px;margin:0}</style><div><h1>🫥</h1><p>This page doesn’t exist, or it isn’t published.</p></div>`;

/* ------------------------------------------------------------------ static app */
app.use('/shared', express.static(path.join(__dirname, 'shared'), { maxAge: 0 }));
app.get('/public-view.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'public-view.js')));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status === 400 ? 'Bad request.' : 'Something went wrong on the server.' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => console.log(`Profile Builder running on port ${PORT} (${CLOUD ? 'Supabase storage' : 'local storage'})`));
}
export { app };
