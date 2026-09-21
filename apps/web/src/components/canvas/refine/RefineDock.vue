<script setup lang="ts">
import { computed, ref } from 'vue'
import { resolveImageEditProfile } from '@lnkpi/shared'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import GuidePickerPopover from '@/components/canvas/dock-studio/shared/GuidePickerPopover.vue'

const props = withDefaults(defineProps<{
  prompt: string
  credits: number
  beforeUrl: string
  /** 该精修通道实际使用的模型（服务端写死，所以是只读状态位） */
  modelLabel: string
  busy?: boolean
  disabled?: boolean
  canApply?: boolean
  errorMessage?: string
  coverageKind?: 'ok' | 'empty' | 'full'
  width?: number
  height?: number
  activeEditIntentId?: string | null
  refRoleHints?: string
}>(), {
  busy: false, disabled: false, canApply: false, coverageKind: 'ok',
  activeEditIntentId: null, refRoleHints: '',
})

const emit = defineEmits<{
  'update:prompt': [value: string]
  run: []
  apply: []
  retry: []
  close: []
  selectEditIntent: [id: string]
  clearEditIntent: []
}>()

const speech = useSpeechRecognition()
const promptSectionRef = ref<InstanceType<typeof DockPromptSection> | null>(null)
const editIntentAnchorRef = ref<HTMLElement | null>(null)
const editIntentPickerOpen = ref(false)

/**
 * 精修通道 POST /studio/image/edit 只接受 prompt / imageUrl / maskUrl，
 * 不接受模型、尺寸与参考图（spec §6.1）。所以这里如实呈现为只读状态位，
 * 不做「点了也没用」的控件。
 */
function aspectLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(w, h) || 1
  const rw = Math.round(w / g)
  const rh = Math.round(h / g)
  return rw > 64 || rh > 64 ? `${(w / h).toFixed(2)}:1` : `${rw}:${rh}`
}

const sizeLabel = computed(() => {
  const w = Number(props.width) || 0
  const h = Number(props.height) || 0
  if (!w || !h) return '原始尺寸'
  return `${w}×${h} · ${aspectLabel(w, h)}`
})

const workRefs = computed<NodeRef[]>(() => [{
  refId: 'refine-work-image',
  refKey: 'I1',
  mediaType: 'image',
  sourceKind: 'asset',
  label: '原图',
  preview: props.beforeUrl,
  payload: { url: props.beforeUrl },
}])

/**
 * GuidePickerPopover 需要 capabilities。精修通道复用语义上与图片编辑同构的能力集，
 * 直接取本通道的模型 profile（与 RefineSidePanel 一致），不增新能力。
 */
const guideCapabilities = resolveImageEditProfile().capabilities ?? {
  transparentBackground: false,
  qualityParam: true,
  maxRefImages: 4,
}

const runDisabled = computed(() => props.busy || props.disabled)

function toggleVoice() {
  if (speech.listening.value) { speech.stop(); return }
  speech.start((text, isFinal) => {
    if (!isFinal) return
    emit('update:prompt', props.prompt ? `${props.prompt} ${text}` : text)
  })
}
</script>

<template>
  <div class="refine-dock" data-testid="refine-dock">
    <DockToolbarShell type="image" :show-close="true" @close="emit('close')">
      <template #header-end>
        <div class="relative">
          <button
            ref="editIntentAnchorRef"
            type="button"
            class="refine-dock__intent"
            :class="{ 'is-active': activeEditIntentId }"
            data-testid="dock-edit-intent"
            :disabled="runDisabled"
            aria-label="编辑意图"
            :aria-expanded="editIntentPickerOpen"
            @click="editIntentPickerOpen = !editIntentPickerOpen"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" />
              <rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" />
            </svg>
            <span>编辑意图</span>
          </button>
          <GuidePickerPopover
            mode="edit_intent"
            :active-id="activeEditIntentId"
            :capabilities="guideCapabilities"
            :open="editIntentPickerOpen"
            :anchor-el="editIntentAnchorRef"
            placement="below-end"
            portal
            @select="emit('selectEditIntent', $event); editIntentPickerOpen = false"
            @clear="emit('clearEditIntent'); editIntentPickerOpen = false"
            @close="editIntentPickerOpen = false"
          />
        </div>
      </template>

      <!-- 参考条：只读展示这张工作图。精修通道暂不接受附加参考图，所以不给 + 上传。 -->
      <DockRefStrip :refs="workRefs" @mention="promptSectionRef?.insertRefMention($event)" />

      <DockPromptSection
        ref="promptSectionRef"
        :model-value="prompt"
        placeholder="改这里：……"
        @update:model-value="emit('update:prompt', $event)"
        @submit="emit('run')"
      />

      <p v-if="refRoleHints" class="refine-dock__hint">参考图：{{ refRoleHints }}</p>
      <p v-if="coverageKind === 'empty'" class="refine-dock__hint">请先圈选要改的区域</p>
      <p v-else-if="coverageKind === 'full'" class="refine-dock__hint refine-dock__hint--warn">
        这会改整张图，更像重新生成；可用底部生成栏
      </p>

      <div v-if="errorMessage" class="refine-dock__error" role="alert">
        <span>{{ errorMessage }}</span>
        <button type="button" class="refine-dock__retry" :disabled="busy" @click="emit('retry')">重试</button>
      </div>

      <div class="bottom-toolbar-actions refine-dock__actions">
        <span class="refine-dock__chip" data-testid="dock-model-chip" :title="`精修通道模型：${modelLabel}`">
          <span class="refine-dock__chip-k">模型</span>{{ modelLabel }}
        </span>
        <span class="refine-dock__chip" data-testid="dock-size-chip" title="输出尺寸跟随原图">
          <span class="refine-dock__chip-k">尺寸</span>{{ sizeLabel }}
        </span>

        <div class="ml-auto flex items-center gap-2">
          <DockMicButton :listening="speech.listening.value" :disabled="runDisabled" @toggle="toggleVoice" />
          <DockCreditBadge :credits="credits" />
          <button type="button" class="refine-dock__primary" data-testid="dock-run" :disabled="runDisabled" @click="emit('run')">
            精修
          </button>
          <button type="button" class="refine-dock__ghost" disabled title="抠图将走专用通道，尚未接入">抠图</button>
          <button v-if="canApply" type="button" class="refine-dock__ghost" data-testid="dock-apply" :disabled="busy" @click="emit('apply')">
            应用到节点
          </button>
        </div>
      </div>
    </DockToolbarShell>
  </div>
</template>

<style scoped>
/* 精修右栏只有 400px，必须解除横版底栏的 600px 最小宽（styles/neo-node.css:1051） */
.refine-dock :deep(.bottom-toolbar-container) { min-width: 0; width: 100%; }
/* 横版底栏的 -32px/-40px 出血光晕在竖版里会溢出 */
.refine-dock :deep(.bottom-toolbar-container)::after { display: none; }

.refine-dock__intent {
  display: inline-flex; height: 24px; align-items: center; gap: 4px; padding: 0 8px;
  border: 1px solid var(--neo-border); border-radius: 8px; background: transparent;
  color: var(--neo-text-secondary); font-size: 11px; cursor: pointer;
}
.refine-dock__intent.is-active { background: rgba(0, 89, 179, .18); color: #7cc0ff; }
.refine-dock__intent:disabled { opacity: .5; cursor: not-allowed; }

.refine-dock__chip {
  display: inline-flex; height: 24px; align-items: center; gap: 4px; padding: 0 8px;
  border: 1px dashed var(--neo-border); border-radius: 8px;
  color: var(--neo-text-secondary); font-size: 11px;
}
.refine-dock__chip-k { color: var(--neo-text-muted); }

.refine-dock__hint { margin: 0 12px 6px; color: var(--neo-text-muted); font-size: 11px; }
.refine-dock__hint--warn { color: #e6a23c; }

.refine-dock__error { display: flex; margin: 0 12px 6px; align-items: center; gap: 8px; color: #f56c6c; font-size: 11px; }
.refine-dock__retry { border: 1px solid currentColor; border-radius: 6px; background: transparent; color: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }

.refine-dock__actions { flex-wrap: wrap; }

.refine-dock__primary,
.refine-dock__ghost { height: 28px; padding: 0 12px; border-radius: 8px; font-size: 12px; cursor: pointer; }
.refine-dock__primary { border: none; background: var(--neo-hi-bg, #17181d); color: #fff; font-weight: 600; }
.refine-dock__primary:disabled { opacity: .45; cursor: not-allowed; }
.refine-dock__ghost { border: 1px solid var(--neo-border); background: transparent; color: var(--neo-text-secondary); }
.refine-dock__ghost:disabled { opacity: .5; cursor: not-allowed; }
</style>
