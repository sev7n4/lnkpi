# 文本 Thinking 开关与文本/图片超时

**日期：** 2026-07-20  
**状态：** 已批准  
**范围：** 文本 + 图片超时治理；不含视频异步

## 目标

1. DeepSeek V4 系文本默认关闭 thinking，避免非流式长 TTFB 触发前端超时。
2. Dock 提供「深度思考」开关；开启后可选 effort：`high` | `max`。
3. 按是否开启 thinking 使用不同前端超时；图片统一加长超时。
4. BYOK merge 使用当前渠道模型，且 merge 请求强制关 thinking。

## 非目标

- 视频异步化 / merge 挪入 `completeVideo` 后台（另案）。
- 全局流式 SSE。
- 非 DeepSeek 模型的 thinking UI。

## UI（TextDockPanel）

- 开关「深度思考」，默认关。
- 打开后显示 effort：`high`（默认）| `max`。
- 仅当当前 `textModel` 判定为 DeepSeek V4（`/(^|::|\/)deepseek-v4/i`）时显示。

## 数据与 API

- `node.data.textThinking?: boolean`（默认 false）
- `node.data.textThinkingEffort?: 'high' | 'max'`（开启时默认 high）
- `POST /studio/text/generate`、`POST /studio/prompt/generate` 可选：
  - `thinking?: boolean`
  - `thinkingEffort?: 'high' | 'max'`

## 上游映射（DeepSeek V4）

| UI | Body |
|----|------|
| 关 | `thinking: { type: "disabled" }` |
| 开 + high | `thinking: { type: "enabled" }`, `reasoning_effort: "high"` |
| 开 + max | `thinking: { type: "enabled" }`, `reasoning_effort: "max"` |

非 DeepSeek：不传上述字段。

## 超时（前端 axios）

| 请求 | 超时 |
|------|------|
| text / prompt，thinking 关 | 180s |
| text / prompt，thinking 开 | 300s |
| studio image / variation | 300s |
| canvas material generate-image | 300s |

## Merge

- `mergeRefsToPrompt` 传入当前生成用的渠道 `modelName`。
- merge 调用强制 thinking disabled（若走 DeepSeek）。

## 验收

- 默认关：DeepSeek 短文本不再轻易 90s 超时。
- 开 + high/max：参数正确，超时 300s。
- 非 DeepSeek：无开关、请求无 thinking 字段。
