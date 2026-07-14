# ShennongDB 生产化修复：Codex 主提示词与任务清单

> 归档说明：这是 v0.1 阶段的实施任务清单，不是当前开发指令或产品文档。
> 当前验证入口见 `docs/production-hardening.md` 和 `scripts/test-platform.sh`。

> 适用仓库：`zerostwo/shennong-db`  
> 审阅基线：`main@f6f844157f6974b19cdfbd63aaa68539615ecbcb`  
> 说明：仓库可能继续更新。每次执行任务前，Codex 必须重新检查当前 HEAD 和现有实现，不得机械套用本文件中的旧代码位置。

---

## 1. 使用方式

本文件是一个**逐项执行的主提示词**，不要让 Codex 一次完成所有任务。

每次只给 Codex 一个任务，例如：

```text
请读取 docs/archive/CODEX_PRODUCTION_HARDENING_PROMPT.md，并仅执行 TASK_ID=P0-01。

要求：
1. 先检查当前代码，确认问题是否仍存在。
2. 只处理 P0-01，不得顺手进入后续任务。
3. 添加或更新自动化测试。
4. 运行该任务要求的测试和全局质量检查。
5. 使用 Conventional Commit。
6. 最后报告：改动文件、设计决策、测试结果、剩余风险和提交 SHA。
```

推荐执行顺序：

```text
P0-00
P0-01
P0-02
P0-03
P0-04
P0-05
P0-06
P1-01
P1-02
P1-03
P1-04
P1-05
P1-06
P1-07
P1-08
P2-01
P2-02
P2-03
```

---

# 2. Codex 的角色与总目标

你是 ShennongDB 的资深 Rust、数据库、对象存储和生物信息基础设施工程师。

你的任务是将当前单机一体化原型逐步加固为可用于正式生产环境的数据基础设施，同时保持以下核心设计：

```text
Client / R / Agent
        ↓
Shennong HTTP API
        ↓
Resource / Artifact / Relation 语义层
        ↓
PostgreSQL / ClickHouse / TileDB / Local FS / S3-compatible storage
```

当前系统的主要职责是：

- 管理生物信息数据集的元数据和版本；
- 保存 Resource、Artifact 和 Relation；
- 对 bulk RNA-seq、single-cell 等数据提供有边界的查询；
- 保留数据来源、校验和、注释版本和派生关系；
- 支持本地或云端对象存储；
- 为 R 客户端和 AI agent 提供稳定、可审计的 API。

不要把 ShennongDB 改造成工作流引擎、通用计算平台或聊天系统。

---

# 3. 当前架构背景

当前 Rust workspace 包含：

```text
crates/shennong-schema
crates/shennong-core
crates/shennong-storage
crates/shennong-query
crates/shennong-auth
crates/shennong-server
crates/shennong-cli
```

当前部署包含：

- Axum HTTP API；
- PostgreSQL 元数据、用户、grant 和 audit；
- ClickHouse 表达查询缓存；
- TileDB 稀疏单细胞矩阵；
- 本地 Artifact 文件；
- Provider YAML；
- 单镜像、单 Compose service 的部署形式。

当前主机数据目录通常为：

```text
/data
├── pbmc          # PBMC 原始 10x HDF5 示例文件
├── resources     # Provider 下载或生成的主数据和索引
├── tiledb        # TileDB 派生数组
└── clickhouse    # ClickHouse 缓存数据
```

PostgreSQL 当前使用单独的 Docker named volume。

必须明确以下事实：

1. ClickHouse 当前主要是缓存，不是所有数据的唯一事实来源。
2. Toil 当前仍依赖本地 indexed TSV、phenotype 和 survival 文件。
3. PBMC 查询可使用 TileDB，但原始 HDF5 仍应作为可审计、可重建的 raw Artifact 保存。
4. “转换进数据库”不代表可以删除所有原始数据。
5. 未来需要支持通用 S3-compatible 对象存储。
6. 本地对象存储可以由 Compose 提供 SeaweedFS，但业务代码不得绑定 SeaweedFS 私有接口。
7. 不要引入 MinIO 作为新的默认生产依赖。

---

# 4. 全局工程规则

每个任务都必须遵守以下规则。

## 4.1 一次只完成一个任务

- 仅执行指定的 `TASK_ID`。
- 不得自动进入下一个任务。
- 可以做完成当前任务所必需的小范围重构。
- 不要混入无关格式化、重命名或目录重构。
- 如果前置任务尚未完成并阻塞当前任务，应停止修改并明确报告依赖。

## 4.2 先验证问题是否仍存在

修改前必须：

```bash
git status --short
git rev-parse HEAD
git log -5 --oneline
rg "<相关符号或代码>" .
```

需要阅读相关 crate、测试、迁移、Compose、Dockerfile 和文档。

如果问题已经被其他提交完整修复：

- 不要重复实现；
- 检查测试和文档是否覆盖；
- 给出证据；
- 必要时只补充缺失的回归测试。

## 4.3 数据安全

禁止：

- 删除或覆盖真实 `/data`；
- 删除 PostgreSQL named volume；
- 在测试中复用生产数据目录；
- 静默删除 raw Artifact；
- 修改生产文件而不保留版本、校验和和 provenance；
- 在失败路径中把 Resource 标记为 `available`；
- 把 secret、token、Authorization header 或对象存储凭据写入日志。

测试必须使用：

- 临时目录；
- 临时数据库；
- 专用 test bucket；
- 临时 Docker volume。

## 4.4 API 兼容性

除非任务明确要求 breaking change：

- 保持现有 `/api/v1` 路由兼容；
- 保持现有 JSON 基本结构兼容；
- 不破坏外部 `ShennongData` R 客户端；
- 新字段优先使用可选字段和向后兼容默认值；
- 数据库变更使用迁移；
- breaking change 必须写入 `CHANGELOG.md` 和迁移说明。

## 4.5 Rust 代码要求

优先使用：

- 强类型 enum，而不是自由字符串；
- `thiserror` 定义内部错误；
- 稳定、可序列化的公共错误代码；
- `tracing` 结构化日志；
- 共享、配置过 timeout 的 `reqwest::Client`；
- `tokio::time::timeout`；
- `tokio::sync::Semaphore`；
- 流式 I/O；
- 原子临时文件加 rename；
- 显式大小和并发边界。

避免：

- 在异步 handler 中调用阻塞式 `std::process::Command::output()`；
- `tokio::fs::read()` 读取大型 Artifact；
- 整文件 `Vec<u8>` 对象存储接口；
- 未设超时的网络请求；
- fail-open 权限判断；
- 将内部路径或后端错误直接返回客户端。

## 4.6 每项任务的最低质量检查

默认运行：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

若仓库当前不支持某个参数，先说明原因，再运行最接近的完整检查。

涉及 Docker 时还需运行：

```bash
docker compose config
docker build --pull -t shennong-db:test .
```

涉及运行时集成时，应提供可重复执行的测试脚本或 `docker-compose.test.yml`。

## 4.7 提交规则

每个任务使用一个聚焦的 Conventional Commit，例如：

```text
fix(auth): fail closed on invalid resource visibility
fix(api): stream artifact downloads
refactor(ingest): make provider installation atomic
feat(storage): add s3-compatible object storage
```

提交前检查：

```bash
git diff --check
git status --short
git diff --stat
```

不要把生成文件、真实数据、`.env`、secret、缓存或大型测试文件提交进仓库。

---

# 5. 每个任务结束时必须输出

Codex 的最终报告必须包含：

```text
TASK_ID:
状态: completed / blocked / already-fixed / partially-completed

问题确认:
- 原问题是否仍存在
- 证据和相关文件

实现:
- 核心设计
- 修改文件
- 数据库迁移或配置变化
- API 兼容性影响

测试:
- 新增测试
- 实际运行的命令
- 每个命令的结果

安全:
- 已关闭的攻击面
- 仍存在的风险

运维:
- 是否需要配置变更
- 是否需要数据迁移
- 回滚方式

提交:
- Conventional Commit 标题
- commit SHA
```

不能只说“已修复”，必须给出测试证据。

---

# 6. 任务清单

---

## TASK_ID=P0-00：建立生产加固回归测试基线

**优先级：P0**  
**依赖：无**

### 目标

在开始安全和架构重构前，建立可重复的质量基线，防止后续修复破坏现有功能。

### 工作范围

1. 记录当前 workspace 的：
   - 编译状态；
   - 单元测试状态；
   - clippy 状态；
   - Docker build 状态；
   - Compose 配置状态。
2. 补充最小集成测试框架，覆盖：
   - `/health`；
   - `/healthz`；
   - public Resource 读取；
   - private Resource 未授权返回 404；
   - admin 写操作；
   - bounded query；
   - Artifact 本地路径 root 检查。
3. 所有集成测试必须使用临时数据和隔离 volume。
4. 不在此任务中改变业务行为。

### 验收标准

- CI 或本地脚本可以一条命令运行基础回归测试。
- 测试失败时退出码非 0。
- 不要求真实 9 GB Toil 数据。
- 不要求真实 PBMC 数据。
- 提供小型 fixture 模拟 Resource、Artifact 和查询。
- 文档说明如何运行。

### 建议提交

```text
test(platform): add production hardening regression baseline
```

---

## TASK_ID=P0-01：将 Resource 授权改为 fail-closed

**优先级：P0**  
**依赖：P0-00**

### 当前风险

当前权限逻辑只把精确的 `"private"` 当作私有。缺失值、拼写错误或未知值可能被视为公开。

### 目标

实现明确、强类型、默认私有的授权模型。

### 要求

1. 为 visibility 定义强类型：
   - `public`
   - `private`
2. 创建或更新 Resource 时：
   - 缺失 visibility 时默认 `private`；
   - 未知值返回 422；
   - `permissions.read_scopes` 必须是合法字符串数组。
3. 授权政策：
   - `public`：guest 可读；
   - `private`：仅 active admin，或 active user 同时具有显式 grant 和所需 scope；
   - 无效或无法解析权限：拒绝访问，不得公开。
4. admin 的 `*` scope 可以匹配所有 scope。
5. 保留“无权限私有资源返回 404”的防枚举行为。
6. Resource list、details、artifacts、relations、download、query、gene resolve、agent discovery 必须采用同一套授权判断。
7. 为旧数据库数据提供兼容迁移或启动校验：
   - 不得把未知值自动改成 public；
   - 可将未知值迁移成 private，并记录 warning/audit。
8. 更新 seed/provider：
   - 公开示例必须显式写 `"visibility":"public"`；
   - 新 Resource 默认 private。

### 必须测试

- missing visibility 不公开；
- typo visibility 不公开且写入被拒绝；
- public guest 可读；
- private guest 返回 404；
- private user 无 grant 返回 404；
- private user 有 grant 但 scope 不足返回 404；
- private user 有 grant 且 scope 足够可读；
- disabled user 不可读；
- admin 可读；
- 所有相关路由一致。

### 验收标准

代码中不存在通过：

```text
visibility != "private"
```

实现授权的逻辑。

### 建议提交

```text
fix(auth): fail closed on invalid resource visibility
```

---

## TASK_ID=P0-02：流式下载 Artifact，并支持 HTTP Range

**优先级：P0**  
**依赖：P0-00**

### 当前风险

大型 Artifact 可能通过整文件读取进入内存，导致 OOM 和拒绝服务。

### 目标

任何大小的本地 Artifact 都通过流式方式返回，不把完整文件载入内存。

### 要求

1. 删除大型下载路径中的：
   - `tokio::fs::read(path)`；
   - `Body::from(Vec<u8>)`。
2. 实现流式 GET。
3. 支持：
   - `Content-Length`；
   - `Accept-Ranges: bytes`；
   - 单 Range 请求；
   - `206 Partial Content`；
   - `Content-Range`；
   - 无效 Range 返回 `416`。
4. 可选增加 `HEAD`。
5. 在打开文件前完成 Resource 和 Artifact 授权检查。
6. Artifact 路径继续执行 canonicalization 和 data root 边界检查。
7. 设置下载并发上限和可配置超时。
8. 文件名用于 `Content-Disposition` 时必须安全编码，禁止 header injection。
9. 不泄漏实际主机路径。
10. 为未来 S3/presigned URL 保留统一接口，但本任务不要提前实现完整 S3。

### 必须测试

- 完整小文件下载；
- 大于测试内存预算的模拟文件仍流式；
- 第一段、中间段、末尾 Range；
- 无效 Range；
- 私有 Artifact 鉴权；
- 路径逃逸拒绝；
- 并发限制；
- 客户端断开不会导致进程异常。

### 验收标准

- 下载路径内没有整文件 `Vec<u8>`。
- 可以用 `curl -r` 正确读取指定区间。
- 测试可证明响应是流式的。

### 建议提交

```text
fix(api): stream artifact downloads with range support
```

---

## TASK_ID=P0-03：限制查询资源，并安全管理 TileDB 子进程

**优先级：P0**  
**依赖：P0-00**

### 当前风险

每次 TileDB 查询同步创建 Python 进程，缺少超时、并发上限和可靠终止，可能耗尽 Tokio worker、PID、CPU 和内存。

### 目标

在保留当前 Python backend 的前提下，先消除无边界子进程和网络调用。

### 要求

1. 不得在异步 handler 中直接使用阻塞式：
   - `std::process::Command::output()`。
2. 优先使用：
   - `tokio::process::Command`；
   - `kill_on_drop(true)`；
   - `tokio::time::timeout`；
   - 共享 `Semaphore`。
3. TileDB 查询、resolve 和 describe 都必须：
   - 有超时；
   - 有并发上限；
   - 超时后终止子进程；
   - 限制 stdout/stderr 最大字节；
   - 不把完整 stderr 返回客户端。
4. ClickHouse 和其他 HTTP backend：
   - 使用共享 `reqwest::Client`；
   - 配置 connect timeout；
   - 配置 request timeout；
   - 配置合理连接池。
5. 查询限制至少包括：
   - 最大 rows；
   - 最大响应字节；
   - 最大 feature 名长度；
   - 最大 context 字段数和字符串长度。
6. 公开错误只返回稳定错误 code 和 request ID。
7. 详细后端错误只写结构化服务端日志。
8. 保留现有 API 基本响应结构。

### 必须测试

- 正常 Python 子进程；
- 超时进程被终止；
- 非零退出码；
- 超长 stdout；
- 超长 stderr；
- 并发超限；
- ClickHouse 超时；
- 错误响应不包含 `/data`、Python traceback 或内部命令。

### 验收标准

- 不再存在无超时的每请求阻塞子进程。
- 不再向客户端直接返回后端 stderr。
- 并发上限可通过环境变量或配置设置。

### 建议提交

```text
fix(query): bound backend execution and sanitize errors
```

---

## TASK_ID=P0-04：实现可靠的 ingestion 状态机和事务一致性

**优先级：P0**  
**依赖：P0-00**

### 当前风险

Resource 可能先被标为 `available`，但 Artifact 尚未全部写入；seed 也可能声明不存在的数据可用。

### 目标

Resource 的可用状态必须反映真实、完整、已验证的数据状态。

### 要求

1. 定义 ingestion 状态：
   - `registered` 或 `pending`；
   - `downloading`；
   - `verifying`；
   - `materializing`；
   - `available`；
   - `failed` 或 `unavailable`。
2. 如果不希望扩大 `Resource.status`，可增加独立 ingestion job 表，但最终查询必须只接受完整可用 Resource。
3. Provider 安装流程：
   - 创建 job；
   - 在 staging 下载；
   - 校验所有文件；
   - 生成所有派生物；
   - 原子发布对象或文件；
   - 使用 PostgreSQL transaction 写 Resource、Artifact、Relation；
   - 最后标记 `available`。
4. 任何中途失败：
   - 不得留下 `available` 的半成品；
   - job 记录错误类别；
   - 清理安全的 `.part` 文件；
   - 保留可恢复的 raw 下载时需明确状态。
5. 同一 Provider/version 防止并发重复安装：
   - advisory lock、数据库唯一约束或幂等 job key。
6. query、download 和 agent discovery 必须拒绝非 available Resource。
7. 修复 seed 与实际路径不一致问题。
8. PBMC 源 HDF5 或 TileDB 不存在时，不得显示为 available。
9. ingestion HTTP 请求不应长期占用连接：
   - 返回 job ID；
   - 可轮询状态；
   - 如果本任务范围过大，至少先实现事务和状态一致性，再记录异步 worker 为后续任务。

### 必须测试

- 第二个文件失败；
- DB upsert 中途失败；
- materialization 失败；
- 重复安装；
- 服务重启后恢复；
- seed 指向不存在路径；
- 非 available query；
- 成功安装后 Resource 与全部 Artifact 同时可见。

### 验收标准

不存在：

```text
Resource available + 缺失必要 Artifact
```

的可观测状态。

### 建议提交

```text
refactor(ingest): make resource installation atomic
```

---

## TASK_ID=P0-05：强制数据完整性并限制安全解压

**优先级：P0**  
**依赖：P0-04**

### 当前风险

部分大型 raw 文件没有 checksum；gzip 解压在完成后才检查大小，可能耗尽磁盘；下载后的原始压缩文件可能被删除。

### 目标

建立可审计、可验证、可恢复的 raw ingestion。

### 要求

1. Provider raw 文件在 production mode 必须有：
   - SHA-256；
   - 下载大小；
   - 解压后大小（适用时）；
   - 来源 URL；
   - 版本；
   - 获取时间。
2. 如果上游无法提供 checksum：
   - 不得假装已验证；
   - 使用明确的 `integrity_status=unverified`；
   - production 默认拒绝；
   - 只有显式 dev 配置可以允许。
3. 下载：
   - 流式计算 SHA-256；
   - 限制实际下载字节；
   - 校验 HTTP status、Content-Length（若提供）；
   - 使用 `.part`；
   - 完成后 fsync/rename。
4. gzip 解压：
   - 流式解压；
   - 边写边计算 canonical checksum；
   - 超过声明的 uncompressed size 立即终止；
   - 设置磁盘空间预检；
   - 设置超时；
   - 不调用无输出上限的外部 gzip，或为外部进程实现严格输出限制。
5. raw 压缩对象必须保留，不再在成功解压后直接删除。
6. raw、canonical 和 index 分别注册 Artifact，并通过 provenance/derived_from 关联。
7. 校验失败不得发布为 available。
8. 校验和比较使用固定格式和可靠实现。

### 必须测试

- checksum 匹配；
- checksum 不匹配；
- Content-Length 欺骗；
- 下载超过上限；
- gzip bomb；
- 解压后大小不足；
- 磁盘不足；
- 中断后 resume；
- raw 保留；
- canonical checksum 被记录。

### 验收标准

- production Provider 不再接受无校验 raw 文件。
- 解压输出存在硬上限。
- raw Artifact 不因物化成功而消失。

### 建议提交

```text
fix(ingest): verify raw artifacts and bound decompression
```

---

## TASK_ID=P0-06：加固 HTTP 边界、中间件和公开错误

**优先级：P0**  
**依赖：P0-01、P0-02、P0-03**

### 当前风险

CORS 过宽，缺少统一 body limit、请求超时、限流、安全 headers 和错误脱敏。

### 目标

为互联网或反向代理后的生产部署建立明确的 HTTP 安全边界。

### 要求

1. 替换 permissive CORS：
   - 使用配置的 origin allowlist；
   - production 没有 allowlist 时默认不允许跨域；
   - 限制 methods 和 headers；
   - 不随意允许 credentials。
2. 增加：
   - request ID；
   - request timeout；
   - body size limit；
   - global concurrency limit；
   - per-IP 和/或 per-principal rate limit；
   - query 与 download 独立限额。
3. 增加安全 headers：
   - `X-Content-Type-Options: nosniff`；
   - 合理的 `Referrer-Policy`；
   - API 场景合适的 CSP；
   - 由 TLS proxy 配置 HSTS，或在确认 TLS 后启用。
4. 公开错误：
   - 稳定 `code`；
   - 简短 message；
   - request ID；
   - 不含数据库 SQL、文件路径、traceback、secret。
5. `/api/v1/providers`：
   - 公共响应不得暴露敏感下载 URL 或内部配置；
   - 完整 Provider manifest 仅管理员可读，或提供脱敏版本。
6. 为健康检查保留合理豁免，但避免成为昂贵探测入口。
7. 配置项加入 `.env.example` 和文档。

### 必须测试

- 非 allowlist Origin；
- allowlist Origin；
- 超大 body；
- 请求超时；
- rate limit；
- query 并发；
- request ID；
- 错误脱敏；
- Provider 信息脱敏。

### 验收标准

- production 不再使用 `CorsLayer::permissive()`。
- 所有公开错误遵循统一 schema。
- 重要路由具备明确资源边界。

### 建议提交

```text
fix(api): harden http middleware and public errors
```

---

## TASK_ID=P1-01：重构为流式 BlobStore 抽象

**优先级：P1**  
**依赖：P0-02、P0-04**

### 当前问题

当前对象存储接口只提供整文件 `read() -> Vec<u8>` 和 `write(&[u8])`，无法安全处理大型本地或 S3 对象。

### 目标

建立与物理 backend 无关的、流式、Range-aware 的存储抽象，同时保持 Local FS 可用。

### 设计要求

建议至少支持：

```rust
head
get_stream
get_range
put_stream
delete
exists
copy_or_promote
presign_get
```

返回元数据至少包括：

```text
size
etag
sha256（如果已知）
content_type
last_modified
version_id（backend 支持时）
```

### 要求

1. 引入强类型：
   - `ArtifactUri`；
   - `ObjectKey`；
   - `ByteRange`；
   - `ObjectMeta`。
2. 支持 URI：
   - `file://` 或受控 local URI；
   - `s3://bucket/key`。
3. 禁止任意主机绝对路径成为客户端可控输入。
4. Local FS backend：
   - 流式读写；
   - Range；
   - 原子 publish；
   - root containment；
   - symlink/path traversal 防护。
5. 修改现有 query、download 和 ingestion，使其依赖 trait，而不是直接使用 `tokio::fs::read()`。
6. 暂时可保留兼容 adapter，但主路径不能整文件进入内存。
7. 对不支持的 presign 功能返回强类型能力错误。

### 必须测试

- Local full stream；
- Local range；
- atomic put；
- path traversal；
- symlink escape；
- interrupted put；
- large fixture；
- URI parse；
- backend capability。

### 验收标准

核心服务不再依赖仅能返回 `Vec<u8>` 的对象存储接口。

### 建议提交

```text
refactor(storage): add streaming blob store interface
```

---

## TASK_ID=P1-02：定义 raw、canonical、derived、cache 和 staging 生命周期

**优先级：P1**  
**依赖：P1-01**

### 目标

明确哪些数据必须永久保留，哪些数据可重建，哪些数据可以清理，避免“导入数据库后删除原始数据”的错误模型。

### 数据分类

```text
raw
canonical
derived
cache
staging
```

### 要求

1. Schema 中为 Artifact 增加或规范：
   - `data_class`；
   - `immutable`；
   - `content_sha256`；
   - `source_uri`；
   - `derived_from`；
   - `pipeline_version`；
   - `created_at`；
   - `retention_policy`；
   - `storage_backend`；
   - `storage_uri`。
2. raw：
   - 内容寻址；
   - 默认不可覆盖；
   - 必须有 checksum；
   - 不因派生数据生成而删除。
3. canonical：
   - 标准化但尽量无损；
   - 保留转换工具和版本；
   - 新转换产生新版本。
4. derived：
   - TileDB、索引、Parquet、embedding 等；
   - 必须指向 raw/canonical；
   - 可重建。
5. cache：
   - 明确可删除；
   - 不作为唯一事实来源。
6. staging：
   - 有过期和清理规则；
   - 不出现在可用 Resource catalog。
7. 数据库迁移必须兼容现有 Artifact。
8. 增加数据布局文档和恢复规则。
9. 不在本任务中删除现有文件。

### 推荐对象布局

```text
raw/<resource>/<version>/<sha256>/<filename>
canonical/<resource>/<version>/<pipeline-digest>/<filename>
derived/<resource>/<version>/<pipeline-digest>/<filename>
staging/<ingestion-id>/<filename>.part
```

### 必须测试

- raw 不可覆盖；
- 相同 checksum 幂等；
- 不同内容产生不同 key；
- derived lineage；
- staging 不公开；
- 旧 Artifact 迁移；
- cache 删除不影响 Resource 主数据。

### 建议提交

```text
feat(storage): model artifact lifecycle and provenance
```

---

## TASK_ID=P1-03：增加通用 S3-compatible backend 和本地 SeaweedFS profile

**优先级：P1**  
**依赖：P1-01、P1-02**

### 目标

ShennongDB 可以选择：

- 本地文件系统；
- 本地 S3-compatible 服务；
- 云端 S3-compatible 服务；

而无需修改业务 API 或 Provider 语义。

### 要求

1. 实现 S3-compatible BlobStore：
   - streaming GET；
   - Range GET；
   - streaming/multipart PUT；
   - HEAD；
   - delete；
   - presigned GET；
   - endpoint override；
   - region；
   - path-style；
   - bucket；
   - retry；
   - connect/request timeout。
2. 配置支持：
   - `SHENNONG_S3_ENDPOINT`；
   - `SHENNONG_S3_REGION`；
   - `SHENNONG_S3_FORCE_PATH_STYLE`；
   - raw/derived/staging bucket；
   - credential file；
   - 环境变量凭据仅用于开发兼容。
3. 不把 secret 输出到日志或错误。
4. Artifact backend 接受 `s3`。
5. 下载：
   - 小对象可由 API stream；
   - 大对象优先返回短期 presigned URL，策略必须可配置；
   - 授权必须在生成 URL 前完成。
6. 本地 Compose 增加可选 profile：
   - SeaweedFS；
   - 独立 service；
   - 独立 volume；
   - 不暴露到公网；
   - 固定镜像版本或 digest；
   - 不使用 `latest`。
7. 业务代码只依赖标准 S3 行为，不依赖 SeaweedFS 专有 API。
8. 不引入 MinIO。
9. 为 S3 契约增加集成测试：
   - multipart；
   - range；
   - presign；
   - checksum/etag；
   - 中断重试；
   - 大对象；
   - Unicode key；
   - path-style endpoint。

### 验收标准

同一组 Artifact 测试可在 Local FS 和 SeaweedFS S3 backend 上通过。

### 建议提交

```text
feat(storage): add s3-compatible artifact backend
```

---

## TASK_ID=P1-04：让 Toil 查询使用 Range-aware 索引和对象存储

**优先级：P1**  
**依赖：P1-03**

### 当前问题

当前行索引只记录起始 offset，本地文件可 seek/read_line，但 S3 需要明确字节区间；metadata 文件也可能在每次查询时整文件读取。

### 目标

Toil 单基因查询无需下载或扫描完整 9 GB 矩阵，并可在 Local FS 和 S3 上使用同一查询路径。

### 要求

1. 索引记录：
   - feature；
   - byte offset；
   - byte length；
   - canonical Artifact checksum；
   - index schema version。
2. header 单独保存或索引中记录可安全读取的 header range。
3. 查询流程：
   - 读取 header；
   - Range GET 指定基因行；
   - 验证行 feature；
   - 解析 bounded sample rows。
4. index 必须与矩阵 checksum 绑定，防止索引错配。
5. sample metadata、survival 和 gene map：
   - 不得每请求无边界整文件读；
   - 可建立索引、Parquet/SQLite 派生物或有界缓存；
   - 选择方案并记录理由。
6. 保持当前 Query API。
7. Local FS 和 S3 返回一致结果。
8. 保留原始 versioned Ensembl ID 和 provenance。
9. 为旧 offset-only index 提供升级或明确拒绝。

### 必须测试

- 首行、中间行、末行；
- 不存在 gene；
- checksum mismatch；
- truncated range；
- Local 与 S3 一致；
- context join；
- survival join；
- 并发；
- 响应 limit。

### 验收标准

单基因查询的数据读取量与目标行大小相关，而不是与整个矩阵大小相关。

### 建议提交

```text
perf(query): read indexed expression rows by byte range
```

---

## TASK_ID=P1-05：移除 PBMC 文件名硬编码，改为通用 Provider ingestion

**优先级：P1**  
**依赖：P0-04、P1-02**

### 当前问题

entrypoint 了解 PBMC 1k/3k/4k 的具体文件名和路径，导致运行时与示例数据集耦合。

### 目标

容器启动只启动服务，不负责硬编码地物化具体数据集。

### 要求

1. 从 entrypoint 移除 PBMC 固定文件循环。
2. 使用 Provider manifest 或 ingestion job 描述：
   - 10x HDF5 source；
   - TileDB target；
   - Resource ID/version；
   - checksum；
   - schema；
   - materializer。
3. PBMC 1k/3k/4k 可继续作为示例 Provider，但不再是系统特殊代码。
4. seed 不能在数据不存在时标记 available。
5. materialization：
   - 幂等；
   - 状态可追踪；
   - 失败不发布；
   - 可以重建；
   - 记录工具和 TileDB 版本。
6. 启动 API 时不自动处理大型数据。
7. 文档明确：
   - 如何安装 PBMC Provider；
   - raw 存在哪里；
   - TileDB derived 存在哪里；
   - 如何重建。

### 必须测试

- 无 PBMC 文件正常启动；
- 安装自定义 10x Provider；
- 相同 Provider 重试；
- HDF5 损坏；
- TileDB materialization 失败；
- 不存在数据不显示 available。

### 验收标准

`entrypoint.sh` 和 server startup 中不存在 PBMC 专用文件名。

### 建议提交

```text
refactor(ingest): move pbmc materialization into providers
```

---

## TASK_ID=P1-06：将 TileDB 查询改为长驻 backend

**优先级：P1**  
**依赖：P0-03、P1-05**

### 目标

移除“每个请求启动一个 Python 进程”的运行模式。

### 可选方案

优先顺序：

1. Rust TileDB binding；
2. 长驻 Python worker，通过 Unix socket/gRPC/HTTP 内部接口；
3. 受控进程池。

必须在 ADR 中比较方案后选择。

### 要求

1. backend 长驻并提供：
   - query；
   - resolve；
   - describe；
   - health。
2. 明确并发模型和内存边界。
3. API 与 backend 之间有：
   - timeout；
   - cancellation；
   - 最大请求/响应；
   - 稳定错误 code。
4. 避免每请求重新加载 feature IDs、names、barcodes 全量 metadata。
5. 支持优雅关闭和健康检查。
6. 对多个 TileDB Resource 安全复用。
7. 更新部署和测试。
8. 保留现有公开 Query API。

### 必须测试

- 并发查询；
- worker 重启；
- backend timeout；
- malformed request；
- 大 metadata；
- graceful shutdown；
- API backend unavailable；
- 结果与旧实现一致。

### 验收标准

正常查询路径不再创建 Python OS 进程。

### 建议提交

```text
refactor(tiledb): use a persistent query backend
```

---

## TASK_ID=P1-07：拆分正式生产服务并实现最小权限

**优先级：P1**  
**依赖：P1-03、P1-06**

### 当前问题

API、PostgreSQL、ClickHouse、Python 和 TileDB 处于同一容器和相同 Unix 用户边界，单点故障和横向影响较大。

### 目标

保留简单开发部署，同时提供正式生产 Compose 拓扑。

### 生产服务建议

```text
reverse-proxy
shennong-api
shennong-worker
postgres
clickhouse
object-store
tiledb-backend
```

可以根据 P1-06 的最终方案调整。

### 要求

1. API：
   - 非 root；
   - read-only root filesystem；
   - `no-new-privileges`；
   - `cap_drop: ALL`；
   - 独立 service account；
   - 不挂载 PostgreSQL/ClickHouse 数据目录。
2. PostgreSQL：
   - 不使用 trust 作为跨容器认证；
   - 强密码或 secret；
   - 只在内部网络；
   - 独立 volume；
   - 健康检查。
3. ClickHouse：
   - 独立用户和密码；
   - 只在内部网络；
   - 独立 volume；
   - cache 可清理。
4. 对象存储：
   - 独立 service/volume；
   - 不公开管理端口；
   - 使用 secret。
5. ingress：
   - TLS 终止；
   - body limit；
   - access log 脱敏；
   - proxy timeout。
6. Compose：
   - 固定版本或 digest；
   - resource limit；
   - restart policy；
   - healthcheck；
   - internal network；
   - 不使用 `latest`。
7. 保留开发模式，但 production profile 不得把数据引擎嵌入 API 容器。
8. 提供从旧单容器 volume 迁移的文档和脚本。
9. 回滚时数据不丢失。

### 必须测试

- 全新安装；
- 旧部署迁移；
- API 重启不影响数据库；
- ClickHouse 缓存丢失后可恢复；
- object store 不可用；
- PostgreSQL 不可用；
- secret 不出现在 `docker inspect` 的普通环境变量中（尽量使用 secrets）；
- 非 root 验证。

### 验收标准

正式 production Compose 中，API 不再与 PostgreSQL 和 ClickHouse 共用同一容器或数据目录。

### 建议提交

```text
refactor(deploy): split production data services
```

---

## TASK_ID=P1-08：为 ClickHouse 缓存增加生命周期和容量控制

**优先级：P1**  
**依赖：P0-00**

### 目标

明确 ClickHouse 是可丢弃缓存，并防止其无限增长。

### 要求

1. 为 cache 表设计：
   - 合理 partition；
   - TTL；
   - cache key；
   - version；
   - created/cached timestamp。
2. Provider 或 Artifact 版本变化时使旧缓存失效。
3. 增加最大容量或配额策略。
4. 对相同 miss 使用 single-flight，防止并发重复填充。
5. 缓存写失败不应让主查询失败，除非配置要求。
6. 提供：
   - clear by Resource/version；
   - cache stats；
   - hit/miss 指标。
7. 创建可升级的 ClickHouse migration，而不是只在 entrypoint 拼接建表 SQL。
8. 文档明确 ClickHouse 数据不需要作为 raw 备份。

### 必须测试

- cache hit/miss；
- TTL；
- version invalidation；
- 并发 miss；
- ClickHouse 不可用时 fallback；
- clear；
- 容量边界。

### 验收标准

缓存有可配置过期策略，并可在删除后从主数据重建。

### 建议提交

```text
fix(cache): bound clickhouse cache lifecycle
```

---

## TASK_ID=P2-01：完善管理员密钥、JWT、scope 和撤销机制

**优先级：P2**  
**依赖：P0-01**

### 目标

将静态管理员 key 降级为 bootstrap/紧急机制，并为 JWT 建立可审计的生命周期。

### 要求

1. 启动配置：
   - production 缺失 secret 时拒绝启动；
   - 检查最小熵/长度；
   - 支持 Docker secret `_FILE`；
   - 不输出 secret。
2. admin key：
   - constant-time compare；
   - 可禁用；
   - 可轮换；
   - 最好只用于 bootstrap 或 break-glass；
   - 使用时 audit 中记录明确 actor 类型，而不是无信息的 null。
3. JWT claims：
   - `sub`；
   - `exp`；
   - `iat`；
   - `jti`；
   - `iss`；
   - `aud`；
   - scopes；
   - 可选 `nbf`。
4. 验证：
   - issuer；
   - audience；
   - expiration；
   - algorithm allowlist；
   - clock skew；
   - active user；
   - revoked jti。
5. token 数据库只保存安全 hash/identifier，不保存明文 token。
6. 增加：
   - revoke token；
   - list active tokens；
   - key rotation 策略；
   - 可选短期 access token。
7. 每个路由真正 enforce scope。
8. Token 不进入 URL、日志和 audit metadata。
9. 不破坏 disabled user 立即失效语义。

### 必须测试

- weak/missing secret；
- wrong issuer/audience；
- expired；
- revoked；
- disabled user；
- scope 不足；
- key rotation；
- admin key disabled；
- token 不出现在日志。

### 建议提交

```text
feat(auth): add revocable scoped token lifecycle
```

---

## TASK_ID=P2-02：建立一致性备份、恢复和可观测性

**优先级：P2**  
**依赖：P1-07**

### 目标

正式定义哪些数据需要备份、如何恢复以及如何判断系统健康。

### 要求

1. 数据分类：
   - PostgreSQL metadata/auth/audit：必须备份；
   - object storage raw：必须复制或版本化；
   - canonical/derived：按重建成本制定；
   - TileDB：可重建但应根据成本备份；
   - ClickHouse cache：默认不备份。
2. 设计：
   - PostgreSQL logical backup 或 PITR；
   - object storage 跨主机/跨故障域复制；
   - manifest/checksum 一致性检查；
   - 恢复顺序；
   - RPO/RTO。
3. 提供：
   - backup 脚本；
   - restore 脚本；
   - verify 脚本；
   - 非生产 restore drill。
4. 备份不得只依赖同时执行的 `pg_dump` 和普通 `rsync` 就声称一致。
5. 可观测性：
   - Prometheus metrics；
   - request ID；
   - structured logs；
   - query latency；
   - backend latency/error；
   - cache hit/miss；
   - ingestion state；
   - storage bytes；
   - worker queue；
   - rejected/rate-limited requests。
6. readiness：
   - 检查核心依赖；
   - 不执行昂贵全量操作；
   - 区分 liveness 和 readiness。
7. 告警建议：
   - 磁盘；
   - 数据库连接；
   - ingestion 失败；
   - checksum 失败；
   - object store 不可用；
   - backup 失败；
   - certificate 过期。
8. 文档执行一次完整恢复演练。

### 验收标准

在一台空白测试主机上，可以按照文档恢复 catalog 和至少一个完整 Resource，并通过 checksum 和查询验证。

### 建议提交

```text
feat(ops): add backup restore and observability tooling
```

---

## TASK_ID=P2-03：加固 CI/CD、镜像供应链和不可变发布

**优先级：P2**  
**依赖：建议在前述任务稳定后执行**

### 当前问题

发布不应在每次 main push 时覆盖固定版本 tag；还需要测试、扫描、SBOM、签名和 provenance。

### 目标

构建可追溯、不可变、可验证的正式发布流程。

### 要求

1. PR/main CI：
   - `cargo fmt --check`；
   - `cargo clippy -D warnings`；
   - `cargo test`；
   - integration tests；
   - migration test；
   - Docker build test。
2. 安全：
   - dependency advisory scan；
   - license/policy scan；
   - container vulnerability scan；
   - secret scan；
   - SBOM；
   - image signing；
   - build provenance。
3. GitHub Actions：
   - 最小 permissions；
   - 第三方 action 固定到 commit SHA；
   - 不把 token 打印到日志；
   - environment protection。
4. 发布：
   - 只从语义版本 tag 或批准 workflow 发布；
   - `0.1.1` 不得被后续构建覆盖；
   - 同时发布 git SHA tag；
   - 记录 image digest；
   - `latest` 只作为可选移动标签；
   - release notes 关联 commit 和 migration。
5. Docker：
   - `.dockerignore` 排除 `.env`、secret、数据、target；
   - multi-stage；
   - 非 root runtime；
   - 最小包；
   - 固定关键基础镜像 digest；
   - OCI labels。
6. 生成：
   - SBOM；
   - checksums；
   - signature；
   - provenance attestation。
7. 失败的测试或高严重性漏洞阻止正式发布。
8. 增加发布回滚和镜像验证文档。

### 验收标准

可以从 release 页面或 registry 验证：

```text
source commit
semantic version
image digest
SBOM
signature
provenance
migration notes
```

### 建议提交

```text
ci(release): add immutable signed container releases
```

---

# 7. 正式生产完成标准

只有满足以下条件，才可以把系统称为 production-ready：

## 权限

- 权限 fail-closed；
- 新 Resource 默认 private；
- scope 被真正执行；
- token 可撤销；
- secret 可轮换；
- 管理操作可归属到具体 actor。

## 数据

- raw 有 checksum；
- raw 不因转换而删除；
- derived 有 lineage；
- cache 可删除；
- staging 有清理；
- Resource available 与 Artifact 完整性一致。

## I/O

- 大文件全程流式；
- 支持 Range；
- 没有无边界 `Vec<u8>`；
- 没有每请求启动 Python 进程；
- 所有网络和 backend 操作有 timeout。

## 存储

- Local FS 与 S3-compatible backend 可切换；
- 本地对象存储是独立 Compose service；
- 云端 S3 不需要改业务代码；
- object key 和 metadata 可审计；
- raw 至少有第二故障域副本。

## 部署

- API 非 root；
- PostgreSQL、ClickHouse、对象存储独立；
- 数据引擎不对公网暴露；
- TLS、限流和安全 headers；
- 有资源配额；
- 无固定版本 tag 覆盖。

## 运维

- 有 metrics、logs、request ID；
- 有一致性备份；
- 有恢复演练；
- 有 RPO/RTO；
- 有漏洞扫描、SBOM、签名和 provenance；
- 有数据库和对象布局迁移说明。

---

# 8. Codex 单任务执行模板

复制下面内容，并替换 `<TASK_ID>`：

```text
你正在维护 GitHub 仓库 zerostwo/shennong-db。

请先阅读 docs/archive/CODEX_PRODUCTION_HARDENING_PROMPT.md，然后仅执行：

TASK_ID=<TASK_ID>

执行规则：

1. 先运行：
   git status --short
   git rev-parse HEAD
   git log -5 --oneline

2. 阅读该任务涉及的实现、测试、迁移、Docker 和文档，确认问题在当前 HEAD 是否仍存在。

3. 只实现当前 TASK_ID。不要自动执行后续任务，不要进行无关重构。

4. 保护数据：
   - 不读取、修改或删除真实 /data；
   - 不删除 Docker volume；
   - 使用临时 fixture 和 test volume；
   - 不提交数据、secret 或 .env。

5. 先增加失败的回归测试或明确现有测试缺口，再实现修复。

6. 保持 /api/v1 和外部 R 客户端兼容，除非该任务明确允许 breaking change。任何数据库变更必须提供迁移。

7. 运行相关测试，并尽量运行：
   cargo fmt --all --check
   cargo clippy --workspace --all-targets --all-features -- -D warnings
   cargo test --workspace --all-features
   git diff --check

8. 涉及 Docker 时运行：
   docker compose config
   docker build --pull -t shennong-db:test .

9. 使用 Conventional Commit。一个任务对应一个聚焦提交。

10. 完成后输出：
    - TASK_ID 和状态；
    - 问题确认与证据；
    - 设计决策；
    - 修改文件；
    - 新增测试；
    - 实际运行命令及结果；
    - 配置/数据库/数据迁移影响；
    - 安全改善；
    - 剩余风险；
    - 回滚方式；
    - commit SHA。

如果前置依赖没有完成，停止修改并报告 blocked，不要用临时 hack 绕过架构依赖。
```
