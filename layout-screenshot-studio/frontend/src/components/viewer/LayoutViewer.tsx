import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Spin, Tag, Tooltip } from 'antd';
import { BorderOutlined, ColumnWidthOutlined, DeleteOutlined, DragOutlined, EnvironmentOutlined, ExpandOutlined, MinusOutlined, PlusOutlined, SearchOutlined, VerticalAlignTopOutlined } from '@ant-design/icons';
import { useAppStore } from '@/store/appStore';
import { TileManager } from '@/renderer/TileManager';
import type { TileSnapshot } from '@/renderer/TileManager';
import { WebGLRenderer } from '@/renderer/WebGLRenderer';
import { clampScale, fitViewport, getTileGrid, normalizeBBox, screenToWorld, worldToScreen } from '@/renderer/viewport';
import type { Viewport } from '@/renderer/viewport';
import type { BBox, Cell } from '@/types/api';
import { QueryDrawer } from './QueryDrawer';

interface DragState {
  mode: 'pan' | 'select' | 'ruler';
  pointerId: number;
  start: [number, number];
  current: [number, number];
  startCenter: [number, number];
}

const EMPTY_TILES: TileSnapshot = { geometries: [], loading: 0, error: null, cacheHits: 0, truncated: false, lod: 0 };

export function LayoutViewer() {
  const layoutId = useAppStore((state) => state.selectedFileId)!;
  const metadata = useAppStore((state) => state.metadata)!;
  const layers = useAppStore((state) => state.layers);
  const selectedCell = useAppStore((state) => state.selectedCell)!;
  const selection = useAppStore((state) => state.selection);
  const setSelection = useAppStore((state) => state.setSelection);
  const markers = useAppStore((state) => state.markers);
  const addMarker = useAppStore((state) => state.addMarker);
  const removeMarker = useAppStore((state) => state.removeMarker);
  const setSelectedCell = useAppStore((state) => state.setSelectedCell);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const managerRef = useRef<TileManager | null>(null);
  if (!managerRef.current) managerRef.current = new TileManager();
  const dragRef = useRef<DragState | null>(null);
  const spacePressed = useRef(false);
  const viewportRef = useRef<Viewport>({ center: [0, 0], scale: 1 });
  const sizeRef = useRef({ width: 1, height: 1 });
  const [viewport, setViewport] = useState<Viewport>(viewportRef.current);
  const [size, setSize] = useState(sizeRef.current);
  const [tiles, setTiles] = useState<TileSnapshot>(EMPTY_TILES);
  const [mouseWorld, setMouseWorld] = useState<[number, number]>([0, 0]);
  const [unit, setUnit] = useState<'um' | 'dbu'>('um');
  const [tool, setTool] = useState<'select' | 'pan' | 'mark' | 'ruler'>('select');
  const [ruler, setRuler] = useState<{ start: [number, number]; end: [number, number] } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [dragRect, setDragRect] = useState<DragState | null>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [renderNonce, setRenderNonce] = useState(0);

  viewportRef.current = viewport;
  sizeRef.current = size;

  const cellBBox = useMemo<BBox>(() => (
    selectedCell.bbox || metadata.bbox || [0, 0, 1000, 1000]
  ), [selectedCell, metadata.bbox]);

  const fitBBox = useCallback((bbox: BBox) => {
    const { width, height } = sizeRef.current;
    if (width > 1 && height > 1) setViewport(fitViewport(bbox, width, height));
  }, []);

  const fitCurrent = useCallback(() => {
    fitBBox(selectedCell.bbox || metadata.bbox || metadata.top_cells[0]?.bbox || [0, 0, 1000, 1000]);
  }, [fitBBox, metadata, selectedCell]);

  const goTop = useCallback(() => {
    const top = metadata.top_cells.find((cell) => cell.cell_index === metadata.default_cell_index) || metadata.top_cells[0];
    if (!top) return;
    const cell: Cell = {
      cell_index: top.cell_index,
      cell_name: top.cell_name || top.name || `Cell ${top.cell_index}`,
      bbox: top.bbox,
      is_top: true,
      direct_instance_count: selectedCell.is_top ? selectedCell.direct_instance_count : 0,
    };
    setSelectedCell(cell);
    fitBBox(top.bbox);
  }, [fitBBox, metadata.top_cells, selectedCell, setSelectedCell]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, entry.contentRect.width);
      const height = Math.max(1, entry.contentRect.height);
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    managerRef.current?.reset();
    setTiles(EMPTY_TILES);
    setSelection(null);
    setRuler(null);
    fitCurrent();
  }, [layoutId, selectedCell.cell_index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fitCurrent(); }, [size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => managerRef.current?.dispose(), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new WebGLRenderer(canvas);
      setGlError(null);
    } catch (error) {
      setGlError(error instanceof Error ? error.message : 'WebGL2 初始化失败');
    }
    return () => { rendererRef.current?.dispose(); rendererRef.current = null; };
  }, [renderNonce]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const lost = (event: Event) => { event.preventDefault(); setGlError('WebGL 上下文已丢失，正在等待浏览器恢复'); };
    const restored = () => setRenderNonce((value) => value + 1);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => { canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored); };
  }, []);

  const layerKey = layers.filter((layer) => layer.visible).map((layer) => layer.layer_index).sort((a, b) => a - b).join(',');
  useEffect(() => {
    if (!layerKey) {
      managerRef.current?.reset();
      setTiles(EMPTY_TILES);
      return;
    }
    if (!layoutId || size.width <= 1 || size.height <= 1) return;
    managerRef.current?.sync({
      layoutId,
      cellIndex: selectedCell.cell_index,
      layerIndexes: layerKey.split(',').map(Number),
      viewport,
      width: size.width,
      height: size.height,
      cellBBox,
    }, setTiles);
  }, [layoutId, selectedCell.cell_index, layerKey, viewport, size.width, size.height, cellBBox]);

  useEffect(() => {
    if (!rendererRef.current || glError) return;
    try {
      rendererRef.current.render({
        geometries: tiles.geometries,
        layers,
        viewport,
        width: size.width,
        height: size.height,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
    } catch (error) {
      setGlError(error instanceof Error ? error.message : 'WebGL 渲染失败');
    }
  }, [tiles.geometries, layers, viewport, size, glError, renderNonce]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
      const { width, height } = sizeRef.current;
      setViewport((current) => {
        const anchor = screenToWorld(point, current, width, height);
        const scale = clampScale(current.scale * Math.exp(-event.deltaY * 0.0015));
        return {
          scale,
          center: [anchor[0] - (point[0] - width / 2) / scale, anchor[1] - (height / 2 - point[1]) / scale],
        };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest('input, textarea, [contenteditable="true"]'));
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        setRuler(null);
        dragRef.current = null;
        setDragRect(null);
      }
      if (event.code === 'Space' && !isEditable(event.target)) {
        spacePressed.current = true;
        setSpaceDown(true);
        if (document.activeElement === canvasRef.current) event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') { spacePressed.current = false; setSpaceDown(false); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.focus();
    const point = pointerPosition(event);
    if (tool === 'mark' && event.button === 0) {
      const world = screenToWorld(point, viewportRef.current, size.width, size.height);
      const number = markers.filter((marker) => marker.cell_index === selectedCell.cell_index).length + 1;
      addMarker({
        id: crypto.randomUUID(),
        cell_index: selectedCell.cell_index,
        x: Math.round(world[0]),
        y: Math.round(world[1]),
        label: `M${number}`,
      });
      return;
    }
    const pan = event.button === 1 || spacePressed.current || tool === 'pan';
    const mode = pan ? 'pan' : tool === 'ruler' ? 'ruler' : 'select';
    const drag: DragState = { mode, pointerId: event.pointerId, start: point, current: point, startCenter: viewport.center };
    dragRef.current = drag;
    setDragRect(drag);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event);
    setMouseWorld(screenToWorld(point, viewportRef.current, size.width, size.height));
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'pan') {
      const dx = point[0] - drag.start[0];
      const dy = point[1] - drag.start[1];
      setViewport((current) => ({ ...current, center: [drag.startCenter[0] - dx / current.scale, drag.startCenter[1] + dy / current.scale] }));
    } else {
      const next = { ...drag, current: point };
      dragRef.current = next;
      setDragRect(next);
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'select') {
      const point = pointerPosition(event);
      if (Math.abs(point[0] - drag.start[0]) >= 4 && Math.abs(point[1] - drag.start[1]) >= 4) {
        const a = screenToWorld(drag.start, viewportRef.current, size.width, size.height);
        const b = screenToWorld(point, viewportRef.current, size.width, size.height);
        setSelection(normalizeBBox(a, b));
        setQueryOpen(true);
      }
    } else if (drag.mode === 'ruler') {
      const point = pointerPosition(event);
      if (Math.hypot(point[0] - drag.start[0], point[1] - drag.start[1]) >= 4) {
        setRuler({
          start: screenToWorld(drag.start, viewportRef.current, size.width, size.height),
          end: screenToWorld(point, viewportRef.current, size.width, size.height),
        });
      }
    }
    dragRef.current = null;
    setDragRect(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const zoom = (factor: number) => setViewport((current) => ({ ...current, scale: clampScale(current.scale * factor) }));
  const grid = getTileGrid(viewport, size.width, size.height, cellBBox);
  const scaleBar = getScaleBar(viewport.scale, metadata.dbu_um, unit);
  const selectionRect = selection ? worldRect(selection, viewport, size.width, size.height) : null;
  const activeRect = dragRect?.mode === 'select' ? screenRect(dragRect.start, dragRect.current) : null;
  const activeRuler = dragRect?.mode === 'ruler' ? {
    start: screenToWorld(dragRect.start, viewport, size.width, size.height),
    end: screenToWorld(dragRect.current, viewport, size.width, size.height),
  } : ruler;
  const rulerScreen = activeRuler ? {
    start: worldToScreen(activeRuler.start, viewport, size.width, size.height),
    end: worldToScreen(activeRuler.end, viewport, size.width, size.height),
  } : null;
  const currentMarkers = markers.filter((marker) => marker.cell_index === selectedCell.cell_index);
  const cursor = dragRef.current?.mode === 'pan' || spaceDown || tool === 'pan' ? 'grabbing' : 'crosshair';

  return (
    <div className="layout-viewer">
      <div className="viewer-toolbar">
        <div className="viewer-cell-breadcrumb"><span>CELL</span><strong>{selectedCell.cell_name}</strong><Tag>#{selectedCell.cell_index}</Tag></div>
        <div className="viewer-tool-group">
          <Tooltip title="框选区域并查询（左键拖动）"><Button type={tool === 'select' ? 'primary' : 'text'} icon={<BorderOutlined />} onClick={() => setTool('select')} aria-label="框选工具" /></Tooltip>
          <Tooltip title="平移（中键或空格 + 左键）"><Button type={tool === 'pan' ? 'primary' : 'text'} icon={<DragOutlined />} onClick={() => setTool('pan')} aria-label="平移工具" /></Tooltip>
          <Tooltip title="标记：单击版图添加标记"><Button type={tool === 'mark' ? 'primary' : 'text'} icon={<EnvironmentOutlined />} onClick={() => setTool('mark')} aria-label="标记工具" /></Tooltip>
          <Tooltip title="标尺：按住左键拖动测量距离"><Button type={tool === 'ruler' ? 'primary' : 'text'} icon={<ColumnWidthOutlined />} onClick={() => setTool('ruler')} aria-label="标尺工具" /></Tooltip>
          {ruler && <Tooltip title="清除标尺（Esc）"><Button type="text" icon={<DeleteOutlined />} onClick={() => setRuler(null)} aria-label="清除标尺" /></Tooltip>}
          <span className="toolbar-divider" />
          <Tooltip title="适配当前 Cell"><Button type="text" icon={<ExpandOutlined />} onClick={fitCurrent} aria-label="适配全部" /></Tooltip>
          <Tooltip title="回到 Top Cell"><Button type="text" icon={<VerticalAlignTopOutlined />} onClick={goTop} aria-label="回到 Top Cell" /></Tooltip>
          <Tooltip title="缩小"><Button type="text" icon={<MinusOutlined />} onClick={() => zoom(1 / 1.5)} aria-label="缩小" /></Tooltip>
          <Tooltip title="放大"><Button type="text" icon={<PlusOutlined />} onClick={() => zoom(1.5)} aria-label="放大" /></Tooltip>
          <Button icon={<SearchOutlined />} disabled={!selection} onClick={() => setQueryOpen(true)}>区域查询</Button>
        </div>
        <Select className="unit-select" value={unit} onChange={setUnit} options={[{ value: 'um', label: 'µm' }, { value: 'dbu', label: 'DBU' }]} aria-label="坐标单位" />
      </div>
      <div className="canvas-container" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="webgl-canvas"
          style={{ cursor }}
          tabIndex={0}
          aria-label="WebGL2 版图视口。滚轮缩放，中键或空格加左键平移，左键拖动弹选。"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onContextMenu={(event) => event.preventDefault()}
        />
        <div className="canvas-grid" style={{ backgroundSize: `${scaleBar.pixels}px ${scaleBar.pixels}px` }} />
        {activeRect && <div className="selection-rectangle active" style={activeRect}><span>{formatRectSize(dragRect!.start, dragRect!.current, viewport, metadata.dbu_um, unit)}</span></div>}
        {selectionRect && !activeRect && <div className="selection-rectangle" style={selectionRect}><span>查询 / 截图范围</span></div>}
        {rulerScreen && activeRuler && <>
          <svg className="measurement-layer" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
            <line x1={rulerScreen.start[0]} y1={rulerScreen.start[1]} x2={rulerScreen.end[0]} y2={rulerScreen.end[1]} />
            <circle cx={rulerScreen.start[0]} cy={rulerScreen.start[1]} r={4} />
            <circle cx={rulerScreen.end[0]} cy={rulerScreen.end[1]} r={4} />
          </svg>
          <div className="ruler-label" style={{ left: (rulerScreen.start[0] + rulerScreen.end[0]) / 2, top: (rulerScreen.start[1] + rulerScreen.end[1]) / 2 }}>{formatRuler(activeRuler, metadata.dbu_um, unit)}</div>
        </>}
        {currentMarkers.map((marker) => {
          const point = worldToScreen([marker.x, marker.y], viewport, size.width, size.height);
          return <div className="layout-marker" key={marker.id} style={{ left: point[0], top: point[1] }} title={`${marker.label}: ${marker.x}, ${marker.y} DBU`}><EnvironmentOutlined /><span>{marker.label}</span><button type="button" onClick={() => removeMarker(marker.id)} aria-label={`删除标记 ${marker.label}`}>×</button></div>;
        })}
        <div className="viewport-badges"><Tag>LOD {tiles.lod || grid.lod}</Tag><Tag>{tiles.geometries.length} 瓦片</Tag>{currentMarkers.length > 0 && <Tag color="gold">{currentMarkers.length} 标记</Tag>}{tiles.cacheHits > 0 && <Tag color="green">缓存 {tiles.cacheHits}</Tag>}</div>
        {tiles.loading > 0 && <div className="tile-loading"><Spin size="small" /><span>加载 {tiles.loading} 个瓦片</span></div>}
        {tiles.truncated && <div className="truncated-warning">部分瓦片几何已截断，请放大查看完整细节</div>}
        {tiles.error && <Alert className="tile-error" type="error" showIcon message={tiles.error} action={<Button size="small" onClick={() => managerRef.current?.retry()}>重试</Button>} />}
        {glError && <div className="webgl-error"><Alert type="error" showIcon message="无法启动 WebGL2" description={glError} /></div>}
        {!glError && !tiles.loading && !tiles.error && !tiles.geometries.length && <div className="tiles-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前视口没有可显示几何" /></div>}
        <div className="scale-overlay"><div className="scale-bar" style={{ width: scaleBar.pixels }} /><span>{scaleBar.label}</span></div>
        <div className="coordinate-overlay">
          <span>X <code>{formatCoordinate(mouseWorld[0], metadata.dbu_um, unit)}</code></span>
          <span>Y <code>{formatCoordinate(mouseWorld[1], metadata.dbu_um, unit)}</code></span>
          <span>{unit === 'um' ? 'µm' : 'DBU'}</span>
        </div>
      </div>
      <div className="viewer-statusbar">
        <span>1 px = {formatCoordinate(1 / viewport.scale, metadata.dbu_um, unit)} {unit === 'um' ? 'µm' : 'DBU'}</span>
        <span>缩放 {formatZoom(viewport.scale * metadata.dbu_um)}</span>
        <span className="statusbar-help">滚轮：鼠标中心缩放 · 中键 / Space + 左键：平移 · 左键：框选</span>
      </div>
      <QueryDrawer open={queryOpen} onClose={() => setQueryOpen(false)} />
    </div>
  );
}

function screenRect(a: [number, number], b: [number, number]) {
  return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}

function worldRect(bbox: BBox, viewport: Viewport, width: number, height: number) {
  return screenRect(worldToScreen([bbox[0], bbox[3]], viewport, width, height), worldToScreen([bbox[2], bbox[1]], viewport, width, height));
}

function getScaleBar(scale: number, dbuUm: number, unit: 'um' | 'dbu') {
  const targetDbu = 96 / scale;
  const exponent = 10 ** Math.floor(Math.log10(Math.max(targetDbu, 1e-12)));
  const normalized = targetDbu / exponent;
  const nice = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * exponent;
  const pixels = Math.max(24, nice * scale);
  const value = unit === 'um' ? nice * dbuUm : nice;
  return { pixels, label: `${formatShort(value)} ${unit === 'um' ? 'µm' : 'DBU'}` };
}

function formatCoordinate(value: number, dbuUm: number, unit: 'um' | 'dbu') {
  const converted = unit === 'um' ? value * dbuUm : value;
  const digits = Math.abs(converted) < 10 && unit === 'um' ? 4 : 2;
  return converted.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function formatShort(value: number) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: value < 1 ? 4 : 2 });
}

function formatZoom(scaleUm: number) {
  const percent = scaleUm * 100;
  if (percent >= 100) return `${Math.round(percent)}%`;
  if (percent >= 1) return `${percent.toFixed(1)}%`;
  return `${percent.toExponential(1)}%`;
}

function formatRuler(ruler: { start: [number, number]; end: [number, number] }, dbu: number, unit: 'um' | 'dbu') {
  const dx = ruler.end[0] - ruler.start[0];
  const dy = ruler.end[1] - ruler.start[1];
  const distance = Math.hypot(dx, dy);
  const convert = (value: number) => unit === 'um' ? value * dbu : value;
  return `L ${formatShort(convert(distance))} · ΔX ${formatShort(convert(dx))} · ΔY ${formatShort(convert(dy))} ${unit === 'um' ? 'µm' : 'DBU'}`;
}

function formatRectSize(a: [number, number], b: [number, number], viewport: Viewport, dbu: number, unit: 'um' | 'dbu') {
  const wa = screenToWorld(a, viewport, 1000, 1000);
  const wb = screenToWorld(b, viewport, 1000, 1000);
  return `${formatCoordinate(Math.abs(wb[0] - wa[0]), dbu, unit)} × ${formatCoordinate(Math.abs(wb[1] - wa[1]), dbu, unit)}`;
}
