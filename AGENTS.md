# Agent 开发规范

本项目默认遵循 superpower skills 定义的标准开发流程。

## 核心流程规则

- **任何创造性工作前**（新建功能、组件、行为修改）：必须先调用 `brainstorming` skill 探索意图和设计方案
- **遇到 bug 或异常行为**：必须先调用 `systematic-debugging` skill 进行系统性排查，再动手修复
- **提交代码或创建 PR 前**：必须调用 `verification-before-completion` skill 验证通过
- **开始实现计划前**：优先调用 `writing-plans` skill 编写任务计划
- **需要分支管理时**：调用 `using-git-worktrees` skill 确保隔离工作区

## Skill 调用优先级

```
brainstorming / systematic-debugging  (流程类)
    ↓
writing-plans / subagent-driven-development  (规划类)
    ↓
verification-before-completion  (收尾类)
    ↓
finishing-a-development-branch / requesting-code-review  (提交类)
```

## 跳过规则

用户明确指示跳过、或 skill 明显不适用当前任务时，可跳过。但不得以"这只是个小改动"为由跳过流程类 skill。

## 分支保鲜规则（2026-09-18 增补）

经过 2026-09-18 清理 stale 分支的实战教训，新增以下规则：

### 原则
**任何本地分支必须主动推进，长期挂起 = 隐性技术债。**

### 细则

1. **保鲜窗口**：分支创建后 **14 天** 内必须有 commit + push 动作
2. **过期判定**：以下任一情况触发 stale 状态：
   - 创建超过 14 天无任何 commit
   - 创建超过 14 天无任何 push
   - `ahead origin/main == 0` 且 `behind origin/main > 30`
3. **处置选项**（按优先级）：
   - **merge**：功能完整、设计已确认
   - **rebase + push**：仅落后未冲突
   - **archive**：保留设计文档归档，删除分支
   - **discard**：明确输入 "discard" 关键词才执行

### 自动化建议（待办）

- [ ] CI 中加 `git branch --sort=-committerdate` 检测 14 天未动分支
- [ ] 周报中列出 ahead/behind 比例异常的分支
- [ ] worktree 超过 30 个触发告警

### 实战经验

> 2026-09-18 清理发现：7 个分支中 5 个是已被 main 覆盖的废弃分支，2 个是 base 老化的"假独有"。根本原因是：**分支创建后未与 origin/main 同步，也未与团队沟通设计方向**。

> 教训：分支创建应该立即设置"目标 PR"和"过期日"，否则容易变成孤儿。

## 项目 GitHub 工作流规范（lnkpi 特有，继承自 pintuotuo）

针对本 monorepo 适配，补充 superpower skills 未覆盖的项目特定规则。

### 硬约束

1. **禁止直接 push 到 main** — 必须走 feature 分支 + PR
2. **禁止跳过本地验证** — 提交前必须 `pnpm build` 通过
3. **PR 创建后监控 CI**（`.github/workflows/ci.yml`）**全绿再合并**
4. **合并使用 Squash & Merge**

### 分支命名

`{type}/{short-description}`

- `type` 取值：`feature` | `fix` | `enhancement`（参考已有分支命名习惯）
- 示例：`feature/scene-composer-d1-d4`、`fix/agent-confirm-loop-hardening`

### 本地验证（提交前必跑）

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/agent test
```

### PR 模板

- **Summary**：本次改动做了什么、为什么
- **Test plan**：验证步骤清单（必勾本地验证 4 条）

### 合并后自动部署

| 部署目标 | 触发 |
|---|---|
| CVM API（server / agent-runtime） | `deploy.yml` workflow on push to main |
| Vercel 前端（web） | Vercel 监听 main push 自动部署 |

## 规格书配图规范（强制，2026-09-22 生效）

来源实践：WorkbenchShell + 扩图打样 spec。完整规范见 **`docs/superpowers/SPEC-CONVENTIONS.md`**。

### 硬约束

1. **图与文字同权**：涉及**前端 UI 布局、组件形状尺寸、架构槽位、交互流程、状态机、判据决策**的规格，必须配图；缺图视为规格不完整。
2. **两分法**：能用文字结构（节点 + 关系 + 标签）表达的图 → **Mermaid 内嵌**在 spec 里；依赖真实空间/比例/形状的视觉稿 → **自绘 SVG** 放文档同目录 `assets/`，相对路径引用。
3. **禁止贴截图**（png/jpg/gif）当设计稿；禁止把能内嵌的图导出成附件。
4. **每张图必须**：有编号（图 1、图 2…连续唯一）、有图注（写清"说明了什么、怎么用"）、在正文被引用。
5. **含图的文档必须有 §0 配图索引**，登记全部图号 / 形式 / 位置 / 验收用途。
6. **提交前必跑**：`pnpm verify-spec-figures`（校验 R1–R8，退出码非 0 即不合格）。

### 写作顺序

先写判据正文 → 按判据决定图的有无 → 路由选图形式 → 编号 + §0 索引 → 图注 + 正文引用 → 跑校验 → 评审。

> 已有同类规范的位置：本文档（工程流程）+ `SPEC-CONVENTIONS.md`（配图细则，含骨架模板与反模式清单）。

### 与 superpower skills 的协同

| 阶段 | 用 superpower skill | 配套本规范 |
|---|---|---|
| 创意/需求 | `brainstorming` | — |
| 规划 | `writing-plans` | — |
| 编码 | `test-driven-development` | 提交前必跑本规范本地验证 4 条 |
| 提交 | — | 按本规范创建分支 + PR |
| 收尾 | `verification-before-completion` + `finishing-a-development-branch` | CI 全绿 + Squash Merge |
