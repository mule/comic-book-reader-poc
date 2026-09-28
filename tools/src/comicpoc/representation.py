"""Page representation benchmarks, direct extraction evaluation, and visual comparisons."""

import io
import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageDraw

from comicpoc.corpus import ROOT


@dataclass(frozen=True)
class CandidateProfile:
    name: str
    long_edge: int
    format: str
    quality: int | None = None
    lossless: bool = False
    is_thumbnail: bool = False
    is_native_raster: bool = False


@dataclass
class CandidateMeasurement:
    candidate_name: str
    long_edge: int
    format: str
    quality: int | None
    lossless: bool
    is_thumbnail: bool
    width: int
    height: int
    byte_size: int
    render_time_s: float
    encode_time_s: float
    total_time_s: float
    psnr_db: float
    mse: float
    is_native_raster: bool = False
    embedded_raster_long_edge: int | None = None


PAGE_RESOLUTIONS = [1600, 2400, 3056, 3840]
THUMBNAIL_RESOLUTIONS = [240, 360]


def build_page_candidates(
    resolutions: list[int] | None = None,
    include_native_raster: bool = True,
) -> list[CandidateProfile]:
    res_list = resolutions if resolutions is not None else PAGE_RESOLUTIONS
    candidates = []
    if include_native_raster:
        candidates.append(
            CandidateProfile(
                name="webp-q85-native-raster",
                long_edge=0,
                format="WEBP",
                quality=85,
                is_native_raster=True,
            )
        )
    for r in res_list:
        candidates.extend(
            [
                CandidateProfile(
                    name=f"png-{r}",
                    long_edge=r,
                    format="PNG",
                    lossless=True,
                ),
                CandidateProfile(
                    name=f"webp-lossless-{r}",
                    long_edge=r,
                    format="WEBP",
                    lossless=True,
                ),
                CandidateProfile(
                    name=f"webp-q92-{r}",
                    long_edge=r,
                    format="WEBP",
                    quality=92,
                ),
                CandidateProfile(
                    name=f"webp-q85-{r}",
                    long_edge=r,
                    format="WEBP",
                    quality=85,
                ),
                CandidateProfile(
                    name=f"webp-q75-{r}",
                    long_edge=r,
                    format="WEBP",
                    quality=75,
                ),
                CandidateProfile(
                    name=f"jpeg-q90-{r}",
                    long_edge=r,
                    format="JPEG",
                    quality=90,
                ),
            ]
        )
    return candidates


def build_thumbnail_candidates(
    resolutions: list[int] | None = None,
) -> list[CandidateProfile]:
    res_list = resolutions if resolutions is not None else THUMBNAIL_RESOLUTIONS
    candidates = []
    for r in res_list:
        candidates.extend(
            [
                CandidateProfile(
                    name=f"thumb-webp-q80-{r}",
                    long_edge=r,
                    format="WEBP",
                    quality=80,
                    is_thumbnail=True,
                ),
                CandidateProfile(
                    name=f"thumb-webp-q85-{r}",
                    long_edge=r,
                    format="WEBP",
                    quality=85,
                    is_thumbnail=True,
                ),
                CandidateProfile(
                    name=f"thumb-jpeg-q85-{r}",
                    long_edge=r,
                    format="JPEG",
                    quality=85,
                    is_thumbnail=True,
                ),
                CandidateProfile(
                    name=f"thumb-jpeg-q90-{r}",
                    long_edge=r,
                    format="JPEG",
                    quality=90,
                    is_thumbnail=True,
                ),
            ]
        )
    return candidates


def compute_psnr(reference: Image.Image, candidate: Image.Image) -> tuple[float, float]:
    """Compute PSNR (dB) and MSE between reference and candidate image.

    If candidate dimensions differ from reference, candidate is resampled
    to reference size using Lanczos interpolation.
    """
    if candidate.size != reference.size:
        candidate = candidate.resize(reference.size, Image.Resampling.LANCZOS)

    ref_arr = np.asarray(reference.convert("RGB"), dtype=np.float64)
    cand_arr = np.asarray(candidate.convert("RGB"), dtype=np.float64)

    mse = float(np.mean((ref_arr - cand_arr) ** 2))
    if mse == 0.0:
        return float("inf"), 0.0
    psnr = float(10.0 * np.log10((255.0**2) / mse))
    return psnr, mse


def render_page_at_long_edge(page: pdfium.PdfPage, long_edge: int) -> Image.Image:
    """Render a PDF page with its longest edge scaled to long_edge pixels."""
    pw, ph = page.get_size()
    max_pt = max(pw, ph)
    scale = long_edge / max_pt
    bitmap = page.render(scale=scale)
    try:
        return bitmap.to_pil().convert("RGB")
    finally:
        bitmap.close()


def encode_image(image: Image.Image, profile: CandidateProfile) -> bytes:
    """Encode PIL image according to candidate profile."""
    buffer = io.BytesIO()
    if profile.format == "PNG":
        image.save(buffer, format="PNG")
    elif profile.format == "WEBP":
        if profile.lossless:
            image.save(buffer, format="WEBP", lossless=True)
        else:
            image.save(buffer, format="WEBP", quality=profile.quality)
    elif profile.format == "JPEG":
        image.save(buffer, format="JPEG", quality=profile.quality)
    else:
        raise ValueError(f"Unsupported format: {profile.format}")
    return buffer.getvalue()


def measure_page(
    page: pdfium.PdfPage,
    candidates: list[CandidateProfile],
    native_long_edge: int = 3056,
    native_raster_edge: int | None = None,
) -> list[CandidateMeasurement]:
    """Render complete page at native baseline and candidate resolutions, recording metrics."""
    if native_raster_edge is None:
        images = [
            (img.get_metadata().width, img.get_metadata().height)
            for img in page.get_objects()
            if img.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE
        ]
        largest = max(images, key=lambda s: s[0] * s[1], default=None)
        native_raster_edge = max(largest) if largest else native_long_edge

    # Render native lossless reference
    ref_image = render_page_at_long_edge(page, native_long_edge)

    # Group candidates by actual render long_edge
    by_edge: dict[int, list[CandidateProfile]] = {}
    for cand in candidates:
        actual_edge = native_raster_edge if cand.is_native_raster else cand.long_edge
        by_edge.setdefault(actual_edge, []).append(cand)

    measurements = []
    for edge, profiles in by_edge.items():
        # Time the render once per resolution
        t_render_start = time.perf_counter()
        if edge == native_long_edge:
            rendered = ref_image
            t_render = 0.0  # Already rendered
        else:
            rendered = render_page_at_long_edge(page, edge)
            t_render = time.perf_counter() - t_render_start

        width, height = rendered.size

        for profile in profiles:
            t_encode_start = time.perf_counter()
            encoded_bytes = encode_image(rendered, profile)
            t_encode = time.perf_counter() - t_encode_start

            byte_size = len(encoded_bytes)
            total_time = t_render + t_encode

            # Decode and measure difference vs reference
            decoded = Image.open(io.BytesIO(encoded_bytes)).convert("RGB")
            psnr_val, mse_val = compute_psnr(ref_image, decoded)

            measurements.append(
                CandidateMeasurement(
                    candidate_name=profile.name,
                    long_edge=edge,
                    format=profile.format,
                    quality=profile.quality,
                    lossless=profile.lossless,
                    is_thumbnail=profile.is_thumbnail,
                    is_native_raster=profile.is_native_raster,
                    embedded_raster_long_edge=native_raster_edge,
                    width=width,
                    height=height,
                    byte_size=byte_size,
                    render_time_s=t_render,
                    encode_time_s=t_encode,
                    total_time_s=total_time,
                    psnr_db=psnr_val,
                    mse=mse_val,
                )
            )

    return measurements


def evaluate_direct_extraction(page: pdfium.PdfPage) -> dict:
    """Evaluate whether direct embedded image extraction preserves page composition."""
    pw, ph = page.get_size()
    objs = list(page.get_objects())
    img_objs = [o for o in objs if o.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE]
    text_objs = [o for o in objs if o.type == pdfium.raw.FPDF_PAGEOBJ_TEXT]
    path_objs = [o for o in objs if o.type == pdfium.raw.FPDF_PAGEOBJ_PATH]

    if len(img_objs) != 1:
        return {
            "qualifies": False,
            "reason": f"Expected exactly 1 image object, found {len(img_objs)}",
            "image_count": len(img_objs),
            "text_count": len(text_objs),
            "path_count": len(path_objs),
            "size_match": False,
            "max_pixel_diff": None,
            "mean_pixel_diff": None,
        }

    if text_objs:
        return {
            "qualifies": False,
            "reason": f"Page contains {len(text_objs)} PDF text objects omitted by extraction",
            "image_count": len(img_objs),
            "text_count": len(text_objs),
            "path_count": len(path_objs),
            "size_match": False,
            "max_pixel_diff": None,
            "mean_pixel_diff": None,
        }

    if path_objs:
        return {
            "qualifies": False,
            "reason": f"Page contains {len(path_objs)} vector path objects omitted by extraction",
            "image_count": len(img_objs),
            "text_count": len(text_objs),
            "path_count": len(path_objs),
            "size_match": False,
            "max_pixel_diff": None,
            "mean_pixel_diff": None,
        }

    img_obj = img_objs[0]
    bounds = img_obj.get_bounds()
    # Check if bounds match page box within 0.5 pt tolerance
    x0, y0, x1, y1 = bounds
    if abs(x0) > 0.5 or abs(y0) > 0.5 or abs(x1 - pw) > 0.5 or abs(y1 - ph) > 0.5:
        return {
            "qualifies": False,
            "reason": f"Image bounds ({x0:.1f}, {y0:.1f}, {x1:.1f}, {y1:.1f}) differ from page box (0, 0, {pw:.1f}, {ph:.1f}) (bleed/transform mismatch)",
            "image_count": len(img_objs),
            "text_count": len(text_objs),
            "path_count": len(path_objs),
            "size_match": False,
            "max_pixel_diff": None,
            "mean_pixel_diff": None,
        }

    # Extract bitmap
    bm = img_obj.get_bitmap()
    try:
        extracted = bm.to_pil().convert("RGB")
    finally:
        bm.close()

    ew, eh = extracted.size
    render_bm = page.render(scale=eh / ph).to_pil().convert("RGB")
    rw, rh = render_bm.size

    size_match = ew == rw and eh == rh
    if not size_match:
        return {
            "qualifies": False,
            "reason": f"Extracted dimensions ({ew}x{eh}) do not match page box render ({rw}x{rh})",
            "image_count": len(img_objs),
            "text_count": len(text_objs),
            "path_count": len(path_objs),
            "size_match": False,
            "max_pixel_diff": None,
            "mean_pixel_diff": None,
        }

    diff = np.abs(
        np.array(extracted, dtype=np.int16) - np.array(render_bm, dtype=np.int16)
    )
    max_diff = int(np.max(diff))
    mean_diff = float(np.mean(diff))

    if max_diff > 0:
        return {
            "qualifies": False,
            "reason": f"Pixel differences detected (max {max_diff}, mean {mean_diff:.2f})",
            "image_count": len(img_objs),
            "text_count": len(text_objs),
            "path_count": len(path_objs),
            "size_match": True,
            "max_pixel_diff": max_diff,
            "mean_pixel_diff": mean_diff,
        }

    return {
        "qualifies": True,
        "reason": "Single image covering page box without text, vector, or pixel differences",
        "image_count": 1,
        "text_count": 0,
        "path_count": 0,
        "size_match": True,
        "max_pixel_diff": 0,
        "mean_pixel_diff": 0.0,
    }


def compare_panel_crops_vs_full_page(
    page: pdfium.PdfPage,
    panel_boxes_fraction: list[tuple[float, float, float, float]],
    long_edge: int = 2400,
    quality: int = 85,
) -> dict:
    """Compare byte size of full page vs sum of individual panel crop derivatives.

    panel_boxes_fraction: list of (x0_frac, y0_frac, x1_frac, y1_frac) in normalized 0..1 coords.
    """
    full_img = render_page_at_long_edge(page, long_edge)
    w, h = full_img.size

    buf_full = io.BytesIO()
    full_img.save(buf_full, format="WEBP", quality=quality)
    full_bytes = len(buf_full.getvalue())

    crop_bytes_total = 0
    crops_info = []
    for i, (x0_f, y0_f, x1_f, y1_f) in enumerate(panel_boxes_fraction):
        box = (
            round(x0_f * w),
            round(y0_f * h),
            round(x1_f * w),
            round(y1_f * h),
        )
        cropped = full_img.crop(box)
        buf_crop = io.BytesIO()
        cropped.save(buf_crop, format="WEBP", quality=quality)
        cb = len(buf_crop.getvalue())
        crop_bytes_total += cb
        crops_info.append(
            {"panel_index": i + 1, "box": box, "bytes": cb, "size": cropped.size}
        )

    return {
        "full_page_bytes": full_bytes,
        "panel_count": len(panel_boxes_fraction),
        "crops_total_bytes": crop_bytes_total,
        "ratio_crops_to_full": crop_bytes_total / full_bytes if full_bytes else 0.0,
        "panels": crops_info,
    }


def generate_visual_inspection_samples(
    sources_dir: Path,
    output_dir: Path,
) -> list[Path]:
    """Generate panel-zoom crops and simulated viewport fits under output_dir."""
    if not output_dir.resolve().is_relative_to((ROOT / "work").resolve()):
        raise ValueError(
            "Artwork output must be inside this repository's work/ directory"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    generated_files = []

    # Selected pages and lettering regions for visual comparison:
    # 1. Archer & Armstrong p7 (5 horizontal panels, dialog in panel 1)
    # 2. Harbinger p34 (monochrome high-frequency line art, native 3056)
    # 3. Harbinger p44 (dark page with vector text)
    # 4. Quantum & Woody p10 (dense dialogue grid + intertitle)
    # 5. Quantum & Woody p37 (explosion + oversized sound effects)
    visual_targets = [
        {
            "book_name": "Archer  Armstrong Vol 1 The Michelangelo Code.pdf",
            "book_slug": "archer-armstrong",
            "pdf_page": 7,
            "label": "p007_dialogue",
            # Crop box in normalized fractions (x0, y0, x1, y1)
            "crop_frac": (0.28, 0.08, 0.88, 0.22),
            "description": "Dialogue balloons in top panel",
        },
        {
            "book_name": "Harbinger Vol 1 Omega Rising.pdf",
            "book_slug": "harbinger",
            "pdf_page": 34,
            "label": "p034_ink_detail",
            "crop_frac": (0.35, 0.40, 0.75, 0.60),
            "description": "Monochrome cross-hatching and ink linework",
        },
        {
            "book_name": "Harbinger Vol 1 Omega Rising.pdf",
            "book_slug": "harbinger",
            "pdf_page": 44,
            "label": "p044_vector_text",
            "crop_frac": (0.45, 0.50, 0.95, 0.70),
            "description": "Vector-rendered narration text on dark background",
        },
        {
            "book_name": "Quantum and Woody Vol 1 The Worlds Worst Superhero Team.pdf",
            "book_slug": "quantum-woody",
            "pdf_page": 10,
            "label": "p010_dense_grid",
            "crop_frac": (0.05, 0.15, 0.55, 0.35),
            "description": "Small dialogue lettering in conversation grid",
        },
        {
            "book_name": "Quantum and Woody Vol 1 The Worlds Worst Superhero Team.pdf",
            "book_slug": "quantum-woody",
            "pdf_page": 37,
            "label": "p037_sfx_explosion",
            "crop_frac": (0.20, 0.50, 0.80, 0.75),
            "description": "Sound effects and bright explosion artwork",
        },
    ]

    crops_dir = output_dir / "crops"
    fits_dir = output_dir / "viewports"
    crops_dir.mkdir(parents=True, exist_ok=True)
    fits_dir.mkdir(parents=True, exist_ok=True)

    # Candidate configurations to compare in visual crops
    visual_candidates = [
        CandidateProfile("1600-webp-q85", 1600, "WEBP", quality=85),
        CandidateProfile("2400-webp-q85", 2400, "WEBP", quality=85),
        CandidateProfile("3056-webp-q75", 3056, "WEBP", quality=75),
        CandidateProfile("3056-webp-q85", 3056, "WEBP", quality=85),
        CandidateProfile("3056-webp-q92", 3056, "WEBP", quality=92),
        CandidateProfile("3056-png-lossless", 3056, "PNG", lossless=True),
        CandidateProfile("3840-webp-q85", 3840, "WEBP", quality=85),
    ]

    for target in visual_targets:
        pdf_path = sources_dir / target["book_name"]
        if not pdf_path.is_file():
            continue

        with pdfium.PdfDocument(pdf_path) as doc:
            page = doc[target["pdf_page"] - 1]

            # 1. Panel-zoom detail crops for candidate profiles
            crop_images = []
            crop_labels = []
            x0f, y0f, x1f, y1f = target["crop_frac"]

            for cand in visual_candidates:
                rendered = render_page_at_long_edge(page, cand.long_edge)
                encoded = encode_image(rendered, cand)
                decoded = Image.open(io.BytesIO(encoded)).convert("RGB")

                dw, dh = decoded.size
                crop_box = (
                    round(x0f * dw),
                    round(y0f * dh),
                    round(x1f * dw),
                    round(y1f * dh),
                )
                crop_img = decoded.crop(crop_box)

                # Save individual crop
                fname = f"{target['book_slug']}-{target['label']}-{cand.name}.webp"
                crop_path = crops_dir / fname
                crop_img.save(crop_path, format="WEBP", quality=90)
                generated_files.append(crop_path)

                crop_images.append(crop_img)
                crop_labels.append(f"{cand.name} ({len(encoded) // 1024}KB)")

            # Create side-by-side comparison strip for key comparison (1600 vs 2400 vs 3056 vs 3840)
            # Resize crops to a common viewing height for side-by-side comparison
            target_h = 320
            resized_crops = []
            for c_img in crop_images:
                rw = round(c_img.width * (target_h / c_img.height))
                resized_crops.append(
                    c_img.resize((rw, target_h), Image.Resampling.LANCZOS)
                )

            strip_w = sum(img.width + 10 for img in resized_crops) + 10
            strip = Image.new("RGB", (strip_w, target_h + 35), "#222222")
            draw = ImageDraw.Draw(strip)
            cur_x = 10
            for r_img, label in zip(resized_crops, crop_labels, strict=False):
                strip.paste(r_img, (cur_x, 25))
                draw.text((cur_x + 4, 6), label, fill="#eeeeee")
                cur_x += r_img.width + 10

            strip_path = (
                crops_dir
                / f"{target['book_slug']}-{target['label']}-comparison-strip.png"
            )
            strip.save(strip_path)
            generated_files.append(strip_path)

            # 2. Simulated Viewport Fits:
            # - Desktop 1920x1080 @ 1x
            # - Tablet 1536x2048 @ 2x
            # - Tablet Pro 2048x2732 @ 2x
            viewports = [
                ("desktop-1920x1080", 1920, 1080),
                ("tablet-1536x2048", 1536, 2048),
                ("tabletpro-2048x2732", 2048, 2732),
            ]

            # Render at recommended profile: 2400 WebP q85
            p2400 = render_page_at_long_edge(page, 2400)
            encoded_p2400 = encode_image(
                p2400, CandidateProfile("2400", 2400, "WEBP", quality=85)
            )
            p2400_dec = Image.open(io.BytesIO(encoded_p2400)).convert("RGB")

            for vp_name, vp_w, vp_h in viewports:
                # Scale page to fit viewport with aspect ratio preserved
                pw, ph = p2400_dec.size
                scale = min(vp_w / pw, vp_h / ph)
                fit_w = round(pw * scale)
                fit_h = round(ph * scale)
                fitted_page = p2400_dec.resize((fit_w, fit_h), Image.Resampling.LANCZOS)

                vp_canvas = Image.new("RGB", (vp_w, vp_h), "#181818")
                paste_x = (vp_w - fit_w) // 2
                paste_y = (vp_h - fit_h) // 2
                vp_canvas.paste(fitted_page, (paste_x, paste_y))

                vp_path = (
                    fits_dir
                    / f"{target['book_slug']}-p{target['pdf_page']:03d}-{vp_name}.webp"
                )
                vp_canvas.save(vp_path, format="WEBP", quality=85)
                generated_files.append(vp_path)

    # 3. Native-Raster vs Upscaled Lettering & Artwork Comparisons:
    native_upscale_dir = output_dir / "native_vs_upscale_crops"
    native_upscale_dir.mkdir(parents=True, exist_ok=True)

    native_upscale_configs = [
        {
            "book_name": "Archer  Armstrong Vol 1 The Michelangelo Code.pdf",
            "pdf_page": 7,
            "native_res": 1532,
            "items": [
                {
                    "name": "aa_p7_lettering",
                    "crop_frac": (0.28, 0.08, 0.72, 0.22),
                    "title": "Archer p7 Lettering (Speech Balloon)",
                },
                {
                    "name": "aa_p7_artwork",
                    "crop_frac": (0.04, 0.82, 0.35, 0.98),
                    "title": "Archer p7 Artwork (Monk & Gun)",
                },
            ],
        },
        {
            "book_name": "Harbinger Vol 1 Omega Rising.pdf",
            "pdf_page": 11,
            "native_res": 1533,
            "items": [
                {
                    "name": "harb_p11_lettering",
                    "crop_frac": (0.40, 0.03, 0.85, 0.16),
                    "title": "Harbinger p11 Lettering (Speech Balloon)",
                },
                {
                    "name": "harb_p11_artwork",
                    "crop_frac": (0.05, 0.25, 0.45, 0.48),
                    "title": "Harbinger p11 Artwork (Peter Portrait)",
                },
            ],
        },
        {
            "book_name": "Quantum and Woody Vol 1 The Worlds Worst Superhero Team.pdf",
            "pdf_page": 10,
            "native_res": 1533,
            "items": [
                {
                    "name": "qw_p10_lettering",
                    "crop_frac": (0.08, 0.16, 0.50, 0.30),
                    "title": "Quantum & Woody p10 Lettering (Dense Dialogue)",
                },
                {
                    "name": "qw_p10_artwork",
                    "crop_frac": (0.55, 0.40, 0.92, 0.65),
                    "title": "Quantum & Woody p10 Artwork (Woody at Desk)",
                },
            ],
        },
    ]

    for cfg in native_upscale_configs:
        pdf_path = sources_dir / cfg["book_name"]
        if not pdf_path.is_file():
            continue
        with pdfium.PdfDocument(pdf_path) as doc:
            page = doc[cfg["pdf_page"] - 1]
            n_res = cfg["native_res"]
            renders = {
                f"native ({n_res}px)": render_page_at_long_edge(page, n_res),
                "2400px (rec)": render_page_at_long_edge(page, 2400),
                "3056px (upscaled)": render_page_at_long_edge(page, 3056),
            }
            for item in cfg["items"]:
                x0f, y0f, x1f, y1f = item["crop_frac"]
                target_h = 350
                resized_crops = []
                labels = []
                for label, full_img in renders.items():
                    w, h = full_img.size
                    box = (
                        round(x0f * w),
                        round(y0f * h),
                        round(x1f * w),
                        round(y1f * h),
                    )
                    crop_img = full_img.crop(box)
                    rw = round(crop_img.width * (target_h / crop_img.height))
                    resized_crops.append(
                        crop_img.resize((rw, target_h), Image.Resampling.LANCZOS)
                    )
                    labels.append(f"{label} - {crop_img.width}x{crop_img.height}")

                strip_w = sum(img.width + 10 for img in resized_crops) + 10
                strip = Image.new("RGB", (strip_w, target_h + 35), "#222222")
                draw = ImageDraw.Draw(strip)
                cur_x = 10
                for r_img, lbl in zip(resized_crops, labels, strict=False):
                    strip.paste(r_img, (cur_x, 25))
                    draw.text((cur_x + 4, 6), lbl, fill="#eeeeee")
                    cur_x += r_img.width + 10

                strip_path = native_upscale_dir / f"{item['name']}_comparison.png"
                strip.save(strip_path)
                generated_files.append(strip_path)

    return generated_files


def analyze_corpus_raster_distribution(inventory_path: Path) -> dict:
    """Analyze embedded raster resolutions across the corpus from inventory.json."""
    with inventory_path.open() as f:
        inv = json.load(f)

    books_summary = []
    total_pages = 0
    corpus_counts = {
        "covers_3056": 0,
        "story_1533": 0,
        "spread_1993": 0,
        "low_res": 0,
    }
    all_edge_counts: dict[int, int] = {}

    for b in inv["books"]:
        p_count = len(b["pages"])
        total_pages += p_count
        b_counts = {
            "covers_3056": 0,
            "story_1533": 0,
            "spread_1993": 0,
            "low_res": 0,
        }
        for p in b["pages"]:
            lip = p.get("largest_image_pixels")
            le = max(lip) if lip else None
            if le is not None:
                all_edge_counts[le] = all_edge_counts.get(le, 0) + 1
            if le is None:
                b_counts["low_res"] += 1
            elif le >= 3000:
                b_counts["covers_3056"] += 1
            elif le == 1993:
                b_counts["spread_1993"] += 1
            elif 1200 <= le <= 1700:
                b_counts["story_1533"] += 1
            else:
                b_counts["low_res"] += 1
        for k, v in b_counts.items():
            corpus_counts[k] += v
        books_summary.append(
            {
                "book_id": b["book_id"],
                "page_count": p_count,
                **b_counts,
            }
        )

    return {
        "total_books": len(inv["books"]),
        "total_pages": total_pages,
        "books": books_summary,
        "corpus_counts": corpus_counts,
        "all_edge_counts": dict(sorted(all_edge_counts.items())),
    }


def format_corpus_raster_distribution_table(dist: dict) -> str:
    """Format corpus raster resolution distribution as a Markdown table."""
    lines = [
        "| Book ID | ~1500–1633 px (Story) | ~3056 px (Covers/Splash) | 1993 px (Spread) | <1000 px (Spot/Ad) | Total Pages |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for b in dist["books"]:
        s_pct = (b["story_1533"] / b["page_count"]) * 100
        c_pct = (b["covers_3056"] / b["page_count"]) * 100
        lines.append(
            f"| `{b['book_id']}` | {b['story_1533']} ({s_pct:.1f}%) | {b['covers_3056']} ({c_pct:.1f}%) | {b['spread_1993']} | {b['low_res']} | {b['page_count']} |"
        )
    cc = dist["corpus_counts"]
    tp = dist["total_pages"]
    lines.append(
        f"| **Corpus Total** | **{cc['story_1533']} ({(cc['story_1533'] / tp) * 100:.1f}%)** | **{cc['covers_3056']} ({(cc['covers_3056'] / tp) * 100:.1f}%)** | **{cc['spread_1993']} ({(cc['spread_1993'] / tp) * 100:.1f}%)** | **{cc['low_res']} ({(cc['low_res'] / tp) * 100:.1f}%)** | **{tp} (100.0%)** |"
    )
    return "\n".join(lines)


def format_dev_pages_raster_table(dev_raster_info: list[dict]) -> str:
    """Format DEV pages raster resolution audit as a Markdown table."""
    lines = [
        "| Book ID | PDF Page | Embedded Raster | Long Edge (px) | Has PDF Text | Category |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for p in dev_raster_info:
        r_str = (
            f"{p['embedded_raster_size'][0]}x{p['embedded_raster_size'][1]}"
            if p["embedded_raster_size"]
            else "None"
        )
        le = p["embedded_raster_long_edge"]
        cat = (
            "Story (~1533)"
            if le and 1200 <= le <= 1700
            else (
                "Cover/Splash (3056)"
                if le and le >= 3000
                else ("Spread (1993)" if le == 1993 else "Spot/Ad")
            )
        )
        lines.append(
            f"| `{p['book_id']}` | {p['pdf_page_number']} | {r_str} | {le} | {'Yes' if p['has_text_objects'] else 'No'} | {cat} |"
        )
    return "\n".join(lines)


def run_benchmark(
    sources_dir: Path,
    eval_split_path: Path,
    inventory_path: Path,
    output_dir: Path,
    generate_visuals: bool = True,
    evaluate_extraction_audit: bool = True,
    page_resolutions: list[int] | None = None,
    thumbnail_resolutions: list[int] | None = None,
    selected_pages: list[int] | None = None,
    selected_book: str | None = None,
) -> dict:
    """Run representation comparison across DEV pages."""
    if not output_dir.resolve().is_relative_to((ROOT / "work").resolve()):
        raise ValueError(
            "Artwork output must be inside this repository's work/ directory"
        )
    output_dir.mkdir(parents=True, exist_ok=True)

    with eval_split_path.open() as f:
        eval_data = json.load(f)
    with inventory_path.open() as f:
        inv_data = json.load(f)

    corpus_distribution = analyze_corpus_raster_distribution(inventory_path)
    inv_books = {
        b["book_id"]: {p["pdf_page_number"]: p for p in b["pages"]}
        for b in inv_data["books"]
    }

    book_sources = {b["book_id"]: b["source"] for b in inv_data["books"]}
    dev_pages = [p for p in eval_data["pages"] if p["split"] == "dev"]

    if selected_book:
        dev_pages = [p for p in dev_pages if p["book_id"] == selected_book]
    if selected_pages:
        dev_pages = [p for p in dev_pages if p["pdf_page_number"] in selected_pages]

    if not dev_pages:
        raise ValueError("No matching DEV pages found for benchmark")

    page_candidates = build_page_candidates(page_resolutions)
    thumb_candidates = build_thumbnail_candidates(thumbnail_resolutions)
    all_candidates = page_candidates + thumb_candidates

    per_page_measurements = []
    extraction_results = []
    dev_pages_raster_info = []

    # Cache open documents
    open_docs: dict[str, pdfium.PdfDocument] = {}
    try:
        for item in dev_pages:
            bid = item["book_id"]
            pnum = item["pdf_page_number"]
            source_file = book_sources[bid]
            pdf_path = sources_dir / source_file

            p_inv = inv_books.get(bid, {}).get(pnum, {})
            lip = p_inv.get("largest_image_pixels")
            raster_edge = max(lip) if lip else None
            dev_pages_raster_info.append(
                {
                    "book_id": bid,
                    "pdf_page_number": pnum,
                    "embedded_raster_size": lip,
                    "embedded_raster_long_edge": raster_edge,
                    "has_text_objects": p_inv.get("has_text_objects", False),
                }
            )

            if bid not in open_docs:
                open_docs[bid] = pdfium.PdfDocument(pdf_path)
            doc = open_docs[bid]
            page = doc[pnum - 1]

            # Measure representation candidates
            page_measurements = measure_page(
                page,
                all_candidates,
                native_long_edge=3056,
                native_raster_edge=raster_edge,
            )
            for m in page_measurements:
                per_page_measurements.append(
                    {
                        "book_id": bid,
                        "pdf_page_number": pnum,
                        **asdict(m),
                    }
                )

            # Evaluate direct extraction
            if evaluate_extraction_audit:
                ext_res = evaluate_direct_extraction(page)
                extraction_results.append(
                    {
                        "book_id": bid,
                        "pdf_page_number": pnum,
                        **ext_res,
                    }
                )

        # Aggregate statistics per candidate profile
        candidates_summary = []
        by_cand: dict[str, list[dict]] = {}
        for m in per_page_measurements:
            by_cand.setdefault(m["candidate_name"], []).append(m)

        for c_name, measurements in by_cand.items():
            first = measurements[0]
            avg_bytes = float(np.mean([m["byte_size"] for m in measurements]))
            total_bytes_dev = int(sum(m["byte_size"] for m in measurements))
            avg_render_time = float(np.mean([m["render_time_s"] for m in measurements]))
            avg_encode_time = float(np.mean([m["encode_time_s"] for m in measurements]))
            avg_total_time = float(np.mean([m["total_time_s"] for m in measurements]))

            psnr_vals = [m["psnr_db"] for m in measurements]
            avg_psnr = (
                float(np.mean(psnr_vals))
                if all(np.isfinite(psnr_vals))
                else float("inf")
            )

            # Project corpus size for 389 pages
            corpus_size_mb = (avg_bytes * 389) / (1024 * 1024)

            candidates_summary.append(
                {
                    "candidate_name": c_name,
                    "long_edge": first["long_edge"]
                    if not first.get("is_native_raster")
                    else "native-raster",
                    "format": first["format"],
                    "quality": first["quality"],
                    "lossless": first["lossless"],
                    "is_thumbnail": first["is_thumbnail"],
                    "is_native_raster": first.get("is_native_raster", False),
                    "avg_bytes_per_page": avg_bytes,
                    "total_bytes_dev_pages": total_bytes_dev,
                    "avg_render_time_s": avg_render_time,
                    "avg_encode_time_s": avg_encode_time,
                    "avg_total_time_s": avg_total_time,
                    "avg_psnr_db": avg_psnr,
                    "corpus_projected_mb": corpus_size_mb,
                }
            )

        # Assess panel crops vs full page on representative page
        # Archer & Armstrong p7: 5 horizontal stacked panels
        panel_crop_assessment = None
        if "archer-armstrong-vol-1-the-michelangelo-code" in open_docs:
            aa_doc = open_docs["archer-armstrong-vol-1-the-michelangelo-code"]
            p7 = aa_doc[6]
            panel_boxes = [
                (0.0, 0.0, 1.0, 0.20),
                (0.0, 0.20, 1.0, 0.40),
                (0.0, 0.40, 1.0, 0.60),
                (0.0, 0.60, 1.0, 0.80),
                (0.0, 0.80, 1.0, 1.0),
            ]
            panel_crop_assessment = compare_panel_crops_vs_full_page(p7, panel_boxes)

        visual_files = []
        if generate_visuals:
            visual_files = [
                str(p.relative_to(ROOT))
                for p in generate_visual_inspection_samples(sources_dir, output_dir)
            ]

        results = {
            "dev_page_count": len(dev_pages),
            "corpus_distribution": corpus_distribution,
            "dev_pages_raster_info": dev_pages_raster_info,
            "candidates_summary": candidates_summary,
            "extraction_results": extraction_results,
            "panel_crop_assessment": panel_crop_assessment,
            "visual_files": visual_files,
            "per_page_measurements": per_page_measurements,
        }

        # Write results JSON
        json_path = output_dir / "benchmark-results.json"
        json_path.write_text(json.dumps(results, indent=2) + "\n")
        return results

    finally:
        for doc in open_docs.values():
            doc.close()


def format_benchmark_table(results: dict) -> str:
    """Format benchmark candidates summary as a Markdown table."""
    lines = [
        "| Candidate | Res (px) | Format | Lossless/Q | Avg KB/Page | Dev MB | Corpus (389p) MB | Render (s) | Encode (s) | Total (s) | PSNR (dB) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for c in results["candidates_summary"]:
        q_str = "lossless" if c["lossless"] else f"q={c['quality']}"
        avg_kb = c["avg_bytes_per_page"] / 1024
        dev_mb = c["total_bytes_dev_pages"] / (1024 * 1024)
        corp_mb = c["corpus_projected_mb"]
        psnr_str = (
            "inf" if not np.isfinite(c["avg_psnr_db"]) else f"{c['avg_psnr_db']:.2f}"
        )
        res_str = "native-raster" if c.get("is_native_raster") else str(c["long_edge"])
        lines.append(
            f"| `{c['candidate_name']}` | {res_str} | {c['format']} | {q_str} | {avg_kb:.1f} KB | {dev_mb:.2f} MB | {corp_mb:.1f} MB | {c['avg_render_time_s']:.3f} | {c['avg_encode_time_s']:.3f} | {c['avg_total_time_s']:.3f} | {psnr_str} |"
        )
    return "\n".join(lines)


def format_extraction_table(results: dict) -> str:
    """Format direct extraction audit as a Markdown table."""
    lines = [
        "| Book ID | Page | Images | Text Objs | Path Objs | Size Match | Max Diff | Qualifies | Reason |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in results["extraction_results"]:
        q_str = "**YES**" if r["qualifies"] else "NO"
        max_d = str(r["max_pixel_diff"]) if r["max_pixel_diff"] is not None else "N/A"
        sm_str = "Yes" if r["size_match"] else "No"
        lines.append(
            f"| `{r['book_id']}` | {r['pdf_page_number']} | {r['image_count']} | {r['text_count']} | {r['path_count']} | {sm_str} | {max_d} | {q_str} | {r['reason']} |"
        )
    return "\n".join(lines)
