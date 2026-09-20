# 图片编辑能力统一设计：裁剪 · 抠图 · 点选修改 · 宫格选择器优化

- 日期：2026-09-21
- 状态：待评审
- 级别：Architectural（新子系统 + 现有交互体系重构）

## 1. 背景与目标

lnkpi 画布中的图片节点已具备生成、查看、精修（Refine）、宫格切分（GridSlice）、放大（Upscale）能力，但存在：

1. **三个目标新能力缺失**：裁剪、一键抠图、点选元素并修改（重绘/删除/换背景/扩图）。
2. **现有交互体系边界混乱**（见 §2 审计）：入口重复、双轨实现、面板膨胀。
3. **商业化缺位**：免费/付费无清晰边界，无免费额度机制。

目标：新增三能力的同时，统一图片类交互的入口、容器与商业化边界。**免费优先**——前端算力可覆盖的能力零边际成本无限供给，仅 AI 生成类操作消耗积分。

### 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 产品定位 | 画布内图片节点编辑，不建独立页面 |
| 成本边界 | 裁剪/抠图/点选分割纯浏览器端免费；AI 修改类调用服务端按次扣积分 |
| 修改能力范围 | 完整操作菜单：描述重绘、删除元素、抠出为素材、换背景、扩图 |
| 容器 | 复用 Refine 精修模式作为唯一编辑容器，不新建全屏编辑器 |
| 宫格选择器 | 下拉预设菜单改为 7×7 悬浮格子选择器（悬停高亮、单击切分、支持非正方形） |

## 2. 现状审计（基于代码）

### 2.1 现有资产

| 组件 | 职责 | 状态 |
|---|---|---|
| `CanvasNodeImage.vue` | 图片节点，hover 悬浮按钮 6 个（预览/替换/下载/存资产库/编辑/ⓘ），双击开灯箱 | 按钮过载 |
| `MediaPreviewOverlay.vue` | 灯箱：查看/下载/更多信息，**无编辑入口** | 死胡同 |
| `MediaInspectorDrawer.vue` | 信息抽屉：元信息/诊断/引用/定位 | 只读，保留 |
| `SelectionActionBar.vue` | 单击选中后节点上方操作条：宫格裁剪▾ + 放大 + 编辑 | 入口重复 |
| `CanvasContextMenu.vue` | 右键菜单：放大/编辑图像/引用/副本/删除 | 与选中条重复 |
| Refine 体系 | `RefineWorkViewport` + `RefineSidePanel`（1149 行）：mask 六件套（brush/eraser/rect/wand/polygon/point）、MediaPipe magic_touch 点选分割、重绘链路、VersionStrip、CompareView/Lightbox、apply/revert | 核心复用资产 |
| GridSlice 体系 | `GridSliceDropdown` + `GridSliceWorkbench`（WorkViewport + SidePanel），正方形预设 2×2~7×7 + 自定义对话框 | 选择器需优化 |
| `useImageUpscale` | 放大 2×，一键 action 无工作台 | 入口重复 |
| `canvasEditor` store | refine 相关状态 15+ 个，含 docked/floating 双 chrome | 状态膨胀 |

### 2.2 问题清单

- **P1 入口分裂**：「编辑」存在三处入口（hover chip / 选中条 / 右键菜单），「放大」两处；双击最自然的动线进灯箱后是死胡同。
- **P2 分割双轨**：`mediapipeSegment`（MediaPipe magic_touch）与 `pointSegmentSession` 两套点选分割并存，双份维护。
- **P3 面板膨胀**：`RefineSidePanel.vue` 1149 行，新增裁剪/抠图/操作菜单前必须拆分。
- **P4 chrome 双模式**：Refine floating（可拖拽/调宽/折叠）状态成本高、价值低。
- **P5 Workbench 平行实现**：Refine 与 GridSlice 两个工作台结构同构但代码独立，`CanvasPage` 中 `refinePanelNode`/`gridSlicePanelNode` 互斥逻辑已耦合。
- **P6 商业化无信息位**：仅有 `estimateImageCredits` 积分预估，无免费额度概念与展示。
- **P7 宫格选择器**：仅正方形预设，非正方形需两步自定义对话框，纯文字菜单不直观。

## 3. 统一交互设计

### 3.1 操作分类原则（核心）

按**产出物**分类，而非按钮位置：

| 类型 | 判据 | 归属 | 操作 |
|---|---|---|---|
| 一键型 | 免交互、单次点击出结果 | `SelectionActionBar` | 放大（积分）、宫格裁剪（格子选择器）、一键抠图（免费）、下载、存资产库 |
| 编辑型 | 需要交互过程（选区/画笔/参数） | Refine 工作台 | 裁剪、mask 微调、点选修改四操作 |
| 切分型 | 产出多个子节点 | GridSlice 工作台 | 宫格切分（保持独立工作台） |
| 查看/信息 | 只读 | 灯箱 / 信息抽屉 | 预览、下载、元信息 |

### 3.2 入口动线（去重规则：每操作最多一个快捷入口 + 一个全量入口）

- **节点 hover**：收敛为 3 个按钮——预览 / 替换 / ⓘ（替换因上传机制内聚在节点组件而保留；下载、存资产库、编辑 chip 移除——前两者入选中条与右键/灯箱，编辑由单击选中条承担）。
- **单击选中** → `SelectionActionBar`（三组六单元，图标+短文字混合，见 3.2.1）：宫格裁剪（格子选择器）│ 一键抠图（免费，M2 点亮）+ 放大（积分角标）+ 编辑 │ 下载 + 存资产库。
- **双击** → 灯箱（升级为查看 hub）：顶栏 = 编辑(primary) + 下载 + 更多信息 + 关闭。
- **右键菜单** = 全量入口：编辑图像、放大、宫格裁剪、替换、下载、存资产库、副本、删除。
- 灯箱「编辑」与选中条「编辑」→ 同一动作：进入 Refine 工作台。

#### 3.2.1 SelectionActionBar 设计细则（图标化 + 克制）

```
[⊞ 宫格▾] │ [✂ 抠图] [⤢ 放大 ¤2] [✎ 编辑] │ [⬇] [⊕ 存库]
   切分组        AI 一键组（免费/积分/容器入口）      文件组
```

- **结构**：三个视觉分组，分隔线隔开；≤6 个视觉单元 + 1 个下拉，超出的低频操作一律归右键菜单——不重演节点按钮过载。
- **图标/文字混合原则**：高频操作（宫格、抠图、放大、编辑）图标 + 短文字；低频操作（下载、存库）纯图标 + tooltip。不做纯图标条（认知负担大）。
- **所见即所得**：宫格悬停即见 7×7 格子选择器；抠图单击直接产出透明素材（toast + 入素材面板）；放大单击直接出 2×。一键型操作全部零参数零确认。
- **积分可见性**：放大按钮带积分角标（复用 DockCreditBadge 数值），免费操作（抠图）不带——免费/付费在入口处即可分辨。
- **降级规则**：抠图在引擎未就绪（M1）或模型未缓存且离线时隐藏该位（不出现灰色死按钮）；放大在 `imageUpscale=false` 时同现状禁用。
- **缩放适配**：选中条挂在节点坐标系随 viewport 缩放（现状行为保留）；缩放 <0.5 时文字标签自动隐藏、只留图标（保证低缩放可点性）。

### 3.3 Refine 面板信息架构（400px docked，冻结 floating，移动端全屏）

```
┌───────────────────────────────┐
│ 头部：今日免费 AI 2/3 · 余额 128 分    │ ← 新增，复用 DockCreditBadge 样式
├───────────────────────────────┤
│ 工具条：点选分割 │ mask 族 │ 裁剪 │ 一键抠图 │ │ ← 并入现有 refineTool 族
├───────────────────────────────┤
│ 上下文区：选中元素 → 操作菜单           │ ← 重绘20/删除15/换背景20/扩图30 分
│          未选中 → 抠图/导出素材入口      │
├───────────────────────────────┤
│ 版本区：VersionStrip + Compare + 应用  │ ← 现有能力不动
└───────────────────────────────┘
```

裁剪产出单图新版本走 VersionStrip；点选修改四操作做成现有 `editIntents` 机制的扩展 preset；「抠出为素材」产出透明 PNG 入 `CanvasAssetPanel`。

### 3.4 宫格格子选择器（优化 GridSliceDropdown）

- 交互：点击「宫格裁剪」弹出 **7×7 格子阵**（28px 单元格），悬停高亮左上子矩形，底部实时标签「3 × 2 · 共 6 张」，**单击即切分**；Esc/点击外部关闭。
- 支持非正方形（2×3、3×4 等）；2×2/3×3 快捷位常驻浅色标记。
- 触屏降级：第一次点选高亮、第二次确认。
- 底部保留「精确输入…」对话框（>7 或指定比例），复用现有 `open-custom`。
- 事件契约：`quick-slice(n: number)` → `slice(cols: number, rows: number)`；`runGridSlice` 子节点元数据 `{cols, rows}` 本就独立，服务端与切分逻辑零改动。
- 移除 `GRID_SLICE_SQUARE_PRESETS` 纯文字菜单。

### 3.5 组件边界总表

| 组件 | 负责 | 不负责 |
|---|---|---|
| 节点 hover 按钮（3个） | 快捷：看/换/查 | 编辑操作（归选中条）、下载/存库（归选中条） |
| SelectionActionBar | 一键型操作 + 编辑入口 + 文件快捷（下载/存库） | 交互过程（替换/裁剪/mask 等） |
| 灯箱 | 查看 hub、编辑入口、下载 | 元信息（转抽屉） |
| 信息抽屉 | 元信息/诊断/引用 | 编辑、预览 |
| Refine 工作台 | 所有编辑型操作 + 版本 + 积分交互 | 节点管理、一键操作 |
| GridSlice 工作台 | 切分型操作 | 单图编辑 |
| `@lnkpi/image-editor` 引擎包 | 模型加载/crop/抠图/分割/导出纯逻辑 | UI、状态、API |

## 4. 前端架构

### 4.1 新增包 `@lnkpi/image-editor`（框架无关引擎层）

```
packages/image-editor/src/
├── model-registry.ts    # 模型清单/懒加载/Cache Storage 缓存/进度回调
├── crop/                # 裁剪几何计算（比例锁定、旋转、三分线）
├── matting/             # U²-Net int8 (~40MB) via onnxruntime-web，主体抠图
├── segment/             # 统一点选分割接口；MediaPipe magic_touch 迁入，收敛 pointSegmentSession 双轨
├── mask/                # mask 位图操作（增/减/羽化/导出 PNG）
└── export/              # 透明 PNG / 新版本图导出
```

- 模型文件走 jsDelivr CDN，CVM 零带宽压力；int8 量化；首装 ~5-10s 带进度条。
- 引擎不含 UI/状态/API，由 `MaskEditor`/`RefineSidePanel`/`SelectionActionBar` 消费。
- **状态机约束**（项目教训）：所有初始化（模型/解码）完成后再置 running，全程 try/catch 兜底回落 idle。

### 4.2 重构项

| 项 | 内容 |
|---|---|
| `RefineSidePanel` 拆分 | 1149 行 → `RefineHeader`（含免费额度位）/ `RefineToolbar` / `CropToolPanel` / `MattingToolPanel` / `OpMenuPanel` / `RefineVersionArea` |
| 分割收敛 | `mediapipeSegment` + `pointSegmentSession` → 引擎 `segment/` 统一接口，UI 只认接口 |
| chrome 冻结 | Refine floating 模式下线（保留 docked），清理 `refineChrome/refinePanelWidth/refinePanelCollapsed/refinePanel*` 相关 store 状态 |
| WorkbenchShell 抽取 | 统一 WorkViewport + SidePanel + 面板互斥骨架，Refine 与 GridSlice 迁移至同一外壳；`CanvasPage` 互斥逻辑收敛 |
| 入口改造 | `CanvasNodeImage` hover 收敛 3 按钮；灯箱加编辑；右键菜单去重；`SelectionActionBar` 图标化三组改造（宫格/抠图/放大/编辑/下载/存库，见 3.2.1） |

## 5. 后端设计（NestJS `MediaEditModule`）

```
POST /api/media/edit
  body: { shotId | imageBase64, maskPng, action: inpaint|remove|rebg|expand, prompt? }
  流程: 鉴权 → 校验积分/免费额度 → 预扣 → OpenAI images/edits (gpt-image-1, 1024px, n=2)
        → 候选入 storage → 落库 MediaEditTask → 返回候选
  失败/超时: 事务内自动返还
```

- 复用现有 `points` / `membership` / `storage` / `upload` 模块，不新造轮子。
- 护栏：每用户 1 并行任务；单图 ≤10MB 且 ≤4096px；mask 面积 <1% 或 >95% 拒绝；每日免费 AI 额度 3 次（服务端计数，防刷）。
- 免费额度接口：`GET /api/media/edit/quota` 返回 `{ freeUsed, freeLimit, pointsBalance }`，面板头部消费。

## 6. 商业化设计

| 层级 | 内容 | 定价 |
|---|---|---|
| 免费（无限） | 裁剪、一键抠图、点选分割、抠出素材、导出 ≤2K、撤销历史 | 0 |
| 免费额度 | AI 四操作每日 3 次 | 0（拉新钩子） |
| 积分 | 重绘 20 / 删除 15 / 换背景 20 / 扩图 30（分） | 成本加成 ~8 倍¹ |
| 会员 | 导出 4K、批量、优先队列、每月赠积分 | 挂现有会员套餐 |

¹ gpt-image-1 medium ≈ ¥0.30/张；若 1 分 ≈ ¥0.02 则重绘 20 分 ≈ ¥0.4，毛利率 25-50%，上线后按真实用量校准。不满意的候选不应用 → 返还一半积分。

## 7. 数据模型

Prisma 新增：

```prisma
model MediaEditTask {
  id            String   @id @default(cuid())
  userId        String
  shotId        String?
  action        String   // inpaint | remove | rebg | expand
  prompt        String?
  status        String   // pending | done | failed | applied | rejected
  costPoints    Int
  freeQuotaUsed Boolean  @default(false)
  candidateUrls Json?
  appliedAt     DateTime?
  createdAt     DateTime @default(now())
}
```

## 8. 排期

| 里程碑 | 内容 | 特性 |
|---|---|---|
| M1 | 入口统一（hover 收敛/灯箱编辑/右键去重）+ 宫格格子选择器 + `WorkbenchShell` 抽取 + chrome 冻结 | 纯重构 + 宫格优化，零模型风险 |
| M2 | `@lnkpi/image-editor` 引擎包 + 裁剪 + 一键抠图（素材导出） | 免费 |
| M3 | `MediaEditModule` + 积分闭环 + 点选修改四操作 + RefineSidePanel 拆分 | 商业化核心 |
| M4 | 会员档 + 批量 + 免费额度数据看板 + 定价校准 | 增长 |

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| U²-Net/MediaPipe 许可证 | U²-Net Apache-2.0、MediaPipe Apache-2.0，商用安全；引入前复核 LICENSE |
| 低端设备 WASM 推理慢（3-8s） | int8 量化 + 进度提示 + IndexedDB 结果缓存；检测 `navigator.hardwareConcurrency` 降级提示 |
| 模型首载流量 | jsDelivr CDN + Cache Storage 永久缓存 + 首载仅在用户触发功能时 |
| 明文 HTTP 入口安全上下文限制 | 复用 `randomId` 范式，WASM/Cache 能力检测降级（`http://119.29.173.89:8888` 下免费能力部分不可用，引导 HTTPS 入口） |
| OpenAI edits 成本失控 | 每用户并行数 1 + 免费额度服务端计数 + 积分预扣事务 |

## 10. 验收要点

1. 双击图片 → 灯箱 →「编辑」→ Refine 打开，动线一气呵成。
2. 选中图片节点 → 操作条 → 宫格裁剪悬停 3×2 → 单击 → 6 个子节点落位。
3. Refine 内：裁剪 → 新版本入 VersionStrip；一键抠图 → 透明素材入资产面板；点选人物 → 操作菜单「换背景」→ 2 候选 → 应用 → 画布节点更新，积分扣减正确。
4. 免费额度 3 次用尽后操作菜单显示积分价；积分不足 → 升级引导。
5. 失败任务积分自动返还；每日免费计数跨天重置。
