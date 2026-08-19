# 画布图像精修壳层（Side panel + 节点选区 + 对照）Design

**Date:** 2026-08-19  
**Status:** Approved, plan in 2026-08-19-cx-image-edit-sidepanel.md  
**代号:** **CX-IMAGE-EDIT-CHROME**（P1 后端不变，只改画布精修壳层）  
**Related:**
- `2026-08-18-cx-image-edit-design.md` — P1 作业、积分、EditProvider、合成、版本链仍有效；**本文覆盖其入口布局、mask 表面、对照形态**
- `2026-08-15-media-inspector-design.md` — 停靠手势对齐 ⓘ 右侧抽屉；Inspector 仍只读
- Agent `AgentSideRail` — 浮动窗（拖、改宽、停靠/浮动切换）对齐其标题栏行为，不抽公共 RightDock

---

## Goal

精修从底部固定 Dock 改为 **右侧停靠抽屉（默认同 ⓘ）**，标题栏可切成 **可拖浮动窗（同 Agent）**。选区画在 **画布图片节点** 上，不画在 Before 缩略图上。Before/After 只做对照：默认左右，可切换重叠滑竿；最大化看细节。应用前节点一直显示 Before。

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| 壳 | 独立 `RefineSidePanel`。不把精修做成 Inspector Tab，不抽 Agent/Inspector 共用 RightDock |
| 默认形态 | **右侧停靠抽屉**，从右往左推出，手势同 ⓘ。默认宽度 **400px**（可拖 360–560px） |
| 浮动 | 标题栏「停靠 / 浮动」同 Agent。浮动后可拖、可改宽；不再挤开画布右侧 |
| 与 Agent | **停靠互斥**：精修停靠时 Agent 收为 56px 图标轨。浮动精修可与 Agent 停靠并存 |
| 与 ⓘ | 打开精修则关掉 Inspector。打开 Inspector 时：精修未 busy 则关掉精修；busy 则保持精修、不打开 Inspector |
| 底部生成 Dock | 精修打开期间 **隐藏**。关掉精修后若仍选中该节点，生成 Dock 回来 |
| 选区 | 打开后 `fitView` 该节点；mask overlay **叠在节点原图上**，跟节点 transform |
| 应用前节点 | 一直显示 **Before**。After 只出现在对照（迷你 + 最大化） |
| 对照 | 默认 **左右**；可切 **重叠（竖向滑竿）**。左 = Before，右 = After |
| 最大化 | 全屏对照，可左右或重叠；同步缩放/平移；不改 mask、不扣分 |
| 写回 | 沿用 P1：`POST /studio/image/edit`、10 分、`图像精修`、同节点版本链 |
| 入口 | 仍仅显式：节点「编辑」、右键「编辑图像」、Dock「精修这张图」、`open_image_editor`。选中节点不打开精修 |

---

## Non-goals（本轮）

- 智能选区 / 点击选区 / 文本指代选区
- 抠图、透明底、批量电商修图
- Agent 自动跑精修（`run_icon_refine` 仍不动）
- `/image-studio` 精修
- 给 `ImageProvider.generate()` 加 `maskUrl`
- 抽出共用 RightDock
- 把精修做成 Inspector 的编辑 Tab
- **对照后续（写入计划，本轮不实现）**：上下擦除、透明度溶解、自动闪光对比

---

## 1. 壳：停靠与浮动

### 停靠（默认）

`RefineSidePanel` 贴画布右缘，从右往左推出，遮罩/推入方式对齐 `MediaInspectorDrawer`（Element Plus Drawer 或同等 overlay）。不要用底部 `RefineDockPanel` 大卡片。

打开精修时同时：

1. 收起 Agent 展开面板（`open=false`），保留图标轨
2. `closeInspector()`
3. 不渲染底部 `DockStudioToolbar`

### 浮动

标题栏按钮：未浮动时 title「切换为浮动窗口」；已浮动时「停靠回侧栏」。交互抄 `AgentSideRail` 的 `floating` / `floatPos` / `floatWidth`（可简化：不必复制全部 420–760 的 Agent 宽度档）。

- 切到浮动：以当前停靠宽度放到视口右上附近，可拖标题栏、左缘改宽
- 切回停靠：清浮动坐标，重新占右侧
- 窄屏（< 640px）：只停靠/全宽 sheet，禁止浮动（同 Agent 手机策略）

偏好：本次会话记住停靠/浮动；刷新回默认停靠。不做 localStorage，除非实现时几乎零成本。

### 与 Agent 停靠互斥

| 当前 | 用户动作 | 结果 |
|------|----------|------|
| 精修停靠，未 busy | 点 Agent 打开对话 | **关闭精修**（丢未应用笔划和 After），Agent 展开 |
| 精修停靠，busy | 点 Agent 打开对话 | **挡住**：Agent 不展开；精修继续。只能先取消精修 |
| 精修浮动 | 点 Agent 打开对话 | Agent 可停靠展开；精修浮窗留着 |
| Agent 已展开 | 打开精修 | Agent 收为图标轨；精修停靠（或按会话偏好浮动） |

### 关闭

未 busy：点关闭、Esc（最大化优先关最大化）、切到其他节点、上述「让出停靠给 Agent」→ `decideRefineDismiss` 仍为 `dismiss` / `keep` / `block`。busy → 只能「取消精修」。

---

## 2. 节点上的 mask

打开精修后 `fitView` 该节点（padding 足够看见 overlay 和右侧抽屉）。`MaskEditor` 作为节点 overlay，画布坐标 = 底图像素尺寸，随 VueFlow 缩放平移。

工具（画笔 / 橡皮 / 矩形）、笔刷大小、清除选区、污渍芯片、指令、主按钮「精修」/「应用到节点」、版本条，都在 `RefineSidePanel` 里，**不**在对照缩略图上画。

覆盖率、导出格式沿用 P1：

- 覆盖 &lt; 0.3% → 不能提交，提示圈选
- 近全图 → 提示更像重新生成，仍允许提交
- PNG：选区 RGB 白 + A=255；保留 RGB 黑 + A=0（Image2 需要 alpha）

尺寸未就绪前不能画。busy 时 overlay 只读。

关掉精修或 dismiss：丢掉笔划和未应用 After；节点 url 仍是 Before。

---

## 3. 对照

对照**只比对**，不承担选区。

### 迷你（抽屉内）

未出图：After 空占位。出图后默认 **左右** 缩略图。标题旁模式：`左右` | `重叠`；无 After 时重叠禁用。

按住「原图」：左右模式下右栏改显示 Before；重叠模式下滑竿收到最左（整幅 Before），松开恢复。

应用成功后对照为 N | N+1；节点此时才换成新 url。

### 重叠（本轮要做）

同一画框叠 Before / After，竖向分界线 + 圆钮可拖：

- 分界**左** = Before，**右** = After
- 分界位置 ∈ [0, 1]，0 = 全 Before，1 = 全 After
- 拖的是分界，不带动画布平移
- 单击分界不切换左右/重叠模式

### 最大化

「最大化对照」打开全屏层（在精修面板之上）。左右 / 重叠共用精修 session 的 `compareMode` 与 `wipeRatio`。滚轮同步缩放两张图，拖空白平移视口。Esc 或关闭回到精修面板，**保留模式和滑竿位置**。最大化内不改 mask、不发起精修、不应用。

### 版本条

仍在抽屉：点版本只改对照 Before（及重叠里的 Before）；「恢复」才写回节点。与 P1 相同。

### 对照后续（本轮不实现，计划必须包含）

| 模式 | 意图 |
|------|------|
| 上下擦除 | 横向分界，上/下分别为 Before、After（具体哪边在规格落地计划时定，默认上 Before 下 After） |
| 透明度溶解 | 单画框，滑竿 0–100% 控制 After 叠在 Before 上的不透明度 |
| 自动闪光对比 | 按固定节奏在 Before / After 间切换（可暂停）；不改 mask |

这三项与「左右 / 重叠」并列，作为对照模式扩展槽，不改写回契约。

---

## 4. 写回（沿用 P1）

1. 「精修」：节点 overlay 导出 mask → `persistMediaUrl` → `POST /studio/image/edit`（10 分，`chargeReason: 图像精修`，Image2，服务端合成）
2. 成功：`afterUrl` 进对照；**不** patch 节点 url
3. 「应用到节点」：`appendEditVersion`，同一 `nodeId`，不 `addNodes`
4. 失败/取消：现有 consume → refund；抽屉错误条可重试

`run_icon_refine`、生成 adapter、Prisma schema 不改。

---

## 5. 组件

| 单元 | 职责 |
|------|------|
| `RefineSidePanel.vue` | 停靠抽屉 + 浮动壳、标题栏、工具、指令、迷你对照、版本、应用 |
| 节点 `MaskEditor` overlay | 画在目标 image 节点上，跟 transform |
| `CompareView` | `mode: 'split' \| 'wipe'`；wipe 分界 0–1 |
| `CompareLightbox`（或同等） | 最大化对照，复用 CompareView |
| `canvasEditor` | 仍用 `imageTarget` + `refineBusy`；可加 `refineChrome: 'docked' \| 'floating'` |
| 删除/降级 | 底部 `RefineDockPanel` 不再作为主壳 |

纯函数（单测）：

- `decideRefineDismiss`（已有）+ Agent/Inspector 互斥表
- `clampWipeRatio(n)` → [0, 1]
- 应用前「节点 url 必须等于 session beforeUrl」的断言用现有 `syncRefineUrls` 思路扩展：apply 前 before 不变

---

## 6. 验收

- 点「编辑」→ 右侧推出精修抽屉，底部生成 Dock 消失；画布 fit 到该节点；节点上可画选区
- 标题栏切浮动 → 可拖；再停靠回去
- 精修停靠时点开 Agent → 未 busy 则精修关掉；busy 则 Agent 不展开
- 精修成功后节点仍是旧图；对照能左右和重叠滑竿；最大化能看清
- 「应用到节点」后仍是同一节点，url 变为合成图，版本条可回 N
- 空选区不能提交；RGB 无 alpha 的 mask 不作为前端导出格式

---

## Spec coverage

| 项 | 本文件 |
|----|--------|
| 右侧停靠同 ⓘ + 浮动同 Agent | §1 |
| 与 Agent / Inspector 互斥 | §1 |
| mask 在节点上；应用前节点=Before | §2 |
| 左右 + 重叠滑竿 + 最大化 | §3 |
| 上下擦除 / 溶解 / 闪光 = 后续 | §3 后续 |
| 写回契约 | §4 = P1 |

无 Prisma 新表；无 P2 智能选区。
