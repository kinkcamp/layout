# Layout Screenshot Studio

基于真实 GDSII/OASIS 几何数据的团队版图浏览与 PNG 截图 POC。不是图片转换器：KLayout 负责只读解析和层次区域查询，浏览器使用 WebGL2 渲染瓦片，后端使用相同几何服务导出 PNG。

## 已实现

- 64 MiB 分片上传、断点续传、失败分片重试、流式 SHA-256、只读原文件。
- GDSII/OASIS 元数据、DBU、Top Cell、Cell 层次与实例/阵列摘要、Layer/Datatype。
- LOD 区域瓦片、磁盘缓存、几何上限与截断提示、分页区域查询。
- WebGL2 缩放/平移/框选/适配、局部原点与 earcut 三角化、图层顺序/颜色/透明度。
- 截图范围与比例/分辨率、背景/边距、标题/比例尺/坐标/图例、PNG 预览下载。
- JWT 登录、项目门户与新建项目向导、GDS/OAS 选择、截图目录授权、项目隔离和审计日志。
- 默认仅渲染首个图层；支持画布标记、双点标尺（距离/ΔX/ΔY），标记随 PNG 导出。
- 任务轮询/取消/失败重试和基础配额。
- PostgreSQL、Redis、Celery 独立解析/截图 Worker、Nginx、Docker Compose 资源限制。

## 本地开发

要求：Python 3.12+（已实测 3.13）、Node.js 22+。

```bash
make install
make dev-backend
# 另一个终端
make dev-frontend
```

访问 http://127.0.0.1:5173。开发账号 `admin / admin123`，可用 `LSS_ADMIN_USERNAME`、`LSS_ADMIN_PASSWORD` 修改。默认使用 SQLite 和本地后台任务，无需 Postgres/Redis。

```bash
make test
make build
.venv/bin/python scripts/check_klayout.py /path/to/file.gds
.venv/bin/python scripts/benchmark_layout.py /path/to/file.gds --output data/exports/benchmark.png
```

## Docker Compose

```bash
cp .env.example .env
# 修改数据库密码、JWT 密钥和管理员密码
make docker-up
```

访问 http://localhost:8080。共享命名卷 `layout-data` 保存原文件、缓存和导出；`postgres-data`、`redis-data` 分别保存数据库与队列。停止服务使用 `make docker-down`，不会删除数据卷。

## 验证记录

使用 40 MB `eetop.cn_fpga_top_icv_in_design.gds` 实测：KLayout 0.30.12 可识别 474 个 Cell、403 个 Top Cell、40 个 Layer/Datatype，默认 Cell 为 `fpga_top`（index 441），DBU 为 0.001 µm。API 分片上传、解析、瓦片、区域查询和 1920×1080 PNG 下载闭环通过；后端 12 项测试通过，前端 TypeScript 与生产构建通过，Compose 配置校验通过。缩放加载采用有界 KLayout 实例池、gzip 瓦片响应和过期请求取消；相同样本 6 个并发新瓦片由约 1.36 秒降至预热后约 0.61 秒。

## POC 边界

- 单瓦片默认最多 5000 个图形；大图全览会明确提示截断，放大后查询局部细节。
- POC 使用 gzip JSON 几何瓦片而非二进制流；每个进程使用有界 KLayout 只读实例池（默认 4，可用 `LSS_LAYOUT_CACHE_ENTRIES` 调整），尚未实现跨进程共享空间索引。
- 本地模式适合单进程开发；团队部署请使用 Celery 模式并设置资源配额。
- 标记与浏览器导出目录授权保存在当前页面会话中；刷新后需重新选择目录。不支持目录授权的浏览器使用默认下载目录。
- 未集成 Calibre DRC/LVS、生产 SSO、Alembic 版本迁移和自动运维告警。
