"""Synthetic-only detection, immutable publication and reference scoring contracts."""

import copy
import json

import pytest
from PIL import Image, ImageDraw

from comicpoc import detection, importer, publication
from comicpoc.corpus import ROOT, fingerprint
from comicpoc.detection_evaluation import evaluate, score_page
from comicpoc.manifest import effective_regions, validate_annotations, validate_package


def rect(rid, x=0.1, y=0.1, width=0.3, height=0.3):
    return {"id": rid, "x": x, "y": y, "width": width, "height": height}


@pytest.fixture
def config():
    return detection.load_config(ROOT / "corpus/detector-config.json")


@pytest.fixture
def package(tmp_path, monkeypatch):
    monkeypatch.setattr(importer, "ROOT", tmp_path)
    monkeypatch.setattr(publication, "ROOT", tmp_path)
    monkeypatch.setattr(detection, "ROOT", tmp_path)
    image = Image.new("RGB", (400, 600), "white")
    draw = ImageDraw.Draw(image)
    for box in [
        (20, 20, 180, 260),
        (220, 20, 380, 260),
        (20, 300, 180, 560),
        (220, 300, 380, 560),
    ]:
        draw.rectangle(box, fill="#303030", outline="black", width=3)
    source = tmp_path / "synthetic.pdf"
    image.save(source)
    return importer.import_pdf(
        source, profile=importer.RenderProfile(format="png", long_edge_px=600)
    )


def split_for(package, split="dev"):
    m = json.loads((package / "manifest.json").read_text())
    return {
        "pages": [
            {
                "book_id": m["book"]["id"],
                "pdf_page_number": p["pdf_page_number"],
                "split": split,
            }
            for p in m["pages"]
        ]
    }


def annotations(manifest, edited=None, deleted=None):
    page = manifest["pages"][0]
    deleted = deleted or []
    return {
        "schema_version": 1,
        "book_id": manifest["book"]["id"],
        "source_sha256": manifest["source"]["sha256"],
        "pages": [
            {
                "page_id": page["id"],
                "pdf_page_number": page["pdf_page_number"],
                "added_regions": [],
                "edited_regions": edited or [],
                "deleted_region_ids": deleted,
                "order": [
                    r["id"] for r in effective_regions(page) if r["id"] not in deleted
                ],
            }
        ],
    }


def test_real_opencv_grid_and_blank(tmp_path, config):
    path = tmp_path / "grid.png"
    image = Image.new("RGB", (400, 600), "white")
    draw = ImageDraw.Draw(image)
    for box in [(20, 20, 180, 260), (220, 20, 380, 260), (20, 300, 380, 560)]:
        draw.rectangle(box, fill="black")
    image.save(path)
    regions = detection.contour_regions(path, config)
    assert len(regions) == 3
    assert [(round(r["x"], 2), round(r["y"], 2)) for r in regions] == [
        (0.05, 0.03),
        (0.55, 0.03),
        (0.05, 0.5),
    ]
    Image.new("RGB", (400, 600), "white").save(path)
    assert detection.contour_regions(path, config) == []


def test_immutable_republish_and_stable_manual_edits(package, config):
    before = {
        str(p.relative_to(package)): p.read_bytes()
        for p in package.rglob("*")
        if p.is_file()
    }
    split = split_for(package)
    first, report = detection.detect_package(
        package, package.parent / "first", config, split
    )
    m1 = validate_package(first)
    assert report["pages"][0]["count"] == 4
    original_regions = m1["pages"][0]["suggestions"]["regions"]
    edited = {**original_regions[0], "width": 0.2}
    ann = annotations(m1, [edited], [original_regions[1]["id"]])
    validate_annotations(ann, m1)
    second, _ = detection.detect_package(
        first, package.parent / "second", config, split
    )
    m2 = validate_package(second)
    validate_annotations(ann, m2)
    effective = effective_regions(m2["pages"][0], ann["pages"][0])
    assert effective[0] == edited
    assert original_regions[1]["id"] not in [r["id"] for r in effective]
    assert [r["id"] for r in original_regions] == m2["pages"][0]["suggestions"]["order"]
    assert (
        m1["pages"][0]["suggestions"]["detector"]["run_id"]
        != m2["pages"][0]["suggestions"]["detector"]["run_id"]
    )
    assert {
        str(p.relative_to(package)): p.read_bytes()
        for p in package.rglob("*")
        if p.is_file()
    } == before
    for name, data in before.items():
        if name not in {"manifest.json", "COMPLETE.json"}:
            assert (second / name).read_bytes() == data
    assert fingerprint(second / "manifest.json") == json.loads(
        (second / "COMPLETE.json").read_text()
    )
    assert publication.without_suggestions(m2) == json.loads(before["manifest.json"])


def test_absent_then_returning_suggestions_keep_tombstones(
    package, config, monkeypatch
):
    split = split_for(package)
    first, _ = detection.detect_package(
        package, package.parent / "first", config, split
    )
    m1 = validate_package(first)
    ids = m1["pages"][0]["suggestions"]["order"]
    ann = annotations(m1, deleted=ids)
    detector = detection.contour_regions
    monkeypatch.setattr(detection, "contour_regions", lambda *_: [])
    blank, report = detection.detect_package(
        first, package.parent / "blank", config, split
    )
    assert report["pages"][0]["status"] == "fallback"
    validate_annotations(ann, validate_package(blank))
    monkeypatch.setattr(detection, "contour_regions", detector)
    back, _ = detection.detect_package(blank, package.parent / "back", config, split)
    m3 = validate_package(back)
    validate_annotations(ann, m3)
    assert m3["pages"][0]["suggestions"]["order"] == ids
    assert effective_regions(m3["pages"][0], ann["pages"][0]) == []


@pytest.mark.parametrize(
    "bad",
    [
        rect("x", x=-0.1),
        rect("x", width=2),
        rect("x", x=float("nan")),
        rect("x", height=0),
        rect("x", x=False),
    ],
)
def test_invalid_output_falls_back(package, config, monkeypatch, bad):
    monkeypatch.setattr(detection, "contour_regions", lambda *_: [bad])
    result, report = detection.detect_package(
        package, package.parent / "bad", config, split_for(package)
    )
    assert report["pages"][0]["status"] == "fallback"
    assert "ValueError" in report["pages"][0]["reason"]
    assert effective_regions(validate_package(result)["pages"][0]) == []


def test_detector_exception_reported(package, config, monkeypatch, capsys):
    def fail(*_):
        raise RuntimeError("synthetic failure")

    monkeypatch.setattr(detection, "contour_regions", fail)
    result, report = detection.detect_package(
        package, package.parent / "failed", config, split_for(package)
    )
    assert report["pages"][0]["reason"] == "RuntimeError: synthetic failure"
    assert "full-page fallback" in capsys.readouterr().err
    assert effective_regions(validate_package(result)["pages"][0]) == []


def test_split_guard_precedes_artwork_access(package, config, monkeypatch):
    def forbidden(*_):
        pytest.fail("Opened assets before split guard")

    monkeypatch.setattr(detection, "validate_package", forbidden)
    with pytest.raises(ValueError, match="not in requested dev"):
        detection.detect_package(
            package, package.parent / "bad", config, split_for(package, "heldout")
        )
    with pytest.raises(ValueError, match="--phase-b"):
        detection.detect_package(
            package,
            package.parent / "bad",
            config,
            split_for(package, "heldout"),
            "heldout",
        )
    mutable = {**config, "frozen": False}
    with pytest.raises(ValueError, match="frozen"):
        detection.detect_package(
            package,
            package.parent / "bad",
            mutable,
            split_for(package, "heldout"),
            "heldout",
            True,
        )


def test_republish_rejects_changes_existing_and_cleans_failed_stage(
    package, monkeypatch
):
    original = validate_package(package)
    changed = copy.deepcopy(original)
    changed["book"]["title"] = "Changed"
    with pytest.raises(ValueError, match="suggestions only"):
        publication.republish(package, package.parent / "bad", original, changed)
    with pytest.raises(ValueError, match="separate"):
        publication.republish(package, package, original, original)
    (package.parent / "existing").mkdir()
    with pytest.raises(ValueError, match="already exists"):
        publication.republish(package, package.parent / "existing", original, original)

    def fail(*_):
        raise RuntimeError("validation failure")

    monkeypatch.setattr(publication, "validate_package", fail)
    with pytest.raises(RuntimeError):
        publication.republish(package, package.parent / "failed", original, original)
    assert not (package.parent / "failed").exists()
    assert not list(package.parent.glob(".failed.staging-*"))
    validate_package(package)


def test_iou_identity_matching_is_one_to_one():
    old = [rect("a"), rect("b", x=0.6)]
    new = [rect("candidate", x=0.61), rect("candidate2", x=0.11), rect("extra", x=0.12)]
    matches = detection.match_regions(new, old, 0.65)
    assert set(matches) == {(0, 1), (1, 0)}
    assert detection.match_regions([rect("new", y=0.6)], old, 0.65) == []


def test_synthetic_metrics_errors_and_empty():
    reference = [rect("a"), rect("b", x=0.6), rect("c", y=0.6)]
    predicted = [rect("pb", x=0.6), rect("pa", x=0.12), rect("extra", x=0.6, y=0.6)]
    result = score_page(predicted, reference, resize_tolerance=0.005)
    assert (result["matched"], result["missed"], result["spurious"]) == (2, 1, 1)
    assert result["ordering_inversions"] == 1
    assert result["boundary_error_mean"] == pytest.approx(0.005)
    assert result["correction_effort"] == {
        "adds": 1,
        "deletes": 1,
        "resizes": 1,
        "reorders": 1,
        "total": 4,
    }
    assert score_page([], reference)["missed"] == 3
    assert score_page(predicted, [])["spurious"] == 3
    assert score_page([], [])["boundary_error_mean"] is None
    assert score_page(reference, reference)["correction_effort"]["total"] == 0


def test_evaluate_uses_reference_manifest_not_fresh_predictions(package, config):
    prediction, _ = detection.detect_package(
        package, package.parent / "pred", config, split_for(package)
    )
    m = validate_package(prediction)
    reference = validate_package(package)
    ann = annotations(reference)
    report = evaluate(m, ann, reference, split_for(package))
    assert report["splits"]["dev"]["totals"]["spurious"] == 4
    assert report["splits"]["dev"]["failure_page_ids"] == m["page_order"]
    assert report["splits"]["heldout"]["status"] == "not-evaluated"
    ann["pages"] = []
    missing = evaluate(m, ann, reference, split_for(package))["splits"]["dev"]
    assert missing["status"] == "incomplete-references"
    assert missing["pages"] == []
    assert missing["missing_reference_page_ids"] == m["page_order"]


def test_overlay_guard(package, tmp_path):
    with pytest.raises(ValueError, match="not in requested dev"):
        detection.overlays(
            package, tmp_path / "work/overlays", split_for(package, "heldout")
        )


@pytest.mark.parametrize("value", [float("nan"), -1, True, "235"])
def test_bad_config(tmp_path, config, value):
    config["parameters"]["white_threshold"] = value
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config))
    with pytest.raises(ValueError):
        detection.load_config(path)


def test_new_geometry_gets_fresh_id_and_existing_edit_survives(
    package, config, monkeypatch
):
    first, _ = detection.detect_package(
        package, package.parent / "first", config, split_for(package)
    )
    m = validate_package(first)
    previous = m["pages"][0]["suggestions"]["regions"]
    ann = annotations(
        m, edited=[{**previous[0], "width": 0.2}], deleted=[previous[1]["id"]]
    )
    monkeypatch.setattr(
        detection,
        "contour_regions",
        lambda *_: [
            {k: v for k, v in previous[0].items() if k != "id"},
            {"x": 0.45, "y": 0.45, "width": 0.05, "height": 0.05},
        ],
    )
    second, _ = detection.detect_package(
        first, package.parent / "second", config, split_for(package)
    )
    updated = validate_package(second)
    result = effective_regions(updated["pages"][0], ann["pages"][0])
    assert result[0] == ann["pages"][0]["edited_regions"][0]
    assert result[-1]["id"] not in {r["id"] for r in previous}
    # Changed membership requires explicit editor reconciliation, never loss of edits/tombstones.
    with pytest.raises(ValueError, match="order"):
        validate_annotations(ann, updated)
    ann["pages"][0]["order"] = [r["id"] for r in result]
    validate_annotations(ann, updated)
    assert ann["pages"][0]["deleted_region_ids"] == [previous[1]["id"]]


def test_invalid_order_cannot_publish(package):
    original = validate_package(package)
    changed = copy.deepcopy(original)
    changed["pages"][0]["suggestions"] = {
        "detector": {
            "name": "synthetic",
            "version": "1",
            "configuration": {},
            "run_id": "test",
        },
        "regions": [rect("one")],
        "order": ["absent"],
    }
    with pytest.raises(ValueError, match="order"):
        publication.republish(package, package.parent / "invalid", original, changed)
    assert not (package.parent / "invalid").exists()


def test_batch_continues_after_page_failure(tmp_path, monkeypatch, config):
    monkeypatch.setattr(importer, "ROOT", tmp_path)
    monkeypatch.setattr(publication, "ROOT", tmp_path)
    source = tmp_path / "batch.pdf"
    image = Image.new("RGB", (80, 120), "white")
    image.save(source, save_all=True, append_images=[image])
    package = importer.import_pdf(
        source, profile=importer.RenderProfile(long_edge_px=120)
    )
    calls = []

    def detector(path, _config):
        calls.append(path)
        if len(calls) == 1:
            raise RuntimeError("first page fails")
        return [{"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5}]

    monkeypatch.setattr(detection, "contour_regions", detector)
    target, report = detection.detect_package(
        package, package.parent / "result", config, split_for(package)
    )
    assert [p["status"] for p in report["pages"]] == ["fallback", "ok"]
    assert len(validate_package(target)["pages"][1]["suggestions"]["regions"]) == 1


def test_cli_detection_evaluation_and_report_cannot_overwrite_package(
    package, config, monkeypatch, tmp_path
):
    import sys

    from comicpoc import cli

    monkeypatch.setattr(cli, "ROOT", tmp_path)
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config))
    split_path = tmp_path / "split.json"
    split_path.write_text(json.dumps(split_for(package)))
    target = package.parent / "cli"
    base = [
        "comicpoc",
        "detect",
        str(package),
        "--output",
        str(target),
        "--config",
        str(config_path),
        "--eval-split",
        str(split_path),
    ]
    monkeypatch.setattr(sys, "argv", base + ["--report", str(target / "manifest.json")])
    assert cli.main() == 1
    assert not target.exists()
    report = tmp_path / "work/report.json"
    monkeypatch.setattr(sys, "argv", base + ["--report", str(report)])
    assert cli.main() == 0
    assert json.loads(report.read_text())["pages"][0]["count"] == 4
    ann = tmp_path / "annotations.json"
    manifest = validate_package(target)
    ann.write_text(json.dumps(annotations(manifest)))
    evaluated = tmp_path / "work/evaluation.json"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "comicpoc",
            "evaluate-detection",
            str(target),
            "--annotations",
            str(ann),
            "--reference-manifest",
            str(target / "manifest.json"),
            "--eval-split",
            str(split_path),
            "--output",
            str(evaluated),
        ],
    )
    assert cli.main() == 0
    assert json.loads(evaluated.read_text())["splits"]["dev"]["totals"]["matched"] == 4
