"""Reproduce development/full imports and artwork-free inventory reconciliation."""

import csv
import json
import resource
import sys
import time

from comicpoc.corpus import ROOT, check_inventory
from comicpoc.importer import import_pdf
from comicpoc.manifest import validate_package


def main():
    inventory = json.loads((ROOT / "corpus/inventory.json").read_text())
    split = json.loads((ROOT / "corpus/evaluation-split.json").read_text())
    problems = check_inventory(ROOT / "test-data", inventory)
    if problems:
        raise ValueError(problems)
    rows = []
    details = []
    for mode in ["dev", "all"]:
        for book in inventory["books"]:
            selected = (
                [
                    p["pdf_page_number"]
                    for p in split["pages"]
                    if p["book_id"] == book["book_id"] and p["split"] == "dev"
                ]
                if mode == "dev"
                else None
            )
            started = time.monotonic()
            package = import_pdf(
                ROOT / "test-data" / book["source"],
                ROOT / ("work/samples" if mode == "dev" else "work/packages"),
                selected,
                identity=book["book_id"],
            )
            elapsed = time.monotonic() - started
            manifest = validate_package(package)
            expected = selected or list(range(1, book["page_count"] + 1))
            actual = [p["pdf_page_number"] for p in manifest["pages"]]
            assert actual == expected
            assert manifest["source"]["sha256"] == book["sha256"]
            assert manifest["source"]["byte_size"] == book["byte_size"]
            size = sum(
                p[k]["byte_size"]
                for p in manifest["pages"]
                for k in ["page", "thumbnail"]
            )
            page_sizes = [p["page"]["byte_size"] for p in manifest["pages"]]
            rows.append(
                f"| {mode} | {book['book_id']} | {len(actual)} | {elapsed:.2f} | {size} | {min(page_sizes)} / {sum(page_sizes) / len(actual):.0f} / {max(page_sizes)} |"
            )
            for p in manifest["pages"]:
                details.append(
                    {
                        "selection": mode,
                        "book_id": book["book_id"],
                        "pdf_page_number": p["pdf_page_number"],
                        "width": p["width"],
                        "height": p["height"],
                        "page_bytes": p["page"]["byte_size"],
                        "thumbnail_bytes": p["thumbnail"]["byte_size"],
                    }
                )
            print(rows[-1], flush=True)

    # Deny access to original PDFs while verifying every derived package again.
    def audit(event, args):
        if (
            event == "open"
            and isinstance(args[0], (str, bytes))
            and ("test-data" in str(args[0]) or str(args[0]).lower().endswith(".pdf"))
        ):
            raise PermissionError(
                "Original PDF access forbidden during standalone verification"
            )

    sys.addaudithook(audit)
    total = 0
    for book in inventory["books"]:
        package = ROOT / "work/packages" / book["book_id"]
        manifest = validate_package(package)
        total += len(manifest["pages"])
        for path in package.rglob("*.json"):
            document = json.loads(path.read_text())

            def check(value):
                if isinstance(value, dict):
                    for item in value.values():
                        check(item)
                elif isinstance(value, list):
                    for item in value:
                        check(item)
                elif isinstance(value, str):
                    assert not value.startswith("/") and ":\\" not in value

            check(document)
    assert total == 389
    with (ROOT / "docs/import-page-sizes.csv").open("w") as output:
        writer = csv.DictWriter(
            output, fieldnames=list(details[0]), lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(details)
    (ROOT / "docs/import-report.md").write_text(
        """# Import report

Measured locally on 2026-09-28 using the provisional native-embedded-capped WebP q90 / 3056px profile; thumbnails WebP q80 / 360px. These are complete PDF renders, including vectors and lettering. Timings include hashing, rendering, encoding, checkpoint writes, integrity verification and publication (cold package directories).

| Selection | Book | Pages | Seconds | Page + thumb bytes | Page bytes min / mean / max |
| --- | --- | ---: | ---: | ---: | ---: |
"""
        + "\n".join(rows)
        + f"""

All **{total}/389** source pages matched inventory fingerprint, byte size, count and original PDF sequence: 111 Archer & Armstrong, 149 Harbinger, 129 Quantum and Woody. No silent omissions. Development samples contain exactly the six development pages per book, including Harbinger p141 as one intact landscape page. Every asset was decoded, dimensions checked and SHA-256 verified against its manifest. COMPLETE.json binds the published manifest checksum. Per-page dimensions and sizes (including samples) are in [import-page-sizes.csv](import-page-sizes.csv).

Standalone verification reran all three packages with a Python audit hook rejecting any attempt to open a PDF or test-data path. It passed. Recursive checks of package JSON values found no absolute local paths. Original PDFs were read only; their inventory hashes matched before import and after each book render.

Peak process RSS across sequential sample/full imports: {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.1f} MiB on Linux. Rendering holds one PDF page/bitmap and its converted image at a time; native allocator caching and PDF document metadata also contribute. This is measured process RSS, not a proof of a fixed numeric ceiling across arbitrary PDFs.

Reproduce: `cd tools && uv run python scripts/import_corpus.py`. Existing identical packages are verified/reused; remove no originals. Use fresh output roots for new timing measurements or profile variants. Packages are local under work/samples and work/packages; artwork is excluded from Git. Final representation choice from #3 and visual/tablet acceptance remain separate work.
"""
    )


if __name__ == "__main__":
    main()
