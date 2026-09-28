"""Artwork-free evaluation against explicitly annotated, final reference regions."""

from comicpoc.detection import check_split, match_regions
from comicpoc.manifest import effective_regions, validate_annotations, validate_manifest


def boundary_error(a: dict, b: dict) -> float:
    """Mean absolute error of four edges, in normalized page coordinates."""
    return (
        sum(
            abs(x - y)
            for x, y in zip(
                (a["x"], a["y"], a["x"] + a["width"], a["y"] + a["height"]),
                (b["x"], b["y"], b["x"] + b["width"], b["y"] + b["height"]),
                strict=True,
            )
        )
        / 4
    )


def score_page(
    predicted: list,
    reference: list,
    threshold: float = 0.5,
    resize_tolerance: float = 0.01,
) -> dict:
    matches = sorted(match_regions(predicted, reference, threshold))
    errors = [boundary_error(predicted[i], reference[j]) for i, j in matches]
    sequence = [j for _, j in matches]
    inversions = sum(a > b for i, a in enumerate(sequence) for b in sequence[i + 1 :])
    effort = {
        "adds": len(reference) - len(matches),
        "deletes": len(predicted) - len(matches),
        "resizes": sum(e > resize_tolerance for e in errors),
        "reorders": inversions,
    }
    return {
        "matched": len(matches),
        "missed": effort["adds"],
        "spurious": effort["deletes"],
        "boundary_error_mean": sum(errors) / len(errors) if errors else None,
        "boundary_errors": errors,
        "ordering_inversions": inversions,
        "correction_effort": {**effort, "total": sum(effort.values())},
        "matches": [
            {"suggestion_id": predicted[i]["id"], "reference_id": reference[j]["id"]}
            for i, j in matches
        ],
    }


def evaluate(
    manifest: dict,
    annotations: dict,
    reference_manifest: dict,
    split: dict,
    requested: str = "dev",
    phase_b: bool = False,
    threshold: float = 0.5,
    resize_tolerance: float = 0.01,
) -> dict:
    if not 0 < threshold <= 1 or not 0 <= resize_tolerance <= 1:
        raise ValueError("Invalid evaluation thresholds")
    # No assets read; heldout still requires an explicit Phase B decision.
    check_split(manifest, split, requested, phase_b)
    validate_manifest(manifest)
    validate_annotations(annotations, reference_manifest)
    if (manifest["book"]["id"], manifest["source"]) != (
        reference_manifest["book"]["id"],
        reference_manifest["source"],
    ):
        raise ValueError("Reference and prediction book/source mismatch")
    if requested == "heldout" and any(
        not p.get("suggestions", {})
        .get("detector", {})
        .get("configuration", {})
        .get("config", {})
        .get("frozen", False)
        for p in manifest["pages"]
    ):
        raise ValueError("Held-out evaluation requires frozen detector provenance")
    reference_pages = {p["id"]: p for p in reference_manifest["pages"]}
    overrides = {p["page_id"]: p for p in annotations["pages"]}
    results, missing = [], []
    for page in manifest["pages"]:
        pid = page["id"]
        if pid not in overrides:
            missing.append(pid)
            continue
        reference = effective_regions(reference_pages[pid], overrides[pid])
        result = score_page(
            effective_regions(page), reference, threshold, resize_tolerance
        )
        results.append(
            {"page_id": pid, "pdf_page_number": page["pdf_page_number"], **result}
        )
    group = {
        "status": "complete" if not missing else "incomplete-references",
        "pages": results,
        "missing_reference_page_ids": missing,
        "failure_page_ids": [
            p["page_id"] for p in results if p["correction_effort"]["total"] > 0
        ],
        "totals": {
            key: sum(p[key] for p in results)
            for key in ["matched", "missed", "spurious", "ordering_inversions"]
        },
    }
    return {
        "schema_version": 1,
        "book_id": manifest["book"]["id"],
        "iou_threshold": threshold,
        "resize_tolerance": resize_tolerance,
        "matching": "greedy-highest-iou-one-to-one",
        "boundary_units": "normalized-page-edges",
        "splits": {
            s: group if s == requested else {"status": "not-evaluated", "pages": []}
            for s in ["dev", "heldout"]
        },
    }
