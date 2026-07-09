<script setup lang="ts">
import { computed, ref } from 'vue'

export interface MentionOption {
  id: string
  label: string
  type?: string
}

const props = defineProps<{
  modelValue: string
  mentions: MentionOption[]
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [v: string]; submit: [] }>()

const textareaRef = ref<HTMLTextAreaElement>()
const showMenu = ref(false)
const filterText = ref('')
const selectedIndex = ref(0)
const mentionStart = ref(-1)

const filteredMentions = computed(() => {
  const q = filterText.value.toLowerCase()
  return props.mentions.filter((m) =>
    m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
  ).slice(0, 8)
})

function updateValue(value: string) {
  emit('update:modelValue', value)
}

function detectMention(el: HTMLTextAreaElement) {
  const cursor = el.selectionStart ?? 0
  const before = el.value.slice(0, cursor)
  const match = before.match(/@([^\s@]*)$/)
  if (match) {
    showMenu.value = true
    filterText.value = match[1]
    mentionStart.value = cursor - match[0].length
    selectedIndex.value = 0
  } else {
    showMenu.value = false
    mentionStart.value = -1
  }
}

function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  updateValue(el.value)
  detectMention(el)
}

function insertMention(option: MentionOption) {
  const el = textareaRef.value
  if (!el || mentionStart.value < 0) return
  const cursor = el.selectionStart ?? el.value.length
  const before = el.value.slice(0, mentionStart.value)
  const after = el.value.slice(cursor)
  const token = `@${option.label}`
  const next = `${before}${token} ${after}`
  updateValue(next)
  showMenu.value = false
  requestAnimationFrame(() => {
    const pos = before.length + token.length + 1
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    emit('submit')
    return
  }
  if (!showMenu.value || !filteredMentions.value.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % filteredMentions.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + filteredMentions.value.length) % filteredMentions.value.length
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    insertMention(filteredMentions.value[selectedIndex.value])
  } else if (e.key === 'Escape') {
    showMenu.value = false
  }
}
</script>

<template>
  <div class="relative flex-1">
    <textarea
      ref="textareaRef"
      :value="modelValue"
      class="input-field min-h-[48px] w-full resize-none"
      rows="2"
      :placeholder="placeholder ?? '描述你想要生成的内容，@ 引用节点...'"
      @input="onInput"
      @keydown="onKeydown"
      @click="textareaRef && detectMention(textareaRef)"
    />

    <ul
      v-if="showMenu && filteredMentions.length"
      class="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#242424] py-1 shadow-xl"
    >
      <li
        v-for="(item, idx) in filteredMentions"
        :key="item.id"
        class="cursor-pointer px-3 py-2 text-sm"
        :class="idx === selectedIndex ? 'bg-[#6366f1]/25 text-[#818cf8]' : 'text-white/80 hover:bg-white/5'"
        @mousedown.prevent="insertMention(item)"
      >
        <span class="text-white/40">@</span>{{ item.label }}
        <span v-if="item.type" class="ml-2 text-[10px] text-white/30">{{ item.type }}</span>
      </li>
    </ul>
  </div>
</template>
