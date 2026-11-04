from __future__ import annotations

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.database import SessionLocal
from app.models import LayoutFile, ScreenshotTask
from app.services.parser import parse_layout_task
from app.services.screenshots import render_screenshot_task


def run_parse(layout_id: str, settings: Settings) -> None:
    db = SessionLocal()
    try:
        parse_layout_task(db, layout_id)
    finally:
        db.close()


def run_screenshot(task_id: str, settings: Settings) -> None:
    db = SessionLocal()
    try:
        render_screenshot_task(db, task_id, settings)
    finally:
        db.close()


def enqueue_parse(db: Session, layout: LayoutFile, background: BackgroundTasks | None, settings: Settings) -> None:
    if settings.task_backend == "local":
        if background is None:
            run_parse(layout.id, settings)
        else:
            background.add_task(run_parse, layout.id, settings)
        return
    from .celery_app import celery_app

    result = celery_app.send_task("layout.parse", args=[layout.id], queue="parser")
    layout.celery_task_id = result.id
    db.commit()


def enqueue_screenshot(
    db: Session,
    task: ScreenshotTask,
    background: BackgroundTasks | None,
    settings: Settings,
) -> None:
    if settings.task_backend == "local":
        if background is None:
            run_screenshot(task.id, settings)
        else:
            background.add_task(run_screenshot, task.id, settings)
        return
    from .celery_app import celery_app

    result = celery_app.send_task("layout.screenshot", args=[task.id], queue="screenshot")
    task.celery_task_id = result.id
    db.commit()
