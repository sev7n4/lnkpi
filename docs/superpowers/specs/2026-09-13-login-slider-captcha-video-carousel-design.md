# 登录缺口滑块验证码 + 五主题视频轮播设计

日期：2026-09-13  
状态：待实现  
范围：将已上线的积木拼图验证改为极验风格缺口滑块；登录左栏改为 5 段公开可商用主题视频轮播。全屏登录壳、发送验证码前门控、`AUTH_CAPTCHA_MODE` 不变。

## 背景

#297 已上线「积木拼图 + 单段占位视频」登录。产品反馈：人机验证应为**拖动滑块对齐图片缺口**；左栏视频应轮播 5 类创作气质片，便于后续替换成片。

## 目标

1. 发送验证码前：缺口拼图滑块（拖块对齐缺口）通过后发 `captchaTicket`。
2. 左栏：5 段静音循环视频 crossfade 轮播，主题近似：一镜到底运镜 / 好莱坞科幻 / 电商带货 / 护肤 TVC / 宏观→微观空间下钻。
3. 保留：全屏左视频右表单、`openLogin()`、`AUTH_CAPTCHA_MODE=off|soft|strict`、固定码短信模式。

## 非目标

- 接入极验/腾讯云等商业验证码 SDK。
- 独立 `/login` 路由。
- 真实成片拍摄（本期库存片占位）。

## 已锁定决策

| 项 | 选择 |
|----|------|
| 人机形态 | 缺口拼图滑块（非积木、非「拖到底」纯进度条） |
| 视频素材 | 公开可商用库存片，5 类各一段，后续可替换 |
| 实现路径 | 方案 A：自研缺口图 + 现有 ticket 门控 |
| 触发时机 | 仍为点「发送验证码」前 |

## 架构

```
LoginDialog（全屏壳，不变）
  ├─ LoginVideoPanel  → 5 视频 crossfade + 主题署名
  ├─ LoginFormPanel   → 不变
  └─ SliderCaptchaOverlay（替换 BlockCaptchaOverlay）
        ↕
   auth store
        ↕
   POST /auth/captcha/challenge  （缺口题面）
   POST /auth/captcha/verify     （提交滑块 x）
   POST /auth/send-code          （captchaTicket，模式不变）
```

删除或停用积木相关前端组件与后端 placements 校验路径；类型改为滑块挑战。

## 缺口滑块交互

1. 打开层 → `challenge` → 展示底图（带缺口）+ 可拖拼图块 + 底部轨道滑块。  
2. 拖动轨道滑块时，拼图块水平跟随；松手判定 `|offsetX - targetX| ≤ tolerance`（建议 **5px**）。  
3. 成功：短暂高亮 → `verify` 得 ticket → 关层 → `send-code`。  
4. 失败：拼图块与滑块弹回起点，文案「再试一次」；可「换一题」。  
5. 关闭验证层不发短信；Esc 先关验证层，再关登录壳。

文案：「拖动滑块完成验证」；辅助：「将滑块拖动到正确位置」。

### 服务端出题（建议）

- `createChallenge()`：从服务端内置底图池（或程序生成简单纹理图）切出：
  - `bgImage`：带缺口的底图（data URL 或 `/auth/captcha/...` 短时资源）
  - `pieceImage`：滑块拼图块
  - `challengeId`、`targetX`（仅存服务端 Map，**不下发明文 targetX**；或下发加密字段，verify 时服务端解密）
  - `puzzle`：`{ width, height, pieceSize, y }` 布局元数据
- `verify({ challengeId, offsetX })`：与存档 `targetX` 比较容差 → 签发 `captchaTicket`（仍 `cpt_` + HMAC + 一次性 consume）。

**安全预期（诚实）：** 自研缺口仍可被脚本分析图像绕过；继续依赖 soft→strict 与短信侧限流，真扛刷再换商业滑块。

### API 形状（相对积木版的变更）

```ts
// challenge response data
{
  challengeId: string
  bgImage: string      // data URL or path
  pieceImage: string
  puzzle: { width: number; height: number; pieceSize: number; y: number }
}

// verify request
{ challengeId: string; offsetX: number }

// verify response — 不变
{ captchaTicket: string; expiresAt: string }
```

移除 `blocks` / `slots` / `placements`。前端 `captcha-types.ts` 与 `BlockCaptchaOverlay.vue` 改为 `SliderCaptchaOverlay.vue`（或原地重写并改名）。

## 五主题视频轮播

| # | 主题标签 | 视觉近似方向 |
|---|---------|--------------|
| 1 | 运镜 | 一镜到底、连续运动镜头 |
| 2 | 科幻 | 好莱坞科幻氛围 |
| 3 | 电商 | 带货/商品展示节奏 |
| 4 | 护肤 | 护肤品广告 TVC 质感 |
| 5 | 微观 | 宏观到微观下钻 / 空间感 |

- 文件：`apps/web/public/auth/login-loop-01.mp4` … `05.mp4`（或等价命名）+ 更新 `LICENSE.md`（每段来源、许可、下载日）。  
- `LoginVideoPanel`：静音、`playsinline`、`autoplay`；当前片 `ended` 或定时切下一段；crossfade（约 0.5–0.8s）；`prefers-reduced-motion` 时固定第一段或静帧。  
- 底部署名随主题切换（如「超创 · 运镜」）。  
- 加载失败：该段跳过或静帧海报，不挡右栏登录。

## 错误处理

| 场景 | 处理 |
|------|------|
| challenge 失败 | 「验证加载失败，请重试」 |
| 对齐失败 | 弹回 + 「再试一次」 |
| verify 失败 | 同失败；可换一题 |
| ticket 过期后再发码 | 重新开滑块层 |
| 视频失败 | 跳过/海报，表单可用 |

## 测试要点

- 非法手机号打不开滑块层。  
- 关层不发短信；对齐成功后 `send-code` 带 ticket。  
- `off` / `soft` / `strict` 行为与现网一致。  
- Esc 分层关闭。  
- 5 段视频轮播与署名切换；窄屏抽屉滑块可用。  
- 积木 API/UI 不再被调用。

## 主要改动文件（预期）

- `apps/server/src/auth/captcha.types.ts` / `captcha.service.ts` / tests / controller DTO  
- `apps/web/src/components/auth/BlockCaptchaOverlay.vue` → `SliderCaptchaOverlay.vue`（重命名或替换）  
- `apps/web/src/components/auth/LoginDialog.vue`、`captcha-types.ts`、`LoginVideoPanel.vue`  
- `apps/web/public/auth/*` 五视频 + LICENSE  
- 规格/计划文档更新

## 风险

- 库存片主题仅为近似，成片替换时只换文件与 LICENSE。  
- 出题实现：**优先预切静态题库**（多组 `bg` + `piece` + 服务端存 `targetX`），避免新增 `canvas`/`sharp` 依赖；题库放 `apps/server` 资源或 `public/auth/captcha/`（targetX 仅服务端）。
