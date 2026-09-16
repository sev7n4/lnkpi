# 规划确认门确定性落盘（v1.6）

> 日期：2026-09-16  
> 状态：**已批准**（对话确认方案 A + 设计两段）  
> 产品：超创平台（lnkpi）无限画布 / Agent 侧栏规划器  
> 父规格：[2026-09-15-workflow-recipe-planner-design.md](./2026-09-15-workflow-recipe-planner-design.md) §14.5 / §14.10  
> 范围：规划 → preview → 点「确认落到画布」**必须** instantiate；失败文案不得被节点闸门盖掉  
> 非范围：一句话直落（没走过确认）、preview HITL 文案、晋升 chip、`import_workflow` 手搭、campaign / `await_topo`

## 0. 决策摘要

| # | 决策 |
|---|------|
| **C1** | 实现路径 **方案 A**：chip「确认落到画布」在 explore **进 LLM 之前**短路，确定性调用 `instantiate_workflow_template` |
| **C2** | 只处理侧栏 `sendPreset` 的**整句** chip（trim 后全等），不匹配自由发挥的「确认落到画布吧」 |
| **C3** | instantiate 参数跟**最近一次成功的** `preview_workflow_template` 调用参数（从确认 user 往前扫 messages；跳过失败的 preview，不因一次失败作废更早的成功） |
| **C4** | 只用 preview **调用参数** `parent_id` / `parent_version` / `delta`（缺 delta → `{}`）。禁止把 preview 返回体里的整份 Recipe IR 交给 instantiate |
| **C5** | 填槽原话仍用 `pick_planner_slot_utterance`（跳过确认 chip）；侧栏附件照旧随 Nest instantiate |
| **C6** | 无成功 preview：不写画布；文案见 §3。**禁止**「未能更新节点，请提供节点 id」 |
| **C7** | Nest instantiate 失败：把服务端用户文案原样回侧栏。同样禁止节点 id 追问 |
| **C8** | 「先不改」整句：不写画布、不调 LLM；短回取消文案 |
| **C9** | 同一 preview 再次「确认落到画布」：**再落一份**（与现有 import 语义一致；本切片不去重） |
| **C10** | 「先不改」**不作废**上次成功 preview；之后再点确认仍按 C3 查找 |

## 1. 背景

生产复测与 explore 闸门叠加后，点「确认落到画布」常被标成 `node_write`。模型若未调用 instantiate，`explore` 用 `_NODE_WRITE_CLARIFY`（未能更新节点，请提供节点 id）盖掉回复。空画布必现，规划确认门失效。

§14.5 已规定：preview 成功且本轮未 instantiate 时出确认句 + chip；确认后才 bind instantiate。v1.5 已钉死 preview 回复 SSOT。缺口是确认这一跳仍赌 LLM 调工具并记住 `parentId`/`delta`。

## 2. 确认门流程

```text
本轮 user trim 后全等「确认落到画布」
  → 从该 HumanMessage 往前扫 thread 原始 messages
       命中最近一次成功的 preview_workflow_template
       （有 tool 调用，配对 ToolMessage 无 error）
  → 有：不调 LLM；instantiate(parent_id, parent_version, delta?)
       成功 → 「已按模板落到画布。」
       Nest 失败 → 原样回服务端用户文案（如 empty_prompt）
  → 无任何成功 preview：不写画布 → 「请先规划并确认模板改动，再落到画布。」

本轮 user trim 后全等「先不改」
  → 不调 LLM、不 instantiate → 「已取消落到画布。」
```

查找范围是 **LangGraph thread 原始 messages**（含 `tool_calls` / `ToolMessage`），不是压缩后的 LLM 摘要。失败的 preview 跳过；其前若有成功 preview，仍按 C3 落盘。一次成功都没有才走 C6。

成功回复与现有 instantiate 后机器载荷替换文案一致：`已按模板落到画布。`

## 3. 失败文案（验收钉死）

| 情况 | 助手文案 | 禁止 |
|------|----------|------|
| 无成功 preview 就点确认 | `请先规划并确认模板改动，再落到画布。` | `未能更新节点` / 节点 id 追问 |
| Nest instantiate 失败 | 服务端返回的用户文案（如「还有步骤没写提示词…」） | 同上；不编造节点 id |
| 「先不改」 | `已取消落到画布。` | 任何写画布 |

chip 确认 / 「先不改」回合 **不得**进入 `node_write` 空工具闸门。

## 4. 非目标

- 用户直接说「把角色三视图落到画布 / 导入这条模板」、没点确认 chip
- 改 preview HITL `diffLines` 文案、晋升二次确认 chip
- 用 `import_workflow` 手搭规划拓扑
- 规划器进入 campaign / `await_topo`
- checkpoint 里持久化 `planner_preview` snapshot（失败后再开；本切片从 messages 恢复即可）

## 5. 验收

1. 规划 → `preview_workflow_template` 成功 → 点「确认落到画布」→ 调用 `instantiate_workflow_template`，`parent_id` / `parent_version` / `delta` 与那次 preview **调用参数**一致，画布出现新节点；助手为「已按模板落到画布。」
2. 同一路径下 explore **不** `ainvoke` LLM。
3. 无成功 preview 就点确认 → 不写画布；文案为 §3 无 preview 句；**不是**「未能更新节点，请提供节点 id」。
4. 「先不改」→ 不调用 instantiate。
5. instantiate HTTP/业务失败 → 侧栏可见服务端用户文案；**不是**「未能更新节点」。

## 6. 实现落点（计划阶段可再拆任务）

- `services/agent-runtime/app/graph/nodes/explore.py`：chip 短路；闸门豁免
- `services/agent-runtime/app/graph/planner_copy.py`（或同级小模块）：从 messages 解析最近成功 preview 参数
- 测试：`test_planner_copy.py` / 新 `test_planner_confirm_instantiate.py` 覆盖 §5
- 前端 chip 文案保持 `确认落到画布` / `先不改`，本切片不改 Vue
