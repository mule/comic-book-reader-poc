"""Full-page thumbnails and labeled contact sheets, restricted to local work/."""

from contextlib import closing
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw

from comicpoc.corpus import ROOT, book_id


def contact_sheets(
    source: Path, output: Path, pages: list[int] | None = None
) -> list[Path]:
    if not output.resolve().is_relative_to((ROOT / "work").resolve()):
        raise ValueError(
            "Artwork output must be inside this repository's work/ directory"
        )
    output.mkdir(parents=True, exist_ok=True)
    written = []
    with pdfium.PdfDocument(source) as document:
        selected = pages if pages is not None else list(range(1, len(document) + 1))
        if not selected or any(n < 1 or n > len(document) for n in selected):
            raise ValueError(f"Pages must be between 1 and {len(document)}")
        for start in range(0, len(selected), 20):
            batch = selected[start : start + 20]
            sheet = Image.new("RGB", (1000, 330 * ((len(batch) + 3) // 4)), "#dddddd")
            draw = ImageDraw.Draw(sheet)
            for offset, number in enumerate(batch):
                with (
                    closing(document[number - 1]) as page,
                    closing(page.render(scale=1000 / max(page.get_size()))) as bitmap,
                ):
                    thumbnail = bitmap.to_pil().convert("RGB")
                thumbnail.save(
                    output / f"{book_id(source)}-p{number:03}.jpg", quality=88
                )
                thumbnail.thumbnail((240, 300))
                x, y = (offset % 4) * 250, (offset // 4) * 330
                sheet.paste(thumbnail, (x, y + 22))
                draw.text((x + 5, y + 4), f"PDF page {number}", fill="black")
            target = output / f"{book_id(source)}-sheet-{start // 20 + 1:02}.jpg"
            sheet.save(target, quality=90)
            written.append(target)
    return written
