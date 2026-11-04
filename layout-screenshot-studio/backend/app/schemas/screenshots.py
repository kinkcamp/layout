from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator, model_validator

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


class ScreenshotLayer(BaseModel):
    layer_index: int = Field(ge=0)
    layer_number: int = Field(ge=0)
    datatype: int = Field(ge=0)
    color: str
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    visible: bool = True

    @field_validator("color")
    @classmethod
    def valid_color(cls, value: str) -> str:
        if not HEX_COLOR.fullmatch(value):
            raise ValueError("color must be #RRGGBB")
        return value.upper()


class ScreenshotMarker(BaseModel):
    x: int
    y: int
    label: str = Field(min_length=1, max_length=50)


class ScreenshotAnnotations(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    scale: bool = False
    coordinates: bool = False
    legend: bool = False
    markers: list[ScreenshotMarker] = Field(default_factory=list, max_length=256)


class ScreenshotCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    layout_id: str = Field(min_length=36, max_length=36)
    cell_index: int = Field(ge=0)
    bbox: list[int] = Field(min_length=4, max_length=4)
    width_px: int = Field(gt=0)
    height_px: int = Field(gt=0)
    aspect_ratio: str | None = Field(default=None, max_length=32)
    layers: list[ScreenshotLayer] = Field(min_length=1, max_length=256)
    background: str = "#000000"
    margin_px: int = Field(default=0, ge=0)
    annotations: ScreenshotAnnotations = Field(default_factory=ScreenshotAnnotations)

    @field_validator("bbox")
    @classmethod
    def valid_bbox(cls, value: list[int]) -> list[int]:
        if value[2] <= value[0] or value[3] <= value[1]:
            raise ValueError("bbox must have positive width and height")
        return value

    @field_validator("background")
    @classmethod
    def valid_background(cls, value: str) -> str:
        if not HEX_COLOR.fullmatch(value):
            raise ValueError("background must be #RRGGBB")
        return value.upper()

    @model_validator(mode="after")
    def validate_canvas(self) -> "ScreenshotCreateRequest":
        if self.margin_px * 2 >= min(self.width_px, self.height_px):
            raise ValueError("margin_px leaves no drawable canvas")
        if self.aspect_ratio and self.aspect_ratio.lower() != "custom":
            match = re.fullmatch(r"(\d+):(\d+)", self.aspect_ratio)
            if not match or int(match.group(2)) == 0:
                raise ValueError("aspect_ratio must be W:H or custom")
            expected = int(match.group(1)) / int(match.group(2))
            if abs(self.width_px / self.height_px - expected) > 1e-6:
                raise ValueError("width_px and height_px do not match aspect_ratio")
        return self
