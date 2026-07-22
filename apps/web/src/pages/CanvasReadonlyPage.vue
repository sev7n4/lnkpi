<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { ElMessage } from 'element-plus'
import type { Work } from '@lnkpi/shared'
import { worksApi } from '@/services/works-api'
import { useAuthStore } from '@/stores/auth'
import CanvasNodePrompt from '@/components/canvas/CanvasNodePrompt.vue'
import CanvasNodeImage from '@/components/canvas/CanvasNodeImage.vue'
import CanvasNodeVideo from '@/components/canvas/CanvasNodeVideo.vue'
import CanvasNodeText from '@/components/canvas/CanvasNodeText.vue'
import CanvasNodeShot from '@/components/canvas/CanvasNodeShot.vue'
import CanvasNodeGroup from '@/components/canvas/CanvasNodeGroup.vue'
import CanvasNodeAudio from '@/components/canvas/CanvasNodeAudio.vue'
import CanvasNodeDirector from '@/components/canvas/CanvasNodeDirector.vue'
import CanvasNodeMediaInput from '@/components/canvas/CanvasNodeMediaInput.vue'
import CanvasNodeVideoComposition from '@/components/canvas/CanvasNodeVideoComposition.vue'
import CanvasNodeWorldModel from '@/components/canvas/CanvasNodeWorldModel.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const workId = computed(() => route.params.id as string)
const work = ref<Work | null>(null)
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const loading = ref(true)
const forking = ref(false)

const nodeTypes = {
  prompt: CanvasNodePrompt,
  image: CanvasNodeImage,
  video: CanvasNodeVideo,
  text: CanvasNodeText,
  shot: CanvasNodeShot,
  group: CanvasNodeGroup,
  audio: CanvasNodeAudio,
  director: CanvasNodeDirector,
  mediaInput: CanvasNodeMediaInput,
  videoComposition: CanvasNodeVideoComposition,
  worldModel: CanvasNodeWorldModel,
}

onMounted(async () => {
  try {
    const [workRes, canvasRes] = await Promise.all([
      worksApi.get(workId.value),
      worksApi.getCanvas(workId.value),
    ])
    work.value = workRes.data.data
    nodes.value = (canvasRes.data.data.nodes ?? []) as Node[]
    edges.value = (canvasRes.data.data.edges ?? []) as Edge[]
  } catch {
    work.value = null
  } finally {
    loading.value = false
  }
})

async function forkToMyCanvas() {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  forking.value = true
  try {
    const { data } = await worksApi.forkCanvas(workId.value)
    ElMessage.success('已复制到你的画布')
    router.push(`/workflow/${data.data.id}`)
  } catch {
    ElMessage.error('复制失败，请确认已登录')
  } finally {
    forking.value = false
  }
}

function backToShare() {
  router.push(`/share/${workId.value}`)
}
</script>

<template>
  <div class="flex h-[calc(100vh-4rem)] flex-col">
    <div class="flex items-center justify-between border-b border-white/8 bg-[#141414] px-4 py-3">
      <div class="flex items-center gap-3">
        <button class="text-sm text-white/50 hover:text-white" @click="backToShare">← 返回详情</button>
        <span class="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">只读 · 制作过程</span>
        <span v-if="work" class="text-sm text-white/60">{{ work.title }}</span>
      </div>
      <button class="btn-primary text-sm" :disabled="forking" @click="forkToMyCanvas">
        {{ forking ? '复制中…' : '复制到我的画布' }}
      </button>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-white/40">加载中…</div>
    <div v-else-if="!work" class="flex flex-1 items-center justify-center text-white/40">作品不存在</div>
    <div v-else class="relative flex-1">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes as any"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="false"
        :pan-on-drag="true"
        :zoom-on-scroll="true"
        fit-view-on-init
        class="canvas-flow h-full w-full bg-[#0a0a0a]"
      >
        <Background pattern-color="#333" :gap="20" />
      </VueFlow>
    </div>
  </div>
</template>

<style scoped>
.canvas-flow :deep(.vue-flow__pane) {
  cursor: grab;
}
</style>
