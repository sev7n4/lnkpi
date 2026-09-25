<script setup lang="ts">
import { ref } from 'vue'
import ReplaceImagePicker from './ReplaceImagePicker.vue'

/**
 * 编辑芯片行（2026-09-25 元素编辑/重绘芯片化通用）：
 * 缩略图（hover 放大预览）+ 对象名（可编辑）+【修改】展开修改内容
 * +「+」替换图（本地/资产库，作为对象替换参考）+ × 删除本枚 + 识别中旋转态。
 */
export interface ElementChipRowItem {
  id: string
  name: string
  modify: string
  thumb?: string
  recognizing?: boolean
  refUrl?: string | null
}

const props = defineProps<{
  item: ElementChipRowItem
  highlighted?: boolean
  namePlaceholder?: string
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:modify': [value: string]
  'update:refUrl': [value: string | null]
  remove: []
  highlight: [value: boolean]
}>()

const modifyOpen = ref(false)
const previewOpen = ref(false)

function thumbSrc(): string {
  return props.item.thumb ?? ''
}
</script>

<template>
  <div class="ecr" :class="{ 'is-hl': highlighted, 'is-busy': item.recognizing }" :data-testid="`ecr-${item.id}`">
    <span
      class="ecr__thumbwrap"
      @mouseenter="previewOpen = true"
      @mouseleave="previewOpen = false"
    >
      <span
        v-if="item.thumb"
        class="ecr__thumb"
        :style="{ backgroundImage: `url(${thumbSrc()})` }"
      />
      <span v-else class="ecr__thumb ecr__thumb--empty" />
      <!-- hover 放大预览 -->
      <span v-if="previewOpen && item.thumb" class="ecr__preview" data-testid="ecr-preview">
        <img :src="thumbSrc()" alt="选区预览">
      </span>
    </span>

    <input
      :value="item.name"
      class="ecr__name"
      :data-testid="`ecr-name-${item.id}`"
      :placeholder="namePlaceholder ?? '对象名'"
      :disabled="item.recognizing"
      @input="emit('update:name', ($event.target as HTMLInputElement).value)"
      @focus="emit('highlight', true)"
      @blur="emit('highlight', false)"
    >

    <ReplaceImagePicker
      :model-value="item.refUrl ?? null"
      @update:model-value="emit('update:refUrl', $event)"
    />

    <button
      type="button"
      class="ecr__modify-btn"
      :class="{ 'is-on': modifyOpen }"
      :data-testid="`ecr-modify-toggle-${item.id}`"
      :title="modifyOpen ? '收起修改输入' : '填写修改内容'"
      @click="modifyOpen = !modifyOpen"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z" />
      </svg>
      <span>修改</span>
    </button>

    <span v-if="item.recognizing" class="ecr__spin" aria-label="识别中" />

    <button
      type="button"
      class="ecr__remove"
      :data-testid="`ecr-remove-${item.id}`"
      title="删除这处编辑"
      aria-label="删除这处编辑"
      @click="emit('remove')"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>

    <input
      v-if="modifyOpen"
      :value="item.modify"
      class="ecr__modify"
      :data-testid="`ecr-modify-${item.id}`"
      placeholder="想改成什么样？如：换成蓝色发光"
      @input="emit('update:modify', ($event.target as HTMLInputElement).value)"
      @keydown.enter.prevent="modifyOpen = false"
    >
  </div>
</template>

<style scoped>
.ecr {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.4rem;
  border-radius: 0.55rem;
  color: var(--neo-text);
}
.ecr.is-hl {
  background: color-mix(in srgb, var(--neo-accent-text, #a89dff) 12%, transparent);
}
.ecr.is-busy { opacity: 0.75; }

.ecr__thumbwrap { position: relative; display: inline-flex; flex: 0 0 auto; }
.ecr__thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background-color: color-mix(in srgb, var(--neo-text) 8%, transparent);
  background-size: cover;
  background-position: center;
  cursor: zoom-in;
}
.ecr__thumb--empty {
  background-image: linear-gradient(45deg, color-mix(in srgb, var(--neo-text) 6%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--neo-text) 6%, transparent) 75%);
  background-size: 8px 8px;
}
.ecr__preview {
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  z-index: 40;
  width: 168px;
  padding: 4px;
  border-radius: 8px;
  background: var(--neo-hi, #1c1c1e);
  border: 1px solid color-mix(in srgb, var(--neo-text) 14%, transparent);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}
.ecr__preview img {
  display: block;
  width: 100%;
  max-height: 168px;
  object-fit: contain;
  border-radius: 5px;
}

.ecr__name {
  min-width: 0;
  flex: 1;
  padding: 0.22rem 0.4rem;
  border: none;
  border-radius: 0.4rem;
  background: transparent;
  color: var(--neo-text);
  font-size: 12px;
  font-weight: 600;
}
.ecr__name:hover { background: color-mix(in srgb, var(--neo-text) 7%, transparent); }
.ecr__name:focus {
  outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent);
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
}
.ecr__name:disabled { color: var(--neo-text-muted); }

.ecr__modify-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.2rem;
  padding: 0.24rem 0.45rem;
  border-radius: 0.45rem;
  color: var(--neo-text-muted);
  font-size: 11.5px;
  cursor: pointer;
}
.ecr__modify-btn:hover,
.ecr__modify-btn.is-on {
  background: color-mix(in srgb, var(--neo-text) 10%, transparent);
  color: var(--neo-text);
}

.ecr__spin {
  flex: 0 0 11px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--neo-text) 25%, transparent);
  border-top-color: var(--neo-accent-text, #a89dff);
  animation: ecr-spin 0.8s linear infinite;
}
@keyframes ecr-spin { to { transform: rotate(360deg); } }

.ecr__remove {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: var(--neo-text-muted);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.ecr__remove:hover {
  background: color-mix(in srgb, #ff6b6b 18%, transparent);
  color: #ff6b6b;
}

.ecr__modify {
  grid-column: 1 / -1;
  margin-left: 36px;
  width: calc(100% - 40px);
  padding: 0.32rem 0.45rem;
  border: none;
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--neo-text) 6%, transparent);
  color: var(--neo-text);
  font-size: 12px;
}
.ecr__modify:focus { outline: 1px solid color-mix(in srgb, var(--neo-text) 30%, transparent); }
.ecr__modify::placeholder { color: color-mix(in srgb, var(--neo-text) 45%, transparent); }
</style>
