import json
import subprocess
import sys
from contextlib import closing

import pypdfium2 as pdfium
import pytest
from PIL import Image, ImageDraw

from comicpoc.corpus import ROOT, check_inventory, inventory
from comicpoc.preview import contact_sheets


@pytest.fixture
def synthetic(tmp_path):
    source = tmp_path / "sources"
    source.mkdir()
    path = source / "Panels.pdf"
    picture = Image.new("RGB", (240, 360), "white")
    draw = ImageDraw.Draw(picture)
    draw.rectangle((10, 10, 110, 170), outline="black", width=3)
    draw.rectangle((130, 10, 230, 170), outline="black", width=3)
    draw.text((20, 30), "Synthetic lettering", fill="black")
    picture.save(path, "PDF", resolution=72, save_all=True, append_images=[picture])
    rotated = source / "Rotated.pdf"
    with pdfium.PdfDocument(path) as document:
        with closing(document[1]) as page:
            page.set_rotation(90)
        document.save(rotated)
    return source


def test_inventory_geometry_and_composition(synthetic):
    result = inventory(synthetic)
    assert result == inventory(synthetic)
    normal, rotated = result["books"]
    assert normal["page_count"] == 2
    assert normal["byte_size"] > 0
    assert len(normal["sha256"]) == 64
    assert normal["encrypted"] is False
    assert normal["pages"][0] == {
        "pdf_page_number": 1,
        "width_points": 240.0,
        "height_points": 360.0,
        "rotation_degrees": 0,
        "embedded_image_count": 1,
        "largest_image_pixels": [240, 360],
        "has_text_objects": False,  # Raster lettering is not a PDF text object.
    }
    assert rotated["pages"][1]["rotation_degrees"] == 90
    assert rotated["pages"][1]["width_points"] == 360
    assert rotated["pages"][1]["height_points"] == 240


def test_cli_detects_changes_missing_and_added(synthetic, tmp_path):
    output = tmp_path / "inventory.json"
    command = [
        sys.executable,
        "-m",
        "comicpoc",
        "inventory",
        "--sources",
        str(synthetic),
        "--output",
        str(output),
    ]
    assert subprocess.run(command, check=False, capture_output=True).returncode == 0
    before = output.read_bytes()
    assert (
        subprocess.run(
            command + ["--check"], check=False, capture_output=True
        ).returncode
        == 0
    )
    (synthetic / "Panels.pdf").write_bytes(b"changed")
    (synthetic / "Rotated.pdf").unlink()
    (synthetic / "Added.PDF").write_bytes(b"new")
    checked = subprocess.run(
        command + ["--check"], check=False, capture_output=True, text=True
    )
    assert checked.returncode == 1
    for message in ["changed: Panels.pdf", "missing: Rotated.pdf", "added: Added.PDF"]:
        assert message in checked.stderr
    assert output.read_bytes() == before


def test_absent_sources_name_missing_books(synthetic, tmp_path):
    result = inventory(synthetic)
    assert check_inventory(tmp_path / "absent", result) == [
        "missing: Panels.pdf",
        "missing: Rotated.pdf",
    ]
    with pytest.raises(ValueError, match="missing"):
        inventory(tmp_path / "absent")


def test_preview(synthetic, tmp_path, monkeypatch):
    from comicpoc import preview

    monkeypatch.setattr(preview, "ROOT", tmp_path)
    output = tmp_path / "work/previews"
    sheets = contact_sheets(synthetic / "Rotated.pdf", output, [2])
    assert len(sheets) == 1
    with Image.open(output / "rotated-p002.jpg") as rendered:
        assert rendered.width == 1000
        assert rendered.height < rendered.width
    with pytest.raises(ValueError, match="work/"):
        contact_sheets(synthetic / "Panels.pdf", tmp_path / "unsafe", [1])
    with pytest.raises(ValueError, match="between"):
        contact_sheets(synthetic / "Panels.pdf", output, [0])


def test_evaluation_split():
    books = {
        b["book_id"]: b
        for b in json.loads((ROOT / "corpus/inventory.json").read_text())["books"]
    }
    pages = json.loads((ROOT / "corpus/evaluation-split.json").read_text())["pages"]
    assert len(pages) == 30
    assert len({(p["book_id"], p["pdf_page_number"]) for p in pages}) == 30
    for book_id, book in books.items():
        selected = [p for p in pages if p["book_id"] == book_id]
        assert len(selected) == 10
        assert sum(p["split"] == "dev" for p in selected) == 6
        assert sum(p["split"] == "heldout" for p in selected) == 4
        for page in selected:
            assert 1 <= page["pdf_page_number"] <= book["page_count"]
            assert page["layout_tags"] and page["rationale"]


@pytest.mark.corpus
@pytest.mark.skipif(
    not (ROOT / "test-data").is_dir(), reason="Local purchased test-data/ absent"
)
def test_real_corpus():
    recorded = json.loads((ROOT / "corpus/inventory.json").read_text())
    assert not check_inventory(ROOT / "test-data", recorded)
    assert inventory(ROOT / "test-data") == recorded
    assert sum(b["page_count"] for b in recorded["books"]) == 389


def test_vector_text_and_empty_page(tmp_path):
    import ctypes

    path = tmp_path / "Vector.pdf"
    with pdfium.PdfDocument.new() as document:
        with closing(document.new_page(200, 300)) as page:
            text = pdfium.raw.FPDFPageObj_NewTextObj(document, b"Helvetica", 12)
            assert text
            encoded = "Synthetic text\0".encode("utf-16-le")
            buffer = (ctypes.c_ushort * (len(encoded) // 2)).from_buffer_copy(encoded)
            assert pdfium.raw.FPDFText_SetText(text, buffer)
            page.insert_obj(pdfium.PdfObject(text, pdf=document))
            page.gen_content()
        with closing(document.new_page(100, 100)):
            pass
        document.save(path)
    pages = inventory(tmp_path)["books"][0]["pages"]
    assert pages[0]["has_text_objects"] is True
    assert pages[0]["embedded_image_count"] == 0
    assert pages[0]["largest_image_pixels"] is None
    assert pages[1]["has_text_objects"] is False
    assert pages[1]["embedded_image_count"] == 0
