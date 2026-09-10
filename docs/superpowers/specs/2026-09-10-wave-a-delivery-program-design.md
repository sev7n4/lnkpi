# Wave A · 成片交付战役总纲领

> 日期：2026-09-10  
> 状态：已批准（对话确认 §1–§3）  
> 产品：超创平台（lnkpi）无限画布  
> 北极星：**成片导出成功率**  
> 策略来源：竞争力分析（NeoWOW / LibTV）→ Wave A「先闭环交付」

## 1. 背景与目标

赛道竞争已从「单段生成好看」转向「多镜成片能交付」。超创在 Agent↔画布 harness、Dock Studio、sceneComposer/合成上已接近 NeoWOW 骨架；相对 LibTV 等仍弱在交付闭环（下载/打包/持久化）与精修能力（upscale / lip-sync / STS）。

**Wave A 要证明的事：** 超创不只是「能在画布上生成」，而是「能稳定交得出去」。

**北极星指标：** 用户从画布选中媒体 → 成功拿到可离线保存的文件或压缩包，且不因第三方外链过期而失败（成片导出成功率）。

## 2. 范围

### 2.1 工作流清单（顺序锁定）

| 顺序 | ID | 名称 | 一句话 |
|------|-----|------|--------|
| 1 | **A3** | 媒体持久化 | 流式代理下载落地；收藏进 COS，减少外链过期 |
| 2 | **A2** | 导出打包 | 去掉「二期」禁用，人/Agent 都能打包下载 |
| 3 | **A1** | M4 交付能力 | OSS STS + upscale + lip-sync（**不含** worldModel） |
| 4 | **A4** | 角色主体库 v1 | 角色资产可锁定，跨节点 refs 复用 |
| 5 | **A5** | Agent dock 贯通 | 侧栏 model / skillId / 积分真正进 Runtime |

执行顺序：**A3 → A2 → A1 → A4 → A5**（与竞争力策略中的「C 序」一致）。

### 2.2 非目标（Wave A 明确不做）

- worldModel / PlayCanvas 重建 / 完整 3D 导演台  
- 对外 OpenClaw Skill 双入口（属 Wave B）  
- 实时多人共编、ComfyUI 插件市场  
- 与 Liblib 拼模型目录广度或价格补贴  
- 把生成物默认改成全部 rehost（默认仍可存 upstream；**收藏 / 关键交付物**才持久化）  
- `/技能名` 斜杠技能市场、多 Skill 并行编排（超出 A5 贯通范围）

## 3. 依赖与里程碑

### 3.1 依赖图

```
A3 媒体持久化 ──► A2 导出打包 ──► A1 M4（STS / upscale / lip-sync）
                                      │
                                      ▼
                              A4 角色主体库 v1
                                      │
                                      ▼
                              A5 Agent dock 贯通
```

| 顺序 | ID | 依赖原因 |
|------|-----|----------|
| 1 | A3 | 导出与收藏都需要可信下载/落库；仓内已有流式下载 plan/spec |
| 2 | A2 | `export_media_package` 后端/tool 已有，前端芯片仍禁用；依赖 A3，避免 zip 塞易过期外链 |
| 3 | A1 | OSS STS 是上传/高清链路底座；upscale/lip-sync 对标 Neo 精修 |
| 4 | A4 | 不挡「能导出」，挡「多镜一致」；接在交付闭环之后 |
| 5 | A5 | 不挡交付；打通后 Agent 与 Dock 参数同源 |

**弱并行：** A2 完成后，A4 与 A5 可部分并行开规格/实现；A1 的 upscale / lip-sync 可在 STS 契约冻结后分 PR。

### 3.2 验收切片（Done 定义）

| ID | 用户可感知验收 | 技术锚点（现有） |
|----|----------------|------------------|
| **A3** | 节点「下载」走鉴权流式代理；外链有过期提示；收藏写入 COS 且可再拖回画布 | `docs/superpowers/plans/2026-08-08-media-stream-download-p0.md`；`docs/superpowers/specs/2026-08-08-media-storage-download-deferred-design.md` |
| **A2** | 对话芯片「导出打包」可点；选中节点 → zip/清单 URL 可下；Agent `export_media_package` 同路径 | Nest `POST .../export-media-package`；前端 `disabled: true` /「导出打包（二期）」文案解除 |
| **A1** | 图可 upscale；视频可选 lip-sync；上传走 STS（非仅本地磁盘） | `docs/DOCK_STUDIO_E2E_TRACKING.md` M4 / B-2、B-4、B-5；**砍掉 worldModel** |
| **A4** | 可建角色主体并锁定；后续图/视频节点默认带该主体 refs | 现有 T*/I*/V*/A* refs 协议扩展（见 C2.1 / refs 相关规格），不新造第二套引用语法 |
| **A5** | 侧栏改 model/skill 后当轮 run 真用该值；积分展示与扣费一致 | Runtime 一期遗留；可对齐 `docs/superpowers/specs/2026-08-03-agent-phase-c2-dock-model-skillid-design.md` |

### 3.3 里程碑

| 里程碑 | 内容 | 建议周期 | 硬性 |
|--------|------|----------|------|
| **M-A1** | A3 + A2 合并验收 → 北极星可测 | 约 3–4 周 | **必须达成** |
| **M-A2** | A1：STS / upscale / lip-sync 可用 | 约 +3 周 | 可按资源裁剪，不得回退导出 |
| **M-A3** | A4 + A5 → Wave A 收口 | 约 +3–4 周 | 可按资源裁剪 |

Wave A 整体成功以 **M-A1** 为准；M-A2/M-A3 可伸缩，但不得回退「导出可用」。

## 4. 工作流边界

| ID | 做 | 不做 |
|----|----|------|
| **A3** | `stream-download` 鉴权代理；外链过期文案；「收藏到 COS」与再引用 | 默认把所有生成物 rehost；改生成主路径默认存储策略 |
| **A2** | 启用导出芯片；统一人/Agent 打包；zip 优先用已持久化或可代理 URL | 完整 NLE 时间线导出；跨 session 批量归档产品 |
| **A1** | OSS STS 上传；image upscale；video lip-sync（可选入口） | worldModel；任意新模型厂商大接入 |
| **A4** | 主体实体 + 锁定 + 写入现有 refs 芯片 | 自动角色一致性训练 / LoRA；全库智能检索 |
| **A5** | Conversation/run DTO 带 `model`/`skillId`；intake 认 skill；积分展示对齐 | `/技能名` 市场、多 Skill 并行编排 |

## 5. 全 Wave 共用原则

1. **画布真相源不变：** Nest `Session.canvasData`；Agent 只经 Tools，不全量镜像进 LangGraph State。  
2. **人机同路径：** 导出、下载、upscale、lip-sync 必须是 UI 与 Agent tool 打同一 Nest API。  
3. **存储分层：** 默认 upstream URL 可保留；**收藏 / 打包入选 / 主体封面** 必须可持久化（COS）。  
4. **能力可发现：** upscale / lip-sync / STS 走 capabilities 或明确 feature flag，避免 Dock 有按钮无后端。  
5. **子规格强制：** 每个 ID 单独  
   `docs/superpowers/specs/YYYY-MM-DD-wave-a-{a3|a2|a1|a4|a5}-*.md`，本纲领只管顺序与边界。  
6. **YAGNI：** 每项只交付 §4「做」列；「不做」列进 PR 描述 checklist。

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 外链在打包瞬间 403/过期 | A3 先落地；A2 zip 构建时经代理或已收藏 URL |
| OSS/COS 凭证与本机 upload 双轨混乱 | A1 STS 为唯一上传主路径；本地 upload 仅开发兜底 |
| lip-sync 供应商不稳定 | 入口标可选；失败可诊断；不挡 A2 验收 |
| A4 与现有 refs 协议冲突 | 只扩展 metadata/锁定标记，不新造引用语法 |
| A5 改 DTO 破坏旧客户端 | 字段可选 + 缺省保持现行为；先加契约测试 |
| 范围回潮到 worldModel / 双入口 | 本纲领 §2.2 非目标 + 子规格开门写 Non-goals |

## 7. 规格与实现节奏

1. **本规格**（Wave A 总纲领）批准并入库。  
2. 下一份子规格：**A3 媒体持久化**（优先复用/收敛已有 deferred + stream-download 文档，避免双真源）。  
3. 然后依次：A2 → A1 → A4 → A5（A4/A5 可并行开规格）。  
4. 每个子规格批准后：`writing-plans` → 实现 → 按 M-A* 验收。

### 7.1 相关已有文档（勿重复发明）

| 文档 | 与 Wave A 关系 |
|------|----------------|
| `docs/PRODUCT_CAPABILITY_MAP.md` | Neo 对标总表（部分 checkbox 可能过时） |
| `docs/NEOWOW_RESEARCH.md` | 竞品与差异化预留 |
| `docs/DOCK_STUDIO_E2E_TRACKING.md` | M4 / B-2 B-4 B-5 缺口 |
| `docs/superpowers/specs/2026-08-08-media-storage-download-deferred-design.md` | A3 存储/下载分期 |
| `docs/superpowers/plans/2026-08-08-media-stream-download-p0.md` | A3 流式下载实现计划 |
| `docs/superpowers/specs/2026-08-08-agent-canvas-control-surface-design.md` | `export_media_package` 等控制面 |
| `docs/superpowers/specs/2026-08-03-agent-phase-c2-dock-model-skillid-design.md` | A5 可对齐草案 |
| `docs/superpowers/specs/2026-07-23-agent-runtime-langgraph-design.md` | dock 一期非目标 / 二期遗留 |

## 8. 成功标准（收口检查清单）

- [ ] M-A1：流式下载 + 导出打包在生产可手测通过（人 + Agent 各一条路径）  
- [ ] 北极星：抽样会话导出失败率有基线，且较 Wave A 前下降（或首次可测）  
- [ ] A1（若交付）：STS 上传为主路径；upscale/lip-sync 有明确入口与失败诊断  
- [ ] A4（若交付）：至少一个角色主体可锁定并出现在下游 refs  
- [ ] A5（若交付）：改侧栏 model/skill 后 Runtime 日志/行为可证明生效  
- [ ] 无 worldModel / 对外 Skill 双入口误入本 Wave PR

## 9. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-10 | 初稿：对话确认 §1 目标边界、§2 依赖验收、§3 边界原则风险后入库 |
