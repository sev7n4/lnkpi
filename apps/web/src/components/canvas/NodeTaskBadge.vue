<script setup lang="ts">
/** Elapsed-only label; primary chrome lives in NodeTaskCornerActions. */
defineProps<{ elapsedText?: string | null }>()
</script>

<template>
  <span v-if="elapsedText" class="neo-task-elapsed">{{ elapsedText }}</span>
</template>
