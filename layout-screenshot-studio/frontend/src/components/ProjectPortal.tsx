import { useEffect, useState } from 'react';
import { Alert, App, Button, Empty, Form, Input, Modal, Skeleton, Space, Upload } from 'antd';
import { CloudUploadOutlined, FileOutlined, FolderOpenOutlined, LogoutOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { apiFetch, authToken } from '@/lib/api';
import { chooseExportDirectory, getExportDirectoryName, supportsDirectoryPicker } from '@/lib/exportDirectory';
import { useAppStore } from '@/store/appStore';
import type { Project } from '@/types/api';
import { BrandMark } from './LoginPage';

interface ProjectFields { name: string; description?: string }

export function ProjectPortal() {
  const { message } = App.useApp();
  const { user, projects } = useAppStore();
  const setProjects = useAppStore((state) => state.setProjects);
  const selectProject = useAppStore((state) => state.selectProject);
  const setWorkspaceEntered = useAppStore((state) => state.setWorkspaceEntered);
  const setPendingUploadFile = useAppStore((state) => state.setPendingUploadFile);
  const resetWorkspace = useAppStore((state) => state.resetWorkspace);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [directoryName, setDirectoryName] = useState(getExportDirectoryName());
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<ProjectFields>();

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{ items: Project[] }>('/projects');
      setProjects(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '项目加载失败');
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadProjects(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enterProject = (project: Project) => {
    selectProject(project.id);
    setPendingUploadFile(null);
    setWorkspaceEntered(true);
  };

  const selectDirectory = async () => {
    try {
      setDirectoryName(await chooseExportDirectory());
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) message.error(reason instanceof Error ? reason.message : '目录选择失败');
    }
  };

  const createProject = async (values: ProjectFields) => {
    if (!file) { setError('请选择需要导入的 GDSII 或 OASIS 文件'); return; }
    setCreating(true);
    setError(null);
    try {
      const project = await apiFetch<Project>('/projects', { method: 'POST', body: { name: values.name.trim(), description: values.description?.trim() || '' } });
      setProjects([project, ...projects]);
      selectProject(project.id);
      setPendingUploadFile(file);
      setCreateOpen(false);
      setWorkspaceEntered(true);
      message.success('项目已创建，开始导入版图');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '项目创建失败');
    } finally { setCreating(false); }
  };

  const logout = () => { authToken.clear(); resetWorkspace(); };

  return (
    <main className="project-portal">
      <header className="portal-header">
        <div className="brand brand-large"><BrandMark /><span>Layout Screenshot Studio</span></div>
        <Space><span className="portal-user">{user?.username}</span><Button type="text" icon={<LogoutOutlined />} onClick={logout}>退出</Button></Space>
      </header>
      <section className="portal-content">
        <div className="portal-heading">
          <div><span className="eyebrow">PROJECT WORKSPACE</span><h1>选择项目，继续版图分析</h1><p>每个项目独立管理原始版图、图层配置与截图任务。</p></div>
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => { setFile(null); setError(null); setCreateOpen(true); }}>新建项目</Button>
        </div>
        {error && !createOpen && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => void loadProjects()}>重试</Button>} />}
        {loading ? <div className="project-grid">{[0, 1, 2].map((item) => <div className="project-entry" key={item}><Skeleton active /></div>)}</div> : projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <button className="project-entry" key={project.id} onClick={() => enterProject(project)}>
                <div className="project-entry-icon"><FolderOpenOutlined /></div>
                <div className="project-entry-copy"><strong>{project.name}</strong><p>{project.description || 'GDSII / OASIS 版图项目'}</p><span>{formatProjectDate(project.created_at)}</span></div>
                <RightOutlined className="project-entry-arrow" />
              </button>
            ))}
          </div>
        ) : <div className="portal-empty"><Empty description="还没有项目"><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建第一个项目</Button></Empty></div>}
      </section>
      <Modal title="新建项目并导入版图" open={createOpen} onCancel={() => setCreateOpen(false)} footer={null} width={620} maskClosable={false}>
        <Form form={form} layout="vertical" requiredMark={false} onFinish={createProject} initialValues={{ name: '', description: '' }}>
          <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: '请输入项目名称' }, { max: 200 }]}><Input placeholder="例如：FPGA Top 版图审查" autoFocus /></Form.Item>
          <Form.Item name="description" label="项目说明"><Input.TextArea rows={2} maxLength={500} placeholder="可选，记录芯片、工艺或审查目标" /></Form.Item>
          <div className="field-label">GDSII / OASIS 文件</div>
          {file ? <div className="wizard-file"><FileOutlined /><div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MiB</span></div><Button size="small" onClick={() => setFile(null)}>更换</Button></div> : (
            <Upload.Dragger accept=".gds,.gdsii,.oas,.oasis" multiple={false} showUploadList={false} beforeUpload={(selected) => { setFile(selected); return false; }}>
              <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p><p className="ant-upload-text">选择或拖入版图文件</p><p className="ant-upload-hint">创建项目后自动进行分片上传与解析</p>
            </Upload.Dragger>
          )}
          <div className="wizard-directory">
            <div><span className="field-label">截图保存位置</span><p>{directoryName || '浏览器默认下载目录'}{supportsDirectoryPicker() ? '' : ' · 当前浏览器不支持目录授权'}</p></div>
            <Button icon={<FolderOpenOutlined />} onClick={() => void selectDirectory()} disabled={!supportsDirectoryPicker()}>{directoryName ? '更换目录' : '选择目录'}</Button>
          </div>
          {error && <Alert type="error" showIcon message={error} />}
          <div className="wizard-footer"><span>{directoryName ? `截图将保存到 ${directoryName}` : '截图可在任务列表中下载'}</span><Button type="primary" htmlType="submit" loading={creating} disabled={!file} icon={<RightOutlined />}>创建并导入</Button></div>
        </Form>
      </Modal>
    </main>
  );
}

function formatProjectDate(value?: string) {
  if (!value) return '刚刚创建';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `创建于 ${date.toLocaleDateString('zh-CN')}`;
}
