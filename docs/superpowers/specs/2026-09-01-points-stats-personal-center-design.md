# 个人中心积分统计（明细 + 分类汇总）

**日期：** 2026-09-01  
**状态：** 实现完成 / 待 QA  
**范围：** 扩展积分账本、会员交易 API、个人中心卡片式汇总与明细；不含充值/支付改造

## 背景

- `PointTransaction` 仅有 `id / userId / amount / reason / createdAt`；扣费 `reason` 为中文自由文本（如「图像生成」「文本生成-失败退款」）。
- 个人中心 `ProfilePage` 已拉取账单，但 UI 只展示 `reason` + `amount`，**未展示已有的 `createdAt`**，也无按文本/图片/音频/视频的消费汇总。
- 用户需要：**可解释的消费明细（含时间戳等）** + **按媒体分类的积分汇总**，并支持时间范围切换。

## 目标

1. 账单明细可自查：时间、类型、分类、金额、说明，以及模型与生成记录追溯（本期 B 档）。
2. 分类汇总：文本 / 图片 / 音频 / 视频的**净消耗**；同时展示期间退款合计、获得合计作对照。
3. 时间范围：默认「本月」，可切换「近 7 天 / 本月 / 全部」。
4. 存量流水回填结构化字段；新流水写入时强制带结构化 meta。
5. UI 采用**卡片式**布局（汇总分类卡 + 明细流水卡）。

## 非目标（本期）

- 充值入口、支付渠道、会员套餐改版。
- 消费趋势图、CSV 导出。
- 运营级字段（节点 ID、计费规则版本、BYOK/平台路径、分辨率/时长等）——见 **演进 C**，本期不实现。
- 独立分析库 / 双写事件表。

## 已确认决策

| 项 | 决策 |
|----|------|
| 目标 | A+B：明细透明 + 分类汇总 |
| 实现路径 | 扩展 `PointTransaction` 单一账本（方案 1） |
| 时间范围 | 默认 `month`；可选 `7d` / `month` / `all` |
| 汇总口径 | 净消耗为主 + 退款合计对照；获得不进四分类净消耗 |
| 明细信息密度 | 本期 B；演进计划写入 C |
| 存量数据 | 按 `reason` 回填；无法识别 → `category=other` |
| UI | 卡片式汇总网格 + 卡片式明细列表 |
| 日界时区 | `Asia/Shanghai`；响应带回实际 `from` / `to` |

---

## §1 数据模型

### 1.1 扩展 `PointTransaction`

在现有字段上新增：

| 字段 | 类型 | 说明 |
|------|------|------|
| `kind` | `String` | `consume` \| `refund` \| `grant`；迁移默认 `consume`，随后回填脚本纠正 |
| `category` | `String` | `text` \| `image` \| `audio` \| `video` \| `other`；迁移默认 `other`，随后回填纠正 |
| `status` | `String?` | 消费成功：`success`；退款：`failed_refund` \| `cancelled_refund` \| `byok_refund`；grant 为 `null` |
| `model` | `String?` | 计费时模型 ID |
| `generationId` | `String?` | 关联 `GenerationRecord.id`（逻辑关联即可，本期不加 FK 约束） |
| `balanceAfter` | `Int?` | 变动后余额；旧数据回填保持 `null` |

保留 `reason` 作为面向用户的短文案；筛选与汇总只依赖结构化字段。

### 1.2 索引

- `(userId, createdAt)` — 明细分页  
- `(userId, kind, category, createdAt)` — 汇总与筛选  

### 1.3 写入约定

- `PointsService.consume` / `refund` 与会员发放（签到、升级）统一写入结构化 meta（至少 `kind` + `category`）。
- 消费：`amount < 0`，`kind=consume`，`status=success`（扣费成功落账时）。
- 退款：`amount > 0`，`kind=refund`，`category` 与原消费一致；能关联则带同一 `generationId`。
- 获得：`amount > 0`，`kind=grant`，`category=other`（签到、升级赠送等）。

### 1.4 存量回填

一次性脚本按 `reason` 启发式映射，例如：

| reason 模式 | kind | category | status |
|-------------|------|----------|--------|
| 文本生成、提示词模式生成 | consume | text | success |
| 图像生成、图像变体、图像精修 | consume | image | success |
| 视频生成 | consume | video | success |
| 音频相关（若有） | consume | audio | success |
| `*-失败退款` | refund | 从前缀推断 | failed_refund |
| `*-取消退款` | refund | 从前缀推断 | cancelled_refund |
| `*-BYOK失败退款` | refund | 从前缀推断 | byok_refund |
| 每日签到、升级 * | grant | other | null |
| 平台回退生成、平台回退失败退款、导演台批量生成 * | 按后缀/符号 | other | 对应 success / *_refund |
| 无法识别且 `amount < 0` | consume | other | success |
| 无法识别且 `amount > 0` | grant | other | null |

不臆造 `model` / `generationId` / `balanceAfter`。回填脚本幂等：仅更新仍为默认 `other`（或显式标记未回填）的行，可重复执行。

---

## §2 API 与汇总口径

沿用 `/membership/*`，不新开积分域。

### 2.1 `GET /membership/transactions`

**Query**

- `range`：`7d` \| `month` \| `all`（默认 `month`）
- `kind?`、`category?`
- `cursor?` / `limit?`（默认 50）

**Item**

```
id, amount, reason, createdAt,
kind, category, status, model, generationId, balanceAfter
```

另可返回本次查询的 `from` / `to`（与汇总一致）。

### 2.2 `GET /membership/points-summary`

**Query：** `range`（默认 `month`）

**口径**

- `byCategory.text|image|audio|video`（同 category）：  
  `netConsumed = (-sum(amount where kind=consume)) - sum(amount where kind=refund)`  
  即「消费绝对值之和 − 退款之和」；结果可为 0，不为负时按 0 展示（异常超退在明细可查）。
- `refundTotal`：期间全部 `kind=refund` 的 `amount` 之和（正数）  
- `grantTotal`：期间全部 `kind=grant` 的 `amount` 之和（正数）  
- `otherNetConsumed`：对 `category=other` 用同一净消耗公式（仅当 > 0 时前端展示「其他」卡）  
- `range`、`from`、`to`：实际窗口；`month` = 上海时区当月 00:00:00 至当前；`7d` = 当前往前 7×24h；`all` 无下界  

**不**把 grant 计入四分类净消耗；**不**把毛消耗作为主数字。

### 2.3 余额

继续使用现有 `GET /membership/points` / profile 的 `points`。汇总接口可附带当前余额方便 UI，非必须。

### 2.4 调用点改造

Studio / canvas / scene-composer / membership 等所有 `consume`/`refund`/发放路径补齐 `category`（及有则 `model`、`generationId`）。

---

## §3 个人中心 UI（卡片式）

改 `ProfilePage`（及 `membershipApi` 类型）：在余额/会员信息下方为 **汇总区 → 明细区**。

### 3.1 时间范围

顶部筛选卡片：`近 7 天` | `本月`（默认） | `全部`。切换同时刷新汇总与明细。

### 3.2 汇总：分类卡片网格

- 四张分类卡（文本 / 图片 / 音频 / 视频）：主数字为净消耗；点击 → 明细筛到该 `category`。
- 对照卡：期间退款合计、期间获得合计（弱样式）。
- `otherNetConsumed > 0` 时增加「其他」卡。

### 3.3 明细：流水卡片列表

每条一卡：

- 主区：`reason`、分类徽章、类型（消费/退款/获得）、金额（消费负向强调；退款/获得正向）
- 次要：`createdAt`（本地时区格式化）；有则 `model`；有 `generationId` 可提供「查看生成」（路由实现阶段确定）
- 退款卡用徽章或左边色条区分

轻量筛选：`kind`、`category`（与汇总同 `range`）。支持分页/加载更多。空态有文案。

### 3.4 本期不做

趋势图、导出、充值改版、演进 C 字段展示。

---

## §4 演进到 C（后续计划，本期不实现）

在 B 稳定后，按需扩展账本（或关联 meta JSON）：

| 方向 | 用途 |
|------|------|
| `nodeId` / `sessionId` | 画布节点与会话追溯 |
| `billingRuleVersion` | 计价规则变更可解释 |
| `chargePath` | `platform` / `byok` / `platform_fallback` |
| `meter` | 计量快照：`durationSec`、`imageCount`、`resolution` 等 |
| `relatedTxId` | 退款指向原消费流水 |

UI：明细卡可展开「计量详情」；汇总可按 path / 规则版本切片。原则：只加列、旧行 null、不改 B 的净消耗口径。

---

## §5 边界与一致性

- 汇总与明细必须使用同一 `range` 与同一 `from`/`to`。
- 无 `generationId` 时不展示跳转。
- 金额符号：消费 `amount < 0`；退款与获得 `amount > 0`。
- 回填失败进 `other`，不阻塞上线。

---

## §6 测试要点

- 回填映射表：覆盖常见 `reason` 与无法识别路径。
- 汇总：同 category 消费 − 退款 = 净消耗；grant 不进四分类；`refundTotal` / `grantTotal` 正确。
- API：默认 `month`；`7d` / `all`；`kind`/`category` 筛选；分页。
- UI：卡片展示时间/分类/金额；点分类卡联动明细筛选；空态。

---

## §7 建议落地顺序

1. Prisma 迁移 + `PointsService` / membership 写入结构化字段  
2. 存量回填脚本  
3. `transactions` 扩展 + 新 `points-summary`  
4. `ProfilePage` 卡片式汇总与明细  
5. 各生成路径补齐 category/model/generationId  
6.（后续）演进 C 字段与 UI  

## 参考

- 现有模型：`apps/server/prisma/schema.prisma` → `PointTransaction`  
- 现有服务：`apps/server/src/points/points.service.ts`、`apps/server/src/membership/membership.service.ts`  
- 现有 UI：`apps/web/src/pages/ProfilePage.vue`  
- 单价常量：`apps/web/src/constants/credits.ts`（text/image/video/audio）  
