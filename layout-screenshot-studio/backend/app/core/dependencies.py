from __future__ import annotations

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LayoutFile, Project, User

from .database import get_db
from .errors import AppError, NotFoundError, PermissionDeniedError
from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError("UNAUTHORIZED", "Bearer token required", 401)
    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.InvalidTokenError as exc:
        raise AppError("UNAUTHORIZED", "Invalid or expired token", 401) from exc
    user = db.get(User, payload["sub"])
    if user is None:
        raise AppError("UNAUTHORIZED", "User no longer exists", 401)
    return user


def require_editor(user: User = Depends(get_current_user)) -> User:
    if user.role.lower() == "viewer":
        raise PermissionDeniedError("Viewer role is read-only")
    return user


def can_access_project(user: User, project: Project) -> bool:
    return user.role.lower() == "admin" or project.owner_id == user.id


def get_project(db: Session, user: User, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project", project_id)
    if not can_access_project(user, project):
        raise PermissionDeniedError()
    return project


def get_layout(db: Session, user: User, layout_id: str, ready: bool = False) -> LayoutFile:
    layout = db.get(LayoutFile, layout_id)
    if layout is None:
        raise NotFoundError("Layout", layout_id)
    project = db.get(Project, layout.project_id)
    if project is None or not can_access_project(user, project):
        raise PermissionDeniedError()
    if ready and layout.status != "READY":
        raise AppError("LAYOUT_NOT_READY", f"Layout status is {layout.status}", 409)
    return layout


def layout_file_query(db: Session, user: User):
    if user.role.lower() == "admin":
        return select(LayoutFile)
    return select(LayoutFile).join(Project).where(Project.owner_id == user.id)
