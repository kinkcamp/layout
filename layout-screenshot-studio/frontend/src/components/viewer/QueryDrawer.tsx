import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Empty, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { apiFetch } from '@/lib/api';
import { formatBBox, formatNumber } from '@/lib/format';
import { useAppStore } from '@/store/appStore';
import type { Paged, QueryGeometry } from '@/types/api';

export function QueryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const layoutId = useAppStore((state) => state.selectedFileId);
  const cell = useAppStore((state) => state.selectedCell);
  const selection = useAppStore((state) => state.selection);
  const layers = useAppStore((state) => state.layers);
  const visibleLayers = useMemo(() => layers.filter((layer) => layer.visible), [layers]);
  const [items, setItems] = useState<QueryGeometry[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(async (signal?: AbortSignal) => {
    if (!layoutId || !cell || !selection) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<Paged<QueryGeometry>>(`/layouts/${layoutId}/query`, {
        method: 'POST',
        signal,
        body: {
          cell_index: cell.cell_index,
          bbox: selection.map(Math.round),
          layers: visibleLayers.map((layer) => layer.layer_index),
          recursive: true,
          page,
          page_size: pageSize,
        },
      });
      setItems(result.items);
      setTotal(result.total);
      setTruncated(Boolean(result.truncated));
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '区域查询失败');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [layoutId, cell, selection, visibleLayers, page, pageSize]);

  useEffect(() => { setPage(1); }, [selection]);
  useEffect(() => {
    if (!open || !selection) return;
    const controller = new AbortController();
    void query(controller.signal);
    return () => controller.abort();
  }, [open, query, selection]);

  const columns: ColumnsType<QueryGeometry> = [
    { title: '#', key: 'index', width: 62, render: (_, __, index) => (page - 1) * pageSize + index + 1 },
    { title: 'Layer / DT', key: 'layer', width: 110, render: (_, record) => <span className="mono">{record.layer_number ?? '—'} / {record.datatype ?? '—'}</span> },
    { title: '类型', dataIndex: 'kind', width: 90, render: (value) => <Tag>{value || 'SHAPE'}</Tag> },
    { title: 'Cell', dataIndex: 'cell_index', width: 80, render: (value) => value ?? cell?.cell_index },
    { title: 'BBox / DBU', dataIndex: 'bbox', render: (value) => <code className="bbox-code">[{formatBBox(value)}]</code> },
    { title: '几何', key: 'geometry', width: 90, render: (_, record) => record.polygons ? `${record.polygons.length} polygon` : record.text || '—' },
  ];

  return (
    <Drawer title="区域几何查询" width={760} open={open} onClose={onClose} destroyOnHidden={false}>
      {selection ? (
        <div className="query-content">
          <div className="query-summary">
            <div><span>Cell</span><strong>{cell?.cell_name}</strong></div>
            <div><span>BBox / DBU</span><code>[{formatBBox(selection)}]</code></div>
            <div><span>图层</span><strong>{visibleLayers.length} 个可见图层 · 递归实例</strong></div>
          </div>
          {truncated && <Alert type="warning" showIcon message="查询结果已截断" description="服务端仅返回部分几何。请缩小区域或结合分页核对总数。" />}
          {error && <Alert type="error" showIcon message="查询失败" description={error} action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void query()}>重试</Button>} />}
          <Table<QueryGeometry>
            size="small"
            rowKey={(record, index) => String(record.id ?? record.shape_index ?? `${page}-${index}`)}
            columns={columns}
            dataSource={items}
            loading={loading}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error ? '暂无可显示结果' : '该区域内没有匹配几何'} /> }}
            scroll={{ x: 720 }}
            expandable={{ expandedRowRender: (record) => <pre className="geometry-json">{JSON.stringify(record, null, 2)}</pre> }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 25, 50, 100],
              showTotal: (value) => `共 ${formatNumber(value)} 个几何`,
              onChange: (nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); },
            }}
          />
          <div className="query-footer"><Space><Tag color="cyan">recursive: true</Tag><Tag>page_size: {pageSize}</Tag></Space><span>坐标均为整数 DBU；实例按层次递归展开。</span></div>
        </div>
      ) : <Empty description="请先在 Viewer 中用左键框选查询区域" />}
    </Drawer>
  );
}
