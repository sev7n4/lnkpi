# 工作流导入落点（空白区 + 视口对准）设计

> 日期：2026-09-12  
> 状态：已批准（对话确认方案 **C**）  
> 产品：超创平台（lnkpi）无限画布  
> 上级规格：[2026-09-12-canvas-workflow-exchange-design.md](./2026-09-12-canvas-workflow-exchange-design.md)  
> 背景：W1 导入合并仅对根节点做固定 `(+80,+80)`，易与当前画布/视口重叠遮挡  

## 1. 背景与目标

当前 `importWorkflowPackage` → `toMergeNodes` 对每个**根节点**施加常量 `IMPORT_POSITION_OFFSET = 80`，分组子节点保留相对坐标。规格只保证 ID remap 与合并进当前画布，**未**定义避障与视口行为。

**目标：** 导入子图以**整包统一平移**落到空白区，尽量不遮挡当前视口内容；导入后视口对准新块。

**非目标：**

- 打散或重排导入拓扑（边相对关系须保持）
- 修改分组子节点相对坐标 / `extent`
- 新建 session / 替换整布（仍为 merge）
- 精确像素级与真实 DOM 尺寸碰撞（可用固定估算宽高）

## 2. 产品规则（方案 C）

1. **优先**在当前视口 flow 矩形内找空白（右侧 → 下方）。  
2. 若与已有内容或视口占用冲突，按步长外推；仍失败则落到**视口右外侧**，再与画布包围盒碰撞外推。  
3. 合并完成后对**本次导入节点**做短动画 `fitView`（padding ≈ 0.2）。

## 3. 算法

### 3.1 包围盒

- **根节点**：无 `parentNode` / `parentId`（或父 id 不在本子图内）的节点。  
- **估算尺寸**：默认 `W=280, H=180`（可常量；group 可用更大宽高如 `320×240`，YAGNI 可先统一）。  
- `importBBox`：导入图根节点 `position` + 估算尺寸的并集。  
- `canvasBBox`：当前画布根节点同规则；空画布 → 无障碍（可把导入放在视口中心偏右下，或原点附近视口内空白）。  
- `viewBBox`：由 Vue Flow `getViewport()`（`x,y,zoom`）与画布容器像素尺寸换算：

```text
flowX = (-viewport.x) / zoom
flowY = (-viewport.y) / zoom
flowW = containerWidth / zoom
flowH = containerHeight / zoom
```

（以仓库现有 Vue Flow 坐标系为准；实现时对照 `useVueFlow` 文档与现有 `setViewport` 用法校准一次。）

### 3.2 碰撞

矩形轴对齐相交即冲突。Margin `M = 64`：候选放置时，导入 bbox 外扩 M 再与 `canvasBBox` / 已占用区检测。

### 3.3 候选落点顺序

对「导入 bbox 左上角」求 `dx, dy`（整包平移量 = `targetTopLeft - importBBox.topLeft`）：

1. 视口内右侧：`import` 左缘贴 `view` 右缘内侧，或贴 `canvasBBox` 右缘 + M（取更不易撞的一侧试探）。  
2. 视口内下方：同理。  
3. 步长外推：`STEP = 120`，沿右/下各尝试有限次（如 12 次）。  
4. 回退：视口右外侧（`view.right + M`），再相对 `canvasBBox` 右/下外推直至无相交或达上限；上限仍冲突则采用「canvas 右下 + M」的最后候选（最差也比固定 +80 可控）。

空画布：优先视口中心附近偏右（仍做 fitView）。

### 3.4 应用与对准

1. 所有**根节点** `position += (dx, dy)`。  
2. 子节点坐标不变；`parentNode` / `extent` / `expandParent` 逻辑保持现状。  
3. `applyMerge` 之后：`fitView({ nodes: importedIds, padding: 0.2, duration: 300 })`（API 名以 `@vue-flow/core` 现用为准）。  
4. 若 `fitView` 不可用，退化为 `setViewport` 使导入 bbox 中心落入视口中心。

## 4. 接口与文件

| 位置 | 变更 |
|------|------|
| `apps/web/src/composables/useWorkflowExchange.ts` | 抽出 `computeImportTranslation` / `placeImportedNodes`；`toMergeNodes` 接受 `(dx,dy)` 或内部调用；删除仅 `+80` 的默认路径 |
| `ImportWorkflowPackageContext` | 增加可选 `getViewport` / `getContainerSize` / `fitImportedNodes(ids)`，由 `CanvasPage` 注入 |
| `apps/web/src/pages/CanvasPage.vue` | 导入时注入 viewport + fitView |
| `useWorkflowExchange.test.ts` | 单测：重叠 canvas 时 dx/dy 使 bbox 分离；空画布；子节点相对坐标不变；可选 mock fit 被调用 |

纯几何函数尽量无 DOM，便于 Vitest。

## 5. 验收

1. 当前画布中心已有节点时导入同源坐标包 → 新块与旧块轴对齐 bbox **不相交**（margin≥64）。  
2. 导入后视口可见新块主体（fitView / 等效对准）。  
3. 含 group 的包：子节点相对父仍正确；`extent`/`expandParent` 仍设置。  
4. 无回归：非法格式仍不 merge；媒体缺失仍 warning + 计数。

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 估算尺寸与真实节点差较大 | margin 64 + 步长外推；后续可接 `dimensions` |
| 坐标系符号搞反 | 单测用固定 viewport 夹具 + 手工一眼冒烟 |
| 超大导入图视口内永远放不下 | 规则允许落到视口外再 fitView |

## 7. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-12 | 初稿：对话选定方案 C 后入库 |
