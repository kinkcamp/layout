from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, get_layout, get_project, require_editor
from app.core.errors import AppError
from app.models import LayoutFile, User
from app.schemas.files import UploadCreateRequest
from app.services.audit import audit
from app.services.uploads import UploadService
from app.tasks.dispatch import enqueue_parse

router = APIRouter(prefix="/files", tags=["files"])


def status_payload(layout: LayoutFile, service: UploadService) -> dict:
    return {
        "id": layout.id,
        "filename": layout.original_name,
        "project_id": layout.project_id,
        "status": layout.status,
        "size_bytes": layout.size_bytes,
        "total_chunks": layout.total_chunks,
        "chunk_size": layout.chunk_size,
        "completed_chunks": service.completed_chunks(layout.id),
        "sha256": layout.sha256,
        "error_code": layout.error_code,
        "error_message": layout.error_message,
    }


@router.post("", status_code=201)
def create_upload(
    payload: UploadCreateRequest,
    user: User = Depends(require_editor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    get_project(db, user, payload.project_id)
    layout = UploadService(db, settings).create_session(user, payload.project_id, payload)
    audit(db, user.id, "file.upload_started", "layout", layout.id, {"filename": layout.original_name})
    db.commit()
    return status_payload(layout, UploadService(db, settings))


@router.put("/{layout_id}/chunks/{chunk_index}")
async def upload_chunk(
    layout_id: str,
    chunk_index: int,
    request: Request,
    content_type: str | None = Header(default=None),
    user: User = Depends(require_editor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    if content_type and content_type.split(";", 1)[0].strip() != "application/octet-stream":
        raise AppError("INVALID_CONTENT_TYPE", "Chunks must use application/octet-stream", 415)
    layout = get_layout(db, user, layout_id)
    chunk, duplicate = await UploadService(db, settings).put_chunk(layout, chunk_index, request.stream())
    audit(
        db,
        user.id,
        "file.chunk_repeated" if duplicate else "file.chunk_uploaded",
        "layout",
        layout.id,
        {"chunk_index": chunk_index},
    )
    db.commit()
    return {
        "id": layout.id,
        "chunk_index": chunk_index,
        "size_bytes": chunk.size_bytes,
        "sha256": chunk.sha256,
        "duplicate": duplicate,
        "status": layout.status,
    }


@router.get("/{layout_id}/status")
def upload_status(
    layout_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    layout = get_layout(db, user, layout_id)
    return status_payload(layout, UploadService(db, settings))


@router.post("/{layout_id}/complete")
def complete_upload(
    layout_id: str,
    background: BackgroundTasks,
    user: User = Depends(require_editor),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    layout = get_layout(db, user, layout_id)
    service = UploadService(db, settings)
    service.complete(layout)
    audit(db, user.id, "file.upload_completed", "layout", layout.id, {"sha256": layout.sha256})
    db.commit()
    enqueue_parse(db, layout, background, settings)
    return status_payload(layout, service)
