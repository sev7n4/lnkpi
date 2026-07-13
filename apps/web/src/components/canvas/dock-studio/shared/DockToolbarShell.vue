<script setup lang="ts">
defineProps<{
  typeLabel: string
  showTitle?: boolean
  title?: string
  titlePlaceholder?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  close: []
  'update:title': [value: string]
}>()
</script>

<template>
  <div
    class="bottom-toolbar-container"
    :class="{ 'is-dock-readonly': readonly }"
    @click.stop
  >
    <div class="bottom-toolbar-header">
      <div class="flex items-center gap-2">
        <span class="bottom-toolbar-type">{{ typeLabel }}</span>
        <input
          v-if="showTitle"
          :value="title"
          class="bottom-toolbar-title-input"
          :placeholder="titlePlaceholder ?? '节点标题'"
          :readonly="readonly"
          @input="emit('update:title', ($event.target as HTMLInputElement).value)"
        >
      </div>
      <button type="button" class="bottom-toolbar-close" aria-label="关闭" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <slot />
  </div>
</template>
