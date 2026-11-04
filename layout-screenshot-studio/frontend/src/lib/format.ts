import type { BBox } from '@/types/api';

export function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 2 : 1)} ${units[index]}`;
}

export function formatNumber(value?: number) {
  return value === undefined ? '—' : new Intl.NumberFormat('zh-CN').format(value);
}

export function formatBBox(bbox?: BBox, precision = 0) {
  if (!bbox) return '—';
  return bbox.map((value) => value.toLocaleString('zh-CN', { maximumFractionDigits: precision })).join(', ');
}

export function fileName(file: { filename: string; original_name?: string }) {
  return file.original_name || file.filename;
}

export function statusText(status = '') {
  const labels: Record<string, string> = {
    CREATED: '待上传', UPLOADING: '上传中', UPLOADED: '已上传', QUEUED: '排队中',
    RUNNING: '处理中', READY: '就绪', SUCCESS: '已完成', FAILED: '失败', CANCELLED: '已取消',
  };
  return labels[status.toUpperCase()] || status;
}

export function statusColor(status = '') {
  const value = status.toUpperCase();
  if (value === 'READY' || value === 'SUCCESS') return 'success';
  if (value === 'FAILED') return 'error';
  if (value === 'CANCELLED') return 'default';
  if (value === 'RUNNING' || value === 'UPLOADING') return 'processing';
  return 'warning';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
