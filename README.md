# 超创平台 (lnkpi)

> AI 无限画布创作工作流平台 — 深度对标 NeoWOW，AI Native Agent 全面驱动画布。

## 核心架构

```
用户自然语言 → Agent 对话 (SSE) → Canvas Tools → 画布实时更新
                     ↓
              OpenAI / 规则引擎
                     ↓
         create_shot / generate_image / generate_video / ...
```

## 功能概览

| 模块 | 状态 | 对标 NeoWOW |
|------|------|------------|
| 创作启动器 | ✅ | `/workflow` |
| 无限画布 + 分镜节点 | ✅ | `WorkflowCanvas` |
| **Agent 驱动画布** | ✅ | `/agent/chat/conversation` |
| Canvas API (6 端点) | ✅ | `/agent/canvas/*` |
| 图像生成 Provider | ✅ | OpenAI / Placeholder 降级 |
| Shot/Material 持久化 | ✅ | Prisma + 轮询 |
| PlayCanvas POC | ✅ | 3D 画布评估模式 |
| @mention 输入 | ✅ | `MentionInput.vue` |
| 语音输入 | ✅ | Web Speech API |
| Agent 工具链 (8 tools) | ✅ | Canvas Domain API |
| SSE 流式对话 | ✅ | 流式 Agent 回复 |
| 三栏布局 (会话/画布/Agent) | ✅ | SessionSelector + Canvas + Chat |
| 底部生成栏 + 模型选择 | ✅ | GenerationBar |
| 手机验证码登录 | ✅ | LoginDialog |
| 社区作品流 | ✅ | NeoTV |

## 技术栈

- **前端**: Vue 3 + TypeScript + Vite + Tailwind + Vue Flow
- **Agent**: `@lnkpi/agent` — 原生 Tool-Calling Agent 框架
- **后端**: NestJS + Prisma + SQLite + SSE
- **对标调研**: [NeoWOW 深度调研](./docs/NEOWOW_RESEARCH.md)

## 快速开始

```bash
pnpm install
pnpm --filter @lnkpi/server db:push
pnpm --filter @lnkpi/server db:seed
pnpm dev
```

- 前端: http://localhost:5173
- 后端: http://localhost:3001/api
- 开发验证码: `123456`

## Agent 配置

```bash
# .env — 配置后自动切换为 OpenAI Agent（否则使用规则引擎）
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_CHAT_MODEL=gpt-4o
OPENAI_IMAGE_MODEL=dall-e-3
```

## Agent Native 验收 (M2)

1. 登录：`13800000000` / 验证码 `123456`
2. 打开 `/workflow`，输入创意创建画布
3. 在 Agent 面板输入「创作赛博朋克城市夜景」→ 应出现分镜 + 图像节点
4. 刷新页面 → 节点持久化保留
5. Canvas API 测试：`bash apps/server/scripts/test-canvas-api.sh`

无 `OPENAI_API_KEY` 时使用 RuleBasedAgent + Unsplash 占位图，功能仍可验收。

## Phase 2 验收 (M4)

1. 画布底部生成栏输入 prompt → 自动创建分镜 + 异步生成图像
2. 工具栏「分镜」→ 打开分镜面板浏览所有 shot
3. 工具栏「发布」或 `/workflow` 页「发布作品」→ 发布到社区
4. 刷新 `/workflow` → 新作品出现在列表

## 项目结构

```
lnkpi/
├── apps/web/              # Vue 3 前端
├── apps/server/           # NestJS 后端 (/agent/* API)
├── packages/agent/        # AI Native Agent 框架 + Canvas Tools
├── packages/shared/       # 共享类型 (Shot/Material/CanvasAction)
└── docs/
    ├── NEOWOW_RESEARCH.md          # 竞品深度调研
    └── PRODUCT_CAPABILITY_MAP.md   # 能力对标路线图
```
