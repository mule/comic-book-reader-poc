# Page Representation Experiment and Profile Recommendation

This report evaluates page representations, candidate resolutions, compression formats, direct image extraction, and panel derivative strategies for the comic book reader proof-of-concept. All measurements were conducted on the 18 frozen DEV pages established in `corpus/evaluation-split.json` across all three purchased corpus volumes.

## Reproducible Command

The benchmark and inspection assets were produced using the `comicpoc` CLI tool:

```sh
cd tools
# Run full benchmark and generate visual crops and viewport fits
uv run comicpoc compare-representations
```

Optional flags:
- `--no-visuals`: Run numerical benchmarks and extraction audit without generating image crops.
- `--no-extraction`: Skip the direct image extraction feasibility audit.
- `--output PATH`: Specify custom output directory under `work/` (default: `work/representation`).
- `--pages N [N ...]`: Limit benchmark to specific 1-based PDF page numbers.
- `--book BOOK_ID`: Limit benchmark to a specific volume.

All generated inspection crops, side-by-side comparison strips, viewport simulations, and full machine-readable JSON results are written to `work/representation/` (gitignored).

---

## Representation Benchmark Results

Measurements below represent averages across all **18 DEV pages** (6 pages from each of the 3 books). The reference baseline is complete-page rendering with pypdfium2 at native resolution (3056 px long-edge) evaluated uncompressed. PSNR (Peak Signal-to-Noise Ratio) is computed against this baseline after Lanczos-reconstructing candidate decodes to the reference pixel grid.

| Candidate | Res (px) | Format | Lossless / Quality | Avg KB / Page | Dev Split (18p) | Projected Corpus (389p) | Avg Render Time | Avg Encode Time | Avg Total Time | Avg PSNR vs Native |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `png-1600` | 1600 | PNG | lossless | 1735.1 KB | 30.50 MB | 659.1 MB | 0.079 s | 0.312 s | 0.391 s | 29.43 dB |
| `webp-lossless-1600` | 1600 | WEBP | lossless | 1188.5 KB | 20.89 MB | 451.5 MB | 0.079 s | 0.975 s | 1.055 s | 29.43 dB |
| `webp-q92-1600` | 1600 | WEBP | q=92 | 336.2 KB | 5.91 MB | 127.7 MB | 0.079 s | 0.201 s | 0.280 s | 29.08 dB |
| `webp-q85-1600` | 1600 | WEBP | q=85 | 242.1 KB | 4.26 MB | 92.0 MB | 0.079 s | 0.181 s | 0.260 s | 28.87 dB |
| `webp-q75-1600` | 1600 | WEBP | q=75 | 172.4 KB | 3.03 MB | 65.5 MB | 0.079 s | 0.165 s | 0.244 s | 28.50 dB |
| `jpeg-q90-1600` | 1600 | JPEG | q=90 | 430.4 KB | 7.57 MB | 163.5 MB | 0.079 s | 0.008 s | 0.087 s | 28.92 dB |
| `png-2400` | 2400 | PNG | lossless | 3183.8 KB | 55.97 MB | 1209.5 MB | 0.121 s | 0.689 s | 0.810 s | 35.93 dB |
| `webp-lossless-2400` | 2400 | WEBP | lossless | 2119.1 KB | 37.25 MB | 805.0 MB | 0.121 s | 2.245 s | 2.367 s | 35.93 dB |
| `webp-q92-2400` | 2400 | WEBP | q=92 | 565.0 KB | 9.93 MB | 214.6 MB | 0.121 s | 0.399 s | 0.520 s | 34.90 dB |
| **`webp-q85-2400`** *(Rec)* | **2400** | **WEBP** | **q=85** | **396.5 KB** | **6.97 MB** | **150.6 MB** | **0.121 s** | **0.364 s** | **0.485 s** | **34.32 dB** |
| `webp-q75-2400` | 2400 | WEBP | q=75 | 276.7 KB | 4.86 MB | 105.1 MB | 0.121 s | 0.342 s | 0.463 s | 33.40 dB |
| `jpeg-q90-2400` | 2400 | JPEG | q=90 | 762.6 KB | 13.40 MB | 289.7 MB | 0.121 s | 0.018 s | 0.139 s | 34.61 dB |
| `png-3056` | 3056 | PNG | lossless | 4474.1 KB | 78.65 MB | 1699.6 MB | 0.000 s | 1.088 s | 1.088 s | inf dB |
| `webp-lossless-3056` | 3056 | WEBP | lossless | 2869.9 KB | 50.45 MB | 1090.2 MB | 0.000 s | 4.073 s | 4.073 s | inf dB |
| `webp-q92-3056` | 3056 | WEBP | q=92 | 742.2 KB | 13.05 MB | 282.0 MB | 0.000 s | 0.683 s | 0.683 s | 43.91 dB |
| `webp-q85-3056` | 3056 | WEBP | q=85 | 515.9 KB | 9.07 MB | 196.0 MB | 0.000 s | 0.618 s | 0.618 s | 41.44 dB |
| `webp-q75-3056` | 3056 | WEBP | q=75 | 358.4 KB | 6.30 MB | 136.2 MB | 0.000 s | 0.579 s | 0.579 s | 38.73 dB |
| `jpeg-q90-3056` | 3056 | JPEG | q=90 | 1057.3 KB | 18.58 MB | 401.6 MB | 0.000 s | 0.027 s | 0.027 s | 42.98 dB |
| `png-3840` | 3840 | PNG | lossless | 6174.1 KB | 108.53 MB | 2345.4 MB | 0.236 s | 1.749 s | 1.985 s | 38.20 dB |
| `webp-lossless-3840` | 3840 | WEBP | lossless | 3914.3 KB | 68.81 MB | 1487.0 MB | 0.236 s | 6.552 s | 6.788 s | 38.20 dB |
| `webp-q92-3840` | 3840 | WEBP | q=92 | 977.9 KB | 17.19 MB | 371.5 MB | 0.236 s | 0.993 s | 1.229 s | 37.28 dB |
| `webp-q85-3840` | 3840 | WEBP | q=85 | 672.4 KB | 11.82 MB | 255.4 MB | 0.236 s | 0.920 s | 1.156 s | 36.71 dB |
| `webp-q75-3840` | 3840 | WEBP | q=75 | 471.6 KB | 8.29 MB | 179.1 MB | 0.236 s | 0.875 s | 1.111 s | 35.84 dB |
| `jpeg-q90-3840` | 3840 | JPEG | q=90 | 1457.9 KB | 25.63 MB | 553.8 MB | 0.236 s | 0.043 s | 0.279 s | 37.20 dB |

### Thumbnail Candidates

| Candidate | Res (px) | Format | Quality | Avg KB / Page | Dev Split (18p) | Projected Corpus (389p) | Avg Render Time | Avg Encode Time | Avg Total Time | Avg PSNR vs Native |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `thumb-webp-q80-240` | 240 | WEBP | q=80 | 11.6 KB | 0.20 MB | 4.4 MB | 0.013 s | 0.007 s | 0.020 s | 16.46 dB |
| `thumb-webp-q85-240` | 240 | WEBP | q=85 | 13.4 KB | 0.24 MB | 5.1 MB | 0.013 s | 0.007 s | 0.020 s | 16.48 dB |
| `thumb-jpeg-q85-240` | 240 | JPEG | q=85 | 16.4 KB | 0.29 MB | 6.2 MB | 0.013 s | 0.000 s | 0.014 s | 16.43 dB |
| `thumb-jpeg-q90-240` | 240 | JPEG | q=90 | 19.8 KB | 0.35 MB | 7.5 MB | 0.013 s | 0.000 s | 0.014 s | 16.47 dB |
| **`thumb-webp-q80-360`** *(Rec)* | **360** | **WEBP** | **q=80** | **22.1 KB** | **0.39 MB** | **8.4 MB** | **0.014 s** | **0.014 s** | **0.028 s** | **18.45 dB** |
| `thumb-webp-q85-360` | 360 | WEBP | q=85 | 25.6 KB | 0.45 MB | 9.7 MB | 0.014 s | 0.015 s | 0.029 s | 18.48 dB |
| `thumb-jpeg-q85-360` | 360 | JPEG | q=85 | 32.3 KB | 0.57 MB | 12.3 MB | 0.014 s | 0.001 s | 0.015 s | 18.41 dB |
| `thumb-jpeg-q90-360` | 360 | JPEG | q=90 | 39.2 KB | 0.69 MB | 14.9 MB | 0.014 s | 0.001 s | 0.015 s | 18.47 dB |

---

## Direct Embedded-Image Extraction Audit

Direct image extraction was evaluated as a candidate optimization where a page consists of exactly one image covering the full page box without text, vector, mask, or coordinate transform differences.

### DEV Page Audit Results

| Book ID | PDF Page | Image Objects | Text Objects | Path Objects | Size Match | Max Pixel Diff | Qualifies? | Primary Disqualification Reason |
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
- **Vector balloon & panel paths**: 16 of 18 pages rely on hundreds of vector paths for balloon contours, panel gutters, and stylized sound lettering. Extracting the raster alone discards these drawings.
- **Bleed & Crop box clipping**: All pages place the embedded raster with negative margins (-1.0 to -1.9 points) extending outside the page crop box. Blind extraction alters the page aspect ratio (e.g. 1988x3056 vs rendered 1999x3056).
- **Text objects**: On pages such as Harbinger p44, speech and narration are true PDF text objects (`FPDF_PAGEOBJ_TEXT`). Direct extraction omits all lettering.
- **Multi-image compositing**: Pages like Quantum & Woody p29 comprise up to 27 separate image streams composited across the page.
- **Color space**: Embedded rasters are stored as CMYK JPEGs or indexed streams. PDFium performs ICC-compliant CMYK-to-sRGB color management and blending.

> [!IMPORTANT]
> **Complete-page rendering with PDFium is mandatory**, not merely a fallback. Direct image extraction cannot be safely used on any volume in this corpus.

---

## Visual Inspection Findings

Inspection crops and side-by-side comparison strips were reviewed across the books to judge lettering legibility, linework sharpness, and compression artifacts:

### 1. Archer & Armstrong Vol. 1
- **Page 7 (Dialogue Balloons & Linework)**:
  - At **1600 px** (`1600-webp-q85`, 218 KB), speech text ("GILAD WOULD NOT WANT THIS, BROTHER...") is readable but softened. High-frequency eyebrow creases and beard textures show slight blurring.
  - At **2400 px** (`2400-webp-q85`, 351 KB), text strokes become sharp and well-delineated. The vector speech balloon border outline is clean and distinct.
  - At **3056 px** (`3056-webp-q85`, 465 KB), text is pristine. However, `3056-webp-q75` (320 KB) exhibits subtle mosquito ringing around the black balloon contours, whereas `q85` is artifact-free.
  - At **3840 px** (`3840-webp-q85`, 610 KB), no additional artwork detail is gained; linework definitions are identical to 3056 px.

### 2. Harbinger Vol. 1
- **Page 34 (Monochrome Inks - Native 3056 px Raster)**:
  - This unlettered black-and-white ink page embeds a genuine 1988x3056 raster.
  - At **1600 px**, fine cross-hatching on the handheld cassette tape and hair shadows partially coalesces.
  - At **2400 px**, individual pen strokes and delicate hatching remain crisp and separated.
  - At **3056 px**, fidelity matches the native uncompressed raster perfectly.
  - At **3840 px**, the image is simply upscaled via bilinear/bicubic filtering. Zero additional line detail is present, while file size expands by +29% (664 KB vs 515 KB).
- **Page 44 (Dark Scene & Vector Text)**:
  - In deep blue and black shadow gradients with glowing night-vision rifle sights, WebP `q85` maintains clean tonal transitions without macroblock banding.
  - Vector-rendered narration boxes are rendered razor-sharp by PDFium.

### 3. Quantum & Woody Vol. 1
- **Page 10 (Dense Conversation Grid & Serif Intertitle)**:
  - The white serif headline on a black strip ("Fight for your right...to fight") reveals compression behavior: `q75` exhibits ringing along the serifs; `q85` produces crisp letterforms against pure black.
  - In panel 3, condensed dialogue ("SHAOLIN WET-NAPKIN STYLE GOT TOO EMBARRASSING TO WATCH") has tiny letter counters (in 'A', 'R', 'B'). At **1600 px**, letter counters fill in slightly; at **2400 px**, all counters remain open and effortlessly readable.
- **Page 37 (Sound Effects & Explosions)**:
  - Bold jagged SFX lettering ("CAR-BO...") with internal flame gradients: WebP `q75` introduces noticeable blocking in the orange-to-yellow gradient; `q85` renders smooth gradients with punchy, high-contrast borders.

### 4. Viewport Simulations
- **Desktop 1920x1080 (1x)**: Vertical height of 1080 px comfortably displays regular page grids. Fine caption text is readable, but reading comfort benefits from guided panel zoom on multi-column pages.
- **Tablet Portrait 1536x2048 (iPad 9.7/10.2")**: Vertical height of 2048 px is the sweet spot. Pages sourced from a 2400 px asset display without any client-side upscaling blur; dialogue balloons match standard physical trade paperback scale.
- **Tablet Pro Portrait 2048x2732 (iPad Pro 12.9")**: Vertical height of 2732 px. Sourcing from a 1600 px asset requires 1.7x client-side scaling, producing noticeable softness. Sourcing from 2400 px requires only a slight 1.14x scaling and maintains excellent perceived sharpness.

---

## Source-Resolution Limits

Inventory inspection across all 389 corpus pages reveals a fundamental production constraint:
- **Covers, endpapers, and variant covers** are scanned/rasterized at **~1988x3056 px (~297-300 dpi)**.
- **Internal story pages** across all three books are largely embedded at **~999x1533 px (~150 dpi)**. Only rare specialty pages (such as Harbinger p34 monochrome ink) contain a 3056 px raster.

Because the source rasters for most interior pages are ~1533 px tall, rendering beyond 2400-3056 px cannot recover non-existent detail from the underlying color art. While PDFium's rasterizer renders vector speech balloon outlines and text objects crisply at any scale, rendering at 3840 px:
- Increases file size by **+30%** (672 KB vs 516 KB at q85).
- Increases total rendering + encoding time by **+87%** (1.16 s vs 0.62 s per page).
- Decreases objective PSNR vs native baseline (from 41.4 dB to 36.7 dB) due to resampling filter blur.

---

## Cropped Panel Derivatives vs. Full Page Baseline

We evaluated whether guided reading should download pre-cropped panel derivative images or use a single full-page image combined with manifest region coordinates.

Using Archer & Armstrong p7 (5 stacked horizontal panels):
- **Full page baseline (WebP q85)**: 350.9 KB (359,368 bytes)
- **Sum of 5 panel crops (WebP q85)**: 354.8 KB (363,334 bytes)
- **Ratio (panel crops / full page)**: **101.1%**

### Trade-off Assessment
1. **Network & Storage Overhead**: Cropped panel derivatives do not save bytes; due to per-file container headers and loss of cross-panel spatial prediction, their sum is slightly larger than the full page. If a reader downloads full pages for browsing and separate crops for guided mode, total data transfer **doubles** (~201%).
2. **Layout Bleed & Non-Rectangular Gutters**: Comic panels frequently feature sound effects crossing borders, floating figures, overlapping inset panels, and slanted gutters. Rectangular bounding-box crops duplicate background art; polygon-alpha crops bloat file sizes.
3. **Pipeline Flexibility & Corrections**: In Issue #6, users can interactively correct panel bounding boxes. With full-page assets + region coordinates, correcting a panel requires updating a lightweight JSON manifest with zero image re-encoding. Pre-cropped derivatives would require re-cutting and re-uploading raster files.

> [!TIP]
> **Architecture Decision**: The web reader should consume **full-page complete renders** and use client-side CSS/Canvas viewport transforms over manifest region coordinates for guided reading.

---

## Recommended Profiles

### 1. Initial Page Profile
- **Format**: **WebP (lossy)**
- **Quality**: **q=85**
- **Longest Edge**: **2400 px**
- **Justification**:
  - **Storage & Bandwidth**: Average page size is **396.5 KB**, projecting to **150.6 MB for the entire 389-page corpus** (comfortably within local memory and storage budgets, compared to 1.2 GB for PNG or 290 MB for JPEG q90).
  - **Visual Fidelity**: Delivers 34.3 dB avg PSNR, completely eliminating the high-contrast ringing artifacts observed at q75 while saving 23% storage vs 3056 px.
  - **Display Matching**: 2400 px covers standard iPad displays (2048 px height) without upscaling and provides sharp rendering on 2732 px iPad Pro displays.
  - **Throughput**: Average total processing time is **0.485 s per page**, allowing a full 149-page book to be imported in ~72 seconds.

### 2. Thumbnail Profile
- **Format**: **WebP (lossy)**
- **Quality**: **q=80**
- **Longest Edge**: **360 px**
- **Justification**:
  - **Storage**: Average thumbnail is **22.1 KB**, projecting to **8.4 MB for all 389 pages combined**.
  - **Visual Quality**: 360 px provides crisp, Retina-sharp thumbnail previews in navigation rails, grids, and contact sheets without text unreadability.
  - **Speed**: PDFium renders 360 px thumbnails in **0.014 s (14 ms)** directly, avoiding downsampling overhead from full renders.
