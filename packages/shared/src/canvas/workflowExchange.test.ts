import { describe, expect, it } from 'vitest'
import {
  buildWorkflowDocument,
  remapWorkflowIds,
  validateWorkflow,
  inferMediaRole,
} from './workflowExchange'

describe('workflowExchange', () => {
  it('validateWorkflow throws on invalid input', () => {
    expect(() => validateWorkflow({ format: 'wrong' })).toThrow()
    expect(() => validateWorkflow(null)).toThrow()
  })

  it('validateWorkflow accepts minimal doc', () => {
    const doc = buildWorkflowDocument({
      nodes: [
        {
          id: 'image-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { prompt: 'p', url: 'https://x/a.png' },
        },
      ],
      edges: [],
      mode: 'full',
      exportMode: 'lightweight',
    })
    expect(doc.format).toBe('lnkpi.workflow')
    expect(doc.version).toBe('1.0.0')
    expect(validateWorkflow(doc).graph.nodes[0].mediaRole).toMatch(
      /generated|uploaded|none/,
    )
  })

  it('remapWorkflowIds rewrites edges, parentId, mediaIndex, and data refs', () => {
    const doc = buildWorkflowDocument({
      nodes: [
        {
          id: 'image-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: {
            url: 'https://x/a.png',
            mentionedKeys: ['image-2'],
            localRefs: [
              {
                id: 'ref-1',
                mediaType: 'image',
                sourceKind: 'upload',
                label: 'ref',
                nodeId: 'image-2',
              },
            ],
          },
        },
        {
          id: 'image-2',
          type: 'image',
          position: { x: 1, y: 0 },
          parentId: 'image-1',
          parentNode: 'image-1',
          data: { url: 'https://x/b.png' },
        },
      ],
      edges: [{ id: 'e1', source: 'image-2', target: 'image-1' }],
      mode: 'full',
      exportMode: 'full_package',
      mediaIndex: [
        {
          nodeId: 'image-1',
          kind: 'image',
          fileName: 'a.png',
          path: 'media/a.png',
        },
      ],
    })
    let n = 0
    const { document, idMap } = remapWorkflowIds(doc, (type) => `${type}-new-${++n}`)
    expect(idMap['image-1']).toMatch(/^image-new-/)
    expect(document.graph.edges[0].source).toBe(idMap['image-2'])
    expect(document.graph.edges[0].target).toBe(idMap['image-1'])
    expect(document.graph.nodes[1].parentId).toBe(idMap['image-1'])
    expect(document.graph.nodes[1].parentNode).toBe(idMap['image-1'])
    expect(document.mediaIndex[0].nodeId).toBe(idMap['image-1'])
    const node0Data = document.graph.nodes[0].data
    expect(node0Data.mentionedKeys).toEqual([idMap['image-2']])
    const localRefs = node0Data.localRefs as Array<{ nodeId: string }>
    expect(localRefs[0].nodeId).toBe(idMap['image-2'])
  })

  it('inferMediaRole detects upload vs generated', () => {
    expect(
      inferMediaRole({ url: 'https://x/a.png', imageVersions: [{ source: 'upload' }] }),
    ).toBe('uploaded')
    expect(
      inferMediaRole({ url: 'https://x/a.png', generationRecordId: 'g1' }),
    ).toBe('generated')
    expect(inferMediaRole({})).toBe('none')
  })
})
