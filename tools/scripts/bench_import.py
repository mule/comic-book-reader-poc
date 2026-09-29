"""Benchmark import timing and size stats on a fresh output directory with current default profile."""

import json
import os
import platform
import shutil
import sys
import time

from comicpoc.corpus import ROOT
from comicpoc.importer import RenderProfile, import_pdf
from comicpoc.manifest import validate_package


def main() -> int:
    inventory_path = ROOT / "corpus/inventory.json"
    inventory = json.loads(inventory_path.read_text())

    output_dir = ROOT / "work/bench-import"
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    profile = (
        RenderProfile()
    )  # Current default profile: 2400px WebP q85, thumbnails 360px WebP q80
    profile_data = profile.manifest()

    bench_results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "profile": profile_data,
        "environment": {
            "os": platform.platform(),
            "python": sys.version,
            "cpu": platform.processor(),
            "cpu_count": os.cpu_count(),
        },
        "books": [],
        "total_pages": 0,
        "total_import_seconds": 0.0,
        "total_page_bytes": 0,
        "total_thumb_bytes": 0,
        "total_package_bytes": 0,
    }

    try:
        total_time = 0.0
        for book in inventory["books"]:
            book_id = book["book_id"]
            pdf_path = ROOT / "test-data" / book["source"]
            print(f"Importing {book_id} from {pdf_path.name}...", flush=True)

            t0 = time.monotonic()
            package_path = import_pdf(
                source=pdf_path,
                output=output_dir,
                profile=profile,
                identity=book_id,
            )
            elapsed = time.monotonic() - t0
            total_time += elapsed

            manifest = validate_package(package_path)
            pages = manifest["pages"]
            page_sizes = [p["page"]["byte_size"] for p in pages]
            thumb_sizes = [p["thumbnail"]["byte_size"] for p in pages]

            book_stat = {
                "book_id": book_id,
                "title": manifest["book"]["title"],
                "source_sha256": manifest["source"]["sha256"],
                "source_bytes": manifest["source"]["byte_size"],
                "pages": len(pages),
                "import_seconds": round(elapsed, 2),
                "import_pages_per_second": round(len(pages) / elapsed, 2),
                "page_bytes_total": sum(page_sizes),
                "page_bytes_min": min(page_sizes),
                "page_bytes_mean": sum(page_sizes) // len(page_sizes),
                "page_bytes_max": max(page_sizes),
                "thumb_bytes_total": sum(thumb_sizes),
                "asset_bytes_total": sum(page_sizes) + sum(thumb_sizes),
                "package_bytes_total": sum(
                    p.stat().st_size for p in package_path.rglob("*") if p.is_file()
                ),
            }
            bench_results["books"].append(book_stat)
            bench_results["total_pages"] += len(pages)
            bench_results["total_page_bytes"] += sum(page_sizes)
            bench_results["total_thumb_bytes"] += sum(thumb_sizes)
            bench_results["total_package_bytes"] += book_stat["package_bytes_total"]
            print(
                f"  Done in {elapsed:.2f}s ({book_stat['import_pages_per_second']} pages/s), total {book_stat['package_bytes_total']} bytes",
                flush=True,
            )

        bench_results["total_import_seconds"] = round(total_time, 2)
        bench_results["overall_pages_per_second"] = round(
            bench_results["total_pages"] / total_time, 2
        )

        out_json = ROOT / "work/bench/import-benchmark.json"
        out_json.parent.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(bench_results, indent=2) + "\n")
        print(f"\nSaved raw benchmark to {out_json}")

    finally:
        # Clean up temporary bench-import dir to save space
        if output_dir.exists():
            shutil.rmtree(output_dir)

    return 0


if __name__ == "__main__":
    sys.exit(main())
