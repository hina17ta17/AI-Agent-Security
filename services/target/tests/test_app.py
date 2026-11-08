"""Basic service tests. The request-flow tests live in test_ingest.py (the ingest endpoint)."""

from fastapi.testclient import TestClient

from app import main
from app.config import Settings


def client():
    main.app.state.settings = Settings(
        project_id="test", events_topic="t", dashboard_sa="sa-dashboard@test.iam.gserviceaccount.com",
        sim_audience="https://target.test",
    )
    # These endpoints never touch the database, Pub/Sub or token checks. Placeholders keep
    # startup from creating real Google Cloud clients, so the tests run without credentials (CI).
    main.app.state.store = object()
    main.app.state.publisher = object()
    main.app.state.verifier = object()
    return TestClient(main.app)


def test_health_ok():
    with client() as c:
        r = c.get("/health")
        assert r.status_code == 200 and r.json() == {"ok": True}


def test_root_describes_the_service():
    with client() as c:
        r = c.get("/")
        assert r.status_code == 200
        assert "AgentGuard" in r.text


def test_the_demo_shop_path_is_gone():
    with client() as c:
        assert c.get("/s/demosite01/").status_code == 404
