"""Env flags for route LLM primary/shadow must honor LNKPI_ prefix."""

from __future__ import annotations

from app.config import Settings


def test_lnkpi_route_llm_primary_env(monkeypatch):
    monkeypatch.setenv("LNKPI_ROUTE_LLM_PRIMARY", "true")
    monkeypatch.delenv("LNKPI_ROUTE_LLM_SHADOW", raising=False)
    s = Settings()
    assert s.route_llm_primary is True
    assert s.route_llm_shadow is False


def test_lnkpi_route_llm_shadow_env(monkeypatch):
    monkeypatch.setenv("LNKPI_ROUTE_LLM_SHADOW", "true")
    monkeypatch.delenv("LNKPI_ROUTE_LLM_PRIMARY", raising=False)
    s = Settings()
    assert s.route_llm_shadow is True
    assert s.route_llm_primary is False
