# Panel detection — Phase A

Status: **implemented and frozen 2026-09-28; real reference scoring and held-out evaluation PENDING Phase B**. Only the 18 dev pages were decoded, detected and overlaid. No held-out artwork was opened, rendered, detected or used to choose parameters. CI tests use generated images/PDFs only. Dev counts are suggestions, not accuracy or confidence scores.

## Baseline and reproducibility

Kumiko's candidate revision `9d587ae9498bc84dfda06fc19c6ad89f421bec14` was checked at its primary [license](https://github.com/njean42/kumiko/blob/9d587ae9498bc84dfda06fc19c6ad89f421bec14/LICENSE) and README. Its AGPL-3.0-or-later source is not vendored or run. For this small independent POC we chose the explicitly allowed alternative: an independently written OpenCV contour baseline, not a port or measured performance claim about Kumiko. See [dependencies](dependencies.md). Algorithm `comicpoc-opencv-contours`, version `1`, uses exactly locked `opencv-python-headless==4.13.0.92` (native OpenCV `4.13.0`), Pillow and NumPy. Configuration version/native version mismatches fail before detection. No external model, service, PDF input or fabricated confidence is involved.

[corpus/detector-config.json](../corpus/detector-config.json) is the frozen Phase B input. Do not tune it against held-out pages. A later algorithm/config experiment needs its own version/config and a fresh evaluation protocol. Per-page provenance includes name/version, the complete config, identity matching history, and a new per-batch UUID `run_id`. Asset hashes and the package's completion marker bind the source imagery.

Pipeline: decode the rendered page; convert RGB to grayscale; downsize with Lanczos to at most 1200px long edge; threshold pixels at intensity 210 using inverse binary threshold; apply a 1px closing kernel (identity operation); find external contours; bound them by axis-aligned rectangles. Accept bounding-box area 2.5%–95% of the page, each side at least 8% of the corresponding page dimension, and contour area / bounding-box area at least 0.45. Normalize in displayed page coordinates. The maximum-area filter can reject connected whole-page components; external-only contours cannot recover inset panels enclosed by them. Thin lettering-only strips, borderless panels, dark backgrounds, rotated panels, figures and shared panel borders are known weaknesses.

Reading order groups boxes into rows by top edge: sort by `(y, x, width, height)`, choose the first remaining y as row anchor, include tops up to anchor + 0.035 page height, then sort that row left-to-right, breaking ties by y/width/height. Repeat downward. This is deterministic western order, not semantic story understanding. Tall columns, staggered panels, insets, overlapping boxes and spreads can need manual ordering. The whole displayed spread remains one page.

## Running and republishing

From `tools/` (replace BOOK with an actual book ID):

```sh
uv run comicpoc detect ../work/samples/BOOK \
  --output ../work/detection/run-1/BOOK \
  --report ../work/detection/run-1-BOOK.json \
  --overlays ../work/detection/overlays-run-1/BOOK
uv run comicpoc detect ../work/detection/run-1/BOOK \
  --output ../work/detection/run-2/BOOK \
  --report ../work/detection/run-2-BOOK.json
uv run comicpoc validate ../work/detection/run-2/BOOK
```

`--output` names the entire **new package**, not its parent. Report/overlay paths must be separate from packages and stay under `work/`. Existing destinations are refused. Publication stages a complete copy, validates schema, geometry, order coverage and all asset hashes/dimensions, writes a new COMPLETE.json, and atomically renames. It never edits the input. All files except manifest/marker are byte-identical, and all manifest values outside suggestions are unchanged. See [format](format.md). Serve the new root with `COMIC_PACKAGES_DIR=../work/detection/run-2 pnpm dev` from reader/. The same v1 reader/editor types remain valid; no sidecar loading or reader migration is necessary.

Default `--split dev` enforces the committed evaluation split **before package validation opens images**. Unknown or mixed-split packages fail explicitly. Future held-out operation requires both `--split heldout --phase-b` and frozen configuration; neither flag was used on purchased pages in Phase A. The flags are an explicit workflow guard, not a security boundary against a caller supplying a false split file. Use the committed split.

Empty or invalid detector output yields `regions: []`, `order: []` and a per-page reason in the report plus stderr, allowing full-page fallback while subsequent pages continue. OpenCV/image errors are similarly reported. A corrupt source package is a batch-level integrity error, not an excuse to silently replace its content. Historical IDs survive empty output. Manual regions still take precedence, so existing edited regions can remain readable even when proposals are empty. Optional overlay failures occur after the package and report are saved and produce a nonzero exit.

## Stable IDs and editor handoff

Matching uses one-to-one greedy IoU pairs at threshold **0.65**, highest overlap first; ties use new reading-order index then old ID (old candidates are sorted by ID). Matching suggestions reuse their ID; unmatched suggestions get a fresh `auto-<UUID>`. A last-seen geometry registry in `detector.configuration.identity_history` retains absent IDs across empty runs. Each successful match updates that geometry. This history is never drawn as active regions and never changes annotations. It grows with distinct IDs; this small POC does not prune history, since pruning can erase deletion identity.

Start reruns from the latest detected package, not the original import. Same-geometry reruns preserve manual edits/deletions through `effective_regions` and `validate_annotations`; synthetic tests also cover absent-then-returning deleted suggestions, small matching shifts, new IDs, and explicit order reconciliation when membership changes. The #6 editor can keep its existing separate persistence keyed by book/source/page. It should derive a new full order using `effective_regions` before validating/exporting stale overrides; complete edits and tombstones must remain intact. Annotation files copied during republish are left byte-identical, even if their old order needs reconciliation.

IoU identity is a heuristic: splits/merges, large moves or overlapping historical boxes may produce new/wrong correspondences. No automatic geometric matcher can guarantee semantic tombstone continuity in those cases. Review changed membership; do not discard tombstones. Two runs from the same parent agree on existing IDs but may assign different UUIDs to genuinely new boxes; rerun lineage is explicit.

## Dev-only tuning log and visual observations

All trials used exactly the six dev pages per book in `work/samples/`. No references were created, imported or scored. Trial 1 used threshold 235 / closing kernel 3. Trial 2 changed only threshold to 210 and kernel to 1. After inspecting overlays, trial 2 was frozen without further tuning. Frozen packages were generated from trial 2 to verify ID continuity. Local files are under `work/detection/{trial-235,trial-210,frozen,overlays-235,overlays-210,overlays-frozen}`. Artwork is ignored; [artwork-free run metadata](../corpus/detection-dev-phase-a.json) records counts, exact page IDs, fallback reasons, trial configs and frozen-config SHA-256.

| Book | PDF pages in dev order | Trial 1 suggestion counts | Trial 2 / frozen counts |
| --- | --- | --- | --- |
| Archer & Armstrong | 7, 10, 17, 33, 49, 67 | 1, 1, 3, 1, 1, 8 | 5, 2, 6, 5, 1, 9 |
| Harbinger | 11, 23, 34, 44, 58, 141 | 3, 0, 0, 0, 6, 0 | 3, 0, 0, 0, 6, 0 |
| Quantum and Woody | 10, 12, 20, 29, 31, 37 | 7, 6, 9, 4, 1, 5 | 7, 6, 9, 4, 1, 5 |

Actually opened and visually inspected these dev overlays (not inferred from filenames or counts):

- Archer p7, both trials: trial 1 draws one rectangle around the stacked artwork; trial 2 draws five separate horizontal boxes in top-to-bottom order.
- Archer p67, both trials: trial 1 merges the top-left two cells into one box; trial 2 draws nine separate boxes, numbered left-to-right in three rows.
- Archer p17, trial 2: the three upper frames and a lower scene are boxed, but two additional boxes isolate standing figures in the white central area. Other central figures and a lower-right silhouette remain outside boxes. This is visibly incomplete/fragmented coverage, not reliable panel segmentation.
- Harbinger p58, trial 2: six boxes follow two upper panels, three middle panels and one bottom strip in western order. The boxes roughly follow those frames; no claim of pixel-perfect boundaries or reference accuracy is made.
- Harbinger p141, trial 1: the landscape composition and inset frames are visible, but there are no suggestion boxes. Full-page fallback preserves access to it.
- Quantum p10, trial 1: seven boxes cover the illustrated scenes, while the black text-only horizontal strip below the top scene is left outside boxes. Whether that strip should be its own reading region needs a manual reference decision.

These observations support retaining manual correction and full-page access. Four Harbinger pages (23, 34, 44, 141) have empty suggestions in both trials; full page IDs are in the committed metadata. The apparent gains on Archer's regular layouts do not establish general accuracy. No quantitative missed/spurious/order/error claims are made without reference annotations. Further detector investment is **not yet justified by measured correction savings**; make that decision in Phase B, including borderless/inset/text-only examples.

## Evaluation harness and metric definitions

References are schema-valid annotation documents and their **original reference manifest**. Evaluate final reference `effective_regions(reference_page, override)` against raw ordered suggestions from the candidate manifest. Never resolve reference overrides against a newly detected manifest: new proposals would contaminate ground truth. An explicit annotated page with empty final regions is a valid zero-region reference; an absent annotation page is missing reference data and reports `incomplete-references`, never a perfect zero score. Reference authoring/completeness still requires human review.

```sh
uv run comicpoc evaluate-detection ../work/detection/frozen/BOOK \
  --annotations ../work/annotations/BOOK.annotations.json \
  --reference-manifest ../work/reference-packages/BOOK/manifest.json \
  --output ../work/evaluation/dev-BOOK.json
```

This command reads JSON only. Reference annotation schema, bounds/order and book/source bindings are validated. Predicted manifests are schema/semantically validated; image integrity is checked separately by `comicpoc validate`. Results contain separate `dev` and `heldout` groups; the unrequested group is explicitly `not-evaluated`. Missing reference IDs and failure page IDs are reported separately.

- Default matching IoU is **0.5**, independently of the identity threshold. Deterministic greedy highest-IoU one-to-one matching defines matched/missed/spurious counts. Greedy matching is not globally maximum-cardinality; overlapping/inset boxes can make this metric imperfect. Retain the emitted match IDs for audit.
- Boundary error is mean absolute displacement of left/top/right/bottom edges, in normalized page coordinates, for each matched pair; page mean is `null` when there are no matches. It is not a pixel count or confidence score.
- Ordering errors count inversions of matched reference indices in suggestion order. This equals the adjacent swaps required to sort the matched sequence; unmatched panels are accounted for as adds/deletes.
- Estimated correction operations: one add per missed region, one delete per spurious region, one resize per matched pair with mean edge error greater than **0.01**, and one reorder per inversion. Total is their sum. These are protocol estimates, not measured editor clicks or time. IDs need not match between independent references and proposals.

Synthetic tests cover perfect and empty output, missing/spurious panels, edge displacement, swapped order, absent references, invalid annotations/output, actual OpenCV contours, batch continuation, split guards, ID preservation and publication integrity.

## Phase B — PENDING

Do not fill this section from Phase A counts. Build manual references with #6, retain their original manifest snapshots, validate all requested pages, then evaluate dev and held-out separately with the already frozen config. Held-out commands additionally require `--split heldout --phase-b`; prepare held-out packages only once Phase B is authorized. Record per-page metrics/failure IDs, difficult layouts, actual editing effort on named devices, and whether measured savings justify further detector work. No held-out scores or manual-reference accuracy results exist yet.

## Phase B reference protocol (2026-09-29)

All 30 evaluation pages now have **AI-agent visual reference annotations; these are not human-annotated ground truth**. Six documents under [corpus/reference-annotations](../corpus/reference-annotations/README.md) use only `added_regions`, explicit western order, and source/book/page binding. Coordinates were authored from the original, suggestion-free 2400px assets in `work/packages`; the agent opened every original and all 30 numbered overlays. Four pages were corrected after overlay review (Archer 33, Harbinger 23/141, Quantum 79), then checked again. An original-resolution crop clarified Harbinger 141's overhanging dialogue. No Phase B detector output was consulted before reference freeze. Prior Phase A dev-overlay exposure means this is not a fully blinded dev-reference study.

Tight rectangles include complete panels and their balloons/tails, captions, sound effects and visible bleed. Diagonal/inset boxes may overlap. Borderless continuous scenes remain one reading region rather than isolated figures; covers/splashes remain one region; narrative text-only strips receive their own region; standalone publisher logos/credits outside panels do not. Explicit per-page decisions and ambiguity limits are documented in the reference README. The reference-manifest snapshots contain only original metadata and no detector output. Provenance records annotation, asset and config hashes. References will not be changed in response to detector scores.
