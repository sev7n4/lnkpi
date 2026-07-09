import type { AgentToolDefinition } from '../types'

export const CANVAS_TOOLS: AgentToolDefinition[] = [
  {
    name: 'create_shot',
    description: '在画布上创建一个新分镜/镜头节点，用于组织创作内容',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '分镜标题' },
        prompt: { type: 'string', description: '分镜的 AI 生成提示词' },
        x: { type: 'number', description: '画布 X 坐标' },
        y: { type: 'number', description: '画布 Y 坐标' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_image',
    description: '为指定分镜生成 AI 图像素材',
    parameters: {
      type: 'object',
      properties: {
        shotId: { type: 'string', description: '目标分镜 ID' },
        prompt: { type: 'string', description: '图像生成提示词' },
        modelId: { type: 'string', description: '图像模型 ID' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: '为指定分镜生成 AI 视频素材（图生视频或文生视频）',
    parameters: {
      type: 'object',
      properties: {
        shotId: { type: 'string', description: '目标分镜 ID' },
        prompt: { type: 'string', description: '视频生成提示词' },
        imageUrl: { type: 'string', description: '参考图像 URL（图生视频）' },
        duration: { type: 'number', description: '视频时长（秒）' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'optimize_prompt',
    description: '优化用户的提示词，使其更适合 AI 图像/视频生成',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '原始提示词' },
        style: { type: 'string', description: '目标风格，如 cinematic、anime、realistic' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'connect_shots',
    description: '在两个分镜之间创建连接，表示创作流程关系',
    parameters: {
      type: 'object',
      properties: {
        sourceShotId: { type: 'string', description: '源分镜 ID' },
        targetShotId: { type: 'string', description: '目标分镜 ID' },
      },
      required: ['sourceShotId', 'targetShotId'],
    },
  },
  {
    name: 'update_shot',
    description: '更新分镜的属性（标题、提示词、位置等）',
    parameters: {
      type: 'object',
      properties: {
        shotId: { type: 'string', description: '分镜 ID' },
        title: { type: 'string', description: '新标题' },
        prompt: { type: 'string', description: '新提示词' },
      },
      required: ['shotId'],
    },
  },
  {
    name: 'add_text_node',
    description: '在画布上添加文本节点（脚本、旁白、台词等）',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '文本内容' },
        x: { type: 'number', description: 'X 坐标' },
        y: { type: 'number', description: 'Y 坐标' },
      },
      required: ['content'],
    },
  },
  {
    name: 'layout_shots',
    description: '自动排列画布上所有分镜节点的布局',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: '排列方向', enum: ['horizontal', 'vertical', 'grid'] },
      },
      required: [],
    },
  },
]
