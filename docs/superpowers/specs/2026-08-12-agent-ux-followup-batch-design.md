# Agent UX 跟进批次 — 设计规格

> **状态**：实现中  
> **日期**：2026-08-12  
> **触发**：产品视觉 Sign-off 后用户 7 项体验问题  
> **策略**：SDD 并行、5 PR 交付（Wave 1–3）

---

## 1. 问题与 PR 映射

| # | 问题 | 根因 | PR |
|---|------|------|-----|
| 4 | 宏观门控自由文本修订报错 | `classify_macro_scheme_decision` 关键词过窄 + 长文本走 fresh-turn 清空 `macro_schemes` | PR-1 |
| 7 | 画布图片双击预览不灵 | Vue Flow 拖拽吞双击；预览区缺 `nodrag` | PR-2 |
| 6 | 移动端首页不可见 | Header/Launcher 窄屏溢出；main 缺 stacking | PR-3 |
| 3+5 | 宏观卡片/执行过程不进历史 | `AgentMessage` 仅存纯文本 | PR-4 |
| 1 | 识图不可用 | 配置/模型降级（by-design） | PR-5a（后续） |
| 2 | 宏观方案固定 2 套 | Prompt 偏 A/B + `MAX_MACRO_SCHEMES_SELECTED=2` | PR-5b（后续） |

---

## 2. PR-1：宏观自由文本修订

### 2.1 行为

在 `await_macro_scheme_select` 门控下：

- 含修订意图的自由文本（如「商业特写，但是需要增加更多模特…」）→ `action: revise`
- 长文本（>24 字）且无 `@T/I/V/A` 引用 → **resume 门控**，禁止 fresh-turn

### 2.2 验收

- 复现用例不再出现「宏观方案缺失」与 `INVALID_CONCURRENT_GRAPH_UPDATE`
- `test_hitl_resume` + `test_product_visual_v2_nodes` 通过

---

## 3. PR-2：图片预览入口

- 预览区加 `nodrag` + `draggable="false"`
- Hover 显示眼睛按钮（仿 `CanvasNodeVideo` play 按钮）

---

## 4. PR-3：移动端首页

- `main` 加 `relative z-10`
- Header 窄屏：缩小 padding、隐藏昵称文字
- `WorkflowPage` / Launcher 移动端 padding 与按钮换行

---

## 5. PR-4：Turn metadata 持久化

### 5.1 Schema

`AgentMessage.metadata` JSON：

```json
{
  "presentation": { "kind": "macro_scheme_cards", ... },
  "executionEvents": [{ "type": "step", "data": {...} }]
}
```

### 5.2 写入

Nest `streamFromRuntime` 在 `finalizeTurn` 写入 metadata。

### 5.3 读取

`loadHistory` 反序列化；`replayExecutionTraceEvents` 重建 trace；历史气泡渲染 `AgentPresentationHost`（disabled）。

---

## 6. 合并顺序

PR-1 → PR-2/PR-3（并行）→ PR-4 → PR-5a/5b
