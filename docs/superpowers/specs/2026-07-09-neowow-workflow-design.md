# NeoWOW Workflow 复刻设计 Spec

> **Status:** Approved (2026-07-09)  
> **Target:** https://neowow.cn/workflow?sessionId=2074796563114016768  
> **Priority:** A（视觉/UI 对齐）+ C（Agent 原生驱动优先）  
> **Repo:** lnkpi（超创平台）

---

## 1. 背景与目标

### 1.1 问题陈述

lnkpi 已完成 NeoWOW 竞品调研与 MVP 骨架（启动器、Vue Flow 画布、基础 Agent SSE、4 个 `/agent/*` API）。当前与 NeoWOW 目标页面在 **视觉还原度** 和 **Agent 真实驱动能力** 上仍有明显差距。

### 1.2 Phase 1 目标

用户访问 `/workflow?sessionId=xxx` 时：

1. **视觉（A）：** 页面布局、配色、字体、组件形态接近 NeoWOW（深色 `#141414`、三栏画布 chrome、底部生成栏）。
2. **Agent（C）：** 在 Agent 面板输入自然语言，Agent 通过 Tool Call 创建分镜、调用真实 LLM/图像 API，画布节点实时更新并持久化。

### 1.3 成功标准（可验证）

| # | 验收项 | 验证方式 |
|---|--------|----------|
| 1 | `/workflow` 启动器视觉与 NeoWOW 布局一致（Header / Hero / Launcher / 作品流） | 截图对比 |
| 2 | `/workflow?sessionId=xxx` 自动恢复会话并进入画布 | 手动 E2E |
| 3 | 画布三栏布局：会话列表 + 画布 + Agent 面板 | 手动 E2E |
| 4 | Agent 输入「创作赛博朋克城市夜景」→ 创建 Shot 节点 + 生成图像 | 配置 OPENAI_API_KEY 后 E2E |
| 5 | 画布状态持久化，刷新后节点仍在 | API + 刷新验证 |
| 6 | 无 API Key 时降级为 RuleBasedAgent + placeholder 图像 | 无 Key 环境 E2E |

### 1.4 明确排除（YAGNI）

- 会员 / 积分 / 微信支付 / 微信 JSSDK
- image-studio / video-studio / audio-studio / video-editor
- 唇形同步 / 数字人 / 多平台白标
- NeoWOW 95 个 `/agent/*` API 全量对标
- 社区发布流程深化（已有 MVP，本 Phase 不扩展）
- PlayCanvas 画布引擎（推迟至 M3，非 Phase 1 阻塞项）

---

## 2. 竞品蒸馏摘要

来源：`docs/NEOWOW_RESEARCH.md`（公开资源逆向，不复制源码/素材）

| 维度 | NeoWOW | lnkpi Phase 1 |
|------|--------|---------------|
| 框架 | Vue 3 + Vite | Vue 3 + Vite ✅ |
| UI | Element Plus + Ant Design | 引入 Element Plus |
| 画布 | PlayCanvas + Vue Flow | Vue Flow（M3 评估 PlayCanvas） |
| 架构 | Agent-First `/agent/*` | `@lnkpi/agent` + NestJS |
| 背景色 | `#141414` | 对齐 |
| 主题色 | `#6366f1` | 从当前 `#7c3aed` 调整 |
| 数据模型 | Canvas → Shot → Material | Prisma 已有，补 Service |

---

## 3. 技术方案

### 3.1 选定方案：UI Shell 优先 + Vue Flow + Agent Native

**三里程碑：**

```
M1 UI Shell     → NeoWOW 设计系统 + 页面/chrome 1:1
M2 Agent Native → 真实 LLM + 图像 API + Canvas API + 持久化
M3 Canvas Polish → PlayCanvas POC、@mention、视觉微调（可选）
```

**未选方案及原因：**

- PlayCanvas 先行：阻塞 Agent 验证，周期长。
- 仅 Agent 不改 UI：不符合 A 优先级。

### 3.2 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3, TypeScript, Vite, Tailwind, **Element Plus**, Vue Flow |
| Agent | `@lnkpi/agent`（RuleBasedAgent / OpenAIAgent） |
| 后端 | NestJS, Prisma, SQLite, SSE |
| AI | OpenAI Chat Completions (stream + tools), DALL·E 或兼容图像 API |
| 包管理 | pnpm monorepo |

---

## 4. 视觉设计系统（A）

### 4.1 Design Tokens

```yaml
color:
  background: "#141414"          # NeoWOW html/body
  surface-card: "#1a1a1a"
  surface-elevated: "#242424"
  border: "rgba(255,255,255,0.08)"
  accent-primary: "#6366f1"      # NeoWOW theme-color
  accent-hover: "#818cf8"
  text-primary: "#ffffff"
  text-secondary: "rgba(255,255,255,0.6)"
  text-muted: "rgba(255,255,255,0.4)"

typography:
  display: "Unbounded"           # Logo、大标题
  body: "Inter"                  # 正文
  size-hero: 2rem / 2.5rem
  size-body: 0.875rem

radius:
  sm: 8px
  md: 12px
  lg: 16px
  full: 9999px                   # Category tabs

spacing:
  header-height: 64px
  sidebar-width: 240px
  agent-panel-width: 320px
  generation-bar-height: auto (min 80px)
```

### 4.2 文件规划

| 文件 | 职责 |
|------|------|
| `apps/web/src/styles/neowow-tokens.css` | CSS 变量定义 |
| `apps/web/tailwind.config.js` | 扩展 token 映射 |
| `apps/web/src/main.ts` | 注册 Element Plus |

### 4.3 组件对标

| NeoWOW 组件 | lnkpi 组件 | M1 动作 |
|-------------|-----------|---------|
| AppHeader + main-tab | `AppHeader.vue` | Tab 样式、Logo 区 |
| CreativeLauncher | `WorkflowPage.vue` hero 区 | 输入框 + 双按钮布局 |
| WorksGridList | `WorkCard.vue` + grid | 卡片比例、标签、hover |
| SessionSelector | `CanvasPage.vue` 左栏 | 240px 固定宽 |
| WorkflowCanvas | `CanvasPage.vue` 中栏 | 工具栏 chrome |
| Agent 对话区 | `AgentPanel.vue` | 320px、消息气泡 |
| GenerationBar | `GenerationBar.vue` | 模型 tab + 输入区 |
| LoginDialog | `LoginDialog.vue` | Element Plus Dialog 换肤 |

---

## 5. 页面结构与路由（A）

### 5.1 启动器 `/workflow`

```
┌─────────────────────────────────────────────────────────┐
│ AppHeader: Logo | 画布(active) | 超创站 | 登录           │
├─────────────────────────────────────────────────────────┤
│ HeroGreeting: "{上午|下午|晚上}好，今天要做点什么呢？"     │
│ CreativeLauncher:                                       │
│   [ 说说你的创意...                    ] [告诉我你的想法] │
│                                        [  创建画布  ]   │
│ CarouselBanner: 沉浸式创作（静态或轮播）                  │
│ CategoryTabs: 全部 | 2026-赛事 | ...    [搜索] [发布作品]│
│ WorksWaterfall: WorkCard × N                            │
└─────────────────────────────────────────────────────────┘
```

### 5.2 画布编辑器 `/workflow/:sessionId`

```
┌ SessionSidebar ─┬─ CanvasViewport ─────────────┬─ AgentPanel ─┐
│ 240px           │ flex-1                        │ 320px        │
│ 我的画布         │ Toolbar: 返回|会话|Agent|标题  │ AI 创作助手   │
│ 列表 + 新建      │ Vue Flow + MiniMap + Controls │ SSE 消息     │
│                 │ Shot / Image / Video 节点      │ Tool 可视化   │
├─────────────────┴──────────────────────────────┴──────────────┤
│ GenerationBar: [文本|图像|视频] [模型×3] [语音mock] [输入] [生成]│
└───────────────────────────────────────────────────────────────┘
```

### 5.3 sessionId 路由行为

```
GET /workflow?sessionId={id}
  → 若 session 存在且用户已登录：redirect /workflow/{id}
  → 若未登录：展示启动器 + LoginDialog（登录后 redirect）
  → 若 session 不存在：展示启动器 + toast 提示
```

**实现位置：** `apps/web/src/pages/WorkflowPage.vue` + `router/index.ts`

---

## 6. Agent 原生架构（C）

### 6.1 数据流

```
User Input (AgentPanel)
  → POST /api/agent/chat/conversation (SSE)
  → AgentService.streamConversation()
  → CanvasAgent.run() [OpenAIAgent | RuleBasedAgent]
  → Tool Executor → CanvasAction[]
  → SSE events: text_delta | tool_call | tool_result | canvas_action
  → AgentPanel 更新消息 + emit canvasActions
  → CanvasPage.applyActionsToFlow()
  → PUT /api/sessions/:id (canvasData 持久化)
```

### 6.2 Phase 1 Agent Tools（6 个）

| Tool | 描述 | 真实 API |
|------|------|----------|
| `create_shot` | 创建分镜节点 | 本地 + Prisma Shot |
| `generate_image` | 生成图像素材 | OpenAI images/generations 或兼容 |
| `optimize_prompt` | 优化提示词 | LLM |
| `update_shot` | 更新分镜属性 | 本地 + Prisma |
| `connect_shots` | 节点连线 | 本地 canvasData |
| `layout_shots` | 自动排列 | 本地算法 |

**Package 位置：** `packages/agent/src/tools/canvas-tools.ts`（已有 8 个，Phase 1 重点完善 `generate_image` 真实 API 路径）

### 6.3 LLM 配置

```env
# apps/server/.env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # 或兼容网关
OPENAI_CHAT_MODEL=gpt-4o
OPENAI_IMAGE_MODEL=dall-e-3
```

**降级：** 无 Key → `RuleBasedAgent` + Unsplash placeholder（现有行为）

### 6.4 异步生成与轮询

图像生成超过 3s 时：

1. `generate_image` 创建 Material，`status: generating`
2. 后台任务完成 → 更新 Material URL + Shot coverUrl
3. 前端每 2s 轮询 `GET /agent/canvas/shot/status/batch?ids=...`
4. 收到 `completed` → 更新节点 data

---

## 7. 后端 API（C — 最小集）

### 7.1 已有（保留/enhance）

| Method | Path | 动作 |
|--------|------|------|
| POST | `/agent/chat/conversation` | Enhance：tool 结果写 Shot/Material |
| GET | `/agent/chat/user/messages` | 保持 |
| POST | `/agent/chat/optimize-prompt` | 保持 |
| GET | `/agent/capabilities/list` | 保持 |
| CRUD | `/sessions/*` | 保持，canvasData 同步 |

### 7.2 新增（M2）

| Method | Path | 职责 |
|--------|------|------|
| GET | `/agent/canvas/list` | 用户画布列表（对标 NeoWOW） |
| POST | `/agent/canvas/create` | 创建画布 |
| PUT | `/agent/canvas/update` | 更新画布 metadata + canvasData |
| POST | `/agent/canvas/shot/create` | 创建 Shot 记录 |
| POST | `/agent/canvas/material/generate-image` | 提交异步图像任务 |
| GET | `/agent/canvas/shot/status/batch` | 批量查询 Shot/Material 状态 |

**模块结构：**

```
apps/server/src/
├── agent/          # 已有 — chat + capabilities
├── canvas/         # 🆕 canvas.controller + canvas.service
│   ├── canvas.module.ts
│   ├── canvas.controller.ts
│   ├── canvas.service.ts
│   ├── shot.service.ts
│   └── material.service.ts
```

### 7.3 数据模型（Prisma — 已有，M2 启用）

```prisma
Session → Shot[] → Material[]
Session → AgentMessage[]
```

Shot 字段：`title, prompt, order, status, positionX, positionY`  
Material 字段：`type, url, thumbnail, prompt, status, order`

---

## 8. 前端模块变更

### 8.1 新建文件

| 路径 | 职责 |
|------|------|
| `apps/web/src/styles/neowow-tokens.css` | Design tokens |
| `apps/web/src/components/workflow/CreativeLauncher.vue` | 启动器输入区 |
| `apps/web/src/components/workflow/CarouselBanner.vue` | Banner 区 |
| `apps/web/src/components/workflow/CategoryTabs.vue` | 分类 Tab |
| `apps/web/src/composables/useSessionRedirect.ts` | sessionId URL 处理 |
| `apps/web/src/composables/useShotPolling.ts` | 生成状态轮询 |
| `apps/web/src/services/canvas-api.ts` | `/agent/canvas/*` 封装 |

### 8.2 修改文件

| 路径 | 变更 |
|------|------|
| `apps/web/tailwind.config.js` | NeoWOW tokens |
| `apps/web/src/main.ts` | Element Plus |
| `apps/web/package.json` | + element-plus |
| `apps/web/src/pages/WorkflowPage.vue` | 拆分子组件 + sessionId redirect |
| `apps/web/src/pages/CanvasPage.vue` | UI chrome + polling |
| `apps/web/src/components/agent/AgentPanel.vue` | 视觉换肤 |
| `apps/web/src/components/canvas/GenerationBar.vue` | NeoWOW 布局 |
| `packages/agent/src/tools/executor.ts` | 真实 image API 分支 |

---

## 9. 里程碑与交付

### M1: UI Shell（≈1 周）

**交付：**
- NeoWOW design tokens + Element Plus
- `/workflow` 启动器视觉改版
- `/workflow/:sessionId` 三栏 chrome 对齐
- `?sessionId=` 路由恢复逻辑
- GenerationBar / LoginDialog 换肤

**不包含：** 真实图像 API、Canvas 新 API

### M2: Agent Native（≈1 周）

**交付：**
- `apps/server/src/canvas/` 模块（6 个新 API）
- OpenAI 图像生成接入
- Shot/Material Prisma 读写
- 异步生成 + status 轮询
- Agent tool → 持久化闭环

**不包含：** PlayCanvas、视频生成

### M3: Canvas Polish（≈1 周，可选）

**交付：**
- PlayCanvas POC（评估是否替换 Vue Flow）
- GenerationBar @mention 输入
- 语音输入 mock → 真实 Web Speech API
- 像素级截图对比修复

---

## 10. 测试策略

| 层 | 方法 |
|----|------|
| Agent Tools | 单元测试 `packages/agent` executor（mock fetch） |
| Canvas API | NestJS e2e：`/agent/canvas/shot/create` → `status/batch` |
| SSE | 集成测试：conversation 返回 canvas_action 事件 |
| UI | 手动截图对比 NeoWOW；Playwright 可选（M2 后） |
| 降级 | 无 OPENAI_API_KEY 环境跑通 RuleBased 路径 |

**TDD 要求（Superpowers）：** M2 每个新 API 先写 failing test，再实现。

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| PlayCanvas 学习曲线高 | 推迟 M3，M1-M2 用 Vue Flow |
| 图像 API 成本 | env 开关 + 开发环境 placeholder |
| UI 1:1 难量化 | 固定截图对比清单（5 个关键页面状态） |
| NeoWOW 功能持续迭代 | spec 锁定 Phase 1 范围，变更走新 spec |
| Element Plus 与 Tailwind 冲突 | 仅 Dialog/Input/Select 用 EP，布局用 Tailwind |

---

## 12. 参考文档

- `docs/NEOWOW_RESEARCH.md` — 竞品逆向蒸馏
- `docs/PRODUCT_CAPABILITY_MAP.md` — 长期能力路线图
- `packages/agent/` — Agent 框架现有实现
- Superpowers brainstorming 批准记录：2026-07-09，优先级 A+C

---

## Spec 自检（2026-07-09）

- [x] 无 TBD / TODO 占位
- [x] 架构与 API 列表一致
- [x] 范围可在一个 implementation plan 内分解为 M1/M2 任务
- [x] 「A+C」优先级在成功标准、排除项、里程碑中一致
- [x] sessionId URL 行为已明确定义
- [x] 降级策略已定义
