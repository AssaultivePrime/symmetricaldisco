// Shared by the browser editor and the Node server.
// One renderer => the editor canvas, the preview and the published page look identical.
// Everything user-controlled is validated (sanitizeDoc) AND escaped/clamped again at render time.

export const FONTS = {
  'Inter': { stack: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;700' },
  'Playfair Display': { stack: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:ital,wght@0,400;0,700;1,400' },
  'Lora': { stack: "'Lora', Georgia, serif", google: 'Lora:ital,wght@0,400;0,700;1,400' },
  'DM Serif Display': { stack: "'DM Serif Display', Georgia, serif", google: 'DM+Serif+Display' },
  'Space Mono': { stack: "'Space Mono', 'Courier New', monospace", google: 'Space+Mono:wght@400;700' },
  'Pacifico': { stack: "'Pacifico', cursive", google: 'Pacifico' },
  'Caveat': { stack: "'Caveat', cursive", google: 'Caveat:wght@400;700' },
  'Permanent Marker': { stack: "'Permanent Marker', cursive", google: 'Permanent+Marker' },
  'Bebas Neue': { stack: "'Bebas Neue', Impact, sans-serif", google: 'Bebas+Neue' },
  'Press Start 2P': { stack: "'Press Start 2P', monospace", google: 'Press+Start+2P' },
  'Fredoka': { stack: "'Fredoka', system-ui, sans-serif", google: 'Fredoka:wght@400;700' },
  'Georgia': { stack: 'Georgia, serif', google: '' },
  'Courier New': { stack: "'Courier New', monospace", google: '' },
  'Arial': { stack: 'Arial, Helvetica, sans-serif', google: '' },
};

export const MAX_ELEMENTS = 500;
const TYPES = ['image', 'text', 'link', 'shape', 'divider', 'emoji', 'audio', 'embed', 'html'];
const SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'heart', 'frame'];

/* ---------- tiny validators ---------- */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function num(v, def, min, max) {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}
export function int(v, def, min, max) { return Math.round(num(v, def, min, max)); }
export function pick(v, list, def) { return list.includes(v) ? v : def; }
export function safeId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : ''; }
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.\s,%]+\)|hsla?\(\s*[\d.\s,%deg]+\)|transparent|[a-zA-Z]{3,20})$/;
export function color(v, def = '#000000') { return typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : def; }
export function safeHref(u) {
  if (typeof u !== 'string') return '';
  u = u.trim().slice(0, 2000);
  if (!u) return '';
  if (/^mailto:[^\s<>"']+$/i.test(u)) return u;
  try {
    const p = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : '';
  } catch { return ''; }
}
export function embedUrl(u) {
  const href = safeHref(u);
  if (!href || href.startsWith('mailto:')) return '';
  let p; try { p = new URL(href); } catch { return ''; }
  if (p.protocol !== 'https:') return '';
  const host = p.hostname.replace(/^www\./, '');
  let m;
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const v = p.searchParams.get('v');
    if (v && /^[\w-]{6,20}$/.test(v)) return `https://www.youtube-nocookie.com/embed/${v}`;
    if ((m = p.pathname.match(/^\/(embed|shorts)\/([\w-]{6,20})/))) return `https://www.youtube-nocookie.com/embed/${m[2]}`;
  }
  if (host === 'youtu.be' && (m = p.pathname.match(/^\/([\w-]{6,20})/))) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  if (host === 'open.spotify.com' && (m = p.pathname.match(/^\/(track|album|playlist|episode|show|artist)\/(\w+)/))) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  if (host === 'vimeo.com' && (m = p.pathname.match(/^\/(\d+)/))) return `https://player.vimeo.com/video/${m[1]}`;
  return href;
}

/* ---------- sanitising a whole document (server-side, on every save) ---------- */
const clampShadow = (s, def = {}) => ({
  on: !!s?.on, x: num(s?.x, def.x ?? 3, -60, 60), y: num(s?.y, def.y ?? 4, -60, 60),
  blur: num(s?.blur, def.blur ?? 8, 0, 100), color: color(s?.color, def.color ?? 'rgba(0,0,0,0.35)'),
});
const clampFilters = (f) => ({
  brightness: num(f?.brightness, 100, 0, 300), contrast: num(f?.contrast, 100, 0, 300), saturate: num(f?.saturate, 100, 0, 300),
  grayscale: num(f?.grayscale, 0, 0, 100), blur: num(f?.blur, 0, 0, 40), hue: num(f?.hue, 0, -180, 180),
});

export function sanitizeDoc(raw) {
  const s = raw?.settings || {};
  const settings = {
    bg: color(s.bg, '#ffffff'),
    bgAsset: safeId(s.bgAsset),
    bgSize: pick(s.bgSize, ['cover', 'contain', 'auto', 'tile'], 'cover'),
    bgPos: pick(s.bgPos, ['center', 'top', 'bottom', 'left', 'right'], 'center'),
    width: int(s.width, 960, 320, 1600),
    height: int(s.height, 1200, 300, 8000),
    autoExpand: !!s.autoExpand,
    wide: pick(s.wide, ['center', 'fit'], 'center'),
    cursorAsset: safeId(s.cursorAsset),
  };
  const seen = new Set();
  const elements = [];
  for (const e of (Array.isArray(raw?.elements) ? raw.elements : []).slice(0, MAX_ELEMENTS)) {
    const c = cleanEl(e);
    if (!c) continue;
    while (!c.id || seen.has(c.id)) c.id = 'e' + Math.random().toString(36).slice(2, 10);
    seen.add(c.id);
    elements.push(c);
  }
  return { settings, elements };
}

function cleanText(e, c) {
  c.text = String(e.text ?? '').slice(0, 5000);
  c.font = FONTS[e.font] ? e.font : 'Inter';
  c.size = num(e.size, 24, 6, 400);
  c.color = color(e.color, '#111111');
  c.bold = !!e.bold; c.italic = !!e.italic; c.underline = !!e.underline;
  c.align = pick(e.align, ['left', 'center', 'right', 'justify'], 'left');
  c.ls = num(e.ls, 0, -10, 60);
  c.lh = num(e.lh, 1.3, 0.6, 4);
  c.outlineW = num(e.outlineW, 0, 0, 20);
  c.outlineColor = color(e.outlineColor, '#000000');
  c.shadow = clampShadow(e.shadow, { x: 2, y: 2, blur: 4 });
  c.bg = e.bg ? color(e.bg, '') : '';
  c.pad = num(e.pad, 0, 0, 100);
  c.radius = num(e.radius, 0, 0, 200);
}

function cleanEl(e) {
  if (!e || typeof e !== 'object' || !TYPES.includes(e.type)) return null;
  const c = {
    id: safeId(e.id), type: e.type,
    x: num(e.x, 0, -3000, 9000), y: num(e.y, 0, -3000, 12000),
    w: num(e.w, 100, 8, 4000), h: num(e.h, 100, 8, 6000),
    rot: num(e.rot, 0, -360, 360), opacity: num(e.opacity, 1, 0, 1),
    locked: !!e.locked, groupId: safeId(e.groupId), name: String(e.name ?? '').slice(0, 60),
  };
  switch (e.type) {
    case 'image':
      c.assetId = safeId(e.assetId); c.alt = String(e.alt ?? '').slice(0, 200);
      c.fit = pick(e.fit, ['cover', 'contain', 'fill'], 'cover');
      c.posX = num(e.posX, 50, 0, 100); c.posY = num(e.posY, 50, 0, 100);
      c.borderW = num(e.borderW, 0, 0, 40); c.borderColor = color(e.borderColor, '#ffffff');
      c.borderStyle = pick(e.borderStyle, ['solid', 'dashed', 'dotted', 'double'], 'solid');
      c.radius = num(e.radius, 0, 0, 1000);
      c.shadow = clampShadow(e.shadow); c.filters = clampFilters(e.filters); c.href = safeHref(e.href);
      break;
    case 'text': case 'link':
      cleanText(e, c);
      if (e.type === 'link') c.href = safeHref(e.href);
      break;
    case 'shape':
      c.kind = pick(e.kind, SHAPES, 'rect'); c.fill = color(e.fill, '#ff7aa8');
      c.stroke = color(e.stroke, '#111111'); c.strokeW = num(e.strokeW, 0, 0, 40);
      c.strokeStyle = pick(e.strokeStyle, ['solid', 'dashed', 'dotted', 'double'], 'solid');
      c.radius = num(e.radius, 0, 0, 1000); c.shadow = clampShadow(e.shadow); c.href = safeHref(e.href);
      break;
    case 'divider':
      c.style = pick(e.style, ['solid', 'dashed', 'dotted', 'double', 'wavy'], 'solid');
      c.color = color(e.color, '#111111'); c.thickness = num(e.thickness, 3, 1, 30);
      break;
    case 'emoji':
      c.char = String(e.char ?? '⭐').slice(0, 12); c.shadow = clampShadow(e.shadow); c.href = safeHref(e.href);
      break;
    case 'audio':
      c.assetId = safeId(e.assetId); c.title = String(e.title ?? '').slice(0, 100);
      c.theme = pick(e.theme, ['light', 'dark', 'pink'], 'light');
      break;
    case 'embed':
      c.url = embedUrl(e.url) ? safeHref(e.url) : '';
      break;
    case 'html':
      c.code = String(e.code ?? '').slice(0, 20000);
      break;
  }
  return c;
}

/* ---------- rendering ---------- */
const px = (n) => `${Math.round(n * 100) / 100}px`;
const shadowTxt = (s) => (s?.on ? `${px(s.x)} ${px(s.y)} ${px(s.blur)} ${color(s.color, 'rgba(0,0,0,.4)')}` : '');

function filterCss(el) {
  const f = el.filters || {}, p = [];
  if (f.brightness != null && f.brightness !== 100) p.push(`brightness(${num(f.brightness, 100, 0, 300)}%)`);
  if (f.contrast != null && f.contrast !== 100) p.push(`contrast(${num(f.contrast, 100, 0, 300)}%)`);
  if (f.saturate != null && f.saturate !== 100) p.push(`saturate(${num(f.saturate, 100, 0, 300)}%)`);
  if (f.grayscale) p.push(`grayscale(${num(f.grayscale, 0, 0, 100)}%)`);
  if (f.hue) p.push(`hue-rotate(${num(f.hue, 0, -180, 180)}deg)`);
  if (f.blur) p.push(`blur(${num(f.blur, 0, 0, 40)}px)`);
  const sh = shadowTxt(el.shadow);
  if (sh) p.push(`drop-shadow(${sh})`);
  return p.join(' ');
}

const isTextual = (el) => el.type === 'text' || el.type === 'link';

/** CSS for the positioned wrapper of an element. */
export function elementStyle(el, editor = false) {
  let css = `position:absolute;left:${px(el.x)};top:${px(el.y)};width:${px(el.w)};box-sizing:border-box;`;
  css += isTextual(el) ? `min-height:${px(el.h)};` : `height:${px(el.h)};`;
  if (el.rot) css += `transform:rotate(${num(el.rot, 0, -360, 360)}deg);`;
  if (el.opacity != null && el.opacity < 1) css += `opacity:${num(el.opacity, 1, 0, 1)};`;
  if (el.type === 'image') {
    if (el.borderW) css += `border:${px(el.borderW)} ${pick(el.borderStyle, ['solid', 'dashed', 'dotted', 'double'], 'solid')} ${color(el.borderColor, '#fff')};`;
    if (el.radius) css += `border-radius:${px(el.radius)};`;
    css += 'overflow:hidden;';
    const f = filterCss(el); if (f) css += `filter:${f};`;
  } else if (isTextual(el)) {
    css += `font-family:${(FONTS[el.font] || FONTS.Inter).stack};font-size:${px(num(el.size, 24, 6, 400))};color:${color(el.color, '#111')};`;
    css += `font-weight:${el.bold ? 700 : 400};font-style:${el.italic ? 'italic' : 'normal'};text-decoration:${el.underline ? 'underline' : 'none'};`;
    css += `text-align:${pick(el.align, ['left', 'center', 'right', 'justify'], 'left')};letter-spacing:${px(el.ls || 0)};line-height:${num(el.lh, 1.3, 0.6, 4)};`;
    css += 'white-space:pre-wrap;overflow-wrap:anywhere;';
    if (el.outlineW) css += `-webkit-text-stroke:${px(el.outlineW)} ${color(el.outlineColor, '#000')};paint-order:stroke fill;`;
    const ts = shadowTxt(el.shadow); if (ts) css += `text-shadow:${ts};`;
    if (el.bg) css += `background:${color(el.bg, 'transparent')};`;
    if (el.pad) css += `padding:${px(el.pad)};`;
    if (el.radius) css += `border-radius:${px(el.radius)};`;
  } else if (el.type === 'shape' || el.type === 'emoji') {
    const ds = shadowTxt(el.shadow); if (ds) css += `filter:drop-shadow(${ds});`;
  }
  if (editor && el.type === 'audio') css += '';
  return css;
}

function wrapLink(el, inner, editor) {
  if (editor || !el.href) return inner;
  return `<a href="${esc(el.href)}" target="_blank" rel="noopener noreferrer nofollow" style="display:block;width:100%;height:100%;color:inherit;text-decoration:none">${inner}</a>`;
}

const SHAPE_PATHS = {
  triangle: 'M50 5 L96 95 L4 95 Z',
  star: 'M50 4 L62 37 L97 38 L69 59 L79 94 L50 73 L21 94 L31 59 L3 38 L38 37 Z',
  heart: 'M50 92 C8 60 -2 34 18 18 C33 7 47 15 50 28 C53 15 67 7 82 18 C102 34 92 60 50 92 Z',
};

function wavyUri(c, t) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><path d="M0 10 Q10 0 20 10 T40 10" fill="none" stroke="${c}" stroke-width="${t}" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Inner HTML for an element. ctx = { editor, pageId, draft } */
export function elementInner(el, ctx = {}) {
  const editor = !!ctx.editor;
  switch (el.type) {
    case 'image': {
      if (!el.assetId) return editor ? '<div class="ph"><span>＋</span>Drop an image here</div>' : '';
      const fit = pick(el.fit, ['cover', 'contain', 'fill'], 'cover');
      const img = `<img src="/f/${esc(el.assetId)}" alt="${esc(el.alt || '')}" ${editor ? '' : 'loading="lazy"'} draggable="false" style="width:100%;height:100%;display:block;object-fit:${fit};object-position:${num(el.posX, 50, 0, 100)}% ${num(el.posY, 50, 0, 100)}%">`;
      return wrapLink(el, img, editor);
    }
    case 'text':
      return esc(el.text);
    case 'link':
      return editor ? esc(el.text) : `<a href="${esc(el.href || '#')}" target="_blank" rel="noopener noreferrer nofollow" style="color:inherit;text-decoration:inherit">${esc(el.text)}</a>`;
    case 'shape': {
      const fill = color(el.fill, '#ff7aa8'), stroke = color(el.stroke, '#111');
      let inner;
      if (el.kind === 'rect' || el.kind === 'ellipse') {
        const r = el.kind === 'ellipse' ? '50%' : px(el.radius || 0);
        inner = `<div style="width:100%;height:100%;box-sizing:border-box;background:${fill};border-radius:${r};${el.strokeW ? `border:${px(el.strokeW)} ${pick(el.strokeStyle, ['solid', 'dashed', 'dotted', 'double'], 'solid')} ${stroke};` : ''}"></div>`;
      } else if (el.kind === 'frame') {
        inner = `<div style="width:100%;height:100%;box-sizing:border-box;border-radius:${px(el.radius || 0)};border:${px(el.strokeW || 6)} ${pick(el.strokeStyle, ['solid', 'dashed', 'dotted', 'double'], 'solid')} ${stroke}"></div>`;
      } else {
        inner = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;display:block;overflow:visible"><path d="${SHAPE_PATHS[el.kind] || SHAPE_PATHS.star}" fill="${fill}" stroke="${el.strokeW ? stroke : 'none'}" stroke-width="${el.strokeW || 0}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
        inner = inner.replace('vector-effect="non-scaling-stroke"', 'vector-effect="non-scaling-stroke"');
      }
      return wrapLink(el, inner, editor);
    }
    case 'divider': {
      const c = color(el.color, '#111'), t = num(el.thickness, 3, 1, 30);
      if (el.style === 'wavy') return `<div style="position:absolute;inset:0;background:url('${wavyUri(c, Math.min(t, 6))}') repeat-x center/auto 100%"></div>`;
      return `<div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);border-top:${px(t)} ${pick(el.style, ['solid', 'dashed', 'dotted', 'double'], 'solid')} ${c}"></div>`;
    }
    case 'emoji': {
      const fs = Math.min(el.w, el.h) * 0.82;
      return wrapLink(el, `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:${px(fs)};line-height:1">${esc(el.char)}</div>`, editor);
    }
    case 'audio': {
      const theme = pick(el.theme, ['light', 'dark', 'pink'], 'light');
      const title = el.title ? `<div class="au-title">${esc(el.title)}</div>` : '';
      if (!el.assetId) return editor ? `<div class="au au-${theme}"><div class="au-title">♪ Drop an audio file here</div></div>` : '';
      return `<div class="au au-${theme}">${title}<audio controls preload="none" src="/f/${esc(el.assetId)}"></audio></div>`;
    }
    case 'embed': {
      const u = embedUrl(el.url);
      if (!u) return editor ? '<div class="ph"><span>▶</span>Paste a link in the panel</div>' : '';
      if (editor) return `<div class="ph embed-ph"><span>▶</span>Embed · ${esc(new URL(u).hostname)}<small>shown on preview &amp; published page</small></div>`;
      return `<iframe src="${esc(u)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="no-referrer" style="width:100%;height:100%;border:0;display:block"></iframe>`;
    }
    case 'html':
      if (editor) return '<div class="ph"><span>&lt;/&gt;</span>Custom HTML block<small>runs sandboxed on preview &amp; published page</small></div>';
      return `<iframe src="/embed-html/${esc(ctx.pageId)}/${esc(el.id)}${ctx.draft ? '?draft=1' : ''}" loading="lazy" sandbox="allow-scripts" referrerpolicy="no-referrer" style="width:100%;height:100%;border:0;display:block;background:transparent"></iframe>`;
  }
  return '';
}

export function bgStyle(s) {
  let css = `background-color:${color(s.bg, '#fff')};`;
  if (s.bgAsset) {
    const tile = s.bgSize === 'tile';
    const pos = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' }[s.bgPos] || 'center';
    css += `background-image:url(/f/${s.bgAsset});background-position:${pos};background-repeat:${tile ? 'repeat' : 'no-repeat'};background-size:${tile ? 'auto' : s.bgSize || 'cover'};`;
  }
  return css;
}

export function docHeight(doc) {
  const s = doc.settings;
  if (!s.autoExpand) return s.height;
  let bottom = 0;
  for (const e of doc.elements) bottom = Math.max(bottom, e.y + e.h + (e.rot ? Math.abs(Math.sin((e.rot * Math.PI) / 180)) * e.w * 0.5 : 0));
  return Math.max(500, Math.ceil(bottom + 60));
}

export function googleFontsHref(names) {
  const fam = [...new Set(names)].map((n) => FONTS[n]?.google).filter(Boolean);
  return fam.length ? `https://fonts.googleapis.com/css2?${fam.map((f) => 'family=' + f).join('&')}&display=swap` : '';
}

export const AUDIO_CSS = `.au{width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:6px;padding:8px 10px;border-radius:14px;font:600 13px system-ui,sans-serif}
.au audio{width:100%;height:36px}.au-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.au-light{background:#fffd;color:#222;box-shadow:0 2px 10px #0002}.au-dark{background:#151515e6;color:#f3f3f3;box-shadow:0 2px 10px #0005}.au-pink{background:#ffd3e6e6;color:#7a1646;box-shadow:0 2px 10px #7a164633}`;

/** Full public/preview HTML page. */
export function pageHtml({ page, doc, siteUrl = '', draft = false }) {
  const s = doc.settings;
  const H = docHeight(doc);
  const fonts = doc.elements.filter(isTextual).map((e) => e.font);
  const fontsHref = googleFontsHref(fonts);
  const title = esc(page.title || 'Untitled');
  const desc = esc(page.description || '');
  const thumb = page.thumbnail ? `${siteUrl}/f/${esc(page.thumbnail)}` : '';
  const cursor = s.cursorAsset ? `cursor:url(/f/${s.cursorAsset}) 0 0,auto;` : '';
  const els = doc.elements.map((el) =>
    `<div class="el" style="${esc(elementStyle(el, false))}">${elementInner(el, { editor: false, pageId: page.id, draft })}</div>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
${desc ? `<meta name="description" content="${desc}">` : ''}
<meta property="og:title" content="${title}"><meta property="og:type" content="website">
${desc ? `<meta property="og:description" content="${desc}">` : ''}${thumb ? `<meta property="og:image" content="${thumb}"><meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="robots" content="${draft ? 'noindex' : 'index,follow'}">
${fontsHref ? `<link rel="stylesheet" href="${esc(fontsHref)}">` : ''}
<style>
html,body{margin:0;padding:0}body{background:${color(s.bg, '#fff')};overflow-x:hidden;${cursor}}
#scaler{position:relative;margin:0 auto;transform-origin:top left}
#page{position:relative;width:${s.width}px;height:${H}px;overflow:hidden;${bgStyle(s)}}
.el a{cursor:pointer}${AUDIO_CSS}
</style></head>
<body><div id="scaler" data-w="${s.width}" data-h="${H}" data-wide="${s.wide}"><div id="page">
${els}
</div></div><script src="/public-view.js" defer></script></body></html>`;
}
