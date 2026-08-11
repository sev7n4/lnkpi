<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import type { SidebarAttachment } from '@lnkpi/shared'
import { normalizeMentionedKeys, SIDEBAR_ATTACHMENT_MAX } from '@lnkpi/shared'
import { apiUrl } from '@/services/api-base'
import { sessionsApi } from '@/services/sessions-api'
import NeoAgentLogo from '@/components/agent/NeoAgentLogo.vue'
import AgentRefStrip from '@/components/agent/AgentRefStrip.vue'
import AgentAssetPicker from '@/components/agent/AgentAssetPicker.vue'
import AgentTaskProgressCard from '@/components/agent/AgentTaskProgressCard.vue'
import AgentCanvasOutputs from '@/components/agent/AgentCanvasOutputs.vue'
import AgentExecutionTrace from '@/components/agent/AgentExecutionTrace.vue'
import { resolveMessageOutputs } from '@/components/agent/agentCanvasOutputs'
import type { AgentStreamMessage } from '@/stores/agent'
import {
  applyTaskEvent,
  applyPollRecordToTask,
  emptyTaskProgress,
  type AgentTaskProgressState,
} from '@/components/agent/agentTaskProgress'
import { useGenerationPolling, type GenerationPollTask } from '@/composables/useGenerationPolling'
import { useAgentStream, formatPhaseLabel } from '@/composables/useAgentStream'
import {
  reconcileTaskProgress,
  shouldFinishTaskCard,
  synthesizeSummary,
  type CanvasNodeLike,
} from '@/components/agent/taskProgressReconcile'
import {
  looksLikeConfirmTurn,
  pickAssistantForLatestUserTurn,
  shouldApplyReconciledAssistant,
} from '@/components/agent/assistantReconcile'
import ProductVisualDeliveryCard from '@/components/agent/ProductVisualDeliveryCard.vue'
import { detectAgentChipSet } from '@/components/agent/agentChipSet'
import {
  chipSetFromInterrupt,
  IMAGE_QA_OPTIONS,
  interruptPayloadFromThreadState,
  buildSchemeConfirmMessage,
  buildMacroSchemeConfirmMessage,
  buildVisualIntentSummary,
  buildDeliveryConfirmMessage,
  buildDeliveryRefineMessage,
  buildDeliverySwitchMessage,
  buildShotDeliveryConfirmMessage,
  buildShotDeliverySwitchMessage,
  defaultDeliverySelections,
  defaultMacroSchemeSelection,
  defaultSchemeSelections,
  defaultShotDeliverySelections,
  selectableImageTypes,
  type AgentInterruptPayload,
  type ProductVisualMacroScheme,
  type ProductVisualPlan,
  type ProductVisualShot,
} from '@/components/agent/agentInterruptGate'
import { phaseHintFromInterrupt } from '@/components/agent/executionStepLabels'
import {
  buildIdempotencyKey,
  createAgentThreadId,
  persistActiveThreadId,
  resolveBootstrapThreadId,
  shouldPollRuntimeHealth,
  checkRuntimeHealthViaNest,
  RUNTIME_UNREACHABLE_SNIPPET,
} from '@/components/agent/streamRecovery'
import ForceChoiceDialog, { type ForceChoiceKind } from '@/components/agent/ForceChoiceDialog.vue'
import DockGenerateButton from '@/components/canvas/dock-studio/shared/DockGenerateButton.vue'
import DockMicButton from '@/components/canvas/dock-studio/shared/DockMicButton.vue'
import { useSpeechRecognition } from '@/composables/useSpeechRecognition'
import { useSidebarAttachments, assignRefKeysFor, type FocusNodeLike, type CanvasRefAddResult } from '@/composables/useSidebarAttachments'
import { parseRefMentions } from '@/composables/useRefMentions'
import MentionInput, { type MentionOption } from '@/components/canvas/MentionInput.vue'
import { copyTextToClipboard } from '@/utils/copyToClipboard'
import { useClickOutside } from '@/composables/useClickOutside'
import { useProviderBootstrap } from '@/composables/useProviderBootstrap'
import {
  AGENT_SKILLS,
  agentInputPlaceholder,
  getAgentSkill,
} from '@/constants/agentSkillMap'
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import CanvasRefTargetIcon from '@/components/shared/CanvasRefTargetIcon.vue'
import { useCanvasRefPickMode } from '@/composables/useCanvasRefPickMode'
import { formatDuration as formatTraceDuration } from '@/components/agent/executionStepLabels'
import { formatSessionTime, lastThreadStorageKey } from '@/utils/formatSessionTime'
import { randomId } from '@/utils/randomId'
import { ElMessage } from 'element-plus'

interface AgentThreadRow {
  id: string
  title: string
  updatedAt: string
  createdAt: string
}

const props = defineProps<{
  sessionId: string
  /** 当前登录用户非画布所有者时为 true，禁止 Agent 写入画布 */
  readOnly?: boolean
  /** W30: 画布选中节点 id，配合「快速生成」走单节点路径 */
  selectedNodeId?: string | null
  /** M2: 选中节点数据，发送时升格为 canvasNode attachment */
  selectedNode?: { id: string; type?: string; data?: Record<string, unknown> } | null
}>()

const emit = defineEmits<{
  canvasActions: [actions: unknown[]]
  /** Agent 一轮结束后由画布从服务端回拉 SoT，避免本地旧图覆盖 Nest 拆图结果 */
  turnComplete: []
  focusNode: [nodeId: string]
  focusAll: [nodeIds: string[]]
  undo: []
  redo: []
  openImageEditor: [nodeId: string]
  expandedChange: [expanded: boolean]
  /** 切换画布引用 Pick 模式（由 CanvasPage 处理选中 seed） */
  canvasRefPickToggle: []
}>()

const pickMode = useCanvasRefPickMode()

const agent = useAgentStore()
const auth = useAuthStore()
const router = useRouter()
const input = ref('')
const composerRef = ref<InstanceType<typeof MentionInput> | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const chatContainer = ref<HTMLElement>()
const sidebar = useSidebarAttachments()
const isUploading = ref(false)
const isDragOver = ref(false)
const assetPickerOpen = ref(false)
const attachMenuOpen = ref(false)
const attachMenuRef = ref<HTMLElement | null>(null)
useClickOutside(attachMenuRef, () => {
  attachMenuOpen.value = false
})

function makeAttachmentItems(
  attachments: SidebarAttachment[] | undefined,
  refKeys: string[] | undefined,
) {
  const list = attachments ?? []
  const keys = refKeys?.length === list.length ? refKeys : assignRefKeysFor(list)
  return list.map((attachment, index) => ({
    attachment,
    refKey: keys[index] ?? attachment.id,
  }))
}

function clearComposer() {
  input.value = ''
  sidebar.clear()
}

function reattachFromHistory(attachment: SidebarAttachment) {
  if (sidebar.pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) {
    ElMessage.warning(`最多 ${SIDEBAR_ATTACHMENT_MAX} 个引用`)
    return
  }
  dismissHistoryReattachCoachmark()
  sidebar.addFromPayload({ ...attachment, id: randomId() })
  const keys = sidebar.assignRefKeys()
  const idx = sidebar.pendingAttachments.value.length - 1
  if (keys[idx]) insertRefMention(keys[idx])
  nextTick(() => composerRef.value?.focus())
}

const HISTORY_REATTACH_HINT_KEY = 'agent-history-reattach-hint'
const historyReattachHintSeen = ref(false)

onMounted(() => {
  try {
    historyReattachHintSeen.value = localStorage.getItem(HISTORY_REATTACH_HINT_KEY) === '1'
  } catch {
    historyReattachHintSeen.value = false
  }
})

function dismissHistoryReattachCoachmark() {
  historyReattachHintSeen.value = true
  try {
    localStorage.setItem(HISTORY_REATTACH_HINT_KEY, '1')
  } catch {
    /* ignore quota / private mode */
  }
}

function canReuseTurn(msg: AgentStreamMessage): boolean {
  if (msg.role !== 'user') return false
  return Boolean(msg.content?.trim()) || (msg.attachments?.length ?? 0) > 0
}

async function reattachTurnFromHistory(msg: AgentStreamMessage) {
  if (props.readOnly || !canReuseTurn(msg)) return

  dismissHistoryReattachCoachmark()
  sidebar.clear()

  const items = makeAttachmentItems(msg.attachments, msg.attachmentRefKeys)
  for (const { attachment } of items) {
    if (sidebar.pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) {
      ElMessage.warning(`最多 ${SIDEBAR_ATTACHMENT_MAX} 个引用，已跳过其余项`)
      break
    }
    sidebar.addFromPayload({ ...attachment, id: randomId() })
  }

  sidebar.assignRefKeys()

  const original = (msg.content ?? '').trim()
  if (original) {
    // 保留原始 @ 提及与提示词顺序；避免 insertText 与 v-model 竞态导致只剩引用
    input.value = original
  } else {
    const keys = sidebar.assignRefKeys()
    input.value = keys.map((key) => `@${key}`).join(' ')
  }

  await nextTick()
  composerRef.value?.focus()
  ElMessage.success('已复用本轮提示词与引用')
}

const messageFeedback = ref<Record<string, 'up' | 'down'>>({})
const copiedMessageId = ref<string | null>(null)
let copiedMessageTimer: number | null = null

function canShowMessageActions(msg: AgentStreamMessage): boolean {
  if (msg.role !== 'assistant' || msg.streaming) return false
  if (isLiveTurnMessage(msg) && (agent.isStreaming || showTaskCard.value)) return false
  return Boolean(
    msg.content.trim()
    || (assistantOutputsById.value.get(msg.id)?.length ?? 0) > 0
    || msg.executionTrace,
  )
}

function toggleMessageFeedback(msgId: string, vote: 'up' | 'down') {
  if (messageFeedback.value[msgId] === vote) {
    const next = { ...messageFeedback.value }
    delete next[msgId]
    messageFeedback.value = next
    return
  }
  messageFeedback.value = { ...messageFeedback.value, [msgId]: vote }
}

async function copyAssistantMessage(msg: AgentStreamMessage) {
  const text = msg.content.trim()
  if (!text) return
  try {
    await copyTextToClipboard(text)
    copiedMessageId.value = msg.id
    if (copiedMessageTimer !== null) window.clearTimeout(copiedMessageTimer)
    copiedMessageTimer = window.setTimeout(() => {
      if (copiedMessageId.value === msg.id) copiedMessageId.value = null
      copiedMessageTimer = null
    }, 1600)
  } catch {
    ElMessage.error('复制失败')
  }
}

const threadHasReattachableHistory = computed(() =>
  agent.messages.some((msg) => canReuseTurn(msg)),
)

const showHistoryReattachCoachmark = computed(
  () => !props.readOnly && !historyReattachHintSeen.value && threadHasReattachableHistory.value,
)

const showComposerReattachHint = computed(
  () =>
    !props.readOnly
    && pendingAttachmentItems.value.length === 0
    && !input.value.trim()
    && threadHasReattachableHistory.value,
)

const pendingAttachmentItems = computed(() =>
  makeAttachmentItems(sidebar.pendingAttachments.value, sidebar.assignRefKeys()),
)

const showPickHint = computed(
  () => !props.readOnly && pendingAttachmentItems.value.length === 0 && !pickMode.active.value,
)

/** 输入框左上角 🎯 圆心重合时的文字起始内边距（半径 + 小间距） */
const COMPOSER_PICK_INSET = 18

const mentionOptions = computed((): MentionOption[] =>
  pendingAttachmentItems.value.map(({ refKey, attachment }) => ({
    id: attachment.id,
    label: refKey,
    type: attachment.mediaType,
  })),
)

function insertRefMention(refKey: string) {
  const token = `@${refKey} `
  composerRef.value?.insertText(input.value ? ` ${token}` : token)
  nextTick(() => composerRef.value?.focus())
}

/** Runtime LangGraph thread；与画布 sessionId 解耦，新建对话时重置 */
const agentThreadId = ref(createAgentThreadId(props.sessionId))
const taskProgress = ref<AgentTaskProgressState>(emptyTaskProgress())
const showTaskCard = computed(() => taskProgress.value.items.length > 0)

const lastAssistantMessageId = computed(() =>
  [...agent.messages].reverse().find((m) => m.role === 'assistant')?.id,
)

function isLiveTurnMessage(msg: AgentStreamMessage): boolean {
  if (msg.role !== 'assistant') return false
  if (msg.id !== lastAssistantMessageId.value) return false
  return Boolean(msg.streaming) || Boolean(msg.executionTrace) || showTaskCard.value
}

function canvasOutputsForMessage(msg: AgentStreamMessage) {
  return resolveMessageOutputs({
    linkedOutputs: msg.linkedOutputs,
    canvasActions: msg.canvasActions,
    traceSteps: msg.executionTrace?.steps,
    taskItems: isLiveTurnMessage(msg) ? taskProgress.value.items : undefined,
    isLiveTurn: isLiveTurnMessage(msg),
  })
}

const assistantOutputsById = computed(() => {
  const map = new Map<string, ReturnType<typeof canvasOutputsForMessage>>()
  for (const msg of agent.messages) {
    if (msg.role === 'assistant') {
      map.set(msg.id, canvasOutputsForMessage(msg))
    }
  }
  return map
})
const forceChoiceOpen = ref(false)
const forceChoiceKind = ref<ForceChoiceKind | null>(null)

const taskRecordPolling = useGenerationPolling((results) => {
  for (const { task, record } of results) {
    taskProgress.value = applyPollRecordToTask(
      taskProgress.value,
      task.nodeId,
      record.status,
    )
  }
})

function startTaskRecordPoll(tasks: GenerationPollTask[]) {
  if (!tasks.length) return
  taskRecordPolling.start(tasks)
}

function pollTasksFromProgress() {
  const tasks: GenerationPollTask[] = []
  for (const it of taskProgress.value.items) {
    if (it.recordId && it.nodeId) {
      tasks.push({ recordId: it.recordId, nodeId: it.nodeId })
    }
  }
  startTaskRecordPoll(tasks)
}

let streamAbortController: AbortController | null = null
const reconnecting = ref(false)
const recoveredPhaseHint = ref<string | null>(null)
/** P0-06: authoritative gate from SSE interrupt or thread-state reconnect */
const interruptGate = ref<AgentInterruptPayload | null>(null)
/** LangGraph checkpoint: same thread can regenerate/variant on prior atomic node */
const hasAtomicCheckpoint = ref(false)

const agentStream = useAgentStream({
  onStale: () => {
    streamAbortController?.abort()
  },
})

/** 方案确认门 / 主文案确认门：侧栏快捷钮 */
const chipSet = computed(() => {
  const fromInterrupt = chipSetFromInterrupt(interruptGate.value)
  if (fromInterrupt) return fromInterrupt
  if (agent.isStreaming) return null
  const last = [...agent.messages].reverse().find((m) => m.role === 'assistant')
  // 修复 P1-4：把"最近用户消息"传入 detectAgentChipSet，避免 modify 阶段误显示 plan 按钮
  const lastUser = [...agent.messages].reverse().find((m) => m.role === 'user')
  return detectAgentChipSet(last?.content || '', { latestUserText: lastUser?.content })
})
const awaitingConfirm = computed(() => chipSet.value === 'plan')
const awaitingCopyConfirm = computed(() => chipSet.value === 'copy')
const awaitingTopoConfirm = computed(() => chipSet.value === 'topo')
const awaitingAtomicConfirm = computed(() => chipSet.value === 'atomic')
const awaitingImageQa = computed(() => chipSet.value === 'image_qa')
const awaitingSchemeSelect = computed(() => chipSet.value === 'scheme_select')
const awaitingMacroSchemeSelect = computed(() => chipSet.value === 'macro_scheme_select')
const awaitingShotConfirm = computed(
  () =>
    interruptGate.value?.phase === 'await_shot_confirm' ||
    interruptGate.value?.node === 'await_shot_confirm',
)
const awaitingDeliveryConfirm = computed(() => chipSet.value === 'delivery_confirm')
const productVisualPlan = ref<ProductVisualPlan | null>(null)
const macroSchemes = ref<ProductVisualMacroScheme[]>([])
const macroSelections = ref<string[]>([])
const shotManifest = ref<ProductVisualShot[]>([])
const productVisualSchemeV2 = ref(false)
const schemeSelections = ref<Record<string, string[]>>({})
const deliverySelections = ref<Record<string, string>>({})
const deliveryGenByKey = ref<Record<string, { node_id?: string | null; url?: string | null; title?: string | null }>>({})
const deliveryRefineDraft = ref<Record<string, string>>({})
const schemeSelectTypes = computed(() => selectableImageTypes(productVisualPlan.value))
const visualIntentSummary = computed(() => buildVisualIntentSummary(productVisualPlan.value))

function syncSchemeSelectionsFromPlan(plan: ProductVisualPlan | null | undefined) {
  productVisualPlan.value = plan ?? null
  schemeSelections.value = defaultSchemeSelections(plan)
}

function syncMacroSchemes(schemes: ProductVisualMacroScheme[] | null | undefined) {
  macroSchemes.value = schemes ?? []
  macroSelections.value = defaultMacroSchemeSelection(schemes)
}

function syncShotManifest(shots: ProductVisualShot[] | null | undefined) {
  shotManifest.value = shots ?? []
}

function toggleMacroSelection(schemeId: string, checked: boolean) {
  const current = new Set(macroSelections.value)
  if (checked) {
    current.add(schemeId)
    if (current.size > 2) {
      const first = macroSelections.value[0]
      if (first) current.delete(first)
    }
  } else {
    current.delete(schemeId)
  }
  macroSelections.value = [...current]
}

async function sendMacroSchemeConfirm() {
  const message = buildMacroSchemeConfirmMessage(macroSelections.value)
  await sendMessage(message, 'confirm')
}

async function sendMacroSchemeRevise() {
  await sendMessage('需要调整方案', 'revise')
}

async function sendShotConfirm() {
  await sendMessage('确认出图', 'confirm_gen')
}

async function sendShotRevise() {
  await sendMessage('调整构图', 'revise')
}

function syncDeliveryCheckpoint(
  plan: ProductVisualPlan | null | undefined,
  selections: Record<string, string> | null | undefined,
  genByKey: Record<string, { node_id?: string | null; url?: string | null; title?: string | null }> | null | undefined,
) {
  if (plan) productVisualPlan.value = plan
  const merged = productVisualSchemeV2.value && shotManifest.value.length
    ? {
        ...defaultShotDeliverySelections(shotManifest.value, genByKey),
        ...(selections ?? {}),
      }
    : {
        ...defaultDeliverySelections(plan ?? productVisualPlan.value, genByKey),
        ...(selections ?? {}),
      }
  deliverySelections.value = merged
  deliveryGenByKey.value = genByKey ?? deliveryGenByKey.value
}

function toggleSchemeSelection(typeId: string, schemeId: string, checked: boolean) {
  const current = new Set(schemeSelections.value[typeId] ?? [])
  if (checked) current.add(schemeId)
  else current.delete(schemeId)
  schemeSelections.value = { ...schemeSelections.value, [typeId]: [...current] }
}

async function sendSchemeConfirm() {
  const message = buildSchemeConfirmMessage(schemeSelections.value)
  await sendMessage(message, 'confirm')
}

async function sendSchemeRevisePreset() {
  await sendMessage('需要调整方案', 'revise')
}

async function sendDeliverySwitch(typeId: string, schemeId: string) {
  deliverySelections.value = { ...deliverySelections.value, [typeId]: schemeId }
  await sendMessage(buildDeliverySwitchMessage(typeId, schemeId))
}

async function sendDeliveryRefine(typeId: string, feedback: string) {
  const schemeId = deliverySelections.value[typeId]
  if (!schemeId) return
  await sendMessage(buildDeliveryRefineMessage(typeId, schemeId, feedback))
}

async function sendDeliveryConfirmAll() {
  await sendMessage(buildDeliveryConfirmMessage(deliverySelections.value), 'confirm')
}

const canSubmitComposer = computed(() =>
  Boolean(input.value.trim() || sidebar.pendingAttachments.value.length),
)

function openFilePicker() {
  if (!props.readOnly && !isUploading.value) {
    fileInputRef.value?.click()
  }
}

function addAssetReference(attachment: SidebarAttachment) {
  if (props.readOnly) return
  sidebar.addFromPayload(attachment)
}

function addAttachment(attachment: SidebarAttachment) {
  if (props.readOnly) return
  sidebar.addFromPayload({ ...attachment, id: randomId() })
}

function setComposerInput(text: string) {
  input.value = text
  nextTick(() => composerRef.value?.focus())
}

function toggleAttachMenu() {
  if (props.readOnly || isUploading.value) return
  attachMenuOpen.value = !attachMenuOpen.value
}

function pickLocalUpload() {
  attachMenuOpen.value = false
  openFilePicker()
}

function pickAssetLibrary() {
  attachMenuOpen.value = false
  assetPickerOpen.value = true
}

function pickCanvasFromMenu() {
  attachMenuOpen.value = false
  onStartCanvasPick()
}

function onCanvasRefPickToggle() {
  emit('canvasRefPickToggle')
}

function onStartCanvasPick() {
  if (!pickMode.active.value) emit('canvasRefPickToggle')
}

function onInputDockPointerDown(event: PointerEvent) {
  if (!pickMode.active.value) return
  const target = event.target as Element
  if (target.closest('.composer-canvas-pick-btn')) return
  if (target.closest('.agent-attach-menu')) return
  pickMode.deactivate()
}

async function addFiles(files: FileList | File[]) {
  if (props.readOnly || !files.length) return

  isUploading.value = true
  try {
    for (const file of Array.from(files)) {
      await sidebar.addFromFile(file)
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '上传参考素材失败')
  } finally {
    isUploading.value = false
  }
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  void addFiles(target.files ?? []).finally(() => {
    target.value = ''
  })
}

function onDragOver() {
  if (!props.readOnly) isDragOver.value = true
}

function onDragLeave() {
  isDragOver.value = false
}

function onDrop(event: DragEvent) {
  isDragOver.value = false
  void addFiles(event.dataTransfer?.files ?? [])
}

/** 面板是否展开（收缩态只保留右下角 logo FAB） */
const open = ref(false)
/** 浮动窗口模式：面板脱离侧栏，悬浮在画布上，可拖拽 */
const floating = ref(false)

/* ---- 宽度：默认可容纳 dock 底部参数一排，支持拖拉调宽 ---- */
const PANEL_MIN_W = 420
const PANEL_MAX_W = 760
const PANEL_DEFAULT_W = 500
const panelWidth = ref(PANEL_DEFAULT_W)
const resizing = ref(false)

/* ---- 浮窗位置 / 尺寸 ---- */
const floatPos = ref({ x: 0, y: 0 })
const floatWidth = ref(PANEL_DEFAULT_W)
const dragging = ref(false)

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

const speech = useSpeechRecognition()

const { preferences, load: loadProviderBootstrap } = useProviderBootstrap()
const planningModel = ref(preferences.value?.defaultTextModel ?? '')

/* ---- 技能选择（显式 Skill；默认自动 / 平台路由） ---- */
const activeSkillId = ref<string | null>(null)
const activeSkill = computed(() => getAgentSkill(activeSkillId.value))
const skillButtonLabel = computed(() => activeSkill.value?.label ?? '技能')
const inputPlaceholder = computed(() => agentInputPlaceholder(activeSkill.value))
const skillMenuOpen = ref(false)
const skillMenuRef = ref<HTMLElement | null>(null)
useClickOutside(skillMenuRef, () => {
  skillMenuOpen.value = false
})

/* ---- 对话 thread 列表 ---- */
const historyOpen = ref(false)
const historyRef = ref<HTMLElement | null>(null)
const threads = ref<AgentThreadRow[]>([])
useClickOutside(historyRef, () => {
  historyOpen.value = false
})

async function fetchThreads(): Promise<AgentThreadRow[]> {
  try {
    const res = await fetch(
      apiUrl(`/api/agent/chat/threads?sessionId=${encodeURIComponent(props.sessionId)}`),
    )
    const json = await res.json()
    const rows = (json.data ?? []) as AgentThreadRow[]
    threads.value = rows
    return rows
  } catch {
    return []
  }
}

async function toggleHistoryOpen() {
  historyOpen.value = !historyOpen.value
  if (historyOpen.value) {
    await fetchThreads()
  }
}

async function selectThread(threadId: string) {
  if (threadId === agentThreadId.value) {
    historyOpen.value = false
    return
  }
  clearComposer()
  agentThreadId.value = threadId
  persistActiveThreadId(props.sessionId, threadId)
  historyOpen.value = false
  taskProgress.value = emptyTaskProgress()
  interruptGate.value = null
  hasAtomicCheckpoint.value = false
  recoveredPhaseHint.value = null
  await loadHistory()
  void refreshThreadCheckpoint()
}

async function bootstrapThread() {
  clearComposer()
  agent.clear()
  taskProgress.value = emptyTaskProgress()
  const cached = localStorage.getItem(lastThreadStorageKey(props.sessionId))
  const list = await fetchThreads()
  agentThreadId.value = await resolveBootstrapThreadId(props.sessionId, {
    cachedThreadId: cached,
    threads: list,
    messageCountFor: async (threadId) => {
      try {
        const res = await fetch(
          apiUrl(
            `/api/agent/chat/user/messages?sessionId=${encodeURIComponent(props.sessionId)}&threadId=${encodeURIComponent(threadId)}`,
          ),
        )
        const json = await res.json()
        return Array.isArray(json.data) ? json.data.length : 0
      } catch {
        return 0
      }
    },
  })
  persistActiveThreadId(props.sessionId, agentThreadId.value)
  await loadHistory()
  void refreshThreadCheckpoint()
  scrollToBottom()
}

onMounted(() => {
  void bootstrapThread()
  void loadProviderBootstrap().then(() => {
    if (!planningModel.value && preferences.value?.defaultTextModel) {
      planningModel.value = preferences.value.defaultTextModel
    }
  })
})

watch(
  () => props.sessionId,
  () => {
    taskProgress.value = emptyTaskProgress()
    interruptGate.value = null
    hasAtomicCheckpoint.value = false
    recoveredPhaseHint.value = null
    void bootstrapThread()
  },
)

function openPanel() {
  open.value = true
  emit('expandedChange', true)
  scrollToBottom()
}

function closePanel() {
  open.value = false
  emit('expandedChange', false)
}

function toggleFloating() {
  floating.value = !floating.value
  if (floating.value) {
    // 首次浮出时把面板放到画布右侧默认位置
    floatWidth.value = clamp(panelWidth.value, PANEL_MIN_W, window.innerWidth - 48)
    floatPos.value = {
      x: Math.max(16, window.innerWidth - floatWidth.value - 40),
      y: 56,
    }
  }
}

/* ---- 浮窗拖拽（按住头部空白处移动） ---- */
function startDrag(event: MouseEvent) {
  if (!floating.value) return
  if ((event.target as HTMLElement).closest('button, input, textarea')) return
  event.preventDefault()
  dragging.value = true
  const offsetX = event.clientX - floatPos.value.x
  const offsetY = event.clientY - floatPos.value.y
  const onMove = (ev: MouseEvent) => {
    floatPos.value = {
      x: clamp(ev.clientX - offsetX, -floatWidth.value + 120, window.innerWidth - 120),
      y: clamp(ev.clientY - offsetY, 0, window.innerHeight - 64),
    }
  }
  const onUp = () => {
    dragging.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/* ---- 左边缘拖拉调宽（侧栏 / 浮窗通用） ---- */
function startResize(event: MouseEvent) {
  event.preventDefault()
  resizing.value = true
  const floatRight = floatPos.value.x + floatWidth.value
  const onMove = (ev: MouseEvent) => {
    if (floating.value) {
      const width = clamp(floatRight - ev.clientX, PANEL_MIN_W, PANEL_MAX_W)
      floatWidth.value = width
      floatPos.value = { ...floatPos.value, x: floatRight - width }
    } else {
      panelWidth.value = clamp(window.innerWidth - ev.clientX, PANEL_MIN_W, PANEL_MAX_W)
    }
  }
  const onUp = () => {
    resizing.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function newAgentSession() {
  clearComposer()
  agent.clear()
  taskProgress.value = emptyTaskProgress()
  interruptGate.value = null
  hasAtomicCheckpoint.value = false
  recoveredPhaseHint.value = null
  agentThreadId.value = createAgentThreadId(props.sessionId)
  persistActiveThreadId(props.sessionId, agentThreadId.value)
  ElMessage.info('已新建对话')
}

async function refreshThreadCheckpoint() {
  try {
    const token = localStorage.getItem('token')
    const res = await fetch(
      apiUrl(`/api/agent/thread-state?threadId=${encodeURIComponent(agentThreadId.value)}`),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const json = (await res.json()) as {
      data?: {
        hasAtomicCheckpoint?: boolean
        interrupted?: boolean
        phase?: string | null
        productVisualPlan?: ProductVisualPlan | null
        macroSchemes?: ProductVisualMacroScheme[] | null
        shotManifest?: ProductVisualShot[] | null
        visualIntent?: Record<string, unknown> | null
        productVisualSchemeV2?: boolean | null
        deliverySelections?: Record<string, string> | null
        deliveryGenByKey?: Record<string, { node_id?: string | null; url?: string | null; title?: string | null }> | null
      }
    }
    hasAtomicCheckpoint.value = Boolean(json.data?.hasAtomicCheckpoint)
    if (json.data?.productVisualSchemeV2 != null) {
      productVisualSchemeV2.value = Boolean(json.data.productVisualSchemeV2)
    }
    if (json.data?.macroSchemes) {
      syncMacroSchemes(json.data.macroSchemes)
    }
    if (json.data?.shotManifest) {
      syncShotManifest(json.data.shotManifest)
    }
    if (json.data?.productVisualPlan) {
      syncSchemeSelectionsFromPlan(json.data.productVisualPlan)
    }
    if (json.data?.productVisualPlan || json.data?.deliverySelections || json.data?.deliveryGenByKey) {
      syncDeliveryCheckpoint(
        json.data?.productVisualPlan,
        json.data?.deliverySelections,
        json.data?.deliveryGenByKey,
      )
    }
    if (json.data?.interrupted) {
      interruptGate.value = interruptPayloadFromThreadState(json.data)
    }
  } catch {
    // ignore — checkpoint hint is best-effort
  }
}

async function loadHistory() {
  agent.clear()
  taskProgress.value = emptyTaskProgress()
  try {
    const res = await fetch(
      apiUrl(
        `/api/agent/chat/user/messages?sessionId=${encodeURIComponent(props.sessionId)}&threadId=${encodeURIComponent(agentThreadId.value)}`,
      ),
    )
    if (!res.ok) {
      ElMessage.warning('对话历史加载失败，请检查网络后刷新')
      return
    }
    const json = await res.json()
    if (json.data?.length) agent.loadHistory(json.data)
  } catch {
    ElMessage.warning('对话历史加载失败，请检查网络后刷新')
  }
  scrollToBottom()
}

function toggleVoice() {
  if (speech.listening.value) {
    speech.stop()
    return
  }
  speech.start((text, isFinal) => {
    if (isFinal) {
      input.value = input.value ? `${input.value} ${text}` : text
    }
  })
}

async function send() {
  if (!canSubmitComposer.value || agent.isStreaming || isUploading.value) return
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  persistActiveThreadId(props.sessionId, agentThreadId.value)

  const message = input.value.trim()
  input.value = ''
  // W5：手动输入若匹配确认/修改关键词，带上 userDecision，供 interrupt_before gate 恢复
  await sendMessage(message, mapPresetToDecision(message))
}

async function onForceChoiceAction(message: string) {
  await sendMessage(message, mapPresetToDecision(message))
}

async function sendPreset(text: string) {
  if (agent.isStreaming || isUploading.value || !text.trim()) return
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  input.value = ''
  // W5 修复：按钮选择是结构化决策（confirm/revise），需显式传递 userDecision
  // 否则后端 interrupt_before 恢复（aupdate_state + astream(None)）拿不到 userDecision，会卡在 await_confirm
  const decision = mapPresetToDecision(text)
  await sendMessage(text.trim(), decision)
}

/** 把按钮文本映射为后端可识别的 userDecision 值。 */
function mapPresetToDecision(text: string): 'confirm' | 'revise' | undefined {
  const t = (text || '').trim()
  if (
    t === '1'
    || t === 'A'
    || t === '确认方案'
    || t === '确认出图'
    || t === '确认生成'
    || t === '写入主文案'
  ) {
    return 'confirm'
  }
  if (
    t === '2'
    || t === 'B'
    || t === '3'
    || t === 'C'
    || t === '取消'
    || t === '换方向'
    || t === '自己说明修改'
    || t === '要修改'
    || t === '要改拓扑：'
    || t === '退出'
    || t === '退出当前流程'
  ) {
    return 'revise'
  }
  return undefined
}

function goToWorkflowHome() {
  void router.push('/workflow')
}

async function createOwnCanvas() {
  if (!auth.isLoggedIn) {
    auth.openLogin()
    return
  }
  try {
    const { data } = await sessionsApi.create({ title: '我的画布' })
    void router.push(`/workflow/${data.data.id}`)
  } catch {
    goToWorkflowHome()
  }
}

async function sendMessage(message: string, userDecision?: 'confirm' | 'revise') {
  const selectableTextModels = preferences.value?.selectableTextModels ?? []
  if (planningModel.value && !selectableTextModels.includes(planningModel.value)) {
    ElMessage.warning('当前规划模型已停用，请重新选择')
    return
  }

  persistActiveThreadId(props.sessionId, agentThreadId.value)
  taskProgress.value = emptyTaskProgress()

  const { attachments: pendingAttachments } = sidebar.toPayload()
  const attachments = pendingAttachments
  const mentionedKeys = normalizeMentionedKeys(parseRefMentions(message))
  const refOrder = attachments.map((a) => a.id)
  const attachmentRefKeys = assignRefKeysFor(attachments)
  const userMessageExtras = attachments.length
    ? { attachments, attachmentRefKeys }
    : undefined

  if (props.readOnly) {
    agent.addUserMessage(message, userMessageExtras)
    sidebar.clear()
    agent.startAssistantMessage()
    agent.appendText(
      '⚠️ 此画布不属于当前账号，无法写入。请返回工作台新建画布，或使用画布所有者账号登录。',
    )
    agent.finishStreaming()
    await nextTick()
    scrollToBottom()
    return
  }
  agent.addUserMessage(message, userMessageExtras)
  sidebar.clear()
  agent.isStreaming = true
  agent.startAssistantMessage()
  await nextTick()
  scrollToBottom()

  // Generate idempotency key for this request
  const idempotencyKey = buildIdempotencyKey(agentThreadId.value)
  // Track whether SSE stream ended normally (received [DONE])
  let streamEndedNormally = false
  recoveredPhaseHint.value = null
  interruptGate.value = null
  streamAbortController = new AbortController()
  agentStream.start()

  try {
    const token = localStorage.getItem('token')
    const res = await fetch(apiUrl('/api/agent/chat/conversation'), {
      method: 'POST',
      signal: streamAbortController.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        sessionId: props.sessionId,
        message,
        threadId: agentThreadId.value,
        userDecision,
        skillId: activeSkillId.value ?? undefined,
        model: planningModel.value || undefined,
        focusNodeId: props.selectedNodeId || undefined,
        attachments: attachments.length ? attachments : undefined,
        refOrder: refOrder.length ? refOrder : undefined,
        mentionedKeys,
      }),
    })

    const reader = res.body?.getReader()
    if (!reader) return

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        if (line === 'data: [DONE]') {
          streamEndedNormally = true
          continue
        }
        try {
          const event = JSON.parse(line.slice(6)) as { type: string; data: unknown }
          agentStream.touch()
          handleEvent(event)
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') {
      agent.appendText(`\n\n⚠️ 请求失败: ${err}`)
    }
  } finally {
    agentStream.stop()
    streamAbortController = null
    // SSE abnormal-end detection: stream broke without [DONE]
    if (!streamEndedNormally) {
      const last = agent.messages[agent.messages.length - 1]
      if (last?.role === 'assistant' && !last.content.trim()) {
        agent.appendText('\n\n⚠️ 连接意外断开，请稍后重试。')
      } else if (last?.role === 'assistant' && agentStream.unreachable.value) {
        if (!last.content.includes(RUNTIME_UNREACHABLE_SNIPPET)) {
          last.content += `\n\n⚠️ ${RUNTIME_UNREACHABLE_SNIPPET}，已保存进度。请点击下方「重连」继续。`
        }
      }
    }

    const last = agent.messages[agent.messages.length - 1]
    if (last?.role === 'assistant' && !last.content.trim()) {
      agent.appendText('（本轮无文本回复。若在确认方案，可再发「确认」；或点「新建对话」后重试。）')
    }
    agent.finishStreaming()
    await reconcileLatestAssistant()
    await refreshThreadCheckpoint()
    const actions = agent.flushActions()
    if (actions.length) emit('canvasActions', actions)
    // 始终回拉：Runtime 已写 Session.canvasData；本地 save 不得用旧节点覆盖
    emit('turnComplete')
    scrollToBottom()
  }
}

async function reconnectStream() {
  if (reconnecting.value) return
  reconnecting.value = true
  try {
    streamAbortController?.abort()
    agentStream.stop()

    const health = await checkRuntimeHealthViaNest()
    if (!health?.ok) {
      recoveredPhaseHint.value = '生成服务仍不可达，请稍后再试'
      return
    }

    const token = localStorage.getItem('token')
    const res = await fetch(
      apiUrl(`/api/agent/thread-state?threadId=${encodeURIComponent(agentThreadId.value)}`),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const json = (await res.json()) as {
      data?: {
        phase?: string | null
        interrupted?: boolean
        finished?: boolean
        nextNodes?: string[]
        hasAtomicCheckpoint?: boolean
        productVisualPlan?: ProductVisualPlan | null
        macroSchemes?: ProductVisualMacroScheme[] | null
        shotManifest?: ProductVisualShot[] | null
        visualIntent?: Record<string, unknown> | null
        productVisualSchemeV2?: boolean | null
        deliverySelections?: Record<string, string> | null
        deliveryGenByKey?: Record<string, { node_id?: string | null; url?: string | null; title?: string | null }> | null
      } | null
    }
    const phase = json.data?.phase ?? null
    hasAtomicCheckpoint.value = Boolean(json.data?.hasAtomicCheckpoint)
    if (json.data?.productVisualSchemeV2 != null) {
      productVisualSchemeV2.value = Boolean(json.data.productVisualSchemeV2)
    }
    if (json.data?.macroSchemes) {
      syncMacroSchemes(json.data.macroSchemes)
    }
    if (json.data?.shotManifest) {
      syncShotManifest(json.data.shotManifest)
    }
    if (json.data?.productVisualPlan) {
      syncSchemeSelectionsFromPlan(json.data.productVisualPlan)
    }
    if (json.data?.productVisualPlan || json.data?.deliverySelections || json.data?.deliveryGenByKey) {
      syncDeliveryCheckpoint(
        json.data?.productVisualPlan,
        json.data?.deliverySelections,
        json.data?.deliveryGenByKey,
      )
    }
    interruptGate.value = interruptPayloadFromThreadState(json.data)

    const hint = phaseHintFromInterrupt(interruptGate.value)
    if (hint) {
      agent.trackPhaseHint({ phase: interruptGate.value?.phase ?? undefined, label: hint })
    }

    if (agent.isStreaming) {
      agent.finishStreaming()
    }
    agentStream.reset()
    await reconcileLatestAssistant()
    emit('turnComplete')

    const label = formatPhaseLabel(phase)
    recoveredPhaseHint.value =
      json.data?.finished
        ? '服务已恢复。上一轮已完成，可继续新的指令。'
        : `服务已恢复。当前阶段：${label}。请继续操作。`
    pollTasksFromProgress()
  } catch {
    recoveredPhaseHint.value = '重连失败，请稍后再试'
  } finally {
    reconnecting.value = false
    scrollToBottom()
  }
}

const BUSY_TIP_SNIPPET = '上一轮仍在处理中'
const EXEC_PROGRESS_SNIPPET = '出图成功'
const COPY_WRITTEN_SNIPPET = '已将确认的主文案'

/** 流结束后用 DB 历史补齐（避免只看到 busy / 截断 / 被旧确认文案覆盖）。
 *  当检测到仍在生成中时，附加 runtime 健康轮询。 */
async function reconcileLatestAssistant() {
  const localAssistantContent = () =>
    [...agent.messages].reverse().find((m) => m.role === 'assistant')?.content?.trim() ?? ''

  const pull = async () => {
    const res = await fetch(
      apiUrl(
        `/api/agent/chat/user/messages?sessionId=${encodeURIComponent(props.sessionId)}&threadId=${encodeURIComponent(agentThreadId.value)}`,
      ),
    )
    const json = await res.json()
    const rows = (json.data || []) as Array<{ role: string; content: string }>
    const lastDb = pickAssistantForLatestUserTurn(rows)
    if (!lastDb?.content?.trim()) return null
    const lastLocal = agent.messages[agent.messages.length - 1]
    if (
      lastLocal?.role === 'assistant'
      && shouldApplyReconciledAssistant(lastLocal.content || '', lastDb.content)
    ) {
      lastLocal.content = lastDb.content
    }
    return lastDb.content
  }

  try {
    let content = await pull()
    const lastUser = [...agent.messages].reverse().find((m) => m.role === 'user')
    const confirmTurn = lastUser ? looksLikeConfirmTurn(lastUser.content || '') : false
    const effectiveContent = () => content ?? localAssistantContent()
    // busy tip：首轮仍在写 DB；确认拆图：Nest 可能在 Vercel 断流后继续跑完
    const shouldPoll =
      effectiveContent().includes(BUSY_TIP_SNIPPET)
      || (confirmTurn && !effectiveContent().includes(EXEC_PROGRESS_SNIPPET) && !effectiveContent().includes('自动出图'))
    if (shouldPoll) {
      let runtimeFailCount = 0
      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5_000))
        content = await pull()
        const active = effectiveContent()
        if (
          active
          && !active.includes(BUSY_TIP_SNIPPET)
          && (
            active.includes(COPY_WRITTEN_SNIPPET)
            || active.includes(EXEC_PROGRESS_SNIPPET)
            || active.includes('自动出图')
            || active.length > 80
          )
        ) {
          scrollToBottom()
          break
        }
        // Runtime health check (every 3rd poll, i.e. every 15s)
        if (i > 0 && i % 3 === 0 && active && shouldPollRuntimeHealth(active)) {
          const health = await checkRuntimeHealthViaNest()
          if (!health || !health.ok) {
            runtimeFailCount++
            if (runtimeFailCount >= 2) {
              const last = agent.messages[agent.messages.length - 1]
              if (last?.role === 'assistant' && !last.content.includes(RUNTIME_UNREACHABLE_SNIPPET)) {
                last.content += '\n\n⚠️ 生成服务暂时不可达，出图可能已中断。请稍后重试或新建对话。'
              }
              scrollToBottom()
              break
            }
          } else {
            runtimeFailCount = 0
          }
        }
      }
    }
  } catch {
    // ignore
  }
}

function handleEvent(event: { type: string; data: unknown }) {
  switch (event.type) {
    case 'text_replace':
      agent.replaceAssistantText((event.data as { text: string }).text)
      scrollToBottom()
      break
    case 'text_delta':
      agent.appendText((event.data as { text: string }).text)
      scrollToBottom()
      break
    case 'tool_call':
      agent.addToolCall((event.data as { name: string }).name)
      break
    case 'tool_result':
      agent.addToolCall(
        (event.data as { name: string }).name,
        (event.data as { result: unknown }).result,
      )
      break
    case 'canvas_action':
      agent.addCanvasAction(event.data as Parameters<typeof agent.addCanvasAction>[0])
      break
    case 'node_status': {
      const data = event.data as { nodeId: string; status: string; url?: string }
      agent.trackNodeStatus(data)
      break
    }
    case 'step':
      agent.trackStep(event.data as Parameters<typeof agent.trackStep>[0])
      break
    case 'phase_hint':
      agent.trackPhaseHint(event.data as { phase?: string; label: string })
      break
    case 'thinking':
      agent.trackThinking(event.data as { status: string; summary?: string })
      break
    case 'explore':
      agent.trackExplore(event.data as Parameters<typeof agent.trackExplore>[0])
      break
    case 'canvas_command': {
      const cmd = event.data as {
        type: string
        nodeId?: string
        nodeIds?: string[]
        attachments?: SidebarAttachment[]
      }
      if (cmd.type === 'focus_node' && cmd.nodeId) {
        emit('focusNode', cmd.nodeId)
      } else if (cmd.type === 'focus_nodes' && cmd.nodeIds?.length) {
        emit('focusAll', cmd.nodeIds)
      } else if (cmd.type === 'undo') {
        emit('undo')
      } else if (cmd.type === 'redo') {
        emit('redo')
      } else if (cmd.type === 'open_image_editor' && cmd.nodeId) {
        emit('openImageEditor', cmd.nodeId)
      } else if (cmd.type === 'introduce_nodes' && cmd.attachments?.length) {
        for (const att of cmd.attachments) {
          if (sidebar.pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) break
          sidebar.addFromPayload(att)
        }
      }
      break
    }
    case 'task_list':
    case 'task_update':
    case 'task_summary': {
      const prev = taskProgress.value
      taskProgress.value = applyTaskEvent(
        taskProgress.value,
        event as Parameters<typeof applyTaskEvent>[1],
      )
      if (event.type === 'task_update') {
        const data = event.data as {
          recordId?: string
          id?: string
          status?: string
          errorHint?: string
          errorCode?: string
        }
        const item = taskProgress.value.items.find((it) => it.id === data.id)
        if (item) {
          agent.trackTaskUpdate({
            id: item.id,
            status: data.status ?? item.status,
            title: item.title,
            nodeId: item.nodeId,
            errorHint: data.errorHint ?? item.errorHint,
            errorCode: data.errorCode ?? item.errorCode,
          })
        }
        if (item?.recordId && item.nodeId) {
          startTaskRecordPoll([{ recordId: item.recordId, nodeId: item.nodeId }])
        }
      } else if (event.type === 'task_list' && taskProgress.value.items.length !== prev.items.length) {
        pollTasksFromProgress()
      }
      scrollToBottom()
      break
    }
    case 'ping':
      break
    case 'interrupt': {
      const data = event.data as AgentInterruptPayload
      interruptGate.value = {
        interrupted: data.interrupted ?? true,
        phase: data.phase ?? null,
        node: data.node ?? null,
      }
      if (
        data.phase === 'await_scheme_select' ||
        data.node === 'await_scheme_select' ||
        data.phase === 'await_macro_scheme_select' ||
        data.node === 'await_macro_scheme_select' ||
        data.phase === 'await_shot_confirm' ||
        data.node === 'await_shot_confirm' ||
        data.phase === 'await_delivery_confirm' ||
        data.node === 'await_delivery_confirm'
      ) {
        void refreshThreadCheckpoint()
      }
      break
    }
    case 'force_choice': {
      const kind = (event.data as { kind?: string }).kind
      if (kind === 'plan_max_revise' || kind === 'copy_max_revise' || kind === 'gen_partial') {
        forceChoiceKind.value = kind
        forceChoiceOpen.value = true
      }
      break
    }
    case 'error': {
      const data = event.data as {
        message?: string
        error_type?: string
        retry_hint?: string
        tool_name?: string
      }
      agent.trackStructuredError(data)
      agent.appendText(`\n\n⚠️ ${data.message || '发生错误'}`)
      break
    }
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

function reconcileFromNodes(rawNodes: CanvasNodeLike[]) {
  if (!taskProgress.value.items.length) return
  let next = reconcileTaskProgress(taskProgress.value, rawNodes)
  // W11: canvas generationRecordId → start poll for matching task items
  for (const n of rawNodes) {
    const recordId = n.data?.generationRecordId
    if (typeof recordId !== 'string' || !recordId) continue
    const item = next.items.find((it) => it.nodeId === n.id)
    if (item && !item.recordId) {
      next = applyTaskEvent(next, {
        type: 'task_update',
        data: { id: item.id, status: item.status, recordId },
      })
    }
  }
  pollTasksFromProgress()
  if (shouldFinishTaskCard(next, rawNodes) && !next.finished) {
    next = {
      ...next,
      finished: true,
      summary: next.summary ?? synthesizeSummary(next),
    }
  }
  taskProgress.value = next
}

defineExpose({
  openPanel,
  setComposerInput,
  addAttachment,
  reconcileFromNodes,
  addFromCanvasNodes: (nodes: FocusNodeLike[]): CanvasRefAddResult => {
    const result = sidebar.addFromCanvasNodesDetailed(nodes)
    if (result.added < nodes.length && nodes.length === 1) {
      if (result.empty) ElMessage.warning('该节点暂无可用内容')
      else if (result.duplicate) ElMessage.info('该节点已在引用中')
    } else if (result.added < nodes.length && sidebar.pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) {
      ElMessage.warning(`最多 ${SIDEBAR_ATTACHMENT_MAX} 个参考素材`)
    }
    return result
  },
})
</script>

<template>
  <aside
    class="agent-side-rail shrink-0 overflow-visible"
    :class="{ 'is-resizing': resizing, 'is-docked-open': open && !floating }"
    :style="{ width: open && !floating ? `${panelWidth}px` : '0px' }"
  >
    <div class="flex h-full min-h-0">
      <!-- 收缩态：右下角 agent logo 悬浮按钮 -->
      <Teleport to="body">
        <button
          v-if="!open"
          type="button"
          class="agent-fab"
          title="打开 AI 助手"
          @click="openPanel"
        >
          <NeoAgentLogo size="sm" />
        </button>
      </Teleport>

      <!-- 面板：侧栏内嵌 or 浮动窗口（Teleport 到 body） -->
      <Teleport to="body" :disabled="!floating">
        <div
          v-show="open"
          class="agent-panel-shell flex min-w-0 flex-col"
          :class="[
            floating ? 'agent-panel-floating' : 'agent-panel-inline flex-1',
            { 'is-dragging': dragging },
          ]"
          :style="floating ? {
            left: `${floatPos.x}px`,
            top: `${floatPos.y}px`,
            width: `${floatWidth}px`,
          } : undefined"
        >
          <!-- 左边缘拖拉调宽 -->
          <div class="agent-resize-handle" title="拖拉调整宽度" @mousedown="startResize" />

          <!-- 顶栏：logo + 新建 / 历史 / 浮窗切换 / 收起（浮窗模式可按住拖动） -->
          <div
            class="agent-panel-header flex items-center justify-between px-3 py-2"
            :class="floating ? 'cursor-move' : ''"
            @mousedown="startDrag"
          >
            <div class="flex min-w-0 items-center gap-2">
              <NeoAgentLogo size="xs" active />
              <p class="agent-subtitle truncate text-[11px]">lnk·π agent</p>
            </div>
            <div class="flex items-center gap-0.5">
              <!-- 新建 agent 会话 -->
              <button type="button" class="agent-head-btn" title="新建对话" @click="newAgentSession">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" d="M12 5v14M5 12h14" />
                </svg>
              </button>

              <!-- 历史记录 -->
              <div ref="historyRef" class="relative">
                <button
                  type="button"
                  class="agent-head-btn"
                  :class="historyOpen ? 'is-active' : ''"
                  title="对话历史"
                  @click="toggleHistoryOpen"
                >
                  <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                    <circle cx="12" cy="12" r="9" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 7v5l3 2" />
                  </svg>
                </button>
                <div
                  v-if="historyOpen"
                  class="neo-popover absolute right-0 top-full z-20 mt-1.5 max-h-[280px] w-[240px] overflow-y-auto rounded-xl py-1"
                  @click.stop
                >
                  <p class="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--neo-text-muted)]">对话历史</p>
                  <button
                    v-for="thread in threads"
                    :key="thread.id"
                    type="button"
                    class="neo-popover-item block w-full px-3 py-2 text-left text-xs"
                    :class="thread.id === agentThreadId ? '!bg-[var(--neo-hi-bg)] !text-[var(--neo-hi-text)] shadow-[var(--neo-hi-shadow)]' : ''"
                    :title="thread.title"
                    @click="selectThread(thread.id)"
                  >
                    <span class="block truncate font-medium">{{ thread.title }}</span>
                    <span class="block text-[10px] opacity-60">{{ formatSessionTime(thread.updatedAt) }}</span>
                  </button>
                  <p v-if="!threads.length" class="px-3 py-4 text-center text-[11px] text-[var(--neo-text-muted)]">
                    暂无对话记录
                  </p>
                </div>
              </div>

              <!-- 浮动窗口切换：面板脱离/停靠侧栏 -->
              <button
                type="button"
                class="agent-head-btn"
                :class="floating ? 'is-active' : ''"
                :title="floating ? '停靠回侧栏' : '切换为浮动窗口'"
                @click="toggleFloating"
              >
                <!-- 浮窗图标：主窗 + 右上悬浮小窗（带弹出箭头） -->
                <svg v-if="!floating" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" d="M20 9V5.5A1.5 1.5 0 0 0 18.5 4H5.5A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H9" />
                  <rect x="12" y="12" width="9" height="8" rx="1.5" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.5 9.5 13 6m0 0h-2.8M13 6v2.8" transform="translate(-1 1)" />
                </svg>
                <!-- 停靠图标：小窗收回主窗 -->
                <svg v-else viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path stroke-linecap="round" d="M15 4v16M15 12h6" opacity="0.4" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="m11 9-3 3 3 3M8 12h5" />
                </svg>
              </button>

              <!-- 收起：回到右下角 logo -->
              <button type="button" class="agent-head-btn" title="收起助手" @click="closePanel">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div
            v-if="readOnly"
            class="agent-readonly-banner mx-3 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100"
          >
            <p>此画布属于其他账号，Agent 无法写入节点。</p>
            <p class="mt-1 opacity-80">请新建自己的画布，或使用画布所有者账号登录。</p>
            <div class="mt-2.5 flex flex-wrap gap-2">
              <button type="button" class="agent-readonly-btn" @click="goToWorkflowHome">
                返回工作台
              </button>
              <button type="button" class="agent-readonly-btn agent-readonly-btn-primary" @click="createOwnCanvas">
                新建画布
              </button>
            </div>
          </div>

          <div
            v-if="agentStream.unreachable.value || recoveredPhaseHint"
            class="agent-stream-banner mx-3 mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-100"
          >
            <p v-if="agentStream.unreachable.value && agent.isStreaming">
              {{ RUNTIME_UNREACHABLE_SNIPPET }}，已保存进度。出图状态仍可通过轮询更新。
            </p>
            <p v-else-if="recoveredPhaseHint">{{ recoveredPhaseHint }}</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                class="agent-readonly-btn agent-readonly-btn-primary"
                :disabled="reconnecting"
                @click="reconnectStream"
              >
                {{ reconnecting ? '重连中…' : '重连' }}
              </button>
            </div>
          </div>

          <!-- 消息列表 -->
          <div ref="chatContainer" class="agent-chat-scroll min-h-0 flex-1 overflow-y-auto py-3">
            <div v-if="!agent.messages.length" class="agent-empty px-3 py-10 text-center">
              <p class="text-sm">描述你的创意</p>
              <p class="mt-1 text-[11px] opacity-70">我会驱动画布创建节点、连线与生成任务</p>
            </div>
            <div
              v-for="msg in agent.messages"
              :key="msg.id"
              class="agent-turn"
              :class="msg.role === 'user' ? 'agent-turn--user' : 'agent-turn--assistant'"
            >
              <div
                class="agent-bubble text-[13px] leading-relaxed"
                :class="msg.role === 'user' ? 'agent-bubble-user' : 'agent-bubble-assistant'"
              >
                <p class="whitespace-pre-wrap">
                  {{ msg.content }}<span v-if="msg.streaming" class="animate-pulse">▊</span>
                  <span
                    v-if="msg.role === 'assistant' && msg.executionTrace?.totalMs != null && !msg.streaming"
                    class="ml-1 text-[11px] opacity-60"
                  >· {{ formatTraceDuration(msg.executionTrace.totalMs) }}</span>
                </p>
                <AgentRefStrip
                  v-if="msg.role === 'user' && msg.attachments?.length"
                  class="agent-ref-strip--in-user-bubble mt-2"
                  :items="makeAttachmentItems(msg.attachments, msg.attachmentRefKeys)"
                  :removable="false"
                  history-interactive
                  @reattach="reattachFromHistory"
                />
                <div
                  v-if="!readOnly && canReuseTurn(msg)"
                  class="agent-bubble-reuse mt-1.5 flex justify-end"
                >
                  <button
                    type="button"
                    class="agent-bubble-reuse-btn"
                    @click="reattachTurnFromHistory(msg)"
                  >
                    ↺ 复用本轮（提示词 + 引用）
                  </button>
                </div>
                <AgentCanvasOutputs
                  v-if="msg.role === 'assistant' && (assistantOutputsById.get(msg.id)?.length ?? 0) > 0"
                  :outputs="assistantOutputsById.get(msg.id) ?? []"
                  @focus-node="emit('focusNode', $event)"
                  @focus-all="emit('focusAll', $event)"
                />
                <AgentExecutionTrace
                  v-if="msg.role === 'assistant' && msg.executionTrace"
                  :trace="msg.executionTrace"
                  :streaming="Boolean(msg.streaming)"
                  @focus-node="emit('focusNode', $event)"
                />
                <div v-if="msg.toolCalls?.length" class="agent-tools mt-1 space-y-0.5 pt-1">
                  <div v-for="(tc, i) in msg.toolCalls" :key="i" class="text-[10px] text-[var(--neo-text-secondary)]">⚙ {{ tc.name }}</div>
                </div>
                <div
                  v-if="canShowMessageActions(msg)"
                  class="agent-msg-actions"
                >
                  <button
                    type="button"
                    class="agent-msg-action-btn"
                    :class="{ 'is-active': messageFeedback[msg.id] === 'up' }"
                    title="有帮助"
                    aria-label="有帮助"
                    @click="toggleMessageFeedback(msg.id, 'up')"
                  >
                    <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M7 11v8m0-8V7a2 2 0 0 1 2-2h1.5a1.5 1.5 0 0 1 1.4 1.02l1.12 3.36a2 2 0 0 0 1.9 1.34H17a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1.5l-.84 2.52A1.5 1.5 0 0 1 13.18 21H10a2 2 0 0 1-2-2v-8z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="agent-msg-action-btn"
                    :class="{ 'is-active': messageFeedback[msg.id] === 'down' }"
                    title="无帮助"
                    aria-label="无帮助"
                    @click="toggleMessageFeedback(msg.id, 'down')"
                  >
                    <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M17 13V5m0 8v3a2 2 0 0 1-2 2h-1.5a1.5 1.5 0 0 1-1.4-1.02l-1.12-3.36a2 2 0 0 0-1.9-1.34H7a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h1.5l.84-2.52A1.5 1.5 0 0 0 10.82 3H14a2 2 0 0 1 2 2v8z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="agent-msg-action-btn"
                    :class="{ 'is-active': copiedMessageId === msg.id }"
                    :title="copiedMessageId === msg.id ? '已复制' : '复制回复'"
                    aria-label="复制回复"
                    @click="copyAssistantMessage(msg)"
                  >
                    <svg v-if="copiedMessageId !== msg.id" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                      <rect x="9" y="9" width="11" height="11" rx="2" />
                      <path stroke-linecap="round" d="M5 15V5a2 2 0 0 1 2-2h10" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <AgentTaskProgressCard
              v-if="showTaskCard"
              class="mx-3"
              :progress="taskProgress"
              @focus-node="emit('focusNode', $event)"
            />
          </div>

          <!-- 底部输入 dock：与节点 dock-studio 同款毛玻璃 -->
          <div class="agent-input-area px-2.5 pb-2.5 pt-1">
            <div v-if="awaitingConfirm" class="mb-2 flex flex-wrap gap-2 px-0.5">
              <button
                type="button"
                class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
                :disabled="agent.isStreaming"
                @click="sendPreset('1')"
              >
                确认方案
              </button>
              <button
                type="button"
                class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                :disabled="agent.isStreaming"
                @click="sendPreset('2')"
              >
                换方向
              </button>
              <button
                type="button"
                class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                :disabled="agent.isStreaming"
                @click="sendPreset('3')"
              >
                自己说明修改
              </button>
            </div>
            <div v-else-if="awaitingAtomicConfirm" class="mb-2 flex flex-wrap gap-2 px-0.5">
              <button
                type="button"
                class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
                :disabled="agent.isStreaming"
                @click="sendPreset('确认生成')"
              >
                确认生成
              </button>
              <button
                type="button"
                class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                :disabled="agent.isStreaming"
                @click="sendPreset('取消')"
              >
                取消
              </button>
            </div>
            <div v-else-if="awaitingImageQa" class="mb-2 flex flex-wrap gap-2 px-0.5">
              <button
                v-for="opt in IMAGE_QA_OPTIONS"
                :key="opt.id"
                type="button"
                class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                :class="{ 'agent-preset-primary font-medium': opt.id === 'ai_white_bg' }"
                :disabled="agent.isStreaming"
                @click="sendPreset(opt.message)"
              >
                {{ opt.label }}
              </button>
            </div>
            <div v-else-if="awaitingMacroSchemeSelect && macroSchemes.length" class="mb-2 px-0.5">
              <div class="space-y-2">
                <div
                  v-for="scheme in macroSchemes"
                  :key="scheme.id"
                  class="rounded-lg border border-[var(--neo-border)] p-2"
                >
                  <label class="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      class="mt-0.5"
                      :checked="macroSelections.includes(scheme.id)"
                      :disabled="agent.isStreaming"
                      @change="toggleMacroSelection(scheme.id, ($event.target as HTMLInputElement).checked)"
                    />
                    <span>
                      <span class="font-medium">{{ scheme.label || scheme.id }}</span>
                      <span v-if="scheme.recommended" class="ml-1 text-[var(--neo-accent)]">推荐</span>
                      <span v-if="scheme.summary" class="mt-0.5 block text-[var(--neo-muted)]">{{ scheme.summary }}</span>
                    </span>
                  </label>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
                  :disabled="agent.isStreaming || !macroSelections.length"
                  @click="sendMacroSchemeConfirm()"
                >
                  确认宏观方案
                </button>
                <button
                  type="button"
                  class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                  :disabled="agent.isStreaming"
                  @click="sendMacroSchemeRevise()"
                >
                  需要调整方案
                </button>
              </div>
            </div>
            <div v-else-if="awaitingSchemeSelect && productVisualPlan" class="mb-2 px-0.5">
              <p v-if="visualIntentSummary" class="mb-2 text-xs text-[var(--neo-muted)]">
                系统理解：{{ visualIntentSummary }}
              </p>
              <div class="space-y-2">
                <div
                  v-for="imageType in schemeSelectTypes"
                  :key="imageType.type_id"
                  class="rounded-lg border border-[var(--neo-border)] p-2"
                >
                  <div class="mb-1.5 text-xs font-medium">{{ imageType.type_label }}</div>
                  <div class="flex flex-col gap-1.5">
                    <label
                      v-for="scheme in imageType.schemes"
                      :key="scheme.scheme_id"
                      class="flex cursor-pointer items-start gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        class="mt-0.5"
                        :checked="(schemeSelections[imageType.type_id] ?? []).includes(scheme.scheme_id)"
                        :disabled="agent.isStreaming"
                        @change="toggleSchemeSelection(imageType.type_id, scheme.scheme_id, ($event.target as HTMLInputElement).checked)"
                      />
                      <span>
                        <span class="font-medium">{{ scheme.name || scheme.scheme_id }}</span>
                        <span v-if="scheme.recommended" class="ml-1 text-[var(--neo-accent)]">推荐</span>
                        <span class="mt-0.5 block text-[var(--neo-muted)]">{{ scheme.prompt.slice(0, 80) }}{{ scheme.prompt.length > 80 ? '…' : '' }}</span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
                  :disabled="agent.isStreaming"
                  @click="sendSchemeConfirm()"
                >
                  确认所选变体
                </button>
                <button
                  type="button"
                  class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                  :disabled="agent.isStreaming"
                  @click="sendSchemeRevisePreset()"
                >
                  需要调整方案
                </button>
              </div>
            </div>
            <ProductVisualDeliveryCard
              v-else-if="awaitingDeliveryConfirm && productVisualPlan && !productVisualSchemeV2"
              class="mb-2 px-0.5"
              :plan="productVisualPlan"
              :gen-by-key="deliveryGenByKey"
              :selections="deliverySelections"
              :disabled="agent.isStreaming"
              v-model:refine-draft="deliveryRefineDraft"
              @switch-scheme="sendDeliverySwitch"
              @refine-type="sendDeliveryRefine"
              @confirm-all="sendDeliveryConfirmAll"
            />
            <div
              v-else-if="awaitingDeliveryConfirm && productVisualSchemeV2 && shotManifest.length"
              class="mb-2 space-y-2 px-0.5"
            >
              <div
                v-for="shot in shotManifest"
                :key="shot.shot_id"
                class="rounded-lg border border-[var(--neo-border)] p-2 text-xs"
              >
                <div class="mb-1 font-medium">
                  {{ shot.label || shot.shot_id }}
                  <span v-if="shot.macro_scheme_id" class="ml-1 text-[var(--neo-muted)]">
                    方案{{ shot.macro_scheme_id }}
                  </span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="variantKey in (
                      (shot.variant_count ?? 1) === 1
                        ? [shot.shot_id]
                        : Array.from({ length: Math.min(3, shot.variant_count ?? 1) }, (_, i) => `${shot.shot_id}__v${i + 1}`)
                    )"
                    :key="variantKey"
                    type="button"
                    class="neo-ctl rounded px-2 py-1"
                    :class="{ 'agent-preset-primary font-medium': deliverySelections[shot.shot_id] === variantKey }"
                    :disabled="agent.isStreaming || !deliveryGenByKey[variantKey]?.url"
                    @click="sendMessage(buildShotDeliverySwitchMessage(shot.shot_id, variantKey))"
                  >
                    {{ variantKey.includes('__v') ? variantKey.split('__v').pop() : '默认' }}
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
                :disabled="agent.isStreaming"
                @click="sendMessage(buildShotDeliveryConfirmMessage(deliverySelections), 'confirm')"
              >
                确认全部定稿
              </button>
            </div>
            <div v-else-if="awaitingShotConfirm" class="mb-2 px-0.5">
              <div v-if="shotManifest.length" class="mb-2 space-y-1 text-xs text-[var(--neo-muted)]">
                <div v-for="shot in shotManifest" :key="shot.shot_id">
                  · {{ shot.label || shot.shot_id }}
                  <span v-if="shot.macro_scheme_id">（方案{{ shot.macro_scheme_id }}）</span>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
                  :disabled="agent.isStreaming"
                  @click="sendShotConfirm()"
                >
                  确认出图
                </button>
                <button
                  type="button"
                  class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                  :disabled="agent.isStreaming"
                  @click="sendShotRevise()"
                >
                  调整构图
                </button>
              </div>
            </div>
            <div v-else-if="awaitingTopoConfirm && !awaitingShotConfirm" class="mb-2 flex flex-wrap gap-2 px-0.5">
              <button
                type="button"
                class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
                :disabled="agent.isStreaming"
                @click="sendPreset('确认出图')"
              >
                确认出图
              </button>
              <button
                type="button"
                class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                :disabled="agent.isStreaming"
                @click="sendPreset('写入主文案')"
              >
                写入主文案
              </button>
              <button
                type="button"
                class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                :disabled="agent.isStreaming"
                @click="sendPreset('要改拓扑：')"
              >
                要改拓扑
              </button>
            </div>
            <div v-else-if="awaitingCopyConfirm" class="mb-2 flex flex-wrap gap-2 px-0.5">
              <button
                type="button"
                class="neo-ctl agent-preset-primary rounded-lg px-3 py-1.5 text-xs font-medium"
                :disabled="agent.isStreaming"
                @click="sendPreset('写入主文案')"
              >
                写入主文案
              </button>
              <button
                type="button"
                class="neo-ctl rounded-lg px-3 py-1.5 text-xs"
                :disabled="agent.isStreaming"
                @click="sendPreset('文案要修改：')"
              >
                要修改
              </button>
            </div>
            <div
              class="agent-input-dock"
              :class="{ 'is-drop-target': isDragOver }"
              @dragover.prevent="onDragOver"
              @dragleave.prevent="onDragLeave"
              @drop.prevent="onDrop"
              @pointerdown="onInputDockPointerDown"
            >
              <div
                v-if="showHistoryReattachCoachmark"
                class="agent-history-coachmark mx-0.5 mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-snug"
                role="status"
              >
                <span class="min-w-0 flex-1 text-[var(--neo-text-secondary)]">
                  点击历史消息中的 ↺ 引用可再次加入输入框；也可点「复用本轮」一键带回提示词与全部引用。
                </span>
                <button
                  type="button"
                  class="agent-history-coachmark__dismiss shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
                  @click="dismissHistoryReattachCoachmark"
                >
                  知道了
                </button>
              </div>
              <div class="agent-composer">
                <p
                  v-if="showComposerReattachHint"
                  class="agent-composer-reattach-hint mb-1.5 px-0.5 text-[10px] leading-snug text-[var(--neo-text-muted)]"
                >
                  点击上方历史消息中的 ↺ 引用，或「复用本轮」，可再次加入本次对话
                </p>
                <AgentRefStrip
                  v-if="pendingAttachmentItems.length"
                  class="agent-composer__refs"
                  :items="pendingAttachmentItems"
                  :removable="true"
                  @remove="sidebar.remove"
                  @mention="insertRefMention"
                  @reorder="sidebar.reorder"
                />
                <div class="agent-composer__input-wrap">
                  <MentionInput
                    ref="composerRef"
                    v-model="input"
                    class="agent-composer__mention w-full"
                    :mentions="mentionOptions"
                    :placeholder="inputPlaceholder"
                    :disabled="agent.isStreaming"
                    :leading-inset="readOnly ? 0 : COMPOSER_PICK_INSET"
                    submit-on-enter
                    @submit="send"
                  />
                  <button
                    v-if="!readOnly"
                    type="button"
                    class="composer-canvas-pick-btn"
                    :class="{ 'is-active': pickMode.active.value, 'is-hint': showPickHint }"
                    :disabled="isUploading"
                    aria-label="从画布选节点作引用"
                    @click.stop="onCanvasRefPickToggle"
                  >
                    <span class="composer-canvas-pick-btn__halo" aria-hidden="true" />
                    <span class="composer-canvas-pick-btn__lens" aria-hidden="true" />
                    <CanvasRefTargetIcon :size="14" :filled="pickMode.active.value" class="composer-canvas-pick-btn__icon" />
                    <span class="composer-canvas-pick-tip">从画布选节点作引用</span>
                  </button>
                </div>
              </div>
              <input
                ref="fileInputRef"
                type="file"
                class="sr-only"
                multiple
                :disabled="readOnly || isUploading"
                @change="onFileChange"
              >

              <div class="agent-dock-actions">
                <div class="agent-dock-params">
                  <div ref="attachMenuRef" class="agent-attach-menu relative">
                    <button
                      type="button"
                      class="dock-ghost-ctl flex h-8 w-8 items-center justify-center rounded-lg"
                      :class="{ 'is-open': attachMenuOpen }"
                      :disabled="readOnly || isUploading"
                      :title="readOnly ? '只读画布不能添加参考素材' : '添加引用素材'"
                      @click="toggleAttachMenu"
                    >
                      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                        <path stroke-linecap="round" d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                    <div
                      v-if="attachMenuOpen"
                      class="neo-popover absolute bottom-full left-0 z-30 mb-1 w-[220px] rounded-xl py-1"
                      @click.stop
                    >
                      <button
                        type="button"
                        class="neo-popover-item flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs"
                        @click="pickLocalUpload"
                      >
                        <span class="agent-attach-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4" />
                            <path stroke-linecap="round" d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
                          </svg>
                        </span>
                        <span>本地上传</span>
                      </button>
                      <button
                        type="button"
                        class="neo-popover-item flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs"
                        @click="pickAssetLibrary"
                      >
                        <span class="agent-attach-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <path stroke-linecap="round" d="M3 9h18M8 5V3m8 2V3" />
                          </svg>
                        </span>
                        <span>我的资产库</span>
                      </button>
                      <button
                        type="button"
                        class="neo-popover-item flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs"
                        @click="pickCanvasFromMenu"
                      >
                        <span class="agent-attach-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                          <CanvasRefTargetIcon :size="14" />
                        </span>
                        <span>从画布选节点</span>
                      </button>
                    </div>
                  </div>

                  <UniversalModelSelector v-model="planningModel" type="text" ghost />

                  <div ref="skillMenuRef" class="relative">
                  <button
                    type="button"
                    class="agent-skill-trigger dock-ghost-ctl flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
                    :class="{ 'is-open': skillMenuOpen, 'has-value': activeSkillId !== null }"
                    title="技能"
                    @click="skillMenuOpen = !skillMenuOpen"
                  >
                    <span class="agent-skill-trigger__icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM16.5 6.75h.008v.008H16.5V6.75z" />
                      </svg>
                    </span>
                    <span class="max-w-[72px] truncate font-medium">{{ skillButtonLabel }}</span>
                  </button>
                  <div
                    v-if="skillMenuOpen"
                    class="neo-popover absolute bottom-full left-0 z-30 mb-1 w-[240px] rounded-xl py-1"
                    @click.stop
                  >
                    <button
                      type="button"
                      class="neo-popover-item agent-popover-skill-item flex w-full items-start gap-2 px-3 py-2 text-left"
                      :class="{ 'is-selected': activeSkillId === null }"
                      @click="activeSkillId = null; skillMenuOpen = false"
                    >
                      <span class="agent-skill-icon mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
                        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                        </svg>
                      </span>
                      <span class="min-w-0">
                        <span class="text-xs font-medium">自动</span>
                        <span class="block truncate text-[10px] opacity-60">平台路由，单张/图生图优先</span>
                      </span>
                    </button>
                    <div class="mx-3 my-1 border-t border-[var(--neo-border)] opacity-40" />
                    <button
                      v-for="skill in AGENT_SKILLS"
                      :key="skill.id"
                      type="button"
                      class="neo-popover-item agent-popover-skill-item flex w-full items-start gap-2 px-3 py-2 text-left"
                      :class="{ 'is-selected': skill.id === activeSkillId }"
                      @click="activeSkillId = skill.id; skillMenuOpen = false"
                    >
                      <span class="agent-skill-icon mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
                        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.75">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                      </span>
                      <span class="min-w-0">
                        <span class="text-xs font-medium">{{ skill.label }}</span>
                        <span class="block truncate text-[10px] opacity-60">{{ skill.desc }}</span>
                      </span>
                    </button>
                    <p v-if="!AGENT_SKILLS.length" class="px-3 py-2 text-[10px] opacity-50">暂无已安装技能</p>
                  </div>
                </div>
                </div>

                <div class="agent-dock-primary">
                  <DockMicButton
                    :listening="speech.listening.value"
                    :disabled="agent.isStreaming || isUploading"
                    @toggle="toggleVoice"
                  />
                  <DockGenerateButton
                    :generating="agent.isStreaming"
                    :disabled="isUploading || (!agent.isStreaming && !canSubmitComposer)"
                    @generate="send"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Teleport>
      <ForceChoiceDialog
        v-model="forceChoiceOpen"
        :kind="forceChoiceKind"
        @action="onForceChoiceAction"
      />
      <AgentAssetPicker v-model:open="assetPickerOpen" @pick="addAssetReference" />
    </div>
  </aside>
</template>

<style scoped>
.agent-side-rail {
  position: relative;
  background: var(--neo-bg);
  transition: width 0.3s ease, background 0.25s ease;
}

.agent-side-rail.is-docked-open {
  border-left: 1px solid var(--neo-border);
}

.agent-side-rail.is-resizing {
  transition: none;
}

/* ---- 收缩态右下角 logo 悬浮按钮 ---- */
.agent-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 55;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.agent-fab:hover {
  transform: scale(1.08);
}

/* ---- 面板外壳 ---- */
.agent-panel-inline {
  position: relative;
  background: var(--neo-bg);
}

.agent-panel-floating {
  position: fixed;
  z-index: 60;
  height: min(680px, calc(100vh - 72px));
  max-width: calc(100vw - 32px);
  border: 1px solid var(--neo-glass-border);
  border-radius: 20px;
  background: var(--neo-popover-bg);
  box-shadow: var(--neo-popover-shadow);
  backdrop-filter: blur(28px) saturate(1.4);
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  overflow: hidden;
}

.agent-panel-floating.is-dragging {
  user-select: none;
}

/* ---- 左边缘拖拉调宽 ---- */
.agent-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  z-index: 5;
  width: 7px;
  cursor: ew-resize;
}

.agent-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  background: transparent;
  transition: background 0.15s ease;
}

.agent-resize-handle:hover::after {
  background: color-mix(in srgb, var(--neo-hi-text) 35%, transparent);
}

.agent-panel-floating .agent-resize-handle {
  left: 0;
}

.agent-panel-header {
  border-bottom: 1px solid var(--neo-border);
}

.agent-subtitle {
  color: var(--neo-text-muted);
}

.agent-head-btn {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--neo-text-muted);
  transition: background 0.15s ease, color 0.15s ease;
}

.agent-head-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.agent-head-btn.is-active {
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  box-shadow: var(--neo-hi-shadow);
}

.agent-readonly-btn {
  border-radius: 8px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  background: rgba(0, 0, 0, 0.15);
  padding: 4px 10px;
  font-size: 11px;
  line-height: 1.4;
  color: rgb(254, 243, 199);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.agent-readonly-btn:hover {
  background: rgba(251, 191, 36, 0.12);
  border-color: rgba(251, 191, 36, 0.55);
}

.agent-readonly-btn-primary {
  border-color: rgba(251, 191, 36, 0.55);
  background: rgba(251, 191, 36, 0.18);
  color: rgb(255, 251, 235);
}

.agent-readonly-btn-primary:hover {
  background: rgba(251, 191, 36, 0.28);
}

/* ---- 消息列表 ---- */
.agent-chat-scroll {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-turn--user {
  display: flex;
  justify-content: flex-end;
  padding: 0 12px;
}

.agent-turn--assistant {
  width: 100%;
  padding: 0 12px;
}

.agent-empty {
  color: var(--neo-text-muted);
}

.agent-bubble-user {
  max-width: 88%;
  border: 1px solid var(--agent-user-border);
  border-radius: 16px;
  background: var(--agent-user-bg);
  color: var(--agent-user-text);
  box-shadow: var(--agent-user-shadow);
  padding: 8px 12px;
}

.agent-bubble-assistant {
  width: 100%;
  max-width: none;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--agent-assistant-text);
  box-shadow: none;
  padding: 4px 0 8px;
}

.agent-bubble-assistant :deep(.agent-tools) {
  border-color: var(--agent-assistant-divider);
}

.agent-bubble-assistant :deep(.agent-canvas-outputs) {
  border-color: var(--agent-assistant-divider);
}

.agent-msg-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 8px;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

.agent-turn--assistant:hover .agent-msg-actions,
.agent-msg-actions:focus-within {
  opacity: 1;
}

.agent-msg-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--agent-assistant-muted);
  transition: background 0.15s ease, color 0.15s ease;
}

.agent-msg-action-btn:hover {
  background: var(--neo-hover-bg);
  color: var(--neo-text-primary);
}

.agent-msg-action-btn.is-active {
  background: var(--neo-active-bg);
  color: var(--neo-text-primary);
}

/* 用户气泡内引用 chip：棋盘底 + 描边，白/浅图也能辨认 */
.agent-bubble-user :deep(.dock-ref-chip.has-media) {
  border-color: color-mix(in srgb, var(--agent-user-text) 16%, transparent);
  background-color: var(--agent-user-media-bg);
  background-image:
    linear-gradient(45deg, var(--agent-user-media-checker) 25%, transparent 25%),
    linear-gradient(-45deg, var(--agent-user-media-checker) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--agent-user-media-checker) 75%),
    linear-gradient(-45deg, transparent 75%, var(--agent-user-media-checker) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, #fff 42%, transparent),
    0 1px 3px rgba(0, 0, 0, 0.14);
}

.agent-bubble-user :deep(.dock-ref-chip.has-media .dock-ref-chip__key) {
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}

.agent-bubble-user :deep(.dock-ref-chip:not(.has-media)) {
  border-color: color-mix(in srgb, var(--agent-user-text) 14%, transparent);
  background: color-mix(in srgb, var(--agent-user-text) 8%, transparent);
  color: color-mix(in srgb, var(--agent-user-text) 72%, transparent);
}

.agent-bubble-user :deep(.dock-ref-chip:not(.has-media) .dock-ref-chip__key) {
  color: var(--agent-user-text);
  text-shadow: none;
}

.agent-bubble-reuse-btn {
  border: 1px dashed color-mix(in srgb, var(--agent-user-text) 22%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--agent-user-text) 6%, transparent);
  padding: 2px 8px;
  font-size: 10px;
  line-height: 1.4;
  color: color-mix(in srgb, var(--agent-user-text) 78%, transparent);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.agent-bubble-reuse-btn:hover {
  border-color: color-mix(in srgb, var(--agent-user-text) 35%, transparent);
  background: color-mix(in srgb, var(--agent-user-text) 12%, transparent);
  color: var(--agent-user-text);
}

.agent-history-coachmark {
  border-color: color-mix(in srgb, var(--neo-hi-text) 14%, var(--neo-border));
  background: color-mix(in srgb, var(--neo-hi-bg) 8%, var(--neo-hover-bg));
}

.agent-history-coachmark__dismiss {
  border: 1px solid var(--neo-border);
  background: var(--neo-hi-bg);
  color: var(--neo-hi-text);
  box-shadow: var(--neo-hi-shadow);
}

.agent-composer-reattach-hint {
  border-left: 2px solid color-mix(in srgb, var(--neo-hi-text) 18%, transparent);
  padding-left: 8px;
}

.agent-tools {
  border-top: 1px solid var(--neo-border);
}

/* ---- 底部输入 dock（对齐 dock-studio 毛玻璃） ---- */
.agent-input-dock {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  overflow: visible;
  border: 1px solid var(--neo-glass-border);
  border-radius: 18px;
  background: var(--neo-glass-bg);
  backdrop-filter: blur(var(--neo-glass-blur)) saturate(1.5);
  -webkit-backdrop-filter: blur(var(--neo-glass-blur)) saturate(1.5);
  box-shadow:
    0 20px 44px rgba(0, 0, 0, 0.42),
    0 2px 6px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.agent-input-dock::before {
  content: '';
  position: absolute;
  top: 0;
  right: 20px;
  left: 20px;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, var(--neo-glass-topline), transparent);
}

.agent-input-dock:focus-within {
  border-color: color-mix(in srgb, var(--neo-hi-text) 28%, var(--neo-glass-border));
  box-shadow:
    0 20px 44px rgba(0, 0, 0, 0.42),
    0 2px 6px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3),
    0 0 0 2px color-mix(in srgb, var(--neo-hi-text) 14%, transparent);
}

.agent-input-dock.is-drop-target {
  border-color: color-mix(in srgb, var(--neo-hi-text) 35%, var(--neo-border));
  background: var(--neo-hover-bg);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-hi-text) 18%, transparent);
}

.agent-prompt-field {
  width: 100%;
  min-height: 76px;
  max-height: 180px;
  resize: none;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  line-height: 1.55;
  color: var(--neo-text-primary);
}

.agent-prompt-field::placeholder {
  color: var(--neo-text-muted);
}

.agent-dock-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding-top: 6px;
}

.agent-dock-params {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.agent-dock-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.agent-skill-icon {
  background: var(--neo-hover-bg);
  color: var(--neo-text-secondary);
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.agent-skill-trigger__icon {
  display: inline-flex;
  color: var(--neo-text-secondary);
  transition: color 0.15s ease;
}

.agent-skill-trigger:hover .agent-skill-trigger__icon,
.agent-skill-trigger.is-open .agent-skill-trigger__icon {
  color: var(--neo-text-primary);
}

.agent-skill-trigger.has-value {
  border-color: color-mix(in srgb, var(--neo-hi-text) 12%, var(--neo-border));
  background: color-mix(in srgb, var(--neo-hi-bg) 10%, var(--neo-hover-bg));
}

.agent-skill-trigger.has-value .agent-skill-trigger__icon {
  color: var(--neo-text-primary);
}

.agent-popover-skill-item.is-selected {
  background: var(--neo-hi-bg) !important;
  color: var(--neo-hi-text) !important;
  box-shadow: var(--neo-hi-shadow);
}

.agent-popover-skill-item.is-selected .agent-skill-icon {
  background: color-mix(in srgb, var(--neo-hi-text) 10%, transparent);
  color: var(--neo-hi-text);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--neo-hi-text) 12%, transparent);
}

.agent-preset-primary {
  background: var(--neo-hi-bg) !important;
  color: var(--neo-hi-text) !important;
  border-color: transparent !important;
  box-shadow: var(--neo-hi-shadow);
}

.agent-preset-primary:hover:not(:disabled) {
  filter: brightness(1.04);
}

.agent-composer {
  min-width: 0;
}

.agent-composer__refs {
  margin-bottom: 4px;
}

.agent-composer__input-wrap {
  position: relative;
  min-width: 0;
  width: 100%;
  overflow: visible;
}

.agent-composer__mention {
  min-width: 0;
}

.composer-canvas-pick-btn {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
  isolation: isolate;
  overflow: visible;
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--neo-glass-border);
  border-radius: 999px;
  background:
    radial-gradient(circle at 28% 22%, rgba(255, 255, 255, 0.24) 0%, transparent 46%),
    var(--neo-glass-lite-bg);
  color: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(var(--neo-glass-lite-blur)) saturate(1.4);
  -webkit-backdrop-filter: blur(var(--neo-glass-lite-blur)) saturate(1.4);
  box-shadow:
    var(--neo-glass-lite-shadow),
    0 4px 12px rgba(0, 0, 0, 0.18);
  transform: translate(-50%, -50%);
  transition:
    background 0.22s ease,
    border-color 0.22s ease,
    color 0.22s ease,
    box-shadow 0.22s ease,
    transform 0.14s cubic-bezier(0.34, 1.2, 0.64, 1);
}

.composer-canvas-pick-btn__halo {
  position: absolute;
  inset: -4px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: inherit;
  pointer-events: none;
  opacity: 0.55;
  transition: opacity 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}

.composer-canvas-pick-btn__lens {
  position: absolute;
  inset: 1px;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(ellipse 90% 70% at 24% 18%, rgba(255, 255, 255, 0.16) 0%, transparent 52%),
    radial-gradient(ellipse 55% 45% at 78% 88%, rgba(255, 255, 255, 0.05) 0%, transparent 48%);
  opacity: 0.9;
  transition: opacity 0.22s ease, background 0.22s ease;
}

.composer-canvas-pick-btn__icon {
  position: relative;
  z-index: 1;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
  transition: filter 0.22s ease, transform 0.14s ease;
}

.composer-canvas-pick-btn:hover:not(:disabled):not(.is-active) {
  border-color: var(--neo-glass-border-hover);
  color: #fff;
  transform: translate(-50%, -50%) scale(1.05);
  box-shadow:
    var(--neo-glass-lite-shadow),
    0 6px 16px rgba(0, 0, 0, 0.22);
}

.composer-canvas-pick-btn:hover:not(:disabled):not(.is-active) .composer-canvas-pick-btn__halo {
  opacity: 0.85;
  border-color: rgba(255, 255, 255, 0.12);
}

.composer-canvas-pick-btn:active:not(:disabled):not(.is-active) {
  transform: translate(-50%, -50%) scale(0.94);
}

.composer-canvas-pick-btn.is-active {
  border-color: rgba(255, 255, 255, 0.92);
  background:
    radial-gradient(circle at 30% 24%, rgba(255, 255, 255, 0.95) 0%, transparent 46%),
    linear-gradient(165deg, #ffffff 0%, #f3f3f6 48%, #e6e6ec 100%);
  color: var(--neo-hi-text);
  box-shadow:
    var(--neo-hi-shadow),
    0 0 0 1px rgba(255, 255, 255, 0.55),
    0 8px 20px rgba(0, 0, 0, 0.34);
}

.composer-canvas-pick-btn.is-active .composer-canvas-pick-btn__halo {
  inset: -5px;
  border-color: rgba(255, 255, 255, 0.42);
  opacity: 1;
  animation: composer-pick-target-ring 1.75s ease-out infinite;
}

.composer-canvas-pick-btn.is-active .composer-canvas-pick-btn__lens {
  background:
    radial-gradient(ellipse 85% 65% at 28% 22%, rgba(255, 255, 255, 0.72) 0%, transparent 54%),
    radial-gradient(ellipse 50% 40% at 72% 82%, rgba(255, 255, 255, 0.18) 0%, transparent 50%);
  opacity: 1;
}

.composer-canvas-pick-btn.is-active .composer-canvas-pick-btn__icon {
  filter: none;
}

.composer-canvas-pick-btn.is-active:active:not(:disabled) {
  transform: translate(-50%, -50%) scale(0.96);
  box-shadow:
    var(--neo-hi-shadow),
    0 0 0 2px rgba(255, 255, 255, 0.45),
    0 6px 16px rgba(0, 0, 0, 0.3);
}

.composer-canvas-pick-btn.is-hint:not(.is-active) .composer-canvas-pick-btn__halo {
  animation: composer-pick-halo-breathe 2.6s ease-in-out infinite;
}

:global(:root[data-canvas-theme='light']) .composer-canvas-pick-btn:not(.is-active) {
  color: var(--neo-text-secondary);
}

:global(:root[data-canvas-theme='light']) .composer-canvas-pick-btn.is-active {
  color: var(--neo-hi-text);
}

.composer-canvas-pick-tip {
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  z-index: 5;
  padding: 4px 8px;
  border: 1px solid var(--neo-border);
  border-radius: 8px;
  background: var(--neo-surface-elevated);
  font-size: 10px;
  line-height: 1.3;
  white-space: nowrap;
  color: var(--neo-text-secondary);
  pointer-events: none;
  opacity: 0;
  transform: translateX(-50%) translateY(2px);
  transition: opacity 0.15s ease, transform 0.15s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}

.composer-canvas-pick-btn:hover:not(:disabled) .composer-canvas-pick-tip,
.composer-canvas-pick-btn:focus-visible .composer-canvas-pick-tip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.agent-attach-icon {
  background: var(--neo-hover-bg);
  color: var(--neo-text-secondary);
}

@keyframes composer-pick-halo-breathe {
  0%, 100% {
    opacity: 0.42;
    transform: scale(1);
  }
  50% {
    opacity: 0.92;
    transform: scale(1.06);
  }
}

@keyframes composer-pick-target-ring {
  0% {
    opacity: 0.85;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(1.42);
  }
}
</style>
