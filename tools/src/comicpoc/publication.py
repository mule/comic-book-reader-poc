"""Publish a new immutable revision; never replace a package in place."""

import copy
import fcntl
import json
import shutil
import tempfile
from pathlib import Path

from comicpoc.corpus import ROOT, fingerprint
from comicpoc.importer import write_json
from comicpoc.manifest import validate_package


def without_suggestions(manifest: dict) -> dict:
    result = copy.deepcopy(manifest)
    for page in result["pages"]:
        page.pop("suggestions", None)
    return result


def republish(source: Path, target: Path, original: dict, updated: dict) -> Path:
    if without_suggestions(original) != without_suggestions(updated):
        raise ValueError("Republish may change suggestions only")
    source, target = source.resolve(), target.resolve()
    if not target.is_relative_to((ROOT / "work").resolve()):
        raise ValueError("Published artwork must stay under work/")
    if (
        target == source
        or target.is_relative_to(source)
        or source.is_relative_to(target)
    ):
        raise ValueError("Republish requires a separate new package path")
    target.parent.mkdir(parents=True, exist_ok=True)
    with (target.parent / f".{target.name}.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.exists():
            raise ValueError("Output already exists; choose a new revision path")
        # Reject symlinks in metadata too; copy bytes, never hardlink mutable files.
        if any(p.is_symlink() for p in source.rglob("*")):
            raise ValueError("Republish refuses package symlinks")
        before = {
            str(p.relative_to(source)): fingerprint(p)
            for p in source.rglob("*")
            if p.is_file()
        }
        stage = Path(
            tempfile.mkdtemp(prefix=f".{target.name}.staging-", dir=target.parent)
        )
        try:
            shutil.copytree(source, stage, dirs_exist_ok=True)
            if json.loads((stage / "manifest.json").read_text()) != original:
                raise ValueError("Source manifest changed during detection")
            for name, digest in before.items():
                if fingerprint(stage / name) != digest:
                    raise ValueError(f"Source changed during copy: {name}")
            write_json(stage / "manifest.json", updated)
            write_json(stage / "COMPLETE.json", fingerprint(stage / "manifest.json"))
            validate_package(stage)
            after = {
                str(p.relative_to(source)): fingerprint(p)
                for p in source.rglob("*")
                if p.is_file()
            }
            if before != after:
                raise ValueError("Source package changed during republish")
            stage.rename(target)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    return target
