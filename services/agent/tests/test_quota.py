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
