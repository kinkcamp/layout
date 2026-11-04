import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Drawer, Empty, Image, Modal, Popconfirm, Skeleton, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloseOutlined, DownloadOutlined, EyeOutlined, FolderOpenOutlined, ReloadOutlined, RetweetOutlined } from '@ant-design/icons';
import { apiBlob, apiFetch } from '@/lib/api';
import { formatBytes, statusColor, statusText } from '@/lib/format';
import { chooseExportDirectory, getExportDirectoryName, saveScreenshotBlob, supportsDirectoryPicker } from '@/lib/exportDirectory';
import { useAppStore } from '@/store/appStore';
import type { ScreenshotTask } from '@/types/api';

export function TaskDrawer() {
  const { message } = App.useApp();
  const open = useAppStore((state) => state.tasksOpen);
  const setOpen = useAppStore((state) => state.setTasksOpen);
  const layoutId = useAppStore((state) => state.selectedFileId);
  const tasks = useAppStore((state) => state.tasks);
  const setTasks = useAppStore((state) => state.setTasks);
  const upsertTask = useAppStore((state) => state.upsertTask);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScreenshotTask | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [directoryName, setDirectoryName] = useState(getExportDirectoryName());

  const refresh = useCallback(async () => {
    if (!layoutId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ items: ScreenshotTask[] }>(`/screenshots?layout_id=${encodeURIComponent(layoutId)}`);
      setTasks(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务列表加载失败');
    } finally { setLoading(false); }
  }, [layoutId, setTasks]);

  useEffect(() => { if (open) void refresh(); }, [open, refresh]);

  const download = async (task: ScreenshotTask) => {
    setDownloading(task.id);
    try {
      const blob = await apiBlob(`/screenshots/${task.id}/download`);
      const destination = await saveScreenshotBlob(blob, `${safeFilename(task.name)}.png`);
      message.success(destination === 'directory' ? `已保存到 ${getExportDirectoryName()}` : '已开始下载 PNG');
    } catch (reason) { message.error(reason instanceof Error ? reason.message : 'PNG 下载失败'); }
    finally { setDownloading(null); }
  };

  const selectDirectory = async () => {
    try {
      setDirectoryName(await chooseExportDirectory());
      message.success('截图保存目录已更新');
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) message.error(reason instanceof Error ? reason.message : '目录选择失败');
    }
  };

  const action = async (task: ScreenshotTask, kind: 'retry' | 'cancel') => {
    setActing(`${kind}-${task.id}`);
    try {
      const path = kind === 'retry' ? `/screenshots/${task.id}/retry` : `/tasks/${task.id}/cancel`;
      const updated = await apiFetch<ScreenshotTask>(path, { method: 'POST' });
      upsertTask({ ...task, ...updated });
      message.success(kind === 'retry' ? '已重新提交任务' : '任务已取消');
      await refresh();
    } catch (reason) { message.error(reason instanceof Error ? reason.message : '任务操作失败'); }
    finally { setActing(null); }
  };

  const columns: ColumnsType<ScreenshotTask> = [
    { title: '任务', key: 'name', width: 190, render: (_, task) => <div className="task-name"><strong>{task.name}</strong><span>{task.cell_index !== undefined ? `Cell #${task.cell_index}` : ''} · {formatTime(task.created_at)}</span></div> },
    { title: '状态', key: 'status', width: 92, render: (_, task) => <Tag color={statusColor(task.status)}>{statusText(task.status)}</Tag> },
    { title: '尺寸', key: 'size', width: 112, render: (_, task) => <span className="mono">{task.width_px}×{task.height_px}</span> },
    { title: '耗时', key: 'duration', width: 86, render: (_, task) => formatDuration(task) },
    { title: '输出', key: 'file', width: 90, render: (_, task) => task.file_size_bytes ? formatBytes(task.file_size_bytes) : '—' },
    {
      title: '操作', key: 'actions', width: 205, fixed: 'right', render: (_, task) => {
        const success = task.status.toUpperCase() === 'SUCCESS';
        const failed = ['FAILED', 'CANCELLED'].includes(task.status.toUpperCase());
        const active = ['QUEUED', 'RUNNING', 'CREATED'].includes(task.status.toUpperCase());
        return <Space size={2}>
          {success && <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setPreview(task)}>预览</Button>}
          {success && <Button type="text" size="small" icon={<DownloadOutlined />} loading={downloading === task.id} onClick={() => void download(task)}>下载</Button>}
          {failed && <Button type="text" size="small" icon={<RetweetOutlined />} loading={acting === `retry-${task.id}`} onClick={() => void action(task, 'retry')}>重试</Button>}
          {active && <Popconfirm title="取消此截图任务？" okText="取消任务" cancelText="保留" onConfirm={() => void action(task, 'cancel')}><Button type="text" size="small" danger icon={<CloseOutlined />} loading={acting === `cancel-${task.id}`}>取消</Button></Popconfirm>}
        </Space>;
      },
    },
  ];

  return (
    <>
      <Drawer title="截图任务" width={900} open={open} onClose={() => setOpen(false)} extra={<Space><Button icon={<FolderOpenOutlined />} disabled={!supportsDirectoryPicker()} onClick={() => void selectDirectory()}>{directoryName || '默认下载目录'}</Button><Button icon={<ReloadOutlined />} onClick={() => void refresh()}>刷新</Button></Space>}>
        {error && <Alert className="task-error" type="error" showIcon message={error} action={<Button size="small" onClick={() => void refresh()}>重试</Button>} />}
        <Table<ScreenshotTask>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={tasks}
          loading={loading}
          scroll={{ x: 790 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前版图暂无截图任务" /> }}
          expandable={{
            expandedRowRender: (task) => task.error ? <Alert type="error" showIcon message={task.error_code || '任务失败'} description={task.error} /> : <div className="task-detail"><span>BBox / DBU</span><code>[{task.bbox?.join(', ')}]</code><span>背景 {task.background} · 边距 {task.margin_px}px</span></div>,
            rowExpandable: (task) => Boolean(task.error || task.bbox),
          }}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
        />
        <div className="task-polling-note">运行中任务每 2.5 秒自动刷新 · PNG 预览与下载均携带 Bearer 鉴权</div>
      </Drawer>
      <Modal title={preview?.name} open={Boolean(preview)} onCancel={() => setPreview(null)} width={860} footer={preview ? <Button type="primary" icon={<DownloadOutlined />} loading={downloading === preview.id} onClick={() => void download(preview)}>下载 PNG</Button> : null}>
        {preview && <AuthenticatedPreview task={preview} />}
      </Modal>
    </>
  );
}

function AuthenticatedPreview({ task }: { task: ScreenshotTask }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    apiBlob(`/screenshots/${task.id}/download`, controller.signal).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((reason) => {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '预览加载失败');
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [task.id]);
  if (error) return <Alert type="error" showIcon message="PNG 预览失败" description={error} />;
  if (!url) return <Skeleton.Image active className="preview-skeleton" />;
  return <div className="png-preview"><Image src={url} alt={`${task.name} PNG 预览`} /><div className="preview-meta">{task.width_px} × {task.height_px} px · PNG · 鉴权 Blob 预览</div></div>;
}

function formatDuration(task: ScreenshotTask) {
  let seconds = task.duration_seconds ?? task.elapsed_seconds;
  if (seconds === undefined && task.started_at && task.finished_at) seconds = (new Date(task.finished_at).getTime() - new Date(task.started_at).getTime()) / 1000;
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatTime(value?: string) {
  if (!value) return '刚刚';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function safeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'layout-screenshot';
}
