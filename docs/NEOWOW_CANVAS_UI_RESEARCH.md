# NeoWOW 画布 UI 深度调研（2026-07-10）

> 对标 URL：https://neowow.cn/workflow?sessionId=2075168177019133952  
> 方法：HTML + `WorkflowCanvas-IwMyO27T.js` + `WorkflowCanvas-BmojlfTA.css` 公开 bundle 逆向（不复制源码）

---

## 1. 核心结论（与当前 lnkpi 最大差异）

| 维度 | NeoWOW 实际设计 | lnkpi 当前实现 | 偏差等级 |
|------|----------------|----------------|----------|
| 底部创作区 | **NodePanel 节点坞** + **选中节点 BottomToolbar** | 单一 `GenerationBar` 全局生成 | 🔴 架构错误 |
| Agent | **GeminiChatAgent 浮动窗**（FloatingWindow） | 固定右侧 `AgentPanel` 320px | 🔴 布局错误 |
| 参数编辑 | 点击节点 → 底部工具条展示该节点参数 | 参数在 GenerationBar / 节点内混杂 | 🔴 |
| 分组 | **框选多选** → 多选工具栏「打组」 | 右键菜单「加入分组」 | 🔴 UX 错误 |
| 小地图 | **WorkflowMinimapPanel**（可展开/全屏/节点列表） | Vue Flow 默认 `MiniMap` + `Controls` | 🔴 |
| 节点类型 | 9 种生成/输入节点（见 §3） | shot/image/video/text/group 等简化模型 | 🟡 |

**用户反馈「不要任意发挥」的根因**：我们把 M2 的「底部生成栏」做成了全局 Prompt 输入，而 Neo 早已演进为 **「画布节点 + 底部节点编辑器」** 模式（与 TapNow/LiblibTV 同类 Prompt Composer 架构）。

---

## 2. NeoWOW 画布布局（蒸馏）

```
┌─────────────────────────────────────────────────────────────────────┐
│ [SessionSelector 左]     无限画布 (Vue Flow + PlayCanvas)            │
│                          CanvasPinBar (顶部 Pin 色标条)              │
│                          ZoomRuler (极简模式缩放尺)                   │
├─────────────────────────────────────────────────────────────────────┤
│ 左下 CanvasStatus          中下 NodePanel + BottomToolbarWrapper      │
│ · 连线数 / 节点列表         · 胶囊按钮：+文本/图/视/音/导演台…          │
│ · 分组数 / 生成中任务       · 选中节点时：模型/比例/时长/Mention/生成   │
│ · 错误边检查               · UniversalModelSelector / VideoSettings    │
│ 左下缩放控制栏                                                    右下 WorkflowMinimapPanel │
│ (网格/对齐/适应)              · 缩略地图 + 展开全屏 + 节点搜索定位      │
└─────────────────────────────────────────────────────────────────────┘
        GeminiChatAgent（浮动对话窗，非固定侧栏）
```

**关键点**：
- 画布占满 Header 以下区域，**无固定右侧 Agent 栏**
- 底部有两层：`NodePanel`（常驻加节点）+ `BottomToolbarWrapper`（选中时出现）
- Agent 通过 `FloatingWindow` 悬浮，可收起，与底部工具条**职责分离**

---

## 3. 节点类型（bundle 中 `NODE_TYPE` / `NodePanel` 菜单）

| type | 中文 | 说明 |
|------|------|------|
| `mediaInput` | 媒体输入 | 上传图片/视频，可转生成节点 |
| `text` | 文本生成 | 脚本/广告词；badge「Neo-G 5.5」 |
| `image` | 图片生成 | badge「Neo Image2」 |
| `video` | 视频生成 | TEXT_TO_VIDEO / IMAGE_TO_VIDEO 等 |
| `audio` | 音频生成 | 音色/情感/语速 |
| `videoComposition` | 视频合成 | 多轨合成 |
| `sceneComposer` | **导演台** | 场景编排、预览图 |
| `worldModel` | 3D World | Beta，SPZ 漫游 |
| `comment` | 评论 | 协作批注 |
| `group` | 分组 | 多选打组容器，`parentNode` 嵌套 |

**底部 NodePanel 菜单项（bundle 明文）**：
```javascript
[
  { type: 'text', label: '文本', badge: 'Neo-G 5.5', description: '脚本、广告词、品牌文案' },
  { type: 'image', label: '图片', badge: 'Neo Image2', description: '...' },
  { type: 'video', label: '视频' },
  { type: 'audio', label: '音频' },
  { type: 'videoComposition', label: '视频合成' },
  { type: 'sceneComposer', label: '导演台' },
  { type: 'worldModel', label: '3D World', badge: 'Beta', description: '生成可漫游的 3D 世界' },
]
```

---

## 4. 底部创作台交互（对标用户诉求 §1 §2）

### 4.1 NodePanel（常驻节点坞）

- 组件：`NodePanel` + `BottomToolbarWrapper` 容器
- CSS 类：`node-panel-dock`、`capsule-buttons`、`add-menu-popover`
- 支持：拖拽节点类型到画布、`@add-node`、文件上传 `@upload-files`
- 可 dock/undock（localStorage `workflow-node-panel-dock`）
- 缩放：`bottomToolbarScale`（设置面板可调 0.8–2.0）

### 4.2 BottomToolbarWrapper（选中节点编辑器）

- **仅在选中单个可编辑节点时**显示（只读模式 `readonly-toolbar` 除外）
- 按节点类型挂载不同工具条：
  - 图片：`ImageNodeToolbar`（模型、比例、参考图）
  - 视频：`VideoSettingsSelector` + `UniversalModelSelector`
  - 文本：`TextModelSelector`
  - 音频：`VoiceSynthesisPanel` / `VoiceModelSelector`
- 通用：`MentionInput`、`VoiceInput`、`GenerateButton`
- 数据流：编辑底部表单 → **实时 sync 回节点 `data`**（不在节点内嵌大表单）

### 4.3 与 Agent 的关系

- `GeminiChatAgent`：浮动窗 + `ChatModelSelector` + SSE `/agent/chat/conversation`
- Agent 通过 tool call 创建/更新节点，**不占用底部 UI 空间**
- 用户诉求 §4「底部工作台与右边 Agent 重复」→ Neo 做法是 **去掉固定右栏，Agent 改浮动**

---

## 5. 分组与框选（对标用户诉求 §3）

来源：画布使用指南（bundle 内 `guide-desc` 明文）

| 操作 | NeoWOW 行为 |
|------|-------------|
| 框选 | 空白处 **左键拖动** 框选多个节点 |
| 加选 | **Shift / Cmd+Click** 追加选择 |
| 打组 | 多选后工具栏 **「打组」**，`groupPadding` 默认 80px |
| 组内 | `GroupNode` + `parentNode` 嵌套，`groupResize` / `group_layout` |
| 组列表 | `CanvasStatus` 分组入口 → 列出所有 group |

**不应采用**：仅靠右键「加入分组」（当前 lnkpi Sprint 6.1 做法不符合 Neo）。

---

## 6. 小地图（对标用户诉求 §5）

组件：`WorkflowMinimapPanel` + `WorkflowMiniMap`（自定义 Vue Flow minimap）

| 特性 | NeoWOW |
|------|--------|
| 位置 | 右下，`minimap-container` |
| 状态 | `minimapExpanded`: 0 隐藏 / 1 展开 / 2 **全屏节点列表** |
| 交互 | 点击 minimap 定位；全屏模式带 **搜索 + 按类型分组列表** |
| 样式 | 背景 `rgba(20,20,20,.9)`；节点 `fill: rgba(255,255,255,.2)`；viewport 描边 |
| 默认 Controls | **不用** Vue Flow 自带 Controls（Neo 用左下自定义缩放栏） |

lnkpi 当前：`@vue-flow/minimap` + `@vue-flow/controls` 默认样式 → 需整体替换。

---

## 7. 后端 API 能力（画布域，Neo 已有 / lnkpi 对照）

| API | Neo | lnkpi |
|-----|-----|-------|
| canvas CRUD + shot | ✅ | ✅ |
| shot/edit, shot-order | ✅ | ✅ (Sprint 6.1) |
| material/generate-image/video | ✅ | ✅ |
| material/upscale-image | ✅ | ❌ |
| material/lip-sync | ✅ | ❌ |
| shot/optimize-prompt | ✅ | ❌ (仅有 chat/optimize-prompt) |
| capabilities/list | ✅ | ✅ |
| chat/conversation SSE | ✅ | ✅ |
| OSS upload / sts | ✅ | ❌ |

---

## 8. lnkpi 改造方案（Phase 7 — 严格对标）

### Sprint 7.1 — 布局重构（P0，阻断项）

- [ ] **移除** 固定右侧 `AgentPanel` → 改为 `AgentFloatingWindow`（可拖拽/收起）
- [ ] **移除** 全局 `GenerationBar`
- [ ] 新增 `NodePanelDock`（底部常驻加节点胶囊栏）
- [ ] 新增 `BottomNodeToolbar`（选中节点时显示，sync 节点 data）
- [ ] 画布改为 **全宽**，Session 侧栏保留

### Sprint 7.2 — 节点体系（P0）

- [ ] 节点类型对齐：`text/image/video/audio/sceneComposer/mediaInput/group`
- [ ] 各类型节点卡片简化（仅预览/状态，表单在底部工具条）
- [ ] `UniversalModelSelector` 统一模型入口（读 `/agent/capabilities/list`）
- [ ] 生成按钮走现有 canvas/studio API

### Sprint 7.3 — 框选打组（P0）

- [ ] Vue Flow `selectionOnDrag` 框选
- [ ] 多选浮动工具栏：打组 / 删除 / 整理布局
- [ ] `GroupNode` 使用 `parentNode` 嵌套 + `groupPadding`
- [ ] 移除右键「加入分组」为主路径

### Sprint 7.4 — 小地图 + 状态栏（P1）

- [ ] 实现 `WorkflowMinimapPanel`（三态 + 节点列表搜索）
- [ ] 左下 `CanvasStatus`（节点数/分组/生成中）
- [ ] 移除默认 `Controls`，改用 Neo 风格缩放栏

### Sprint 7.5 — 后端补齐（P1）

- [ ] shot/optimize-prompt、material/upscale（按需）
- [ ] OSS 上传（可选）

---

## 9. 文件级改造映射（lnkpi）

| 删除/弱化 | 新增/重写 |
|-----------|-----------|
| `GenerationBar.vue` | `NodePanelDock.vue` |
| `AgentPanel.vue`（固定侧栏） | `AgentFloatingWindow.vue` |
| `CanvasPage.vue` 三栏布局 | `CanvasPage.vue` 全画布 + overlay |
| `@vue-flow/controls` | `CanvasZoomBar.vue` |
| 默认 `MiniMap` | `WorkflowMinimapPanel.vue` |
| `CanvasContextMenu` 分组 | `MultiSelectToolbar.vue` + 框选 |
| — | `composables/useSelectedNodeEditor.ts` |
| — | `BottomNodeToolbar/` 按类型子组件 |

---

## 10. 验收标准（截图级）

1. 底部可见 **文本/图片/视频/音频/导演台** 等胶囊按钮，点击后在画布添加对应节点
2. 选中图片节点 → 底部出现模型+比例+prompt+生成，**不是**全局 GenerationBar
3. 框选 3 个节点 → 出现「打组」→ 生成 Group 容器
4. **无**固定右侧 Agent 栏；Agent 为可收起浮动窗
5. 右下小地图可展开为节点列表并搜索定位

---

## 参考 bundle 组件清单

```
WorkflowCanvas, NodePanel, BottomToolbarWrapper, WorkflowMinimapPanel,
WorkflowMiniMap, CanvasStatus, CanvasPinBar, ZoomRuler,
ImageNodeToolbar, VideoSettingsSelector, UniversalModelSelector,
TextModelSelector, MentionInput, VoiceInput, GenerateButton,
GeminiChatAgent, FloatingWindow, GroupNode, BaseNode,
TextGenerationNode, ImageGenerationNode, VideoGenerationNode,
AudioGenerationNode, SceneComposerNode, MediaInputNode
```

---

## 11. Dock Studio 端到端跟踪

节点级 E2E 打通的任务拆解、里程碑、验收清单与 Sprint 排期见：

**[DOCK_STUDIO_E2E_TRACKING.md](./DOCK_STUDIO_E2E_TRACKING.md)**
