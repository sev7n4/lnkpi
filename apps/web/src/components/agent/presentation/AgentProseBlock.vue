<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  hasSchemeDraftSections,
  splitAssistantDraftMessage,
  splitSchemeDraftSections,
} from './schemeDraftProse'

const props = defineProps<{
  content: string
}>()

const expanded = ref(false)

const parsed = computed(() => splitAssistantDraftMessage(props.content))
const sections = computed(() => splitSchemeDraftSections(parsed.value.prose))
const isStructured = computed(() => hasSchemeDraftSections(parsed.value.prose))

const visibleSections = computed(() =>
  expanded.value ? sections.value : sections.value.slice(0, 2),
)

const hasHiddenSections = computed(() => sections.value.length > 2)
</script>

<template>
  <div v-if="isStructured" class="agent-prose-block space-y-2" data-testid="agent-prose-block">
    <section
      v-for="section in visibleSections"
      :key="section.heading"
      class="space-y-1"
      :data-section="section.heading"
    >
      <h4 class="text-xs font-medium text-[var(--neo-text)]">{{ section.heading }}</h4>
      <p class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--neo-muted)]">
        {{ section.body }}
      </p>
    </section>
    <button
      v-if="hasHiddenSections"
      type="button"
      class="text-xs text-[var(--neo-accent)] hover:underline"
      data-testid="prose-expand-toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起完整方案' : '展开完整方案' }}
    </button>
    <p
      v-if="parsed.footer"
      class="mt-1 whitespace-pre-wrap text-xs text-[var(--neo-muted)]"
      data-testid="prose-footer"
    >
      {{ parsed.footer }}
    </p>
  </div>
  <p v-else class="whitespace-pre-wrap">
    {{ content }}
  </p>
</template>
