# UI P1/P2 交互与视觉设计

> P0 已在 `2026-08-10-ui-p0-interactions-design.md` 完成（PR #207）。

## P1 — 主页画布列表 ✅

- [x] 默认展示 5 个 +「查看更多」
- [x] 封面缩略图（从 canvasData 首图/视频节点推导）
- [x] 批量删除（`POST /sessions/batch-delete`）
- [x] 搜索（客户端 title 过滤）

## P2 — 视觉重做（部分完成）

### 主页 Studio ✅

- [x] `CreativeLauncher` 对齐 neo-glass / hi-bg 白钮

### 画布主题与紫色背景（部分）

- [x] Agent 顶栏 active、drop-target、skill icon
- [x] 左侧 dock active 态
- [x] 底栏 seg-btn、group 选中
- [x] 框选矩形、placeholder、ref chip drag、MentionInput、dock-seg-btn
- [ ] 主页/Studio 独立页、WorkCard 等站外页面

### 连线样式自定义 ✅

- [x] 粗细 / 颜色 / 发光 / 实虚线（localStorage + 底栏 popover）

### Agent 侧栏 Studio 布局

- [x] ghost 单层 dock（#210）
- [ ] dock-studio 模型选择器同样 ghost 化（可选）

