import type { BBox } from '@/types/api';

export interface Viewport {
  center: [number, number];
  scale: number;
}

export interface TileCoordinate { x: number; y: number }
export interface TileGrid {
  lod: number;
  tileSize: number;
  tiles: TileCoordinate[];
}

export const MIN_SCALE = 1e-10;
export const MAX_SCALE = 1e10;

export function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(point: [number, number], viewport: Viewport, width: number, height: number): [number, number] {
  return [
    viewport.center[0] + (point[0] - width / 2) / viewport.scale,
    viewport.center[1] + (height / 2 - point[1]) / viewport.scale,
  ];
}

export function worldToScreen(point: [number, number], viewport: Viewport, width: number, height: number): [number, number] {
  return [
    width / 2 + (point[0] - viewport.center[0]) * viewport.scale,
    height / 2 - (point[1] - viewport.center[1]) * viewport.scale,
  ];
}

export function fitViewport(bbox: BBox, width: number, height: number, padding = 0.9): Viewport {
  const spanX = Math.max(1, bbox[2] - bbox[0]);
  const spanY = Math.max(1, bbox[3] - bbox[1]);
  return {
    center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
    scale: clampScale(Math.min(width / spanX, height / spanY) * padding),
  };
}

export function getTileGrid(viewport: Viewport, width: number, height: number, cellBBox: BBox): TileGrid {
  const [cellLeft, cellBottom, cellRight, cellTop] = cellBBox;
  const spanX = Math.max(1, cellRight - cellLeft);
  const spanY = Math.max(1, cellTop - cellBottom);
  const desiredTileSize = 256 / viewport.scale;
  let lod = Math.max(0, Math.min(20, Math.round(Math.log2(Math.max(spanX, spanY) / desiredTileSize))));
  let tileSize = Math.max(spanX, spanY) / 2 ** lod;
  let tiles: TileCoordinate[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const left = viewport.center[0] - width / (2 * viewport.scale);
    const right = viewport.center[0] + width / (2 * viewport.scale);
    const bottom = viewport.center[1] - height / (2 * viewport.scale);
    const top = viewport.center[1] + height / (2 * viewport.scale);
    if (right < cellLeft || left > cellRight || top < cellBottom || bottom > cellTop) {
      return { lod, tileSize, tiles: [] };
    }
    const grid = 2 ** lod;
    const minX = Math.max(0, Math.min(grid - 1, Math.floor((left - cellLeft) / spanX * grid)));
    const maxX = Math.max(0, Math.min(grid - 1, Math.floor((right - cellLeft) / spanX * grid)));
    const minY = Math.max(0, Math.min(grid - 1, Math.floor((bottom - cellBottom) / spanY * grid)));
    const maxY = Math.max(0, Math.min(grid - 1, Math.floor((top - cellBottom) / spanY * grid)));
    tiles = [];
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) tiles.push({ x, y });
    if (tiles.length <= 96 || lod === 0) break;
    lod -= 1;
    tileSize = Math.max(spanX, spanY) / 2 ** lod;
  }
  return { lod, tileSize, tiles };
}

export function normalizeBBox(a: [number, number], b: [number, number]): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}
