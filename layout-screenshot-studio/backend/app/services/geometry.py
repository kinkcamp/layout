from __future__ import annotations

from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import klayout.db as kdb

from app.core.errors import AppError
from app.models import LayoutFile

from .layout_cache import layout_cache


def _number(value: float) -> int | float:
    rounded = round(value)
    return int(rounded) if abs(value - rounded) < 1e-7 else float(value)


def _points(points) -> list[list[int | float]]:
    return [[_number(point.x), _number(point.y)] for point in points]


def _kind(shape) -> str:
    if shape.is_text():
        return "text"
    if shape.is_box():
        return "box"
    if shape.is_path():
        return "path"
    return "polygon"


@dataclass
class GeometryResult:
    shapes: list[dict[str, Any]]
    total: int
    truncated: bool
    stats: dict[str, Any]


class GeometryService:
    """Read-only KLayout region queries; hierarchy is traversed without flattening."""

    def _iter_layer(
        self,
        layout: kdb.Layout,
        cell_index: int,
        layer_index: int,
        bbox: list[int] | tuple[int, int, int, int],
        recursive: bool,
    ) -> Iterator[tuple[Any, Any]]:
        cell = layout.cell(cell_index)
        if cell is None:
            raise AppError("CELL_NOT_FOUND", "Cell index does not exist", 404)
        region = kdb.Box(*bbox)
        if recursive:
            iterator = layout.begin_shapes_overlapping(cell_index, layer_index, region)
            while not iterator.at_end():
                yield iterator.shape(), iterator.trans()
                iterator.next()
        else:
            for shape in cell.shapes(layer_index).each_overlapping(region):
                yield shape, kdb.ICplxTrans()

    def query(
        self,
        layout_file: LayoutFile,
        cell_index: int,
        bbox: list[int] | tuple[int, int, int, int],
        layers: list[int] | None,
        recursive: bool = True,
        offset: int = 0,
        limit: int = 100,
        scan_limit: int = 100_000,
    ) -> GeometryResult:
        with layout_cache.acquire(layout_file) as layout:
            return self._query_layout(layout, cell_index, bbox, layers, recursive, offset, limit, scan_limit)

    def _query_layout(
        self,
        layout: kdb.Layout,
        cell_index: int,
        bbox: list[int] | tuple[int, int, int, int],
        layers: list[int] | None,
        recursive: bool,
        offset: int,
        limit: int,
        scan_limit: int,
    ) -> GeometryResult:
        if layout.cell(cell_index) is None:
            raise AppError("CELL_NOT_FOUND", "Cell index does not exist", 404)
        available = list(layout.layer_indexes())
        selected = available if layers is None else layers
        unknown = sorted(set(selected) - set(available))
        if unknown:
            raise AppError("INVALID_LAYERS", "Unknown KLayout layer indexes", 422, {"layer_indexes": unknown})
        layer_infos = {index: layout.get_info(index) for index in selected}
        shapes: list[dict[str, Any]] = []
        layer_counts: Counter[int] = Counter()
        kind_counts: Counter[str] = Counter()
        matched = 0
        truncated = False
        stop = False
        for layer_index in selected:
            info = layer_infos[layer_index]
            for shape, trans in self._iter_layer(layout, cell_index, layer_index, bbox, recursive):
                if matched >= scan_limit:
                    truncated = True
                    stop = True
                    break
                kind = _kind(shape)
                layer_counts[layer_index] += 1
                kind_counts[kind] += 1
                if offset <= matched < offset + limit:
                    base = {
                        "layer_index": int(layer_index),
                        "layer_number": int(info.layer),
                        "datatype": int(info.datatype),
                        "kind": kind,
                    }
                    if kind == "text":
                        text = shape.text.transformed(trans)
                        base.update(
                            polygons=[],
                            text=text.string,
                            position=[_number(text.x), _number(text.y)],
                        )
                    else:
                        polygon = shape.polygon
                        if polygon is None:
                            matched += 1
                            continue
                        transformed = polygon.transformed(trans)
                        base["polygons"] = [
                            {
                                "hull": _points(transformed.each_point_hull()),
                                "holes": [
                                    _points(transformed.each_point_hole(hole))
                                    for hole in range(transformed.holes())
                                ],
                            }
                        ]
                    shapes.append(base)
                matched += 1
                if matched >= offset + limit and limit == 0:
                    break
            if stop:
                break
        if matched >= scan_limit:
            truncated = True
        return GeometryResult(
            shapes=shapes,
            total=matched,
            truncated=truncated,
            stats={
                "by_layer": [
                    {
                        "layer_index": int(index),
                        "layer_number": int(layer_infos[index].layer),
                        "datatype": int(layer_infos[index].datatype),
                        "count": int(count),
                    }
                    for index, count in sorted(layer_counts.items())
                ],
                "by_kind": dict(sorted(kind_counts.items())),
                "scan_limit": scan_limit,
                "total_is_lower_bound": truncated,
            },
        )

    def first_shapes(
        self,
        layout_file: LayoutFile,
        cell_index: int,
        bbox: list[int] | tuple[int, int, int, int],
        layers: list[int] | None,
        max_shapes: int,
    ) -> GeometryResult:
        result = self.query(
            layout_file,
            cell_index,
            bbox,
            layers,
            recursive=True,
            offset=0,
            limit=max_shapes,
            scan_limit=max_shapes + 1,
        )
        result.truncated = result.total > max_shapes
        result.shapes = result.shapes[:max_shapes]
        return result
