"""每月再平衡機器人。

用法：
  python3 bot.py              # 只顯示「會下哪些單」，不送出（預設）
  python3 bot.py --execute    # 真的送單到 Alpaca 模擬帳戶
真實帳戶需另外設定 ALPACA_LIVE=1 並加 --i-understand-real-money（不建議）。
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from alpaca_client import AlpacaClient
from strategy import StrategyConfig, plan_orders, target_weights

LOG = Path(__file__).with_name("trade_log.jsonl")
MAX_ORDER_PCT = 0.45  # 防呆：單筆訂單不得超過總資產 45%


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true", help="實際送出訂單")
    ap.add_argument("--i-understand-real-money", action="store_true")
    ap.add_argument("--force", action="store_true", help="市場未開盤也照樣送單（會排隊到開盤）")
    args = ap.parse_args()

    cfg = StrategyConfig()
    api = AlpacaClient(allow_live=args.i_understand_real_money)
    print(f"帳戶模式：{'⚠️ 真實帳戶' if api.live else '模擬帳戶 (paper)'}")

    acct = api.account()
    if acct.get("trading_blocked") or acct.get("account_blocked"):
        raise SystemExit("帳戶被限制交易，停止。")
    equity = float(acct["equity"])
    print(f"總資產：${equity:,.2f}　可用現金：${float(acct['cash']):,.2f}")

    if api.open_orders():
        raise SystemExit("還有未成交訂單，為避免重複下單先停止。請到 Alpaca 後台確認。")

    symbols = sorted(set(cfg.universe) | {cfg.safe_asset})
    closes = api.daily_closes(symbols)
    weights = target_weights(closes, cfg)
    positions = api.positions()
    prices = closes.iloc[-1].to_dict()

    print(f"\n資料日期：{closes.index[-1].date()}")
    print("目標配置：", ", ".join(f"{s} {w:.0%}" for s, w in weights.items()))
    print("目前持倉：", ", ".join(f"{s} ${v:,.0f}" for s, v in positions.items()) or "（空手）")

    orders = plan_orders(weights, equity, positions, prices)
    if not orders:
        print("\n持倉已接近目標，不需調整。")
        return
    print("\n預計訂單：")
    for o in orders:
        if o["notional"] > equity * MAX_ORDER_PCT and not o["close_all"]:
            raise SystemExit(f"防呆觸發：{o} 超過總資產 {MAX_ORDER_PCT:.0%}，停止。")
        print(f"  {o['side'].upper():4} {o['symbol']:5} ${o['notional']:,.2f}{'（全部出清）' if o['close_all'] else ''}")

    if not args.execute:
        print("\n（試算模式，未送單。加 --execute 才會下單。）")
        return

    clock = api.clock()
    if not clock["is_open"] and not args.force:
        raise SystemExit(f"市場未開盤（下次開盤 {clock['next_open']}）。加 --force 可預掛單。")

    with LOG.open("a") as f:
        for o in orders:
            if o["close_all"]:
                res = api.close_position(o["symbol"])
            else:
                res = api.submit_notional(o["symbol"], o["side"], o["notional"])
            if o["side"] == "sell":
                time.sleep(2)  # 讓賣單先成交釋出現金
            rec = {"time": datetime.now().isoformat(), "order": o, "id": res.get("id"),
                   "status": res.get("status"), "live": api.live}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            print("  已送出", o["symbol"], res.get("status"))
    print(f"\n完成，紀錄寫入 {LOG.name}")


if __name__ == "__main__":
    main()
