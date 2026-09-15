from app.runs import RunRequest, resolve_llm, resolve_vision_creds, default_llm


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
