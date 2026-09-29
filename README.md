# Comic reader POC

Independent local PDF-to-web-reader experiment. Purchased source files and all derived artwork stay outside Git. The `tools/` side inventories and imports purchased PDFs into local packages; the `reader/` app (React + TypeScript) reads them with bounded loading, zoom/pan and local progress. Guided reading and persistent manual panel editing are available in the reader.

## Setup and checks

Use Python 3.12, uv 0.11.15, Node 24 (also checked locally on 22.22.3), and pnpm 11.3.0. Dependency versions are recorded in `tools/uv.lock` and `reader/pnpm-lock.yaml`.

```sh
cd tools
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run pytest
cd ../reader
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev
```

CI uses generated synthetic PDFs only. The `corpus` pytest marker automatically skips purchased-source tests if root `test-data/` is absent. With local sources present, the default test run verifies the full corpus as well.

## Local corpus commands

Place the three purchased PDFs in root `test-data/` (a symlink is supported). Never modify or commit originals. Run from `tools/`:

```sh
uv run comicpoc inventory
uv run comicpoc inventory --check
uv run comicpoc contact-sheet '../test-data/Harbinger Vol 1 Omega Rising.pdf' --pages 11 23 34 44 58 141
uv run comicpoc compare-representations
```

`inventory` writes deterministic, artwork-free `corpus/inventory.json`. `--check` compares relative source paths, SHA-256 and byte sizes, names missing/changed/added books, returns 1 on any difference, and never rewrites the baseline. Use `--sources PATH` and `--output PATH` for a separate experiment. Defaults resolve relative to this source checkout, regardless of current directory; the Python package is intended for editable installation with uv, not distribution as a standalone wheel.

`contact-sheet` renders complete pages to JPEG thumbnails with a 1000-pixel longest edge and labeled 20-page sheets under `work/contact-sheets/`. Omit `--pages` to render all pages. `--output` must resolve inside this checkout's `work/`. Separate output directories avoid overwriting sheets from different selections. Page numbers are **one-based PDF order**, including covers and front matter.

`compare-representations` renders and benchmarks the 18 DEV pages from `corpus/evaluation-split.json` across candidate resolutions (1600, 2400, 3056, 3840 px) and encodings (PNG, WebP lossless/q75/q85/q92, JPEG q90) plus thumbnail candidates (240, 360 px). It measures render/encode time, output bytes, and PSNR vs native 3056 baseline, audits direct embedded-image extraction feasibility, evaluates panel crop derivative overhead vs full-page baseline, and generates side-by-side lettering crops and simulated viewport fits under `work/representation/`. See [representation report](docs/representation-report.md).


Inventory geometry is PDFium's effective page size in points (1/72 inch for this corpus), including page rotation; `rotation_degrees` records that rotation separately. Image counts include nested Form XObjects and count placements, not unique image streams. Largest image dimensions are chosen by pixel area. `has_text_objects` refers to PDF text objects, not lettering rasterized into images; this is not OCR. Form nesting beyond 64 levels fails explicitly. Password-protected PDFs that cannot open without a password fail rather than disappearing from the inventory; no password input is provided in this foundation.

See [evaluation policy and page selections](docs/evaluation-split.md) and [dependency licenses](docs/dependencies.md). Store local annotation exports in `local-annotations/` or as `*.annotations.json` (both ignored).

Verify ignore rules from root:

```sh
git check-ignore test-data 'test-data/Harbinger Vol 1 Omega Rising.pdf' work/contact-sheets/example.jpg
git status --short
```

For a symlinked `test-data`, Git may reject traversal through the symlink; `git check-ignore test-data` verifies that the entire source link is ignored, and `git check-ignore --no-index example.pdf` verifies the PDF rule independently.

## Import standalone comic packages

```sh
cd tools
uv run comicpoc import '../test-data/Harbinger Vol 1 Omega Rising.pdf' --pages 11 23 34 44 58 141 --output ../work/samples
uv run comicpoc import '../test-data/Harbinger Vol 1 Omega Rising.pdf'
uv run comicpoc validate ../work/packages/harbinger-vol-1-omega-rising
uv run python scripts/import_corpus.py
```

Use the exact source filenames from `corpus/inventory.json`. `--pages` takes one-based PDF numbers in the desired reading order; omit it for the entire book. Interrupted imports resume automatically using verified per-page checkpoints. Completed packages are immutable: changing source, selected pages or profile requires a different `--output` directory under `work/`. Identical reimports preserve page IDs and never touch annotation files.

`--profile profile.json` accepts rendering parameters (without the computed `id`):

```json
{"format":"webp","quality":85,"long_edge_px":2400,"resolution_policy":"fixed-long-edge","thumbnail":{"format":"webp","quality":80,"long_edge_px":360}}
```

The complete format and annotation contract is in [docs/format.md](docs/format.md). `comicpoc validate PACKAGE --annotations FILE` also checks an exported annotation document against its book/source/page identity. All artwork remains untracked under `work/`; the source PDFs remain untouched.

## Read the books

Import at least one package (above), then from `reader/`:

```sh
pnpm dev            # http://localhost:5173
```

The dev/preview server exposes imported packages read-only at `/packages/` from `COMIC_PACKAGES_DIR` (default `../work/packages`, relative to `reader/`). `/packages/index.json` lists only complete packages (`COMPLETE.json` present). The middleware refuses to serve `.pdf` files and refuses any root that resolves into `test-data`; it never writes to packages. Point it elsewhere with `COMIC_PACKAGES_DIR=path pnpm dev`.

The reader validates each manifest with ajv against the canonical `format/manifest.schema.json` plus the semantic checks from `docs/format.md`, verifies the manifest hash recorded in `COMPLETE.json`, loads only a bounded window (current page + 1 back / 2 ahead) and releases images outside it, and persists reading position in localStorage keyed by `book.id` + `source.sha256`. Keyboard: arrows/PageUp/PageDown/Home/End, `+`/`-`/`0` zoom, `Esc` reset; mouse wheel/drag/double-click and touch swipe/pinch/double-tap gestures; lazy thumbnail strip under "Pages".

Evidence from reading all three books end to end (network counts, bounded prefetch, memory, restore and failure behavior) is in [docs/reader-report.md](docs/reader-report.md).

### Guided reading and panel editing

The reader bar switches between **Full page**, **Guided** and **Edit regions** modes. Guided mode steps through the effective reading regions (suggestions merged with your manual overrides), fits each complete region in the viewport and crosses page boundaries; unannotated pages contribute one transient full-page step, and full-page mode always stays one click away. The editor draws/moves/resizes/reorders normalized rectangles over the page; edits are saved in localStorage per `(book.id, source.sha256)` and exported as an annotation document via **Annotations → Download**. See [docs/editor.md](docs/editor.md) for the merge semantics and the export → `work/annotations/<book_id>.annotations.json` → `comicpoc validate <package> --annotations <file>` handoff; the static server never writes edits to disk. Curated region sets for dev pages live in `corpus/curated-annotations/`, with browser evidence in [docs/editor-report.md](docs/editor-report.md).

### LAN tablet (no hosted infrastructure)

Everything is served from your machine; there is no backend beyond the Vite dev/preview server:

```sh
cd reader
pnpm dev:lan        # opt-in: binds 0.0.0.0; Vite prints a http://<lan-ip>:5173 URL
# or a production build:
pnpm build && pnpm exec vite preview --host 0.0.0.0   # opt-in LAN preview (port 4173)
```

`pnpm dev` binds to localhost only, so purchased artwork is never exposed to the network by default. Use `dev:lan` only on a trusted network. Open the printed LAN URL on a tablet connected to the same network. The reader is a static client; packages are streamed from the local packages directory only. Real tablet/touch hardware testing is **PENDING** — see the reader report; only desktop Chrome and a touch-enabled viewport emulation have been verified so far.

Guided browser verification (requires the real local packages):

```sh
cd reader && pnpm build
cd ../bench && pnpm install --frozen-lockfile && pnpm exec playwright install chromium
pnpm guided
```

Raw results go to `work/bench/guided.json`; `pnpm bench:smoke` exercises the same
checks against a generated synthetic package, including in CI. See
[editor report](docs/editor-report.md) for measured results and limitations.

## Detect panels on dev packages (Phase A)

```sh
cd tools
uv run comicpoc detect ../work/samples/archer-armstrong-vol-1-the-michelangelo-code \
  --output ../work/detection/frozen/archer-armstrong-vol-1-the-michelangelo-code \
  --report ../work/detection/archer-frozen.json \
  --overlays ../work/detection/overlays-frozen/archer
```

Use a new output package directory/report for each run. To preserve suggestion IDs on rerun, use the previous detected package as input. Only rendered page assets are read; split membership is checked before assets are opened. Defaults use the committed frozen configuration and permit **dev pages only**. See [detection approach and Phase B results](docs/detection.md) for republish semantics, metrics and limitations. Phase B now includes visually verified AI reference annotations for all 30 pages, separate dev/held-out results and a guided-reader integration check; the detector configuration remains frozen.

## Final evaluation & benchmarks

Automated corpus verification and end-to-end browser performance benchmarks live under `tools/` and `bench/`. All measurements derive from script runs with raw JSON saved under `work/bench/`.

### 1. Verify complete corpus against inventory

Verify that all 389 pages across all three packages in `work/packages/` match source SHA-256, page counts, sequential order, orientation, decodability and hashes:

```sh
cd tools
uv run comicpoc verify-corpus \
  --packages ../work/packages \
  --inventory ../corpus/inventory.json \
  --json ../work/bench/corpus-verification.json \
  --markdown ../work/bench/corpus-verification.md
```

### 2. Measure import timing & size on fresh output

```sh
cd tools
uv run python scripts/bench_import.py
```

### 3. Run browser performance benchmarks (Playwright)

Run cold first-page loads, warm page navigation latency (p50/p95), extended reading across all 389 pages with memory and bounded-prefetch sampling, and offline degradation tests:

```sh
cd bench
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm typecheck
pnpm bench
```

### 4. Synthetic smoke test (CI runnable)

Runs cold load, warm turns, zero forbidden request checks, and offline restoration against an ephemeral synthetic package:

```sh
cd bench
pnpm bench:smoke
```

See [docs/evaluation-report.md](docs/evaluation-report.md) for full benchmark findings, environment details, and PENDING validation items.


Phase B now includes AI-visually-authored references for all 30 evaluation pages, separate dev/held-out metrics, and estimated edit operations in [docs/detection.md](docs/detection.md). [Reference rules and snapshots](corpus/reference-annotations/README.md) and [raw results](corpus/detection-results-phase-b.json) contain no artwork. The frozen config is unchanged. On the tested main revision detected packages load in the full-page reader; guided suggestion integration is verified in the detection report.

DEV-only visual comparisons (all purchased images remain under ignored `work/`):

```sh
cd bench && pnpm exec tsx src/visual.ts
cd ../tools && uv run python scripts/compare_visual.py
uv run python scripts/evaluation_evidence.py
uv run python scripts/evaluation_tables.py
```

See the [final epic report](docs/evaluation-report.md) for reproduction, measured
results, inspected visual comparisons and explicit remaining validation gaps.
