# Refine M2 能力包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精修模式扩图（outpainting）+ 精修通道参数化（模型/尺寸可操作 + 按模型定价）+ 放大 2X 整条下线 + 选中浮层与宫格切分选择器优化。

**Architecture:** 扩图走「前端合成」路线——前端产出新画布底图与同尺寸蒙版，复用现有 `POST /studio/image/edit` 全链路（服务端仅扩 DTO 与定价读表）；参数化通过 shared 层多模型 profile 白名单 + 定价常量表贯通前后端；浮层与宫格下拉统一 counter-scale 反向缩放 + 视口边界翻转；宫格选择器重写为竞品双面板样式。

**Tech Stack:** Vue 3 + Vue Flow + Tailwind/neo（web）；NestJS + Prisma（server）；pnpm monorepo（packages/shared 供两端常量）；Vitest。

**Spec:** `docs/superpowers/specs/2026-09-22-refine-m2-capability-pack-design.md`（实现依据，两份一起读）

## Global Constraints

- 分支：从最新 `origin/main` 建 `feature/refine-m2-capability-pack`；禁止直接 push main；每 Task 一个 commit。
- 提交前全量验证四条：`pnpm install --frozen-lockfile`、`pnpm --filter @lnkpi/server exec prisma generate`、`pnpm build`、`pnpm --filter @lnkpi/agent test`；最后跑 `pnpm --filter @lnkpi/web test`。
- **worktree 环境坑**（必读）：新 worktree 里 node unlink 全 EPERM，`pnpm install` 必挂——不动 package.json 时直接软链主仓 node_modules（root + 各 package 共 5 处）；`vue-tsc -b` 弄脏 `apps/web/vite.config.js` 后用 `rm -f` + `git checkout HEAD --` 两步还原；push/gh 用 `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy` 绕沙箱代理；`gh` 全路径 `/usr/local/bin/gh`。
- 白名单与定价是**前后端同一真源**（packages/shared），两端不得各写一份。
- 本期白名单仅 `image2`（`gpt-image-2-official`）；定价 `image2 = 10`；尺寸/扩图不加价。
- 扩图蒙版语义：扩出区整片蒙版，原图区禁画笔；底图扩出区默认透明 PNG（spike 结论若异常则 `OUTPAINT_FILL = 'white'` 开关切白）。
- 扩图边界：单边 ≥256px；新画布面积 ≤ 原图 9 倍。
- 普通 inpaint 调用方**零感知**：DTO 新字段全部可选、缺省行为与现状完全一致。
- 删除放大 2X 时：历史 `image_upscale` record 与积分流水保留；仅删通道代码与 UI 入口。
- 宫格选择器文案用「宫格切分」；单格 <64px 档位禁用；嵌套切分允许、`sourceNodeId` 记直接父节点。
- 测试新断言必须先在旧实现上跑红（回归有效性），组件测试放同目录 `.test.ts`。

## Review Focus

- **透明 PNG 底图被上游渲染成黑边/异常** → 用户扩图结果四周发黑。Task 1 spike 钉死；若异常，Task 7 的 `OUTPAINT_FILL` 必须切 `'white'`（测试钉住开关两态）。
- **白名单外 model 注入**（恶意 `model: "gpt-image-2"` 或大小写变体）→ 服务端必须 400，且扣费分文不动（先校验后扣费）。
- **旧客户端缺省字段**（不带 model/size/mode 的 inpaint 请求）→ 行为与扣费金额和现状逐字节一致（10 分、gpt-image-2-official、auto）。
- **贴顶/贴底节点的浮层翻转** 与 zoom 极小(0.2)/极大(4) 下的浮层尺寸 → 菜单必须完整可见且可点（Task 12 纯函数 + 组件测试钉住）。
- **大切分（7×7）失败后的画布一致性** → 后端单请求要么全成功要么全失败，前端不得出现「建了一半节点」；撤回必须把本次全部子节点+边成批移除。

---

### Task 0: Spike — apimart image2 edit 通道三项实测

**Files:**
- Create: `/tmp/spike-image-edit.mjs`（一次性脚本，不入库）
- Modify: `docs/superpowers/specs/2026-09-22-refine-m2-capability-pack-design.md`（§9 回填结论）

**Interfaces:**
- Produces: 三项结论写入规格 §9（size 档位表、透明 PNG 可用性、空 prompt 可用性）；Task 2/3/7 依赖这些结论。

- [ ] **Step 1: 写最小实测脚本**

读 `packages/agent/src/tools/image-edit-provider.ts` 与 `.env` 里的 apimart 凭据，用 fetch 直接打上游（或走本地 `POST /studio/image/edit`）：

```js
// /tmp/spike-image-edit.mjs —— 三次请求：
// A) size='1536x1024'（非 auto 档位）→ 记录接受/报错
// B) 底图=左半贴像素、右半透明 RGBA PNG + 全图白蒙版 → 记录输出是否黑边
// C) prompt=''（空字符串）→ 记录接受/报错
```

- [ ] **Step 2: 跑并记录结论**（每项：接受值/报错原文）。花费 ≈ 2-3 次精修积分，用最小图（256×256）。
- [ ] **Step 3: 结论回填规格 §9**，并标注：size 档位表 → Task 2 的 `size` 联合类型；透明 PNG 异常 → Task 7 `OUTPAINT_FILL='white'`；空 prompt 拒绝 → Task 8 前端兜底文案。

- [ ] **Step 4: Commit（仅规格改动）** `git commit -m "docs(refine-m2): spike 结论回填（size 档位/透明 PNG/空 prompt）"`

### Task 1: shared 层 — imageEditProfiles 多模型白名单 + 定价表

**Files:**
- Modify: `packages/shared/src/imageEditProfiles.ts`
- Create: `packages/shared/src/imageEditProfiles.test.ts`

**Interfaces:**
- Consumes: 现有 `IMAGE_EDIT_GATEWAY_MODEL_ID`、`IMAGE2_EDIT_PROFILE`（保持导出不变）。
- Produces:
  - `IMAGE_EDIT_MODEL_KEYS: readonly string[]`（本期 `['image2']`）
  - `IMAGE_EDIT_MODEL_PRICING: Readonly<Record<string, number>>`（`{ image2: 10 }`）
  - `resolveImageEditProfile(modelKey?: string): ImageEditModelProfile` —— 未知 key **throw** `Error('unknown image edit model: ...')`；`undefined`/`'image2'` 返回 Image2 profile
  - `ImageEditModelProfile.size` 放宽为 `'auto' | string`（spike 档位表以 `IMAGE2_EDIT_SIZES: readonly string[]` 常量挂 profile 旁）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  IMAGE_EDIT_MODEL_KEYS,
  IMAGE_EDIT_MODEL_PRICING,
  resolveImageEditProfile,
} from './imageEditProfiles'

describe('imageEditProfiles 白名单与定价', () => {
  it('白名单本期仅 image2，定价 10 分', () => {
    expect(IMAGE_EDIT_MODEL_KEYS).toEqual(['image2'])
    expect(IMAGE_EDIT_MODEL_PRICING['image2']).toBe(10)
  })
  it('缺省与 image2 都解析到 gpt-image-2-official', () => {
    expect(resolveImageEditProfile().gatewayModelId).toBe('gpt-image-2-official')
    expect(resolveImageEditProfile('image2').gatewayModelId).toBe('gpt-image-2-official')
  })
  it('未知/大小写变体 key 抛错（服务端据此 400）', () => {
    expect(() => resolveImageEditProfile('GPT-Image-2')).toThrow()
    expect(() => resolveImageEditProfile('seedream-5.0-pro')).toThrow()
  })
})
```

- [ ] **Step 2: 跑红** `pnpm --filter @lnkpi/shared test -- imageEditProfiles` → FAIL（当前实现恒返 Image2 不抛错）
- [ ] **Step 3: 最小实现**：`resolveImageEditProfile` 改为 `const key = modelKey ?? P1_IMAGE_EDIT_MODEL_KEY; if (!IMAGE_EDIT_MODEL_KEYS.includes(key)) throw ...; return IMAGE2_EDIT_PROFILE`；新增两个常量。
- [ ] **Step 4: 跑绿 + 全 shared 测试** `pnpm --filter @lnkpi/shared test`
- [ ] **Step 5: Commit** `git commit -m "feat(shared): image edit model whitelist + per-model pricing"`

### Task 2: 服务端 — ImageEditDto 扩展 + 白名单校验 + 定价读表

**Files:**
- Modify: `apps/server/src/studio/studio.controller.ts:245-254`（`ImageEditDto`）
- Modify: `apps/server/src/studio/studio.service.ts:1310-1480`（`editImage` 定价与 metadata）
- Test: `apps/server/src/studio/studio.service.test.ts`（不存在则新建，mock 方式对齐 `apps/server/src/studio/image-slice.service.test.ts`）

**Interfaces:**
- Consumes: Task 1 的 `resolveImageEditProfile`（抛错即 400 语义）与 `IMAGE_EDIT_MODEL_PRICING`。
- Produces: DTO 字段 `model?: string; size?: string; mode?: 'inpaint' | 'outpaint'`；`editImage` metadata 新增 `editModelKey / editSize / editMode / outpaintFrom: {width,height} / outpaintTo: {width,height}`（outpaint 时）；扣费 `cost = IMAGE_EDIT_MODEL_PRICING[modelKey ?? 'image2']`。

- [ ] **Step 1: 写失败测试**（核心断言，harness 对齐 image-slice.service.test.ts 的 mock 风格）

```ts
describe('editImage 参数化与定价', () => {
  it('缺省字段：走 image2、扣 10 分（与旧行为一致）', async () => {
    /* 调 editImage（最小入参，无 model/size/mode）
       expect points.consume 以 cost=10 被调；metadata.gatewayModelId='gpt-image-2-official' */
  })
  it('白名单外 model → BadRequestException，且 points.consume 未被调', async () => {
    /* model='seedream-5.0-pro' → 先校验后扣费 */
  })
  it('mode=outpaint 时 metadata 记录 outpaintFrom/outpaintTo', async () => {})
})
```

- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**：DTO 加三个可选字段（`@IsOptional() @IsIn(IMAGE_EDIT_MODEL_KEYS)` 等 class-validator 装饰器）；`editImage` 开头 `resolveImageEditProfile(dto.model)`（try/catch 转 `BadRequestException`），定价 `const cost = IMAGE_EDIT_MODEL_PRICING[dto.model ?? 'image2'] ?? 10`，替换硬编码 10；metadata 按上述 Produces 写入。
- [ ] **Step 4: 跑绿 + server 全量测试**
- [ ] **Step 5: Commit** `git commit -m "feat(server): image edit DTO model/size/mode + whitelist + per-model pricing"`

### Task 3: agent edit-adapter 透传 model/size

**Files:**
- Modify: `packages/agent/src/studio/edit-adapter.ts:20-51`（`buildImageEditRequest`）
- Test: `packages/agent/src/studio/edit-adapter.test.ts`（不存在则新建）

**Interfaces:**
- Consumes: Task 1 profile（`size` 已可非 auto）。
- Produces: `buildImageEditRequest(input)` 输出 body 含 `size: profile.size === 'auto' ? 'auto' : (input.sizeOverride ?? profile.size)`；model 恒取 profile.gatewayModelId。

- [ ] **Step 1: 失败测试**：`sizeOverride` 透传用例 + 缺省 `'auto'` 用例。
- [ ] **Step 2: 跑红 → Step 3: 最小实现 → Step 4: `pnpm --filter @lnkpi/agent test`（210+ 全绿）**
- [ ] **Step 5: Commit** `git commit -m "feat(agent): edit adapter size passthrough"`

### Task 4: 前端 — 精修 dock 参数化（模型/尺寸选择 + 动态积分）

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineDock.vue`（只读 chip → 受控选择器）
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`（组装参数、传入请求）
- Modify: `apps/web/src/services/studio-api.ts:93-104`（`imageEdit` body 增 model/size/mode）
- Test: `apps/web/src/components/canvas/refine/RefineDock.test.ts`、`RefineSidePanel.test.ts`（追加用例）

**Interfaces:**
- Consumes: `UniversalModelSelector`（v-model + `type="image"`）、`IMAGE_EDIT_MODEL_KEYS`、`IMAGE_EDIT_MODEL_PRICING`、Task 1 profile 档位 `IMAGE2_EDIT_SIZES`。
- Produces:
  - RefineDock 新 props：`modelKey: string`、`sizes: readonly string[]`、`availableModelKeys: readonly string[]`、`sizeOverride: string | 'auto'`（扩图模式下由父层传 `'auto'` 并隐藏选择器）；新 emits：`update:modelKey`、`update:sizeOverride`
  - `RefineSidePanel.runRefine()` 请求体追加 `model / size / mode`
  - `DockCreditBadge` credits 值 = `IMAGE_EDIT_MODEL_PRICING[modelKey]`

- [ ] **Step 1: 失败组件测试**：模型选择器渲染白名单项（本期仅 image2）、切模型 emit `update:modelKey`；尺寸选择器列 `auto + IMAGE2_EDIT_SIZES`；credits 显示 10；请求体断言含 model/size。
- [ ] **Step 2: 跑红 → Step 3: 实现（复用 UniversalModelSelector，不新写选择器）→ Step 4: web 相关测试绿**
- [ ] **Step 5: Commit** `git commit -m "feat(web): refine dock model/size selectors + dynamic credits"`

### Task 5: 扩图几何纯函数 outpaintGeometry

**Files:**
- Create: `apps/web/src/components/canvas/refine/outpaintGeometry.ts`
- Test: `apps/web/src/components/canvas/refine/outpaintGeometry.test.ts`

**Interfaces:**
- Produces:
  - `OUTPAINT_MIN_EDGE = 256`、`OUTPAINT_MAX_AREA_RATIO = 9`
  - `clampOutpaintCanvas(base: {width,height}, next: {width,height}, anchor: {x: 'start'|'end'|'center', y: 'start'|'end'|'center'}): {x,y,width,height}` —— 返回新画布矩形与原图左上角在新画布中的位置；违反单边下限/面积上限时 clamp（并保证 clamp 后仍合法，否则抛错）

- [ ] **Step 1: 失败测试**（覆盖：合法扩展、单边 <256 clamp、面积 >9 倍 clamp、中心/角锚定坐标正确、原图 300×200 切 7×7 场景单格 42px）
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 绿**
- [ ] **Step 5: Commit** `git commit -m "feat(web): outpaint canvas geometry pure functions"`

### Task 6: 扩图合成规格 outpaintComposite

**Files:**
- Create: `apps/web/src/components/canvas/refine/outpaintComposite.ts`
- Test: `apps/web/src/components/canvas/refine/outpaintComposite.test.ts`

**Interfaces:**
- Consumes: Task 5 的矩形。
- Produces:
  - `OUTPAINT_FILL: 'transparent' | 'white'`（常量开关，默认 `'transparent'`；Task 0 spike 结论异常则改 `'white'`）
  - `computeOutpaintLayers(base: {width,height}, rect: {x,y,width,height}): { baseSpec: {width,height,srcX,srcY,fill}, maskSpec: {width,height,maskRect:{x,y,width,height}} }` —— 纯规格对象（不做 canvas 绘制），组件据此绘制并导出 PNG

- [ ] **Step 1: 失败测试**（baseSpec.srcX=-rect.x、maskRect=原图矩形关于新画布的补集即扩出区：整片扩出区=mask 白区；断言 fill 开关两态）
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 绿**
- [ ] **Step 5: Commit** `git commit -m "feat(web): outpaint layer composition spec"`

### Task 7: 扩图组件 RefineOutpaintCanvas + 全链路接线

**Files:**
- Create: `apps/web/src/components/canvas/refine/RefineOutpaintCanvas.vue`
- Modify: `apps/web/src/components/canvas/refine/RefineToolRail.vue`（新增「扩图」组，激活时高亮；扩图模式禁画笔/橡皮）
- Modify: `apps/web/src/components/canvas/refine/RefineWorkViewport.vue`（挂载扩图画布，v-show 切换普通工作图/扩图画布）
- Modify: `apps/web/src/components/canvas/refine/RefineWorkbench.vue` / `RefineSidePanel.vue`（提交时合成两张 PNG→persist→走 imageEdit，`mode:'outpaint'`、`size:'auto'`；空 prompt 兜底文案；busy 时手柄冻结 + 模式不可切换）
- Test: `RefineOutpaintCanvas.test.ts`、`RefineToolRail.test.ts`（追加）、`RefineSidePanel.test.ts`（追加 outpaint 提交用例）

**Interfaces:**
- Consumes: Task 5/6 纯函数；`persistMediaUrl`；Task 4 请求通道。
- Produces: store 状态 `refineMode: 'select' | 'outpaint'`（进 `canvasEditor` store）；提交 emit 载荷 `{ basePngUrl, maskPngUrl, rect }`。

- [ ] **Step 1: 失败测试**：rail 出现扩图组且点击后激活态；扩图模式画笔按钮 disabled；8 手柄拖拽改变读数（mock pointer 事件 + clamp 生效）；拖拽超出视口时视口自动缩放跟随；Esc 退出扩图模式（再按才退精修，与对照分级同思路）；busy 时手柄 disabled；提交 emit 两张 persist 后的 URL + `mode:'outpaint'`；空 prompt 时请求体 prompt=兜底英文。
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: web 相关测试绿**
- [ ] **Step 5: Commit** `git commit -m "feat(web): outpaint mode in refine studio"`

### Task 8: 对照带「基准画布 + 贴图」模式

**Files:**
- Modify: `apps/web/src/components/canvas/refine/CompareView.vue`
- Modify: `apps/web/src/components/canvas/refine/RefineCompareBand.vue`（当工作版本 `metadata.editMode==='outpaint'` 时传基准画布）
- Test: `CompareView.test.ts`、`RefineCompareBand.test.ts`（追加）

**Interfaces:**
- Consumes: 版本 metadata（Task 2 写入的 `editMode/outpaintTo`）。
- Produces: CompareView 新可选 prop `baseCanvas?: { width: number; height: number; beforeOffset: { x: number; y: number } }`——存在时 Before 按偏移贴入新画布框、扩出区渲染斜纹占位；wipe/split 行为不变。

- [ ] **Step 1: 失败测试**：传 baseCanvas 后 Before 容器尺寸=新画布、Before 图偏移正确、扩出区有斜纹元素；不传时渲染与现状逐像素兼容（回归）。
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 绿**
- [ ] **Step 5: Commit** `git commit -m "feat(web): compare view base-canvas mode for outpaint versions"`

### Task 9: 应用到节点 — 中心锚定

**Files:**
- Modify: `apps/web/src/pages/CanvasPage.vue`（精修「应用到节点」处理器）
- Create: `apps/web/src/utils/centerExpand.ts`（纯函数）
- Test: `apps/web/src/utils/centerExpand.test.ts`

**Interfaces:**
- Produces: `centerExpandPosition(pos: {x,y}, oldSize: {width,height}, newSize: {width,height}): {x,y}` —— `x + (oldW-newW)/2, y + (oldH-newH)/2`。

- [ ] **Step 1: 失败测试**（放大/缩小两态）
- [ ] **Step 2: 跑红 → Step 3: 实现 + CanvasPage 应用链路改用该函数（仅当 newSize ≠ oldSize）→ Step 4: 绿**
- [ ] **Step 5: Commit** `git commit -m "feat(web): center-anchored node apply for resized refine results"`

### Task 10: 放大 2X 整条下线

**Files:**
- Delete: `apps/server/src/studio/upscale.service.ts`、`packages/agent/src/tools/upscale-provider.ts`、`apps/web/src/composables/useImageUpscale.ts`、`apps/web/src/utils/upscaleNode.ts`
- Modify: `apps/server/src/canvas/canvas.controller.ts:460-463`（删路由）、`apps/server/src/agent/agent-canvas-tools.controller.ts:1312` + `service.ts:2377`（删工具）、`apps/server/src/agent/agent.service.ts:91-92`（删 `capabilities.imageUpscale`）、`apps/server/src/studio/studio.service.ts:232/2330`（类型映射与文案残留）、`apps/web/src/components/canvas/CanvasContextMenu.vue:14,40-78`、`apps/web/src/components/canvas/SelectionActionBar.vue`（放大按钮，Task 12 一并重排——本 Task 仅删逻辑）、`apps/web/src/pages/CanvasPage.vue`（:140,144,751-752,778,2820-2867,3334,3997-4011 装配点）

- [ ] **Step 1: 全仓引用扫描** `git grep -n "upscale\|Upscale" -- apps packages | grep -v spec | grep -v test` 逐条处置（删或确认与放大通道无关）
- [ ] **Step 2: 删除 + 清理装配点**
- [ ] **Step 3: 全量验证** `pnpm build && pnpm --filter @lnkpi/agent test && pnpm --filter @lnkpi/web test`（相关失败用例随删）
- [ ] **Step 4: Commit** `git commit -m "feat!: remove 2x upscale pipeline (per spec §6)"`

### Task 11: selectionToolModel + SelectionActionBar 重构

**Files:**
- Create: `apps/web/src/components/canvas/selectionToolModel.ts` + `.test.ts`
- Modify: `apps/web/src/components/canvas/SelectionActionBar.vue`（重排 + counter-scale + 边界翻转）
- Test: `SelectionActionBar.test.ts`（追加）

**Interfaces:**
- Produces:
  - `SelectionToolDef = { id: string; icon: string; title: string; disabled: boolean; disabledReason?: string; group: 'ai' | 'file' }`
  - `buildSelectionTools(opts: { hasUrl: boolean }): SelectionToolDef[]` —— 输出编排：`精修(ai, enabled)`、`抠图(ai, disabled, '抠图将在后续能力包点亮')`、`裁剪(ai, disabled)`、`旋转/翻转(ai, disabled)`、`下载(file, hasUrl)`、`存入资产库(file, hasUrl)`
  - `clampCounterScale(zoom: number): number` —— `Math.min(1.2, Math.max(0.8, 1/zoom))`
  - `resolveBarPlacement(barBox, viewportBox): 'top' | 'bottom'` —— 越界翻转判定
- 行为：删除「放大」按钮与 `imageUpscale` prop；「编辑」改「精修」；容器 counter-scale；贴顶翻转到节点下方。

- [ ] **Step 1: 失败测试**：`clampCounterScale(0.2)=1.2 / (1)=1 / (4)=0.8`；`resolveBarPlacement` 贴顶返回 bottom；`buildSelectionTools` 编排与禁用原因；组件：精修按钮存在、无放大按钮、工具组渲染 title。
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 绿**
- [ ] **Step 5: Commit** `git commit -m "feat(web): selection action bar rework — counter-scale, flip, tool model"`

### Task 12: 宫格双面板选择器重写

**Files:**
- Modify: `apps/web/src/components/canvas/grid-slice/GridSliceDropdown.vue`（重写模板）
- Modify: `apps/web/src/utils/gridSlice.ts`（新增纯函数）
- Test: `GridSliceDropdown.test.ts`（重写用例）、`gridSlice.test.ts`（追加）

**Interfaces:**
- Consumes: Task 11 的 `clampCounterScale` / `resolveBarPlacement`；既有 `studioApi.imageSlice`。
- Produces:
  - `gridSlicePresetOptions(): Array<{ n: number; label: string }>` —— `4宫格 (2×2) … 25宫格 (5×5)`
  - `canSliceAtCell(base: {width,height}, cols, rows, minCellPx = 64): boolean`
  - 模板：左面板预设列表 + 「自定义 ›」；右面板（hover 自定义出现）7×7 格阵 + 实时读数 `${cols} x ${rows}` + 底部「预览切分效果…」（emit 打开既有 Workbench）；删除旧密集格阵与「精确输入…」
  - 触发按钮文案「宫格切分 ▾」；<64px 档位禁用 + disabledTitle

- [ ] **Step 1: 失败测试**：preset 文案列表；`canSliceAtCell(300,200,7,7)=false / (1024,1024,3,3)=true`；右面板 hover 更新读数；点格 emit slice；「预览切分效果…」emit open-custom；min-width 实底样式类存在。
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 绿（Workbench 测试回归不动）**
- [ ] **Step 5: Commit** `git commit -m "feat(web): grid slice two-panel picker per competitor reference"`

### Task 13: useGridSlice 撤回 + loading + 嵌套钉死

**Files:**
- Modify: `apps/web/src/composables/useGridSlice.ts` + `CanvasPage.vue`（结果 toast）
- Test: `useGridSlice.test.ts`（追加）

**Interfaces:**
- Consumes: 既有 `runGridSlice`（backend 单请求 `studioApi.imageSlice`，timeout 120s）。
- Produces:
  - `makeSliceUndo(sessionId, sourceNodeId, childIds): () => void` —— 按 `data.gridSlice.sourceNodeId === sourceNodeId && id ∈ childIds` 移除子节点与关联边（经 `removeNode` 回调注入）；成功 toast 挂「撤回本次切分」按钮
  - `RunGridSliceInput` 增可选 `removeNode?: (id: string) => void`、`notify?: (msg: string, actions?: Array<{ label: string; onClick: () => void }>) => void`
  - 嵌套切分：子节点 `data.gridSlice = { sourceNodeId: <直接父>, index, cols, rows }`（现状行为）——补测试钉死再次切分时 sourceNodeId 指向切片子节点而非原始根
  - loading：切分期间触发按钮 loading 文案「切分中 · 大图约需数十秒」

- [ ] **Step 1: 失败测试**：undo 移除且仅移除本次 childIds；嵌套再切 sourceNodeId=直接父；notify 被调含撤回 action。
- [ ] **Step 2: 跑红 → Step 3: 实现 → Step 4: 绿**
- [ ] **Step 5: Commit** `git commit -m "feat(web): grid slice undo + loading + nested-slice semantics pinned"`

### Task 14: 全量验证 + PR + CI + 合并部署

- [ ] **Step 1:** 四条本地验证 + `pnpm --filter @lnkpi/web test` 全量 + `vue-tsc -b` 干净 + 还原 `vite.config.js`
- [ ] **Step 2:** 推分支（绕代理）→ PR（Summary 引规格 §各节；Test plan 勾四条）→ CI 5/5 绿 → squash merge → 盯 Deploy to Tencent Cloud success + `/api/health` 200 → 清理 worktree
- [ ] **Step 3:** 部署后目视验收 §12 清单（扩图拖拽/对照基准/浮层缩放/宫格双面板/撤回）
