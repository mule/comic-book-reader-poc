"""Command-line entry point."""

import argparse
import json
import sys
from pathlib import Path

from comicpoc.corpus import ROOT, check_inventory, inventory
from comicpoc.importer import RenderProfile, ThumbnailSettings, import_pdf
from comicpoc.manifest import validate_annotations, validate_package
from comicpoc.preview import contact_sheets
from comicpoc.representation import (
    format_benchmark_table,
    format_corpus_raster_distribution_table,
    format_dev_pages_raster_table,
    format_extraction_table,
    run_benchmark,
)


def main() -> int:
    parser = argparse.ArgumentParser(prog="comicpoc")
    commands = parser.add_subparsers(dest="command", required=True)
    inv = commands.add_parser("inventory", help="Record or check local PDF sources")
    inv.add_argument("--sources", type=Path, default=ROOT / "test-data")
    inv.add_argument("--output", type=Path, default=ROOT / "corpus/inventory.json")
    inv.add_argument("--check", action="store_true")
    preview = commands.add_parser(
        "contact-sheet", help="Render labeled previews under work/"
    )
    preview.add_argument("source", type=Path)
    preview.add_argument("--output", type=Path, default=ROOT / "work/contact-sheets")
    preview.add_argument(
        "--pages", type=int, nargs="+", help="One-based PDF page numbers; default all"
    )
    imp = commands.add_parser("import", help="Render a resumable standalone package")
    imp.add_argument("source", type=Path)
    imp.add_argument("--output", type=Path, default=ROOT / "work/packages")
    imp.add_argument("--book-id")
    imp.add_argument("--pages", nargs="+", type=int)
    imp.add_argument(
        "--profile", type=Path, help="JSON RenderProfile parameters (without id)"
    )
    val = commands.add_parser("validate", help="Verify package schema and every asset")
    val.add_argument("package", type=Path)
    val.add_argument("--annotations", type=Path)
    comp = commands.add_parser(
        "compare-representations",
        help="Compare resolutions and encodings on DEV pages",
    )
    comp.add_argument("--sources", type=Path, default=ROOT / "test-data")
    comp.add_argument(
        "--eval-split", type=Path, default=ROOT / "corpus/evaluation-split.json"
    )
    comp.add_argument("--inventory", type=Path, default=ROOT / "corpus/inventory.json")
    comp.add_argument("--output", type=Path, default=ROOT / "work/representation")
    comp.add_argument(
        "--pages", type=int, nargs="+", help="Specific PDF page numbers to evaluate"
    )
    comp.add_argument("--book", type=str, help="Specific book_id to evaluate")
    comp.add_argument(
        "--page-resolutions",
        type=int,
        nargs="+",
        help="Custom page resolutions for benchmark",
    )
    comp.add_argument(
        "--thumbnail-resolutions",
        type=int,
        nargs="+",
        help="Custom thumbnail resolutions for benchmark",
    )
    comp.add_argument(
        "--no-visuals", action="store_true", help="Skip generating visual crops/fits"
    )
    comp.add_argument(
        "--no-extraction",
        action="store_true",
        help="Skip direct image extraction audit",
    )
    args = parser.parse_args()
    try:
        if args.command == "import":
            params = json.loads(args.profile.read_text()) if args.profile else {}
            if "thumbnail" in params:
                params["thumbnail"] = ThumbnailSettings(**params["thumbnail"])
            print(
                import_pdf(
                    args.source,
                    args.output,
                    args.pages,
                    RenderProfile(**params),
                    args.book_id,
                )
            )
        elif args.command == "validate":
            manifest = validate_package(args.package)
            if args.annotations:
                validate_annotations(json.loads(args.annotations.read_text()), manifest)
            print(
                f"Valid package: {len(manifest['pages'])} pages ({manifest['selection']})"
            )
        elif args.command == "contact-sheet":
            for path in contact_sheets(args.source, args.output, args.pages):
                print(path)
        elif args.command == "compare-representations":
            results = run_benchmark(
                sources_dir=args.sources,
                eval_split_path=args.eval_split,
                inventory_path=args.inventory,
                output_dir=args.output,
                generate_visuals=not args.no_visuals,
                evaluate_extraction_audit=not args.no_extraction,
                page_resolutions=args.page_resolutions,
                thumbnail_resolutions=args.thumbnail_resolutions,
                selected_pages=args.pages,
                selected_book=args.book,
            )
            print("# Representation Benchmark Results\n")
            print(f"Evaluated {results['dev_page_count']} DEV pages.\n")
            if "corpus_distribution" in results:
                print("## Corpus-Wide Embedded Raster Distribution\n")
                print(
                    format_corpus_raster_distribution_table(
                        results["corpus_distribution"]
                    )
                )
                print()
            if "dev_pages_raster_info" in results:
                print("## DEV Pages Embedded Raster Resolutions\n")
                print(format_dev_pages_raster_table(results["dev_pages_raster_info"]))
                print()
            print("## Candidate Profile Measurements\n")
            print(format_benchmark_table(results))
            if results.get("extraction_results"):
                print("\n## Direct Embedded-Image Extraction Audit\n")
                print(format_extraction_table(results))
            if results.get("panel_crop_assessment"):
                pca = results["panel_crop_assessment"]
                print("\n## Cropped Panel Derivatives vs Full Page Baseline\n")
                print(
                    f"- Full page (WebP q85): {pca['full_page_bytes']} bytes ({pca['full_page_bytes'] / 1024:.1f} KB)"
                )
                print(
                    f"- Sum of {pca['panel_count']} panel crops: {pca['crops_total_bytes']} bytes ({pca['crops_total_bytes'] / 1024:.1f} KB)"
                )
                print(f"- Ratio (crops / full): {pca['ratio_crops_to_full']:.2%}")
            if results.get("visual_files"):
                print(
                    f"\nGenerated {len(results['visual_files'])} visual inspection files under {args.output}"
                )
            print(
                f"\nWrote full machine-readable JSON to {args.output / 'benchmark-results.json'}"
            )
        elif args.check:
            problems = check_inventory(
                args.sources, json.loads(args.output.read_text())
            )
            if problems:
                print("\n".join(problems), file=sys.stderr)
                return 1
            print("Inventory matches all sources")
        else:
            result = inventory(args.sources)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2) + "\n")
            print(f"Wrote {len(result['books'])} books to {args.output}")
    except (OSError, ValueError, RuntimeError, TypeError) as error:
        print(f"comicpoc: {error}", file=sys.stderr)
        return 1
    return 0
