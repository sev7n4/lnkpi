<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  useModelProviderSettings,
  PROVIDER_KINDS,
  type ProviderKind,
} from '@/composables/useModelProviderSettings'

const open = defineModel<boolean>({ default: false })

const { settings, resetKind } = useModelProviderSettings()
const activeKind = ref<ProviderKind>('text')
const draft = ref({ apiKey: '', baseUrl: '', model: '' })

watch(
  () => [open.value, activeKind.value] as const,
  () => {
    if (!open.value) return
    const cfg = settings.value[activeKind.value]
    draft.value = { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model }
  },
  { immediate: true },
)

function save() {
  settings.value[activeKind.value] = { ...draft.value }
  open.value = false
}

function onReset() {
  resetKind(activeKind.value)
  const cfg = settings.value[activeKind.value]
  draft.value = { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        @click.self="open = false"
      >
        <div
          class="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1e1e1e] shadow-2xl"
          @click.stop
        >
          <div class="flex items-center justify-between border-b border-white/5 px-5 py-4">
            <div>
              <h2 class="text-sm font-semibold text-white">模型服务配置</h2>
              <p class="mt-0.5 text-[11px] text-white/40">按节点类型配置 API Key、Base URL 与默认 Model</p>
            </div>
            <button type="button" class="text-white/40 hover:text-white/70" @click="open = false">×</button>
          </div>

          <div class="flex border-b border-white/5 px-2">
            <button
              v-for="item in PROVIDER_KINDS"
              :key="item.key"
              type="button"
              class="px-3 py-2.5 text-xs transition"
              :class="activeKind === item.key ? 'border-b-2 border-[#6366f1] text-[#818cf8]' : 'text-white/45 hover:text-white/70'"
              @click="activeKind = item.key"
            >
              {{ item.label }}
            </button>
          </div>

          <div class="space-y-3 p-5">
            <p class="text-[10px] text-white/35">
              {{ PROVIDER_KINDS.find((k) => k.key === activeKind)?.hint }}
            </p>

            <label class="block">
              <span class="mb-1 block text-[11px] text-white/50">API Key</span>
              <input
                v-model="draft.apiKey"
                type="password"
                autocomplete="off"
                class="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#6366f1]/50"
                placeholder="sk-..."
              >
            </label>

            <label class="block">
              <span class="mb-1 block text-[11px] text-white/50">Base URL</span>
              <input
                v-model="draft.baseUrl"
                type="url"
                class="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#6366f1]/50"
                placeholder="https://api.openai.com/v1"
              >
            </label>

            <label class="block">
              <span class="mb-1 block text-[11px] text-white/50">默认 Model</span>
              <input
                v-model="draft.model"
                type="text"
                class="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-[#6366f1]/50"
                placeholder="gpt-4o"
              >
            </label>

            <p class="text-[10px] leading-relaxed text-white/30">
              配置保存在本地浏览器，用于自定义模型网关。留空 API Key 时将使用平台默认服务。
            </p>
          </div>

          <div class="flex items-center justify-between border-t border-white/5 px-5 py-3">
            <button type="button" class="text-xs text-white/40 hover:text-white/60" @click="onReset">
              恢复默认
            </button>
            <div class="flex gap-2">
              <button type="button" class="btn-ghost px-4 py-1.5 text-xs" @click="open = false">取消</button>
              <button type="button" class="btn-primary px-4 py-1.5 text-xs" @click="save">保存</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.18s ease;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
