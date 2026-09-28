"""Offline schema, identity, package integrity and annotation validation."""

import hashlib
import json
import math
from pathlib import Path

from jsonschema import Draft202012Validator
from PIL import Image

from comicpoc.corpus import ROOT, fingerprint


def page_id(source_sha: str, number: int) -> str:
    return f"p-{source_sha}-{number:04d}"


def profile_id(params: dict) -> str:
    return (
        "render-"
        + hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]
    )


def schema_validate(data: dict, name: str) -> None:
    schema = json.loads((ROOT / "format" / f"{name}.schema.json").read_text())
    errors = list(Draft202012Validator(schema).iter_errors(data))
    if errors:
        raise ValueError("; ".join(f"{list(e.path)}: {e.message}" for e in errors))


def unique(values: list, label: str) -> None:
    if len(values) != len(set(values)):
        raise ValueError(f"Duplicate {label}")


def regions_valid(regions: list) -> None:
    unique([r["id"] for r in regions], "region IDs")
    for r in regions:
        if (
            any(not math.isfinite(r[k]) for k in ["x", "y", "width", "height"])
            or r["width"] <= 0
            or r["height"] <= 0
            or r["x"] + r["width"] > 1
            or r["y"] + r["height"] > 1
        ):
            raise ValueError(f"Region out of bounds: {r['id']}")


def validate_manifest(data: dict) -> None:
    schema_validate(data, "manifest")
    params = {k: v for k, v in data["render_profile"].items() if k != "id"}
    if profile_id(params) != data["render_profile"]["id"]:
        raise ValueError("Render profile ID does not match parameters")
    ids = [p["id"] for p in data["pages"]]
    unique(ids, "page IDs")
    numbers = [p["pdf_page_number"] for p in data["pages"]]
    unique(numbers, "PDF page numbers")
    if set(ids) != set(data["page_order"]):
        raise ValueError("Page order must reference every page exactly once")
    if any(n > data["source"]["page_count"] for n in numbers):
        raise ValueError("PDF page number exceeds source count")
    if data["selection"] == "all" and set(numbers) != set(
        range(1, data["source"]["page_count"] + 1)
    ):
        raise ValueError("Full import omits source pages")
    paths = []
    for p in data["pages"]:
        if p["id"] != page_id(data["source"]["sha256"], p["pdf_page_number"]):
            raise ValueError("Page identity does not match source")
        orientation = (
            "landscape"
            if p["width"] > p["height"]
            else "portrait"
            if p["width"] < p["height"]
            else "square"
        )
        if p["orientation"] != orientation or (p["width"], p["height"]) != (
            p["page"]["width"],
            p["page"]["height"],
        ):
            raise ValueError("Page geometry inconsistent")
        for kind in ["page", "thumbnail"]:
            paths.append(p[kind]["path"])
            if not p[kind]["path"].startswith(
                "pages/" if kind == "page" else "thumbs/"
            ):
                raise ValueError("Asset in wrong directory")
        if "suggestions" in p:
            suggestions = p["suggestions"]
            regions_valid(suggestions["regions"])
            if set(suggestions["order"]) != {r["id"] for r in suggestions["regions"]}:
                raise ValueError("Suggestion order must include every region")
    unique(paths, "asset paths")


def effective_regions(page: dict, override: dict | None = None) -> list:
    suggestions = page.get("suggestions", {"regions": [], "order": []})
    regions = {r["id"]: r for r in suggestions["regions"]}
    order = suggestions["order"]
    if override is not None:
        for rid in override["deleted_region_ids"]:
            regions.pop(rid, None)
        for r in override["edited_regions"] + override["added_regions"]:
            regions[r["id"]] = r
        # New detector regions append after the curated sequence. Tombstones persist.
        order = override["order"] + [
            rid for rid in suggestions["order"] if rid not in override["order"]
        ]
    return [regions[rid] for rid in order if rid in regions]


def validate_annotations(data: dict, manifest: dict) -> None:
    schema_validate(data, "annotations")
    validate_manifest(manifest)
    if (
        data["book_id"] != manifest["book"]["id"]
        or data["source_sha256"] != manifest["source"]["sha256"]
    ):
        raise ValueError("Annotation book/source mismatch")
    unique([p["page_id"] for p in data["pages"]], "annotation page IDs")
    pages = {p["id"]: p for p in manifest["pages"]}
    for override in data["pages"]:
        page = pages.get(override["page_id"])
        if page is None or page["pdf_page_number"] != override["pdf_page_number"]:
            raise ValueError("Annotation page identity mismatch")
        regions = override["added_regions"] + override["edited_regions"]
        regions_valid(regions)
        ids = {r["id"] for r in regions}
        deleted = set(override["deleted_region_ids"])
        if ids & deleted or set(override["order"]) & deleted:
            raise ValueError("Deleted region also edited or ordered")
        suggested = {r["id"] for r in page.get("suggestions", {}).get("regions", [])}
        if {r["id"] for r in override["added_regions"]} & suggested:
            raise ValueError("Added region collides with suggestion")
        if not ids <= set(override["order"]) or not set(override["order"]) <= (
            suggested | ids
        ):
            raise ValueError("Invalid manual region order")
        if (suggested | ids) - deleted != set(override["order"]):
            raise ValueError("Manual order must include all surviving regions")


def validate_asset(package: Path, asset: dict) -> None:
    path = package / asset["path"]
    if path.is_symlink() or not path.resolve().is_relative_to(package.resolve()):
        raise ValueError("Asset escapes package")
    if fingerprint(path) != {k: asset[k] for k in ["sha256", "byte_size"]}:
        raise ValueError(f"Asset checksum mismatch: {asset['path']}")
    with Image.open(path) as image:
        image.load()
        if image.size != (asset["width"], asset["height"]):
            raise ValueError("Asset dimensions mismatch")


def validate_package(package: Path, require_complete: bool = True) -> dict:
    manifest = json.loads((package / "manifest.json").read_text())
    validate_manifest(manifest)
    if require_complete:
        marker = json.loads((package / "COMPLETE.json").read_text())
        if marker != fingerprint(package / "manifest.json"):
            raise ValueError("Completion marker mismatch")
    for page in manifest["pages"]:
        for kind in ["page", "thumbnail"]:
            validate_asset(package, page[kind])
    return manifest
