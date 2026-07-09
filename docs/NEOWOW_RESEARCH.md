# NeoWOW 竞品深度调研报告

> 调研目标：https://neowow.cn/workflow?sessionId=2074796563114016768  
> 方法：公开资源逆向分析（HTML/JS Bundle/CSS/路由/网络接口），不涉及盗用源代码或素材。

## 1. 技术栈蒸馏

| 层级 | 技术 | 证据 |
|------|------|------|
| 框架 | Vue 3 + Vue Router | `vue-vendor-*.js` |
| UI 组件 | Element Plus + Ant Design | `element-plus-vendor`, `ant-design` |
| 无限画布 | **PlayCanvas** + Vue Flow 混合 | `playcanvas-vendor-*.js`, `WorkflowCanvas-*.js` 引用 vue-flow |
| 构建 | Vite | `import.meta.url`, `__vite__mapDeps` |
| 多平台 | 白标配置（NeoWOW/火山/围观短剧等） | HTML 内联 `getPlatform()` |
| 存储 | 阿里云 OSS | `/agent/sts/oss/token`, OSS process 参数 |
| 支付 | 微信支付 | `/agent/wxpay/recurring/contract/terminate` |

## 2. 核心路由地图

```
/workflow              创作启动器（sessionId 查询参数恢复上下文）
/workflows             工作流列表
/ai-workflow           AI 工作流
/canvas-editor         无限画布编辑器（核心）
/neo-tv                超创站社区
/inputSection          创意输入区
/stories               我的短片
/generation-records    生成记录
/image-studio          图像工作室
/video-studio          视频工作室
/audio-studio          音频工作室
/video-editor          视频编辑器
/membership            会员中心
/profile               个人中心
/share/:id             作品分享
/creator/:creatorId    创作者主页
```

## 3. 前端 UI 布局（蒸馏）

### 3.1 `/workflow` 启动器页
```
┌─────────────────────────────────────────────────────────┐
│ [Logo]  画布 | 超创站 | ...                    [登录]   │
├─────────────────────────────────────────────────────────┤
│              下午好，今天要做点什么呢？                    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 说说你的创意...          [告诉我你的想法] [创建画布]│    │
│  └─────────────────────────────────────────────────┘    │
│              [轮播 Banner - 沉浸式创作]                    │
│  [全部] [2026-赛事] [...]              [搜索] [发布作品] │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                   │
│  │作品卡│ │作品卡│ │作品卡│ │作品卡│  ...               │
│  └──────┘ └──────┘ └──────┘ └──────┘                   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 `WorkflowCanvas` 画布编辑器（核心）
```
┌──────────┬────────────────────────────────┬──────────┐
│ 会话列表  │                                │ (可选)   │
│ 我的画布  │     PlayCanvas 无限画布          │ 属性面板  │
│          │     + Shot/Material 节点         │          │
│          │                                │          │
├──────────┴────────────────────────────────┴──────────┤
│ Agent 对话区 / 生成栏                                  │
│ [文本|图像|视频] [模型选择器] [语音] [提示词输入] [生成]  │
└──────────────────────────────────────────────────────┘
```

### 3.3 关键 Vue 组件
- `WorkflowCanvas` — 画布主体（PlayCanvas + VueFlow）
- `SessionSelector` — 会话切换
- `GenerationBar` / `MentionInput` / `VoiceInput` — 底部生成栏
- `TextModelSelector` / `ImageModelSelector` / `VideoModelSelector` — 模型选择
- `StoryboardDialog` — 分镜面板
- `AIImageEditor` — 图像编辑
- `PublishNeoTVDialog` — 发布到社区
- `LoginDialog` — 手机验证码登录

## 4. 后端 API 架构（`/agent/*` 为核心）

NeoWOW 采用 **Agent-First** 架构，所有创作能力通过 `/agent` 前缀暴露：

### 4.1 画布域（Canvas Domain）
```
GET  /agent/canvas/list
POST /agent/canvas/create
PUT  /agent/canvas/update
POST /agent/canvas/shot/create
POST /agent/canvas/shot/edit
POST /agent/canvas/shot-order
POST /agent/canvas/shot/optimize-prompt
POST /agent/canvas/material/generate-image
POST /agent/canvas/material/generate-video
POST /agent/canvas/material/upscale-image
POST /agent/canvas/material/lip-sync
POST /agent/canvas/material/page
POST /agent/canvas/shot/status/batch
```

### 4.2 Agent 对话域（核心驱动力）
```
POST /agent/chat/conversation          # Agent 对话（SSE 流式）
POST /agent/chat/optimize-prompt       # 提示词优化
GET  /agent/chat/sessions              # 对话会话列表
GET  /agent/chat/user/messages         # 历史消息
PUT  /agent/chat/session/update        # 更新对话会话
POST /agent/ai-creation/conversation/content    # AI 创作对话内容
POST /agent/ai-creation/visual-record/render      # 视觉记录渲染
```

### 4.3 生成域
```
POST /agent/ai-image-generation/generate
GET  /agent/ai-image-generation/page
POST /agent/ai-image/upload
GET  /agent/capabilities/list          # 能力/模型列表
```

### 4.4 用户/商业域
```
POST /user/login/send-unified-code
POST /user/login/unified-login/identity
GET  /user/profile
GET  /user/points-info
GET  /agent/membership/plans/v2
POST /agent/membership/subscribe
```

## 5. 数据模型蒸馏

```
Canvas (画布会话)
 ├── Shot (分镜/镜头) × N
 │    ├── prompt, order, status, volume
 │    ├── Material (素材) × N
 │    │    ├── type: image | video | audio
 │    │    ├── url, thumbnail, status
 │    │    └── generationParams
 │    └── Audio (旁白/配音)
 └── viewport, backgroundMusic

AgentChatSession (Agent 对话会话)
 └── AgentMessage[] (user | assistant | tool)
      └── toolCalls → CanvasAction[]
```

## 6. Agent 驱动画布机制（核心洞察）

NeoWOW 的 AI Native 模式：

1. **用户在底部 Agent 栏输入自然语言**
2. **`/agent/chat/conversation` 流式返回**，包含：
   - 文本回复（assistant message）
   - Tool Calls（隐式或显式）
3. **Agent 调用画布工具**：
   - `optimize-prompt` → 优化分镜提示词
   - `generate-image` → 在指定 Shot 生成图像
   - `generate-video` → 图生视频
   - `shot/create` → 创建新分镜
4. **前端监听 SSE 事件**，实时更新 PlayCanvas 画布状态
5. **Shot 状态轮询** `/agent/canvas/shot/status/batch` 跟踪异步生成

## 7. 超创平台对标策略

| NeoWOW 能力 | 超创实现方案 |
|------------|-------------|
| PlayCanvas 画布 | Phase 1: Vue Flow 节点画布；Phase 2: 引入 PlayCanvas |
| Agent 对话驱动 | `@lnkpi/agent` + SSE `/agent/chat/conversation` |
| Shot/Material 模型 | Prisma 扩展 + Canvas Tools |
| 模型选择器 | 复刻 UI + `/agent/capabilities/list` |
| 提示词优化 | Agent Tool: `optimize_prompt` |
| 异步生成轮询 | Shot status batch API |
| 社区发布 | 已有 Work 模型，扩展 Publish API |

## 8. 差异化迭代预留

完成复刻后的自有路线：
- 开源 Agent 框架可插拔多 LLM
- 支持 ComfyUI / 本地模型
- 协作编辑（NeoWOW 有 project-collaboration API）
- 插件化节点系统
