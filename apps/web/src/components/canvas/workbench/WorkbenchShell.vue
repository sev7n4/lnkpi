<script setup lang="ts">
import { computed } from 'vue'
import { useWorkbenchPanel } from './useWorkbenchPanel'

const props = withDefaults(defineProps<{
  defaultWidth?: number
  busy?: boolean
}>(), { defaultWidth: 400, busy: false })

const emit = defineEmits<{ close: [] }>()

/** Shell 只管布局与折叠（宽度 / 折叠 / 窄屏），不含任何业务状态（spec §5）。 */
const { panelWidth, collapsed, isNarrow, insetRight, setPanelWidth, setCollapsed } = useWorkbenchPanel({
  defaultWidth: props.defaultWidth,
  busy: () => props.busy,
  onClose: () => emit('close'),
})

/** 悬浮 dock 是否可用：窄屏退化为面板落点（§6.3）。 */
const floatingAvailable = computed(() => !isNarrow.value)
</script>

<template>
  <div class="workbench-shell" data-testid="workbench-shell">
    <div class="workbench-shell__viewport">
      <slot name="viewport" :inset-right="insetRight" />
    </div>
    <div class="workbench-shell__panel" data-testid="workbench-shell-panel">
      <slot
        name="panel"
        :panel-width="panelWidth"
        :collapsed="collapsed"
        :is-narrow="isNarrow"
        :inset-right="insetRight"
        :floating-available="floatingAvailable"
        :set-collapsed="setCollapsed"
        :set-panel-width="setPanelWidth"
      />
    </div>
  </div>
</template>

<style scoped>
/* 绝对定位于画布页容器之上（与既有 RefineWorkViewport 同一层）。Shell 只提供
   viewport/panel 布局骨架；§4.3 的「dock 不遮挡滚动区」由 RefineSidePanel 的
   flex 兄弟 + Teleport 保证，本组件不做布局承诺。 */
.workbench-shell {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  min-width: 0;
}
.workbench-shell__viewport { position: relative; min-width: 0; flex: 1; }
.workbench-shell__panel { display: contents; }
</style>
