<script setup lang="ts">
import { ref } from 'vue'
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

const mentionInputRef = ref<InstanceType<typeof MentionInput> | null>(null)

function insertRefMention(refKey: string) {
  const token = `@${refKey} `
  mentionInputRef.value?.insertText(token)
  mentionInputRef.value?.focus()
}

defineExpose({ insertRefMention, focus: () => mentionInputRef.value?.focus() })
</script>

<template>
  <div class="prompt-input-section">
    <MentionInput
      ref="mentionInputRef"
      :model-value="modelValue"
      :mentions="mentions ?? []"
      :placeholder="placeholder ?? '描述生成内容，@ 引用节点...'"
      @update:model-value="emit('update:modelValue', $event)"
      @submit="emit('submit')"
    />
  </div>
</template>
