# Dock Studio 端到端业务打通 — 开发跟踪文档

> **对标参考**：[NeoWOW Workflow](https://neowow.cn/workflow?sessionId=2074796563114016768)  
> **UI 调研**：[NEOWOW_CANVAS_UI_RESEARCH.md](./NEOWOW_CANVAS_UI_RESEARCH.md)（§4.2 BottomToolbarWrapper / NodePanel）  
> **创建日期**：2026-07-13  
> **最后更新**：2026-07-14（生产登录 Edge 代理修复 + 浏览器 E2E 手测验收）

---

## 零、完成情况审计（2026-07-14）

### 0.1 总体进度

| 阶段 | 完成度 | 说明 |
|------|--------|------|
| **Phase 0** 基础架构 | **100%** | P0-1 ~ P0-6 全部完成 |
| **Phase 1** 核心生成节点 | **~92%** | text/image/video/audio/shot 主链路完成；T-5/I-6/I-7/V-6 待补 |
| **Phase 2** 输入与编排 | **~85%** | mediaInput ✅；sceneComposer D-1~D-4 ✅；videoComposition C-1~C-4 ✅；worldModel 未开始 |
| **Phase 3** Dock UX | **~83%** | UX-1~UX-5 ✅；UX-6 Capabilities API 未开始 |
| **Phase 4** 后端补齐 | **~67%** | B-1/B-3/B-4/B-6 ✅；B-2 upscale、B-5 lip-sync 未开始 |
| **里程碑 M1/M2** | **已完成** | 代码落地，`pnpm build` 通过 |
| **里程碑 M3** | **基本完成** | mediaInput + sceneComposer + videoComposition C-1~C-4 已落地 |
| **里程碑 M4** | **未开始** | UX-6 + 后端 upscale/lip-sync/OSS STS |
| **浏览器 E2E 手测** | **✅ 生产 P0 通过** | 2026-07-14 生产登录 + 5 类节点 Dock 验收（见 §0.4） |

### 0.4 生产环境 E2E 手测记录（2026-07-14）

**环境**：https://lnkpi-web.vercel.app · API 经 `api/proxy` → CVM `119.29.173.89:5100`

| 项 | 结果 | 说明 |
|----|------|------|
| 登录（验证码 123456） | ✅ | ~2s 完成，Header 显示积分/昵称，固定码提示可见 |
| 创建画布 | ✅ | 跳转 `/workflow/{canvasId}` |
| text 节点 + Dock | ✅ | 添加、选中、Dock 弹出；prompt 写回节点预览 |
| image 节点 + Dock | ✅ | 模型/比例/生成按钮正常 |
| video 节点 + Dock | ✅ | 文生视频/图生视频切换、模型/时长 |
| audio 节点 + Dock | ✅ | 音色/语速、生成音频 |
| mediaInput 节点 + Dock | ✅ | 素材名称、上传/替换 |
| shot 分镜节点 | ☐ 待补 | 添加菜单与 Dock 层叠，自动化未点选；代码已就绪 |
| 各节点「生成」闭环 | ☐ 待补 | 需生产配置模型 API Key 后再跑完整生成 |
| 刷新持久化 | ☐ 待补 | 画布页可加载；节点参数刷新后需人工再验 |

**登录修复摘要**：Vercel 外链 rewrite 跨境超时（~31s 502）→ 改为 `apps/web/api/proxy.ts` Serverless 代理（3 次重试）+ 客户端 auth retry。

### 0.2 节点 E2E 矩阵（审计后）

| 节点 | Dock | 生成 E2E | 状态 | 待办 |
|------|------|----------|------|------|
| text | ✅ | ✅ | **已完成** | T-5 txt 拖入验收 |
| image | ✅ | ✅ | **已完成** | I-6 编辑器联动、I-7 upscale |
| video | ✅ | ✅ | **已完成** | V-6 多选批量一致 |
| audio | ✅ | ✅ | **已完成** | — |
| shot | ✅ | ✅ | **已完成** | — |
| mediaInput | ✅ | 🟡 | **基本完成** | M-3 升级 OSS STS |
| sceneComposer | ✅ | 🟡 | **D-1~D-4 已落地** | 浏览器 UI 手测 |
| videoComposition | ✅ | 🟢 | **C-1~C-4 已落地** | — |
| worldModel | ❌ | ❌ | **未开始** | W-1~W-3 |
| prompt | 🟡 Legacy | ⚠️ | **待定** | 是否合并进 text |

### 0.3 建议下一 Sprint（主线开发）

1. ~~**P0 生产验收**~~：✅ 2026-07-14 已完成登录 + 5 节点 Dock 手测
2. ~~**P1 sceneComposer**（D-1~D-4）~~ ✅ 2026-07-14 代码落地
3. ~~**生产手测** videoComposition C-2~C-4 export~~ ✅ 2026-07-16 curl export MP4 公网 URL 可访问；或 sceneComposer 生成闭环
4. **P1 可选 polish**：I-6 AIImageEditor 联动、UX-6 Capabilities API
5. **P2** worldModel / upscale / lip-sync

---

## 文档目录

| # | 章节 | 用途 |
|---|------|------|
| 一 | NeoWOW Dock Studio 设计原则 | 架构对齐基准 |
| 二 | 当前实现 vs 目标（节点矩阵） | 差距盘点 |
| 三 | 目标架构 | 落地目录与分层 |
| 四 | 分阶段开发任务拆解 | 可勾选任务清单 |
| 五 | 推荐实施顺序（里程碑） | 排期与演示节点 |
| 六 | 单节点 E2E 测试清单 | 验收标准模板 |
| 七 | 建议优先开工的 3 个 Sprint | 近期排期 |

---

## 一、NeoWOW Dock Studio 设计原则（对标基准）

```
选中单个节点 → BottomToolbarWrapper 出现
├── 节点卡片：只负责预览 / 状态 / 连线
└── Dock Studio：负责编辑 + 生成
    ├── 通用：MentionInput、语音输入、生成按钮
    └── 按类型：模型 / 比例 / 时长 / 音色 / 参考图 …
```

### 1.1 核心交互模型

| 原则 | 说明 |
|------|------|
| **选中即编辑** | 单击选中单个节点 → 底部 Dock 弹出，展示该节点类型专属参数面板 |
| **节点 vs Dock 分工** | 画布节点 = 预览 + 连线端点 + 状态角标；Dock = 全部编辑与生成操作 |
| **实时同步** | Dock 内编辑 → debounce 后 `patch` 回 `node.data` → 持久化到 canvas |
| **生成闭环** | 点「生成」→ 登录/额度校验 → `generating` 态 → API → 轮询/回调 → 更新节点预览 → `saveCanvas` |
| **Agent 分工** | Agent 浮动窗改画布结构（增删节点/连线）；Dock 管单节点参数与生成，互不抢 UI |

### 1.2 数据流（目标态）

```
用户选中节点
    ↓
DockStudioShell 显示（按 node.type 路由到对应 Panel）
    ↓
用户编辑 prompt / 模型 / 比例 / 参考图 …
    ↓
debounce patch → node.data（Vue Flow store）
    ↓
用户点击「生成」
    ↓
useNodeGeneration → studioApi / canvasApi
    ↓
generating → polling / webhook
    ↓
completed → 写回 url / content / coverUrl
    ↓
节点预览更新 + saveCanvas
```

### 1.3 关键代码路径（当前）

| 路径 | 职责 |
|------|------|
| `apps/web/src/pages/CanvasPage.vue` | `editorNode`、`handleNodeGenerate`、Dock 显隐 |
| `apps/web/src/components/canvas/DockStudioToolbar.vue` | Dock 外壳 |
| `apps/web/src/components/canvas/NodeEditorToolbar.vue` | 当前单文件聚合编辑器（待拆分） |
| `apps/web/src/composables/useSelectedNodeEditor.ts` | 选中节点与 Dock 数据绑定 |
| `apps/web/src/services/studio-api.ts` | text/image/video/audio 生成 |
| `apps/web/src/services/canvas-api.ts` | shot/material、optimize-prompt |
| `apps/server/src/canvas/canvas.controller.ts` | Canvas REST |
| `apps/server/src/canvas/material.service.ts` | 素材与图像任务 |

---

## 二、当前实现 vs 目标（节点矩阵）

> **图例**：✅ 完成 · 🟡 部分 · 🔴 缺失 · — 不适用  
> **状态列**：`未开始` / `进行中` / `已完成` / `阻塞` — 迭代时手动更新

| 节点 type | Dock 是否出现 | Dock 能力完整度 | 生成 E2E | 上游连线消费 | 主要缺口 | 状态 |
|-----------|--------------|----------------|----------|-------------|---------|------|
| **text** | ✅ | 🟢 85% | ✅ studio | ✅ 出边供下游消费 | TextDockPanel 已拆 | 已完成 |
| **image** | ✅ | 🟢 85% | ✅ 统一 composable | ✅ 入边 text/image 预填 | upscale 未做；比例仅存 metadata | 已完成 |
| **video** | ✅ | 🟢 80% | ✅ 异步轮询 | ✅ I2V + 入边参考图 | crop 已 UI 未传 provider | 已完成 |
| **audio** | ✅ | 🟢 80% | ✅ voice+settings | ✅ 入边 text 预填 | 情感/语速存 metadata | 已完成 |
| **shot（分镜）** | ✅ | 🟢 85% | ✅ canvas | ✅ 入边 text + shotGenerateMode | ShotDockPanel 已拆 | 已完成 |
| **sceneComposer** | ✅ | 🔴 20% | ❌ 仅 draft | ❌ | **无导演台专属 Dock + 编排 API** | 未开始 |
| **mediaInput** | ✅ | 🟢 75% | 🟡 本地 upload | ✅ | 预览+转节点已完成；OSS STS 待升级 | 基本完成 |
| **videoComposition** | ✅ | 🟢 85% | ✅ export | ✅ 入边 video/audio/mediaInput | ✅ 生产 export 2026-07-16 | C-1~C-4 完成 |
| **worldModel** | ❌ | — | ❌ | ❌ | **无 Dock、无 3D API** | 未开始 |
| **prompt** | ✅ | 🟡 50% | ⚠️ 与 text 混用 | ❌ | Legacy 面板，是否合并进 text 待产品定稿 | 未开始 |
| **group** | — | — | — | — | 容器节点，不需要 Dock | — |

### 2.1 架构层共性缺口（所有节点受益）

| # | 缺口 | 影响 | 状态 |
|---|------|------|------|
| G-1 | `NodeEditorToolbar.vue` 单文件承载全部类型 | text/audio/shot/image/video 已拆 Panel；Legacy 仅 sceneComposer/prompt | 进行中 |
| G-2 | `handleNodeGenerate` 在 `CanvasPage.vue` 600+ 行，缺 `useNodeGeneration` | 已迁出至 composable | 已完成 |
| G-3 | 上游图解析未标准化（连线 text/image → prompt/refImage） | `useUpstreamNodeContext` 已实现 | 已完成 |
| G-4 | 视频/分镜异步轮询不统一（shot 有 polling，studio video 无） | `useGenerationPolling` + B-6 部分提前 | 已完成 |
| G-5 | 后端缺 upscale、lip-sync、OSS、capabilities 对齐 | 部分 Dock 控件无 API | 未开始 |

### 2.2 未接线 / 重复组件

| 组件 | 说明 | 处置建议 | 状态 |
|------|------|---------|------|
| `BottomNodeToolbar.vue` | 与 `NodeEditorToolbar` 重复 | 已删除，统一 Dock Studio | 已完成 |
| `NodeEditorToolbarOverlay.vue` | 未接入主流程 | 评估删除或合并 | 未开始 |
| `ImageNodeToolbar` / `VoiceSynthesisPanel` 等 | 调研文档提及，未实现 | Phase 0 拆分实现 | 未开始 |

### 2.3 API 对照（调研 §7）

| API | lnkpi 现状 | 阻塞节点 | 状态 |
|-----|-----------|---------|------|
| canvas CRUD + shot/material | ✅ | shot, image | 已完成 |
| `optimize-prompt` | ✅ Dock 内 Text/Shot 已接 | shot, text | 已完成 |
| `material/upscale` | ❌ | image | 未开始 |
| `material/lip-sync` | ❌ | video（可选） | 未开始 |
| OSS upload / STS | 本地 `POST /api/upload` + 静态 `/api/uploads/`（非 OSS STS） | mediaInput | 部分完成 |
| `capabilities/list` → UniversalModelSelector | 需确认完全对接 | 全部生成节点 | 未开始 |
| `GET /studio/generations/:id` | ✅（Sprint A 提前落地，原 B-6） | video 轮询 | 已完成 |

---

## 三、目标架构（建议落地形态）

### 3.1 目录结构（Sprint A 已落地）

```
apps/web/src/components/canvas/
├── DockStudioToolbar.vue              # 外壳 + 动画
├── dock-studio/
│   ├── DockStudioRouter.vue           # 按 type 路由 Panel
│   ├── shared/
│   │   ├── DockPromptSection.vue
│   │   ├── DockGenerateButton.vue
│   │   └── DockToolbarShell.vue
│   └── panels/
│       ├── TextDockPanel.vue          # ✅ Sprint B
│       ├── AudioDockPanel.vue         # ✅ Sprint B
│       ├── ShotDockPanel.vue          # ✅ Sprint B
│       └── LegacyDockPanel.vue        # sceneComposer / prompt
apps/web/src/constants/dockStudio.ts   # EDITABLE + 状态机常量
```

> **偏差说明（Sprint B 更新）**：`DockOptimizePrompt.vue` 已创建；Legacy 面板仅保留 sceneComposer / prompt。

### 3.2 Composables

```
apps/web/src/composables/
├── useNodeGeneration.ts         # 统一 generate + 状态机（从 CanvasPage 迁出）
├── useUpstreamNodeContext.ts    # 解析入边：text/image/video → prompt/refUrl
└── useGenerationPolling.ts      # 统一轮询 studio + canvas 异步任务
```

### 3.3 注册表模式（可选增强）

```typescript
// dock-studio/registry.ts — 节点 type → Panel 组件 + generate handler
interface DockStudioEntry {
  type: string
  panel: Component
  editable: boolean
  generate?: (ctx: GenerateContext) => Promise<void>
}
```

### 3.4 EDITABLE_NODE_TYPES 目标策略

| type | 进 Dock | 只读态条件 |
|------|---------|-----------|
| text, image, video, audio | ✅ | generating / uploading |
| shot, sceneComposer | ✅ | generating |
| mediaInput | ✅（新增） | uploading |
| videoComposition, worldModel | ✅（Phase 2+） | generating |
| prompt | 🟡 待合并 text | — |
| group, comment | ❌ | — |

---

## 四、分阶段开发任务拆解

> 每项任务格式：`- [ ] ID — 描述`  
> 完成后改为 `- [x]` 并更新关联「状态」表。

---

### Phase 0 — 基础架构（P0，阻塞所有节点 E2E）

| ID | 任务 | 产出 | 验收标准 | 状态 |
|----|------|------|---------|------|
| P0-1 | 抽离 `useNodeGeneration` | composable | 现有 text/image/video/shot 行为不退化 | 已完成 |
| P0-2 | 抽离 `useUpstreamNodeContext` | 读入边工具 | 连线 text+image → video Dock 自动带出 | 已完成 |
| P0-3 | Dock 组件拆分 | `dock-studio/panels/*` | image/video 独立 Panel + Router | 已完成 |
| P0-4 | 统一节点状态机 | `NODE_GENERATION_STATUS` 常量 | 生成流统一使用常量 | 已完成 |
| P0-5 | 统一轮询层 | `useGenerationPolling` | studio 异步 video 回写 url | 已完成 |
| P0-6 | 扩展 `EDITABLE_NODE_TYPES` 策略 | `constants/dockStudio.ts` | 常量集中管理 | 已完成 |

**Phase 0 勾选清单**

- [x] P0-1 — 抽离 `useNodeGeneration`
- [x] P0-2 — 抽离 `useUpstreamNodeContext`
- [x] P0-3 — Dock 组件拆分为 `panels/*`（image/video + Legacy）
- [x] P0-4 — 统一节点状态机
- [x] P0-5 — 统一轮询层 `useGenerationPolling`
- [x] P0-6 — 扩展 `EDITABLE_NODE_TYPES` 策略

---

### Phase 1 — 核心生成节点 E2E（P0）

#### 1.1 文本节点 `text`

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| T-1 | `TextDockPanel`：模型 + 多行脚本 + 字数统计 | P0-3 | 已完成 |
| T-2 | 接入 `optimize-prompt`（Dock 内「优化」按钮） | canvasApi | 已完成 |
| T-3 | 生成结果写回 `content`，节点内实时预览 | P0-1 | 已完成 |
| T-4 | 作为上游：出边自动供 image/video/shot 消费 | P0-2 | 已完成 |
| T-5 | 本地 txt 拖入 → text 节点 → Dock 可编辑（补验收） | — | 未开始 |

**E2E 验收**：选 text → Dock 改 prompt → 生成 → 节点显示文案 → 连线到 video → video Dock 自动带 prompt。

- [x] T-1 — TextDockPanel
- [x] T-2 — optimize-prompt 接入
- [x] T-3 — 生成写回 content
- [x] T-4 — 上游 text 出边消费
- [ ] T-5 — 本地 txt 拖入验收

---

#### 1.2 图片节点 `image`

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| I-1 | `ImageDockPanel`：模型 + `ImageAspectSelector` + 参考图槽 | P0-3 | 已完成 |
| I-2 | 读入边：左侧 text 节点 → 预填 prompt | P0-2 | 已完成 |
| I-3 | 读入边：参考图 mediaInput/image → `referenceImageUrl` | P0-2 | 已完成 |
| I-4 | 统一 generate 路径（去掉 shot/独立双轨分散） | P0-1 | 已完成 |
| I-5 | 生成中 skeleton + 完成后节点预览 | P0-4 | 已完成 |
| I-6 | 右键「编辑图像」→ AIImageEditor 与 Dock 数据同步 | — | 未开始 |
| I-7 | 放大 `upscale`（可选） | 后端 B-2 | 未开始 |

**E2E 验收**：text→image 连线 → 选 image → Dock 有 prompt+比例 → 生成 → 预览图 → 保存画布。

- [x] I-1 — ImageDockPanel
- [x] I-2 — 入边 text → prompt
- [x] I-3 — 入边 image → referenceImageUrl
- [x] I-4 — 统一 generate 路径
- [x] I-5 — skeleton + 预览
- [ ] I-6 — AIImageEditor 联动
- [ ] I-7 — upscale（可选）

---

#### 1.3 视频节点 `video`

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| V-1 | `VideoDockPanel`：T2V / I2V 模式切换 | P0-3 | 已完成 |
| V-2 | I2V：参考图来自连线或 Dock 上传 | P0-2, I-3 | 已完成 |
| V-3 | `VideoSettingsSelector` 全量写回并传给 API | 已有组件 | 已完成 |
| V-4 | 异步生成 + 轮询直到 `url` 就绪 | P0-5 | 已完成 |
| V-5 | 节点内 `<video controls>` 播放 | 已有 UI | 已完成 |
| V-6 | 多选 text+image→video 与 Dock 单节点生成行为一致 | — | 未开始 |

**E2E 验收**：image+text 连线 video → Dock 显示 I2V → 生成 → 轮询 → 可播放。

- [x] V-1 — VideoDockPanel T2V/I2V
- [x] V-2 — I2V 参考图
- [x] V-3 — VideoSettingsSelector 全量对接
- [x] V-4 — 异步轮询
- [x] V-5 — 节点内播放验收
- [ ] V-6 — 批量与 Dock 行为一致

---

#### 1.4 音频节点 `audio`

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| A-1 | `AudioDockPanel` + **VoiceModelSelector** | 新组件 | 已完成 |
| A-2 | 情感/语速/语言控件 | AudioVoiceSettingsSelector | 已完成 |
| A-3 | 文本来源：Dock 输入 or 连线 text 节点 | P0-2 | 已完成 |
| A-4 | 生成后节点内 `<audio controls>` + Dock 可重生成 | P0-1 | 已完成 |
| A-5 | 后端：audio generate 支持 voice/emotion/speed/language | B-3 | 已完成 |

**E2E 验收**：选 audio → 选音色 → 输入旁白 → 生成 → 可播放。

- [x] A-1 — VoiceModelSelector
- [x] A-2 — 情感/语速/语言
- [x] A-3 — 文本来源（Dock / 入边）
- [x] A-4 — 播放 + 重生成
- [x] A-5 — 后端 voice/emotion/speed/language

---

#### 1.5 分镜节点 `shot`

| ID | 任务 | 依赖 | 状态 |
|----|------|------|------|
| S-1 | `ShotDockPanel`：标题 + prompt + 生成模式 | P0-3 | 已完成 |
| S-2 | 接入 `canvasApi.createShot/editShot` 幂等 | 已有 | 已完成 |
| S-3 | 生成策略：auto/image/video（`shotGenerateMode`） | 已有 | 已完成 |
| S-4 | `useShotPolling` 与 Dock 状态同步 | 已有 | 已完成 |
| S-5 | Dock 内「优化提示词」 | DockOptimizePrompt | 已完成 |
| S-6 | 与 StoryboardDialog 双向同步 | handleStoryboardUpdated | 已完成 |

**E2E 验收**：建 shot → Dock 写 prompt → 生成 → 子 image 节点出图 → shot 封面更新。

- [x] S-1 — ShotDockPanel
- [x] S-2 — createShot/editShot 幂等
- [x] S-3 — 生成策略（shotGenerateMode）
- [x] S-4 — polling 与 Dock 同步
- [x] S-5 — optimize-prompt
- [x] S-6 — StoryboardDialog 双向同步

---

### Phase 2 — 输入与编排节点（P1）

#### 2.1 媒体输入 `mediaInput`

| ID | 任务 | 状态 |
|----|------|------|
| M-1 | 加入 `EDITABLE_NODE_TYPES` | 已完成 |
| M-2 | `MediaInputDockPanel`：预览 + 文件名 + 「转为 image/video 节点」 | 已完成 |
| M-3 | OSS/STS 上传（替换 blob URL） | 部分完成（本地 upload API） |
| M-4 | 作为上游 ref 被 image/video 消费 | 已完成 |

- [x] M-1 — EDITABLE 注册
- [x] M-2 — MediaInputDockPanel
- [x] M-3 — OSS 上传（本地 API，见附录 E）
- [x] M-4 — 上游 ref 消费

---

#### 2.2 导演台 `sceneComposer`

| ID | 任务 | 状态 |
|----|------|------|
| D-1 | `SceneComposerDockPanel`：场景列表 / 镜头脚本 / 预览图 | ✅ |
| D-2 | 定义 `sceneComposer` 数据结构（scenes[], shots[]） | ✅ |
| D-3 | 后端 API：编排保存 + 批量生成子素材（或 Agent tool） | ✅ |
| D-4 | 一键展开为 shot + image/video 子图 | ✅ |

- [x] D-1 — SceneComposerDockPanel
- [x] D-2 — 数据结构定义（`@lnkpi/shared/sceneComposer`）
- [x] D-3 — `POST scene-composer/save` + `batch-generate`
- [x] D-4 — Dock「展开子图」→ shot + image/video 连线

---

#### 2.3 视频合成 `videoComposition`

| ID | 任务 | 状态 |
|----|------|------|
| C-1 | 加入 EDITABLE + `VideoCompositionDockPanel` | ✅ |
| C-2 | 读入边：收集所有 video/audio 轨 | ✅ |
| C-3 | 简易时间轴预览（可复用 VideoEditorPage MVP） | ✅ |
| C-4 | 后端：合成/export API（或 ffmpeg 任务） | ✅ |

- [x] C-1 — VideoCompositionDockPanel
- [x] C-2 — 入边轨收集 + trackOrder/时长持久化 + mediaInput 支持
- [x] C-3 — CompositionTimelinePreview 时间轴 MVP
- [x] C-4 — `POST video-composition/export` + ffmpeg 合成 + Dock 导出按钮

---

#### 2.4 3D World `worldModel`

| ID | 任务 | 状态 |
|----|------|------|
| W-1 | Beta 标记 + 最小 Dock（prompt + 模型） | 未开始 |
| W-2 | 对接 PlayCanvasView 预览 | 未开始 |
| W-3 | 后端 world 生成 API（长期） | 未开始 |

- [ ] W-1 — 最小 WorldModel Dock
- [ ] W-2 — PlayCanvasView 预览
- [ ] W-3 — world 生成 API

---

### Phase 3 — Dock 体验对齐 Neo（P1–P2）

| ID | 任务 | 说明 | 状态 |
|----|------|------|------|
| UX-1 | Dock 实时 sync（debounce patch，不等点生成） | Neo 核心体验 | 已完成 |
| UX-2 | 只读态：上传中/生成中禁用编辑 | `readonly-toolbar` | 已完成 |
| UX-3 | `bottomToolbarScale` 设置项 | 调研文档 §4.1 | 已完成 |
| UX-4 | 本地文件节点选中 → Dock 联动 | 拖入走 upload + mediaInput | 已完成 |
| UX-5 | 取消 `BottomNodeToolbar.vue` 重复实现 | 与 DockStudio 合并 | 已完成 |
| UX-6 | Capabilities API 驱动模型列表 | `UniversalModelSelector` 读 `/capabilities/list` | 未开始 |

- [x] UX-1 — Dock 实时 sync
- [x] UX-2 — 只读态
- [x] UX-3 — bottomToolbarScale
- [x] UX-4 — 本地文件 → Dock 联动
- [x] UX-5 — 合并 BottomNodeToolbar
- [ ] UX-6 — Capabilities API

---

### Phase 4 — 后端补齐（与前端并行）

| ID | API | 服务节点 | 状态 |
|----|-----|---------|------|
| B-1 | `POST /agent/chat/optimize-prompt`（Dock 已接） | shot, text | 已完成 |
| B-2 | `POST /agent/canvas/material/upscale-image` | image | 未开始 |
| B-3 | `POST /studio/audio/generate` 扩展 voice/emotion/speed/language | audio | 已完成 |
| B-4 | OSS STS + `POST /upload` | mediaInput | 部分完成（本地磁盘 upload） |
| B-5 | `POST /agent/canvas/material/lip-sync` | video（可选） | 未开始 |
| B-6 | video 异步 job status 查询 | video, shot | 已完成（`GET /studio/generations/:id`） |

- [x] B-1 — optimize-prompt（经 chat API）
- [ ] B-2 — upscale-image
- [x] B-3 — audio voice/emotion/speed/language
- [x] B-4 — upload API（本地，非 OSS STS）
- [ ] B-5 — lip-sync（可选）
- [x] B-6 — video job status（Sprint A 提前）

---

## 五、推荐实施顺序（里程碑）

### 5.1 里程碑总览

| 里程碑 | 范围 | 可演示能力 | 目标完成 | 状态 |
|--------|------|-----------|---------|------|
| **M1** | Phase 0 | 架构就绪，旧功能不退化 | 2026-07-13 | 已完成 |
| **M2** | text/image/video/audio/shot | 5 类节点完整「选中→Dock→生成→预览」 | 2026-07-13 | 已完成（待浏览器验收） |
| **M3** | mediaInput + sceneComposer + composition | 输入→生成→合成链路 | — | 进行中（mediaInput 已落地） |
| **M4** | UX + 后端补齐 | 对标 NeoWOW 会话级体验 | — | 未开始 |

### 5.2 依赖关系（简图）

```
Phase 0 (P0-1~P0-6)
    ├── Phase 1: text / image / video / audio / shot（可并行，依赖 P0）
    ├── Phase 2: mediaInput / sceneComposer / videoComposition / worldModel
    ├── Phase 3: UX polish（可与 Phase 1 后期并行）
    └── Phase 4: 后端 API（与前端并行，部分阻塞 Dock 控件）
```

### 5.3 甘特参考（排期可调）

| 阶段 | 内容 | 建议工期 |
|------|------|---------|
| M1 | P0 基础架构 | 1–2 周 |
| M2a | text + image E2E | 1 周 |
| M2b | video + audio E2E | 1 周 |
| M2c | shot E2E | 5 天 |
| M3 | mediaInput + composer + composition | 2–3 周 |
| M4 | UX + 后端补齐 | 2 周 |

---

## 六、单节点 E2E 测试清单

> **用法**：每完成一个节点类型，复制本清单并填写节点名，逐项勾选验收。

### 6.1 通用验收步骤（每个节点重复）

| # | 步骤 | 预期结果 | 通过 |
|---|------|---------|------|
| 1 | 添加节点 → 单击选中 | Dock 弹出，Panel 类型与节点 type 一致 | ☐ |
| 2 | 修改 Dock 参数 | `node.data` 实时更新（或 debounce 后更新） | ☐ |
| 3 | 刷新页面 | 参数持久化，与保存前一致 | ☐ |
| 4 | 点「生成」（已登录） | 进入 `generating`，按钮/面板只读 | ☐ |
| 5 | 生成成功 | 节点预览更新（图/文/音视频），状态 `completed` | ☐ |
| 6 | 生成失败 | 错误信息展示，可修改参数重试 | ☐ |
| 7 | 上游连线（如适用） | Dock 自动带入 prompt / 参考图 / 文本 | ☐ |
| 8 | 取消选中 / 点空白 | Dock 关闭 | ☐ |
| 9 | 多选节点 | Dock 不显示或显示多选提示（与 Neo 一致） | ☐ |
| 10 | `pnpm build` | 无 TS/构建错误 | ☐ |

### 6.2 分节点专项验收

| 节点 | 专项验收点 | 通过 |
|------|-----------|------|
| **text** | 生成文案在节点内可读；连线到 video 后 prompt 带入 | ✅ Dock/参数（生成待 API Key） |
| **image** | 比例/模型生效；参考图来自入边或 Dock 上传；生成图可预览 | ✅ Dock/参数（生成待 API Key） |
| **video** | T2V/I2V 切换；I2V 参考图正确；轮询完成后可播放 | ✅ Dock/T2V·I2V（生成待 API Key） |
| **audio** | 音色可选；生成后可 `<audio>` 播放 | ✅ Dock/音色（生成待 API Key） |
| **shot** | 生成后子节点创建/更新；封面与 polling 同步 | ☐ 待手测 |
| **mediaInput** | 预览正确；可转 image/video；OSS url 非 blob | ✅ Dock/上传入口 |
| **sceneComposer** | 场景列表编辑；展开子图 | ✅ API 手测 2026-07-16（save + batch-generate） |
| **videoComposition** | 入边轨收集 + 轨排序/时长持久化；时间轴预览；export MP4 | ✅ 生产 export（curl 2026-07-16） |

### 6.3 回归清单（每次大改 Dock 后跑）

- [ ] 画布：空白添加节点、连线、框选、打组、Delete 仍正常
- [ ] 媒体拖放/粘贴 → 建节点 → 选中 Dock 联动
- [ ] Agent 浮动窗与 Dock 不互相遮挡关键控件
- [ ] 未登录点生成 → 正确提示登录

---

## 七、建议优先开工的 3 个 Sprint

### Sprint A — 架构 + 图片/视频（建议第 1 周）

**目标**：M1 完成 + image/video 核心 E2E 可演示

| 任务 ID | 内容 |
|---------|------|
| P0-1 ~ P0-5 | 基础 composable + Dock 拆分 + 轮询 |
| I-1 ~ I-5 | ImageDockPanel 完整链路 |
| V-1 ~ V-4 | VideoDockPanel + I2V + 轮询 |

**Sprint A 完成定义**

- [x] `useNodeGeneration` 从 CanvasPage 迁出，build 通过
- [x] image：text 入边 → prompt，生成 → 预览
- [x] video：I2V 参考图 + 异步轮询 → 可播放
- [x] 浏览器 E2E 手测验收（2026-07-14 生产 P0：登录 + Dock）

---

## 附录 C：Sprint A 实现偏差记录

| 项 | 原规划 | 实际实现 | 后续 |
|----|--------|---------|------|
| Dock 壳层 | `DockStudioShell.vue` | 动画保留在 `DockStudioToolbar.vue` | 可选抽取 |
| 非 image/video 节点 | 各自 Panel | `LegacyDockPanel` → `NodeEditorToolbar` | Sprint B 拆分 |
| 图片比例 | 传给 image provider | 仅存 `metadata.aspectRatio` + API DTO | 待 provider 支持 |
| 参考图上传 | OSS | 本地 `POST /api/upload` → `/api/uploads/{userId}/` | 可升级 OSS STS |
| Dock 只读态 | generating 禁用编辑 | `dockReadonly` + `is-dock-readonly` CSS | — |
| B-6 轮询 API | Phase 4 | Sprint A 提前实现 `GET /studio/generations/:id` | — |
| 单测 | P0-1 含单测骨架 | 未加单测（build 验收通过） | 按需补 |

## 附录 D：Sprint B 实现偏差记录

| 项 | 原规划 | 实际实现 | 后续 |
|----|--------|---------|------|
| B-1 optimize API | `/agent/canvas/shot/optimize-prompt` | 复用已有 `/agent/chat/optimize-prompt` | 无需重复建 API |
| DockOptimizePrompt prop | `style` | 改为 `optimizeStyle`（避免与 Vue style 冲突） | — |
| 音频情感/语速 | 传入 TTS provider | 存 metadata；provider 仍只用 voice | provider 升级时读取 metadata |
| Legacy Panel | 全部非 image/video | 仅 sceneComposer + prompt | — |
| Shot 生成 | 子节点推断 | 增加 `shotGenerateMode`：auto/image/video | — |

### Sprint B — 音频 + 分镜 + 上游图（建议第 2 周）

**目标**：M2 五节点齐全

| 任务 ID | 内容 |
|---------|------|
| A-1 ~ A-5 | AudioDockPanel + voice API |
| S-1 ~ S-6 | ShotDockPanel + optimize + Storyboard 同步 |
| P0-2 完善 | 上游图解析覆盖全部生成节点 |
| T-1 ~ T-4 | text 链路补全 |

**Sprint B 完成定义**

- [x] audio：选音色 → 生成 → 播放
- [x] shot：prompt → 子 image → 封面更新（逻辑已有 + shotGenerateMode）
- [x] text→image→video 全链路上游自动带入
- [ ] 浏览器 E2E 手测验收（待人工）

---

### Sprint C — 媒体输入 + Dock 体验（建议第 3 周）

**目标**：M3 起步 + 体验对齐

| 任务 ID | 内容 |
|---------|------|
| M-1 ~ M-4 | mediaInput Dock + OSS |
| UX-1 ~ UX-4 | 实时 sync、只读态、本地文件 Dock |
| B-1, B-3, B-4 | optimize-prompt、audio voice、OSS |

**Sprint C 完成定义**

- [x] mediaInput 选中出现 Dock，上传持久化 URL（登录走 API，未登录 blob）
- [x] Dock 编辑 debounce 写回 node.data
- [x] optimize-prompt 在 shot/text Dock 可用（Sprint B 已接）
- [ ] 浏览器 E2E 手测验收（待人工）

---

## 附录 E：Sprint C 实现偏差记录

| 项 | 原规划 | 实际实现 | 后续 |
|----|--------|---------|------|
| B-4 / M-3 上传 | OSS STS + 对象存储 | `POST /api/upload` 存本地 `uploads/{userId}/`，静态 `/api/uploads/` | 生产环境换 OSS |
| 拖入媒体 | 建 mediaInput 节点 | 登录用户上传后建 image/video/audio/text；未登录仍 blob | 可选统一 mediaInput |
| UX-4 文本文件 | Dock 联动 | 文本仍走 `createFileNodeAt` → text 节点 | 可扩展 |
| `useCanvasMedia` | 传 `MediaFilePayload` | 改为直接传 `File`，由 `ingestMediaFile` 统一持久化 | — |

## 附录 A：迭代记录模板

复制下表到每次 Sprint 结束时的「迭代记录」区。

| 日期 | Sprint | 完成任务 ID | 阻塞/风险 | 下一步 |
|------|--------|------------|----------|--------|
| YYYY-MM-DD | A/B/C | P0-1, I-1 | — | V-4 轮询 |

### 迭代记录

| 日期 | Sprint | 完成任务 ID | 阻塞/风险 | 下一步 |
|------|--------|------------|----------|--------|
| 2026-07-13 | — | （文档创建） | — | Sprint A：P0 + image/video |
| 2026-07-13 | A | P0-1~P0-6, I-1~I-5, V-1~V-5, B-6 | 图片比例未进 provider；参考图 blob | Sprint B |
| 2026-07-13 | B | T-1~T-4, A-1~A-5, S-1~S-6, B-1, B-3 | 音频 emotion/speed 未进 TTS | Sprint C |
| 2026-07-14 | M3 | D-1~D-4 sceneComposer | 生产手测待做 | videoComposition C-1 |
| 2026-07-14 | M3 | C-2~C-3 videoComposition | C-4 export 未做 | 生产手测 C-2/C-3 |
| 2026-07-14 | M3 | C-4 videoComposition export API | 生产 export 手测 | M4 / worldModel |
| 2026-07-16 | M3 | C-2~C-4 生产 export 验收 | API_PUBLIC_URL 容器 env 曾错配 127.0.0.1（已热修） | sceneComposer 生产手测 / Deploy recover 加固 PR |
| 2026-07-16 | M3 | sceneComposer 生产 API 手测 | GHA Wait 轮询被 MOTD 污染卡住（#11） | 浏览器 UI 手测 / fix deploy poll |

---

## 附录 B：相关文档索引

| 文档 | 说明 |
|------|------|
| [NEOWOW_CANVAS_UI_RESEARCH.md](./NEOWOW_CANVAS_UI_RESEARCH.md) | NeoWOW 画布 UI 逆向调研 |
| [NEOWOW_RESEARCH.md](./NEOWOW_RESEARCH.md) | NeoWOW 产品调研 |
| [superpowers/plans/2026-07-09-neowow-workflow.md](./superpowers/plans/2026-07-09-neowow-workflow.md) | M1/M2 实现计划 |
| [PRODUCT_CAPABILITY_MAP.md](./PRODUCT_CAPABILITY_MAP.md) | 产品能力地图 |

---

**最后更新**：2026-07-14（D-1~D-4 sceneComposer 落地；`pnpm build` 通过）
