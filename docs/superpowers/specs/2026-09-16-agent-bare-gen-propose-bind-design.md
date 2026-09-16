# Explore 裸生成绑定 `propose_generation` — 窄写工具缺口

> 日期：2026-09-16  
> 状态：**已批准**（方案 B + 审阅补丁：收紧门控、H8 不改）  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md)（V2 / §6.0.2 B9）  
> 前置：Phase 2b 工具已存在；Phase 2d.3 已合入生产（#345/#347）  
> 实现 plan：待写 [`../plans/2026-09-16-agent-bare-gen-propose-bind.md`](../plans/2026-09-16-agent-bare-gen-propose-bind.md)

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **BG-D1** | 根因：`build_tool_plan` 已将 `upsert_media_node` / `propose_generation` 标 CORE，但 explore `_bind_plan_tools` 只绑定 `select_narrow_write_tools()` 返回的写工具。默认窄集不含这两项，系统提示仍要求调用 → 模型 `tool_search` 失败（meta 只搜 deferred）。 |
| **BG-D2** | 方案 **B**：规划 / 导入窄集优先且不变；**另开媒体窄集**，仅生成口语绑定 `{upsert_media_node, propose_generation, set_node_prompt, attach_refs}`。默认闲聊窄集不加 propose。 |
| **BG-D3** | 门控 **不得**用整份 `utterance_suggests_media_create`（会命中「海报/主图/视频」等宽词）。专用谓词 `utterance_binds_media_propose`：排除 regen / campaign 后，命中 `MEDIA_CREATE_HINTS` **或** `strong_generate_media(normalize_colloquial_create_verbs(text))`。 |
| **BG-D4** | 验收到 **pending_confirm**（upsert + propose）；不要求 dock 真出图。确认前无 `run_*`、无扣费。 |
| **BG-D5** | **不改** 2d.3 H8 脚本语义（#346 的「无扣费即可」仍作回归）。本轮 **新开** 生产冒烟（V2/B9）：裸生成必须出现 pending 节点。 |
| **BG-D6** | 绑定是必要非充分：单测锁 bind 集合；生产锁 `tool_call` + 画布 pending。若 bind 绿而生产仍无 tool_call，另开 prompt/模型跟进，**本 PR 不做** mandatory 直调。 |

### 金标句（钉死）

> 帮我生成一张蓝色天空产品主图

### 媒体窄集（钉死，恰好 4 个，≤5）

`upsert_media_node` · `propose_generation` · `set_node_prompt` · `attach_refs`

不含 `upsert_prompt_node`（提示词节点）、不含 `connect_nodes`（本轮非工作流摆盘）。

### 非目标

- 真出图 / 确认卡 ≡ dock 执行  
- 同会话「重新生成一张」再 propose  
- 2d.4 删 `LEGACY_LANE_SHIM`、Phase 3  
- 改 CORE/deferred 分类；把 CORE 写工具塞进 `tool_search`  
- 扩大默认窄集（方案 A）或 mandatory 直调（方案 C）

---

## 1. 背景

生产 H8（2d.3）硬表可通过：`flow_mode=canvas_agent`、无 atomic 子图、无 `run_*`。裸生成常 **零 tool_call**，回复「工具检索没找到 upsert_media_node / propose_generation 的绑定入口」，画布无 `pending_confirm`。

父规格 **V2 / B9** 要求显式出图句 → agent 建图节点 + propose（或等价待确认），确认前不扣费。2a **A6** 明确不要求 propose；本档补的是 2b 之后被窄绑裁掉的缺口，不是新造工具。

`select_narrow_write_tools` 现序：import 锚点 → planner 确认 → planner 口语 → import 弱锚点 → `_DEFAULT_NARROW_WRITE`。媒体分支插入 **上述全部之后、默认返回之前**。

---

## 2. 钉死规则

1. **谓词 `utterance_binds_media_propose(text) -> bool`**（放 `explore_dispatch.py`，避免把 bind 政策塞进 `atomic_intent.py`）  
   - `regen_intent(text)` 或 `regenerate_phrase_intent(text)` → **False**（「重新生成一张」含字面「生成一张」，必须排除）。  
   - campaign 覆盖（与 `utterance_suggests_media_create` 同一 `_is_campaign_override`）→ **False**。  
   - 否则：任一 `MEDIA_CREATE_HINTS` 为 text 子串 → True；或 `strong_generate_media(normalize_colloquial_create_verbs(text))` → True。  
   - 金标句必须 True；「看看这张海报」必须 False。

2. **`select_narrow_write_tools`**  
   - 规划 / 导入分支 **一字不改**（含 `len ≤ 5` 既有测）。  
   - `utterance_binds_media_propose` 为 True 时返回媒体窄集（§0）。  
   - 否则仍 `_DEFAULT_NARROW_WRITE`。

3. **`_bind_plan_tools`** 逻辑不改；只因窄集变化而绑定媒体工具。

4. **系统提示** 可补一句：生成口语下这两工具应已绑定，**不要**用 `tool_search` 找 CORE。不作为唯一修复。

5. **测试文件** `test_explore_narrow_bind.py`：纠正「keyword cull 已删除」的过时注释；增加金标句 / 负例 / regen 排除 / `_bind_plan_tools` 实测。

6. **生产冒烟** 新文件 `deploy/prod-phase-v2-bare-gen-verify.py`（名称可微调，不得覆盖 `prod-phase-2d3-h8-verify.py`）：  
   - 金标句 → `flow_mode == canvas_agent`（唯一期望，不是 clarify_route）；  
   - `tool_call` 含 `upsert_media_node` 与 `propose_generation`（顺序：先 upsert 后 propose）；  
   - 画布出现 `pending_confirm` 节点；  
   - 无 `run_image_generation` / `run_video_generation`；节点在确认前不进入 billed 完成态。

---

## 3. 验收硬表

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **P1** | `select_narrow_write_tools(金标句)` | 含 `upsert_media_node` 与 `propose_generation`；集合 = 媒体窄集 |
| **P2** | `select_narrow_write_tools("看看这张海报")` | **不含** 上述两工具（走默认窄集） |
| **P3** | `select_narrow_write_tools("重新生成一张")` | **不含** 上述两工具 |
| **P4** | 既有 planner / import 窄绑测 | 全绿，集合不变 |
| **P5** | `_bind_plan_tools(金标句)` 的 visible/bind 名 | 含两工具 |
| **P6** | `build_tool_plan().visible_names` | 仍含两工具且 **不含** `run_*`（B1/V3 回归） |
| **P7** | 生产 V2 冒烟 | pending_confirm + 无 `run_*` 扣费；**不**用放宽后的 H8 代替本条 |

---

## 4. 回滚

- 去掉媒体分支即可回到「能聊不能 propose」；不恢复 `run_*` visible。  
- H8 脚本保持独立，回滚本档不影响 2d.3 回归。

---

## 5. 后续（未授权）

- bind 绿、生产无 tool_call → prompt / 模型切片  
- regen 同会话 propose  
- 确认后真出图（2c 路径）

---

## 6. 自检（写档时）

- [x] 无 TBD 阻塞合入门禁  
- [x] 门控与 `utterance_suggests_media_create` 分离，并排除 regen 子串误伤  
- [x] 未改 H8；未滑入 2d.4 / Phase 3 / mandatory 直调  
- [x] 硬表可测、金标句唯一  
