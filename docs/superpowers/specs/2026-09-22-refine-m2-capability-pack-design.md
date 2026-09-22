# 精修 M2 能力包设计规格：扩图 + 精修通道参数化 + 放大 2X 下线 + 选中浮层优化

- 日期：2026-09-22
- 状态：设计已与用户逐段确认，待实现
- 前置：#394（布局重组）、#395（follow-up r2）已合并上线
- 关联决策会话：2026-09-21/22（brainstorming，用户逐条拍板）

---

## 1. 背景与目标

精修工作室（M1/refine-studio）已上线，但精修通道能力受限：模型写死 `gpt-image-2-official`、尺寸跟随原图、无扩图能力。M2 目标：

1. **扩图（outpainting）**：在精修模式内支持画布外扩生成；
2. **精修通道参数化**：dock 的模型/尺寸从只读变为可操作（后端 DTO + 白名单 + 定价）；
3. **放大 2X 整条下线**（用户既定决策）；
4. **图片节点选中浮层（SelectionActionBar）优化**：修复缩放后菜单过小/位置错乱，搭好快捷工具框架。

**本期白名单只含 image2**（`gpt-image-2-official`）；参考图参数化、其他模型接入、按面积连续计价均不做（见 §11）。

## 2. 总体路线（已拍板）

- 扩图采用**路线 A：前端合成，服务端零合成逻辑**。前端产出「新画布底图 + 同尺寸蒙版」，复用现有 `/studio/image/edit` 全链路（生成/轮询/退款/版本历史）。依据：现有「蒙版与底图同尺寸校验」与「蒙版外像素回贴」两条约束在前端预先合成后依然成立。
- 模型白名单：机制先行、按实测放行。一期 = `[gpt-image-2-official]`（保底可用）。
- 定价：**按模型分档**（用户修订，推翻早期的模型×尺寸二维方案）。本期 image2 = 10 积分；尺寸与扩图不加价。

## 3. 扩图交互设计

### 3.1 入口与模式

- 左栏工具条新增「扩图」组（画布四向箭头图标），点击进入扩图模式；与输入组（智能选择/框选/涂抹）并列，但语义是**改变画布尺寸**而非产选区。
- 进入后：工作图居中缩小，四周出现 **8 个拖拽手柄**（4 角 + 4 边）；扩出区域显示斜纹底纹；实时读数显示新画布 宽×高·比例。
- **边界约束**：单边最小 256px（生成模型对过窄扩展效果差）；上限按**面积**——新画布 ≤ 原图 9 倍面积（不设单边 3 倍限制，避免挡住「宽不变、高拉 4 倍」的分镜板场景）。
- **缩放锚定原图**（2026-09-22 用户验收修订，替换原「拖拽时视口自动跟随」）：原图进入扩图模式即按可用区 60% 定大小并**保持不变**——拖拽手柄只扩大蒙版区域，原图与缩放不随拖拽变化（「原图不变，变的是扩展的蒙版」）。拖拽增量钳制在视口可容纳的画布尺寸内，保证手柄始终在屏幕上可抓取；单边 256px 下限优先于视口钳制。

### 3.2 蒙版语义（PM 修订后收窄）

- 扩出区域**整片自动成为生成蒙版**。
- **画笔/橡皮在扩图模式下禁用**——砍掉「擦除留白」语义。理由：擦除区的透明像素会漏进合成底图并最终镂空节点，用户预期是白底，必然被当成 bug。「留白构图」等有真实需求再做，且届时扩出区必须填实体色。
- 原图区域内不允许加蒙版（改原图内容 = 退出扩图用普通精修）。

### 3.3 dock 联动

- **悬浮 dock 非常驻**（2026-09-22 用户验收修订）：进入扩图模式不弹 dock（常驻浮层挡画布拖拽）；**产生真实扩出后**才出现，**手柄拖拽进行中隐藏**、松手恢复。窄屏面板底部兜底 dock 不挡画布，不受此门控。
- 扩图模式下尺寸选择器**隐藏**，尺寸 chip 显示「扩图 · 新画布 宽×高」（由拖拽实时决定）；
- 模型选择器照常可用；积分徽标实时显示（扩图与普通精修同价，见 §5）；
- 提示词区不变，描述扩出内容；**允许空 prompt**（「自然延展」是高频用法）——按钮不置灰；若上游拒绝空 prompt，前端兜底传「Extend the image naturally, keep style consistent」。

### 3.4 提交、退出与结果语义

- 点「精修」提交：前端合成 ①新画布底图（原图贴正确位置，扩出区**透明 PNG**——若 spike 发现上游渲染异常，开关切换为填白底，见 §9）②同尺寸蒙版（扩出区白、原图区黑）；先 persist 再连 `mode:'outpaint'` 走现有接口。
- Esc 或再点「扩图」退出，拖拽状态不保留；**busy 时手柄冻结、模式不可切换**（与返回画布 busy 置灰同款）。
- 生成结果进版本历史，与普通精修一致，metadata 标记 `mode:'outpaint'` + 原/新尺寸；**支持链式扩图**（扩图结果可再次扩图，版本链 parentVersionId 已支持）。
- **应用到节点：以原图中心锚定**，节点按新尺寸居中放大；与其他节点重叠时按画布既有 z 序处理（叠在上面），**不做自动避让**。
- 扩图拖拽**不进** MaskEditor 蒙版历史栈（是画布几何状态，非蒙版操作）。

### 3.5 对照带适配（扩图版本打破既有假设）

- 对照以**新画布为基准**：Before 居中贴在新画布框内，扩出区显示斜纹占位；wipe 滑竿在新基准下继续可用。
- `CompareView` 需新增「基准画布 + 贴图」渲染模式（本期实打实的工作量）。
- 无 After 版本时维持 #395 已有的「After·待生成」占位。

## 4. 精修通道参数化

### 4.1 shared 层

- `imageEditProfiles.ts` 改造：`IMAGE_EDIT_PROFILES` 支持多模型注册；`resolveImageEditProfile(modelKey)` 真按 key 解析（现状忽略 key 恒返 Image2）；**白名单守卫**：不在册模型直接抛错。
- 新增 `IMAGE_EDIT_MODEL_PRICING` 常量表（模型 → 积分），前端 dock 徽标与服务端 `points.consume` **读同一张表**（单一真源）。

### 4.2 服务端

- `ImageEditDto`（studio.controller.ts）新增：
  - `model?: string`（缺省 image2；**服务端白名单校验**，不在册 400，防任意 model 注入）；
  - `size?: string`（`auto` 默认 + 预设档位；实际档位由 spike 实测钉死后写进 profile）；
  - `mode?: 'inpaint' | 'outpaint'`（缺省 inpaint；仅用于记录与链路标识，不影响价格与合成）。
- `edit-adapter.buildImageEditRequest()` 透传 model/size。
- `StudioService.editImage`：定价从硬编码 10 改为读 `IMAGE_EDIT_MODEL_PRICING`；metadata 记录 model/size/mode/outpaint 原新尺寸；失败/取消退款逻辑不变（金额动态）。

### 4.3 前端 dock

- `RefineDock` 的模型 chip → `UniversalModelSelector`（type="image"，选项 = 精修白名单 ∩ `STUDIO_MODEL_CATALOG`，本期仅 image2 一项）；尺寸 chip → 尺寸选择器（跟随原图 auto + 档位，档位来自 profile）。
- 参数从 dock → `RefineSidePanel` → 请求体逐层打通；`DockCreditBadge` 价格随模型动态刷新。
- 白名单外模型在 UI 上不可见（而非置灰）——未来实测通过的模型加进 shared 白名单即自动出现，前后端零结构性改动。

## 5. 定价（按模型分档）

| 模型 | 积分 | 备注 |
|---|---|---|
| gpt-image-2-official | 10 | 本期唯一白名单模型，扩图同价 |

- 尺寸档位、扩图（输出面积变大）**均不加价**（用户拍板的简化）。
- 定价表进 shared 常量；服务端扣费、前端展示、积分徽标共用。

## 6. 放大 2X 整条下线

删除清单（调查确认牵连面小，无其他模块引用）：

- `apps/server/src/studio/upscale.service.ts`（UpscaleService，扣 10 分逻辑一并删除）
- `packages/agent/src/tools/upscale-provider.ts`（fal Real-ESRGAN，`FAL_KEY` 依赖）
- `apps/web/src/composables/useImageUpscale.ts`
- UI 入口两处：`CanvasContextMenu.vue`（右键菜单）、`SelectionActionBar.vue`（选中浮层——本次重排一并处理）
- `CanvasPage.vue` 全部装配点（:140,144,751-752,778,2820-2867,3334,3997-4011 附近）
- agent 工具暴露（agent-canvas-tools.controller :1312 + service :2377）与 `capabilities.imageUpscale` 能力位（agent.service.ts:91-92）
- `image_upscale` 类型映射与失败文案残留（studio.service.ts:232/2330）
- `utils/upscaleNode.ts`

**保留**：历史 `image_upscale` record 与积分流水不删（审计）；`utils/upscale.ts`（若与节点缩放显示相关）需实现时甄别，仅删放大通道专用代码。

## 7. 图片节点选中浮层优化（SelectionActionBar）

用户反馈的问题：**缩放后菜单太小/位置乱**。

### 7.1 缩放可点性修复

- 菜单容器 **counter-scale 反向补偿**：`scale(clamp(1/zoom, 0.8, 1.2))`——任何 viewport 缩放下菜单保持恒定可点尺寸，位置仍锚定节点上沿中心（节点坐标系 + 反向缩放并存）。
- `labelsHidden`（zoom<0.5 藏文字）行为保留，与补偿叠加。

### 7.2 位置越界修复

- 菜单锚定节点上方 44px，检测视口边界；节点贴近视口顶部时**翻转至节点下方**（与精修 rail 二级菜单同套边界翻转思路）；左右越界 clamp 进视口。

### 7.3 按钮重排（放大下线联动）与快捷工具框架

- 摘掉「放大 2×」与 `imageUpscale` prop、积分角标预留；「编辑」文案与图标统一为「精修」。
- 重排：`切组｜精修｜快捷工具组｜｜下载｜存库`。
- **快捷工具组（config 驱动的框架，能力禁用但架子搭好）**：
  - 新增纯函数模型层 `selectionToolModel.ts`：工具定义数组 `{ id, icon, title, disabled, disabledReason, group }`，渲染层按配置输出；
  - 一期预置禁用占位：**抠图（matting，title「抠图将在后续能力包点亮」）**、裁剪（crop）、旋转/翻转（rotate/flip）；
  - 后续点亮 = 配置里翻 `disabled` 标志 + 接 emit，无结构改动；
  - 遵循 #395 r2-F6 的修订精神（预置能力组框架 + 图标 + title 说明，不渲染假交互）。
- 出现/消失加轻过渡；单击空白收起的既有行为保留；**扩图入口不加在浮层**（扩图在精修模式内，避免双入口）。

### 7.4 宫格切分优化（选择器复刻 + 链路补强）

用户确认的现状问题：下拉面板随 viewport 缩放巨化（zoom 大变巨物挡图、zoom 小难点）、半透明背景与图片混叠；另经 PM 审查确认一键切无防误触、大切分无进度、小图无格子下限、嵌套切分语义未定义。

**A. 选择器复刻（竞品二面板样式，用户拍板）**

- 触发按钮文案统一为「宫格切分 ▾」（原「宫格裁剪」）。
- 下拉改为**双面板**：
  - **左面板**：预设文字列表 `4宫格 (2×2) / 9宫格 (3×3) / 16宫格 (4×4) / 25宫格 (5×5)` + 底部「自定义 ›」项；
  - **右面板**（hover/点选「自定义」时出现）：标题「自定义宫格」+ 右侧实时读数 `3 x 2`，主体为 7×7 hover 格阵，悬停即高亮 cols×rows 区域，点击直接执行切分；
  - 面板底部保留一个「预览切分效果…」文字入口进既有 `GridSliceWorkbench`（精修同壳工作台保留给想看真实分割线 overlay 的场景）。
- 原密集 7×7 首屏格阵与「精确输入…」入口删除（被右面板取代）。
- **随浮层统一 counter-scale**（§7.1 同一套补偿），任何 zoom 下面板恒定尺寸；背景实底化（暗/亮主题各过对比度）；弹出方向边界自适应（§7.2 同一套判定）。
- 触摸二段点选、preset 标记交互沿用既有实现精神，在新模板上重建。

**B. 链路补强（PM 审查裁决）**

1. **一键切撤回**：切分完成 toast 带「撤回本次切分」——按本次写入的 `data.gridSlice.sourceNodeId` 反查批量移除子节点与边（纯前端状态操作）；画布级 undo 不在本期范围。
2. **切分过程反馈**：切分为**后端单请求**（`POST /studio/image/slice`，timeout 120s）——大网格时按钮 loading + 提示「切分中 · 大图约需数十秒」，失败整体报错（沿用现状）；**不做逐张进度**（无逐张上传）。
3. **单格最小像素**：单格 < 64px（原图宽/cols 或高/rows 任一）时该档位禁用 + title 说明，下拉与右面板格阵同样生效。
4. **嵌套切分语义（用户拍板）**：允许对切片子节点再切；子节点 `data.gridSlice.sourceNodeId` 记录**直接父节点**（覆盖式），链路经父节点逐级可追溯；补测试钉死。
5. **切分执行内核不动**：`equalSliceRects` 等分+余数给末行/列、后端 `POST /studio/image/slice`（`ImageSliceService`）、`addNode/addEdge` + 网格排布、与精修互斥，全部沿用。

**C. 事实修正（2026-09-22 复核）**

早前审查误报「P1 后端切片 + Agent 工具未做」——经复核**两者均已存在**：`POST /studio/image/slice`（`apps/server/src/studio/image-slice.service.ts`）与 agent 画布工具 `gridSliceImage`（`agent-canvas-tools.service.ts:2395+`，支持 sourceUrl/nodeId 二态）。本规格不涉及后端切片改动；「P1 立项」决定作废。

## 8. 前端新组件/纯函数清单

| 单元 | 职责 | 依赖 |
|---|---|---|
| `RefineOutpaintCanvas`（组件） | 扩图模式画布：手柄拖拽、斜纹、读数、视口跟随 | VueFlow viewport |
| `outpaintGeometry.ts`（纯函数） | 拖拽 clamp（256px/9 倍面积）、新画布矩形计算 | — |
| `outpaintComposite.ts`（纯函数） | 底图合成（原图贴位 + 扩出透明/白）与蒙版导出参数计算 | canvas 导出 |
| `CompareView` 扩展 | 「基准画布 + 贴图」渲染模式（Before 居中 + 扩出斜纹占位） | 既有 CompareView |
| `imageEditProfiles.ts` 改造 | 多模型注册 + 白名单解析 + 定价表 | shared |
| `selectionToolModel.ts`（纯函数） | 浮层工具配置模型 | web 本地（仅浮层消费，不进 shared） |
| `GridSliceDropdown` 重写 | 双面板选择器（预设列表 + 自定义 hover 格阵） | counter-scale / 边界翻转复用浮层 |
| `useGridSlice` 扩展 | 切分撤回（按 sourceNodeId 批量移除）、loading 提示 | 既有 sliceApi/addNode 通道 |
| `SelectionActionBar` 重构 | counter-scale + 边界翻转 + config 驱动渲染 | 上述模型 |

## 9. Spike（实现计划第一项，先行验证再动手）

用最小图实测 apimart `gpt-image-2-official` edit 通道：

1. **size 档位**：接口接受哪些 size 值（确定 profile 档位表，如 1024×1024 / 1536×1024 / auto…）；
2. **透明 PNG 底图**：扩出区透明时上游输出是否正常（黑边/异常 → 合成开关切填白底）；
3. **空 prompt**：接口是否拒绝空 prompt（决定前端兜底是否必要）。

Spike 产出：档位表 + 透明/空 prompt 结论，回填本规格与 profile 常量。Spike 脚本为一次性产物，不入库。

## 10. 测试策略

- **纯函数层重点单测**：`outpaintGeometry`（clamp 边界/面积上限）、`outpaintComposite`（贴位/蒙版参数/透明与白底开关）、`resolveImageEditProfile`（白名单内外、缺省回落）、定价表、`selectionToolModel`（配置 → 渲染态、禁用原因）、counter-scale clamp 函数、边界翻转判定。
- **组件测试**：扩图模式交互（进入/手柄/dock 联动/busy 锁定）、dock 模型与尺寸选择器、浮层重排与工具组、对照带新基准模式。
- **回归**：普通精修（inpaint）全链路不变——DTO 缺省值必须让旧调用方零感知。
- 本地验证四条照旧（install / prisma generate / build / agent test）+ web 全量。

## 11. 明确不做（本期外）

- 参考图参数化（dock 附加参考图上传）；
- 其他模型接入白名单（机制就绪，待实测）；
- 按面积连续计价、尺寸加价；
- 扩图「擦除留白」语义；
- 节点应用后的画布自动避让；
- 浮层新增真实能力（裁剪/旋转/抠图均只搭架子）；
- 老的 `image_upscale` 历史数据清理；
- 画布级 undo/redo 全局体系（本期仅做切分撤回单点）；
- ~~后端切片端点 + Agent 切图工具~~（复核证实已存在，无需立项，见 §7.4-C）。
- 画布级 undo/redo 全局体系（本期仅做切分撤回单点）。

## 12. 验收清单

- [ ] 精修模式可进入扩图，拖拽外扩 → 生成 → 版本历史 → 应用回节点（中心锚定、尺寸正确）
- [ ] 链式扩图可行；扩图版本在对照带以新画布为基准正确显示
- [ ] dock 可切模型（本期 image2 单项）与尺寸档位；扩图模式下尺寸由拖拽决定
- [ ] 白名单外 model 请求 400；扣费金额与定价表一致；失败/取消退款金额正确
- [ ] 空 prompt 扩图可提交（或前端兜底生效）
- [ ] 放大 2X 全链路（UI 入口/后端/agent 能力位）消失；历史记录仍可查看
- [ ] 选中浮层在任何 zoom 下恒定可点；贴顶节点菜单翻转到下方
- [ ] 浮层快捷工具组渲染禁用占位（抠图/裁剪/旋转翻转），title 说明到位
- [ ] 宫格选择器为双面板样式（预设列表 + 自定义 hover 格阵），任意 zoom 下恒定尺寸、实底背景、方向自适应
- [ ] 一键切后 toast 可撤回本次切分（子节点+边成批移除）
- [ ] 大切分 loading 明确提示；失败整体报错
- [ ] 单格 <64px 的档位禁用并有说明
- [ ] 切片子节点可再切，`sourceNodeId` 指向直接父节点（测试钉死）
- [ ] 全部测试绿；Spike 结论回填 profile
