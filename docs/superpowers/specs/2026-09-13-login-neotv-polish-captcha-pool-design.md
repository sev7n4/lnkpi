# 登录页 Neo-TV 视觉精修 + 题库切图滑块设计

日期：2026-09-13  
状态：待实现  
范围：登录全屏壳视觉对齐 neo-tv；左栏视频可播 + 左侧圆点切换；滑块改为服务端题库随机底图切缺口（≥3 形、≤10 图）；布局 65%/35%。

## 背景

#298 已上线缺口滑块 + 五主题视频，但：

1. 滑块题面为纯色紫蓝 SVG，整卡观感廉价。
2. 左栏视频自动播放不可靠，交互缺少 neo-tv 式圆点切换。
3. 左右分割约 55%/45%，视频沉浸感不足。

参考：[neowow.cn/neo-tv](https://neowow.cn/neo-tv)（深色、玻璃、主内容权重）；方案 A 视觉预览已获方向认可。

## 目标

1. 桌面登录：**左视频 65% / 右表单 35%**；移动端仍上视频下表单。
2. 左栏：视频可靠静音自动播放；**左侧竖排圆点**可手动切换主题；底部署名。
3. 滑块：服务端 **≤10 张内置底图**随机选题；**≥3 种缺口形状**随机；切图生成 `bgImage` + `pieceImage`；`targetX` 仅存服务端；容差 5px；不依赖外网。
4. 滑块浮层 UI：深色玻璃、浅色手柄、无整卡紫底（对齐方案 A 预览）。

## 非目标

- 接入商业验证码 SDK。
- 把登录页改造成完整 neo-tv 首页（侧栏 + 作品网格）。
- 外网随机图 / CDN 热链出题。
- 改变 `AUTH_CAPTCHA_MODE` / ticket 门控语义。

## 已锁定决策

| 项 | 选择 |
|----|------|
| 布局比例 | 桌面视频 **65%** / 表单 **35%** |
| 视频交互 | 自动轮播 + **左侧竖向圆点**手动切换 |
| 出题素材 | 服务端题库切图，**≤10** 张，不依赖外网 |
| 缺口形状 | **≥3** 种（如圆角方、圆形、拼图榫） |
| 滑块 UI | 方案 A：深色玻璃 + 电影感题面 + 浅色手柄 |
| 切图实现 | 优先用已有依赖 **`sharp`** 在服务端合成 PNG/WebP data URL |

## 架构

```
LoginDialog（65/35 壳）
  ├─ LoginVideoPanel  → 可靠 autoplay + 左侧 dots + 署名
  ├─ LoginFormPanel   → 布局微调，逻辑不变
  └─ SliderCaptchaOverlay（方案 A UI）
        ↕
   CaptchaService
     assets/captcha/bg-01…N.(jpg|png)  ≤10
     shapes: rect | circle | puzzle（≥3）
     createChallenge → 随机图 + 随机形 + 随机 targetX/y
     verifySlide(challengeId, offsetX)
```

公开 API 形状相对 #298 **可扩展、不破坏**：

```ts
// challenge response
{
  challengeId: string
  bgImage: string      // data:image/png;base64,... 或 webp
  pieceImage: string
  puzzle: {
    width: number
    height: number
    pieceSize: number
    y: number
    shape?: 'rect' | 'circle' | 'puzzle'  // 可选，供前端样式对齐
  }
}
// verify 仍为 { challengeId, offsetX }
```

`targetX`、所选底图 id、形状参数 **不下发**。

## 出题细节

### 底图池

- 路径建议：`apps/server/assets/captcha/`（或 `apps/server/src/auth/captcha/assets/`）。
- 数量 **1–10**；启动时扫描目录；少于 1 张则回退到现有程序化纹理（保底不挂）。
- 授权：公开可商用静帧，仓库内附 `LICENSE.md`（来源、许可、下载日）。
- 视觉：偏暗、电影感，适配登录深色壳（避免高饱和紫块）。

### 形状（至少 3）

| id | 描述 |
|----|------|
| `rect` | 圆角矩形缺口 |
| `circle` | 圆形缺口 |
| `puzzle` | 一侧带榫头的拼图块（简化极验形） |

出题时均匀随机一种；`pieceImage` 与底图缺口蒙版一致。

### 切图流程（sharp）

1. 读入底图 → resize 到 puzzle 画布（建议 280×160）。
2. 随机 `targetX ∈ [pieceSize, width-2*pieceSize]`，`y` 在安全区内。
3. 用 SVG/路径 mask 抠缺口：底图挖空 → `bgImage`；裁出拼图块 → `pieceImage`。
4. 内部 Map 存 `{ targetX, puzzle, expires }`；公开响应不含 `targetX`。
5. `verifySlide`：`|offsetX-targetX|≤5` 签发 ticket；失败保留 challenge。

### 前端滑块 UI

- 复用方案 A：玻璃浮层、细边框、浅色 thumb、辅助文案不变。
- `img` 展示 `bgImage`/`pieceImage`；piece 跟随轨道 `offsetX`。
- 形状若下发 `puzzle.shape`，仅影响阴影/圆角微调（非必须）。

## 视频面板

- 属性：`autoplay muted playsinline` + `loadeddata`/`canplay` 后再 `play()`；失败吞错并保留海报。
- **左侧竖排 5 圆点**：当前加亮/加长；点击切到对应 clip 并立即播放；与自动轮播共用索引。
- 桌面左栏：`width: 65%`（或 `flex: 0 0 65%`）；右栏 `35%`。
- 可选：轻微 inset + 大圆角以贴近 neo-tv 主内容卡片感（不挡点击）。

## 错误与模式

| 场景 | 处理 |
|------|------|
| 题库缺失 | 程序化暗色纹理回退 |
| sharp 失败 | 回退或返回可重试错误文案 |
| 视频 play 失败 | 海报 + 圆点仍可切换重试 |
| soft/strict/off | 不变 |

## 测试要点

- `createChallenge` 连续多次 → 底图/形状有变化；响应无 `targetX`。
- 三种 shape 均可 `verifySlide` 在容差内过、容差外失败可重试。
- 前端：65/35 布局；圆点切换更新署名与播放源；滑块展示非纯色题面。
- 无外网请求用于出题素材。

## 主要改动文件（预期）

- `apps/server/src/auth/captcha.service.ts` / types / tests  
- `apps/server/assets/captcha/*` + `LICENSE.md`  
- `apps/web/src/components/auth/SliderCaptchaOverlay.vue`  
- `apps/web/src/components/auth/LoginVideoPanel.vue`  
- `apps/web/src/components/auth/LoginDialog.vue`  
- 本规格 + 实现计划

## 风险

- sharp 冷启动/内存：题面小图，可接受；注意并发下短时缓冲。
- 拼图榫路径复杂度：首版简化轮廓即可，后续可增形。
- 视频仍受浏览器自动播放策略约束：muted + playsinline 为底线。

## 视觉参考

- 方案 A 交互预览：`.superpowers/previews/slider-captcha-scheme-a.html`
- 生成稿：`login-slider-captcha-scheme-a-mock.png`（会话资产）
