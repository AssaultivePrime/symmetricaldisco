// Contextual properties panel. Only controls relevant to the selection are shown; advanced ones are collapsed.
import { h, icon, iconBtn, round, clamp } from './ui.js';
import { pickAsset, store } from './tray.js';
import { FONTS } from '/shared/render.js';

export const EMOJI = ['⭐', '✨', '💖', '🔥', '🌈', '🌙', '☀️', '🌸', '🌼', '🍀', '🦋', '🐱', '🐶', '🐸', '👾', '👑', '💎', '🎀', '🎧', '🎵', '🎮', '📷', '💌', '💫', '🍓', '🍒', '🍕', '☕', '🧸', '🎈', '🪩', '🕯️', '🖤', '💜', '💙', '💚', '💛', '🧡', '❤️', '🤍', '✌️', '👀', '🫶', '💬', '📌', '🔮', '🧿', '🍄'];

function parseColor(str) {
  str = String(str || '');
  let m = str.match(/^#([0-9a-f]{3}|[0-9a-f]{6})/i);
  if (m) { let x = m[1]; if (x.length === 3) x = [...x].map((c) => c + c).join(''); return { hex: '#' + x.toLowerCase(), a: 1 }; }
  m = str.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/);
  if (m) return { hex: '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join(''), a: m[4] != null ? +m[4] : 1 };
  if (str === 'transparent') return { hex: '#ffffff', a: 0 };
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#000'; probe.fillStyle = str;
  const v = probe.fillStyle;
  return v.startsWith('#') ? { hex: v, a: 1 } : parseColor(v);
}
const toRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return a >= 1 ? hex : `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${round(a, 2)})`;
};

export function createProps(ed) {
  const root = h('aside', { class: 'props', 'aria-label': 'Properties' });
  let syncers = [];

  /* ---------- control builders ---------- */
  const reg = (fn) => { syncers.push(fn); fn(); };
  const row = (label, ...ctrls) => h('div', { class: 'prow' }, label ? h('label', {}, label) : null, h('div', { class: 'pctl' }, ctrls));
  const first = () => ed.selected()[0];
  const get = (k, d) => { const e = first(); return e && e[k] != null ? e[k] : d; };
  const set = (k, v, key) => ed.set({ [k]: v }, key || 'p:' + k);

  function num(label, k, { min = -9999, max = 9999, step = 1, unit = '', nested } = {}) {
    const input = h('input', { type: 'number', min, max, step, 'aria-label': label });
    const read = () => (nested ? first()?.[nested]?.[k] : first()?.[k]);
    input.addEventListener('input', () => {
      if (input.value === '' || isNaN(+input.value)) return;
      const v = clamp(+input.value, min, max);
      nested ? ed.setNested(nested, { [k]: v }, 'p:' + nested + k) : set(k, v);
    });
    reg(() => { if (document.activeElement !== input) input.value = round(read() ?? 0, 1); });
    return row(label, input, unit ? h('span', { class: 'unit' }, unit) : null);
  }
  function range(label, k, { min = 0, max = 100, step = 1, unit = '', scale = 1, nested, def = 0 } = {}) {
    const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
    const out = h('output', {});
    const read = () => (nested ? first()?.[nested]?.[k] : first()?.[k]) ?? def;
    input.addEventListener('input', () => {
      const v = +input.value / scale;
      nested ? ed.setNested(nested, { [k]: v }, 'p:' + nested + k) : set(k, v);
      out.textContent = round(+input.value, 2) + unit;
    });
    reg(() => { const v = read() * scale; input.value = v; out.textContent = round(v, 2) + unit; });
    return row(label, input, out);
  }
  function color(label, k, { nested, alpha = false, clearable = false, def = '#000000' } = {}) {
    const input = h('input', { type: 'color', 'aria-label': label });
    const a = alpha ? h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label + ' opacity', class: 'alpha' }) : null;
    const read = () => (nested ? first()?.[nested]?.[k] : first()?.[k]);
    const write = () => {
      const v = toRgba(input.value, a ? +a.value / 100 : 1);
      nested ? ed.setNested(nested, { [k]: v }, 'p:' + nested + k) : set(k, v);
    };
    input.addEventListener('input', write);
    a?.addEventListener('input', write);
    const clear = clearable ? h('button', { class: 'mini-btn', type: 'button', title: 'No colour', onclick: () => (nested ? ed.setNested(nested, { [k]: '' }) : set(k, '')) }, 'None') : null;
    reg(() => {
      const raw = read();
      const p = parseColor(raw || def);
      if (document.activeElement !== input) input.value = p.hex;
      if (a) a.value = Math.round(p.a * 100);
      input.classList.toggle('none', clearable && !raw);
    });
    return row(label, input, a, clear);
  }
  function select(label, k, options, { nested } = {}) {
    const s = h('select', { 'aria-label': label }, options.map(([v, l]) => h('option', { value: v }, l)));
    s.addEventListener('change', () => (nested ? ed.setNested(nested, { [k]: s.value }) : set(k, s.value)));
    reg(() => { s.value = (nested ? first()?.[nested]?.[k] : first()?.[k]) ?? options[0][0]; });
    return row(label, s);
  }
  function text(label, k, { placeholder = '', multiline = false, rows = 3, mono = false, onSet } = {}) {
    const i = multiline ? h('textarea', { rows, placeholder, 'aria-label': label, class: mono ? 'mono' : '' }) : h('input', { type: 'text', placeholder, 'aria-label': label });
    i.addEventListener('input', () => (onSet ? onSet(i.value) : set(k, i.value)));
    reg(() => { if (document.activeElement !== i) i.value = first()?.[k] ?? ''; });
    return multiline ? h('div', { class: 'prow col' }, h('label', {}, label), i) : row(label, i);
  }
  function toggle(label, k, { nested } = {}) {
    const i = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
    i.addEventListener('change', () => (nested ? ed.setNested(nested, { [k]: i.checked }) : set(k, i.checked)));
    reg(() => { i.checked = !!(nested ? first()?.[nested]?.[k] : first()?.[k]); });
    return row(label, h('label', { class: 'switch' }, i, h('span', {})));
  }
  function seg(label, k, items, { dflt } = {}) {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const btns = items.map((it) => h('button', { type: 'button', class: 'seg-b', title: it.title || it.label, 'aria-label': it.title || it.label, html: it.icon ? icon(it.icon, 16) : it.label, onclick: () => set(k, it.value) }));
    wrap.append(...btns);
    reg(() => items.forEach((it, i) => btns[i].classList.toggle('on', (get(k, dflt)) === it.value)));
    return label ? row(label, wrap) : wrap;
  }
  function flag(k, ic, title) {
    const b = h('button', { type: 'button', class: 'seg-b flag', title, 'aria-label': title, 'aria-pressed': 'false', html: icon(ic, 16), onclick: () => set(k, !get(k, false)) });
    reg(() => { const on = !!get(k); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    return b;
  }
  function section(title, kids, { open = true, adv = false } = {}) {
    return h('details', { class: 'psec' + (adv ? ' adv' : ''), open }, h('summary', {}, title), h('div', { class: 'pbody' }, kids));
  }
  const btn = (label, ic, onclick, extra = '') => h('button', { type: 'button', class: 'btn small ' + extra, onclick, html: (ic ? icon(ic, 15) + ' ' : '') + label });

  /* ---------- reusable sections ---------- */
  function geometry({ noH = false, noRot = false } = {}) {
    return section('Size & position', [
      h('div', { class: 'two' }, num('X', 'x', { step: 1 }), num('Y', 'y', { step: 1 })),
      h('div', { class: 'two' }, num('W', 'w', { min: 8, max: 4000 }), noH ? null : num('H', 'h', { min: 8, max: 6000 })),
      noRot ? null : range('Rotate', 'rot', { min: -180, max: 180, unit: '°' }),
      range('Opacity', 'opacity', { min: 0, max: 100, scale: 100, unit: '%', def: 1 }),
    ]);
  }
  function arrange(multi) {
    const els = ed.selected();
    const locked = els.every((e) => e.locked);
    const grouped = els.some((e) => e.groupId);
    return section('Arrange', [
      h('div', { class: 'btnrow' },
        iconBtn('front', 'Bring to front  (Ctrl+])', () => ed.layer('front')), iconBtn('up', 'Bring forward  ( ] )', () => ed.layer('forward')),
        iconBtn('down', 'Send backward  ( [ )', () => ed.layer('backward')), iconBtn('back2', 'Send to back  (Ctrl+[)', () => ed.layer('back'))),
      h('div', { class: 'btnrow wrap' },
        btn('Duplicate', 'copy', () => ed.duplicate()),
        btn(locked ? 'Unlock' : 'Lock', locked ? 'unlock' : 'lock', () => ed.toggleLock()),
        multi ? btn('Group', 'group', () => ed.group()) : null,
        grouped ? btn('Ungroup', 'ungroup', () => ed.ungroup()) : null,
        btn('Delete', 'trash', () => ed.remove(), 'danger')),
    ]);
  }
  function shadowSection(title = 'Shadow', { text: isText = false } = {}) {
    return [
      toggle(title, 'on', { nested: 'shadow' }),
      num('Offset X', 'x', { nested: 'shadow', min: -60, max: 60 }), num('Offset Y', 'y', { nested: 'shadow', min: -60, max: 60 }),
      num('Blur', 'blur', { nested: 'shadow', min: 0, max: 100 }), color('Colour', 'color', { nested: 'shadow', alpha: true, def: 'rgba(0,0,0,0.35)' }),
    ];
  }
  const linkField = () => text('Link to', 'href', { placeholder: 'https://…  (optional)' });

  /* ---------- per-type panels ---------- */
  function imagePanel() {
    const e = first();
    return [
      section('Image', [
        h('div', { class: 'thumb-row' }, e.assetId ? h('img', { src: '/f/' + e.assetId, alt: '' }) : h('div', { class: 'ph-mini' }, 'No image'),
          h('div', {}, btn(e.assetId ? 'Replace…' : 'Choose image…', 'image', async () => { const a = await pickAsset({ kinds: ['image', 'gif'] }); if (a) ed.set({ assetId: a.id }, 'img'); }))),
        select('Fit', 'fit', [['cover', 'Fill (crop to fit)'], ['contain', 'Fit inside'], ['fill', 'Stretch']]),
        text('Alt text', 'alt', { placeholder: 'Describe the image' }),
      ]),
      geometry(),
      section('Style', [
        range('Corners', 'radius', { min: 0, max: 400, unit: 'px' }),
        range('Border', 'borderW', { min: 0, max: 30, unit: 'px' }), color('Border colour', 'borderColor', { def: '#ffffff' }),
        ...shadowSection(),
      ], { open: false }),
      section('Advanced', [
        range('Focus X', 'posX', { min: 0, max: 100, unit: '%', def: 50 }), range('Focus Y', 'posY', { min: 0, max: 100, unit: '%', def: 50 }),
        range('Brightness', 'brightness', { min: 0, max: 300, nested: 'filters', unit: '%', def: 100 }), range('Contrast', 'contrast', { min: 0, max: 300, nested: 'filters', unit: '%', def: 100 }),
        range('Saturation', 'saturate', { min: 0, max: 300, nested: 'filters', unit: '%', def: 100 }), range('Grayscale', 'grayscale', { min: 0, max: 100, nested: 'filters', unit: '%' }),
        range('Hue', 'hue', { min: -180, max: 180, nested: 'filters', unit: '°' }), range('Blur', 'blur', { min: 0, max: 40, nested: 'filters', unit: 'px' }),
        select('Border style', 'borderStyle', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']]),
        linkField(),
      ], { open: false, adv: true }),
    ];
  }
  function textPanel(isLink) {
    return [
      section(isLink ? 'Link' : 'Text', [
        text('Text', 'text', { multiline: true, rows: 3 }),
        isLink ? text('Address', 'href', { placeholder: 'https://example.com' }) : null,
        row('Font', (() => { const s = h('select', { 'aria-label': 'Font', class: 'font-select' }, Object.keys(FONTS).map((f) => h('option', { value: f, style: { fontFamily: FONTS[f].stack } }, f))); s.addEventListener('change', () => set('font', s.value)); reg(() => (s.value = get('font', 'Inter'))); return s; })()),
        num('Size', 'size', { min: 6, max: 400, unit: 'px' }),
        color('Colour', 'color', { def: '#111111' }),
        row('Style', h('div', { class: 'seg' }, flag('bold', 'bold', 'Bold'), flag('italic', 'italic', 'Italic'), flag('underline', 'underline', 'Underline'))),
        row('Align', seg('', 'align', [{ value: 'left', icon: 'align-left', title: 'Left' }, { value: 'center', icon: 'align-center', title: 'Centre' }, { value: 'right', icon: 'align-right', title: 'Right' }, { value: 'justify', icon: 'align-justify', title: 'Justify' }], { dflt: 'left' })),
      ]),
      geometry({ noH: true }),
      section('Effects', [
        range('Letter spacing', 'ls', { min: -5, max: 40, step: 0.5, unit: 'px' }), range('Line height', 'lh', { min: 0.8, max: 3, step: 0.05, def: 1.3 }),
        range('Outline', 'outlineW', { min: 0, max: 12, step: 0.5, unit: 'px' }), color('Outline colour', 'outlineColor', { def: '#000000' }),
        ...shadowSection('Text shadow', { text: true }),
      ], { open: false }),
      section('Background', [
        color('Fill', 'bg', { clearable: true, def: '#ffffff' }), range('Padding', 'pad', { min: 0, max: 80, unit: 'px' }), range('Corners', 'radius', { min: 0, max: 200, unit: 'px' }),
      ], { open: false, adv: true }),
    ];
  }
  function shapePanel() {
    const kind = first().kind;
    return [
      section('Shape', [
        select('Shape', 'kind', [['rect', 'Rectangle'], ['ellipse', 'Circle / oval'], ['triangle', 'Triangle'], ['star', 'Star'], ['heart', 'Heart'], ['frame', 'Frame (outline)']]),
        kind !== 'frame' ? color('Fill', 'fill', { def: '#ff7aa8' }) : null,
        color(kind === 'frame' ? 'Colour' : 'Outline', 'stroke', { def: '#111111' }),
        range(kind === 'frame' ? 'Thickness' : 'Outline width', 'strokeW', { min: 0, max: 40, unit: 'px' }),
        (kind === 'rect' || kind === 'frame') ? range('Corners', 'radius', { min: 0, max: 400, unit: 'px' }) : null,
        (kind === 'frame' || kind === 'rect') ? select('Line style', 'strokeStyle', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double']]) : null,
      ]),
      geometry(),
      section('Shadow', shadowSection(), { open: false }),
      section('Advanced', [linkField()], { open: false, adv: true }),
    ];
  }
  function emojiPanel() {
    return [
      section('Sticker', [
        text('Emoji', 'char', { placeholder: 'Type or paste an emoji' }),
        h('div', { class: 'emoji-grid' }, EMOJI.map((c) => h('button', { type: 'button', class: 'emoji-b', onclick: () => ed.set({ char: c }, 'emoji') }, c))),
      ]),
      geometry(),
      section('Shadow', shadowSection(), { open: false }),
      section('Advanced', [linkField()], { open: false, adv: true }),
    ];
  }
  function dividerPanel() {
    return [
      section('Divider', [
        select('Style', 'style', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['double', 'Double'], ['wavy', 'Wavy']]),
        color('Colour', 'color', { def: '#111111' }), range('Thickness', 'thickness', { min: 1, max: 30, unit: 'px' }),
      ]),
      geometry({ noH: true }),
    ];
  }
  function audioPanel() {
    const e = first();
    const a = store.byId(e.assetId);
    return [
      section('Music player', [
        h('div', { class: 'thumb-row' }, h('div', { class: 'ph-mini', html: icon('music', 22) }), h('div', {}, h('div', { class: 'small-note' }, a ? a.name : 'No audio chosen'),
          btn(e.assetId ? 'Replace…' : 'Choose audio…', 'music', async () => { const x = await pickAsset({ kinds: ['audio'], title: 'Choose audio' }); if (x) ed.set({ assetId: x.id, title: e.title || x.name }, 'audio'); }))),
        text('Title', 'title', { placeholder: 'Song name' }),
        select('Look', 'theme', [['light', 'Light'], ['dark', 'Dark'], ['pink', 'Pink']]),
        h('p', { class: 'small-note' }, 'Visitors press play themselves; music never starts automatically.'),
      ]),
      geometry({ noRot: false }),
    ];
  }
  function embedPanel() {
    return [
      section('Embed', [
        text('Link', 'url', { placeholder: 'YouTube, Spotify, Vimeo or any https:// page' }),
        h('p', { class: 'small-note' }, 'Paste a video or music link. It loads inside a sandboxed frame. Embeds appear in Preview and on the published page.'),
      ]),
      geometry(),
    ];
  }
  function htmlPanel() {
    return [
      section('Custom HTML', [
        text('HTML', 'code', { multiline: true, rows: 9, mono: true }),
        h('p', { class: 'small-note' }, 'Runs in an isolated sandbox: it can’t read your page, cookies or account, and can’t navigate away. Use for widgets and counters.'),
      ]),
      geometry(),
    ];
  }

  /* ---------- page panel ---------- */
  function pagePanel() {
    const s = () => ed.doc().settings;
    const setS = (patch, key) => ed.setSettings(patch, key);
    const colorIn = h('input', { type: 'color', 'aria-label': 'Background colour' });
    colorIn.addEventListener('input', () => setS({ bg: colorIn.value }, 'bg'));
    reg(() => (colorIn.value = parseColor(s().bg).hex));
    const bgAsset = store.byId(s().bgAsset);
    const mkSeg = (key, items) => { const w = h('div', { class: 'seg' }); const bs = items.map(([v, l]) => h('button', { type: 'button', class: 'seg-b', onclick: () => setS({ [key]: v }) }, l)); w.append(...bs); reg(() => items.forEach(([v], i) => bs[i].classList.toggle('on', s()[key] === v))); return w; };
    const numS = (label, key, min, max, unit = 'px') => { const i = h('input', { type: 'number', min, max, step: 10, 'aria-label': label }); i.addEventListener('input', () => { if (i.value !== '') setS({ [key]: clamp(+i.value, min, max) }, 'ps' + key); }); reg(() => { if (document.activeElement !== i) i.value = s()[key]; }); return row(label, i, h('span', { class: 'unit' }, unit)); };
    const selS = (label, key, opts) => { const x = h('select', { 'aria-label': label }, opts.map(([v, l]) => h('option', { value: v }, l))); x.addEventListener('change', () => setS({ [key]: x.value })); reg(() => (x.value = s()[key])); return row(label, x); };
    const cur = store.byId(s().cursorAsset);
    return [
      h('div', { class: 'panel-title' }, 'Page'),
      h('p', { class: 'hint' }, 'Select something on the page to see its options here.'),
      section('Background', [
        row('Colour', colorIn),
        h('div', { class: 'thumb-row' }, bgAsset ? h('img', { src: bgAsset.url, alt: '' }) : h('div', { class: 'ph-mini' }, 'None'),
          h('div', { class: 'btnrow wrap' }, btn(bgAsset ? 'Change image…' : 'Background image…', 'image', async () => { const a = await pickAsset({ kinds: ['image', 'gif'], title: 'Choose a background' }); if (a) setS({ bgAsset: a.id }); }),
            bgAsset ? btn('Remove', 'x', () => setS({ bgAsset: '' })) : null)),
        bgAsset ? row('Fill', mkSeg('bgSize', [['cover', 'Cover'], ['contain', 'Fit'], ['tile', 'Tile'], ['auto', 'Actual']])) : null,
        bgAsset ? selS('Position', 'bgPos', [['center', 'Centre'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']]) : null,
      ]),
      section('Layout', [
        row('Height', mkSeg('autoExpand', [[false, 'Fixed'], [true, 'Grows with content']])),
        numS('Width', 'width', 320, 1600),
        !s().autoExpand ? numS('Height', 'height', 300, 8000) : h('p', { class: 'small-note' }, 'The page gets taller as you place things lower down.'),
        selS('Wide screens', 'wide', [['center', 'Keep size, centred'], ['fit', 'Scale up to fill']]),
        h('p', { class: 'small-note' }, 'On phones the whole page scales down to fit automatically. Use the Preview button to check.'),
      ]),
      section('Mouse cursor', [
        h('div', { class: 'thumb-row' }, cur ? h('img', { src: cur.url, alt: '', style: { width: '32px', height: '32px', objectFit: 'contain' } }) : h('div', { class: 'ph-mini' }, 'Default'),
          h('div', { class: 'btnrow wrap' }, btn(cur ? 'Change…' : 'Custom cursor…', 'image', async () => { const a = await pickAsset({ kinds: ['image', 'gif'], title: 'Choose a cursor image' }); if (a) setS({ cursorAsset: a.id }); }), cur ? btn('Remove', 'x', () => setS({ cursorAsset: '' })) : null)),
        h('p', { class: 'small-note' }, 'Small transparent PNGs (32×32) work best.'),
      ], { open: false, adv: true }),
    ];
  }

  function multiPanel() {
    const n = ed.selected().length;
    const al = (dir, ic, t) => iconBtn(ic, t, () => ed.align(dir));
    return [
      h('div', { class: 'panel-title' }, `${n} items selected`),
      section('Align', [h('div', { class: 'btnrow' }, al('left', 'a-left', 'Align left'), al('center', 'a-center', 'Align centres'), al('right', 'a-right', 'Align right'), al('top', 'a-top', 'Align top'), al('middle', 'a-middle', 'Align middles'), al('bottom', 'a-bottom', 'Align bottom'))]),
      range('Opacity', 'opacity', { min: 0, max: 100, scale: 100, unit: '%', def: 1 }),
      arrange(true),
    ];
  }

  /* ---------- main ---------- */
  const TITLES = { image: 'Image', text: 'Text', link: 'Link', shape: 'Shape', divider: 'Divider', emoji: 'Sticker', audio: 'Music player', embed: 'Embed', html: 'HTML block' };
  function refresh() {
    syncers = [];
    const els = ed.selected();
    let kids;
    if (!els.length) kids = pagePanel();
    else if (els.length > 1) kids = multiPanel();
    else {
      const e = els[0];
      const body = { image: imagePanel, text: () => textPanel(false), link: () => textPanel(true), shape: shapePanel, emoji: emojiPanel, divider: dividerPanel, audio: audioPanel, embed: embedPanel, html: htmlPanel }[e.type]();
      kids = [h('div', { class: 'panel-title' }, TITLES[e.type] || 'Element', e.locked ? h('span', { class: 'tag' }, 'locked') : null), body, arrange(false)];
    }
    root.replaceChildren(...kids.flat());
    syncers.forEach((f) => f());
  }
  // rotation is stored as `rot` but exposed as `rotate` in controls
  const _first = first;
  function sync() { syncers.forEach((f) => f()); }
  root.refresh = refresh; root.sync = sync;
  return root;
}
