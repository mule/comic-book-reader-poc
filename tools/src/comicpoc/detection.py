"""Independent OpenCV contour baseline; only derived page assets are inputs."""

import copy
import json
import math
import sys
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
from PIL import Image, ImageDraw

from comicpoc.corpus import ROOT
from comicpoc.manifest import regions_valid, validate_manifest, validate_package
from comicpoc.publication import republish

NAME = "comicpoc-opencv-contours"
VERSION = "1"


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text())
    expected = {
        "schema_version",
        "detector",
        "version",
        "opencv_version",
        "frozen",
        "frozen_date",
        "parameters",
    }
    if set(config) != expected or config["schema_version"] != 1:
        raise ValueError("Invalid detector configuration document")
    if (config["detector"], config["version"], config["opencv_version"]) != (
        NAME,
        VERSION,
        cv2.__version__,
    ):
        raise ValueError("Detector/configuration version mismatch")
    p = config["parameters"]
    limits = {
        "long_edge_px": (64, 4096),
        "white_threshold": (1, 254),
        "close_kernel": (1, 31),
        "min_area": (0.0001, 0.5),
        "max_area": (0.5, 1),
        "min_side": (0.001, 0.5),
        "min_fill": (0, 1),
        "row_tolerance": (0, 0.5),
        "identity_iou": (0.01, 1),
    }
    if set(p) != set(limits):
        raise ValueError("Unknown or missing detector parameters")
    for name, (low, high) in limits.items():
        value = p[name]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not low <= value <= high
        ):
            raise ValueError(f"Invalid detector parameter: {name}")
    for name in ["long_edge_px", "white_threshold", "close_kernel"]:
        if type(p[name]) is not int:
            raise ValueError(f"Integer parameter required: {name}")
    if type(config["frozen"]) is not bool or (
        config["frozen"] and not config["frozen_date"]
    ):
        raise ValueError("Frozen configuration needs a date")
    return config


def check_split(
    manifest: dict, split: dict, requested: str, phase_b: bool = False
) -> None:
    """Check metadata BEFORE opening/validating any artwork."""
    if requested not in {"dev", "heldout"}:
        raise ValueError("Unknown evaluation split")
    if requested == "heldout" and not phase_b:
        raise ValueError("Held-out access requires explicit --phase-b")
    entries = {(p["book_id"], p["pdf_page_number"]): p["split"] for p in split["pages"]}
    for page in manifest["pages"]:
        if entries.get((manifest["book"]["id"], page["pdf_page_number"])) != requested:
            raise ValueError(f"Page {page['id']} is not in requested {requested} split")


def iou(a: dict, b: dict) -> float:
    width = max(0, min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]))
    height = max(
        0, min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"])
    )
    intersection = width * height
    return intersection / (
        a["width"] * a["height"] + b["width"] * b["height"] - intersection
    )


def match_regions(new: list, old: list, threshold: float) -> list[tuple[int, int]]:
    """Deterministic greedy one-to-one IoU matching, highest overlap first."""
    candidates = sorted(
        (-iou(a, b), i, j)
        for i, a in enumerate(new)
        for j, b in enumerate(old)
        if iou(a, b) >= threshold
    )
    used_new, used_old, matches = set(), set(), []
    for _, i, j in candidates:
        if i not in used_new and j not in used_old:
            matches.append((i, j))
            used_new.add(i)
            used_old.add(j)
    return matches


def western_order(regions: list, tolerance: float) -> list:
    """Group by top edge relative to row anchor, then read each row left to right."""
    pending = sorted(regions, key=lambda r: (r["y"], r["x"], r["width"], r["height"]))
    ordered = []
    while pending:
        anchor = pending[0]["y"]
        row = [r for r in pending if r["y"] <= anchor + tolerance]
        pending = [r for r in pending if r["y"] > anchor + tolerance]
        ordered.extend(
            sorted(row, key=lambda r: (r["x"], r["y"], r["width"], r["height"]))
        )
    return ordered


def contour_regions(path: Path, config: dict) -> list:
    p = config["parameters"]
    with Image.open(path) as original:
        image = original.convert("RGB")
        image.thumbnail(
            (p["long_edge_px"], p["long_edge_px"]), Image.Resampling.LANCZOS
        )
        gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    height, width = gray.shape
    _, mask = cv2.threshold(gray, p["white_threshold"], 255, cv2.THRESH_BINARY_INV)
    kernel = np.ones((p["close_kernel"], p["close_kernel"]), dtype=np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h / (width * height)
        if (
            p["min_area"] <= area <= p["max_area"]
            and w / width >= p["min_side"]
            and h / height >= p["min_side"]
            and cv2.contourArea(contour) / (w * h) >= p["min_fill"]
        ):
            regions.append(
                {
                    "x": x / width,
                    "y": y / height,
                    "width": (x + w) / width - x / width,
                    "height": (y + h) / height - y / height,
                }
            )
    return western_order(regions, p["row_tolerance"])


def suggestions(page: dict, path: Path, config: dict, run_id: str) -> tuple[dict, dict]:
    previous = page.get("suggestions", {})
    history = (
        previous.get("detector", {})
        .get("configuration", {})
        .get("identity_history", [])
    )
    # Keep last geometry for absent IDs so empty runs cannot resurrect tombstones.
    registry = {r["id"]: r for r in history + previous.get("regions", [])}
    regions_valid(list(registry.values()))
    reason = None
    try:
        regions = contour_regions(path, config)
        # Temporary IDs allow validation before matching or persisting any result.
        regions = [{**r, "id": f"candidate-{i}"} for i, r in enumerate(regions)]
        regions_valid(regions)
        if any(set(r) != {"id", "x", "y", "width", "height"} for r in regions):
            raise ValueError("Unexpected detection fields")
        old = sorted(registry.values(), key=lambda r: r["id"])
        matches = dict(
            match_regions(regions, old, config["parameters"]["identity_iou"])
        )
        for i, region in enumerate(regions):
            region["id"] = (
                old[matches[i]]["id"] if i in matches else f"auto-{uuid4().hex}"
            )
            registry[region["id"]] = region
        if not regions:
            reason = "No contours passed geometry/area filters"
    except (cv2.error, OSError, ValueError, TypeError, KeyError, RuntimeError) as error:
        regions = []
        reason = f"{type(error).__name__}: {error}"
    result = {
        "detector": {
            "name": NAME,
            "version": VERSION,
            "run_id": run_id,
            "configuration": {
                "config": config,
                "identity_history": list(registry.values()),
            },
        },
        "regions": regions,
        "order": [r["id"] for r in regions],
    }
    return result, {
        "page_id": page["id"],
        "pdf_page_number": page["pdf_page_number"],
        "count": len(regions),
        "status": "fallback" if reason else "ok",
        "reason": reason,
    }


def detect_package(
    package: Path,
    output: Path,
    config: dict,
    split: dict,
    requested: str = "dev",
    phase_b: bool = False,
) -> tuple[Path, dict]:
    metadata = json.loads((package / "manifest.json").read_text())
    validate_manifest(metadata)
    check_split(metadata, split, requested, phase_b)
    if requested == "heldout" and not config["frozen"]:
        raise ValueError("Held-out runs require frozen configuration")
    manifest = validate_package(package)
    updated = copy.deepcopy(manifest)
    run_id = uuid4().hex
    reports = []
    for page in updated["pages"]:
        page["suggestions"], report = suggestions(
            page, package / page["page"]["path"], config, run_id
        )
        reports.append(report)
        if report["reason"]:
            print(
                f"{page['id']}: full-page fallback: {report['reason']}", file=sys.stderr
            )
    validate_manifest(updated)
    target = republish(package, output, manifest, updated)
    return target, {
        "run_id": run_id,
        "split": requested,
        "config": config,
        "pages": reports,
    }


def overlays(
    package: Path,
    output: Path,
    split: dict,
    requested: str = "dev",
    phase_b: bool = False,
) -> None:
    manifest = json.loads((package / "manifest.json").read_text())
    check_split(manifest, split, requested, phase_b)
    if not output.resolve().is_relative_to((ROOT / "work").resolve()):
        raise ValueError("Overlays must stay under work/")
    if output.resolve().is_relative_to(
        package.resolve()
    ) or package.resolve().is_relative_to(output.resolve()):
        raise ValueError("Overlay directory must be separate from the package")
    if output.exists():
        raise ValueError("Overlay output exists; choose a new directory")
    output.mkdir(parents=True, exist_ok=True)
    for page in manifest["pages"]:
        with Image.open(package / page["page"]["path"]) as source:
            image = source.convert("RGB")
            image.thumbnail((1200, 1200))
        draw = ImageDraw.Draw(image)
        by_id = {r["id"]: r for r in page["suggestions"]["regions"]}
        for index, rid in enumerate(page["suggestions"]["order"], 1):
            r = by_id[rid]
            box = (
                r["x"] * image.width,
                r["y"] * image.height,
                (r["x"] + r["width"]) * image.width,
                (r["y"] + r["height"]) * image.height,
            )
            draw.rectangle(box, outline="#ff00ff", width=4)
            draw.text(
                (box[0] + 5, box[1] + 5),
                str(index),
                fill="white",
                stroke_width=2,
                stroke_fill="black",
                font_size=24,
            )
        draw.text(
            (5, 5),
            f"PDF p{page['pdf_page_number']} - {len(by_id)} suggestions",
            fill="white",
            stroke_width=2,
            stroke_fill="black",
            font_size=20,
        )
        image.save(output / f"{page['id']}.jpg", quality=90)
