<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  beforeUrl: string
  afterUrl?: string
  showingOriginal?: boolean
}>()

const emit = defineEmits<{
  'update:showingOriginal': [value: boolean]
}>()

const localHold = ref(false)

const showingOriginal = computed(() => props.showingOriginal ?? localHold.value)

const afterDisplayUrl = computed(() => {
  if (showingOriginal.value) return props.beforeUrl
  return props.afterUrl || props.beforeUrl
})

function setHold(value: boolean) {
  localHold.value = value
  emit('update:showingOriginal', value)
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return true
  return target.isContentEditable
}

function onKeyDown(event: KeyboardEvent) {
  if (event.code !== 'Space' || event.repeat) return
  if (isTypingTarget(event.target)) return
  event.preventDefault()
  setHold(true)
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code !== 'Space') return
  if (isTypingTarget(event.target)) return
  setHold(false)
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<template>
  <div class="compare-view">
    <div class="compare-view__panes">
      <div class="compare-view__pane">
        <span class="compare-view__label">Before</span>
        <div class="compare-view__frame">
          <slot name="before">
            <img class="compare-view__image" :src="beforeUrl" alt="">
          </slot>
        </div>
      </div>
      <div class="compare-view__pane">
        <span class="compare-view__label">After</span>
        <div class="compare-view__frame">
          <img class="compare-view__image" :src="afterDisplayUrl" alt="">
        </div>
      </div>
    </div>
    <button
      type="button"
      class="compare-view__original"
      @mousedown.prevent="setHold(true)"
      @mouseup="setHold(false)"
      @mouseleave="setHold(false)"
    >
      原图
    </button>
  </div>
</template>

<style scoped>
.compare-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.compare-view__panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  min-height: 140px;
}

.compare-view__pane {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.compare-view__label {
  font-size: 11px;
  color: var(--neo-text-muted);
}

.compare-view__frame {
  position: relative;
  display: flex;
  min-height: 120px;
  max-height: 220px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--neo-border);
  border-radius: 12px;
  background: #0a0a0a;
}

.compare-view__image {
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
}

.compare-view__original {
  align-self: flex-start;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--neo-border);
  border-radius: 999px;
  background: var(--neo-hover-bg);
  color: var(--neo-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.compare-view__original:hover {
  color: var(--neo-text-primary);
}
</style>
