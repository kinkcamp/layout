from __future__ import annotations

from io import BytesIO

from PIL import Image


def test_screenshot_render_and_authenticated_download(client, headers, uploaded_layout):
    layer = client.get(f"/api/v1/layouts/{uploaded_layout}/layers", headers=headers).json()["items"][0]
    top_index = client.get(f"/api/v1/layouts/{uploaded_layout}/metadata", headers=headers).json()["default_cell_index"]
    response = client.post(
        "/api/v1/screenshots",
        headers=headers,
        json={
            "name": "pytest screenshot",
            "layout_id": uploaded_layout,
            "cell_index": top_index,
            "bbox": [900, 1900, 5600, 6500],
            "width_px": 640,
            "height_px": 360,
            "aspect_ratio": "16:9",
            "layers": [
                {
                    "layer_index": layer["layer_index"],
                    "layer_number": layer["layer_number"],
                    "datatype": layer["datatype"],
                    "color": "#FF0000",
                    "opacity": 0.8,
                    "visible": True,
                }
            ],
            "background": "#101010",
            "margin_px": 20,
            "annotations": {"title": "Test", "scale": True, "coordinates": True, "legend": True},
        },
    )
    assert response.status_code == 202, response.text
    task_id = response.json()["id"]
    status = client.get(f"/api/v1/screenshots/{task_id}", headers=headers)
    assert status.status_code == 200
    assert status.json()["status"] == "SUCCESS", status.json()
    assert status.json()["duration_ms"] >= 0
    denied = client.get(f"/api/v1/screenshots/{task_id}/download")
    assert denied.status_code == 401
    download = client.get(f"/api/v1/screenshots/{task_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.headers["content-type"] == "image/png"
    with Image.open(BytesIO(download.content)) as image:
        assert image.format == "PNG"
        assert image.size == (640, 360)
    listing = client.get(f"/api/v1/screenshots?layout_id={uploaded_layout}", headers=headers)
    assert listing.json()["total"] == 1


def test_screenshot_pixel_limit(client, headers, uploaded_layout):
    layer = client.get(f"/api/v1/layouts/{uploaded_layout}/layers", headers=headers).json()["items"][0]
    top_index = client.get(f"/api/v1/layouts/{uploaded_layout}/metadata", headers=headers).json()["default_cell_index"]
    response = client.post(
        "/api/v1/screenshots",
        headers=headers,
        json={
            "name": "too large",
            "layout_id": uploaded_layout,
            "cell_index": top_index,
            "bbox": [900, 1900, 5600, 6500],
            "width_px": 16385,
            "height_px": 10,
            "layers": [{**layer, "color": "#FF0000", "opacity": 1, "visible": True}],
            "background": "#000000",
            "margin_px": 0,
            "annotations": {},
        },
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "IMAGE_SIDE_TOO_LARGE"
