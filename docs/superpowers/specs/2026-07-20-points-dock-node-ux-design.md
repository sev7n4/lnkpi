# 积分反馈、画布账户条与节点/Dock 交互改进

**日期：** 2026-07-20  
**状态：** 已确认设计，待实现  
**范围：** 单 PR 一次交付（5 项）

## 背景

- 生成接口先扣积分；余额为 0 时返回 HTTP 400「积分不足」，画布侧常显示为笼统的 Axios `status code 400`。
- 失败与取消当前**不退款**；用户期望失败/取消后「X 积分已返回」。
- 沉浸画布隐藏 `AppHeader`，右上仅有主题切换，生成过程中看不到余额变化。
- Dock 生成中整区 `opacity` + `pointer-events` 锁定，停止按钮观感像禁用。
- 下游 Dock 在 prompt 为空时会把上游文本 seed 进编辑区，干扰编辑；数据流应靠芯片/`@` 引用。
- 节点任务态为文字徽章 + 文案按钮，期望改为圆形图标动画（所见即所得）。

## 目标

1. 积分不足有明确摘要并引导充值；失败/取消真正退款并提示「N 积分已返回」。
2. 画布右上展示积分与用户信息，余额随扣费/退款实时可见。
3. Dock 生成中停止按钮显性可点；参数禁改但不整区灰死。
4. 上游文本不自动灌入下游 prompt 编辑区；芯片 + `@` + 服务端 merge 打通数据流。
5. 节点运行中/取消/重试改为圆形图标 + 旁侧耗时。

## 非目标

- 不改变平台/BYOK 模型单价表本身（仅退款与二次扣费时机）。
- 不强制清空历史画布里已灌入的 prompt。
- 不重做会员体系/支付渠道（复用 `MembershipModal`）。
- 不在本 PR 修复平台上游 `model_not_found` 等 Agnes 网关运维问题。

## 已确认决策

| 项 | 决策 |
|----|------|
| 退款 | 真正退款（失败、取消一律退本次已扣） |
| 取消 | 只要已扣费，取消一律退回 |
| BYOK fallback | BYOK 失败立刻退 X；确认走平台再按平台单价另扣；平台失败再退 |
| 画布顶栏 | 方案 A：积分胶囊 + 头像/昵称下拉（主题旁） |
| 交付节奏 | 单 PR 一把梭 |
| 节点 chrome | 圆形图标（转圈/脉冲/重试）+ 旁侧 `m:ss` |

---

## §1 积分扣费 / 退款 / 文案

### 服务端

- `PointsService` 新增 `refund(userId, amount, reason)`：`points` increment + 正向 `pointTransaction`。
- 每次成功 `consume` 后，在生成记录 / material 的 `metadata` 写入 `chargedPoints`。
- **失败**（上游错误、业务失败）：`refund(chargedPoints)`，metadata 写 `refundedPoints`、`refundReason`。
- **用户取消**：若已扣费且未退过，同样 `refund`；取消路径需能定位到对应 record/material 与 `chargedPoints`。
- **BYOK → `fallback_pending`**：进入 pending 前立刻退回本次 X，并清/标记 `refundedPoints`；用户**确认平台回退**时再 `consume` 平台单价，写入新的 `chargedPoints`；平台失败再退。
- **积分不足**：`consume` 抛 `BadRequestException('积分不足')`，不落生成记录、不调用上游。

### 前端

- 生成链路统一用类似 `apiErrorMessage` 解析 Nest `message`。
- 节点 `errorMessage` 文案约定：
  - 不足：`积分不足，请充值后再试`（可触发打开会员弹窗）
  - 失败已退：`生成失败，N 积分已返回`
  - 取消已退：`已取消，N 积分已返回`
- 扣费/退款后刷新 `auth.user.points`：开始时可乐观减少；以接口返回或随后 `GET` profile/points 为准；退款后加回。

### 测试要点

- `consume` 不足 → 400 + 文案；余额不变。
- 扣费后上游失败 → 余额恢复 + `refundedPoints`。
- 取消已扣费任务 → 余额恢复。
- BYOK pending：先退；确认平台再扣；平台失败再退。

---

## §2 画布右上账户条

- 沉浸画布仍隐藏全局 `AppHeader`。
- 在 `CanvasPage` 右上（主题按钮旁）增加 `CanvasAccountChrome`：
  - 顺序：`主题 | 积分胶囊 | 头像+昵称`
  - 积分点击 → `MembershipModal`
  - 用户 → 下拉：个人资料 / 退出（对齐现有 Header）
- 余额与 §1 的乐观/回写同步，生成过程中可见扣除与退回。

---

## §3 Dock 生成中交互

- **保持可点**：关闭 Dock、停止方块（高对比实心，非半透明灰）。
- **禁改但不整区灰死**：模型/参数/参考图/标题等用控件级 `disabled`/`readonly`；移除（或收窄）`.is-dock-locked` 对整块的 `opacity: 0.55` + `pointer-events: none`。
- Prompt：生成中不可编辑，对比度保持正常；停止按钮单独高亮。
- 停止 = 现有 `cancelGeneration`；成功后按 §1 提示取消退款文案。

---

## §4 上游文本不灌进 prompt

- 删除各 Dock panel「prompt 为空则 seed `upstream.textPrompt`」逻辑。
- 上游经连线 → `DockRefStrip` 芯片 + `@Tn` mention；生成仍传 `refs` + `mentionedKeys`，服务端 `mergeRefsToPrompt` 不变。
- 本地 prompt 仅用户手写内容 + mention 标记。
- **兼容**：历史已灌入的 prompt 不强制清空；新连接/新打开不再自动灌入。

---

## §5 节点圆形任务控件

- 替换标题旁文字徽章 + 角上文案按钮。
- 右上角圆形按钮：
  - 生成中：转圈/脉冲；旁侧 `m:ss`；点击取消
  - 失败：重试图标可点；短错误可用 tooltip/旁侧摘要
  - `fallback_pending`：区分图标；确认仍走现有弹窗
  - 完成：短暂成功态后消失
- 与 Dock 停止语义一致，均为一眼可点。

---

## 架构与数据流（摘要）

```text
generate 请求
  → consume(X) → metadata.chargedPoints=X → 更新前端 points
  → 上游成功 → completed
  → 上游失败 / 取消 → refund(X) → metadata.refundedPoints=X → 前端文案 + points
  → BYOK 失败 → refund(X) + fallback_pending
       → 用户确认平台 → consume(Y) → …
       → 用户拒绝 → 已退过，结束
```

## 主要改动面（实现时）

| 区域 | 预期触及 |
|------|----------|
| Server | `points.service`、`studio.service`、`material.service`、取消/fallback 路径、相关单测 |
| Web | `useNodeGeneration`、错误解析、`CanvasPage` 账户条、`auth` points 同步、Dock CSS/Generate 按钮、Dock seed 逻辑、`NodeTaskBadge`/`CornerActions`/`nodeTaskChrome` |
| Shared（可选） | 文案常量、`chargedPoints`/`refundedPoints` 类型约定 |

## 错误处理

- 退款失败：打日志；前端仍展示失败原因，并提示「退款异常，请联系支持」（避免静默丢点）；实现时优先保证退款与失败状态同事务或补偿可重试。
- 重复退款：以 metadata 是否已有 `refundedPoints` / 幂等 reason+recordId 防护。

## 验收清单

- [ ] 积分为 0 生成：节点明确「积分不足，请充值」并可打开充值
- [ ] 扣费后失败：余额恢复，文案含「N 积分已返回」
- [ ] 生成中取消：停止明显可点；余额恢复；文案「已取消，N 积分已返回」
- [ ] 画布右上积分随扣/退实时变化；用户下拉可用
- [ ] Dock 生成中非整区发灰；停止高对比
- [ ] 新连下游：prompt 不自动出现上游全文；芯片可见；生成仍能引用上游
- [ ] 节点圆形运行/重试 + `m:ss`；重试可点

## 风险

- 取消与异步上游竞态：需在现有 cancel 忽略晚到结果的基础上，保证退款只发生一次。
- BYOK 二次扣费改变现有「一次扣费管到底」行为，需更新 fallback 相关测试与文案。
