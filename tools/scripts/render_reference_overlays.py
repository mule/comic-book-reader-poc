"""Draw final reference regions over original package assets, never proposals."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

from comicpoc.corpus import ROOT
from comicpoc.manifest import effective_regions, validate_annotations, validate_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("annotations", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.output.resolve().is_relative_to((ROOT / "work").resolve()):
        raise ValueError("Artwork output must be under work/")
    if args.output.resolve().is_relative_to(args.package.resolve()):
        raise ValueError("Do not write overlays into immutable packages")
    manifest = json.loads((args.package / "manifest.json").read_text())
    validate_manifest(manifest)
    if any("suggestions" in page for page in manifest["pages"]):
        raise ValueError("Reference overlays require original, suggestion-free assets")
    annotations = json.loads(args.annotations.read_text())
    validate_annotations(annotations, manifest)
    pages = {p["id"]: p for p in manifest["pages"]}
    args.output.mkdir(parents=True, exist_ok=True)
    for override in annotations["pages"]:
        page = pages[override["page_id"]]
        with Image.open(args.package / page["page"]["path"]) as source:
            image = source.convert("RGB")
        draw = ImageDraw.Draw(image)
        labels = []
        for i, region in enumerate(effective_regions(page, override), 1):
            box = (
                region["x"] * image.width,
                region["y"] * image.height,
                (region["x"] + region["width"]) * image.width - 1,
                (region["y"] + region["height"]) * image.height - 1,
            )
            color = ["#ff00ff", "#00ff70", "#ff9500"][i % 3]
            draw.rectangle(box, outline=color, width=6)
            label_x, label_y = box[0] + 8, box[1] + 8
            if any(abs(label_x - x) < 60 and abs(label_y - y) < 60 for x, y in labels):
                label_x += min(400, (box[2] - box[0]) / 3)
            labels.append((label_x, label_y))
            draw.text(
                (label_x, label_y),
                str(i),
                fill=color,
                stroke_width=4,
                stroke_fill="black",
                font_size=48,
            )
        image.save(args.output / f"{page['pdf_page_number']:03}-full.png")
        image.thumbnail((1200, 1200))
        image.save(args.output / f"{page['pdf_page_number']:03}.png")
        print(f"{page['id']}: {len(override['added_regions'])} reference regions")


if __name__ == "__main__":
    main()
