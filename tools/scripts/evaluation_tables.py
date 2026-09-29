"""Produce report tables from saved run outputs, with no handwritten measurements."""

import json

from comicpoc.corpus import ROOT


def main():
    directory = ROOT / "work/bench"

    def read(name):
        return json.loads((directory / f"{name}.json").read_text())

    def book(value):
        if value.startswith("archer"):
            return "Archer & Armstrong"
        if value.startswith("harbinger"):
            return "Harbinger"
        return "Quantum and Woody"

    def viewport(value):
        return value.replace("desktop-", "Desktop ").replace(
            "tablet-emulation-", "Tablet EMULATION "
        )

    lines = []

    def table(title, headers, rows):
        lines.extend(
            [
                f"## {title}",
                "",
                "| " + " | ".join(headers) + " |",
                "| " + " | ".join(["---"] * len(headers)) + " |",
            ]
        )
        lines.extend("| " + " | ".join(map(str, row)) + " |" for row in rows)
        lines.append("")

    imports = read("import-benchmark")
    table(
        "Import and storage",
        [
            "Book",
            "Pages",
            "Source B",
            "Import s",
            "Page B min / mean / max",
            "Assets B",
            "Package B incl. metadata",
        ],
        [
            [
                book(b["book_id"]),
                b["pages"],
                b["source_bytes"],
                b["import_seconds"],
                f"{b['page_bytes_min']} / {b['page_bytes_mean']} / {b['page_bytes_max']}",
                b["asset_bytes_total"],
                b["package_bytes_total"],
            ]
            for b in imports["books"]
        ],
    )
    reader = read("reader-benchmark")
    table(
        "Page navigation",
        ["Book", "Viewport", "Cold decode ms", "Warm turns", "Warm p50 / p95 ms"],
        [
            [
                book(c["bookId"]),
                viewport(c["viewport"]),
                c["firstPageDecodeMs"],
                w["totalTurns"],
                f"{w['p50Ms']} / {w['p95Ms']}",
            ]
            for c, w in zip(reader["coldLoads"], reader["warmNavigations"], strict=True)
        ],
    )
    table(
        "Extended reading",
        [
            "Book",
            "Viewport",
            "Pages / requests",
            "PDF / test-data requests",
            "Max sampled DOM images",
            "Sampled JS heap MiB min / max / final",
            "Bounded prefetch",
        ],
        [
            [
                book(e["bookId"]),
                viewport(e["viewport"]),
                f"{e['pagesVisited']} / {e['pagesRequested']}",
                f"{e['pdfRequestsCount']} / {e['testDataRequestsCount']}",
                e["domPageImageCountMax"],
                f"{min(s['jsHeapUsedSizeMb'] for s in e['memorySamples'])} / {max(s['jsHeapUsedSizeMb'] for s in e['memorySamples'])} / {e['finalHeapUsedSizeMb']}",
                e["boundedPrefetchSatisfied"],
            ]
            for e in reader["extendedReadings"]
        ],
    )
    table(
        "Lost network after load",
        [
            "Book",
            "Viewport",
            "Cached page status",
            "Unvisited page / status",
            "Retry + previous buttons",
        ],
        [
            [
                book(o["bookId"]),
                viewport(o["viewport"]),
                o["cachedPage"]["status"],
                f"{o['unvisitedPage']['pdfPageNumber']} / {o['unvisitedPage']['status']}",
                o["unvisitedPage"]["retryButtonPresent"]
                and o["unvisitedPage"]["previousButtonPresent"],
            ]
            for o in reader["offlineObservations"]
        ],
    )
    guided = read("guided")
    assert guided["timestamp"] >= reader["timestamp"], (
        "Run standalone guided after bench"
    )
    table(
        "Guided navigation",
        ["Book", "Viewport", "Steps", "p50 / p95 ms"],
        [
            [
                book(g["bookId"]),
                viewport(g["viewport"]),
                len(g["samples"]),
                f"{g['p50Ms']} / {g['p95Ms']}",
            ]
            for g in guided["results"]
        ],
    )
    evidence = read("evidence")
    rows = []
    for r in evidence["detection_by_book"]:
        result = r["result"]
        totals = result["totals"]
        ops = sum(p["correction_effort"]["total"] for p in result["pages"])
        rows.append(
            [
                book(r["book_id"]),
                r["split"],
                len(result["pages"]),
                totals["matched"],
                totals["missed"],
                totals["spurious"],
                ops,
                totals["ordering_inversions"],
            ]
        )
    table(
        "Frozen detector results (extracted, not rerun)",
        [
            "Book",
            "Split",
            "Pages",
            "Matched",
            "Missed",
            "Spurious",
            "Estimated edit ops",
            "Matched ordering inversions",
        ],
        rows,
    )
    table(
        "Detector split totals",
        [
            "Split (all books)",
            "Reference regions",
            "Precision",
            "Recall",
            "Estimated ops / page",
        ],
        [
            [
                split,
                s["reference_regions"],
                f"{100 * s['precision']:.2f}%",
                f"{100 * s['recall']:.2f}%",
                f"{s['estimated_operations_per_page']:.2f}",
            ]
            for split, s in evidence["detection_splits"].items()
        ],
    )
    (directory / "tables.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
