# ShennongDB WebUI 完整实现提示词

> 归档说明：这是 WebUI 初始实现 brief。当前运行时为 `web/app`，当前行为以
> `web/README.md`、`docs/web-api-boundaries.md` 和实时 Rust API 为准。

> 目标仓库：`zerostwo/shennong-db`  
> 交付对象：Codex Build Website / Build Web Apps  
> 目标：在现有 ShennongDB Rust 后端基础上，实现一套可用于生产环境的公共数据门户、用户控制台和管理员后台。  
> 重要：本规范是独立视觉与产品规格，不依赖 Figma。Codex 应直接以本文档为设计和实现源。

---

# 0. 给 Codex 的总指令

你正在维护 `zerostwo/shennong-db`。

请在现有仓库中新增一套完整的 ShennongDB WebUI，覆盖：

1. 游客可访问的公共数据门户；
2. 登录用户的数据访问控制台；
3. 管理员后台；
4. 登录、2FA、Token、上传、权限、审计等完整流程；
5. 与现有 ShennongDB Rust API 对接的前端架构；
6. Docker 化部署；
7. 响应式、可访问性、测试和生产质量保障。

这不是一个静态演示页面，也不是把所有功能塞进一个 Dashboard。它必须是一个结构清晰、真实可操作、可扩展的生产级数据基础设施产品。

不要依赖 Figma。本文档即为唯一产品和视觉规格。

---

# 1. 产品定位

ShennongDB 是一个面向生物信息学数据的统一存储、元数据管理、权限控制和读取服务。

核心对象：

```text
Resource
Artifact
Relation
User
Grant
Token
Provider
Ingestion Job
Audit Event
Storage Backend
```

典型数据：

```text
Bulk RNA-seq
Single-cell RNA-seq
Spatial transcriptomics
Clinical / survival data
Reference genomes and indexes
Gene annotation
Knowledge databases
Raw sequencing files
Derived matrices and indexes
```

WebUI 的核心任务不是“分析数据”，而是：

```text
发现数据
理解数据
检查数据来源和完整性
获取 API 访问方式
上传和注册数据
查看使用量
管理用户、权限和系统
```

---

# 2. 产品体验原则

## 2.1 Calm, not empty

界面应当安静、清晰、专业，但不能空洞。

使用：

- 真实表格；
- 清晰的层级；
- 较高的信息密度；
- 充足但不过度的留白；
- 精确的状态标签；
- 小型图表；
- 轻量边框和分隔线。

避免：

- 大面积营销式 Hero；
- 大量装饰插画；
- 无意义卡片墙；
- 多层卡片嵌套；
- 过度圆角；
- 强烈渐变；
- 巨大阴影；
- 玻璃拟态；
- 过度活泼的 SaaS 模板感。

## 2.2 Objects first

界面围绕 ShennongDB 对象组织，而不是围绕技术名词堆叠。

用户应快速理解：

```text
这是一个 Resource
它包含哪些 Artifacts
它与哪些 Resource 有 Relation
它是否 Public / Private
它存在哪里
它能执行什么操作
它由什么数据生成
```

## 2.3 Progressive disclosure

默认显示最重要的信息。

详细信息放在：

- 右侧 Drawer；
- Tabs；
- Expandable sections；
- Context menu；
- Detail pages。

不要在列表页一次展示所有 schema 和 provenance。

## 2.4 Role-aware

游客、普通用户、管理员看到的内容必须不同。

权限必须由后端决定，前端只负责展示。

隐藏按钮不能替代服务端权限校验。

## 2.5 Trust visible

生物数据基础设施必须把可信度做成界面的一部分。

应显式展示：

- checksum；
- provenance；
- source；
- version；
- reference assembly；
- annotation release；
- ingestion status；
- raw / canonical / derived / cache；
- access policy；
- last verified time。

---

# 3. 技术栈

使用以下技术栈：

```text
Next.js App Router
React
TypeScript strict
pnpm
Tailwind CSS
shadcn/ui
Radix UI primitives
TanStack Query
TanStack Table
TanStack Virtual
React Hook Form
Zod
Apache ECharts
Lucide React
date-fns
nuqs 或 URLSearchParams
Vitest
Testing Library
MSW
Playwright
```

## 3.1 架构原则

```text
Browser
   ↓
Next.js WebUI
   ↓
ShennongDB Rust API
   ↓
PostgreSQL / ClickHouse / TileDB / Object Storage
```

Next.js 负责：

- 页面；
- 路由；
- SSR；
- Web session；
- BFF；
- UI 聚合；
- 浏览器安全边界。

Rust API 负责：

- 用户事实；
- Token；
- Grant；
- Resource 权限；
- 查询；
- 数据；
- 审计；
- ingestion；
- 系统状态。

不要在 Next.js 中复制后端权限逻辑。

---

# 4. 仓库结构

在现有仓库下新增：

```text
shennong-db/
├── crates/
├── providers/
├── seed/
├── docs/
├── web/
│   ├── app/
│   │   ├── (public)/
│   │   ├── (auth)/
│   │   ├── (console)/
│   │   ├── admin/
│   │   ├── api/
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/
│   │   ├── shell/
│   │   ├── catalog/
│   │   ├── resource/
│   │   ├── account/
│   │   ├── upload/
│   │   ├── admin/
│   │   ├── charts/
│   │   └── feedback/
│   ├── features/
│   │   ├── auth/
│   │   ├── catalog/
│   │   ├── resources/
│   │   ├── tokens/
│   │   ├── usage/
│   │   ├── uploads/
│   │   ├── users/
│   │   ├── grants/
│   │   ├── settings/
│   │   └── monitoring/
│   ├── lib/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── config/
│   │   ├── permissions/
│   │   ├── formatting/
│   │   └── validation/
│   ├── hooks/
│   ├── mocks/
│   ├── public/
│   ├── tests/
│   ├── playwright/
│   ├── components.json
│   ├── next.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── Dockerfile
├── openapi/
│   └── shennongdb.json
├── docker-compose.yml
└── README.md
```

不要把所有内容写进一个 `page.tsx`。

`AppShell` 只负责组合布局，不负责业务逻辑。

---

# 5. 路由规划

## 5.1 公共门户

```text
/
├── /catalog
├── /catalog/resources/[resourceId]
├── /catalog/collections
├── /catalog/tags
├── /catalog/schemas
├── /catalog/relations
├── /docs
└── /support
```

## 5.2 登录与账户

```text
/auth/sign-in
/auth/forgot-password
/auth/reset-password
/auth/two-factor
/auth/recovery-code
```

## 5.3 用户控制台

```text
/console
├── /console/my-data
├── /console/uploads
├── /console/uploads/new
├── /console/jobs
├── /console/api-access
├── /console/tokens
├── /console/usage
├── /console/profile
├── /console/security
├── /console/sessions
└── /console/login-history
```

## 5.4 管理员后台

```text
/admin
├── /admin/dashboard
├── /admin/users
├── /admin/users/[userId]
├── /admin/grants
├── /admin/tokens
├── /admin/providers
├── /admin/ingestion
├── /admin/storage
├── /admin/monitoring
├── /admin/audit
├── /admin/security
├── /admin/backups
└── /admin/settings
```

---

# 6. 角色和权限

## 6.1 Guest

游客可以：

- 浏览 public Resources；
- 搜索和筛选 public 数据；
- 查看 public Resource 基本信息；
- 查看公开的 provenance 和 schema；
- 查看 API 文档；
- 查看系统公开状态。

游客不能：

- 查看 private Resource 是否存在；
- 下载 private Artifact；
- 查询 private Resource；
- 创建 Token；
- 上传数据；
- 查看使用量；
- 进入用户控制台；
- 进入管理员后台。

## 6.2 User

普通用户可以：

- 浏览 public Resource；
- 浏览被授权的 private Resource；
- 创建和撤销自己的 API Token；
- 查看自己的 API 使用量；
- 上传数据；
- 查看自己的 ingestion jobs；
- 管理个人资料、安全、2FA 和会话；
- 收藏、创建 Collection；
- 下载被授权 Artifact。

## 6.3 Admin

管理员拥有普通用户能力，此外可以：

- 管理用户；
- 管理 Grants；
- 管理 Token；
- 管理 Provider；
- 管理系统设置；
- 查看完整 Audit Log；
- 查看存储和后台服务状态；
- 查看全部 ingestion jobs；
- 管理备份；
- 配置 Analytics 和 Telemetry；
- 配置安全策略。

管理员入口不要作为左侧固定主导航项出现在公共门户。

管理员进入方式：

```text
左下角用户头像
    ↓
用户菜单
    ↓
Administrator Panel
```

只有当前用户为 admin 时展示。


---

# 7. 全局视觉方案

## 7.1 设计语言

参考方向：

```text
ChatGPT
Codex
Linear
Vercel
现代数据基础设施控制台
```

不是照搬品牌，而是使用相似的设计原则：

- 清晰；
- 克制；
- 高质量排版；
- 细边框；
- 高信息密度；
- 简洁图标；
- 极少阴影；
- 强调内容，不强调装饰。

## 7.2 色彩

### Light theme

```css
--background: #ffffff;
--surface: #ffffff;
--surface-subtle: #f8fafc;
--surface-muted: #f3f5f7;
--surface-selected: #edf5ff;

--text-primary: #0f172a;
--text-secondary: #64748b;
--text-muted: #94a3b8;
--text-inverse: #ffffff;

--border: #e2e8f0;
--border-strong: #cbd5e1;

--brand: #16a34a;
--brand-hover: #15803d;
--brand-soft: #eafaf0;

--action: #2563eb;
--action-hover: #1d4ed8;
--action-soft: #eff6ff;

--success: #16a34a;
--success-soft: #ecfdf3;

--warning: #d97706;
--warning-soft: #fff7e6;

--danger: #dc2626;
--danger-soft: #fef2f2;

--private: #9a6700;
--private-soft: #fff6dc;

--artifact: #7c3aed;
--artifact-soft: #f5f3ff;
```

### Dark admin sidebar

管理员后台左侧栏：

```css
--admin-sidebar-bg: #08131f;
--admin-sidebar-surface: #152232;
--admin-sidebar-text: #e5edf5;
--admin-sidebar-muted: #8391a2;
--admin-sidebar-border: #223143;
--admin-sidebar-brand: #22c55e;
```

公共门户左侧栏仍为浅色。

## 7.3 字体

```text
UI: Inter
Code: JetBrains Mono
```

推荐：

```css
Display: 32 / 40 / 650
H1: 28 / 36 / 650
H2: 22 / 30 / 650
H3: 17 / 24 / 600

Body large: 16 / 24 / 400
Body: 14 / 21 / 400
Body medium: 14 / 21 / 500

Label: 13 / 18 / 500
Small: 12 / 17 / 400
Caption: 11 / 16 / 400

Code: 12 / 18 / 400
```

不要用浏览器默认控件字号。

## 7.4 圆角

```text
Input: 8px
Button: 8px
Table: 10px
Card: 10px
Drawer: 16px
Popover: 12px
Badge: 6px
```

不要使用 20–32px 的大圆角。

## 7.5 阴影

仅用于：

- Drawer；
- Popover；
- Dialog；
- Dropdown；
- Command palette。

普通 Card 和 Table 使用边框，不使用明显阴影。

```css
--shadow-popover:
  0 12px 30px rgba(15, 23, 42, 0.12),
  0 2px 8px rgba(15, 23, 42, 0.06);

--shadow-drawer:
  0 18px 45px rgba(15, 23, 42, 0.10),
  0 4px 12px rgba(15, 23, 42, 0.05);
```

---

# 8. 全局布局

## 8.1 Desktop 基准

主要设计基准：

```text
1672 × 941
```

同时支持：

```text
1440 × 900
1280 × 800
1024 × 768
移动端
```

## 8.2 公共门户布局

```text
┌───────────────┬──────────────────────────────────┬───────────────┐
│ Sidebar 252px │ Main flexible                    │ Drawer 448px  │
└───────────────┴──────────────────────────────────┴───────────────┘
```

Sidebar：

```text
宽度：248–252px
固定高度：100vh
右侧 1px border
```

Main：

```text
最大宽度不限
左右 padding 24px
顶部 search 40px
```

Drawer：

```text
宽度 420–448px
右侧 margin 16px
顶部 margin 40px
底部 margin 40px
圆角 16px
shadow
```

Drawer 不是固定占据页面栅格的第三列。

它应浮在主界面右侧之上。

## 8.3 管理员后台布局

```text
┌──────────────┬──────────────────────────────┬─────────────────┐
│ Dark Sidebar │ Dashboard                    │ Settings Panel  │
│ 232px        │ flexible                     │ 460–480px       │
└──────────────┴──────────────────────────────┴─────────────────┘
```

System Settings 作为管理员后台右侧配置面板时：

- 宽度约 476px；
- 与 Dashboard 同屏；
- 底部 Save Changes 固定；
- 面板自身可滚动；
- 主 Dashboard 保持完整可读。

---

# 9. 公共门户 App Shell

## 9.1 左侧栏顶部

```text
ShennongDB Logo
折叠按钮
All systems operational
```

系统状态放在 Logo 下方。

不要放在全局底部状态栏。

## 9.2 左侧导航

分组：

```text
CATALOG
- Overview
- Catalog
- Collections
- Tags
- Schemas
- Relations

DATA OPS
- Ingest
- Pipelines
- Jobs
- Storage
- Monitoring

GOVERNANCE
- Access
- Audit Logs
- Policies
- Tokens

SUPPORT
- Docs
- Support
```

根据角色隐藏无权限入口。

游客不显示 Data Ops 和 Governance 管理项，只保留公开入口。

## 9.3 左下用户区域

未登录：

```text
Sign in
```

登录后：

```text
Avatar
Email
Role
Chevron
```

点击后出现 Popover：

```text
Profile
API Tokens
Settings
Administrator Panel   # 仅 Admin
Sign out
```

---

# 10. Catalog 主页面

路径：

```text
/catalog
```

## 10.1 顶部搜索

宽输入框：

```text
Ask ShennongDB or search resources...
```

右侧显示快捷键：

```text
⌘ K
```

点击后打开 Command Palette。

Command Palette 支持：

- 搜索 Resource；
- 跳转到上传；
- 查看 Token；
- 查看使用量；
- 打开管理员后台；
- 搜索用户；
- 搜索设置。

## 10.2 Catalog Tabs

```text
All
Resources
Artifacts
Relations
```

每个 Tab 显示数量。

选中状态：

- 淡蓝背景；
- 蓝色文字；
- 轻边框。

## 10.3 Filter Bar

```text
Filter button
Search input
Sort dropdown
View density
```

Filter 支持：

```text
Type
Visibility
Backend
Data class
Organism
Assay
Owner
Tag
Status
Updated date
```

筛选状态同步到 URL。

例如：

```text
/catalog?type=resource&visibility=public&backend=tiledb
```

## 10.4 Catalog Table

列：

```text
Name
Type
Visibility
Backend
Updated
Usage
Actions
```

行高：

```text
56–60px
```

Name 区：

```text
Type icon
Title
ID
```

Visibility：

```text
Public
Private
```

Backend：

```text
Local
S3
TileDB
ClickHouse
PostgreSQL
```

Actions：

```text
View details
Open resource
Copy ID
View artifacts
View relations
Download
Add to collection
```

不允许在 Catalog 页面把每个条目做成 Card。

必须使用高密度 Table。

## 10.5 Selection

点击行：

- 保持当前页面；
- 高亮当前行；
- 右侧打开浮动 Drawer；
- URL 更新 query parameter；
- 不跳转到新页面。

例如：

```text
/catalog?resource=toil
```

支持 ESC 关闭。

---

# 11. Resource 详情 Drawer

## 11.1 Header

```text
Type icon
Resource title
Resource badge
Resource ID
Copy ID
Close
More menu
```

## 11.2 Tabs

```text
Overview
Schema
Provenance
Relations
Access
```

## 11.3 Overview

展示：

```text
Description
Visibility
Backend
Storage class
Size
Created
Updated
Owner
Tags
```

Storage class：

```text
raw
canonical
derived
cache
staging
```

## 11.4 Integrity & Provenance

展示：

```text
SHA256
Source
Pipeline version
Derived from
Registered at
Last verified
Reference genome
Annotation release
```

必须支持复制 checksum 和 URI。

## 11.5 API Endpoints

语言切换：

```text
cURL
R
Python
```

代码块使用 JetBrains Mono。

示例：

```r
library(shennongdata)

toil <- sn_load_data("toil")
sn_fetch_data(
  toil,
  c("tumor", "group", "YTHDF2"),
  layer = "tpm"
)
```

代码块右上角：

```text
Copy
```

## 11.6 Allowed Operations

两列：

```text
Allowed
- Discover
- Read
- Query
- Download

Not allowed
- Write
- Update
- Delete
```

## 11.7 Authentication Callout

Drawer 底部：

```text
Authentication
Use an API token for programmatic access.
View Tokens
```

---

# 12. Collections

路径：

```text
/catalog/collections
```

集合用于整理 Resource。

页面：

```text
Title
Create collection
Search
Collection list
```

Collection 展示：

```text
Name
Description
Resource count
Owner
Visibility
Updated
```

支持：

- 创建；
- 重命名；
- 添加 Resource；
- 移除 Resource；
- 分享；
- 删除。

---

# 13. Relations 浏览器

路径：

```text
/catalog/relations
```

不要一开始做复杂图谱。

默认使用：

```text
Relation table
```

列：

```text
Source
Relation type
Target
Evidence
Updated
```

点击 Relation 打开 Drawer。

可选提供简单局部关系图：

```text
中心 Resource
一层邻居
```

不显示全库大图。


---

# 14. 用户控制台

公共门户与用户控制台共用浅色 App Shell。

## 14.1 My Data

路径：

```text
/console/my-data
```

Tabs：

```text
Owned
Shared with me
Favorites
Collections
```

展示 Resource Table。

## 14.2 Uploads

路径：

```text
/console/uploads
```

展示：

```text
Upload name
Dataset
File count
Total size
Status
Progress
Created
Actions
```

状态：

```text
Draft
Uploading
Validating
Materializing
Available
Failed
Cancelled
```

## 14.3 新建上传

路径：

```text
/console/uploads/new
```

使用 Stepper：

```text
1. Select files
2. Describe dataset
3. Map artifacts
4. Access
5. Review
6. Upload
```

### Step 1

拖拽区：

```text
Drop files here
or Browse files
```

显示：

- 文件名；
- 大小；
- MIME；
- checksum progress；
- remove。

### Step 2

字段：

```text
Dataset name
Description
Organism
Modality
Assay
Reference genome
Annotation release
Tags
Citation
```

### Step 3

每个文件映射：

```text
Role
Format
Data class
Compression
Primary key
Feature identifier
Observation identifier
```

### Step 4

```text
Visibility
Private by default
Grant users
Grant scopes
```

### Step 5

Review：

```text
Dataset metadata
Files
Total bytes
Storage target
Expected transformations
Warnings
```

### Step 6

显示：

```text
Upload progress
Checksum
Multipart parts
Retry
Cancel
```

完成后进入 ingestion job。

---

# 15. API Access 页面

路径：

```text
/console/api-access
```

## 15.1 Header

```text
API Access
Manage personal tokens, usage, limits, SDKs, and examples.
```

## 15.2 Base URL

```text
https://api.example.org/api/v1
Copy
```

## 15.3 Metric Cards

四张：

```text
Requests this month
Rate limit
Data transferred
Active tokens
```

例如：

```text
2.14M
1,250 / min
186.4 GB
3
```

## 15.4 Usage chart

```text
API calls · Last 30 days
```

折线图。

支持：

```text
7 days
30 days
90 days
```

## 15.5 Rate Limit

环形进度：

```text
62%
1,250 / 2,000
```

并显示：

```text
Daily
Monthly
Reset time
```

## 15.6 Personal Tokens

表格：

```text
Token name
Prefix
Scopes
Created
Last used
Expires
Actions
```

Actions：

```text
Rename
Rotate
Revoke
```

创建 Token：

```text
Name
Expiration
Scopes
```

生成后只展示一次：

```text
Token created
Copy the token now. It will not be shown again.
```

---

# 16. Usage 页面

路径：

```text
/console/usage
```

Sections：

```text
Request volume
Data transfer
Top resources
Top endpoints
Errors
Rate-limited requests
Token usage
```

筛选：

```text
Date range
Token
Endpoint
Resource
Status
```

---

# 17. Profile & Security

## 17.1 Profile

路径：

```text
/console/profile
```

字段：

```text
Display name
Email
Organization
Role
Timezone
Locale
Avatar
```

## 17.2 Security

路径：

```text
/console/security
```

Sections：

```text
Password
Two-factor authentication
Recovery codes
Active sessions
Login history
API tokens
```

## 17.3 Login history

表格：

```text
Time
IP
Location
Device
Browser
Result
```

## 17.4 Sessions

表格：

```text
Device
IP
Created
Last active
Current
Revoke
```

---

# 18. 管理员后台 App Shell

管理员后台左侧使用深色 Sidebar。

## 18.1 Logo

```text
ShennongDB
Biomedical Data Infrastructure
```

## 18.2 Navigation

```text
Dashboard

MANAGEMENT
- Users
- Tokens
- Grants
- Providers
- Storage
- Tracking
- Security
- Backups
- System Settings

SYSTEM
- Version
- Build
- Uptime
- Cluster
- Region
```

底部：

```text
Avatar
Name
Administrator
```

提供：

```text
Return to data portal
```

---

# 19. Admin Dashboard

路径：

```text
/admin/dashboard
```

## 19.1 Header

```text
Dashboard
Overview of system health, usage, and activity.
```

右侧：

```text
All Systems Operational
Updated 30s ago
Refresh
```

## 19.2 Metric Cards

一行五张：

```text
Total Resources
Artifacts
Raw Data
Derived Data
Cache
```

显示：

```text
Primary value
Objects count
Small icon
```

尺寸约：

```text
高度 132px
```

## 19.3 System Services

表格：

```text
Service
Status
Latency
Version
Instance
```

数据：

```text
PostgreSQL
ClickHouse
TileDB
S3 Object Storage
```

## 19.4 Ingestion Job Queue

Rows：

```text
Queued
Running
Failed
Completed 24h
Avg. Processing Time
```

每行右侧小型 sparkline。

## 19.5 Analytics Row

三块：

```text
Query Call Volume
Access Events
Top Query Endpoints
```

Query Call Volume：

- 折线；
- 时间刻度；
- 总请求。

Access Events：

```text
Successful
Failed
Unauthorized
Rate Limited
Total Events
```

Top Query Endpoints：

```text
Endpoint
Count
Percentage
```

## 19.6 Recent Audit Trail

完整 Table：

```text
Time UTC
Actor
Action
Resource
Result
IP Address
```

---

# 20. Users 管理

路径：

```text
/admin/users
```

## 20.1 Table

列：

```text
User
Email
Role
Status
Resources
Tokens
Last active
Created
Actions
```

Filters：

```text
Role
Status
Has 2FA
Created
Last active
```

## 20.2 User Drawer

Tabs：

```text
Overview
Grants
Tokens
Sessions
Audit
```

Overview：

```text
Identity
Role
Status
2FA
Created
Last login
Login failures
```

Actions：

```text
Disable
Enable
Reset 2FA
Revoke sessions
Revoke tokens
Change role
```

危险操作需要确认 Dialog。

---

# 21. Grants 管理

路径：

```text
/admin/grants
```

表格：

```text
User
Resource
Scopes
Granted by
Granted at
Expires
Actions
```

Create Grant：

```text
User
Resource
Scopes
Expiration
Reason
```

Scopes：

```text
resource.read
artifact.download
query.execute
resource.write
resource.admin
```

---

# 22. Providers

路径：

```text
/admin/providers
```

Provider List：

```text
Name
Version
Source
Installed
Resource count
Last sync
Status
```

详情 Drawer：

```text
Manifest
Files
Checksums
Storage
Permissions
Installation history
```

Actions：

```text
Install
Update
Disable
Validate
View jobs
```

---

# 23. Ingestion Jobs

路径：

```text
/admin/ingestion
```

表格：

```text
Job ID
Resource
Provider
State
Progress
Started
Duration
Worker
Actions
```

状态机：

```text
registered
downloading
verifying
materializing
available
failed
cancelled
```

详情：

```text
Timeline
Logs
Files
Checksums
Warnings
Errors
Retry
Cancel
```

---

# 24. Storage

路径：

```text
/admin/storage
```

## 24.1 Summary

Cards：

```text
Raw
Canonical
Derived
Cache
Staging
```

## 24.2 Backend table

```text
Backend
Type
Endpoint
Health
Capacity
Used
Latency
Default
```

Backend：

```text
Local Filesystem
S3-compatible
TileDB
ClickHouse
PostgreSQL
```

## 24.3 Storage policy

展示：

```text
Default raw backend
Default derived backend
Staging retention
Cache TTL
Checksum policy
Multipart threshold
Presigned URL expiry
```

---

# 25. Monitoring

路径：

```text
/admin/monitoring
```

Sections：

```text
API latency
Error rate
Request volume
Backend latency
Database connections
Ingestion queue
Storage utilization
Cache hit rate
```

图表保持简洁。

不要做复杂 Grafana 克隆。

---

# 26. Audit Log

路径：

```text
/admin/audit
```

Table：

```text
Timestamp
Actor
Action
Object type
Object ID
Result
IP
Request ID
```

Filters：

```text
Actor
Action
Object type
Result
IP
Date
```

Detail Drawer：

```text
Request metadata
User agent
Scopes
Before / after
Error code
Related resource
```

---

# 27. System Settings

路径：

```text
/admin/settings
```

同时支持从 Dashboard 右侧面板快速打开。

Tabs：

```text
General
Security
Storage
Integrations
Notifications
Advanced
```

## 27.1 General

```text
Instance name
Public URL
Support URL
Docs URL
Default timezone
Default locale
Public catalog
Registration
```

## 27.2 Analytics Integrations

```text
Umami
Google Analytics
```

字段：

```text
Enabled
Website ID
Measurement ID
Script URL
```

## 27.3 Privacy & Telemetry

```text
Enable telemetry
IP anonymization
Respect DNT
Usage metrics
Error reporting
```

## 27.4 Data Retention

```text
Audit logs
Access logs
Query logs
Metrics
Staging files
Failed ingestion files
```

## 27.5 Security Policies

```text
Require admin 2FA
Session timeout
Password minimum length
Token default expiration
Maximum token expiration
Login failure threshold
Lockout duration
```

## 27.6 Storage

```text
Object storage backend
S3 endpoint
S3 bucket
S3 region
Path style
Presigned expiration
Multipart size
```

## 27.7 Footer actions

固定在底部：

```text
Reset to Defaults
Save Changes
```

有未保存修改时显示：

```text
Unsaved changes
```

---

# 28. Auth 页面

Auth 页面使用简洁单栏布局。

## 28.1 Sign in

```text
Welcome back
Sign in to access private Resources and personal APIs.

Email
Password
Forgot password
Sign in
```

下方：

```text
Public catalog remains available without an account.
Browse public catalog
```

## 28.2 Two-factor

```text
Two-factor authentication
Enter the 6-digit code from your authenticator app.

Code
Verify
Use recovery code
```

## 28.3 Forgot password

```text
Email
Send reset link
```

不要暴露该 Email 是否存在。


---

# 29. Dialogs 和状态

必须实现：

```text
Create API Token
Token Created
Revoke Token
Delete Resource
Disable User
Reset 2FA
Cancel Upload
Retry Job
Access Denied
Session Expired
Unsaved Changes
```

## 29.1 Access Denied

```text
You do not have access to this Resource.
Request access or contact an administrator.
```

Actions：

```text
Return to Catalog
Request Access
```

## 29.2 Empty states

需要：

```text
No Resources
No Tokens
No Grants
No Uploads
No Jobs
No Audit Events
No Results
```

不要用大型插画。

使用：

```text
Small icon
Short title
One sentence
One action
```

## 29.3 Loading

使用：

- Table skeleton；
- Card skeleton；
- Drawer skeleton；
- Inline spinner；
- Progress bar。

不要整页 loading spinner。

---

# 30. 组件清单

必须封装：

```text
AppShell
PublicSidebar
AdminSidebar
TopSearch
CommandPalette
UserMenu
StatusIndicator

PageHeader
SectionHeader
MetricCard
StatRow

DataTable
DataTableToolbar
DataTablePagination
DataTableColumnHeader
DataTableRowActions

ResourceTypeIcon
VisibilityBadge
BackendBadge
DataClassBadge
StatusBadge
ScopeBadge

ResourceDrawer
ResourceOverview
ResourceProvenance
ResourceSchema
ResourceRelations
ResourceAccess
ApiExample

CodeBlock
CopyButton

ChartCard
Sparkline
LineChart
DonutChart

FormSection
SettingsRow
SettingsGroup
SettingsFooter
ToggleField

UploadDropzone
UploadFileRow
UploadStepper
UploadProgress

TokenTable
TokenCreateDialog
TokenSecretDialog

UserDrawer
GrantDialog
ConfirmDialog
AccessDenied
EmptyState
ErrorState
```

---

# 31. 交互规则

## 31.1 Drawer

- 从右侧打开；
- ESC 关闭；
- 点击遮罩不关闭，除非明确允许；
- URL 保留选中对象；
- 浏览器 back 可关闭；
- 保留滚动位置。

## 31.2 Table

- 支持 keyboard focus；
- Row hover；
- Row selected；
- 列排序；
- 筛选；
- 分页；
- 空状态；
- 错误状态；
- loading；
- 大数据使用 virtualize。

## 31.3 Form

- 字段级错误；
- 顶部 summary；
- dirty state；
- 保存中状态；
- 成功 toast；
- 失败 toast；
- destructive confirm。

## 31.4 Copy

复制成功后显示：

```text
Copied
```

持续约 1.5 秒。

## 31.5 Toast

位置：

```text
右下角
```

最多同时 3 个。

---

# 32. 响应式

## 32.1 1440+

完整 Desktop。

## 32.2 1280–1439

- Sidebar 220px；
- Drawer 400px；
- Metric cards 5 列仍保留；
- Table 减少次要列。

## 32.3 1024–1279

- Sidebar 可折叠为 icon rail；
- Drawer 420px overlay；
- Admin settings 为 overlay；
- Metric cards 3+2；
- Secondary charts 换行。

## 32.4 768–1023

- Sidebar 变 Sheet；
- Top bar 固定；
- Table 横向滚动；
- Drawer 全高 70vw；
- Admin Dashboard cards 两列。

## 32.5 Mobile

- 底部不使用完整 Desktop sidebar；
- 使用顶部 Header + Navigation Sheet；
- Catalog 使用紧凑 list，不使用卡片墙；
- Resource Drawer 变全屏 Sheet；
- Dashboard cards 单列；
- 表格转为可横向滚动表格或 row list；
- Settings 变独立页面。

不能简单把桌面缩小。

---

# 33. 可访问性

最低要求：

```text
WCAG AA
```

必须：

- 完整键盘导航；
- 正确 heading；
- focus visible；
- Drawer focus trap；
- Dialog focus trap；
- 表格语义；
- form label；
- aria-describedby；
- 状态不只依靠颜色；
- 图表提供文字摘要；
- 支持 reduced motion；
- 图标按钮有 accessible name；
- Toast 可被 screen reader 读取；
- 不使用低于 12px 的关键文字。

---

# 34. Mock 数据

第一阶段使用 MSW。

Mock 必须真实且一致。

使用以下 Resource：

```text
Toil RNA-seq (Homo sapiens)
PBMC 3K TileDB filtered
TCGA survival metadata
GENCODE v44 gene map
S3 raw bucket · WGS reads
Toil RNA-seq v1
PBMC snapshot 2024-05-12
TCGA clinical → survival
GENCODE gene → transcript
```

Backend：

```text
Local
TileDB
PostgreSQL
ClickHouse
S3
```

数据类：

```text
raw
canonical
derived
cache
```

不要使用：

```text
Lorem ipsum
Dataset 1
User A
Token 123
```

---

# 35. API 适配

## 35.1 第一阶段

使用统一 API adapter：

```text
web/lib/api/
```

所有组件只调用 feature hooks。

例如：

```text
useResources()
useResource()
useArtifacts()
useRelations()
useTokens()
useUsage()
useUsers()
useGrants()
useAuditEvents()
useSystemHealth()
useIngestionJobs()
```

组件中禁止直接写 `fetch()`。

## 35.2 第二阶段

接入 Rust API。

若后端接口缺失：

- 不在前端伪造真正的权限；
- 用 adapter 暂时返回 `not_supported`；
- 记录需要的 API；
- 不修改 Rust 核心职责。

## 35.3 API 错误

统一：

```ts
type ApiError = {
  code: string
  message: string
  requestId?: string
  details?: unknown
}
```

UI 不显示内部 traceback、SQL 或文件路径。

---

# 36. Web 认证

不要把 JWT 放在：

```text
localStorage
sessionStorage
URL
```

使用：

```text
HttpOnly
Secure
SameSite
```

Cookie。

Web session 与 Personal API Token 完全分开。

Personal API Token 只用于：

```text
R
Python
curl
SDK
```

Token 只显示一次。

---

# 37. 性能

要求：

- Route-level code splitting；
- Table virtualization；
- Drawer lazy loading；
- ECharts dynamic import；
- 避免大列表一次渲染；
- query caching；
- stale time；
- skeleton；
- 图片最少；
- 首屏不加载管理员资源；
- 不把所有页面打进一个 bundle。

目标：

```text
公共 Catalog 首屏可交互 < 2.5s
Drawer 打开后立即显示 skeleton
搜索输入不阻塞
1000 rows 表格滚动流畅
```

---

# 38. 测试

## 38.1 Unit

测试：

```text
formatters
permission display helpers
query key builders
Zod schemas
API adapters
URL filters
```

## 38.2 Component

Testing Library：

```text
Resource Drawer
Data Table
Token Dialog
Upload Stepper
Settings Form
User Menu
Access Denied
```

## 38.3 MSW Integration

覆盖：

```text
Catalog success
Catalog empty
Catalog error
Private resource 404
Token creation
Token revoke
Upload progress
Admin user disable
Settings save
```

## 38.4 Playwright

核心流程：

```text
Guest browses public catalog
User signs in with 2FA
User opens private resource
User creates token
User uploads dataset
Admin opens admin panel
Admin disables user
Admin grants resource access
Admin updates system settings
```

每个流程必须包含：

- happy path；
- loading；
- failure；
- unauthorized；
- mobile smoke test。

---

# 39. Docker 部署

新增：

```text
shennong-db-api
shennong-db-web
```

Next.js 独立镜像。

不要把前端塞入 Rust API 镜像。

建议：

```yaml
services:
  web:
    build: ./web
    environment:
      SHENNONG_API_INTERNAL_URL: http://shennong-db:8000
      NEXT_PUBLIC_SHENNONG_PUBLIC_URL: https://example.org
    depends_on:
      - shennong-db
```

Web 容器：

- 非 root；
- read-only filesystem；
- healthcheck；
- no-new-privileges；
- fixed version；
- production build。

---

# 40. 实施阶段

Codex 必须分阶段执行。

## Phase 0：检查仓库

任务：

- 检查现有文件；
- 确认 API；
- 确认 Docker；
- 确认是否已有前端；
- 记录缺失接口；
- 不改代码。

输出：

```text
Repository assessment
WebUI implementation plan
API gap list
```

## Phase 1：项目和设计系统

任务：

- 初始化 `web/`；
- Next.js；
- Tailwind；
- shadcn/ui；
- fonts；
- colors；
- tokens；
- Button；
- Input；
- Badge；
- Sidebar；
- Drawer；
- Table；
- Dialog；
- Toast；
- MSW。

验收：

- Story-like component page；
- Light theme；
- Dark admin sidebar；
- Responsive shell。

提交：

```text
feat(web): add webui foundation and design system
```

## Phase 2：公共 Catalog

任务：

- Public Shell；
- Catalog；
- filters；
- search；
- tabs；
- table；
- pagination；
- Resource Drawer；
- user menu；
- command palette。

验收：

- 1672×941 完整；
- 1440；
- 1280；
- mobile；
- Guest/User/Admin 状态。

提交：

```text
feat(web): implement catalog and resource drawer
```

## Phase 3：用户控制台

任务：

- API access；
- tokens；
- usage；
- profile；
- security；
- sessions；
- login history；
- uploads；
- ingestion jobs。

提交：

```text
feat(web): add user console and api access
```

## Phase 4：管理员后台

任务：

- Dashboard；
- Users；
- Grants；
- Providers；
- Storage；
- Monitoring；
- Audit；
- Settings；
- Backups。

提交：

```text
feat(web): implement administrator console
```

## Phase 5：认证

任务：

- Sign in；
- 2FA；
- password；
- HttpOnly session；
- role-aware routes；
- session expiry；
- access denied。

提交：

```text
feat(web): add secure web authentication flows
```

## Phase 6：真实 API

任务：

- 接 Rust；
- 替换 MSW；
- error handling；
- token；
- query；
- upload；
- admin APIs。

提交：

```text
feat(web): connect webui to shennong api
```

## Phase 7：QA 与生产

任务：

- Playwright；
- performance；
- accessibility；
- Docker；
- docs；
- screenshots；
- final polish。

提交：

```text
test(web): add end-to-end coverage and production hardening
```

---

# 41. 视觉验收

每个主要页面都必须截图。

至少：

```text
Catalog desktop
Catalog resource drawer
Catalog admin menu
API Access
Profile & Security
Upload
Admin Dashboard
Users
System Settings
Mobile Catalog
Mobile Resource
```

检查：

- 字体；
- 行高；
- 表格密度；
- sidebar；
- drawer；
- card；
- border；
- icon；
- spacing；
- responsive；
- truncation；
- empty；
- loading；
- error。

禁止以下情况进入下一阶段：

- 文本重叠；
- Drawer 裁切；
- Table 列错位；
- Sidebar 高度溢出；
- 移动端横向溢出；
- 按钮不可点击；
- 假链接；
- 假图表；
- placeholder；
- 过多卡片；
- 浏览器默认控件风格；
- 全部页面视觉不一致。

---

# 42. 代码标准

- TypeScript strict；
- 不使用 `any`，除非有注释；
- 不写单个超大组件；
- 页面组件不超过合理复杂度；
- 业务逻辑放 feature；
- API 放 adapter；
- 样式使用 tokens；
- 不在 JSX 中散落 magic color；
- 不复制重复 markup；
- 图表封装；
- Table columns 独立；
- 表单 schema 独立；
- 所有异步流程有 error state；
- 所有 mutation 有 pending state；
- 所有 destructive action 有 confirm；
- 所有代码通过 lint、typecheck、tests。

---

# 43. 每阶段结束报告

每阶段结束必须输出：

```text
Phase:
Status:

Implemented:
- ...

Files:
- ...

Routes:
- ...

Components:
- ...

Tests:
- ...

Commands:
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm playwright test
- pnpm build

Screenshots:
- ...

API gaps:
- ...

Remaining issues:
- ...

Commit:
- title
- SHA
```

---

# 44. 最终完成标准

只有满足以下条件才算完成：

## 产品

- Guest/User/Admin 三种角色完整；
- 公共 Catalog 可用；
- Resource Drawer 完整；
- Token 和 Usage 完整；
- 上传流程完整；
- Admin Dashboard 完整；
- Users、Grants、Providers、Storage、Audit、Settings 完整。

## 视觉

- 前后台属于同一个产品；
- 公共区浅色；
- 管理员 Sidebar 深色；
- 不像模板；
- 不像 Figma 草稿；
- 不像卡片墙；
- 表格可读；
- 信息密度合理；
- 细节统一。

## 工程

- 独立 `web/`；
- Docker；
- Strict TS；
- API adapter；
- MSW；
- Unit；
- E2E；
- Responsive；
- A11y；
- Production build。

## 安全

- HttpOnly Cookie；
- 不在 localStorage 保存 JWT；
- private resource 由后端授权；
- admin routes 服务端验证；
- token 只展示一次；
- 错误不泄漏内部信息。

---

# 45. 可直接复制给 Codex 的执行指令

```text
请读取 docs/archive/SHENNONGDB_WEBUI_BUILD_PROMPT.md，并按照文档实现完整 ShennongDB WebUI。

硬性要求：

1. 本文档是唯一产品和视觉规格，不需要 Figma。
2. 先执行 Phase 0，只检查仓库和 API，不改代码。
3. Phase 0 完成后输出实施计划和 API gap list。
4. 后续一次只完成一个 Phase。
5. 不得将所有页面写成一个组件。
6. 不得把界面实现成静态截图。
7. 必须实现真实交互、状态、表格、Drawer、Dialog、表单和图表。
8. 必须保持 Guest/User/Admin 权限边界。
9. 浏览器 Web session 使用 HttpOnly Cookie。
10. 必须使用 MSW 完成 UI，再连接真实 Rust API。
11. 每个 Phase 必须运行 lint、typecheck、tests 和 production build。
12. 每个主要页面必须进行 Desktop 和 Mobile 浏览器截图验证。
13. 发现视觉问题时先修复，再进入下一 Phase。
14. 使用 Conventional Commits。
15. 每阶段结束报告修改文件、路由、组件、测试、截图、API gaps 和 commit SHA。

现在仅执行 Phase 0。
```
