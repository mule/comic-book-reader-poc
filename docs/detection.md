# Panel detection — frozen baseline and Phase B evaluation

Status: **Phase B references, evaluation and guided-mode integration completed 2026-09-29**. The detector/configuration remain frozen from 2026-09-28. During Phase A only the 18 dev pages were decoded, detected and overlaid; held-out artwork was untouched until this separately authorized Phase B. CI detection tests use generated images/PDFs only. The Phase A counts below are historical suggestion counts; Phase B metrics appear later in this report.

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

## Phase A dev-only tuning log and visual observations

During Phase A, all trials used exactly the six dev pages per book in `work/samples/`. No references were created, imported or scored. Trial 1 used threshold 235 / closing kernel 3. Trial 2 changed only threshold to 210 and kernel to 1. After inspecting overlays, trial 2 was frozen without further tuning. Frozen packages were generated from trial 2 to verify ID continuity. Local files are under `work/detection/{trial-235,trial-210,frozen,overlays-235,overlays-210,overlays-frozen}`. Artwork is ignored; [artwork-free run metadata](../corpus/detection-dev-phase-a.json) records counts, exact page IDs, fallback reasons, trial configs and frozen-config SHA-256.

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

These observations support retaining manual correction and full-page access. Four Harbinger pages (23, 34, 44, 141) have empty suggestions in both trials; full page IDs are in the committed metadata. The apparent gains on Archer's regular layouts do not establish general accuracy. No quantitative missed/spurious/order/error claims are made without reference annotations. At the end of Phase A, further detector investment was **not yet justified by measured correction savings**; the Phase B decision below includes borderless/inset/text-only examples.

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

## Phase B execution (2026-09-29)

References were committed as `0ebc79c` before any Phase B detection. The exact config SHA-256 before and after evaluation is `135955b530f8983b06ba02325096eed6120c5d427cc64d3d83a0d804bb1bcaaa`; neither config nor detector/evaluator code changed. Native OpenCV remains 4.13.0, wheel 4.13.0.92. Dev detection and evaluation ran first. Held-out sample packages were then imported into `work/phase-b/heldout-samples` using the original PDFs and unchanged 2400px profile. Each held-out page was detected **once**, in one successful run per book; there were no retries or post-result tuning. Derived asset hashes exactly match the original assets used for references.

Commands from the repository root (BOOK/SPLIT placeholders expanded in the committed raw execution log):

```sh
uv run --project tools comicpoc detect work/samples/BOOK \
  --output work/phase-b/detected/dev/BOOK \
  --report work/phase-b/detect-dev-BOOK.json --split dev
uv run --project tools comicpoc evaluate-detection work/phase-b/detected/dev/BOOK \
  --annotations corpus/reference-annotations/dev/BOOK.json \
  --reference-manifest corpus/reference-annotations/manifests/BOOK.json \
  --output work/phase-b/evaluate-dev-BOOK.json --split dev
```

Held-out import page lists were Archer `54 80 91 95`, Harbinger `20 37 52 59`, Quantum `65 73 79 80`:

```sh
uv run --project tools comicpoc import 'test-data/SOURCE.pdf' \
  --output work/phase-b/heldout-samples --book-id BOOK --pages PAGE_NUMBERS
uv run --project tools comicpoc detect work/phase-b/heldout-samples/BOOK \
  --output work/phase-b/detected/heldout/BOOK \
  --report work/phase-b/detect-heldout-BOOK.json --split heldout --phase-b
uv run --project tools comicpoc evaluate-detection work/phase-b/detected/heldout/BOOK \
  --annotations corpus/reference-annotations/heldout/BOOK.json \
  --reference-manifest corpus/reference-annotations/manifests/BOOK.json \
  --output work/phase-b/evaluate-heldout-BOOK.json --split heldout --phase-b
```

These document completed runs; do not rerun held-out detection to tune this experiment. Results, normalized predictions, run IDs, implementation/config fingerprints, input/output manifest hashes, command timestamps and raw per-page evaluation output are committed in [corpus/detection-results-phase-b.json](../corpus/detection-results-phase-b.json). Local execution stdout/stderr, overlays and reader screenshots are in `work/phase-b/`.

## Phase B reference protocol (2026-09-29)

All 30 evaluation pages now have **AI-agent visual reference annotations; these are not human-annotated ground truth**. Six documents under [corpus/reference-annotations](../corpus/reference-annotations/README.md) use only `added_regions`, explicit western order, and source/book/page binding. Coordinates were authored from the original, suggestion-free 2400px assets in `work/packages`; the agent opened every original and all 30 numbered overlays. Four pages were corrected after overlay review (Archer 33, Harbinger 23/141, Quantum 79), then checked again. An original-resolution crop clarified Harbinger 141's overhanging dialogue. No Phase B detector output was consulted before reference freeze. Prior Phase A dev-overlay exposure means this is not a fully blinded dev-reference study.

Tight rectangles include complete panels and their balloons/tails, captions, sound effects and visible bleed. Diagonal/inset boxes may overlap. Borderless continuous scenes remain one reading region rather than isolated figures; covers/splashes remain one region; narrative text-only strips receive their own region; standalone publisher logos/credits outside panels do not. Explicit per-page decisions and ambiguity limits are documented in the reference README. The reference-manifest snapshots contain only original metadata and no detector output. Provenance records annotation, asset and config hashes. References will not be changed in response to detector scores.

## Phase B measured results

Matching IoU remains **0.5**, identity IoU **0.65**, resize threshold **0.01 mean normalized edge displacement**, and reorder count is matched-pair inversions, exactly as specified in Phase A. Boundary means below pool matched pairs (not page means); no-match pages have no boundary estimate. Precision = matched / suggestions; recall = matched / references. These are small, selected samples with AI-produced references, not population estimates or human agreement measurements.

| Split | Pages | Reference regions | Suggestions | Matched | Missed | Spurious | Precision | Recall | Mean edge error | Inversions | Estimated ops | Ops/page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dev | 18 | 104 | 69 | 65 | 39 | 4 | 94.20% | 62.50% | 0.004840 | 0 | 46 | 2.56 |
| Held-out | 12 | 50 | 44 | 43 | 7 | 1 | 97.73% | 86.00% | 0.003349 | 0 | 9 | 0.75 |

Dev operations: **39 adds, 4 deletes, 3 resizes, 0 reorders**; 11/18 pages have nonzero estimated corrections. Held-out operations: **7 adds, 1 delete, 1 resize, 0 reorders**; 5/12 pages have nonzero estimated corrections. Zero-operation pages (7 dev, 7 held-out) satisfy this metric, not a guarantee of perfect lettering coverage. An add-only baseline starting with no stored regions would require 104 dev / 50 held-out adds; 46 / 9 is fewer estimated operations, but neither review time nor real editor gestures were measured. In particular, empty suggestions on single-region covers/splashes already produce usable full-page reading, even though the metric charges one add.

The held-out score is better than dev largely because layout difficulty differs: four dark/inset Harbinger dev pages contribute 24 missed regions, while held-out Harbinger contains conventional frames plus one cover. It does not show improved generalization or justify pooling the splits. Zero inversions concerns only matched regions; missing insets and merged panels can still break the complete reading sequence.

### dev per-page results

| Book / PDF page | Matched | Missed | Spurious | Mean edge error | Inversions | Add/delete/resize/reorder | Ops/page |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Archer 7 | 5 | 0 | 0 | 0.000612 | 0 | 0/0/0/0 | 0 |
| Archer 10 | 1 | 4 | 1 | 0.000321 | 0 | 4/1/0/0 | 5 |
| Archer 17 | 4 | 2 | 2 | 0.000793 | 0 | 2/2/0/0 | 4 |
| Archer 33 | 5 | 1 | 0 | 0.012077 | 0 | 1/0/1/0 | 2 |
| Archer 49 | 0 | 4 | 1 | — | 0 | 4/1/0/0 | 5 |
| Archer 67 | 9 | 0 | 0 | 0.000621 | 0 | 0/0/0/0 | 0 |
| Harbinger 11 | 3 | 0 | 0 | 0.001448 | 0 | 0/0/0/0 | 0 |
| Harbinger 23 | 0 | 8 | 0 | — | 0 | 8/0/0/0 | 8 |
| Harbinger 34 | 0 | 6 | 0 | — | 0 | 6/0/0/0 | 6 |
| Harbinger 44 | 0 | 5 | 0 | — | 0 | 5/0/0/0 | 5 |
| Harbinger 58 | 6 | 0 | 0 | 0.001183 | 0 | 0/0/0/0 | 0 |
| Harbinger 141 | 0 | 5 | 0 | — | 0 | 5/0/0/0 | 5 |
| Quantum 10 | 7 | 1 | 0 | 0.000907 | 0 | 1/0/0/0 | 1 |
| Quantum 12 | 6 | 0 | 0 | 0.000705 | 0 | 0/0/0/0 | 0 |
| Quantum 20 | 9 | 1 | 0 | 0.011043 | 0 | 1/0/1/0 | 2 |
| Quantum 29 | 4 | 2 | 0 | 0.028842 | 0 | 2/0/1/0 | 3 |
| Quantum 31 | 1 | 0 | 0 | 0.000946 | 0 | 0/0/0/0 | 0 |
| Quantum 37 | 5 | 0 | 0 | 0.000872 | 0 | 0/0/0/0 | 0 |

dev failure page IDs (estimated correction total > 0):

```text
p-53ef05d949a1e0c98472e19008ce052214dc4b4c776d1f87aeb8fe720ae1222a-0010
p-53ef05d949a1e0c98472e19008ce052214dc4b4c776d1f87aeb8fe720ae1222a-0017
p-53ef05d949a1e0c98472e19008ce052214dc4b4c776d1f87aeb8fe720ae1222a-0033
p-53ef05d949a1e0c98472e19008ce052214dc4b4c776d1f87aeb8fe720ae1222a-0049
p-69975ea54b0a0d047a64151a22a2338fc1c330b51f7c2691b5f214ddce7cb979-0023
p-69975ea54b0a0d047a64151a22a2338fc1c330b51f7c2691b5f214ddce7cb979-0034
p-69975ea54b0a0d047a64151a22a2338fc1c330b51f7c2691b5f214ddce7cb979-0044
p-69975ea54b0a0d047a64151a22a2338fc1c330b51f7c2691b5f214ddce7cb979-0141
p-2c10cfe55eac42984025e7e86ed4c9c3d78e3a4a22219fbedda0862ab9b8dd71-0010
p-2c10cfe55eac42984025e7e86ed4c9c3d78e3a4a22219fbedda0862ab9b8dd71-0020
p-2c10cfe55eac42984025e7e86ed4c9c3d78e3a4a22219fbedda0862ab9b8dd71-0029
```

### heldout per-page results

| Book / PDF page | Matched | Missed | Spurious | Mean edge error | Inversions | Add/delete/resize/reorder | Ops/page |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Archer 54 | 4 | 0 | 0 | 0.000765 | 0 | 0/0/0/0 | 0 |
| Archer 80 | 0 | 1 | 0 | — | 0 | 1/0/0/0 | 1 |
| Archer 91 | 3 | 2 | 0 | 0.002853 | 0 | 2/0/0/0 | 2 |
| Archer 95 | 4 | 0 | 0 | 0.000633 | 0 | 0/0/0/0 | 0 |
| Harbinger 20 | 6 | 0 | 0 | 0.002145 | 0 | 0/0/0/0 | 0 |
| Harbinger 37 | 0 | 1 | 0 | — | 0 | 1/0/0/0 | 1 |
| Harbinger 52 | 4 | 0 | 0 | 0.001030 | 0 | 0/0/0/0 | 0 |
| Harbinger 59 | 6 | 0 | 0 | 0.001199 | 0 | 0/0/0/0 | 0 |
| Quantum 65 | 4 | 1 | 0 | 0.021747 | 0 | 1/0/1/0 | 2 |
| Quantum 73 | 4 | 2 | 1 | 0.001827 | 0 | 2/1/0/0 | 3 |
| Quantum 79 | 7 | 0 | 0 | 0.001477 | 0 | 0/0/0/0 | 0 |
| Quantum 80 | 1 | 0 | 0 | 0.001058 | 0 | 0/0/0/0 | 0 |

heldout failure page IDs (estimated correction total > 0):

```text
p-53ef05d949a1e0c98472e19008ce052214dc4b4c776d1f87aeb8fe720ae1222a-0080
p-53ef05d949a1e0c98472e19008ce052214dc4b4c776d1f87aeb8fe720ae1222a-0091
p-69975ea54b0a0d047a64151a22a2338fc1c330b51f7c2691b5f214ddce7cb979-0037
p-2c10cfe55eac42984025e7e86ed4c9c3d78e3a4a22219fbedda0862ab9b8dd71-0065
p-2c10cfe55eac42984025e7e86ed4c9c3d78e3a4a22219fbedda0862ab9b8dd71-0073
```

### Difficult layouts and metric limitations

- **Dev:** Archer 10's action/inset page needs five estimated operations; the borderless departure scene on Archer 17 needs four. Archer 33's diagonal right column yields a merge/missing panel (two operations). Archer 49's connected stepped columns need five. Harbinger 23/34/44/141 produce no usable suggestions and need 8/6/5/5 adds. Quantum 10 misses its narrow text-only strip; Quantum 20 merges panels; Quantum 29's energy bleed and faint borderless ending need three estimated operations.
- **Held-out:** Archer 80 and Harbinger 37 produce empty proposals for their full-page splash/cover. Archer 91 needs two inset adds. Quantum 65 needs one add and one resize; Quantum 73 needs two adds and one delete. All exact failure identities are listed above and in raw JSON.
- After scoring, existing frozen-result overlays were opened for Archer 91 and Quantum 65/73 (drawing stored boxes did not rerun detection). Archer 91's large box includes the two insets without proposing separate inset regions; its bottom-right box also clips the upper balloon. Quantum 65's first box spans the top-left and middle-left scenes. Quantum 73's final box merges its two bottom panels. These observations agree with the main missed/merge failures.
- **Observed undercount, reported without changing the frozen metric:** Archer 91's clipped upper balloon still has page mean edge error 0.002853, and its affected matched pair stays below the 0.01 resize cutoff. No resize operation is charged, although a reader needs the balloon included. Averaging four edges can hide a significant one-edge text cutoff. Threshold-qualified matches and zero estimated edits therefore are not equivalent to readable panel crops.
- Merged boxes near IoU 0.5 can count as a match+resize+add or as delete+multiple adds. Estimated operations do not model a dedicated split action, drag distance, validation time or manual ordering of newly added regions. Rectangular reference ambiguity on diagonal/overlapping scenes also affects IoU. No confidence scores or measured human correction times are claimed.

### Reader integration and verification

Initial evaluation used main `5c08029613e859eed183e902c144918bb88b693c`, which lacked guided mode. After the orchestrator merged #6, this branch was rebased onto `c36bfb4dd819e9aefbfa6c6ccec32d64c6734c05` and the browser check was extended. **Importer → frozen detect → reader guided display now passes.** This reused the existing detected dev packages; no detection or scoring was rerun and all detector/evaluator/config/reference fingerprints remain unchanged. The original reference commit `0ebc79c` became `9c2e1a7` through rebase; the original detection provenance is retained.

`bench/src/detectionSmoke.ts` launched the built reader against all three detected dev packages using Playwright/Chromium. Each clean browser context received its exact manifest, including 28/9/32 suggestions, with no reference annotations imported. It verified all **69 suggested regions plus four empty-page full-page stops**, forward and backward across page boundaries, by checking active page/region IDs, the guided outline, decoded image and an independently calculated camera transform. Reload restored the last guided stop. No page errors or PDF/test-data requests occurred. A guided screenshot was actually opened: Archer page 7 displays Guided active and Panel 1/28 with the first suggested horizontal panel centered and neighboring artwork visible outside it. This verifies guided focus, not a cropped-image export or detector accuracy.

Serve the completed revisions from reader/:

```sh
COMIC_PACKAGES_DIR=../work/phase-b/detected/dev pnpm dev
# Or select the separate held-out root:
COMIC_PACKAGES_DIR=../work/phase-b/detected/heldout pnpm dev
```

Read-only browser check from bench/ (reader build must exist):

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec tsx src/detectionSmoke.ts ../work/phase-b/detected/dev
```

Artwork screenshots stay in `work/phase-b/reader-check`; artwork-free browser results (including the earlier full-page-only check) are embedded in the raw results JSON. No reader serving files or original packages were modified. The merged editor benchmark `pnpm guided` was also run separately against its original packages and curated fixtures; it is distinct from the suggestion-only integration check above.

### Decision and checks

**Retain the baseline as optional suggestions, and justify only a bounded next experiment, not autonomous panel preparation or custom model training.** High observed precision (94.2% dev / 97.7% held-out) and 0.75 held-out estimated operations/page suggest useful assistance for regular layouts. Dev recall of 62.5%, complete failures on four Harbinger pages, and the visible balloon cutoff show that review and full-page access remain essential. Prioritize measuring actual correction time with the now-merged editor. If that demonstrates a benefit, a separate experiment on new data could investigate connected-gutter separation and inset handling; this detector/config stays unchanged, and the now-observed held-out pages must not be reused as an untouched test set. Human review of these AI references is needed before stronger accuracy claims.

Validation completed: all six reference documents passed `comicpoc validate --annotations` against their original full packages; all reference snapshots/documents passed semantic/schema checks; all six detected packages validated and their assets matched reference hashes. Python locked sync, ruff lint/format and **65 tests passed**. Reader locked install, typecheck, lint, **150 tests** and production build passed. Bench locked install/typecheck, synthetic `bench:smoke`, the three-book detected-package guided browser check and `pnpm guided` passed. No detector/config/evaluator changes were made after results. Real human/tablet correction time remains pending.
