# Prompt 节点意图路由 + 多模式模板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让画布 `prompt` 节点支持「短需求 → 意图分类 → 模式最佳实践长文 Markdown」，双击 TipTap 编辑（含语音），Dock 语音紧贴生成按钮。

**Architecture:** `@lnkpi/agent` 内建模式注册表 + 两段式 LLM（classify → generate）；Nest `POST /studio/prompt/generate` 记账落库；前端 `PromptDockPanel` + `useNodeGeneration` prompt 分支 + `PromptMarkdownEditor`；现有 Dock 统一 🎤 紧贴提交按钮。

**Tech Stack:** Vue 3, TypeScript, NestJS, Prisma, Vitest, TipTap (`@tiptap/vue-3` + starter-kit + markdown), `useSpeechRecognition`, OpenAI-compatible `chat/completions`

**Spec:** `docs/superpowers/specs/2026-07-17-prompt-node-intent-templates-design.md`

## Global Constraints

- 仅改造 `prompt` 节点；`text` 节点 `/studio/text/generate` 行为不变
- `prompt`（用户短需求）与 `content`（生成长文）严格分离，输入时禁止同步为同一字符串
- 第一期纯 LLM 分类；`tryRuleShortcut` 钩子恒返回 `null`
- 积分 5 点；前端超时 90s
- 第一期不做节点 resize；Markdown / 全 Dock 必须有语音，🎤 紧贴生成/关闭主按钮
- 无 `OPENAI_API_KEY` 时按 mode 返回 Placeholder 长文，禁止 echo `prompt`
- 提交前本地：`pnpm --filter @lnkpi/agent test`；涉及 web 时 `pnpm --filter @lnkpi/web build`（或 monorepo `pnpm build`）

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `packages/agent/src/prompt-modes/types.ts` | ModeId、PromptModeDefinition 类型 |
| `packages/agent/src/prompt-modes/registry.ts` | 6 模式注册表 + `getPromptMode` |
| `packages/agent/src/prompt-modes/modes/*.ts` | 各模式 system / fewShot / placeholder / classifyHints |
| `packages/agent/src/prompt-modes/classify.ts` | Call-1 分类 + `tryRuleShortcut` 钩子 |
| `packages/agent/src/prompt-modes/generate.ts` | Call-2 生成 + 无 Key Placeholder |
| `packages/agent/src/prompt-modes/index.ts` | 对外导出 |
| `packages/agent/src/prompt-modes/*.test.ts` | 单元测试 |
| `packages/agent/src/index.ts` | re-export |
| `apps/server/src/studio/studio.service.ts` | `generatePrompt` |
| `apps/server/src/studio/studio.controller.ts` | `POST prompt/generate` |
| `apps/web/src/services/studio-api.ts` | `generatePrompt` |
| `apps/web/src/composables/useGenerationPolling.ts` | `parseRecordPromptContent` |
| `apps/web/src/composables/useNodeGeneration.ts` | `prompt` 分支 |
| `apps/web/src/composables/useUpstreamNodeContext.ts` | prompt 节点优先 `content` |
| `apps/web/src/components/canvas/dock-studio/panels/PromptDockPanel.vue` | Prompt Dock |
| `apps/web/src/components/canvas/dock-studio/DockStudioRouter.vue` | 路由到 PromptDockPanel |
| `apps/web/src/components/canvas/PromptMarkdownEditor.vue` | TipTap 弹窗 + 语音 |
| `apps/web/src/components/canvas/CanvasNodePrompt.vue` | 预览 + 双击打开编辑器 |
| `apps/web/src/components/canvas/canvasDockMenu.ts` | 菜单增加 prompt |
| `apps/web/src/components/canvas/NodePanelDock.vue` | DockNodeType 含 prompt |
| `apps/web/src/components/canvas/dock-studio/panels/*DockPanel.vue` | 🎤 紧贴生成按钮 |
| `apps/web/package.json` | TipTap 依赖 |

---

### Task 1: 模式类型、注册表与分类/生成核心（agent 包）

**Files:**
- Create: `packages/agent/src/prompt-modes/types.ts`
- Create: `packages/agent/src/prompt-modes/registry.ts`
- Create: `packages/agent/src/prompt-modes/modes/image-prompt-multi-style.ts`
- Create: `packages/agent/src/prompt-modes/modes/character-turnaround.ts`
- Create: `packages/agent/src/prompt-modes/modes/storyboard.ts`
- Create: `packages/agent/src/prompt-modes/modes/script.ts`
- Create: `packages/agent/src/prompt-modes/modes/copywriting.ts`
- Create: `packages/agent/src/prompt-modes/modes/generic.ts`
- Create: `packages/agent/src/prompt-modes/classify.ts`
- Create: `packages/agent/src/prompt-modes/generate.ts`
- Create: `packages/agent/src/prompt-modes/index.ts`
- Create: `packages/agent/src/prompt-modes/classify.test.ts`
- Create: `packages/agent/src/prompt-modes/generate.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Produces:
  - `export type PromptModeId = 'image_prompt_multi_style' | 'character_turnaround' | 'storyboard' | 'script' | 'copywriting' | 'generic'`
  - `export interface PromptModeDefinition { id: PromptModeId; label: string; classifyHints: string; system: string; fewShot: { user: string; assistant: string }; placeholder: (prompt: string) => string }`
  - `export function tryRuleShortcut(_prompt: string): PromptModeId | null` → 一期恒 `null`
  - `export async function classifyPromptMode(prompt: string, opts?: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ mode: PromptModeId; confidence: number }>`
  - `export async function generatePromptContent(prompt: string, mode: PromptModeId, opts?: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ mode: PromptModeId; content: string }>`
  - `export async function generatePromptFromUserInput(prompt: string, opts?: ...): Promise<{ mode: PromptModeId; content: string }>`（内部 classify → generate）

- [ ] **Step 1: 写分类失败测试（无 Key 走启发式占位选 mode）**

Create `packages/agent/src/prompt-modes/classify.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tryRuleShortcut, classifyPromptMode } from './classify'

describe('tryRuleShortcut', () => {
  it('returns null in phase 1', () => {
    expect(tryRuleShortcut('帮我生成一个分镜提示词')).toBeNull()
  })
})

describe('classifyPromptMode without API key', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  it('uses keyword heuristic for turnaround when no key', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await classifyPromptMode('帮我生成一个包含人物三视图的提示词')
    expect(res.mode).toBe('character_turnaround')
    expect(res.confidence).toBeLessThan(1)
  })

  it('falls back to generic for ambiguous text when no key', async () => {
    delete process.env.OPENAI_API_KEY
    const res = await classifyPromptMode('你好')
    expect(res.mode).toBe('generic')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @lnkpi/agent test -- src/prompt-modes/classify.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 types + 6 个 mode 文件 + registry**

`types.ts` 按 Interfaces 定义。

每个 mode 文件导出 `PromptModeDefinition`。`system` 必须覆盖 spec §2.3 质量原则；至少包含输出 Markdown 骨架说明。示例如 `image-prompt-multi-style.ts`：

```ts
import type { PromptModeDefinition } from '../types'

export const imagePromptMultiStyleMode: PromptModeDefinition = {
  id: 'image_prompt_multi_style',
  label: '多风格绘画提示词',
  classifyHints: '用户要多组 AI 绘画/Midjourney/SD 风格提示词、海报/车模/角色外观多风格方案',
  system: `你是资深 AI 绘画提示词工程师。根据用户短需求输出 Markdown：
1) 简短开场；2) 至少 3 种风格，每组含「中文描述」+「Prompt (EN)」引用块；3) 建议与技巧（比例、负面词等）；4) 禁止只复述用户原句。用中文说明、英文 Prompt。`,
  fewShot: {
    user: '赛博朋克猫咖啡馆海报',
    assistant: '### 风格一：霓虹夜雨\n- **中文描述：** …\n- **Prompt:**\n> neon rain, cyberpunk cat cafe…',
  },
  placeholder: (prompt) =>
    `【提示词草案·多风格】\n\n基于「${prompt}」：\n\n### 风格一\n- 中文描述：…\n- Prompt: \`sample prompt\`\n\n（配置 OPENAI_API_KEY 后可获得真实 LLM 输出）`,
}
```

其余 5 个 mode 同结构，`system`/`placeholder`/`classifyHints` 按 spec 模式表填写（三视图强制正侧背一致性；分镜含镜号景别；剧本含主题人物分场；文案可口播；generic 兜底）。

`registry.ts`:

```ts
import type { PromptModeDefinition, PromptModeId } from './types'
import { imagePromptMultiStyleMode } from './modes/image-prompt-multi-style'
// ... import others

export const PROMPT_MODES: Record<PromptModeId, PromptModeDefinition> = {
  image_prompt_multi_style: imagePromptMultiStyleMode,
  character_turnaround: characterTurnaroundMode,
  storyboard: storyboardMode,
  script: scriptMode,
  copywriting: copywritingMode,
  generic: genericMode,
}

export function getPromptMode(id: PromptModeId): PromptModeDefinition {
  return PROMPT_MODES[id]
}

export const PROMPT_MODE_IDS = Object.keys(PROMPT_MODES) as PromptModeId[]
```

- [ ] **Step 4: 实现 classify.ts**

```ts
import { getPromptMode, PROMPT_MODE_IDS, PROMPT_MODES } from './registry'
import type { PromptModeId } from './types'

export function tryRuleShortcut(_prompt: string): PromptModeId | null {
  return null
}

/** 仅无 Key / Placeholder 路径使用；不用于跳过有 Key 时的 Call-1 */
export function heuristicMode(prompt: string): PromptModeId {
  const p = prompt.toLowerCase()
  if (/三视图|正侧背|turnaround/.test(p)) return 'character_turnaround'
  if (/分镜/.test(p)) return 'storyboard'
  if (/剧本|剧本大纲|人生观/.test(p)) return 'script'
  if (/旁白|口播|文案/.test(p)) return 'copywriting'
  if (/提示词|midjourney|stable diffusion|绘画|车模/.test(p)) return 'image_prompt_multi_style'
  return 'generic'
}

export async function classifyPromptMode(
  prompt: string,
  opts?: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<{ mode: PromptModeId; confidence: number }> {
  const shortcut = tryRuleShortcut(prompt)
  if (shortcut) return { mode: shortcut, confidence: 0.99 }

  const key = opts?.apiKey ?? process.env.OPENAI_API_KEY
  if (!key) return { mode: heuristicMode(prompt), confidence: 0.4 }

  const hints = PROMPT_MODE_IDS.map((id) => `- ${id}: ${PROMPT_MODES[id].classifyHints}`).join('\n')
  const baseUrl = (opts?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: opts?.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `你是意图分类器。只输出 JSON：{"mode":"<id>","confidence":0-1}。mode 必须是其一：${PROMPT_MODE_IDS.join(', ')}。\n判别：\n${hints}`,
        },
        { role: 'user', content: prompt.slice(0, 500) },
      ],
    }),
  })
  if (!res.ok) return { mode: 'generic', confidence: 0 }
  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  const raw = json.choices[0]?.message?.content ?? ''
  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as { mode?: string; confidence?: number }
    const mode = PROMPT_MODE_IDS.includes(parsed.mode as PromptModeId)
      ? (parsed.mode as PromptModeId)
      : 'generic'
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
    if (confidence < 0.5) return { mode: 'generic', confidence }
    return { mode, confidence }
  } catch {
    return { mode: 'generic', confidence: 0 }
  }
}
```

- [ ] **Step 5: 实现 generate.ts + generate.test.ts**

```ts
// generate.test.ts
import { describe, it, expect } from 'vitest'
import { generatePromptContent } from './generate'

describe('generatePromptContent without key', () => {
  it('returns placeholder that includes user prompt and is longer than input', async () => {
    delete process.env.OPENAI_API_KEY
    const input = '美女模特车模展会'
    const { mode, content } = await generatePromptContent(input, 'image_prompt_multi_style')
    expect(mode).toBe('image_prompt_multi_style')
    expect(content).toContain(input)
    expect(content.length).toBeGreaterThan(input.length)
    expect(content).not.toBe(input)
  })
})
```

`generate.ts`：有 Key 时用 mode.system + fewShot + user 调 `chat/completions`；无 Key 时 `getPromptMode(mode).placeholder(prompt)`。

`generatePromptFromUserInput`：`const { mode } = await classifyPromptMode(...); return generatePromptContent(prompt, mode, opts)`。

- [ ] **Step 6: 导出并跑通测试**

Modify `packages/agent/src/index.ts` 增加 prompt-modes 导出。

Run: `pnpm --filter @lnkpi/agent test`

Expected: PASS（含新测试）

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/prompt-modes packages/agent/src/index.ts
git commit -m "feat(agent): add prompt mode registry with classify/generate"
```

---

### Task 2: Nest Studio API `POST /studio/prompt/generate`

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/studio/studio.controller.ts`
- Test: 手动或最小 e2e；若无可加 `apps/server` 单测，优先 service 逻辑靠 agent 单测覆盖

**Interfaces:**
- Consumes: `generatePromptFromUserInput` from `@lnkpi/agent`
- Produces: GenerationRecord with `type: 'prompt'`, `metadata: JSON.stringify({ mode, content })`

- [ ] **Step 1: 在 StudioService 增加方法**

```ts
async generatePrompt(userId: string, prompt: string, model?: string) {
  const trimmed = prompt?.trim()
  if (!trimmed) throw new BadRequestException('prompt 不能为空')
  await this.consumePoints(userId, 5, '提示词模式生成')
  const { mode, content } = await generatePromptFromUserInput(trimmed, {
    model,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
  })
  return this.prisma.generationRecord.create({
    data: {
      userId,
      type: 'prompt',
      prompt: trimmed,
      model,
      url: null,
      status: 'completed',
      metadata: JSON.stringify({ mode, content }),
    },
  })
}
```

（确保文件顶部已 `import { BadRequestException } from '@nestjs/common'` 与 `generatePromptFromUserInput`。）

- [ ] **Step 2: Controller DTO + 路由**

在 `studio.controller.ts` 增加：

```ts
class GeneratePromptDto {
  @IsString()
  prompt!: string

  @IsOptional()
  @IsString()
  model?: string
}

@Post('prompt/generate')
@UseGuards(AuthGuard)
async generatePrompt(@Req() req: { user: { sub: string } }, @Body() dto: GeneratePromptDto) {
  const data = await this.studioService.generatePrompt(req.user.sub, dto.prompt, dto.model)
  return { code: 0, message: 'ok', data }
}
```

- [ ] **Step 3: 本地冒烟（无 Key 亦可）**

启动 server 后（或 vitest mock），确认路由注册：`POST /api/studio/prompt/generate`（以项目全局前缀为准，与 text/generate 同级）。

Run: `pnpm --filter @lnkpi/server build`（或 monorepo build 中 server 部分）

Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/studio/studio.service.ts apps/server/src/studio/studio.controller.ts
git commit -m "feat(server): add POST /studio/prompt/generate"
```

---

### Task 3: 前端 API、解析、生成链路与上游

**Files:**
- Modify: `apps/web/src/services/studio-api.ts`
- Modify: `apps/web/src/composables/useGenerationPolling.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useUpstreamNodeContext.ts`

**Interfaces:**
- Produces: `studioApi.generatePrompt(prompt, model?)`；`parseRecordPromptContent(record) => { content: string; mode: string | null }`

- [ ] **Step 1: studio-api**

```ts
generatePrompt: (prompt: string, model?: string) =>
  api.post<{ data: GenerationRecord }>('/studio/prompt/generate', { prompt, model }, { timeout: 90_000 }),
```

- [ ] **Step 2: parseRecordPromptContent**

在 `useGenerationPolling.ts` 旁或同文件：

```ts
export function parseRecordPromptContent(record: { metadata?: string | null; prompt: string }) {
  if (!record.metadata) return { content: record.prompt, mode: null as string | null }
  try {
    const meta = JSON.parse(record.metadata) as { content?: string; mode?: string; text?: string }
    return {
      content: meta.content ?? meta.text ?? record.prompt,
      mode: meta.mode ?? null,
    }
  } catch {
    return { content: record.prompt, mode: null }
  }
}
```

- [ ] **Step 3: useNodeGeneration 增加 prompt 分支**

在 `nodeType === 'text'` 分支之前或之后插入：

```ts
if (nodeType === 'prompt') {
  const userPrompt = String(data.prompt ?? '').trim() || prompt
  if (!userPrompt) return
  deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating })
  const models = deps.resolveProviderModels()
  const { data: res } = await studioApi.generatePrompt(
    userPrompt,
    String(data.textModel ?? models.text),
  )
  const parsed = parseRecordPromptContent(res.data)
  deps.patchNodeData(node.id, {
    content: parsed.content,
    promptMode: parsed.mode,
    status: NODE_GENERATION_STATUS.completed,
    errorMessage: null,
  })
  await deps.saveCanvas()
  return
}
```

注意：`mergePromptWithUpstream` 对 prompt 节点可能拼上游；生成请求应以节点自身 `data.prompt` 为主（可把 upstream 文本拼进 userPrompt，若现有 merge 已含则复用 `prompt` 变量但**不要**把合并结果写回覆盖用户短需求字段——只用于请求体）。实现时：请求用 `mergePromptWithUpstream` 结果；patch 成功时**不**改 `data.prompt`。

- [ ] **Step 4: useUpstreamNodeContext**

将 `nodeTextContent` 改为对 prompt 类型优先 content：

```ts
function nodeTextContent(node: EditableFlowNode): string {
  const data = node.data ?? {}
  const type = String(node.type ?? '')
  if (type === 'prompt') {
    return String(data.content ?? data.prompt ?? '').trim()
  }
  return String(data.content ?? data.prompt ?? '').trim()
}
```

（与现状等价但意图显式；保持 `content` 优先。）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/studio-api.ts apps/web/src/composables/useGenerationPolling.ts apps/web/src/composables/useNodeGeneration.ts apps/web/src/composables/useUpstreamNodeContext.ts
git commit -m "feat(web): wire prompt node generation to studio API"
```

---

### Task 4: PromptDockPanel + Router + 菜单可添加 prompt

**Files:**
- Create: `apps/web/src/components/canvas/dock-studio/panels/PromptDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/DockStudioRouter.vue`
- Modify: `apps/web/src/components/canvas/NodePanelDock.vue`
- Modify: `apps/web/src/components/canvas/canvasDockMenu.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`（若 `add` 节点工厂不支持 prompt，补默认 data）

**Interfaces:**
- Consumes: `emit('patch')` / `emit('generate')` 与其它 Dock 一致
- Produces: 只 patch `{ prompt, textModel }`，不写 `content`

- [ ] **Step 1: 扩展 DockNodeType 与菜单**

`NodePanelDock.vue` 的 `DockNodeType` 增加 `'prompt'`。

`canvasDockMenu.ts` 在列表顶部或 text 旁增加：

```ts
{ type: 'prompt', label: '提示词', desc: '多模式提示词扩写', badge: 'Prompt', tone: 'text-fuchsia-300 bg-fuchsia-500/15' },
```

`CONNECT_OUT_TARGET_TYPES` 视需要加入 `'prompt'`。

- [ ] **Step 2: 创建 PromptDockPanel.vue**

对照 `TextDockPanel.vue`，但：

- `syncFromNode`：`prompt.value = String(data.prompt ?? '')`（不要用 content 填输入框，除非 prompt 空且仅预填需求——默认只用 `data.prompt`）
- `onPromptInput`：`emit('patch', { prompt: value })` **不** patch content
- 底栏布局：`[UniversalModelSelector] [可选 promptMode 标签] … ml-auto [🎤] [DockGenerateButton label=生成提示词]`
- 🎤 必须紧挨 `DockGenerateButton` 左侧（`ml-auto` 包住二者或 flex 右对齐成组）

- [ ] **Step 3: DockStudioRouter**

在 `text` 分支旁增加：

```vue
<PromptDockPanel
  v-else-if="node && nodeType === 'prompt'"
  ...
/>
```

确保不再落到 LegacyDockPanel。

- [ ] **Step 4: CanvasPage addNode**

确认添加 `prompt` 类型时 `data: { prompt: '', label: '提示词' }`（搜索现有 `add`/`onAddNode` 映射并补全）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/dock-studio/panels/PromptDockPanel.vue apps/web/src/components/canvas/dock-studio/DockStudioRouter.vue apps/web/src/components/canvas/NodePanelDock.vue apps/web/src/components/canvas/canvasDockMenu.ts apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): add PromptDockPanel and dock menu entry"
```

---

### Task 5: TipTap PromptMarkdownEditor + 语音

**Files:**
- Modify: `apps/web/package.json`（添加依赖）
- Create: `apps/web/src/components/canvas/PromptMarkdownEditor.vue`
- Create: `apps/web/src/components/canvas/PromptMarkdownEditor.css`（可选 scoped 外置）

**Interfaces:**
- Props: `visible: boolean`, `modelValue: string`
- Emits: `update:visible`, `update:modelValue`, `save(content: string)`

- [ ] **Step 1: 安装 TipTap**

Run（在 repo 根目录）:

```bash
pnpm --filter @lnkpi/web add @tiptap/vue-3 @tiptap/starter-kit @tiptap/extension-placeholder @tiptap/extension-typography tiptap-markdown
```

若 `tiptap-markdown` 与当前 TipTap 主版本不兼容，改用：存储纯文本 Markdown 时用 `editor.getText()` 不理想——优先 `tiptap-markdown` 的 `getMarkdown()`；不兼容则用 `@tiptap/core` + 手动 `markdown-it` 双向转换，但计划默认 `tiptap-markdown`。

- [ ] **Step 2: 实现 PromptMarkdownEditor.vue**

结构：

```vue
<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { EditorContent, Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'

const props = defineProps<{ visible: boolean; modelValue: string }>()
const emit = defineEmits<{
  'update:visible': [boolean]
  'update:modelValue': [string]
  save: [string]
}>()

const speech = useSpeechRecognition()
let editor: Editor | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function getMarkdown(): string {
  return (editor?.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown?.() ?? ''
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const md = getMarkdown()
    emit('update:modelValue', md)
    emit('save', md)
  }, 400)
}

function ensureEditor() {
  if (editor) return
  editor = new Editor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: '输入或生成提示词内容...' }),
      Markdown.configure({ html: false }),
    ],
    content: props.modelValue || '',
    onUpdate: () => scheduleSave(),
  })
}

watch(() => props.visible, (v) => {
  if (v) {
    ensureEditor()
    editor?.commands.setContent(props.modelValue || '')
    setTimeout(() => editor?.commands.focus('end'), 50)
  }
})

function close() {
  const md = getMarkdown()
  emit('update:modelValue', md)
  emit('save', md)
  emit('update:visible', false)
}

function copyAll() {
  void navigator.clipboard.writeText(getMarkdown())
}

function toggleVoice() {
  if (speech.listening.value) {
    speech.stop()
    return
  }
  speech.start((text, isFinal) => {
    if (!isFinal || !editor) return
    editor.chain().focus().insertContent(text).run()
    scheduleSave()
  })
}

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  editor?.destroy()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="prompt-md-overlay" @click.self="close">
      <div class="prompt-md-modal" @click.stop>
        <div class="prompt-md-toolbar">
          <!-- 格式按钮：H1/H2/H3/Bold/Italic/List/HR -->
          <div class="prompt-md-spacer" />
          <button type="button" class="dock-icon-btn" title="语音输入" :class="speech.listening.value ? 'animate-pulse text-red-400' : ''" @click="toggleVoice">🎤</button>
          <button type="button" class="btn-primary text-xs" @click="copyAll">复制</button>
          <button type="button" class="btn-secondary text-xs" @click="close">关闭</button>
        </div>
        <EditorContent :editor="editor" class="prompt-md-editor" />
      </div>
    </div>
  </Teleport>
</template>
```

样式：深色大弹窗、遮罩、`toolbar` 中 **🎤 紧邻复制/关闭**（主操作组右侧成对）。格式按钮在左，右侧 `spacer + 🎤 + 复制 + 关闭`。

- [ ] **Step 3: 构建校验**

Run: `pnpm --filter @lnkpi/web build`

Expected: PASS（若 TipTap 类型报错，补 `// @ts-expect-error` 或正确 storage 类型）

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/canvas/PromptMarkdownEditor.vue
git commit -m "feat(web): add TipTap PromptMarkdownEditor with voice"
```

---

### Task 6: CanvasNodePrompt 双击打开编辑器

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasNodePrompt.vue`

- [ ] **Step 1: 改写节点组件**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import NeoBaseNode from '@/components/canvas/NeoBaseNode.vue'
import PromptMarkdownEditor from '@/components/canvas/PromptMarkdownEditor.vue'

const props = defineProps<{
  selected?: boolean
  data: { prompt?: string; content?: string; label?: string; status?: string }
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
}>()

const editorOpen = ref(false)
const draft = ref('')

const preview = computed(() => {
  const c = String(props.data.content ?? '').trim()
  if (c) return c.length > 180 ? `${c.slice(0, 180)}…` : c
  return ''
})

function openEditor() {
  draft.value = String(props.data.content ?? '')
  editorOpen.value = true
}

function onSave(md: string) {
  emit('patch', { content: md })
}
</script>

<template>
  <NeoBaseNode node-type="prompt" :selected="selected" :data="data" :status="data.status">
    <div class="neo-text-card" @dblclick.stop="openEditor">
      <template v-if="preview">
        <p class="whitespace-pre-wrap text-left text-[12px] leading-relaxed text-white/80">{{ preview }}</p>
      </template>
      <template v-else>
        <p>输入需求生成提示词</p>
        <p class="text-[11px] text-white/35">双击编辑文本</p>
        <p v-if="data.prompt" class="mt-1 line-clamp-2 text-[11px] text-white/40">{{ data.prompt }}</p>
      </template>
    </div>
    <PromptMarkdownEditor
      v-model:visible="editorOpen"
      v-model="draft"
      @save="onSave"
    />
  </NeoBaseNode>
</template>
```

若 Vue Flow 节点不能直接 `emit('patch')`，改为 inject/provide 或通过 `CanvasPage` 已有的节点更新总线（查看 `NeoBaseNode` / 其它节点如何更新 data）。**实现时以项目现有节点更新模式为准**：常见做法是 `updateNodeData` 回调 via `useVueFlow` 的 `updateNodeData(id,)`，需在组件内 `const id = getNodeId()` 或 props 增加 `id`。检查 `CanvasNodeText`——若无 patch，则在 `CanvasPage` 用 `@node-double-click` 或给 Prompt 节点包一层。  

**校正步骤：** 打开 `CanvasPage.vue` 中 `<VueFlow>` 节点类型注册；若节点组件无法 emit 到页面，使用：

```ts
import { useVueFlow } from '@vue-flow/core'
const { updateNodeData } = useVueFlow()
// onSave:
updateNodeData(nodeId, { content: md })
```

并从 `useNodeId()`（@vue-flow/core）取 id。

- [ ] **Step 2: 手动验证清单**

- 双击打开弹窗、编辑、关闭后节点 preview 更新  
- 标题双击仍只重命名，不打开编辑器  

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/canvas/CanvasNodePrompt.vue
git commit -m "feat(web): double-click prompt node opens markdown editor"
```

---

### Task 7: 全 Dock 语音按钮紧贴生成按钮

**Files:**
- Modify: `apps/web/src/components/canvas/dock-studio/panels/TextDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/AudioDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/ShotDockPanel.vue`
- 检查其它含 🎤 的 Dock / Legacy 面板一并调整

- [ ] **Step 1: 统一布局模式**

每个面板 `bottom-toolbar-actions` 改为：

```vue
<div class="bottom-toolbar-actions flex-wrap items-center">
  <!-- 左侧：模型、优化、字数等 -->
  <div class="ml-auto flex items-center gap-2">
    <button type="button" class="dock-icon-btn" ... @click="toggleVoice">🎤</button>
    <DockGenerateButton ... />
  </div>
</div>
```

从原位置删除离散的 🎤，避免重复。

- [ ] **Step 2: 目视确认**

Prompt / Text / Image / Video / Audio / Shot：🎤 均在生成按钮左侧紧邻。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/canvas/dock-studio/panels/*.vue
git commit -m "fix(web): place dock voice control beside generate button"
```

---

### Task 8: 端到端验收与收尾

**Files:** 无新文件；按需修 bug

- [ ] **Step 1: 跑测试与构建**

```bash
pnpm --filter @lnkpi/agent test
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
```

Expected: 全部通过

- [ ] **Step 2: 对照 spec §3.6 手工点验**

| # | 操作 | 期望 |
|---|---|---|
| 1 | prompt 节点输入车模短需求 → 生成 | mode 多风格，content 长文，prompt 不变 |
| 2 | 「人物三视图」 | character_turnaround |
| 3 | 「分镜提示词」 | storyboard |
| 4 | 「按××人生观写剧本」 | script |
| 5 | 双击 TipTap + 语音 | 写入 content，Dock prompt 不变 |
| 6 | 无 Key | Placeholder，非 echo |
| 7 | 失败 | 旧 content 保留 |
| 8 | 连 image | 上游带 content |
| 9–10 | Dock/Markdown 🎤 位置 | 紧贴提交 |

- [ ] **Step 3: 最终 commit（若有修复）**

```bash
git add -u
git commit -m "fix: prompt node intent-templates acceptance polish"
```

---

## Spec Coverage Checklist

| Spec 项 | Task |
|---------|------|
| 6 模式注册表 + 质量原则 | Task 1 |
| 两段式 classify → generate | Task 1 |
| tryRuleShortcut 恒 null | Task 1 |
| POST /studio/prompt/generate，5 点 | Task 2 |
| 前端 generate + 不覆盖 prompt | Task 3–4 |
| 上游优先 content | Task 3 |
| PromptDockPanel「生成提示词」 | Task 4 |
| TipTap 弹窗 | Task 5 |
| 双击打开 | Task 6 |
| Dock + Markdown 语音，紧贴提交 | Task 4–5、7 |
| resize 不做 | 无任务（刻意） |
| text 节点不变 | 无改 text generate |

## Placeholder Scan

无 TBD /「类似 Task N」未展开项；TipTap 依赖名已给出，若不兼容在 Task 5 Step 1 有明确回退路径。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-prompt-node-intent-templates.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新开子代理，任务间审查，迭代快  
2. **Inline Execution** — 本会话按 `executing-plans` 连续执行并设检查点  

Which approach?
