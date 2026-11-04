from __future__ import annotations

from app.models import LayoutFile
from app.services.layout_cache import LayoutCache


def test_layout_cache_reuses_instances_and_bounds_concurrency(sample_gds):
    layout_file = LayoutFile(
        id="cache-test",
        project_id="project",
        original_name=sample_gds.name,
        storage_path=str(sample_gds),
        format="GDSII",
        size_bytes=sample_gds.stat().st_size,
        total_chunks=1,
        chunk_size=sample_gds.stat().st_size,
        sha256="cache-test-sha256",
        status="READY",
        created_by="user",
    )
    cache = LayoutCache(max_entries=2)
    with cache.acquire(layout_file) as first:
        assert first.cells() == 2
    with cache.acquire(layout_file) as reused:
        assert reused is first
        with cache.acquire(layout_file) as concurrent:
            assert concurrent is not first
            assert concurrent.cells() == 2
    with cache.acquire(layout_file) as after_release:
        assert after_release in (first, concurrent)
