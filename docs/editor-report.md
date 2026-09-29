# Guided reader and editor observations — 2026-09-29

## Environment and method

The real reader was built with `cd reader && pnpm build` and served using Vite
preview on loopback with `COMIC_PACKAGES_DIR` pointing at `work/packages`.
Playwright 1.63.0 ran headless Chromium 153.0.8010.12 on Linux
7.0.11-76070011-generic, x64, Intel Core i7-10510U, 8 logical CPUs, 31.01 GiB RAM
(as reported by the benchmark). Each book/viewport used a fresh browser context
with HTTP cache enabled. All three committed annotation files were imported
through the UI file chooser; no browser storage injection was used.

Viewports: desktop 1280×800 at DPR 1; tablet **EMULATION** landscape 1180×820
and portrait 820×1180 at DPR 2 with mobile/touch flags. Editor curation used
Chromium at 1800×1500, with mouse drags, Shift+drag for overlap, list reorder
buttons, and the browser's Download export. Emulated tablet editor gestures in
the automated checks also used mouse input. These runs are not physical touch
or tablet-hardware validation.

## Curation and visual inspection

All six pages were checked against `corpus/evaluation-split.json`: all are dev
pages. The annotation files contain coordinates only. Numbered overlays of the
exported rectangles were rendered and visually inspected under `work/editor/`;
complete-page source previews and browser editor screenshots are also there.

| Book | PDF page | Regions | Observed curation |
| --- | ---: | ---: | --- |
| Archer & Armstrong | 7 | 5 | Five horizontal strips; top of first panel and final balloon at the bottom of fifth included. |
| Archer & Armstrong | 67 | 9 | Three-by-three grid, left-to-right then top-to-bottom; all balloons inside bounds. |
| Harbinger | 11 | 3 | Three horizontal panels; dense lower-panel thought balloons retained. |
| Harbinger | 141 | 5 | Upper-left inset, second upper-left inset, complete main spread, lower-right inset, final right inset. Overlap retained; protruding balloon/figure content included. |
| Quantum & Woody | 10 | 8 | Top panel, lettering strip, three middle panels, two lower panels, full-width bottom panel. |
| Quantum & Woody | 12 | 6 | Top panel, large middle-left panel, two middle-right panels, two full-width bottom panels. |

Harbinger 141 is one intact landscape image. Its main region overlaps all four
insets; the main image is intentionally presented between the upper-left and
lower-right inset sequences. Rectangles around protruding inset content include
some surrounding artwork. Harbinger 11's last panel and Harbinger 141's main
spread have small lettering when completely fitted; the reader's zoom remains
available. Full-page mode remains available throughout.

`comicpoc validate <package> --annotations <curated file>` passed for all three
packages: Archer 111 pages, Harbinger 149, Q&W 129. The validators decoded and
checksummed the package assets as well as checking annotation schema, identities,
bounds, and order. No held-out reference annotations or detector scores were
produced in this task.

## Browser assertions that passed

`cd bench && pnpm guided` exercised both curated pages of every book at each of
the three viewports (nine book/viewport runs):

- UI file import and downloaded export were JSON-equal to the committed file;
  key whitespace is not treated as byte identity.
- Malformed JSON, wrong book, wrong source, unknown page and unsupported schema
  imports displayed rejection and left the exported edits unchanged.
- Draw, edge move, corner resize, list reorder and delete were performed through
  browser input. Moving against the page edge retained the region dimensions;
  deleting the temporary region restored the original annotation document.
- Every curated region was traversed forward and backward. Each adjacent
  unannotated page contributed a full-page step; returning across each boundary
  restored the exact region. The actual image transform was checked against an
  independently calculated fit for every expected stop.
- Reload restored a non-first panel, edits and order, and also restored guided
  mode on a full-page fallback. Full-page mode was reachable on each curated page.
- Swapping viewport width/height retained and refitted the active region. Zoom
  and Fit worked within a region. Rapid key navigation reached the expected last
  region and returned to the first without waiting for intermediate animations.
- Emulated `prefers-reduced-motion: reduce` had a constant settled transform over
  sampled animation frames and no active DOM animations. Reader unit tests also
  verified no scheduled camera-animation frames in reduced-motion mode.
- No uncaught browser page errors were observed by the script.

## Measured guided latency

Final run completed at `2026-09-29T07:59:07.116Z`.

| Book | Viewport | Steps | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: |
| Archer & Armstrong | desktop-1280x800 | 34 | 299.86 | 300.39 |
| Archer & Armstrong | tablet-emulation-1180x820 | 34 | 299.86 | 300.37 |
| Archer & Armstrong | tablet-emulation-820x1180 | 34 | 299.90 | 317.24 |
| Harbinger | desktop-1280x800 | 22 | 299.52 | 317.00 |
| Harbinger | tablet-emulation-1180x820 | 22 | 299.72 | 317.23 |
| Harbinger | tablet-emulation-820x1180 | 22 | 299.94 | 316.67 |
| Q&W | desktop-1280x800 | 34 | 299.91 | 316.84 |
| Q&W | tablet-emulation-1180x820 | 34 | 300.06 | 316.93 |
| Q&W | tablet-emulation-820x1180 | 34 | 299.99 | 316.87 |

The metric runs from the Playwright keypress call to the expected fitted image
transform, image decode, and two animation frames. It includes driver overhead
and the configured 260 ms same-page transition. Boundary fallbacks snap and are
included in these distributions. Each page also contributes one timed step to
its second region before the persistence check. Percentiles use nearest rank;
this is one final run, not a repeated-run statistical estimate. Raw samples,
directions and target identities are in `work/bench/guided.json`.

## Automated checks and limits

Python: **65 passed**, including five cases shared with TypeScript in
`format/merge-cases.json`. Reader: **150 passed**; typecheck, ESLint and production
build passed. Bench: typecheck and synthetic smoke passed. The CI smoke uses a
newly generated three-page synthetic package and the same guided assertion
function; its raw guided result is `work/bench/guided-smoke.json`.

A focused mutation check temporarily restored the old missing-tombstone bug:
`deleting an edit omitted by the detector prevents resurrection` failed. Restoring
the fix made it pass. The local transcript is `work/editor/tombstone-mutation.log`.
Other regressions cover add/edit ID collisions, minimum edge dimensions,
order-only corrections surviving matching detector runs, guided fallback mode,
and multiple navigation events within one React render batch.

**Physical tablet testing: PENDING.** No physical tablet, touch gesture comfort,
subjective long-session readability, or cross-browser measurements were made.
No detector accuracy or human correction-effort claim is made here. Geometry
identity across detector splits/merges remains heuristic as documented in
`docs/detection.md`.
