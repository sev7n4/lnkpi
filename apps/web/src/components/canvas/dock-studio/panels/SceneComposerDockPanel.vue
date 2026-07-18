<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { UpstreamNodeContext } from '@/composables/useUpstreamNodeContext'
import type { MentionOption } from '@/components/canvas/MentionInput.vue'
import DockToolbarShell from '@/components/canvas/dock-studio/shared/DockToolbarShell.vue'
import DockPromptSection from '@/components/canvas/dock-studio/shared/DockPromptSection.vue'
import DockOptimizePrompt from '@/components/canvas/dock-studio/shared/DockOptimizePrompt.vue'
import { isNodeGenerating } from '@/constants/dockStudio'
import {
  countSceneComposerShots,
  createEmptySceneComposerScene,
  createEmptySceneComposerShot,
  type SceneComposerPayload,
  type SceneComposerScene,
  type SceneComposerShot,
  type SceneComposerShotMediaType,
} from '@lnkpi/shared'
import { readSceneComposerFromNode, sceneComposerToNodePatch } from '@/utils/sceneComposer'

const props = defineProps<{
  node: EditableFlowNode
  upstream: UpstreamNodeContext
  mentions?: MentionOption[]
  generating?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  patch: [patch: Record<string, unknown>]
  save: []
  expand: []
  batchGenerate: []
  close: []
}>()

const payload = ref<SceneComposerPayload>(readSceneComposerFromNode(props.node))
const activeSceneId = ref(payload.value.scenes[0]?.id ?? '')

const locked = computed(
  () => !!props.readonly || isNodeGenerating(props.node.data?.status) || !!props.generating,
)

const activeScene = computed(() =>
  payload.value.scenes.find((scene) => scene.id === activeSceneId.value) ?? payload.value.scenes[0],
)

const statsLabel = computed(
  () => `${payload.value.scenes.length} 场景 · ${countSceneComposerShots(payload.value)} 镜头`,
)

function syncFromNode() {
  payload.value = readSceneComposerFromNode(props.node)
  if (!payload.value.scenes.some((scene) => scene.id === activeSceneId.value)) {
    activeSceneId.value = payload.value.scenes[0]?.id ?? ''
  }
}

watch(() => props.node, syncFromNode, { immediate: true, deep: true })

watch(
  () => props.upstream,
  (ctx) => {
    if (!payload.value.prompt?.trim() && ctx.textPrompt) {
      payload.value.prompt = ctx.textPrompt
      commitPatch()
    }
  },
  { immediate: true },
)

function commitPatch() {
  emit('patch', sceneComposerToNodePatch(payload.value))
}

function onSynopsisInput(value: string) {
  payload.value.prompt = value
  commitPatch()
}

function onTitleInput(value: string) {
  payload.value.title = value
  commitPatch()
}

function selectScene(sceneId: string) {
  activeSceneId.value = sceneId
}

function addScene() {
  const index = payload.value.scenes.length + 1
  const scene = createEmptySceneComposerScene({ title: `场景 ${index}` })
  payload.value.scenes.push(scene)
  activeSceneId.value = scene.id
  commitPatch()
}

function removeScene(sceneId: string) {
  if (payload.value.scenes.length <= 1) return
  payload.value.scenes = payload.value.scenes.filter((scene) => scene.id !== sceneId)
  if (activeSceneId.value === sceneId) {
    activeSceneId.value = payload.value.scenes[0]?.id ?? ''
  }
  commitPatch()
}

function updateScene(sceneId: string, patch: Partial<SceneComposerScene>) {
  const scene = payload.value.scenes.find((item) => item.id === sceneId)
  if (!scene) return
  Object.assign(scene, patch)
  commitPatch()
}

function addShot(sceneId: string) {
  const scene = payload.value.scenes.find((item) => item.id === sceneId)
  if (!scene) return
  scene.shots.push(createEmptySceneComposerShot({ title: `镜头 ${scene.shots.length + 1}` }))
  commitPatch()
}

function removeShot(sceneId: string, shotId: string) {
  const scene = payload.value.scenes.find((item) => item.id === sceneId)
  if (!scene || scene.shots.length <= 1) return
  scene.shots = scene.shots.filter((shot) => shot.id !== shotId)
  commitPatch()
}

function updateShot(sceneId: string, shotId: string, patch: Partial<SceneComposerShot>) {
  const scene = payload.value.scenes.find((item) => item.id === sceneId)
  const shot = scene?.shots.find((item) => item.id === shotId)
  if (!shot) return
  Object.assign(shot, patch)
  commitPatch()
}

function setShotMediaType(sceneId: string, shotId: string, mediaType: SceneComposerShotMediaType) {
  updateShot(sceneId, shotId, { mediaType })
}

function onOptimizedSynopsis(value: string) {
  payload.value.prompt = value
  commitPatch()
}

const canBatchGenerate = computed(() =>
  payload.value.scenes.some((scene) =>
    scene.shots.some(
      (shot) =>
        shot.shotNodeId &&
        shot.prompt.trim() &&
        (shot.mediaType === 'image' || shot.mediaType === 'video'),
    ),
  ),
)
</script>

<template>
  <DockToolbarShell
    type="sceneComposer"
    show-title
    :title="payload.title ?? '场景编排'"
    title-placeholder="编排标题"
    :readonly="locked"
    @update:title="onTitleInput"
    @close="emit('close')"
  >
    <div class="mb-2 flex items-center justify-between px-1 text-[10px] text-white/45">
      <span>{{ statsLabel }}</span>
      <span v-if="payload.expanded" class="text-amber-300/80">已展开子图</span>
    </div>

    <DockPromptSection
      :model-value="payload.prompt ?? ''"
      :mentions="mentions"
      placeholder="整体故事梗概或风格描述，@ 引用上游节点..."
      @update:model-value="onSynopsisInput"
      @submit="emit('save')"
    />

    <div class="scene-composer-layout">
      <div class="scene-composer-scenes">
        <div class="mb-1 flex items-center justify-between px-1">
          <span class="text-[10px] uppercase tracking-wide text-white/40">场景</span>
          <button
            type="button"
            class="text-[10px] text-[#818cf8] hover:text-[#a5b4fc]"
            :disabled="locked"
            @click="addScene"
          >
            + 场景
          </button>
        </div>
        <div class="flex max-h-36 flex-col gap-1 overflow-y-auto pr-1">
          <button
            v-for="scene in payload.scenes"
            :key="scene.id"
            type="button"
            class="scene-tab"
            :class="{ 'is-active': scene.id === activeSceneId }"
            :disabled="locked"
            @click="selectScene(scene.id)"
          >
            <span class="truncate">{{ scene.title }}</span>
            <span class="text-white/35">{{ scene.shots.length }}</span>
          </button>
        </div>
      </div>

      <div v-if="activeScene" class="scene-composer-shots min-w-0 flex-1">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <input
            :value="activeScene.title"
            class="bottom-toolbar-title-input min-w-[120px] flex-1"
            placeholder="场景名称"
            :readonly="locked"
            @input="updateScene(activeScene.id, { title: ($event.target as HTMLInputElement).value })"
          >
          <button
            type="button"
            class="text-[10px] text-red-300/80 hover:text-red-200"
            :disabled="locked || payload.scenes.length <= 1"
            @click="removeScene(activeScene.id)"
          >
            删除场景
          </button>
          <button
            type="button"
            class="rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/70 hover:bg-white/5"
            :disabled="locked"
            @click="addShot(activeScene.id)"
          >
            + 镜头
          </button>
        </div>

        <div class="max-h-44 space-y-2 overflow-y-auto pr-1">
          <div
            v-for="(shot, shotIndex) in activeScene.shots"
            :key="shot.id"
            class="shot-row"
          >
            <div class="shot-preview">
              <img v-if="shot.previewUrl" :src="shot.previewUrl" alt="">
              <span v-else class="text-[10px] text-white/30">{{ shotIndex + 1 }}</span>
            </div>
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <input
                  :value="shot.title"
                  class="bottom-toolbar-title-input max-w-[140px]"
                  placeholder="镜头标题"
                  :readonly="locked"
                  @input="updateShot(activeScene.id, shot.id, { title: ($event.target as HTMLInputElement).value })"
                >
                <div class="flex rounded-md border border-white/10 p-0.5">
                  <button
                    v-for="opt in ([['image', '图'], ['video', '视'], ['none', '无']] as const)"
                    :key="opt[0]"
                    type="button"
                    class="rounded px-1.5 py-0.5 text-[10px]"
                    :class="shot.mediaType === opt[0] ? 'bg-[#6366f1]/30 text-[#818cf8]' : 'text-white/45'"
                    :disabled="locked"
                    @click="setShotMediaType(activeScene.id, shot.id, opt[0])"
                  >
                    {{ opt[1] }}
                  </button>
                </div>
                <button
                  type="button"
                  class="text-[10px] text-red-300/70"
                  :disabled="locked || activeScene.shots.length <= 1"
                  @click="removeShot(activeScene.id, shot.id)"
                >
                  删
                </button>
              </div>
              <textarea
                :value="shot.prompt"
                class="input-field min-h-[52px] w-full resize-y text-xs"
                placeholder="镜头脚本 / 画面描述..."
                :readonly="locked"
                @input="updateShot(activeScene.id, shot.id, { prompt: ($event.target as HTMLTextAreaElement).value })"
              />
              <p v-if="shot.shotNodeId" class="text-[10px] text-emerald-300/70">
                已关联分镜节点 {{ shot.shotNodeId.slice(0, 8) }}…
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="bottom-toolbar-actions flex-wrap">
      <DockOptimizePrompt
        :prompt="payload.prompt ?? ''"
        optimize-style="cinematic"
        :disabled="locked"
        @optimized="onOptimizedSynopsis"
      />

      <button
        type="button"
        class="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/75 hover:bg-white/5"
        :disabled="locked"
        @click="emit('save')"
      >
        {{ generating ? '保存中...' : '保存编排' }}
      </button>

      <button
        type="button"
        class="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs text-amber-200/90 hover:bg-amber-400/10"
        :disabled="locked"
        @click="emit('expand')"
      >
        展开子图
      </button>

      <button
        type="button"
        class="btn-primary px-4 py-1.5 text-xs"
        :disabled="locked || !canBatchGenerate"
        @click="emit('batchGenerate')"
      >
        {{ generating ? '生成中...' : '批量生成素材' }}
      </button>
    </div>
  </DockToolbarShell>
</template>

<style scoped>
.scene-composer-layout {
  display: grid;
  grid-template-columns: minmax(120px, 160px) minmax(0, 1fr);
  gap: 12px;
  margin-bottom: 8px;
}

.scene-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.65);
  font-size: 11px;
  text-align: left;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.scene-tab.is-active {
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: rgba(255, 255, 255, 0.92);
}

.shot-row {
  display: flex;
  gap: 10px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
}

.shot-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.shot-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
