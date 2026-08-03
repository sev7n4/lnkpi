"""P4: run Studio generation for one atomic-created node."""

from __future__ import annotations

from typing import Any, Callable

from langchain_core.messages import AIMessage


def _is_success(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    status = str(result.get("status") or "").lower()
    if status in ("completed", "success"):
        return True
    url = result.get("url")
    return isinstance(url, str) and bool(url.strip())


def _result_record_id(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    rid = result.get("generationRecordId")
    return str(rid) if rid else None


def make_run_atomic_gen_node(*, nest: Any) -> Callable:
    async def run_atomic_gen(state: dict) -> dict:
        node_id = str(state.get("atomic_node_id") or "").strip()
        spec = state.get("atomic_spec") or {}
        target_type = str(spec.get("target_type") or "image")
        title = str(spec.get("title") or target_type)

        if not node_id:
            return {
                "phase": "error",
                "last_error": "missing atomic_node_id",
                "messages": [AIMessage(content="缺少画布节点，无法生产。")],
            }

        runners = {
            "image": getattr(nest, "run_image_generation", None),
            "video": getattr(nest, "run_video_generation", None),
            "text": getattr(nest, "run_text_generation", None),
            "prompt": getattr(nest, "run_prompt_generation", None),
            "audio": getattr(nest, "run_audio_generation", None),
        }
        run = runners.get(target_type)
        if run is None:
            return {
                "phase": "error",
                "last_error": f"unsupported target_type: {target_type}",
                "messages": [AIMessage(content=f"暂不支持 {target_type} 模态生产。")],
            }

        try:
            result = await run(node_id)
        except Exception as exc:  # noqa: BLE001
            return {
                "phase": "error",
                "last_error": str(exc),
                "messages": [AIMessage(content=f"生成失败：{exc}")],
            }

        record_id = _result_record_id(result)
        if _is_success(result):
            msg = f"「{title}」生成完成。"
            if record_id:
                msg += f"（record: {record_id}）"
            return {
                "phase": "done",
                "atomic_record_id": record_id,
                "messages": [AIMessage(content=msg)],
            }

        status = str(result.get("status") or "error") if isinstance(result, dict) else "error"
        return {
            "phase": "error",
            "atomic_record_id": record_id,
            "last_error": status,
            "messages": [AIMessage(content=f"「{title}」生成未完成（{status}）。")],
        }

    return run_atomic_gen
