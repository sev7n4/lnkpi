from app.llm_thinking import (
    apply_agent_llm_thinking_policy,
    ensure_reasoning_content_roundtrip,
    is_deepseek_chat_model,
)
from app.runs import RunRequest, resolve_llm, resolve_vision_creds, default_llm
from langchain_core.messages import AIMessage
import langchain_openai.chat_models.base as oai_base


def test_resolve_llm_uses_default_when_no_override():
    req = RunRequest(session_id="s1", user_id="u1", message="hi")
    llm = resolve_llm(req)
    default = default_llm()
    assert llm.model_name == default.model_name


def test_resolve_llm_uses_override_credentials():
    req = RunRequest(
        session_id="s1",
        user_id="u1",
        message="hi",
        llm_model="gpt-test",
        llm_api_key="sk-test",
        llm_base_url="https://api.example/v1",
    )
    llm = resolve_llm(req)
    assert llm.model_name == "gpt-test"
    assert getattr(llm, "extra_body", None) in (None, {})


def test_resolve_vision_creds_returns_request_fields_without_settings_fallback():
    req = RunRequest(
        session_id="s1",
        user_id="u1",
        message="hi",
        llm_provider_ref="ch_byok::deepseek-flash",
        llm_model="deepseek-flash",
        llm_api_key="sk-byok",
        llm_base_url="https://api.byok.example/v1",
        llm_source="user",
    )
    assert resolve_vision_creds(req) == {
        "provider_ref": "ch_byok::deepseek-flash",
        "model": "deepseek-flash",
        "api_key": "sk-byok",
        "base_url": "https://api.byok.example/v1",
        "source": "user",
    }


def test_resolve_vision_creds_missing_fields_are_none_not_settings():
    req = RunRequest(session_id="s1", user_id="u1", message="hi")
    creds = resolve_vision_creds(req)
    assert creds == {
        "provider_ref": None,
        "model": None,
        "api_key": None,
        "base_url": None,
        "source": None,
    }


def test_is_deepseek_chat_model():
    assert is_deepseek_chat_model("deepseek-flash") is True
    assert is_deepseek_chat_model("ch_x::deepseek-v4-pro") is True
    assert is_deepseek_chat_model("deepseek-v3.2") is True
    assert is_deepseek_chat_model("gpt-4o") is False


def test_apply_agent_llm_thinking_policy_disables_deepseek_by_default():
    out = apply_agent_llm_thinking_policy(
        "deepseek-flash",
        {"model": "deepseek-flash", "temperature": 0.4},
    )
    assert out["extra_body"] == {"thinking": {"type": "disabled"}}
    assert "reasoning_effort" not in out


def test_apply_agent_llm_thinking_policy_enables_with_effort():
    out = apply_agent_llm_thinking_policy(
        "deepseek-v4-pro",
        {"model": "deepseek-v4-pro", "temperature": 0.4},
        thinking=True,
        thinking_effort="max",
    )
    assert out["extra_body"] == {"thinking": {"type": "enabled"}}
    assert out["reasoning_effort"] == "max"


def test_resolve_llm_disables_thinking_for_deepseek_override():
    req = RunRequest(
        session_id="s1",
        user_id="u1",
        message="请帮我导入这条工作流 @T1",
        llm_model="deepseek-flash",
        llm_api_key="sk-test",
        llm_base_url="https://api.deepseek.com",
    )
    llm = resolve_llm(req)
    assert llm.extra_body == {"thinking": {"type": "disabled"}}


def test_resolve_llm_enables_thinking_when_requested():
    req = RunRequest(
        session_id="s1",
        user_id="u1",
        message="hi",
        llm_model="deepseek-flash",
        llm_api_key="sk-test",
        llm_base_url="https://api.deepseek.com",
        thinking=True,
        thinking_effort="high",
    )
    llm = resolve_llm(req)
    assert llm.extra_body == {"thinking": {"type": "enabled"}}
    assert llm.reasoning_effort == "high"


def test_reasoning_content_roundtrip_patch():
    ensure_reasoning_content_roundtrip()
    msg = oai_base._convert_dict_to_message(
        {
            "role": "assistant",
            "content": "",
            "reasoning_content": "step-by-step",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "import_workflow", "arguments": "{}"},
                }
            ],
        }
    )
    assert isinstance(msg, AIMessage)
    assert msg.additional_kwargs.get("reasoning_content") == "step-by-step"
    payload = oai_base._convert_message_to_dict(msg)
    assert payload["reasoning_content"] == "step-by-step"
