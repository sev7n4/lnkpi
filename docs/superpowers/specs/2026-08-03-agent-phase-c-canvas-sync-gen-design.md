# Phase C：画布/Dock 手工改完再「执行生图」

> 状态：MVP 规格  
> 依赖：Phase A `await_topo` 出图门、Phase B 一致性链（已落地）

## 1. 目标

用户在 **await_topo** 阶段通过画布/Dock 手工增删改节点或 prompt 后，对话发送「确认出图」或「执行生图」，Runtime **以当前画布为权威** 同步 `split_manifest`，再走现有 `start_gen → gen_scheduler → gen_node`。

## 2. 非目标（MVP）

- 不从画布自动推断复杂 `depends_on`（保留 manifest 已有依赖；新增节点 `depends_on=[]`）
- 不实现 Dock model/skillId 端到端（§10 二期）
- 不在 plan/confirm 阶段同步画布

## 3. 流程

```
await_topo（用户手工改画布）
  → 用户：「执行生图」/「确认出图」
  → start_gen：get_canvas_summary → reconcile split_manifest
  → gen_scheduler …（与现有一致）
```

## 4. 对账规则（canvas → manifest）

| 情况 | 动作 |
| --- | --- |
| manifest 有 `node_id` 且画布仍存在 | 保留，更新 `title` |
| manifest 有 `node_id` 但画布已删 | 从 manifest 移除 |
| 画布新增 image/video 节点（非 plan） | 追加 manifest 项，`auto_generate=true` |
| text/plan 节点 | 不参与新增Discovery |

## 5. 成功标准

1. 手工删除画布节点后「确认出图」，不生成已删节点  
2. 手工新增 image 节点后「执行生图」，该节点进入 gen 队列  
3. Phase B 脚本仍 PASS；可选 Phase C 扩展用例
