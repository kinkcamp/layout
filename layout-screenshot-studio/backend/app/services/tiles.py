from __future__ import annotations

import hashlib
import json
import os
import uuid
from pathlib import Path

from app.core.config import Settings
from app.core.errors import AppError
from app.models import LayoutCell, LayoutFile
from shared.coordinate import tile_bbox

from .geometry import GeometryService


class TileService:
    def __init__(self, settings: Settings, geometry: GeometryService | None = None) -> None:
        self.settings = settings
        self.geometry = geometry or GeometryService()

    def get_tile(
        self,
        layout: LayoutFile,
        cell: LayoutCell,
        lod: int,
        tile_x: int,
        tile_y: int,
        layers: list[int] | None,
        max_shapes: int,
    ) -> dict:
        try:
            bbox = tile_bbox(cell.bbox, lod, tile_x, tile_y)
        except ValueError as exc:
            raise AppError("INVALID_TILE", str(exc), 422) from exc
        if not layout.sha256 or not layout.parser_version:
            raise AppError("LAYOUT_NOT_READY", "Layout cache identity is unavailable", 409)
        canonical_layers = None if layers is None else sorted(layers)
        layer_hash = hashlib.sha256(
            json.dumps(canonical_layers, separators=(",", ":")).encode()
        ).hexdigest()[:20]
        key_parts = [
            layout.sha256,
            layout.parser_version,
            self.settings.tile_schema_version,
            str(cell.cell_index),
            str(lod),
            str(tile_x),
            str(tile_y),
            layer_hash,
            f"m{max_shapes}",
        ]
        cache_path = self.settings.tiles_dir / layout.sha256[:2] / f"{':'.join(key_parts)}.json"
        if cache_path.is_file():
            try:
                with cache_path.open("r", encoding="utf-8") as stream:
                    payload = json.load(stream)
                payload["cache_hit"] = True
                return payload
            except (OSError, json.JSONDecodeError):
                pass
        result = self.geometry.first_shapes(layout, cell.cell_index, bbox, layers, max_shapes)
        payload = {
            "bbox": list(bbox),
            "origin": [bbox[0], bbox[1]],
            "dbu_um": layout.dbu_um,
            "shapes": result.shapes,
            "truncated": result.truncated,
            "total": result.total,
            "cache_hit": False,
        }
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = cache_path.with_name(f".{uuid.uuid4().hex}.tmp")
        try:
            with temp_path.open("w", encoding="utf-8") as stream:
                json.dump(payload, stream, separators=(",", ":"), ensure_ascii=False)
            os.replace(temp_path, cache_path)
        finally:
            temp_path.unlink(missing_ok=True)
        return payload
