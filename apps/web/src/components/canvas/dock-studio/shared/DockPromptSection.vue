<script setup lang="ts">
import MentionInput, { type MentionOption } from '@/components/canvas/MentionInput.vue'

defineProps<{
  modelValue: string
  mentions?: MentionOption[]
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()
</script>

<template>
  <div class="prompt-input-section">
    <MentionInput
      :model-value="modelValue"
      :mentions="mentions ?? []"
      :placeholder="placeholder ?? '描述生成内容，@ 引用节点...'"
      @update:model-value="emit('update:modelValue', $event)"
      @submit="emit('submit')"
    />
  </div>
</template>
