"""Command-line entry point."""

import argparse
import json
import sys
from pathlib import Path

from comicpoc.corpus import ROOT, check_inventory, inventory
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
    args = parser.parse_args()
    try:
        if args.command == "contact-sheet":
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
    except (OSError, ValueError, RuntimeError) as error:
        print(f"comicpoc: {error}", file=sys.stderr)
        return 1
    return 0
