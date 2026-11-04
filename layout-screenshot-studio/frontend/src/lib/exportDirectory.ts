import { downloadBlob } from './format';

interface WritableFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

export interface ExportDirectoryHandle {
  name: string;
  getFileHandle(name: string, options: { create: true }): Promise<{
    createWritable(): Promise<WritableFile>;
  }>;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<ExportDirectoryHandle>;
};

let exportDirectory: ExportDirectoryHandle | null = null;

export function supportsDirectoryPicker() {
  return typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function chooseExportDirectory() {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('当前浏览器不支持目录授权，截图将保存到默认下载目录');
  exportDirectory = await picker.call(window, { mode: 'readwrite' });
  return exportDirectory.name;
}

export function getExportDirectoryName() {
  return exportDirectory?.name || null;
}

export async function saveScreenshotBlob(blob: Blob, filename: string) {
  if (!exportDirectory) {
    downloadBlob(blob, filename);
    return 'download' as const;
  }
  const file = await exportDirectory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
  return 'directory' as const;
}
