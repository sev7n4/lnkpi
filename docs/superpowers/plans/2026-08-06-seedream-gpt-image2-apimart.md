# Seedream 5.0 / GPT Image2 APIMart 补全 — 实施计划

> 规格：`docs/superpowers/specs/2026-08-06-seedream-gpt-image2-apimart-design.md`

## Task 1 — shared/imageModelProfiles

- 新增 `resolveImageModelProfile(modelKey, gatewayModelId)`
- 新增 `clampImageGenerationInput(profile, { n, resolution, refCount })`
- 导出 `ImageRefWire`, `ImageResponseMode`, `ImageModelProfile`
- 更新 `studioModelCatalog` gatewayModelId 与 params
- 测试：`imageModelProfiles.test.ts`

## Task 2 — generation-adapter

- `buildImageProviderOptions` 接受 `aspectRatio` + `resolution`
- 按 profile 设置 `refImageMode=native`、`nativeParams`、`responseMode`
- `providerReferenceImages` / `buildEffectiveImagePrompt` 覆盖 APIMart native
- 导出 `buildImageProviderRequestOptions(built)` 供 server/provider
- 测试更新 seedream/image2/agnes cases

## Task 3 — image-provider

- 扩展 `ImageGenerateOptions`（refWire, responseMode, resolution, quality, nativeParams）
- APIMart async：extract task_id → poll `/tasks/{id}` → urls
- APIMart refs：`image_urls`
- Agnes refs：`extra_body.image`（保持）
- 测试：async poll mock、image_urls body

## Task 4 — server

- `studio.service` / `material.service`：传 aspectRatio+resolution 给 adapter
- async 模型跳过 IMAGE_FAST_PATH_MS
- `completeImage` 传完整 provider options
- 平台回退：`refImageMode===native` 含 APIMart

## Task 5 — 验证

```bash
pnpm --filter @lnkpi/shared test
pnpm --filter @lnkpi/agent test
pnpm build
```
