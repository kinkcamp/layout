# Layout Screenshot Studio

## Web 化版图辅助查看与截图平台------完整技术方案（POC 版）

**版本：** 1.0\
**日期：** 2026-11-04\
**目标部署：** Linux + Docker Compose\
**目标用户：** 5～20 人团队\
**目标数据：** GDSII / OASIS，数百 MB 至数 GB\
**优先工作流：** Siemens Calibre；POC
阶段聚焦版图导入、查看、图层管理、区域查询与截图，不集成 DRC/LVS 执行。

------------------------------------------------------------------------

# 1. 项目概述

## 1.1 建设目标

建设一个浏览器访问的 Layout Screenshot
Studio，用于导入芯片版图文件、浏览层次结构、管理 Layer/Datatype
显示、定位版图区域、创建截图任务并导出
PNG。平台面向团队内部使用，支持多人同时浏览和提交任务。

平台必须直接解析 GDSII/OASIS
原始版图数据，而不是将版图文件简单转换成一张图片。原始数据作为只读输入保存，解析结果、空间索引、瓦片和截图作为可重建缓存管理。

## 1.2 POC 范围

**纳入范围**

-   GDSII（`.gds`、`.gdsii`）和 OASIS（`.oas`、`.oasis`）导入。
-   大文件分片上传、断点续传能力、SHA-256 校验。
-   Layout 元数据解析：DBU、Top Cell、Cell 数量、层列表、边界框。
-   Cell 层次树和实例信息浏览。
-   Layer/Datatype 列表、显隐、颜色、透明度、分组和显示顺序。
-   WebGL 版图视图、缩放、平移、框选、坐标显示。
-   按 Cell、Layer/Datatype、矩形区域查询几何。
-   截图任务：范围、宽高/比例、分辨率、图层可见性、背景色、边框与标注。
-   PNG 导出、任务状态、失败重试、操作审计。
-   用户登录、基础角色权限、资源配额和任务并发限制。

**暂不纳入**

-   Calibre DRC/LVS 规则 deck 执行、结果数据库解析和错误标记回写。
-   版图编辑、几何修改、保存回写原始 GDS/OAS。
-   PDK/工艺规则管理。
-   在线协同编辑和实时光标。
-   对外互联网多租户 SaaS 能力。

## 1.3 设计原则

1.  **原始文件只读**：不修改用户上传的 GDS/OAS。
2.  **保留层次**：默认不 Flatten，保留 Cell/Instance/Array 信息。
3.  **按需加载**：浏览器只获取当前视口需要的瓦片或几何，不全量加载版图。
4.  **整数坐标为准**：后端以 DBU
    整数坐标计算，前端使用局部原点和相对坐标渲染。
5.  **缓存可重建**：缓存由原始文件哈希、解析器版本和索引版本共同标识。
6.  **任务隔离**：解析、瓦片、截图分队列，限制并发和内存。
7.  **先验证后扩容**：先用真实版图做性能基线，再确定服务器资源和并发参数。

------------------------------------------------------------------------

# 2. 总体架构

## 2.1 逻辑架构

``` text
┌────────────────────────────────────────────────────────────┐
│                       Browser                              │
│  React + TypeScript                                        │
│  ├─ Project / File Manager                                 │
│  ├─ Cell Hierarchy                                         │
│  ├─ Layer & Datatype Manager                               │
│  ├─ WebGL Layout Viewer                                    │
│  └─ Screenshot Task Editor / PNG Download                  │
└───────────────────────────┬────────────────────────────────┘
                            │ HTTPS / REST / WebSocket
┌───────────────────────────▼────────────────────────────────┐
│                  Nginx Reverse Proxy                       │
│            Static Assets / TLS / API Proxy                 │
└───────────────────────────┬────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────┐
│                    FastAPI Backend                          │
│  Auth / Upload Session / Layout API / Tile API / Task API  │
└───────────────┬───────────────────────────┬────────────────┘
                │                           │
        ┌───────▼────────┐          ┌───────▼────────┐
        │ PostgreSQL    │          │ Redis          │
        │ Metadata      │          │ Celery Broker  │
        │ Users/Tasks   │          │ Cache/Progress │
        └───────────────┘          └───────┬────────┘
                                          │
          ┌───────────────────────────────┼────────────────────────┐
          │                               │                        │
   ┌──────▼──────┐                 ┌──────▼──────┐          ┌──────▼──────┐
   │ Parser      │                 │ Renderer    │          │ Screenshot │
   │ Worker      │                 │ Worker      │          │ Worker     │
   │ KLayout API │                 │ Tile/Query  │          │ PNG Export │
   └──────┬──────┘                 └──────┬──────┘          └──────┬──────┘
          │                               │                        │
          └───────────────────────────────┼────────────────────────┘
                                          │
                              ┌───────────▼───────────┐
                              │ Shared Storage        │
                              │ uploads / cache       │
                              │ exports / logs        │
                              └───────────────────────┘
```

## 2.2 技术选型

  ---------------------------------------------------------------------------------
  层次                    建议技术                主要职责
  ----------------------- ----------------------- ---------------------------------
  前端                    React + TypeScript +    页面、交互、任务管理
                          Vite                    

  版图渲染                WebGL 2.0；可评估 regl  大规模几何绘制
                          / PixiJS 自定义图层     

  UI                      Ant Design 或 Mantine   表格、树、对话框、表单

  状态管理                Zustand                 视口、图层、选择集、任务状态

  API                     Python FastAPI          REST API、鉴权、上传、任务编排

  版图解析                KLayout Python          GDS/OAS 读取、Cell/Layer/Geometry
                          API（`klayout.db`）     查询

  后台任务                Celery                  异步解析、瓦片生成、截图导出

  消息队列                Redis 7                 Broker、短期进度和缓存

  元数据                  PostgreSQL 16           用户、文件、布局元数据、任务

  反向代理                Nginx                   HTTPS、静态资源、API 转发

  部署                    Docker Compose          单机/单节点部署

  监控                    Prometheus +            CPU、内存、队列、任务和存储监控
                          Grafana（第二阶段）     
  ---------------------------------------------------------------------------------

### 选型说明

-   KLayout 是 POC 的核心解析引擎。先验证目标版本的 Python 包、Python
    ABI、系统库和 GDS/OAS 文件兼容性，再固定镜像版本。
-   前端渲染不直接依赖 KLayout
    GUI。后端提供标准化的几何瓦片/查询结果，前端只负责绘制和交互。
-   初期不要求服务端 NVIDIA GPU。WebGL 使用用户浏览器本机 GPU；后端 CPU
    完成解析和 PNG 离屏渲染即可。
-   KLayout 版本不得使用 `latest`。POC 可从 `klayout==0.30.12`
    开始验证，正式锁定前必须对目标样本做 API 和性能回归。

------------------------------------------------------------------------

# 3. 核心业务流程

## 3.1 文件导入

1.  用户创建项目或选择已有项目。
2.  浏览器请求创建上传会话，后端返回 upload
    ID、分片大小和已完成分片列表。
3.  浏览器按分片上传文件，建议初始分片大小 64 MiB。
4.  后端校验每个分片并记录状态；失败分片可单独重传。
5.  用户完成上传后，后端按顺序合并分片，计算完整文件 SHA-256。
6.  文件进入 `QUEUED` 状态，Parser Worker 异步解析。
7.  解析成功后保存元数据和索引状态，文件变为
    `READY`；失败则记录错误码、日志 ID 和失败原因。

## 3.2 浏览与渲染

1.  前端请求布局元数据、Top Cell 和 Layer/Datatype。
2.  用户选择 Top Cell、图层可见性和颜色。
3.  前端请求当前视口的瓦片。
4.  Renderer 根据文件哈希、Cell、层过滤条件、LOD、瓦片坐标查缓存。
5.  缓存命中直接返回；未命中则按需查询几何、生成瓦片并写缓存。
6.  前端将瓦片转换为 GPU Buffer，按视口坐标渲染。
7.  用户缩放、平移、隐藏图层或切换 Cell 时，只更新受影响的视口数据。

## 3.3 截图任务

1.  用户在 Viewer 中框选区域，或输入坐标范围。
2.  选择输出尺寸、宽高比、DPI/像素尺寸、背景色、边距和图层集合。
3.  前端提交截图任务，后端校验范围、像素上限和权限。
4.  Screenshot Worker 查询所需几何，按图层绘制或分块渲染。
5.  生成 PNG，保存任务元数据和文件路径。
6.  前端显示预览、尺寸、耗时、状态，并提供下载。

------------------------------------------------------------------------

# 4. 数据与版图解析设计

## 4.1 支持格式

  ---------------------------------------------------------------------------------------------------
  格式                    扩展名                  POC 要求
  ----------------------- ----------------------- ---------------------------------------------------
  GDSII                   `.gds`、`.gdsii`        读取
                                                  Cell、实例、Layer/Datatype、Box/Polygon/Path/Text

  OASIS                   `.oas`、`.oasis`        读取同类数据；重点验证压缩、重复结构和大文件行为
  ---------------------------------------------------------------------------------------------------

格式识别不能只依赖扩展名。后端应先检查文件头/解析器读取结果，并对不支持或损坏文件给出明确错误。

## 4.2 KLayout 解析数据模型

主要对象：

-   `Layout`：一个版图数据库。
-   `Cell`：版图单元。
-   `Instance`：Cell 实例引用及其变换。
-   `LayerInfo`：Layer/Datatype/名称等信息。
-   `Shape`：Polygon、Box、Path、Text 等几何。
-   `Region` / Recursive Shape Iterator：区域几何查询和层次遍历。

解析必须保留： - `layout.dbu`； - Cell 名称和内部索引； - Top Cell； -
Cell bbox； - Layer/Datatype； - 实例关系、实例变换、阵列参数； -
几何类型和必要属性。

**重要：** `layout.cells()` 是数据库 Cell 数量，不是 Flatten
后的总几何数量，也不是递归实例展开数量。报表必须区分 Cell 数、直接 Shape
数、实例数和查询时展开的几何数。

## 4.3 元数据解析示例

``` python
from pathlib import Path
import json
import time
import klayout.db as kdb

def parse_layout(filename: str) -> dict:
    path = Path(filename)
    if not path.is_file():
        raise FileNotFoundError(filename)

    started = time.perf_counter()
    layout = kdb.Layout()
    layout.read(str(path))

    top_cells = []
    for cell in layout.top_cells():
        box = cell.bbox()
        top_cells.append({
            "name": cell.name,
            "cell_index": cell.cell_index(),
            "bbox_dbu": {
                "left": box.left,
                "bottom": box.bottom,
                "right": box.right,
                "top": box.top,
            },
        })

    layers = []
    for layer_index in layout.layer_indexes():
        info = layout.get_info(layer_index)
        layers.append({
            "layer_index": layer_index,
            "layer": info.layer,
            "datatype": info.datatype,
            "name": info.name,
        })

    return {
        "filename": path.name,
        "size_bytes": path.stat().st_size,
        "dbu_um": layout.dbu,
        "cell_count": layout.cells(),
        "top_cells": top_cells,
        "layers": layers,
        "parse_seconds": round(time.perf_counter() - started, 3),
    }

if __name__ == "__main__":
    import sys
    print(json.dumps(parse_layout(sys.argv[1]), indent=2))
```

此代码用于 POC
验证。正式实现需要增加异常分类、超时/取消、资源统计、日志、格式校验、版本信息和结果持久化。

## 4.4 OASIS 内存策略

-   首先以 KLayout 默认读取模式验证 OASIS 样本。
-   不要在没有基准测试前主动 Flatten。
-   对 OASIS，优先评估 KLayout 非编辑模式读取及其对重复结构/shape arrays
    的内存优势。
-   对需要修改数据库的操作才考虑编辑模式；本平台 POC
    是只读查看，优先只读路径。
-   分别记录文件大小、解析耗时、峰值 RSS、Cell 数、实例数、Shape
    数和缓存占用。

## 4.5 层次与实例

Cell Tree 采用按需展开： - 首次只返回 Top Cell。 - 展开某个 Cell
时再查询其子实例。 - 对重复实例显示数量、阵列行列数、变换信息。 -
对循环引用、异常层次或超深层次设置防护。 - 对大型阵列不得在 API
响应中把每个实例全部展开。

默认不
Flatten。区域查询应支持递归实例变换，包括平移、旋转、镜像和阵列实例。必须用测试样本验证
AREF、嵌套 Cell、旋转与镜像。

------------------------------------------------------------------------

# 5. 几何查询、瓦片与 WebGL

## 5.1 为什么必须使用瓦片

数 GB
版图可能包含极多多边形和重复实例。一次性将全部几何传到浏览器会导致： -
API 响应过大； - 浏览器内存和 GPU Buffer 暴涨； - 首屏加载缓慢； -
缩放和平移卡顿； - 图层开关需要重新处理大量数据。

因此采用视口驱动的 Tile + LOD 机制。

## 5.2 坐标约定

-   后端数据库坐标统一使用整数 DBU。
-   DBU 与微米换算：`um = dbu_integer * layout.dbu`。
-   API 返回坐标时明确单位，不允许混用 DBU、µm 和像素。
-   前端使用视口局部原点：`local = global - viewport_origin`，避免大坐标直接写入
    Float32 导致精度损失。
-   截图范围在 API 中以 DBU 整数或明确声明单位的坐标传递。

## 5.3 Tile 设计

Tile 请求维度建议包括： - layout_id / content_hash； - top_cell 或目标
Cell； - LOD； - tile_x、tile_y； - Layer/Datatype 过滤集合； -
几何简化级别； - tile schema version。

瓦片缓存键示例：

``` text
{sha256}:{parser_version}:{tile_schema}:{cell}:{lod}:{x}:{y}:{layer_filter_hash}
```

瓦片生成原则： - 只查询瓦片 bbox 与目标几何相交的对象。 - 使用空间索引或
KLayout 区域查询能力。 - 低缩放级别优先显示简化轮廓或密度信息。 -
高缩放级别加载精细 Polygon/Path。 -
超密集区域采用分块、简化或密度渲染，避免单瓦片承载无限几何。 -
图层显隐优先通过图层独立 Buffer/瓦片控制，避免每次全量重新解析。

## 5.4 WebGL 前端

主要模块： - `ViewportController`：缩放、平移、框选、坐标变换。 -
`TileManager`：可见瓦片计算、请求、缓存、淘汰。 - `LayerRenderer`：按
Layer/Datatype 管理 GPU Buffer。 -
`SelectionManager`：Cell、Shape、区域选择。 -
`CoordinateOverlay`：坐标、比例尺、DBU/µm 显示。 -
`ScreenshotComposer`：截图范围和标注预览。

交互要求： - 滚轮缩放，以鼠标位置为缩放中心。 -
中键拖动或空格+左键平移（可配置）。 - 框选区域、适配全部、回到 Top
Cell。 - 图层显隐即时反馈。 - 选中几何显示边界/高亮，不要求 POC
编辑几何。 - 大视图下保持交互响应，不允许主线程进行大规模几何解析。

## 5.5 区域查询

查询条件： - layout； - Cell； - DBU bbox； - Layer/Datatype； -
几何类型； - 是否递归遍历实例。

优先使用 KLayout 的区域查询/递归 Shape Iterator 能力。POC 应验证
`begin_shapes_overlapping`、`begin_shapes_touching` 或等价 API
在当前锁定版本上的行为和性能。API
返回分页结果和统计，不允许默认返回整个区域的所有 Shape。

------------------------------------------------------------------------

# 6. 截图任务系统

## 6.1 截图任务字段

  字段           类型           说明
  -------------- -------------- -----------------------------------------
  name           string         任务名称
  layout_id      UUID           来源版图
  cell_id        string         目标 Cell
  bbox           integer\[4\]   DBU 坐标范围
  width_px       integer        输出宽度
  height_px      integer        输出高度
  aspect_ratio   string         预设比例或自定义
  layers         array          可见 Layer/Datatype
  background     string         背景色
  margin_px      integer        边距
  annotations    array          标题、比例尺、坐标、图例等
  format         enum           POC 固定 PNG
  status         enum           QUEUED/RUNNING/SUCCESS/FAILED/CANCELLED

## 6.2 比例预设

建议提供： - 16:9：演示文稿/横向报告； - 4:3：传统报告； -
1:1：局部结构对比； - 3:2：通用横向截图； - 9:16：竖向说明； -
自定义宽高。

比例只是画布宽高比，不应自动改变版图几何比例。默认保持 X/Y
等比例，留白区域由边距策略处理。

## 6.3 分辨率与限制

POC 建议： - 默认 1920×1080； - 可选 2560×1440、3840×2160； -
自定义尺寸设置最大像素数和最大边长； - 初期单张截图限制 100
MP，压测后再调整； - 超大截图采用分块渲染和 PNG 拼接； -
服务端设置任务超时、内存限制和磁盘配额。

截图必须使用和 Viewer
一致的坐标变换、图层顺序、颜色及过滤条件，避免"屏幕显示与导出结果不一致"。

## 6.4 截图渲染实现

两条路线： 1. **POC 推荐：** 后端使用 KLayout 查询几何，采用 Python/C++
绘图或 KLayout 可用的渲染接口生成 PNG。 2. **后续增强：**
复用统一的几何瓦片数据，由独立渲染器完成高分辨率离屏绘制。

不要依赖浏览器截图作为唯一导出方案，因为浏览器截图受显卡、视口尺寸、浏览器缩放和当前加载瓦片影响，不适合稳定生成
4K/超大图。

------------------------------------------------------------------------

# 7. 后端服务与 API 设计

统一前缀：`/api/v1`

  方法   路径                           用途
  ------ ------------------------------ ------------------------------
  GET    `/health`                      健康检查
  POST   `/files`                       创建上传会话
  PUT    `/files/{id}/chunks/{n}`       上传指定分片
  GET    `/files/{id}/status`           查询上传/解析状态
  POST   `/files/{id}/complete`         合并分片并提交解析
  GET    `/layouts/{id}/metadata`       DBU、bbox、Cell 数等
  GET    `/layouts/{id}/layers`         Layer/Datatype
  GET    `/layouts/{id}/cells`          Cell Tree，支持分页/按需展开
  GET    `/layouts/{id}/tiles`          获取指定视口瓦片
  POST   `/layouts/{id}/query`          区域几何查询
  POST   `/screenshots`                 创建截图任务
  GET    `/screenshots/{id}`            查询截图状态
  GET    `/screenshots/{id}/download`   下载 PNG
  POST   `/tasks/{id}/cancel`           取消可取消任务

## 7.1 分片上传协议

建议初始分片大小 64 MiB，可根据网络和浏览器表现调整。

1.  `POST /files`：传文件名、总大小、总分片数、可选 SHA-256。
2.  `PUT /files/{id}/chunks/{n}`：传分片二进制，支持幂等重传。
3.  `GET /files/{id}/status`：返回已完成分片号。
4.  `POST /files/{id}/complete`：服务端按序合并、校验哈希并入队解析。

必须处理： - 重复分片； - 分片乱序； - 上传中断； - 用户取消； -
会话过期清理； - 磁盘空间不足； - 哈希不匹配； - 同名文件； -
并发上传配额。

## 7.2 API 任务状态

建议统一状态机：

``` text
CREATED -> UPLOADING -> UPLOADED -> QUEUED -> RUNNING
                                      |          |
                                      |          +-> SUCCESS
                                      |          +-> FAILED
                                      |          +-> CANCELLED
                                      +-> CANCELLED
```

状态更新写 PostgreSQL；Redis
用于短期任务进度、队列和事件通知。关键状态不可只存在 Redis。

------------------------------------------------------------------------

# 8. 数据库设计

建议 PostgreSQL 存元数据，不存原始几何主体。

## 8.1 核心表

### users

-   `id`
-   `username`
-   `password_hash` / 外部认证标识
-   `role`
-   `created_at`

### projects

-   `id`
-   `name`
-   `description`
-   `owner_id`
-   `created_at`

### layout_files

-   `id`
-   `project_id`
-   `original_name`
-   `storage_path`
-   `format`
-   `size_bytes`
-   `sha256`
-   `status`
-   `parser_version`
-   `dbu`
-   `cell_count`
-   `top_cell_count`
-   `bbox`
-   `created_by`
-   `created_at`

### layout_layers

-   `id`
-   `layout_id`
-   `layer_index`
-   `layer_number`
-   `datatype`
-   `name`
-   `default_color`
-   `visible_default`

### layout_cells

-   `id`
-   `layout_id`
-   `cell_index`
-   `cell_name`
-   `bbox`
-   `is_top`
-   `direct_instance_count`

### screenshot_tasks

-   `id`
-   `layout_id`
-   `created_by`
-   `name`
-   `cell_id`
-   `bbox`
-   `width_px`
-   `height_px`
-   `layer_config_json`
-   `status`
-   `output_path`
-   `error_code`
-   `created_at`
-   `finished_at`

### audit_logs

-   `id`
-   `user_id`
-   `action`
-   `object_type`
-   `object_id`
-   `created_at`
-   `request_id`

## 8.2 索引

-   `layout_files(project_id, created_at)`
-   `layout_files(sha256)`
-   `layout_layers(layout_id, layer_number, datatype)`
-   `layout_cells(layout_id, cell_name)`
-   `screenshot_tasks(created_by, created_at)`
-   `screenshot_tasks(status, created_at)`

bbox 可先以 JSON/数值字段保存；若后续需要数据库级空间查询，再评估
PostGIS。POC 的几何查询优先由 KLayout 处理。

------------------------------------------------------------------------

# 9. 存储与缓存设计

建议目录：

``` text
/data/
├── uploads/
│   ├── sessions/
│   └── originals/
├── cache/
│   ├── metadata/
│   ├── tiles/
│   └── spatial-index/
├── exports/
│   └── screenshots/
├── logs/
└── tmp/
```

规则： - `originals/` 上传完成后设为只读或以只读方式挂载到 Worker。 -
`sessions/` 保存未完成分片，按过期时间清理。 - `cache/` 可删除并重建。 -
`exports/` 按项目/用户/日期组织，设置保留策略。 - PostgreSQL
只存路径、元数据和状态。 -
所有路径由服务端生成，禁止直接信任用户上传文件名。 -
文件名需要清理路径分隔符和特殊字符，避免路径穿越。

缓存失效键至少包括：
`SHA256 + KLayout版本 + 解析配置 + Tile Schema Version`。

------------------------------------------------------------------------

# 10. Docker Compose 部署设计

## 10.1 建议服务

  服务         作用                     初始资源上限参考
  ------------ ------------------------ ------------------
  nginx        前端静态文件、反向代理   1 CPU / 512 MiB
  api          FastAPI                  2 CPU / 2 GiB
  parser       KLayout 解析队列         8 CPU / 32 GiB
  renderer     瓦片与区域查询           8 CPU / 16 GiB
  screenshot   PNG 导出                 4 CPU / 8 GiB
  postgres     元数据                   2 CPU / 4 GiB
  redis        Broker/进度              1 CPU / 1 GiB

这只是一个 32 核、128 GiB
级服务器的起始资源预算示例，不是硬件最低要求或性能保证。实际限制必须根据真实文件压测调整。

## 10.2 Docker Compose 示例

以下是服务编排骨架。正式部署需补齐 `.env`
密钥、TLS、备份、日志轮转和镜像版本锁定。

``` yaml
services:
  nginx:
    build:
      context: .
      dockerfile: frontend/Dockerfile
    ports:
      - "8080:80"
    depends_on:
      api:
        condition: service_healthy
    volumes:
      - ./deploy/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    restart: unless-stopped

  api:
    build:
      context: .
      dockerfile: Dockerfile.backend
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
    env_file: .env
    volumes:
      - ./data:/data
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      interval: 20s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    mem_limit: 2g
    cpus: 2

  parser:
    build:
      context: .
      dockerfile: Dockerfile.backend
    command: celery -A app.tasks.celery_app worker -Q parser --concurrency=1 --prefetch-multiplier=1
    env_file: .env
    volumes:
      - ./data:/data
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    mem_limit: 32g
    cpus: 8

  renderer:
    build:
      context: .
      dockerfile: Dockerfile.backend
    command: celery -A app.tasks.celery_app worker -Q renderer --concurrency=1 --prefetch-multiplier=1
    env_file: .env
    volumes:
      - ./data:/data
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    mem_limit: 16g
    cpus: 8

  screenshot:
    build:
      context: .
      dockerfile: Dockerfile.backend
    command: celery -A app.tasks.celery_app worker -Q screenshot --concurrency=1 --prefetch-multiplier=1
    env_file: .env
    volumes:
      - ./data:/data
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    mem_limit: 8g
    cpus: 4

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: layoutstudio
      POSTGRES_USER: layoutstudio
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U layoutstudio -d layoutstudio"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "1gb", "--maxmemory-policy", "noeviction"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

注意： - Compose `mem_limit`、`cpus` 是容器资源上限，不是资源预留。 -
Redis `noeviction`
可避免因内存淘汰静默丢失队列键，但达到上限时写入会失败，必须监控内存和队列。 -
生产环境应固定 PostgreSQL、Redis、Node、Nginx、Python、KLayout
的明确版本和镜像 digest。 - Parser/Renderer/Screenshot 初期各自并发
1，禁止未经压测就提高并发。 - API 上传大文件应走分片协议；Nginx
需配置合理的超时、请求体限制和关闭请求缓冲策略。

## 10.3 后端 Dockerfile 示例

``` dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 libgcc-s1 libgomp1 libpng16-16 zlib1g \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ /app/
COPY workers/ /app/workers/
COPY shared/ /app/shared/

RUN useradd --uid 10001 --create-home appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data

USER 10001
```

`klayout` Python wheel 与基础镜像的 Python ABI、glibc
和系统库必须实测。若官方 wheel
不兼容，应单独构建解析镜像，不要在生产容器启动时临时编译。

## 10.4 前端 Dockerfile 示例

``` dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.28-alpine
COPY --from=build /app/dist /usr/share/nginx/html
```

前端 Nginx 配置应支持 SPA fallback，并将 `/api/` 转发至 API
服务。大文件上传应关闭代理请求缓冲或采用专门上传配置，并设置上传超时。

------------------------------------------------------------------------

# 11. 项目目录结构

``` text
layout-screenshot-studio/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── layout-viewer/
│   │   │   ├── layer-manager/
│   │   │   ├── cell-tree/
│   │   │   └── screenshot/
│   │   ├── renderer/
│   │   │   ├── webgl/
│   │   │   ├── tile-manager/
│   │   │   ├── viewport/
│   │   │   └── coordinate/
│   │   ├── services/
│   │   ├── stores/
│   │   ├── hooks/
│   │   └── types/
│   ├── Dockerfile
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── files.py
│   │   │   ├── layouts.py
│   │   │   ├── layers.py
│   │   │   ├── cells.py
│   │   │   ├── tiles.py
│   │   │   └── screenshots.py
│   │   ├── core/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── tasks/
│   └── requirements.txt
├── workers/
│   ├── parser/
│   ├── renderer/
│   └── screenshot/
├── shared/
│   ├── schemas/
│   ├── coordinate/
│   └── constants/
├── tests/
│   ├── fixtures/
│   ├── unit/
│   ├── integration/
│   ├── performance/
│   └── acceptance/
├── deploy/
│   ├── nginx/
│   ├── postgres/
│   └── scripts/
├── scripts/
│   ├── check_environment.sh
│   ├── check_klayout.py
│   ├── benchmark_layout.py
│   └── acceptance.sh
├── data/
│   ├── uploads/
│   ├── cache/
│   ├── exports/
│   └── logs/
├── compose.yaml
├── Dockerfile.backend
├── .env.example
├── .dockerignore
├── Makefile
└── README.md
```

------------------------------------------------------------------------

# 12. Python 依赖建议

POC 依赖清单起点：

``` text
fastapi
uvicorn[standard]
python-multipart
pydantic
pydantic-settings
celery
redis
sqlalchemy
psycopg[binary]
alembic
Pillow
orjson
klayout==0.30.12
psutil
```

建议正式项目使用锁文件（如 `uv.lock` 或固定版本 requirements），并在 CI
中执行： - Python 版本兼容检查； - KLayout import/read 冒烟测试； -
GDS/OAS 样本解析回归； - 容器镜像漏洞扫描； - 依赖许可证检查。

不能把上述清单视为最终兼容性证明。KLayout Python 包必须在目标 Linux
发行版、CPU 架构和 Python 版本上实际验证。

------------------------------------------------------------------------

# 13. 安全与权限

## 13.1 角色

  角色            权限
  --------------- ----------------------------
  Admin           用户、项目、配额、系统配置
  Project Owner   项目成员、文件、任务管理
  Editor          上传文件、浏览、创建截图
  Viewer          只读浏览和下载有权限的截图

## 13.2 安全要求

-   内网部署优先；跨网访问必须启用 HTTPS。
-   密码使用成熟密码哈希算法，不明文存储。
-   API 统一鉴权和项目级权限检查。
-   上传文件按随机 ID 存储，不使用原始文件名拼接路径。
-   Worker 以非 root 用户运行，容器只挂载必要目录。
-   原始文件只读；解析进程设置 CPU、内存、时间和文件大小限制。
-   限制上传格式、文件大小、并发上传数和单用户存储配额。
-   防止压缩炸弹式资源耗尽、畸形文件触发异常和路径穿越。
-   日志记录任务 ID、文件
    ID、错误码，不记录版图几何明细或不必要的敏感数据。
-   下载链接需鉴权或使用短期签名 URL。
-   对项目删除、原始文件删除和批量导出进行审计。

------------------------------------------------------------------------

# 14. 监控、日志与运维

POC 至少记录：

**主机** - CPU、内存、Swap、磁盘空间、磁盘 IOPS/吞吐； - 文件系统
inode； - Docker 容器资源使用。

**应用** - API 请求量、延迟、错误率； - 上传吞吐、失败率、重传次数； -
Parser 队列长度、解析耗时、峰值 RSS； - Renderer
缓存命中率、瓦片生成耗时； - Screenshot 排队时间、渲染耗时、导出大小； -
PostgreSQL 连接数和慢查询； - Redis 内存、队列长度和拒写事件。

日志使用 JSON 格式，至少包含：
`timestamp, level, service, request_id, task_id, layout_id, user_id, event, duration_ms, error_code`。

建议提供运维命令：

``` bash
docker compose ps
docker compose logs -f api parser renderer screenshot
docker stats
df -h
df -i
free -h
iostat -xz 1
```

------------------------------------------------------------------------

# 15. 性能规划与压测

## 15.1 测试数据分级

  级别           文件规模 目的
  ------ ---------------- ----------------------------
  T0             1～10 MB 功能和几何正确性
  T1          100～500 MB 常规交互性能
  T2         500 MB～2 GB 大文件解析和瓦片性能
  T3       2～5 GB 及以上 极限资源、稳定性和故障恢复

建议覆盖： - 数字标准单元； - SRAM/Memory Array（重点验证
AREF/重复结构）； - Analog/Mixed Signal； - Full-chip； - 同一版图的 GDS
与 OAS 两种格式（若可提供）。

测试数据应确保使用者有权在该平台中处理。不要把受限制的 PDK
或客户版图放入未经批准的测试环境。

## 15.2 测试指标

每次记录： - 文件大小、SHA-256； - KLayout 版本、Python
版本、容器镜像版本； - 解析耗时； - 峰值 RSS； - Cell 数、实例数、Layer
数； - Top Cell bbox； - 首屏瓦片耗时； - 平移/缩放请求耗时； -
区域查询耗时； - 4K 截图耗时、峰值 RSS； - 缓存命中率； - 磁盘读写吞吐。

建议每组至少运行： 1. 冷缓存； 2. 热缓存； 3. 清缓存后重复； 4.
多用户并发。

使用：

``` bash
/usr/bin/time -v python check_klayout.py sample.gds
pidstat -dur 1
iostat -xz 1
docker stats
```

## 15.3 并发初始目标

针对 5～20 人团队，POC 初始目标可设为： - 浏览页面：20～50 个会话； -
并行上传：5～10 个； - 大文件 Parser：1 个； - 中小文件
Parser：压测后再考虑 2 个； - Tile/区域查询：4～8 个并发请求； -
Screenshot：2 个并发任务。

这是测试目标，不是未经压测的承诺。若大文件解析与瓦片查询共享内存，必须通过独立队列和并发上限避免互相挤占资源。

## 15.4 资源预算参考

32 核 / 128 GiB 示例：

  组件                       CPU 上限   内存上限
  ------------------------ ---------- ----------
  Nginx                             1    512 MiB
  API                               2      2 GiB
  Parser                            8     32 GiB
  Renderer                          8     16 GiB
  Screenshot                        4      8 GiB
  PostgreSQL                        2      4 GiB
  Redis                             1      1 GiB
  OS / page cache / 余量         其余       其余

保留足够内存给 Linux page
cache、文件系统缓存和突发任务。不要将物理内存全部分配给容器 limit。

------------------------------------------------------------------------

# 16. 测试与验收标准

  编号   验收项           通过标准
  ------ ---------------- -------------------------------------------
  P01    GDS 导入         文件上传、校验、解析成功
  P02    OAS 导入         文件上传、校验、解析成功
  P03    DBU              与 KLayout 对照一致
  P04    Top Cell         名称和 bbox 一致
  P05    Cell Tree        层次关系与实例数量正确
  P06    AREF             阵列实例数量/变换显示正确
  P07    Layer/Datatype   编号、Datatype、名称一致
  P08    几何类型         Polygon、Box、Path、Text 能正确显示或标识
  P09    图层管理         显隐、颜色、透明度有效
  P10    Viewer           缩放、平移、框选、适配视图正常
  P11    区域查询         与 KLayout 对照结果一致
  P12    PNG 截图         输出尺寸、范围、图层与配置一致
  P13    大文件           T2/T3 样本不导致服务崩溃
  P14    多用户           目标并发下服务可用，任务状态正确
  P15    缓存             缓存键正确，原文件变化后不会误用旧缓存

### 对照方法

-   使用同一原始文件，在 KLayout GUI/脚本和 Web 平台分别打开。
-   对照 DBU、Top Cell、Cell 层次、Layer/Datatype、bbox 和区域查询几何。
-   对 GDS/OAS 等价文件比较结构和坐标，不要求 PNG
    像素完全一致；抗锯齿和渲染器差异可能导致像素差异。
-   对 AREF、旋转、镜像、嵌套 Cell 设计专门测试样本。
-   记录每次验收的输入文件 SHA-256，保证结果可追溯。

------------------------------------------------------------------------

# 17. 开发实施计划

## 第 1 周：解析与基础服务

-   建立仓库、Docker Compose 和基础 CI。
-   集成 KLayout Python API。
-   完成 GDS/OAS 文件读取。
-   完成 DBU、Top Cell、bbox、Cell、Layer 元数据接口。
-   实现分片上传和 SHA-256 校验。
-   建立真实样本解析基线。

**交付：** 可部署的后端、上传流程、解析报告、资源测试数据。

## 第 2 周：Viewer 与图层管理

-   React 页面框架。
-   Cell Tree 和 Layer/Datatype 面板。
-   WebGL 视口、坐标变换、缩放和平移。
-   Tile API、LOD 和缓存。
-   AREF/旋转/镜像层次显示验证。

**交付：** 浏览器可查看真实 GDS/OAS，图层可显隐，支持基本定位。

## 第 3 周：截图与稳定性

-   截图任务表单和任务列表。
-   后端 PNG 渲染、分块拼接。
-   PNG 下载和任务失败重试。
-   权限、日志、配额。
-   T1/T2 压测和 P01～P15 验收。

**交付：** 可供 5～20 人团队试用的 POC。

## 第二阶段建议

-   Calibre DRC/LVS 结果导入和 Marker 可视化；
-   结果数据库（如 RDB）解析；
-   DRC Marker 与版图区域联动；
-   用户自定义截图模板；
-   项目版本对比；
-   SSO/LDAP/AD 集成；
-   Prometheus/Grafana；
-   多节点 Worker 和对象存储。

------------------------------------------------------------------------

# 18. 主要风险与应对

  -------------------------------------------------------------------------------------
  风险                     影响                    应对
  ------------------------ ----------------------- ------------------------------------
  数 GB 文件解析内存过高   Worker OOM              Parser 并发
                                                   1、内存限制、样本压测、OAS
                                                   非编辑模式评估

  Flatten 导致数据膨胀     内存/时间失控           默认保留层次，按视口递归查询

  AREF/旋转/镜像显示错误   几何不一致              建立专项测试样本并对照 KLayout

  Float32 大坐标精度损失   图形抖动/错位           DBU 整数后端、前端局部原点

  浏览器一次加载过多几何   卡顿或崩溃              Tile、LOD、分页、GPU Buffer 管理

  截图任务占用过多资源     影响在线浏览            独立队列、像素上限、并发和超时限制

  上传中断/文件损坏        任务失败                分片重传、SHA-256、会话清理

  缓存与原文件不一致       展示错误                缓存键纳入 SHA-256 和版本

  解析畸形文件             Worker 异常/安全风险    非
                                                   root、容器隔离、资源限制、异常捕获
  -------------------------------------------------------------------------------------

------------------------------------------------------------------------

# 19. POC 启动前检查清单

## 主机

-   [ ] Linux 主机 Docker Engine 与 Compose 插件可用。
-   [ ] 数据盘使用可靠文件系统，容量满足原文件、缓存和导出空间。
-   [ ] `/data` 目录具备正确 UID/GID 权限。
-   [ ] 文件系统剩余空间和 inode 有监控。
-   [ ] 有独立备份策略，至少备份 PostgreSQL 和重要导出文件。

## 软件

-   [ ] Python 与 KLayout wheel ABI 兼容。
-   [ ] KLayout 可读取真实 GDS 样本。
-   [ ] KLayout 可读取真实 OAS 样本。
-   [ ] Docker 镜像版本已锁定。
-   [ ] 前端浏览器支持 WebGL 2.0。

## 数据

-   [ ] 至少一个小型 GDS/OAS 测试文件。
-   [ ] 至少一个 100～500 MB 真实文件。
-   [ ] 至少一个 500 MB～2 GB 真实文件。
-   [ ] 有可核对的 Top Cell、DBU、Layer 和 bbox 预期值。
-   [ ] 测试数据已获得内部使用授权。

## 验收

-   [ ] P01～P15 验收用例已建立。
-   [ ] 冷/热缓存性能数据已记录。
-   [ ] Parser、Renderer、Screenshot 的资源上限已验证。
-   [ ] 20 人浏览、5～10 个并发上传的目标完成压测。

------------------------------------------------------------------------

# 20. 结论与推荐实施路径

建议以 **KLayout + FastAPI + Celery + Redis + PostgreSQL + React/WebGL +
Docker Compose** 作为 POC 技术栈。

项目最关键的技术难点不是普通 Web 页面，而是： 1. KLayout 对真实 GDS/OAS
大文件的读取和资源消耗； 2. 不 Flatten 的层次化几何查询，尤其是
AREF、旋转、镜像； 3. Tile/LOD 机制能否将数 GB
数据转化为浏览器可承受的增量数据； 4. 后端 PNG 截图是否能与 Viewer
的坐标、图层和显示配置保持一致。

因此第一阶段应先拿真实文件完成解析与性能基线，再投入完整 Viewer
开发。不要先做复杂 UI，再发现解析路径或大文件资源模型不可行。

**推荐的 POC 里程碑：** 先实现"上传一个真实 GDS/OAS → 解析元数据 → 浏览
Top Cell/Layer → 显示一个区域 → 导出一张
PNG"的端到端闭环。该闭环通过后，再扩展多人并发、完整 Cell
Tree、LOD、批量截图和 Calibre 结果联动。
