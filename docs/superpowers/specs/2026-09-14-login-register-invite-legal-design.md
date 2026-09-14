# 登录/注册分栏 + 邀请码全流程 + 协议页设计

日期：2026-09-14  
状态：待实现  
范围：复刻 neo-tv 登录壳（左视频全出血、右栏登录/注册、协议文案）；打通专属邀请码校验/绑定/双边积分；协议独立页替换 NeoWOW 为 lnk π 平台信息。

参考：[neowow.cn/neo-tv](https://neowow.cn/neo-tv) 登录浮层。

## 背景与目标

当前全屏登录为「登录即注册」单通道；左视频有圆角 inset；协议仅为占位《用户协议》《隐私政策》；无邀请体系。

**成功标准**

- 左栏视频无圆角、贴满左栏，视觉接近 neo-tv 全出血
- 右栏分 **登录 / 注册**；注册可选邀请码；无效码拒绝注册
- 每用户专属邀请码；绑定邀请关系；双方各 +200 积分（含日上限规则）
- Profile 展示邀请码、一键复制、已邀请人数
- `/terms`、`/privacy` 可点可分享；平台名与主体信息正确

## 已锁定决策

| 项 | 选择 |
|----|------|
| 平台名 | **lnk π超创平台**（`BRAND_NAME`） |
| 运营主体 | 墨鱼π科技技术有限公司 |
| 联系邮箱 | sev7nseason@outlook.com |
| ICP | 暂无，文案「ICP备案号申请中」 |
| 邀请码来源 | 每用户自动专属码；本期不做运营批次码 |
| 邀请码选填 | 空=可注册不绑；填了无效=拒绝 |
| 积分 | 邀请人与被邀请人各 **+200** |
| 防刷 | 禁止自邀；同一 invitee 只结算一次；邀请人单日成功邀请 **20** 封顶（超限仍绑定，当日不再给邀请人分） |
| 鉴权 | 拆分 `POST /auth/login` 与 `POST /auth/register` |
| 协议呈现 | 独立路由 `/terms`、`/privacy` |
| 实现路径 | 单 PR 全竖切（视觉 + 协议 + 邀请后端 + Profile） |

非目标：运营批次码、邀请排行榜、法务终稿级长文（本期结构化合规占位，可替换正文不改路由）、微信/密码登录。

---

## 1. 登录壳与右栏表单

### 1.1 左视频（`LoginVideoPanel`）

- 去掉外层 padding、圆角、边框、阴影；视频 `object-cover` 铺满左栏容器
- 保留左侧圆点切换与底部弱 caption（如「超创 · {主题}」可保留或改为「lnk π · {主题}」）
- 桌面仍约 65% / 35%；移动端上视频条 + 下表单不变

### 1.2 右栏（`LoginFormPanel`）

自上而下：

1. BrandLogo（名称取 `BRAND_NAME`）
2. 标题：登录「欢迎登录」；注册「欢迎注册」
3. 副文案：「继续你的创作之旅」
4. 胶囊 Tab：**登录 | 注册**
5. 手机号（+86）
6. 验证码 +「发送验证码」（仍：滑块 captcha → `send-code`）
7. **仅注册**：邀请码输入，placeholder「请输入邀请码（可选）」
8. 主按钮：登录「开始你的旅程」；注册「注册」
9. 协议行（见 §3）
10. 底部 ICP 占位灰字

切换 Tab 时清空错误态；邀请码字段仅注册可见；倒计时可跨 Tab 保留（同手机号）。

### 1.3 提交

- 登录 → `POST /auth/login` `{ phone, code }`
- 注册 → `POST /auth/register` `{ phone, code, inviteCode? }`
- 错误展示表单下方短句（已存在账号、邀请码无效、验证码错误等）

---

## 2. 邀请模型 + 鉴权 + 积分

### 2.1 Prisma

`User` 新增：

- `inviteCode String @unique` — 创建时生成
- `invitedByUserId String?` — 仅注册成功且有效码时写入，此后不可改

关系：`invitedBy User? @relation("UserInvites", …)` / `invitees User[]`

推荐表 `InviteRedemption`：

| 字段 | 说明 |
|------|------|
| `id` | cuid |
| `inviteeId` | `@unique` 保证一人一次 |
| `inviterId` | |
| `inviteCode` | 冗余快照 |
| `inviteePoints` | 实际发给被邀请人的分数 |
| `inviterPoints` | 实际发给邀请人的分数（日上限跳过时可为 0） |
| `inviterRewardSkippedReason` | 可选，如 `daily_cap` |
| `createdAt` | |

码格式：前缀 `XC` + 8 位易读字符（排除 `0OIL1` 等易混字符），碰撞重试。

**存量用户**：`login` / `getProfile` 时若 `inviteCode` 为空则惰性生成并写回。

### 2.2 API

| 方法 | 行为 |
|------|------|
| `POST /auth/login` | 用户必须已存在，否则 `404`/`400`「账号不存在，请先注册」；验码通过发 JWT；**忽略**邀请码 |
| `POST /auth/register` | 手机号已存在 → `409`「账号已存在，请直接登录」；验码通过创建用户；处理可选邀请码；发 JWT |
| `GET /auth/profile`（现有） | 增加 `inviteCode`、`invitedByUserId?`、`inviteeCount`（已邀请人数） |

邀请码处理（仅 register）：

1. 空/空白 → 不绑定、不加双边邀请积分（新用户仍拿默认 1000）
2. 码不存在 → `400`「邀请码无效」
3. 码属于将要创建的账号自身（不可能）或与 phone 对应用户冲突 → 不适用；创建后禁止「填自己的码」：若码对应用户 id 在创建前即等于…（创建前用码查 inviter，创建后若 inviterId === newUserId 不可能）；**禁止**邀请人 phone 与注册 phone 相同的边缘情况不存在。标准：**inviter.inviteCode === input 且 inviter 存在**；若未来同请求伪造则在绑定前断言 `inviter.id !== invitee.id`
4. 成功：写 `invitedByUserId`、写 `InviteRedemption`、双方 credit

### 2.3 积分规则

- 新用户 `points` 默认仍 **1000**
- 有效邀请绑定时：
  - 被邀请人 `PointsService` **+200**，reason/`kind`：`invite_reward_invitee`
  - 邀请人 **+200**，除非该邀请人在上海时区当日已成功邀请（`InviteRedemption` 按 `inviterId`+当日）≥ **20**：仍绑定，`inviterPoints=0`，`inviterRewardSkippedReason=daily_cap`
- 全程事务：用户创建 + 绑定 + 流水尽量同一事务，避免半成功

### 2.4 Profile

- 展示「我的邀请码」+ 一键复制
- 展示「已邀请 N 人」（`inviteeCount`）
- 不在本规格做邀请列表详情页

---

## 3. 协议页与品牌常量

### 3.1 常量（`brand.ts` / `legal.ts`）

```ts
BRAND_NAME = 'lnk π超创平台'
LEGAL_ENTITY = '墨鱼π科技技术有限公司'
SUPPORT_EMAIL = 'sev7nseason@outlook.com'
ICP_TEXT = 'ICP备案号申请中'
TERMS_TITLE = 'lnk π超创平台用户协议'
PRIVACY_TITLE = 'lnk π超创平台隐私政策'
```

登录/注册协议行：

- 登录：`登录即表示同意《lnk π超创平台用户协议》与《lnk π超创平台隐私政策》`
- 注册：`注册即表示同意《…》与《…》`

链接：`/terms`、`/privacy`，**新标签打开**（保留登录浮层）。

### 3.2 页面

- 路由：`/terms`、`/privacy`，公开
- 深色文档页：顶栏品牌、标题、更新/生效日期、分节正文、页脚主体/邮箱/ICP
- 文案：结构对齐 neo-tv 用户协议骨架；替换平台名与主体；隐私政策含收集范围、用途、存储、第三方、用户权利、未成年人（不面向 18 岁以下）、联系方式
- 非目标：逐字复制 neo-tv；法务终审后可只换 Markdown/组件正文

---

## 4. 文件触点（预期）

| 区域 | 文件 |
|------|------|
| UI | `LoginVideoPanel.vue`、`LoginFormPanel.vue`、`LoginDialog.vue` |
| Auth store / API | `stores/auth.ts`、server `auth.controller/service` + DTO |
| DB | `schema.prisma` + migration |
| Invite | 新建 `invite.service.ts`（或挂在 auth）+ 测试 |
| Points | 复用 `PointsService.credit` |
| Profile | `ProfilePage.vue` |
| Legal | 新页面组件 + `router/index.ts` |
| Brand | `constants/brand.ts`（及可选 `legal.ts`） |

---

## 5. 测试计划

- [ ] 左视频无圆角、桌面铺满左栏
- [ ] Tab 切换字段与主按钮文案正确；注册无码可成功
- [ ] 无效码 / 自邀码注册失败；有效码双方 +200，默认 1000+200
- [ ] 登录已存在用户成功；注册已存在 → 409；登录不存在 → 明确错误
- [ ] 邀请人日第 21 次：绑定成功但邀请人不加分
- [ ] Profile 码可复制、`已邀请 N` 正确；存量用户补码
- [ ] `/terms` `/privacy` 可打开，主体/邮箱/平台名正确；登录浮层链接新标签
- [ ] captcha → send-code → login/register 回归

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-14 | 初稿：视觉 + login/register + 邀请全流程 + 协议页；平台名 lnk π超创平台 |
