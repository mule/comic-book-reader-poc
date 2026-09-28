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
    detect = commands.add_parser(
        "detect", help="Republish dev page assets with panel suggestions"
    )
    detect.add_argument("package", type=Path)
    detect.add_argument(
        "--output", type=Path, required=True, help="New package path under work/"
    )
    detect.add_argument(
        "--config", type=Path, default=ROOT / "corpus/detector-config.json"
    )
    detect.add_argument("--report", type=Path, required=True)
    detect.add_argument("--overlays", type=Path)
    evaluation = commands.add_parser(
        "evaluate-detection", help="Score suggestions against final manual references"
    )
    evaluation.add_argument("package", type=Path)
    evaluation.add_argument("--annotations", type=Path, required=True)
    evaluation.add_argument("--reference-manifest", type=Path, required=True)
    evaluation.add_argument("--output", type=Path, required=True)
    evaluation.add_argument("--iou-threshold", type=float, default=0.5)
    evaluation.add_argument("--resize-tolerance", type=float, default=0.01)
    for command in [detect, evaluation]:
        command.add_argument(
            "--eval-split", type=Path, default=ROOT / "corpus/evaluation-split.json"
        )
        command.add_argument("--split", choices=["dev", "heldout"], default="dev")
        command.add_argument(
            "--phase-b",
            action="store_true",
            help="Explicitly authorize held-out access",
        )
    args = parser.parse_args()
    try:
        if args.command in {"detect", "evaluate-detection"}:
            from comicpoc.detection import detect_package, load_config, overlays
            from comicpoc.detection_evaluation import evaluate
            from comicpoc.importer import write_json

            report_path = args.report if args.command == "detect" else args.output
            if not report_path.resolve().is_relative_to((ROOT / "work").resolve()):
                raise ValueError("Detection reports must stay under work/")
            if report_path.exists():
                raise ValueError("Report exists; choose a new report path")
            if report_path.resolve().is_relative_to(args.package.resolve()):
                raise ValueError("Report must be outside the input package")
            split = json.loads(args.eval_split.read_text())
            if args.command == "detect":
                if report_path.resolve().is_relative_to(args.output.resolve()):
                    raise ValueError("Report must be outside the output package")
                if args.overlays:
                    overlay_path = args.overlays.resolve()
                    for package_path in [args.package.resolve(), args.output.resolve()]:
                        if overlay_path.is_relative_to(
                            package_path
                        ) or package_path.is_relative_to(overlay_path):
                            raise ValueError("Overlays must be separate from packages")
                    if overlay_path.exists():
                        raise ValueError(
                            "Overlay output exists; choose a new directory"
                        )
                    if report_path.resolve().is_relative_to(overlay_path):
                        raise ValueError("Report must be outside overlays")
                if args.overlays and not args.overlays.resolve().is_relative_to(
                    (ROOT / "work").resolve()
                ):
                    raise ValueError("Overlays must stay under work/")
                target, report = detect_package(
                    args.package,
                    args.output,
                    load_config(args.config),
                    split,
                    args.split,
                    args.phase_b,
                )
                print(target)
            else:
                report = evaluate(
                    json.loads((args.package / "manifest.json").read_text()),
                    json.loads(args.annotations.read_text()),
                    json.loads(args.reference_manifest.read_text()),
                    split,
                    args.split,
                    args.phase_b,
                    args.iou_threshold,
                    args.resize_tolerance,
                )
            report_path.parent.mkdir(parents=True, exist_ok=True)
            write_json(report_path, report)
            print(report_path)
            if args.command == "detect" and args.overlays:
                overlays(target, args.overlays, split, args.split, args.phase_b)
        elif args.command == "import":
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
