# 全屏登录 + 积木拼图验证码设计

日期：2026-09-13  
状态：已实现  
范围：替换现有小弹窗登录为 Seko 风格全屏浮层；发送短信前自研积木拼图验证；后端预留 ticket 校验

## 背景与目标

当前登录是 `LoginDialog`（`el-dialog` 420px），仅手机号 + SMS，无图形验证、无独立登录页。参考 [Seko explore 登录](https://seko.sensetime.com/explore)（左视频 / 右表单全屏浮层）与 NeoWow 深色创作台气质，优化登录入口体验，并在「发送验证码」前增加积木拼图，降低短信被刷风险。

**成功标准**

- 任意现有 `auth.openLogin()` 入口打开同一套全屏登录，无需改调用方语义
- 桌面：左约 55% 循环视频，右约 45% 表单；移动：上视频条 + 下表单
- 点「发送验证码」前必须完成积木拼图；登录通道仍为手机号 + SMS（注册登录合并）
- 后端支持 `AUTH_CAPTCHA_MODE=off|soft|strict`，前端始终走完整 UI

## 已锁定决策

| 项 | 选择 |
|----|------|
| 呈现形态 | 全屏浮层（非独立 `/login` 路由；后续可加） |
| 实现路径 | 方案 A：一体化全屏登录 + 发送前积木层 |
| 验证码 | 自研 UI + 后端预留；暂不接入极验/腾讯云 |
| 左侧素材 | 公开可商用、无侵权高质量视频占位，后续可替换 |
| 触发时机 | 点「发送验证码」前 |

## 架构

```
App.vue
  └─ LoginDialog（升级为全屏壳，保留 showLoginDialog 开关）
        ├─ LoginVideoPanel（左：循环 video）
        ├─ LoginFormPanel（右：Logo / 文案 / 手机号 / 验证码 / CTA）
        └─ BlockCaptchaOverlay（积木层：桌面覆盖右栏，移动底部抽屉）
              ↕
         auth store + api
              ↕
         POST /auth/captcha/challenge
         POST /auth/captcha/verify  → captchaTicket
         POST /auth/send-code      ← 可选 captchaTicket
         POST /auth/login
```

**边界**

- `LoginDialog`：壳与开关，不承载拼图几何逻辑
- `BlockCaptchaOverlay`：仅负责挑战展示、拖拽、本地吸附判定后调 verify
- `auth` store：发码/登录；缓存当前 `captchaTicket` 至发码成功或过期清空
- 不新增 `/login` 路由；不改 OAuth/密码通道（仍无）

## 视觉系统

沿用 Neo token，不另起主题：

| 角色 | 值 |
|------|-----|
| 背景 ink | `#131318` |
| 右栏板面 | `#1a1a21` |
| 主文字 | `#f4f4f8` |
| 次文字 | `rgba(244,244,248,0.62)` |
| 强调紫 | `#6d5dfc` |
| 积木高亮青 | `#22d3ee` |

- 标题：`Unbounded`；正文：现有 sans
- 签名记忆点：左栏成片光影；右栏克制，无紫渐变英雄区、无 SaaS 灰卡堆
- 积木：几何砖块（圆角矩形 / L 形），品牌紫/青，非写实乐高、非滑块缺口默认皮

### 桌面布局

```
全屏浮层（z 高于业务页）
├─ 左 ~55vw：video object-cover 全出血；底部居中弱署名/品牌
└─ 右 ~45vw：垂直居中内容列（max-width ~320–360px）；右上关闭
```

### 移动布局

- 上约 28vh 静音循环视频条
- 下表单可滚动
- 积木用底部抽屉，不长期遮挡输入区

## 右栏表单与文案

自上而下：

1. BrandLogo  
2. 主标题：「欢迎回来」  
3. 副文案：「用手机号继续创作」  
4. 手机号：`+86` + 11 位  
5. 验证码输入 +「发送验证码」  
6. 主按钮：「开始创作」/「登录中…」  
7. 协议：「登录即表示同意《用户协议》与《隐私政策》」——若仓库已有协议路由则链过去，否则先用 `#` 占位文案链，不阻断登录

固定码模式：开发环境可显示琥珀色弱提示（临时验证码）；真实短信模式不展示。

键盘：`Esc` 若积木层打开则先关积木层；否则关全屏登录浮层。

### 交互状态

| 条件 | 行为 |
|------|------|
| 手机号非法 | 「发送验证码」禁用 |
| 未过积木 | 点发送 → 开积木层，不发请求 |
| 积木通过 | 关积木层 → `send-code`（带 ticket） |
| 倒计时 | 按钮 `Ns`，不可点 |
| 登录成功 | 关全屏浮层 |
| 失败 | 表单下方红色短句（具体原因），不用系统 alert |

## 积木拼图交互

1. 合法手机号下点「发送验证码」→ 打开积木层  
2. 展示目标剪影 + 3～4 块散落可拖积木  
3. 拖到槽位，约 12px 内磁吸算到位  
4. 全部就位 → 电流青高亮一拍 → `verify` 得 `captchaTicket` → 关层 → 发短信  
5. 「换一题」重置；关闭积木层不发短信  

入场：积木轻微落下一次编排；之后仅响应拖拽，无逐段 fade-up。

## 后端预留 API

### `POST /auth/captcha/challenge`

- 响应：`challengeId`、积木几何描述（相对坐标/形状枚举）、目标槽位、可选 TTL  
- 本阶段可服务端生成确定性简单题，或返回前端可渲染的静态题库条目

### `POST /auth/captcha/verify`

- 请求：`challengeId` + 摆放结果（各块 slotId / 坐标）  
- 响应：`captchaTicket`、`expiresAt`  
- 本阶段校验规则可与前端吸附一致；ticket 为签名短令牌（HMAC 或随机 + 服务端存储），短 TTL（建议 2–5 分钟）

### `POST /auth/send-code` 扩展

- 请求增加可选 `captchaTicket`  
- 行为由 `AUTH_CAPTCHA_MODE` 控制：  
  - `off`：忽略 ticket（本地默认可用）  
  - `soft`：缺/无效 ticket 仍发码，打日志（建议首发默认）  
  - `strict`：无有效 ticket 返回 4xx，拒绝发码  

`POST /auth/login` 不变（`phone` + `code`）。

## 视频素材

- 使用公开可商用、无侵权的高质量循环视频（可 1～3 条 crossfade，对齐 Seko 体验）  
- 静音、`playsinline`、`autoplay`；失败时回退静帧海报  
- 资源放 `apps/web/public/` 或配置的 CDN；文档注明来源与许可，便于后续替换

## 错误处理

| 场景 | 处理 |
|------|------|
| challenge 拉取失败 | 积木层提示「验证加载失败，请重试」；可关层 |
| verify 失败 | 提示「拼图不正确」+ 换一题 |
| ticket 过期后点发送 | 重新开积木层 |
| send-code / login 网络超时 | 沿用现有跨境超时文案 |
| 视频加载失败 | 左栏纯色 + 海报，不影响右栏 |

## 测试要点

- 打开/关闭全屏浮层不破坏底层页滚动与焦点还原  
- 非法手机号无法发码；合法号未拼图不发请求  
- 拼图完成后 `send-code` 带 ticket；`soft`/`strict`/`off` 三种模式行为符合开关  
- 倒计时与登录成功关层  
- 桌面 / 窄屏布局与抽屉积木可用；键盘可关浮层（Esc）  
- `prefers-reduced-motion`：减弱积木入场与视频切换动画  

## 非目标（本迭代不做）

- 独立 `/login` 路由与强制路由守卫  
- 微信 / 密码 / 企业登录  
- 接入极验、腾讯云等商业验证码  
- 首页（WorkflowPage）整体视觉重做（另项）  

## 主要改动文件（预期）

- `apps/web/src/components/auth/LoginDialog.vue`（壳升级）  
- 新增：`LoginVideoPanel.vue`、`LoginFormPanel.vue`、`BlockCaptchaOverlay.vue`（路径可在 `components/auth/`）  
- `apps/web/src/stores/auth.ts`、`services/api` 相关  
- `apps/server/src/auth/*`（challenge / verify / send-code 扩展与开关）  
- `apps/web/public/` 视频与许可说明  

## 风险与后续

- 自研拼图防专业黑产能力有限；接口形状已预留，后续可替换为商业验证码而保持「发送前过人机」产品流程  
- 视频版权需在落地时核对许可文件；不确定则换明确 CC0 / 自有素材  
