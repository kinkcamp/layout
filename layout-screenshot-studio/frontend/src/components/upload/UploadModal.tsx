import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Modal, Progress, Space, Steps, Tag, Upload } from 'antd';
import { CloudUploadOutlined, FileZipOutlined, PauseOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { createSHA256 } from 'hash-wasm';
import { apiFetch } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useAppStore } from '@/store/appStore';
import type { FileStatus, UploadSession } from '@/types/api';

const CHUNK_SIZE = 64 * 1024 * 1024;
const MAX_RETRIES = 3;
type Phase = 'idle' | 'hashing' | 'uploading' | 'paused' | 'completing' | 'parsing' | 'success' | 'error';
type ChunkState = 'pending' | 'uploading' | 'done' | 'error';

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onReady: (layoutId: string) => void;
  onFilesChanged: () => void;
  initialFile?: File | null;
}

export function UploadModal({ open, onClose, onReady, onFilesChanged, initialFile }: UploadModalProps) {
  const { message } = App.useApp();
  const projectId = useAppStore((state) => state.selectedProjectId);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [sha256, setSha256] = useState('');
  const [hashProgress, setHashProgress] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [totalChunks, setTotalChunks] = useState(0);
  const [completedChunks, setCompletedChunks] = useState<Set<number>>(new Set());
  const [chunkStates, setChunkStates] = useState<Record<number, ChunkState>>({});
  const [currentChunk, setCurrentChunk] = useState<number | null>(null);
  const [parseStatus, setParseStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const pauseRequested = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      void readerRef.current?.cancel();
    };
  }, []);

  const chooseFile = (selected: File) => {
    abortRef.current?.abort();
    setFile(selected);
    setPhase('idle');
    setSha256('');
    setHashProgress(0);
    setSessionId(null);
    setTotalChunks(Math.ceil(selected.size / CHUNK_SIZE));
    setCompletedChunks(new Set());
    setChunkStates({});
    setCurrentChunk(null);
    setError(null);
    setParseStatus('');
  };

  useEffect(() => {
    if (open && initialFile) chooseFile(initialFile);
  }, [open, initialFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateChunk = (index: number, state: ChunkState) => {
    if (mounted.current) setChunkStates((current) => ({ ...current, [index]: state }));
  };

  const uploadChunk = async (id: string, index: number, controller: AbortController) => {
    if (!file) throw new Error('请先选择文件');
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      if (controller.signal.aborted) throw abortError();
      try {
        setCurrentChunk(index);
        updateChunk(index, 'uploading');
        const start = index * CHUNK_SIZE;
        const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
        await apiFetch<void>(`/files/${id}/chunks/${index}`, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': 'application/octet-stream' },
          signal: controller.signal,
        });
        updateChunk(index, 'done');
        setCompletedChunks((current) => new Set(current).add(index));
        return;
      } catch (reason) {
        if (isAbort(reason) || controller.signal.aborted) throw reason;
        lastError = reason;
      }
    }
    updateChunk(index, 'error');
    throw new Error(`分片 ${index + 1} 连续重试 ${MAX_RETRIES} 次仍失败：${errorMessage(lastError)}`);
  };

  const uploadMissingChunks = async (id: string, completed: Set<number>) => {
    if (!file) return;
    const controller = abortRef.current || new AbortController();
    abortRef.current = controller;
    setPhase('uploading');
    setError(null);
    const done = new Set(completed);
    try {
      for (let index = 0; index < totalChunks; index += 1) {
        if (done.has(index)) continue;
        if (controller.signal.aborted) throw abortError();
        await uploadChunk(id, index, controller);
        done.add(index);
      }
      setPhase('completing');
      await apiFetch<void>(`/files/${id}/complete`, { method: 'POST', signal: controller.signal });
      setPhase('parsing');
      onFilesChanged();
      await pollParsing(id, controller);
    } catch (reason) {
      if (isAbort(reason) || pauseRequested.current) {
        if (mounted.current && !pauseRequested.current) setPhase('paused');
      } else {
        setPhase('error');
        setError(errorMessage(reason));
      }
    } finally {
      setCurrentChunk(null);
    }
  };

  const pollParsing = async (id: string, controller: AbortController) => {
    while (!controller.signal.aborted) {
      const status = await apiFetch<FileStatus>(`/files/${id}/status`, { signal: controller.signal });
      const value = status.status.toUpperCase();
      setParseStatus(value);
      if (value === 'READY') {
        setPhase('success');
        onFilesChanged();
        message.success('文件上传与解析已完成');
        onReady(id);
        return;
      }
      if (value === 'FAILED' || value === 'CANCELLED') throw new Error(status.error_message || status.error || `版图解析${value === 'FAILED' ? '失败' : '已取消'}`);
      await delay(1600);
    }
  };

  const start = async () => {
    if (!file || !projectId) return;
    if (file.size === 0) { setError('不能上传空文件'); setPhase('error'); return; }
    pauseRequested.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase('hashing');
    setHashProgress(0);
    try {
      const hasher = await createSHA256();
      hasher.init();
      const reader = file.stream().getReader();
      readerRef.current = reader;
      let processed = 0;
      while (true) {
        if (controller.signal.aborted) throw abortError();
        const { done, value } = await reader.read();
        if (done) break;
        hasher.update(value);
        processed += value.byteLength;
        setHashProgress(Math.round((processed / file.size) * 100));
      }
      const digest = hasher.digest('hex');
      setSha256(digest);
      setPhase('uploading');
      const session = await apiFetch<UploadSession>('/files', {
        method: 'POST',
        body: { project_id: projectId, filename: file.name, size_bytes: file.size, total_chunks: totalChunks, chunk_size: CHUNK_SIZE, sha256: digest },
        signal: controller.signal,
      });
      const id = session.id || session.upload_id;
      if (!id) throw new Error('服务端未返回上传会话 ID');
      setSessionId(id);
      const status = await apiFetch<FileStatus>(`/files/${id}/status`, { signal: controller.signal });
      const completed = new Set(status.completed_chunks || session.completed_chunks || []);
      setCompletedChunks(completed);
      setChunkStates(Object.fromEntries([...completed].map((index) => [index, 'done'])));
      await uploadMissingChunks(id, completed);
    } catch (reason) {
      if (isAbort(reason) || pauseRequested.current) {
        if (mounted.current) setPhase('paused');
      } else {
        setPhase('error');
        setError(errorMessage(reason));
      }
    }
  };

  const pause = () => {
    pauseRequested.current = true;
    setPhase('paused');
    abortRef.current?.abort();
    void readerRef.current?.cancel();
  };

  const resume = () => {
    pauseRequested.current = false;
    abortRef.current = new AbortController();
    if (sessionId) void uploadMissingChunks(sessionId, new Set(completedChunks));
    else void start();
  };

  const close = () => {
    if (['hashing', 'uploading', 'completing', 'parsing'].includes(phase)) pause();
    onClose();
  };

  const doneCount = completedChunks.size;
  const uploadPercent = totalChunks ? Math.round((doneCount / totalChunks) * 100) : 0;
  const failedChunks = Object.entries(chunkStates).filter(([, state]) => state === 'error').map(([index]) => Number(index));
  const busy = ['hashing', 'uploading', 'completing', 'parsing'].includes(phase);
  const step = phase === 'hashing' || phase === 'idle' ? 0 : phase === 'parsing' || phase === 'success' ? 2 : 1;

  return (
    <Modal title="导入版图文件" open={open} onCancel={close} maskClosable={false} keyboard={false} width={640} footer={null} className="upload-modal">
      <div className="upload-steps"><Steps size="small" current={step} items={[{ title: '文件校验' }, { title: '分片上传' }, { title: '解析索引' }]} /></div>
      {!file ? (
        <Upload.Dragger
          accept=".gds,.gdsii,.oas,.oasis"
          multiple={false}
          showUploadList={false}
          beforeUpload={(selected) => { chooseFile(selected); return false; }}
          disabled={!projectId}
        >
          <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
          <p className="ant-upload-text">选择或拖入 GDSII / OASIS 文件</p>
          <p className="ant-upload-hint">支持 .gds、.gdsii、.oas、.oasis · 64 MiB 分片 · SHA-256 流式校验</p>
        </Upload.Dragger>
      ) : (
        <div className="selected-upload-file">
          <FileZipOutlined />
          <div><strong>{file.name}</strong><span>{formatBytes(file.size)} · {totalChunks} 个分片</span></div>
          {!busy && phase !== 'success' && <Upload accept=".gds,.gdsii,.oas,.oasis" showUploadList={false} beforeUpload={(selected) => { chooseFile(selected); return false; }}><Button size="small">更换</Button></Upload>}
        </div>
      )}
      {file && (
        <div className="upload-progress-section">
          {phase === 'hashing' || (hashProgress > 0 && !sha256) ? (
            <Progress percent={hashProgress} status="active" format={(value) => `SHA256 ${value}%`} />
          ) : <Progress percent={uploadPercent} status={phase === 'error' ? 'exception' : phase === 'success' ? 'success' : busy ? 'active' : 'normal'} format={(value) => `${doneCount}/${totalChunks} · ${value}%`} />}
          <div className="upload-status-line">
            <span>{phaseLabel(phase, parseStatus)}{currentChunk !== null ? ` · 当前分片 ${currentChunk + 1}` : ''}</span>
            {sessionId && <Tag>会话 {sessionId.slice(0, 8)}</Tag>}
          </div>
          {totalChunks > 0 && <ChunkStrip total={totalChunks} current={currentChunk} states={chunkStates} completed={completedChunks} />}
          {sha256 && <div className="hash-value"><span>SHA-256</span><code>{sha256}</code></div>}
        </div>
      )}
      {error && <Alert type="error" showIcon message="上传或解析未完成" description={error} />}
      {phase === 'paused' && <Alert type="warning" showIcon message="传输已中断" description="已完成分片保留在服务端，继续时将从缺失分片恢复。" />}
      {failedChunks.length > 0 && <Alert type="warning" showIcon message={`失败分片：${failedChunks.map((index) => index + 1).join('、')}`} description="点击“重传缺失分片”可单独重试失败及尚未上传的分片。" />}
      <div className="upload-footer">
        <span className="upload-security-note">原始文件只读 · 刷新页面后需重新选择文件以恢复会话</span>
        <Space>
          {busy && <Button icon={<PauseOutlined />} onClick={pause}>中断</Button>}
          {(phase === 'paused' || phase === 'error') && <Button type="primary" icon={<ReloadOutlined />} onClick={resume}>重传缺失分片</Button>}
          {phase === 'idle' && <Button type="primary" icon={<PlayCircleOutlined />} disabled={!file || !projectId} onClick={() => void start()}>计算哈希并上传</Button>}
          {phase === 'success' && <Button type="primary" onClick={close}>完成</Button>}
        </Space>
      </div>
    </Modal>
  );
}

function ChunkStrip({ total, current, states, completed }: { total: number; current: number | null; states: Record<number, ChunkState>; completed: Set<number> }) {
  const center = current ?? 0;
  const start = Math.max(0, Math.min(center - 40, total - 100));
  const end = Math.min(total, start + 100);
  const chunks = Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset);
  return (
    <div className="chunk-progress">
      <div className="chunk-strip" aria-label={`分片 ${start + 1} 至 ${end}`}>
        {chunks.map((index) => {
          const state = completed.has(index) ? 'done' : states[index] || 'pending';
          return <span key={index} className={`chunk chunk-${state}`} title={`分片 ${index + 1}：${state}`} />;
        })}
      </div>
      <span>{total > 100 ? `显示 ${start + 1}–${end} / 共 ${total} 片；绿色已完成，红色需重传` : `共 ${total} 片；绿色已完成，红色需重传`}</span>
    </div>
  );
}

function phaseLabel(phase: Phase, parseStatus: string) {
  const labels: Record<Phase, string> = {
    idle: '等待开始', hashing: '正在流式计算 SHA-256', uploading: '正在上传分片', paused: '传输已暂停',
    completing: '正在合并并校验文件', parsing: `正在解析版图${parseStatus ? `（${parseStatus}）` : ''}`,
    success: '上传与解析完成', error: '流程已停止，可重试',
  };
  return labels[phase];
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function abortError() {
  return new DOMException('Upload aborted', 'AbortError');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误';
}
