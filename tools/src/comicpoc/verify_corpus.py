"""Corpus verification against inventory.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from PIL import Image

from comicpoc.corpus import fingerprint
from comicpoc.manifest import validate_manifest


def verify_corpus(
    packages_dir: Path,
    inventory_path: Path,
) -> dict[str, Any]:
    inventory_data = json.loads(inventory_path.read_text())
    books_inv = inventory_data.get("books", [])

    results: list[dict[str, Any]] = []
    total_pages_verified = 0
    total_assets_verified = 0
    all_passed = True
    overall_errors: list[str] = []

    for book in books_inv:
        book_id = book["book_id"]
        source_sha = book["sha256"]
        expected_page_count = book["page_count"]
        book_errors: list[str] = []

        package_dir = packages_dir / book_id
        if not package_dir.is_dir():
            book_errors.append(f"Package directory missing: {package_dir}")
            results.append(
                {
                    "book_id": book_id,
                    "status": "FAILED",
                    "errors": book_errors,
                    "pages_verified": 0,
                    "source_sha256": source_sha,
                }
            )
            all_passed = False
            overall_errors.extend(book_errors)
            continue

        manifest_path = package_dir / "manifest.json"
        complete_path = package_dir / "COMPLETE.json"

        if not manifest_path.is_file():
            book_errors.append(f"manifest.json missing in {package_dir}")
        if not complete_path.is_file():
            book_errors.append(f"COMPLETE.json missing in {package_dir}")

        if book_errors:
            results.append(
                {
                    "book_id": book_id,
                    "status": "FAILED",
                    "errors": book_errors,
                    "pages_verified": 0,
                    "source_sha256": source_sha,
                }
            )
            all_passed = False
            overall_errors.extend(book_errors)
            continue

        try:
            manifest = json.loads(manifest_path.read_text())
            validate_manifest(manifest)
        except (ValueError, OSError, RuntimeError, json.JSONDecodeError) as e:
            book_errors.append(f"Manifest validation failed: {e}")

        complete_marker_valid = False
        try:
            marker = json.loads(complete_path.read_text())
            expected_marker = fingerprint(manifest_path)
            if marker == expected_marker:
                complete_marker_valid = True
            else:
                book_errors.append("COMPLETE.json hash does not match manifest.json")
        except (ValueError, OSError, RuntimeError, json.JSONDecodeError) as e:
            book_errors.append(f"COMPLETE.json check failed: {e}")

        # Source sha256 check
        source_sha256_match = manifest.get("source", {}).get("sha256") == source_sha
        if not source_sha256_match:
            book_errors.append(
                f"Source sha256 mismatch: manifest={manifest.get('source', {}).get('sha256')} vs inventory={source_sha}"
            )

        # Page count check
        manifest_pages = manifest.get("pages", [])
        page_count_match = (
            manifest.get("source", {}).get("page_count") == expected_page_count
            and len(manifest_pages) == expected_page_count
            and len(book.get("pages", [])) == expected_page_count
        )
        if not page_count_match:
            book_errors.append(
                f"Page count mismatch: manifest={len(manifest_pages)} vs inventory={expected_page_count}"
            )

        # Every page present exactly once and in sequential order
        expected_page_ids = [
            f"p-{source_sha}-{num:04d}" for num in range(1, expected_page_count + 1)
        ]
        page_order = manifest.get("page_order", [])
        order_match = (
            page_order == expected_page_ids
            and [p["id"] for p in manifest_pages] == expected_page_ids
            and [p["pdf_page_number"] for p in manifest_pages]
            == list(range(1, expected_page_count + 1))
        )
        if not order_match:
            book_errors.append("Page sequence / page_order mismatch or out of order")

        # Per-page asset checks & orientation checks
        inv_pages_by_num = {p["pdf_page_number"]: p for p in book.get("pages", [])}
        assets_valid = True
        orientations_match = True

        page_sizes: list[int] = []
        thumb_sizes: list[int] = []

        for p in manifest_pages:
            num = p["pdf_page_number"]
            inv_p = inv_pages_by_num.get(num)
            if inv_p is None:
                book_errors.append(f"Page {num} not found in inventory")
                assets_valid = False
                continue

            # Orientation check
            w_pt = inv_p["width_points"]
            h_pt = inv_p["height_points"]
            rot = inv_p.get("rotation_degrees", 0)
            if rot in (90, 270):
                w_pt, h_pt = h_pt, w_pt
            src_orient = (
                "landscape" if w_pt > h_pt else "portrait" if w_pt < h_pt else "square"
            )
            manifest_orient = p.get("orientation")

            if manifest_orient != src_orient:
                orientations_match = False
                book_errors.append(
                    f"Page {num} orientation mismatch: {manifest_orient} vs source {src_orient}"
                )

            # Asset checks
            for kind in ["page", "thumbnail"]:
                asset = p.get(kind)
                if not asset:
                    book_errors.append(f"Page {num} missing {kind} record")
                    assets_valid = False
                    continue

                asset_file = package_dir / asset["path"]
                if not asset_file.is_file() or asset_file.is_symlink():
                    book_errors.append(f"Asset file missing or invalid: {asset_file}")
                    assets_valid = False
                    continue

                # Check hash and size
                fp = fingerprint(asset_file)
                if (
                    fp["sha256"] != asset["sha256"]
                    or fp["byte_size"] != asset["byte_size"]
                ):
                    book_errors.append(f"Asset hash/size mismatch: {asset['path']}")
                    assets_valid = False
                    continue

                if kind == "page":
                    page_sizes.append(asset["byte_size"])
                else:
                    thumb_sizes.append(asset["byte_size"])

                # Decodable check
                try:
                    with Image.open(asset_file) as img:
                        img.load()
                        if img.size != (asset["width"], asset["height"]):
                            book_errors.append(
                                f"Decoded asset dimensions {img.size} mismatch record {asset['width']}x{asset['height']}: {asset['path']}"
                            )
                            assets_valid = False
                except (ValueError, OSError, RuntimeError) as e:
                    book_errors.append(
                        f"Asset decodability check failed for {asset['path']}: {e}"
                    )
                    assets_valid = False

        pages_count = len(manifest_pages)
        total_pages_verified += pages_count
        total_assets_verified += len(page_sizes) + len(thumb_sizes)

        status = "PASSED" if not book_errors else "FAILED"
        if status == "FAILED":
            all_passed = False
            overall_errors.extend(book_errors)

        results.append(
            {
                "book_id": book_id,
                "title": manifest.get("book", {}).get("title", book_id),
                "source_sha256": source_sha,
                "page_count": pages_count,
                "status": status,
                "source_sha256_match": source_sha256_match,
                "page_count_match": page_count_match,
                "order_match": order_match,
                "complete_marker_valid": complete_marker_valid,
                "orientations_match": orientations_match,
                "assets_valid": assets_valid,
                "page_bytes_total": sum(page_sizes),
                "page_bytes_min": min(page_sizes) if page_sizes else 0,
                "page_bytes_mean": (
                    sum(page_sizes) // len(page_sizes) if page_sizes else 0
                ),
                "page_bytes_max": max(page_sizes) if page_sizes else 0,
                "thumb_bytes_total": sum(thumb_sizes),
                "total_bytes": sum(page_sizes) + sum(thumb_sizes),
                "errors": book_errors,
            }
        )

    summary = {
        "passed": all_passed,
        "total_books": len(books_inv),
        "total_pages_verified": total_pages_verified,
        "total_assets_verified": total_assets_verified,
        "books": results,
        "errors": overall_errors,
    }
    return summary


def format_verification_markdown(report: dict[str, Any]) -> str:
    lines = [
        "## Corpus Verification Summary",
        "",
        f"Overall result: **{'PASSED' if report['passed'] else 'FAILED'}**  ",
        f"Total books: {report['total_books']} | Total pages: {report['total_pages_verified']} | Total assets decoded: {report['total_assets_verified']}",
        "",
        "| Book ID | Pages | Source SHA256 Match | Order Contiguous | Orientations | Assets Decodable & Hash-Match | COMPLETE Marker | Status |",
        "| --- | ---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    ]
    for b in report["books"]:
        sha_str = "✓" if b.get("source_sha256_match") else "✗"
        order_str = "✓" if b.get("order_match") else "✗"
        orient_str = "✓" if b.get("orientations_match") else "✗"
        assets_str = "✓" if b.get("assets_valid") else "✗"
        marker_str = "✓" if b.get("complete_marker_valid") else "✗"
        status_str = f"**{b['status']}**"
        lines.append(
            f"| `{b['book_id']}` | {b.get('page_count', 0)} | {sha_str} | {order_str} | {orient_str} | {assets_str} | {marker_str} | {status_str} |"
        )
    lines.append("")
    if report["errors"]:
        lines.append("### Failures / Discrepancies")
        lines.append("")
        for err in report["errors"]:
            lines.append(f"- {err}")
        lines.append("")
    else:
        lines.append(
            f"All {report['total_pages_verified']} pages across {report['total_books']} packages verified without silent omissions, corruption, or geometry discrepancies."
        )
        lines.append("")
    return "\n".join(lines)
