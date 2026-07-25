# Agent 拓扑预览确认 + 方案门结构化 HITL（设计）

> 状态：**已确认**（2026-07-25）  
> 日期：2026-07-25  
> 前置：  
> - `2026-07-23-agent-runtime-langgraph-design.md`（Runtime / 控制流 vs 数据流）  
> - `2026-07-25-agent-confirm-loop-hardening-design.md`（主文案 HITL / Graph §7）  
> - `2026-07-25-agent-task-progress-card-design.md`（任务卡）  
> 范围（本期 **A**）：方案门多轮摘要 + 结构化选项、确认后写方案节点、骨架预览（Mermaid + 画布）、`await_topo`、出图门、Skill `full|trimmed` 双模式  
> 非范围：**B** 人物/产品三视图一致性链；**C** 画布/Dock 手工改完再「执行生图」完整闭环；durable `interrupt()`  

路线图：A（本文）→ B → C。

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 方案门 | 多轮 NL + **结构化选项（1/A、2/B、3/C）**；附推荐与理由 |
| 方案节点写入 | **确认前不写**；「确认方案」时才 `upsert`「营销方案」节点 |
| 确认后 | 对话输出「已确认方案摘要」→ 再 `split` |
| 拓扑预览 | **对话 Mermaid（资产拓扑）+ 画布骨架**；确认出图前可改 |
| 改拓扑 | NL → **即时**改画布骨架 + 重发 Mermaid |
| 门控 | 方案门 → 骨架可改（`await_topo`，含文案 HITL）→ **出图门** |
| 模板模式 | Skill `topology_mode_default: full\|trimmed` + 用户可覆盖 |
| 主文案 | 骨架阶段草稿确认；出图门只管 image/video |
| 出图时机 | **仅**「确认出图」后 `orchestrate_gen`；禁止 draft 后自动 bg 出图 |
| 实现 | LangGraph 加 `await_topo` + `write_plan_node` |

---

## 1. 用户旅程与相位

```text
用户要方案
  → plan：只生成方案摘要 + 结构化选项（不写画布）
  → await_confirm
       · 选 2/B 或 3/C / 自由 NL → 回到 plan（更新摘要与选项）
       · 选 1/A 确认 → write_plan_node（确认稿写入营销方案节点）
                    → 对话「已确认方案摘要」
                    → 解析 topology_mode（Skill 默认 | 覆盖）
                    → split：物化骨架 + 连线（本步不出图）
                    → Mermaid 资产拓扑
                    → draft_copy（主文案草稿 chips）
                    → phase=await_topo

await_topo（可多轮）
  · NL 改拓扑 → 即时改骨架 + 重发 Mermaid
  · 写入/修改主文案 → await_copy_confirm / write_copy_node → 回到 await_topo
  · 「确认出图」→ orchestrate_gen → done
```

### 1.1 相对现状的关键变化

| 现状 | 本期 |
| --- | --- |
| `plan` 当轮 `upsert_prompt_node` | 确认前不写；确认后 `write_plan_node` |
| 「确认拆图」= 拆骨架并出图 | 拆成 **确认方案** 与 **确认出图** |
| draft 后可 bg 出图 | 出图必须过出图门 |
| 固定 9 项模板 | `full` 全量 + `trimmed` 裁剪；复测双路径 |

---

## 2. 方案门：结构化选项

每轮 `plan` / 修订后的助手消息须包含：

1. **方案摘要**（定位、卖点、将拆资产意向列表）  
2. **推荐选项**（默认标在 1/A）+ **一句话理由**  
3. **可选决策**（chips 与文案一致）：

| 选项 | 含义 |
| --- | --- |
| `1` / `A` | 采纳推荐，确认方案（写画布并进入骨架） |
| `2` / `B` | 按 Agent 给出的某一改法修改（选项文案动态，如「更偏天猫详情」） |
| `3` / `C` | 我自己说明修改（下一轮自由 NL） |

用户可点 chip 或回复编号/字母。`await_confirm` 分类：

- confirm：`1`/`A`/「确认方案」等  
- revise：`2`/`B`/`3`/`C`/「要修改」/自由修改说明  
- none：提示并保持门  

确认成功后必须：

1. `write_plan_node`：确认稿 → 画布「营销方案」（剥开场白，沿用既有清洗）  
2. `text_delta`：「已确认方案摘要」短结  
3. 进入 `split`（不得在确认前创建该节点）

---

## 3. 拓扑预览、NL 改拓扑、出图门

### 3.1 Mermaid（资产拓扑，非控制流）

- 内容：`split_manifest` 的 `depends_on` / 画布数据边  
- 节点 label = 画布节点 `title`（可附 `key`），与骨架一一对应  
- 每次 split 成功或拓扑变更后重发完整 `flowchart`

### 3.2 `await_topo`

- 支持：增/删**模板内**节点、改 `depends_on`、改标题/`prompt_hint`  
- 即时：Nest 增删节点/边/`set_node_prompt` + 更新 `split_manifest` + 重发 Mermaid  
- 依赖闭包：选中下游须带上游；删上游时断开或提示下游边  
- chips：「确认出图」/「要改拓扑」；若主文案未写入，保留「写入主文案」/「要修改」

### 3.3 出图门

- 「确认出图」→ `orchestrate_gen`（仅 image/video 且应自动生成的项）  
- **禁止**在 `draft_copy` 后通过 `pending_orchestrate` 后台自动出图  
- 骨架期节点可存在，但生成在出图门之后

---

## 4. Skill 双模式

```yaml
# SKILL.md metadata 或 canvas-manifest.yaml
topology_mode_default: full   # full | trimmed
```

| 模式 | 行为 |
| --- | --- |
| `full` | 使用 manifest `items` 全量 |
| `trimmed` | LLM 从模板 `key` 中选子集 + 依赖闭包；禁止模板外 key |

用户覆盖（方案确认后或 `await_topo` 内）：「用全套模板」「按方案精简」→ 写入 state `topology_mode`，必要时重建/裁剪骨架。

**复测：** 同一 Skill 各跑 `full` 与 `trimmed` 一条干净画布路径。

---

## 5. Graph / State（相对 confirm-loop §7 的修订）

```text
START → route_entry
  ├─ await_copy_confirm → … →（写完）回到 await_topo 语义
  ├─ await_topo → confirm_gen → orchestrate_gen → done
  │            → topo_revise → await_topo
  │            → copy_* → await_copy_confirm
  ├─ await_confirm → confirm → write_plan_node → split → draft_copy → await_topo
  │               → revise  → plan → await_confirm
  └─ intake → plan → await_confirm
            → chat → END
```

新增/调整字段：

| 字段 | 含义 |
| --- | --- |
| `plan_draft` | 确认前方案正文（只存 state/对话） |
| `topology_mode` | `full` \| `trimmed` |
| `phase=await_topo` | 骨架可改 / 待出图 |
| `pending_orchestrate` | **仅**出图门置位；或删除自动臂逻辑 |

控制流边 = LangGraph 相位；数据流边 = Nest edges + manifest `depends_on`（Mermaid 画后者）。

---

## 6. 前端 chips

| 相位 | Chips |
| --- | --- |
| `await_confirm` | `1/A 确认方案（推荐）`、`2/B …`、`3/C 自己说` |
| `await_topo` | `确认出图`、`要改拓扑`；+ 文案 chips（若未写入） |
| 文案已写入 | 文案 chips 消失 |

检测：扩展 `agentChipSet`（plan 结构化选项 / topo / copy）。

---

## 7. 成功标准（A）

1. 方案多轮修订期间画布**无**「营销方案」节点；确认后才有，且对话有「已确认摘要」。  
2. 确认方案后出现骨架 + Mermaid；**无**自动出图。  
3. NL 改拓扑即时反映到画布与 Mermaid。  
4. 「确认出图」后才出现 `run_image_generation` / 视频生成。  
5. `full` 与 `trimmed` 复测均通过。  
6. 主文案骨架期可写入，不阻塞后续出图门。

---

## 8. 非范围（B / C）

| 阶段 | 内容 |
| --- | --- |
| **B** | 模特：模特图 → 三视图 → 人景；产品：产品三视图链；写入 manifest 依赖 |
| **C** | 用户在画布/Dock 手工增删改 / 改 prompt 后，对话告知「执行生图」 |

---

## 9. 文档同步

- 本文为 A 的权威产品+编排规格。  
- `2026-07-23-agent-runtime-langgraph-design.md` §5/§6 须与本文图对齐。  
- `2026-07-25-agent-confirm-loop-hardening-design.md` §7 主链改为含 `await_topo`；方案节点改为确认后写入；废除「出图与文案并行且 draft 后即可 bg 出图」中与出图门冲突的部分（文案仍可在出图前完成）。
