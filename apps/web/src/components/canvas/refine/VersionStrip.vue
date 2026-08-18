<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ImageVersionEntry } from '@lnkpi/shared'

const props = withDefaults(
  defineProps<{
    versions: ImageVersionEntry[]
    currentVersionId?: string
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  select: [versionId: string]
  revert: [payload: { versionId: string }]
}>()

const selectedId = ref<string | null>(null)

const visibleVersions = computed(() => props.versions.slice(-8))
const hiddenCount = computed(() => Math.max(0, props.versions.length - 8))

const activeId = computed(
  () => selectedId.value ?? props.currentVersionId ?? visibleVersions.value.at(-1)?.id,
)

function onSelect(id: string) {
  if (props.disabled) return
  selectedId.value = id
  emit('select', id)
}

function onRevert() {
  if (props.disabled || !activeId.value) return
  emit('revert', { versionId: activeId.value })
}
</script>

<template>
  <div v-if="versions.length" class="version-strip">
    <div class="version-strip__thumbs">
      <button
        v-for="version in visibleVersions"
        :key="version.id"
        type="button"
        class="version-strip__thumb"
        :class="{ 'is-active': version.id === activeId }"
        :title="version.source"
        :disabled="disabled"
        @click="onSelect(version.id)"
      >
        <img :src="version.url" alt="">
      </button>
      <span v-if="hiddenCount > 0" class="version-strip__more">更多</span>
    </div>
    <button
      type="button"
      class="version-strip__revert"
      :disabled="disabled || !activeId"
      @click="onRevert"
    >
      恢复此版本
    </button>
  </div>
</template>

<style scoped>
.version-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.version-strip__thumbs {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
}

.version-strip__thumb {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--neo-border);
  border-radius: 8px;
  background: #111;
  cursor: pointer;
}

.version-strip__thumb.is-active {
  border-color: var(--neo-hi-bg, #f5b042);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--neo-hi-bg, #f5b042) 50%, transparent);
}

.version-strip__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.version-strip__more {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--neo-text-muted);
}

.version-strip__revert {
  flex-shrink: 0;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--neo-border);
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.version-strip__revert:disabled,
.version-strip__thumb:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
