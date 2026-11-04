import { create } from 'zustand';
import type { BBox, Cell, Layer, LayerConfig, LayoutFile, LayoutMarker, LayoutMetadata, Project, ScreenshotTask, User } from '@/types/api';

interface AppState {
  user: User | null;
  workspaceEntered: boolean;
  pendingUploadFile: File | null;
  projects: Project[];
  files: LayoutFile[];
  selectedProjectId: string | null;
  selectedFileId: string | null;
  metadata: LayoutMetadata | null;
  layers: LayerConfig[];
  selectedCell: Cell | null;
  selection: BBox | null;
  markers: LayoutMarker[];
  screenshotOpen: boolean;
  tasksOpen: boolean;
  tasks: ScreenshotTask[];
  setUser: (user: User | null) => void;
  setWorkspaceEntered: (entered: boolean) => void;
  setPendingUploadFile: (file: File | null) => void;
  setProjects: (projects: Project[]) => void;
  setFiles: (files: LayoutFile[]) => void;
  selectProject: (id: string | null) => void;
  selectFile: (id: string | null) => void;
  setMetadata: (metadata: LayoutMetadata | null) => void;
  setLayers: (layers: Layer[]) => void;
  updateLayer: (id: string, patch: Partial<Pick<LayerConfig, 'visible' | 'color' | 'opacity'>>) => void;
  moveLayer: (id: string, direction: -1 | 1) => void;
  setAllLayers: (visible: boolean) => void;
  setSelectedCell: (cell: Cell | null) => void;
  setSelection: (selection: BBox | null) => void;
  addMarker: (marker: LayoutMarker) => void;
  removeMarker: (id: string) => void;
  clearMarkers: () => void;
  setScreenshotOpen: (open: boolean) => void;
  setTasksOpen: (open: boolean) => void;
  setTasks: (tasks: ScreenshotTask[]) => void;
  upsertTask: (task: ScreenshotTask) => void;
  resetWorkspace: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  workspaceEntered: false,
  pendingUploadFile: null,
  projects: [],
  files: [],
  selectedProjectId: null,
  selectedFileId: null,
  metadata: null,
  layers: [],
  selectedCell: null,
  selection: null,
  markers: [],
  screenshotOpen: false,
  tasksOpen: false,
  tasks: [],
  setUser: (user) => set({ user }),
  setWorkspaceEntered: (workspaceEntered) => set({ workspaceEntered }),
  setPendingUploadFile: (pendingUploadFile) => set({ pendingUploadFile }),
  setProjects: (projects) => set({ projects }),
  setFiles: (files) => set({ files }),
  selectProject: (selectedProjectId) => set({
    selectedProjectId, selectedFileId: null, files: [], metadata: null,
    layers: [], selectedCell: null, selection: null, markers: [], tasks: [],
  }),
  selectFile: (selectedFileId) => set({
    selectedFileId, metadata: null, layers: [], selectedCell: null, selection: null, markers: [], tasks: [],
  }),
  setMetadata: (metadata) => set({ metadata }),
  setLayers: (layers) => set({
    layers: layers.map((layer, index) => ({
      ...layer,
      color: normalizeColor(layer.default_color),
      visible: index === 0,
      opacity: 1,
    })),
  }),
  updateLayer: (id, patch) => set((state) => ({
    layers: state.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer),
  })),
  moveLayer: (id, direction) => set((state) => {
    const index = state.layers.findIndex((layer) => layer.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.layers.length) return state;
    const layers = [...state.layers];
    [layers[index], layers[target]] = [layers[target], layers[index]];
    return { layers };
  }),
  setAllLayers: (visible) => set((state) => ({ layers: state.layers.map((layer) => ({ ...layer, visible })) })),
  setSelectedCell: (selectedCell) => set({ selectedCell, selection: null }),
  setSelection: (selection) => set({ selection }),
  addMarker: (marker) => set((state) => ({ markers: [...state.markers, marker] })),
  removeMarker: (id) => set((state) => ({ markers: state.markers.filter((marker) => marker.id !== id) })),
  clearMarkers: () => set({ markers: [] }),
  setScreenshotOpen: (screenshotOpen) => set({ screenshotOpen }),
  setTasksOpen: (tasksOpen) => set({ tasksOpen }),
  setTasks: (tasks) => set({ tasks }),
  upsertTask: (task) => set((state) => {
    const exists = state.tasks.some((item) => item.id === task.id);
    return { tasks: exists ? state.tasks.map((item) => item.id === task.id ? { ...item, ...task } : item) : [task, ...state.tasks] };
  }),
  resetWorkspace: () => set({
    user: null, workspaceEntered: false, pendingUploadFile: null, projects: [], files: [], selectedProjectId: null, selectedFileId: null,
    metadata: null, layers: [], selectedCell: null, selection: null, markers: [], tasks: [],
    screenshotOpen: false, tasksOpen: false,
  }),
}));

function normalizeColor(color?: string) {
  if (!color) return '#69a7a0';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map((char) => char + char).join('')}`;
  return '#69a7a0';
}
