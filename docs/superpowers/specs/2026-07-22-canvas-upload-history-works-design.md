# 画布上传 / 历史 / 主页作品修复与增强

**日期**：2026-07-22  
**状态**：已批准（对话确认）  
**范围**：问题 1–12 一轮交付（同分支连续提交，最后开一个 PR）

## 已锁定决策

| 项 | 决策 |
|----|------|
| 交付方式 | 方案 2：同 feature 分支按子系统连续提交，最后单一 PR |
| 历史节点编号 | 展示 `node.id`（如 `image-3`） |
| 发布主成片 | 发布弹窗强制选择主成片节点，未选不可发布 |
| 查看制作过程 | 只读画布快照；可「复制到我的画布」 |
| 历史模型/渠道 | 模型名与渠道分两行展示，均保留便于运维追踪 |

## 子系统与提交顺序

1. 上传可观测性 + dock 本地文件拖放（1–5）
2. 连线高亮 class 残留修复（6）
3. 历史画布级 + 卡片/详情/失败 UX，下线 DockFailureChip（7–10）
4. 主页画布 `[...]` 菜单（11）
5. 作品发布主成片 + 详情观看/过程/点赞/分享（12）

---

## 1. 上传与拖放（问题 1–5）

### 问题

登录态下 `persistMediaUrl` 失败会静默回退 `blob:`；各入口再把 blob 当硬失败，用户只看到笼统「上传失败」。全程无进度。Dock 对本地 `Files` 拖放未实现（仅支持资产库 MIME）。

### 统一上传层

- 改造 `persistMediaUrl` / `uploadApi.upload`：
  - 校验响应 `code === 0` 与 `data.url`
  - 失败抛出可读错误（网络、401、413/超 50MB、服务端 `message`）
  - 支持 `onUploadProgress`（0–100%）
- 登录态失败**不再**回退 blob
- 未登录：节点/画布仍可用本地 blob；资产库上传仍要求登录

### 进度感知

- 节点卡、dock 参考图、资产库：进入 `uploading` + 百分比或不确定进度条
- 上传未完成前禁用重复提交

### 各入口行为

| 入口 | 行为 |
|------|------|
| 资产库上传 | 统一上传成功后再 `saveMine`；失败 ElMessage 带原因 |
| 图/视频/音频节点 | 同上；文本节点不支持节点卡上传（画布拖入文本文件仍可建 text 节点） |
| Dock 参考图（Image/Video） | 文件选择器走统一上传 + 进度；失败可重试 |
| 拖到画布空白 | 落点 uploading 占位 → 成功写 URL / 失败 error + 原因 |
| 拖到选中节点 | 类型可接则挂 localRef（保留现逻辑） |
| 拖到 dock-studio | **新增**：`Files` → 上传 → `appendLocalRef`；类型不匹配提示；与资产库拖入对称 |

### 验收

登录态图/视频/音频：资产库、节点卡、dock 选文件、画布拖放、dock 拖放五条路径均可成功或给出明确失败原因，并可见进度。

---

## 2. 连线高亮（问题 6）

### 问题

`flowEdges` 写入的高亮 `class` 经 `onEdgesChange` 污染 `edges.value`；非当前链路边未剥离 class → 点空白/换节点后残留，甚至多组同时亮。

### 设计

- **展示层与源数据分离**：`edges.value` 永不持久化高亮 class
- `flowEdges` 每次按当前选中重算：
  - 上游 → `neo-edge-upstream`
  - 下游 → `neo-edge-downstream`
  - 其余 → 显式 `class: undefined`，卸掉旧 class
- 仅 `multiSelectedIds.length === 1` 时高亮该节点上下游
- 熄灭：`onPaneClick`、切换到另一节点、点击连线时清空节点选中并熄灭链路高亮
- 多选框选时不亮上下游

### 验收

点 A 亮 A；再点 B 只亮 B；点空白全部熄灭；无多节点链路同时高亮。

---

## 3. 历史面板（问题 7–10）

### 7. 画布级作用域

- `GenerationRecord` 增加可选字段：`sessionId`、`nodeId`（生成时写入）
- `GET /studio/generations?sessionId=` 只返回当前画布任务
- 面板用路由 `sessionId` 拉列表
- 旧记录无 `sessionId` 的不进入当前画布列表（避免全局混入）

### 8. 详情：模型 / 渠道 / 参数

- **模型**：单独一行，可读名（`modelOptionName` / `originalModel`）
- **渠道**：单独一行，渠道名称（可解析则用名称，否则 `channelId` 短码）——保留便于追踪
- **节点**：单独一行 `nodeId`（如 `image-3`）
- **参数**：按类型展示 metadata（有则显示）
  - 图：resolution / aspectRatio / size / count
  - 视频：duration / resolution / aspectRatio / crop
  - 音频：voice / speed 等

### 9. 失败任务

- 列表「失败」旁感叹号；点击打开错误面板（`userMessage` + 可复制完整诊断）
- 详情页展示失败原因
- **下线** dock-studio `DockFailureChip`；节点角标 ⓘ 诊断保留

### 10. 默认卡片

- 类型图标 + **`node.id`**（无则「—」）+ 状态
- 缩略图：图 url；视频 `<video>` 预览；音频类型占位；文本摘要块
- 点击进详情；hover 定位仍按 `generationRecordId` / `nodeId` 聚焦节点

### 验收

只见本画布历史；卡片含 `image-3` 类 id 与缩略图；详情模型与渠道分列且有参数；失败可点叹号复制；dock 无失败胶囊。

---

## 4. 主页画布与作品（问题 11–12）

### 11. 我的画布 `[...]` 菜单

- Hover 右上角 `[...]`，`click.stop` 展开
- **重命名** → 已有 `PUT /sessions/:id`
- **删除** → 确认后已有 `DELETE /sessions/:id`
- **复制副本** → 新增 `POST /sessions/:id/duplicate`（title 加「副本」+ 拷贝 `canvasData`）

### 12. 发布与作品详情

#### 发布弹窗

- 强制选择主成片节点（列出有 URL 的 image/video）；未选不可发布
- Work 写入：`playbackUrl`、`playbackKind`（image|video）、`sessionId`、封面

#### 详情页 `/share/:id`

- **立即观看**：video 播放器 / image 大图
- **查看制作过程**：只读 Vue Flow 快照（禁编辑/生成）；「复制到我的画布」→ duplicate 到当前用户
- **分享**：复制详情链接
- **点赞**：`POST /works/:id/like`（需登录）；未登录引导登录
- **作者**：头像/昵称，可进创作者页

#### 首页作品卡

- 点击进详情；卡片保留立即观看 / 制作过程 / 分享等可点击入口

### 验收

画布可重命名/删除/复制；发布必须选主成片；详情能看、能进只读过程、能赞、能分享、能看作者。

---

## 数据模型变更摘要

| 模型 | 变更 |
|------|------|
| `GenerationRecord` | +`sessionId?`、+`nodeId?`；列表支持 `?sessionId=` |
| `Work` | +`playbackUrl?`、+`playbackKind?`；like API |
| `Session` | +`POST /:id/duplicate` |

## 明确非目标（本轮不做）

- 真实短信验证码改造
- 资产库文件物理副本（仍存 URL 引用）
- 系统级原生分享面板（本轮仅复制链接）
- 将 Agent `/replay` 逐步回放作为「制作过程」主路径（只读画布快照为主）
- 文本节点卡上的文件上传入口

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 生产上传仍失败（磁盘/反代 body） | 错误文案透出 HTTP/服务端 message，便于运维 |
| 旧 GenerationRecord 无 sessionId | 不混入当前画布列表；新生成全部写入 |
| 只读画布需公开读 canvas | 详情「制作过程」按 work.sessionId 鉴权：作者或已发布作品可读者 |
| PR 体积大 | 同分支 5 次语义提交，review 按提交看 |
