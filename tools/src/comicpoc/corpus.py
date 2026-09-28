"""Deterministic source inventory; no artwork is written here."""

import hashlib
import re
from contextlib import closing
from pathlib import Path

import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[3]


def sources(directory: Path) -> list[Path]:
    if not directory.is_dir():
        raise ValueError(f"Source directory missing: {directory}")
    paths = sorted(p for p in directory.rglob("*") if p.suffix.lower() == ".pdf")
    if not paths:
        raise ValueError(f"No PDF sources in {directory}")
    return paths


def fingerprint(path: Path) -> dict:
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"sha256": digest, "byte_size": path.stat().st_size}


def book_id(path: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")


def inspect_book(path: Path, directory: Path) -> dict:
    pages = []
    with pdfium.PdfDocument(path) as document:
        encrypted = pdfium.raw.FPDF_GetSecurityHandlerRevision(document) != -1
        for index in range(len(document)):
            with closing(document[index]) as page:
                images = []
                has_text = False
                for obj in page.get_objects(max_depth=64):
                    if obj.type == pdfium.raw.FPDF_PAGEOBJ_FORM and obj.level >= 63:
                        raise ValueError(
                            f"{path.name}: form nesting exceeds inventory limit"
                        )
                    if obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE:
                        images.append(obj.get_px_size())
                    has_text |= obj.type == pdfium.raw.FPDF_PAGEOBJ_TEXT
                width, height = page.get_size()
                largest = max(images, key=lambda size: size[0] * size[1], default=None)
                pages.append(
                    {
                        "pdf_page_number": index + 1,
                        "width_points": width,
                        "height_points": height,
                        "rotation_degrees": page.get_rotation(),
                        "embedded_image_count": len(images),
                        "largest_image_pixels": list(largest) if largest else None,
                        "has_text_objects": has_text,
                    }
                )
    return {
        "book_id": book_id(path),
        "source": path.relative_to(directory).as_posix(),
        **fingerprint(path),
        "page_count": len(pages),
        "encrypted": encrypted,
        "pages": pages,
    }


def inventory(directory: Path) -> dict:
    books = [inspect_book(path, directory) for path in sources(directory)]
    ids = [book["book_id"] for book in books]
    if len(set(ids)) != len(ids):
        raise ValueError("Source filenames produce duplicate book IDs")
    return {"schema_version": 1, "books": books}


def check_inventory(directory: Path, recorded: dict) -> list[str]:
    # Empty or absent directories still report every missing book by name.
    actual = (
        {
            p.relative_to(directory).as_posix(): p
            for p in directory.rglob("*")
            if p.suffix.lower() == ".pdf"
        }
        if directory.is_dir()
        else {}
    )
    expected = {book["source"]: book for book in recorded["books"]}
    problems = []
    for name in sorted(expected.keys() | actual.keys()):
        if name not in actual:
            problems.append(f"missing: {name}")
        elif name not in expected:
            problems.append(f"added: {name}")
        elif any(
            expected[name][key] != value
            for key, value in fingerprint(actual[name]).items()
        ):
            problems.append(f"changed: {name}")
    return problems
