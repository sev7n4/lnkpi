import type { CanvasAction, CanvasData, Shot } from '@lnkpi/shared'
import type { AgentContext, ToolExecutor } from '../types'
import { createImageProvider } from './image-provider'

let shotCounter = 0
let nodeCounter = 0

function nextShotId() {
  return `shot-${Date.now()}-${++shotCounter}`
}

function nextNodeId(type: string) {
  return `${type}-${Date.now()}-${++nodeCounter}`
}

function optimizePromptText(prompt: string, style?: string): string {
  const styleHint = style ? `，${style} 风格` : ''
  return `${prompt}${styleHint}，高清细节，专业构图，电影级光影，8K 画质`
}

export class CanvasToolExecutor implements ToolExecutor {
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: AgentContext,
  ): Promise<{ result: unknown; actions: CanvasAction[] }> {
    switch (name) {
      case 'create_shot':
        return this.createShot(args, ctx)
      case 'generate_image':
        return this.generateImage(args, ctx)
      case 'generate_video':
        return this.generateVideo(args, ctx)
      case 'optimize_prompt':
        return this.optimizePrompt(args)
      case 'connect_shots':
        return this.connectShots(args, ctx)
      case 'update_shot':
        return this.updateShot(args, ctx)
      case 'add_text_node':
        return this.addTextNode(args, ctx)
      case 'layout_shots':
        return this.layoutShots(args, ctx)
      default:
        return { result: { error: `Unknown tool: ${name}` }, actions: [] }
    }
  }

  private createShot(args: Record<string, unknown>, ctx: AgentContext) {
    const id = nextShotId()
    const x = (args.x as number) ?? 200 + ctx.shots.length * 320
    const y = (args.y as number) ?? 150
    const prompt = (args.prompt as string) ?? ''
    const title = (args.title as string) ?? `分镜 ${ctx.shots.length + 1}`

    const shot: Shot = {
      id,
      sessionId: ctx.sessionId,
      title,
      prompt,
      order: ctx.shots.length,
      status: 'draft',
      position: { x, y },
      materials: [],
    }

    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id,
          nodeType: 'shot',
          position: { x, y },
          data: { title, prompt, status: 'draft' },
        },
      },
    ]

    return { result: { shotId: id, title }, actions }
  }

  private async generateImage(args: Record<string, unknown>, ctx: AgentContext) {
    const prompt = args.prompt as string
    const shotId = (args.shotId as string) ?? ctx.shots[ctx.shots.length - 1]?.id
    const { url: imageUrl } = await createImageProvider().generate(prompt)
    const materialId = nextNodeId('material-image')

    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id: materialId,
          nodeType: 'image',
          position: { x: 0, y: 0 },
          parentShotId: shotId,
          data: { url: imageUrl, status: 'completed', prompt },
        },
      },
    ]

    if (shotId) {
      actions.push({
        type: 'update_node',
        payload: { id: shotId, data: { status: 'generated', coverUrl: imageUrl } },
      })
    }

    return { result: { materialId, imageUrl, prompt }, actions }
  }

  private generateVideo(args: Record<string, unknown>, _ctx: AgentContext) {
    const prompt = args.prompt as string
    const shotId = args.shotId as string | undefined
    const materialId = nextNodeId('material-video')

    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id: materialId,
          nodeType: 'video',
          position: { x: 0, y: 0 },
          parentShotId: shotId,
          data: { url: '', status: 'generating', prompt, duration: args.duration ?? 5 },
        },
      },
      {
        type: 'update_node',
        payload: {
          id: materialId,
          data: {
            status: 'completed',
            url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=512&q=80',
          },
        },
      },
    ]

    return { result: { materialId, status: 'generating', prompt }, actions }
  }

  private optimizePrompt(args: Record<string, unknown>) {
    const optimized = optimizePromptText(args.prompt as string, args.style as string | undefined)
    return { result: { original: args.prompt, optimized }, actions: [] }
  }

  private connectShots(args: Record<string, unknown>, _ctx: AgentContext) {
    const actions: CanvasAction[] = [
      {
        type: 'add_edge',
        payload: {
          id: `edge-${args.sourceShotId}-${args.targetShotId}`,
          source: args.sourceShotId as string,
          target: args.targetShotId as string,
        },
      },
    ]
    return { result: { connected: true }, actions }
  }

  private updateShot(args: Record<string, unknown>, _ctx: AgentContext) {
    const actions: CanvasAction[] = [
      {
        type: 'update_node',
        payload: {
          id: args.shotId as string,
          data: {
            ...(args.title ? { title: args.title } : {}),
            ...(args.prompt ? { prompt: args.prompt } : {}),
          },
        },
      },
    ]
    return { result: { updated: args.shotId }, actions }
  }

  private addTextNode(args: Record<string, unknown>, ctx: AgentContext) {
    const id = nextNodeId('text')
    const x = (args.x as number) ?? 100
    const y = (args.y as number) ?? 100 + ctx.shots.length * 50

    const actions: CanvasAction[] = [
      {
        type: 'add_node',
        payload: {
          id,
          nodeType: 'text',
          position: { x, y },
          data: { content: args.content as string },
        },
      },
    ]
    return { result: { nodeId: id }, actions }
  }

  private layoutShots(args: Record<string, unknown>, ctx: AgentContext) {
    const direction = (args.direction as string) ?? 'horizontal'
    const actions: CanvasAction[] = ctx.shots.map((shot, i) => {
      let x = shot.position.x
      let y = shot.position.y
      if (direction === 'horizontal') {
        x = 100 + i * 350
        y = 200
      } else if (direction === 'vertical') {
        x = 300
        y = 100 + i * 280
      } else {
        x = 100 + (i % 3) * 350
        y = 100 + Math.floor(i / 3) * 280
      }
      return { type: 'update_node' as const, payload: { id: shot.id, position: { x, y } } }
    })
    return { result: { layout: direction, count: ctx.shots.length }, actions }
  }
}

export function applyCanvasActions(data: CanvasData, actions: CanvasAction[]): CanvasData {
  const result: CanvasData = {
    nodes: [...data.nodes],
    edges: [...data.edges],
    viewport: data.viewport,
  }

  for (const action of actions) {
    switch (action.type) {
      case 'add_node': {
        const p = action.payload
        const parentShot = p.parentShotId
          ? result.nodes.find((n) => n.id === p.parentShotId)
          : null
        const pos = parentShot
          ? { x: parentShot.position.x + 280, y: parentShot.position.y }
          : (p.position ?? { x: 0, y: 0 })
        if (!p.id) break
        result.nodes.push({
          id: p.id,
          type: (p.nodeType ?? 'prompt') as CanvasData['nodes'][0]['type'],
          position: pos,
          data: p.data ?? {},
        })
        if (parentShot && p.id) {
          result.edges.push({
            id: `e-${parentShot.id}-${p.id}`,
            source: parentShot.id,
            target: p.id,
          })
        }
        break
      }
      case 'update_node': {
        const node = result.nodes.find((n) => n.id === action.payload.id)
        if (node) {
          if (action.payload.position) node.position = action.payload.position
          if (action.payload.data) node.data = { ...node.data, ...action.payload.data }
        }
        break
      }
      case 'add_edge': {
        const { id, source, target } = action.payload
        if (!id || !source || !target) break
        result.edges.push({ id, source, target })
        break
      }
      case 'remove_node':
        result.nodes = result.nodes.filter((n) => n.id !== action.payload.id)
        result.edges = result.edges.filter(
          (e) => e.source !== action.payload.id && e.target !== action.payload.id,
        )
        break
    }
  }

  return result
}
