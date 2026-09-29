# Evaluation report: Corpus, importer and reader performance (Issue #8 Phase A)

Date: 2026-09-28. Branch: `feat/8-evaluation`. Evaluation phase: **Phase A (Measurement Tooling & Baseline Evaluation)**.

This report documents reproducible, measured results across all three books in the POC test corpus under the current default rendering profile (fixed long edge 2400 px, WebP q85, thumbnails 360 px WebP q80). Every number reported here derives directly from instrumented script executions with raw JSON outputs archived in `work/bench/`.

---

## 1. Evaluation environment

| Component | Value | Notes |
| --- | --- | --- |
| Operating System | Linux 7.0.11-76070011-generic (x86_64) | GNU/Linux (Pop!_OS / Ubuntu base) |
| CPU | Intel(R) Core(TM) i7-10510U CPU @ 1.80GHz | 4 physical cores, 8 logical threads |
| System RAM | 31.01 GB | Total physical memory |
| Python runtime | Python 3.12.3 (GCC 13.3.0) | Managed via `uv` |
| Node runtime | Node.js v22.22.3, pnpm 11.3.0 | `reader/` and `bench/` projects |
| Browser engine | Chromium 153.0.8010.12 (Headless) | Driven via Playwright v1.63.0 / Chrome DevTools Protocol |
| Network conditions | Localhost loopback (127.0.0.1) | No simulated latency throttling |
| Server | `vite preview` (`pnpm exec vite preview`) | Production build (`dist/`), `COMIC_PACKAGES_DIR` package plugin |
| Cache conditions | Context cache disabled for cold load; enabled (max-age=3600) for warm navigation | Specified per benchmark test |

---

## 2. Corpus verification (`comicpoc verify-corpus`)

Verification confirms that every page across all three packages in `work/packages/` reconciles against the source PDF inventory (`corpus/inventory.json`).

### Reproduction command

```bash
cd tools && uv run comicpoc verify-corpus \
  --packages ../work/packages \
  --inventory ../corpus/inventory.json \
  --json ../work/bench/corpus-verification.json \
  --markdown ../work/bench/corpus-verification.md
```

Raw JSON artifact: `work/bench/corpus-verification.json`.

### Verification results

| Book ID | Pages | Source SHA256 Match | Order Contiguous | Orientations | Assets Decodable & Hash-Match | COMPLETE Marker | Status |
| --- | ---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `archer-armstrong-vol-1-the-michelangelo-code` | 111 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASSED** |
| `harbinger-vol-1-omega-rising` | 149 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASSED** |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 129 | ✓ | ✓ | ✓ | ✓ | ✓ | **PASSED** |

- **Total books:** 3
- **Total pages verified:** 389 / 389 (100%)
- **Total assets verified & decoded:** 778 (389 full-page WebP + 389 thumbnail WebP)
- **Geometry & orientation:** Every rendered page matches source PDF dimensions and orientation (e.g. Harbinger page 141 confirmed as landscape 2400 × 1846 px; all portrait pages confirmed portrait).
- **Integrity:** Every asset checksum matches its manifest record; manifest text matches `COMPLETE.json` checksum.

---

## 3. Import timing and storage size

Measured on a fresh staging directory (`work/bench-import/`) using the current default profile: 2400 px fixed long edge, WebP q85, thumbnails 360 px WebP q80.

### Reproduction command

```bash
cd tools && uv run python scripts/bench_import.py
```

Raw JSON artifact: `work/bench/import-benchmark.json`.

### Measurement results

| Book | Pages | Source bytes | Import time | Speed | Page assets | Min / Mean / Max page bytes | Thumb assets | Total package bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Archer & Armstrong Vol. 1 | 111 | 68,357,268 | 57.52 s | 1.93 p/s | 43,330,266 B | 41,132 / 390,362 / 648,268 B | 2,306,714 B | 45,636,980 B |
| Harbinger Vol. 1 | 149 | 94,015,425 | 82.72 s | 1.80 p/s | 58,646,560 B | 34,742 / 393,601 / 622,448 B | 3,148,162 B | 61,794,722 B |
| Quantum and Woody Vol. 1 | 129 | 124,784,980 | 76.26 s | 1.69 p/s | 59,746,500 B | 75,638 / 463,151 / 891,064 B | 3,167,634 B | 62,914,134 B |
| **Corpus total** | **389** | **287,157,673** | **216.50 s** | **1.80 p/s** | **161,723,326 B** | **34,742 / 415,741 / 891,064 B** | **8,622,510 B** | **170,345,836 B** |

- Total conversion time for all 389 pages: **216.50 seconds** (~3.6 minutes).
- Total package storage across all three books: **170.35 MB** (161.72 MB pages, 8.62 MB thumbnails), compared to 287.16 MB source PDFs.

---

## 4. Cold first-page load latency

Measured across fresh browser contexts with browser cache disabled (`CDP Network.setCacheDisabled: true`). Timer starts at initial navigation and stops when the page image bitmap has been loaded into DOM, decoded (`HTMLImageElement.decode()`), and painted.

### Reproduction command

```bash
cd bench && pnpm bench
```

Raw JSON artifact: `work/bench/reader-benchmark.json`.

### Measurement results

| Book ID | Viewport | Viewport classification | Decode & Visible (ms) | Manifest fetch (ms) | COMPLETE fetch (ms) | Page 1 Image fetch (ms) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `archer-armstrong-vol-1-the-michelangelo-code` | 1280x800, dpr 1 | Desktop | **237.37** | 2.6 | 1.6 | 7.6 |
| `archer-armstrong-vol-1-the-michelangelo-code` | 1180x820, dpr 2, touch | **EMULATION** (Tablet Landscape) | **286.65** | 3.7 | 1.9 | 9.1 |
| `archer-armstrong-vol-1-the-michelangelo-code` | 820x1180, dpr 2, touch | **EMULATION** (Tablet Portrait) | **270.92** | 1.9 | 1.3 | 5.5 |
| `harbinger-vol-1-omega-rising` | 1280x800, dpr 1 | Desktop | **255.92** | 2.1 | 2.0 | 7.0 |
| `harbinger-vol-1-omega-rising` | 1180x820, dpr 2, touch | **EMULATION** (Tablet Landscape) | **234.78** | 2.1 | 1.5 | 6.1 |
| `harbinger-vol-1-omega-rising` | 820x1180, dpr 2, touch | **EMULATION** (Tablet Portrait) | **283.12** | 1.8 | 1.4 | 6.3 |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 1280x800, dpr 1 | Desktop | **244.48** | 2.0 | 1.3 | 6.3 |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 1180x820, dpr 2, touch | **EMULATION** (Tablet Landscape) | **267.15** | 9.7 | 2.8 | 4.8 |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 820x1180, dpr 2, touch | **EMULATION** (Tablet Portrait) | **278.36** | 2.6 | 1.4 | 9.6 |

- Desktop cold first-page loads average **245.9 ms**.
- Tablet emulation cold loads average **270.2 ms**.

---

## 5. Warm page navigation latency

Measured over 40 consecutive sequential page turns per book, from keypress (`ArrowRight`) until the DOM status reaches `loaded`, the new image bitmap decode resolves, and the subsequent animation frame paints.

### Reproduction command

```bash
cd bench && pnpm bench
```

Raw JSON artifact: `work/bench/reader-benchmark.json`.

### Measurement results

| Book ID | Viewport | Classification | Turns | p50 (ms) | p95 (ms) | Min (ms) | Max (ms) | Mean (ms) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `archer-armstrong-vol-1-the-michelangelo-code` | 1280x800 | Desktop | 40 | **117.08** | **151.56** | 68.85 | 161.36 | 112.45 |
| `harbinger-vol-1-omega-rising` | 1280x800 | Desktop | 40 | **118.80** | **158.74** | 68.66 | 160.60 | 115.79 |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 1280x800 | Desktop | 40 | **121.17** | **157.74** | 65.43 | 187.65 | 120.50 |
| `harbinger-vol-1-omega-rising` | 1180x820 | **EMULATION** (Tablet) | 40 | **123.89** | **152.05** | 52.11 | 153.33 | 117.83 |

- Warm navigation latency remains consistent across books: median (**p50**) ~**117–124 ms**, 95th percentile (**p95**) ~**151–159 ms**.
- Prefetch lookahead guarantees that navigating to the next page is immediately served from cache without network stall.

---

## 6. Extended reading, bounded prefetch and memory behaviour

The benchmark navigated through all 389 pages end-to-end across all three books sequentially, sampling browser heap memory and DOM node counts via CDP (`Performance.getMetrics`) while intercepting all network requests.

### Reproduction command

```bash
cd bench && pnpm bench
```

Raw JSON artifact: `work/bench/reader-benchmark.json`.

### Extended reading audit results

| Book ID | Pages Visited | Page Requests (`/pages/`) | Zero `.pdf` Requests | Zero `test-data` Requests | Max DOM Page `<img>` Count | Final JS Heap (MB) | Bounded Prefetch Satisfied |
| --- | ---: | ---: | :---: | :---: | ---: | ---: | :---: |
| `archer-armstrong-vol-1-the-michelangelo-code` | 111 / 111 | 111 | ✓ (0) | ✓ (0) | 1 | 8.17 | ✓ |
| `harbinger-vol-1-omega-rising` | 149 / 149 | 149 | ✓ (0) | ✓ (0) | 1 | 5.23 | ✓ |
| `quantum-and-woody-vol-1-the-worlds-worst-superhero-team` | 129 / 129 | 129 | ✓ (0) | ✓ (0) | 1 | 5.11 | ✓ |

### Prefetch and memory findings

- **Bounded prefetch:** Request count strictly matches page count (111 requests for 111 pages; 149 for 149; 129 for 129). Page requests never exceed `currentPage + 3`.
- **Zero leaks:** JS Heap stays virtually flat throughout (5.11 MB to 8.17 MB), not scaling with book page count or total byte size.
- **Bounded DOM:** DOM image count stays strictly at **1** (only the active page element exists in the DOM; out-of-window elements have `src` detached).
- **Zero forbidden requests:** Zero requests for `.pdf` files and zero requests containing `test-data` paths across the entire 389-page session.

---

## 7. Offline behaviour observations

Tested by loading a book online, navigating to page 2 (populating the HTTP cache for pages 1 and 2), disconnecting the network via CDP (`context.setOffline(true)`), and observing reader behaviour when navigating back to a cached page versus navigating forward to an unvisited page.

### Observed behaviour

| Test case | Action | Observed reader state | DOM verification | Script observation |
| --- | --- | --- | --- | --- |
| **Recently visited page (cached)** | `ArrowLeft` back to page 1 | Page rendered successfully | `.page-stage[data-page-status="loaded"]`, `img.page-image` present with `naturalWidth=1570px`, `naturalHeight=2400px` | Asset served transparently from HTTP cache. No error banner rendered. |
| **Unvisited page (uncached)** | Navigated forward past prefetch window | Page error state triggered | `.page-status.page-status-error[role="alert"]`, text: *"Page image could not be loaded (missing or corrupt asset...)"*, retry and previous page buttons present | Handled via per-page error UI (PDF page 9); reader does not crash or freeze. |

**Finding (reader UX):** the offline failure is reported with the same message as a missing or corrupt asset. The reader does not distinguish network loss from package damage; a follow-up could check `navigator.onLine` or the fetch error type to show a "you are offline" message. No offline installation or service worker is claimed.

---

## 8. Synthetic CI verification

To ensure continuous reproducibility in environments without access to purchased test data, a synthetic smoke test suite was added to `.github/workflows/ci.yml`.

### Synthetic smoke test command

```bash
cd bench && pnpm bench:smoke
```

- Generates an ephemeral synthetic 3-page package (`work/synthetic-packages/synthetic-smoke-book`).
- Launches the reader preview server on an isolated port.
- Verifies cold load, warm page turns, zero forbidden requests, and offline cache recovery in ~7 seconds.

---

## 9. PENDING sections

The following areas are explicitly marked as **PENDING** as required by the POC brief and issue scope:

### A. Guided / panel reading navigation latency — PENDING
- **Status:** PENDING.
- **Rationale:** Guided reading and manual panel regions are currently being implemented in `reader/` under GitHub issue #6. An extensible hook is established in `bench/src/warmNav.ts` (`measurePanelNavigationLatency`), but no numbers are reported until issue #6 lands.

### B. Automatic detector results on held-out pages (#7 Phase B) — PENDING
- **Status:** PENDING.
- **Rationale:** Automatic detection evaluation on the held-out split requires explicit Phase B authorization and ground truth reference annotation from issue #6. Development split baseline metrics are reported in `docs/detection.md`.

### C. Physical tablet hardware validation — PENDING
- **Status:** PENDING.
- **Rationale:** Physical tablet devices (e.g. iPad, Android tablets) and physical touch screen interactions were unavailable during this automated run. All tablet metrics reported herein are explicitly designated as **EMULATION** (using Chromium's mobile emulation flags and viewport overrides). Physical hardware validation remains pending.

### D. Visual comparison at page and panel zoom — PENDING
- **Status:** PENDING.
- **Rationale:** Subjective human perceptual inspection of lettering sharpness, line fidelity, and artifacting across zoom factors requires interactive visual review against original PDF renderings, established as follow-up review work.
