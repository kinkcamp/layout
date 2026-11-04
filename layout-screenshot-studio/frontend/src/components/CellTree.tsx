import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Spin, Tag, Tree } from 'antd';
import type { DataNode, TreeProps } from 'antd/es/tree';
import { ApartmentOutlined, CloseOutlined, DownOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiFetch, queryString } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useAppStore } from '@/store/appStore';
import type { Cell, Paged } from '@/types/api';
import { MetadataSummary } from './MetadataSummary';

type CellNode = DataNode & {
  cell?: Cell;
  parentIndex?: number;
  page?: number;
  more?: boolean;
};

const PAGE_SIZE = 50;

export function CellTree({ onCloseMobile }: { onCloseMobile: () => void }) {
  const layoutId = useAppStore((state) => state.selectedFileId);
  const metadata = useAppStore((state) => state.metadata);
  const selectedCell = useAppStore((state) => state.selectedCell);
  const setSelectedCell = useAppStore((state) => state.setSelectedCell);
  const [treeData, setTreeData] = useState<CellNode[]>([]);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadChildren = useCallback(async (parentIndex: number | undefined, page: number, replace: boolean) => {
    if (!layoutId) return;
    const parentKey = parentIndex === undefined ? 'root' : `cell-${parentIndex}`;
    setLoadingKeys((current) => new Set(current).add(parentKey));
    setError(null);
    try {
      const result = await apiFetch<Paged<Cell>>(`/layouts/${layoutId}/cells${queryString({ parent_index: parentIndex, page, page_size: PAGE_SIZE })}`);
      const children: CellNode[] = result.items.map((cell) => makeCellNode(cell));
      if (result.total > page * PAGE_SIZE) children.push(makeMoreNode(parentIndex, page + 1));
      setTreeData((current) => {
        if (parentIndex === undefined) return replace ? children : [...withoutMore(current), ...children];
        return updateNodeChildren(current, parentKey, children, replace);
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cell 层次加载失败');
      throw reason;
    } finally {
      setLoadingKeys((current) => { const next = new Set(current); next.delete(parentKey); return next; });
    }
  }, [layoutId]);

  useEffect(() => {
    setTreeData([]);
    if (!layoutId || !metadata) return;
    setLoadingRoot(true);
    void loadChildren(undefined, 1, true).catch(() => undefined).finally(() => setLoadingRoot(false));
  }, [layoutId, metadata, reloadKey, loadChildren]);

  const loadData: TreeProps['loadData'] = async (node) => {
    const cellNode = node as CellNode;
    if (!cellNode.cell || cellNode.children?.length) return;
    await loadChildren(cellNode.cell.cell_index, 1, true);
  };

  const onSelect: TreeProps['onSelect'] = (_, info) => {
    const node = info.node as CellNode;
    if (node.more) {
      void loadChildren(node.parentIndex, node.page || 1, false).catch(() => undefined);
      return;
    }
    if (node.cell) {
      setSelectedCell(node.cell);
      if (window.matchMedia('(max-width: 760px)').matches) onCloseMobile();
    }
  };

  return (
    <div className="panel-content cell-tree-panel">
      <div className="panel-heading">
        <div><ApartmentOutlined /><span>Cell 层次</span></div>
        <div>
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => setReloadKey((value) => value + 1)} disabled={!metadata} aria-label="刷新 Cell 层次" />
          <Button className="mobile-close" type="text" size="small" icon={<CloseOutlined />} onClick={onCloseMobile} aria-label="关闭 Cell 面板" />
        </div>
      </div>
      <MetadataSummary />
      {error && <Alert className="panel-alert" type="error" showIcon message={error} action={<Button size="small" onClick={() => setReloadKey((value) => value + 1)}>重试</Button>} />}
      <div className="cell-tree-scroll">
        {loadingRoot ? <div className="panel-loading"><Spin size="small" /><span>加载 Top Cell…</span></div> : treeData.length ? (
          <Tree
            blockNode
            showLine
            switcherIcon={<DownOutlined />}
            treeData={treeData}
            loadData={loadData}
            onSelect={onSelect}
            selectedKeys={selectedCell ? [`cell-${selectedCell.cell_index}`] : []}
            defaultExpandedKeys={treeData.filter((node) => node.cell?.is_top).map((node) => String(node.key))}
          />
        ) : metadata && !error ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Cell 数据" /> : null}
        {loadingKeys.has('root') && !loadingRoot && <div className="tree-loading-more"><Spin size="small" /> 加载更多</div>}
      </div>
      <div className="panel-footer-hint">按需展开 · 每页 {PAGE_SIZE} 项 · 不展开阵列实例</div>
    </div>
  );
}

function makeCellNode(cell: Cell): CellNode {
  const hasChildren = cell.direct_instance_count > 0 || (cell.instance_count || 0) > 0 || Boolean(cell.array_summary);
  return {
    key: `cell-${cell.cell_index}`,
    cell,
    isLeaf: !hasChildren,
    title: (
      <div className="cell-node">
        <span className="cell-node-name">{cell.cell_name}</span>
        <span className="cell-node-tags">
          {cell.is_top && <Tag color="cyan">TOP</Tag>}
          {cell.direct_instance_count > 0 && <Tag>直接实例 {formatNumber(cell.direct_instance_count)}</Tag>}
          {cell.instance_count !== undefined && cell.instance_count !== cell.direct_instance_count && <Tag>总实例 {formatNumber(cell.instance_count)}</Tag>}
          {cell.array_summary && <Tag color="geekblue">阵列 {arraySummary(cell.array_summary)}</Tag>}
        </span>
      </div>
    ),
  };
}

function makeMoreNode(parentIndex: number | undefined, page: number): CellNode {
  return {
    key: `more-${parentIndex ?? 'root'}-${page}`,
    parentIndex,
    page,
    more: true,
    isLeaf: true,
    selectable: true,
    title: <span className="load-more-label">加载第 {page} 页…</span>,
  };
}

function withoutMore(nodes: CellNode[]) {
  return nodes.filter((node) => !node.more);
}

function updateNodeChildren(nodes: CellNode[], key: string, children: CellNode[], replace: boolean): CellNode[] {
  return nodes.map((node) => {
    if (String(node.key) === key) return { ...node, children: replace ? children : [...withoutMore((node.children || []) as CellNode[]), ...children] };
    if (node.children) return { ...node, children: updateNodeChildren(node.children as CellNode[], key, children, replace) };
    return node;
  });
}

function arraySummary(summary: NonNullable<Cell['array_summary']>) {
  if (typeof summary === 'string') return summary;
  const rows = summary.rows ?? '—';
  const columns = summary.columns ?? '—';
  return summary.count !== undefined ? `${rows}×${columns} / ${summary.count}` : `${rows}×${columns}`;
}
