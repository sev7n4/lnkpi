# Explore Tool 可靠性 Phase 2 — Mandatory Dispatch 设计规格

> 状态：**Draft**（2026-08-09）  
> 前置：[2026-08-08-agent-canvas-control-surface-design.md](./2026-08-08-agent-canvas-control-surface-design.md)（CS-3 explore_canvas）、[2026-08-04-loop-engineering-design.md](./2026-08-04-loop-engineering-design.md)（L-P7 不双栈 ReAct）  
> Phase 1（已合并 #188）：路由词表 + prompt nudge + UI 确定性兜底 + harness coercion

| 字段 | 值 |
|------|-----|
| 文档版本 | v0.1-draft |
| 创建日期 | 2026-08-09 |
| 问题陈述 | Explore 28-tool 生产演示：13 pass / 10 weak / 6 fail；weak/fail 主因 LLM 不调 tool、调错 tool、参数幻觉 |
| 目标 | **会调、调对** 可度量、可回归；降低对 prompt/nudge 的依赖 |

---

## 一、Phase 1 复盘与 Phase 2 动机

### 1.1 Phase 1 已解决

| 层 | 改动 | 效果 |
|----|------|------|
| Graph/Route | `explore_route.py`，explore 优先于 atomic | 消除 set_node_* / asset 误路由 |
| Loop/Prompt | system prompt + nudge | 部分 UI tool 仍 skip |
| Loop/Deterministic | undo/redo/focus 兜底 | 双轨维护成本 |
| Harness | sidebar coercion、Proxy 转发 | param 类错误减少 |

### 1.2 Phase 1 不足（为何需要 Phase 2）

1. **Prompt/nudge 不可靠**：LLM 仍可文字回复「已执行」而不调 tool  
2. **词表军备竞赛**：atomic vs explore 靠关键词对抗，不可扩展  
3. **双轨逻辑**：确定性兜底与 LLM 路径并存，回归面加倍  
4. **无 CI gate**：28-tool demo 未进 PR CI，生产才发现 weak/fail  
5. **无可观测性**：缺少 `route_mismatch`、`tool_skipped` 指标

### 1.3 设计原则（继承 CS-7 / L-P7）

| 编号 | 原则 |
|------|------|
| **ETR-P1** | **Mandatory dispatch 优先**：UI command / lifecycle / narrow write 不允许 LLM 跳过 tool |
| **ETR-P2** | **Route SSOT**：flow_mode 决定 dispatch 策略，不在 prompt 重复路由规则 |
| **ETR-P3** | **窄 tool binding**：每轮 LLM 只见当前 intent 允许的 tool 子集 |
| **ETR-P4** | **Harness 解析 node ref**：标题/@I1/node_id 统一 `resolve_node_ref()` |
| **ETR-P5** | **28-tool CI gate**：PR 必跑 explore contract demo（staging 或 recorded mock） |
| **ETR-P6** | **单轨优先**：确定性兜底收敛为 mandatory 子路径，最终删除 nudge 双轨 |

---

## 二、架构：Explore 子图拆分

### 2.1 现状（Phase 1）

```
intake → route_decide → explore (单节点)
                           ├─ bind_tools(28)
                           ├─ LLM loop ≤4 rounds
                           └─ optional nudge + deterministic fallback
```

### 2.2 目标（Phase 2）

```
intake → route_decide → explore_dispatch (新)
                           ├─ classify_explore_intent(user_text, summary)
                           ├─ branch A: explore_mandatory → 规则/解析 → 直接调 1~N tool → 汇总回复
                           ├─ branch B: explore_read     → LLM + bind_tools(READ subset)
                           └─ branch C: explore_write      → LLM + bind_tools(WRITE subset, max 1 write tool)
```

**不新增 LangGraph 物理子图也可 Phase 2a**：在 `explore.py` 内先实现 dispatch 函数，后续再拆节点。

### 2.3 Intent 分类（`classify_explore_intent`）

| Intent | 触发信号 | Dispatch 策略 | Tools |
|--------|----------|---------------|-------|
| `ui_command` | 定位/撤销/重做/精修/introduce | **Mandatory**，无 LLM | focus_*, undo, redo, open_image_editor, introduce_nodes_to_agent |
| `lifecycle` | 取消/确认 + 生成/fallback | **Mandatory** after resolve_node_ref | cancel_*, confirm/cancel_platform_fallback |
| `asset_read` | 资产库/素材库 + 查询 | **Mandatory** | list_user_assets, list_public_assets |
| `node_read` | node_id/节点 + 查询 | LLM optional；可 mandatory get_* | get_node, get_canvas_summary, get_canvas_layout, ... |
| `node_write` | node_id + 更新/attach/复制/上传 | LLM with **narrow bind**（≤5 tools） | set_*, attach_refs, duplicate_node, upload_media_to_canvas, upsert_prompt_node |
| `open_query` | 兜底 | LLM + full explore bind | 现有 28 whitelist |

分类器 Phase 2a：**规则 + summary**（复用 `explore_route.explore_explicit_intent` 扩展）；Phase 2b：可选 lightweight classifier。

---

## 三、Mandatory Dispatch 规格

### 3.1 UI Command（ETR-M1）

**输入**：user_text, canvas summary  
**步骤**：

1. `resolve_node_ref(text, summary)` → `node_id | None`
2. 模式匹配 → tool name + args
3. `await tool.ainvoke(args)` — **不经过 LLM**
4. 收集 `canvasCommands` → state → SSE
5. LLM **仅用于**生成简短中文确认（optional：`tool_choice=none` 单轮摘要）

| 用户模式 | Tool | Args |
|----------|------|------|
| 撤销 + 画布 | undo | `{}` |
| 重做 | redo | `{}` |
| 定位 + node ref | focus_node | `{node_id}` |
| 定位 + 多节点 | focus_nodes | `{node_ids[]}` |
| 精修/编辑器 | open_image_editor | `{node_id}` |
| 引入侧栏 | introduce_nodes_to_agent | `{node_ids[]}` |

**Acceptance**：SSE 必含对应 `canvas_command`；禁止仅文字「已定位」。

### 3.2 Lifecycle（ETR-M2）

**前置**：`resolve_node_ref` 必须返回 node_id；否则回复「请指定节点 id」不调 harness。

**Tools**：cancel_generation, cancel_platform_fallback, confirm_platform_fallback

**错误处理**：

| Nest 错误 | 用户可见 |
|-----------|----------|
| 无 generationRecordId | 「该节点无进行中的生成任务」 |
| 非 fallback_pending | 「该节点不在平台回退待确认状态」 |
| param_error | 重试前先 get_generation_status |

### 3.3 Asset Read（ETR-M3）

**Mandatory** 调用 list_user_assets / list_public_assets，LLM 只格式化结果，**禁止拒答**。

### 3.4 Node Write — Narrow Bind（ETR-M4）

LLM 可见 tools = `{intent 相关}` 最多 5 个；system prompt 声明「本轮只允许调用下列工具之一」。

**Loop gate**：若 user intent=node_write 且 rounds 结束无 tool_call → **hard fail 内部重试 1 次**（非 nudge 文案，直接 narrow re-bind）。

---

## 四、Harness：`resolve_node_ref` SSOT

### 4.1 解析优先级

```
1. 显式 node_id 正则 (prompt|image|text|video|audio|group)-*
2. summary.nodes[].title 模糊匹配（「换logo李宁」）
3. @I1 侧栏 key → introduce 路径单独处理
4. null → lifecycle/write 拒绝并澄清
```

### 4.2 位置

`services/agent-runtime/app/graph/node_ref.py`（新模块，explore + mandatory dispatch 共用）

### 4.3 Nest 不变

仍传 `nodeId` / `generationRecordId`；不在 Nest 层接受标题字符串。

---

## 五、Loop Gate（ETR-L1）

在 explore mandatory 分支：

```python
if intent in MANDATORY_INTENTS and not tool_called:
    raise ExploreToolSkippedError(intent)  # 内部 catch → 降级 mandatory 重试
```

在 explore LLM 分支（node_write）：

```python
if intent == "node_write" and rounds_exhausted and not write_tool_called:
    return clarify("未能更新节点，请提供节点 id")
```

**禁止**：无限 ReAct（L-P7）；mandatory 分支 max 1 次重试。

---

## 六、CI / 可观测性

### 6.1 CI Gate（ETR-C1）

| 项 | 说明 |
|----|------|
| 位置 | `.github/workflows/ci.yml` 或 `deploy-agent-runtime` post-deploy |
| 脚本 | `deploy/prod-explore-28-tools-demo.py` |
| 环境 | staging CVM 或 CI mock Nest（优先 staging） |
| 阈值 | `pass_tool >= 24/28`，`wrong_route == 0`，`fail <= 2` |

### 6.2 Metrics（ETR-O1）

扩展现有 `agent_tool_calls_total`：

| 指标 | Labels |
|------|--------|
| `explore_dispatch_total` | intent, strategy(mandatory/llm) |
| `explore_tool_skipped_total` | intent |
| `explore_route_mismatch_total` | expected, actual |

SSE 可选：`step.detail` 增加 `dispatch=intent/strategy`（debug 用）。

---

## 七、分 Wave 交付

| Wave | 内容 | 验收 |
|------|------|------|
| **2a** | `node_ref.py` + mandatory UI + lifecycle + asset | UI/lifecycle demo ≥90% tool |
| **2b** | narrow bind node_write + loop gate | set_node_* 不再 atomic |
| **2c** | CI 28-tool gate + metrics | PR 回归 |
| **2d** | 删除 nudge/确定性兜底双轨 | 代码单轨 |

---

## 八、非目标（Phase 2）

- 同 thread 并行 explore（thread lock 保持不变）
- explore 调用 `run_*_generation`
- 全量 LLM intent classifier 训练

---

## 九、Open Questions

1. Staging 环境是否有独立 session 跑 28-tool CI？  
2. `focus_nodes` 多节点：规则解析「颜色变体1-4」还是 LLM 辅助列 id？  
3. mandatory 分支是否仍需 LLM 摘要句，或纯 tool result 模板化？

---

## 十、参考

- PR #187 NestEventProxy 转发  
- PR #188 explore 路由 + Phase 1 可靠性  
- `deploy/prod-explore-28-tools-demo-results.json` Run `eee92c9a`
