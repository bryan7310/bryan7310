"""回測：用歷史日線模擬每月再平衡，並和買進持有 SPY 比較。

用法：
  python3 backtest.py                # 從 Alpaca 抓資料（需 API key）
  python3 backtest.py --csv prices.csv   # 用自備 CSV（第一欄日期，其餘欄為各代號收盤價）
"""
from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from strategy import StrategyConfig, target_weights


def run(closes: pd.DataFrame, cfg: StrategyConfig, cost_bps: float = 5.0) -> pd.DataFrame:
    rets = closes.pct_change().fillna(0.0)
    start = max(cfg.lookback_days, cfg.sma_days) + 1
    month_ends = set(closes.index.to_series().groupby(closes.index.to_period("M")).max())
    weights = pd.Series(0.0, index=closes.columns)
    equity, rows = 1.0, []
    for i in range(start, len(closes)):
        day = closes.index[i]
        equity *= 1 + float((weights * rets.iloc[i]).sum())
        if day in month_ends:  # 月底收盤後依當日資料決定下月配置
            new = pd.Series(target_weights(closes.iloc[: i + 1], cfg)).reindex(closes.columns).fillna(0.0)
            equity *= 1 - (new - weights).abs().sum() * cost_bps / 1e4
            weights = new
        rows.append((day, equity))
    return pd.DataFrame(rows, columns=["date", "equity"]).set_index("date")


def stats(eq: pd.Series) -> dict:
    years = (eq.index[-1] - eq.index[0]).days / 365.25
    daily = eq.pct_change().dropna()
    return {
        "總報酬": f"{eq.iloc[-1] / eq.iloc[0] - 1:.1%}",
        "年化報酬": f"{(eq.iloc[-1] / eq.iloc[0]) ** (1 / years) - 1:.1%}",
        "年化波動": f"{daily.std() * np.sqrt(252):.1%}",
        "夏普值": f"{daily.mean() / daily.std() * np.sqrt(252):.2f}" if daily.std() else "n/a",
        "最大回撤": f"{(eq / eq.cummax() - 1).min():.1%}",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--days", type=int, default=2500)
    args = ap.parse_args()
    cfg = StrategyConfig()
    symbols = sorted(set(cfg.universe) | {cfg.safe_asset})
    if args.csv:
        closes = pd.read_csv(args.csv, index_col=0, parse_dates=True)
    else:
        from alpaca_client import AlpacaClient
        closes = AlpacaClient().daily_closes(symbols, days=args.days)
    closes = closes.dropna()
    eq = run(closes, cfg)["equity"]
    spy = closes["SPY"].loc[eq.index]
    print(f"期間：{eq.index[0].date()} ~ {eq.index[-1].date()}")
    print(pd.DataFrame({"動能輪動": stats(eq), "買進持有 SPY": stats(spy)}).to_string())


if __name__ == "__main__":
    main()
