import type { AgentContext, AgentStreamEvent, LLMProvider } from './types'
import { CANVAS_TOOLS } from './tools/canvas-tools'
import { CanvasToolExecutor } from './tools/executor'

const SYSTEM_PROMPT = `你是超创平台的 AI 创作助手，专门帮助用户在无限画布上创作 AI 图像、视频和漫剧内容。
你可以调用工具来操作画布：创建分镜、生成图像/视频、优化提示词、连接节点、排列布局。
请用中文回复，简洁专业。当用户描述创作需求时，主动调用合适的工具。`

/**
 * 规则引擎：无 LLM API Key 时的降级 Agent，通过意图匹配驱动工具
 */
export class RuleBasedAgent implements LLMProvider {
  async chat(
    messages: Array<{ role: string; content: string }>,
    _tools: typeof CANVAS_TOOLS,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<void> {
    const userMsg = messages.filter((m) => m.role === 'user').pop()?.content ?? ''
    const executor = new CanvasToolExecutor()
    const ctx = this.buildContext(userMsg, messages)

    const plan = this.planTools(userMsg)

    onEvent({ type: 'text_delta', data: { text: plan.reply } })

    for (const tool of plan.tools) {
      onEvent({ type: 'tool_call', data: { name: tool.name, arguments: tool.args } })
      const { result, actions } = await executor.execute(tool.name, tool.args, ctx)
      onEvent({ type: 'tool_result', data: { name: tool.name, result } })
      for (const action of actions) {
        onEvent({ type: 'canvas_action', data: action })
      }
    }

    onEvent({ type: 'done', data: {} })
  }

  private buildContext(userMessage: string, messages: Array<{ role: string; content: string }>): AgentContext {
    return {
      sessionId: 'current',
      canvasData: { nodes: [], edges: [] },
      shots: [],
      userMessage,
      history: messages.map((m, i) => ({
        id: String(i),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        createdAt: new Date().toISOString(),
      })),
    }
  }

  private planTools(msg: string): { reply: string; tools: Array<{ name: string; args: Record<string, unknown> }> } {
    const lower = msg.toLowerCase()

    if (/优化|改进|enhance/.test(msg) && /提示|prompt/.test(lower)) {
      const prompt = msg.replace(/优化提示词[：:]*\s*/i, '').trim()
      return {
        reply: '我来帮你优化这个提示词，让它更适合 AI 生成：',
        tools: [{ name: 'optimize_prompt', args: { prompt, style: 'cinematic' } }],
      }
    }

    if (/视频|video|动画/.test(msg)) {
      const prompt = msg.replace(/生成(一个)?视频[：:]*\s*/i, '').trim() || msg
      return {
        reply: '好的，我来为你创建分镜并生成视频：',
        tools: [
          { name: 'create_shot', args: { prompt, title: '视频分镜' } },
          { name: 'generate_video', args: { prompt, duration: 5 } },
        ],
      }
    }

    if (/排列|布局|整理/.test(msg)) {
      return {
        reply: '我来帮你自动排列画布上的分镜：',
        tools: [{ name: 'layout_shots', args: { direction: 'horizontal' } }],
      }
    }

    if (/脚本|台词|旁白|文本/.test(msg)) {
      return {
        reply: '已添加文本节点：',
        tools: [{ name: 'add_text_node', args: { content: msg } }],
      }
    }

    // 默认：创建分镜 + 生成图像
    const prompt = msg.replace(/生成(一张)?(图|画|图像)[：:]*\s*/i, '').trim() || msg
    return {
      reply: `收到！我来为你创建分镜并生成图像素材：`,
      tools: [
        { name: 'create_shot', args: { prompt, title: 'AI 创作分镜' } },
        { name: 'generate_image', args: { prompt } },
      ],
    }
  }
}

/**
 * OpenAI 兼容 LLM Agent（有 API Key 时使用）
 */
export class OpenAIAgent implements LLMProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.openai.com/v1',
    private model = 'gpt-4o',
  ) {}

  async chat(
    messages: Array<{ role: string; content: string }>,
    tools: typeof CANVAS_TOOLS,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<void> {
    const executor = new CanvasToolExecutor()
    const ctx: AgentContext = {
      sessionId: 'current',
      canvasData: { nodes: [], edges: [] },
      shots: [],
      userMessage: messages.filter((m) => m.role === 'user').pop()?.content ?? '',
      history: [],
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        stream: true,
      }),
    })

    if (!response.ok || !response.body) {
      onEvent({ type: 'error', data: { message: `LLM API error: ${response.status}` } })
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const pendingToolCalls: Map<number, { name: string; arguments: string }> = new Map()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
        try {
          const chunk = JSON.parse(line.slice(6))
          const delta = chunk.choices?.[0]?.delta
          if (!delta) continue

          if (delta.content) {
            onEvent({ type: 'text_delta', data: { text: delta.content } })
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, { name: tc.function?.name ?? '', arguments: '' })
              }
              const pending = pendingToolCalls.get(idx)!
              if (tc.function?.name) pending.name = tc.function.name
              if (tc.function?.arguments) pending.arguments += tc.function.arguments
            }
          }

          if (chunk.choices?.[0]?.finish_reason === 'tool_calls') {
            for (const [, tc] of pendingToolCalls) {
              const args = JSON.parse(tc.arguments || '{}')
              onEvent({ type: 'tool_call', data: { name: tc.name, arguments: args } })
              const { result, actions } = await executor.execute(tc.name, args, ctx)
              onEvent({ type: 'tool_result', data: { name: tc.name, result } })
              for (const action of actions) {
                onEvent({ type: 'canvas_action', data: action })
              }
            }
            pendingToolCalls.clear()
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    onEvent({ type: 'done', data: {} })
  }
}

export class CanvasAgent {
  private provider: LLMProvider

  constructor(apiKey?: string, baseUrl?: string) {
    this.provider = apiKey
      ? new OpenAIAgent(apiKey, baseUrl)
      : new RuleBasedAgent()
  }

  async run(
    messages: Array<{ role: string; content: string }>,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<void> {
    await this.provider.chat(messages, CANVAS_TOOLS, onEvent)
  }
}

export type { AgentStreamEvent } from './types'
