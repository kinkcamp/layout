import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Empty, Skeleton } from 'antd';
import { apiFetch } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import type { Cell, LayoutFile, LayoutMetadata, Layer, Project, ScreenshotTask, User } from '@/types/api';
import { TopBar } from './TopBar';
import { CellTree } from './CellTree';
import { LayerManager } from './LayerManager';
import { LayoutViewer } from './viewer/LayoutViewer';
import { UploadModal } from './upload/UploadModal';
import { ScreenshotEditor } from './screenshot/ScreenshotEditor';
import { TaskDrawer } from './screenshot/TaskDrawer';

export function Workspace() {
  const { message } = App.useApp();
  const {
    selectedProjectId, selectedFileId, files, metadata, selectedCell, tasks, tasksOpen, pendingUploadFile,
  } = useAppStore();
  const setUser = useAppStore((state) => state.setUser);
  const setProjects = useAppStore((state) => state.setProjects);
  const selectProject = useAppStore((state) => state.selectProject);
  const setFiles = useAppStore((state) => state.setFiles);
  const selectFile = useAppStore((state) => state.selectFile);
  const setMetadata = useAppStore((state) => state.setMetadata);
  const setLayers = useAppStore((state) => state.setLayers);
  const setSelectedCell = useAppStore((state) => state.setSelectedCell);
  const setTasks = useAppStore((state) => state.setTasks);
  const setPendingUploadFile = useAppStore((state) => state.setPendingUploadFile);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [cellsOpen, setCellsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const result = await apiFetch<Project[] | { items: Project[] }>('/projects', { signal });
      const items = Array.isArray(result) ? result : result.items;
      setProjects(items);
      const current = useAppStore.getState().selectedProjectId;
      if (!current && items.length) selectProject(items[0].id);
    } catch (error) {
      if (!isAbort(error)) setProjectsError(errorMessage(error));
    } finally {
      if (!signal?.aborted) setProjectsLoading(false);
    }
  }, [selectProject, setProjects]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProjects(controller.signal);
    void apiFetch<User>('/auth/me', { signal: controller.signal }).then(setUser).catch(() => undefined);
    return () => controller.abort();
  }, [loadProjects, setUser]);

  const loadFiles = useCallback(async (signal?: AbortSignal) => {
    if (!selectedProjectId) return;
    try {
      const result = await apiFetch<LayoutFile[] | { items: LayoutFile[] }>(`/files?project_id=${encodeURIComponent(selectedProjectId)}`, { signal });
      const items = Array.isArray(result) ? result : result.items;
      setFiles(items);
      const current = useAppStore.getState().selectedFileId;
      if (!items.some((item) => item.id === current)) {
        const preferred = items.find((item) => item.status.toUpperCase() === 'READY') || items[0];
        selectFile(preferred?.id || null);
      }
    } catch (error) {
      if (!isAbort(error)) message.error(errorMessage(error));
    }
  }, [message, selectedProjectId, selectFile, setFiles]);

  useEffect(() => {
    if (pendingUploadFile) setUploadOpen(true);
  }, [pendingUploadFile]);

  useEffect(() => {
    const controller = new AbortController();
    void loadFiles(controller.signal);
    return () => controller.abort();
  }, [loadFiles]);

  useEffect(() => {
    const file = files.find((item) => item.id === selectedFileId);
    if (!file || file.status.toUpperCase() !== 'READY') {
      setMetadata(null);
      setLayers([]);
      setSelectedCell(null);
      return;
    }
    const controller = new AbortController();
    setLayoutLoading(true);
    setLayoutError(null);
    Promise.all([
      apiFetch<LayoutMetadata>(`/layouts/${file.id}/metadata`, { signal: controller.signal }),
      apiFetch<{ items: Layer[] }>(`/layouts/${file.id}/layers`, { signal: controller.signal }),
    ]).then(([layout, layerResult]) => {
      setMetadata(layout);
      setLayers(layerResult.items);
      const top = layout.top_cells.find((cell) => cell.cell_index === layout.default_cell_index) || layout.top_cells[0];
      if (top) {
        const cell: Cell = {
          cell_index: top.cell_index,
          cell_name: top.cell_name || top.name || `Cell ${top.cell_index}`,
          bbox: top.bbox,
          is_top: true,
          direct_instance_count: 0,
        };
        setSelectedCell(cell);
      }
    }).catch((error) => {
      if (!isAbort(error)) setLayoutError(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLayoutLoading(false);
    });
    return () => controller.abort();
  }, [selectedFileId, files, setLayers, setMetadata, setSelectedCell]);

  const hasActiveTasks = tasks.some((task) => ['QUEUED', 'RUNNING', 'CREATED'].includes(task.status.toUpperCase()));
  useEffect(() => {
    if (!selectedFileId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await apiFetch<{ items: ScreenshotTask[] }>(`/screenshots?layout_id=${encodeURIComponent(selectedFileId)}`, { signal: controller.signal });
        setTasks(result.items);
        if (hasActiveTasks || tasksOpen) timer = setTimeout(() => void poll(), 2500);
      } catch (error) {
        if (!isAbort(error) && tasksOpen) message.error(errorMessage(error));
      }
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [selectedFileId, hasActiveTasks, tasksOpen, setTasks, message]);

  const file = files.find((item) => item.id === selectedFileId);
  const onUploaded = async (id: string) => {
    await loadFiles();
    selectFile(id);
    setPendingUploadFile(null);
    setUploadOpen(false);
    message.success('版图解析完成，已载入工作台');
  };

  return (
    <div className="workbench">
      <TopBar onUpload={() => setUploadOpen(true)} onToggleCells={() => setCellsOpen((value) => !value)} onToggleLayers={() => setLayersOpen((value) => !value)} />
      {projectsError && <Alert type="error" showIcon message="项目加载失败" description={projectsError} action={<a onClick={() => void loadProjects()}>重试</a>} />}
      <main className={`workspace-grid ${cellsOpen ? 'cells-open' : ''} ${layersOpen ? 'layers-open' : ''}`}>
        <aside className="side-panel cell-panel">
          {projectsLoading ? <Skeleton active paragraph={{ rows: 7 }} /> : (
            <CellTree onCloseMobile={() => setCellsOpen(false)} />
          )}
        </aside>
        <section className="viewer-panel">
          {layoutLoading && <div className="viewer-loading"><Skeleton active paragraph={{ rows: 8 }} /></div>}
          {!layoutLoading && layoutError && <Alert className="viewer-alert" type="error" showIcon message="版图加载失败" description={layoutError} />}
          {!layoutLoading && !layoutError && file && file.status.toUpperCase() !== 'READY' && (
            <div className="viewer-empty"><Empty description={file.status.toUpperCase() === 'FAILED' ? `解析失败：${file.error_message || file.error || '未知错误'}` : `文件当前状态：${file.status}，解析完成后可浏览`} /></div>
          )}
          {!layoutLoading && !layoutError && !file && !projectsLoading && (
            <div className="viewer-empty"><Empty description="请选择项目并上传 GDSII 或 OASIS 文件" /></div>
          )}
          {!layoutLoading && !layoutError && metadata && selectedCell && <LayoutViewer />}
        </section>
        <aside className="side-panel layer-panel">
          <LayerManager onCloseMobile={() => setLayersOpen(false)} />
        </aside>
      </main>
      <UploadModal open={uploadOpen} initialFile={pendingUploadFile} onClose={() => { setUploadOpen(false); setPendingUploadFile(null); }} onReady={(id) => void onUploaded(id)} onFilesChanged={() => void loadFiles()} />
      <ScreenshotEditor />
      <TaskDrawer />
    </div>
  );
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请稍后重试';
}
