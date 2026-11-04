from __future__ import annotations

import math
import re

from pydantic import BaseModel, Field, model_validator


class UploadCreateRequest(BaseModel):
    project_id: str = Field(min_length=36, max_length=36)
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)
    total_chunks: int = Field(gt=0)
    chunk_size: int = Field(gt=0)
    sha256: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{64}$")

    @model_validator(mode="after")
    def validate_chunks(self) -> "UploadCreateRequest":
        if math.ceil(self.size_bytes / self.chunk_size) != self.total_chunks:
            raise ValueError("total_chunks must equal ceil(size_bytes / chunk_size)")
        return self


class LayoutStatusResponse(BaseModel):
    id: str
    filename: str
    project_id: str
    status: str
    size_bytes: int
    total_chunks: int
    chunk_size: int
    completed_chunks: list[int]
    sha256: str | None
    error_code: str | None
    error_message: str | None
