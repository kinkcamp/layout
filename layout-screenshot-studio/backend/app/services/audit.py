from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.logging import request_id_var
from app.models import AuditLog


def audit(
    db: Session,
    user_id: str | None,
    action: str,
    object_type: str,
    object_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            object_type=object_type,
            object_id=object_id,
            details=details or {},
            request_id=request_id_var.get(None) or None,
        )
    )
