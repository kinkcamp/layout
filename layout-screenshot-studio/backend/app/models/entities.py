from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.core.database import Base


def uuid4() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    role: Mapped[str] = mapped_column(String(32), default="editor", index=True)
    storage_quota_bytes: Mapped[int] = mapped_column(BigInteger, default=20 * 1024**3)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LayoutFile(Base):
    __tablename__ = "layout_files"
    __table_args__ = (
        Index("ix_layout_files_project_created", "project_id", "created_at"),
        Index("ix_layout_files_sha256", "sha256"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    format: Mapped[str] = mapped_column(String(16))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    total_chunks: Mapped[int] = mapped_column(BigInteger)
    chunk_size: Mapped[int] = mapped_column(BigInteger)
    expected_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="UPLOADING", index=True)
    parser_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dbu_um: Mapped[float | None] = mapped_column(Float, nullable=True)
    cell_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    top_cell_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bbox: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    extra_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    parsed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UploadChunk(Base):
    __tablename__ = "upload_chunks"
    __table_args__ = (UniqueConstraint("layout_id", "chunk_index", name="uq_upload_chunk"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    layout_id: Mapped[str] = mapped_column(ForeignKey("layout_files.id", ondelete="CASCADE"), index=True)
    chunk_index: Mapped[int] = mapped_column(BigInteger)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LayoutLayer(Base):
    __tablename__ = "layout_layers"
    __table_args__ = (
        UniqueConstraint("layout_id", "layer_index", name="uq_layout_layer_index"),
        Index("ix_layout_layers_layout_layer_dt", "layout_id", "layer_number", "datatype"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    layout_id: Mapped[str] = mapped_column(ForeignKey("layout_files.id", ondelete="CASCADE"), index=True)
    layer_index: Mapped[int] = mapped_column(BigInteger)
    layer_number: Mapped[int] = mapped_column(BigInteger)
    datatype: Mapped[int] = mapped_column(BigInteger)
    name: Mapped[str] = mapped_column(String(255), default="")
    default_color: Mapped[str] = mapped_column(String(16))
    visible_default: Mapped[bool] = mapped_column(Boolean, default=True)


class LayoutCell(Base):
    __tablename__ = "layout_cells"
    __table_args__ = (
        UniqueConstraint("layout_id", "cell_index", name="uq_layout_cell_index"),
        Index("ix_layout_cells_layout_name", "layout_id", "cell_name"),
        Index("ix_layout_cells_layout_top", "layout_id", "is_top"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    layout_id: Mapped[str] = mapped_column(ForeignKey("layout_files.id", ondelete="CASCADE"), index=True)
    cell_index: Mapped[int] = mapped_column(BigInteger)
    cell_name: Mapped[str] = mapped_column(String(255))
    bbox: Mapped[list[int]] = mapped_column(JSON)
    is_top: Mapped[bool] = mapped_column(Boolean, default=False)
    direct_shape_count: Mapped[int] = mapped_column(BigInteger, default=0)
    direct_instance_count: Mapped[int] = mapped_column(BigInteger, default=0)
    children: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)


class ScreenshotTask(Base):
    __tablename__ = "screenshot_tasks"
    __table_args__ = (
        Index("ix_screenshot_tasks_user_created", "created_by", "created_at"),
        Index("ix_screenshot_tasks_status_created", "status", "created_at"),
        Index("ix_screenshot_tasks_layout_created", "layout_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    layout_id: Mapped[str] = mapped_column(ForeignKey("layout_files.id"), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    cell_index: Mapped[int] = mapped_column(BigInteger)
    bbox: Mapped[list[int]] = mapped_column(JSON)
    width_px: Mapped[int] = mapped_column(BigInteger)
    height_px: Mapped[int] = mapped_column(BigInteger)
    aspect_ratio: Mapped[str | None] = mapped_column(String(32), nullable=True)
    layer_config_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    background: Mapped[str] = mapped_column(String(16))
    margin_px: Mapped[int] = mapped_column(BigInteger)
    annotations: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="QUEUED")
    output_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_object", "object_type", "object_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    object_type: Mapped[str] = mapped_column(String(80))
    object_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
