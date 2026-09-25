<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { TOOL_ICON_CROP, TOOL_ICON_ELEMENT, TOOL_ICON_INPAINT, TOOL_ICON_MATTING, TOOL_ICON_OUTPAINT, TOOL_ICON_SELECT } from '@/components/canvas/toolIcons'
import {
  REFINE_CAPABILITY_ITEMS, REFINE_COMPARE_OPTIONS, REFINE_FIT_OPTIONS, REFINE_VIEW_TOOLS, REFINE_ZOOM_ACTIONS,
  type RefineFitOptionId,
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

/** 模式入口统一式（spec 图 3 上半段）：setRefineMode(激活 ? 'select' : 目标模式) */
const outpaintActive = computed(() => editor.refineMode === 'outpaint')
function toggleOutpaint() {
  editor.setRefineMode(outpaintActive.value ? 'select' : 'outpaint')
}

const mattingActive = computed(() => editor.refineMode === 'matting')
function toggleMatting() {
  editor.setRefineMode(mattingActive.value ? 'select' : 'matting')
}

const cropActive = computed(() => editor.refineMode === 'crop')
function toggleCrop() {
  editor.setRefineMode(cropActive.value ? 'select' : 'crop')
}

/** 局部重绘模式入口：进模式默认画笔（画笔优先的精修子模式） */
const inpaintActive = computed(() => editor.refineMode === 'inpaint')
function toggleInpaint() {
  if (inpaintActive.value) {
    editor.setRefineMode('select')
    return
  }
  editor.setRefineMode('inpaint')
  editor.setRefineTool('brush')
}

/** 元素编辑模式入口：多选区局部编辑（选区 → 面板添加 → 生成） */
const elementActive = computed(() => editor.refineMode === 'element')
function toggleElement() {
  editor.setRefineMode(elementActive.value ? 'select' : 'element')
}

const selectActive = computed(() => editor.refineMode === 'select')
function pickSelect() {
  editor.setRefineMode('select') // 选区目标模式就是 select，恒幂等
}

/** 选区引导（2026-09-23 用户反馈）：抠图模式下无选区时，让「选区」入口呼吸提示——圈选后才能「用当前选区抠」。 */
const selectNeedsAttention = computed(() => editor.refineMode === 'matting' && !editor.refineMaskAvailable)
const selectTitle = computed(() =>
  selectNeedsAttention.value ? '选区（先圈选区域，回到「抠图」即可按选区抠图）' : '选区（智能 / 形状 / 涂抹三类工具在右侧面板）',
)

/** 同一时刻只允许一个二级菜单展开 */
type OpenMenu = { kind: 'view'; id: 'compare' | 'fit' } | null
const openMenu = ref<OpenMenu>(null)

function onDocPointerDown(event: PointerEvent) {
  const el = railRef.value
  if (!el) return
  if (el.contains(event.target as Node)) return
  openMenu.value = null
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true))

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
const isViewOpen = (id: 'compare' | 'fit') => openMenu.value?.kind === 'view' && openMenu.value.id === id
</script>

<template>
  <nav ref="railRef" class="refine-rail neo-glass-lite" data-testid="refine-rail" aria-label="画布工具">
    <!-- 扩图模式入口（Task 7）：激活时高亮；busy 时冻结不可切换；画笔/橡皮在右侧面板 -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': outpaintActive }"
        data-testid="rail-mode-outpaint"
        aria-label="扩图"
        title="扩图（拖拽手柄扩展画布）"
        :aria-pressed="outpaintActive"
        :disabled="editor.refineBusy"
        @click="toggleOutpaint"
      >
        <span class="refine-rail__glyph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="TOOL_ICON_OUTPAINT" />
        </span>
        <span class="refine-rail__name">扩图</span>
      </button>
    </div>

    <!-- 一键抠图模式入口（rail 只此一个抠图入口；一键 / 选区抠图双动作在右侧抠图面板内） -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': mattingActive }"
        data-testid="rail-mode-matting"
        aria-label="抠图（生成透明 PNG）"
        title="抠图（生成透明 PNG）"
        :aria-pressed="mattingActive"
        :disabled="editor.refineBusy"
        @click="toggleMatting"
      >
        <span class="refine-rail__glyph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="TOOL_ICON_MATTING" />
        </span>
        <span class="refine-rail__name">抠图</span>
      </button>
    </div>

    <!-- 裁剪模式入口：激活时高亮；busy 时冻结不可切换；与扩图/抠图互斥（setRefineMode 覆盖式切换） -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': cropActive }"
        data-testid="rail-mode-crop"
        aria-label="裁剪"
        title="裁剪（拖框 / 比例 / 旋转，纯本地免费）"
        :aria-pressed="cropActive"
        :disabled="editor.refineBusy"
        @click="toggleCrop"
      >
        <span class="refine-rail__glyph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="TOOL_ICON_CROP" />
        </span>
        <span class="refine-rail__name">裁剪</span>
      </button>
    </div>

    <!-- 局部重绘模式入口：激活时高亮；busy 时冻结不可切换；画笔/橡皮在右侧面板 -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': inpaintActive }"
        data-testid="rail-mode-inpaint"
        aria-label="局部重绘"
        title="局部重绘（画笔涂抹区域 + 描述改动，只重画圈出的部分）"
        :aria-pressed="inpaintActive"
        :disabled="editor.refineBusy"
        @click="toggleInpaint"
      >
        <span class="refine-rail__glyph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="TOOL_ICON_INPAINT" />
        </span>
        <span class="refine-rail__name">局部重绘</span>
      </button>
    </div>

    <!-- 元素编辑模式入口：多选区局部编辑（圈选 → 配名称/描述 → 生成） -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': elementActive }"
        data-testid="rail-mode-element"
        aria-label="元素编辑"
        title="元素编辑（圈选多处元素分别描述，一次生成）"
        :aria-pressed="elementActive"
        :disabled="editor.refineBusy"
        @click="toggleElement"
      >
        <span class="refine-rail__glyph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="TOOL_ICON_ELEMENT" />
        </span>
        <span class="refine-rail__name">元素编辑</span>
      </button>
    </div>

    <!-- 选区模式入口（spec §4.2）：select 是基座模式，点击恒幂等 -->
    <div class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :class="{ 'is-active': selectActive, 'is-hint': selectNeedsAttention }"
        data-testid="rail-mode-select"
        aria-label="选区"
        :title="selectTitle"
        :aria-pressed="selectActive"
        :disabled="editor.refineBusy"
        @click="pickSelect"
      >
        <span class="refine-rail__glyph">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="TOOL_ICON_SELECT" />
        </span>
        <span class="refine-rail__name">选区</span>
      </button>
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
          对照需要「处理后」的版本，未产出时两项置灰。<br>选中后打开全屏对照，<b>Esc</b> 或对照头部的返回按钮回到工作图。
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

    <div class="refine-rail__hr" data-testid="rail-capability-hr" />

    <!-- 能力区（§9）：Toolbox 能力组迁入左栏，全部禁用占位，M2 能力包逐个点亮 -->
    <div v-for="item in REFINE_CAPABILITY_ITEMS" :key="item.id" class="refine-rail__slot">
      <button
        type="button"
        class="refine-rail__btn"
        :data-testid="`rail-capability-${item.id}`"
        disabled
        :title="item.hint"
        :aria-label="item.label"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path v-for="(d, i) in item.icon" :key="i" :d="d" />
        </svg>
        <span class="refine-rail__name">{{ item.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.refine-rail {
  /* 顶部让出 chrome 层「返回画布」的高度，避免盖住第一个入口（follow-up #1） */
  display: flex; width: 56px; flex: 0 0 56px; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px;
  margin: 60px 0 12px; padding: 8px 0; border-radius: 16px;
}
/* 玻璃卡片容器由全局 .neo-glass-lite 提供边框/背景/阴影（与画布左栏 NodePanelDock 同款） */
.refine-rail__slot { position: relative; }
.refine-rail__btn {
  display: flex; width: 44px; flex-direction: column; align-items: center; gap: 2px;
  padding: 1px 0; border: none; border-radius: 10px; background: transparent;
  color: var(--neo-text-muted); font-size: 10px; line-height: 1.1; cursor: pointer;
}
/* 高亮只发生在圆形底座上（对齐 NodePanelDock 的 rail-circle 范式），按钮本体保持透明 */
.refine-rail__btn:hover:not(:disabled) { background: transparent; color: var(--neo-text-primary); }
.refine-rail__btn:active:not(:disabled) { transform: scale(.94); }
.refine-rail__btn:focus-visible { outline: 1.5px solid #4a9eff; outline-offset: 1px; }
.refine-rail__btn:disabled { opacity: .38; cursor: not-allowed; }
.refine-rail__glyph {
  display: flex; width: 30px; height: 30px; align-items: center; justify-content: center;
  border: 1px solid var(--neo-border); border-radius: 50%; background: var(--neo-hover-bg);
  font-size: 13px; line-height: 1; transition: border-color .15s ease, background .15s ease, color .15s ease;
}
.refine-rail__btn:hover:not(:disabled) .refine-rail__glyph {
  border-color: var(--neo-border-strong); background: var(--neo-active-bg);
}
.refine-rail__btn.is-active { background: transparent; color: var(--neo-text-primary); }
.refine-rail__btn.is-active .refine-rail__glyph {
  border-color: color-mix(in srgb, var(--neo-hi-text) 30%, var(--neo-border));
  background: var(--neo-hi-bg); color: var(--neo-hi-text); box-shadow: var(--neo-hi-shadow);
}
/* 选区引导呼吸（仅抠图模式且无选区）：强调色描边 + 柔和呼吸光环，圈选后自动消失 */
.refine-rail__btn.is-hint .refine-rail__glyph {
  border-color: var(--neo-accent-text);
  color: var(--neo-text-primary);
  animation: refine-rail-hint 1.8s ease-in-out infinite;
}
@keyframes refine-rail-hint {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--neo-accent-text) 0%, transparent); }
  50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--neo-accent-text) 28%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .refine-rail__btn.is-hint .refine-rail__glyph { animation: none; }
}
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
.refine-rail__fly-note { padding: 2px 6px 0; color: var(--neo-text-muted); font-size: 10px; line-height: 1.5; }
</style>
