"""動能輪動策略（純計算，不碰網路，方便測試與回測）。

規則（每月調整一次）：
1. 對候選 ETF 計算過去 N 個交易日的報酬率（動能）。
2. 只保留「收盤價高於 200 日均線」且動能 > 0 的標的（絕對動能過濾，避開空頭）。
3. 取動能最高的 TOP_N 檔，等權重持有。
4. 沒有標的通過時，資金放在避險標的（短天期美債 ETF）。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd


@dataclass
class StrategyConfig:
    universe: list[str] = field(
        default_factory=lambda: ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "GLD", "VNQ"]
    )
    safe_asset: str = "SHY"
    lookback_days: int = 126  # 約 6 個月
    sma_days: int = 200
    top_n: int = 3
    max_weight: float = 0.40  # 單一標的上限
    cash_buffer: float = 0.02  # 保留 2% 現金，避免下單金額不足


PRESETS = {
    # 穩健型：大類資產輪動，6 個月動能，持有 3 檔
    "conservative": StrategyConfig(),
    # 積極型：產業／成長型 ETF，3 個月動能，集中持有 2 檔
    "aggressive": StrategyConfig(
        universe=["QQQ", "SMH", "XLK", "XLC", "XLY", "XLF", "XLE", "XLV", "XLI", "IWM", "GLD"],
        lookback_days=63,
        top_n=2,
        max_weight=0.50,
    ),
}
PRESET_NAMES = {"conservative": "穩健型", "aggressive": "積極型"}


def get_config(name: str | None = None) -> StrategyConfig:
    """依名稱取策略設定；沒指定時讀環境變數 STRATEGY，預設穩健型。"""
    import os
    name = (name or os.environ.get("STRATEGY") or "conservative").strip().lower()
    if name not in PRESETS:
        raise SystemExit(f"未知策略 {name!r}，可用：{', '.join(PRESETS)}")
    return PRESETS[name]


def momentum_scores(closes: pd.DataFrame, cfg: StrategyConfig) -> pd.Series:
    """回傳每檔標的最新的動能分數；未通過過濾的為 NaN。"""
    need = max(cfg.lookback_days, cfg.sma_days) + 1
    if len(closes) < need:
        raise ValueError(f"歷史資料不足：需要 {need} 天，只有 {len(closes)} 天")
    last = closes.iloc[-1]
    mom = last / closes.iloc[-1 - cfg.lookback_days] - 1
    sma = closes.iloc[-cfg.sma_days:].mean()
    ok = (last > sma) & (mom > 0)
    return mom.where(ok)


def target_weights(closes: pd.DataFrame, cfg: StrategyConfig) -> dict[str, float]:
    """依最新資料算出目標權重（加總 = 1 - cash_buffer）。"""
    cols = [s for s in cfg.universe if s in closes.columns]
    scores = momentum_scores(closes[cols], cfg).dropna().sort_values(ascending=False)
    picks = list(scores.index[: cfg.top_n])
    investable = 1.0 - cfg.cash_buffer

    weights: dict[str, float] = {}
    if picks:
        w = min(investable / cfg.top_n, cfg.max_weight)
        weights = {s: w for s in picks}
    # 沒選滿的部分放進避險標的
    rest = investable - sum(weights.values())
    if rest > 1e-9:
        weights[cfg.safe_asset] = weights.get(cfg.safe_asset, 0.0) + rest
    return weights


def plan_orders(
    weights: dict[str, float],
    equity: float,
    positions: dict[str, float],
    prices: dict[str, float],
    min_trade_usd: float = 50.0,
) -> list[dict]:
    """比較目標權重與目前持倉（市值），產生下單清單。先賣後買。

    positions: {代號: 目前市值(USD)}；prices: {代號: 最新價}
    回傳的 notional 為金額（Alpaca 支援零股金額下單）。
    """
    orders = []
    for sym in sorted(set(weights) | set(positions)):
        target = weights.get(sym, 0.0) * equity
        current = positions.get(sym, 0.0)
        diff = target - current
        if abs(diff) < min_trade_usd:
            continue
        if sym not in weights:  # 完全出清
            orders.append({"symbol": sym, "side": "sell", "close_all": True, "notional": round(current, 2)})
        else:
            orders.append({"symbol": sym, "side": "buy" if diff > 0 else "sell",
                           "close_all": False, "notional": round(abs(diff), 2)})
    orders.sort(key=lambda o: o["side"] != "sell")
    return orders
