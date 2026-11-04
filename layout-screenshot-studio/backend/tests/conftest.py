from __future__ import annotations

import hashlib
import math
import os
import shutil
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

import pytest

TEST_ROOT = Path(tempfile.mkdtemp(prefix="layout-studio-tests-"))
os.environ["LSS_ENVIRONMENT"] = "test"
os.environ["LSS_DATA_DIR"] = str(TEST_ROOT / "data")
os.environ["LSS_DATABASE_URL"] = f"sqlite:///{TEST_ROOT / 'test.db'}"
os.environ["LSS_ADMIN_PASSWORD"] = "admin123"
os.environ["LSS_MIN_FREE_DISK_BYTES"] = "1024"

import klayout.db as kdb
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client
    shutil.rmtree(TEST_ROOT, ignore_errors=True)


@pytest.fixture(scope="session")
def headers(client) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture(scope="session")
def project_id(client, headers) -> str:
    response = client.get("/api/v1/projects", headers=headers)
    assert response.status_code == 200
    return response.json()["items"][0]["id"]


def make_sample_gds(path: Path) -> Path:
    layout = kdb.Layout()
    layout.dbu = 0.001
    top = layout.create_cell("TOP")
    child = layout.create_cell("CHILD")
    layer = layout.layer(1, 0)
    child.shapes(layer).insert(kdb.Box(0, 0, 100, 200))
    top.insert(kdb.CellInstArray(child.cell_index(), kdb.Trans(kdb.Vector(1000, 2000))))
    top.insert(
        kdb.CellInstArray(
            child.cell_index(),
            kdb.ICplxTrans(1.0, 90, False, 3000, 4000),
        )
    )
    top.insert(
        kdb.CellInstArray(
            child.cell_index(),
            kdb.Trans(kdb.Vector(5000, 5000)),
            kdb.Vector(500, 0),
            kdb.Vector(0, 500),
            2,
            3,
        )
    )
    layout.write(str(path))
    return path


def upload_file(client, headers, project_id: str, path: Path, chunk_size: int = 1024, sha256: str | None = None):
    data = path.read_bytes()
    total_chunks = math.ceil(len(data) / chunk_size)
    response = client.post(
        "/api/v1/files",
        headers=headers,
        json={
            "project_id": project_id,
            "filename": path.name,
            "size_bytes": len(data),
            "total_chunks": total_chunks,
            "chunk_size": chunk_size,
            "sha256": sha256 if sha256 is not None else hashlib.sha256(data).hexdigest(),
        },
    )
    assert response.status_code == 201, response.text
    layout_id = response.json()["id"]
    for index in reversed(range(total_chunks)):
        chunk = data[index * chunk_size : (index + 1) * chunk_size]
        uploaded = client.put(
            f"/api/v1/files/{layout_id}/chunks/{index}",
            headers={**headers, "Content-Type": "application/octet-stream"},
            content=chunk,
        )
        assert uploaded.status_code == 200, uploaded.text
    completed = client.post(f"/api/v1/files/{layout_id}/complete", headers=headers)
    assert completed.status_code == 200, completed.text
    return layout_id


@pytest.fixture(scope="session")
def sample_gds() -> Path:
    return make_sample_gds(TEST_ROOT / "synthetic.gds")


@pytest.fixture(scope="session")
def uploaded_layout(client, headers, project_id, sample_gds) -> str:
    return upload_file(client, headers, project_id, sample_gds)
