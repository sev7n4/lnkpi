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
        items = [dict(i) for i in (state.get("atomic_items") or []) if isinstance(i, dict)]
        if not items:
            node_id = str(state.get("atomic_node_id") or "").strip()
            spec = state.get("atomic_spec") or {}
            if node_id:
                items = [{**spec, "node_id": node_id}]

        if not items:
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

        completed: list[str] = []
        failed: list[str] = []
        last_record_id: str | None = None
        last_completion_summary: str | None = None
        last_error: str | None = None

        for item in items:
            node_id = str(item.get("node_id") or state.get("atomic_node_id") or "").strip()
            target_type = str(item.get("target_type") or "image")
            title = str(item.get("title") or target_type)
            if not node_id:
                failed.append(title)
                last_error = "missing atomic_node_id"
                continue

            run = runners.get(target_type)
            if run is None:
                failed.append(title)
                last_error = f"unsupported target_type: {target_type}"
                continue

            try:
                result = await run(node_id)
            except Exception as exc:  # noqa: BLE001
                failed.append(title)
                last_error = str(exc)
                continue

            record_id = _result_record_id(result)
            if record_id:
                last_record_id = record_id

            if isinstance(result, dict) and result.get("completionSummary"):
                last_completion_summary = str(result["completionSummary"])

            if _is_success(result):
                completed.append(title)
            else:
                status = str(result.get("status") or "error") if isinstance(result, dict) else "error"
                failed.append(title)
                last_error = status

        if completed and not failed:
            if len(completed) == 1:
                msg = f"「{completed[0]}」生成完成。"
            else:
                msg = f"已完成 {len(completed)} 张：{'、'.join(completed)}。"
            if last_completion_summary:
                msg += last_completion_summary
            elif last_record_id:
                msg += f"（record: {last_record_id}）"
            return {
                "phase": "done",
                "atomic_record_id": last_record_id,
                "messages": [AIMessage(content=msg)],
            }

        if completed and failed:
            msg = f"部分完成：{'、'.join(completed)}；未完成：{'、'.join(failed)}。"
            return {
                "phase": "error",
                "atomic_record_id": last_record_id,
                "last_error": last_error,
                "messages": [AIMessage(content=msg)],
            }

        title = str(items[0].get("title") or items[0].get("target_type") or "节点")
        status = last_error or "error"
        return {
            "phase": "error",
            "atomic_record_id": last_record_id,
            "last_error": status,
            "messages": [AIMessage(content=f"「{title}」生成未完成（{status}）。")],
        }

    return run_atomic_gen
