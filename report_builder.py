"""Expert-style daily paper-trading report from live quotes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd
import yfinance as yf


def _yahoo_symbol(symbol: str, market: str) -> str:
    sym = symbol.upper().strip()
    if market == "ca":
        return sym if sym.endswith(".TO") else f"{sym}.TO"
    return sym.replace(".TO", "")


def _fetch_df(yahoo: str) -> pd.DataFrame:
    df = yf.Ticker(yahoo).history(period="6mo", interval="1d", auto_adjust=True)
    if df.empty:
        raise ValueError(f"No data for {yahoo}")
    return df


def generate_daily_report(
    market: str,
    currency: str,
    paper: dict[str, Any],
    universe_signals: list[dict[str, Any]],
) -> dict[str, Any]:
    cash = float(paper.get("cash", 100_000))
    positions = paper.get("positions") or []
    start_equity = float(paper.get("startEquity", cash))

    holdings: list[dict[str, Any]] = []
    positions_value = 0.0
    total_unrealized = 0.0

    quote_map = {
        str(s.get("symbol", "")).upper(): s
        for s in universe_signals
        if s.get("symbol") and s.get("price") is not None
    }

    for pos in positions:
        sym = str(pos.get("symbol", "")).upper()
        shares = float(pos.get("shares", 0))
        avg_cost = float(pos.get("avgCost", 0))
        cached = quote_map.get(sym)
        if cached:
            price = float(cached["price"])
            day_chg_pct = float(cached.get("changePct") or 0)
        else:
            yahoo = _yahoo_symbol(sym, market)
            try:
                df = _fetch_df(yahoo)
                price = float(df["Close"].iloc[-1])
                prev = float(df["Close"].iloc[-2]) if len(df) > 1 else price
                day_chg_pct = ((price - prev) / prev * 100) if prev else 0
            except Exception:
                price = avg_cost
                day_chg_pct = 0

        market_value = price * shares
        cost_basis = avg_cost * shares
        pl = market_value - cost_basis
        pl_pct = (pl / cost_basis * 100) if cost_basis else 0
        positions_value += market_value
        total_unrealized += pl

        holdings.append(
            {
                "symbol": sym,
                "shares": shares,
                "avgCost": round(avg_cost, 2),
                "currentPrice": round(price, 2),
                "marketValue": round(market_value, 2),
                "unrealizedPL": round(pl, 2),
                "unrealizedPLPct": round(pl_pct, 2),
                "dayChangePct": round(day_chg_pct, 2),
                "openedAt": pos.get("openedAt"),
            }
        )

    equity = cash + positions_value
    total_return_pct = ((equity - start_equity) / start_equity * 100) if start_equity else 0

    buys = [s for s in universe_signals if s.get("action") == "buy"]
    sells = [s for s in universe_signals if s.get("action") == "sell"]
    buys.sort(key=lambda x: x.get("confidence", 0), reverse=True)
    sells.sort(key=lambda x: x.get("confidence", 0), reverse=True)

    held_symbols = {h["symbol"] for h in holdings}
    new_ideas = [b for b in buys[:3] if b["symbol"] not in held_symbols]
    trim_ideas = [s for s in sells if s["symbol"] in held_symbols][:3]

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")

    executive = (
        f"Daily desk note — {date_str} ({market.upper()} / {currency}). "
        f"Paper equity {currency} {equity:,.2f} "
        f"({'+' if total_return_pct >= 0 else ''}{total_return_pct:.2f}% vs starting capital). "
        f"Cash {currency} {cash:,.2f}; invested {currency} {positions_value:,.2f}. "
        f"Unrealized P/L {currency} {total_unrealized:+,.2f}."
    )

    playbook: list[str] = []
    if new_ideas:
        top = new_ideas[0]
        playbook.append(
            f"Primary add watch: {top['symbol']} ({top.get('confidence')}% ensemble conviction, "
            f"live ~{currency} {top.get('price')}). {top.get('reason', '')}"
        )
    if trim_ideas:
        t = trim_ideas[0]
        playbook.append(
            f"Reduce bias: {t['symbol']} — sell signal at {t.get('confidence')}% confidence."
        )
    if not playbook:
        playbook.append("No high-conviction adds; maintain discipline and wait for factor alignment.")

    risk_note = (
        "Risk: Yahoo quotes are delayed; ensemble is technical-only. "
        "Size positions ≤2% risk per trade; use stops below support levels from expanded ticker view."
    )

    sections = [
        {"title": "Executive summary", "body": executive},
        {"title": "Portfolio snapshot", "body": _holdings_table_text(holdings, currency)},
        {"title": "Today's playbook", "body": "\n".join(f"• {p}" for p in playbook)},
        {"title": "Top buy scans", "body": _signal_list_text(buys[:5], currency)},
        {"title": "Sell / trim watch", "body": _signal_list_text(sells[:5], currency)},
        {"title": "Risk management", "body": risk_note},
    ]

    return {
        "date": date_str,
        "market": market,
        "currency": currency,
        "generatedAt": now.isoformat(),
        "equity": round(equity, 2),
        "cash": round(cash, 2),
        "positionsValue": round(positions_value, 2),
        "unrealizedPL": round(total_unrealized, 2),
        "totalReturnPct": round(total_return_pct, 2),
        "holdings": holdings,
        "sections": sections,
        "newIdeas": new_ideas,
        "trimIdeas": trim_ideas,
    }


def _holdings_table_text(holdings: list[dict], currency: str) -> str:
    if not holdings:
        return "Flat — 100% cash. Deploy only when buy conviction ≥72%."
    lines = []
    for h in holdings:
        lines.append(
            f"{h['symbol']}: {h['shares']} sh @ {currency} {h['avgCost']} avg → "
            f"{currency} {h['currentPrice']} ({h['dayChangePct']:+.2f}% today). "
            f"Value {currency} {h['marketValue']:,.2f}, P/L {h['unrealizedPL']:+.2f} ({h['unrealizedPLPct']:+.2f}%)."
        )
    return "\n".join(lines)


def _signal_list_text(signals: list[dict], currency: str) -> str:
    if not signals:
        return "None flagged."
    return "\n".join(
        f"{s['symbol']} @ {currency} {s.get('price')} — {s.get('action', '').upper()} "
        f"({s.get('confidence')}%): {s.get('reason', '')[:120]}"
        for s in signals
    )
