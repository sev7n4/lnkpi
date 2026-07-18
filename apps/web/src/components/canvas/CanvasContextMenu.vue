<script setup lang="ts">
import { ref } from 'vue'

const { x, y, nodeId, nodeType } = defineProps<{
  x: number
  y: number
  nodeId?: string
  nodeType?: string
}>()

const emit = defineEmits<{
  action: [action: string, payload?: string]
  close: []
}>()

const visible = ref(true)

function run(action: string, payload?: string) {
  emit('action', action, payload)
  visible.value = false
  emit('close')
}
</script>

<template>
  <div
    v-if="visible && nodeId"
    class="fixed z-[100] min-w-[160px] rounded-xl border border-white/10 bg-[#242424] py-1 shadow-xl"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
  >
    <button
      v-if="nodeType === 'image'"
      class="block w-full px-4 py-2 text-left text-xs text-white/80 hover:bg-white/5"
      @click="run('edit-image')"
    >
      编辑图像
    </button>

    <button
      v-if="nodeType === 'group'"
      class="block w-full px-4 py-2 text-left text-xs text-white/80 hover:bg-white/5"
      @click="run('ungroup')"
    >
      解组
    </button>

    <button
      v-if="nodeId && nodeType !== 'group'"
      class="block w-full px-4 py-2 text-left text-xs text-white/80 hover:bg-white/5"
      @click="run('duplicate')"
    >
      复制节点
    </button>
    <button
      v-if="nodeId"
      class="block w-full px-4 py-2 text-left text-xs text-red-400 hover:bg-white/5"
      @click="run('delete')"
    >
      删除节点
    </button>
  </div>
</template>
