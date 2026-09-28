# Full-page reader evidence report (issue #5)

Date: 2026-09-28. Reader: `reader/` at commit `feat/5-reader` (see git log for exact commit).

## Environment

| Item | Value |
| --- | --- |
| Browser | Chrome 151.0.0.0 (Chromium via DevTools Protocol), `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36` |
| Desktop viewport | 1280x832 CSS px, devicePixelRatio 1 |
| Mobile-viewport emulation | 820x1180 CSS px, devicePixelRatio 2, touch + mobile flags (DevTools emulation) |
| Server | `pnpm dev` (Vite 7 dev server) against the real packages at `work/packages` (3 books, 389 pages); a second instance on another port with `COMIC_PACKAGES_DIR=../work/broken-packages` for failure injection |
| Input | Keyboard events dispatched as real key events; clicks via DevTools; no direct state manipulation |

**Real tablet/touch hardware testing is PENDING** — this report covers desktop Chrome and a touch-enabled viewport *emulation* only. Pinch/swipe/double-tap were implemented with pointer events and covered by unit tests, but have not been validated on physical hardware.

## Books navigated end to end

All three complete packages were opened from the library and paged through with ArrowRight from PDF page 1 to the final page, one page turn at a time:

| Book | Pages | Page-asset requests | Unique page URLs | Notes |
| --- | ---: | ---: | ---: | --- |
| Harbinger Vol. 1 | 149 | 158 | 158 | 149 for the full read; +2 reload window, +3 explicit back-turns, +4 thumbnail-jump window. Every request accounted for |
| Archer & Armstrong Vol. 1 | 111 | 111 | 111 | every page fetched exactly once |
| Quantum and Woody Vol. 1 | 129 | 129 | 129 | every page fetched exactly once |

Across the whole session (486 recorded requests, DevTools network log with preserved log): **0 requests for any `.pdf` and 0 requests touching `test-data`**. The dev-server middleware additionally returns 403 for any `.pdf` path under `/packages/`, 405 for non-GET/HEAD, and refuses to start against a root that resolves into `test-data` (all unit tested in `reader/plugins/comic-packages.test.ts`).

## Bounded loading and prefetch

Window policy: current page + 1 back + 2 ahead (explicit cap `MAX_WINDOW_ENTRIES = 8`; the default spec totals 4). Implemented in `reader/src/reading/pageWindow.ts` (framework-free, unit tested) and wired to image preloads in `usePageImages.ts`; leaving the window removes listeners and clears `src` on the preload `Image` handle.

Observed in the browser:

- Opening Harbinger requested exactly `manifest.json` + `COMPLETE.json` + **3 page images** (pages 1–3; at index 0 the window is 0,+1,+2). No other page traffic.
- One ArrowRight turn produced exactly **+1** page request (4 → 5 total). Two measured runs of 36 consecutive turns each produced exactly +36 requests.
- Paging to the end of Archer (111 pages) produced exactly 111 page-asset requests; Quantum and Woody exactly 129. No speculative fetching beyond the 2-ahead window, no accumulation.
- Going backwards re-serves pages from the browser HTTP cache (assets carry `Cache-Control: public, max-age=3600`), so back-turns within a session add at most the window edges.
- The DevTools network log shows page requests arriving strictly in sequential request IDs (…0034.webp, …0035.webp, …0036.webp) matching the reading order defined by `page_order`.

## Memory / decoded-image observations

- `document.querySelectorAll('.page-image')` stayed at **1** rendered page element throughout all three books (only the current page exists in the DOM).
- Chrome `performance.memory.usedJSHeapSize` (Chrome-only API, indicative): 7 MB after reading all 149 Harbinger pages, 8 MB after Archer, 9 MB after Quantum and Woody — flat, not proportional to the ~250 MB of WebP that 389 pages represent. The reader never holds references to out-of-window images (unit tests in `pageWindow.test.ts` assert acquire/release bookkeeping; release clears `src`).
- Chrome's internal decoded-image cache may retain recently shown bitmaps; that is browser-managed memory outside reader control. The reader-side obligations — bounded window, bounded DOM, dropped references — are met and measured.
- Thumbnail strip: opening it renders 149 placeholder buttons but only **27 thumbnail images** were actually requested (native `loading="lazy"`), limited to the visible neighborhood.

## Reading position persistence

Position is stored per `(book.id, source.sha256)` in localStorage (`comicpoc:reading-position:v1:<bookId>:<sha256>`, stores the page ID).

- Reload after finishing Harbinger restored **PDF page 149 / 149** and showed the explicit notice "Restored your position at the last page."
- A saved position whose page ID no longer exists (injected `…-9999`) produced "The saved reading position references page …-9999, which no longer exists in this package. Starting from the first page." and fell back to PDF page 1.
- A saved position under a different source revision produced "A saved reading position exists for a different source revision of this book (sha256 …). Positions never migrate across source changes; starting from the first page."
- Identity comes from the manifest, not the directory name: opening a directory copy of the sample package restored that book's position by `book.id`, as the format spec requires.

## Incompatible manifests and missing assets (failure injection)

Temporary broken packages were created under `work/broken-packages/` (gitignored; never committed) and served by a second dev instance with `COMIC_PACKAGES_DIR=../work/broken-packages`:

| Fixture | Symptom | Reader behavior (verified in browser) |
| --- | --- | --- |
| `future-manifest` | `schema_version: 2` (COMPLETE.json hash updated to match) | Error screen: "This reader supports manifest schema_version 1, but the package declares 2." with Retry and Back to library. Listed in the library (marker present) but rejected on open |
| `broken-asset` | one `pages/*.webp` deleted from a valid package | Per-page error state naming the failing URL, with Retry and Previous page; navigation to other pages unaffected. Restoring the file and clicking Retry loaded the page (recovery verified) |
| `no-complete` | `COMPLETE.json` removed | Excluded from `/packages/index.json` (the index lists only the two packages with markers); deep link shows "Package … is incomplete: the COMPLETE.json marker is missing, so the reader refuses to open it." |

The reader also verifies the manifest text against the `sha256` recorded in `COMPLETE.json` (WebCrypto) and fails visibly on mismatch (unit tested).

## Spreads, zoom and layout

- Harbinger PDF page 141 — the intact landscape spread, 1993x1533 — displayed complete at fit: rendered 1011.7x778.2 px inside the 1280x832 viewport (uniform scale 0.5076, no cropping, no rotation applied by the reader as `rotation_degrees` is 0).
- Keyboard zoom `+` scaled to 0.6346 anchored at viewport center; `0` returned to the exact fit transform (transform strings captured before/after).
- Thumbnail-strip jump to PDF page 100 switched the reader and prefetched only that window (4 page requests).
- Mobile-viewport emulation (820x1180, dpr 2, touch): page fits (733x1126), no horizontal overflow, stage uses `touch-action: none` with pointer-event gesture handling.

## Manifest validation

The reader validates with ajv (draft 2020-12) against the canonical `format/manifest.schema.json` **imported directly from the repo** (the dev network log shows Vite serving `/@fs/.../format/manifest.schema.json`; the production build inlines the same import — no copy exists under `reader/`). On top it implements the reader-applicable semantic checks from `docs/format.md`: page-order coverage, unique page IDs and PDF page numbers, per-selection coverage for `selection: all`, asset-path prefixes and duplicate asset paths, region bounds/order/positivity, orientation consistency, and the version gate. Wrong versions are rejected with a dedicated message before any geometry is trusted.

## How to reproduce

```sh
cd tools && uv run comicpoc import '../test-data/<Book>.pdf'   # if not already imported
cd ../reader && pnpm dev                                        # http://localhost:5173
```

Unit checks: `cd reader && pnpm typecheck && pnpm lint && pnpm test && pnpm build` (75 tests). Failure injection: copy a package under `work/broken-packages/`, mutate as above, run `COMIC_PACKAGES_DIR=../work/broken-packages pnpm dev -- --port 5200`.

## Orchestrator re-verification (2026-09-28)

Re-run after the corpus was re-imported with the #3 default profile (WebP q85, fixed 2400 px long edge), Playwright-driven Chromium at 1280x832 against `pnpm dev`:

- Library lists the three complete packages with lazily loaded covers; `/packages/<id>/pages/x.pdf` returns 403 and an encoded traversal attempt returns 404.
- Harbinger PDF p141 (2400x1846 spread) is shown intact and fits the viewport.
- From Home, 20 consecutive forward turns produced exactly one new `/pages/` request per turn (1…20), zero `.pdf`/`test-data` requests, one `<img>` in the DOM, JS heap ~9 MB.
- Reload restored PDF page 21; positions survived the profile re-import because page IDs depend only on source bytes.
- `pnpm dev` now binds to localhost only; LAN access is opt-in via `pnpm dev:lan`.
