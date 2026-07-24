# Agent 对话一期 UX 与 Skill 门控设计

> 状态：**已确认**（2026-07-24）  
> 日期：2026-07-24  
> 前置：`2026-07-23-agent-runtime-langgraph-design.md`（Runtime / Skills / 出图）  
> 依据：干净画布复测 `cmryyhm580003lj01f50e83na` + UX 审视（P0–P2）  
> 范围：对话可感知进度、可读确认摘要、可行动出图结果、Dock 去误导、确认快捷钮、规模提示、历史补齐、**非营销日常对话门控**  
> 非范围：`/` 显式唤起 Skill、侧栏 `skillId` 打通、按 brief 裁剪 manifest、`interrupt()` 正式 HITL、自动出视频、dock model/积分真实计费

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 实现路径 | **Runtime 话术 / 事件为主** + Web 少量 UI；不引入二期 interrupt |
| 非营销输入 | **日常对话**（短答，不进 plan→拆图）；**禁止** `intake` fallback 到「唯一 Skill」 |
| Skill 进入 | 一期仅 **强营销意图**（关键词/启发式）；`/技能名` 与侧栏 `skillId` **二期** |
| 拆解规模 | 确认门 **只提示将拆 N 项**；仍按 Skill `canvas-manifest` 全量拆，不裁剪 |
| Dock | 一期 **隐藏**模型选择器与积分徽章；可选一行「规划模型由服务端配置」 |
| 确认交互 | 方案后快捷钮「确认拆图」「要修改」→ 发送固定文案，同一 `threadId` |

---

## 1. 问题陈述（复测证据）

1. 确认后约数分钟空白，用户连发「确认」；busy 锁已挡二次，但首轮仍缺持续进度。  
2. 侧栏摘要被截成客套句，完整方案只在画布节点。  
3. 「成功 3 / 失败 4」无节点、无 `fallback_pending` 行动指引。  
4. 底栏显示停用模型，规划实际走服务端配置 → 误导。  
5. 只能打字确认；极简 brief 仍拆 9 骨架（规模需提示，本期不裁剪）。  
6. **任何话都可能进营销 Skill**（`intake` 在未命中关键词时仍 `entries[0]`）。

---

## 2. Skill 门控 vs 日常对话

### 2.1 模式

| 模式 | 条件（一期） | Graph 行为 |
| --- | --- | --- |
| **日常对话** | 无强营销意图，且未处于 `await_confirm` / 出图中 | `intake` → **`chat`** → END；`skill_id=null`；不写方案节点、不拆图 |
| **营销 Skill 工作流** | 强营销意图（见 §2.2） | 现有 `intake` → `plan` → `await_confirm` → … |
| **续轮确认/修改** | `awaiting_user && phase=await_confirm` | 现有 `route_entry` → `await_confirm`（不变） |

### 2.2 强营销意图（启发式，可测）

命中任一即可进入营销 Skill（可与现有 `_MARKETING_HINTS` 合并扩展）：

- 关键词：营销、主图、详情页、banner、campaign、电商、天猫、方案+出图/拆画布 等  
- 或明确「做一套…详情页/主图方案」类编排诉求  

**不**仅因「音箱」「产品」等名词进 Skill。

### 2.3 明确禁止

- `elif entries: skill_id = entries[0].skill_id` 这类 **唯一包兜底**。  
- 日常对话路径调用 `upsert_prompt_node` / `add_nodes_batch` / `run_image_generation`。

### 2.4 二期（本设计不实现）

- `/enterprise-marketing-campaign` 或侧栏 `skillId` 显式唤起  
- 低置信意图先追问「是否按营销 Skill 拆画布出图？」  
- UI 技能菜单驱动 Runtime（替换文案前缀）

### 2.5 `chat` 节点职责

- 使用同一规划 LLM（`LNKPI_OPENAI_*`）短答用户问题  
- 可提示：若要做电商详情页/主图方案，可直接说「帮我做一套…营销方案」  
- 输出 `messages` AI 文本；`phase=done`；`awaiting_user=False`

---

## 3. Graph 拓扑修订

```text
START
  ├─ (await_confirm 续轮) → await_confirm → …
  └─ intake
        ├─ skill 命中 → plan → await_confirm → …
        └─ 未命中   → chat → END
```

`route_entry` 仍优先：`awaiting_user && phase==await_confirm` → `await_confirm`。

---

## 4. 对话 UX（P0–P2）

### 4.1 P0 — 必须

| ID | 项 | 行为 |
| --- | --- | --- |
| P0-1 | 进度可感知 | confirm 后立即进度文案；`split` 完成独立一条；`orchestrate_gen` 每张成功/失败短进度；结束汇总 |
| P0-2 | 可读确认摘要 | 定位一句 + **将拆资产列表（manifest 标题）** +「完整方案见画布『营销方案』节点」+「确认后将拆解 N 项并自动出图」 |
| P0-3 | 出图结果可行动 | 按节点列成功 / 失败 / **待确认平台兜底**；引导用户点画布节点处理 fallback |

### 4.2 P1 — 强烈建议（一期做）

| ID | 项 | 行为 |
| --- | --- | --- |
| P1-1 | Dock 去误导 | 隐藏 `UniversalModelSelector` 与 `DockCreditBadge`；可显示静态说明「规划模型由服务端配置」 |
| P1-2 | 确认快捷钮 | 处于确认门时展示「确认拆图」「要修改」；分别发送约定文案（如「确认」「我要修改」） |
| P1-3 | 规模提示 | 仅话术提示 N；**不**裁剪 manifest（已锁定） |

### 4.3 P2 — 顺手（一期做）

| ID | 项 | 行为 |
| --- | --- | --- |
| P2-1 | 分段 | 各阶段独立 `text_delta`，换行/分段，禁止粘成一句 |
| P2-2 | 历史补齐 | 流结束后 `GET /api/agent/chat/user/messages?sessionId=` 合并最新助手消息，避免只见 busy |

### 4.4 同 thread 并发

保持已上线 busy 锁：第二轮立即提示「上一轮仍在处理中…」，不冲掉 checkpoint。

---

## 5. 主要改动面

| 层 | 文件/模块 | 改动 |
| --- | --- | --- |
| Runtime | `builder.py` / `intake.py` | 门控；新增 `chat` 节点与边 |
| Runtime | `plan.py` | 摘要结构（定位 + 资产列表 + N + 画布指引） |
| Runtime | `split.py` / `orchestrate_gen.py` / `done.py` | 分段进度与可行动汇总；识别 `fallback_pending` |
| Runtime | tests | 门控、摘要、进度、汇总文案 |
| Web | `AgentSideRail.vue` | 隐藏 dock 误导控件；确认快捷钮；流结束补拉历史 |
| Spec | 本文 + 主设计 §5/§12 交叉引用 | 验收项 |

---

## 6. 验收标准

1. 「你好」/无关闲聊 → **不出现**方案节点、不拆图；有日常短答。  
2. 「帮我做一套蓝牙音箱天猫详情页方案」→ 进营销 Skill；摘要含资产列表与 N。  
3. 「确认」后 数秒内可见进度文案；完成后侧栏有按节点的成功/失败/兜底说明。  
4. 底栏不再展示可误导的停用模型选择器与静态积分徽章（或等价不可点说明）。  
5. 确认门可见快捷钮；点击等价于发送约定文案。  
6. 二次连发「确认」仍得 busy 提示；首轮仍能完成拆图。  
7. 人为断开/慢网后，流结束补拉能使侧栏最终与 DB 助手消息一致（成功长文可见）。

---

## 7. 与主规格关系

- 修订 `2026-07-23-agent-runtime-langgraph-design.md`：`intake` 职责、拓扑、`§12` 验收、修订记录。  
- 主规格 §10「`/` / skillId」仍属二期；一期门控以本文 §2 为准。

---

## 8. 文档修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-07-24 | 初稿：P0–P2 UX + 日常对话门控（选项 1）+ 规模仅提示（选项 1） |
