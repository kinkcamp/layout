from __future__ import annotations


def test_metadata_layers_cells_and_hierarchy_summary(client, headers, uploaded_layout):
    metadata = client.get(f"/api/v1/layouts/{uploaded_layout}/metadata", headers=headers)
    assert metadata.status_code == 200, metadata.text
    payload = metadata.json()
    assert payload["dbu_um"] == 0.001
    assert payload["cell_count"] == 2
    assert payload["top_cells"][0]["name"] == "TOP"
    layers = client.get(f"/api/v1/layouts/{uploaded_layout}/layers", headers=headers).json()["items"]
    assert [(item["layer_number"], item["datatype"]) for item in layers] == [(1, 0)]
    cells = client.get(f"/api/v1/layouts/{uploaded_layout}/cells", headers=headers).json()
    assert cells["total"] == 1
    top_index = payload["default_cell_index"]
    children = client.get(
        f"/api/v1/layouts/{uploaded_layout}/cells?parent_index={top_index}", headers=headers
    ).json()
    assert children["total"] == 1
    relation = children["items"][0]
    assert relation["instance_count"] == 8
    assert relation["placement_count"] == 3
    assert relation["array"]["is_array"] is True
    assert relation["array"]["samples"][0]["columns"] * relation["array"]["samples"][0]["rows"] == 6


def test_recursive_query_tiles_and_disk_cache(client, headers, uploaded_layout):
    metadata = client.get(f"/api/v1/layouts/{uploaded_layout}/metadata", headers=headers).json()
    top_index = metadata["default_cell_index"]
    query = client.post(
        f"/api/v1/layouts/{uploaded_layout}/query",
        headers=headers,
        json={"cell_index": top_index, "bbox": [-10000, -10000, 10000, 10000], "page_size": 3},
    )
    assert query.status_code == 200, query.text
    payload = query.json()
    assert payload["total"] == 8
    assert len(payload["items"]) == 3
    assert payload["stats"]["by_kind"]["box"] == 8
    nonrecursive = client.post(
        f"/api/v1/layouts/{uploaded_layout}/query",
        headers=headers,
        json={"cell_index": top_index, "bbox": [-10000, -10000, 10000, 10000], "recursive": False},
    )
    assert nonrecursive.json()["total"] == 0
    first = client.get(
        f"/api/v1/layouts/{uploaded_layout}/tiles?cell_index={top_index}&lod=0&tile_x=0&tile_y=0&max_shapes=20",
        headers=headers,
    )
    assert first.status_code == 200, first.text
    assert first.json()["cache_hit"] is False
    assert first.json()["total"] == 8
    assert first.json()["bbox"] == [1000, 2000, 5600, 6200]
    second = client.get(
        f"/api/v1/layouts/{uploaded_layout}/tiles?cell_index={top_index}&lod=0&tile_x=0&tile_y=0&max_shapes=20",
        headers=headers,
    )
    assert second.json()["cache_hit"] is True
    limited = client.get(
        f"/api/v1/layouts/{uploaded_layout}/tiles?cell_index={top_index}&max_shapes=2", headers=headers
    )
    assert limited.status_code == 200
    assert len(limited.json()["shapes"]) == 2
    assert limited.json()["truncated"] is True
