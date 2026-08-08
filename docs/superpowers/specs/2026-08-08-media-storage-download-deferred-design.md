# 生成媒体存储与下载 — 零 CVM 持久化方案（技术债）

> **状态**：**已确认**（2026-08-08）· **待排期实现**（技术债）  
> **Plan（P0）**：[2026-08-08-media-stream-download-p0.md](../plans/2026-08-08-media-stream-download-p0.md)  
> **触发**：画布节点「下载」实为 `window.open` 预览；生成图存 AI 平台 CDN 外链；用户**不希望**出图默认占用 lnkpi CVM 磁盘  
> **关联**：`apps/web/src/composables/useCanvasMedia.ts`、`apps/server/src/canvas/material.service.ts`、`docs/superpowers/specs/2026-07-19-c21-canvas-refs-design.md`

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 生成物默认落盘 | **否** — 节点 `data.url` 继续存 **AI 平台 / 上游 CDN 外链** |
| CVM `uploads/` | **仅**用户主动上传、侧栏参考、视频合成导出等**已有路径**；**生成完成不自动写入** |
| 下载 | **P0**：服务端 **流式代理**，不落盘；去掉 `window.open` 假下载 |
| 长期可靠 | **不承诺**；UI 提示链接可能过期；生成完成 toast 建议存本机 |
| img2img 参考图 | 稳定 refs 仍依赖用户 **上传到 `/api/uploads/`** 或 **收藏入库** |
| 用户显式持久化 | **P2**：「收藏 / 存入资产库」→ 异步转 **COS/R2**（不占 CVM） |
| 全量出图转 COS | **不做默认**；与「默认外链」冲突，降为 **P3 可选/付费** |
| OSS 生命周期 | **P3**：仅对 **已持久化（COS）** 对象；免费 7–30 天、付费更长 |

---

## 1. 方案冲突分析与消解

用户确认的条目里，表面冲突有两点：

### 冲突 A：「默认只存第三方 URL」 vs 「P1 新出图异步转 COS」

| 原表述 | 冲突点 |
| --- | --- |
| §1 节点只存第三方 `url` | 生成后 URL 指向 Apimart / 火山 / BYOK CDN |
| 优先级 P1「新出图异步转 COS」 | 生成后 URL 应变为 COS/CDN |

**消解（写入本 spec 的唯一定义）：**

```text
Phase 0–2（默认）     生成 → 仅存 upstream URL（现状增强）
Phase 2（P2）         用户点「收藏/入库」→ 异步 copy 到 COS → 资产库 + 可选回写节点 URL
Phase 3（P3，可选）   付费/设置项「生成即持久化到 COS」— 非默认，与 §1 并存为 opt-in
```

**结论**：无逻辑冲突，但 **P1 必须重定义为 P2（懒持久化）+ P3（可选全量持久化）**，不得与默认外链策略同时作为 P0 需求。

### 冲突 B：「不占 CVM」 vs 「img2img 走 /api/uploads/」

| 原表述 | 冲突点 |
| --- | --- |
| 不占 lnkpi 服务器资源 | 用户上传仍进 CVM `uploads/` |
| img2img 参考图要稳定 | 历史上传走 `/api/uploads/` |

**消解：**

- **生成物**：不占 CVM（外链 + 可选 COS 懒持久化）。
- **用户上传 / 侧栏附件**：**允许**继续 CVM `uploads/`（体量可控、已是同源稳定 refs）；后续可 **独立迁移** 到 COS，**不在本 spec 默认范围**。
- img2img 文案引导：「参考图请先上传或从资产库选择（已入库）」，不承诺第三方 CDN 作 refs 长期有效。

### 冲突 C：「按需代理不落盘」 vs 「打包 ZIP」

**消解**：ZIP 采用 **流式打包**（archiver pipe 到 response），**不写** CVM 临时文件；单文件超限或外链失效则 skip 并写入 manifest 错误项。

---

## 2. 现状（As-Is）

### 2.1 生成链路

```typescript
// material.service.ts — 出图成功后
const { url } = await provider.generate(...)
// url 原样写入 Material.url 与 canvasData 节点 data.url
```

文件物理位置：**上游 AI 平台 / 聚合商 CDN**，不在 lnkpi CVM。

### 2.2 下载链路

```typescript
// useCanvasMedia.ts
fetch(url) → blob → <a download>
catch → window.open(url)  // 用户感知「打开链接、无法下载」
```

跨域 CDN 导致 `fetch` 常失败 → 退化预览。

### 2.3 已有 rehost（例外）

| 场景 | 存储 |
| --- | --- |
| 用户手动上传 | CVM `/api/uploads/{userId}/` |
| 视频合成导出 | `uploadService.saveUserFile` → CVM |

---

## 3. 目标架构（To-Be）

```text
                    ┌─────────────────────────────────────┐
                    │           用户浏览器 / 画布           │
                    └──────────────┬──────────────────────┘
                                   │
          生成完成                  │ 点「下载」
          (默认)                    │
                    ┌──────────────▼──────────────────────┐
                    │         lnkpi API (CVM)              │
                    │  · 不写生成图到磁盘                   │
                    │  · GET /media/stream-download        │
                    │    → 拉 upstream → pipe 响应         │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
     AI 平台 CDN URL      用户上传 /api/uploads/    COS/R2（仅 P2+）
     (默认节点 url)       (refs 稳定)              (收藏/ opt-in)
```

### 3.1 节点 URL 状态机

| 状态 | `data.url` 示例 | 何时 |
| --- | --- | --- |
| `upstream` | `https://*.volces.com/...` | 生成完成默认 |
| `upload` | `/api/uploads/...` | 用户上传 / 侧栏附件 |
| `persisted` | `https://cdn.example.com/...` 或 COS 域名 | 收藏入库 / P3 opt-in |

可选字段（二期）：`storageTier: 'upstream' | 'upload' | 'persisted'`、`upstreamExpiresAt?`。

---

## 4. 分阶段交付（优先级）

### P0 — 下载与提示（不改存储策略）【技术债首选】

**后端**

- 新增 `GET /api/media/stream-download`
  - Query：`url`（必填）、`filename`（可选）
  - 鉴权：`AuthGuard`；校验 URL 属于 **允许域 allowlist**（平台 CDN 模式 + 本站 `/api/uploads/`）或 **节点/session 归属**（该 URL 出现在用户 session 的 canvasData / Material）
  - SSRF：复用 `assertSafeOutboundUrl`；拒绝内网/metadata
  - 响应：`Content-Disposition: attachment`；`Content-Type` 透传或 sniff；**流式 pipe**，不写磁盘
  - 体积上限：如 200MB；超限 413
  - 外链 4xx/5xx：502 + 可读 message

**前端**

- `downloadMediaFile`：改调 `/api/media/stream-download?url=&filename=`（或 POST body 避免 URL 长度）
- **删除** `window.open` 下载兜底；失败 `ElMessage.warning`
- `triggerDownload`：`revokeObjectURL` 延迟 ~1s
- 节点 / 预览层：外链资源角标或 tooltip「第三方链接，可能过期，请及时下载」
- 生成完成 toast（已有 success 文案处追加）：「建议立即下载到本机保存」

**验收**

- 生成图（upstream URL）点击下载 → 浏览器保存文件，非新标签预览
- 失败时有明确提示，非静默 `window.open`

---

### P2 — 懒持久化（收藏 / 资产库）【替代原 P1「全量出图转 COS」】

**触发**：用户点击节点或预览「存入资产库 / 收藏」。

**流程**

```text
用户点收藏
  → POST /api/assets/persist-remote { url, kind, label, sessionId?, nodeId? }
  → 后端流式 fetch upstream → 流式 write COS/R2（仍不占 CVM 磁盘）
  → 返回 persistedUrl
  → 资产库条目 + 可选「替换节点 url 为 persistedUrl」
```

**默认**：生成 **不** 触发此流程。

**与 §1 关系**：仅用户显式动作才脱离 upstream；符合「不占 CVM、默认外链」。

---

### P3 — 可选增强（排期靠后）

| 项 | 说明 |
| --- | --- |
| 生成即持久化（opt-in） | 用户设置 / 付费档位：出图成功后 **异步** copy COS，节点 url 最终切 persisted；**非默认** |
| OSS 生命周期 | 仅 `persisted` 对象：免费 7–30 天自动删；付费延长；upstream 不管理 |
| 批量 ZIP 下载 | 多选 → 流式 ZIP proxy；失败项写 `errors[]` |
| 用户上传迁 COS | 将 `/api/uploads/` 迁至 COS，进一步释放 CVM；**独立项目** |

---

## 5. API 草案

### `GET /api/media/stream-download`

| 参数 | 说明 |
| --- | --- |
| `url` | 待下载绝对 URL 或本站 `/api/uploads/...`（需 resolve 公网） |
| `filename` | 建议文件名 |

响应头：`Content-Disposition: attachment; filename*=UTF-8''...`

错误：`400` SSRF/非法域；`403` 非本 session 资源；`502` upstream 失败；`413` 过大

### `POST /api/assets/persist-remote`（P2）

Body：`{ url, kind, label?, sessionId?, nodeId?, replaceNodeUrl?: boolean }`  
Response：`{ persistedUrl, assetId }`

---

## 6. 安全与成本

| 风险 | 缓解 |
| --- | --- |
| SSRF | allowlist + `assertSafeOutboundUrl` |
| 滥用代理带宽 | 鉴权 + 每用户 rate limit + 体积上限 |
| 下载他人 URL | 校验 url 出现在该用户 session/material 中 |
| 大视频 | 单独限额或仅 persisted 允许 |

---

## 7. 非范围（一期不做）

- 天猫 / 电商页一键导入
- 生成默认 rehost 到 CVM `uploads/`
- 无鉴权公开 proxy
- 保证 upstream 链接永久有效

---

## 8. 与现有 PR / 代码关系

| 已有 | 本 spec |
| --- | --- |
| #171 批量 intake / thread bootstrap | 不冲突 |
| `resolveMediaUrl` / `resolvePublicMediaUrls` | P0 proxy 下载 refs 时需统一 resolve |
| `saveAssetToLibrary`（当前存 url 字符串） | P2 扩展为 persist-remote + COS |
| 视频合成 `saveUserFile` | 保留；后续可迁 COS |

---

## 9. 验收标准（上线时）

1. 默认生成图仍为 upstream URL，CVM `uploads/` 不增加生成物文件  
2. upstream 图点击下载 → 经 proxy 保存到本机，成功率显著高于现状  
3. UI 对外链有过期提示；生成完成有「建议下载」toast  
4. 收藏后资产库为 COS persisted URL，可稳定下载与 img2img（若用户选择替换节点 url）  
5. img2img 文档/提示：参考图优先上传或已入库资产  

---

## 10. 排期建议

| 阶段 | 工作量粗估 | 依赖 |
| --- | --- | --- |
| P0 | 2–3d | 无 |
| P2 | 3–5d | COS/R2 账号、IAM、CDN 域名 |
| P3 | 按需 | P2 基础设施 |

**建议**：先 **P0** 改善下载体验；P2 与 COS 开通一并排期；P3 按产品档位迭代。

---

## 11. 变更记录

| 日期 | 说明 |
| --- | --- |
| 2026-08-08 | 初稿：确认零 CVM 默认策略；消解 P1 全量 COS 与默认外链冲突；标为技术债 |
