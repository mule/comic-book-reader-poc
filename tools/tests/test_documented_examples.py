"""The final report links these exact synthetic examples; no corpus is needed."""

import copy
import json

import pytest

from comicpoc.corpus import ROOT
from comicpoc.manifest import validate_annotations, validate_manifest


def test_documented_synthetic_examples():
    examples = ROOT / "docs/examples"
    manifest = json.loads((examples / "manifest.json").read_text())
    annotations = json.loads((examples / "annotations.json").read_text())
    validate_manifest(manifest)
    validate_annotations(annotations, manifest)
    # Prove validation is active, including cross-document identity checks.
    broken = copy.deepcopy(annotations)
    broken["source_sha256"] = "f" * 64
    with pytest.raises(ValueError):
        validate_annotations(broken, manifest)
    broken = copy.deepcopy(manifest)
    broken["schema_version"] = 999
    with pytest.raises(ValueError):
        validate_manifest(broken)
