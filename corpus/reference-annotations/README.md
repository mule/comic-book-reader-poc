# Phase B visual references

Six annotation documents cover all 30 evaluation pages: six dev and four held-out pages per book. These are **AI-agent visual annotations, not human annotations**. Rectangles were placed from the suggestion-free 2400px assets in `work/packages`, using 1200px inspection views and a source-resolution crop for ambiguous spread lettering. All 30 numbered overlays were opened and checked; four pages were revised and their overlays checked again before evaluation. No detector-derived boxes were used as reference coordinates. The same agent had seen several dev detector overlays during Phase A, so dev annotation is not claimed to be fully blinded.

The `manifests/` files are artwork-free snapshots of the original selected page metadata, with `selection: sample`; assets and source/page identities are unchanged. They contain no suggestions. Use them as `--reference-manifest` for evaluation, never the candidate detection manifest. `provenance.json` records source asset hashes, annotation/snapshot hashes, frozen-config hash and the page-by-page visual-review checklist. Coordinates are normalized over the entire displayed page, including the spread.

Rules: tight axis-aligned boxes include frame borders, complete visible panel art, all attached balloons/tails/captions and edge sound effects. Overlap is allowed for bleed, diagonal boundaries and insets. Story-bearing text-only strips count as regions. Covers and splashes count as one region. Standalone publisher logos/credits outside story artwork do not become extra regions. Borderless narrative clusters are kept intact rather than treating each disconnected figure as a panel. Order follows western narrative progression: rows left-to-right then down, complete tall left panels before their stacked right companions, with explicit inset/montage decisions below.

Notable decisions (PDF page numbers):

| Book/page | Reference interpretation |
| --- | --- |
| Archer 10 | Five regions: opening strip, attack strip, left doorway inset, right action scene, bottom button inset. The right scene is bounded at its horizontal scene edge; surrounding wall texture is not an additional region. |
| Archer 17 | Three top frames, one complete central borderless departure montage including all figures/dialogue, lower-left scene, lower-right silhouette/dialogue. |
| Archer 33 | Six panels: the right column has two panels separated by a diagonal gutter. Their bounding rectangles necessarily overlap. Upper right includes balloon points outside the frame. |
| Archer 49 | Four stepped columns read left-to-right; second box extends right to include its balloon. |
| Archer 80 | One full-page splash, including caption arrows and title lettering. |
| Archer 91 | Large underlying scene, upper-right inset, lower-right inset, two lower scenes. Underlying-scene rectangle includes inset area because rectangles cannot represent holes. |
| Archer 95 | Four regions; last region extends above its colored backdrop for dialogue/fists and to the bottom edge for the figure. |
| Harbinger 23 | Opening borderless scene, upper-right inset, three middle frames, facing-couple frame, borderless kiss, bottom close-up. The last two overlap; chosen western sequence is kiss before bottom close-up. |
| Harbinger 34 | Six ink-art story panels. Publisher header and artist-credit footer excluded as separate regions. |
| Harbinger 37 | One complete cover region. |
| Harbinger 52 | Four regions; top balloon extends above its frame; second panel overlaps the large third scene. |
| Harbinger 141 | Two left insets, whole central falling composition, lower inset with its left-overhanging balloon, rightmost inset including figure bleed. Main scene contains inset areas; its dialogue is not assigned to the lower inset. |
| Quantum 10 and 73 | Black narrative/title strips are explicit reading regions in their vertical position (eight and six total regions respectively). |
| Quantum 29 | Six regions: two top frames, tall left frame including energy bleed, two stacked right frames, final faint borderless figures plus dialogue. |
| Quantum 31 and 80 | One framed splash each, including lettering. |
| Quantum 65 and 79 | Include line/art bleed beyond nominal frames, as well as dialogue and sound effects. |

These choices are part of the evaluation protocol, not universal ground truth for ambiguous comic layouts. They were fixed before Phase B detection. An independent human review remains useful for external claims.

Reproduce overlays (artwork stays under work/):

```sh
cd tools
uv run python scripts/render_reference_overlays.py ../work/packages/BOOK \
  ../corpus/reference-annotations/dev/BOOK.json \
  --output ../work/phase-b/reference-overlays/BOOK
uv run comicpoc validate ../work/packages/BOOK \
  --annotations ../corpus/reference-annotations/dev/BOOK.json
```

Repeat for `heldout`. The renderer writes both source-resolution `NNN-full.png` and inspection-size `NNN.png`; it rejects manifests containing suggestions. See [detection report](../../docs/detection.md) for measured results and limitations.
