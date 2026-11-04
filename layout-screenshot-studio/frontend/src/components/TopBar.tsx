import { Badge, Button, Dropdown, Select, Space, Tag, Tooltip } from 'antd';
import { CameraOutlined, CloudUploadOutlined, DownOutlined, FileOutlined, FolderOutlined, HomeOutlined, LogoutOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { authToken } from '@/lib/api';
import { fileName, formatBytes, statusColor, statusText } from '@/lib/format';
import { useAppStore } from '@/store/appStore';
import { BrandMark } from './LoginPage';

interface TopBarProps {
  onUpload: () => void;
  onToggleCells: () => void;
  onToggleLayers: () => void;
}

export function TopBar({ onUpload, onToggleCells, onToggleLayers }: TopBarProps) {
  const { user, projects, files, selectedProjectId, selectedFileId, metadata, selectedCell, tasks } = useAppStore();
  const selectProject = useAppStore((state) => state.selectProject);
  const selectFile = useAppStore((state) => state.selectFile);
  const resetWorkspace = useAppStore((state) => state.resetWorkspace);
  const setWorkspaceEntered = useAppStore((state) => state.setWorkspaceEntered);
  const setScreenshotOpen = useAppStore((state) => state.setScreenshotOpen);
  const setTasksOpen = useAppStore((state) => state.setTasksOpen);
  const file = files.find((item) => item.id === selectedFileId);
  const activeTasks = tasks.filter((task) => ['QUEUED', 'RUNNING', 'CREATED'].includes(task.status.toUpperCase())).length;

  const logout = () => {
    authToken.clear();
    resetWorkspace();
  };

  return (
    <header className="topbar">
      <div className="brand topbar-brand"><BrandMark /><span>Layout Screenshot Studio</span></div>
      <div className="topbar-mobile-actions">
        <Tooltip title="Cell 面板"><Button type="text" icon={<MenuOutlined />} onClick={onToggleCells} aria-label="打开 Cell 面板" /></Tooltip>
      </div>
      <div className="topbar-selectors">
        <Select
          className="project-select"
          value={selectedProjectId || undefined}
          placeholder="选择项目"
          suffixIcon={<FolderOutlined />}
          onChange={selectProject}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          popupMatchSelectWidth={220}
          aria-label="项目选择"
        />
        <div className="file-selector-wrap">
          <Select
            className="file-select"
            value={selectedFileId || undefined}
            placeholder="选择版图文件"
            suffixIcon={<FileOutlined />}
            onChange={selectFile}
            notFoundContent={selectedProjectId ? '当前项目暂无文件' : '请先选择项目'}
            options={files.map((item) => ({
              value: item.id,
              label: <div className="file-option"><span>{fileName(item)}</span><Tag color={statusColor(item.status)}>{statusText(item.status)}</Tag></div>,
              textValue: fileName(item),
            }))}
            optionFilterProp="textValue"
            showSearch
            aria-label="版图文件选择"
          />
          {file && <span className={`file-state state-${file.status.toLowerCase()}`}>{statusText(file.status)} · {formatBytes(file.size_bytes)}</span>}
        </div>
      </div>
      <Space className="topbar-actions" size={6} wrap>
        <Tooltip title="返回项目门户首页"><Button icon={<HomeOutlined />} onClick={() => setWorkspaceEntered(false)}>首页</Button></Tooltip>
        <Button icon={<CloudUploadOutlined />} onClick={onUpload} disabled={!selectedProjectId}>上传</Button>
        <Badge count={activeTasks} size="small" offset={[-3, 3]}>
          <Button onClick={() => setTasksOpen(true)} disabled={!selectedFileId}>任务</Button>
        </Badge>
        <Button type="primary" icon={<CameraOutlined />} onClick={() => setScreenshotOpen(true)} disabled={!metadata || !selectedCell}>截图</Button>
        <Tooltip title="图层面板"><Button className="mobile-layer-button" onClick={onToggleLayers}>图层</Button></Tooltip>
        <Dropdown menu={{ items: [{ key: 'home', icon: <HomeOutlined />, label: '返回项目门户', onClick: () => setWorkspaceEntered(false) }, { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout }] }} trigger={['click']}>
          <Button type="text" className="user-button"><UserOutlined /><span>{user?.username}</span><DownOutlined /></Button>
        </Dropdown>
      </Space>
    </header>
  );
}
