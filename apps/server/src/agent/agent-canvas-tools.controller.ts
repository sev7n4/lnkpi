import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common'
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator'
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
}

class SetNodePromptDto {
  @IsString()
  sessionId!: string

  @IsString()
  nodeId!: string

  @IsString()
  prompt!: string
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

class RunImageGenerationDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsString()
  nodeId!: string
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

  @Post('set-node-prompt')
  async setNodePrompt(@Body() dto: SetNodePromptDto) {
    const data = await this.tools.setNodePrompt(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('attach-refs')
  async attachRefs(@Body() dto: AttachRefsDto) {
    const data = await this.tools.attachRefs(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('run-image-generation')
  async runImageGeneration(@Body() dto: RunImageGenerationDto) {
    const data = await this.tools.runImageGeneration(dto)
    return { code: 0, message: 'ok', data }
  }

  @Post('get-generation-status')
  async getGenerationStatus(@Body() dto: SessionNodeDto) {
    const data = await this.tools.getGenerationStatus(dto)
    return { code: 0, message: 'ok', data }
  }
}
