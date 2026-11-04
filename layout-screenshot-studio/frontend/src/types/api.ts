export type BBox = [number, number, number, number];
export type TaskStatus = 'CREATED' | 'UPLOADING' | 'UPLOADED' | 'QUEUED' | 'RUNNING' | 'READY' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export interface User {
  id: string;
  username: string;
  role?: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  owner_id?: string;
  created_at?: string;
}

export interface LayoutMarker {
  id: string;
  cell_index: number;
  x: number;
  y: number;
  label: string;
}

export interface LayoutFile {
  id: string;
  project_id: string;
  filename: string;
  original_name?: string;
  size_bytes: number;
  sha256?: string;
  status: TaskStatus | string;
  error?: string | null;
  error_message?: string | null;
  total_chunks?: number;
  completed_chunks?: number[];
  dbu_um?: number;
  cell_count?: number;
  bbox?: BBox;
  created_at?: string;
}

export interface UploadSession extends LayoutFile {
  upload_id?: string;
  chunk_size?: number;
}

export interface FileStatus {
  id: string;
  status: TaskStatus | string;
  completed_chunks: number[];
  error?: string | null;
  error_message?: string | null;
  progress?: number;
}

export interface TopCell {
  cell_index: number;
  cell_name?: string;
  name?: string;
  bbox: BBox;
}

export interface LayoutMetadata {
  id: string;
  filename?: string;
  dbu_um: number;
  cell_count: number;
  bbox?: BBox;
  top_cells: TopCell[];
  default_cell_index?: number;
  parse_seconds?: number;
}

export interface Layer {
  id: string;
  layer_index: number;
  layer_number: number;
  datatype: number;
  name?: string;
  default_color: string;
  visible_default: boolean;
}

export interface LayerConfig extends Layer {
  color: string;
  opacity: number;
  visible: boolean;
}

export interface Cell {
  cell_index: number;
  cell_name: string;
  bbox: BBox;
  is_top: boolean;
  direct_instance_count: number;
  instance_count?: number;
  array_summary?: string | { rows?: number; columns?: number; count?: number; [key: string]: unknown };
}

export interface Paged<T> {
  items: T[];
  total: number;
  truncated?: boolean;
}

export interface Polygon {
  hull: [number, number][];
  holes: [number, number][][];
}

export interface TileShape {
  layer_index: number;
  layer_number: number;
  datatype: number;
  kind: string;
  polygons: Polygon[];
  text?: string;
}

export interface TileResponse {
  bbox: BBox;
  origin: [number, number];
  dbu_um: number;
  shapes: TileShape[];
  truncated: boolean;
  total: number;
  cache_hit: boolean;
}

export interface QueryGeometry {
  id?: string | number;
  shape_index?: number;
  layer_index?: number;
  layer_number?: number;
  datatype?: number;
  kind?: string;
  bbox?: BBox;
  polygons?: Polygon[];
  text?: string;
  cell_index?: number;
  [key: string]: unknown;
}

export interface ScreenshotLayer {
  layer_index: number;
  layer_number: number;
  datatype: number;
  color: string;
  opacity: number;
  visible: boolean;
}

export interface ScreenshotRequest {
  name: string;
  layout_id: string;
  cell_index: number;
  bbox: BBox;
  width_px: number;
  height_px: number;
  aspect_ratio: string;
  layers: ScreenshotLayer[];
  background: string;
  margin_px: number;
  annotations: {
    title: string | null;
    scale: boolean;
    coordinates: boolean;
    legend: boolean;
    markers?: Array<{ x: number; y: number; label: string }>;
  };
}

export interface ScreenshotTask extends ScreenshotRequest {
  id: string;
  status: TaskStatus | string;
  error?: string | null;
  error_code?: string;
  duration_seconds?: number;
  elapsed_seconds?: number;
  created_at?: string;
  started_at?: string;
  finished_at?: string;
  file_size_bytes?: number;
}
