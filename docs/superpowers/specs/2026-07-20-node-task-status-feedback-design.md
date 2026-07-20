# 节点任务状态反馈（布局 C）设计规格

**日期**：2026-07-20  
**状态**：已确认，待实现  
**分支建议**：`fix/text-prompt-result-separation`（已含文本 prompt/content 分离与 Dock 取消加固）  
**布局决策**：C — 标题徽章 + 角标操作  

---

## 1. 背景与问题

1. **文本节点**：生成结果回写 `prompt`，Dock Studio 输入被覆盖；期望 Dock 保留提示词，结果只在节点卡片。
2. **取消 / 状态**：生成按钮转圈后难以取消；节点上任务状态几乎不可感知（仅标题旁小点）。
3. **结果反馈**：用户无法直观看到进行中、耗时、失败原因，也无法在卡片上取消/重试。

已锁定产品范围：**完整反馈（原选项 B）** = 状态 + 进度/耗时 + 失败摘要 + 卡片取消/重试。  
视觉布局锁定为 **C**。

---

## 2. 已锁定决策

| 决策 | 结论 |
|------|------|
| 架构 | 共享 `NodeTaskChrome`（方案 1），非每节点各自一套 UI |
| 布局 | **C**：标题旁状态徽章 + 内容区右上角操作 |
| 进度 | 仅「已用时 m:ss」，不做假百分比条 |
| 取消语义 | 客户端 abort + 停轮询；不清空已有结果；不上游强制取消 API（本版） |
| 重试 | 用当前节点 `prompt` + 模型参数再调 `generateForNode` |
| 覆盖节点 | `text` / `image` / `video` / `audio` / `shot` |
| 同 PR 附带 | 文本 prompt/content 分离；Dock 生成中可取消 |

---

## 3. 结构与数据

### 3.1 组件

- **`NodeTaskChrome`**（新）
  - **徽章**：挂在 `NeoBaseNode` 标题行（节点名旁）
  - **角标**：绝对定位于卡片内容区右上角
- Dock 停止按钮与卡片「取消」共用 `cancelGeneration`
- 卡片「重试」调用 `generateForNode`（不要求 Dock 打开）

### 3.2 节点 `data` 字段

| 字段 | 说明 |
|------|------|
| `status` | 已有：`draft` / `generating` / `completed` / `error` / `fallback_pending` |
| `errorMessage` | 已有：失败摘要；卡片截断约 40 字 |
| `generationStartedAt` | **新增**：ISO 时间戳，用于已用时 |
| `generationModel` | **可选**：模型短名，徽章副文案 |
| `generationRecordId` | 已有：轮询恢复 |

### 3.3 文本 prompt / content 分离（附带修复）

| 字段 | 职责 |
|------|------|
| `prompt` | Dock 输入；生成请求用 |
| `content` | 生成结果；仅卡片展示 |

- 生成开始：只更新 `status` + 保留 `prompt`，**不**把 prompt 写入 `content`
- 生成完成：只写 `content`（及 status），**不**覆盖 `prompt`
- Dock `TextDockPanel` 只同步 `prompt` / `textModel`，不 deep-watch `content`

---

## 4. 视觉与文案（布局 C）

### 4.1 徽章

| 状态 | 徽章 |
|------|------|
| `generating` | `生成中 · 0:42`（每秒刷新）；可选副文案模型短名 |
| `error` / `failed` | `失败` |
| `completed`（刚完成） | `已完成`，约 2s 后淡出，仅留标题绿点 |
| `fallback_pending` | `待确认` |
| `draft` / 空闲 | 无徽章 |

### 4.2 角标

| 状态 | 角标 |
|------|------|
| `generating` | 「取消」 |
| `error` / `failed` | 「重试」 |
| `fallback_pending` | 无（走费用确认弹窗） |
| 其他 | 无 |

- 角标 `pointerdown`/`click` 须 `stopPropagation`，避免拖拽/误选中
- 失败时卡片内另有一行错误摘要（`errorMessage` 截断）

### 4.3 Dock 生成按钮（附带）

- 生成中显示停止方块（非仅转圈），可点击取消
- 锁定态 CSS 不得禁用生成按钮的 pointer-events
- `handleNodeGenerate` 在 `flush` **之前**处理取消

---

## 5. 交互与边界

### 5.1 取消

1. abort 进行中的请求（AbortSignal）
2. `stopGenerationPolling(nodeId)`
3. `status → draft`，清除 busy；**保留**已有 `url` / `content`
4. 清除或忽略后续 poll 结果对该节点的写入

### 5.2 重试

1. 若 `prompt`（及该类型必要参数）为空：不发起；短暂提示「请先填写提示词」
2. 否则清 `errorMessage`，写入新的 `generationStartedAt`，再 `generateForNode`

### 5.3 耗时

- 客户端根据 `generationStartedAt` 计算；无后端进度
- 刷新后仍为 `generating` 且有 `generationRecordId`：恢复轮询；若无 `generationStartedAt`，从恢复时刻起算

### 5.4 与 Dock

- 未选中节点也可在卡片上取消/重试
- 与 Dock 同时操作时依赖现有 per-node busy 守卫，禁止双开同节点任务

### 5.5 本版明确不做

- 全局任务列表 / 批量取消
- 服务端取消上游供应商任务
- 真实百分比进度条

---

## 6. 落地范围与验收

### 6.1 交付物

1. 文本 prompt/content 分离 + TextDockPanel 同步修复  
2. Dock 可取消加固  
3. `NodeTaskChrome` 布局 C + 五类节点接入  
4. `generationStartedAt`（及可选 model）在开始生成时写入  

### 6.2 验收

- [ ] 文本生成后 Dock 提示词不变，卡片显示结果  
- [ ] 生成中：标题徽章「生成中 · m:ss」，右上可取消  
- [ ] 取消后回草稿，已有媒体/正文保留  
- [ ] 失败：徽章「失败」+ 摘要 + 角标重试可再跑  
- [ ] 完成：短暂「已完成」后徽章消失  
- [ ] 不打开 Dock 时，仅角标可取消/重试  

### 6.3 测试

- 单测：文本不覆盖 prompt；取消路径；`generationStartedAt` 写入  
- 手测：text + image 各走 生成 → 取消 →（模拟）失败重试  

---

## 7. 实现提示（非阻塞）

- 在 `useNodeGeneration.beginNodeWork` / 首次 `patchNodeData(..., generating)` 时写入 `generationStartedAt: new Date().toISOString()`
- `CanvasPage` 向节点组件注入 cancel/retry 回调（与现有 `patchNodeData` / `generateForNode` 对齐），避免每个 CanvasNode 直接依赖 composable 实例细节
- 标题徽章可扩 `NeoBaseNode` slot 或 props，避免复制五套标题 DOM
