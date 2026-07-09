# NeoWOW Workflow 复刻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复刻 NeoWOW `/workflow?sessionId=` 体验——视觉对齐（A）+ Agent 原生驱动画布（C）。

**Architecture:** M1 建立 NeoWOW 设计系统与页面 chrome（Element Plus + Tailwind tokens）；M2 补齐 `/agent/canvas/*` API、OpenAI 图像生成、Shot/Material 持久化与前端轮询。画布渲染继续用 Vue Flow，PlayCanvas 推迟 M3。

**Tech Stack:** Vue 3, TypeScript, Vite, Tailwind, Element Plus, Vue Flow, NestJS, Prisma, SQLite, `@lnkpi/agent`, OpenAI API, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-07-09-neowow-workflow-design.md`

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `apps/web/src/styles/neowow-tokens.css` | NeoWOW CSS 变量 |
| `apps/web/tailwind.config.js` | Token → Tailwind 映射 |
| `apps/web/src/main.ts` | Element Plus 注册 |
| `apps/web/src/components/workflow/CreativeLauncher.vue` | 启动器输入区 |
| `apps/web/src/components/workflow/CarouselBanner.vue` | Banner |
| `apps/web/src/components/workflow/CategoryTabs.vue` | 分类 Tab |
| `apps/web/src/composables/useSessionRedirect.ts` | `?sessionId=` 路由恢复 |
| `apps/web/src/composables/useShotPolling.ts` | 生成状态轮询 |
| `apps/web/src/services/canvas-api.ts` | Canvas API 客户端 |
| `apps/server/src/canvas/canvas.module.ts` | Canvas NestJS 模块 |
| `apps/server/src/canvas/canvas.controller.ts` | 6 个 Canvas API |
| `apps/server/src/canvas/canvas.service.ts` | Session/Canvas CRUD |
| `apps/server/src/canvas/shot.service.ts` | Shot CRUD + status batch |
| `apps/server/src/canvas/material.service.ts` | Material + 图像任务 |
| `apps/server/src/ai/openai-image.service.ts` | OpenAI images API |
| `packages/agent/src/tools/executor.ts` | 真实/降级图像生成 |
| `packages/agent/src/tools/image-provider.ts` | 图像 API 抽象 |
| `packages/agent/src/tools/executor.test.ts` | Agent tool 单元测试 |

---

# Milestone M1: UI Shell（视觉对齐）

---

### Task 1: NeoWOW Design Tokens

**Files:**
- Create: `apps/web/src/styles/neowow-tokens.css`
- Modify: `apps/web/tailwind.config.js`
- Modify: `apps/web/src/styles/main.css`
- Modify: `apps/web/index.html`

- [ ] **Step 1: 创建 CSS 变量文件**

Create `apps/web/src/styles/neowow-tokens.css`:

```css
:root {
  --neo-bg: #141414;
  --neo-surface-card: #1a1a1a;
  --neo-surface-elevated: #242424;
  --neo-border: rgba(255, 255, 255, 0.08);
  --neo-accent: #6366f1;
  --neo-accent-hover: #818cf8;
  --neo-text-primary: #ffffff;
  --neo-text-secondary: rgba(255, 255, 255, 0.6);
  --neo-text-muted: rgba(255, 255, 255, 0.4);
  --neo-sidebar-width: 240px;
  --neo-agent-panel-width: 320px;
  --neo-header-height: 64px;
  --neo-radius-md: 12px;
  --neo-radius-lg: 16px;
}
```

- [ ] **Step 2: 更新 Tailwind 配置**

Replace `apps/web/tailwind.config.js` colors section:

```js
colors: {
  brand: {
    500: '#6366f1',
    600: '#6366f1',
    700: '#4f46e5',
    400: '#818cf8',
  },
  surface: {
    DEFAULT: '#141414',
    card: '#1a1a1a',
    elevated: '#242424',
    border: 'rgba(255,255,255,0.08)',
  },
},
```

- [ ] **Step 3: 导入 tokens**

Add to top of `apps/web/src/styles/main.css`:

```css
@import './neowow-tokens.css';
```

Update `body` in `@layer base` to `background-color: var(--neo-bg)`.

- [ ] **Step 4: 更新 index.html body class**

```html
<body class="bg-[#141414] text-white antialiased">
```

- [ ] **Step 5: 验证构建**

Run: `pnpm --filter @lnkpi/web build`  
Expected: exit 0

---

### Task 2: 引入 Element Plus

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/main.ts`

- [ ] **Step 1: 安装依赖**

Run: `pnpm --filter @lnkpi/web add element-plus`

- [ ] **Step 2: 注册 Element Plus**

Update `apps/web/src/main.ts`:

```typescript
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

createApp(App).use(createPinia()).use(router).use(ElementPlus).mount('#app')
```

Add `<html class="dark">` to `apps/web/index.html`.

- [ ] **Step 3: 验证 dev 启动**

Run: `pnpm --filter @lnkpi/web dev`  
Expected: http://localhost:5173 正常加载，无 console 报错

---

### Task 3: AppHeader NeoWOW 换肤

**Files:**
- Modify: `apps/web/src/components/layout/AppHeader.vue`

- [ ] **Step 1: 更新 Header 样式**

Key changes:
- `h-16` → `h-[var(--neo-header-height)]`
- Tab 使用 pill 样式：`rounded-lg px-4 py-2`，active 态 `bg-white/10`
- Logo 区使用 `font-display`，accent 改为 `#6366f1`
- 背景：`bg-[#141414]/95 backdrop-blur-xl border-white/5`

- [ ] **Step 2: 验证**

Run: `pnpm --filter @lnkpi/web build`  
Manual: 打开 `/workflow`，Header Tab「画布|超创站」视觉接近 NeoWOW

---

### Task 4: 拆分 Workflow 启动器组件

**Files:**
- Create: `apps/web/src/components/workflow/CreativeLauncher.vue`
- Create: `apps/web/src/components/workflow/CarouselBanner.vue`
- Create: `apps/web/src/components/workflow/CategoryTabs.vue`
- Modify: `apps/web/src/pages/WorkflowPage.vue`

- [ ] **Step 1: CreativeLauncher.vue**

```vue
<script setup lang="ts">
defineProps<{ modelValue: string }>()
defineEmits<{ 'update:modelValue': [v: string]; create: []; guide: [] }>()
</script>

<template>
  <div class="rounded-2xl border border-white/8 bg-[#1a1a1a] p-2">
    <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
      <input
        :value="modelValue"
        class="flex-1 rounded-xl bg-transparent px-4 py-3 text-sm outline-none placeholder:text-white/40"
        placeholder="说说你的创意，超创帮你在画布上实现 …"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('create')"
      />
      <div class="flex shrink-0 gap-2">
        <button
          type="button"
          class="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 hover:bg-white/5"
          @click="$emit('guide')"
        >
          告诉我你的想法
        </button>
        <button
          type="button"
          class="rounded-xl bg-[#6366f1] px-5 py-2.5 text-sm font-medium hover:bg-[#818cf8]"
          @click="$emit('create')"
        >
          创建画布
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: CarouselBanner.vue**

Static banner with gradient `from-indigo-950/40 to-[#1a1a1a]`, text「沉浸式创作 / AI 无限画布 · 图像 · 视频 · 漫剧」.

- [ ] **Step 3: CategoryTabs.vue**

Props: `categories: string[]`, `modelValue: string`. Emit `update:modelValue`. Active tab: `bg-[#6366f1] rounded-full`.

- [ ] **Step 4: 重构 WorkflowPage.vue**

Import three components; replace inline markup. Keep existing `fetchWorks` / `createCanvas` logic.

- [ ] **Step 5: 验证**

Run: `pnpm --filter @lnkpi/web build`

---

### Task 5: WorkCard 视觉对齐

**Files:**
- Modify: `apps/web/src/components/works/WorkCard.vue`

- [ ] **Step 1: 更新卡片样式**

- 背景 `bg-[#1a1a1a] border-white/5`
- Hover: `hover:border-[#6366f1]/30`
- 标签「画布/短片」：`bg-black/50 backdrop-blur-sm`
- 「查看创作过程」按钮：`bg-white/10 backdrop-blur-sm rounded-lg`

- [ ] **Step 2: 验证**

Manual: `/workflow` 作品网格与 NeoWOW 截图对比

---

### Task 6: sessionId URL 恢复逻辑

**Files:**
- Create: `apps/web/src/composables/useSessionRedirect.ts`
- Modify: `apps/web/src/pages/WorkflowPage.vue`
- Modify: `apps/web/src/router/index.ts`

- [ ] **Step 1: useSessionRedirect.ts**

```typescript
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/services/api'

export function useSessionRedirect() {
  const route = useRoute()
  const router = useRouter()
  const auth = useAuthStore()

  onMounted(async () => {
    const sessionId = route.query.sessionId as string | undefined
    if (!sessionId) return

    if (!auth.isLoggedIn) {
      auth.openLogin()
      return
    }

    try {
      await api.get(`/sessions/${sessionId}`)
      await router.replace(`/workflow/${sessionId}`)
    } catch {
      // session 不存在 — 留在启动器，可选 ElMessage
    }
  })
}
```

- [ ] **Step 2: WorkflowPage 调用**

Add `useSessionRedirect()` at top of `<script setup>`.

- [ ] **Step 3: 验证 E2E**

1. 登录 → 创建画布 → 复制 session id  
2. 访问 `/workflow?sessionId={id}`  
Expected: 自动跳转 `/workflow/{id}`

---

### Task 7: Canvas 三栏 Chrome 对齐

**Files:**
- Modify: `apps/web/src/pages/CanvasPage.vue`
- Modify: `apps/web/src/components/agent/AgentPanel.vue`
- Modify: `apps/web/src/components/canvas/GenerationBar.vue`

- [ ] **Step 1: CanvasPage 布局尺寸**

- 左栏固定 `w-[240px]`（`--neo-sidebar-width`）
- 右栏 Agent `w-[320px]`（`--neo-agent-panel-width`）
- 背景 `#141414`，toolbar `bg-[#1a1a1a] border-white/5`

- [ ] **Step 2: AgentPanel 换肤**

- 用户气泡：`bg-[#6366f1]`
- 助手气泡：`bg-[#242424]`
- Tool call 行：`text-indigo-400 text-[10px]`

- [ ] **Step 3: GenerationBar 换肤**

- 底部栏 `bg-[#1a1a1a]/95 backdrop-blur border-t border-white/5`
- Tab active: `bg-indigo-600/30 text-indigo-300`
- 生成按钮 `bg-[#6366f1]`

- [ ] **Step 4: 验证**

Manual: 打开 `/workflow/:sessionId`，三栏布局 + 底部栏与 spec §5.2 一致

---

### Task 8: LoginDialog Element Plus 换肤

**Files:**
- Modify: `apps/web/src/components/auth/LoginDialog.vue`

- [ ] **Step 1: 改用 el-dialog**

Replace Teleport div with:

```vue
<el-dialog v-model="visible" title="欢迎登录" width="420px" :show-close="true">
  <!-- 保留现有表单字段 -->
</el-dialog>
```

Bind `visible` to `auth.showLoginDialog` via computed get/set.

- [ ] **Step 2: 验证**

Manual: 点击「登录」，Dialog 深色主题正常

---

### Task 9: M1 验收清单

- [ ] **Step 1: 构建通过**

Run: `pnpm build`  
Expected: 全 monorepo build 成功

- [ ] **Step 2: 截图对比（5 张）**

| 页面 | URL |
|------|-----|
| 启动器 | `/workflow` |
| 启动器+登录 | `/workflow` + 登录弹窗 |
| 画布三栏 | `/workflow/:sessionId` |
| Agent 面板 | 同上，右侧 |
| 底部生成栏 | 同上，底部 |

- [ ] **Step 3: Commit M1**

```bash
git add apps/web/
git commit -m "feat(web): M1 NeoWOW UI shell — tokens, Element Plus, workflow/canvas chrome"
```

---

# Milestone M2: Agent Native（真实驱动）

---

### Task 10: Agent 包测试基础设施

**Files:**
- Modify: `packages/agent/package.json`
- Create: `packages/agent/vitest.config.ts`
- Create: `packages/agent/src/tools/executor.test.ts`

- [ ] **Step 1: 添加 vitest**

Run: `pnpm --filter @lnkpi/agent add -D vitest`

Add script: `"test": "vitest run"`

- [ ] **Step 2: 写 failing test — create_shot**

Create `packages/agent/src/tools/executor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { CanvasToolExecutor } from './executor'

describe('CanvasToolExecutor', () => {
  it('create_shot returns shotId and add_node action', async () => {
    const executor = new CanvasToolExecutor()
    const ctx = {
      sessionId: 'sess-1',
      canvasData: { nodes: [], edges: [] },
      shots: [],
      userMessage: 'test',
      history: [],
    }
    const { result, actions } = await executor.execute(
      'create_shot',
      { prompt: '赛博朋克城市', title: '分镜1' },
      ctx,
    )
    expect(result).toMatchObject({ title: '分镜1' })
    expect(actions[0].type).toBe('add_node')
    expect(actions[0].payload.nodeType).toBe('shot')
  })
})
```

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter @lnkpi/agent test`  
Expected: PASS（executor 已实现）

---

### Task 11: 图像生成 Provider 抽象

**Files:**
- Create: `packages/agent/src/tools/image-provider.ts`
- Modify: `packages/agent/src/tools/executor.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: image-provider.ts**

```typescript
export interface ImageProvider {
  generate(prompt: string, modelId?: string): Promise<{ url: string }>
}

export class PlaceholderImageProvider implements ImageProvider {
  private urls = [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=512&q=80',
    'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=512&q=80',
  ]
  async generate() {
    const url = this.urls[Math.floor(Math.random() * this.urls.length)]
    return { url }
  }
}

export class OpenAIImageProvider implements ImageProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.openai.com/v1',
    private model = 'dall-e-3',
  ) {}

  async generate(prompt: string): Promise<{ url: string }> {
    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, prompt, n: 1, size: '1024x1024' }),
    })
    if (!res.ok) throw new Error(`Image API ${res.status}: ${await res.text()}`)
    const json = await res.json()
    return { url: json.data[0].url as string }
  }
}

export function createImageProvider(): ImageProvider {
  const key = process.env.OPENAI_API_KEY
  if (key) {
    return new OpenAIImageProvider(key, process.env.OPENAI_BASE_URL, process.env.OPENAI_IMAGE_MODEL)
  }
  return new PlaceholderImageProvider()
}
```

- [ ] **Step 2: executor generate_image 使用 provider**

In `generateImage()`, replace hardcoded PLACEHOLDER with:

```typescript
import { createImageProvider } from './image-provider'
// ...
const { url: imageUrl } = await createImageProvider().generate(prompt)
```

- [ ] **Step 3: 添加 generate_image 测试（mock fetch）**

Extend `executor.test.ts` with vi.stubGlobal fetch mock returning `{ data: [{ url: 'https://example.com/img.png' }] }`.

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @lnkpi/agent test`  
Expected: PASS

---

### Task 12: Canvas 后端模块 — Shot Service

**Files:**
- Create: `apps/server/src/canvas/shot.service.ts`
- Create: `apps/server/src/canvas/canvas.module.ts`
- Modify: `apps/server/src/app.module.ts`

- [ ] **Step 1: shot.service.ts**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ShotService {
  constructor(private prisma: PrismaService) {}

  async create(sessionId: string, data: {
    title?: string; prompt?: string; order?: number
    positionX?: number; positionY?: number
  }) {
    const count = await this.prisma.shot.count({ where: { sessionId } })
    return this.prisma.shot.create({
      data: {
        sessionId,
        title: data.title ?? `分镜 ${count + 1}`,
        prompt: data.prompt ?? '',
        order: data.order ?? count,
        positionX: data.positionX ?? 200 + count * 320,
        positionY: data.positionY ?? 150,
        status: 'draft',
      },
    })
  }

  async statusBatch(ids: string[]) {
    return this.prisma.shot.findMany({
      where: { id: { in: ids } },
      include: { materials: true },
    })
  }
}
```

- [ ] **Step 2: canvas.module.ts + 注册**

```typescript
@Module({
  providers: [ShotService, MaterialService, CanvasService],
  controllers: [CanvasController],
  exports: [ShotService, MaterialService, CanvasService],
})
export class CanvasModule {}
```

Add `CanvasModule` to `app.module.ts` imports.

- [ ] **Step 3: 验证 server 启动**

Run: `pnpm --filter @lnkpi/server dev`  
Expected: 无 import 错误

---

### Task 13: Canvas API — Controller 6 端点

**Files:**
- Create: `apps/server/src/canvas/canvas.controller.ts`
- Create: `apps/server/src/canvas/canvas.service.ts`
- Create: `apps/server/src/canvas/material.service.ts`
- Create: `apps/server/scripts/test-canvas-api.sh`

- [ ] **Step 1: canvas.service.ts — list/create/update**

```typescript
async list(userId: string) {
  return this.prisma.session.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })
}

async create(userId: string, title?: string) {
  return this.prisma.session.create({
    data: { userId, title: title ?? '未命名画布' },
  })
}

async update(id: string, userId: string, data: { title?: string; canvasData?: string }) {
  const session = await this.prisma.session.findFirst({ where: { id, userId } })
  if (!session) throw new NotFoundException()
  return this.prisma.session.update({ where: { id }, data })
}
```

- [ ] **Step 2: material.service.ts — generate-image 异步**

```typescript
async generateImage(shotId: string, prompt: string) {
  const material = await this.prisma.material.create({
    data: { shotId, type: 'image', prompt, status: 'generating' },
  })
  // fire-and-forget in dev: setImmediate(async () => { ... update url, status: completed })
  this.runGeneration(material.id, prompt).catch(console.error)
  return material
}

private async runGeneration(materialId: string, prompt: string) {
  const { createImageProvider } = await import('@lnkpi/agent/tools/image-provider')
  // OR duplicate thin wrapper in server — prefer importing from agent package
  const provider = createImageProvider()
  const { url } = await provider.generate(prompt)
  await this.prisma.material.update({
    where: { id: materialId },
    data: { url, thumbnail: url, status: 'completed' },
  })
}
```

Note: Export `createImageProvider` from `@lnkpi/agent` index if importing from server.

- [ ] **Step 3: canvas.controller.ts 路由**

```typescript
@Controller('agent/canvas')
export class CanvasController {
  @Get('list') @UseGuards(AuthGuard) list(@Req() req) { ... }
  @Post('create') @UseGuards(AuthGuard) create(@Body() dto, @Req() req) { ... }
  @Put('update') @UseGuards(AuthGuard) update(@Body() dto, @Req() req) { ... }
  @Post('shot/create') @UseGuards(AuthGuard) createShot(@Body() dto) { ... }
  @Post('material/generate-image') @UseGuards(AuthGuard) generateImage(@Body() dto) { ... }
  @Get('shot/status/batch') statusBatch(@Query('ids') ids: string) {
    const idList = ids.split(',').filter(Boolean)
    return this.shotService.statusBatch(idList)
  }
}
```

All responses: `{ code: 0, message: 'ok', data }`.

- [ ] **Step 4: 手动 API 测试脚本**

Create `apps/server/scripts/test-canvas-api.sh`:

```bash
#!/usr/bin/env bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","code":"123456"}' | jq -r '.data.token')

curl -s http://localhost:3001/api/agent/canvas/list \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Run after login seed exists. Expected: JSON list of sessions.

---

### Task 14: AgentService 持久化 Shot/Material

**Files:**
- Modify: `apps/server/src/agent/agent.service.ts`
- Modify: `apps/server/src/agent/agent.module.ts`

- [ ] **Step 1: 注入 ShotService**

In `streamConversation`, after collecting `canvasActions`:

```typescript
for (const action of canvasActions) {
  if (action.type === 'add_node' && action.payload.nodeType === 'shot') {
    await this.shotService.create(sessionId, {
      title: action.payload.data?.title as string,
      prompt: action.payload.data?.prompt as string,
      positionX: action.payload.position?.x,
      positionY: action.payload.position?.y,
    })
  }
}
```

- [ ] **Step 2: 验证 SSE + DB**

1. POST `/agent/chat/conversation` with message「创作一个分镜」  
2. Query `sqlite3 apps/server/prisma/dev.db "SELECT * FROM Shot;"`  
Expected: 新 Shot 记录

---

### Task 15: 前端 Canvas API + 轮询

**Files:**
- Create: `apps/web/src/services/canvas-api.ts`
- Create: `apps/web/src/composables/useShotPolling.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`

- [ ] **Step 1: canvas-api.ts**

```typescript
import { api } from './api'

export const canvasApi = {
  list: () => api.get('/agent/canvas/list'),
  create: (title?: string) => api.post('/agent/canvas/create', { title }),
  update: (id: string, data: { title?: string; canvasData?: unknown }) =>
    api.put('/agent/canvas/update', { id, ...data }),
  createShot: (sessionId: string, data: { title?: string; prompt?: string }) =>
    api.post('/agent/canvas/shot/create', { sessionId, ...data }),
  generateImage: (shotId: string, prompt: string) =>
    api.post('/agent/canvas/material/generate-image', { shotId, prompt }),
  statusBatch: (ids: string[]) =>
    api.get('/agent/canvas/shot/status/batch', { params: { ids: ids.join(',') } }),
}
```

- [ ] **Step 2: useShotPolling.ts**

```typescript
import { onUnmounted, ref } from 'vue'
import { canvasApi } from '@/services/canvas-api'

export function useShotPolling(onUpdate: (shots: unknown[]) => void) {
  const timer = ref<ReturnType<typeof setInterval>>()
  const ids = ref<string[]>([])

  function start(shotIds: string[]) {
    ids.value = shotIds
    stop()
    timer.value = setInterval(async () => {
      if (!ids.value.length) return
      const { data } = await canvasApi.statusBatch(ids.value)
      onUpdate(data.data)
    }, 2000)
  }

  function stop() {
    if (timer.value) clearInterval(timer.value)
  }

  onUnmounted(stop)
  return { start, stop }
}
```

- [ ] **Step 3: CanvasPage 集成轮询**

After `handleAgentActions`, extract shot node ids with `status === 'generating'`, call `polling.start(ids)`.

On update, merge material url into node `data.url`, set `status: 'completed'`.

- [ ] **Step 4: 验证 E2E（spec §1.3 #4-6）**

With OPENAI_API_KEY:
- Agent 输入「创作赛博朋克城市夜景」→ Shot + 图像节点

Without key:
- RuleBasedAgent + placeholder 仍工作

Refresh page → nodes persist (spec #5)

---

### Task 16: 环境变量与文档

**Files:**
- Modify: `.env.example`
- Modify: `apps/server/.env`
- Modify: `README.md`

- [ ] **Step 1: 更新 .env.example**

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_CHAT_MODEL=gpt-4o
OPENAI_IMAGE_MODEL=dall-e-3
```

- [ ] **Step 2: README M2 验收步骤**

Add section「Agent Native 验收」with curl + browser steps from spec §1.3.

---

### Task 17: M2 验收与 Commit

- [ ] **Step 1: 全量构建**

Run: `pnpm build && pnpm --filter @lnkpi/agent test`

- [ ] **Step 2: Agent E2E 脚本**

Run server + web, complete spec 6 条验收

- [ ] **Step 3: Commit M2**

```bash
git add apps/server/ packages/agent/ apps/web/src/services/canvas-api.ts apps/web/src/composables/useShotPolling.ts
git commit -m "feat: M2 Agent Native — canvas API, OpenAI image, shot polling"
```

---

# Milestone M3（可选，不在本 Plan 执行范围）

- PlayCanvas POC in `apps/web/src/canvas/playcanvas/`
- GenerationBar @mention with `MentionInput.vue`
- Web Speech API in GenerationBar
- Pixel-perfect screenshot diff fixes

单独开 plan：`docs/superpowers/plans/2026-XX-XX-neowow-canvas-polish.md`

---

## Plan Self-Review

| Spec 要求 | 对应 Task |
|-----------|-----------|
| A: Design tokens | Task 1 |
| A: Element Plus | Task 2 |
| A: 启动器/layout | Task 3-5 |
| A: sessionId redirect | Task 6 |
| A: 三栏 chrome | Task 7 |
| A: LoginDialog | Task 8 |
| C: Image provider | Task 11 |
| C: Canvas API ×6 | Task 12-13 |
| C: Agent 持久化 | Task 14 |
| C: 前端轮询 | Task 15 |
| TDD | Task 10-11 |
| 降级路径 | Task 11, 15 step 4 |
| M3 排除 | M3 appendix only |

No TBD placeholders found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-neowow-workflow.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每个 Task 派一个全新 subagent，Task 间做 spec compliance + code quality 两阶段 review，迭代快。

2. **Inline Execution** — 在本会话用 `executing-plans` 按 Task 批量执行，checkpoint 处暂停等你 review。

**你想用哪种方式开始？** 回复 `1` 或 `2`，或直接说「从 Task 1 开始执行」。
