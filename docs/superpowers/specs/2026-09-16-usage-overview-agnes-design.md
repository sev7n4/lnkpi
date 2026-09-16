# 个人中心用量总览（复刻 Agnes 结构 · 暗色皮肤）

日期：2026-09-16  
状态：待实现  
前置：`#270` 积分账单、`points-summary` insights、`2026-09-15` 账户/账单 Tab  
范围：把 `/profile` 账单 Tab 升级为 Agnes「用量总览」四段式页面；流水下沉为按日下钻。

## 背景与目标

对标 [Agnes 用量总览](https://platform.agnes-ai.com/settings/usage)：总览五卡 → 年历活跃度 → 趋势折线 → 按日明细。

lnk π 卖的是积分不是 Token；`PointTransaction` 没有 Token / 张数 / 秒数字段。结构、层级、控件严格按 Agnes，指标换成积分口径，皮肤跟现有个人中心暗色。

**成功标准**

- `/profile` 仍两级：账户 | 用量（原账单）；`?tab=billing` 深链继续打开用量
- 四段一次看完：累计五卡、近 6 个月年历、可切换折线、按日表
- 点某一日展开当天流水（原因、模型、生成 ID、变动后余额）
- 暗色、年历绿色为唯一强调；无白底、无导出、无自定义日期

## 已锁定决策

| 项 | 选择 |
|----|------|
| 入口 | 改造现有账单 Tab，不新建设置壳、不第三级 Tab、不独立路由 |
| Tab 文案 | 对外「用量」；query 仍认 `billing`，也认 `usage`；写入继续用 `billing` |
| 皮肤 | 结构复刻 + 暗色个人中心 |
| 总览五卡 | 净消耗积分、图片消耗、视频消耗、生成次数、累计活跃 |
| 年历 | 滚动近 6 个月；格子 = 当天净消耗；只看不点；一周从周一开始 |
| 趋势 | 近 7 天 / 近 30 天 / 本月；默认近 7 天；单选系列 |
| 明细表 | 按日；点行展开当天流水；无导出 |
| 时间窗口 | 三套相互独立（见 §2） |
| API | `GET /membership/usage` + `GET /membership/usage-days`；流水加 `day=` |
| 旧接口 | `points-summary` 保留，用量页不再读 |

非目标：导出、自定义区间、「今年」、浅色皮肤、设置侧栏、Token/张数/秒数、年历点击、总览卡当筛选、新 Prisma 字段、删除 `points-summary`、获得/签到进用量页、改 MembershipModal。

---

## §1 页面结构

账户 Tab 不变。用量 Tab 自上而下四段，左对齐。

```
个人中心                          [ × ]
[ 账户 ] [ 用量 ]

用量总览
[ 净消耗积分 ] [ 图片消耗 ] [ 视频消耗 ] [ 生成次数 ] [ 累计活跃 ]

活跃度     低 ■■■■ 高          N 个活跃日     YYYY-MM-DD – YYYY-MM-DD
[ 近 6 个月 GitHub 式年历 ]

用量趋势
[ 近 7 天 ] [ 近 30 天 ] [ 本月 ]
                                生成次数 | 积分消耗 | 文本 | 图片 | 音频 | 视频
[ 折线 ]

用量明细
日期 | 生成次数 | 积分消耗 | 文本 | 图片 | 音频 | 视频
[ 行展开 → 当天流水 ]
```

整页内容区改为 `max-w-6xl`（年历需要宽度）。账户 Tab 内卡片保持约 `max-w-3xl` 左对齐，避免身份区被拉得过宽。

### 1.1 总览五卡

累计窗口（账户全部历史）。不可点击。

| 卡 | 值 | 口径 |
|----|----|------|
| 净消耗积分 | `overview.netConsumedTotal` | 四分类 + other 净消耗之和 |
| 图片消耗 | `overview.byCategory.image` | 图片净消耗 |
| 视频消耗 | `overview.byCategory.video` | 视频净消耗 |
| 生成次数 | `overview.generationCount` | 见 §3.2 |
| 累计活跃 | `overview.activeDays` | 全部历史上至少一笔 `consume` 的上海日历日数 |

文案用「累计活跃」，不要和年历「N 个活跃日」混用。数字 `tabular-nums`，整数千分位。

文本、音频不进五卡，进趋势系列和明细列。

### 1.2 活跃度年历

- 窗口：滚动近 6 个上海日历月，含今天。`from = 今日减去 6 个日历月`（日溢出落到目标月最后一天。例：今天 `2026-03-31` → `from = 2025-09-30`）。今天 `2026-09-16` → `2026-03-16`～`2026-09-16`
- 格子按周列排布，一周从周一开始；左侧标 周一 / 周三 / 周五。从 `from` 所在周的周一画到 `to` 所在周的周日；**窗口外**的格子画成空槽但不可 hover，不要标成有消耗
- 空格 `rgba(255,255,255,0.06)`；有消耗 4 档绿（GitHub dark：`#0e4429` / `#006d32` / `#26a641` / `#39d353`）
- 分档相对**本窗口净消耗最大值**：0 → 空；`(0,25%]` `L1`；`(25,50%]` `L2`；`(50,75%]` `L3`；`(75,100%]` `L4`。窗口最大值为 0 则全空
- 左侧「N 个活跃日」= 近 6 个月至少一笔 `consume` 的天数（可以和五卡累计活跃不同）
- 右侧写区间起止日期
- Hover：日期、当日净消耗、生成次数
- 不响应点击
- 窄屏横向滚动，不把格子压扁

### 1.3 用量趋势

- 时间：近 7 天 | 近 30 天 | 本月。默认近 7 天。上海日历日，含今天，见 §2
- 系列单选：生成次数、积分消耗、文本消耗、图片消耗、音频消耗、视频消耗
- 默认系列：生成次数（对 Agnes「请求数」）
- 折线按**窗口内每一个日历日**取点，无消耗的日值为 0，不跳日
- Hover：日期 + 当前系列的值
- 不展示「开始日期 / 结束日期」双系列
- 切时间只刷新折线 + 明细，总览和年历不动
- `prefers-reduced-motion`：无入场动画

### 1.4 用量明细

列：日期、生成次数、积分消耗、文本、图片、音频、视频。

- 与趋势同一 `range`
- **有过 `kind=consume` 的日才出一行**（净消耗可以为 0，例如当天后全退）
- 无 consume 的日不占空行（与折线补 0 不同）
- 日期新→旧
- 点一行展开当天流水；同时只允许展开一行；再点同一行收起
- 展开后再请求流水，不预拉 30 天
- 「积分消耗」含 `other` 净消耗；文本/图片/音频/视频四列不含 other。四列之和可以小于积分消耗。不加「其他」列
- 第一版无「导出」

展开区复用现有账单行：原因、kind/category 徽章、模型、金额、时间、生成 ID、变动后余额。当天 **consume / refund / grant 全展示**（对账用）。不再要「全部 / 消耗 / 获得」分段条。

---

## §2 三套时间窗口

| 区块 | 窗口 | 切趋势是否变 |
|------|------|----------------|
| 总览五卡 | 累计 `from = null` | 不变 |
| 年历 | 近 6 个日历月 | 不变 |
| 趋势 + 明细 | `7d` / `30d` / `month` | 变 |

全部按 `Asia/Shanghai`。

| `range` | `from` | `to` |
|---------|--------|------|
| `7d` | 含今天在内往前 6 个上海日历日的 00:00（共 7 日） | 现在 |
| `30d` | 含今天在内往前 29 个上海日历日的 00:00（共 30 日） | 现在 |
| `month` | 本月上海 1 日 00:00 | 现在 |

不要复用现有 `resolvePointsRange('7d')` 的滚动 168 小时。用量日历日逻辑放新 helper（如 `points-usage-range.ts`），**不改** `points-summary` 的旧 `7d` 语义。

---

## §3 口径

### 3.1 净消耗

与现有 `points-summary` 一致：

```
net(category) = max(0, -sum(consume.amount) - sum(refund.amount))
netConsumedTotal = Σ net(text|image|audio|video|other)
```

`grant` 不计入任何消耗分子。年历格子、折线「积分消耗」、表明细「积分消耗」都用净消耗。

年历某日净消耗为 0：格子当空。若该日有过 consume 后又退净，明细仍可有行。

### 3.2 生成次数

窗口内 `kind=consume`：

- 有 `generationId`：按 ID 去重计 1
- 无 `generationId`：每笔计 1
- `refund` / `grant` 不计

### 3.3 活跃日

至少一笔 `kind=consume` 的上海日历日。五卡用累计；年历副文案用近 6 个月。

---

## §4 API

两个只读接口 + 扩展流水。均 `AuthGuard`，只查 `req.user.sub`。

### 4.1 `GET /membership/usage`

进用量 Tab 拉一次。无 query。

```ts
interface UsageOverviewResponse {
  overview: {
    netConsumedTotal: number
    byCategory: { text: number; image: number; audio: number; video: number }
    otherNetConsumed: number
    generationCount: number
    activeDays: number
  }
  heatmap: {
    from: string // YYYY-MM-DD 上海
    to: string
    activeDays: number
    days: Array<{
      date: string // YYYY-MM-DD
      netConsumed: number
      generationCount: number
    }>
  }
}
```

`heatmap.days` 只返回净消耗 > 0 **或** 生成次数 > 0 的日，前端按日历补空格。不要一次下发约 180 个全零对象。

### 4.2 `GET /membership/usage-days?range=7d|30d|month`

默认 `7d`。非法值当 `7d`。

```ts
interface UsageDaysResponse {
  range: '7d' | '30d' | 'month'
  from: string // YYYY-MM-DD
  to: string
  days: Array<{
    date: string
    generationCount: number
    netConsumed: number
    byCategory: { text: number; image: number; audio: number; video: number }
    otherNetConsumed: number
  }>
}
```

`days` 含窗口内**每一个日历日**（含全 0），升序。折线直接用；表过滤 `generationCount > 0`（有 consume 才会 > 0；无 ID 的 consume 也会 > 0）。

若某日只有 refund/grant、没有任何 consume：`generationCount = 0` 且净消耗为 0，表不出行。

### 4.3 `GET /membership/transactions?day=YYYY-MM-DD`

新增 `day`。传入时**忽略** `range`，按该上海日 `[00:00, 次日 00:00)` 过滤。`kind` / `category` / `cursor` / `limit` 仍可用。

非法日期（非 `YYYY-MM-DD` 或不存在的日）→ 400。

展开某日：`day` + 不传 `kind`，当天三种 kind 都返回。

### 4.4 实现约束

- 按日聚合在 SQL / Prisma groupBy，不要把用户全部流水拉进 Node 再 bucket。`usage` 累计可用 `groupBy kind+category` + 去重 `generationId`；年历扫描近 6 个月 consume/refund。
- 已有索引 `(userId, createdAt)`、`(userId, kind, category, createdAt)` 够用则不加字段。
- 前端：`membershipApi.usage()`、`membershipApi.usageDays(range)`、`transactions` 增加 `day?`。
- 仅在用量 Tab 激活时请求 `usage` / `usage-days`；切回账户不停轮询。切趋势 range 只重打 `usage-days`。
- `points-summary` 行为不变，本页不调用。

---

## §5 视觉

沿用个人中心暗色，年历绿是这一页唯一大胆元素。

| Token | 值 | 用途 |
|-------|----|------|
| 页底 | `--neo-bg` / `#131318` | 背景 |
| 段面 | `#16161C` | 四段容器 |
| 边线 | `rgba(255,255,255,0.08)` | 分割 |
| 主/次文 | 白 / `white/55` | 标题与说明 |
| 年历空 | `rgba(255,255,255,0.06)` | 无消耗格 |
| 年历热 | `#0e4429` → `#39d353` | 4 档绿 |
| 折线 | `white/80` | 单系列，不彩虹 |

数字用现有无衬线 + `tabular-nums`。不要大数字 Hero 渐变、ALL-CAPS eyebrow、每张卡阴影。

时间分段与系列切换用暗色胶囊，选中 `bg-white/12`，不要账单旧紫 `#6366f1`。

键盘：分段按钮可 Tab；年历格子 hover/focus 给同一套说明（桌面 title 或小提示）。窄屏：年历和表横向滚动。

---

## §6 状态

| 状态 | 行为 |
|------|------|
| 未登录 | 与现页一致，`openLogin()` |
| 用量 + 年历加载 | 五卡和年历骨架；不要整页空白 |
| 趋势切换 | 只骨架折线 + 表 |
| 累计无消耗 | 五卡为 0；年历全空；「0 个活跃日」 |
| 该 range 无消耗 | 折线贴 0；表：「还没有消耗。去创作后，这里会按日汇总。」链到 `/workflow` |
| `usage` 失败 | 五卡+年历错误 + 「重新加载」，趋势区仍可试 |
| `usage-days` 失败 | 折线+表错误 + 「重新加载」，上面两段保留 |
| 某日流水失败 | 错误写在展开区，不影响其它行 |
| 某日无流水 | 展开区：「这一天没有流水。」（不应发生在有 consume 的行；grant-only 日不出表） |

---

## §7 组件与文件

| 文件 | 角色 |
|------|------|
| `apps/server/src/points/points-usage-range.ts` | 日历日 `7d`/`30d`/`month` + 近 6 个月 |
| `apps/server/src/points/points-usage.ts` | 净消耗、生成次数、按日聚合纯函数 |
| `apps/server/src/membership/membership.service.ts` | `usage` / `usageDays`；`listTransactions` 支持 `day` |
| `apps/server/src/membership/membership.controller.ts` | 两 GET + `day` query |
| `apps/web/src/services/users-api.ts` | 类型与 API |
| `apps/web/src/pages/ProfilePage.vue` | Tab 文案；用量四段替换旧账单堆叠 |
| `apps/web/src/components/usage/UsageOverviewCards.vue` | 五卡 |
| `apps/web/src/components/usage/UsageHeatmap.vue` | 年历 |
| `apps/web/src/components/usage/UsageTrend.vue` | 折线 + 时间/系列 |
| `apps/web/src/components/usage/UsageDayTable.vue` | 表 + 展开流水 |
| 对应 `*.test.ts` | 口径与渲染冒烟 |

前端折线用项目里已有的轻量方案；若 `apps/web` 无图表库，用 SVG 折线，不为此引入重型 dashboard 套件。

---

## §8 测试计划

- [ ] `7d`/`30d`/`month` 上海日历日边界（跨月、跨年、含今天）
- [ ] 近 6 个月起止
- [ ] 净消耗：consume + refund + grant 组合
- [ ] 生成次数：去重 ID、无 ID、退款不计
- [ ] `usage` 不随 range 变化（无 range 参数）
- [ ] `usage-days` 补齐空日；表侧过滤无 consume 日
- [ ] `transactions?day=` 忽略 range；非法 day 400
- [ ] Profile：Tab「用量」；`?tab=billing` 打开用量
- [ ] 切 近 7 天 / 30 天 / 本月 不重新请求 `usage`
- [ ] 同时只展开一行；展开才打 `day` 请求
- [ ] 空态文案与重新加载
- [ ] 账户 Tab 视觉回归：身份 / 创作能量 / 邀请仍在

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-16 | 初稿：Agnes 结构 + 暗色；五卡积分口径；6 个月年历；双接口；流水按日下钻 |
