from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import klayout.db as kdb

from app.core.config import get_settings
from app.core.errors import AppError
from app.models import LayoutFile


@dataclass
class _CacheEntry:
    layout: kdb.Layout | None = None
    in_use: bool = True


class LayoutCache:
    """Bounded process-local pool; each KLayout instance is used by one thread at a time."""

    def __init__(self, max_entries: int) -> None:
        self.max_entries = max_entries
        self._buckets: OrderedDict[tuple, list[_CacheEntry]] = OrderedDict()
        self._condition = threading.Condition()

    def _entry_count(self) -> int:
        return sum(len(bucket) for bucket in self._buckets.values())

    def _evict_idle(self, exclude: tuple) -> bool:
        for key, bucket in list(self._buckets.items()):
            if key == exclude:
                continue
            for entry in list(bucket):
                if not entry.in_use:
                    bucket.remove(entry)
                    if not bucket:
                        self._buckets.pop(key, None)
                    return True
        return False

    @contextmanager
    def acquire(self, layout_file: LayoutFile) -> Iterator[kdb.Layout]:
        if not layout_file.storage_path:
            raise AppError("LAYOUT_NOT_READY", "Layout has no original file", 409)
        path = Path(layout_file.storage_path).resolve()
        try:
            stat = path.stat()
        except OSError as exc:
            raise AppError("LAYOUT_READ_FAILED", "Original layout file is unavailable", 422) from exc
        key = (str(path), layout_file.sha256, stat.st_mtime_ns, stat.st_size)
        entry: _CacheEntry | None = None
        created = False
        with self._condition:
            while entry is None:
                bucket = self._buckets.get(key)
                if bucket is None:
                    bucket = []
                    self._buckets[key] = bucket
                else:
                    self._buckets.move_to_end(key)
                idle = next((candidate for candidate in bucket if not candidate.in_use), None)
                if idle is not None:
                    idle.in_use = True
                    entry = idle
                    break
                if self._entry_count() < self.max_entries:
                    entry = _CacheEntry()
                    bucket.append(entry)
                    created = True
                    break
                self._evict_idle(key)
                if self._entry_count() >= self.max_entries:
                    self._condition.wait()
        if created:
            try:
                layout = kdb.Layout()
                layout.read(str(path))
                entry.layout = layout
            except Exception as exc:
                with self._condition:
                    bucket = self._buckets.get(key, [])
                    if entry in bucket:
                        bucket.remove(entry)
                    if not bucket:
                        self._buckets.pop(key, None)
                    self._condition.notify_all()
                raise AppError("LAYOUT_READ_FAILED", "KLayout could not read the original file", 422) from exc
        try:
            if entry.layout is None:
                raise AppError("LAYOUT_READ_FAILED", "Cached layout is unavailable", 500)
            yield entry.layout
        finally:
            with self._condition:
                entry.in_use = False
                self._condition.notify_all()

    def clear(self) -> None:
        with self._condition:
            self._buckets.clear()
            self._condition.notify_all()


layout_cache = LayoutCache(max_entries=get_settings().layout_cache_entries)
