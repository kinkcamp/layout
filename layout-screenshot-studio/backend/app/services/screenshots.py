from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.logging import log_event, task_id_var
from app.models import LayoutFile, ScreenshotTask

from .geometry import GeometryService
from .renderer import PillowRenderer

logger = logging.getLogger(__name__)


def render_screenshot_task(db: Session, task_id: str, settings: Settings) -> None:
    token = task_id_var.set(task_id)
    started = time.perf_counter()
    try:
        task = db.get(ScreenshotTask, task_id)
        if task is None or task.status == "CANCELLED":
            return
        task.status = "RUNNING"
        task.started_at = datetime.now(UTC)
        task.error_code = None
        task.error_message = None
        db.commit()
        layout = db.get(LayoutFile, task.layout_id)
        if layout is None or layout.status != "READY":
            raise ValueError("layout is not ready")
        visible_layers = [layer for layer in task.layer_config_json if layer["visible"]]
        geometry = GeometryService().first_shapes(
            layout,
            task.cell_index,
            task.bbox,
            [layer["layer_index"] for layer in visible_layers],
            settings.render_max_shapes,
        )
        db.refresh(task)
        if task.cancel_requested:
            task.status = "CANCELLED"
            task.finished_at = datetime.now(UTC)
            db.commit()
            return
        image = PillowRenderer().render(
            geometry.shapes,
            task.bbox,
            task.width_px,
            task.height_px,
            task.layer_config_json,
            task.background,
            task.margin_px,
            task.annotations,
            task.name,
            layout.dbu_um,
        )
        output_dir = settings.exports_dir / task.created_by
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{task.id}.png"
        temp_path = output_dir / f".{uuid.uuid4().hex}.tmp"
        try:
            image.save(temp_path, format="PNG", compress_level=6)
            db.refresh(task)
            if task.cancel_requested:
                temp_path.unlink(missing_ok=True)
                task.status = "CANCELLED"
                task.finished_at = datetime.now(UTC)
                db.commit()
                return
            os.replace(temp_path, output_path)
        finally:
            temp_path.unlink(missing_ok=True)
        task.output_path = str(output_path)
        task.output_size_bytes = output_path.stat().st_size
        task.truncated = geometry.truncated
        task.duration_ms = round((time.perf_counter() - started) * 1000)
        task.status = "SUCCESS"
        task.finished_at = datetime.now(UTC)
        db.commit()
        log_event(
            logger,
            "screenshot.completed",
            task_id=task_id,
            layout_id=task.layout_id,
            duration_ms=task.duration_ms,
        )
    except Exception as exc:
        db.rollback()
        task = db.get(ScreenshotTask, task_id)
        if task is not None:
            task.status = "CANCELLED" if task.cancel_requested else "FAILED"
            task.error_code = "TASK_CANCELLED" if task.cancel_requested else "RENDER_FAILED"
            task.error_message = None if task.cancel_requested else str(exc)[:2000]
            task.finished_at = datetime.now(UTC)
            task.duration_ms = round((time.perf_counter() - started) * 1000)
            db.commit()
        logger.exception(
            "screenshot.failed",
            extra={"event": "screenshot.failed", "task_id": task_id, "error_code": "RENDER_FAILED"},
        )
    finally:
        task_id_var.reset(token)
