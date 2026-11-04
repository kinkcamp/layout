import earcut from 'earcut';
import type { TileResponse } from '@/types/api';

export interface TileGeometry {
  key: string;
  tile: TileResponse;
  layerVertices: Map<number, Float32Array>;
}

export function buildTileGeometry(key: string, tile: TileResponse): TileGeometry {
  const origin = tile.origin || [tile.bbox[0], tile.bbox[1]];
  const buffers = new Map<number, number[]>();
  for (const shape of tile.shapes) {
    if (!shape.polygons?.length) continue;
    const vertices = buffers.get(shape.layer_index) || [];
    for (const polygon of shape.polygons) {
      if (!polygon.hull || polygon.hull.length < 3) continue;
      const rings = [polygon.hull, ...(polygon.holes || [])].filter((ring) => ring.length >= 3);
      const flat: number[] = [];
      const holes: number[] = [];
      rings.forEach((ring, ringIndex) => {
        if (ringIndex > 0) holes.push(flat.length / 2);
        for (const point of ring) flat.push(point[0], point[1]);
      });
      if (flat.length < 6) continue;
      const triangles = earcut(flat, holes.length ? holes : undefined, 2);
      for (const index of triangles) {
        vertices.push(flat[index * 2] - origin[0], flat[index * 2 + 1] - origin[1]);
      }
    }
    buffers.set(shape.layer_index, vertices);
  }
  const layerVertices = new Map<number, Float32Array>();
  buffers.forEach((vertices, layerIndex) => layerVertices.set(layerIndex, new Float32Array(vertices)));
  return { key, tile, layerVertices };
}
