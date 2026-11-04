import { apiFetch, queryString } from '@/lib/api';
import type { BBox, TileResponse } from '@/types/api';
import { buildTileGeometry } from './geometry';
import type { TileGeometry } from './geometry';
import { getTileGrid } from './viewport';
import type { Viewport } from './viewport';

export interface TileQuery {
  layoutId: string;
  cellIndex: number;
  layerIndexes: number[];
  viewport: Viewport;
  width: number;
  height: number;
  cellBBox: BBox;
}

export interface TileSnapshot {
  geometries: TileGeometry[];
  loading: number;
  error: string | null;
  cacheHits: number;
  truncated: boolean;
  lod: number;
}

interface CacheEntry { geometry: TileGeometry }
interface Job { key: string; query: TileQuery; lod: number; x: number; y: number }
type Listener = (snapshot: TileSnapshot) => void;

export class TileManager {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, AbortController>();
  private errors = new Map<string, string>();
  private queue: Job[] = [];
  private active = 0;
  private generation = 0;
  private currentKeys = new Set<string>();
  private lastQuery: TileQuery | null = null;
  private listener: Listener | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastLod = 0;

  constructor(private maxEntries = 96, private maxConcurrent = 6) {}

  sync(query: TileQuery, listener: Listener) {
    this.lastQuery = query;
    this.listener = listener;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.runSync(), 120);
  }

  private runSync() {
    const query = this.lastQuery;
    if (!query || query.width <= 0 || query.height <= 0) return;
    const grid = getTileGrid(query.viewport, query.width, query.height, query.cellBBox);
    this.lastLod = grid.lod;
    const layerSignature = [...query.layerIndexes].sort((a, b) => a - b).join(',');
    const nextKeys = new Set(grid.tiles.map(({ x, y }) => tileKey(query, grid.lod, x, y, layerSignature)));
    this.inflight.forEach((controller, key) => {
      if (!nextKeys.has(key)) controller.abort();
    });
    this.queue = this.queue.filter((job) => nextKeys.has(job.key));
    this.currentKeys = nextKeys;
    grid.tiles.forEach(({ x, y }) => {
      const key = tileKey(query, grid.lod, x, y, layerSignature);
      if (!this.cache.has(key) && !this.inflight.has(key) && !this.errors.has(key)) {
        this.queue.push({ key, query, lod: grid.lod, x, y });
      }
    });
    this.pump();
    this.notify();
  }

  private pump() {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift()!;
      if (this.cache.has(job.key) || this.inflight.has(job.key)) continue;
      if (!this.currentKeys.has(job.key)) continue;
      const controller = new AbortController();
      this.inflight.set(job.key, controller);
      this.active += 1;
      const layers = [...job.query.layerIndexes].sort((a, b) => a - b).join(',');
      void apiFetch<TileResponse>(`/layouts/${job.query.layoutId}/tiles${queryString({
        cell_index: job.query.cellIndex,
        lod: job.lod,
        tile_x: job.x,
        tile_y: job.y,
        layers,
        max_shapes: 5000,
      })}`, { signal: controller.signal }).then((tile) => {
        const geometry = buildTileGeometry(job.key, tile);
        this.cache.delete(job.key);
        this.cache.set(job.key, { geometry });
        this.errors.delete(job.key);
        this.evict();
      }).catch((error: unknown) => {
        if (!isAbort(error)) this.errors.set(job.key, error instanceof Error ? error.message : '瓦片加载失败');
      }).finally(() => {
        this.inflight.delete(job.key);
        this.active -= 1;
        this.pump();
        this.notify();
      });
    }
  }

  private notify() {
    if (!this.listener || !this.lastQuery) return;
    const geometries: TileGeometry[] = [];
    let loading = 0;
    let error: string | null = null;
    let cacheHits = 0;
    let truncated = false;
    this.currentKeys.forEach((key) => {
      const cached = this.cache.get(key);
      if (cached) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        geometries.push(cached.geometry);
        if (cached.geometry.tile.cache_hit) cacheHits += 1;
        truncated ||= cached.geometry.tile.truncated;
      } else if (this.errors.has(key)) error ||= this.errors.get(key) || '瓦片加载失败';
      else loading += 1;
    });
    this.listener({ geometries, loading, error, cacheHits, truncated, lod: this.lastLod });
  }

  private evict() {
    while (this.cache.size > this.maxEntries) {
      const candidate = [...this.cache.keys()].find((key) => !this.currentKeys.has(key));
      if (!candidate) break;
      this.cache.delete(candidate);
    }
  }

  retry() {
    this.errors.clear();
    if (this.timer) clearTimeout(this.timer);
    this.runSync();
  }

  reset() {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.inflight.forEach((controller) => controller.abort());
    this.queue = [];
    this.cache.clear();
    this.errors.clear();
    this.currentKeys.clear();
  }

  dispose() {
    this.reset();
    this.listener = null;
    this.lastQuery = null;
  }
}

function tileKey(query: TileQuery, lod: number, x: number, y: number, layers: string) {
  return `${query.layoutId}:${query.cellIndex}:${lod}:${x}:${y}:${layers}`;
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
