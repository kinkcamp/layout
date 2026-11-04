from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, get_layout
from app.core.errors import AppError, NotFoundError
from app.models import LayoutCell, LayoutLayer, User
from app.schemas.layouts import GeometryQueryRequest
from app.services.geometry import GeometryService
from app.services.tiles import TileService

router = APIRouter(prefix="/layouts", tags=["layouts"])


def cell_payload(cell: LayoutCell) -> dict:
    return {
        "id": cell.id,
        "cell_index": cell.cell_index,
        "cell_name": cell.cell_name,
        "bbox": cell.bbox,
        "is_top": cell.is_top,
        "direct_shape_count": cell.direct_shape_count,
        "direct_instance_count": cell.direct_instance_count,
    }


@router.get("/{layout_id}/metadata")
def metadata(
    layout_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    layout = get_layout(db, user, layout_id, ready=True)
    return {
        "id": layout.id,
        "filename": layout.original_name,
        "status": layout.status,
        "format": layout.format,
        "size_bytes": layout.size_bytes,
        "sha256": layout.sha256,
        "dbu_um": layout.dbu_um,
        "cell_count": layout.cell_count,
        "top_cell_count": layout.top_cell_count,
        "top_cells": layout.extra_metadata.get("top_cells", []),
        "default_cell_index": layout.extra_metadata.get("default_cell_index"),
        "bbox": layout.bbox,
        "parser_version": layout.parser_version,
        "parse_seconds": layout.extra_metadata.get("parse_seconds"),
    }


@router.get("/{layout_id}/layers")
def layers(
    layout_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    get_layout(db, user, layout_id, ready=True)
    items = db.scalars(
        select(LayoutLayer)
        .where(LayoutLayer.layout_id == layout_id)
        .order_by(LayoutLayer.layer_number, LayoutLayer.datatype, LayoutLayer.layer_index)
    ).all()
    return {
        "items": [
            {
                "id": item.id,
                "layer_index": item.layer_index,
                "layer_number": item.layer_number,
                "datatype": item.datatype,
                "name": item.name,
                "default_color": item.default_color,
                "visible_default": item.visible_default,
            }
            for item in items
        ]
    }


@router.get("/{layout_id}/cells")
def cells(
    layout_id: str,
    parent_index: int | None = Query(default=None, ge=0),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    get_layout(db, user, layout_id, ready=True)
    offset = (page - 1) * page_size
    if parent_index is None:
        total = db.scalar(
            select(func.count(LayoutCell.id)).where(LayoutCell.layout_id == layout_id, LayoutCell.is_top.is_(True))
        ) or 0
        rows = db.scalars(
            select(LayoutCell)
            .where(LayoutCell.layout_id == layout_id, LayoutCell.is_top.is_(True))
            .order_by(LayoutCell.cell_index)
            .offset(offset)
            .limit(page_size)
        ).all()
        items = [cell_payload(row) for row in rows]
    else:
        parent = db.scalar(
            select(LayoutCell).where(LayoutCell.layout_id == layout_id, LayoutCell.cell_index == parent_index)
        )
        if parent is None:
            raise NotFoundError("Cell", str(parent_index))
        relations = parent.children
        total = len(relations)
        selected = relations[offset : offset + page_size]
        indexes = [relation["cell_index"] for relation in selected]
        rows = db.scalars(
            select(LayoutCell).where(LayoutCell.layout_id == layout_id, LayoutCell.cell_index.in_(indexes))
        ).all() if indexes else []
        by_index = {row.cell_index: row for row in rows}
        items = []
        for relation in selected:
            child = by_index.get(relation["cell_index"])
            if child is not None:
                items.append(
                    {
                        **cell_payload(child),
                        "instance_count": relation["instance_count"],
                        "placement_count": relation["placement_count"],
                        "transform": relation["transform"],
                        "array": relation["array"],
                    }
                )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def parse_layer_filter(value: str | None) -> list[int] | None:
    if value is None or not value.strip():
        return None
    try:
        layers = [int(item.strip()) for item in value.split(",")]
    except ValueError as exc:
        raise AppError("INVALID_LAYERS", "layers must be comma-separated layer indexes", 422) from exc
    if len(layers) > 256 or any(index < 0 for index in layers) or len(set(layers)) != len(layers):
        raise AppError("INVALID_LAYERS", "layers must contain unique non-negative indexes", 422)
    return layers


@router.get("/{layout_id}/tiles")
def tiles(
    layout_id: str,
    cell_index: int = Query(ge=0),
    lod: int = Query(default=0, ge=0, le=24),
    tile_x: int = Query(default=0, ge=0),
    tile_y: int = Query(default=0, ge=0),
    layers: str | None = None,
    max_shapes: int = Query(default=5000, ge=1, le=50000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    layout = get_layout(db, user, layout_id, ready=True)
    cell = db.scalar(select(LayoutCell).where(LayoutCell.layout_id == layout_id, LayoutCell.cell_index == cell_index))
    if cell is None:
        raise NotFoundError("Cell", str(cell_index))
    return TileService(settings).get_tile(
        layout, cell, lod, tile_x, tile_y, parse_layer_filter(layers), max_shapes
    )


@router.post("/{layout_id}/query")
def query_geometry(
    layout_id: str,
    payload: GeometryQueryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    layout = get_layout(db, user, layout_id, ready=True)
    result = GeometryService().query(
        layout,
        payload.cell_index,
        payload.bbox,
        payload.layers,
        payload.recursive,
        (payload.page - 1) * payload.page_size,
        payload.page_size,
        settings.query_scan_limit,
    )
    return {
        "items": result.shapes,
        "total": result.total,
        "page": payload.page,
        "page_size": payload.page_size,
        "bbox": payload.bbox,
        "dbu_um": layout.dbu_um,
        "truncated": result.truncated,
        "stats": result.stats,
    }
