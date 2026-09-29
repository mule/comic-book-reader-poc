"""Snapshot reproducibility inputs and extract frozen detection results, never rerun detection."""

import hashlib
import importlib.metadata
import json
import platform
import subprocess

import pypdfium2.version

from comicpoc.corpus import ROOT


def main():
    def command(*args):
        return subprocess.check_output(args, cwd=ROOT, text=True).strip()

    source = ROOT / "corpus/detection-results-phase-b.json"
    detection = json.loads(source.read_text())
    tracked = command("git", "ls-files").splitlines()
    evidence = {
        "base_commit": command("git", "rev-parse", "HEAD"),
        "python": platform.python_version(),
        "pdfium": str(pypdfium2.version.PDFIUM_INFO),
        "js_packages": {
            name: json.loads(
                command("pnpm", "--dir", name, "list", "--depth", "0", "--json")
            )
            for name in ["reader", "bench"]
        },
        "node": command("node", "--version"),
        "pnpm": command("pnpm", "--version"),
        "python_packages": {
            p: importlib.metadata.version(p)
            for p in ["pypdfium2", "Pillow", "jsonschema", "opencv-python-headless"]
        },
        "artwork_tracked": [
            p
            for p in tracked
            if p.lower().endswith((".pdf", ".webp", ".png", ".jpg", ".jpeg", ".gif"))
        ],
        "detection_source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "detection_original_base": detection["base_commit"],
        "detection_annotator": detection["annotator"],
        "detection_splits": detection["splits"],
        "detection_by_book": [
            {
                "split": r["split"],
                "book_id": r["book_id"],
                "result": r["evaluation"]["splits"][r["split"]],
            }
            for r in detection["runs"]
        ],
    }
    output = ROOT / "work/bench/evidence.json"
    output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(output)


if __name__ == "__main__":
    main()
