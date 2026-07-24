from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_health_ok():
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_runs_requires_service_token():
    client = TestClient(app)
    r = client.post(
        "/v1/runs",
        json={
            "session_id": "s1",
            "user_id": "u1",
            "message": "hi",
        },
    )
    assert r.status_code == 401


def test_runs_rejects_wrong_service_token():
    client = TestClient(app)
    r = client.post(
        "/v1/runs",
        headers={"x-lnkpi-service-token": "wrong-token"},
        json={
            "session_id": "s1",
            "user_id": "u1",
            "message": "hi",
        },
    )
    assert r.status_code == 401
    assert settings.effective_runtime_auth_token != "wrong-token"
