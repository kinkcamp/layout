import { Descriptions } from 'antd';
import { formatBBox, formatNumber } from '@/lib/format';
import { useAppStore } from '@/store/appStore';

export function MetadataSummary() {
  const metadata = useAppStore((state) => state.metadata);
  const file = useAppStore((state) => state.files.find((item) => item.id === state.selectedFileId));
  if (!metadata) return <div className="metadata-placeholder">选择就绪文件后显示 DBU、Cell 数和边界信息</div>;
  return (
    <div className="metadata-summary">
      <div className="metadata-file">{file?.original_name || file?.filename || metadata.filename || '当前版图'}</div>
      <Descriptions size="small" column={2} colon={false}>
        <Descriptions.Item label="DBU">{metadata.dbu_um} µm</Descriptions.Item>
        <Descriptions.Item label="Cell 数">{formatNumber(metadata.cell_count)}</Descriptions.Item>
        <Descriptions.Item label="Top Cell">{metadata.top_cells.length}</Descriptions.Item>
        <Descriptions.Item label="解析耗时">{metadata.parse_seconds === undefined ? '—' : `${metadata.parse_seconds}s`}</Descriptions.Item>
      </Descriptions>
      <div className="metadata-bbox"><span>BBox / DBU</span><code>[{formatBBox(metadata.bbox || metadata.top_cells[0]?.bbox)}]</code></div>
    </div>
  );
}
