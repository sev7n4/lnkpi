<script setup lang="ts">
import { computed } from 'vue'
import type { ProductVisualPlan } from './agentInterruptGate'

export interface DeliveryGenItem {
  node_id?: string | null
  url?: string | null
  title?: string | null
}

const props = defineProps<{
  plan: ProductVisualPlan
  genByKey: Record<string, DeliveryGenItem>
  selections: Record<string, string>
  requestLabels?: string[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  switchScheme: [typeId: string, schemeId: string]
  refineType: [typeId: string, feedback: string]
  confirmAll: []
}>()

function schemeKey(typeId: string, schemeId: string) {
  return `${typeId}__${schemeId}`
}

function candidateSchemes(typeId: string, schemes: ProductVisualPlan['image_types'][number]['schemes']) {
  return (schemes ?? []).filter((scheme) => props.genByKey[schemeKey(typeId, scheme.scheme_id)])
}

const imageTypes = computed(() =>
  (props.plan.image_types ?? []).filter((imageType) =>
    candidateSchemes(imageType.type_id, imageType.schemes).length > 0,
  ),
)

const refineDraft = defineModel<Record<string, string>>('refineDraft', { default: () => ({}) })

function previewLabel(typeId: string, schemeId: string) {
  const item = props.genByKey[schemeKey(typeId, schemeId)]
  return item?.title || schemeId
}

function isSelected(typeId: string, schemeId: string) {
  return props.selections[typeId] === schemeId
}

function onSwitch(typeId: string, schemeId: string) {
  if (props.disabled || isSelected(typeId, schemeId)) return
  emit('switchScheme', typeId, schemeId)
}

function onRefine(typeId: string) {
  if (props.disabled) return
  emit('refineType', typeId, (refineDraft.value[typeId] ?? '').trim())
}

function groupTitle(imageType: ProductVisualPlan['image_types'][number], index: number) {
  return props.requestLabels?.[index] ?? imageType.type_label
}

function groupSubtitle(imageType: ProductVisualPlan['image_types'][number]) {
  const selectedId = props.selections[imageType.type_id]
  const scheme = (imageType.schemes ?? []).find((s) => s.scheme_id === selectedId)
  return scheme?.name || selectedId || ''
}

const finalizeCount = computed(() => imageTypes.value.length)

function onConfirmAll() {
  if (props.disabled) return
  emit('confirmAll')
}
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs text-[var(--neo-muted)]">按类型选择定稿图；切换候选不会重新生成。</p>
    <div
      v-for="(imageType, index) in imageTypes"
      :key="imageType.type_id"
      class="rounded-lg border border-[var(--neo-border)] p-2"
    >
      <div class="mb-0.5 text-xs font-medium">{{ groupTitle(imageType, index) }}</div>
      <div v-if="groupSubtitle(imageType)" class="mb-1.5 text-[10px] text-[var(--neo-muted)]">
        {{ groupSubtitle(imageType) }}
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="scheme in candidateSchemes(imageType.type_id, imageType.schemes)"
          :key="scheme.scheme_id"
          type="button"
          class="neo-ctl flex min-w-[88px] max-w-[120px] flex-col items-stretch rounded-lg p-1.5 text-left text-[10px]"
          :class="{
            'ring-2 ring-[var(--neo-accent)]': isSelected(imageType.type_id, scheme.scheme_id),
          }"
          :disabled="disabled"
          @click="onSwitch(imageType.type_id, scheme.scheme_id)"
        >
          <div
            class="mb-1 flex h-16 items-center justify-center overflow-hidden rounded bg-[var(--neo-surface-2)] text-[var(--neo-muted)]"
          >
            <img
              v-if="genByKey[schemeKey(imageType.type_id, scheme.scheme_id)]?.url"
              :src="genByKey[schemeKey(imageType.type_id, scheme.scheme_id)]?.url || undefined"
              :alt="previewLabel(imageType.type_id, scheme.scheme_id)"
              class="h-full w-full object-cover"
            />
            <span v-else>{{ previewLabel(imageType.type_id, scheme.scheme_id).slice(0, 8) }}</span>
          </div>
          <span class="font-medium">{{ scheme.name || scheme.scheme_id }}</span>
          <span v-if="scheme.recommended" class="text-[var(--neo-accent)]">推荐</span>
        </button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <input
          v-model="refineDraft[imageType.type_id]"
          type="text"
          class="neo-ctl min-w-0 flex-1 rounded-lg px-2 py-1 text-xs"
          placeholder="微调说明（可选）"
          :disabled="disabled"
        />
        <button
          type="button"
          class="neo-ctl rounded-lg px-2 py-1 text-xs"
          :disabled="disabled"
          @click="onRefine(imageType.type_id)"
        >
          微调重绘
        </button>
      </div>
    </div>
    <p v-if="finalizeCount > 0" class="text-xs text-[var(--neo-muted)]">
      确认后将交付 {{ finalizeCount }} 张定稿图
    </p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
        :disabled="disabled"
        @click="onConfirmAll"
      >
        确认全部定稿
      </button>
    </div>
  </div>
</template>
