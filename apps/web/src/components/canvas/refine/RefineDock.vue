<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  IMAGE2_EDIT_SIZES,
  IMAGE_EDIT_GATEWAY_MODEL_ID,
  IMAGE_EDIT_MODEL_KEYS,
  IMAGE_EDIT_MODEL_PRICING,
  P1_IMAGE_EDIT_MODEL_KEY,
  resolveImageEditProfile,
} from '@lnkpi/shared'
import type { NodeRef } from '@/composables/useNodeRefs'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useClickOutside } from '@/composables/useClickOutside'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockRefStrip from '@/components/canvas/dock-studio/shared/DockRefStrip.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import DockCreditBadge from '@/components/canvas/dock-studio/shared/DockCreditBadge.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import GuidePickerPopover from '@/components/canvas/dock-studio/shared/GuidePickerPopover.vue'

type RefineMode = 'edit' | 'outpaint'

const props = withDefaults(defineProps<{
  prompt: string
  credits: number
  beforeUrl: string
  /** 当前选中的精修模型 key（受控）。白名单见 availableModelKeys。 */
  modelKey: string
  /** 可选尺寸档位（数据驱动；本期单值，后续扩档零改动）。 */
  sizes: readonly string[]
  /** 模型白名单（数据驱动；本期仅 image2）。 */
  availableModelKeys: readonly string[]
  /** 当前尺寸覆盖（'auto' 表示跟随原图）。扩图模式下由父层传 'auto' 并隐藏选择器。 */
  sizeOverride: string | 'auto'
  /** 通道模式：edit 普通精修；outpaint 扩图（Task 7 接线）会隐藏尺寸选择器。 */
  mode?: RefineMode
  /** 扩图模式：是否已产生真实扩出（四向扩展量不全为 0）。未扩出时给引导文案。 */
  outpaintReady?: boolean
  /** 旧只读状态位的展示值，保留作模型 key 的兜底展示名。 */
  modelLabel?: string
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
  outpaintReady: true,
  activeEditIntentId: null, refRoleHints: '',
  mode: 'edit',
  modelKey: P1_IMAGE_EDIT_MODEL_KEY,
  sizes: () => IMAGE2_EDIT_SIZES,
  availableModelKeys: () => IMAGE_EDIT_MODEL_KEYS,
  sizeOverride: 'auto',
  modelLabel: '',
})

const emit = defineEmits<{
  'update:prompt': [value: string]
  'update:modelKey': [value: string]
  'update:sizeOverride': [value: string | 'auto']
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

const modelOpen = ref(false)
const sizeOpen = ref(false)
const selectorsRef = ref<HTMLElement | null>(null)
useClickOutside(selectorsRef, () => {
  modelOpen.value = false
  sizeOpen.value = false
})

/**
 * 精修通道 POST /studio/image/edit 本期接受 model / size / mode（spec §6.1 已放开）。
 * 模型与尺寸从只读状态位升级为数据驱动选择器：白名单/档位均单值，但选择器按多值渲染，
 * 后续扩档只需追加 shared 常量，UI 零改动。
 */
function aspectLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(w, h) || 1
  const rw = Math.round(w / g)
  const rh = Math.round(h / g)
  return rw > 64 || rh > 64 ? `${(w / h).toFixed(2)}:1` : `${rw}:${rh}`
}

/** 原图尺寸信息（§4.3 归位）：静态元信息只进 tooltip，不占 dock 一行高度。 */
const sizeTooltip = computed(() => {
  const w = Number(props.width) || 0
  const h = Number(props.height) || 0
  return w && h ? `输出尺寸跟随原图（原图 ${w}×${h} · ${aspectLabel(w, h)}）` : '输出尺寸跟随原图'
})

/** 尺寸选项 = ['auto', ...sizes] 去重（auto 既可能在 sizes 中也可能不在）。 */
const sizeOptions = computed(() => Array.from(new Set(['auto', ...props.sizes])))

/** credits 按 shared 定价表动态显示，模型不可识别时回落到父层传入值。 */
const creditValue = computed(() => IMAGE_EDIT_MODEL_PRICING[props.modelKey] ?? props.credits)

function modelLabelFor(key: string): string {
  if (key === P1_IMAGE_EDIT_MODEL_KEY) return IMAGE_EDIT_GATEWAY_MODEL_ID
  return props.modelLabel || key
}

const currentModelLabel = computed(() => modelLabelFor(props.modelKey))

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

function selectModel(key: string) {
  emit('update:modelKey', key)
  modelOpen.value = false
}

function selectSize(size: string) {
  emit('update:sizeOverride', size)
  sizeOpen.value = false
}

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
    <DockToolbarShell type="image" :show-close="false">
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
      <p v-if="mode === 'outpaint' && !outpaintReady" class="refine-dock__hint" data-testid="dock-outpaint-hint">
        先拖动画布四周手柄向外扩出画布，扩出区域将由 AI 生成
      </p>
      <p v-if="coverageKind === 'empty'" class="refine-dock__hint">请先圈选要改的区域</p>
      <p v-else-if="coverageKind === 'full'" class="refine-dock__hint refine-dock__hint--warn">
        这会改整张图，更像重新生成；可用底部生成栏
      </p>

      <div v-if="errorMessage" class="refine-dock__error" role="alert">
        <span>{{ errorMessage }}</span>
        <button type="button" class="refine-dock__retry" :disabled="busy" @click="emit('retry')">重试</button>
      </div>

      <div class="bottom-toolbar-actions refine-dock__actions">
        <!-- 模型选择器：白名单数据驱动，切模型 emit update:modelKey -->
        <div ref="selectorsRef" class="refine-dock__select-group">
          <div class="refine-dock__select">
            <button
              type="button"
              class="refine-dock__select-trigger"
              data-testid="dock-model-select"
              :disabled="runDisabled"
              :aria-expanded="modelOpen"
              @click="modelOpen = !modelOpen"
            >
              <span class="refine-dock__chip-k">模型</span>
              <span class="refine-dock__select-value">{{ currentModelLabel }}</span>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="refine-dock__select-caret">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div v-if="modelOpen" class="refine-dock__select-menu" @click.stop>
              <button
                v-for="k in availableModelKeys"
                :key="k"
                type="button"
                class="refine-dock__select-item"
                :class="{ 'is-active': k === modelKey }"
                :data-model-key="k"
                data-testid="dock-model-option"
                @click="selectModel(k)"
              >
                {{ modelLabelFor(k) }}
              </button>
              <p v-if="!availableModelKeys.length" class="refine-dock__select-empty">暂无可选模型</p>
            </div>
          </div>

          <!-- 尺寸选择器：auto + 档位；扩图模式隐藏（mode 钩子，Task 7 接线） -->
          <div v-if="mode !== 'outpaint'" class="refine-dock__select">
            <button
              type="button"
              class="refine-dock__select-trigger"
              data-testid="dock-size-select"
              :title="sizeTooltip"
              :disabled="runDisabled"
              :aria-expanded="sizeOpen"
              @click="sizeOpen = !sizeOpen"
            >
              <span class="refine-dock__chip-k">尺寸</span>
              <span class="refine-dock__select-value">{{ sizeOverride }}</span>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="refine-dock__select-caret">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div v-if="sizeOpen" class="refine-dock__select-menu" @click.stop>
              <button
                v-for="s in sizeOptions"
                :key="s"
                type="button"
                class="refine-dock__select-item"
                :class="{ 'is-active': s === sizeOverride }"
                :data-size="s"
                data-testid="dock-size-option"
                @click="selectSize(s)"
              >
                {{ s }}
              </button>
            </div>
          </div>
        </div>

        <div class="ml-auto flex items-center gap-2">
          <DockMicButton :listening="speech.listening.value" :disabled="runDisabled" @toggle="toggleVoice" />
          <DockCreditBadge :credits="creditValue" />
          <DockGenerateButton
            data-testid="dock-run"
            size="md"
            :label="mode === 'outpaint' ? '扩图生成' : '精修'"
            :disabled="runDisabled"
            @generate="emit('run')"
          />
          <!-- follow-up #2：置灰「抠图」占位按钮已删 —— 规格 §2.2 明确抠图归 M2 能力包（P1-8 不做假 UI）。
               底排“抠图/裁剪”等实体动作入口随 M2 规格回来，届时进工具箱能力组。 -->
          <button v-if="canApply" type="button" class="refine-dock__ghost" data-testid="dock-apply" :disabled="busy" @click="emit('apply')">
            应用到节点
          </button>
        </div>
      </div>
    </DockToolbarShell>
  </div>
</template>

<style scoped>
.refine-dock { display: flex; flex-direction: column; gap: 8px; padding-bottom: 2px; }

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

/* 模型 / 尺寸选择器：沿用 chip 视觉，受控可点 */
.refine-dock__select-group { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.refine-dock__select { position: relative; display: inline-flex; }
.refine-dock__select-trigger {
  display: inline-flex; height: 24px; align-items: center; gap: 4px; padding: 0 8px;
  border: 1px solid var(--neo-border); border-radius: 8px; background: transparent;
  color: var(--neo-text-secondary); font-size: 11px; cursor: pointer;
}
.refine-dock__select-trigger:disabled { opacity: .5; cursor: not-allowed; }
.refine-dock__select-value { font-weight: 500; color: var(--neo-text-primary); }
.refine-dock__select-caret { opacity: .5; }
.refine-dock__select-menu {
  position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 50;
  min-width: 180px; padding: 4px; border: 1px solid var(--neo-border);
  border-radius: 10px; background: var(--neo-surface, #111);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .28);
}
.refine-dock__select-item {
  display: block; width: 100%; text-align: left; padding: 6px 8px;
  border: none; border-radius: 6px; background: transparent;
  color: var(--neo-text-secondary); font-size: 11px; cursor: pointer;
}
.refine-dock__select-item:hover { background: var(--neo-hover-bg, rgba(255, 255, 255, .06)); color: var(--neo-text-primary); }
.refine-dock__select-item.is-active { background: var(--neo-hi-bg, #17181d); color: #fff; }
.refine-dock__select-empty { margin: 0; padding: 6px 8px; color: var(--neo-text-muted); font-size: 11px; }

.refine-dock__hint { margin: 0 12px; color: var(--neo-text-muted); font-size: 11px; }
.refine-dock__hint--warn { color: #e6a23c; }

.refine-dock__error { display: flex; margin: 0 12px; align-items: center; gap: 8px; color: #f56c6c; font-size: 11px; }
.refine-dock__retry { border: 1px solid currentColor; border-radius: 6px; background: transparent; color: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }

.refine-dock__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 12px 10px; }

.refine-dock__ghost {
  height: 28px; padding: 0 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--neo-border); background: transparent; color: var(--neo-text-secondary);
}
.refine-dock__ghost:disabled { opacity: .5; cursor: not-allowed; }
</style>
