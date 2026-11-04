import { useMemo, useState } from 'react';
import { Button, Collapse, ColorPicker, Empty, Input, Slider, Tooltip } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CloseOutlined, EyeInvisibleOutlined, EyeOutlined, SearchOutlined } from '@ant-design/icons';
import { useAppStore } from '@/store/appStore';
import type { LayerConfig } from '@/types/api';

export function LayerManager({ onCloseMobile }: { onCloseMobile: () => void }) {
  const layers = useAppStore((state) => state.layers);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const moveLayer = useAppStore((state) => state.moveLayer);
  const setAllLayers = useAppStore((state) => state.setAllLayers);
  const [search, setSearch] = useState('');

  const visibleCount = layers.filter((layer) => layer.visible).length;
  const showOnlyFirstLayer = () => {
    setAllLayers(false);
    if (layers[0]) updateLayer(layers[0].id, { visible: true });
  };

  const groups = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const filtered = layers.filter((layer) => `${layer.layer_number}/${layer.datatype} ${layer.name || ''} ${layer.layer_index}`.toLowerCase().includes(keyword));
    const map = new Map<string, LayerConfig[]>();
    filtered.forEach((layer) => {
      const group = layer.name?.trim() || '未命名图层';
      map.set(group, [...(map.get(group) || []), layer]);
    });
    return [...map.entries()];
  }, [layers, search]);

  return (
    <div className="panel-content layer-manager">
      <div className="panel-heading">
        <div><span>Layer / Datatype</span><span className="count-badge">显示 {visibleCount}/{layers.length}</span></div>
        <Button className="mobile-close" type="text" size="small" icon={<CloseOutlined />} onClick={onCloseMobile} aria-label="关闭图层面板" />
      </div>
      <div className="layer-controls">
        <Input allowClear prefix={<SearchOutlined />} placeholder="搜索层号、Datatype 或名称" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="layer-bulk-actions">
          <Button size="small" icon={<EyeOutlined />} onClick={showOnlyFirstLayer} disabled={!layers.length}>仅首层</Button>
          <Button size="small" onClick={() => setAllLayers(true)} disabled={!layers.length}>全部显示</Button>
          <Button size="small" icon={<EyeInvisibleOutlined />} onClick={() => setAllLayers(false)} disabled={!layers.length}>全部隐藏</Button>
        </div>
      </div>
      <div className="layer-list-scroll">
        {groups.length ? (
          <Collapse
            ghost
            size="small"
            defaultActiveKey={groups.map(([name]) => name)}
            items={groups.map(([name, items]) => ({
              key: name,
              label: <span className="layer-group-label">{name}<span>{items.filter((item) => item.visible).length}/{items.length}</span></span>,
              children: <div className="layer-group-items">{items.map((layer) => {
                const index = layers.findIndex((item) => item.id === layer.id);
                return (
                  <div className={`layer-row ${layer.visible ? '' : 'layer-hidden'}`} key={layer.id}>
                    <div className="layer-row-main">
                      <Tooltip title={layer.visible ? '隐藏图层' : '显示图层'}>
                        <Button type="text" size="small" icon={layer.visible ? <EyeOutlined /> : <EyeInvisibleOutlined />} onClick={() => updateLayer(layer.id, { visible: !layer.visible })} aria-label={`${layer.visible ? '隐藏' : '显示'} ${layer.layer_number}/${layer.datatype}`} />
                      </Tooltip>
                      <ColorPicker size="small" value={layer.color} onChange={(color) => updateLayer(layer.id, { color: color.toHexString() })} disabledAlpha />
                      <div className="layer-name">
                        <strong>{layer.layer_number}<span>/</span>{layer.datatype}</strong>
                        <span>{layer.name || `Index ${layer.layer_index}`}</span>
                      </div>
                      <div className="layer-order-actions">
                        <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={index <= 0} onClick={() => moveLayer(layer.id, -1)} aria-label="上移图层" />
                        <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={index === layers.length - 1} onClick={() => moveLayer(layer.id, 1)} aria-label="下移图层" />
                      </div>
                    </div>
                    <div className="layer-opacity">
                      <span>透明度</span>
                      <Slider min={0.05} max={1} step={0.05} value={layer.opacity} onChange={(opacity) => updateLayer(layer.id, { opacity })} tooltip={{ formatter: (value) => `${Math.round((value || 0) * 100)}%` }} />
                      <code>{Math.round(layer.opacity * 100)}%</code>
                    </div>
                  </div>
                );
              })}</div>,
            }))}
          />
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={layers.length ? '没有匹配的图层' : '当前版图暂无图层'} />}
      </div>
      <div className="panel-footer-hint">列表自下而上绘制 · 修改即时作用于 Viewer 与截图</div>
    </div>
  );
}
