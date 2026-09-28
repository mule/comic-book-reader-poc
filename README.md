# Comic reader POC

Independent local PDF-to-web-reader experiment. Purchased source files and all derived artwork stay outside Git. The reader is intentionally a minimal React scaffold; conversion, reading and editing arrive in subsequent issues of epic #1.

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
```

`inventory` writes deterministic, artwork-free `corpus/inventory.json`. `--check` compares relative source paths, SHA-256 and byte sizes, names missing/changed/added books, returns 1 on any difference, and never rewrites the baseline. Use `--sources PATH` and `--output PATH` for a separate experiment. Defaults resolve relative to this source checkout, regardless of current directory; the Python package is intended for editable installation with uv, not distribution as a standalone wheel.

`contact-sheet` renders complete pages to JPEG thumbnails with a 1000-pixel longest edge and labeled 20-page sheets under `work/contact-sheets/`. Omit `--pages` to render all pages. `--output` must resolve inside this checkout's `work/`. Separate output directories avoid overwriting sheets from different selections. Page numbers are **one-based PDF order**, including covers and front matter.

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
{"format":"webp","quality":90,"long_edge_px":3056,"resolution_policy":"native-embedded-capped","thumbnail":{"format":"webp","quality":80,"long_edge_px":360}}
```

The complete format and annotation contract is in [docs/format.md](docs/format.md). `comicpoc validate PACKAGE --annotations FILE` also checks an exported annotation document against its book/source/page identity. All artwork remains untracked under `work/`; the source PDFs remain untouched.
