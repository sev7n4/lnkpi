<script setup lang="ts">
defineProps<{ modelValue: string }>()
defineEmits<{ 'update:modelValue': [v: string]; create: []; guide: [] }>()
</script>

<template>
  <div class="rounded-2xl border border-white/[0.08] bg-[#1a1a1a] p-2">
    <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
      <input
        :value="modelValue"
        class="flex-1 rounded-xl bg-transparent px-4 py-3 text-sm outline-none placeholder:text-white/40"
        placeholder="说说你的创意，超创帮你在画布上实现 …"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('create')"
      />
      <div class="flex shrink-0 gap-2">
        <button
          type="button"
          class="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/5"
          @click="$emit('guide')"
        >
          告诉我你的想法
        </button>
        <button
          type="button"
          class="rounded-xl bg-[#6366f1] px-5 py-2.5 text-sm font-medium transition hover:bg-[#818cf8]"
          @click="$emit('create')"
        >
          创建画布
        </button>
      </div>
    </div>
  </div>
</template>
