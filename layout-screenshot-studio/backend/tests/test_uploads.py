from __future__ import annotations

import hashlib
import math


def test_upload_rejects_bad_chunk_math(client, headers, project_id):
    response = client.post(
        "/api/v1/files",
        headers=headers,
        json={
            "project_id": project_id,
            "filename": "bad.gds",
            "size_bytes": 100,
            "total_chunks": 3,
            "chunk_size": 64,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_chunk_order_duplicate_and_path_sanitization(client, headers, project_id, sample_gds):
    data = sample_gds.read_bytes()
    chunk_size = 512
    total = math.ceil(len(data) / chunk_size)
    created = client.post(
        "/api/v1/files",
        headers=headers,
        json={
            "project_id": project_id,
            "filename": "../../safe-name.gds",
            "size_bytes": len(data),
            "total_chunks": total,
            "chunk_size": chunk_size,
            "sha256": hashlib.sha256(data).hexdigest(),
        },
    )
    assert created.status_code == 201
    payload = created.json()
    assert payload["filename"] == "safe-name.gds"
    layout_id = payload["id"]
    incomplete = client.post(f"/api/v1/files/{layout_id}/complete", headers=headers)
    assert incomplete.status_code == 409
    assert incomplete.json()["error"]["code"] == "CHUNKS_MISSING"
    oversized = client.put(
        f"/api/v1/files/{layout_id}/chunks/0",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=b"X" * (chunk_size + 1),
    )
    assert oversized.status_code == 413
    first = client.put(
        f"/api/v1/files/{layout_id}/chunks/0",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=data[:chunk_size],
    )
    assert first.status_code == 200
    duplicate = client.put(
        f"/api/v1/files/{layout_id}/chunks/0",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=data[:chunk_size],
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    for index in range(1, total):
        response = client.put(
            f"/api/v1/files/{layout_id}/chunks/{index}",
            headers={**headers, "Content-Type": "application/octet-stream"},
            content=data[index * chunk_size : (index + 1) * chunk_size],
        )
        assert response.status_code == 200
    complete = client.post(f"/api/v1/files/{layout_id}/complete", headers=headers)
    assert complete.status_code == 200
    status = client.get(f"/api/v1/files/{layout_id}/status", headers=headers)
    assert status.json()["status"] == "READY"
    assert status.json()["completed_chunks"] == list(range(total))


def test_sha256_mismatch_is_rejected(client, headers, project_id, sample_gds):
    data = sample_gds.read_bytes()
    created = client.post(
        "/api/v1/files",
        headers=headers,
        json={
            "project_id": project_id,
            "filename": "wrong-hash.gds",
            "size_bytes": len(data),
            "total_chunks": 1,
            "chunk_size": len(data),
            "sha256": "0" * 64,
        },
    )
    layout_id = created.json()["id"]
    uploaded = client.put(
        f"/api/v1/files/{layout_id}/chunks/0",
        headers={**headers, "Content-Type": "application/octet-stream"},
        content=data,
    )
    assert uploaded.status_code == 200
    complete = client.post(f"/api/v1/files/{layout_id}/complete", headers=headers)
    assert complete.status_code == 409
    assert complete.json()["error"]["code"] == "SHA256_MISMATCH"
    status = client.get(f"/api/v1/files/{layout_id}/status", headers=headers)
    assert status.json()["status"] == "UPLOADING"
