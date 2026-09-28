"""Synthetic unit tests for comicpoc.representation; no real artwork in CI."""

import json
import sys
from contextlib import closing
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
import pytest
from PIL import Image, ImageDraw

from comicpoc.representation import (
    CandidateProfile,
    build_page_candidates,
    build_thumbnail_candidates,
    compare_panel_crops_vs_full_page,
    compute_psnr,
    encode_image,
    evaluate_direct_extraction,
    format_benchmark_table,
    format_extraction_table,
    measure_page,
    render_page_at_long_edge,
    run_benchmark,
)


@pytest.fixture
def synthetic_pdf(tmp_path) -> Path:
    """Create a synthetic two-page PDF with raster and vector content."""
    pdf_path = tmp_path / "SyntheticBook.pdf"
    # Page 1: 300x450 pure raster covering page exactly
    img = Image.new("RGB", (300, 450), color="#ffffff")
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 20, 140, 200], fill="#ff0000", outline="#000000")
    draw.rectangle([160, 20, 280, 200], fill="#0000ff", outline="#000000")
    draw.rectangle([20, 220, 280, 430], fill="#00ff00", outline="#000000")

    # Save as PDF with exact resolution
    img.save(pdf_path, "PDF", resolution=72)
    return pdf_path


@pytest.fixture
def synthetic_env(tmp_path, monkeypatch):
    """Set up complete synthetic corpus environment for CLI testing."""
    sources_dir = tmp_path / "sources"
    sources_dir.mkdir()
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    corpus_dir = tmp_path / "corpus"
    corpus_dir.mkdir()

    # Monkeypatch representation ROOT
    from comicpoc import representation

    monkeypatch.setattr(representation, "ROOT", tmp_path)

    # Create synthetic PDF
    pdf_path = sources_dir / "TestBook.pdf"
    img = Image.new("RGB", (300, 450), color="#ffffff")
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 20, 280, 200], fill="#ff8800")
    draw.rectangle([20, 220, 280, 430], fill="#0088ff")
    img.save(pdf_path, "PDF", resolution=72)

    # Create minimal inventory.json
    inv = {
        "schema_version": 1,
        "books": [
            {
                "book_id": "test-book",
                "source": "TestBook.pdf",
                "sha256": "fakehash",
                "byte_size": pdf_path.stat().st_size,
                "page_count": 1,
                "encrypted": False,
                "pages": [
                    {
                        "pdf_page_number": 1,
                        "width_points": 300.0,
                        "height_points": 450.0,
                        "rotation_degrees": 0,
                        "embedded_image_count": 1,
                        "largest_image_pixels": [300, 450],
                        "has_text_objects": False,
                    }
                ],
            }
        ],
    }
    inv_file = corpus_dir / "inventory.json"
    inv_file.write_text(json.dumps(inv))

    # Create minimal evaluation-split.json
    eval_split = {
        "schema_version": 1,
        "page_numbering": "one-based PDF order",
        "pages": [
            {
                "book_id": "test-book",
                "pdf_page_number": 1,
                "layout_tags": ["grid"],
                "rationale": "Synthetic dev page",
                "split": "dev",
            }
        ],
    }
    eval_file = corpus_dir / "evaluation-split.json"
    eval_file.write_text(json.dumps(eval_split))

    return {
        "sources_dir": sources_dir,
        "work_dir": work_dir,
        "corpus_dir": corpus_dir,
        "inv_file": inv_file,
        "eval_file": eval_file,
    }


def test_candidate_profiles():
    page_cands = build_page_candidates([1000, 2000])
    assert len(page_cands) == 12  # 2 resolutions * 6 formats
    names = [c.name for c in page_cands]
    assert "png-1000" in names
    assert "webp-lossless-1000" in names
    assert "webp-q85-2000" in names
    assert "jpeg-q90-2000" in names

    thumb_cands = build_thumbnail_candidates([240])
    assert len(thumb_cands) == 4
    assert all(c.is_thumbnail for c in thumb_cands)


def test_compute_psnr_identical():
    img1 = Image.new("RGB", (100, 100), color="blue")
    img2 = Image.new("RGB", (100, 100), color="blue")
    psnr, mse = compute_psnr(img1, img2)
    assert not np.isfinite(psnr)
    assert mse == 0.0


def test_compute_psnr_noisy_and_resampled():
    img1 = Image.new("RGB", (100, 100), color=(100, 100, 100))
    img2 = Image.new("RGB", (100, 100), color=(105, 100, 100))
    psnr, mse = compute_psnr(img1, img2)
    assert np.isfinite(psnr)
    assert mse > 0.0
    assert 30.0 < psnr < 50.0

    # Test with different dimensions
    img_smaller = Image.new("RGB", (50, 50), color=(105, 100, 100))
    psnr_scaled, mse_scaled = compute_psnr(img1, img_smaller)
    assert np.isfinite(psnr_scaled)
    assert mse_scaled > 0.0


def test_render_and_encode(synthetic_pdf):
    with pdfium.PdfDocument(synthetic_pdf) as doc:
        page = doc[0]
        rendered = render_page_at_long_edge(page, 600)
        assert max(rendered.size) == 600

        # Encode PNG
        p_png = CandidateProfile("test-png", 600, "PNG", lossless=True)
        b_png = encode_image(rendered, p_png)
        assert b_png.startswith(b"\x89PNG")

        # Encode WEBP Lossless
        p_wl = CandidateProfile("test-wl", 600, "WEBP", lossless=True)
        b_wl = encode_image(rendered, p_wl)
        assert b_wl.startswith(b"RIFF")
        assert b"WEBP" in b_wl[:16]

        # Encode WEBP Lossy
        p_w85 = CandidateProfile("test-w85", 600, "WEBP", quality=85)
        b_w85 = encode_image(rendered, p_w85)
        assert b_w85.startswith(b"RIFF")

        # Encode JPEG
        p_jpg = CandidateProfile("test-jpg", 600, "JPEG", quality=90)
        b_jpg = encode_image(rendered, p_jpg)
        assert b_jpg.startswith(b"\xff\xd8")


def test_measure_page_synthetic(synthetic_pdf):
    with pdfium.PdfDocument(synthetic_pdf) as doc:
        page = doc[0]
        cands = [
            CandidateProfile("png-300", 300, "PNG", lossless=True),
            CandidateProfile("webp-85-300", 300, "WEBP", quality=85),
            CandidateProfile("thumb-200", 200, "WEBP", quality=80, is_thumbnail=True),
        ]
        results = measure_page(page, cands, native_long_edge=300)
        assert len(results) == 3
        png_res = next(r for r in results if r.candidate_name == "png-300")
        assert png_res.byte_size > 0
        assert png_res.total_time_s >= 0.0
        assert not np.isfinite(png_res.psnr_db)  # Reference match is lossless

        webp_res = next(r for r in results if r.candidate_name == "webp-85-300")
        assert webp_res.byte_size < png_res.byte_size


def test_evaluate_direct_extraction_qualifying_and_disqualifying(tmp_path):
    # 1. Page with exactly 1 image covering full page box with no text/vector/bleed
    img = Image.new("RGB", (200, 300), color="white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([10, 10, 190, 290], fill="red")
    path_good = tmp_path / "Good.pdf"
    img.save(path_good, "PDF", resolution=72)

    with pdfium.PdfDocument(path_good) as doc:
        page = doc[0]
        res = evaluate_direct_extraction(page)
        # Note: Pillow's default PDF output puts 1 image on 1 page covering the page box
        assert res["image_count"] == 1
        assert res["text_count"] == 0
        assert res["path_count"] == 0

    # 2. Page with text object
    import ctypes

    path_text = tmp_path / "WithText.pdf"
    with pdfium.PdfDocument.new() as doc:
        with closing(doc.new_page(200, 300)) as p:
            text = pdfium.raw.FPDFPageObj_NewTextObj(doc, b"Helvetica", 12)
            encoded = "Synthetic text\0".encode("utf-16-le")
            buf = (ctypes.c_ushort * (len(encoded) // 2)).from_buffer_copy(encoded)
            pdfium.raw.FPDFText_SetText(text, buf)
            p.insert_obj(pdfium.PdfObject(text, pdf=doc))
            p.gen_content()
        doc.save(path_text)

    with pdfium.PdfDocument(path_text) as doc:
        page = doc[0]
        res = evaluate_direct_extraction(page)
        assert res["qualifies"] is False
        assert "text" in res["reason"].lower() or "expected" in res["reason"].lower()


def test_panel_crop_assessment(synthetic_pdf):
    with pdfium.PdfDocument(synthetic_pdf) as doc:
        page = doc[0]
        panel_boxes = [
            (0.0, 0.0, 1.0, 0.5),
            (0.0, 0.5, 1.0, 1.0),
        ]
        res = compare_panel_crops_vs_full_page(page, panel_boxes, long_edge=400)
        assert res["panel_count"] == 2
        assert res["full_page_bytes"] > 0
        assert res["crops_total_bytes"] > 0
        assert res["ratio_crops_to_full"] > 0.5


def test_benchmark_runner_and_cli(synthetic_env):
    output_dir = synthetic_env["work_dir"] / "test_rep"
    results = run_benchmark(
        sources_dir=synthetic_env["sources_dir"],
        eval_split_path=synthetic_env["eval_file"],
        inventory_path=synthetic_env["inv_file"],
        output_dir=output_dir,
        generate_visuals=False,
        evaluate_extraction_audit=True,
        page_resolutions=[600],
        thumbnail_resolutions=[150],
    )
    assert results["dev_page_count"] == 1
    assert len(results["candidates_summary"]) > 0
    assert (output_dir / "benchmark-results.json").is_file()

    # Test table formatting
    tbl = format_benchmark_table(results)
    assert "| Candidate | Res (px) |" in tbl
    assert "png-600" in tbl

    ext_tbl = format_extraction_table(results)
    assert "| Book ID | Page |" in ext_tbl


def test_work_directory_guard(synthetic_env, tmp_path):
    unsafe_dir = tmp_path / "unsafe_outside_work"
    with pytest.raises(ValueError, match="work/"):
        run_benchmark(
            sources_dir=synthetic_env["sources_dir"],
            eval_split_path=synthetic_env["eval_file"],
            inventory_path=synthetic_env["inv_file"],
            output_dir=unsafe_dir,
            generate_visuals=False,
        )


def test_cli_subcommand_execution(synthetic_env, monkeypatch):
    from comicpoc import cli, representation

    repo_root = synthetic_env["work_dir"].parent
    monkeypatch.setattr(representation, "ROOT", repo_root)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "comicpoc",
            "compare-representations",
            "--sources",
            str(synthetic_env["sources_dir"]),
            "--eval-split",
            str(synthetic_env["eval_file"]),
            "--inventory",
            str(synthetic_env["inv_file"]),
            "--output",
            str(synthetic_env["work_dir"] / "cli_rep"),
            "--no-visuals",
        ],
    )
    assert cli.main() == 0
    assert (synthetic_env["work_dir"] / "cli_rep/benchmark-results.json").is_file()
