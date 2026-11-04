from __future__ import annotations

import asyncio
import hashlib
import os
import re
import shutil
import threading
import uuid
from collections.abc import AsyncIterable
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.models import LayoutFile, UploadChunk, User

_ALLOWED_EXTENSIONS = {".gds": "GDSII", ".gdsii": "GDSII", ".oas": "OASIS", ".oasis": "OASIS"}
_CHUNK_LOCKS: dict[str, asyncio.Lock] = {}
_COMPLETE_LOCKS: dict[str, threading.Lock] = {}
_LOCK_GUARD = threading.Lock()


def sanitize_filename(filename: str) -> str:
    if "\x00" in filename:
        raise AppError("INVALID_FILENAME", "Filename contains a null byte", 422)
    basename = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    cleaned = re.sub(r"[^\w. \-]", "_", basename).strip(" .")
    if not cleaned or cleaned in {".", ".."}:
        raise AppError("INVALID_FILENAME", "Filename is empty after sanitization", 422)
    return cleaned[:255]


def expected_chunk_size(layout: LayoutFile, chunk_index: int) -> int:
    if chunk_index == layout.total_chunks - 1:
        return layout.size_bytes - layout.chunk_size * (layout.total_chunks - 1)
    return layout.chunk_size


def detect_format(path: Path) -> str:
    with path.open("rb") as stream:
        header = stream.read(16)
    if header.startswith(b"%SEMI-OASIS"):
        return "OASIS"
    if len(header) >= 4:
        record_length = int.from_bytes(header[:2], "big")
        if record_length >= 4 and header[2] == 0 and header[3] == 2:
            return "GDSII"
    raise AppError("INVALID_LAYOUT_FORMAT", "File header is not recognized as GDSII or OASIS", 422)


class UploadService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    def _ensure_space(self, required: int) -> None:
        self.settings.ensure_directories()
        free = shutil.disk_usage(self.settings.data_dir).free
        if free < required + self.settings.min_free_disk_bytes:
            raise AppError(
                "INSUFFICIENT_DISK_SPACE",
                "Not enough free disk space",
                507,
                {"required_bytes": required, "free_bytes": free},
            )

    def create_session(self, user: User, project_id: str, payload) -> LayoutFile:
        filename = sanitize_filename(payload.filename)
        suffix = Path(filename).suffix.lower()
        if suffix not in _ALLOWED_EXTENSIONS:
            raise AppError("UNSUPPORTED_FILE_TYPE", "Only .gds, .gdsii, .oas and .oasis are accepted", 422)
        if payload.size_bytes > self.settings.max_upload_bytes:
            raise AppError("FILE_TOO_LARGE", "File exceeds the configured upload limit", 413)
        if payload.total_chunks > self.settings.max_upload_chunks:
            raise AppError("TOO_MANY_CHUNKS", "Upload exceeds the chunk count limit", 422)
        uploading = self.db.scalar(
            select(func.count(LayoutFile.id)).where(
                LayoutFile.created_by == user.id, LayoutFile.status == "UPLOADING"
            )
        )
        if (uploading or 0) >= self.settings.max_concurrent_uploads:
            raise ConflictError("UPLOAD_QUOTA_EXCEEDED", "Too many concurrent upload sessions")
        used = self.db.scalar(
            select(func.coalesce(func.sum(LayoutFile.size_bytes), 0)).where(LayoutFile.created_by == user.id)
        )
        quota = user.storage_quota_bytes or self.settings.user_storage_quota_bytes
        if (used or 0) + payload.size_bytes > quota:
            raise AppError("STORAGE_QUOTA_EXCEEDED", "User storage quota exceeded", 413)
        self._ensure_space(payload.size_bytes * 2)
        layout = LayoutFile(
            project_id=project_id,
            original_name=filename,
            format=_ALLOWED_EXTENSIONS[suffix],
            size_bytes=payload.size_bytes,
            total_chunks=payload.total_chunks,
            chunk_size=payload.chunk_size,
            expected_sha256=payload.sha256.lower() if payload.sha256 else None,
            created_by=user.id,
        )
        self.db.add(layout)
        self.db.flush()
        (self.settings.upload_sessions_dir / layout.id).mkdir(parents=True, exist_ok=False)
        self.db.commit()
        return layout

    async def put_chunk(
        self,
        layout: LayoutFile,
        chunk_index: int,
        stream: AsyncIterable[bytes],
    ) -> tuple[UploadChunk, bool]:
        if layout.status != "UPLOADING":
            raise ConflictError("UPLOAD_NOT_ACTIVE", f"Cannot upload chunks while status is {layout.status}")
        if not 0 <= chunk_index < layout.total_chunks:
            raise AppError("INVALID_CHUNK_INDEX", "Chunk index is outside the upload session", 422)
        expected = expected_chunk_size(layout, chunk_index)
        lock = _CHUNK_LOCKS.setdefault(layout.id, asyncio.Lock())
        async with lock:
            self._ensure_space(expected)
            session_dir = self.settings.upload_sessions_dir / layout.id
            session_dir.mkdir(parents=True, exist_ok=True)
            final_path = session_dir / f"{chunk_index}.chunk"
            temp_path = session_dir / f".{uuid.uuid4().hex}.uploading"
            digest = hashlib.sha256()
            size = 0
            try:
                with temp_path.open("xb") as output:
                    async for data in stream:
                        if not data:
                            continue
                        size += len(data)
                        if size > expected:
                            raise AppError(
                                "CHUNK_SIZE_MISMATCH",
                                "Chunk exceeds its expected size",
                                413,
                                {"expected_bytes": expected},
                            )
                        digest.update(data)
                        output.write(data)
                if size != expected:
                    raise AppError(
                        "CHUNK_SIZE_MISMATCH",
                        "Chunk size does not match the upload session",
                        422,
                        {"expected_bytes": expected, "actual_bytes": size},
                    )
                checksum = digest.hexdigest()
                existing = self.db.scalar(
                    select(UploadChunk).where(
                        UploadChunk.layout_id == layout.id, UploadChunk.chunk_index == chunk_index
                    )
                )
                duplicate = bool(
                    existing
                    and final_path.exists()
                    and existing.sha256 == checksum
                    and existing.size_bytes == size
                )
                if duplicate:
                    temp_path.unlink(missing_ok=True)
                    return existing, True
                os.replace(temp_path, final_path)
                if existing is None:
                    existing = UploadChunk(
                        layout_id=layout.id,
                        chunk_index=chunk_index,
                        size_bytes=size,
                        sha256=checksum,
                    )
                    self.db.add(existing)
                else:
                    existing.size_bytes = size
                    existing.sha256 = checksum
                self.db.commit()
                return existing, False
            finally:
                temp_path.unlink(missing_ok=True)

    def completed_chunks(self, layout_id: str) -> list[int]:
        return list(
            self.db.scalars(
                select(UploadChunk.chunk_index)
                .where(UploadChunk.layout_id == layout_id)
                .order_by(UploadChunk.chunk_index)
            ).all()
        )

    def complete(self, layout: LayoutFile) -> LayoutFile:
        with _LOCK_GUARD:
            lock = _COMPLETE_LOCKS.setdefault(layout.id, threading.Lock())
        with lock:
            if layout.status != "UPLOADING":
                raise ConflictError("UPLOAD_NOT_ACTIVE", f"Cannot complete while status is {layout.status}")
            completed = self.completed_chunks(layout.id)
            missing = sorted(set(range(layout.total_chunks)) - set(completed))
            if missing:
                raise ConflictError("CHUNKS_MISSING", "Upload is incomplete", {"missing_chunks": missing[:100]})
            self._ensure_space(layout.size_bytes)
            session_dir = self.settings.upload_sessions_dir / layout.id
            final_path = self.settings.originals_dir / f"{layout.id}{Path(layout.original_name).suffix.lower()}"
            temp_path = self.settings.originals_dir / f".{layout.id}.{uuid.uuid4().hex}.tmp"
            digest = hashlib.sha256()
            try:
                with temp_path.open("xb") as output:
                    for index in range(layout.total_chunks):
                        chunk_path = session_dir / f"{index}.chunk"
                        if not chunk_path.is_file():
                            raise ConflictError("CHUNK_FILE_MISSING", f"Chunk {index} is missing on disk")
                        with chunk_path.open("rb") as source:
                            while data := source.read(1024 * 1024):
                                digest.update(data)
                                output.write(data)
                if temp_path.stat().st_size != layout.size_bytes:
                    raise ConflictError("FILE_SIZE_MISMATCH", "Merged file size does not match the session")
                checksum = digest.hexdigest()
                if layout.expected_sha256 and checksum != layout.expected_sha256:
                    raise ConflictError(
                        "SHA256_MISMATCH",
                        "Merged file SHA-256 does not match",
                        {"expected": layout.expected_sha256, "actual": checksum},
                    )
                actual_format = detect_format(temp_path)
                if actual_format != layout.format:
                    raise AppError("FORMAT_MISMATCH", "File header and filename extension disagree", 422)
                os.chmod(temp_path, 0o444)
                os.replace(temp_path, final_path)
                layout.storage_path = str(final_path)
                layout.sha256 = checksum
                layout.status = "QUEUED"
                layout.error_code = None
                layout.error_message = None
                self.db.commit()
            except Exception:
                temp_path.unlink(missing_ok=True)
                self.db.rollback()
                raise
            finally:
                temp_path.unlink(missing_ok=True)
            shutil.rmtree(session_dir, ignore_errors=True)
            return layout
