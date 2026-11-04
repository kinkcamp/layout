from __future__ import annotations

from typing import Any


class AppError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


class NotFoundError(AppError):
    def __init__(self, resource: str, object_id: str | None = None) -> None:
        super().__init__(
            "NOT_FOUND",
            f"{resource} not found",
            404,
            {"id": object_id} if object_id else None,
        )


class PermissionDeniedError(AppError):
    def __init__(self, message: str = "Permission denied") -> None:
        super().__init__("PERMISSION_DENIED", message, 403)


class ConflictError(AppError):
    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(code, message, 409, details)
