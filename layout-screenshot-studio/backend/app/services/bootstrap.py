from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password
from app.models import Project, User


def initialize_defaults(db: Session, settings: Settings) -> None:
    admin = db.scalar(select(User).where(User.username == settings.admin_username))
    if admin is None:
        admin = User(
            username=settings.admin_username,
            password_hash=hash_password(settings.admin_password),
            role="admin",
            storage_quota_bytes=settings.user_storage_quota_bytes,
        )
        db.add(admin)
        db.flush()
    demo = db.scalar(
        select(Project).where(Project.owner_id == admin.id, Project.name == settings.demo_project_name)
    )
    if demo is None:
        db.add(
            Project(
                name=settings.demo_project_name,
                description="Default project for local proof-of-concept imports",
                owner_id=admin.id,
            )
        )
    db.commit()
