# Task 11 — Campaign attach_edges

## Delivered

- Implemented `attach_edges` in `AgentCanvasToolsService.applySidebarAttachments`.
  - Existing canvas attachments reuse their source node IDs.
  - Sidebar image/media URLs become visible `mediaInput` nodes.
  - Sidebar text becomes completed text nodes.
  - Returned source node IDs preserve the requested reference order.
- Added the `apply_sidebar_refs` runtime node after campaign split.
  - The image seed receives visible reference edges.
  - If no image seed is available, attachments fall back to `localRefs` on the created nodes.
- Added regression coverage for the server materialization path and runtime campaign wiring.

## Verification

- `pnpm --filter @lnkpi/server test -- agent-canvas-tools.sidebar.test.ts`
- `python3 -m pytest tests/test_campaign_sidebar_refs.py tests/test_graph_plan_split.py tests/test_sidebar_attachments.py tests/test_atomic_sidebar_refs.py -v`
- `pnpm build`
