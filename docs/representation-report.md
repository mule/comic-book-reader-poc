# Page Representation Experiment and Profile Recommendation

This report evaluates page representations, candidate resolutions, compression formats, direct image extraction feasibility, and panel derivative strategies for the comic book reader proof-of-concept. All measurements were conducted on the 18 frozen DEV pages established in `corpus/evaluation-split.json` across all three purchased corpus volumes.

## Reproducible Command

The benchmark and inspection assets were produced using the `comicpoc` CLI tool:

```sh
cd tools
# Run full benchmark and generate visual crops, comparison strips, and viewport fits
uv run comicpoc compare-representations
```

Supported options:
- `--no-visuals`: Run numerical benchmarks and extraction audit without generating image crops.
- `--no-extraction`: Skip the direct image extraction feasibility audit.
- `--page-resolutions N [N ...]`: Custom page resolutions for benchmark (default: `1600 2400 3056 3840`).
- `--thumbnail-resolutions N [N ...]`: Custom thumbnail resolutions for benchmark (default: `240 360`).
- `--output PATH`: Specify custom output directory under `work/` (default: `work/representation`).
- `--pages N [N ...]`: Limit benchmark to specific 1-based PDF page numbers.
- `--book BOOK_ID`: Limit benchmark to a specific volume.

All generated inspection crops, side-by-side comparison strips, viewport simulations, and full machine-readable JSON results are written strictly to `work/representation/` (gitignored).

---

## Corpus-Wide Embedded Raster Distribution

Analysis of `corpus/inventory.json` reveals the true distribution of embedded image resolutions across the 389 pages of the corpus:

| Book ID | ~1500–1633 px (Story) | ~3056 px (Covers/Splash) | 1993 px (Spread) | <1000 px (Spot/Ad) | Total Pages |
| --- | --- | --- | --- | --- | --- |
| `archer-armstrong-vol-1-the-michelangelo-code` | 93 (83.8%) | 18 (16.2%) | 0 | 0 | 111 |
| `harbinger-vol-1-omega-rising` | 116 (77.9%) | 28 (18.8%) | 1 (0.7%) | 4 (2.7%) | 149 |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 96 (74.4%) | 33 (25.6%) | 0 | 0 | 129 |
| **Corpus Total** | **305 (78.4%)** | **79 (20.3%)** | **1 (0.3%)** | **4 (1.0%)** | **389 (100.0%)** |

### Key Architectural Fact:
- **78.4% of the corpus pages (305 pages)** embed rasters with a long edge of **~1533 px** (~150 DPI on standard ~482x737 pt comic pages).
- Only **20.3% of pages (79 pages)** embed **~3056 px** rasters (~297 DPI); these consist of front/back covers, variant cover galleries, and rare full-page splashes (e.g. Harbinger p34).
- Harbinger p141 is a two-page landscape spread embedding a single **1993x1534 px** raster.
- 4 pages in Harbinger are low-resolution spots/ad placements (<1000 px).

---

## DEV Pages Embedded Raster Resolutions

The 18 representative DEV pages selected in `corpus/evaluation-split.json` reflect this exact corpus distribution:

| Book ID | PDF Page | Embedded Raster | Long Edge (px) | Has PDF Text | Category |
| --- | --- | --- | --- | --- | --- |
| `archer-armstrong-vol-1-the-michelangelo-code` | 7 | 998x1532 | 1532 | No | Story (~1533) |
| `archer-armstrong-vol-1-the-michelangelo-code` | 10 | 999x1533 | 1533 | No | Story (~1533) |
| `archer-armstrong-vol-1-the-michelangelo-code` | 17 | 999x1533 | 1533 | No | Story (~1533) |
| `archer-armstrong-vol-1-the-michelangelo-code` | 33 | 999x1533 | 1533 | No | Story (~1533) |
| `archer-armstrong-vol-1-the-michelangelo-code` | 49 | 999x1533 | 1533 | No | Story (~1533) |
| `archer-armstrong-vol-1-the-michelangelo-code` | 67 | 999x1533 | 1533 | No | Story (~1533) |
| `harbinger-vol-1-omega-rising` | 11 | 998x1533 | 1533 | No | Story (~1533) |
| `harbinger-vol-1-omega-rising` | 23 | 998x1533 | 1533 | No | Story (~1533) |
| `harbinger-vol-1-omega-rising` | 34 | 1988x3056 | 3056 | No | Cover/Splash (3056) |
| `harbinger-vol-1-omega-rising` | 44 | 999x1533 | 1533 | Yes | Story (~1533) |
| `harbinger-vol-1-omega-rising` | 58 | 999x1533 | 1533 | No | Story (~1533) |
| `harbinger-vol-1-omega-rising` | 141 | 1993x1534 | 1993 | No | Spread (1993) |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 10 | 999x1533 | 1533 | No | Story (~1533) |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 12 | 999x1533 | 1533 | No | Story (~1533) |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 20 | 999x1533 | 1533 | No | Story (~1533) |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 29 | 996x1533 | 1533 | No | Story (~1533) |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 31 | 999x1533 | 1533 | No | Story (~1533) |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 37 | 999x1533 | 1533 | No | Story (~1533) |

Of the 18 DEV pages:
- **16 pages (88.9%)** embed **~1533 px** rasters (1532–1533 px).
- **1 page (5.6%)** embeds **3056 px** raster (Harbinger p34, monochrome inks).
- **1 page (5.6%)** is a landscape spread embedding **1993 px** raster (Harbinger p141).

---

## Baseline Caveat and Hybrid Representation Reality

> [!WARNING]
> **The 3056 px Lossless Baseline Caveat**:
> The 3056 px uncompressed render baseline is a **2x upscale** of the underlying embedded raster for 16 of the 18 DEV pages and ~78% of the full corpus.
> Therefore, objective difference metrics (such as PSNR and MSE vs. the 3056 px baseline) do **not** simply measure compression fidelity of the artwork: for the ~1533 px raster artwork, 3056 px adds zero detail, and comparing 1533 px or 2400 px vs. 3056 px largely measures the smoothing properties of Lanczos upsampling.

However, the pages are **hybrid compositions**, not pure flat rasters:
1. **Underlying Artwork**: Embedded color rasters at ~1533 px long edge (~150 DPI).
2. **Dialogue & Layout Overlays**: Hundreds of **PDF vector path objects** (`FPDF_PAGEOBJ_PATH`) per page defining dialogue speech balloon contours, tail pointers, stylized sound effect shapes, and panel borders, plus occasional PDF text objects (`FPDF_PAGEOBJ_TEXT`).

When PDFium renders complete pages, vector paths are mathematically rasterized at whatever target render scale is requested.
- Rendering at **native-raster (~1533 px)** rasterizes vector dialogue balloons and lettering at only ~150 DPI, introducing visible pixel stair-stepping and fuzzy text on modern high-DPI screens.
- Rendering at **2400 px** rasterizes vector speech balloons and lettering with crisp subpixel anti-aliasing (~235 DPI), noticeably improving dialogue legibility.
- Rendering at **3056 px or 3840 px** adds virtually no noticeable improvement over 2400 px for lettering while pointlessly upscaling the ~1533 px raster art, bloating storage by 30% to 70%.

---

## Representation Benchmark Results

Measurements below represent averages across all **18 DEV pages**. The benchmark includes a `webp-q85-native-raster` candidate that dynamically renders each page at its exact embedded raster long edge (e.g. 1532 px for Archer p7, 1993 px for Harbinger p141, 3056 px for Harbinger p34).

| Candidate | Res (px) | Format | Lossless / Q | Avg KB / Page | Dev Split (18p) | Projected Corpus (389p) | Avg Render Time | Avg Encode Time | Avg Total Time | Avg PSNR vs 3056 Ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `webp-q85-native-raster` | native-raster | WEBP | q=85 | 252.6 KB | 4.44 MB | 95.9 MB | 0.041 s | 0.200 s | 0.241 s | 29.01 dB |
| `png-1600` | 1600 | PNG | lossless | 1735.1 KB | 30.50 MB | 659.1 MB | 0.083 s | 0.327 s | 0.410 s | 29.43 dB |
| `webp-lossless-1600` | 1600 | WEBP | lossless | 1188.5 KB | 20.89 MB | 451.5 MB | 0.083 s | 0.969 s | 1.052 s | 29.43 dB |
| `webp-q92-1600` | 1600 | WEBP | q=92 | 336.2 KB | 5.91 MB | 127.7 MB | 0.083 s | 0.207 s | 0.289 s | 29.08 dB |
| `webp-q85-1600` | 1600 | WEBP | q=85 | 242.1 KB | 4.26 MB | 92.0 MB | 0.083 s | 0.196 s | 0.279 s | 28.87 dB |
| `webp-q75-1600` | 1600 | WEBP | q=75 | 172.4 KB | 3.03 MB | 65.5 MB | 0.083 s | 0.177 s | 0.260 s | 28.50 dB |
| `jpeg-q90-1600` | 1600 | JPEG | q=90 | 430.4 KB | 7.57 MB | 163.5 MB | 0.083 s | 0.008 s | 0.090 s | 28.92 dB |
| `png-2400` | 2400 | PNG | lossless | 3183.8 KB | 55.97 MB | 1209.5 MB | 0.123 s | 0.694 s | 0.817 s | 35.93 dB |
| `webp-lossless-2400` | 2400 | WEBP | lossless | 2119.1 KB | 37.25 MB | 805.0 MB | 0.123 s | 2.264 s | 2.388 s | 35.93 dB |
| `webp-q92-2400` | 2400 | WEBP | q=92 | 565.0 KB | 9.93 MB | 214.6 MB | 0.123 s | 0.408 s | 0.532 s | 34.90 dB |
| **`webp-q85-2400`** *(Rec)* | **2400** | **WEBP** | **q=85** | **396.5 KB** | **6.97 MB** | **150.6 MB** | **0.123 s** | **0.386 s** | **0.510 s** | **34.32 dB** |
| `webp-q75-2400` | 2400 | WEBP | q=75 | 276.7 KB | 4.86 MB | 105.1 MB | 0.123 s | 0.364 s | 0.487 s | 33.40 dB |
| `jpeg-q90-2400` | 2400 | JPEG | q=90 | 762.6 KB | 13.40 MB | 289.7 MB | 0.123 s | 0.017 s | 0.140 s | 34.61 dB |
| `png-3056` | 3056 | PNG | lossless | 4474.1 KB | 78.65 MB | 1699.6 MB | 0.000 s | 1.117 s | 1.117 s | inf dB |
| `webp-lossless-3056` | 3056 | WEBP | lossless | 2869.9 KB | 50.45 MB | 1090.2 MB | 0.000 s | 3.989 s | 3.989 s | inf dB |
| `webp-q92-3056` | 3056 | WEBP | q=92 | 742.2 KB | 13.05 MB | 282.0 MB | 0.000 s | 0.653 s | 0.653 s | 43.91 dB |
| `webp-q85-3056` | 3056 | WEBP | q=85 | 515.9 KB | 9.07 MB | 196.0 MB | 0.000 s | 0.619 s | 0.619 s | 41.44 dB |
| `webp-q75-3056` | 3056 | WEBP | q=75 | 358.4 KB | 6.30 MB | 136.2 MB | 0.000 s | 0.566 s | 0.566 s | 38.73 dB |
| `jpeg-q90-3056` | 3056 | JPEG | q=90 | 1057.3 KB | 18.58 MB | 401.6 MB | 0.000 s | 0.025 s | 0.025 s | 42.98 dB |
| `png-3840` | 3840 | PNG | lossless | 6174.1 KB | 108.53 MB | 2345.4 MB | 0.238 s | 1.650 s | 1.888 s | 38.20 dB |
| `webp-lossless-3840` | 3840 | WEBP | lossless | 3914.3 KB | 68.81 MB | 1487.0 MB | 0.238 s | 6.059 s | 6.297 s | 38.20 dB |
| `webp-q92-3840` | 3840 | WEBP | q=92 | 977.9 KB | 17.19 MB | 371.5 MB | 0.238 s | 0.943 s | 1.181 s | 37.28 dB |
| `webp-q85-3840` | 3840 | WEBP | q=85 | 672.4 KB | 11.82 MB | 255.4 MB | 0.238 s | 0.896 s | 1.134 s | 36.71 dB |
| `webp-q75-3840` | 3840 | WEBP | q=75 | 471.6 KB | 8.29 MB | 179.1 MB | 0.238 s | 0.863 s | 1.101 s | 35.84 dB |
| `jpeg-q90-3840` | 3840 | JPEG | q=90 | 1457.9 KB | 25.63 MB | 553.8 MB | 0.238 s | 0.038 s | 0.276 s | 37.20 dB |

### Thumbnail Candidates

| Candidate | Res (px) | Format | Quality | Avg KB / Page | Dev Split (18p) | Projected Corpus (389p) | Avg Render Time | Avg Encode Time | Avg Total Time | Avg PSNR vs 3056 Ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `thumb-webp-q80-240` | 240 | WEBP | q=80 | 11.6 KB | 0.20 MB | 4.4 MB | 0.013 s | 0.006 s | 0.020 s | 16.46 dB |
| `thumb-webp-q85-240` | 240 | WEBP | q=85 | 13.4 KB | 0.24 MB | 5.1 MB | 0.013 s | 0.007 s | 0.020 s | 16.48 dB |
| `thumb-jpeg-q85-240` | 240 | JPEG | q=85 | 16.4 KB | 0.29 MB | 6.2 MB | 0.013 s | 0.000 s | 0.014 s | 16.43 dB |
| `thumb-jpeg-q90-240` | 240 | JPEG | q=90 | 19.8 KB | 0.35 MB | 7.5 MB | 0.013 s | 0.000 s | 0.014 s | 16.47 dB |
| **`thumb-webp-q80-360`** *(Rec)* | **360** | **WEBP** | **q=80** | **22.1 KB** | **0.39 MB** | **8.4 MB** | **0.014 s** | **0.012 s** | **0.026 s** | **18.45 dB** |
| `thumb-webp-q85-360` | 360 | WEBP | q=85 | 25.6 KB | 0.45 MB | 9.7 MB | 0.014 s | 0.013 s | 0.027 s | 18.48 dB |
| `thumb-jpeg-q85-360` | 360 | JPEG | q=85 | 32.3 KB | 0.57 MB | 12.3 MB | 0.014 s | 0.001 s | 0.015 s | 18.41 dB |
| `thumb-jpeg-q90-360` | 360 | JPEG | q=90 | 39.2 KB | 0.69 MB | 14.9 MB | 0.014 s | 0.001 s | 0.015 s | 18.47 dB |

---

## Visual Verification: Native-Raster vs. 2400 px vs. 3056 px

To test the hypothesis that vector path objects sharpen with render resolution while raster artwork gains no detail above native size, side-by-side comparison strips were generated at **native-raster (~1533 px) vs. 2400 px vs. 3056 px** on one representative story page per book and visually inspected using image viewing tools.

### 1. Archer & Armstrong Vol. 1 — Page 7 (Native raster: 998x1532 px)

- **Lettering Crop** (`work/representation/native_vs_upscale_crops/aa_p7_lettering_comparison.png`):
  - *Content*: Dialogue speech balloon: `"OH, AND... YOU MIGHT WANT TO WATCH OUT FOR THE..."` (386 vector path objects on page).
  - *Native-Raster (1532 px)*: Noticeable pixel stair-stepping along the curved strokes of `'O'`, `'S'`, `'C'`, and `'G'`. The oval vector border of the speech balloon shows visible pixel steps and anti-aliasing blur.
  - *2400 px*: The letter stems and balloon outline snap into crisp, clean lines with smooth subpixel anti-aliasing. Text readability is dramatically enhanced.
  - *3056 px*: Virtually indistinguishable from 2400 px under standard viewing conditions; no perceptual readability gain over 2400 px.

- **Artwork Crop** (`work/representation/native_vs_upscale_crops/aa_p7_artwork_comparison.png`):
  - *Content*: Monk running with submachine gun, architectural wall textures, and robe folds.
  - *Native-Raster (1532 px)*: Clean 150 DPI halftone/ink rendering.
  - *2400 px*: Resampled smoothly via Lanczos filtering, but reveals **zero additional brushstrokes, ink textures, or finer line detail**.
  - *3056 px*: Completely identical detail to 2400 px; pure interpolation with zero added information.

### 2. Harbinger Vol. 1 — Page 11 (Native raster: 998x1533 px)

- **Lettering Crop** (`work/representation/native_vs_upscale_crops/harb_p11_lettering_comparison.png`):
  - *Content*: Dialogue balloon: `"CAN WE JUST TALK ABOUT THIS?"` (1,090 vector path objects on page).
  - *Native-Raster (1533 px)*: Thin font stems display coarse pixel steps. Punctuation (`?`) and curves (`'S'`) show soft pixelated contours.
  - *2400 px*: Dialogue text is sharp and razor-clean. The speech balloon border is a crisp, continuous vector stroke with zero aliasing.
  - *3056 px*: Perceptually identical to 2400 px.

- **Artwork Crop** (`work/representation/native_vs_upscale_crops/harb_p11_artwork_comparison.png`):
  - *Content*: Peter Stanchek's face, dark hair strands, and soft jacket shadow gradients.
  - *Native-Raster (1533 px)*: Soft painted digital gradient texture.
  - *2400 px*: Gradients are smoothly rendered without banding, but hair lines contain no finer strands.
  - *3056 px*: Identical to 2400 px.

### 3. Quantum & Woody Vol. 1 — Page 10 (Native raster: 999x1533 px)

- **Lettering Crop** (`work/representation/native_vs_upscale_crops/qw_p10_lettering_comparison.png`):
  - *Content*: Dense dialogue grid: `"WE WILL SOLVE OUR FATHER'S MURDER... WE WILL AVENGE HIS DEATH..."` (606 vector path objects on page).
  - *Native-Raster (1533 px)*: Tiny condensed dialogue has filled-in counters in `'A'`, `'B'`, and `'R'`. Small apostrophes and ellipses blend into letter stems, causing eye strain.
  - *2400 px*: All counters remain clearly open. Letter edges are distinct and readable at a glance.
  - *3056 px*: No discernible improvement over 2400 px.

- **Artwork Crop** (`work/representation/native_vs_upscale_crops/qw_p10_artwork_comparison.png`):
  - *Content*: Woody leaning over an office desk; jacket wrinkles, smirk, and woodgrain textures.
  - *Native-Raster (1533 px)*: Standard 150 DPI digital inking.
  - *2400 px vs. 3056 px*: Both display identical ink boundaries and identical woodgrain textures. No new high-frequency detail is revealed.

### Visual Verification Conclusion:
The visual inspection definitively confirms:
1. **Raster artwork detail caps at ~1533 px**: Upscaling to 2400 px or 3056 px recovers zero extra artwork detail from the embedded image.
2. **Vector lettering sharpens up to 2400 px**: Because dialogue balloons, text, and panel borders are vector paths, rendering at 2400 px significantly sharpens letter readability and smooths balloon contours compared to native-raster (~1533 px).
3. **Diminishing returns beyond 2400 px**: Rendering at 3056 px or 3840 px yields no visible improvement in lettering over 2400 px, while increasing file size by +30% to +70% and encode time by +60% to +132%.

---

## Direct Embedded-Image Extraction Audit

Direct image extraction was audited across all 18 DEV pages to evaluate whether extracting the raw embedded image stream could replace complete PDF page rendering.

### Audit Results

| Book ID | Page | Images | Text Objs | Path Objs | Size Match | Max Diff | Qualifies? | Primary Disqualification Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `archer-armstrong-vol-1` | 7 | 1 | 0 | 386 | No | N/A | **NO** | 386 vector path objects (speech balloons) omitted |
| `archer-armstrong-vol-1` | 10 | 1 | 0 | 133 | No | N/A | **NO** | 133 vector path objects (sound effects) omitted |
| `archer-armstrong-vol-1` | 17 | 1 | 0 | 387 | No | N/A | **NO** | 387 vector path objects omitted |
| `archer-armstrong-vol-1` | 33 | 1 | 0 | 678 | No | N/A | **NO** | 678 vector path objects omitted |
| `archer-armstrong-vol-1` | 49 | 1 | 0 | 600 | No | N/A | **NO** | 600 vector path objects omitted |
| `archer-armstrong-vol-1` | 67 | 1 | 0 | 465 | No | N/A | **NO** | 465 vector path objects omitted |
| `harbinger-vol-1` | 11 | 1 | 0 | 1090 | No | N/A | **NO** | 1090 vector path objects omitted |
| `harbinger-vol-1` | 23 | 1 | 0 | 383 | No | N/A | **NO** | 383 vector path objects omitted |
| `harbinger-vol-1` | 34 | 1 | 0 | 0 | No | N/A | **NO** | Bleed mismatch: image extends -1.88 pt outside page box |
| `harbinger-vol-1` | 44 | 1 | 36 | 22 | No | N/A | **NO** | 36 PDF text objects (narration boxes) omitted |
| `harbinger-vol-1` | 58 | 1 | 0 | 511 | No | N/A | **NO** | 511 vector path objects omitted |
| `harbinger-vol-1` | 141 | 1 | 0 | 299 | No | N/A | **NO** | 299 vector path objects omitted |
| `quantum-and-woody-vol-1` | 10 | 1 | 0 | 606 | No | N/A | **NO** | 606 vector path objects omitted |
| `quantum-and-woody-vol-1` | 12 | 1 | 0 | 240 | No | N/A | **NO** | 240 vector path objects omitted |
| `quantum-and-woody-vol-1` | 20 | 1 | 0 | 922 | No | N/A | **NO** | 922 vector path objects omitted |
| `quantum-and-woody-vol-1` | 29 | 27 | 0 | 561 | No | N/A | **NO** | Multi-image composition (27 embedded images) |
| `quantum-and-woody-vol-1` | 31 | 1 | 0 | 156 | No | N/A | **NO** | 156 vector path objects omitted |
| `quantum-and-woody-vol-1` | 37 | 1 | 0 | 167 | No | N/A | **NO** | 167 vector path objects omitted |

**Audit Conclusion:** Exactly **0 out of 18 DEV pages qualify** for direct image extraction.
- **Omission of Dialogue**: In 17 of 18 pages, dialogue balloons and lettering are vector paths or PDF text objects. Direct extraction leaves empty art backgrounds stripped of all dialogue.
- **Bleed & Transform Mismatches**: On unlettered covers (such as Harbinger p34), the image boundaries extend beyond the PDF MediaBox / CropBox into printer bleed area (-1.88 pt). Blind extraction results in incorrect aspect ratio and uncropped bleed.
- **Multi-Image Assemblies**: Pages like Quantum & Woody p29 assemble 27 separate image tiles.

> [!IMPORTANT]
> **Complete-page rendering with PDFium is mandatory**, not merely a fallback. Direct image extraction cannot be used on this corpus.

---

## Cropped Panel Derivatives vs. Full Page Baseline

Using Archer & Armstrong p7 (5 stacked horizontal panels):
- **Full page baseline (WebP q85)**: 350.9 KB (359,368 bytes)
- **Sum of 5 panel crops (WebP q85)**: 354.8 KB (363,334 bytes)
- **Ratio (panel crops / full page)**: **101.1%**

### Trade-off Assessment
1. **No Storage Benefit**: Due to container header overhead and the loss of cross-panel spatial prediction, the sum of cropped panel files is slightly larger (+1.1%) than the full page.
2. **Double Transfer**: If both full pages (for browsing) and pre-cropped panels (for guided view) are fetched, total network payload doubles (~201%).
3. **Editor Re-encoding Penalty**: If panel bounding boxes are adjusted interactively (as required in Issue #6), using a single full page requires only updating lightweight JSON coordinates. Pre-cropped derivatives would require re-cropping, re-encoding, and re-uploading raster image files.

> [!TIP]
> **Architecture Decision**: The web reader should consume **full-page complete renders** and use client-side CSS/Canvas viewport transforms over manifest region coordinates for guided reading.

---

## Recommended Profiles and Resolution Policy

### 1. Initial Page Profile
- **Format**: **WebP (lossy)**
- **Quality**: **q=85**
- **Longest Edge**: **2400 px**
- **Resolution Policy**: **`fixed-long-edge`**
  - Renders every page so its long edge equals 2400 px (spreads included, where the long edge is width ~2400 px), while never exceeding it.
- **Justification**:
  - **Sharp Lettering**: Rasterizes the hundreds of vector dialogue balloon and lettering paths per page at high-DPI quality (~235 DPI), ensuring crisp legibility without blur on iPad Retina (2048 px) and iPad Pro (2732 px) screens.
  - **Bandwidth & Storage Budget**: At an average of **396.5 KB per page**, the entire **389-page corpus projects to only 150.6 MB** (vs. 1.2 GB for PNG, 290 MB for JPEG q90, or 196 MB for 3056 px).
  - **Avoids Pointless Upscaling of Art**: Caps resolution below 3056/3840 px where underlying ~1533 px raster artwork gains zero detail.
  - **Fast Ingestion**: Average render + encode time is **0.51 s per page**, allowing a complete 149-page volume to be processed in ~76 seconds.

### 2. Thumbnail Profile
- **Format**: **WebP (lossy)**
- **Quality**: **q=80**
- **Longest Edge**: **360 px**
- **Justification**:
  - **Storage**: Average thumbnail is **22.1 KB**, projecting to only **8.4 MB for the entire 389-page corpus combined**.
  - **Visual Quality**: 360 px provides crisp, Retina-sharp thumbnail previews in navigation rails, bottom sheets, and contact sheets.
  - **Speed**: PDFium renders 360 px thumbnails directly in **0.014 s (14 ms)**.

### Corpus-Level Storage Projection (389 Pages)

| Asset Type | Format | Quality | Long Edge | Avg / Page | Total Corpus (389 Pages) |
| --- | --- | --- | --- | --- | --- |
| **Page Artwork** | WebP | q=85 | 2400 px (`fixed-long-edge`) | 396.5 KB | **150.6 MB** |
| **Thumbnails** | WebP | q=80 | 360 px | 22.1 KB | **8.4 MB** |
| **Manifests & JSON** | JSON | N/A | N/A | ~4 KB | **~1.6 MB** |
| **Total Package** | — | — | — | **~422.6 KB** | **~160.6 MB** |
