// Starter templates. They are plain documents (same format as any page) – starting points, not restrictive layouts.
// Image slots are empty image elements: drop an asset from the tray onto one to fill it.

let n = 0;
const id = () => 't' + ++n;
const base = (o) => ({ id: id(), x: 0, y: 0, w: 200, h: 200, rot: 0, opacity: 1, locked: false, ...o });
const text = (o) => base({ type: 'text', w: 360, h: 40, text: 'Text', font: 'Inter', size: 22, color: '#222222', align: 'left', ...o });
const img = (o) => base({ type: 'image', assetId: '', fit: 'cover', w: 220, h: 260, ...o });
const shape = (o) => base({ type: 'shape', kind: 'rect', fill: '#ffd1e3', ...o });
const emoji = (o) => base({ type: 'emoji', char: '⭐', w: 64, h: 64, ...o });
const divider = (o) => base({ type: 'divider', style: 'solid', color: '#222222', thickness: 3, w: 400, h: 20, ...o });
const link = (o) => base({ type: 'link', w: 260, h: 44, text: 'My link', href: 'https://example.com', font: 'Inter', size: 20, bold: true, color: '#222222', align: 'center', bg: '#ffffff', pad: 10, radius: 999, ...o });
const audio = (o) => base({ type: 'audio', assetId: '', title: 'My favourite song', theme: 'dark', w: 360, h: 80, ...o });
const shadow = { on: true, x: 3, y: 6, blur: 10, color: 'rgba(0,0,0,0.3)' };
const polaroid = { borderW: 8, borderColor: '#ffffff', shadow };

const doc = (settings, elements) => ({ settings: { bg: '#ffffff', width: 960, height: 1100, autoExpand: false, ...settings }, elements });

export const TEMPLATES = [
  {
    id: 'minimal', name: 'Minimal profile', description: 'Clean and calm: photo, name, bio and links.',
    doc: doc({ bg: '#faf8f5', height: 900 }, [
      img({ x: 390, y: 70, w: 180, h: 180, radius: 1000, borderW: 6, borderColor: '#ffffff', shadow }),
      text({ x: 230, y: 280, w: 500, h: 60, text: 'Your Name', font: 'DM Serif Display', size: 52, align: 'center' }),
      text({ x: 250, y: 355, w: 460, h: 70, text: 'A short line about you. What you make, what you love, where to find you.', size: 19, align: 'center', color: '#555555', lh: 1.5 }),
      divider({ x: 430, y: 450, w: 100, thickness: 3 }),
      link({ x: 350, y: 500, w: 260, text: 'My website', bg: '#222222', color: '#ffffff' }),
      link({ x: 350, y: 570, w: 260, text: 'Instagram', bg: '#ffffff' }),
      link({ x: 350, y: 640, w: 260, text: 'Say hello', href: 'mailto:you@example.com', bg: '#ffffff' }),
    ]),
  },
  {
    id: 'collage', name: 'Image collage', description: 'A pile of photos with white borders.',
    doc: doc({ bg: '#efece4', height: 1000 }, [
      text({ x: 180, y: 40, w: 600, h: 80, text: 'Little moments', font: 'Playfair Display', size: 64, italic: true, align: 'center' }),
      img({ x: 70, y: 170, w: 260, h: 320, rot: -5, ...polaroid }),
      img({ x: 350, y: 140, w: 270, h: 200, rot: 3, ...polaroid }),
      img({ x: 640, y: 180, w: 250, h: 330, rot: 6, ...polaroid }),
      img({ x: 330, y: 380, w: 300, h: 240, rot: -2, ...polaroid }),
      img({ x: 90, y: 560, w: 220, h: 220, rot: 4, ...polaroid }),
      img({ x: 650, y: 560, w: 230, h: 280, rot: -4, ...polaroid }),
      text({ x: 330, y: 700, w: 300, h: 60, text: 'write a caption here', font: 'Caveat', size: 34, align: 'center', color: '#6a5d4a' }),
    ]),
  },
  {
    id: 'dark', name: 'Dark aesthetic', description: 'Moody, high-contrast, a little mysterious.',
    doc: doc({ bg: '#0b0b10', height: 1000 }, [
      shape({ kind: 'frame', x: 40, y: 40, w: 880, h: 920, stroke: '#7b6cff', strokeW: 2, strokeStyle: 'solid', fill: 'transparent' }),
      text({ x: 80, y: 90, w: 800, h: 120, text: 'NIGHT SHIFT', font: 'Bebas Neue', size: 120, color: '#0b0b10', outlineW: 2, outlineColor: '#e8e6ff', align: 'center', ls: 8 }),
      img({ x: 110, y: 260, w: 330, h: 440, borderW: 2, borderColor: '#7b6cff', shadow: { on: true, x: 0, y: 0, blur: 24, color: 'rgba(123,108,255,0.6)' } }),
      text({ x: 490, y: 270, w: 380, h: 200, text: 'i collect moons,\nold songs,\nand things that glow\nin the dark.', font: 'Space Mono', size: 22, color: '#d8d4ff', lh: 1.7 }),
      divider({ x: 490, y: 500, w: 380, style: 'dashed', color: '#7b6cff', thickness: 2 }),
      text({ x: 490, y: 540, w: 380, h: 100, text: 'status: awake\nmood: nocturnal', font: 'Space Mono', size: 16, color: '#8c86c9', lh: 1.8 }),
      emoji({ char: '🌙', x: 780, y: 620, w: 90, h: 90, rot: 12 }),
      emoji({ char: '✦', x: 90, y: 740, w: 50, h: 50, rot: -10 }),
      link({ x: 330, y: 800, w: 300, text: 'enter →', bg: 'transparent', color: '#e8e6ff', radius: 0, font: 'Space Mono' }),
    ]),
  },
  {
    id: 'pastel', name: 'Pastel aesthetic', description: 'Soft colours, round shapes, hearts.',
    doc: doc({ bg: '#fff0f6', height: 1000 }, [
      shape({ kind: 'ellipse', x: -80, y: -90, w: 420, h: 420, fill: '#ffd6e8' }),
      shape({ kind: 'ellipse', x: 720, y: 120, w: 340, h: 340, fill: '#d9ecff' }),
      shape({ kind: 'ellipse', x: 560, y: 700, w: 460, h: 460, fill: '#e6ffd9' }),
      img({ x: 330, y: 150, w: 300, h: 300, radius: 1000, borderW: 10, borderColor: '#ffffff', shadow }),
      text({ x: 180, y: 480, w: 600, h: 80, text: 'hello, sunshine', font: 'Pacifico', size: 54, color: '#ff6fa5', align: 'center' }),
      text({ x: 250, y: 580, w: 460, h: 80, text: 'soft things, sweet things, small joys', font: 'Fredoka', size: 24, color: '#8a6a7e', align: 'center' }),
      shape({ kind: 'heart', x: 110, y: 420, w: 80, h: 72, fill: '#ff9ec4', rot: -12 }),
      shape({ kind: 'heart', x: 780, y: 560, w: 60, h: 54, fill: '#ffc0d9', rot: 14 }),
      shape({ kind: 'star', x: 150, y: 620, w: 70, h: 70, fill: '#ffe48a', rot: 10 }),
      link({ x: 350, y: 720, text: 'my favourite things', bg: '#ffffff', color: '#ff6fa5' }),
    ]),
  },
  {
    id: 'music', name: 'Music-inspired', description: 'Album art, a player and your top tracks.',
    doc: doc({ bg: '#17121f', height: 900 }, [
      shape({ kind: 'rect', x: 60, y: 60, w: 840, h: 780, fill: '#221a30', radius: 28 }),
      img({ x: 100, y: 100, w: 340, h: 340, radius: 14, shadow: { on: true, x: 0, y: 12, blur: 30, color: 'rgba(0,0,0,0.6)' } }),
      text({ x: 480, y: 110, w: 380, h: 30, text: 'NOW PLAYING', font: 'Space Mono', size: 14, color: '#ff6fb5', ls: 4 }),
      text({ x: 480, y: 145, w: 380, h: 110, text: 'Song title goes here', font: 'DM Serif Display', size: 46, color: '#ffffff', lh: 1.1 }),
      text({ x: 480, y: 280, w: 380, h: 30, text: 'Artist name', size: 20, color: '#b9a9d6' }),
      audio({ x: 480, y: 340, w: 380, h: 84, theme: 'dark' }),
      divider({ x: 100, y: 490, w: 760, style: 'wavy', color: '#ff6fb5', thickness: 2 }),
      text({ x: 100, y: 540, w: 760, h: 220, text: 'ON REPEAT\n1. a song I love\n2. another favourite\n3. the one that gets me every time\n4. late night drive', font: 'Space Mono', size: 20, color: '#e6dcf5', lh: 1.9 }),
    ]),
  },
  {
    id: 'scrapbook', name: 'Chaotic scrapbook', description: 'Stickers, tape, scribbles. Everything everywhere.',
    doc: doc({ bg: '#fff6c9', height: 1200 }, [
      text({ x: 60, y: 40, w: 560, h: 110, text: 'ALL ABOUT ME!!', font: 'Permanent Marker', size: 76, color: '#ff4f81', rot: -4, outlineW: 2, outlineColor: '#ffffff' }),
      shape({ kind: 'rect', x: 560, y: 70, w: 320, h: 70, fill: '#8fd3ff', rot: 3, opacity: 0.8 }),
      text({ x: 575, y: 85, w: 290, h: 40, text: 'under construction', font: 'Caveat', size: 36, rot: 3, align: 'center' }),
      img({ x: 80, y: 220, w: 300, h: 340, rot: -6, ...polaroid }),
      img({ x: 420, y: 200, w: 260, h: 220, rot: 5, ...polaroid }),
      img({ x: 700, y: 280, w: 200, h: 260, rot: -3, ...polaroid }),
      emoji({ char: '🌈', x: 380, y: 430, w: 110, h: 110, rot: -12 }),
      emoji({ char: '👾', x: 740, y: 130, w: 80, h: 80, rot: 15 }),
      shape({ kind: 'star', x: 40, y: 180, w: 80, h: 80, fill: '#ffd23f', rot: -20, strokeW: 3, stroke: '#222222' }),
      shape({ kind: 'heart', x: 640, y: 560, w: 100, h: 90, fill: '#ff6b9a', rot: 10 }),
      divider({ x: 60, y: 620, w: 840, style: 'wavy', color: '#ff4f81', thickness: 3 }),
      text({ x: 80, y: 670, w: 360, h: 220, text: 'things I like:\n- cats\n- stickers\n- 3am snacks\n- the colour pink', font: 'Caveat', size: 34, rot: -2, bg: '#ffffff', pad: 18, radius: 6, shadow }),
      text({ x: 500, y: 700, w: 380, h: 180, text: 'things I do not like:\n- mondays\n- socks with sandals', font: 'Caveat', size: 34, rot: 2, bg: '#d9f7c9', pad: 18, radius: 6, shadow }),
      link({ x: 330, y: 960, text: 'click here!!!', bg: '#ff4f81', color: '#ffffff', font: 'Permanent Marker', radius: 12, rot: -3 }),
    ]),
  },
  {
    id: 'character', name: 'Character profile', description: 'Portrait, stats and a bit of lore.',
    doc: doc({ bg: '#ece3d3', height: 1000 }, [
      shape({ kind: 'frame', x: 30, y: 30, w: 900, h: 940, stroke: '#4a3b2a', strokeW: 6, strokeStyle: 'double' }),
      img({ x: 80, y: 90, w: 340, h: 500, borderW: 6, borderColor: '#4a3b2a', shadow }),
      text({ x: 460, y: 90, w: 420, h: 80, text: 'Character Name', font: 'Playfair Display', size: 50, color: '#3b2d1e' }),
      text({ x: 460, y: 170, w: 420, h: 30, text: '“a short, memorable quote”', font: 'Lora', size: 20, italic: true, color: '#6b5844' }),
      divider({ x: 460, y: 220, w: 420, color: '#4a3b2a', thickness: 3 }),
      text({ x: 460, y: 250, w: 420, h: 260, text: 'Age: —\nSpecies: —\nRole: —\nHome: —\nAlignment: —\nLikes: —', font: 'Lora', size: 22, color: '#3b2d1e', lh: 1.9 }),
      divider({ x: 80, y: 630, w: 800, style: 'dotted', color: '#4a3b2a', thickness: 4 }),
      text({ x: 80, y: 670, w: 800, h: 40, text: 'BACKSTORY', font: 'Bebas Neue', size: 34, color: '#4a3b2a', ls: 6 }),
      text({ x: 80, y: 720, w: 800, h: 200, text: 'Tell their story here. Where they came from, what they want, what they are afraid of.', font: 'Lora', size: 19, color: '#3b2d1e', lh: 1.7 }),
    ]),
  },
];
