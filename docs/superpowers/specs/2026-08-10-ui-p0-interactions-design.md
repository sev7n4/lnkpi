# UI P0 交互修复设计

> 范围：ref 预览、dock/Agent 引用、节点 hover 加入 Agent、首页创建流程、资产入口合并、参数条 hover 展示、资产库加入 Agent。
> P1/P2（画布列表、视觉重做、连线样式）另开 spec。

## 1. Ref 预览不遮挡 Studio/Dock

- `AgentRefHoverPreview` 改为基于 chip 的 `getBoundingClientRect` 定位
- 测量 `.dock-studio-toolbar` / `.agent-input-dock` 顶部，预览底边保持在其上方 8px
- 空间不足时优先 flip 到 chip 上方

## 2. 节点 hover 加入 Agent

- `NeoBaseNode` 右上角 hover 显示「加入 Agent」图标
- `provide(CANVAS_NODE_ADD_AGENT_KEY)` → `addFromCanvasNodes` + `openPanel`

## 3–4. 首页创建 + 自动开 Agent

- `createCanvas` 跳转 `?openAgent=1&initialPrompt=...`
- `CanvasPage` 消费 query，`openPanel` + `setComposerInput`

## 5–6. Agent 底部资产合并

- 单一「添加引用」菜单：本地上传 | 画布节点资产 | 我的资产库

## 7. Agent 参数条 hover 展示

- `UniversalModelSelector`、引用、技能默认折叠；hover/focus-within `agent-input-dock` 时展开
- 麦克风与发送按钮始终可见

## 8. 左侧资产库加入 Agent

- `CanvasAssetPanel` hover 层增加「加入 Agent」
- `CanvasPage` 转为 `SidebarAttachment` 并 `openPanel`
