"""Synthetic tests for comicpoc verify-corpus."""

import json
from pathlib import Path

import pytest
from PIL import Image

from comicpoc import importer
from comicpoc.importer import RenderProfile, import_pdf
from comicpoc.verify_corpus import format_verification_markdown, verify_corpus


def create_synthetic_pdf(path: Path, pages_info: list[tuple[int, int, str]]) -> Path:
    images = [Image.new("RGB", (w, h), color) for w, h, color in pages_info]
    images[0].save(path, save_all=True, append_images=images[1:])
    return path


@pytest.fixture
def test_env(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(importer, "ROOT", tmp_path)
    (tmp_path / "work").mkdir(parents=True, exist_ok=True)
    return tmp_path


def test_verify_corpus_synthetic_success(test_env: Path):
    pdf_path = test_env / "book1.pdf"
    create_synthetic_pdf(
        pdf_path,
        [
            (100, 150, "red"),  # portrait
            (150, 100, "blue"),  # landscape
        ],
    )
    packages_dir = test_env / "work/packages"
    packages_dir.mkdir(parents=True, exist_ok=True)

    package = import_pdf(
        pdf_path,
        packages_dir,
        identity="test-book",
        profile=RenderProfile(long_edge_px=200, quality=80),
    )

    manifest = json.loads((package / "manifest.json").read_text())
    source_sha = manifest["source"]["sha256"]

    # Construct synthetic inventory
    inventory = {
        "schema_version": 1,
        "books": [
            {
                "book_id": "test-book",
                "source": "book1.pdf",
                "sha256": source_sha,
                "byte_size": pdf_path.stat().st_size,
                "page_count": 2,
                "encrypted": False,
                "pages": [
                    {
                        "pdf_page_number": 1,
                        "width_points": 100.0,
                        "height_points": 150.0,
                        "rotation_degrees": 0,
                    },
                    {
                        "pdf_page_number": 2,
                        "width_points": 150.0,
                        "height_points": 100.0,
                        "rotation_degrees": 0,
                    },
                ],
            }
        ],
    }
    inv_path = test_env / "inventory.json"
    inv_path.write_text(json.dumps(inventory))

    report = verify_corpus(packages_dir, inv_path)
    assert report["passed"] is True
    assert report["total_books"] == 1
    assert report["total_pages_verified"] == 2
    assert report["total_assets_verified"] == 4
    assert len(report["errors"]) == 0

    md = format_verification_markdown(report)
    assert "Overall result: **PASSED**" in md
    assert "`test-book`" in md


def test_verify_corpus_detects_corrupt_asset(test_env: Path):
    pdf_path = test_env / "book2.pdf"
    create_synthetic_pdf(pdf_path, [(100, 150, "green")])
    packages_dir = test_env / "work/packages"
    packages_dir.mkdir(parents=True, exist_ok=True)

    package = import_pdf(
        pdf_path,
        packages_dir,
        identity="test-book-corrupt",
        profile=RenderProfile(long_edge_px=200, quality=80),
    )

    manifest = json.loads((package / "manifest.json").read_text())
    page_asset_rel = manifest["pages"][0]["page"]["path"]
    asset_file = package / page_asset_rel
    # Tamper with asset file
    asset_file.write_bytes(b"not an image anymore")

    inventory = {
        "schema_version": 1,
        "books": [
            {
                "book_id": "test-book-corrupt",
                "source": "book2.pdf",
                "sha256": manifest["source"]["sha256"],
                "byte_size": pdf_path.stat().st_size,
                "page_count": 1,
                "encrypted": False,
                "pages": [
                    {
                        "pdf_page_number": 1,
                        "width_points": 100.0,
                        "height_points": 150.0,
                        "rotation_degrees": 0,
                    }
                ],
            }
        ],
    }
    inv_path = test_env / "inventory.json"
    inv_path.write_text(json.dumps(inventory))

    report = verify_corpus(packages_dir, inv_path)
    assert report["passed"] is False
    assert any("mismatch" in e or "check failed" in e for e in report["errors"])


def test_verify_corpus_detects_orientation_mismatch(test_env: Path):
    pdf_path = test_env / "book3.pdf"
    create_synthetic_pdf(pdf_path, [(100, 150, "yellow")])  # portrait
    packages_dir = test_env / "work/packages"
    packages_dir.mkdir(parents=True, exist_ok=True)

    package = import_pdf(
        pdf_path,
        packages_dir,
        identity="test-book-orient",
        profile=RenderProfile(long_edge_px=200, quality=80),
    )

    manifest = json.loads((package / "manifest.json").read_text())

    # Inventory claims landscape (w=200 > h=100)
    inventory = {
        "schema_version": 1,
        "books": [
            {
                "book_id": "test-book-orient",
                "source": "book3.pdf",
                "sha256": manifest["source"]["sha256"],
                "byte_size": pdf_path.stat().st_size,
                "page_count": 1,
                "encrypted": False,
                "pages": [
                    {
                        "pdf_page_number": 1,
                        "width_points": 200.0,
                        "height_points": 100.0,
                        "rotation_degrees": 0,
                    }
                ],
            }
        ],
    }
    inv_path = test_env / "inventory.json"
    inv_path.write_text(json.dumps(inventory))

    report = verify_corpus(packages_dir, inv_path)
    assert report["passed"] is False
    assert any("orientation mismatch" in e for e in report["errors"])
