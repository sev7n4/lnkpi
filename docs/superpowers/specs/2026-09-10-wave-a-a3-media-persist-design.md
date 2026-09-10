# Wave A · A3 媒体持久化设计

> 日期：2026-09-10  
> 状态：已批准（对话确认 §1–§3）  
> 上级纲领：[2026-09-10-wave-a-delivery-program-design.md](./2026-09-10-wave-a-delivery-program-design.md)  
> 存储架构：**方案 C** — 可插拔 `StorageAdapter`  
> 前置文档：  
> - [2026-08-08-media-storage-download-deferred-design.md](./2026-08-08-media-storage-download-deferred-design.md)（P0/P2 分期）  
> - [../plans/2026-08-08-media-stream-download-p0.md](../plans/2026-08-08-media-stream-download-p0.md)（流式下载 plan；代码已基本落地）

## 1. 背景与目标

Wave A 北极星是成片导出成功率。导出与收藏依赖「可信、不过期」的媒体地址。

仓内现状：

| 能力 | 状态 |
|------|------|
| `GET /api/media/stream-download` | **已实现**（鉴权 + SSRF + 归属；前端 `downloadMediaFile`） |
| 外链过期提示 / 无 `window.open` | **基本已有**（image/video/audio/预览） |
| `POST /api/assets/mine`（`saveAssetToLibrary`） | **仅存 URL 字符串**，upstream 仍易过期 |
| `POST /api/assets/persist-remote` | **未做**（deferred spec P2） |
| 对象存储 SDK / 生产 COS 绑定 | **未见**；上传仍以本地 `uploads/` 为主 |

**A3 目标：** 用户显式「存入资产库 / 收藏」后，易过期 upstream 转为 **可持久化对象存储 URL**，并可再拖回画布作稳定 refs；同时确认流式下载 P0 无回归缺口。

## 2. 范围

### 2.1 做

- **P0 验收/补洞：** `stream-download`、外链提示、无 `window.open`、生成完成「建议下载」toast（缺则补）；不做 Media 模块重写。  
- **`POST /api/assets/persist-remote`：** 归属校验 + SSRF → 拉上游流 → `StorageAdapter.putStream` → 返回 `persistedUrl` 并写入 `UserAsset`。  
- **扩展 `saveAssetToLibrary`：** 对 **upstream URL** 先 persist；本站 `/api/uploads/` **跳过转存**，直接 `saveMine`。  
- **可选 `replaceNodeUrl`：** 将节点 `data.url` 换成 persisted（默认 `false`）。  
- **`StorageAdapter` 接口** + 首个驱动（env 有密钥则 COS / S3 兼容；未配置 → **503**，禁止静默成功）。  
- **Agent 同路径：** `save_node_to_asset_library`（若存在）必须打同一 persist service。

### 2.2 不做

- 默认生成即 rehost（deferred P3）  
- 用户上传目录整迁 COS  
- 保证 upstream 永久有效  
- 批量「一键把本会话全部生成物转 COS」  
- 无鉴权公开 persist  
- 在规格中锁死唯一云厂商以致 A1 STS 无法复用  
- Wave A 纲领 §2.2 全部非目标（worldModel、对外 Skill 双入口等）

## 3. 架构

```text
收藏点击
  → saveAssetToLibrary
  →（upstream）POST /api/assets/persist-remote
  → Nest：归属校验 + SSRF（与 stream-download 同源规则）
  → StorageAdapter.putStream(key, stream, contentType)
  → UserAsset.url = persistedUrl；metadata.storageTier = persisted
  → 可选 replaceNodeUrl 回写节点
```

原则：

1. **默认生成路径不变** — 节点仍可只存 upstream。  
2. **人机同路径** — UI 与 Agent tool 共用 Nest persist service。  
3. **A1 预留** — 同一 `StorageAdapter` 供后续 OSS STS 上传复用。  
4. **零 CVM 落盘转存** — persist 过程流式 pipe 到对象存储，不写生成物到 CVM 磁盘。

## 4. API

### `POST /api/assets/persist-remote`（AuthGuard）

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 待持久化（upstream 或 `/api/uploads/...`） |
| `kind` | `image` \| `video` \| `audio` | |
| `label?` | string | |
| `sessionId?` | string | 收紧归属 |
| `nodeId?` / `sourceNodeId?` | string | 写入资产 |
| `replaceNodeUrl?` | boolean | 默认 `false` |
| `generationRecordId?` | string | 沿用现有 metadata 构建 |

**成功：** `{ persistedUrl, assetId, storageTier: 'persisted' }`  

**错误：**

| 码 | 含义 |
|----|------|
| 400 | SSRF / 非法 URL |
| 403 | 非本用户 session/material/upload 资源 |
| 413 | 超过 **200MB** |
| 502 | 上游拉取失败 |
| 503 | Adapter 未配置（明确文案，禁止假成功） |

### 前端默认路径

1. `isUpstreamMediaUrl(url)` → 调用 `persist-remote`（可由后端内部 upsert `UserAsset`，前端只调一次）。  
2. 本站 upload URL → 直接现有 `POST /api/assets/mine`。  
3. `blob:` → 保持现状警告，不 persist。

## 5. 数据模型

不强制新表。约定：

1. **`UserAsset.url`：** 持久化后存 `persistedUrl`（`@@unique([userId, url])` 随之指向 COS URL）。  
2. **`metadata` JSON**（向后兼容）可选字段：  
   - `storageTier: 'upstream' | 'upload' | 'persisted'`  
   - `upstreamUrl?` — 转存前原链  
   - `objectKey?` — Adapter key  
3. 节点（仅 `replaceNodeUrl=true`）：`data.storageTier`、`data.upstreamUrl` 可选写入。

**幂等：** 以最终 `persistedUrl` 做 upsert；`upstreamUrl` 留在 metadata 便于审计。若库中仍有旧 upstream 行，实现计划可定「同 upstream 再收藏时更新/替换」细则，避免双份混乱。

## 6. StorageAdapter

```ts
interface StorageAdapter {
  putStream(input: {
    key: string
    body: NodeJS.ReadableStream
    contentType: string
    contentLength?: number
  }): Promise<{ publicUrl: string }>
}
```

- Key 建议：`users/{userId}/assets/{yyyy}/{cuid}.{ext}`  
- 首个驱动：腾讯云 COS 或 S3 兼容（由 env 选择实现类）。  
- **未配置 → 503**，不得把 upstream URL 标成 `persisted`。

## 7. P0 补洞清单

| 项 | 预期 | 动作 |
|----|------|------|
| `stream-download` | 鉴权 + SSRF + 归属 | 回归测试绿；生产 smoke 一条 |
| `downloadMediaFile` | 无 `window.open` | 保持现有单测 |
| 外链 hint | 「第三方链接，可能过期，请及时下载」 | 节点/预览已有；Inspector 若缺则补 |
| 生成完成 toast | 「建议立即下载到本机保存」 | 缺则补 |
| Agent `downloadPath` | 指向 stream-download | 确认一致 |

P0 通过即标 **A3-P0 Done**。

## 8. 验收标准

1. upstream 媒体点「存入资产库」→ 资产库 URL 为 **persisted**，可再拖回画布使用。  
2. `/api/uploads/` 入库不强制转 COS。  
3. Adapter 未配置 → **503**，无假成功。  
4. `replaceNodeUrl=true` 时节点 url 变为 persisted，metadata/data 可保留 `upstreamUrl`。  
5. 同一逻辑幂等，不产生混乱双份。  
6. P0 补洞清单全过；默认生成仍不写 CVM/COS。  
7. Agent 存资产库（若启用）与 UI 同路径。

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| COS 未就绪阻塞 A2 | Adapter + 503；A2 仍可用 stream-download；M-A1 以导出为准，收藏为增强 |
| `userId+url` 唯一键随 URL 变化 | upsert 以 persistedUrl 为准；metadata 留 upstreamUrl |
| 大视频超时 | 200MB + 502；UI 提示 |
| A1 STS 双轨 | 强制共用本 Adapter |
| 误 persist 全部 save | 仅 upstream 走 persist |

## 10. 与 A2 / A1 的接口

- **A2：** 打包优先 `storageTier=persisted` 与本站 upload；其余走代理拉流。  
- **A1：** OSS STS 上传复用同一 `StorageAdapter`；本规格不实现 STS。

## 11. 实现节奏

1. 本规格入库。  
2. `writing-plans` → `docs/superpowers/plans/2026-09-10-wave-a-a3-media-persist.md`。  
3. 任务顺序建议：P0 扫漏 → Adapter 接口 + 未配置 503 → persist-remote service → 前端接线 → Agent 同路径 → 验收。

## 12. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-10 | 初稿：确认 StorageAdapter（C）、P0 补洞 + P2 主交付；对话批准 §1–§3 后入库 |
| 2026-09-10 | 实现完成：`OBJECT_STORAGE_*` 见 `apps/server/.env.example`；`persist-remote`、`saveAssetToLibrary` upstream 转存、Agent 同路径已落地 |
