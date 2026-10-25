# Profile Builder

A small, personal, Strawpage-style page builder: drag images, GIFs, text, stickers and music onto a freeform canvas, then publish the page at a shareable URL. Built for up to 5 users.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

On first launch the app asks you to create the **owner** account. The owner can add up to 4 **editors** from the account menu. Data lives in `./data` (back that folder up; it is the whole database).

Environment variables (all optional): `PORT` (3000), `DATA_DIR` (./data), `SECURE_COOKIES=1` (set when serving over HTTPS).

Tests: `npm test` runs an end-to-end API test (login, upload, save, publish, public fetch, deletion protection, sanitising).

---

## 1. Architecture and technology choices

| Layer | Choice | Why |
|---|---|---|
| Server | Node 22 + Express 4 | One process, no infrastructure, deploys anywhere Node runs (a $5 VPS, Fly, Railway, a Raspberry Pi). |
| Storage | JSON database file + uploads folder on disk | Right-sized for 5 users. Atomic writes, human-readable, trivially backed up. |
| Editor | Vanilla ES modules, **DOM-based** canvas, no build step | Every element is a real absolutely-positioned DOM node, so the editor and the public page render identically, GIFs animate natively, and text is real text. A `<canvas>` would make GIFs, text editing, accessibility and responsive output much harder. No framework or bundler means `npm start` is the whole toolchain. |
| Shared code | `shared/render.js`, `shared/templates.js` (ES modules used by both browser and server) | One renderer produces the editor canvas, the preview and the published HTML, so "what you see is what you publish". |
| Auth | Cookie sessions, scrypt password hashes | Proportionate: owner/editor, nothing more. |

No third-party editor library was adopted: the interactions needed (move, resize, rotate, snap, marquee, zoom/pan) are around 400 lines on pointer events and are fully under our control. Fonts load from Google Fonts on the public page (allowed in the CSP); everything else is self-hosted.

### Storage trade-offs

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `localStorage` | Zero setup | ~5 MB limit, per-browser, cannot be shared, synchronous, cleared by the browser | Not suitable for images or pages |
| IndexedDB | Large, async, works offline | Still per-browser/per-device, so **public sharing is impossible** and work does not follow you across devices | Fine for an offline-only tool; wrong here |
| **Backend + files on disk (chosen)** | Works across devices, public URLs, real uploads, survives cache clears, simple backups | Needs a running Node process and a persistent disk | Chosen |

Page documents never contain image bytes: elements reference assets by `assetId`, and files are stored in `data/uploads/`.

## 2. Minimum viable feature set

The end-to-end loop that was built and tested first: create profile → upload image → see it in the tray → drag it to the canvas → move/resize/layer → add text → autosave → preview → publish → open the public URL while logged out. Everything else (zoom/pan, snapping, groups, templates, folders, filters, embeds…) was layered on after that loop worked.

## 3. How the pieces interact

```
 Asset tray ──drag (assetId)──▶ Canvas ──element list──▶ Doc (JSON) ──debounced PUT──▶ /api/pages/:id (draft)
     ▲                              │                                                         │
     │ upload (multipart)           └── same renderer ──▶ Preview iframe (/preview/:id)        │ POST /publish
 /api/assets  ◀── files on disk                                                               ▼
                                                                       published snapshot ──▶ /p/:slug (public, no login)
```

* **Tray → canvas.** Dragging a tray thumbnail carries only the `assetId`. Dropping creates a *new* image/audio element that references it; the tray is never modified, so the same asset can be placed any number of times and across pages. Dropping onto an empty image placeholder (templates use these) fills it.
* **Canvas → save.** Every committed change (drag end, property edit, add/delete) pushes an undo snapshot and schedules an autosave (700 ms debounce). The status chip shows Saving / Saved / Error with retry and exponential back-off; a revision counter prevents a stale tab silently overwriting newer work, and the browser warns before leaving with unsaved changes.
* **Draft vs published.** Each page has a draft `doc` and an optional `published` snapshot. Editing never touches the live page; the toolbar shows "Unpublished changes" and **Publish updates** copies the draft to the snapshot. The URL slug never changes unless you change it.
* **Publish → public.** `/p/:slug` is rendered server-side from the snapshot: every value is escaped or validated, no user-supplied script ever runs on the page's origin, and a strict Content-Security-Policy is sent.

## 4. Risks and how they are handled

| Risk | Mitigation |
|---|---|
| Drag-and-drop feel (rotated resize, zoom, snapping) | Pointer events with pointer capture; all math done in page coordinates (`(client − pageRect)/zoom`) so it is zoom-independent; resize is computed in the element's rotated frame. |
| Losing work (save failure, refresh, two tabs) | Debounced autosave + retry, revision conflict detection, `beforeunload` warning, uploads are independent of saves so a failed save never discards an upload. |
| Responsive public pages for freeform layouts | Pages have a design width (default 960 px). Viewports narrower than that scale the whole page down to fit; wider viewports centre it. Editor has Desktop/Tablet/Phone preview. Auto-expanding height mode grows with content. |
| XSS / malicious embeds | Text is stored as plain text and escaped on render; links limited to http(s)/mailto; uploads validated by magic bytes (SVG is rejected); embeds are `https` iframes with `sandbox`; custom HTML blocks are served from a separate sandboxed (opaque-origin, CSP-locked) document. |
| Accidentally deleting a used asset | Server returns 409 with the list of pages using it; assets used by a *published* page require an extra explicit confirmation. |
| Performance with many images | Lazy-loaded thumbnails, immutable cache headers on files, only changed elements are re-rendered, upload limit 15 MB images / 25 MB audio. |

## 5. Decisions on ambiguous requirements

* **Categories** in the tray are derived automatically (Images, GIFs, Audio) plus user-made *collections* (use one called "Stickers" or "Backgrounds"). Only categories that contain something are shown.
* **Multi-select** supports move, duplicate, delete, align, group; resizing/rotating is for single selections and groups-as-boxes are not scaled.
* **Groups** are a shared `groupId`: clicking any member selects the whole group.
* **Text** is plain text only (no rich text), which keeps pages safe and the editor simple.
* **Thumbnails** use the original file (lazy-loaded); there is no image-processing dependency.
* **Audio** uses the browser's native player, never autoplays.
* **Assets are per user**; pages can reference any asset id, so a shared page works for visitors.
* **Slugs**: `a–z 0–9 -`, 2–40 chars, unique, some reserved words blocked. Public URL is `/p/<slug>`.
