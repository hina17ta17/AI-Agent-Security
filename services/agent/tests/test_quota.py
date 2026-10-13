"""The limit decisions for demo (daily + lifetime) and BYOK (owner-set, or unlimited)."""
from app.store import Store

r = Store.quota_reason


def test_demo_daily_and_lifetime_caps():
    # 3 per day, 10 ever. Under both -> allowed.
    assert r(daily_used=0, total_used=0, global_used=0, daily_limit=3, total_limit=10, global_limit=100) is None
    assert r(daily_used=2, total_used=5, global_used=0, daily_limit=3, total_limit=10, global_limit=100) is None
    # Hit the daily cap first.
    assert r(daily_used=3, total_used=5, global_used=0, daily_limit=3, total_limit=10, global_limit=100) == "daily"
    # Under daily but at the lifetime cap.
    assert r(daily_used=0, total_used=10, global_used=0, daily_limit=3, total_limit=10, global_limit=100) == "total"
    # Project-wide cap.
    assert r(daily_used=0, total_used=0, global_used=100, daily_limit=3, total_limit=10, global_limit=100) == "global"


def test_byok_owner_set_limit():
    assert r(daily_used=49, total_used=0, global_used=0, daily_limit=50, total_limit=None, global_limit=None) is None
    assert r(daily_used=50, total_used=0, global_used=0, daily_limit=50, total_limit=None, global_limit=None) == "daily"


def test_byok_unlimited_never_refuses():
    assert r(daily_used=10_000, total_used=0, global_used=0,
             daily_limit=None, total_limit=None, global_limit=None) is None


# --- Which caps apply to which account (pipeline.quota_limits).
import dataclasses

from app.config import get_settings
from app.pipeline import quota_limits


def _s(**kw):
    return dataclasses.replace(get_settings(), self_tenant_id="self-uid", self_daily_limit=100,
                               demo_daily_limit_per_tenant=3, demo_total_limit_per_tenant=10,
                               demo_daily_limit_global=300, byok_daily_limit_per_tenant=200, **kw)


def test_a_demo_user_gets_3_a_day_and_10_ever():
    assert quota_limits(_s(), "user-1", {"aiMode": "demo"}) == (3, 10, 300)


def test_agentguard_itself_has_its_own_daily_budget_and_no_lifetime_cap():
    # Before, AgentGuard's own account fell under the demo user caps (3 a day, 10 ever).
    assert quota_limits(_s(), "self-uid", {"aiMode": "demo"}) == (100, None, None)


def test_operator_override_and_byok_choices():
    assert quota_limits(_s(), "judge", {"aiMode": "demo", "quotaOverride": {"demo": 50}}) == (50, None, 300)
    assert quota_limits(_s(), "u", {"aiMode": "byok"}) == (200, None, None)
    assert quota_limits(_s(), "u", {"aiMode": "byok", "byokDailyLimit": 30}) == (30, None, None)
    assert quota_limits(_s(), "u", {"aiMode": "byok", "byokDailyLimit": None}) == (None, None, None)
