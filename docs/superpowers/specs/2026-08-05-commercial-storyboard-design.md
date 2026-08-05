# 商业品牌分镜提示词模版 — 产品与设计规格

> **状态**：P0 开发中  
> **日期**：2026-08-05  
> **关联**：[2026-07-17-prompt-node-intent-templates-design.md](./2026-07-17-prompt-node-intent-templates-design.md)、[2026-08-03-atomic-studio-intent-design.md](./2026-08-03-atomic-studio-intent-design.md)、PR #139（凡含「提示词」→ prompt 节点）

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.0 |
| 文档定位 | 商业/TVC/品牌广告分镜 promptMode 的行为、路由、四模块模版、验收标准 |
| 实现代码 | `packages/agent/src/prompt-modes/modes/commercial-storyboard*.ts` |

### 已确认决策（2026-08-05）

| # | 决策 | 说明 |
|---|------|------|
| **C1** | 新增独立 `promptMode: commercial_storyboard` | 与普通 `storyboard`（叙事/追逐场景分镜）分离 |
| **C2** | 四模块结构写入 system prompt | 战略输入层 + 自适应规则库 + 强制表格 + 质量校验锁 |
| **C3** | 三种节奏模型按时长自动映射 | ≤15s 闪电切割 / ≈30s AIDA / ≥60s 沉浸移情 |
| **C4** | 问界/AITO 参数内置 presets | Agent 引用 M9/M8/M6/M7 真实规格，禁止编造 |
| **C5** | 三组 few-shot 金样例 | 15s 问界M6 / 30s 问界M9 / 60s 问界M9 |
| **C6** | 含「提示词」→ prompt 节点 | 与 PR #139 一致；商业分镜句含「提示词」仍走 prompt-only |

---

## 一、问题陈述

### 1.1 现状

用户要「商业分镜 / TVC / 品牌广告 / 问界汽车 15 秒抖音片」时，现有 `storyboard` 模式偏叙事场景描述，缺少：

| 缺口 | 影响 |
|------|------|
| 无商业策略对齐 | Agent 直接「翻译画面」，为拍而拍 |
| 无时长→节奏映射 | 15 秒与 60 秒输出密度相同，短视频无效 |
| 无品类视觉语法 | 汽车/美妆/科技镜头语言混用 |
| 无可拍摄性校验 | 输出情绪形容词，导演无法执行 |
| 无品牌落版规范 | 结尾旁白与 Logo 争抢注意力 |

### 1.2 用户预期

> 说「问界 M9 30 秒商业分镜提示词」→ 得到**策略上下文 + 规则映射 + 完整分镜表格 + 质量校验锁**，表格可直接交给导演/剪辑，而非散文式画面描述。

### 1.3 与普通分镜的边界

| 维度 | `storyboard` | `commercial_storyboard` |
|------|--------------|---------------------------|
| 典型输入 | 蓝牙耳机追逐场景分镜 | 问界 M9 TVC 30 秒商业分镜 |
| 输出结构 | 场景/镜头叙事 | 四模块 + 8 列商业表格 |
| 核心逻辑 | 戏剧动作 | 卖货 USP + 节奏模型 |
| 路由关键词 | 仅「分镜」 | 商业分镜/TVC/问界/AITO/15秒30秒60秒… |

---

## 二、产品目标

| ID | 目标 |
|----|------|
| **G1** | Agent 先完成商业策略推理，再输出分镜表 |
| **G2** | 按时长自动选用闪电/AIDA/沉浸三种节奏模型 |
| **G3** | 按品类注入视觉语法（视角/运镜/光影） |
| **G4** | 输出前通过质量校验锁自检 |
| **G5** | 问界等汽车品牌引用内置参数库，不 hallucinate 规格 |

### 非目标（P0）

- 自动生成分镜图/视频（仍仅 prompt 文本）
- 覆盖所有行业细分类（P1 扩展 `VISUAL_GRAMMAR_BY_CATEGORY`）
- 替代专业广告公司的创意策略（模版保证结构，不保证创意唯一性）

---

## 三、四模块模版架构

### 3.1 模块一：战略输入层

Agent 输出前必须完成（可简要展示「商业策略上下文」）：

- 产品/服务品类
- 核心卖点 USP（1 个，「通过 X，帮你在 Y 场景下实现 Z」）
- 目标受众（年龄 + 职业 + 核心焦虑）
- 播放平台与时长
- 营销战役阶段

### 3.2 模块二：自适应规则库（内部映射，摘要输出）

#### A. 节奏模型

| 模型 | 时长 | 镜长 | 产品露出 | 平台 |
|------|------|------|----------|------|
| 闪电切割 | ≤15s | 1.0–1.5s | 前 3 秒 / 第 2 镜 | 抖音/信息流 |
| AIDA 叙事 | ≈30s | 2.5–3.5s | 前 30% 实体出现 | 官网/发布会 |
| 沉浸移情 | ≥60s | 4–5s | 前 10s 仅空镜 | TVC/品牌周年 |

#### B. 视觉语法（品类 → 强制约束）

| 品类 | 视角 | 运镜 | 光影 |
|------|------|------|------|
| 科技数码 | 俯视 45°+微距 | 滑轨横移 | 冷蓝+侧逆光 |
| 美妆快消 | 平视+产品旋转 | 手持微推 | 柔光+高饱和 |
| 汽车重工 | 低角度+大广角 | 航拍跟甩 | 黑金+高对比 |
| 高端金融 | 对称+中景 | 完全固定 | 暖黄+光影切割 |
| **智能汽车** | 低角度+车内主观 | 滑轨+航拍 | 黑金/冷蓝+光塑曲面 |

#### C. 声音品牌化

- 结尾 3 秒纯视觉落版（Logo + Slogan + Mnemonic），禁止旁白
- 有旁白时 BGM 中频挖孔

### 3.3 模块三：强制分镜输出格式

固定 8 列表头：

```
| 序号 | 时长(秒) | 景别与视角 | 画面内容 | 镜头运动 | 营销文案(旁白/大字) | 声音设计 | 剪辑节奏 |
```

**强制规范**：

1. 景别仅限：极远景 / 全景 / 中景 / 近景 / 特写 / 微距
2. 景别与视角：`[景别]+[角度]`
3. 画面内容：`[主体动作]+[构图位置]+[光影色调]`，禁止情绪形容词
4. 镜数：15s 约 8–10 镜；30s 约 8–10 镜；60s 约 10–12 镜

### 3.4 模块四：质量校验锁

输出末尾逐条 `[x]`：

1. 开头 3 秒是否有冲突/痛点/反差
2. 前 30% 时长产品是否实体出现
3. 屏幕大字每行 ≤5 字、对比度足够
4. 旁白时 BGM 挖孔；落版时绝对安静
5. 运镜物理可行或有固定机位替代方案

---

## 四、路由规则（AC-R）

### 4.1 路由表

| ID | 用户说法示例 | promptMode | 节点 |
|----|-------------|------------|------|
| **R1** | 问界 M9 30 秒商业分镜提示词 | `commercial_storyboard` | prompt |
| **R2** | AITO 15 秒抖音前贴片 TVC 分镜 | `commercial_storyboard` | prompt |
| **R3** | 品牌形象片 60 秒分镜 | `commercial_storyboard` | prompt |
| **R4** | 蓝牙耳机追逐场景分镜提示词 | `storyboard` | prompt |
| **R5** | …三视图提示词 | `character_turnaround` | prompt |

### 4.2 分类 heuristic（`classify.ts`）

优先级：

1. 含「提示词」→ 走 prompt 节点（PR #139）
2. 多视图触发词 → `character_turnaround`
3. 商业分镜触发词 → `commercial_storyboard`
4. 含「分镜」→ `storyboard`

商业触发词：

```
商业分镜|品牌分镜|品牌广告|营销战役|TVC|问界|AITO|汽车广告|
15秒|30秒|60秒|抖音前贴|发布会暖场|品牌形象片|闪电切割|AIDA
```

---

## 五、问界/AITO 内置参数库

| 车型 | USP 摘要 | 关键参数 |
|------|----------|----------|
| M9 Ultimate 领世加长版 | 六激光雷达 + ADS 5.0 + 移动影院 | 5402mm 车长，750km CLTC，32 英寸投影巨幕 |
| M8 改款 | M9 同款智驾 + 800V | 5190mm，75kWh，3105mm 轴距 |
| M6 纯电 Max+ | 760km 长续航 + ADS 3.0 | 100kWh，风阻 0.239，896 线激光雷达 |
| M7 增程长续航版 | 1690km 综合续航 | 327km 纯电，192 线激光雷达 |

数据来源：2025–2026 公开上市信息；分镜引用时以 presets 为准，LLM 不得编造未列参数。

---

## 六、Few-shot 金样例

| # | 节奏 | 产品 | 镜数 | presets 常量 |
|---|------|------|------|-------------|
| 1 | 闪电切割 15s | 问界 M6 Max+ | 8 | `COMMERCIAL_STORYBOARD_LIGHTNING_EXAMPLE` |
| 2 | AIDA 30s | 问界 M9 | 9 | `COMMERCIAL_STORYBOARD_PRIMARY_EXAMPLE` |
| 3 | 沉浸移情 60s | 问界 M9 Ultimate | 12 | `COMMERCIAL_STORYBOARD_IMMERSIVE_EXAMPLE` |

`generate.ts` 支持 `fewShots[]` 多轮对话注入，按 15s → 30s → 60s 顺序。

---

## 七、验收标准（AC）

| ID | 验收项 | 通过条件 |
|----|--------|----------|
| **AC-1** | 分类 | 「问界 30 秒商业分镜提示词」→ `commercial_storyboard` |
| **AC-2** | 边界 | 「蓝牙耳机分镜提示词」→ `storyboard`（非 commercial） |
| **AC-3** | 输出结构 | 含四节标题 + Markdown 表格 + 校验锁 |
| **AC-4** | 表格规范 | 景别仅用六种标准术语；画面内容为物理事实 |
| **AC-5** | 节奏 | 15s 请求镜长约 1.5s；60s 前 10s 无产品特写 |
| **AC-6** | 参数 | 问界相关输出引用 M9/M6 等 presets 参数，无虚构续航 |
| **AC-7** | 单元测试 | `classify.test.ts` + `commercial-storyboard-presets.test.ts` 全绿 |
| **AC-8** | 构建 | `pnpm --filter @lnkpi/agent build` 通过 |

---

## 八、实现清单

| 文件 | 变更 |
|------|------|
| `commercial-storyboard-presets.ts` | 规则库 + 问界参数 + 三组 few-shot |
| `commercial-storyboard.ts` | system + fewShots 绑定 |
| `classify.ts` | 商业分镜 heuristic |
| `types.ts` | 新增 `commercial_storyboard` + 可选 `fewShots` |
| `generate.ts` | 多 few-shot messages 注入 |
| `registry.ts` | 注册新模式 |
| `commercial_storyboard_presets.py` | Python 侧常量同步 |

---

## 九、与现有系统关系

```
用户 utterance
  ├─ 含「提示词」→ prompt 节点 → classifyPromptMode → generatePromptContent
  │     ├─ commercial_storyboard（本规格）
  │     ├─ storyboard
  │     └─ character_turnaround / …
  └─ 多视图无「提示词」→ turnaround_image pipeline（见 turnaround 规格）
```

本规格**不修改** image 直出、turnaround 二段式出图链路。
