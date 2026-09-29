# Guided reading and the manual panel editor

The reader (`reader/`) implements issue #6: manual panel editing, guided reading,
and an explicit export/import workflow. This document describes the behavior and,
most importantly, the handoff from browser edits back to preprocessing.

## Modes

The reader bar offers three modes for any open book:

- **Full page** — the complete page fitted in the viewport with free pan/zoom
  (the behavior of issue #5). Always reachable from every other mode.
- **Guided** — steps through the *effective regions* of each page in order,
  crossing page boundaries. `next` clamps at the last step; `previous` is the
  exact inverse of `next`. A page with no usable regions contributes one
  transient full-page step that is not a stored region id and cannot collide
  with annotations. Each complete region is fitted in the viewport via the
  existing camera abstraction (`reader/src/reading/camera.ts`); the user's
  zoom/pan is kept while reading a region (wide/tall panels, small lettering)
  and reset when moving to the next one. Transitions between regions on the
  same page animate; **all animation is disabled under
  `prefers-reduced-motion`** (instant cuts only). Rapid repeated navigation is
  deterministic: a new target always cancels the pending animation and wins.
  Resizing the window or rotating the device preserves the active region and
  refits it.
- **Edit regions** — the current page fitted as an editing canvas. Drag on the
  page to draw a rectangle; drag inside a rectangle to move it; drag a corner
  handle to resize; the side list shows the reading order with visible numbers
  and supports reordering by drag, ↑/↓ buttons or Alt+↑/↓ with the keyboard.
  Delete via ✕ or Delete/Backspace. Suggested regions (once #7 lands) render
  dashed; manual additions solid green; edited suggestions solid amber.

### Merge semantics (identical to the Python CLI)

The editor implements exactly `effective_regions` from
`tools/src/comicpoc/manifest.py` in `reader/src/annotations/merge.ts`:
start from the page `suggestions`, apply persistent tombstones, apply complete
edits/additions, then use the manual order; new surviving suggestions from a
detector rerun append after the curated sequence in detector order. Deleting a
suggestion records its id in `deleted_region_ids` **even if the id is absent
from the current suggestions**, so a later rerun cannot resurrect it. Editing a
suggestion stores a complete replacement rectangle with the original id.

## Persistence

- Manual annotations live in `localStorage` keyed by
  `(book.id, source.sha256)` and survive reloads. They never migrate across a
  source revision boundary.
- Reading progress stores page id **plus region id** (or `null` for the
  full-page fallback / full-page mode). A saved position whose page is gone is
  reported explicitly; a stale region id falls back to the page with a notice.

## Export / import handoff

1. In the reader, open **Annotations** → *Export* → **Download**
   `<book_id>.annotations.json` (a `schema_version: 1` document bound to
   `book_id` and `source_sha256`). The document is validated in the browser
   with ajv against the **same canonical file** the CLI uses,
   `format/annotations.schema.json`, plus identity and semantic checks
   identical to `validate_annotations`.
2. Save the file as `work/annotations/<book_id>.annotations.json`.
3. Validate it offline against the book package:

   ```sh
   cd tools && uv run comicpoc validate ../work/packages/<book_id> \
     --annotations ../work/annotations/<book_id>.annotations.json
   ```

4. **The static server never writes edits to disk.** The dev server
   (`pnpm dev`) is strictly read-only over `work/packages` and `work/samples`;
   nothing a browser does can modify a package, a manifest or a PDF. Getting
   edits into preprocessing is always this explicit export → save → validate →
   import pipeline. The Python importer likewise never reads or writes
   annotation files inside packages.

**Import** (browser): paste or choose a JSON document. It replaces the current
local edits **only after** full schema + identity validation. Documents bound
to another book, another source revision, or referencing unknown pages/regions
are rejected with a clear message and leave existing local edits untouched.

## Curated examples

`corpus/curated-annotations/<book_id>.json` holds manually curated region sets
for dev-split pages (see `corpus/evaluation-split.json`; held-out pages are
never annotated). These are plain annotation documents — coordinates only, no
artwork — under a filename that intentionally avoids the `*.annotations.json`
gitignore pattern so they can be committed. The browser evidence (versions,
viewports, reduced-motion and resize checks) is recorded in
[editor-report.md](editor-report.md).

Known limitation: real tablet testing is explicitly **PENDING** (issue #6
acceptance requires it on named devices).
