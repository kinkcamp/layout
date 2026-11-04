#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import resource
import sys
import time
from importlib.metadata import version
from pathlib import Path

import klayout.db as kdb


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while data := stream.read(4 * 1024 * 1024):
            digest.update(data)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify KLayout and summarize a GDSII/OASIS file")
    parser.add_argument("layout", type=Path)
    parser.add_argument("--full-top-cells", action="store_true")
    args = parser.parse_args()
    path = args.layout.resolve()
    if not path.is_file():
        parser.error(f"not a file: {path}")
    started = time.perf_counter()
    layout = kdb.Layout()
    layout.read(str(path))
    tops = []
    for cell in layout.top_cells():
        box = cell.bbox()
        tops.append(
            {
                "name": cell.name,
                "cell_index": cell.cell_index(),
                "bbox": [box.left, box.bottom, box.right, box.top],
            }
        )
    default = max(
        tops,
        key=lambda item: max(0, item["bbox"][2] - item["bbox"][0])
        * max(0, item["bbox"][3] - item["bbox"][1]),
        default=None,
    )
    report = {
        "status": "ok",
        "python": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "klayout": version("klayout"),
        "file": str(path),
        "size_bytes": path.stat().st_size,
        "sha256": sha256(path),
        "dbu_um": layout.dbu,
        "cell_count": layout.cells(),
        "top_cell_count": len(tops),
        "top_cells": tops if args.full_top_cells else tops[:20],
        "top_cells_omitted": 0 if args.full_top_cells else max(0, len(tops) - 20),
        "default_cell": default,
        "layers": [
            {
                "layer_index": index,
                "layer_number": layout.get_info(index).layer,
                "datatype": layout.get_info(index).datatype,
                "name": layout.get_info(index).name,
            }
            for index in layout.layer_indexes()
        ],
        "read_seconds": round(time.perf_counter() - started, 3),
        "max_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
