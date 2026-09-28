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
    analyze_corpus_raster_distribution,
    build_page_candidates,
    build_thumbnail_candidates,
    compare_panel_crops_vs_full_page,
    compute_psnr,
    encode_image,
    evaluate_direct_extraction,
    format_benchmark_table,
    format_corpus_raster_distribution_table,
    format_dev_pages_raster_table,
    format_extraction_table,
    measure_page,
    render_page_at_long_edge,
    run_benchmark,
)


@pytest.fixture
def synthetic_pdf(tmp_path) -> Path:
    """Create a fast, tiny synthetic PDF with raster content."""
    pdf_path = tmp_path / "SyntheticBook.pdf"
    img = Image.new("RGB", (40, 60), color="#ffffff")
    draw = ImageDraw.Draw(img)
    draw.rectangle([5, 5, 20, 25], fill="#ff0000", outline="#000000")
    draw.rectangle([25, 5, 35, 25], fill="#0000ff", outline="#000000")
    draw.rectangle([5, 30, 35, 55], fill="#00ff00", outline="#000000")
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

    from comicpoc import representation

    monkeypatch.setattr(representation, "ROOT", tmp_path)

    # Create tiny synthetic PDF
    pdf_path = sources_dir / "TestBook.pdf"
    img = Image.new("RGB", (40, 60), color="#ffffff")
    draw = ImageDraw.Draw(img)
    draw.rectangle([5, 5, 35, 25], fill="#ff8800")
    draw.rectangle([5, 30, 35, 55], fill="#0088ff")
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
                        "width_points": 40.0,
                        "height_points": 60.0,
                        "rotation_degrees": 0,
                        "embedded_image_count": 1,
                        "largest_image_pixels": [40, 60],
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
    assert len(page_cands) == 13  # 1 native-raster + 2 resolutions * 6 formats
    names = [c.name for c in page_cands]
    assert "webp-q85-native-raster" in names
    assert "png-1000" in names
    assert "webp-lossless-1000" in names
    assert "webp-q85-2000" in names
    assert "jpeg-q90-2000" in names

    cands_no_native = build_page_candidates([1000, 2000], include_native_raster=False)
    assert len(cands_no_native) == 12

    thumb_cands = build_thumbnail_candidates([240])
    assert len(thumb_cands) == 4
    assert all(c.is_thumbnail for c in thumb_cands)


def test_compute_psnr_identical():
    img1 = Image.new("RGB", (20, 20), color="blue")
    img2 = Image.new("RGB", (20, 20), color="blue")
    psnr, mse = compute_psnr(img1, img2)
    assert not np.isfinite(psnr)
    assert mse == 0.0


def test_compute_psnr_noisy_and_resampled():
    img1 = Image.new("RGB", (20, 20), color=(100, 100, 100))
    img2 = Image.new("RGB", (20, 20), color=(105, 100, 100))
    psnr, mse = compute_psnr(img1, img2)
    assert np.isfinite(psnr)
    assert mse > 0.0
    assert 30.0 < psnr < 50.0

    # Test with different dimensions
    img_smaller = Image.new("RGB", (10, 10), color=(105, 100, 100))
    psnr_scaled, mse_scaled = compute_psnr(img1, img_smaller)
    assert np.isfinite(psnr_scaled)
    assert mse_scaled > 0.0


def test_render_and_encode(synthetic_pdf):
    with pdfium.PdfDocument(synthetic_pdf) as doc:
        page = doc[0]
        rendered = render_page_at_long_edge(page, 60)
        assert max(rendered.size) == 60

        # Encode PNG
        p_png = CandidateProfile("test-png", 60, "PNG", lossless=True)
        b_png = encode_image(rendered, p_png)
        assert b_png.startswith(b"\x89PNG")

        # Encode WEBP Lossless
        p_wl = CandidateProfile("test-wl", 60, "WEBP", lossless=True)
        b_wl = encode_image(rendered, p_wl)
        assert b_wl.startswith(b"RIFF")
        assert b"WEBP" in b_wl[:16]

        # Encode WEBP Lossy
        p_w85 = CandidateProfile("test-w85", 60, "WEBP", quality=85)
        b_w85 = encode_image(rendered, p_w85)
        assert b_w85.startswith(b"RIFF")

        # Encode JPEG
        p_jpg = CandidateProfile("test-jpg", 60, "JPEG", quality=90)
        b_jpg = encode_image(rendered, p_jpg)
        assert b_jpg.startswith(b"\xff\xd8")


def test_measure_page_synthetic(synthetic_pdf):
    with pdfium.PdfDocument(synthetic_pdf) as doc:
        page = doc[0]
        cands = [
            CandidateProfile("png-60", 60, "PNG", lossless=True),
            CandidateProfile("webp-85-60", 60, "WEBP", quality=85),
            CandidateProfile(
                "webp-q85-native-raster",
                0,
                "WEBP",
                quality=85,
                is_native_raster=True,
            ),
            CandidateProfile("thumb-30", 30, "WEBP", quality=80, is_thumbnail=True),
        ]
        results = measure_page(page, cands, native_long_edge=60, native_raster_edge=60)
        assert len(results) == 4
        png_res = next(r for r in results if r.candidate_name == "png-60")
        assert png_res.byte_size > 0
        assert png_res.total_time_s >= 0.0
        assert not np.isfinite(png_res.psnr_db)  # Reference match is lossless

        webp_res = next(r for r in results if r.candidate_name == "webp-85-60")
        assert webp_res.byte_size < png_res.byte_size

        native_res = next(
            r for r in results if r.candidate_name == "webp-q85-native-raster"
        )
        assert native_res.is_native_raster is True
        assert native_res.long_edge == 60


def test_evaluate_direct_extraction_qualifying_and_disqualifying(tmp_path):
    # 1. Page with exactly 1 image covering full page box with no text/vector/bleed
    img = Image.new("RGB", (40, 60), color="white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([5, 5, 35, 55], fill="red")
    path_good = tmp_path / "Good.pdf"
    img.save(path_good, "PDF", resolution=72)

    with pdfium.PdfDocument(path_good) as doc:
        page = doc[0]
        res = evaluate_direct_extraction(page)
        assert res["image_count"] == 1
        assert res["text_count"] == 0
        assert res["path_count"] == 0

    # 2. Page with text object
    import ctypes

    path_text = tmp_path / "WithText.pdf"
    with pdfium.PdfDocument.new() as doc:
        with closing(doc.new_page(40, 60)) as p:
            text = pdfium.raw.FPDFPageObj_NewTextObj(doc, b"Helvetica", 10)
            encoded = "Text\0".encode("utf-16-le")
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
        res = compare_panel_crops_vs_full_page(page, panel_boxes, long_edge=60)
        assert res["panel_count"] == 2
        assert res["full_page_bytes"] > 0
        assert res["crops_total_bytes"] > 0
        assert res["ratio_crops_to_full"] > 0.5


def test_corpus_distribution_analysis(tmp_path):
    inv_file = tmp_path / "inv.json"
    inv_data = {
        "books": [
            {
                "book_id": "book-a",
                "pages": [
                    {"pdf_page_number": 1, "largest_image_pixels": [1988, 3056]},
                    {"pdf_page_number": 2, "largest_image_pixels": [999, 1533]},
                    {"pdf_page_number": 3, "largest_image_pixels": [1993, 1534]},
                    {"pdf_page_number": 4, "largest_image_pixels": [300, 500]},
                ],
            }
        ]
    }
    inv_file.write_text(json.dumps(inv_data))
    dist = analyze_corpus_raster_distribution(inv_file)
    assert dist["total_books"] == 1
    assert dist["total_pages"] == 4
    assert dist["corpus_counts"]["covers_3056"] == 1
    assert dist["corpus_counts"]["story_1533"] == 1
    assert dist["corpus_counts"]["spread_1993"] == 1
    assert dist["corpus_counts"]["low_res"] == 1

    tbl = format_corpus_raster_distribution_table(dist)
    assert "| `book-a` | 1 (25.0%) | 1 (25.0%) | 1 | 1 | 4 |" in tbl
    assert "**Corpus Total**" in tbl


def test_benchmark_runner_and_cli(synthetic_env):
    output_dir = synthetic_env["work_dir"] / "test_rep"
    results = run_benchmark(
        sources_dir=synthetic_env["sources_dir"],
        eval_split_path=synthetic_env["eval_file"],
        inventory_path=synthetic_env["inv_file"],
        output_dir=output_dir,
        generate_visuals=False,
        evaluate_extraction_audit=True,
        page_resolutions=[60],
        thumbnail_resolutions=[30],
    )
    assert results["dev_page_count"] == 1
    assert len(results["candidates_summary"]) > 0
    assert "corpus_distribution" in results
    assert "dev_pages_raster_info" in results
    assert (output_dir / "benchmark-results.json").is_file()

    # Test table formatting
    tbl = format_benchmark_table(results)
    assert "| Candidate | Res (px) |" in tbl
    assert "webp-q85-native-raster" in tbl
    assert "png-60" in tbl

    ext_tbl = format_extraction_table(results)
    assert "| Book ID | Page |" in ext_tbl

    dev_tbl = format_dev_pages_raster_table(results["dev_pages_raster_info"])
    assert "| Book ID | PDF Page |" in dev_tbl
    assert "test-book" in dev_tbl


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
            "--page-resolutions",
            "60",
            "--thumbnail-resolutions",
            "30",
            "--no-visuals",
        ],
    )
    assert cli.main() == 0
    assert (synthetic_env["work_dir"] / "cli_rep/benchmark-results.json").is_file()
