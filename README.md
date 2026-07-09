# 超创平台 (lnkpi)

> AI 无限画布创作工作流平台 — 对标 NeoWOW 产品能力，优先复刻核心功能，后续按自有路线迭代。

## 功能概览

| 模块 | 状态 | 说明 |
|------|------|------|
| 创作启动器 | ✅ | 问候语、创意输入、创建画布、作品瀑布流 |
| 超创站 | ✅ | 社区作品浏览与搜索 |
| 无限画布 | ✅ | 节点式工作流（提示词/图像/视频/文本） |
| 底部生成栏 | ✅ | 多模型选择、语音输入、一键生成 |
| 会话管理 | ✅ | 多画布会话切换 |
| 手机登录 | ✅ | 验证码登录（开发模式固定 123456） |
| AI 生成 | 🟡 | 模拟生成，待接入真实 API |
| 分镜/发布/会员 | ⬜ | Phase 2-3，见 [产品对标文档](./docs/PRODUCT_CAPABILITY_MAP.md) |

## 技术栈

- **前端**: Vue 3 + TypeScript + Vite + Tailwind CSS + Vue Flow
- **后端**: NestJS + Prisma + SQLite
- **包管理**: pnpm monorepo

## 快速开始

```bash
# 安装依赖
pnpm install

# 初始化数据库 & 种子数据
pnpm --filter @lnkpi/server db:push
pnpm --filter @lnkpi/server db:seed

# 启动开发服务（前端 + 后端）
pnpm dev
```

- 前端: http://localhost:5173
- 后端 API: http://localhost:3001/api

## 项目结构

```
lnkpi/
├── apps/
│   ├── web/          # Vue 3 前端
│   └── server/       # NestJS 后端
├── packages/
│   └── shared/       # 共享类型与常量
└── docs/
    └── PRODUCT_CAPABILITY_MAP.md  # NeoWOW 能力对标
```

## 开发说明

- 开发环境验证码固定为 `123456`
- 详细的产品能力对标与分阶段计划见 [docs/PRODUCT_CAPABILITY_MAP.md](./docs/PRODUCT_CAPABILITY_MAP.md)
