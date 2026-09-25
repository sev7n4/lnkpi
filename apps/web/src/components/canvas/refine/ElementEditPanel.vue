<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { studioApi } from '@/services/studio-api'
import { combineElementEditPrompt, ELEMENT_EDIT_NAME_OPTIONS } from '@/components/canvas/elementEditModel'
import { P1_IMAGE_EDIT_MODEL_KEY } from '@lnkpi/shared'

/**
 * 元素编辑面板（精修右栏，element 模式）：
 * 多选区局部编辑——【选区】面板圈一块 → 回本面板「+ 添加当前选区」配元素名/描述 →
 * 蒙版并入累积层并清空选区，可继续圈下一块；【⚡生成】把累积蒙版 + combined prompt
 * 走 image/edit mode:'inpaint' 单次生成，结果进会话胶片条。
 */
const editor = useCanvasEditorStore()

const emit = defineEmits<{
  busy: [value: boolean]
}>()

const name = ref<string>(ELEMENT_EDIT_NAME_OPTIONS[0] as string)
const desc = ref('')
const nameMenuOpen = ref(false)
const busy = ref(false)
const errorMessage = ref('')

const items = computed(() => editor.refineElementItems)
const canAdd = computed(() => editor.refineMaskAvailable && !busy.value)
const canGenerate = computed(() => !busy.value && items.value.length > 0 && !!editor.refineElementMaskCanvas)

function pickName(opt: string) {
  name.value = opt
  nameMenuOpen.value = false
}

/** 当前选区（蒙版位图）并入累积层，登记一项，然后清空选区供下一块圈选。 */
function addCurrentSelection() {
  const handle = editor.getRefineMask()
  const src = handle?.getCanvas()
  if (!src || !editor.refineMaskAvailable) return
  const copy = document.createElement('canvas')
  copy.width = src.width
  copy.height = src.height
  const ctx = copy.getContext('2d')
  if (!ctx) return
  ctx.drawImage(src, 0, 0)
  const ok = editor.addRefineElementItem(name.value.trim() || (ELEMENT_EDIT_NAME_OPTIONS[0] as string), desc.value.trim(), copy)
  if (!ok) return
  handle?.clear()
  desc.value = ''
}

/** 生成：累积蒙版 → PNG → persist → image/edit inpaint（combined prompt）→ 会话结果。 */
async function generate() {
  const maskCanvas = editor.refineElementMaskCanvas
  if (!canGenerate.value || !maskCanvas) return
  busy.value = true
  errorMessage.value = ''
  emit('busy', true)
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      maskCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('蒙版导出失败'))), 'image/png')
    })
    const file = new File([blob], 'element-mask.png', { type: 'image/png' })
    const fallbackUrl = URL.createObjectURL(file)
    let maskUrl: string
    try {
      maskUrl = await persistMediaUrl(file, fallbackUrl)
    } catch (e) {
      URL.revokeObjectURL(fallbackUrl)
      throw e
    }
    if (maskUrl !== fallbackUrl) URL.revokeObjectURL(fallbackUrl)
    const prompt = combineElementEditPrompt(items.value) || '元素编辑'
    const { data } = await studioApi.editImage({
      prompt,
      imageUrl: editor.imageTarget?.url ?? '',
      maskUrl,
      model: P1_IMAGE_EDIT_MODEL_KEY,
      size: 'auto',
      mode: 'inpaint',
      nodeId: editor.imageTarget?.nodeId,
    })
    const url = data.data.url
    if (url) {
      editor.pushRefineSessionResult({ url, recordId: data.data.id, prompt })
      editor.clearRefineElementItems()
    } else {
      errorMessage.value = '生成结果为空，请重试'
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : '元素编辑失败，请重试'
  } finally {
    busy.value = false
    emit('busy', false)
  }
}
</script>

<template>
  <section class="element-panel" data-testid="element-edit-panel">
    <p class="element-panel__hint">
      用左侧 <b>选区</b> 圈出要改的元素 → 回这里配名称与描述 → <b>添加</b>；可重复圈选多处，一次生成。
    </p>

    <div class="element-panel__form">
      <div class="relative">
        <button
          type="button"
          class="element-panel__name"
          data-testid="element-name"
          :aria-expanded="nameMenuOpen"
          :disabled="busy"
          @click="nameMenuOpen = !nameMenuOpen"
        >
          <span class="truncate">{{ name }}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <div
          v-if="nameMenuOpen"
          class="neo-chrome element-panel__menu absolute left-0 top-full z-[3] mt-1 rounded-xl p-1"
          role="menu"
        >
          <button
            v-for="opt in ELEMENT_EDIT_NAME_OPTIONS"
            :key="opt"
            type="button"
            role="menuitem"
            class="element-panel__menu-item"
            :class="{ 'is-on': name === opt }"
            @click="pickName(opt)"
          >{{ opt }}</button>
        </div>
      </div>
      <input
        v-model="desc"
        class="element-panel__desc"
        placeholder="描述改动，如：换成蓝色发光"
        data-testid="element-desc"
        :disabled="busy"
        @keydown.enter.prevent="addCurrentSelection"
      >
      <button
        type="button"
        class="element-panel__add"
        data-testid="element-add-selection"
        :disabled="!canAdd"
        :title="editor.refineMaskAvailable ? '把当前选区加入编辑内容' : '先用左侧「选区」圈出区域'"
        @click="addCurrentSelection"
      >+ 添加当前选区</button>
    </div>

    <div v-if="items.length" class="element-panel__list" data-testid="element-items">
      <div v-for="item in items" :key="item.id" class="element-panel__row">
        <span
          v-if="item.thumb"
          class="element-panel__thumb"
          :style="{ backgroundImage: `url(${item.thumb})` }"
        />
        <span v-else class="element-panel__thumb element-panel__thumb--empty" />
        <b>{{ item.name }}</b>
        <span class="element-panel__row-desc">{{ item.desc || '—' }}</span>
      </div>
      <button
        type="button"
        class="element-panel__clear"
        data-testid="element-clear"
        :disabled="busy"
        @click="editor.clearRefineElementItems()"
      >清空全部重来</button>
    </div>

    <p v-if="errorMessage" class="element-panel__error" data-testid="element-error">{{ errorMessage }}</p>

    <button
      type="button"
      class="element-panel__generate"
      data-testid="element-generate"
      :disabled="!canGenerate"
      :title="items.length ? '按编辑内容一次性生成' : '先添加至少一处编辑'"
      @click="generate"
    >{{ busy ? '生成中…' : `⚡ 生成${items.length ? `（${items.length} 处）` : ''}` }}</button>
  </section>
</template>

<style scoped>
.element-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px;
}
.element-panel__hint {
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--neo-text) 5%, transparent);
  color: var(--neo-text-muted);
  font-size: 11.5px;
  line-height: 1.6;
}
.element-panel__hint b { color: var(--neo-text); font-weight: 600; }

.element-panel__form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.element-panel__name {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  padding: 0.42rem 0.55rem;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--neo-text) 8%, transparent);
  color: var(--neo-text);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.element-panel__menu {
  min-width: 96px;
  background: var(--neo-chrome-bg);
  box-shadow: var(--neo-chrome-shadow);
  max-height: 220px;
  overflow-y: auto;
}
.element-panel__menu-item {
  display: block;
  width: 100%;
  padding: 0.32rem 0.6rem;
  border-radius: 0.4rem;
  text-align: left;
  font-size: 11.5px;
  color: var(--neo-text);
  white-space: nowrap;
  cursor: pointer;
}
.element-panel__menu-item:hover { background: color-mix(in srgb, var(--neo-text) 8%, transparent); }
.element-panel__menu-item.is-on { color: var(--neo-accent-text, #a89dff); }

.element-panel__desc {
  width: 100%;
  padding: 0.42rem 0.55rem;
  border: none;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
  color: var(--neo-text);
  font-size: 12.5px;
}
.element-panel__desc:focus { outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent); }
.element-panel__desc::placeholder { color: color-mix(in srgb, var(--neo-text) 45%, transparent); }

.element-panel__add {
  padding: 0.5rem 0.8rem;
  border-radius: 0.55rem;
  background: #fff;
  color: #111;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.element-panel__add:hover:not(:disabled) { opacity: 0.88; }
.element-panel__add:disabled { cursor: not-allowed; opacity: 0.5; }

.element-panel__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.element-panel__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.4rem;
  border-radius: 0.5rem;
  color: var(--neo-text);
  font-size: 12px;
}
.element-panel__row b { flex: 0 0 auto; font-weight: 600; }
.element-panel__row-desc {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--neo-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.element-panel__thumb {
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 6px;
  background-color: color-mix(in srgb, var(--neo-text) 8%, transparent);
  background-size: cover;
  background-position: center;
}
.element-panel__thumb--empty {
  background-image: linear-gradient(45deg, color-mix(in srgb, var(--neo-text) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--neo-text) 6%, transparent) 75%);
  background-size: 8px 8px;
}
.element-panel__clear {
  align-self: flex-end;
  padding: 0.25rem 0.5rem;
  border-radius: 0.45rem;
  color: var(--neo-text-muted);
  font-size: 11px;
  cursor: pointer;
}
.element-panel__clear:hover:not(:disabled) { background: color-mix(in srgb, var(--neo-text) 8%, transparent); }
.element-panel__clear:disabled { cursor: not-allowed; opacity: 0.5; }

.element-panel__error {
  color: #ff7a7a;
  font-size: 11.5px;
  line-height: 1.5;
}
.element-panel__generate {
  padding: 0.55rem 1rem;
  border-radius: 0.6rem;
  background: #fff;
  color: #111;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.element-panel__generate:hover:not(:disabled) { opacity: 0.88; }
.element-panel__generate:disabled { cursor: not-allowed; opacity: 0.5; }
</style>
