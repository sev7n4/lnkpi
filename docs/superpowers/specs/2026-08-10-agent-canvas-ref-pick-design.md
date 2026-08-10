# Agent 画布引用 Pick 模式 — 设计规格

> 状态：**已确认**（2026-08-10）  
> 前置：[2026-08-07-agent-sidebar-material-entry-design.md](./2026-08-07-agent-sidebar-material-entry-design.md)、[2026-08-10-ui-p0-interactions-design.md](./2026-08-10-ui-p0-interactions-design.md)

---

## 1. 决策摘要

| # | 决策 | 说明 |
|---|------|------|
| D1 | **🎯 一级显性按钮** | Agent dock 参数行 `[模型▾] [🎯] [＋] [技能▾]`，非 + 子菜单 |
| D2 | **图标 + tooltip** | 默认 outline；Pick 中 `filled` + `is-active` 高亮 |
| D3 | **Toggle 退出** | 再点 🎯，或点击 dock 对话区（输入框/引用条），自动变灰退出 Pick |
| D4 | **默认保持 Pick** | 点选节点后不自动退出；每点一个节点 chip 即时出现 |
| D5 | **与节点 ★ 并存** | 节点标题栏 🎯 = 单节点快捷加；Agent 🎯 = 批量点选模式 |
| D6 | **统一引用图标** | `CanvasRefTargetIcon` 🎯 — 引用到 Agent（节点标题 / 资产库 / Agent dock） |
| D7 | **统一定位图标** | `CanvasLocatePinIcon` 📍 — 画布内定位/聚焦（产出列表 / 任务 / 发布等） |

---

## 2. 布局

```
AgentRefStrip
  有 chip → 展示 chip 列表
  无 chip → 虚线槽「＋ 从画布选节点」（次要入口，点进 Pick）

agent-dock-params
  [模型▾] [🎯画布引用] [＋] [技能▾]     ← 主入口

Pick 激活时
  画布：轻遮罩 + 顶栏「点选节点加入引用 · 已选 N · 完成 · Esc」
  光标：自定义 canvas-pick cursor（准星+靶）
  侧栏 🎯：filled + is-active
```

---

## 3. 状态机

```text
Idle
  → 点 🎯 / 空态 CTA → PickMode（🎯 高亮 filled）
  → 画布已有选中 + 点 🎯 → 直接加 chip（可选：仍进 Pick）

PickMode
  → 点节点 → addFromCanvasNode → chip 即时反馈，保持 Pick
  → 再点 🎯 → Idle（图标变灰 outline）
  → 点 dock 对话区（MentionInput / RefStrip / 输入 dock 内）→ Idle
  → 点「完成」/ Esc → Idle
  → 点节点标题 🎯 → 单节点加 chip，不强制退出 Pick
```

---

## 4. 画布 Pick 视觉

| 元素 | 行为 |
|------|------|
| 遮罩 | 画布区 `rgba(0,0,0,0.22)`，Agent 侧栏 / 左 dock 不遮 |
| 顶栏 | canvas 内浮动 pill，显示已选数量 + 完成 |
| 节点 hover | `--neo-hi` 描边 pulse |
| 已选节点 | 持续 hi 描边 |
| 不可引用 | 虚线框 + tooltip「暂无可用内容」 |
| 光标 | `url(canvas-pick.svg) 12 12, crosshair` |

---

## 5. 节点标题栏 🎯（已实现图标统一）

```
[类型icon]  标题……  ●status  [🎯]   ← 最右，hover 淡入
                              ↑
                    CanvasRefTargetIcon (outline)
                    点击 → addFromCanvasNode + openPanel
```

与预览区内 `[存库][下载][替换]` **不重叠**（见 ui-p0 §2）。

---

## 6. 实现任务（待开发）

- [x] `useCanvasRefPickMode` composable（CanvasPage ↔ AgentSideRail）
- [x] Agent dock 🎯 按钮 + tooltip + filled toggle
- [x] AgentRefStrip 空态 CTA
- [x] 画布遮罩 / 顶栏 / cursor / 节点 click 拦截
- [x] dock 对话区 click → 退出 Pick
- [x] 从 + 菜单移除「画布节点」（改由 🎯 承担）
- [x] 定位图标统一为 `CanvasLocatePinIcon`（与 🎯 引用图标区分）

---

## 7. 非目标（本 spec）

- 拖拽节点到引用条（P1）
- 节点列表 Popover 选取（副入口，后续可选）
