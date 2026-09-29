"""Compose reader stage vs PDFium at identical camera geometry, local DEV only."""

import json

import pypdfium2 as pdfium
from PIL import Image, ImageDraw

from comicpoc.corpus import ROOT


def main():
    records = json.loads((ROOT / "work/bench/visual.json").read_text())
    inventory = json.loads((ROOT / "corpus/inventory.json").read_text())
    books = {b["book_id"]: b for b in inventory["books"]}
    out = ROOT / "work/visual"
    for record in records:
        name = record["name"]
        with pdfium.PdfDocument(
            ROOT / "test-data" / books[record["bookId"]]["source"]
        ) as pdf:
            page = pdf[record["pdfPageNumber"] - 1]
            scale = 4800 / max(page.get_size())
            bitmap = page.render(scale=scale)
            original = bitmap.to_pil().convert("RGB")
            original.save(out / f"{name}-source.png")
            bitmap.close()
            page.close()
        screenshot = Image.open(out / f"{name}-stage.png").convert("RGB")
        geometry = record["geometry"]["image"]
        # Match the browser's entire camera window, including art outside the region.
        reference = original.transform(
            screenshot.size,
            Image.Transform.AFFINE,
            (
                original.width / geometry["width"],
                0,
                -geometry["x"] * original.width / geometry["width"],
                0,
                original.height / geometry["height"],
                -geometry["y"] * original.height / geometry["height"],
            ),
            resample=Image.Resampling.BICUBIC,
            fillcolor=(20, 20, 20),
        )
        pair = Image.new("RGB", (screenshot.width * 2, screenshot.height + 30), "white")
        pair.paste(screenshot, (0, 30))
        pair.paste(reference, (screenshot.width, 30))
        draw = ImageDraw.Draw(pair)
        draw.text((8, 8), "Reader WebP camera", fill="black")
        draw.text(
            (screenshot.width + 8, 8), "Source PDFium 4800px, same camera", fill="black"
        )
        pair.save(out / f"{name}-comparison.png")
        record["source_render_long_edge"] = max(original.size)
        record["comparison"] = str((out / f"{name}-comparison.png").relative_to(ROOT))
    for key in dict.fromkeys((r["bookId"], r["pdfPageNumber"]) for r in records):
        group = [r for r in records if (r["bookId"], r["pdfPageNumber"]) == key]
        thumbs = []
        for record in group:
            with Image.open(ROOT / record["comparison"]) as im:
                im.thumbnail((1200, 400))
                thumbs.append((record["mode"], im.copy()))
        sheet = Image.new(
            "RGB", (1200, sum(im.height + 22 for _, im in thumbs)), "white"
        )
        draw = ImageDraw.Draw(sheet)
        y = 0
        for mode, im in thumbs:
            draw.text((4, y), mode, fill="black")
            sheet.paste(im, (0, y + 22))
            y += im.height + 22
        sheet.save(out / f"{key[0]}-p{key[1]}-sequence.png")
    (ROOT / "work/bench/visual.json").write_text(json.dumps(records, indent=2) + "\n")


if __name__ == "__main__":
    main()
