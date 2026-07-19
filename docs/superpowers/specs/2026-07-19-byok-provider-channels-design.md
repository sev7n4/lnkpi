# BYOK 自定义网关设计规格

**日期**：2026-07-19  
**状态**：已设计 / 待实现  
**分支建议**：`feature/byok-provider-channels`  
**UI 复刻基准**：Vercel 部署 [infinite-canvas-sage-phi](https://infinite-canvas-sage-phi.vercel.app) **v0.4.0** 配置弹窗（渠道 / 模型 / 生成偏好 / WebDAV）  
**参考源码对照**：GitHub `basketikun/infinite-canvas`（字段语义对照；不以 v0.8+/main 的 Drawer/脚本编辑器为复刻目标）

---

## 1. 背景与问题

当前 lnkpi：

- Dock 模型列表来自 `packages/shared/src/studioModelCatalog.ts`
- 生成请求使用服务端 `.env`（`OPENAI_API_KEY` / `OPENAI_BASE_URL` 等）
- 画布左上角「模型服务配置」仅写 `localStorage`，**API Key / Base URL 不进入生成链**，属于无效 UI

目标：彻底打通 **BYOK（Bring Your Own Key）**——用户可配置渠道与模型；密钥**服务端加密存储**；生成由**服务端代理调用**；UI **100% 复刻** v0.4.0 配置弹窗四个 Tab（含 WebDAV）。

---

## 2. 已锁定决策

| 决策 | 结论 |
|------|------|
| UI 基准 | Vercel **v0.4.0** 配置弹窗四 Tab 全复刻 |
| 架构 | **方案 A**：渠道中心 + 服务端解析 |
| 模型值 | `channelId::modelName` |
| Dock 展示来源 | 用户「可选模型」配置为唯一来源；Catalog+`.env` 与用户渠道组成候选池 |
| 渠道层级 | 平台只读渠道 + 用户私有渠道 |
| 加密 | AES-256-GCM；主密钥 `BYOK_ENCRYPTION_KEY_V1`；带 `keyVersion`；不复用 `JWT_SECRET` |
| WebDAV | 凭据服务端加密 + **服务端代理**同步（不浏览器直连） |
| BYOK 失败 | **不静默**；进入 `fallback_pending`；二次确认：「自定义渠道失败，已切换平台服务，可能会有额外费用，是否继续？」 |
| 覆盖范围 | 文本 / 图片 / 视频 / 音频 **全部一致** |
| 不纳入本规格 | v0.8+/main 的渠道 Drawer、调用脚本编辑器、「提示词来源」Tab |

---

## 3. 架构总览

```text
UI（v0.4.0 复刻）
  ├─ 渠道 / 模型 / 生成偏好 / WebDAV  →  Provider Settings API
  └─ Dock 选择 channelId::modelName   →  Studio / Canvas generate API
                                              │
                              ProviderResolver（按 userId）
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     ▼                        ▼                        ▼
              用户渠道（解密密钥）      平台渠道（.env）         无配置/失败
                     │                        │                        │
                     └──────── 调用上游 ───────┘                        │
                              │ 失败                                   │
                              ▼                                        │
                     fallback_pending ──二次确认──► 平台重试
```

### 3.1 核心组件

| 组件 | 职责 |
|------|------|
| `ProviderChannel` | 平台只读 + 用户私有；baseUrl / apiFormat / 加密 apiKey / 模型列表 |
| `UserAiPreferences` | 四类可选模型、默认模型、生成偏好 |
| `UserWebdavConfig` | URL/目录/用户名 + 加密密码；test/sync 经服务端代理 |
| `CryptoService` | AES-256-GCM 加解密；keyVersion |
| `ProviderResolver` | 解析 `channelId::model`；校验归属；注入凭据；触发回退流程 |

### 3.2 Dock 与 Catalog 关系

```text
平台模型（studioModelCatalog.ts + .env）
        │
        ├── 注册为只读「平台渠道」
用户自定义渠道（Base URL + API Key + 拉取/手填模型）
        │
        ▼
用户在「模型」Tab：
  四类「可选项」+ 四类「默认模型」
        │
        ▼
Dock Studio 对应节点下拉（唯一展示来源）
```

- 新建节点：写入用户默认模型 `channelId::modelName`
- 已有节点模型若不在可选项：仍显示并标记「已停用」；**生成前必须重选**

---

## 4. 数据模型

### 4.1 `ProviderChannel`

| 字段 | 说明 |
|------|------|
| `id` | 主键；平台渠道固定 id（如 `platform`） |
| `userId` | `null` = 平台渠道；非空 = 用户私有 |
| `name` | 展示名 |
| `apiFormat` | `openai` \| `gemini` |
| `baseUrl` | 经 SSRF 校验后的 URL |
| `encryptedApiKey` / `iv` / `authTag` / `keyVersion` | 用户渠道密钥；平台渠道为空，运行时用 `.env` |
| `models` | JSON：`{ name, capability }[]`，capability ∈ text/image/video/audio |
| timestamps | createdAt / updatedAt |

约束：`(userId, name)` 在用户维度唯一（平台渠道单独处理）。

### 4.2 `UserAiPreferences`

| 字段 | 说明 |
|------|------|
| `userId` | 唯一 |
| `selectableImageModels` 等 | JSON：`channelId::modelName[]` |
| `defaultImageModel` 等 | `channelId::modelName` |
| `canvasImageCount` | 默认 3，范围 1–15 |
| `audioVoice` / `audioFormat` / `audioSpeed` | 对齐 v0.4.0 默认 |
| `audioInstructions` / `systemPrompt` | 可选文本 |

### 4.3 `UserWebdavConfig`

| 字段 | 说明 |
|------|------|
| `userId` | 唯一 |
| `url` / `directory` / `username` | 非敏感 |
| `encryptedPassword` / `iv` / `authTag` / `keyVersion` | 密码加密 |
| `connectionMode` | 固定 `proxy`（服务端代理）；UI 若保留「前端直连」选项则禁用或隐藏 |
| `lastSyncedAt` | 可选 |

### 4.4 生成状态扩展

- `GenerationRecord.status` / Material 相关状态增加：`fallback_pending`
- `metadata` 允许记录：`channelId`、`failureClass`、`providerFallback`、用户是否确认平台重试  
- **禁止**写入明文 apiKey、完整上游响应正文

---

## 5. API

均需登录（`AuthGuard` + `req.user.sub`）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/provider/bootstrap` | 平台渠道 + 用户渠道（掩码）+ 偏好 + WebDAV（无密码） |
| POST | `/provider/channels` | 新建用户渠道 |
| PUT | `/provider/channels/:id` | 更新；`apiKey` 空字符串=保留旧密钥；显式 `null`/clear 标志=删除密钥 |
| DELETE | `/provider/channels/:id` | 删除用户渠道（不可删平台） |
| POST | `/provider/channels/:id/pull-models` | 服务端拉取上游模型列表 |
| POST | `/provider/channels/pull-all` | 拉取用户全部渠道（可选） |
| PUT | `/provider/preferences` | 可选项 + 默认模型 + 生成偏好 |
| PUT | `/provider/webdav` | 保存 WebDAV（密码同保留/清除语义） |
| POST | `/provider/webdav/test` | 服务端测试连接 |
| POST | `/provider/webdav/sync` | 服务端代理同步 |
| POST | `/studio/.../confirm-platform-fallback` | 二次确认后平台重试（文本/图/视/音） |
| POST | `/agent/canvas/.../confirm-platform-fallback` | Canvas Material 路径同等语义 |

响应中的密钥字段：**永不返回明文**；仅 `hasApiKey: boolean` + `apiKeyMask?: string`（如 `sk-…xxxx`）。

---

## 6. UI 复刻清单（v0.4.0）

替换 `ModelProviderSettingsDialog` / `useModelProviderSettings` 的 localStorage 方案。

### 6.1 Tab「渠道」

- 重要提示：新增或拉取模型后需到「模型」Tab 选择可选项
- 「去模型设置」跳转模型 Tab
- 「拉取全部」「新增渠道」
- 每渠道：名称、调用格式（OpenAI/Gemini）、Base URL、API Key（密码框）、模型列表（多选/标签）
- 「拉取模型」、删除渠道（至少保留一个用户可编辑渠道的策略：若仅剩平台渠道则可继续；用户渠道至少 0 个亦可，依赖平台）

### 6.2 Tab「模型」

- 生图/视频/文本/音频「可选项」多选
- 四类「默认模型」单选
- 展示格式：`模型名（渠道名）`

### 6.3 Tab「生成偏好」

- 画布默认生图张数（说明文案对齐参考）
- 默认音频声音 / 格式 / 语速
- 默认音频指令
- 系统提示词

### 6.4 Tab「WebDAV」

- 连接方式：仅服务端代理生效
- WebDAV 地址、远程目录、用户名、密码
- 「测试连接」「立即同步」
- 显示上次同步时间

### 6.5 Dock

- `UniversalModelSelector` 数据源改为偏好中的可选项（按 modality 过滤）
- 节点字段继续存模型字符串，但格式改为 `channelId::modelName`
- 与现有 `resolveModelKey` / Catalog：服务端解析时先拆 channel，再对平台渠道走 Catalog；用户渠道用渠道内 model name 作为 gateway model id（除非后续扩展映射表）

---

## 7. 运行时解析与回退

### 7.1 成功路径

1. 请求携带 `model: "channelId::modelName"`（或服务端从节点/DTO 读取）
2. `ProviderResolver` 校验 channel 为平台或当前用户所有
3. 用户渠道：解密 apiKey + baseUrl + apiFormat；平台渠道：`.env`
4. 调用现有 adapter / provider（注入显式凭据，禁止静默读错用户的 env）
5. 成功写结果；metadata 可记 `channelId`

### 7.2 失败路径（统一）

1. 用户渠道调用失败（连接/鉴权/上游错误等）
2. 任务进入 `fallback_pending`；**不**自动调用平台
3. 前端弹窗：

   > 自定义渠道失败，已切换平台服务，可能会有额外费用，是否继续？

4. 用户确认 → `confirm-platform-fallback` → 用平台 `.env` 重试  
5. 用户取消 → 任务失败/终止  
6. 审计：`failureClass`、`channelId`、`providerFallback: true`（确认后）

文本、图片、视频、音频及 Canvas Material / Studio 路径行为一致。异步 Material 必须在启动前固定好「待确认」状态，避免后台 Promise 静默回退。

---

## 8. 安全硬约束

1. AES-256-GCM；`BYOK_ENCRYPTION_KEY_V1`；`keyVersion` 预留轮换  
2. GET 永不返回明文密钥  
3. Base URL：生产强制 `https`；拒绝私网/链路本地/云元数据地址；限制重定向跳数  
4. 拉取模型与生成出站均在服务端  
5. 所有查询按 `userId` 隔离；跨用户 channel → 404  
6. 日志与错误脱敏；不把上游响应原文拼进客户端错误  
7. WebDAV 密码同等加密；同步内容不含 AI API Key  

---

## 9. Catalog 与初始化

- 启动或 bootstrap 时确保存在平台渠道 `platform`，模型列表由 `STUDIO_MODEL_CATALOG` 生成（capability=modality）  
- 新用户偏好默认：四类可选项 = 平台渠道全部对应模型；默认模型 = Catalog `defaultModelKey` 对应的 `platform::…`  
- 用户后续可增删可选项与默认项  

当前 Catalog 模型底表（实现时以此初始化平台渠道；运营可后续扩展）：

| 类型 | modelKey | 显示名 | gatewayModelId | 默认 |
|------|----------|--------|----------------|------|
| text | gemini-3.1-flash | Gemini 3.1 Flash | gemini-3.1-flash | 是 |
| text | deepseek-v4 | DeepSeek V4 | deepseek-v4 | |
| text | gpt-5.5 | GPT 5.5 | gpt-5.5 | |
| image | image2 | Image2 | image2 | |
| image | navo-pro | Navo Pro | navo-pro | |
| image | seedream-5.0-pro | Seedream 5.0 Pro | seedream-5.0-pro | 是 |
| image | midjourney-8.1 | Midjourney 8.1 | midjourney-8.1 | |
| video | seedance-2.0-min | Seedance 2.0 Min | seedance-2.0-min | 是 |
| video | happyhose-1.1 | Happyhose 1.1 | happyhose-1.1 | |
| video | wan-2.7 | Wan 2.7 | wan-2.7 | |
| audio | seed-audio-1.0 | Seed Audio 1.0 | seed-audio-1.0 | |
| audio | minimax-speech-2.8-hd | MiniMax Speech 2.8 HD | speech-2.8-hd | 是 |

交互配置底表（Canvas）：见工作区 `canvases/studio-model-catalog.canvas.tsx`。

---

## 10. 测试计划

| 类别 | 用例 |
|------|------|
| Crypto | round-trip；错误 keyVersion 失败 |
| 渠道 | CRUD；密钥保留/清除；不可改删平台渠道 |
| 偏好 | 可选项驱动 Dock；停用模型拦截生成 |
| 生成 | 用户渠道成功；失败进 pending；确认平台重试；取消 |
| WebDAV | test/sync 代理；密码不回传 |
| 安全 | SSRF 拒绝；跨用户 404；GET 无明文 |
| 回归 | 无用户渠道时平台路径与现行为一致 |

---

## 11. 非目标（本 PR / 本规格）

- 浏览器执行用户自定义调用脚本（infinite-canvas 插件脚本）  
- 提示词来源 Tab  
- 腾讯云 KMS（后续可替换 CryptoService 后端）  
- 改变积分单价（平台回退仍按现有平台计费规则扣点）  

---

## 12. 实现顺序建议

1. Prisma + CryptoService + Provider 模块（bootstrap / channels / preferences）  
2. ProviderResolver 接入 Studio + Material（含 fallback_pending）  
3. 前端配置弹窗 v0.4.0 复刻 + Dock 绑定可选项  
4. WebDAV 代理  
5. 全量测试 + 文档 / 跟踪清单更新  

---

## 13. 验收标准

1. 配置弹窗四 Tab 字段与 v0.4.0 对齐（WebDAV 连接方式语义改为仅代理）  
2. Dock 模型列表与用户「可选项」一致，非裸 Catalog 全量  
3. 用户渠道生成成功且不泄漏密钥到前端/日志  
4. 用户渠道失败出现费用二次确认；确认后平台重试；取消不调用平台  
5. WebDAV 测试/同步经服务端；密码加密存储  
6. `pnpm build && pnpm test` 通过；关键服务端/Web 单测覆盖 §10  

---

**最后更新**：2026-07-19
