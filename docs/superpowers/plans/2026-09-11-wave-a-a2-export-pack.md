# Wave A · A2 导出打包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 启用交付完成态「导出打包」芯片；人侧经 Host 拦截 `__export_pack__` → `downloadMediaPackage`（manifest + stream-download）；不发聊天消息；真 zip 留给 A2.1。

**Architecture:** Runtime 去掉 `disabled` 并改文案；`AgentPresentationHost` 对 secondary 识别 `__export_pack__`，收集 `finalized`/`basics` 的 `node_id` 后 `emit('exportPack')`；`AgentSideRail`（完成态 Host）与 `CanvasPage` 接到已有 `downloadMediaPackage`。Agent Nest `exportMediaPackage` 保持 manifest/`downloadPath`，本 PR 不造 zip。COS 未配置不得阻塞导出。

**Tech Stack:** Vue 3 + Vitest（web）、Python pytest（agent-runtime）、现有 Nest `exportMediaPackage` / `useCanvasMedia.downloadMediaPackage`

**Spec:** [docs/superpowers/specs/2026-09-11-wave-a-a2-export-pack-design.md](../specs/2026-09-11-wave-a-a2-export-pack-design.md)  
**Program:** [docs/superpowers/specs/2026-09-10-wave-a-delivery-program-design.md](../specs/2026-09-10-wave-a-delivery-program-design.md)

## Global Constraints

- MVP = 启用芯片 + manifest JSON + 多文件 stream-download；**禁止**本 PR 实现真 zip（A2.1）。
- `__export_pack__` **不得**写入用户对话 / 不得触发 `sendMessage` / `onDeliveryPrimaryAction`。
- COS / `persist-remote` 未配置 **不得**阻塞导出。
- 人机最终下载都经 `/api/media/stream-download`。
- Commit per task；PR 前：`pnpm build`、相关 web/runtime 测试、`pnpm --filter @lnkpi/agent test`（若触及）。

## File map

| File | Role |
| --- | --- |
| `services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml` | `done.export_label` →「导出打包」 |
| `services/agent-runtime/app/graph/product_visual_v2/delivery.py` | 去掉 export secondary `disabled: True` |
| `services/agent-runtime/tests/test_product_visual_delivery_v2.py` | 断言文案与可点 |
| `apps/web/src/components/agent/presentation/AgentPresentationHost.vue` | 拦截 `__export_pack__` → `exportPack` |
| `apps/web/src/components/agent/presentation/presentation.test.ts` | Host 导出行为单测 |
| `apps/web/src/components/agent/AgentSideRail.vue` | emit `exportPack`；完成态 Host 接线 |
| `apps/web/src/pages/CanvasPage.vue` | `@export-pack` → `downloadMediaPackage` |
| `apps/web/src/composables/useCanvasMedia.ts` | 空选择 toast |
| `apps/web/src/composables/useCanvasMedia.test.ts` | 空包 toast 单测 |
| Nest `exportMediaPackage` | **默认不改**；仅当发现空选择契约缺口时补测 |

---

### Task 1: Runtime — 文案与启用芯片

**Files:**
- Modify: `services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml`
- Modify: `services/agent-runtime/app/graph/product_visual_v2/delivery.py`（约 294–300 行）
- Test: `services/agent-runtime/tests/test_product_visual_delivery_v2.py`

**Interfaces:**
- Produces: `build_done_presentation(...).secondary_actions[0]` = `{ label: "导出打包", message: "__export_pack__" }`，**无** `disabled: True`

- [ ] **Step 1: 扩展失败测试断言**

在 `test_build_done_presentation_delivery_summary_table` 末尾追加：

```python
    export = pres["secondary_actions"][0]
    assert export["label"] == "导出打包"
    assert export["message"] == "__export_pack__"
    assert export.get("disabled") in (None, False)
```

- [ ] **Step 2: 跑测确认失败**

Run:

```bash
cd services/agent-runtime && python -m pytest tests/test_product_visual_delivery_v2.py::test_build_done_presentation_delivery_summary_table -v
```

Expected: FAIL（仍为「导出打包（二期）」或 `disabled: True`）

- [ ] **Step 3: 改 copy**

`1.0.0.yaml`：

```yaml
  export_label: "导出打包"
```

- [ ] **Step 4: 改 delivery.py**

将：

```python
        "secondary_actions": [
            {
                "label": copy.get("done.export_label"),
                "message": _EXPORT_PACK_MESSAGE,
                "disabled": True,
            }
        ],
```

改为：

```python
        "secondary_actions": [
            {
                "label": copy.get("done.export_label"),
                "message": _EXPORT_PACK_MESSAGE,
            }
        ],
```

- [ ] **Step 5: 跑测确认通过**

同 Step 2 命令。Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml \
  services/agent-runtime/app/graph/product_visual_v2/delivery.py \
  services/agent-runtime/tests/test_product_visual_delivery_v2.py
git commit -m "$(cat <<'EOF'
feat(runtime): enable export pack chip on delivery done

EOF
)"
```

---

### Task 2: Web Host — 拦截 `__export_pack__`

**Files:**
- Modify: `apps/web/src/components/agent/presentation/AgentPresentationHost.vue`
- Modify: `apps/web/src/components/agent/presentation/presentation.test.ts`

**Interfaces:**
- Consumes: `collectAllNodeIds()`（已有，finalized + basics）
- Produces: `emit('exportPack', nodeIds: string[])`；点击导出时 **不** `emit('primaryAction', '__export_pack__')`
- Constant: `EXPORT_PACK_MESSAGE = '__export_pack__'`

- [ ] **Step 1: 写失败单测**

更新 `doneEnvelope.secondary_actions`：

```typescript
  secondary_actions: [{ label: '导出打包', message: '__export_pack__' }],
```

追加用例：

```typescript
  it('emits exportPack on secondary export action without primaryAction', async () => {
    const wrapper = mount(AgentPresentationHost, {
      props: { presentation: doneEnvelope },
    })
    const secondary = wrapper.find('[data-testid="secondary-action"]')
    expect(secondary.text()).toBe('导出打包')
    expect(secondary.attributes('disabled')).toBeUndefined()
    await secondary.trigger('click')
    expect(wrapper.emitted('exportPack')?.[0]?.[0]).toEqual(['node-hero', 'node-gift', 'node-seed'])
    expect(wrapper.emitted('primaryAction')).toBeUndefined()
  })

  it('emits exportPack with empty ids when no node_ids', async () => {
    const emptyDone: AgentPresentationEnvelope = {
      ...doneEnvelope,
      body: { ...doneEnvelope.body!, finalized: [], basics: [] },
    }
    const wrapper = mount(AgentPresentationHost, {
      props: { presentation: emptyDone },
    })
    await wrapper.find('[data-testid="secondary-action"]').trigger('click')
    expect(wrapper.emitted('exportPack')?.[0]?.[0]).toEqual([])
    expect(wrapper.emitted('primaryAction')).toBeUndefined()
  })
```

- [ ] **Step 2: 跑测确认失败**

Run:

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/agent/presentation/presentation.test.ts
```

Expected: FAIL（仍 emit `primaryAction` / 文案仍为二期）

- [ ] **Step 3: 实现 Host 拦截**

在 `AgentPresentationHost.vue` script：

```typescript
const EXPORT_PACK_MESSAGE = '__export_pack__'

const emit = defineEmits<{
  primaryAction: [message: string]
  macroToggle: [schemeId: string, checked: boolean]
  focusNode: [nodeId: string]
  focusAll: [nodeIds: string[]]
  exportPack: [nodeIds: string[]]
  deliverySwitch: [shotId: string, variantKey: string]
}>()

const exportBusy = ref(false)

function onSecondaryAction(action: AgentPresentationPrimaryAction) {
  if (action.message === EXPORT_PACK_MESSAGE) {
    if (exportBusy.value) return
    exportBusy.value = true
    emit('exportPack', collectAllNodeIds())
    window.setTimeout(() => {
      exportBusy.value = false
    }, 800)
    return
  }
  emit('primaryAction', action.message)
}
```

模板 secondary 按钮：

```vue
      <button
        v-for="(action, idx) in secondaryActions"
        :key="`${action.label}-${idx}`"
        type="button"
        class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
        :disabled="disabled || action.disabled || (action.message === EXPORT_PACK_MESSAGE && exportBusy)"
        data-testid="secondary-action"
        @click="onSecondaryAction(action)"
      >
        {{ action.label }}
      </button>
```

确保文件顶部已 `import { computed, ref } from 'vue'`（已有则不改）。

- [ ] **Step 4: 跑测确认通过**

同 Step 2。Expected: PASS（含原有 focusAll 用例）

- [ ] **Step 5: Commit**

```bash
git add \
  apps/web/src/components/agent/presentation/AgentPresentationHost.vue \
  apps/web/src/components/agent/presentation/presentation.test.ts
git commit -m "$(cat <<'EOF'
feat(web): intercept export pack presentation action

EOF
)"
```

---

### Task 3: 接线 SideRail → CanvasPage + 空选择 toast

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify: `apps/web/src/pages/CanvasPage.vue`
- Modify: `apps/web/src/composables/useCanvasMedia.ts`
- Test: `apps/web/src/composables/useCanvasMedia.test.ts`

**Interfaces:**
- Consumes: `downloadMediaPackage(nodes, selectedIds, { sessionId })`
- Produces: `AgentSideRail` emit `exportPack: [nodeIds: string[]]`；`CanvasPage` `@export-pack="handleExportPack"`

- [ ] **Step 1: 空包 toast 失败测试**

在 `useCanvasMedia.test.ts` 增加：

```typescript
import { downloadMediaPackage } from './useCanvasMedia'
import { ElMessage } from 'element-plus'

describe('downloadMediaPackage', () => {
  beforeEach(() => {
    vi.mocked(ElMessage.warning).mockClear()
  })

  it('toasts when no media in selection', async () => {
    const count = await downloadMediaPackage(
      [{ id: 'n1', type: 'image', data: {} }],
      ['n1'],
    )
    expect(count).toBe(0)
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringMatching(/没有可导出|无可导出|没有媒体/))
  })
})
```

（文案以 Step 3 最终字符串为准，测试用同一句。）

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useCanvasMedia.test.ts
```

Expected: FAIL（当前空选择静默 `return 0`）

- [ ] **Step 3: 实现空选择 toast**

`downloadMediaPackage`：

```typescript
  const items = collectMediaFromNodes(nodes, selectedIds)
  if (!items.length) {
    ElMessage.warning('没有可导出的媒体，请确认定稿节点已生成')
    return 0
  }
```

- [ ] **Step 4: AgentSideRail 转发**

`defineEmits` 增加：

```typescript
  exportPack: [nodeIds: string[]]
```

增加：

```typescript
function onExportPack(nodeIds: string[]) {
  emit('exportPack', nodeIds)
}
```

完成态 Host（约 2323–2329，`showCompletionPresentation`）增加：

```vue
                @export-pack="onExportPack($event)"
```

（历史消息 Host 为 `disabled`，可不接；若其他可点 Host 将来出现 export，同样接线。）

- [ ] **Step 5: CanvasPage 处理**

在 `handlePackageDownload` 旁增加：

```typescript
async function handleExportPack(nodeIds: string[]) {
  await downloadMediaPackage(
    nodes.value.map((n) => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> })),
    nodeIds,
    { sessionId: sessionId.value },
  )
}
```

`AgentSideRail` 上增加：

```vue
        @export-pack="handleExportPack"
```

（与现有 `@focus-all="focusNodesByIds"` 同级。）

- [ ] **Step 6: 跑测**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useCanvasMedia.test.ts src/components/agent/presentation/presentation.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add \
  apps/web/src/components/agent/AgentSideRail.vue \
  apps/web/src/pages/CanvasPage.vue \
  apps/web/src/composables/useCanvasMedia.ts \
  apps/web/src/composables/useCanvasMedia.test.ts
git commit -m "$(cat <<'EOF'
feat(web): wire export pack to downloadMediaPackage

EOF
)"
```

---

### Task 4: Nest Agent 路径冒烟（无行为变更优先）

**Files:**
- Read-only 确认: `apps/server/src/agent/agent-canvas-tools.service.ts` `exportMediaPackage`
- Optional Test: 若仓内已有 agent tools 单测文件则追加空 `nodeIds` → `count: 0`；**无现成 harness 则跳过实现、只在 PR 描述写明手工/契约已满足**

**Interfaces:**
- Produces: `{ manifest: { exportedAt, count, items: [{ nodeId, url, fileName, downloadPath }] } }`；`downloadPath` 含 `/api/media/stream-download`

- [ ] **Step 1: 契约核对**

确认 `exportMediaPackage`：无 URL 节点跳过；空 `nodeIds` → `count: 0`；每项 `downloadPath` 以 `/api/media/stream-download?` 开头。与规格 §2.1.5 / §4.1.5 一致则 **不改代码**。

- [ ] **Step 2: Commit（仅当有测试文件变更）**

若写了测试：

```bash
git add apps/server/src/agent/<test-file>
git commit -m "$(cat <<'EOF'
test(server): cover exportMediaPackage empty selection

EOF
)"
```

否则本 Task 无 commit。

---

### Task 5: 本地验证与 PR 准备

**Files:** 无功能改动（或纲领勾选延后到合入后）

- [ ] **Step 1: 构建与测试**

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/web exec vitest run src/composables/useCanvasMedia.test.ts src/components/agent/presentation/presentation.test.ts
cd services/agent-runtime && python -m pytest tests/test_product_visual_delivery_v2.py::test_build_done_presentation_delivery_summary_table -v
```

Expected: 全部 PASS / build 成功

- [ ] **Step 2: PR**

按 `.cursor/skills/mydev-github-workflow`：push 当前分支、`gh pr create`。

标题建议：`feat: Wave A A2 enable export pack (manifest + stream-download)`

Body 要点：

- Summary：启用完成态导出；Host 拦截；接 `downloadMediaPackage`；真 zip = A2.1
- Test plan：上述命令；生产：完成态点「导出打包」→ 本机 JSON+媒体；对话无 `__export_pack__`；未配 COS 仍可下

- [ ] **Step 3: 生产 smoke（合入部署后）**

1. 登录生产画布  
2. 有媒体节点时可用多选打包菜单对照；完成态点「导出打包」  
3. 确认下载发生且聊天无 `__export_pack__`  
4. COS 未配不影响导出（与收藏 503 解耦）

---

## Spec coverage (self-review)

| Spec 要求 | Task |
| --- | --- |
| copy 去「（二期）」 | T1 |
| `disabled` 解除 | T1 |
| Host 拦截 `__export_pack__` 不发 chat | T2 |
| emit nodeIds（finalized+basics） | T2（`collectAllNodeIds`） |
| SideRail / CanvasPage → `downloadMediaPackage` | T3 |
| 空媒体 toast | T3 |
| 短防抖 / busy | T2（`exportBusy` 800ms） |
| Nest Agent 路径 / 空 count | T4 |
| COS 不挡导出 | 无代码依赖（约束 + T5 smoke） |
| 真 zip A2.1 | Non-goal，未排 Task |
| 单测 copy/delivery/Host | T1–T3 |

**Placeholder scan:** 无 TBD。  
**Type consistency:** `exportPack: [nodeIds: string[]]` 贯穿 Host → SideRail → CanvasPage。
