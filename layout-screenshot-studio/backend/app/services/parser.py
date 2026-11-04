from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import klayout.db as kdb
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.logging import log_event
from app.models import LayoutCell, LayoutFile, LayoutLayer

import logging

logger = logging.getLogger(__name__)
PARSER_VERSION = f"klayout-{version('klayout')}"
COLORS = (
    "#E6194B", "#3CB44B", "#FFE119", "#4363D8", "#F58231", "#911EB4",
    "#46F0F0", "#F032E6", "#BCF60C", "#FABEBE", "#008080", "#E6BEFF",
    "#9A6324", "#FFFAC8", "#800000", "#AAFFC3", "#808000", "#FFD8B1",
    "#000075", "#808080", "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
)


def box_list(box) -> list[int]:
    return [int(box.left), int(box.bottom), int(box.right), int(box.top)]


def transform_summary(trans) -> dict[str, Any]:
    angle = getattr(trans, "angle", 0)
    if isinstance(trans, kdb.Trans):
        angle = angle * 90
    return {
        "text": trans.to_s(),
        "rotation_deg": float(angle),
        "mirror": bool(trans.is_mirror()),
        "magnification": float(getattr(trans, "mag", 1.0)),
        "displacement": [int(trans.disp.x), int(trans.disp.y)],
    }


def instance_array_summary(instance) -> dict[str, Any]:
    if not instance.is_regular_array():
        return {"is_array": False, "rows": 1, "columns": 1, "a": [0, 0], "b": [0, 0]}
    return {
        "is_array": True,
        "rows": int(instance.nb),
        "columns": int(instance.na),
        "a": [int(instance.a.x), int(instance.a.y)],
        "b": [int(instance.b.x), int(instance.b.y)],
    }


def summarize_children(cell) -> tuple[int, list[dict[str, Any]]]:
    grouped: dict[int, dict[str, Any]] = {}
    placement_count = 0
    for instance in cell.each_inst():
        placement_count += 1
        child_index = int(instance.cell_index)
        array = instance_array_summary(instance)
        count = int(array["rows"]) * int(array["columns"])
        trans = instance.cplx_trans if instance.is_complex() else instance.trans
        item = grouped.setdefault(
            child_index,
            {
                "cell_index": child_index,
                "instance_count": 0,
                "placement_count": 0,
                "transform_samples": [],
                "array_samples": [],
                "array_placement_count": 0,
            },
        )
        item["instance_count"] += count
        item["placement_count"] += 1
        if array["is_array"]:
            item["array_placement_count"] += 1
        if len(item["transform_samples"]) < 8:
            item["transform_samples"].append(transform_summary(trans))
        if array["is_array"] and len(item["array_samples"]) < 8:
            item["array_samples"].append(array)
    children = []
    for item in grouped.values():
        item["transform"] = {
            "samples": item.pop("transform_samples"),
            "truncated": item["placement_count"] > 8,
        }
        samples = item.pop("array_samples")
        item["array"] = {
            "is_array": item["array_placement_count"] > 0,
            "array_placement_count": item["array_placement_count"],
            "expanded_instance_count": item["instance_count"],
            "samples": samples,
            "truncated": item["array_placement_count"] > len(samples),
        }
        children.append(item)
    children.sort(key=lambda value: value["cell_index"])
    return placement_count, children


def read_metadata(path: Path) -> tuple[kdb.Layout, dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    started = time.perf_counter()
    layout = kdb.Layout()
    layout.read(str(path))
    top_indexes = {cell.cell_index() for cell in layout.top_cells()}
    layers = []
    for layer_index in layout.layer_indexes():
        info = layout.get_info(layer_index)
        layers.append(
            {
                "layer_index": int(layer_index),
                "layer_number": int(info.layer),
                "datatype": int(info.datatype),
                "name": info.name or "",
                "default_color": COLORS[(info.layer * 31 + info.datatype * 17) % len(COLORS)],
                "visible_default": True,
            }
        )
    cells = []
    top_cells = []
    overall: list[int] | None = None
    for cell in layout.each_cell():
        bbox = box_list(cell.bbox())
        is_top = cell.cell_index() in top_indexes
        direct_shapes = sum(cell.shapes(index).size() for index in layout.layer_indexes())
        direct_instances, children = summarize_children(cell)
        cells.append(
            {
                "cell_index": int(cell.cell_index()),
                "cell_name": cell.name,
                "bbox": bbox,
                "is_top": is_top,
                "direct_shape_count": int(direct_shapes),
                "direct_instance_count": int(direct_instances),
                "children": children,
            }
        )
        if is_top:
            top_cells.append({"name": cell.name, "cell_index": int(cell.cell_index()), "bbox": bbox})
            if not cell.bbox().empty():
                if overall is None:
                    overall = bbox
                else:
                    overall = [
                        min(overall[0], bbox[0]), min(overall[1], bbox[1]),
                        max(overall[2], bbox[2]), max(overall[3], bbox[3]),
                    ]
    top_cells.sort(key=lambda item: item["cell_index"])
    default_cell = max(
        (item for item in top_cells if item["bbox"][2] > item["bbox"][0] and item["bbox"][3] > item["bbox"][1]),
        key=lambda item: (item["bbox"][2] - item["bbox"][0]) * (item["bbox"][3] - item["bbox"][1]),
        default=top_cells[0] if top_cells else None,
    )
    metadata = {
        "dbu_um": float(layout.dbu),
        "cell_count": int(layout.cells()),
        "top_cell_count": len(top_cells),
        "top_cells": top_cells,
        "bbox": overall or [0, 0, 0, 0],
        "default_cell_index": default_cell["cell_index"] if default_cell else None,
        "parser_version": PARSER_VERSION,
        "parse_seconds": round(time.perf_counter() - started, 3),
    }
    return layout, metadata, layers, cells


def parse_layout_task(db: Session, layout_id: str) -> None:
    layout_file = db.get(LayoutFile, layout_id)
    if layout_file is None:
        logger.error("layout missing for parser", extra={"event": "parser.missing", "layout_id": layout_id})
        return
    if layout_file.status == "CANCELLED":
        return
    layout_file.status = "RUNNING"
    layout_file.error_code = None
    layout_file.error_message = None
    db.commit()
    try:
        if not layout_file.storage_path:
            raise ValueError("layout has no original file")
        path = Path(layout_file.storage_path)
        _, metadata, layers, cells = read_metadata(path)
        db.execute(delete(LayoutLayer).where(LayoutLayer.layout_id == layout_id))
        db.execute(delete(LayoutCell).where(LayoutCell.layout_id == layout_id))
        db.add_all(LayoutLayer(layout_id=layout_id, **layer) for layer in layers)
        db.add_all(LayoutCell(layout_id=layout_id, **cell) for cell in cells)
        layout_file.dbu_um = metadata["dbu_um"]
        layout_file.cell_count = metadata["cell_count"]
        layout_file.top_cell_count = metadata["top_cell_count"]
        layout_file.bbox = metadata["bbox"]
        layout_file.parser_version = PARSER_VERSION
        layout_file.extra_metadata = metadata
        layout_file.status = "READY"
        layout_file.parsed_at = datetime.now(UTC)
        db.commit()
        log_event(
            logger,
            "parser.completed",
            layout_id=layout_id,
            duration_ms=round(metadata["parse_seconds"] * 1000),
        )
    except Exception as exc:
        db.rollback()
        layout_file = db.get(LayoutFile, layout_id)
        if layout_file is not None:
            layout_file.status = "FAILED"
            layout_file.error_code = "PARSE_FAILED"
            layout_file.error_message = str(exc)[:2000]
            db.commit()
        logger.exception(
            "parser.failed",
            extra={"event": "parser.failed", "layout_id": layout_id, "error_code": "PARSE_FAILED"},
        )
