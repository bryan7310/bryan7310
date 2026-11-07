"""極簡 Alpaca REST 客戶端（只用 requests）。

安全設計：預設只連模擬帳戶 (paper)。要連真實帳戶必須同時設定
ALPACA_LIVE=1 且執行時加 --i-understand-real-money。
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

PAPER_URL = "https://paper-api.alpaca.markets"
LIVE_URL = "https://api.alpaca.markets"
DATA_URL = "https://data.alpaca.markets"


class AlpacaClient:
    def __init__(self, allow_live: bool = False):
        key = os.environ.get("ALPACA_API_KEY")
        secret = os.environ.get("ALPACA_API_SECRET")
        if not key or not secret:
            raise SystemExit("請先設定環境變數 ALPACA_API_KEY 與 ALPACA_API_SECRET（見 trading/README.md）")
        live = os.environ.get("ALPACA_LIVE") == "1"
        if live and not allow_live:
            raise SystemExit("ALPACA_LIVE=1 但沒有加 --i-understand-real-money，已停止。")
        self.live = live and allow_live
        self.base = LIVE_URL if self.live else PAPER_URL
        self.s = requests.Session()
        self.s.headers.update({"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret})

    def _get(self, url, **params):
        r = self.s.get(url, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def account(self) -> dict:
        return self._get(f"{self.base}/v2/account")

    def clock(self) -> dict:
        return self._get(f"{self.base}/v2/clock")

    def positions(self) -> dict[str, float]:
        """{代號: 市值}"""
        return {p["symbol"]: float(p["market_value"]) for p in self._get(f"{self.base}/v2/positions")}

    def open_orders(self) -> list:
        return self._get(f"{self.base}/v2/orders", status="open")

    def orders_since(self, after_iso: str) -> list:
        return self._get(f"{self.base}/v2/orders", status="all", after=after_iso, limit=500)

    def submit_notional(self, symbol: str, side: str, notional: float) -> dict:
        body = {"symbol": symbol, "side": side, "type": "market",
                "time_in_force": "day", "notional": f"{notional:.2f}"}
        r = self.s.post(f"{self.base}/v2/orders", json=body, timeout=30)
        r.raise_for_status()
        return r.json()

    def close_position(self, symbol: str) -> dict:
        r = self.s.delete(f"{self.base}/v2/positions/{symbol}", timeout=30)
        r.raise_for_status()
        return r.json()

    def daily_closes(self, symbols: list[str], days: int = 400) -> pd.DataFrame:
        """抓日線收盤價（已除權息調整），回傳 index=日期、columns=代號。"""
        start = (datetime.now(timezone.utc) - timedelta(days=int(days * 1.5))).strftime("%Y-%m-%d")
        out: dict[str, dict] = {s: {} for s in symbols}
        token = None
        while True:
            params = {"symbols": ",".join(symbols), "timeframe": "1Day", "start": start,
                      "adjustment": "all", "feed": "iex", "limit": 10000}
            if token:
                params["page_token"] = token
            data = self._get(f"{DATA_URL}/v2/stocks/bars", **params)
            for sym, bars in (data.get("bars") or {}).items():
                for b in bars:
                    out[sym][b["t"][:10]] = b["c"]
            token = data.get("next_page_token")
            if not token:
                break
        df = pd.DataFrame(out)
        df.index = pd.to_datetime(df.index)
        return df.sort_index().dropna(how="all").ffill()
