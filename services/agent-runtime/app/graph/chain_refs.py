from __future__ import annotations

from typing import Any


def _nid(item: dict[str, Any] | None) -> str | None:
    if not item:
        return None
    n = item.get("node_id")
    return str(n) if n else None


def _find_role(by_key: dict[str, dict[str, Any]], chain: str, role: str) -> dict[str, Any] | None:
    for it in by_key.values():
        if str(it.get("chain") or "") == chain and str(it.get("role") or "") == role:
            return it
    return None


def build_chain_ref_order(
    *,
    item: dict[str, Any],
    by_key: dict[str, dict[str, Any]],
    plan_node_id: str | None,
) -> list[str]:
    """Build attach_refs order: plan → same-chain seed/turnaround → remaining depends_on."""
    out: list[str] = []
    if plan_node_id:
        out.append(str(plan_node_id))

    chain = item.get("chain")
    role = item.get("role")
    if chain in ("product", "model") and role in ("seed", "turnaround", "downstream"):
        seed = _find_role(by_key, str(chain), "seed")
        turn = _find_role(by_key, str(chain), "turnaround")
        if role == "turnaround":
            n = _nid(seed)
            if n and n not in out:
                out.append(n)
        elif role == "downstream":
            for peer in (seed, turn):
                n = _nid(peer)
                if n and n not in out:
                    out.append(n)
            for dep_key in item.get("depends_on") or []:
                dep = by_key.get(str(dep_key))
                n = _nid(dep)
                if n and n not in out:
                    out.append(n)
        return out

    for dep_key in item.get("depends_on") or []:
        dep = by_key.get(str(dep_key))
        n = _nid(dep)
        if n and n not in out:
            out.append(n)
    return out
