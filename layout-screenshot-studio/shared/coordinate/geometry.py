from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, TypeAlias

BBox: TypeAlias = tuple[int, int, int, int]


def normalize_bbox(values: Iterable[int]) -> BBox:
    """Return left, bottom, right, top and reject empty or inverted boxes."""
    coords = tuple(int(v) for v in values)
    if len(coords) != 4:
        raise ValueError("bbox must contain exactly four integers")
    left, bottom, right, top = coords
    if right <= left or top <= bottom:
        raise ValueError("bbox must have positive width and height")
    return coords


def tile_bbox(cell_bbox: Iterable[int], lod: int, tile_x: int, tile_y: int) -> BBox:
    """Map a bottom-origin LOD tile to an integer DBU box; LOD 0 is 1x1."""
    left, bottom, right, top = normalize_bbox(cell_bbox)
    if lod < 0 or lod > 24:
        raise ValueError("lod must be between 0 and 24")
    grid = 1 << lod
    if not (0 <= tile_x < grid and 0 <= tile_y < grid):
        raise ValueError("tile coordinates are outside the LOD grid")
    width, height = right - left, top - bottom
    x0 = left + width * tile_x // grid
    x1 = left + width * (tile_x + 1) // grid
    y0 = bottom + height * tile_y // grid
    y1 = bottom + height * (tile_y + 1) // grid
    if x1 == x0:
        x1 = min(right, x0 + 1)
    if y1 == y0:
        y1 = min(top, y0 + 1)
    return x0, y0, x1, y1


@dataclass(frozen=True)
class CanvasTransform:
    """Uniform DBU-to-pixel transform with a Y-up to Y-down conversion."""

    bbox: BBox
    width_px: int
    height_px: int
    margin_px: int = 0

    def __post_init__(self) -> None:
        object.__setattr__(self, "bbox", normalize_bbox(self.bbox))
        if self.width_px <= 0 or self.height_px <= 0 or self.margin_px < 0:
            raise ValueError("invalid canvas dimensions")
        if self.width_px <= 2 * self.margin_px or self.height_px <= 2 * self.margin_px:
            raise ValueError("margin leaves no drawable canvas")

    @property
    def scale(self) -> float:
        left, bottom, right, top = self.bbox
        available_width = self.width_px - 2 * self.margin_px
        available_height = self.height_px - 2 * self.margin_px
        return min(available_width / (right - left), available_height / (top - bottom))

    @property
    def offset(self) -> tuple[float, float]:
        left, bottom, right, top = self.bbox
        drawn_width = (right - left) * self.scale
        drawn_height = (top - bottom) * self.scale
        return (self.width_px - drawn_width) / 2, (self.height_px - drawn_height) / 2

    def point(self, x: float, y: float) -> tuple[float, float]:
        left, _, _, top = self.bbox
        offset_x, offset_y = self.offset
        return offset_x + (x - left) * self.scale, offset_y + (top - y) * self.scale

    def length(self, dbu_length: float) -> float:
        return abs(dbu_length) * self.scale
