from __future__ import annotations

from celery import Celery

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.parser import parse_layout_task
from app.services.screenshots import render_screenshot_task

settings = get_settings()
celery_app = Celery(
    "layout_screenshot_studio",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    task_routes={"layout.parse": {"queue": "parser"}, "layout.screenshot": {"queue": "screenshot"}},
)


@celery_app.task(name="layout.parse", bind=True, max_retries=0)
def parse_task(self, layout_id: str) -> None:
    db = SessionLocal()
    try:
        parse_layout_task(db, layout_id)
    finally:
        db.close()


@celery_app.task(name="layout.screenshot", bind=True, max_retries=0)
def screenshot_task(self, task_id: str) -> None:
    db = SessionLocal()
    try:
        render_screenshot_task(db, task_id, settings)
    finally:
        db.close()
