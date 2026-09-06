from app.run_cancel import clear_cancel, is_cancel_requested, peek_cancel_reason, request_cancel


def test_request_cancel_sets_flag():
    tid = "t-cancel-1"
    clear_cancel(tid)
    assert is_cancel_requested(tid) is False
    request_cancel(tid, reason="user")
    assert is_cancel_requested(tid) is True
    assert peek_cancel_reason(tid) == "user"
    clear_cancel(tid)
    assert is_cancel_requested(tid) is False


def test_request_cancel_idempotent():
    tid = "t-cancel-2"
    clear_cancel(tid)
    request_cancel(tid, reason="user")
    request_cancel(tid, reason="user")
    assert is_cancel_requested(tid) is True
    clear_cancel(tid)
