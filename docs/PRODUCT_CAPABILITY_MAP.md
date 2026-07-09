# 超创平台 × NeoWOW 产品能力对标

> 目标：优先 **1:1 复刻 NeoWOW 产品能力**，后续再按自有路线迭代。

## 一、产品模块总览

| 模块 | NeoWOW 对应 | 超创平台状态 | 优先级 |
|------|------------|-------------|--------|
| 创作启动器 | `/workflow` `/neo-tv` | ✅ MVP 已实现 | P0 |
| 无限画布 | `WorkflowCanvas` `/canvas-editor` | 🟡 基础节点，待增强 | P0 |
| 会话管理 | `SessionSelector` | 🟡 API 已有，UI 待补 | P0 |
| 用户认证 | `LoginDialog` 手机验证码 | ✅ MVP 已实现 | P0 |
| 社区作品流 | `NeoTV` / `WorksGridList` | ✅ MVP 已实现 | P0 |
| AI 文本生成 | `TextModelSelector` | ⬜ 待实现 | P1 |
| AI 图像生成 | `ImageModelSelector` + `AIImageEditor` | ⬜ 待实现 | P1 |
| AI 视频生成 | `VideoModelSelector` + `VideoSettingsSelector` | ⬜ 待实现 | P1 |
| 语音输入 | `VoiceInput` | ⬜ 待实现 | P1 |
| 分镜面板 | `StoryboardDialog` | ⬜ 待实现 | P1 |
| 发布作品 | `PublishNeoTVDialog` | ⬜ 待实现 | P1 |
| 积分/会员 | `PointsBillSection` / `UnifiedMembershipModal` | ⬜ 待实现 | P2 |
| 图像工作室 | `/image-studio` | ⬜ 待实现 | P2 |
| 视频工作室 | `/video-studio` | ⬜ 待实现 | P2 |
| 音频工作室 | `/audio-studio` | ⬜ 待实现 | P2 |
| 视频编辑器 | `/video-editor` | ⬜ 待实现 | P2 |
| 生成记录 | `/generation-records` | ⬜ 待实现 | P2 |
| 创作者主页 | `/creator/:id` | ⬜ 待实现 | P2 |
| 作品分享 | `/share/:id` | ⬜ 待实现 | P2 |

## 二、NeoWOW 路由映射

```
/                    → 首页重定向
/workflow            → 创作启动器（画布入口 + 作品流）
/neo-tv              → 超创站（社区作品）
/canvas-editor       → 无限画布编辑器
/inputSection        → 创意输入区
/create              → 创建流程
/stories             → 故事/漫剧
/generation-records  → 生成记录
/profile             → 个人中心
/membership          → 会员/积分
/image-studio        → 图像工作室
/video-studio        → 视频工作室
/audio-studio        → 音频工作室
/video-editor        → 视频编辑器
/featured-works      → 精选作品
/share/:id           → 分享页
/creator/:creatorId  → 创作者主页
```

## 三、无限画布核心能力

### 节点类型
- **提示词节点** — 输入 AI prompt，触发下游生成
- **图像节点** — 展示/编辑 AI 生成图像
- **视频节点** — 展示/编辑 AI 生成视频
- **文本节点** — 脚本/旁白/台词
- **分组节点** — 节点编组

### 画布交互
- 无限平移 / 缩放
- 节点拖拽、连线
- 右键上下文菜单
- 小地图导航
- 自动保存会话

### 底部生成栏（对标 NeoWOW）
- 多模型选择器（文本/图像/视频）
- @提及输入
- 语音输入
- 发送/生成按钮
- 视频参数（比例、时长、裁剪）

## 四、分阶段实施计划

### Phase 1 — 核心骨架（当前）
- [x] Monorepo 工程结构
- [x] 创作启动器页面
- [x] 社区作品流
- [x] 基础无限画布
- [x] 手机验证码登录
- [x] 会话 CRUD API
- [ ] GitHub 仓库

### Phase 2 — AI 生成能力
- [ ] 接入 OpenAI 兼容 API（文本/图像）
- [ ] 画布节点生成流水线
- [ ] 模型选择器 UI
- [ ] 语音输入
- [ ] 分镜面板

### Phase 3 — 社区与商业化
- [ ] 发布作品到超创站
- [ ] 查看创作过程（画布回放）
- [ ] 积分/会员体系
- [ ] 创作者主页

### Phase 4 — 工作室
- [ ] 图像/视频/音频独立工作室
- [ ] 视频编辑器
- [ ] 漫剧/故事模式
