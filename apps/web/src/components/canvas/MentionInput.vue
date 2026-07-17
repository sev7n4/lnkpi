<script setup lang="ts">
import { computed, ref } from 'vue'
import { splitRefMentions } from '@/composables/useRefMentions'

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
const backdropRef = ref<HTMLDivElement>()
const showMenu = ref(false)
const filterText = ref('')
const selectedIndex = ref(0)
const mentionStart = ref(-1)

const highlightSegments = computed(() => splitRefMentions(props.modelValue))

const filteredMentions = computed(() => {
  const q = filterText.value.toLowerCase()
  return props.mentions.filter((m) =>
    m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
  ).slice(0, 8)
})

function updateValue(value: string) {
  emit('update:modelValue', value)
}

function syncBackdropScroll() {
  const el = textareaRef.value
  const backdrop = backdropRef.value
  if (!el || !backdrop) return
  backdrop.scrollTop = el.scrollTop
  backdrop.scrollLeft = el.scrollLeft
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
  syncBackdropScroll()
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
    syncBackdropScroll()
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
    <div class="mention-input-shell">
      <div
        ref="backdropRef"
        class="mention-input-backdrop input-field min-h-[48px] w-full whitespace-pre-wrap break-words text-sm leading-[1.5] text-white/85"
        aria-hidden="true"
      >
        <template v-for="(segment, idx) in highlightSegments" :key="idx">
          <span v-if="segment.kind === 'mention'" class="font-medium text-[#818cf8]">{{ segment.value }}</span>
          <span v-else>{{ segment.value }}</span>
        </template>
        <span v-if="!modelValue">&nbsp;</span>
      </div>

      <textarea
        ref="textareaRef"
        :value="modelValue"
        class="mention-input-field input-field min-h-[48px] w-full resize-none text-sm leading-[1.5] text-transparent caret-white"
        rows="2"
        :placeholder="placeholder ?? '描述你想要生成的内容，@ 引用节点...'"
        @input="onInput"
        @keydown="onKeydown"
        @scroll="syncBackdropScroll"
        @click="textareaRef && detectMention(textareaRef)"
      />
    </div>

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

<style scoped>
.mention-input-shell {
  position: relative;
}

.mention-input-backdrop,
.mention-input-field {
  min-height: 48px;
  padding: 0.625rem 0.75rem;
  border-width: 1px;
  border-style: solid;
}

.mention-input-backdrop {
  pointer-events: none;
  overflow: hidden;
}

.mention-input-field {
  position: absolute;
  inset: 0;
  background: transparent !important;
  box-shadow: none !important;
}
</style>
