# Prompt 节点：意图路由 + 多模式模板生成（设计文档）

> 状态：第一～三节已定稿，待全文确认后 commit  
> 日期：2026-07-17  
> 范围：画布 `prompt` 节点（非 `text` 节点）  
> 竞品参考：neowow `/workflow` 文本生成（`POST /agent/story-canvas/generate-text`，`data.result` 与输入分离，双击打开 MarkdownEditor）

## 决策摘要

| 项 | 选择 |
|---|---|
| 作用节点 | **B**：现有 `prompt` 节点专门承载 |
| 结果形态 | **A**：长文 Markdown（快速对齐竞品多风格长文观感） |
| 数据分离 | **A**：用户短需求与生成结果分字段存储 |
| 能力范围 | **P2**：意图路由 + 4～6 个模式模板 |
| 实现路径 | **方案 2**：两段式（分类 → 模式模板生成），专用生成接口 |
| 展开 UI | **C3**：TipTap Markdown 编辑弹窗（可编辑 + 复制 + 工具栏 + **语音输入**）；节点尺寸第一期固定 |
| 节点 resize | **迭代 B**（第一期不做拖拽放大） |
| 语音输入 | **Dock Studio 全覆盖 + Markdown 弹窗均需**；图标紧贴提交/生成按钮 |
| 积分 / 超时 | **对齐文本生成**：5 点 / 前端超时 90s |
| 意图分类 | **第一期纯 LLM 分类**；规则预筛延后到迭代期（见 §2.8） |

---

## 第一节：范围与节点行为

### 1.1 目标

用户在 `prompt` 节点输入短需求后点击生成，系统先识别创作意图，再按对应模式的最佳实践模板调用 LLM，产出**可读的 Markdown 长文**（如多风格绘画提示词、三视图提示词、分镜表、剧本草案等）。双击节点可展开查看完整内容。

### 1.2 非目标（第一期不做）

- 不改造 `text` 节点的文案生成链路（`/studio/text/generate` 保持现状）
- 不做结构化 `styles[]` 卡片点选与一键灌入下游图片节点（留给后续 C 形态）
- 不接入作品知识库 / RAG（如「万物生」深度资料检索）
- 不把生成主路径绑到 Agent 画布对话（`/agent/chat/conversation`）
- **不做节点 resize handle**（迭代 B；长文阅读靠双击 TipTap 弹窗）
- 不做规则预筛跳过 Call-1（见 §2.8）

### 1.3 数据模型（节点 `data`）

| 字段 | 含义 | 编辑方式 |
|---|---|---|
| `prompt` | 用户短需求（输入区内容） | Dock 输入；生成前后均保留 |
| `content` | 生成后的 Markdown 长文 | 由生成接口写入；双击展开查看 |
| `promptMode` | 最近一次识别到的模式 id | 后端写入；可选 UI 展示 |
| `textModel` | 选用的文本模型 | Dock 模型选择器 |
| `status` | `idle` / `generating` / `completed` / `error` | 生成流程维护 |
| `errorMessage` | 失败信息 | 失败时写入 |

约定：

- **禁止**在输入过程中把 `content` 与 `prompt` 同步成同一字符串（避免与现有 `TextDockPanel` 行为混淆）。
- 生成前可乐观将 `status=generating`，**不要**用 `prompt` 覆盖已有 `content`（保留上一次结果直到新结果返回）。
- 上游消费（连到 image/audio 等）第一期：优先使用 `content`（有则用之），否则回退 `prompt`。后续 C 形态再支持「选用某一风格段落」。

### 1.4 Dock Studio 行为

- `prompt` 节点不再走仅「应用/保存」的 Legacy 工具条语义。
- 主按钮文案：**生成提示词**（生成中禁用）。
- 输入区 placeholder：引导短需求，例如「描述你想要的提示词目标，如：车模展会美女模特 / 人物三视图 / 分镜…」。
- 支持文本模型选择（复用现有 UniversalModelSelector / text 配置）。
- 可选：生成完成后在 Dock 或节点角标展示 `promptMode` 中文名（便于用户理解「系统按哪种模式生成的」）。

### 1.5 节点卡片与双击展开（对齐竞品）

竞品 `TextGenerationNode` 实测行为（neowow WorkflowCanvas 逆向）：

- 占位文案：「输入提示词生成文本」+「双击编辑文本」
- 结果在节点内 Markdown 渲染；节点右下角有 **resize handle** 可拖大
- **双击**内容区 / 占位区 → `visible=true` 打开 **`MarkdownEditor`**（`Teleport` 到 `body`）
- 弹窗能力：TipTap Markdown 编辑、标题/加粗/列表工具栏、复制、关闭；编辑防抖后 `save` 写回 `data.result`
- 支持语音插入（本项目**第一期同步实现**，见 §1.8）

本项目 `prompt` 节点对齐目标（**C3**：弹窗 TipTap 优先，节点尺寸固定）：

| 状态 | 卡片展示 |
|---|---|
| 无 `content` | 占位：「输入需求生成提示词」+ 次行提示「双击编辑文本」；若有 `prompt` 可一行截断预览需求 |
| 有 `content` | 固定尺寸卡片内 Markdown 截断预览（约 120～200 字或卡片高度内滚动）；完整阅读靠双击弹窗 |
| generating | 与现有节点生成中态一致 |
| error | 显示错误摘要，保留旧 `content`（若有） |

**双击节点内容区**（非标题重命名区域）：

1. 打开 `PromptMarkdownEditor` 弹窗（Teleport + modal-fade，视觉贴近竞品深色大编辑器）。
2. **实现选型：TipTap**（含 Markdown 扩展），所见即所得；工具栏至少：复制、H1/H2/H3、加粗、斜体、列表、分割线、关闭。
3. **语音输入**：弹窗内具备麦克风按钮，录音结果插入光标处（对齐竞品 MarkdownEditor + VoiceInput）。
4. 初始内容 = 当前 `content`（无则空，可手写）。
5. 保存策略对齐竞品：编辑变更防抖写回 `content`，关闭时再 flush 一次；**不**改写 `prompt`（用户短需求仍在 Dock）。
6. 关闭后不触发重新生成。
7. 第一期不做节点右下角 resize（迭代 B）。

说明：标题双击重命名（`NeoBaseNode` 已有）与内容双击展开需事件隔离（`stop`），避免冲突。

### 1.8 语音输入（Dock + Markdown，第一期必做）

#### 覆盖范围

| 表面 | 是否要语音 | 写入目标 |
|---|---|---|
| 所有 Dock Studio 面板（含新建的 `PromptDockPanel`，以及现有 text/image/video/audio/shot 等） | **要** | 当前面板的主输入（prompt / content 等） |
| `PromptMarkdownEditor`（TipTap 弹窗） | **要** | 插入到编辑器光标位置；最终仍落在节点 `content` |

复用现有 `useSpeechRecognition`；行为与现有面板一致：听写中图标脉冲/变红，最终结果追加或插入文本。

#### 图标摆放（统一规范）

**语音图标必须紧贴「提交/生成」主按钮**，不要夹在模型选择、字数、优化提示词等次要控件中间。

推荐底栏从左到右（可换行）：

```text
[模型选择] [优化等次要操作] …弹性空白… [🎤 语音] [生成/提交主按钮]
```

具象例子（`PromptDockPanel`）：

```text
[文本模型 ▾] [优化提示词]  12字          [🎤] [生成提示词]
                                         ↑紧邻↑
```

错误摆放（避免）：

```text
[🎤] [文本模型 ▾] [优化] … [生成提示词]   ← 语音离提交太远
[文本模型] [🎤] [优化] [字数] [生成提示词] ← 语音被次要控件隔开
```

Markdown 弹窗工具栏：

```text
[复制] [H1][H2][H3] … [B][I][列表] …弹性空白… [🎤 语音] [关闭]
```

或底部操作条：`[🎤]` 紧挨主操作区右侧关闭/完成按钮左侧——以「用户点完语音后立刻能点关闭/保存」为原则，**语音与主操作成对出现**。

#### 实现注意

- `PromptDockPanel` 新建时按上述规范放置，勿照搬 Legacy「应用」条的旧布局若其语音位置不合规。
- 现有 Dock 面板（Text/Image/Video/Audio/Shot 等）若语音未紧贴生成按钮，**同期调整**到规范位置（小改布局，不改听写逻辑）。
- 生成中 / 只读态：语音按钮 `disabled`，与生成按钮一致。

### 1.6 第一期模式清单（6 个）

| `promptMode` | 中文名 | 典型用户说法 | 输出侧重 |
|---|---|---|---|
| `image_prompt_multi_style` | 多风格绘画提示词 | 「车模展会美女模特…」 | 多组风格：中文描述 + EN Prompt + 使用建议 |
| `character_turnaround` | 人物三视图 | 「生成包含人物三视图的提示词」 | 正/侧/背一致性约束 + 可生图 Prompt |
| `storyboard` | 分镜提示词 | 「帮我生成一个分镜提示词」 | 镜号、景别、运镜、动作、中英 Prompt |
| `script` | 剧本 | 「按××人生观生成相似剧本」 | 主题、人物、冲突、分场/对白草案 |
| `copywriting` | 文案/旁白 | 「写一段品牌旁白」 | 可直接使用的文案结构 |
| `generic` | 通用创作 | 无法归类时 | 澄清意图式的结构化创作回复 |

### 1.7 成功标准（第一节）

- 短需求生成后，`prompt` 仍为原文，`content` 为明显更长的专业 Markdown，而非原文回显。
- 「车模」类需求稳定落到 `image_prompt_multi_style`，观感接近竞品多风格长文。
- 「三视图 / 分镜 / 剧本」类需求分别落到对应模式，而非一律绘画多风格。
- 双击打开 TipTap Markdown 编辑弹窗，可阅读/编辑/语音插入/复制完整 `content`（对齐竞品交互）。
- Dock Studio（含 Prompt）与 Markdown 弹窗均有语音输入，且 🎤 紧贴提交/生成按钮。

---

## 第二节：后端路由、模式模板与 API

### 2.1 总体链路

```text
前端 prompt 节点「生成提示词」
  → POST /studio/prompt/generate  { prompt, model? }
  → PromptGenerationService
       ① classify(prompt) → promptMode
       ② buildMessages(mode, prompt)  // system + few-shot + user
       ③ LLM chat/completions
       ④ 落 GenerationRecord + 返回 { mode, content, record }
  → 前端 patch: { content, promptMode, status }
```

说明：

- 与现有 `POST /studio/text/generate`（文本节点文案）**并行存在**，不复用同一 system prompt。
- 不走 `/agent/chat/conversation`（避免画布 Agent tool-calling 耦合）。
- Provider 复用 `@lnkpi/agent` 的 OpenAI 兼容调用能力，或在 `packages/agent` 新增 `PromptModeProvider`；无 `OPENAI_API_KEY` 时返回**按模式区分的 Placeholder 长文**（禁止原样 echo `prompt`）。

### 2.2 两段式调用

#### Call-1：意图分类（短、稳）

- 输入：用户 `prompt`（可截断至前 N 字，如 500）。
- 输出：严格 JSON，例如 `{"mode":"storyboard","confidence":0.82}`。
- System：只允许从 6 个 mode id 中选择；给每类 1～2 句判别标准 + 边界例子。
- 失败/解析失败/低置信度（如 `<0.5`）：回退 `generic`。
- **第一期不做规则预筛跳过 Call-1**（决策见 §2.8）；分类始终走 LLM（无 Key 时用轻量规则仅用于 Placeholder 选 mode，见下）。

#### Call-2：模式生成（长、质）

- 按 `promptMode` 从**模式注册表**取：
  - `system`：角色 + 输出骨架（Markdown 标题结构）+ 质量 checklist + 禁区
  - `fewShots`：1 个金样例（教格式，不背答案）
  - `userWrapper`：把用户短需求包进「请基于以下需求生成…」
- `temperature`：创作类可 0.7～0.9；分类 Call-1 用 0～0.2。
- 输出：纯 Markdown 字符串写入 `content`（不要包一层 JSON）。

### 2.3 模式注册表（逻辑结构）

建议位置：`packages/agent/src/prompt-modes/`（或 `apps/server/src/studio/prompt-modes/`），每个 mode 一文件 + `index` 导出注册表，便于后续迭代文案而不改控制器。

每个 mode 至少包含：

| 字段 | 用途 |
|---|---|
| `id` | 与 `promptMode` 一致 |
| `label` | 中文名 |
| `classifyHints` | 给 Call-1 的判别句子 |
| `system` | Call-2 系统提示（最佳实践本体） |
| `fewShot` | 输入→输出示例一对 |
| `placeholder` | 无 Key 时的本地样例长文 |

**质量原则（写入各 mode 的 system）：**

- `image_prompt_multi_style`：至少 3 种风格差异；每组含中文描述 + EN Prompt；附负面词/参数建议；禁止只复述用户原句。
- `character_turnaround`：强制同一角色锁定；正/侧/背；白底或干净背景；一致性关键词；禁止每视图换装换脸。
- `storyboard`：镜号序列；景别/机位/运镜/动作；每镜可生图 Prompt；禁止只有形容词堆砌。
- `script`：主题解读→人物→冲突→分场；允许声明「未检索原著时基于常识近似」；禁止伪引用大段「原著原文」。
- `copywriting`：目标受众、语气、版本（短/长）；可直接口播。
- `generic`：先用小节结构给出最可能有用的创作物，并提示用户可改写需求以命中更专模式。

### 2.4 API 契约（草案）

`POST /api/studio/prompt/generate`

请求：

```json
{
  "prompt": "帮我生成一个包含人物三视图的提示词",
  "model": "gpt-4o"
}
```

响应：

```json
{
  "data": {
    "id": "generation-record-id",
    "type": "prompt",
    "prompt": "帮我生成一个包含人物三视图的提示词",
    "model": "gpt-4o",
    "status": "completed",
    "metadata": {
      "mode": "character_turnaround",
      "content": "### 人物三视图提示词\n\n..."
    }
  }
}
```

前端解析：`content = metadata.content`，`promptMode = metadata.mode`。

积分 / 超时（已定）：

- **积分：5 点**，账本备注「提示词模式生成」（与 `studio.generateText` 的 5 点对齐，充分借鉴现有文本生成计费）。
- **前端超时：90s**（与 `studioApi.generateText` 一致）。
- 说明：第一期虽可能两次 LLM，仍先对齐 5 点降低产品摩擦；若线上成本明显偏高，迭代期再调价或合并为单次带 tool 的调用。

### 2.5 错误处理

| 情况 | 行为 |
|---|---|
| 未登录 | 前端 `requireLogin`，不发请求 |
| 空 prompt | 前端禁用按钮；后端 400 |
| 无 API Key | 用轻量关键词规则或 `generic` 选 mode → Placeholder 长文，`completed`，文内标注「草案/需配置密钥」 |
| Call-1 失败 | 回退 `generic` 继续 Call-2 |
| Call-2 失败 | `status=error`，保留旧 `content`，写入 `errorMessage` |
| 超时 | 前端 90s；失败提示，保留旧 `content` |

### 2.6 与竞品差异（有意为之）

| 点 | 竞品 neowow | 本设计 |
|---|---|---|
| 节点类型 | `text` 文本生成 | 本项目 `prompt` 节点 |
| 接口 | `/agent/story-canvas/generate-text` 异步 task | 第一期同步 `/studio/prompt/generate`（足够简单；过慢再改轮询） |
| 结果字段 | `data.result` | `data.content` + `metadata.content`（与画布现有 content 习惯对齐） |
| 双击 | `MarkdownEditor` 弹窗可编辑 | **对齐**：同交互形态的 Markdown 编辑弹窗 |
| 智能 | 偏通用文本模型 | **显式意图路由 + 模式最佳实践包** |

### 2.7 第二节确认结论

| 问题 | 结论 |
|---|---|
| 展开 UI | **对齐竞品 MarkdownEditor 弹窗**（可编辑+复制+工具栏），不是只读 Dialog / 不是纯节点内放大 |
| 积分 / 超时 | **5 点 / 90s**，对齐文本生成 |
| 规则预筛 | **第一期不做**；见 §2.8 |

### 2.8 意图分类：规则预筛 vs 纯 LLM（决策与迭代路径）

#### 鉴定

| 维度 | 纯 LLM 分类（Call-1） | 规则预筛跳过 Call-1 |
|---|---|---|
| 覆盖「千人千面」 | 高：能处理「按万物生人生观写剧本」这类无强关键词 | 低：依赖显式词；隐喻/复合句易漏 |
| 误伤风险 | 低（有 confidence + `generic` 兜底） | 中高：如「写一个分镜师的人物小传」含「分镜」但应走 `script`/`generic` |
| 质量主因 | **否**——质量主要在 Call-2 模板 | **否**——规则不提升文案质量 |
| 延迟 / 成本 | 多 1 次短调用（通常 &lt;1s、token 很少） | 可省 Call-1；对总耗时占比通常 **&lt;15%**（大头在 Call-2 长文） |
| 维护成本 | 维护分类 system + 边界样例 | 维护关键词表 + 排除规则，模式一多易腐烂 |
| 第一期显著成效？ | **有**：把需求送进正确模板，这是 P2 的核心 | **不显著**：省下的延迟/费用有限，却引入误分类风险 |

**决策（第一期）：纯 LLM 分类。**

依据：

1. 用户明确要覆盖剧本 / 三视图 / 分镜等差异大需求 → **分类准确度 &gt; 省一次短调用**。  
2. 体验瓶颈是「模式对不对 + 长文好不好」，不是分类多 300～800ms。  
3. 规则适合做**加速层**，不适合做**正确性层**；过早上规则容易用错误 mode 生成「看起来很长但任务错了」的内容，比慢一点更伤信任。  
4. 无 Key 环境例外：可用规则仅选择 Placeholder 模板（不宣称智能分类成功）。

#### 迭代路径（后期做规则预筛）

| 阶段 | 内容 | 进入条件 |
|---|---|---|
| **一期（当前）** | 仅 LLM Call-1；记录 `mode`、耗时、（可选）confidence 到 GenerationRecord.metadata | — |
| **一期+** | 后台/日志统计：各 mode 占比、Call-1 p50/p95、用户是否立即再次生成（代理不满意） | 有真实流量 |
| **二期** | **高精规则捷径**：仅当命中「强意图短语」且排除歧义时跳过 Call-1。例：整句含「三视图/正侧背」→ `character_turnaround`；「分镜提示词/分镜脚本」→ `storyboard`；「旁白/口播文案」→ `copywriting`。必须带 **否定上下文**（如同时含「剧本/小说」则不走 storyboard） | Call-1 p95 &gt; 1.5s 或分类成本需优化；或明确关键词句占比 &gt; 40% |
| **二期验证** | A/B 或影子模式：规则先只打日志「若启用会选 X」，与 LLM 结果对比，一致率 ≥ 95% 再开启跳过 | 影子一致率达标 |
| **三期** | 用户可手动覆盖 mode（Dock 下拉）；规则 + LLM + 手动 三层 | 有误分类客诉或高级用户需求 |

实现预留：`classify(prompt)` 接口内部保留 `tryRuleShortcut(prompt): mode | null` 钩子，一期恒返回 `null`，避免二期大改。

---

## 第三节：前端交互与数据流

### 3.1 组件改造点

| 模块 | 变更 |
|---|---|
| `DockStudioRouter` | `nodeType === 'prompt'` → 新 `PromptDockPanel`（不再落入 Legacy「应用」） |
| `PromptDockPanel` | 输入只 patch `prompt`；按钮「生成提示词」emit `generate`；模型选择 `textModel`；**语音紧贴生成按钮**；可选展示 `promptMode` 标签 |
| `CanvasNodePrompt` | 预览 `content`（Markdown 截断）；占位+「双击编辑文本」；`@dblclick.stop` 打开编辑弹窗 |
| `PromptMarkdownEditor` | 新建；TipTap + **语音输入**（紧贴关闭/主操作）；Teleport 弹窗 |
| 现有 `*DockPanel` | 统一将 🎤 挪到生成按钮左侧紧邻（§1.8） |
| `useNodeGeneration` | 增加 `prompt` 分支：调 `studioApi.generatePrompt`，写回 `content`/`promptMode`/`status` |
| `studio-api.ts` | `generatePrompt(prompt, model?)` → `POST /studio/prompt/generate`，timeout 90_000 |
| `useUpstreamNodeContext` | `nodeTextContent`：`prompt` 类型优先 `content`，否则 `prompt`（保证下游吃到生成长文） |

### 3.2 生成时序

```text
用户编辑 Dock.prompt
  → patch { prompt }          // 不碰 content
点击「生成提示词」
  → requireLogin
  → patch { status: generating }  // 不覆盖 content
  → POST /studio/prompt/generate
  → 成功：patch { content, promptMode, status: completed, errorMessage: null }
  → 失败：patch { status: error, errorMessage }
  → saveCanvas
双击节点
  → 打开 PromptMarkdownEditor(content)
  → 用户编辑 → 防抖/关闭时 patch { content }（仍不改 prompt）
```

### 3.3 与 text 节点边界

| | `text` 节点 | `prompt` 节点（本设计） |
|---|---|---|
| Dock | `TextDockPanel`「生成文案」 | `PromptDockPanel`「生成提示词」 |
| API | `/studio/text/generate` | `/studio/prompt/generate` |
| 输入/输出 | 历史上 content≈prompt 同步 | **严格分离** |
| 智能 | 单 system 文案扩写 | 意图路由 + 多模式模板 |

### 3.4 第三节确认结论（C3）

| 问题 | 结论 |
|---|---|
| Markdown 弹窗 | **TipTap**（更贴竞品所见即所得）+ **语音输入** |
| 节点 resize handle | **迭代 B**；第一期节点固定尺寸，长文靠双击弹窗 |
| 语音图标位置 | Dock / Markdown **均紧贴提交（生成/关闭）按钮**；现有 Dock 同期校正 |

### 3.5 迭代 B 预留（resize）

- 节点 `data` 可预留 `nodeWidth` / `nodeHeight`（第一期不写、不读）。
- UI 预留右下角 handle 挂载点，第一期不渲染。
- 进入条件：用户反馈「画布上扫读长文不便」或需并排对比多个 prompt 结果时再做。

### 3.6 测试要点（设计层）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 输入车模短需求生成 | `promptMode=image_prompt_multi_style`，`content` 含多风格中英 Prompt，`prompt` 未变 |
| 2 | 「人物三视图」 | 落到 `character_turnaround`，含正侧背一致性 |
| 3 | 「分镜提示词」 | 落到 `storyboard`，含镜号/景别 |
| 4 | 「按××人生观写剧本」 | 落到 `script`，非绘画多风格 |
| 5 | 双击 | TipTap 弹窗打开，可编辑/语音插入并写回 `content`，Dock 里短需求不变 |
| 6 | 无 API Key | Placeholder 长文，非 echo |
| 7 | 生成失败 | 旧 `content` 保留，`status=error` |
| 8 | 连到 image 节点 | 上游优先带上 `content` |
| 9 | Dock 语音 | Prompt 及其他 Dock 的 🎤 紧邻生成按钮，听写写入主输入 |
| 10 | Markdown 语音 | 弹窗内 🎤 紧邻主操作，插入光标处 |

---

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-07-17 | 初稿：第一节范围与节点行为；第二节后端路由/模板/API |
| 2026-07-17 | 第二节确认：展开对齐竞品 MarkdownEditor；积分 5/超时 90s；分类一期纯 LLM + 规则迭代路径；增补第三节前端数据流 |
| 2026-07-17 | 第三节确认 **C3**：TipTap 弹窗 + resize 迭代 B；补测试要点与迭代预留 |
| 2026-07-17 | 语音输入改为第一期必做：全 Dock Studio + Markdown 弹窗；图标统一紧贴提交/生成按钮（§1.8） |
