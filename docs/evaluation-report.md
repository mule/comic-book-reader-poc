# Final epic evaluation — comic content format and reference reader

Evaluated locally on 2026-09-29 from merged main `f8105c5fc0c7d1edae326370459f41c6feebd63b`.
Only evaluation tooling, examples and documentation changed for this report.
The reader and detector implementation remained unchanged. This supersedes the
Phase A measurements; it does **not** declare the physical-tablet acceptance met.

The POC preserves complete pages, supports manually curated guided reading and
survives the exercised reload and network-loss cases. Keep the full-page asset
plus normalized regions format for the next experiment. Prioritize actual tablet
reading and human correction timing before wider detector investment.

## Environment and reproduction

Raw runtime/dependency snapshot: `work/bench/evidence.json`; browser/host snapshot:
`work/bench/reader-benchmark.json`.

- Host: linux 7.0.11-76070011-generic (x64); Intel(R) Core(TM) i7-10510U CPU @ 1.80GHz;
  8 logical CPUs; 31.01 GiB RAM.
- Python 3.12.3; pypdfium2 5.13.0;
  PDFium 153.0.7999.0; Pillow 12.3.0.
- Node v22.22.3; pnpm 11.3.0;
  Playwright 1.63.0;
  Chromium 153.0.8010.12;
  React 19.3.0;
  Vite 7.3.6.


Desktop is headless Chromium at **1280×800, DPR 1** on the named Linux machine.
Tablet **EMULATION** uses **1180×820** and **820×1180**, DPR 2, mobile and touch flags;
it is the same host and browser, not tablet hardware. Production Vite preview
serves localhost over loopback without latency throttling. Cold runs use fresh
contexts and CDP-disabled HTTP cache; warm, extended, guided and offline runs
use fresh contexts with HTTP cache enabled. The raw reader report's global
`cacheState` label describes cold runs only; per-case conditions are as above.
No persistent browser profile is reused.

Install locked dependencies and build the reader first:

```sh
(cd tools && uv sync --locked)
(cd reader && pnpm install --frozen-lockfile && pnpm build)
(cd bench && pnpm install --frozen-lockfile && pnpm exec playwright install chromium)
mkdir -p work/bench
(cd tools && uv run comicpoc verify-corpus --packages ../work/packages \
  --inventory ../corpus/inventory.json --json ../work/bench/corpus-verification.json \
  --markdown ../work/bench/corpus-verification.md) > work/bench/verify.log 2>&1
(cd tools && uv run python scripts/bench_import.py) > work/bench/import.log 2>&1
(cd bench && pnpm bench) > work/bench/bench.log 2>&1
(cd bench && pnpm guided) > work/bench/guided.log 2>&1
(cd bench && pnpm exec tsx src/visual.ts) > work/bench/visual.log 2>&1
(cd tools && uv run python scripts/compare_visual.py) > work/bench/compare.log 2>&1
(cd tools && uv run python scripts/evaluation_evidence.py) > work/bench/evidence.log 2>&1
(cd tools && uv run python scripts/evaluation_tables.py) > work/bench/tables.log 2>&1
```

The packages prerequisite is the complete default import of each inventory PDF
into `work/packages/`; see [import instructions](../README.md).
Raw evidence is local and ignored under `work/bench/`: `corpus-verification.json`,
`import-benchmark.json`, `reader-benchmark.json`, `guided.json`, `visual.json`,
`evidence.json` and generated `tables.md`. `commands.md` records the actual command
sequence, including discarded preliminary timings. Final import and browser runs
were sequential; the machine was not a controlled benchmark appliance.
Single-run samples establish a local baseline, not confidence intervals or
production/network performance. No purchased artwork or PDFs are in the report.

## Corpus verification

Overall result: **PASSED**
Total books: 3 | Total pages: 389 | Total assets decoded: 778

| Book ID | Pages | Source SHA256 Match | Order Contiguous | Orientations | Assets Decodable & Hash-Match | COMPLETE Marker | Status |
| --- | ---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `archer-armstrong-vol-1-the-michelangelo-code` | 111 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASSED** |
| `harbinger-vol-1-omega-rising` | 149 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASSED** |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 129 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASSED** |

All 389 pages across 3 packages verified without silent omissions, corruption, or geometry discrepancies.

Verification reconciles source fingerprints, complete ordered page coverage,
orientation, decodable asset dimensions/checksums and `COMPLETE.json` integrity.
This confirms structural completeness; it is not a visual audit of every page.

## Import and storage

| Book | Pages | Source B | Import s | Page B min / mean / max | Assets B | Package B incl. metadata |
| --- | --- | --- | --- | --- | --- | --- |
| Archer & Armstrong | 111 | 68357268 | 59.53 | 41132 / 390362 / 648268 | 45636980 | 45818350 |
| Harbinger | 149 | 94015425 | 74.66 | 34742 / 393601 / 622448 | 61794722 | 62037763 |
| Quantum and Woody | 129 | 124784980 | 68.55 | 75638 / 463151 / 891064 | 62914134 | 63124799 |

## Page navigation

| Book | Viewport | Cold decode ms | Warm turns | Warm p50 / p95 ms |
| --- | --- | --- | --- | --- |
| Archer & Armstrong | Desktop 1280x800 | 244.24 | 40 | 112.5 / 139.78 |
| Archer & Armstrong | Tablet EMULATION 1180x820 | 269.28 | 40 | 118.91 / 141.04 |
| Archer & Armstrong | Tablet EMULATION 820x1180 | 270.09 | 40 | 115.72 / 151.77 |
| Harbinger | Desktop 1280x800 | 290.38 | 40 | 127.34 / 151.21 |
| Harbinger | Tablet EMULATION 1180x820 | 291.99 | 40 | 118.27 / 152.3 |
| Harbinger | Tablet EMULATION 820x1180 | 282.75 | 40 | 120.37 / 152.29 |
| Quantum and Woody | Desktop 1280x800 | 266.89 | 40 | 118.06 / 156.4 |
| Quantum and Woody | Tablet EMULATION 1180x820 | 285.23 | 40 | 117.61 / 153.95 |
| Quantum and Woody | Tablet EMULATION 820x1180 | 267.47 | 40 | 118.68 / 155.3 |

## Extended reading

| Book | Viewport | Pages / requests | PDF / test-data requests | Max sampled DOM images | Sampled JS heap MiB min / max / final | Bounded prefetch |
| --- | --- | --- | --- | --- | --- | --- |
| Archer & Armstrong | Desktop 1280x800 | 111 / 111 | 0 / 0 | 1 | 6.55 / 9.33 / 9.33 | True |
| Archer & Armstrong | Tablet EMULATION 1180x820 | 111 / 111 | 0 / 0 | 1 | 6.64 / 9.42 / 9.42 | True |
| Archer & Armstrong | Tablet EMULATION 820x1180 | 111 / 111 | 0 / 0 | 1 | 6.57 / 9.32 / 9.32 | True |
| Harbinger | Desktop 1280x800 | 149 / 149 | 0 / 0 | 1 | 5.89 / 9.01 / 5.89 | True |
| Harbinger | Tablet EMULATION 1180x820 | 149 / 149 | 0 / 0 | 1 | 5.94 / 9 / 5.94 | True |
| Harbinger | Tablet EMULATION 820x1180 | 149 / 149 | 0 / 0 | 1 | 4.95 / 9.13 / 6.05 | True |
| Quantum and Woody | Desktop 1280x800 | 129 / 129 | 0 / 0 | 1 | 5.53 / 8.95 / 5.68 | True |
| Quantum and Woody | Tablet EMULATION 1180x820 | 129 / 129 | 0 / 0 | 1 | 5.59 / 9.01 / 5.78 | True |
| Quantum and Woody | Tablet EMULATION 820x1180 | 129 / 129 | 0 / 0 | 1 | 5.62 / 8.98 / 5.82 | True |

## Lost network after load

| Book | Viewport | Cached page status | Unvisited page / status | Retry + previous buttons |
| --- | --- | --- | --- | --- |
| Archer & Armstrong | Desktop 1280x800 | loaded | 9 / error | True |
| Archer & Armstrong | Tablet EMULATION 1180x820 | loaded | 9 / error | True |
| Archer & Armstrong | Tablet EMULATION 820x1180 | loaded | 9 / error | True |
| Harbinger | Desktop 1280x800 | loaded | 9 / error | True |
| Harbinger | Tablet EMULATION 1180x820 | loaded | 9 / error | True |
| Harbinger | Tablet EMULATION 820x1180 | loaded | 9 / error | True |
| Quantum and Woody | Desktop 1280x800 | loaded | 9 / error | True |
| Quantum and Woody | Tablet EMULATION 1180x820 | loaded | 9 / error | True |
| Quantum and Woody | Tablet EMULATION 820x1180 | loaded | 9 / error | True |

## Guided navigation

| Book | Viewport | Steps | p50 / p95 ms |
| --- | --- | --- | --- |
| Archer & Armstrong | Desktop 1280x800 | 34 | 299.91 / 317.11 |
| Archer & Armstrong | Tablet EMULATION 1180x820 | 34 | 299.88 / 301.46 |
| Archer & Armstrong | Tablet EMULATION 820x1180 | 34 | 299.92 / 317.08 |
| Harbinger | Desktop 1280x800 | 22 | 300 / 316.66 |
| Harbinger | Tablet EMULATION 1180x820 | 22 | 299.56 / 317.11 |
| Harbinger | Tablet EMULATION 820x1180 | 22 | 300.1 / 316.48 |
| Quantum and Woody | Desktop 1280x800 | 34 | 299.96 / 317.34 |
| Quantum and Woody | Tablet EMULATION 1180x820 | 34 | 299.93 / 317.07 |
| Quantum and Woody | Tablet EMULATION 820x1180 | 34 | 299.89 / 318.01 |

## Interpreting the measurements

Import uses fixed long edge 2400 px, WEBP quality 85;
thumbnails use 360 px and quality 80, as recorded in the raw output.
Package bytes include manifest and completion metadata; asset bytes include page
and thumbnail files only. The earlier Phase A report mislabeled asset-only bytes
as package bytes. Fresh output prevents package reuse; OS filesystem caches were
not flushed. Times are end-to-end local conversion, not cold-disk measurements.

Cold latency runs from navigation until the first page is decoded and a render
frame has elapsed. Warm page latency includes Playwright keypress, image decode
and the following animation frame, with paced sequential turns and prefetch.
Warm percentiles use the existing sorted-array floor-index convention; guided
percentiles use nearest rank. These are browser/driver measurements, not externally
measured display latency. Prefetch helps; it does not guarantee every next page
is cached on a slower device or network.

Extended runs visit every page in each book in every listed viewport. Heap
samples are CDP **JavaScript heap**, expressed in MiB, sampled periodically; they
exclude decoded image, GPU and total browser process memory. Bounded requests and
sampled DOM image counts support bounded loading. They do **not** prove “zero leaks” or bounded
total device memory. No PDF or `test-data` requests were observed by the scripts.

Guided timings come from the standalone `pnpm guided` run. They mix panel changes
with adjacent full-page fallback boundaries and include the configured camera
animation, independent transform verification, decode and animation-frame waits.
They should not be read as asset-fetch latency or compared directly with page turns.
The full benchmark also embeds its own guided run in `reader-benchmark.json`.

Offline tests disconnect the context after loading and visiting a page. Returning
to a recently visited page succeeds; navigating beyond the cached/prefetched
window shows the per-page error with Retry and Previous page controls. The message
still says the asset may be missing or corrupt, so network loss is poorly explained.
This tests **lost network after load**, not offline installation, reopening the
application offline, or durable downloaded-book storage.

## Visual fidelity: inspected DEV sequences

Playwright captured complete reader screenshots and stage screenshots at page fit
and every curated stop on the sequences below. PDFium rendered the corresponding
source PDF pages directly at **4800 px long edge**, twice the package asset scale.
`compare_visual.py` maps those renders into the recorded browser camera geometry
and places reader and source side by side. This retains neighboring artwork around
a region, as the reader does. Black surround shades and the reader's blue region
outline are UI differences, not PDF content differences.

I opened all four sequence contact sheets and the separate page-fit and second-stop
comparison for each sequence. The contact sheets show sequence coverage; the larger
comparisons support the detail observations below. No held-out page was rendered or
inspected for this evaluation. These are AI visual observations, not human comfort
ratings or a claim that every glyph on every page was checked.

| Book | Inspected DEV sequence | Page-fit observation | Panel-fit observation |
| --- | --- | --- | --- |
| Archer & Armstrong | PDF page 7, horizontal strips | Composition, gutters and balloons match the source; small lettering is cramped at full-page fit. | Balloon lettering is readable at strip fit. Face contours, cloth folds and spear edges remain recognizable; the reader smooths wall grain and fine hatching compared with PDFium. Neighboring strips remain visible above/below the selected strip. |
| Harbinger | PDF page 11; PDF page 141 spread | Page 11's crowded lower-panel balloons are too small for comfortable reading at page fit. The spread stays complete, with the large central action and corner insets in their source positions. | Page 11's speech and caption blocks are clearer at panel fit; facial and clothing lines look softer than the source. On the spread, inset lettering becomes readable; building-window texture and thin edges are visibly softer. The guided sequence moves through insets and the broad composition without splitting the stored page. |
| Quantum and Woody | PDF page 10, strips, caption band and narrower panels | Panel grid and muted colors match; the small multi-balloon row benefits from zoom. | Caption and balloon letterforms remain distinct. Fine suit hatching, hair and thin wall outlines look less crisp than PDFium; no missing balloon or gross artwork displacement was apparent in the inspected sequence. |

Local artifacts follow `work/visual/<book-id>-p<page>-page-comparison.png`,
`...-panel-<stop>-comparison.png`, `...-reader.png` and `...-sequence.png`.
`work/bench/visual.json` enumerates source page, normalized region, camera geometry
and exact comparison paths. No perceptual score is invented. The PDF itself may
contain raster artwork: a larger PDFium render is a source reference, not proof of
additional native detail. Human reading comfort and higher-DPR fidelity remain open.

## Exercised persistence and reader behavior

| Book | Reload / annotation persistence | Boundaries and geometry | Evidence |
| --- | --- | --- | --- |
| Archer & Armstrong | Non-first panel and page restored; exported annotations equal imported data after reload | All curated regions forward/backward; adjacent unannotated-page fallback; resize and zoom/reset | `guided.json` checks and samples |
| Harbinger | Non-first panel and page restored; annotations preserved | Portrait and spread regions; full-page return; fallback; resized viewport fit | `guided.json`, inspected spread captures |
| Quantum and Woody | Non-first panel and page restored; annotations preserved | All curated regions forward/backward; fallback and full-page return; resize and zoom/reset | `guided.json` checks and samples |

Each book ran on desktop and both labelled tablet emulations. The guided script
also exercises real UI import/download, rejection of mismatched documents without
losing edits, draw/move/resize/reorder/delete, rapid navigation and reduced motion.
Reload checks use the same browser context/origin. Cross-device persistence is not
implemented; changing the server origin changes localStorage scope. Export is the
portable backup, and the static server does not save browser edits to disk.

## Detector evidence and correction effort

| Book | Split | Pages | Matched | Missed | Spurious | Estimated edit ops | Matched ordering inversions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Archer & Armstrong | dev | 6 | 24 | 11 | 4 | 16 | 0 |
| Harbinger | dev | 6 | 9 | 24 | 0 | 24 | 0 |
| Quantum and Woody | dev | 6 | 32 | 4 | 0 | 6 | 0 |
| Archer & Armstrong | heldout | 4 | 11 | 3 | 0 | 3 | 0 |
| Harbinger | heldout | 4 | 16 | 1 | 0 | 1 | 0 |
| Quantum and Woody | heldout | 4 | 16 | 3 | 1 | 5 | 0 |

## Detector split totals

| Split (all books) | Reference regions | Precision | Recall | Estimated ops / page |
| --- | --- | --- | --- | --- |
| dev | 104 | 94.20% | 62.50% | 2.56 |
| heldout | 50 | 97.73% | 86.00% | 0.75 |

The current-tree extraction script reads
[`corpus/detection-results-phase-b.json`](../corpus/detection-results-phase-b.json)
and saves its hash, original base and results in `work/bench/evidence.json`.
These are **the frozen prior Phase B measurements, not a new detector run**.
The source provenance remains intact. No held-out inference or tuning was repeated.
References were visually made by an AI agent, not human ground truth; development
exposure was disclosed. Layout-selected samples are small and do not establish
population accuracy. Higher held-out recall does not establish generalization.

“Estimated edit ops” counts evaluator-defined additions, deletions, resizes and
reorders; it is not elapsed editor time. Ordering inversions apply only to matched
regions. The documented Archer balloon-cutoff case falls below the resize threshold,
so even a zero estimated count can miss a visible correction need. See
[detection report](detection.md) for per-page failures, definitions and provenance.
Human reference review and measured human correction time remain **PENDING**.

## Format and usage

The experimental package has a versioned manifest, explicit page order, source
fingerprint, render profile, full-page asset and thumbnail hashes, and a completion
marker. Region rectangles use normalized page coordinates. Detector suggestions
stay in the immutable package; manual additions/edits/deletions/order live in a
separate annotation document tied to book and source identity. A page without
regions contributes a transient full-page guided stop, never a fabricated annotation.

The complete **synthetic** [manifest example](examples/manifest.json) and
[annotation example](examples/annotations.json) contain no corpus identifiers or
artwork. Their placeholder source/asset hashes illustrate metadata, not a loadable
package. The actual schema and semantic validators in `comicpoc` validate both in
`tools/tests/test_documented_examples.py`; malformed schema and identity controls
must fail. The annotation's core is:

```json
{"added_regions": [{"id": "m-top", "x": 0.05, "y": 0.05, "width": 0.9, "height": 0.4}],
 "edited_regions": [], "deleted_region_ids": [], "order": ["m-top"]}
```

Use the [README](../README.md) for locked setup, conversion and localhost serving;
[format specification](format.md) for schema/validation and immutable publication;
[import report](import-report.md) and [representation report](representation-report.md)
for conversion choices; [reader report](reader-report.md) for loading/progress;
and [editor guide](editor.md) for guided mode and manual correction.
In the reader, choose **Full page**, **Guided**, or **Edit regions**. Save portable
edits through **Annotations → Download**; import the JSON through the same panel.
Validate an exported file with `comicpoc validate <package> --annotations <file>`.

## Tested vs remaining gaps

| Area | Status | Scope / remaining gap |
| --- | --- | --- |
| Corpus completeness and integrity | PASS | All inventory books/pages verified; not every page visually inspected |
| Desktop Chromium | PASS | Named host, production localhost build, scripted interactions |
| Tablet EMULATION | PASS | Both viewport orientations; same desktop Chromium host |
| Real tablet/browser and physical touch | **PENDING** | No physical tablet available to the agents; epic hardware acceptance remains unmet |
| Source visual comparisons | DONE, bounded | Inspected DEV sequences only; AI observations; human comfort and high-DPR review pending |
| Page/panel progress and annotations | PASS | Same-origin reload, export/import; no cross-device sync |
| Spread and full-page fallback | PASS | Curated Harbinger spread and adjacent unannotated pages |
| Lost network after load | PASS | Cached page plus uncached error path; no offline-install claim |
| Detector evaluation | EXISTING FROZEN EVIDENCE | AI-made references; no rerun; limited samples and metric undercount |
| Human annotation review/correction timing | **PENDING** | Estimated operations cannot replace timed human corrections |
| Memory | PARTIAL | JS heap/DOM/request sampling; GPU, decoded images and total process memory unmeasured |
| Other browsers | UNTESTED | No Firefox, Safari or physical tablet browser evidence |
| Automated checks | PASS (rerun; see note below) | Synthetic fixtures support corpus-free CI; purchased artifacts stay local |

Python: 66 tests passed; reader: 150 tests passed; typecheck, lint, build and
synthetic browser smoke passed. The first concurrent reader check timed out in the
existing keyboard-navigation unit test. Its focused rerun and then the full reader
checks passed without code changes. This is a retained intermittent-test limitation,
not a diagnosed cause or a claim of repeatability. See `reader-checks-initial.log`,
`reader-focused.log` and final `reader-checks.log`. An initial Python format check
also required line wrapping in the new table script; formatting was applied and
all Python checks rerun successfully.

Checks (raw logs under `work/bench/`):

```sh
(cd tools && uv run ruff check . && uv run ruff format --check . && uv run pytest) > work/bench/tools-checks.log 2>&1
(cd reader && pnpm typecheck && pnpm lint && pnpm test && pnpm build) > work/bench/reader-checks.log 2>&1
(cd bench && pnpm typecheck && pnpm bench:smoke) > work/bench/bench-checks.log 2>&1
```

## Prioritized next epic

1. **Run a physical-tablet reading session.** Include dense lettering and the spread;
   record device/browser, touch navigation, reading comfort, rotation, total memory
   and a longer session. Emulation leaves the most important acceptance gap open.
2. **Measure human correction time and review reference annotations.** Compare manual
   creation with correcting frozen suggestions on new, predeclared test pages.
   Missed regions and the resize-threshold undercount make operation counts an
   insufficient productivity claim. Preserve the existing held-out set untouched.
3. **Improve network-loss messaging and retry UX.** Current controlled offline runs
   consistently reach a generic missing/corrupt-asset error. Test reconnection and
   retry recovery before considering deliberate offline storage.
4. **Experiment with resolution on demand for panel zoom.** The inspected source
   comparisons show softened fine detail despite usable lettering. Measure extra
   bytes, decode cost and actual tablet benefit before raising every page's resolution.
5. **Broaden browser and memory evidence.** Add Safari/Firefox and process/image/GPU
   measurements. Keep the bounded loading design; do not infer leak freedom from
   the JS heap samples or add speculative preloading based on localhost timings.
