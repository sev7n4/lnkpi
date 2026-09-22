# 工作台统一外壳（WorkbenchShell）+ 扩图打样 · 设计规格

状态：待评审（brainstorming 产出，2026-09-22）
前置：2026-09-21-refine-studio-layout-rework-design.md（已上线）、2026-09-22-refine-m2-capability-pack-design.md
打样分支约定：实现走 feature 分支 + PR + squash merge（仓库硬约束）。

## 1. 目标

1. **工具链统一规范**：把「精修工作台」的信息架构固化为可复用的外壳（Shell）+ 工具注册契约，后续每个工具（抠图 / 切图 / 超分……）按契约接入，而不是再长一套固定框架。
2. **扩图完整打样**：按 2026-09-22 竞品截图（即梦式扩图）复刻画布交互（角圆 / 边胶囊 8 手柄、拖拽 3×3 网格、松手确定范围、可多次操作），并落地差异化的右栏参数面板与悬浮 dock。
3. **下线右栏固定框架**：`RefineToolbox` 能力组占位从右栏滚动区移除，能力入口迁入左栏图标栏。

## 2. 范围

### 2.1 本包做（纯 `apps/web`，可独立验收上线）

- `WorkbenchShell.vue` 通用外壳 + `workbenchToolRegistry` 注册契约（以精修工作台为第一个消费者）。
- 扩图（`refineMode === 'outpaint'`）全链路打样：画布手柄 / 网格 / 读数 / 右栏 `OutpaintPanel` / 悬浮 dock。
- 精修（`select`）模式：仅去掉 Toolbox、工具参数保持现状，dock 仍为面板底部常驻。
- 左栏 rail 增加能力区（Toolbox 能力组迁移，禁用占位 + 扩图激活项）。
- store / 几何纯函数配套改动（见 §7、§8）。

### 2.2 本包不做

- 能力组（抠图 / 裁剪 / 宫格切分 / 旋转翻转 / 局部重绘 / 消除替换 / 超分 / 增强）的实际实现 —— 仍归 M2 能力包，本包只搬入口。
- `GridSliceWorkbench` 迁移到 Shell —— 下一个包（验证契约复用性）。
- 扩图「张数」选择器 —— 后端一次一张，等批量能力包（竞品有，先不做，YAGNI）。
- 方向快捷键（↑↓←→ 点击扩 25%）、Alt 对称拖、手柄旁尺寸浮标 —— P2，记录后续。
- 后端 / API 任何改动 —— 扩图提交链路（`refineOutpaintRect` → `computeOutpaintLayers` → `renderOutpaintPngs`）不动。

## 3. 与既有规格的关系（显式修订，避免两份规格打架）

| 既有裁决 | 本包处置 |
|---|---|
| layout-rework **P0-1**「右栏三段式：对照预览固定 → 工具箱（唯一滚动区）→ dock 常驻」 | **修订**：骨架保留（对照固定 + 滚动区 + dock 槽位），但滚动区内容从「工具箱」改为「按激活工具注册的参数面板」；dock 槽位支持 `panel` / `floating` 两种落点 |
| layout-rework **P0-9**「工具参数放画布顶部模式条」 | **就扩图推翻**（用户 2026-09-22 拍板）：扩图参数进右栏面板（与拖拽双向同步）；`select` 模式的工具参数（笔刷 / 容差）仍留模式条，不动 |
| capability-pack「能力组占位在右栏 Toolbox」 | **修订**：占位入口迁至左栏 rail 能力区；能力实现归属不变 |

## 4. 信息架构规范（工具链统一规范，后续工具强制遵循）

工作台 = **三区一骨架**，职责唯一：

| 区 | 职责 | 放什么 | 不放什么 |
|---|---|---|---|
| 左栏 Rail | 工具 / 模式入口 | 图标 + tooltip + 激活态；选区组、扩图、对照、适配、能力区（禁用占位） | 任何参数控件 |
| 右栏 Panel | 上下文与结果 | 头部对照区（固定资产）+ 当前工具参数面板（滚动）+ 版本条（固定资产） | 工具入口图标、生成按钮 |
| Dock | 生成动作 | 提示词（可选）、模型、积分、主 CTA | 参数面板内容 |
| Shell 骨架 | 布局与层级 | header / 分割线 / 滚动 / 折叠逻辑 | 任何业务内容 |

**注册契约（三件套）**：

```ts
// apps/web/src/components/canvas/workbench/workbenchToolRegistry.ts
export interface WorkbenchToolRegistration {
  id: string                       // 'refine-select' | 'refine-outpaint' | …
  railItems?: RailItemDescriptor[] // 左栏图标（可选；select 模式的图标由现有 rail 分组承担）
  panel: Component                 // 右栏滚动区参数面板
  dockPlacement: 'panel' | 'floating'
  dock?: Component                 // 缺省复用共享 Dock 原子件拼装
}
```

规则：**不注册就没有 UI**。右栏滚动区只渲染注册表中当前激活工具的 `panel`，杜绝再出现「固定框架」。

## 5. WorkbenchShell 架构

```
components/canvas/workbench/
├── WorkbenchShell.vue          外壳：header 槽 + rail 槽 + viewport 槽 + panel(固定头/滚动槽/版本条槽) + floating-dock 槽
└── workbenchToolRegistry.ts    注册契约 + refine 两个工具的注册表
```

- `RefineWorkbench.vue` 改为 Shell 的第一个消费者：按 `editor.refineMode` 从注册表取 `panel` 与 `dockPlacement` 渲染。
- Shell 只管布局与折叠（复用 `useWorkbenchPanel` 的宽度 / 折叠 / 窄屏逻辑），不含业务状态。
- `RefineSidePanel.vue` 瘦身为「右栏骨架 + select 模式编排」（Teleport、header、对照带、`<component :is>` 面板、dock 槽位）；扩图逻辑继续外移到 `OutpaintPanel` / `RefineOutpaintCanvas` / 悬浮 dock。

## 6. 扩图打样规格

### 6.1 画布交互（`RefineOutpaintCanvas.vue`）

| 项 | 规格 |
|---|---|
| 8 手柄形状 | 角手柄 = 圆形 16px（`border-radius:50%`）；边手柄 = 胶囊 32×16（横边水平胶囊、竖边垂直胶囊）。命中区外扩 ≥4px。`data-testid="outpaint-handle-{dir}"` 保留 |
| 拖拽反馈 | 拖拽进行中：扩出画布上叠加 **3×3 参考网格**（三分线，虚线）+ **顶部居中尺寸胶囊**（`{w} × {h} · {比例}`）。松手即消失 |
| 松手语义 | 松手 = 确定当前扩展范围（写入 store），**不触发生成**；可立即继续拖拽其他手柄（逐边累积模型天然支持，PR #398） |
| 读数去重 | 现有底部读数条移除；读数只在拖拽顶部胶囊（临时）+ 右栏面板（常驻）两处 |
| 几何模型 | `outpaintGeometry.ts` 逐边累积模型不动（`resizeOutpaintRect` / `floorOutpaintRect` / `hasOutpaintExtension` 原样） |
| 状态源 | **rect 状态源从组件 ref 上移到 store**（见 §7），拖拽增量写入 store，面板与画布同源 |

### 6.2 右栏扩图参数面板（新 `OutpaintPanel.vue`）

自上而下：

1. **比例预设 chips**：`原图 · 1:1 · 4:3 · 3:4 · 16:9 · 9:16`。
   - 点击 = 以原图为基准重算画布（替换当前 rect，非累积）：取**包含原图且面积最小的该比例矩形**，多余扩展量在对边**对称均分**（宽差 → 左右均分，高差 → 上下均分）。
   - 受 §8 同一套 clamp 约束（单边 ≥256、面积 ≤9 倍、恒包含原图）。`原图` chip 恢复 `initialOutpaintRect`。
2. **画布尺寸数字输入**：宽 × 高（px，整数）。绝对值语义，clamp 后生效：`w ≥ max(baseW, 256)`、`h ≥ max(baseH, 256)`、面积上限同上；宽度变化 → 左右对称均分（奇数像素多 1px 给右侧），高度变化 → 上下对称均分；另一维的 `x/y` 不变。
3. **四向扩展读数**：`← 西 x` `→ 东 x` `↑ 北 x` `↓ 南 x`（px，由 `outpaintExtensionAmounts(base, rect)` 派生，只读）。
4. **重置按钮**：恢复 `initialOutpaintRect`（等效「原图」chip）。
5. **守卫提示**：`hasOutpaintExtension === false` 时显示「先拖动画布四周手柄扩展画布」。

双向同步规则：拖拽手柄 → store rect → 面板 chips 激活态 / 数字输入 / 四向读数实时更新；面板改动 → store rect → 画布即时反映。数字输入与 chips 均不产生拖拽历史，也不进蒙版历史栈（现状语义保留）。

### 6.3 悬浮 dock（扩图变体，新 `RefineOutpaintDock.vue`）

- 落点：悬浮于视口底部居中（竞品同位），`dockPlacement: 'floating'`；窄屏（`<640px`）退化为面板底部常驻（复用 panel 落点渲染）。
- 内容（左 → 右）：`× 退出扩图`（= `setRefineMode('select')`，busy 时为取消）｜ 模型选择器（沿用现 `RefineDock` 行为，只读展示）｜ 积分徽标（`DockCreditBadge`）｜ 主 CTA 圆形 `↑`（`title`/`aria-label`=「扩图生成」）。
- 提示词：默认 `OUTPAINT_FALLBACK_PROMPT`；dock 上提供提示词图标，点开 popover 内嵌 textarea 可改（不展开时不占位）。
- CTA 守卫：`!hasOutpaintExtension` → disabled + tooltip「先拖动画布四周手柄扩展」；busy → disabled。
- 提交链路不变：走现有 `runOutpaint`（`computeOutpaintLayers` → `renderOutpaintPngs` → `editImage`）。
- **张数 / 分辨率选择器不做**（§2.2）。

## 7. Store 变更（`stores/canvasEditor.ts`）

| 项 | 变更 |
|---|---|
| `refineOutpaintRect` | 语义升级：从「提交用的落像素快照」升级为**权威草稿**（允许小数，仅 `RefineOutpaintCanvas` 拖拽增量写入）。提交 / 读数侧统一 `floorOutpaintRect` |
| `setRefineOutpaintRect(rect \| null)` | 签名不变；调用方从「canvas watch」扩展为「canvas 拖拽 + 面板动作」 |
| 新增 `applyOutpaintAspectPreset(ratio: { w: number; h: number } \| null)` | `null` = 原图（reset）。内部调 `fitRectToAspect`，busy 时 no-op |
| 新增 `applyOutpaintSize(width: number, height: number)` | 内部调 `resizeOutpaintAbsolute`，busy 时 no-op |
| 新增 `resetOutpaintRect()` | 恢复 `initialOutpaintRect` |
| 退出模式 | `setRefineMode('select')` 重置 rect 的现状语义不变 |

## 8. 几何纯函数新增（`outpaintGeometry.ts`，全部带单测）

```ts
fitRectToAspect(base: Size, ratio: { w: number; h: number } | null): OutpaintRect
resizeOutpaintAbsolute(base: Size, width: number, height: number): OutpaintRect
outpaintExtensionAmounts(base: Size, rect: OutpaintRect): { west: number; east: number; north: number; south: number }
```

统一 clamp 规则（与现有常量一致）：`OUTPAINT_MIN_EDGE=256`、`OUTPAINT_MAX_AREA_RATIO=9`、四向扩展量恒 ≥0（扩图不裁剪）。面积超限时按比例等比缩小到上限内并重新保证包含原图。

## 9. 左栏 rail 能力区（`RefineToolRail.vue` + `refineToolRailModel.ts`）

- 现有分组不变：输入组 3（智能选择 / 框选 / 涂抹）+ 查看组 2（对照 / 适配）+ 扩图切换。
- 新增 **能力区分隔线 + 能力图标**：数据从 `RefineToolbox` 的 `CAPABILITY_GROUPS` 迁入 rail 模型（`REFINE_CAPABILITY_ITEMS`），全部禁用 + tooltip「即将上线」（与 capability-pack 占位一致），仅「扩图」为激活项（现有 toggleRefineMode 按钮即扩图项，两者合并为一枚）。
- `RefineToolbox.vue` 删除（VersionStrip 迁回 `RefineSidePanel` 骨架直接渲染，为 Shell 的版本条固定资产槽位）。

## 10. select（精修）模式本包处置

- rail：不变（工具已在左栏）。
- 右栏滚动区：渲染 select 注册的 `panel` —— 本期即「现状减 Toolbox」。编辑意图 chips 与覆盖率提示**留在 `RefineDock` 内不拆**（它们与生成动作强耦合，拆出无收益）。
- dock：`dockPlacement: 'panel'`，`RefineDock` 原样挂在面板底部。
- 模式条：不变。

## 11. 文件级改动清单

| 文件 | 动作 |
|---|---|
| `components/canvas/workbench/WorkbenchShell.vue` | 新增 |
| `components/canvas/workbench/workbenchToolRegistry.ts` | 新增 |
| `components/canvas/refine/OutpaintPanel.vue` | 新增 |
| `components/canvas/refine/RefineOutpaintDock.vue` | 新增 |
| `components/canvas/refine/RefineOutpaintCanvas.vue` | 修改：手柄形状 / 3×3 网格 / 顶部胶囊读数 / rect 状态源上移 store / 删底部读数条 |
| `components/canvas/refine/outpaintGeometry.ts` | 修改：新增 §8 三个纯函数 |
| `components/canvas/refine/RefineSidePanel.vue` | 修改：接 Shell / 按 mode 渲染面板与 dock 落点 / VersionStrip 直挂 |
| `components/canvas/refine/RefineToolRail.vue` + `refineToolRailModel.ts` | 修改：能力区 |
| `components/canvas/refine/RefineToolbox.vue` | 删除（能力数据迁 rail 模型） |
| `stores/canvasEditor.ts` | 修改：§7 |

## 12. 测试策略与验收标准

### 12.1 自动化（新增测试必须先红后绿，仓库惯例）

- 几何：`fitRectToAspect`（各比例 / 面积超限 / 小于 256 的原图）/ `resizeOutpaintAbsolute`（奇数均分 / clamp）/ `outpaintExtensionAmounts`。
- store：preset / size / reset 动作、busy 守卫、退出模式重置。
- `OutpaintPanel`：chips 激活态、输入同步、守卫提示、禁用态。
- `RefineOutpaintCanvas`：手柄形状 testid、拖拽中网格与顶部胶囊出现/消失、松手后 rect 持久（多次操作不互相吞 —— PR #398 回归）。
- `RefineOutpaintDock`：CTA 守卫 / 退出按钮 / busy 态。
- rail：能力区渲染、禁用 tooltip、扩图激活。
- 基线：`pnpm --filter @lnkpi/web test` 全绿（main 基线 976，只增不减）；`vue-tsc -b` 零错误；全仓四条本地验证。

### 12.2 目视验收（人工，真实浏览器）

1. 进入扩图：工作图居中缩小，四周 8 手柄（角圆 / 边胶囊）。
2. 拖拽任一手柄：3×3 网格 + 顶部尺寸胶囊出现；松手消失且范围保留；连续拖不同手柄扩展区不互相吞。
3. 点比例 chip：画布变为该比例、包含原图、对称扩展；面板数字与四向读数同步；画布同步。
4. 改宽 / 高输入：同上。
5. 未扩展时 CTA 禁用 + 引导文案；扩展后可生成；生成后对照带出现前后对照。
6. `×` 退出扩图回 select；select 模式右栏无 Toolbox、能力图标在左栏且禁用。
7. 窄屏 <640px：悬浮 dock 退化为面板底部。

## 13. 风险

| 风险 | 缓解 |
|---|---|
| rect 状态源上移引发 PR #397/#398 回归 | 拖拽链路测试全量保留；「多边不互吞」回归测试先红后绿重跑 |
| `RefineSidePanel` 拆分动到 select 模式 | select 模式本期最小改动（只删 Toolbox），面板组件化只覆盖扩图 |
| Shell 过早抽象 | Shell 仅含布局槽位，零业务状态；GridSlice 迁移是下一个包的验证，不本包强做 |

## 14. 后续包

1. `GridSliceWorkbench` 迁移到 Shell（验证契约复用）。
2. 能力包按注册表逐个点亮 rail 禁用项。
3. 扩图 P2：方向快捷键、Alt 对称拖、手柄旁尺寸浮标、张数（等批量能力）。
