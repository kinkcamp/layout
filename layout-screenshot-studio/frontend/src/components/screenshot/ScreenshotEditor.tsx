import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, ColorPicker, Drawer, Input, InputNumber, Select, Space, Switch, Tag } from 'antd';
import { CameraOutlined, BorderOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { formatBBox } from '@/lib/format';
import { useAppStore } from '@/store/appStore';
import type { BBox, ScreenshotRequest, ScreenshotTask } from '@/types/api';

const RATIOS: Record<string, number> = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '3:2': 3 / 2, '9:16': 9 / 16 };
const RESOLUTIONS: Record<string, [number, number, string]> = {
  '1920x1080': [1920, 1080, '16:9'],
  '2560x1440': [2560, 1440, '16:9'],
  '3840x2160': [3840, 2160, '16:9'],
  '1280x720': [1280, 720, '16:9'],
  '1600x1200': [1600, 1200, '4:3'],
  '1080x1080': [1080, 1080, '1:1'],
  '1200x800': [1200, 800, '3:2'],
  '1080x1920': [1080, 1920, '9:16'],
};

export function ScreenshotEditor() {
  const { message } = App.useApp();
  const open = useAppStore((state) => state.screenshotOpen);
  const setOpen = useAppStore((state) => state.setScreenshotOpen);
  const setTasksOpen = useAppStore((state) => state.setTasksOpen);
  const layoutId = useAppStore((state) => state.selectedFileId);
  const cell = useAppStore((state) => state.selectedCell);
  const selection = useAppStore((state) => state.selection);
  const layers = useAppStore((state) => state.layers);
  const markers = useAppStore((state) => state.markers);
  const upsertTask = useAppStore((state) => state.upsertTask);
  const [name, setName] = useState('');
  const [bbox, setBBox] = useState<BBox>([0, 0, 1000, 1000]);
  const [ratio, setRatio] = useState('16:9');
  const [resolution, setResolution] = useState('1920x1080');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [background, setBackground] = useState('#0b1113');
  const [margin, setMargin] = useState(24);
  const [annotations, setAnnotations] = useState({ title: true, scale: true, coordinates: true, legend: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !cell) return;
    setName(`${cell.cell_name}_截图`);
    setBBox((selection || cell.bbox).map(Math.round) as BBox);
    setRatio('16:9');
    setResolution('1920x1080');
    setWidth(1920);
    setHeight(1080);
    setError(null);
  }, [open, cell?.cell_index]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleCount = layers.filter((layer) => layer.visible).length;
  const validBBox = bbox[2] > bbox[0] && bbox[3] > bbox[1] && bbox.every(Number.isFinite);
  const validPixels = width > 0 && height > 0 && width * height <= 100_000_000;
  const dimensions = useMemo(() => `${width.toLocaleString()} × ${height.toLocaleString()} px · ${(width * height / 1_000_000).toFixed(1)} MP`, [width, height]);

  const changeRatio = (value: string) => {
    setRatio(value);
    if (value !== 'custom') {
      const nextHeight = Math.max(1, Math.round(width / RATIOS[value]));
      setHeight(nextHeight);
      setResolution('custom');
    }
  };

  const changeResolution = (value: string) => {
    setResolution(value);
    if (value === 'custom') return;
    const [nextWidth, nextHeight, nextRatio] = RESOLUTIONS[value];
    setWidth(nextWidth);
    setHeight(nextHeight);
    setRatio(nextRatio);
  };

  const updateDimension = (kind: 'width' | 'height', value: number | null) => {
    if (kind === 'width') setWidth(value || 1); else setHeight(value || 1);
    setRatio('custom');
    setResolution('custom');
  };

  const submit = async () => {
    if (!layoutId || !cell || !validBBox || !validPixels || !name.trim()) {
      setError(!name.trim() ? '请输入任务名称' : !validBBox ? '截图范围无效：Right 必须大于 Left，Top 必须大于 Bottom' : '输出尺寸无效或超过 100 MP 限制');
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: ScreenshotRequest = {
      name: name.trim(),
      layout_id: layoutId,
      cell_index: cell.cell_index,
      bbox: bbox.map(Math.round) as BBox,
      width_px: Math.round(width),
      height_px: Math.round(height),
      aspect_ratio: ratio,
      layers: layers.map((layer) => ({
        layer_index: layer.layer_index,
        layer_number: layer.layer_number,
        datatype: layer.datatype,
        color: layer.color,
        opacity: layer.opacity,
        visible: layer.visible,
      })),
      background,
      margin_px: margin,
      annotations: {
        title: annotations.title ? name.trim() : null,
        scale: annotations.scale,
        coordinates: annotations.coordinates,
        legend: annotations.legend,
        markers: markers.filter((marker) => marker.cell_index === cell.cell_index).map((marker) => ({ x: marker.x, y: marker.y, label: marker.label })),
      },
    };
    try {
      const task = await apiFetch<ScreenshotTask>('/screenshots', { method: 'POST', body: payload });
      upsertTask({ ...payload, ...task });
      setOpen(false);
      setTasksOpen(true);
      message.success('截图任务已提交');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '截图任务提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      title="创建截图任务"
      width={560}
      open={open}
      onClose={() => setOpen(false)}
      className="screenshot-editor"
      footer={<div className="drawer-footer"><span>图层配置已锁定为提交时的 Viewer 状态</span><Space><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" icon={<CameraOutlined />} loading={submitting} disabled={!validBBox || !validPixels || !name.trim()} onClick={() => void submit()}>提交任务</Button></Space></div>}
    >
      <div className="editor-section">
        <label className="field-label">任务名称</label>
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="输入截图任务名称" showCount />
      </div>
      <div className="editor-section">
        <div className="section-heading"><label className="field-label">截图范围 / DBU</label><Button size="small" icon={<BorderOutlined />} disabled={!selection} onClick={() => selection && setBBox(selection.map(Math.round) as BBox)}>采用框选</Button></div>
        <div className="bbox-input-grid">
          {(['Left', 'Bottom', 'Right', 'Top'] as const).map((label, index) => (
            <label key={label}><span>{label}</span><InputNumber value={bbox[index]} onChange={(value) => setBBox((current) => { const next = [...current] as BBox; next[index] = value || 0; return next; })} step={100} controls={false} /></label>
          ))}
        </div>
        <div className="field-help">当前 Cell：{cell?.cell_name} · 范围 [{formatBBox(bbox)}]</div>
        {!validBBox && <div className="field-error">Right 必须大于 Left，Top 必须大于 Bottom</div>}
      </div>
      <div className="editor-section two-column-fields">
        <div><label className="field-label">画布比例</label><Select value={ratio} onChange={changeRatio} options={[...Object.keys(RATIOS).map((value) => ({ value, label: value })), { value: 'custom', label: '自定义' }]} /></div>
        <div><label className="field-label">分辨率预设</label><Select value={resolution} onChange={changeResolution} options={[...Object.keys(RESOLUTIONS).map((value) => ({ value, label: value.replace('x', ' × ') })), { value: 'custom', label: '自定义尺寸' }]} /></div>
      </div>
      <div className="editor-section two-column-fields">
        <div><label className="field-label">宽度 / px</label><InputNumber min={1} max={32768} precision={0} value={width} onChange={(value) => updateDimension('width', value)} /></div>
        <div><label className="field-label">高度 / px</label><InputNumber min={1} max={32768} precision={0} value={height} onChange={(value) => updateDimension('height', value)} /></div>
      </div>
      <div className={`dimension-summary ${validPixels ? '' : 'invalid'}`}><span>{dimensions}</span><span>{validPixels ? '服务端 PNG 离屏渲染' : '超过 100 MP 上限'}</span></div>
      <div className="editor-section two-column-fields">
        <div><label className="field-label">背景色</label><div className="color-field"><ColorPicker value={background} onChange={(color) => setBackground(color.toHexString())} disabledAlpha /><code>{background.toUpperCase()}</code></div></div>
        <div><label className="field-label">边距 / px</label><InputNumber min={0} max={512} precision={0} value={margin} onChange={(value) => setMargin(value || 0)} /></div>
      </div>
      <div className="editor-section">
        <label className="field-label">标注</label>
        <div className="annotation-grid">
          {([['title', '标题'], ['scale', '比例尺'], ['coordinates', '坐标'], ['legend', '图例']] as const).map(([key, label]) => (
            <label key={key}><Switch size="small" checked={annotations[key]} onChange={(checked) => setAnnotations((current) => ({ ...current, [key]: checked }))} /><span>{label}</span></label>
          ))}
        </div>
      </div>
      <div className="editor-section snapshot-summary">
        <div><span>Viewer 图层快照</span><Tag color="cyan">{visibleCount} 可见 / {layers.length} 总计</Tag></div>
        <p>按当前列表顺序提交所有 Layer / Datatype 的颜色、透明度与显隐状态；当前 Cell 的 {markers.filter((marker) => marker.cell_index === cell?.cell_index).length} 个标记将随 PNG 导出。</p>
      </div>
      {error && <Alert type="error" showIcon message="无法提交截图任务" description={error} />}
    </Drawer>
  );
}
