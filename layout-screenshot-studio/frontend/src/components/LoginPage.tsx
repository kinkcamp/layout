import { useState } from 'react';
import { Alert, Button, Form, Input, Tag } from 'antd';
import { LockOutlined, LoginOutlined, UserOutlined } from '@ant-design/icons';
import { apiFetch, authToken, ApiError } from '@/lib/api';
import { useAppStore } from '@/store/appStore';
import type { LoginResponse } from '@/types/api';

interface LoginFields { username: string; password: string }

export function LoginPage() {
  const setUser = useAppStore((state) => state.setUser);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<LoginFields>();

  const login = async (values: LoginFields) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: values });
      authToken.set(result.access_token);
      setUser(result.user);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-intro" aria-label="产品介绍">
        <div className="brand brand-large"><BrandMark /><span>Layout Screenshot Studio</span></div>
        <div className="login-intro-copy">
          <Tag color="cyan">EDA WORKSPACE</Tag>
          <h1>从原始版图到精确截图</h1>
          <p>直接浏览 GDSII / OASIS 几何，管理 Layer 与 Datatype，按区域查询并输出高分辨率 PNG。</p>
          <div className="login-specs">
            <span>WebGL2 增量瓦片</span><span>DBU 精确坐标</span><span>服务端 PNG 渲染</span>
          </div>
        </div>
        <div className="login-footnote">内部工程工具 · 原始文件只读 · 层次化浏览</div>
      </section>
      <section className="login-form-section">
        <div className="login-form-wrap">
          <div className="login-form-heading">
            <span className="eyebrow">SECURE ACCESS</span>
            <h2>登录工作台</h2>
            <p>使用团队账号继续</p>
          </div>
          <Alert
            className="dev-hint"
            type="info"
            showIcon
            message="开发环境账号"
            description={<span>用户名 <code>admin</code>，密码 <code>admin123</code>。Token 仅保存在当前页面内存中。</span>}
          />
          {error && <Alert type="error" showIcon message={error} className="login-error" />}
          <Form form={form} layout="vertical" requiredMark={false} onFinish={login} initialValues={{ username: 'admin', password: 'admin123' }} size="large">
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} autoComplete="username" placeholder="用户名" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="密码" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading} icon={<LoginOutlined />}>进入工作台</Button>
          </Form>
          <p className="login-session-note">刷新或关闭页面后需要重新登录</p>
        </div>
      </section>
    </main>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 4h10v6H10v4H4V4Zm14 0h10v10h-6v-4h-4V4ZM4 18h6v4h4v6H4V18Zm12 4h6v-4h6v10H14v-6h2Z" fill="currentColor" />
      <path d="M12 12h8v8h-8z" fill="currentColor" opacity=".55" />
    </svg>
  );
}
