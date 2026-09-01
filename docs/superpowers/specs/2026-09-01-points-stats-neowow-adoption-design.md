# 个人中心积分 UX 采纳（Neowow 借鉴 · P0/P1）

**日期：** 2026-09-01  
**状态：** 设计已确认，待实现  
**前置：** `#270` 个人中心积分统计（分类汇总 + 结构化明细 + `points-summary` API）  
**范围：** 在 `#270` 基础上增强账单可读性、会员转化条、用量洞察 KPI；不含热力图、新支付流、账号侧栏壳

## 背景

`#270` 已交付：扩展 `PointTransaction` 结构化字段、`GET /membership/points-summary`、`GET /membership/transactions`（分页/筛选）、`ProfilePage` 卡片式四分类汇总与明细。

对标 Neowow 账号中心实机调研，我们仍有缺口：

1. **账单密度**：模型/分类标签已有，但缺变动后余额展示、kind 分段不够直观  
2. **转化路径**：个人信息区未突出「充值 / 升级会员」双 CTA  
3. **用量洞察**：缺总消耗、峰值、日均、活跃天、最长连续活跃等行为指标  

## 目标

1. 单页三段式信息架构：账户条 → 统计区（分类汇总 + 用量 KPI）→ 账单明细  
2. 统计区与账单区共用 `range`（`7d` / `month` / `all`），切换时同步刷新  
3. `points-summary` 扩展 `insights`，一次请求返回 KPI  
4. 充值 / 升级均打开现有 `MembershipModal`  
5. 账单明细展示 `balanceAfter`（历史 null 显示 `—`）

## 非目标

- GitHub 风格热力图、趋势折线图  
- 独立 `points-insights` 路由或弹层  
- 项目维度筛选（个人/协作）  
- token 明细标签（暂无字段）  
- 新 Prisma 字段 / 支付渠道改造  
- 账号中心侧栏图标壳（Neowow 完整 IA）

## 已确认决策

| 项 | 决策 |
|----|------|
| 范围 | C：账单可读性 + 会员转化条 + 用量 KPI |
| 信息架构 | A：同页三段，无 Tab / 侧栏 |
| KPI 时间口径 | A：与账单共用 `range` |
| 充值/升级行为 | A：均打开 `MembershipModal` |
| KPI 指标集 | B：净消耗、单日峰值、日均消耗、活跃天数、最长连续活跃天 |
| API 方案 | 扩展现有 `points-summary`，不新开接口 |

---

## §1 页面布局（ProfilePage）

自上而下三段，沿用 `/profile` 单路由：

### 1.1 账户条

- 头像 / 昵称 / 手机（保留）  
- **资产卡**：大号可用积分 + 会员等级徽章  
- 并排 CTA：**充值** | **升级会员**（`membership !== 'free'` 时后者文案可为「管理会员」）  
- 免费版弱文案：「开通会员，获得更多积分与高级能力」  
- 两按钮均 `v-model` 打开 `MembershipModal`（与 `CanvasAccountChrome` / `AppHeader` 一致）

### 1.2 统计区

顶部 **range 切换**（`近 7 天` | `本月` | `全部`），切换时刷新 summary + transactions。

**上：分类汇总**（`#270` 已有，保留）  
- 四分类净消耗卡，可点击联动 `category` 筛选  
- 退款合计 / 获得合计 / other 卡（条件展示）

**下：用量洞察 KPI**（新增）  
五卡横排（窄屏 2+3 或纵向）：

| KPI | 说明 |
|-----|------|
| 净消耗 | 四类 + other 净消耗之和 |
| 单日峰值 | 窗口内单日 consume 绝对值之和的最大值 |
| 日均消耗 | `netConsumedTotal / max(1, 窗口日历天数)` |
| 活跃天数 | 至少一笔 `kind=consume` 的上海日历日数 |
| 最长连续活跃 | 活跃日中连续日历日的最长 streak |

加载态：summary 区 skeleton，避免数字闪烁。

### 1.3 账单区

- kind 分段：**全部 | 消耗 | 获得**  
- 明细卡列表 + 加载更多（`#270` 分页保留）  
- 空态区分：无记录 vs 筛选无结果

---

## §2 API 与口径

### 2.1 扩展 `GET /membership/points-summary?range=`

在现有 `PointsSummaryDto` 上增加 `insights`：

```ts
interface PointsInsights {
  netConsumedTotal: number
  peakDayConsumed: number
  avgDailyConsumed: number
  activeDays: number
  longestStreakDays: number
}

interface PointsSummaryDto {
  // ...existing fields
  insights: PointsInsights
}
```

**`netConsumedTotal`**  
`byCategory` 四值 + `otherNetConsumed` 之和（与分类卡一致）。

**`peakDayConsumed`**  
在 `[from, to]` 窗口内，按 `Asia/Shanghai` 日历日 bucket；每日 `sum(|amount|)` where `kind=consume`；取最大值。无 consume 则为 `0`。

**`avgDailyConsumed`**  
`netConsumedTotal / max(1, windowCalendarDays)`。  
- `7d` / `month`：`windowCalendarDays` = `from` 至 `to` 的上海日历日数（含首尾）  
- `all`：`from` = 用户最早一笔 `pointTransaction.createdAt` 所在上海日 00:00；若无交易则 `windowCalendarDays = 1`

**`activeDays`**  
窗口内，至少有一笔 `kind=consume` 的上海日历日数。

**`longestStreakDays`**  
将活跃日排序后，计算最长连续日历日 streak（相邻日差 1 天则连续）。无活跃日为 `0`。

**不计入 insights 的流水**  
- `peakDayConsumed` / `activeDays` / `longestStreakDays`：仅 `kind=consume`  
- `netConsumedTotal` / `avgDailyConsumed`：沿用净消耗公式（consume − refund），与分类汇总一致  
- `grant` 不参与任何 insights 分子

**实现建议**  
在 `MembershipService.pointsSummary` 内，在现有 `groupBy` 之后增加按日聚合查询（`findMany` select `createdAt, amount, kind` 或 raw SQL / Prisma groupBy on date bucket）。数据量按单用户 + range 可控；`all` 需注意索引 `(userId, createdAt)`。

### 2.2 `GET /membership/transactions`

**不变**。字段已含 `balanceAfter`、`model`、`generationId` 等。

**UI kind 分段映射**

| Tab | API `kind` |
|-----|------------|
| 全部 | 不传 |
| 消耗 | `consume` |
| 获得 | `grant` |

退款（`kind=refund`）仅在「全部」展示，带「退款」徽章；不纳入「消耗」tab。  
保留点击「退款积分」对照卡 → `kind=refund` 的快捷筛选（`#270` 行为，可与分段并存）。

### 2.3 共享 types

- 服务端 `PointsSummaryDto` 与 `@lnkpi/shared`（若有）及 `apps/web/src/services/users-api.ts` 的 `PointsSummary` 同步扩展 `insights`  
- 前端 `membershipApi.pointsSummary` 类型一并更新

---

## §3 UI 细节

### 3.1 明细卡结构

| 区域 | 内容 |
|------|------|
| 主行左 | `reason` + kind 徽章 |
| 主行右 | 金额（消耗负向红色；退款/获得正向绿色） |
| 次行 | `createdAt` 本地格式化 |
| 标签行 | `category` 徽章；`model` tag（有则显示） |
| 尾行 | 左：`generationId` 短码（有则）；右：**余额** `balanceAfter`，null → `—` |

### 3.2 筛选交互

- range 切换 → 重置或保留 kind/category 筛选（实现选 **保留**，与 `#270` 一致）  
- 点击分类卡 → `filterCategory` toggle  
- 「清除筛选」保留  
- kind 分段与 chip 筛选互斥：选中分段时清掉 chip 式 kind 筛选，避免双重状态

### 3.3 MembershipModal

`ProfilePage` 引入 `MembershipModal`，本地 `showMembership` ref；不新建支付组件。

---

## §4 边界与一致性

- summary、insights、transactions 必须使用同一 `range` 与 `from`/`to`  
- `balanceAfter` 历史 null 不阻断展示  
- insights 全 0 时 KPI 卡仍展示 `0`，不隐藏  
- `all` + 无交易：insights 全 0，`avgDailyConsumed` 为 0  
- 金额符号：消费 `amount < 0`；退款/获得 `amount > 0`（与 `#270` 一致）

---

## §5 测试要点

### 服务端

- `insights.netConsumedTotal` = 四分类净消耗 + other  
- 单日多笔 consume：峰值取日合计而非单笔  
- 活跃日不连续：streak 正确（如 Mon+Wed = longest 1）  
- 连续三天 consume：streak = 3  
- refund 不改变 activeDays，但减少 netConsumedTotal  
- `range=7d|month|all` 边界与 `resolvePointsRange` 一致  
- `all` 无交易 → insights 全 0

### 前端

- range 切换同时更新 KPI 与明细  
- kind 分段：消耗不含 refund；全部含 refund 徽章  
- `balanceAfter` null 显示 `—`  
- 充值/升级打开 `MembershipModal`  
- 筛选空态文案正确  
- fetch race guard（`#270` 已有 generation 机制）对 insights 仍有效

---

## §6 建议落地顺序

1. 扩展 `PointsSummaryDto` + `pointsSummary()` insights 计算 + 单测  
2. 同步 shared / `users-api.ts` 类型  
3. `ProfilePage`：资产卡 + MembershipModal  
4. `ProfilePage`：insights KPI 卡  
5. `ProfilePage`：kind 分段 + 明细 `balanceAfter` + 密度微调  
6. 冒烟：三 range × 有/无交易账号

---

## §7 与 Neowow 对照（采纳清单）

| Neowow | 我们 | 本期 |
|--------|------|------|
| 密集账单表 + 余额列 | 明细卡 + balanceAfter | ✅ |
| 全部/消耗/获得筛选 | kind 分段 | ✅ |
| 个人信息充值/升级双 CTA | MembershipModal | ✅ |
| 用量 KPI 五指标 | insights | ✅ |
| 365 天固定窗口 | 共用 range | ✅（更一致） |
| 热力图 | — | ❌ |
| 侧栏账号壳 | — | ❌ |
| token/项目标签 | model tag only | 部分 |
