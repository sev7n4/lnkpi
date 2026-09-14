# 账号入口统一 + 个人中心 IA 重设计

日期：2026-09-15  
状态：待实现  
范围：统一主页顶栏与画布账号 Chrome；个人中心拆为「账户 / 账单」两级 Tab，并与共享身份语言对齐。

## 背景与目标

当前存在三套账号气质：

| 入口 | 现状 |
|------|------|
| `AppHeader` | 紫系积分 pill、首字母头像、外露退出 |
| `CanvasAccountChrome` | 暖橙积分 + 闪电、吉祥物头像、popover |
| `/profile` | 首字母头像 + 紫积分 + 纵向卡片堆叠（资料/积分/邀请/账单混在一页） |

**成功标准**

- 主页与画布共用同一套积分 pill + 头像菜单（交互与视觉一致）
- `/profile` 仅两个一级：**账户** | **账单**；默认账户；支持 `?tab=billing` 深链
- 个人中心账户区使用与 Chrome 同一套身份语言（吉祥物头像、琥珀积分强调）
- 账单能力与筛选语义保持，仅换壳与分区
- 美观克制：少卡片、不大数字 Hero 模板、无 ALL-CAPS eyebrow

## 已锁定决策

| 项 | 选择 |
|----|------|
| 统一策略 | 抽共享组件：积分 pill + 头像菜单；Profile 用同一身份语言 |
| 个人中心 IA | 两个一级：账户 + 账单 |
| 切换方式 | 页内胶囊 Tab；默认账户；深链 `/profile?tab=billing` |
| 画布点积分 | 仍打开充值（不打断创作）；不强制跳账单 |
| 头像 | 品牌吉祥物（弃首字母色块） |
| 积分色 | 暖琥珀（沿用画布能量感，弃主页纯紫 pill） |
| 实现路径 | 共享 `AccountChrome` 族 + Profile Tab 重构 |

非目标：改昵称/手机、邀请排行、MembershipModal 内部、全站非账号紫按钮统一。

---

## 1. 站点级信息架构

```
主页顶栏 / 画布浮层
  ├─ 积分 pill → MembershipModal（充值）
  └─ 头像菜单
        ├─ 充值
        ├─ 个人资料 → /profile?tab=account
        └─ 退出

/profile?tab=account|billing
  ├─ 账户（默认）
  └─ 账单
```

非法或缺失 `tab` → `account`。Tab 与 `route.query.tab` 双向同步，使用 `router.replace` 避免历史膨胀。

### 内容归属

| 内容 | 一级 |
|------|------|
| 头像、昵称、手机、会员 | 账户 |
| 积分余额、充值/会员 CTA | 账户（「创作能量」一块） |
| 邀请码、已邀请人数 | 账户（不单独占一级） |
| 时间范围、消耗概览、洞察、流水 | 账单 |

---

## 2. 视觉语言（Chrome + 账户区）

**语境：** lnk π 超创平台 — 创作能量（积分）+ 创作者身份。

**Token**

| 名 | 值 | 用途 |
|----|-----|------|
| 页面底 | `#0C0C10` / 沿用 `--neo-bg` | 背景 |
| 浮层面 | `#16161C` | popover / 区块 |
| 边线 | `rgba(255,255,255,0.08)` | 分割 |
| 积分强调 | `#E8A45C` / `--neo-warm` | pill 图标与余额强调 |
| 正文 | 白 / `white/55` | 主/次文案 |
| 品牌渐变 | `--neo-brand-gradient` | 菜单头、头像底（克制使用） |

**原则**

- 大胆只用在积分琥珀一点；其余安静
- 账户区最多三块：身份 / 创作能量 / 邀请
- 动效仅 popover 开合；尊重 `prefers-reduced-motion`
- 禁止：大数字三列 Hero、01/02 编号、tracked ALL-CAPS eyebrow、主页/画布第三套样式

---

## 3. 共享组件 API

### `AccountPointsPill.vue`

- 展示 `auth.user.points`
- 点击 `emit('click')`；父级打开 MembershipModal
- 视觉：闪电/币标 + 数字 +「积分」

### `AccountUserMenu.vue`

- 吉祥物圆形头像；点击切换 popover
- 头：昵称、会员徽章、积分行「充值」
- 项：个人资料 → `/profile?tab=account`；退出
- Props：`compact?: boolean`（画布可略紧）
- Emits：`open-membership`、`logout`（资料用 router）

### `AccountChrome.vue`

- 组合：PointsPill + UserMenu
- 未登录：单一「登录」按钮 → `auth.openLogin()`
- 已登录：pill + menu；membership 由父级或内部 `MembershipModal` 二选一（实现时与现 Canvas 一致，避免双 modal）

**接入**

- `AppHeader`：用 `AccountChrome` 替换现有积分/头像/退出
- `CanvasAccountChrome`：薄包装或直接替换为 `AccountChrome`（保留 canvas 定位 class 如需）

---

## 4. 个人中心页结构

```
个人中心
[ 账户 ] [ 账单 ]     ← 胶囊 Tab

账户：
  身份带（吉祥物 + 昵称 + 手机 + 会员）
  创作能量（余额大号琥珀强调 + 充值/会员 CTA）
  邀请（码 + 复制 + 已邀请 N）

账单：
  时间范围 · 品类消耗 · 洞察 · 退款/获得 · 流水 Tab · 列表
  （逻辑迁自现 ProfilePage，语义不变）
```

- 切换 Tab 时保留账单筛选状态（内存）
- 空态：说明原因 + 清除筛选 / 去创作
- 未登录：`openLogin()`（现状）
- 移动端：同 Tab；账户单列；账单概览 2 列

---

## 5. 文件触点

| 文件 | 角色 |
|------|------|
| `apps/web/src/components/account/AccountPointsPill.vue` | 新建 |
| `apps/web/src/components/account/AccountUserMenu.vue` | 新建 |
| `apps/web/src/components/account/AccountChrome.vue` | 新建 |
| `apps/web/src/components/layout/AppHeader.vue` | 改用 Chrome |
| `apps/web/src/components/canvas/CanvasAccountChrome.vue` | 改用 Chrome |
| `apps/web/src/pages/ProfilePage.vue` | Tab IA + 账户视觉 |
| `apps/web/src/pages/ProfilePage.test.ts` | 覆盖 tab / 账户关键文案 |

---

## 6. 测试计划

- [ ] 主页与画布：积分 pill、头像菜单外观与菜单项一致
- [ ] 未登录两处均显示登录
- [ ] `/profile` 默认账户；`?tab=billing` 打开账单；非法 tab 回退
- [ ] 账户：邀请复制、充值打开 MembershipModal
- [ ] 账单：原筛选/加载更多仍可用
- [ ] 移动端 Tab 与单列可读
- [ ] `ProfilePage` 单测更新通过

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-15 | 初稿：共享 Chrome、账户/账单 Tab IA、视觉与 API |
