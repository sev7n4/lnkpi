<script setup lang="ts">
export type ForceChoiceKind = 'plan_max_revise' | 'copy_max_revise' | 'gen_partial'

const props = defineProps<{
  modelValue: boolean
  kind: ForceChoiceKind | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  action: [message: string]
}>()

const COPY: Record<
  ForceChoiceKind,
  { title: string; body: string; primary: string; secondary?: string }
> = {
  plan_max_revise: {
    title: '方案修订已达上限',
    body: '已修订 3 次。请确认当前方案继续，或关闭后重新描述需求。',
    primary: '确认当前方案',
    secondary: '稍后再说',
  },
  copy_max_revise: {
    title: '文案修订已达上限',
    body: '已修订 3 次。请确认写入当前主文案，或关闭后手动调整。',
    primary: '写入主文案',
    secondary: '稍后再说',
  },
  gen_partial: {
    title: '部分出图未完成',
    body: '部分节点已成功出图，部分失败或需人工处理。可确认已完成结果，或稍后重试失败项。',
    primary: '确认已完成',
    secondary: '稍后处理',
  },
}

const ACTION_MSG: Record<ForceChoiceKind, { primary: string; secondary?: string }> = {
  plan_max_revise: { primary: '1', secondary: '先不确认，我稍后继续' },
  copy_max_revise: { primary: '写入主文案', secondary: '先不写入，我稍后继续' },
  gen_partial: { primary: '确认已完成出图', secondary: '稍后重试失败项' },
}

const meta = () => (props.kind ? COPY[props.kind] : null)

function close() {
  emit('update:modelValue', false)
}

function onPrimary() {
  if (!props.kind) return
  emit('action', ACTION_MSG[props.kind].primary)
  close()
}

function onSecondary() {
  if (!props.kind) return
  const msg = ACTION_MSG[props.kind].secondary
  if (msg) emit('action', msg)
  close()
}
</script>

<template>
  <div
    v-if="modelValue && kind && meta()"
    class="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4"
    @click.self="close"
  >
    <div
      class="w-full max-w-md rounded-2xl border border-white/10 bg-[#1e1e1e] p-5 text-white shadow-2xl"
      role="dialog"
      aria-modal="true"
    >
      <h2 class="text-base font-semibold">{{ meta()!.title }}</h2>
      <p class="mt-3 text-sm leading-relaxed text-white/70">{{ meta()!.body }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          v-if="meta()!.secondary"
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/5"
          @click="onSecondary"
        >
          {{ meta()!.secondary }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-400"
          @click="onPrimary"
        >
          {{ meta()!.primary }}
        </button>
      </div>
    </div>
  </div>
</template>
