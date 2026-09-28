# Comic POC format, schema version 1

The reader loads only `manifest.json` and relative page/thumbnail assets. It never needs the PDF. Canonical schemas are [manifest.schema.json](../format/manifest.schema.json) and [annotations.schema.json](../format/annotations.schema.json), using JSON Schema draft 2020-12. `comicpoc validate <package>` checks both structural and semantic invariants and decodes/checksums every asset. `--annotations <file>` additionally checks a manual document against that manifest. Python helpers live in `comicpoc.manifest`.

## Identity and page sequence

`book.id` is a portable filename-safe logical identifier (default: normalized source filename; override with `--book-id`). `book.title` is display text. `source` records SHA-256 of the entire PDF, byte size and original PDF page count, never its local path. The tuple `(book.id, source.sha256)` identifies a particular book revision. A page ID is `p-<full source sha256>-<one-based PDF page number padded to at least four digits>`; consumers treat it as opaque and also retain its book identity. These IDs remain stable across sample/full imports, output roots, source filename changes with an explicit book ID, and rendering-profile changes.

Replacing source bytes changes the source fingerprint and every page ID, even if the file appears visually identical. Reading positions and annotations MUST NOT silently migrate across that boundary. Reimporting identical source bytes preserves IDs. A render profile change changes the profile ID and requires new assets, but does not change source/page/region identity. Normalized annotations remain valid because v1 profiles do not crop or change displayed rotation. A future transform that changes geometry needs an explicit migration or a new format contract.

`pages` contains page records; **`page_order` is the authoritative sequence**, references every page exactly once, and need not equal array order. The importer preserves the CLI `--pages` order; without it, it uses ascending original PDF order. `pdf_page_number` is one-based PDF sequence, including covers/credits, not a printed folio. `selection: all` requires all source pages exactly once; `sample` may omit pages intentionally. Import completion is distinct from full-book coverage: a sample may be complete for its explicit selection.

## Assets, geometry and rendering

Each page has displayed pixel `width`, `height`, `orientation` (`portrait`, `landscape`, `square`) and original PDF `rotation_degrees`. PDFium applies that source rotation during rendering. Consumers **must not rotate the image again**. Each `page` and `thumbnail` asset records `path`, `width`, `height`, byte size and SHA-256. Paths are POSIX relative paths under `pages/` and `thumbs/`, with filename-safe characters only. Absolute paths, traversal, URLs, backslashes, duplicate paths and symlink escapes are rejected.

`render_profile` includes its content-derived `id`, `format`, `quality`, `long_edge_px`, `resolution_policy`, and a `thumbnail` object with format/quality/long-edge settings. ID is `render-` plus the first 16 hex characters of SHA-256 of Python `json.dumps(parameters, sort_keys=True)` (default separators, no `id` key). Producers should use the Python helper; consumers compare the recorded parameters as well as the ID.

The default profile (recommended by representation experiment #3) is WebP q85 with a `fixed-long-edge` of 2400px, and WebP q80 thumbnails capped to 360px. Formats supported by the importer are WebP, JPEG and PNG (PNG ignores quality). Resolution policies:
- `fixed-long-edge` (default): Renders every page so its longest edge equals `long_edge_px` (spreads included, where the long edge is the width), while never exceeding it. This ensures crisp rendering of vector elements (hundreds of path objects per page representing speech balloons, text, and panel borders) across high-DPI displays without wasteful upscaling beyond 2400px.
- `native-embedded-capped`: Selects the largest embedded image by area and uses its long edge, capped by `long_edge_px`. Pages with no embedded image use 144 DPI capped to `long_edge_px`.

In both policies, the **complete PDF page** is rendered, retaining all text, masks and vector objects. Mixed-image pages use the policy heuristic; it is not a claim that every placed image has identical effective DPI. Aspect ratio comes from the displayed PDF page; integer rounding can change a dimension by one pixel. Thumbnails never upscale. Profile dimensions accepted by the CLI are 1..16384px.

## Regions, suggestions and manual overrides

Regions are rectangles `{id, x, y, width, height}` with finite normalized coordinates in [0,1]; dimensions must be positive and the rectangle must fit within the displayed page. Origin is the **top-left of the already rotated displayed artwork**, x increases right and y increases down. No physical crops are necessary. Overlap is allowed. IDs are unique within a page and stable across edits; persisted references use book/source/page/region identity together.

An optional page `suggestions` object contains `regions`, an explicit `order` referencing each exactly once, and `detector: {name, version, configuration, run_id}`. No fabricated confidence is required. Detectors must preserve region IDs for corresponding suggestions on rerun. A new unrelated region gets a new ID. Run IDs record provenance; they must not be part of region identity. Detector implementations and matching policies belong to #7.

Manual data is a **separate annotation document**, never merged destructively into detector output:

```json
{
  "schema_version": 1,
  "book_id": "example",
  "source_sha256": "<64 lowercase hex characters>",
  "pages": [{
    "page_id": "<manifest page ID>",
    "pdf_page_number": 1,
    "added_regions": [{"id":"manual-1","x":0,"y":0,"width":0.5,"height":1}],
    "edited_regions": [],
    "deleted_region_ids": ["suggestion-1"],
    "order": ["manual-1"]
  }]
}
```

This illustrative document uses placeholders for identity. Actual imports must satisfy the schema and identity checks. `added_regions` contains complete new rectangles with fresh IDs; `edited_regions` contains complete replacement rectangles with the original suggestion IDs. Full replacements remain usable when a detector temporarily omits an edited suggestion. `deleted_region_ids` are persistent tombstones, including IDs absent from the current detector run. Never discard these just because a suggestion is currently absent. Add/edit/delete sets must be disjoint. `order` is the explicit full surviving sequence for that page. No operation is inferred from omission of an entire page: it means there is no override for that page. An explicit deletion list can suppress every suggestion.

Merge in order: start with suggestions, apply tombstones, apply complete edits/additions, then use manual order. `effective_regions` implements this; any new surviving suggestions from a rerun append in detector order. The editor must reconcile and export this resulting full order before `validate_annotations` accepts it against a changed detector manifest. Stale order references are rejected; corrections are retained for explicit reconciliation rather than overwritten. Detector IDs changing arbitrarily cannot preserve semantic deletions; that is a detector contract violation, not permission to erase annotations.

The importer never reads, writes, deletes or copies annotation files, including files users put inside existing packages. Browser edits belong in local persistence with explicit JSON import/export; a static server does not save edits to disk. Suggested local export location is `work/annotations/<book_id>.annotations.json`. #6 must validate an imported annotation document before replacing current local edits. Rejected imports must leave those edits intact.

## Navigation and spreads

Flatten reading sequence by `page_order`, then each page's effective region order. Previous is the exact inverse of next. A page with no usable regions contributes one transient full-page viewport `(0,0,1,1)`; this fallback is not a stored region ID and cannot collide with annotations. Full-page mode always remains accessible. Invalid detector geometry/order must fail validation visibly; readers may disable guided reading for that page and show its full page, with an error, rather than omit it. Position should distinguish full-page fallback from a stable region ID.

One PDF page is always one manifest page. Do not split or combine source pages automatically. **Harbinger PDF p141 is an intact landscape spread**, with coordinates spanning the entire composition. Landscape orientation alone does not identify every spread or determine reading direction. V1 does not model print left/right folios, inferred two-page pairing or automatic spread splitting; wide regions may require user pan/zoom.

## Publication, recovery and compatibility

A package is `work/packages/<book_id>/{manifest.json,COMPLETE.json,pages/,thumbs/}`. Checkpoints/request metadata may also be present; readers ignore these. COMPLETE.json contains manifest `sha256` and `byte_size`. Only directories with a valid marker and all referenced assets are complete. Readers should reject missing markers or assets visibly. The importer keeps `.BOOK.staging` beside the destination, writes an atomic JSON checkpoint only after both page assets succeed, and verifies checkpoint hashes/dimensions before reuse. Failed pages are listed in `errors.json` and stderr; a later invocation retries missing/corrupt pages. SIGINT/process termination leaves reusable staging and never publishes a partial result. Book-scoped OS file locks prevent concurrent writers. Once every selected page validates, the marker is written in staging and the directory is published with a same-filesystem atomic rename.

An existing identical package is validated and reused without any writes inside it. A different source, profile or selection is rejected; choose another `--output` root (e.g. `work/profile-variants/q85`) or explicitly manage old output yourself. This conservative immutable-publication policy avoids replacing annotated packages. Samples live under `work/samples`, allowing subsequent full imports under `work/packages`. Staging requests must match source/profile/selection exactly to resume. Atomic publication protects process-interruption consistency; this POC does not claim power-loss durability with fsync or network-filesystem guarantees. Linux `fcntl` locks are the supported local environment.

Both documents require integer `schema_version: 1` and reject unknown properties. A consumer supporting v1 must reject other versions before using geometry or applying overrides. Any incompatible field/meaning change, including new currently prohibited fields, needs a new version and explicit migration. Version 1 is experimental, not a claim of indefinite backward compatibility. Schema validation is necessary but insufficient: unique IDs, reference coverage, bounds, source binding, profile hashes, full-import coverage and asset integrity are checked semantically in Python. Readers/editors should implement the same applicable structural and identity checks.

## Detection revisions (Phase A, issue #7)

`comicpoc detect INPUT --output NEW_PACKAGE --report REPORT` explicitly republishes to a **new, previously nonexistent package directory**. The input remains immutable. It stages a byte-for-byte copy of every file, changes only page `suggestions` in the manifest, writes a new manifest-bound `COMPLETE.json`, validates, then atomically renames the staging directory. All other manifest values remain equal; all other files (including any annotation export) remain byte-identical. JSON formatting of the manifest is canonicalized with the existing importer writer. Source bytes are checked for changes during copying. Same-filesystem rename plus destination lock has the importer's process-interruption guarantees, not power-loss durability. An interrupted process can leave an ignored hidden staging directory; rerunning uses a fresh one. No in-place replacement, hardlinks, or symlinks are used.

Point `COMIC_PACKAGES_DIR` at the new revision root to select it. Rerun using the **latest detected package** as INPUT to retain identity history. Rerunning from the original suggestion-free package starts a new identity lineage. Book/source/page identity and assets remain unchanged, preserving reader progress and #6 annotation bindings. Existing readers consume the same v1 suggestions fields; no new manifest fields or version migration are required (schema descriptions clarify this contract).

For `comicpoc-opencv-contours` version `1`, `detector.configuration` contains `config` (the complete configuration document) and `identity_history` (last normalized geometry for each issued suggestion ID). This history is a matching input for reproducibility, **not active suggestions**. It includes absent suggestions so a temporary empty run does not lose deletion identity. The detector name/version and config pin the algorithm/OpenCV, and a fresh `run_id` identifies each run. Only `regions` and `order` drive reading. No confidence score is produced. See [detection.md](detection.md) for thresholds, ambiguity limits and evaluation semantics.

Identical reruns preserve manual edits and tombstones without changing annotation bytes. Changed suggestion membership still requires #6's explicit order reconciliation: retain edits/additions/tombstones, calculate `effective_regions`, then export its IDs as the full manual `order` before `validate_annotations`. A split/merge or a move below the identity IoU threshold can require human reconciliation; geometric matching cannot prove semantic panel identity.
