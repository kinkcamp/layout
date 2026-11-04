from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.dependencies import can_access_project, get_current_user, get_layout, require_editor
from app.core.errors import AppError, ConflictError, NotFoundError, PermissionDeniedError
from app.models import LayoutCell, LayoutFile, LayoutLayer, Project, ScreenshotTask, User
from app.schemas.screenshots import ScreenshotCreateRequest
from app.services.audit import audit
from app.services.uploads import sanitize_filename
from app.tasks.dispatch import enqueue_screenshot

router = APIRouter(tags=["screenshots"])


def task_payload(task: ScreenshotTask) -> dict:
    return {
        "id": task.id,
        "name": task.name,
        "layout_id": task.layout_id,
        "cell_index": task.cell_index,
        "bbox": task.bbox,
        "width_px": task.width_px,
        "height_px": task.height_px,
        "aspect_ratio": task.aspect_ratio,
        "layers": task.layer_config_json,
        "background": task.background,
        "margin_px": task.margin_px,
        "annotations": task.annotations,
        "status": task.status,
        "output_size_bytes": task.output_size_bytes,
        "duration_ms": task.duration_ms,
        "error_code": task.error_code,
        "error_message": task.error_message,
        "truncated": task.truncated,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "finished_at": task.finished_at,
        "download_url": f"/api/v1/screenshots/{task.id}/download" if task.status == "SUCCESS" else None,
    }


def accessible_task(db: Session, user: User, task_id: str) -> ScreenshotTask:
    task = db.get(ScreenshotTask, task_id)
    if task is None:
        raise NotFoundError("Screenshot task", task_id)
    layout = db.get(LayoutFile, task.layout_id)
    project = db.get(Project, layout.project_id) if layout else None
    if project is None or not can_access_project(user, project):
        raise PermissionDeniedError()
    return task


def check_running_quota(db: Session, user: User, settings: Settings) -> None:
    running = db.scalar(
        select(func.count(ScreenshotTask.id)).where(
            ScreenshotTask.created_by == user.id,
            ScreenshotTask.status.in_(["QUEUED", "RUNNING"]),
        )
    ) or 0
    if running >= settings.max_running_tasks_per_user:
        raise ConflictError(
            "TASK_QUOTA_EXCEEDED",
            f"At most {settings.max_running_tasks_per_user} queued/running tasks are allowed per user",
        )


def validate_screenshot(db: Session, layout: LayoutFile, payload: ScreenshotCreateRequest, settings: Settings) -> None:
    if payload.width_px > settings.max_screenshot_side or payload.height_px > settings.max_screenshot_side:
        raise AppError("IMAGE_SIDE_TOO_LARGE", "Screenshot side exceeds the configured limit", 413)
    if payload.width_px * payload.height_px > settings.max_screenshot_pixels:
        raise AppError("IMAGE_PIXEL_LIMIT", "Screenshot exceeds the configured pixel limit", 413)
    cell = db.scalar(
        select(LayoutCell).where(LayoutCell.layout_id == layout.id, LayoutCell.cell_index == payload.cell_index)
    )
    if cell is None:
        raise AppError("CELL_NOT_FOUND", "Cell index does not exist", 404)
    available = {
        layer.layer_index: layer
        for layer in db.scalars(select(LayoutLayer).where(LayoutLayer.layout_id == layout.id)).all()
    }
    indexes = [layer.layer_index for layer in payload.layers]
    if len(indexes) != len(set(indexes)):
        raise AppError("INVALID_LAYERS", "Duplicate layer indexes are not allowed", 422)
    for layer in payload.layers:
        actual = available.get(layer.layer_index)
        if actual is None:
            raise AppError("INVALID_LAYERS", f"Layer index {layer.layer_index} does not exist", 422)
        if actual.layer_number != layer.layer_number or actual.datatype != layer.datatype:
            raise AppError(
                "LAYER_IDENTITY_MISMATCH",
                "layer_number/datatype do not match layer_index",
                422,
                {"layer_index": layer.layer_index},
            )


@router.post("/screenshots", status_code=202)
def create_screenshot(
    payload: ScreenshotCreateRequest,
    background: BackgroundTasks,
    user: User = Depends(require_editor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    layout = get_layout(db, user, payload.layout_id, ready=True)
    validate_screenshot(db, layout, payload, settings)
    check_running_quota(db, user, settings)
    task = ScreenshotTask(
        layout_id=layout.id,
        created_by=user.id,
        name=payload.name,
        cell_index=payload.cell_index,
        bbox=payload.bbox,
        width_px=payload.width_px,
        height_px=payload.height_px,
        aspect_ratio=payload.aspect_ratio,
        layer_config_json=[layer.model_dump() for layer in payload.layers],
        background=payload.background,
        margin_px=payload.margin_px,
        annotations=payload.annotations.model_dump(),
    )
    db.add(task)
    db.flush()
    audit(db, user.id, "screenshot.created", "screenshot_task", task.id, {"layout_id": layout.id})
    db.commit()
    enqueue_screenshot(db, task, background, settings)
    return task_payload(task)


@router.get("/screenshots")
def list_screenshots(
    layout_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    query = select(ScreenshotTask).join(LayoutFile, ScreenshotTask.layout_id == LayoutFile.id).join(
        Project, LayoutFile.project_id == Project.id
    )
    count_query = select(func.count(ScreenshotTask.id)).join(
        LayoutFile, ScreenshotTask.layout_id == LayoutFile.id
    ).join(Project, LayoutFile.project_id == Project.id)
    if user.role.lower() != "admin":
        condition = Project.owner_id == user.id
        query = query.where(condition)
        count_query = count_query.where(condition)
    if layout_id:
        get_layout(db, user, layout_id)
        query = query.where(ScreenshotTask.layout_id == layout_id)
        count_query = count_query.where(ScreenshotTask.layout_id == layout_id)
    total = db.scalar(count_query) or 0
    tasks = db.scalars(
        query.order_by(ScreenshotTask.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {"items": [task_payload(task) for task in tasks], "total": total, "page": page, "page_size": page_size}


@router.get("/screenshots/{task_id}")
def get_screenshot(
    task_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    return task_payload(accessible_task(db, user, task_id))


@router.get("/screenshots/{task_id}/download")
def download_screenshot(
    task_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    task = accessible_task(db, user, task_id)
    if task.status != "SUCCESS" or not task.output_path:
        raise ConflictError("SCREENSHOT_NOT_READY", "Screenshot is not available for download")
    path = Path(task.output_path).resolve()
    if not path.is_relative_to(settings.exports_dir.resolve()) or not path.is_file():
        raise NotFoundError("Screenshot output", task.id)
    audit(db, user.id, "screenshot.downloaded", "screenshot_task", task.id)
    db.commit()
    filename = sanitize_filename(task.name).rsplit(".", 1)[0] + ".png"
    return FileResponse(path, media_type="image/png", filename=filename)


@router.post("/screenshots/{task_id}/retry", status_code=202)
def retry_screenshot(
    task_id: str,
    background: BackgroundTasks,
    user: User = Depends(require_editor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    task = accessible_task(db, user, task_id)
    if task.created_by != user.id and user.role.lower() != "admin":
        raise PermissionDeniedError("Only the task owner or admin can retry")
    if task.status not in {"FAILED", "CANCELLED"}:
        raise ConflictError("TASK_NOT_RETRYABLE", f"Cannot retry a task in {task.status}")
    check_running_quota(db, user, settings)
    task.status = "QUEUED"
    task.error_code = None
    task.error_message = None
    task.output_path = None
    task.output_size_bytes = None
    task.duration_ms = None
    task.cancel_requested = False
    task.truncated = False
    task.started_at = None
    task.finished_at = None
    audit(db, user.id, "screenshot.retried", "screenshot_task", task.id)
    db.commit()
    enqueue_screenshot(db, task, background, settings)
    return task_payload(task)


@router.post("/tasks/{task_id}/cancel")
def cancel_task(
    task_id: str,
    user: User = Depends(require_editor),
    db: Session = Depends(get_db),
) -> dict:
    task = accessible_task(db, user, task_id)
    if task.created_by != user.id and user.role.lower() != "admin":
        raise PermissionDeniedError("Only the task owner or admin can cancel")
    if task.status not in {"QUEUED", "RUNNING"}:
        raise ConflictError("TASK_NOT_CANCELLABLE", f"Cannot cancel a task in {task.status}")
    task.cancel_requested = True
    if task.status == "QUEUED":
        task.status = "CANCELLED"
        task.finished_at = datetime.now(UTC)
    if task.celery_task_id:
        from app.tasks.celery_app import celery_app

        celery_app.control.revoke(task.celery_task_id, terminate=False)
    audit(db, user.id, "screenshot.cancel_requested", "screenshot_task", task.id)
    db.commit()
    return task_payload(task)
