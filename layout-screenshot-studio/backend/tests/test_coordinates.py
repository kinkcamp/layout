import pytest

from shared.coordinate import CanvasTransform, normalize_bbox, tile_bbox


def test_tile_bbox_lod_and_bottom_origin():
    cell = (100, 200, 1100, 2200)
    assert tile_bbox(cell, 0, 0, 0) == cell
    assert tile_bbox(cell, 1, 0, 0) == (100, 200, 600, 1200)
    assert tile_bbox(cell, 1, 1, 1) == (600, 1200, 1100, 2200)
    with pytest.raises(ValueError):
        tile_bbox(cell, 1, 2, 0)


def test_bbox_rejects_inverted_or_empty_regions():
    assert normalize_bbox([4, 3, 10, 12]) == (4, 3, 10, 12)
    with pytest.raises(ValueError):
        normalize_bbox([0, 0, 0, 10])
    with pytest.raises(ValueError):
        normalize_bbox([0, 10, 10, 0])


def test_canvas_transform_preserves_aspect_and_flips_y():
    transform = CanvasTransform((0, 0, 200, 100), 640, 480, 20)
    assert transform.scale == pytest.approx(3.0)
    assert transform.point(0, 0) == pytest.approx((20, 390))
    assert transform.point(200, 100) == pytest.approx((620, 90))
    width = transform.point(200, 0)[0] - transform.point(0, 0)[0]
    height = transform.point(0, 100)[1] - transform.point(0, 0)[1]
    assert width / abs(height) == pytest.approx(2.0)
