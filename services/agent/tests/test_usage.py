"""Per-model token accounting used for the dashboard's cost display."""

from types import SimpleNamespace

from app.context import Usage, price_for


def meta(prompt, out, thoughts=None):
    return SimpleNamespace(prompt_token_count=prompt, candidates_token_count=out, thoughts_token_count=thoughts)


def test_prices_match_model_prefix():
    assert price_for("gemini-3.5-flash-lite-001") == (0.30, 2.50)
    assert price_for("gemini-3.8-flash") == (0.75, 3.75)
    assert price_for(None) == (0.75, 3.75)


def test_usage_sums_per_model_and_bills_thoughts_as_output():
    u = Usage()
    u.add(meta(1_000_000, 0), "gemini-3.5-flash-lite")
    u.add(meta(0, 500_000, 500_000), "gemini-3.8-flash")
    u.add(None, "gemini-3.8-flash")
    assert u.input_tokens == 1_000_000 and u.output_tokens == 1_000_000
    assert u.cost_usd() == round(0.30 + 3.75, 6)
    assert u.by_model["gemini-3.8-flash"]["outputTokens"] == 1_000_000
