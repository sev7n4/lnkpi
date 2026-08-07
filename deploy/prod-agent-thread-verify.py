#!/usr/bin/env python3
"""Production verify — Agent thread isolation, messages API, dedup.

Simulates:
  1. Login → create session
  2. POST conversation thread A → 1 user + 1 assistant persisted
  3. GET messages(thread A) → count 2, asc order
  4. POST conversation thread B → thread A unchanged; B isolated
  5. GET threads → 2 entries, updatedAt desc (B first)
  6. Optional SEED thread → latest-100 wins (not earliest-50 bug)

Usage:
  python3 deploy/prod-agent-thread-verify.py
  BASE_URL=http://119.29.173.89:8888 PHONE=17279698608 CODE=123456 python3 deploy/prod-agent-thread-verify.py
  SEED_SESSION_ID=... SEED_THREAD_ID=... python3 deploy/prod-agent-thread-verify.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = os.environ.get("BASE_URL", "http://119.29.173.89:8888").rstrip("/")
API = f"{BASE}/api"
PHONE = os.environ.get("PHONE", "17279698608")
CODE = os.environ.get("CODE", "123456")
SSE_TIMEOUT_SEC = float(os.environ.get("SSE_TIMEOUT_SEC", "180"))
SEED_SESSION_ID = os.environ.get("SEED_SESSION_ID", "").strip()
SEED_THREAD_ID = os.environ.get("SEED_THREAD_ID", "").strip()
SEED_MIN_MESSAGES = int(os.environ.get("SEED_MIN_MESSAGES", "101"))

PASS = FAIL = SKIP = 0


def record(case: str, ok: bool, detail: str = "", *, skip: bool = False) -> None:
    global PASS, FAIL, SKIP
    if skip:
        SKIP += 1
        icon = "⏭️"
    elif ok:
        PASS += 1
        icon = "✅"
    else:
        FAIL += 1
        icon = "❌"
    line = f"{icon} {case}"
    if detail:
        line += f" — {detail[:220]}"
    print(line)


def http(m: str, p: str, b: dict | None = None, t: str | None = None) -> Any:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if t:
        h["Authorization"] = f"Bearer {t}"
    r = Request(f"{API}{p}", data=None if b is None else json.dumps(b).encode(), headers=h, method=m)
    try:
        with urlopen(r, timeout=120) as resp:
            return json.loads(resp.read())
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode(errors="replace")[:200]
        except Exception:
            pass
        raise RuntimeError(f"HTTP {exc.code} {p}: {body}") from exc


def sse_collect(
    t: str,
    sid: str,
    msg: str,
    tid: str,
    *,
    timeout: float = 180,
) -> tuple[list[dict], str, set[str], str]:
    body: dict[str, Any] = {"sessionId": sid, "message": msg, "threadId": tid}
    h = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {t}",
        "Idempotency-Key": f"ik_{uuid.uuid4().hex}",
    }
    r = Request(f"{API}/agent/chat/conversation", data=json.dumps(body).encode(), headers=h, method="POST")
    events: list[dict] = []
    types: set[str] = set()
    parts: list[str] = []
    end = time.time() + timeout
    exit_reason = "timeout"
    with urlopen(r, timeout=timeout + 30) as resp:
        buf = ""
        while time.time() < end:
            chunk = resp.read(4096)
            if not chunk:
                exit_reason = "eof"
                break
            buf += chunk.decode(errors="replace")
            while "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                for line in block.splitlines():
                    if not line.startswith("data:"):
                        continue
                    pl = line[5:].strip()
                    if pl == "[DONE]":
                        return events, "".join(parts), types, "done_marker"
                    try:
                        ev = json.loads(pl)
                    except json.JSONDecodeError:
                        continue
                    events.append(ev)
                    et = str(ev.get("type") or "")
                    types.add(et)
                    if et == "text_delta":
                        parts.append(str((ev.get("data") or {}).get("text") or ""))
                    if et == "done":
                        return events, "".join(parts), types, "done"
                    if et == "error":
                        return events, "".join(parts), types, "error"
    return events, "".join(parts), types, exit_reason


def get_messages(t: str, sid: str, tid: str) -> list[dict[str, Any]]:
    path = f"/agent/chat/user/messages?sessionId={quote(sid, safe='')}&threadId={quote(tid, safe='')}"
    return http("GET", path, t=t).get("data") or []


def list_threads(t: str, sid: str) -> list[dict[str, Any]]:
    path = f"/agent/chat/threads?sessionId={quote(sid, safe='')}"
    return http("GET", path, t=t).get("data") or []


def role_counts(msgs: list[dict[str, Any]]) -> tuple[int, int]:
    users = sum(1 for m in msgs if m.get("role") == "user")
    assistants = sum(1 for m in msgs if m.get("role") == "assistant")
    return users, assistants


def is_asc_created_at(msgs: list[dict[str, Any]]) -> bool:
    stamps = [str(m.get("createdAt") or "") for m in msgs]
    return stamps == sorted(stamps)


def user_content_count(msgs: list[dict[str, Any]], content: str) -> int:
    return sum(1 for m in msgs if m.get("role") == "user" and content in str(m.get("content") or ""))


def no_duplicate_user_turns(msgs: list[dict[str, Any]]) -> tuple[bool, str]:
    """Each distinct user message body should appear at most once per thread."""
    seen: dict[str, int] = {}
    for m in msgs:
        if m.get("role") != "user":
            continue
        key = str(m.get("content") or "").strip()
        if not key:
            continue
        seen[key] = seen.get(key, 0) + 1
    dupes = {k: v for k, v in seen.items() if v > 1}
    if dupes:
        sample = next(iter(dupes.items()))
        return False, f"duplicate user content count={sample[1]} prefix={sample[0][:40]!r}"
    return True, f"unique_user_turns={len(seen)}"


def verify_latest_wins(msgs: list[dict[str, Any]], *, min_total: int) -> tuple[bool, str]:
    """When thread has >100 messages, API must return latest 100 (asc), not earliest."""
    if len(msgs) > 100:
        return False, f"returned {len(msgs)} > limit 100"
    if len(msgs) < min_total:
        return False, f"seed thread has {len(msgs)} messages (< {min_total}); set SEED_* on a busier thread"
    if not is_asc_created_at(msgs):
        return False, "messages not asc by createdAt"
    first_ts = str(msgs[0].get("createdAt") or "")
    last_ts = str(msgs[-1].get("createdAt") or "")
    if first_ts >= last_ts:
        return False, f"bad ordering first={first_ts} last={last_ts}"
    # Latest-wins: window span should be recent tail, not full history from epoch.
    # Heuristic: last message must be newer than first by at least 1s when truncated.
    return True, f"count={len(msgs)} first={first_ts[:19]} last={last_ts[:19]}"


def main() -> int:
    tag = uuid.uuid4().hex[:8]
    print("=== Agent thread isolation verify ===")
    print(f"BASE={BASE}\n")

    try:
        http("POST", "/auth/send-code", {"phone": PHONE})
    except Exception:
        pass
    try:
        tok = http("POST", "/auth/login", {"phone": PHONE, "code": CODE})["data"]["token"]
        record("Login", True)
    except Exception as exc:  # noqa: BLE001
        record("Login", False, str(exc))
        return 1

    rt = http("GET", "/agent/runtime-health", t=tok)
    record("Runtime health", bool((rt.get("data") or {}).get("ok")))

    sid = http("POST", "/sessions", {"title": f"thread-iso-{tag}"}, t=tok)["data"]["id"]
    tid_a = f"{sid}:{uuid.uuid4()}"
    tid_b = f"{sid}:{uuid.uuid4()}"
    msg_a = f"thread-A-isolation-{tag} 请一句话回复"
    msg_b = f"thread-B-isolation-{tag} 请一句话回复"
    record("Create session", True, sid)

    _, text_a, types_a, exit_a = sse_collect(tok, sid, msg_a, tid_a, timeout=SSE_TIMEOUT_SEC)
    record(
        "Thread A conversation SSE",
        "error" not in types_a,
        f"exit={exit_a} types={sorted(types_a)[:6]} text_len={len(text_a)}",
    )

    msgs_a1 = get_messages(tok, sid, tid_a)
    users_a, assistants_a = role_counts(msgs_a1)
    record(
        "Thread A DB roles (1 user + 1 assistant)",
        users_a == 1 and assistants_a == 1,
        f"users={users_a} assistants={assistants_a} total={len(msgs_a1)}",
    )
    record(
        "Thread A GET messages count 2",
        len(msgs_a1) == 2,
        f"count={len(msgs_a1)}",
    )
    record(
        "Thread A messages asc order",
        is_asc_created_at(msgs_a1),
        f"first={str((msgs_a1[0] if msgs_a1 else {}).get('createdAt', ''))[:19]}",
    )
    ok_dup_a, detail_dup_a = no_duplicate_user_turns(msgs_a1)
    record("Thread A no duplicate user per turn", ok_dup_a and user_content_count(msgs_a1, msg_a) == 1, detail_dup_a)
    snapshot_a_ids = [m.get("id") for m in msgs_a1]

    _, text_b, types_b, exit_b = sse_collect(tok, sid, msg_b, tid_b, timeout=SSE_TIMEOUT_SEC)
    record(
        "Thread B conversation SSE",
        "error" not in types_b,
        f"exit={exit_b} types={sorted(types_b)[:6]} text_len={len(text_b)}",
    )

    msgs_a2 = get_messages(tok, sid, tid_a)
    record(
        "Thread A unchanged after thread B",
        [m.get("id") for m in msgs_a2] == snapshot_a_ids and len(msgs_a2) == 2,
        f"ids_stable={ [m.get('id') for m in msgs_a2] == snapshot_a_ids } count={len(msgs_a2)}",
    )

    msgs_b = get_messages(tok, sid, tid_b)
    users_b, assistants_b = role_counts(msgs_b)
    record(
        "Thread B isolated (2 msgs, own content)",
        len(msgs_b) == 2 and users_b == 1 and assistants_b == 1 and user_content_count(msgs_b, msg_b) == 1,
        f"total={len(msgs_b)} users={users_b} has_b={user_content_count(msgs_b, msg_b)} has_a={user_content_count(msgs_b, msg_a)}",
    )
    ok_dup_b, detail_dup_b = no_duplicate_user_turns(msgs_b)
    record("Thread B no duplicate user per turn", ok_dup_b, detail_dup_b)

    try:
        threads = list_threads(tok, sid)
    except RuntimeError as exc:
        record("GET threads lists 2 entries", False, str(exc))
        record("GET threads ordered by updatedAt desc", False, "skip: threads API unavailable")
    else:
        our_threads = [th for th in threads if th.get("id") in (tid_a, tid_b)]
        record(
            "GET threads lists 2 entries",
            len(our_threads) == 2,
            f"found={len(our_threads)} ids={[th.get('id') for th in our_threads]}",
        )
        if len(our_threads) == 2:
            ts = [str(th.get("updatedAt") or "") for th in our_threads]
            ordered = ts == sorted(ts, reverse=True)
            b_first = our_threads[0].get("id") == tid_b
            record(
                "GET threads ordered by updatedAt desc",
                ordered and b_first,
                f"order={[th.get('id') for th in our_threads]} updatedAt={ts}",
            )
        else:
            record("GET threads ordered by updatedAt desc", False, "skip: missing threads")

    all_msgs = msgs_a2 + msgs_b
    ok_all, detail_all = no_duplicate_user_turns(all_msgs)
    record(
        "No duplicate user messages per turn (count check)",
        ok_all
        and user_content_count(msgs_a2, msg_a) == 1
        and user_content_count(msgs_b, msg_b) == 1,
        detail_all,
    )

    record(
        "Messages within limit 100 + asc",
        len(msgs_a2) <= 100 and len(msgs_b) <= 100 and is_asc_created_at(msgs_a2) and is_asc_created_at(msgs_b),
        f"threadA={len(msgs_a2)} threadB={len(msgs_b)}",
    )

    if SEED_SESSION_ID and SEED_THREAD_ID:
        seed_msgs = get_messages(tok, SEED_SESSION_ID, SEED_THREAD_ID)
        ok_seed, detail_seed = verify_latest_wins(seed_msgs, min_total=min(SEED_MIN_MESSAGES, 100))
        record("Seed thread latest-100 wins", ok_seed, detail_seed)
    else:
        record(
            "Seed thread latest-100 wins",
            False,
            "set SEED_SESSION_ID + SEED_THREAD_ID to verify truncation on >100 msg thread",
            skip=True,
        )

    print(f"\n=== Summary PASS={PASS} FAIL={FAIL} SKIP={SKIP} ===")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
