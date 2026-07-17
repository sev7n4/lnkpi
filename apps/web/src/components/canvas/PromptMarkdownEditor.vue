<script setup lang="ts">
import { watch, onBeforeUnmount, shallowRef } from 'vue'
import { EditorContent, Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Typography from '@tiptap/extension-typography'
import { Markdown } from 'tiptap-markdown'
import type { MarkdownStorage } from 'tiptap-markdown'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import './PromptMarkdownEditor.css'

const props = defineProps<{ visible: boolean; modelValue: string }>()
const emit = defineEmits<{
  'update:visible': [boolean]
  'update:modelValue': [string]
  save: [string]
}>()

const speech = useSpeechRecognition()
const editor = shallowRef<Editor>()
let saveTimer: ReturnType<typeof setTimeout> | null = null

function getMarkdown(): string {
  const storage = editor.value?.storage as { markdown?: MarkdownStorage } | undefined
  return storage?.markdown?.getMarkdown?.() ?? ''
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const md = getMarkdown()
  emit('update:modelValue', md)
  emit('save', md)
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSave, 400)
}

function ensureEditor() {
  if (editor.value) return
  editor.value = new Editor({
    extensions: [
      StarterKit,
      Typography,
      Placeholder.configure({ placeholder: '输入或生成提示词内容...' }),
      Markdown.configure({ html: false }),
    ],
    content: props.modelValue || '',
    onUpdate: () => scheduleSave(),
  })
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      ensureEditor()
      editor.value?.commands.setContent(props.modelValue || '')
      setTimeout(() => editor.value?.commands.focus('end'), 50)
    } else {
      speech.stop()
    }
  },
)

function close() {
  speech.stop()
  flushSave()
  emit('update:visible', false)
}

function copyAll() {
  void navigator.clipboard.writeText(getMarkdown())
}

function toggleVoice() {
  if (speech.listening.value) {
    speech.stop()
    return
  }
  speech.start((text, isFinal) => {
    if (!isFinal || !editor.value) return
    editor.value.chain().focus().insertContent(text).run()
    scheduleSave()
  })
}

function isActive(name: string, attrs?: Record<string, unknown>) {
  return editor.value?.isActive(name, attrs) ?? false
}

onBeforeUnmount(() => {
  speech.stop()
  if (saveTimer) clearTimeout(saveTimer)
  editor.value?.destroy()
  editor.value = undefined
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="prompt-md-overlay" @click.self="close">
      <div class="prompt-md-modal" @click.stop>
        <div class="prompt-md-toolbar">
          <div class="prompt-md-format-group">
            <button
              type="button"
              class="prompt-md-format-btn"
              :class="{ 'is-active': isActive('heading', { level: 1 }) }"
              title="标题 1"
              @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
            >
              H1
            </button>
            <button
              type="button"
              class="prompt-md-format-btn"
              :class="{ 'is-active': isActive('heading', { level: 2 }) }"
              title="标题 2"
              @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
            >
              H2
            </button>
            <button
              type="button"
              class="prompt-md-format-btn"
              :class="{ 'is-active': isActive('heading', { level: 3 }) }"
              title="标题 3"
              @click="editor?.chain().focus().toggleHeading({ level: 3 }).run()"
            >
              H3
            </button>
            <button
              type="button"
              class="prompt-md-format-btn"
              :class="{ 'is-active': isActive('bold') }"
              title="粗体"
              @click="editor?.chain().focus().toggleBold().run()"
            >
              B
            </button>
            <button
              type="button"
              class="prompt-md-format-btn"
              :class="{ 'is-active': isActive('italic') }"
              title="斜体"
              @click="editor?.chain().focus().toggleItalic().run()"
            >
              I
            </button>
            <button
              type="button"
              class="prompt-md-format-btn"
              :class="{ 'is-active': isActive('bulletList') }"
              title="无序列表"
              @click="editor?.chain().focus().toggleBulletList().run()"
            >
              •
            </button>
            <button
              type="button"
              class="prompt-md-format-btn"
              title="分隔线"
              @click="editor?.chain().focus().setHorizontalRule().run()"
            >
              —
            </button>
          </div>

          <div class="prompt-md-spacer" />

          <div class="prompt-md-actions">
            <button
              type="button"
              class="dock-icon-btn"
              title="语音输入"
              :class="speech.listening.value ? 'animate-pulse text-red-400' : ''"
              @click="toggleVoice"
            >
              🎤
            </button>
            <button type="button" class="btn-primary text-xs" @click="copyAll">复制</button>
            <button type="button" class="prompt-md-btn-secondary" @click="close">关闭</button>
          </div>
        </div>

        <EditorContent :editor="editor" class="prompt-md-editor" />
      </div>
    </div>
  </Teleport>
</template>
