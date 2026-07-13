<script setup lang="ts">
import NeoAgentLogo from '@/components/agent/NeoAgentLogo.vue'

defineEmits<{ open: [] }>()
</script>

<template>
  <button
    type="button"
    class="canvas-agent-fab pointer-events-auto fixed bottom-[72px] right-4 z-[55]"
    title="打开 AI 创作助手"
    @click="$emit('open')"
  >
    <NeoAgentLogo />
  </button>
</template>

<style scoped>
.canvas-agent-fab {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
}
</style>
