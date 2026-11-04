from __future__ import annotations


def test_create_and_list_project(client, headers):
    response = client.post(
        "/api/v1/projects",
        headers=headers,
        json={"name": "Layout POC", "description": "project portal test"},
    )
    assert response.status_code == 201, response.text
    project = response.json()
    assert project["name"] == "Layout POC"
    assert project["description"] == "project portal test"
    assert project["owner_id"]
    listing = client.get("/api/v1/projects", headers=headers)
    assert listing.status_code == 200
    assert any(item["id"] == project["id"] for item in listing.json()["items"])
