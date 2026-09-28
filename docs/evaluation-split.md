# Evaluation split, fixed before detector tuning

The authoritative list is [corpus/evaluation-split.json](../corpus/evaluation-split.json): 30 unique pages, ten per book, with six `dev` and four `heldout` pages per book. IDs are stable filename-derived slugs from the inventory. Page numbers are one-based PDF order, including covers/front matter, not printed folios. Each selection records visual layout tags and its specific rationale.

Selection on 2026-09-28 used actual PDFium full-page renders: 1000-pixel-long-edge thumbnails and labeled contact sheets. Contact sheets viewed covered Archer & Armstrong pages 1–100, Harbinger 1–60 and 141–149, and Quantum and Woody 1–40 and 61–100. All selected pages were viewed on those sheets; Harbinger 141 was additionally viewed individually to confirm its landscape spread with inset panels. Previews were rendered for all 389 pages, but not every preview was visually reviewed. This is a deliberately varied sample, not a random or exhaustive corpus survey and not a reading-quality assessment on a tablet.

| Book | Development PDF pages | Held-out PDF pages |
| --- | --- | --- |
| Archer & Armstrong | 7, 10, 17, 33, 49, 67 | 54, 80, 91, 95 |
| Harbinger | 11, 23, 34, 44, 58, 141 | 20, 37, 52, 59 |
| Quantum and Woody | 10, 12, 20, 29, 31, 37 | 65, 73, 79, 80 |

The set includes regular grids (including Archer's nine-panel page 67), slanted/inset/borderless layouts, story splash pages, a cover splash, dense balloons, small captions, low contrast, monochrome ink art, dark backgrounds and oversized sound effects. Harbinger 141 is the sole landscape PDF page in the inventory and supplies the verified spread case. No spread is claimed for the other books merely because adjacent pages face one another. Tags describe observed structures, not panel annotations or inferred reading-order ground truth.

**Held-out pages must not be used for detector tuning**, threshold selection, algorithm selection, debugging against expected panel boxes, or fitting manual heuristics. Future detector tools must explicitly filter `split == "dev"` when constructing tuning inputs; never glob all previews. Keep held-out images, annotations and final measurements in separate `work/heldout/` paths, outside detector input directories. This JSON is reference metadata, not a detector input list. Previewing held-out pages for this initial stratification does not authorize using them to tune.

Freeze parameters on development pages first, then evaluate held-out pages once and report both results. If held-out results influence another algorithm revision, disclose that contamination and choose a new untouched holdout rather than claiming an independent result. No detector was run or tuned during this foundation task. Real tablet readability testing remains PENDING for the reader/evaluation issues.
