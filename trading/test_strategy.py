import numpy as np
import pandas as pd

from backtest import run
from strategy import StrategyConfig, plan_orders, target_weights


def make_prices(drifts, n=300, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2022-01-03", periods=n)
    data = {s: 100 * np.exp(np.cumsum(d + rng.normal(0, 0.005, n))) for s, d in drifts.items()}
    return pd.DataFrame(data, index=idx)


def test_picks_strongest_uptrends():
    cfg = StrategyConfig(universe=["A", "B", "C", "D"], safe_asset="S", top_n=2)
    px = make_prices({"A": 0.002, "B": 0.001, "C": -0.001, "D": -0.002, "S": 0.0001})
    w = target_weights(px, cfg)
    assert set(w) == {"A", "B", "S"}  # 選 A、B；第 3 份額度上限外的部分進避險
    assert abs(sum(w.values()) - (1 - cfg.cash_buffer)) < 1e-9
    assert all(v <= cfg.max_weight + 1e-9 for k, v in w.items() if k != "S")


def test_all_down_goes_to_safe_asset():
    cfg = StrategyConfig(universe=["A", "B"], safe_asset="S")
    px = make_prices({"A": -0.002, "B": -0.001, "S": 0.0001})
    assert list(target_weights(px, cfg)) == ["S"]


def test_plan_orders_sells_first_and_closes_dropped():
    orders = plan_orders({"A": 0.5, "B": 0.48}, 10000, {"A": 2000, "C": 3000}, {})
    assert orders[0] == {"symbol": "C", "side": "sell", "close_all": True, "notional": 3000}
    assert [o["symbol"] for o in orders[1:]] == ["A", "B"]


def test_backtest_runs():
    cfg = StrategyConfig(universe=["A", "B", "C"], safe_asset="S", top_n=2)
    px = make_prices({"A": 0.001, "B": 0.0005, "C": -0.0005, "S": 0.0001}, n=600)
    eq = run(px, cfg)["equity"]
    assert len(eq) > 300 and eq.iloc[-1] > 0
