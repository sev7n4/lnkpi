<script setup lang="ts">
defineProps<{
  generating?: boolean
  disabled?: boolean
  label?: string
}>()

const emit = defineEmits<{
  generate: []
}>()
</script>

<template>
  <button
    type="button"
    class="btn-primary ml-auto px-4 py-1.5 text-xs"
    :disabled="disabled || generating"
    @click="emit('generate')"
  >
    {{ generating ? '生成中...' : (label ?? '生成') }}
  </button>
</template>
