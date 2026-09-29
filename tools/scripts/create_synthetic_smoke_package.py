"""Create a small 3-page synthetic package for smoke tests and CI."""

from pathlib import Path

from PIL import Image

from comicpoc.corpus import ROOT
from comicpoc.importer import RenderProfile, import_pdf


def generate_smoke_package(target_dir: Path | None = None) -> Path:
    out = target_dir or (ROOT / "work/synthetic-packages")
    out.mkdir(parents=True, exist_ok=True)
    pdf_path = out / "synthetic-smoke.pdf"

    imgs = [
        Image.new("RGB", (200, 300), color)
        for color in ["#e74c3c", "#2ecc71", "#3498db"]
    ]
    imgs[0].save(pdf_path, save_all=True, append_images=imgs[1:])

    package = import_pdf(
        pdf_path,
        out,
        identity="synthetic-smoke-book",
        profile=RenderProfile(long_edge_px=300, quality=80),
    )
    if pdf_path.exists():
        pdf_path.unlink()
    return package


if __name__ == "__main__":
    pkg = generate_smoke_package()
    print(f"Synthetic package created at: {pkg}")
