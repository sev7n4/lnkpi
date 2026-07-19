<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { encodeChannelModel, type ApiCallFormat, type ModelCapability } from '@lnkpi/shared'
import { useProviderBootstrap } from '@/composables/useProviderBootstrap'
import {
  apiErrorMessage,
  providerApi,
  type ChannelModelEntry,
  type ProviderChannelPublic,
  type ProviderPreferencesPublic,
  type ProviderWebdavPublic,
} from '@/services/provider-api'

const open = defineModel<boolean>({ default: false })

const {
  load,
  loading,
  allChannels,
  preferences,
  webdav,
  patchChannel,
  patchPreferences,
  patchWebdav,
  setBootstrap,
} = useProviderBootstrap()

type TabKey = 'channels' | 'models' | 'preferences' | 'webdav'
const activeTab = ref<TabKey>('channels')
const saving = ref(false)
const pullingId = ref('')
const testingWebdav = ref(false)
const syncingWebdav = ref(false)

type ChannelDraft = {
  id: string
  name: string
  apiFormat: ApiCallFormat
  baseUrl: string
  /** empty = keep existing key; non-empty = replace */
  apiKeyDraft: string
  clearApiKey: boolean
  modelNames: string[]
  modelMeta: Record<string, ModelCapability>
  hasApiKey: boolean
  apiKeyMask?: string
  readOnly: boolean
}

const channelDrafts = ref<ChannelDraft[]>([])
const prefsDraft = reactive({
  selectableImageModels: [] as string[],
  selectableVideoModels: [] as string[],
  selectableTextModels: [] as string[],
  selectableAudioModels: [] as string[],
  defaultImageModel: '',
  defaultVideoModel: '',
  defaultTextModel: '',
  defaultAudioModel: '',
  canvasImageCount: 3,
  audioVoice: 'female-shaonv',
  audioFormat: 'mp3',
  audioSpeed: 1,
  audioInstructions: '',
  systemPrompt: '',
})
const webdavDraft = reactive({
  url: '',
  directory: '',
  username: '',
  password: '',
  clearPassword: false,
  hasPassword: false,
  lastSyncedAt: null as string | null,
})

const AUDIO_VOICE_OPTIONS = [
  { value: 'female-shaonv', label: '女声 · 少女' },
  { value: 'female-1', label: '女声 · 温柔' },
  { value: 'male-1', label: '男声 · 沉稳' },
  { value: 'narrator', label: '旁白 · 磁性' },
  { value: 'alloy', label: 'Alloy' },
  { value: 'echo', label: 'Echo' },
  { value: 'nova', label: 'Nova' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'shimmer', label: 'Shimmer' },
]

const AUDIO_FORMAT_OPTIONS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'opus', label: 'Opus' },
  { value: 'aac', label: 'AAC' },
  { value: 'flac', label: 'FLAC' },
]

const MODEL_GROUPS = [
  {
    capability: 'image' as const,
    selectableKey: 'selectableImageModels' as const,
    defaultKey: 'defaultImageModel' as const,
    optionsLabel: '生图模型可选项',
    defaultLabel: '默认生图模型',
  },
  {
    capability: 'video' as const,
    selectableKey: 'selectableVideoModels' as const,
    defaultKey: 'defaultVideoModel' as const,
    optionsLabel: '视频模型可选项',
    defaultLabel: '默认视频模型',
  },
  {
    capability: 'text' as const,
    selectableKey: 'selectableTextModels' as const,
    defaultKey: 'defaultTextModel' as const,
    optionsLabel: '文本模型可选项',
    defaultLabel: '默认文本模型',
  },
  {
    capability: 'audio' as const,
    selectableKey: 'selectableAudioModels' as const,
    defaultKey: 'defaultAudioModel' as const,
    optionsLabel: '音频模型可选项',
    defaultLabel: '默认音频模型',
  },
]

function toDraft(ch: ProviderChannelPublic): ChannelDraft {
  const meta: Record<string, ModelCapability> = {}
  for (const m of ch.models) meta[m.name] = m.capability
  return {
    id: ch.id,
    name: ch.name,
    apiFormat: ch.apiFormat,
    baseUrl: ch.baseUrl,
    apiKeyDraft: '',
    clearApiKey: false,
    modelNames: ch.models.map((m) => m.name),
    modelMeta: meta,
    hasApiKey: ch.hasApiKey,
    apiKeyMask: ch.apiKeyMask,
    readOnly: ch.readOnly,
  }
}

function applyServerChannel(ch: ProviderChannelPublic) {
  const draft = toDraft(ch)
  const idx = channelDrafts.value.findIndex((c) => c.id === ch.id)
  if (idx >= 0) channelDrafts.value[idx] = draft
  else channelDrafts.value.push(draft)
  patchChannel(ch)
}

function hydrateFromBootstrap() {
  channelDrafts.value = allChannels.value.map(toDraft)
  const prefs = preferences.value
  if (prefs) {
    prefsDraft.selectableImageModels = [...prefs.selectableImageModels]
    prefsDraft.selectableVideoModels = [...prefs.selectableVideoModels]
    prefsDraft.selectableTextModels = [...prefs.selectableTextModels]
    prefsDraft.selectableAudioModels = [...prefs.selectableAudioModels]
    prefsDraft.defaultImageModel = prefs.defaultImageModel
    prefsDraft.defaultVideoModel = prefs.defaultVideoModel
    prefsDraft.defaultTextModel = prefs.defaultTextModel
    prefsDraft.defaultAudioModel = prefs.defaultAudioModel
    prefsDraft.canvasImageCount = prefs.canvasImageCount
    prefsDraft.audioVoice = prefs.audioVoice
    prefsDraft.audioFormat = prefs.audioFormat
    prefsDraft.audioSpeed = prefs.audioSpeed
    prefsDraft.audioInstructions = prefs.audioInstructions ?? ''
    prefsDraft.systemPrompt = prefs.systemPrompt ?? ''
  }
  const wd = webdav.value
  if (wd) {
    webdavDraft.url = wd.url
    webdavDraft.directory = wd.directory
    webdavDraft.username = wd.username
    webdavDraft.password = ''
    webdavDraft.clearPassword = false
    webdavDraft.hasPassword = wd.hasPassword
    webdavDraft.lastSyncedAt = wd.lastSyncedAt
  }
}

watch(
  () => open.value,
  async (visible) => {
    if (!visible) return
    activeTab.value = 'channels'
    try {
      await load(true)
      hydrateFromBootstrap()
    } catch (err) {
      ElMessage.error(apiErrorMessage(err, '加载配置失败'))
    }
  },
)

const modelOptionPool = computed(() => {
  const options: Array<{ value: string; label: string; capability: ModelCapability }> = []
  for (const ch of channelDrafts.value) {
    for (const name of ch.modelNames) {
      const capability = ch.modelMeta[name] ?? 'text'
      const value = encodeChannelModel(ch.id, name)
      options.push({
        value,
        label: `${name}（${ch.name || '未命名渠道'}）`,
        capability,
      })
    }
  }
  return options
})

function optionsForCapability(capability: ModelCapability) {
  return modelOptionPool.value.filter((o) => o.capability === capability)
}

function labelForModelValue(value: string) {
  return modelOptionPool.value.find((o) => o.value === value)?.label ?? value
}

function modelsFromDraft(draft: ChannelDraft): ChannelModelEntry[] {
  return draft.modelNames.map((name) => ({
    name,
    capability: draft.modelMeta[name] ?? 'text',
  }))
}

async function persistChannel(draft: ChannelDraft) {
  if (draft.readOnly) return
  const input: Parameters<typeof providerApi.updateChannel>[1] = {
    name: draft.name.trim(),
    apiFormat: draft.apiFormat,
    baseUrl: draft.baseUrl.trim(),
    models: modelsFromDraft(draft),
  }
  if (draft.clearApiKey) input.clearApiKey = true
  else if (draft.apiKeyDraft.trim()) input.apiKey = draft.apiKeyDraft.trim()

  const updated = await providerApi.updateChannel(draft.id, input)
  applyServerChannel(updated)
}

async function refreshChannelDrafts() {
  const data = await load(true)
  setBootstrap(data)
  channelDrafts.value = [data.platformChannel, ...data.channels].map(toDraft)
}

async function addChannel() {
  try {
    await providerApi.createChannel({
      name: `渠道 ${channelDrafts.value.filter((c) => !c.readOnly).length + 1}`,
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    })
    await refreshChannelDrafts()
    ElMessage.success('已新增渠道')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '新增渠道失败'))
  }
}

async function deleteChannel(draft: ChannelDraft) {
  if (draft.readOnly) {
    ElMessage.warning('平台渠道不可删除')
    return
  }
  try {
    await providerApi.deleteChannel(draft.id)
    await refreshChannelDrafts()
    ElMessage.success('渠道已删除')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '删除渠道失败'))
  }
}

async function pullChannelModels(draft: ChannelDraft) {
  if (!draft.readOnly) {
    try {
      await persistChannel(draft)
    } catch (err) {
      ElMessage.error(apiErrorMessage(err, '保存渠道失败，无法拉取模型'))
      return
    }
  }
  pullingId.value = draft.id
  try {
    const updated = await providerApi.pullModels(draft.id)
    applyServerChannel(updated)
    ElMessage.success(`${updated.name} 模型列表已更新`)
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '拉取模型失败'))
  } finally {
    pullingId.value = ''
  }
}

async function pullAllModels() {
  // persist dirty user channels first
  for (const draft of channelDrafts.value.filter((c) => !c.readOnly)) {
    try {
      await persistChannel(draft)
    } catch (err) {
      ElMessage.error(apiErrorMessage(err, `保存「${draft.name}」失败`))
      return
    }
  }
  pullingId.value = 'all'
  try {
    const results = await providerApi.pullAllModels()
    for (const ch of results) applyServerChannel(ch)
    // also refresh platform
    const data = await load(true)
    channelDrafts.value = [data.platformChannel, ...data.channels].map(toDraft)
    ElMessage.success('模型列表已更新')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '拉取全部失败'))
  } finally {
    pullingId.value = ''
  }
}

function goToModelsTab() {
  activeTab.value = 'models'
}

function onSelectableChange(
  key: (typeof MODEL_GROUPS)[number]['selectableKey'],
  defaultKey: (typeof MODEL_GROUPS)[number]['defaultKey'],
  values: string[],
) {
  prefsDraft[key] = values
  if (!values.includes(prefsDraft[defaultKey])) {
    prefsDraft[defaultKey] = values[0] || ''
  }
}

function buildPreferencesPayload(): ProviderPreferencesPublic {
  return {
    selectableImageModels: prefsDraft.selectableImageModels,
    selectableVideoModels: prefsDraft.selectableVideoModels,
    selectableTextModels: prefsDraft.selectableTextModels,
    selectableAudioModels: prefsDraft.selectableAudioModels,
    defaultImageModel: prefsDraft.defaultImageModel,
    defaultVideoModel: prefsDraft.defaultVideoModel,
    defaultTextModel: prefsDraft.defaultTextModel,
    defaultAudioModel: prefsDraft.defaultAudioModel,
    canvasImageCount: Math.max(1, Math.min(15, Math.floor(Number(prefsDraft.canvasImageCount) || 3))),
    audioVoice: prefsDraft.audioVoice,
    audioFormat: prefsDraft.audioFormat,
    audioSpeed: Math.max(0.25, Math.min(4, Number(prefsDraft.audioSpeed) || 1)),
    audioInstructions: prefsDraft.audioInstructions.trim() || null,
    systemPrompt: prefsDraft.systemPrompt.trim() || null,
  }
}

async function saveWebdav(): Promise<ProviderWebdavPublic> {
  const input: Parameters<typeof providerApi.updateWebdav>[0] = {
    url: webdavDraft.url.trim(),
    directory: webdavDraft.directory.trim(),
    username: webdavDraft.username.trim(),
  }
  if (webdavDraft.clearPassword) input.clearPassword = true
  else if (webdavDraft.password) input.password = webdavDraft.password

  const updated = await providerApi.updateWebdav(input)
  patchWebdav(updated)
  webdavDraft.hasPassword = updated.hasPassword
  webdavDraft.password = ''
  webdavDraft.clearPassword = false
  webdavDraft.lastSyncedAt = updated.lastSyncedAt
  return updated
}

async function finish() {
  saving.value = true
  try {
    for (const draft of channelDrafts.value.filter((c) => !c.readOnly)) {
      await persistChannel(draft)
    }
    const prefs = await providerApi.updatePreferences(buildPreferencesPayload())
    patchPreferences(prefs)
    await saveWebdav()
    ElMessage.success('配置已保存')
    open.value = false
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, '保存失败'))
  } finally {
    saving.value = false
  }
}

async function testWebdav() {
  if (!webdavDraft.url.trim()) {
    ElMessage.error('请先填写 WebDAV 地址')
    return
  }
  testingWebdav.value = true
  try {
    await saveWebdav()
    await providerApi.testWebdav()
    ElMessage.success('WebDAV 连接可用')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'WebDAV 连接测试失败'))
  } finally {
    testingWebdav.value = false
  }
}

async function syncWebdav() {
  if (!webdavDraft.url.trim()) {
    ElMessage.error('请先填写 WebDAV 地址')
    return
  }
  syncingWebdav.value = true
  try {
    await saveWebdav()
    const updated = await providerApi.syncWebdav()
    patchWebdav(updated)
    webdavDraft.lastSyncedAt = updated.lastSyncedAt
    ElMessage.success('同步完成')
  } catch (err) {
    ElMessage.error(apiErrorMessage(err, 'WebDAV 同步失败'))
  } finally {
    syncingWebdav.value = false
  }
}

function formatSyncTime(value: string | null) {
  if (!value) return '尚未同步'
  return `上次同步 ${new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function apiKeyPlaceholder(draft: ChannelDraft) {
  if (draft.clearApiKey) return '将清除已保存密钥'
  if (draft.hasApiKey) return draft.apiKeyMask || '已保存（留空保留）'
  return 'sk-...'
}
</script>

<template>
  <el-dialog
    v-model="open"
    width="980px"
    class="provider-config-dialog"
    destroy-on-close
    align-center
    :close-on-click-modal="false"
  >
    <template #header>
      <div>
        <div class="text-base font-semibold text-white">配置与用户偏好</div>
        <div class="mt-1 text-xs font-normal text-white/45">渠道聚合、模型选择和同步偏好</div>
      </div>
    </template>

    <div v-loading="loading" class="provider-config-body">
      <el-tabs v-model="activeTab">
        <!-- 渠道 -->
        <el-tab-pane label="渠道" name="channels">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <div class="min-w-0 text-xs leading-5 text-amber-100/90">
              <span class="font-medium text-amber-100">重要提示：</span>
              新增或拉取模型后，请到「模型」Tab 勾选可选项，Dock 才会显示这些模型。
            </div>
            <el-button size="small" @click="goToModelsTab">去模型设置</el-button>
          </div>

          <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 p-3">
            <div>
              <div class="text-sm font-semibold text-white">多渠道聚合</div>
              <div class="mt-1 text-xs text-white/45">
                每个渠道保存自己的 Base URL、API Key 和模型列表；模型选择时会显示模型名和渠道名。
              </div>
            </div>
            <div class="flex gap-2">
              <el-button :loading="pullingId === 'all'" @click="pullAllModels">拉取全部</el-button>
              <el-button type="primary" @click="addChannel">新增渠道</el-button>
            </div>
          </div>

          <div class="space-y-3">
            <section
              v-for="draft in channelDrafts"
              :key="draft.id"
              class="rounded-lg border border-white/10 p-3"
            >
              <div class="mb-3 flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-white">
                    {{ draft.name || '未命名渠道' }}
                    <span v-if="draft.readOnly" class="ml-2 text-[10px] font-normal text-white/35">平台 · 只读</span>
                  </div>
                  <div class="mt-1 text-xs text-white/40">已保存 {{ draft.modelNames.length }} 个模型</div>
                </div>
                <div class="flex shrink-0 gap-2">
                  <el-button
                    size="small"
                    :loading="pullingId === draft.id"
                    @click="pullChannelModels(draft)"
                  >
                    拉取模型
                  </el-button>
                  <el-button
                    size="small"
                    type="danger"
                    plain
                    :disabled="draft.readOnly"
                    @click="deleteChannel(draft)"
                  >
                    删除
                  </el-button>
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <label class="block">
                  <span class="mb-1 block text-[11px] text-white/50">渠道名称</span>
                  <el-input v-model="draft.name" :disabled="draft.readOnly" />
                </label>
                <label class="block">
                  <span class="mb-1 block text-[11px] text-white/50">调用格式</span>
                  <el-select v-model="draft.apiFormat" class="w-full" :disabled="draft.readOnly">
                    <el-option label="OpenAI" value="openai" />
                    <el-option label="Gemini" value="gemini" />
                  </el-select>
                </label>
                <label class="block">
                  <span class="mb-1 block text-[11px] text-white/50">Base URL</span>
                  <el-input v-model="draft.baseUrl" :disabled="draft.readOnly" placeholder="https://api.openai.com/v1" />
                </label>
                <label class="block">
                  <span class="mb-1 block text-[11px] text-white/50">API Key</span>
                  <el-input
                    v-model="draft.apiKeyDraft"
                    type="password"
                    show-password
                    :disabled="draft.readOnly"
                    autocomplete="off"
                    :placeholder="apiKeyPlaceholder(draft)"
                    @input="draft.clearApiKey = false"
                  />
                  <button
                    v-if="!draft.readOnly && draft.hasApiKey"
                    type="button"
                    class="mt-1 text-[10px] text-white/35 hover:text-white/60"
                    @click="draft.clearApiKey = true; draft.apiKeyDraft = ''"
                  >
                    清除已保存密钥
                  </button>
                </label>
                <label class="block md:col-span-2">
                  <span class="mb-1 block text-[11px] text-white/50">模型列表</span>
                  <el-select
                    v-model="draft.modelNames"
                    class="w-full"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    :disabled="draft.readOnly"
                    placeholder="输入模型名，或点击拉取模型"
                  />
                </label>
              </div>
            </section>
          </div>
        </el-tab-pane>

        <!-- 模型 -->
        <el-tab-pane label="模型" name="models">
          <div class="mb-4 rounded-lg border border-white/10 p-3">
            <div class="text-sm font-semibold text-white">默认模型和可选项</div>
            <div class="mt-1 text-xs leading-5 text-white/45">
              可选项决定各处下拉框展示哪些模型；同名模型会以括号里的渠道名区分。
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label v-for="group in MODEL_GROUPS" :key="group.selectableKey" class="block">
              <span class="mb-1 block text-[11px] text-white/50">{{ group.optionsLabel }}</span>
              <el-select
                :model-value="prefsDraft[group.selectableKey]"
                class="w-full"
                multiple
                filterable
                collapse-tags
                collapse-tags-tooltip
                :placeholder="modelOptionPool.length ? `请选择${group.optionsLabel}` : '先到渠道里填写或拉取模型'"
                @update:model-value="onSelectableChange(group.selectableKey, group.defaultKey, $event)"
              >
                <el-option
                  v-for="opt in optionsForCapability(group.capability)"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </label>
          </div>

          <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label v-for="group in MODEL_GROUPS" :key="group.defaultKey" class="block">
              <span class="mb-1 block text-[11px] text-white/50">{{ group.defaultLabel }}</span>
              <el-select v-model="prefsDraft[group.defaultKey]" class="w-full" clearable filterable>
                <el-option
                  v-for="value in prefsDraft[group.selectableKey]"
                  :key="value"
                  :label="labelForModelValue(value)"
                  :value="value"
                />
              </el-select>
            </label>
          </div>
        </el-tab-pane>

        <!-- 生成偏好 -->
        <el-tab-pane label="生成偏好" name="preferences">
          <div class="grid gap-4 md:grid-cols-4">
            <label class="block">
              <span class="mb-1 block text-[11px] text-white/50">画布默认生图张数</span>
              <el-input-number
                v-model="prefsDraft.canvasImageCount"
                :min="1"
                :max="15"
                class="!w-full"
                controls-position="right"
              />
              <span class="mt-1 block text-[10px] leading-4 text-white/35">
                新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。
              </span>
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] text-white/50">默认音频声音</span>
              <el-select v-model="prefsDraft.audioVoice" class="w-full" filterable allow-create>
                <el-option
                  v-for="opt in AUDIO_VOICE_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] text-white/50">默认音频格式</span>
              <el-select v-model="prefsDraft.audioFormat" class="w-full">
                <el-option
                  v-for="opt in AUDIO_FORMAT_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] text-white/50">默认音频语速</span>
              <el-input-number
                v-model="prefsDraft.audioSpeed"
                :min="0.25"
                :max="4"
                :step="0.05"
                class="!w-full"
                controls-position="right"
              />
            </label>
          </div>

          <label class="mt-4 block">
            <span class="mb-1 block text-[11px] text-white/50">默认音频指令</span>
            <el-input
              v-model="prefsDraft.audioInstructions"
              type="textarea"
              :rows="2"
              placeholder="例如：自然、温暖、适合旁白。"
            />
          </label>

          <label class="mt-4 block">
            <span class="mb-1 block text-[11px] text-white/50">系统提示词</span>
            <el-input
              v-model="prefsDraft.systemPrompt"
              type="textarea"
              :rows="4"
              placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。"
            />
          </label>
        </el-tab-pane>

        <!-- WebDAV -->
        <el-tab-pane label="WebDAV" name="webdav">
          <section class="rounded-lg border border-white/10 p-3">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-white">WebDAV 同步</div>
                <div class="mt-1 text-xs text-white/45">
                  同步画布与素材等数据，不包含 AI API Key；连接经服务端代理（不在浏览器直连）。
                </div>
              </div>
              <div class="text-xs text-white/40">{{ formatSyncTime(webdavDraft.lastSyncedAt) }}</div>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="block md:col-span-2">
                <span class="mb-1 block text-[11px] text-white/50">连接方式</span>
                <el-radio-group model-value="proxy">
                  <el-radio-button value="proxy">服务端代理</el-radio-button>
                </el-radio-group>
                <span class="mt-1 block text-[10px] text-white/35">本产品仅支持服务端代理模式</span>
              </label>
              <label class="block">
                <span class="mb-1 block text-[11px] text-white/50">WebDAV 地址</span>
                <el-input v-model="webdavDraft.url" placeholder="https://nas.example.com/webdav" />
              </label>
              <label class="block">
                <span class="mb-1 block text-[11px] text-white/50">远程目录</span>
                <el-input v-model="webdavDraft.directory" placeholder="lnkpi" />
              </label>
              <label class="block">
                <span class="mb-1 block text-[11px] text-white/50">用户名</span>
                <el-input v-model="webdavDraft.username" autocomplete="username" />
              </label>
              <label class="block">
                <span class="mb-1 block text-[11px] text-white/50">密码 / 应用密码</span>
                <el-input
                  v-model="webdavDraft.password"
                  type="password"
                  show-password
                  autocomplete="current-password"
                  :placeholder="webdavDraft.hasPassword && !webdavDraft.clearPassword ? '已保存（留空保留）' : ''"
                  @input="webdavDraft.clearPassword = false"
                />
                <button
                  v-if="webdavDraft.hasPassword"
                  type="button"
                  class="mt-1 text-[10px] text-white/35 hover:text-white/60"
                  @click="webdavDraft.clearPassword = true; webdavDraft.password = ''"
                >
                  清除已保存密码
                </button>
              </label>
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <el-button
                :disabled="!webdavDraft.url.trim() || syncingWebdav"
                :loading="testingWebdav"
                @click="testWebdav"
              >
                测试连接
              </el-button>
              <el-button
                type="primary"
                :disabled="!webdavDraft.url.trim() || testingWebdav"
                :loading="syncingWebdav"
                @click="syncWebdav"
              >
                {{ syncingWebdav ? '同步中' : '立即同步' }}
              </el-button>
            </div>
          </section>
        </el-tab-pane>
      </el-tabs>
    </div>

    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="finish">完成</el-button>
    </template>
  </el-dialog>
</template>

<style>
.provider-config-dialog .el-dialog {
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  max-width: 96vw;
}
.provider-config-dialog .el-dialog__header {
  margin-right: 0;
  padding-bottom: 8px;
}
.provider-config-dialog .el-dialog__title,
.provider-config-dialog .el-dialog__headerbtn .el-dialog__close {
  color: #fff;
}
.provider-config-dialog .el-dialog__body {
  max-height: 72vh;
  overflow-y: auto;
  padding-top: 4px;
}
.provider-config-dialog .el-tabs__item {
  color: rgba(255, 255, 255, 0.45);
}
.provider-config-dialog .el-tabs__item.is-active {
  color: #818cf8;
}
.provider-config-dialog .el-tabs__active-bar {
  background-color: #6366f1;
}
.provider-config-body {
  min-height: 240px;
}
</style>
