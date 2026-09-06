from app.graph.post_cancel import (
    build_revise_turn_command,
    classify_post_cancel_intent,
    revise_state_clear_for_phase,
)


def classify(
    message: str,
    *,
    next_nodes: list[str] | None = None,
    user_decision: str | None = None,
    run_cancelled: bool = True,
    phase: str | None = "cancelled",
):
    return classify_post_cancel_intent(
        message,
        next_nodes=next_nodes or [],
        user_decision=user_decision,
        run_cancelled=run_cancelled,
        phase=phase,
    )


def test_new_task_chip_has_highest_priority():
    assert classify("__new_task__", next_nodes=["await_shot_topo_confirm"]) == "new_task"


def test_gate_resume_after_cancel():
    assert classify("确认出图", next_nodes=["await_shot_topo_confirm"]) == "gate_resume"


def test_gate_resume_for_explicit_user_decision():
    assert (
        classify(
            "继续",
            next_nodes=["await_shot_topo_confirm"],
            user_decision="confirm_gen",
        )
        == "gate_resume"
    )


def test_revise_phrase():
    assert classify("换成白底风格") == "revise"


def test_explicit_new_task_phrase_wins_over_revise_phrase():
    assert classify("重新做另一套，换成白底风格") == "new_task"


def test_long_ref_is_new_task():
    msg = "请用 @I1 帮我做另一套耳机主图方案并出白底图"
    assert classify(msg) == "new_task"


def test_long_free_form_request_is_new_task():
    assert classify("请帮这个产品设计一个面向户外场景的完整广告方案") == "new_task"


def test_short_non_revise_message_is_new_task():
    assert classify("做海报") == "new_task"


def test_not_post_cancel_returns_none():
    assert classify("你好", run_cancelled=False, phase="done") is None


def test_cancelled_phase_is_enough_to_classify():
    assert classify("换成白底", run_cancelled=False, phase="cancelled") == "revise"


def test_revise_clear_generating_keeps_macro_and_shot_but_clears_gen():
    clear = revise_state_clear_for_phase("orchestrate_gen")

    assert clear["gen_completed_keys"] is None
    assert clear["gen_by_key"] is None
    assert clear["gen_progress_id"] is None
    assert clear["delivery_selections"] is None
    assert "selected_macro_scheme_ids" not in clear
    assert "macro_schemes" not in clear
    assert "shot_manifest" not in clear


def test_revise_clear_shot_phase_keeps_macro_selection_and_clears_shot():
    clear = revise_state_clear_for_phase("await_shot_topo_confirm")

    assert clear["shot_manifest"] is None
    assert clear["delivery_selections"] is None
    assert clear["gen_completed_keys"] is None
    assert "selected_macro_scheme_ids" not in clear
    assert "macro_schemes" not in clear


def test_revise_clear_macro_phase_keeps_draft_and_clears_selection_downstream():
    clear = revise_state_clear_for_phase("await_macro_scheme_select")

    assert clear["selected_macro_scheme_ids"] is None
    assert clear["shot_manifest"] is None
    assert clear["delivery_selections"] is None
    assert "macro_schemes" not in clear


def test_revise_clear_image_qa_phase_clears_qa_and_downstream():
    clear = revise_state_clear_for_phase("await_image_qa")

    assert clear["image_qa_decision"] is None
    assert clear["retake_pending"] is None
    assert clear["macro_schemes"] is None
    assert clear["shot_manifest"] is None


def test_build_revise_turn_command_jumps_to_intake_with_clear_and_update():
    command = build_revise_turn_command(
        phase_hint="orchestrate_gen",
        update={"effective_utterance": "换成白底"},
    )

    assert command.goto == "intake"
    assert command.update["gen_completed_keys"] is None
    assert command.update["run_cancelled"] is None
    assert command.update["cancel_reason"] is None
    assert command.update["phase"] is None
    assert command.update["effective_utterance"] == "换成白底"
