from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from PIL import Image, ImageDraw, ImageFont
from shared.coordinate import CanvasTransform


def rgb(color: str) -> tuple[int, int, int]:
    return tuple(int(color[index : index + 2], 16) for index in (1, 3, 5))


def nice_scale_length(target_um: float) -> float:
    if target_um <= 0:
        return 1.0
    exponent = math.floor(math.log10(target_um))
    fraction = target_um / (10**exponent)
    nice = 1 if fraction < 2 else 2 if fraction < 5 else 5
    return nice * (10**exponent)


class PillowRenderer:
    def render(
        self,
        shapes: list[dict[str, Any]],
        bbox: list[int],
        width_px: int,
        height_px: int,
        layers: list[dict[str, Any]],
        background: str,
        margin_px: int,
        annotations: dict[str, Any],
        name: str,
        dbu_um: float,
    ) -> Image.Image:
        transform = CanvasTransform(tuple(bbox), width_px, height_px, margin_px)
        image = Image.new("RGBA", (width_px, height_px), rgb(background) + (255,))
        by_layer: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for shape in shapes:
            by_layer[shape["layer_index"]].append(shape)
        for layer in layers:
            if not layer["visible"] or layer["opacity"] <= 0:
                continue
            layer_shapes = by_layer.get(layer["layer_index"], [])
            mask = Image.new("L", image.size, 0)
            mask_draw = ImageDraw.Draw(mask)
            alpha = round(layer["opacity"] * 255)
            for shape in layer_shapes:
                for polygon in shape.get("polygons", []):
                    hull = [transform.point(x, y) for x, y in polygon["hull"]]
                    if len(hull) >= 3:
                        mask_draw.polygon(hull, fill=alpha)
                    for hole in polygon.get("holes", []):
                        points = [transform.point(x, y) for x, y in hole]
                        if len(points) >= 3:
                            mask_draw.polygon(points, fill=0)
            color_image = Image.new("RGBA", image.size, rgb(layer["color"]) + (0,))
            color_image.putalpha(mask)
            image.alpha_composite(color_image)
        draw = ImageDraw.Draw(image)
        for layer in layers:
            if not layer["visible"]:
                continue
            for shape in by_layer.get(layer["layer_index"], []):
                if shape["kind"] == "text" and shape.get("position"):
                    x, y = transform.point(*shape["position"])
                    draw.text((x, y), shape.get("text", ""), fill=rgb(layer["color"]))
        self._draw_annotations(image, transform, layers, annotations, name, dbu_um)
        return image.convert("RGB")

    def _draw_annotations(
        self,
        image: Image.Image,
        transform: CanvasTransform,
        layers: list[dict[str, Any]],
        annotations: dict[str, Any],
        name: str,
        dbu_um: float,
    ) -> None:
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default()
        foreground = "#FFFFFF" if sum(image.getpixel((0, 0))[:3]) < 384 else "#111111"
        title = annotations.get("title")
        if title:
            draw.text((12, 10), title or name, fill=foreground, font=font)
        if annotations.get("coordinates"):
            left, bottom, right, top = transform.bbox
            text = f"DBU [{left}, {bottom}, {right}, {top}]  DBU={dbu_um:g} um"
            draw.text((12, image.height - 18), text, fill=foreground, font=font)
        if annotations.get("scale"):
            bbox_width_um = (transform.bbox[2] - transform.bbox[0]) * dbu_um
            length_um = nice_scale_length(bbox_width_um * 0.2)
            length_px = transform.length(length_um / dbu_um)
            x, y = 16, image.height - 36
            draw.line((x, y, x + length_px, y), fill=foreground, width=2)
            draw.line((x, y - 4, x, y + 4), fill=foreground, width=2)
            draw.line((x + length_px, y - 4, x + length_px, y + 4), fill=foreground, width=2)
            draw.text((x, y - 16), f"{length_um:g} um", fill=foreground, font=font)
        if annotations.get("legend"):
            visible = [layer for layer in layers if layer["visible"]]
            x, y = 12, 30 if title else 12
            box_height = len(visible) * 16 + 8
            draw.rectangle((x - 4, y - 4, x + 190, y + box_height), fill=(0, 0, 0, 180))
            for layer in visible:
                draw.rectangle((x, y + 2, x + 10, y + 12), fill=layer["color"])
                label = f"L{layer['layer_number']}/D{layer['datatype']} (i{layer['layer_index']})"
                draw.text((x + 16, y), label, fill="#FFFFFF", font=font)
                y += 16
        for marker in annotations.get("markers", []):
            x, y = transform.point(marker["x"], marker["y"])
            if not (-20 <= x <= image.width + 20 and -20 <= y <= image.height + 20):
                continue
            draw.line((x, y - 14, x, y + 10), fill="#FFCC66", width=2)
            draw.ellipse((x - 4, y - 18, x + 4, y - 10), fill="#FFCC66", outline="#3A2A10")
            label = marker["label"]
            draw.rectangle((x + 7, y - 20, x + 15 + len(label) * 7, y - 6), fill="#201D16")
            draw.text((x + 11, y - 19), label, fill="#FFE0A3", font=font)
