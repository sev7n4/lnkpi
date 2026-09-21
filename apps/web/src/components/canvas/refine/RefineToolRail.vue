<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import type { RefineMaskTool } from '@/stores/canvasEditor'
import {
  REFINE_COMPARE_OPTIONS, REFINE_FIT_OPTIONS, REFINE_INPUT_GROUPS, REFINE_VIEW_TOOLS, REFINE_ZOOM_ACTIONS,
  inputToolActive,
  type RefineFitOptionId, type RefineInputGroupId, type RefineToolCommand,
} from './refineToolRailModel'

const props = withDefaults(defineProps<{
  /** 是否已有「处理后」版本；没有则对照两项置灰（spec P0-4） */
  hasAfter?: boolean
  /** 蒙版历史栈深（follow-up #13）：由 MaskEditor 经 viewport 下发 */
  canUndo?: boolean
  canRedo?: boolean
}>(), { hasAfter: true, canUndo: false, canRedo: false })

const emit = defineEmits<{
  fit: []
  /** 原始比例 1:1 —— 模板里写 @actual-size */
  actualSize: []
  zoomIn: []
  zoomOut: []
  undo: []
  redo: []
}>()

const editor = useCanvasEditorStore()
const railRef = ref<HTMLElement | null>(null)

/** 同一时刻只允许一个二级菜单展开 */
type OpenMenu = { kind: 'input'; id: RefineInputGroupId } | { kind: 'view'; id: 'compare' | 'fit' } | null
const openMenu = ref<OpenMenu>(null)

function onDocPointerDown(event: PointerEvent) {
  const el = railRef.value
  if (!el) return
  if (el.contains(event.target as Node)) return
  openMenu.value = null
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true))

const GLYPH: Record<RefineInputGroupId, string> = { smart: '◉', marquee: '▢', paint: '✎' }

/** 二级菜单里的工具项只留图标（follow-up #11/#12），文字进 title / aria-label */
const VARIANT_ICONS: Record<RefineMaskTool, string[]> = {
  point: ['M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z', 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z'],
  wand: ['M6 18.5 17 7.5', 'M15.5 4.5l4 4', 'M5 15.5l3.5 3.5', 'M17.5 6.5l1 1'],
  rect: ['M4 5.5h16v13H4z'],
  polygon: ['M12 3.5l8.5 6.2-3.2 10H6.7L3.5 9.7z'],
  brush: ['M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z', 'M14.8 6.6l2.6 2.6'],
  eraser: ['M5 15.2l7.4-7.4a1.6 1.6 0 0 1 2.3 0l3.9 3.9a1.6 1.6 0 0 1 0 2.3L13.5 19H8.6z', 'M5 19.5h14.5'],
}

function toggleInputGroup(id: RefineInputGroupId) {
  openMenu.value = openMenu.value?.kind === 'input' && openMenu.value.id === id ? null : { kind: 'input', id }
}
function pickTool(tool: RefineMaskTool) {
  editor.setRefineTool(tool)
  openMenu.value = null
}
function runCommand(id: RefineToolCommand) {
  const mask = editor.getRefineMask()
  if (id === 'invert') mask?.invert()
  else mask?.clear()
  openMenu.value = null
}
function toggleView(id: 'compare' | 'fit') {
  openMenu.value = openMenu.value?.kind === 'view' && openMenu.value.id === id ? null : { kind: 'view', id }
}
function pickCompareMode(mode: (typeof REFINE_COMPARE_OPTIONS)[number]['mode']) {
  if (!props.hasAfter) return
  editor.setRefineCompareMode(mode)
  editor.setCompareLightboxOpen(true)
  openMenu.value = null
}
function pickFit(id: RefineFitOptionId) {
  if (id === 'fit-window') emit('fit')
  else emit('actualSize')
  openMenu.value = null
}
function toggleLoupe() {
  editor.setRefineLoupe(!editor.refineLoupeOn)
}
const isInputOpen = (id: RefineInputGroupId) => openMenu.value?.kind === 'input' && openMenu.value.id === id
const isViewOpen = (id: 'compare' | 'fit') => openMenu.value?.kind === 'view' && openMenu.value.id === id
</script>

<template>
  <nav ref="railRef" class="refine-rail" data-testid="refine-rail" aria-label="画布工具">
    <!-- 输入组：往图上放东西，只产出选区 / 蒙版 -->
    <div v-for="group in REFINE_INPUT_GROUPS" :key="group.id" class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': inputToolActive(editor.refineTool, group.id) }"
        :data-testid="`rail-input-${group.id}`"
        :aria-label="group.label"
        :title="group.label"
        :aria-expanded="isInputOpen(group.id)"
        @click="toggleInputGroup(group.id)"
      >
        <span class="refine-rail__glyph">{{ GLYPH[group.id] }}</span>
        <span class="refine-rail__name">{{ group.label }}</span>
      </button>

      <div v-if="isInputOpen(group.id)" class="refine-rail__fly" role="menu">
        <div class="refine-rail__fly-title">{{ group.label }}</div>
        <div class="refine-rail__fly-icons">
          <button
            v-for="variant in group.variants"
            :key="variant.tool"
            type="button"
            role="menuitemradio"
            class="refine-rail__opt-icon"
            :class="{ 'is-on': editor.refineTool === variant.tool }"
            :data-testid="`rail-variant-${variant.tool}`"
            :title="variant.label"
            :aria-label="variant.label"
            @click="pickTool(variant.tool)"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path v-for="(d, i) in VARIANT_ICONS[variant.tool]" :key="i" :d="d" />
            </svg>
          </button>
        </div>
        <template v-if="group.commands.length">
          <div class="refine-rail__fly-div" />
          <button
            v-for="cmd in group.commands"
            :key="cmd.id"
            type="button"
            class="refine-rail__cmd"
            :data-testid="`rail-command-${cmd.id}`"
            @click="runCommand(cmd.id)"
          >
            {{ cmd.label }}
          </button>
        </template>
      </div>
    </div>

    <!-- 查看组分隔（follow-up #5）：只留发丝线，不再放文字标签 -->
    <div class="refine-rail__hr" />

    <!-- 查看组：只看不改，不写图片数据、不产生版本 -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': editor.compareLightboxOpen }"
        data-testid="rail-view-compare"
        :aria-label="REFINE_VIEW_TOOLS[0]!.label"
        :title="REFINE_VIEW_TOOLS[0]!.label"
        :aria-expanded="isViewOpen('compare')"
        @click="toggleView('compare')"
      >
        <span class="refine-rail__glyph">⇆</span>
        <span class="refine-rail__name">{{ REFINE_VIEW_TOOLS[0]!.label }}</span>
      </button>

      <div v-if="isViewOpen('compare')" class="refine-rail__fly refine-rail__fly--up" role="menu">
        <div class="refine-rail__fly-title">对照方式（二选一）</div>
        <button
          v-for="option in REFINE_COMPARE_OPTIONS"
          :key="option.mode"
          type="button"
          role="menuitemradio"
          class="refine-rail__opt"
          :class="{ 'is-on': editor.refineCompareMode === option.mode }"
          :data-testid="`rail-compare-option-${option.mode}`"
          :disabled="!hasAfter"
          @click="pickCompareMode(option.mode)"
        >
          <span class="refine-rail__opt-tx">
            <b>{{ option.label }}<span v-if="option.mode === 'split'" class="refine-rail__pin">默认</span></b>
            <em>{{ option.hint }}</em>
          </span>
          <span class="refine-rail__radio" />
        </button>
        <div class="refine-rail__fly-div" />
        <div class="refine-rail__fly-note">
          对照需要「处理后」的版本，未产出时两项置灰。<br>选中后画布顶部出模式条，<b>Esc</b> 回到工作图。
        </div>
      </div>
    </div>

    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        data-testid="rail-view-fit"
        :aria-label="REFINE_VIEW_TOOLS[1]!.label"
        :title="REFINE_VIEW_TOOLS[1]!.label"
        :aria-expanded="isViewOpen('fit')"
        @click="toggleView('fit')"
      >
        <span class="refine-rail__glyph">⛶</span>
        <span class="refine-rail__name">{{ REFINE_VIEW_TOOLS[1]!.label }}</span>
      </button>

      <div v-if="isViewOpen('fit')" class="refine-rail__fly refine-rail__fly--up" role="menu">
        <div class="refine-rail__fly-title">视图</div>
        <!-- 即时缩放（follow-up #10）：放大 / 缩小合入「适配」 -->
        <button
          v-for="action in REFINE_ZOOM_ACTIONS"
          :key="action.id"
          type="button"
          class="refine-rail__opt"
          :data-testid="`rail-zoom-${action.id}`"
          @click="action.id === 'zoom-in' ? emit('zoomIn') : emit('zoomOut')"
        >
          <span class="refine-rail__opt-tx"><b>{{ action.label }}</b><em>{{ action.hint }}</em></span>
        </button>
        <div class="refine-rail__fly-div" />
        <button
          v-for="option in REFINE_FIT_OPTIONS"
          :key="option.id"
          type="button"
          class="refine-rail__opt"
          :data-testid="`rail-fit-option-${option.id}`"
          @click="pickFit(option.id)"
        >
          <span class="refine-rail__opt-tx"><b>{{ option.label }}</b><em>{{ option.hint }}</em></span>
        </button>
      </div>
    </div>

    <!-- 细节放大（follow-up #9）：P0-5 按用户 2026-09-21 晚指示回退，入口回归左栏；底层 refineLoupeOn 一直保留 -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': editor.refineLoupeOn }"
        data-testid="rail-view-loupe"
        aria-label="细节放大"
        title="细节放大（放大镜跟随光标）"
        :aria-pressed="editor.refineLoupeOn"
        @click="toggleLoupe"
      >
        <span class="refine-rail__glyph">⊕</span>
        <span class="refine-rail__name">细节放大</span>
      </button>
    </div>

    <div class="refine-rail__hr" />

    <!-- 撤销 / 重做（follow-up #13）：作用于蒙版历史栈 -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        data-testid="rail-undo"
        aria-label="撤销"
        title="撤销 (⌘Z)"
        :disabled="!canUndo"
        @click="emit('undo')"
      >
        <span class="refine-rail__glyph">↶</span>
        <span class="refine-rail__name">撤销</span>
      </button>
    </div>
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        data-testid="rail-redo"
        aria-label="重做"
        title="重做 (⇧⌘Z)"
        :disabled="!canRedo"
        @click="emit('redo')"
      >
        <span class="refine-rail__glyph">↷</span>
        <span class="refine-rail__name">重做</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.refine-rail {
  /* 顶部让出 chrome 层「返回画布」的高度，避免盖住第一个入口（follow-up #1） */
  display: flex; width: 56px; flex: 0 0 56px; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px; padding: 60px 0 10px;
  background: rgba(20, 20, 22, 0.72); border-right: 1px solid var(--neo-border);
}
.refine-rail__slot { position: relative; }
.refine-rail__btn {
  display: flex; width: 44px; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 0 5px; border: none; border-radius: 10px; background: transparent;
  color: var(--neo-text-muted); font-size: 10px; line-height: 1.1; cursor: pointer;
}
.refine-rail__btn:hover:not(:disabled) { background: var(--neo-hover-bg); color: var(--neo-text-secondary); }
.refine-rail__btn:active:not(:disabled) { transform: scale(.94); }
.refine-rail__btn:focus-visible { outline: 1.5px solid #4a9eff; outline-offset: 1px; }
.refine-rail__btn.is-active { background: rgba(0, 89, 179, 0.18); color: #7cc0ff; }
.refine-rail__btn:disabled { opacity: .38; cursor: not-allowed; }
.refine-rail__glyph { font-size: 15px; line-height: 1; }
.refine-rail__name { font-size: 10px; white-space: nowrap; }
.refine-rail__hr { width: 24px; height: 1px; margin: 6px 0 4px; background: var(--neo-border); }
.refine-rail__fly {
  position: absolute; top: -6px; left: calc(100% + 8px); z-index: 2; min-width: 196px; padding: 8px;
  border: 1px solid var(--neo-glass-border, var(--neo-border)); border-radius: 14px;
  background: var(--neo-surface, #17181d); box-shadow: 0 12px 32px rgba(0, 0, 0, .36);
}
/* 底部两枚（对照 / 适配）向上弹，避免飞出视口下缘 */
.refine-rail__fly--up { top: auto; bottom: -6px; }
.refine-rail__fly-title { padding: 2px 6px 6px; color: var(--neo-text-muted); font-size: 10.5px; }
.refine-rail__fly-icons { display: flex; align-items: center; gap: 4px; padding: 0 2px 2px; }
.refine-rail__opt-icon {
  display: flex; width: 32px; height: 32px; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 9px; background: transparent;
  color: var(--neo-text-secondary); cursor: pointer;
}
.refine-rail__opt-icon:hover { background: var(--neo-hover-bg); }
.refine-rail__opt-icon.is-on { border-color: rgba(74, 158, 255, .5); background: rgba(0, 89, 179, .16); color: #7cc0ff; }
.refine-rail__opt {
  display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px;
  border: none; border-radius: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer;
}
.refine-rail__opt:hover { background: var(--neo-hover-bg); }
.refine-rail__opt.is-on { background: rgba(0, 89, 179, .16); }
.refine-rail__opt:disabled { opacity: .45; cursor: not-allowed; }
.refine-rail__opt-tx { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.refine-rail__opt-tx b { font-size: 12px; font-weight: 600; }
.refine-rail__opt-tx em { color: var(--neo-text-muted); font-size: 10.5px; font-style: normal; }
.refine-rail__radio { width: 12px; height: 12px; flex: 0 0 12px; border: 1.5px solid var(--neo-text-muted); border-radius: 50%; }
.refine-rail__opt.is-on .refine-rail__radio { border-color: #4a9eff; background: radial-gradient(circle, #4a9eff 0 3.5px, transparent 4px); }
.refine-rail__pin { margin-left: 5px; padding: 0 5px; border-radius: 5px; background: rgba(74, 158, 255, .2); color: #7cc0ff; font-size: 9.5px; font-weight: 500; }
.refine-rail__fly-div { height: 1px; margin: 6px 4px; background: var(--neo-border); }
.refine-rail__cmd { display: block; width: 100%; padding: 5px 6px; border: none; border-radius: 9px; background: transparent; color: var(--neo-text-secondary); font-size: 12px; text-align: left; cursor: pointer; }
.refine-rail__cmd:hover { background: var(--neo-hover-bg); }
.refine-rail__fly-note { padding: 2px 6px 0; color: var(--neo-text-muted); font-size: 10px; line-height: 1.5; }
</style>
