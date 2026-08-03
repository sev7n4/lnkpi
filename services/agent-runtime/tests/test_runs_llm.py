from app.runs import RunRequest, resolve_llm, default_llm


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
