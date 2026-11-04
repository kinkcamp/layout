#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import resource
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
sys.path.insert(0, str(PROJECT_ROOT))

from app.models.entities import LayoutFile  # noqa: E402
from app.services.geometry import GeometryService  # noqa: E402
from app.services.parser import PARSER_VERSION, read_metadata  # noqa: E402
from app.services.renderer import PillowRenderer  # noqa: E402


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while data := stream.read(4 * 1024 * 1024):
            digest.update(data)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark shared KLayout geometry and Pillow rendering services")
    parser.add_argument("layout", type=Path)
    parser.add_argument("--cell-index", type=int)
    parser.add_argument("--bbox", type=int, nargs=4, metavar=("L", "B", "R", "T"))
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--max-shapes", type=int, default=50000)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    path = args.layout.resolve()
    if not path.is_file():
        parser.error(f"not a file: {path}")
    parse_started = time.perf_counter()
    _, metadata, layers, cells = read_metadata(path)
    parse_seconds = time.perf_counter() - parse_started
    cell_index = args.cell_index if args.cell_index is not None else metadata["default_cell_index"]
    if cell_index is None:
        parser.error("layout has no top cell")
    cell = next((item for item in cells if item["cell_index"] == cell_index), None)
    if cell is None:
        parser.error(f"unknown cell index: {cell_index}")
    bbox = args.bbox or cell["bbox"]
    layout_file = LayoutFile(
        id="benchmark",
        project_id="benchmark",
        original_name=path.name,
        storage_path=str(path),
        format="GDSII",
        size_bytes=path.stat().st_size,
        total_chunks=1,
        chunk_size=path.stat().st_size,
        sha256=file_sha256(path),
        status="READY",
        parser_version=PARSER_VERSION,
        dbu_um=metadata["dbu_um"],
        created_by="benchmark",
    )
    geometry_started = time.perf_counter()
    geometry = GeometryService().first_shapes(layout_file, cell_index, bbox, None, args.max_shapes)
    geometry_seconds = time.perf_counter() - geometry_started
    layer_config = [
        {
            "layer_index": layer["layer_index"],
            "layer_number": layer["layer_number"],
            "datatype": layer["datatype"],
            "color": layer["default_color"],
            "opacity": 1.0,
            "visible": True,
        }
        for layer in layers
    ]
    render_started = time.perf_counter()
    image = PillowRenderer().render(
        geometry.shapes,
        bbox,
        args.width,
        args.height,
        layer_config,
        "#000000",
        20,
        {"title": "Benchmark", "scale": True, "coordinates": True, "legend": False},
        "Benchmark",
        metadata["dbu_um"],
    )
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        image.save(args.output, format="PNG")
    render_seconds = time.perf_counter() - render_started
    report = {
        "status": "ok",
        "file": str(path),
        "size_bytes": path.stat().st_size,
        "sha256": layout_file.sha256,
        "dbu_um": metadata["dbu_um"],
        "cell_count": metadata["cell_count"],
        "cell_index": cell_index,
        "bbox": bbox,
        "layer_count": len(layers),
        "parse_seconds": round(parse_seconds, 3),
        "geometry_seconds": round(geometry_seconds, 3),
        "shape_count": len(geometry.shapes),
        "observed_total": geometry.total,
        "truncated": geometry.truncated,
        "render_seconds": round(render_seconds, 3),
        "png_size": [image.width, image.height],
        "output": str(args.output.resolve()) if args.output else None,
        "max_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
