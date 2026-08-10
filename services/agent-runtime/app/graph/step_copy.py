"""User-facing step labels for LangGraph node execution (SSE ``step`` / ``phase_hint``)."""

from __future__ import annotations

NODE_STEP_LABELS: dict[str, str] = {
    "intake": "理解你的需求",
    "chat": "日常对话",
    "decide_plan_mode": "判断任务类型",
    "write_plan_node": "拟定营销方案",
    "plan": "拟定营销方案",
    "await_confirm": "等待你确认方案",
    "split": "拆解画布任务",
    "draft_copy": "起草主文案",
    "await_copy_confirm": "等待你确认主文案",
    "await_topo": "等待你确认节点结构",
    "orchestrate_gen": "批量生成",
    "collect_gen": "汇总生成结果",
    "parse_atomic_intent": "解析创作意图",
    "clarify_gate": "澄清需求",
    "clarify_atomic_intent": "澄清创作需求",
    "create_atomic_node": "创建画布节点",
    "run_atomic_gen": "生成内容",
    "await_atomic_confirm": "等待你确认生成参数",
    "image_qa_check": "检查成图效果",
    "await_image_qa": "等待你确认成图效果",
    "plan_product_visual": "策划视觉方案",
    "await_scheme_select": "等待你选择变体",
    "split_product_visual_stub": "拆解视觉任务",
    "prepare_atomic_regenerate": "准备重新生成",
    "prepare_single_gen": "准备单节点生成",
    "run_single_gen": "单节点生成",
    "done": "完成",
}

PHASE_HINT_LABELS: dict[str, str] = {
    "await_confirm": "等待你确认方案",
    "await_copy_confirm": "等待你确认主文案",
    "await_topo": "等待你确认节点结构",
    "await_atomic_confirm": "等待你确认生成参数",
    "await_image_qa": "等待你确认成图效果",
    "await_scheme_select": "等待你选择变体",
    "atomic_confirm_gate": "等待你确认生成参数",
}


def step_label(node_name: str) -> str:
    return NODE_STEP_LABELS.get(node_name, "处理中")


def phase_hint_label(phase: str | None, gate_node: str | None = None) -> str | None:
    if phase and phase in PHASE_HINT_LABELS:
        return PHASE_HINT_LABELS[phase]
    if gate_node and gate_node in PHASE_HINT_LABELS:
        return PHASE_HINT_LABELS[gate_node]
    return None


def step_event(
    node_name: str,
    *,
    status: str,
    ms: int | None = None,
    detail: str | None = None,
) -> dict:
    data: dict = {
        "id": f"node:{node_name}",
        "kind": "phase",
        "label": step_label(node_name),
        "status": status,
    }
    if ms is not None:
        data["ms"] = ms
    if detail:
        data["detail"] = detail[:200]
    return {"type": "step", "data": data}


def phase_hint_event(*, phase: str | None, gate_node: str | None = None) -> dict | None:
    label = phase_hint_label(phase, gate_node)
    if not label:
        return None
    return {
        "type": "phase_hint",
        "data": {
            "phase": phase or gate_node,
            "label": label,
        },
    }
