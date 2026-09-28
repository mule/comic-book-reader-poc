import copy
import json

import pypdfium2 as pdfium
import pytest
from PIL import Image

from comicpoc import importer
from comicpoc.manifest import (
    effective_regions,
    validate_annotations,
    validate_manifest,
    validate_package,
)


@pytest.fixture
def source(tmp_path, monkeypatch):
    monkeypatch.setattr(importer, "ROOT", tmp_path)
    path = tmp_path / "synthetic.pdf"
    images = [Image.new("RGB", (100, 160), color) for color in ["red", "green", "blue"]]
    images[0].save(path, save_all=True, append_images=images[1:])
    return path


def test_order_rotation_standalone(source):
    rotated = source.with_name("rotated.pdf")
    with pdfium.PdfDocument(source) as doc:
        page = doc[1]
        page.set_rotation(90)
        page.close()
        doc.save(rotated)
    package = importer.import_pdf(rotated, pages=[2, 1])
    source.unlink()
    rotated.unlink()
    manifest = validate_package(package)
    assert manifest["selection"] == "sample"
    assert [p["pdf_page_number"] for p in manifest["pages"]] == [2, 1]
    assert manifest["page_order"] == [p["id"] for p in manifest["pages"]]
    assert manifest["pages"][0]["orientation"] == "landscape"
    assert manifest["pages"][0]["rotation_degrees"] == 90
    assert not any(
        str(package.parent.parent.parent) in f.read_text()
        for f in package.rglob("*.json")
    )


def test_failure_resume_and_identity(source, monkeypatch):
    render = importer.render_page
    calls = []

    def fail(doc, number, *args):
        calls.append(number)
        if number == 2:
            raise RuntimeError("simulated page failure")
        return render(doc, number, *args)

    monkeypatch.setattr(importer, "render_page", fail)
    with pytest.raises(RuntimeError, match="1 page"):
        importer.import_pdf(source)
    root = source.parent / "work/packages"
    assert not (root / "synthetic").exists()
    stage = root / ".synthetic.staging"
    assert not (stage / "COMPLETE.json").exists()
    assert (
        json.loads((stage / "errors.json").read_text())["errors"][0]["pdf_page_number"]
        == 2
    )
    first = (stage / "checkpoints/1.json").read_bytes()
    calls.clear()

    def resume(doc, number, *args):
        calls.append(number)
        return render(doc, number, *args)

    monkeypatch.setattr(importer, "render_page", resume)
    package = importer.import_pdf(source)
    assert calls == [2]
    assert (package / "checkpoints/1.json").read_bytes() == first
    manifest = validate_package(package)
    annotation = package / "manual.annotations.json"
    annotation.write_text("curated bytes")
    assert importer.import_pdf(source) == package
    assert annotation.read_text() == "curated bytes"
    assert validate_package(package)["page_order"] == manifest["page_order"]
    with pytest.raises(ValueError, match="differs"):
        importer.import_pdf(source, profile=importer.RenderProfile(quality=85))
    alternate = importer.import_pdf(
        source,
        output=source.parent / "work/alternate",
        profile=importer.RenderProfile(quality=85),
    )
    assert validate_package(alternate)["page_order"] == manifest["page_order"]
    assert (
        validate_package(alternate)["render_profile"]["id"]
        != manifest["render_profile"]["id"]
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "version",
        "duplicate",
        "order",
        "absolute",
        "traversal",
        "bounds",
        "profile",
        "missing",
    ],
)
def test_invalid_manifest(source, mutation):
    manifest = validate_package(importer.import_pdf(source))
    page = manifest["pages"][0]
    if mutation == "version":
        manifest["schema_version"] = 2
    if mutation == "duplicate":
        manifest["pages"][1]["id"] = page["id"]
    if mutation == "order":
        manifest["page_order"] = ["unknown"]
    if mutation == "absolute":
        page["page"]["path"] = "/tmp/page.webp"
    if mutation == "traversal":
        page["page"]["path"] = "pages/../page.webp"
    if mutation == "profile":
        manifest["render_profile"]["quality"] = 84
    if mutation == "missing":
        manifest["pages"].pop()
        manifest["page_order"].pop()
    if mutation == "bounds":
        page["suggestions"] = {
            "detector": {
                "name": "synthetic",
                "version": "1",
                "configuration": {},
                "run_id": "one",
            },
            "regions": [{"id": "r1", "x": 0.9, "y": 0, "width": 0.2, "height": 1}],
            "order": ["r1"],
        }
    with pytest.raises(ValueError):
        validate_manifest(manifest)


def test_annotation_merge_and_binding(source):
    manifest = validate_package(importer.import_pdf(source))
    page = manifest["pages"][0]
    region = {"id": "r1", "x": 0, "y": 0, "width": 1, "height": 1}
    page["suggestions"] = {
        "detector": {
            "name": "synthetic",
            "version": "1",
            "configuration": {},
            "run_id": "one",
        },
        "regions": [region],
        "order": ["r1"],
    }
    added = {**region, "id": "manual-1", "width": 0.5}
    override = {
        "page_id": page["id"],
        "pdf_page_number": 1,
        "added_regions": [added],
        "edited_regions": [],
        "deleted_region_ids": ["r1"],
        "order": ["manual-1"],
    }
    annotations = {
        "schema_version": 1,
        "book_id": manifest["book"]["id"],
        "source_sha256": manifest["source"]["sha256"],
        "pages": [override],
    }
    validate_annotations(annotations, manifest)
    assert effective_regions(page, override) == [added]
    assert effective_regions(manifest["pages"][1]) == []
    page["suggestions"]["detector"]["run_id"] = "rerun"
    validate_annotations(annotations, manifest)
    assert effective_regions(page, override) == [added]
    bad = copy.deepcopy(annotations)
    bad["source_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="mismatch"):
        validate_annotations(bad, manifest)
    bad = copy.deepcopy(annotations)
    bad["pages"][0]["order"] = ["missing"]
    with pytest.raises(ValueError):
        validate_annotations(bad, manifest)


def test_corrupt_checkpoint_is_rendered_again(source, monkeypatch):
    render = importer.render_page

    def interrupt(doc, number, *args):
        if number == 2:
            raise KeyboardInterrupt
        return render(doc, number, *args)

    monkeypatch.setattr(importer, "render_page", interrupt)
    with pytest.raises(KeyboardInterrupt):
        importer.import_pdf(source)
    stage = source.parent / "work/packages/.synthetic.staging"
    next((stage / "pages").iterdir()).write_bytes(b"broken")
    monkeypatch.setattr(importer, "render_page", render)
    validate_package(importer.import_pdf(source))


def test_replacement_source_and_missing_asset(source):
    package = importer.import_pdf(source)
    old = validate_package(package)
    Image.new("RGB", (80, 80), "white").save(source)
    with pytest.raises(ValueError, match="differs"):
        importer.import_pdf(source)
    other = importer.import_pdf(source, output=source.parent / "work/replacement")
    assert set(old["page_order"]).isdisjoint(validate_package(other)["page_order"])
    (other / validate_package(other)["pages"][0]["page"]["path"]).unlink()
    with pytest.raises(OSError):
        validate_package(other)


def test_nonfinite_regions_and_schema_documents(source):
    from jsonschema import Draft202012Validator

    from comicpoc.corpus import ROOT
    from comicpoc.manifest import regions_valid

    for name in ["manifest", "annotations"]:
        Draft202012Validator.check_schema(
            json.loads((ROOT / "format" / f"{name}.schema.json").read_text())
        )
    for value in [float("nan"), float("inf"), float("-inf")]:
        with pytest.raises(ValueError):
            regions_valid(
                [{"id": "r1", "x": value, "y": 0, "width": 0.5, "height": 0.5}]
            )


def test_invalid_profile_does_not_create_package(source):
    with pytest.raises(ValueError, match="Invalid render profile"):
        importer.import_pdf(source, profile=importer.RenderProfile(long_edge_px=0))
    assert not (source.parent / "work/packages").exists()
