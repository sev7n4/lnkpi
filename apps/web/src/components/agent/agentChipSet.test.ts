/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import {
  applyAtomicProposeChipPriority,
  confirmAtomicGeneration,
  confirmProposeGeneration,
  canvasHasRecipeParent,
  detectAgentChipSet,
  extractProposeGenerationNodeId,
  resolveAtomicConfirmNodeId,
  resolvePendingConfirmNodeId,
} from './agentChipSet'

type CanvasNodeLike = {
  id: string
  data?: {
    status?: string
    createdAt?: string
    updatedAt?: string
    [key: string]: unknown
  }
}

describe('extractProposeGenerationNodeId', () => {
  it('extracts nodeId from last successful propose_generation dict result', () => {
    expect(
      extractProposeGenerationNodeId([
        { name: 'upsert_media_node', result: { nodeId: 'other' } },
        {
          name: 'propose_generation',
          result: { nodeId: 'img-1', status: 'pending_confirm' },
        },
      ]),
    ).toBe('img-1')
  })

  it('parses JSON string results and accepts node_id', () => {
    expect(
      extractProposeGenerationNodeId([
        {
          name: 'propose_generation',
          result: JSON.stringify({ node_id: 'vid-9', status: 'pending_confirm' }),
        },
      ]),
    ).toBe('vid-9')
  })

  it('ignores propose results that are not pending_confirm', () => {
    expect(
      extractProposeGenerationNodeId([
        { name: 'propose_generation', result: { nodeId: 'img-1', status: 'draft' } },
        { name: 'propose_generation' },
      ]),
    ).toBe(null)
  })

  it('prefers the last successful propose_generation', () => {
    expect(
      extractProposeGenerationNodeId([
        {
          name: 'propose_generation',
          result: { nodeId: 'old', status: 'pending_confirm' },
        },
        {
          name: 'propose_generation',
          result: { nodeId: 'new', status: 'pending_confirm' },
        },
      ]),
    ).toBe('new')
  })
})

describe('detectAgentChipSet', () => {
  it('detects generation_propose from toolCalls even without atomic text', () => {
    expect(
      detectAgentChipSet('已为你准备好节点，请确认后开始生成。', {
        toolCalls: [
          {
            name: 'propose_generation',
            result: { nodeId: 'img-1', status: 'pending_confirm' },
          },
        ],
      }),
    ).toBe('generation_propose')
  })

  it('prefers generation_propose over atomic text snippets', () => {
    expect(
      detectAgentChipSet('视频/音频生成将消耗积分。回复「确认生成」开始，或「取消」放弃。', {
        toolCalls: [
          {
            name: 'propose_generation',
            result: { nodeId: 'img-2', status: 'pending_confirm' },
          },
        ],
      }),
    ).toBe('generation_propose')
  })

  it('detects recipe confirm chips from planner preview copy', () => {
    expect(
      detectAgentChipSet('增加「包装细节」\n请确认是否把改动落到画布'),
    ).toBe('recipe_confirm')
  })

  it('detects recipe confirm chips from composition HITL copy', () => {
    expect(
      detectAgentChipSet('新建白底三视图，再换装两套造型。\n请确认是否把构图落到画布'),
    ).toBe('recipe_confirm')
    expect(
      detectAgentChipSet(
        '请确认是否把构图落到画布\n新建白底三视图\n服装扇出 2\nP+V\n保留 0\n新增 6\n生成请用 Dock 生成工作流',
      ),
    ).toBe('recipe_confirm')
  })

  it('detects recipe promote chips from HITL copy', () => {
    expect(detectAgentChipSet('这份工作流更像哪一种？')).toBe('recipe_promote')
  })

  it('detects promote seed-lock chips from second-step copy', () => {
    expect(
      detectAgentChipSet('将锁定这些核心步骤：模特定妆、模特四视图。确认后才会存成新模板。'),
    ).toBe('recipe_promote_seed')
  })

  it('detects promote variant confirm chips from second-step copy', () => {
    expect(
      detectAgentChipSet('还是原来那套核心步骤，只记住这次的增减和连线。请确认是否保存为改版。'),
    ).toBe('recipe_promote_variant')
  })

  it('detects recipe parent identity on instantiated canvas nodes', () => {
    expect(canvasHasRecipeParent(undefined)).toBe(false)
    expect(canvasHasRecipeParent([{ id: 'image-1', data: { title: '白底' } }])).toBe(false)
    expect(
      canvasHasRecipeParent([
        { id: 'image-1', data: { recipeId: 'model-turnaround', recipeKey: 'model_portrait' } },
      ]),
    ).toBe(true)
    expect(
      canvasHasRecipeParent([{ id: 'image-1', data: { parentRecipeId: 'ecommerce-product-visual' } }]),
    ).toBe(true)
  })

  it('detects plan structured options (new format)', () => {
    expect(
      detectAgentChipSet(
        '定位：高端\n请选择：\n1. 采纳推荐并确认方案\n2. 换个方向再改一版\n3. 我自己说明修改',
      ),
    ).toBe('plan')
  })

  it('detects plan structured options (legacy format)', () => {
    expect(
      detectAgentChipSet(
        '定位：高端\n请选择：\n1 / A：采纳推荐并确认方案\n2 / B：换个方向',
      ),
    ).toBe('plan')
  })

  it('detects copy draft gate', () => {
    expect(
      detectAgentChipSet('【主文案草稿】\n静音\n\n请确认后回复「写入主文案」…'),
    ).toBe('copy')
  })

  it('prefers copy when draft not yet written even if footer mentions 确认出图', () => {
    expect(
      detectAgentChipSet(
        '【主文案草稿】\n静音\n\n请确认后回复「写入主文案」。拓扑确认无误后回复「确认出图」。',
      ),
    ).toBe('copy')
  })

  it('shows topo after copy written and footer mentions 确认出图', () => {
    expect(
      detectAgentChipSet(
        '【主文案草稿】\n静音\n\n已将确认的主文案写入画布节点。拓扑确认无误后回复「确认出图」。',
      ),
    ).toBe('topo')
  })

  it('detects atomic confirm gate', () => {
    expect(
      detectAgentChipSet('视频/音频生成将消耗积分。回复「确认生成」开始，或「取消」放弃。'),
    ).toBe('atomic')
  })

  it('detects atomic confirm gate from sidebar copy snippet', () => {
    expect(
      detectAgentChipSet('收到，将为你创建视频「展示片」。提交前需你确认。'),
    ).toBe('atomic')
  })

  it('detects topo gate and prefers topo over bare plan words', () => {
    expect(
      detectAgentChipSet(
        '已拆解骨架\n当前资产拓扑：\n```mermaid\nflowchart LR\n```\n确认无误后回复「确认出图」。',
      ),
    ).toBe('topo')
  })

  it('returns null for ordinary replies', () => {
    expect(detectAgentChipSet('出图成功')).toBe(null)
  })

  it('returns null for user-facing atomic ack without confirm gate', () => {
    expect(detectAgentChipSet('好的，我来生成图片「主图」。')).toBe(null)
  })

  // 修复 P1-4 + P2-1：modify intent 检测的新优先级逻辑
  // Phase 2c.1 C1: recover generation_propose from canvas pending_confirm SSOT
  describe('Phase 2c.1 C1: pending_confirm SSOT without toolCalls', () => {
    /**
     * Newest heuristic (documented for implementers):
     * prefer data.updatedAt, else data.createdAt (ISO), else lexicographic id.
     */
    it('resolvePendingConfirmNodeId: selected pending wins over older pending', () => {
      const nodes: CanvasNodeLike[] = [
        {
          id: 'img-new',
          data: {
            status: 'pending_confirm',
            createdAt: '2026-09-14T12:00:00.000Z',
            updatedAt: '2026-09-14T12:00:00.000Z',
          },
        },
        {
          id: 'img-selected',
          data: {
            status: 'pending_confirm',
            createdAt: '2026-09-14T10:00:00.000Z',
            updatedAt: '2026-09-14T10:00:00.000Z',
          },
        },
      ]
      expect(resolvePendingConfirmNodeId(nodes, 'img-selected')).toBe('img-selected')
    })

    it('resolvePendingConfirmNodeId: no selected → newest pending by updatedAt/createdAt', () => {
      const nodes: CanvasNodeLike[] = [
        {
          id: 'img-old',
          data: {
            status: 'pending_confirm',
            createdAt: '2026-09-14T09:00:00.000Z',
            updatedAt: '2026-09-14T09:00:00.000Z',
          },
        },
        {
          id: 'img-new',
          data: {
            status: 'pending_confirm',
            createdAt: '2026-09-14T11:00:00.000Z',
            updatedAt: '2026-09-14T11:00:00.000Z',
          },
        },
        {
          id: 'img-draft',
          data: { status: 'draft', createdAt: '2026-09-14T12:00:00.000Z' },
        },
      ]
      expect(resolvePendingConfirmNodeId(nodes, null)).toBe('img-new')
      expect(resolvePendingConfirmNodeId(nodes, undefined)).toBe('img-new')
      expect(resolvePendingConfirmNodeId(nodes, 'missing')).toBe('img-new')
    })

    it('resolvePendingConfirmNodeId: no pending → null', () => {
      const nodes: CanvasNodeLike[] = [
        { id: 'img-1', data: { status: 'draft' } },
        { id: 'img-2', data: { status: 'completed' } },
      ]
      expect(resolvePendingConfirmNodeId(nodes, 'img-1')).toBe(null)
      expect(resolvePendingConfirmNodeId([], null)).toBe(null)
    })

    it('detectAgentChipSet: generation_propose from canvas nodes alone (empty toolCalls)', () => {
      expect(
        detectAgentChipSet('刷新后仍可确认生成。', {
          toolCalls: [],
          canvasNodes: [
            {
              id: 'img-recover',
              data: {
                status: 'pending_confirm',
                createdAt: '2026-09-14T12:00:00.000Z',
              },
            },
          ],
          selectedNodeId: 'img-recover',
        }),
      ).toBe('generation_propose')
    })
  })

  // Phase 2c.1 C2: confirm must call generateForNode, never sendPreset
  describe('Phase 2c.1 C2: confirmProposeGeneration uses dock generate', () => {
    it('calls generateForNode(nodeId) and never sendPreset', async () => {
      const generateForNode = vi.fn(async () => undefined)
      const sendPreset = vi.fn()

      await confirmProposeGeneration('img-1', { generateForNode, sendPreset })

      expect(generateForNode).toHaveBeenCalledTimes(1)
      expect(generateForNode).toHaveBeenCalledWith('img-1')
      expect(sendPreset).not.toHaveBeenCalled()
    })
  })

  // Phase 2c.3 E1–E3: weaken atomic confirm UX
  describe('Phase 2c.3: atomic confirm → dock + propose priority', () => {
    it('E1: pending beats atomic interrupt chip', () => {
      expect(applyAtomicProposeChipPriority('atomic', 'img-pending')).toBe('generation_propose')
      expect(applyAtomicProposeChipPriority('atomic', null)).toBe('atomic')
      expect(applyAtomicProposeChipPriority('plan', 'img-pending')).toBe('plan')
      expect(applyAtomicProposeChipPriority('image_qa', 'img-pending')).toBe('image_qa')
    })

    it('resolveAtomicConfirmNodeId: pending → atomicNodeId → selected media', () => {
      const nodes = [
        { id: 'img-pending', data: { status: 'pending_confirm' } },
        { id: 'img-selected', data: { status: 'draft', type: 'image' } },
      ]
      expect(
        resolveAtomicConfirmNodeId({
          canvasNodes: nodes,
          selectedNodeId: 'img-selected',
          atomicNodeId: 'atomic-1',
          selectedNodeType: 'image',
        }),
      ).toBe('img-pending')
      expect(
        resolveAtomicConfirmNodeId({
          canvasNodes: [{ id: 'x', data: { status: 'draft' } }],
          selectedNodeId: 'img-selected',
          atomicNodeId: 'atomic-1',
          selectedNodeType: 'image',
        }),
      ).toBe('atomic-1')
      expect(
        resolveAtomicConfirmNodeId({
          canvasNodes: nodes.filter((n) => n.id !== 'img-pending'),
          selectedNodeId: 'img-selected',
          atomicNodeId: null,
          selectedNodeType: 'image',
        }),
      ).toBe('img-selected')
      expect(
        resolveAtomicConfirmNodeId({
          canvasNodes: [],
          selectedNodeId: null,
          atomicNodeId: null,
        }),
      ).toBe(null)
    })

    it('E2: confirmAtomicGeneration with nodeId → generateForNode + unwind, no sendPreset confirm', async () => {
      const generateForNode = vi.fn(async () => undefined)
      const sendPreset = vi.fn()
      const unwindAtomicInterrupt = vi.fn(async () => undefined)

      const path = await confirmAtomicGeneration('vid-1', {
        generateForNode,
        sendPreset,
        unwindAtomicInterrupt,
      })

      expect(path).toBe('dock')
      expect(unwindAtomicInterrupt).toHaveBeenCalledTimes(1)
      expect(generateForNode).toHaveBeenCalledWith('vid-1')
      expect(sendPreset).not.toHaveBeenCalledWith('确认生成')
    })

    it('E3: confirmAtomicGeneration without nodeId → sendPreset fallback', async () => {
      const generateForNode = vi.fn()
      const sendPreset = vi.fn(async () => undefined)

      const path = await confirmAtomicGeneration(null, { generateForNode, sendPreset })

      expect(path).toBe('preset')
      expect(generateForNode).not.toHaveBeenCalled()
      expect(sendPreset).toHaveBeenCalledWith('确认生成')
    })
  })

  describe('P1-4 + P2-1: modify intent 与 confirm 选项的优先级', () => {
    it('shows plan chip when agent replies with new confirm after modify', () => {
      // 用户输入"3" → agent 重新生成 → 回复新 confirm 选项
      // 这时应该显示 plan 按钮，让用户确认新方案
      expect(
        detectAgentChipSet(
          '定位：运动鞋\n请选择：\n1. 采纳推荐并确认方案\n2. 换个方向再改一版',
          { latestUserText: '3' },
        ),
      ).toBe('plan')
    })

    it('shows plan chip when agent replies after explicit modify instructions', () => {
      // 用户输入"把模特定妆改为双人模特" → agent 重新生成 → 回复新 confirm
      expect(
        detectAgentChipSet(
          '定位：蓝牙耳机\n请选择：\n1. 采纳推荐并确认方案',
          { latestUserText: '把模特定妆改为双人模特，增加产品材质特写图' },
        ),
      ).toBe('plan')
    })

    it('suppresses chip when agent is still transitioning (no confirm options)', () => {
      // 用户输入 modify intent → agent 回复过渡消息（"正在调整…"）
      // 此时不含 confirm 选项 → 抑制 chip
      expect(
        detectAgentChipSet(
          '好的，正在基于当前方案调整您提到的部分，保留其余节点不变，请稍候…',
          { latestUserText: '把模特定妆改为双人模特' },
        ),
      ).toBe(null)
    })

    it('still shows plan chip for "1/A" confirmation reply', () => {
      expect(
        detectAgentChipSet(
          '正在写入确认方案并拆解画布骨架（先不出图）\n请选择：1. 采纳推荐',
          { latestUserText: '1' },
        ),
      ).toBe('plan')
    })

    it('suppresses chip on lowercase "c" modify with transition message', () => {
      expect(
        detectAgentChipSet('好的，正在基于当前方案调整…', { latestUserText: 'c' }),
      ).toBe(null)
    })
  })
})
