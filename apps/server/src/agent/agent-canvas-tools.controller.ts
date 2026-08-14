import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common'
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { AgentCanvasToolsService } from './agent-canvas-tools.service'
import { AgentInternalGuard } from './agent-internal.guard'

class UpsertPromptNodeDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsOptional()
  @IsString()
  nodeId?: string

  @IsString()
  prompt!: string

  @IsString()
  content!: string

  @IsOptional()
  position?: { x: number; y: number }

  @IsOptional()
  @IsBoolean()
  stage?: boolean
}

class SessionNodeDto {
  @IsString()
  sessionId!: string

  @IsString()
  nodeId!: string
}

class SessionOnlyDto {
  @IsString()
  sessionId!: string
}

class GetAgentMessagesDto {
  @IsString()
  sessionId!: string

  @IsString()
  threadId!: string
}

class BatchNodeItemDto {
  @IsString()
  key!: string

  @IsString()
  title!: string

  @IsString()
  targetType!: string

  @IsOptional()
  @IsString()
  prompt?: string

  @IsOptional()
  position?: { x: number; y: number }

  @IsOptional()
  @IsString()
  pipeline?: string

  @IsOptional()
  @IsString()
  imageAspect?: string

  @IsOptional()
  videoSettings?: {
    aspectRatio?: string
    duration?: number
    resolution?: string
    crop?: string
    generateAudio?: boolean
  }

  @IsOptional()
  @IsString()
  videoMode?: string

  @IsOptional()
  @IsString()
  referenceImageUrl?: string
}

class AddNodesBatchDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchNodeItemDto)
  items!: BatchNodeItemDto[]

  @IsOptional()
  @IsBoolean()
  stage?: boolean
}

class EdgeDto {
  @IsString()
  source!: string

  @IsString()
  target!: string
}

class ConnectNodesDto {
  @IsString()
  sessionId!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeDto)
  edges!: EdgeDto[]

  @IsOptional()
  @IsBoolean()
  stage?: boolean
}

// W31: Remove nodes DTO
class RemoveNodesDto {
  @IsString()
  sessionId!: string

  @IsArray()
  @IsString({ each: true })
  nodeIds!: string[]

  @IsOptional()
  @IsBoolean()
  stage?: boolean
}

// W32: Remove edges DTO
class RemoveEdgesDto {
  @IsString()
  sessionId!: string

  @IsArray()
  @IsString({ each: true })
  edgeIds!: string[]

  @IsOptional()
  @IsBoolean()
  stage?: boolean
}

class SetNodePromptDto {
  @IsString()
  sessionId!: string

  @IsString()
  nodeId!: string

  @IsString()
  prompt!: string

  // P0 修复：modify 模式 upsert 节点时同时更新标题（可选）
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsBoolean()
  stage?: boolean
}

class SetNodeContentDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  nodeId!: string

  @IsString()
  content!: string

  @IsOptional()
  @IsBoolean()
  stage?: boolean
}

class AttachRefsDto {
  @IsString()
  sessionId!: string

  @IsString()
  nodeId!: string

  @IsArray()
  @IsString({ each: true })
  refOrder!: string[]
}

class ApplySidebarAttachmentsDto {
  @IsString()
  sessionId!: string

  @IsArray()
  @IsString({ each: true })
  nodeIds!: string[]

  @IsArray()
  attachments!: Record<string, unknown>[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  refOrder?: string[]

  @IsString()
  mode!: 'localRefs' | 'attach_edges'

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentionedKeys?: string[]
}

class UpdateNodesBatchItemDto {
  @IsString()
  nodeId!: string

  patch!: Record<string, unknown>
}

class UpdateNodesBatchDto {
  @IsString()
  sessionId!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateNodesBatchItemDto)
  items!: UpdateNodesBatchItemDto[]
}

class RunImageGenerationDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  nodeId!: string
}

class RunVisionQaDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  @IsString({ each: true })
  imageUrls!: string[]

  @IsString()
  systemPrompt!: string

  @IsString()
  userContent!: string

  @IsOptional()
  @IsString()
  userText?: string

  @IsOptional()
  @IsString()
  sceneKind?: string

  @IsOptional()
  @IsString()
  model?: string
}

class WaitImageGenerationDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  nodeId!: string

  @IsString()
  generationRecordId!: string
}

class GenerationLifecycleDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsOptional()
  @IsString()
  generationRecordId?: string

  @IsOptional()
  @IsString()
  nodeId?: string
}

class SessionUserDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string
}

class ListGenerationTasksDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsOptional()
  @IsString()
  type?: string
}

class UserOnlyDto {
  @IsString()
  userId!: string
}

class ListPublicAssetsDto {
  @IsOptional()
  @IsIn(['image', 'video', 'audio'])
  kind?: 'image' | 'video' | 'audio'

  @IsOptional()
  @IsString()
  search?: string
}

class SaveNodeAssetDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  nodeId!: string

  @IsOptional()
  @IsString()
  label?: string
}

class IntroduceNodesDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  @IsString({ each: true })
  nodeIds!: string[]
}

class ApplyAssetToNodeDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  nodeId!: string

  @IsString()
  assetId!: string

  @IsIn(['user', 'public'])
  source!: 'user' | 'public'
}

class DuplicateNodeDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  nodeId!: string

  @IsOptional()
  offset?: { x: number; y: number }
}

class UploadMediaToCanvasDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  url!: string

  @IsIn(['image', 'video', 'audio'])
  mediaType!: 'image' | 'video' | 'audio'

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  position?: { x: number; y: number }
}

class ExportMediaPackageDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  @IsString({ each: true })
  nodeIds!: string[]
}

class GroupNodesDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  @IsString({ each: true })
  nodeIds!: string[]

  @IsOptional()
  @IsString()
  title?: string
}

class UngroupNodeDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  groupId!: string
}

class ArrangeNodesGridDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  @IsString({ each: true })
  nodeIds!: string[]

  @IsOptional()
  gap?: number
}

class MoveNodeItemDto {
  @IsString()
  nodeId!: string

  @IsNumber()
  x!: number

  @IsNumber()
  y!: number
}

class MoveNodesDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoveNodeItemDto)
  items!: MoveNodeItemDto[]
}

class ApplyLayoutOpsDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  ops!: Array<Record<string, unknown>>
}

class SaveAgentMessageDto {
  @IsString()
  sessionId!: string

  @IsString()
  threadId!: string

  @IsString()
  userId!: string

  @IsString()
  role!: string

  @IsString()
  content!: string

  @IsOptional()
  @IsString()
  toolCalls?: string
}

class AcquireThreadLockDto {
  @IsString()
  threadId!: string

  @IsString()
  holderId!: string

  @IsOptional()
  ttlSeconds?: number
}

class RenewThreadLockDto {
  @IsString()
  threadId!: string

  @IsString()
  holderId!: string

  @IsOptional()
  ttlSeconds?: number
}

class ReleaseThreadLockDto {
  @IsString()
  threadId!: string

  @IsString()
  holderId!: string
}

class StageCanvasActionsDto {
  @IsString()
  sessionId!: string

  @IsArray()
  actions!: unknown[]
}

class CommitStageDto {
  @IsString()
  sessionId!: string
}

class RollbackStageDto {
  @IsString()
  sessionId!: string
}

// W15: Generation progress DTOs
class GetGenProgressDto {
  @IsString()
  threadId!: string
}

class SaveGenProgressDto {
  @IsString()
  threadId!: string

  @IsString()
  sessionId!: string

  @IsString()
  lines!: string

  @IsOptional()
  @IsString()
  summary?: string
}

// W18: Context snapshot DTOs
class GetContextSnapshotDto {
  @IsString()
  threadId!: string

  @IsOptional()
  @IsString()
  stage?: string
}

class SaveContextSnapshotDto {
  @IsString()
  threadId!: string

  @IsString()
  sessionId!: string

  @IsString()
  stage!: string

  @IsOptional()
  @IsString()
  brief?: string

  @IsOptional()
  @IsString()
  planSummary?: string

  @IsOptional()
  @IsString()
  manifestJson?: string

  @IsOptional()
  messageCount?: number
}

@Controller('agent/internal')
@UseGuards(AgentInternalGuard)
export class AgentCanvasToolsController {
  constructor(
    @Inject(AgentCanvasToolsService) private readonly tools: AgentCanvasToolsService,
  ) {}

  @Post('upsert-prompt-node')
  async upsertPromptNode(@Body() dto: UpsertPromptNodeDto) {
    const data = await this.tools.upsertPromptNode(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('get-node')
  async getNode(@Body() dto: SessionNodeDto) {
    const data = await this.tools.getNode(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('get-canvas-summary')
  async getCanvasSummary(@Body() dto: SessionOnlyDto) {
    const data = await this.tools.getCanvasSummary(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('add-nodes-batch')
  async addNodesBatch(@Body() dto: AddNodesBatchDto) {
    const data = await this.tools.addNodesBatch(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('connect-nodes')
  async connectNodes(@Body() dto: ConnectNodesDto) {
    const data = await this.tools.connectNodes(dto)
    return { code: 0, message: 'ok', data }
  }

  // W31: Remove nodes endpoint
  @Post('remove-nodes')
  async removeNodes(@Body() dto: RemoveNodesDto) {
    const data = await this.tools.removeNodes(dto)
    return { code: 0, message: 'ok', data }
  }

  // W32: Remove edges endpoint
  @Post('remove-edges')
  async removeEdges(@Body() dto: RemoveEdgesDto) {
    const data = await this.tools.removeEdges(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('set-node-prompt')
  async setNodePrompt(@Body() dto: SetNodePromptDto) {
    const data = await this.tools.setNodePrompt(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('set-node-content')
  async setNodeContent(@Body() dto: SetNodeContentDto) {
    const data = await this.tools.setNodeContent(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('attach-refs')
  async attachRefs(@Body() dto: AttachRefsDto) {
    const data = await this.tools.attachRefs(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('apply-sidebar-attachments')
  async applySidebarAttachments(@Body() dto: ApplySidebarAttachmentsDto) {
    const data = await this.tools.applySidebarAttachments({
      sessionId: dto.sessionId,
      nodeIds: dto.nodeIds,
      attachments: dto.attachments as Parameters<
        AgentCanvasToolsService['applySidebarAttachments']
      >[0]['attachments'],
      refOrder: dto.refOrder,
      mode: dto.mode,
      mentionedKeys: dto.mentionedKeys,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('update-nodes-batch')
  async updateNodesBatch(@Body() dto: UpdateNodesBatchDto) {
    const data = await this.tools.updateNodesBatch({
      sessionId: dto.sessionId,
      items: dto.items,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('run-image-generation')
  async runImageGeneration(@Body() dto: RunImageGenerationDto) {
    const data = await this.tools.runImageGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('start-image-generation')
  async startImageGeneration(@Body() dto: RunImageGenerationDto) {
    const data = await this.tools.startImageGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('wait-image-generation')
  async waitImageGeneration(@Body() dto: WaitImageGenerationDto) {
    const data = await this.tools.waitImageGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('run-video-generation')
  async runVideoGeneration(@Body() dto: RunImageGenerationDto) {
    const data = await this.tools.runVideoGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('start-video-generation')
  async startVideoGeneration(@Body() dto: RunImageGenerationDto) {
    const data = await this.tools.startVideoGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('wait-video-generation')
  async waitVideoGeneration(@Body() dto: WaitImageGenerationDto) {
    const data = await this.tools.waitVideoGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('run-text-generation')
  async runTextGeneration(@Body() dto: RunImageGenerationDto) {
    const data = await this.tools.runTextGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('run-prompt-generation')
  async runPromptGeneration(@Body() dto: RunImageGenerationDto) {
    const data = await this.tools.runPromptGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('run-audio-generation')
  async runAudioGeneration(@Body() dto: RunImageGenerationDto) {
    const data = await this.tools.runAudioGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('run-vision-qa')
  async runVisionQa(@Body() dto: RunVisionQaDto) {
    const data = await this.tools.runVisionQa(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('get-generation-status')
  async getGenerationStatus(@Body() dto: SessionNodeDto) {
    const data = await this.tools.getGenerationStatus(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('get-generation-diagnostic')
  async getGenerationDiagnostic(@Body() dto: GenerationLifecycleDto) {
    const data = await this.tools.getGenerationDiagnostic(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('cancel-generation')
  async cancelGeneration(@Body() dto: GenerationLifecycleDto) {
    const data = await this.tools.cancelGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('confirm-platform-fallback')
  async confirmPlatformFallback(@Body() dto: GenerationLifecycleDto) {
    const data = await this.tools.confirmPlatformFallback(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('cancel-platform-fallback')
  async cancelPlatformFallback(@Body() dto: GenerationLifecycleDto) {
    const data = await this.tools.cancelPlatformFallback(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('list-generation-tasks')
  async listGenerationTasks(@Body() dto: ListGenerationTasksDto) {
    const data = await this.tools.listGenerationTasks(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('list-user-assets')
  async listUserAssets(@Body() dto: UserOnlyDto) {
    const data = await this.tools.listUserAssets(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('list-public-assets')
  async listPublicAssets(@Body() dto: ListPublicAssetsDto) {
    const data = await this.tools.listPublicAssets(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('save-node-to-asset-library')
  async saveNodeToAssetLibrary(@Body() dto: SaveNodeAssetDto) {
    const data = await this.tools.saveNodeToAssetLibrary(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('introduce-nodes-to-agent')
  async introduceNodesToAgent(@Body() dto: IntroduceNodesDto) {
    const data = await this.tools.introduceNodesToAgent(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('apply-asset-to-node')
  async applyAssetToNode(@Body() dto: ApplyAssetToNodeDto) {
    const data = await this.tools.applyAssetToNode(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('get-canvas-layout')
  async getCanvasLayout(@Body() dto: SessionOnlyDto) {
    const data = await this.tools.getCanvasLayout(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('duplicate-node')
  async duplicateNode(@Body() dto: DuplicateNodeDto) {
    const data = await this.tools.duplicateNode(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('upload-media-to-canvas')
  async uploadMediaToCanvas(@Body() dto: UploadMediaToCanvasDto) {
    const data = await this.tools.uploadMediaToCanvas(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('export-media-package')
  async exportMediaPackage(@Body() dto: ExportMediaPackageDto) {
    const data = await this.tools.exportMediaPackage(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('group-nodes')
  async groupNodes(@Body() dto: GroupNodesDto) {
    const data = await this.tools.groupNodes(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('ungroup-node')
  async ungroupNode(@Body() dto: UngroupNodeDto) {
    const data = await this.tools.ungroupNode(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('arrange-nodes-grid')
  async arrangeNodesGrid(@Body() dto: ArrangeNodesGridDto) {
    const data = await this.tools.arrangeNodesGrid(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('move-nodes')
  async moveNodes(@Body() dto: MoveNodesDto) {
    const data = await this.tools.moveNodes(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('apply-layout-ops')
  async applyLayoutOps(@Body() dto: ApplyLayoutOpsDto) {
    const data = await this.tools.applyLayoutOps({
      sessionId: dto.sessionId,
      userId: dto.userId,
      ops: dto.ops as Parameters<AgentCanvasToolsService['applyLayoutOps']>[0]['ops'],
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('get-image-edit-capabilities')
  async getImageEditCapabilities(@Body() dto: SessionNodeDto) {
    const data = await this.tools.getImageEditCapabilities(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('get-agent-messages')
  async getAgentMessages(@Body() dto: GetAgentMessagesDto) {
    const data = await this.tools.getAgentMessages(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('save-agent-message')
  async saveAgentMessage(@Body() dto: SaveAgentMessageDto) {
    const data = await this.tools.saveAgentMessage(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('acquire-thread-lock')
  async acquireThreadLock(@Body() dto: AcquireThreadLockDto) {
    const data = await this.tools.acquireThreadLock({
      threadId: dto.threadId,
      holderId: dto.holderId,
      ttlSeconds: dto.ttlSeconds ?? 300,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('renew-thread-lock')
  async renewThreadLock(@Body() dto: RenewThreadLockDto) {
    const data = await this.tools.renewThreadLock({
      threadId: dto.threadId,
      holderId: dto.holderId,
      ttlSeconds: dto.ttlSeconds ?? 300,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('release-thread-lock')
  async releaseThreadLock(@Body() dto: ReleaseThreadLockDto) {
    const data = await this.tools.releaseThreadLock(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('stage-canvas-actions')
  async stageCanvasActions(@Body() dto: StageCanvasActionsDto) {
    const data = await this.tools.stageCanvasActions({
      sessionId: dto.sessionId,
      actions: dto.actions as any,
    })
    return { code: 0, message: 'ok', data }
  }

  @Post('commit-stage')
  async commitStage(@Body() dto: CommitStageDto) {
    const data = await this.tools.commitStage(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('rollback-stage')
  async rollbackStage(@Body() dto: RollbackStageDto) {
    const data = await this.tools.rollbackStage(dto)
    return { code: 0, message: 'ok', data }
  }

  // W15: Generation progress endpoints
  @Post('get-gen-progress')
  async getGenProgress(@Body() dto: GetGenProgressDto) {
    const data = await this.tools.getGenProgress(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('save-gen-progress')
  async saveGenProgress(@Body() dto: SaveGenProgressDto) {
    const data = await this.tools.saveGenProgress(dto)
    return { code: 0, message: 'ok', data }
  }

  // W18: Context snapshot endpoints
  @Post('get-context-snapshot')
  async getContextSnapshot(@Body() dto: GetContextSnapshotDto) {
    const data = await this.tools.getContextSnapshot(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('save-context-snapshot')
  async saveContextSnapshot(@Body() dto: SaveContextSnapshotDto) {
    const data = await this.tools.saveContextSnapshot(dto)
    return { code: 0, message: 'ok', data }
  }
}
