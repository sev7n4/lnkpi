<script setup lang="ts">
import { BYOK_FALLBACK_CONFIRM_MESSAGE } from '@lnkpi/shared'

const props = defineProps<{
  modelValue: boolean
  message?: string
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
  cancel: []
}>()

const displayMessage = () => props.message?.trim() || BYOK_FALLBACK_CONFIRM_MESSAGE

function onConfirm() {
  if (props.loading) return
  emit('confirm')
}

function onCancel() {
  if (props.loading) return
  emit('cancel')
  emit('update:modelValue', false)
}
</script>

<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4"
    @click.self="onCancel"
  >
    <div
      class="w-full max-w-md rounded-2xl border border-white/10 bg-[#1e1e1e] p-5 text-white shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="byok-fallback-title"
    >
      <h2 id="byok-fallback-title" class="text-base font-semibold">渠道回退确认</h2>
      <p class="mt-3 text-sm leading-relaxed text-white/70">
        {{ displayMessage() }}
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/5"
          :disabled="loading"
          @click="onCancel"
        >
          取消
        </button>
        <button
          type="button"
          class="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-50"
          :disabled="loading"
          @click="onConfirm"
        >
          {{ loading ? '处理中…' : '继续' }}
        </button>
      </div>
    </div>
  </div>
</template>
