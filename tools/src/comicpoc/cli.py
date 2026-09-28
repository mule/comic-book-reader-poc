"""Command-line entry point."""

import argparse
import json
import sys
from pathlib import Path

from comicpoc.corpus import ROOT, check_inventory, inventory
from comicpoc.importer import RenderProfile, ThumbnailSettings, import_pdf
from comicpoc.manifest import validate_annotations, validate_package
from comicpoc.preview import contact_sheets


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
