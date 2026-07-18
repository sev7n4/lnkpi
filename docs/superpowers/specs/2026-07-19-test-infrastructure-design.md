# 测试基础设施（T0 前置）产品与技术规格

> 状态：**待审阅**（§1–§3 已共创确认；实现计划待 `writing-plans`）  
> 日期：2026-07-19  
> 范围：**T0** — 单元 + 服务端集成测试地基，并全量接入 CI；**不含** Playwright E2E / 真库  
> 背景：C1 PR [#25](https://github.com/sev7n4/lnkpi/pull/25) **暂停合并**，本规格作为其前置；合入 main 后再 rebase #25 并按需补 C1 专项用例  
> 关联：`2026-07-19-dock-studio-model-adapter-design.md`（C1）

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 本轮代号 | **T0**（测试地基前置 PR） |
| 覆盖层 | **单元 + Server 集成**；E2E 留 **T2** |
| 测试栈 | **全仓 Vitest**（与 shared/agent 一致） |
| Server Nest | Vitest + `@nestjs/testing`；装饰器经 SWC / 等价转换一次配好 |
| Prisma | **Mock PrismaService**（不启真库） |
| Provider | **Mock** Image/Video/Audio/Text Provider（或等价注入点） |
| Web | Vitest + Vue Test Utils + jsdom；**composable 为主**，少量组件冒烟 |
| CI | `install → prisma generate → build → pnpm test → (PR) docker-build` |
| C1 #25 | 不合并；T0 合入后 rebase #25 |

---

## 1. 目标与非目标

### 1.1 目标

建立可持续的「单元 + 服务端集成」测试地基并接入 CI，保障：

- Controller → Service → Adapter →（mock）Provider 的**参数与 refs 传递正确**
- Web 侧 `useNodeGeneration` 等组装的 **studio-api 请求 payload 齐全**
- CI 对 `shared` / `agent` / `server` / `web` **四包测试全跑**（现仅 agent，且 shared 有测未进 CI）

### 1.2 非目标（T0 明确不做）

| 能力 | 说明 |
| --- | --- |
| Playwright / Cypress E2E | **T2** |
| 真实 Postgres/SQLite 集成库 | **T3**（可选） |
| 部署后业务 API 冒烟扩展 | **T3**；现有 `/api/health` 保留 |
| Web 全量 Dock 组件渲染矩阵 | 超出本轮；仅 composable + 少量冒烟 |
| 为历史全业务补齐测试 | 只保关键路径与地基 |

### 1.3 验收标准

1. 根目录存在 `pnpm test`（`pnpm -r test`），四包均可执行且本地全绿。  
2. `.github/workflows/ci.yml` 在 build 之后运行全仓测试（不仅 agent）。  
3. `apps/server` 可跑至少一组 Studio 集成用例（见 §4）。  
4. `apps/web` 可跑至少一组 `useNodeGeneration`（及 catalog/blob 护栏）用例。  
5. 规格文档含 **后续迭代计划**（§6）；T0 PR 描述中引用本文件。

---

## 2. 架构

### 2.1 测试金字塔（本仓约定）

```text
        ┌─────────────┐
        │  E2E (T2)   │  Playwright：画布关键路径（后置）
        ├─────────────┤
        │ Integration │  Server：@nestjs/testing + mock Prisma/Provider（T0）
        ├─────────────┤
        │    Unit     │  shared / agent / web composables（T0 加固 + CI）
        └─────────────┘
```

### 2.2 Server 集成边界

```text
HTTP DTO (Controller)
  → StudioService
       → resolveMergedPrompt / StudioGenerationAdapter（真逻辑）
       → create*Provider() 或可注入的 Provider 工厂（测试中替换为 mock）
       → PrismaService（测试中 mock：user 积分、generationRecord.create/update）
```

断言重点：传入 mock Provider 的 `model` / `modelId` / `size` / `n` / `options.image` / audio options；写入 record 的 `metadata` 含 AdapterMeta 关键字段。

### 2.3 Web 单元边界

- Mock `studio-api` / `canvas-api` 与 deps（nodes/edges/patch/save）。  
- 调用 `generateForNode`，断言 mock API 收到的参数。  
- 不启动真实 VueFlow / 浏览器。

---

## 3. 文件与 CI 改动

| 路径 | 职责 |
| --- | --- |
| `package.json` | `"test": "pnpm -r test"` |
| `.github/workflows/ci.yml` | build 后 `pnpm test`（覆盖四包） |
| `apps/server/package.json` | `test` + vitest、@nestjs/testing、相关依赖 |
| `apps/server/vitest.config.ts` | Vitest + Nest 装饰器支持 |
| `apps/server/src/studio/studio.integration.test.ts` | Studio 集成用例 |
| `apps/web/package.json` | `test` + vitest、@vue/test-utils、jsdom、@vitejs/plugin-vue（若需） |
| `apps/web/vitest.config.ts` | Vitest + Vue + jsdom |
| `apps/web/src/composables/useNodeGeneration.test.ts` | 生成 payload |
| `apps/web/src/...`（可选） | catalog / blob 护栏小测 |
| 本文档 | 规格 + 后续路线 |

### CI 目标流水线

```text
install → prisma generate → pnpm build → pnpm test → (pull_request) docker-build
```

说明：`paths-ignore` 对 `**/*.md` / `docs/**` 的 push 忽略可保留；**本前置 PR 含代码**，PR 事件仍会跑全量 CI。

---

## 4. 首批用例清单

### 4.1 Server 集成（必须）

1. **Image**：`model` → provider `modelId`；resolution/count → size/n；refs 路径可执行；I2+ 经 suffix 或 metadata **可观测**（禁止静默丢多图）。  
2. **Video**：主参考图 → `options.image`；duration / aspectRatio / resolution 透传。  
3. **Audio**：`model` / `voice` / `speed` / `volume` / `pitch` 进 provider options；能力外字段进 prefix 或 metadata。  
4. **Text**：`resolveModelKey('text')` 后的 `gatewayModelId` 进入 text（或 vision）调用；metadata 含 modelKey / fallback 标志（若触发）。

### 4.2 Web composable（必须）

1. image / video / audio / text 生成时，`studioApi.*` 收到的参数齐全（含 audio `volume`/`pitch`/`model`）。  
2. 非法或旧 modelKey 经 `resolveModelKey` 纠正后再请求。  
3. refs 或 `referenceImageUrl` 含 `blob:` 时阻断生成并写入 error 状态。

### 4.3 已有（必须进 CI）

- `@lnkpi/shared` 现有 vitest  
- `@lnkpi/agent` 现有 vitest（含 adapter / providers）

---

## 5. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| Nest 装饰器在 Vitest 下反射失败 | 首版用 SWC / 官方推荐插件一次配通；失败则文档化备选 |
| Provider 为模块内 `createXProvider()` 难 mock | 测试中优先 mock `@lnkpi/agent` 工厂；必要时小 refactor 支持注入（YAGNI：能 mock 就不改生产 API） |
| Web 测依赖过多 CanvasPage 图 | 只测 `useNodeGeneration`，构造最小 deps |
| CI 时间变长 | 单测保持无网络、无 DB；并行 `-r test` |

---

## 6. 后续迭代计划（记录备查）

> 以下为产品/工程路线，**不在本 T0 PR 实现**。变更时更新本节状态列。

| 轮次 | 名称 | 内容 | 依赖 | 状态 |
| --- | --- | --- | --- | --- |
| **T0** | 测试地基 | 本规格：Vitest 全仓、Server 集成、Web composable、CI 全量 | — | 规格确认中 → 实现 |
| **T1** | C1 合入 | PR #25 rebase 到含 T0 的 main；按需补 C1 专项用例；再 Squash & Merge | T0 合入 | 暂停（#25 待 rebase） |
| **T2** | Playwright E2E | 起 web + api（网关 mock）；画布：选模型/参数/生成/断言请求或节点状态 | T0 | 规划中 |
| **T3** | 可选加固 | 真库 Prisma 集成子集；部署后鉴权 API 冒烟（不止 health） | T0 / T2 | 可选 |
| **C2** | 旁路统一 | shot / scene composer 与 studio 共用参数 + refs | C1 合入后 | 产品规格已拆 |
| **C3** | 视频芯片 | V* 抽帧 / 理解 | C1 后 | 产品规格已拆 |
| **C4** | 音频芯片 | A* ASR / 音色参考（若 provider 支持） | C1 后 | 产品规格已拆 |

### 与 C1 的关系

```text
T0 (本 PR) ──merge──► main
                         │
                         ▼
              rebase #25 (C1) ──CI + 手工清单──► merge C1
                         │
                         ▼
              T2 E2E / C2–C4 按优先级推进
```

---

## 7. 与现状差距（事实）

| 项 | 现状 | T0 后 |
| --- | --- | --- |
| CI 测试 | 仅 `@lnkpi/agent test` | 四包 `pnpm test` |
| shared | 有测、CI 未跑 | CI 跑 |
| server | 无 test 脚本 | Vitest + 集成用例 |
| web | 无 test | Vitest + composable 用例 |
| E2E | 无 | 仍无（T2） |
| 部署验证 | `/api/health` | 不变（T3 再扩） |

---

## 8. 实现交接

规格审阅通过后：

1. `writing-plans` → `docs/superpowers/plans/2026-07-19-test-infrastructure.md`  
2. 新分支（建议 `chore/test-infrastructure-t0`，勿与 #25 混提交）  
3. Subagent-Driven 或 Inline 执行  
4. 独立 PR → CI 绿 → Squash & Merge → 再处理 #25 rebase  
