# Import report

Measured locally on 2026-09-28 using the provisional native-embedded-capped WebP q90 / 3056px profile; thumbnails WebP q80 / 360px. These are complete PDF renders, including vectors and lettering. Timings include hashing, rendering, encoding, checkpoint writes, integrity verification and publication (cold package directories).

| Selection | Book | Pages | Seconds | Page + thumb bytes | Page bytes min / mean / max |
| --- | --- | ---: | ---: | ---: | ---: |
| dev | archer-armstrong-vol-1-the-michelangelo-code | 6 | 1.98 | 1700660 | 240144 / 263110 / 284098 |
| dev | harbinger-vol-1-omega-rising | 6 | 2.72 | 2554108 | 230426 / 401967 / 645882 |
| dev | quantum-and-woody-vol-1-the-worlds-worst-superhero-team | 6 | 2.09 | 1980242 | 254032 / 306471 / 401514 |
| all | archer-armstrong-vol-1-the-michelangelo-code | 111 | 40.71 | 40597128 | 69298 / 344954 / 1178530 |
| all | harbinger-vol-1-omega-rising | 149 | 70.65 | 53655254 | 19814 / 338975 / 953338 |
| all | quantum-and-woody-vol-1-the-worlds-worst-superhero-team | 129 | 74.95 | 62485330 | 132938 / 459792 / 1671206 |

Full-book assets total **156,737,712 bytes**; package files including manifests and checkpoints total **157,371,630 bytes**. Combined full-book import time: **186.31 seconds**. Harbinger p141 renders at **1993 × 1533px**. An explicit forbidden-PDF-open control also confirmed that the audit hook rejects access.

All **389/389** source pages matched inventory fingerprint, byte size, count and original PDF sequence: 111 Archer & Armstrong, 149 Harbinger, 129 Quantum and Woody. No silent omissions. Development samples contain exactly the six development pages per book, including Harbinger p141 as one intact landscape page. Every asset was decoded, dimensions checked and SHA-256 verified against its manifest. COMPLETE.json binds the published manifest checksum. Per-page dimensions and sizes (including samples) are in [import-page-sizes.csv](import-page-sizes.csv).

Standalone verification reran all three packages with a Python audit hook rejecting any attempt to open a PDF or test-data path. It passed. Recursive checks of package JSON values found no absolute local paths. Original PDFs were read only; their inventory hashes matched before import and after each book render.

Peak process RSS across sequential sample/full imports: 258.3 MiB on Linux. Rendering holds one PDF page/bitmap and its converted image at a time; native allocator caching and PDF document metadata also contribute. This is measured process RSS, not a proof of a fixed numeric ceiling across arbitrary PDFs.

Reproduce: `cd tools && uv run python scripts/import_corpus.py`. Existing identical packages are verified/reused; remove no originals. Use fresh output roots for new timing measurements or profile variants. Packages are local under work/samples and work/packages; artwork is excluded from Git. Final representation choice from #3 and visual/tablet acceptance remain separate work.
