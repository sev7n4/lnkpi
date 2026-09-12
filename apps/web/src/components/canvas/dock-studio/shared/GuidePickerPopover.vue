<script setup lang="ts">
import {
  GUIDE_GROUP_ORDER,
  listEditIntents,
  listGenerationScenes,
  type EditIntent,
  type GenerationScene,
  type GuideCapabilities,
  type GuideKind,
} from '@lnkpi/shared'
import { computed, nextTick, onUnmounted, ref, watch, type CSSProperties } from 'vue'
import { guidePickerDisabledReason } from './guidePickerDisable'
import { filterGuideItems, groupGuideItems } from './guidePickerFilter'

type GuideItem = GenerationScene | EditIntent

const props = withDefaults(
  defineProps<{
    mode: GuideKind
    activeId: string | null
    capabilities: GuideCapabilities
    open: boolean
    refImageCount?: number
    placement?: 'below-start' | 'below-end' | 'above-end'
    /** Escape overflow:auto ancestors (e.g. Refine side panel body). */
    portal?: boolean
    /** Required when portal=true — position relative to this element. */
    anchorEl?: HTMLElement | null
  }>(),
  {
    refImageCount: 0,
    placement: 'below-start',
    portal: false,
    anchorEl: null,
  },
)

const emit = defineEmits<{
  select: [id: string]
  clear: []
  close: []
}>()

const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const portalStyle = ref<CSSProperties>({})

const items = computed<GuideItem[]>(() =>
  props.mode === 'generation_scene'
    ? listGenerationScenes()
    : listEditIntents(),
)

const groups = computed(() =>
  groupGuideItems(
    filterGuideItems(items.value, query.value),
    GUIDE_GROUP_ORDER,
  ),
)

const searchPlaceholder = computed(() =>
  props.mode === 'generation_scene' ? '搜索场景…' : '搜索编辑意图…',
)

const clearLabel = computed(() =>
  props.mode === 'generation_scene' ? '清除场景' : '清除意图',
)

const POPOVER_WIDTH = 288
const VIEW_MARGIN = 12
const GAP = 8
const EST_HEIGHT = 340

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function updatePortalPosition() {
  if (!props.portal || !props.anchorEl || typeof window === 'undefined') return
  const rect = props.anchorEl.getBoundingClientRect()
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEW_MARGIN * 2)
  const measured = panelRef.value?.getBoundingClientRect().height
  const height = measured && measured > 0 ? measured : EST_HEIGHT

  let top: number
  const preferBelow = props.placement !== 'above-end'
  const spaceBelow = window.innerHeight - rect.bottom - GAP - VIEW_MARGIN
  const spaceAbove = rect.top - GAP - VIEW_MARGIN
  const placeBelow = preferBelow
    ? spaceBelow >= Math.min(height, 200) || spaceBelow >= spaceAbove
    : spaceAbove < Math.min(height, 200) && spaceBelow > spaceAbove

  if (placeBelow) {
    top = rect.bottom + GAP
  } else {
    top = rect.top - height - GAP
  }

  let left =
    props.placement === 'below-start'
      ? rect.left
      : rect.right - width

  left = clamp(left, VIEW_MARGIN, window.innerWidth - width - VIEW_MARGIN)
  top = clamp(top, VIEW_MARGIN, window.innerHeight - VIEW_MARGIN)

  portalStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    zIndex: 120,
    right: 'auto',
    bottom: 'auto',
  }
}

function handleWindowEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  emit('close')
}

function onViewportChange() {
  updatePortalPosition()
}

watch(
  () => props.open,
  (open, _prev, onCleanup) => {
    if (!open) return
    query.value = ''
    void nextTick(() => {
      searchInput.value?.focus()
      updatePortalPosition()
      void nextTick(() => updatePortalPosition())
    })
    window.addEventListener('keydown', handleWindowEscape, { capture: true })
    if (props.portal) {
      window.addEventListener('resize', onViewportChange)
      window.addEventListener('scroll', onViewportChange, true)
    }
    onCleanup(() => {
      window.removeEventListener('keydown', handleWindowEscape, { capture: true })
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    })
  },
  { immediate: true },
)

watch(
  () => [props.anchorEl, props.placement, props.portal] as const,
  () => {
    if (props.open) updatePortalPosition()
  },
)

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowEscape, { capture: true })
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})

function disabledReason(id: string): string | null {
  return guidePickerDisabledReason(props.mode, id, props.capabilities)
}

function selectItem(item: GuideItem) {
  if (disabledReason(item.id)) return
  emit('select', item.id)
  emit('close')
}

function onEscape(event: KeyboardEvent) {
  event.stopPropagation()
  emit('close')
}
</script>

<template>
  <Teleport to="body" :disabled="!portal">
    <section
      v-if="open"
      ref="panelRef"
      class="guide-picker-popover neo-popover"
      :class="[
        `guide-picker-popover--${placement}`,
        { 'guide-picker-popover--portal': portal },
      ]"
      :style="portal ? portalStyle : undefined"
      role="dialog"
      :aria-label="mode === 'generation_scene' ? '选择生成场景' : '选择编辑意图'"
      @keydown.escape.prevent="onEscape"
    >
      <div class="guide-picker-popover__search">
        <span aria-hidden="true" class="guide-picker-popover__search-icon">⌕</span>
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          class="guide-picker-popover__input"
          :placeholder="searchPlaceholder"
          autocomplete="off"
        />
      </div>

      <div class="guide-picker-popover__list">
        <template v-if="groups.length">
          <section
            v-for="group in groups"
            :key="group.groupId"
            class="guide-picker-popover__group"
          >
            <h3 class="guide-picker-popover__group-label">
              {{ group.groupLabel }}
            </h3>
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              class="guide-picker-popover__item neo-popover-item"
              :class="{ 'is-active': activeId === item.id }"
              :disabled="Boolean(disabledReason(item.id))"
              :title="disabledReason(item.id) || item.description"
              :aria-current="activeId === item.id ? 'true' : undefined"
              @click="selectItem(item)"
            >
              <span class="guide-picker-popover__item-copy">
                <span class="guide-picker-popover__item-label">
                  {{ item.label }}
                </span>
                <span class="guide-picker-popover__item-description">
                  {{ item.description }}
                </span>
              </span>
              <span
                v-if="disabledReason(item.id)"
                class="guide-picker-popover__disabled"
              >
                不可用
              </span>
              <span
                v-else-if="activeId === item.id"
                class="guide-picker-popover__active-mark"
                aria-hidden="true"
              >
                ✓
              </span>
            </button>
          </section>
        </template>
        <p v-else class="guide-picker-popover__empty">没有匹配结果</p>
      </div>

      <footer v-if="activeId" class="guide-picker-popover__footer">
        <button
          type="button"
          class="guide-picker-popover__clear"
          @click="emit('clear')"
        >
          {{ clearLabel }}
        </button>
      </footer>
    </section>
  </Teleport>
</template>

<style scoped>
.guide-picker-popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 50;
  width: min(288px, calc(100vw - 24px));
  overflow: hidden;
  border-radius: 16px;
}

.guide-picker-popover--below-end {
  top: calc(100% + 8px);
  right: 0;
  left: auto;
}

.guide-picker-popover--above-end {
  top: auto;
  right: 0;
  bottom: calc(100% + 8px);
  left: auto;
}

.guide-picker-popover--portal {
  /* Inline style supplies fixed top/left/width; reset absolute placement. */
  top: auto;
  right: auto;
  bottom: auto;
  left: auto;
}

.guide-picker-popover__search {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 8px;
  padding: 0 10px;
  border: 1px solid var(--neo-border);
  border-radius: 10px;
  background: var(--neo-hover-bg);
  color: var(--neo-text-muted);
}

.guide-picker-popover__search:focus-within {
  border-color: var(--neo-border-strong);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-hi-text) 10%, transparent);
}

.guide-picker-popover__search-icon {
  flex-shrink: 0;
  font-size: 16px;
  line-height: 1;
}

.guide-picker-popover__input {
  min-width: 0;
  width: 100%;
  height: 34px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--neo-text-primary);
  font-size: 12px;
}

.guide-picker-popover__input::placeholder {
  color: var(--neo-text-muted);
}

.guide-picker-popover__input::-webkit-search-cancel-button {
  opacity: 0.6;
}

.guide-picker-popover__list {
  max-height: 280px;
  overflow-y: auto;
  padding: 0 6px 6px;
}

.guide-picker-popover__group + .guide-picker-popover__group {
  margin-top: 5px;
}

.guide-picker-popover__group-label {
  margin: 0;
  padding: 7px 8px 4px;
  color: var(--neo-text-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.guide-picker-popover__item {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.guide-picker-popover__item.is-active {
  border-color: color-mix(in srgb, var(--neo-hi-text) 18%, transparent);
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  box-shadow: var(--neo-hi-shadow);
}

.guide-picker-popover__item:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.guide-picker-popover__item:disabled:hover {
  background: transparent;
  color: var(--neo-text-secondary);
}

.guide-picker-popover__item-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.guide-picker-popover__item-label {
  overflow: hidden;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guide-picker-popover__item-description {
  overflow: hidden;
  color: var(--neo-text-muted);
  font-size: 10px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.guide-picker-popover__disabled,
.guide-picker-popover__active-mark {
  flex-shrink: 0;
  font-size: 10px;
}

.guide-picker-popover__disabled {
  color: var(--neo-text-muted);
}

.guide-picker-popover__active-mark {
  color: var(--neo-hi-text);
  font-weight: 700;
}

.guide-picker-popover__empty {
  margin: 0;
  padding: 24px 8px;
  color: var(--neo-text-muted);
  font-size: 12px;
  text-align: center;
}

.guide-picker-popover__footer {
  padding: 7px 8px;
  border-top: 1px solid var(--neo-border);
}

.guide-picker-popover__clear {
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.guide-picker-popover__clear:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}
</style>
