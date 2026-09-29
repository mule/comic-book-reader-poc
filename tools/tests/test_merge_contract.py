"""Cross-language merge contract; reader vitest reads this same fixture."""

import json

import pytest

from comicpoc.corpus import ROOT
from comicpoc.manifest import effective_regions


@pytest.mark.parametrize(
    "case",
    json.loads((ROOT / "format/merge-cases.json").read_text()),
    ids=lambda case: case["name"],
)
def test_shared_merge_contract(case):
    assert effective_regions(case["page"], case["override"]) == case["expected"]
