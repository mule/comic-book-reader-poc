"""Bounded complete-page rendering with immutable, atomic package publication."""

import fcntl
import json
import re
import sys
from contextlib import closing
from dataclasses import asdict, dataclass, field
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

from comicpoc.corpus import ROOT, book_id, fingerprint
from comicpoc.manifest import page_id, profile_id, validate_asset, validate_package


@dataclass(frozen=True)
class ThumbnailSettings:
    format: str = "webp"
    quality: int = 80
    long_edge_px: int = 360


@dataclass(frozen=True)
class RenderProfile:
    format: str = "webp"
    quality: int = 90
    long_edge_px: int = 3056
    resolution_policy: str = "native-embedded-capped"
    thumbnail: ThumbnailSettings = field(default_factory=ThumbnailSettings)

    def manifest(self) -> dict:
        params = asdict(self)
        for settings in [params, params["thumbnail"]]:
            if (
                settings["format"] not in ["webp", "jpeg", "png"]
                or not 1 <= settings["quality"] <= 100
                or not 1 <= settings["long_edge_px"] <= 16384
            ):
                raise ValueError(
                    "Invalid render profile settings (edge must be 1..16384)"
                )
        if self.resolution_policy != "native-embedded-capped":
            raise ValueError("Unsupported resolution policy")
        return {"id": profile_id(params), **params}


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def save_asset(image: Image.Image, path: Path, quality: int) -> dict:
    image.save(path, quality=quality)
    return {
        "path": f"{path.parent.name}/{path.name}",
        **fingerprint(path),
        "width": image.width,
        "height": image.height,
    }


def render_page(
    document, number: int, stage: Path, source_sha: str, profile: RenderProfile
) -> dict:
    with closing(document[number - 1]) as page:
        images = [
            obj.get_px_size()
            for obj in page.get_objects(max_depth=64)
            if obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE
        ]
        largest = max(images, key=lambda size: size[0] * size[1], default=None)
        width, height = page.get_size()
        # Render all PDF content, using the dominant embedded image only to choose resolution.
        edge = min(
            max(largest) if largest else round(max(width, height) * 2),
            profile.long_edge_px,
        )
        with closing(page.render(scale=edge / max(width, height))) as bitmap:
            image = bitmap.to_pil().convert("RGB")
        try:
            image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            pid = page_id(source_sha, number)
            result = {
                "id": pid,
                "pdf_page_number": number,
                "width": image.width,
                "height": image.height,
                "rotation_degrees": page.get_rotation(),
                "orientation": "landscape"
                if image.width > image.height
                else "portrait"
                if image.width < image.height
                else "square",
            }
            result["page"] = save_asset(
                image, stage / "pages" / f"{pid}.{profile.format}", profile.quality
            )
            image.thumbnail(
                (profile.thumbnail.long_edge_px, profile.thumbnail.long_edge_px),
                Image.Resampling.LANCZOS,
            )
            result["thumbnail"] = save_asset(
                image,
                stage / "thumbs" / f"{pid}.{profile.thumbnail.format}",
                profile.thumbnail.quality,
            )
            return result
        finally:
            image.close()


def import_pdf(
    source: Path,
    output: Path | None = None,
    pages: list[int] | None = None,
    profile: RenderProfile | None = None,
    identity: str | None = None,
) -> Path:
    output = output or ROOT / "work/packages"
    if not output.resolve().is_relative_to((ROOT / "work").resolve()):
        raise ValueError("Artwork output must be inside this repository work/")
    identity = identity or book_id(source)
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", identity):
        raise ValueError("Invalid book ID")
    profile = profile or RenderProfile()
    profile_data = profile.manifest()
    source_data = fingerprint(source)
    output.mkdir(parents=True, exist_ok=True)
    # Single writer per book; lock is released by the OS on interruption.
    with (output / f".{identity}.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with pdfium.PdfDocument(source) as document:
            source_data["page_count"] = len(document)
            selected = list(range(1, len(document) + 1)) if pages is None else pages
            if (
                not selected
                or len(set(selected)) != len(selected)
                or any(n < 1 or n > len(document) for n in selected)
            ):
                raise ValueError("Invalid or duplicate PDF page selection")
            request = {
                "book": {"id": identity, "title": source.stem},
                "source": source_data,
                "render_profile": profile_data,
                "selected": selected,
            }
            target = output / identity
            if target.exists():
                existing = validate_package(target)
                if (
                    existing["source"] != source_data
                    or existing["render_profile"] != profile_data
                    or [
                        next(
                            p["pdf_page_number"]
                            for p in existing["pages"]
                            if p["id"] == pid
                        )
                        for pid in existing["page_order"]
                    ]
                    != selected
                ):
                    raise ValueError(
                        "Existing package source/profile/selection differs; use another --output directory. Existing annotations are never overwritten."
                    )
                return target
            stage = output / f".{identity}.staging"
            stage.mkdir(exist_ok=True)
            request_file = stage / "request.json"
            if (
                request_file.exists()
                and json.loads(request_file.read_text()) != request
            ):
                raise ValueError(
                    "Staging source/profile/selection differs; use another --output directory"
                )
            write_json(request_file, request)
            for directory in ["pages", "thumbs", "checkpoints"]:
                (stage / directory).mkdir(exist_ok=True)
            results = []
            errors = []
            for number in selected:
                checkpoint = stage / "checkpoints" / f"{number}.json"
                result = None
                if checkpoint.exists():
                    try:
                        candidate = json.loads(checkpoint.read_text())
                        if (
                            candidate["id"] != page_id(source_data["sha256"], number)
                            or candidate["pdf_page_number"] != number
                        ):
                            raise ValueError("Checkpoint identity mismatch")
                        for kind in ["page", "thumbnail"]:
                            validate_asset(stage, candidate[kind])
                        result = candidate
                    except (OSError, ValueError, KeyError):
                        result = None
                try:
                    if result is None:
                        result = render_page(
                            document, number, stage, source_data["sha256"], profile
                        )
                        write_json(checkpoint, result)
                    results.append(result)
                except (OSError, ValueError, RuntimeError) as error:
                    errors.append({"pdf_page_number": number, "error": str(error)})
                    print(f"PDF page {number}: {error}", file=sys.stderr)
                    write_json(stage / "errors.json", {"errors": errors})
            if errors:
                raise RuntimeError(
                    f"{len(errors)} page(s) failed; checkpoints retained in {stage.name}"
                )
            if fingerprint(source) != {
                k: source_data[k] for k in ["sha256", "byte_size"]
            }:
                raise ValueError("Source changed during import")
            manifest = {
                "schema_version": 1,
                **{k: request[k] for k in ["book", "source", "render_profile"]},
                "selection": "all" if len(selected) == len(document) else "sample",
                "page_order": [p["id"] for p in results],
                "pages": results,
            }
            write_json(stage / "manifest.json", manifest)
            validate_package(stage, require_complete=False)
            write_json(stage / "COMPLETE.json", fingerprint(stage / "manifest.json"))
            (stage / "errors.json").unlink(missing_ok=True)
            stage.rename(target)
            return target
