<script setup lang="ts">
defineProps<{ modelValue: string }>()
defineEmits<{ 'update:modelValue': [v: string]; create: []; guide: [] }>()
</script>

<template>
  <div class="studio-launcher neo-glass-lite rounded-2xl p-2">
    <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
      <input
        :value="modelValue"
        class="studio-launcher-input flex-1 rounded-xl bg-transparent px-4 py-3 text-sm outline-none"
        placeholder="说说你的创意，超创帮你在画布上实现 …"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('create')"
      >
      <div class="flex shrink-0 gap-2">
        <button
          type="button"
          class="studio-launcher-secondary rounded-xl border px-4 py-2.5 text-sm transition"
          @click="$emit('guide')"
        >
          告诉我你的想法
        </button>
        <button
          type="button"
          class="studio-launcher-primary rounded-xl px-5 py-2.5 text-sm font-medium transition"
          @click="$emit('create')"
        >
          创建画布
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.studio-launcher {
  border: 1px solid var(--neo-glass-border);
  box-shadow: var(--neo-glass-shadow);
}

.studio-launcher-input {
  color: var(--neo-text-primary);
}

.studio-launcher-input::placeholder {
  color: var(--neo-text-muted);
}

.studio-launcher-secondary {
  border-color: var(--neo-border);
  color: var(--neo-text-secondary);
}

.studio-launcher-secondary:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.studio-launcher-primary {
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  box-shadow: var(--neo-hi-shadow);
}

.studio-launcher-primary:hover {
  filter: brightness(1.06);
}
</style>
