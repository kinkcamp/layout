from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class GeometryQueryRequest(BaseModel):
    cell_index: int = Field(ge=0)
    bbox: list[int] = Field(min_length=4, max_length=4)
    layers: list[int] | None = Field(default=None, max_length=256)
    recursive: bool = True
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=100, ge=1, le=1000)

    @field_validator("bbox")
    @classmethod
    def valid_bbox(cls, value: list[int]) -> list[int]:
        if value[2] <= value[0] or value[3] <= value[1]:
            raise ValueError("bbox must have positive width and height")
        return value

    @field_validator("layers")
    @classmethod
    def valid_layers(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and (any(v < 0 for v in value) or len(set(value)) != len(value)):
            raise ValueError("layers must contain unique non-negative layer indexes")
        return value
