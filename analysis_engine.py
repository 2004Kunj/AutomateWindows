"""
Multi-factor ensemble v3 — 10+ technical factors, high-conviction scoring.
Educational signals only — not financial advice.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> float | None:
    if len(series) < period + 2:
        return None
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    last_loss = loss.iloc[-1]
    if last_loss == 0 or math.isnan(last_loss):
        return 100.0
    rs = gain.iloc[-1] / last_loss
    return float(100 - (100 / (1 + rs)))


def stochastic_vote(high: pd.Series, low: pd.Series, close: pd.Series, k_period: int = 14) -> tuple[float, int]:
    if len(close) < k_period + 3:
        return 50.0, 0
    lowest = low.rolling(k_period).min()
    highest = high.rolling(k_period).max()
    k = 100 * (close - lowest) / (highest - lowest)
    k_val = float(k.iloc[-1])
    if math.isnan(k_val):
        return 50.0, 0
    if k_val < 20:
        return k_val, 1
    if k_val > 80:
        return k_val, -1
    if k_val < 35:
        return k_val, 1
    if k_val > 65:
        return k_val, -1
    return k_val, 0


def adx_proxy_vote(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> tuple[float, int]:
    """Simplified trend-strength proxy when full ADX is heavy."""
    if len(close) < period + 5:
        return 0.0, 0
    tr = pd.concat(
        [
            high - low,
            (high - close.shift()).abs(),
            (low - close.shift()).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = tr.rolling(period).mean()
    up = high.diff()
    down = -low.diff()
    plus_dm = up.where((up > down) & (up > 0), 0.0)
    minus_dm = down.where((down > up) & (down > 0), 0.0)
    plus_di = 100 * (plus_dm.rolling(period).mean() / atr)
    minus_di = 100 * (minus_dm.rolling(period).mean() / atr)
    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, math.nan) * 100
    strength = float(dx.rolling(period).mean().iloc[-1])
    if math.isnan(strength):
        return 0.0, 0
    pdi = float(plus_di.iloc[-1])
    mdi = float(minus_di.iloc[-1])
    if strength > 22 and pdi > mdi:
        return strength, 1
    if strength > 22 and mdi > pdi:
        return strength, -1
    return strength, 0


def range_position_vote(close: pd.Series, window: int = 252) -> tuple[float, int]:
    seg = close.tail(min(window, len(close)))
    if len(seg) < 20:
        return 0.5, 0
    lo, hi = float(seg.min()), float(seg.max())
    price = float(close.iloc[-1])
    if hi == lo:
        return 0.5, 0
    pos = (price - lo) / (hi - lo)
    if pos < 0.25:
        return round(pos, 3), 1
    if pos > 0.85:
        return round(pos, 3), -1
    if pos > 0.55:
        return round(pos, 3), 1
    if pos < 0.4:
        return round(pos, 3), -1
    return round(pos, 3), 0


def ema_cross_vote(close: pd.Series) -> int:
    if len(close) < 30:
        return 0
    e9 = _ema(close, 9)
    e21 = _ema(close, 21)
    if float(e9.iloc[-1]) > float(e21.iloc[-1]) and float(e9.iloc[-2]) <= float(e21.iloc[-2]):
        return 1
    if float(e9.iloc[-1]) < float(e21.iloc[-1]) and float(e9.iloc[-2]) >= float(e21.iloc[-2]):
        return -1
    return 1 if float(e9.iloc[-1]) > float(e21.iloc[-1]) else -1


def macd_signal(close: pd.Series) -> tuple[float, float, float, int]:
    if len(close) < 35:
        return 0.0, 0.0, 0.0, 0
    ema12 = _ema(close, 12)
    ema26 = _ema(close, 26)
    macd_line = ema12 - ema26
    signal_line = _ema(macd_line, 9)
    hist = float(macd_line.iloc[-1] - signal_line.iloc[-1])
    prev_hist = float(macd_line.iloc[-2] - signal_line.iloc[-2]) if len(close) > 1 else hist
    vote = 0
    if hist > 0 and hist > prev_hist:
        vote = 1
    elif hist < 0 and hist < prev_hist:
        vote = -1
    elif hist > 0:
        vote = 1
    elif hist < 0:
        vote = -1
    return float(macd_line.iloc[-1]), float(signal_line.iloc[-1]), hist, vote


def bollinger_vote(close: pd.Series, period: int = 20) -> tuple[float, int]:
    if len(close) < period:
        return 0.5, 0
    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + 2 * std
    lower = mid - 2 * std
    price = float(close.iloc[-1])
    u, l = float(upper.iloc[-1]), float(lower.iloc[-1])
    pct_b = (price - l) / (u - l) if u != l else 0.5
    if pct_b < 0.2:
        return round(pct_b, 3), 1
    if pct_b > 0.85:
        return round(pct_b, 3), -1
    return round(pct_b, 3), 0


def trend_vote(price: float, sma20: float, sma50: float, sma200: float | None) -> int:
    score = 0
    if price > sma20 > sma50:
        score += 2
    elif price < sma20 < sma50:
        score -= 2
    elif sma20 > sma50:
        score += 1
    else:
        score -= 1
    if sma200:
        score += 1 if price > sma200 else -1
    return 1 if score >= 2 else (-1 if score <= -2 else (1 if score > 0 else (-1 if score < 0 else 0)))


def momentum_vote(close: pd.Series, days: int = 20) -> tuple[float, int]:
    if len(close) <= days:
        return 0.0, 0
    old = float(close.iloc[-days - 1])
    price = float(close.iloc[-1])
    pct = ((price - old) / old * 100) if old else 0.0
    if pct > 6:
        return pct, 1
    if pct < -6:
        return pct, -1
    if pct > 2:
        return pct, 1
    if pct < -2:
        return pct, -1
    return pct, 0


def volume_vote(volume: pd.Series) -> tuple[float, int]:
    if len(volume) < 20:
        return 1.0, 0
    avg = float(volume.tail(20).mean())
    last = float(volume.iloc[-1])
    ratio = last / avg if avg > 0 else 1.0
    if ratio > 1.35:
        return round(ratio, 2), 1
    if ratio < 0.7:
        return round(ratio, 2), -1
    return round(ratio, 2), 0


def rsi_vote(rsi_val: float | None) -> int:
    if rsi_val is None:
        return 0
    if rsi_val < 30:
        return 1
    if rsi_val > 72:
        return -1
    if rsi_val < 40:
        return 1
    if rsi_val > 60:
        return -1
    return 0


def support_resistance(close: pd.Series, window: int = 60) -> tuple[float, float]:
    segment = close.tail(min(window, len(close)))
    return float(segment.min()), float(segment.max())


def confidence_from_ensemble(
    action: str, votes: list[tuple[str, int, float]], composite: float
) -> int:
    weighted = sum(v * w for _, v, w in votes)
    max_w = sum(w for _, _, w in votes) or 1
    alignment = weighted / max_w

    bullish = sum(1 for _, v, _ in votes if v > 0)
    bearish = sum(1 for _, v, _ in votes if v < 0)
    neutral = sum(1 for _, v, _ in votes if v == 0)
    total = len(votes) or 1
    dominant = max(bullish, bearish)
    agreement = dominant / total
    unanimity_bonus = 0
    if action == "buy" and bearish == 0 and bullish >= 6:
        unanimity_bonus = 6
    if action == "sell" and bullish == 0 and bearish >= 6:
        unanimity_bonus = 6

    if action == "hold":
        return int(min(70, max(42, 48 + neutral * 3)))

    strength = abs(composite - 50) / 50
    base = 76 + agreement * 16 + strength * 10 + unanimity_bonus
    if action == "buy" and alignment > 0.25:
        base += min(8, alignment * 10)
    elif action == "sell" and alignment < -0.25:
        base += min(8, abs(alignment) * 10)
    elif action in ("buy", "sell"):
        base -= 10

    return int(min(94, max(74, round(base))))


def build_narrative(
    action: str,
    symbol: str,
    name: str,
    price: float,
    factors: list[dict[str, Any]],
    thesis_points: list[str],
    risk_points: list[str],
) -> dict[str, Any]:
    action_label = {"buy": "BUY", "sell": "SELL", "hold": "HOLD"}[action]
    headlines = {
        "buy": f"{symbol} — high-conviction long setup (ensemble v3 aligned)",
        "sell": f"{symbol} — defensive exit / trim signal",
        "hold": f"{symbol} — standby until factor stack aligns",
    }
    summary = {
        "buy": (
            f"{name} ({symbol}) at ${price:.2f}: ten-factor ensemble shows dominant bullish alignment "
            f"(trend, momentum, oscillators, volume). Model favors staged long entries with stops under support."
        ),
        "sell": (
            f"{symbol} at ${price:.2f}: bearish factor majority — momentum loss, weak trend, or overbought "
            f"stretch. Consider reducing size or waiting for base rebuild."
        ),
        "hold": (
            f"{symbol} at ${price:.2f}: mixed factor votes — no clear edge. Preserve capital until "
            f"conviction exceeds 74% on a directional signal."
        ),
    }
    return {
        "headline": headlines[action],
        "summary": summary[action],
        "actionLabel": action_label,
        "thesis": thesis_points,
        "risks": risk_points,
        "factors": factors,
    }


def analyze_dataframe(df: pd.DataFrame, symbol: str, name: str) -> dict[str, Any]:
    close = df["Close"].dropna()
    volume = df["Volume"].dropna()
    high = df["High"].dropna() if "High" in df.columns else close
    low = df["Low"].dropna() if "Low" in df.columns else close

    if len(close) < 50:
        raise ValueError("Not enough history for ensemble v3 (need 50+ sessions)")

    price = float(close.iloc[-1])
    prev = float(close.iloc[-2])
    change_pct = round((price - prev) / prev * 100, 2) if prev else 0.0

    rsi_val = rsi(close, 14)
    sma20 = float(close.rolling(20).mean().iloc[-1])
    sma50 = float(close.rolling(50).mean().iloc[-1])
    sma200 = float(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else None

    _, _, macd_hist, macd_v = macd_signal(close)
    pct_b, bb_v = bollinger_vote(close)
    mom_pct, mom_v = momentum_vote(close)
    vol_ratio, vol_v = volume_vote(volume)
    rsi_v = rsi_vote(rsi_val)
    trend_v = trend_vote(price, sma20, sma50, sma200)
    stoch_k, stoch_v = stochastic_vote(high, low, close)
    adx_strength, adx_v = adx_proxy_vote(high, low, close)
    range_pos, range_v = range_position_vote(close)
    ema_v = ema_cross_vote(close)

    votes: list[tuple[str, int, float]] = [
        ("RSI (14)", rsi_v, 1.3),
        ("Trend (SMA 20/50/200)", trend_v, 1.8),
        ("MACD", macd_v, 1.4),
        ("Bollinger %B", bb_v, 1.1),
        ("Stochastic %K", stoch_v, 1.2),
        ("ADX trend strength", adx_v, 1.3),
        ("52-week range position", range_v, 1.0),
        ("EMA 9/21 cross", ema_v, 1.2),
        ("20d momentum", mom_v, 1.3),
        ("Volume", vol_v, 1.0),
    ]

    composite = 50.0
    for _, v, w in votes:
        composite += v * w * 3.8
    composite = max(0, min(100, round(composite)))

    if composite >= 66:
        action = "buy"
    elif composite <= 34:
        action = "sell"
    else:
        action = "hold"

    confidence = confidence_from_ensemble(action, votes, composite)

    factors: list[dict[str, Any]] = []
    thesis: list[str] = []
    risks: list[str] = []

    def factor_row(label: str, vote: int, detail: str):
        bias = "bullish" if vote > 0 else ("bearish" if vote < 0 else "neutral")
        factors.append({"name": label, "bias": bias, "detail": detail})
        if vote > 0:
            thesis.append(detail)
        elif vote < 0:
            risks.append(detail)

    if rsi_val is not None:
        factor_row("RSI", rsi_v, f"RSI {rsi_val:.1f}.")
    factor_row("Trend", trend_v, "SMA stack: " + ("bullish alignment" if trend_v > 0 else "bearish alignment" if trend_v < 0 else "mixed"))
    factor_row("MACD", macd_v, f"MACD histogram {macd_hist:+.4f}.")
    factor_row("Bollinger", bb_v, f"Bollinger %B {pct_b:.2f}.")
    factor_row("Stochastic", stoch_v, f"Stochastic %K {stoch_k:.1f}.")
    factor_row("ADX proxy", adx_v, f"Trend strength index {adx_strength:.1f}.")
    factor_row("Range", range_v, f"Price at {range_pos * 100:.0f}% of 52-week range.")
    factor_row("EMA 9/21", ema_v, "Fast EMA vs slow EMA: " + ("bullish" if ema_v > 0 else "bearish" if ema_v < 0 else "flat"))
    factor_row("Momentum", mom_v, f"20-day return {mom_pct:+.1f}%.")
    factor_row("Volume", vol_v, f"Volume {vol_ratio:.2f}× average.")

    sup, res = support_resistance(close)
    if action == "buy":
        thesis.append(f"Support ${sup:.2f} — logical stop zone.")
    if action == "sell":
        risks.append(f"Resistance ${res:.2f} may cap rebounds.")

    if not thesis:
        thesis.append("Wait for clearer bullish confirmation.")
    if not risks:
        risks.append("Single-factor divergence possible on gap days.")

    narrative = build_narrative(action, symbol, name, price, factors, thesis, risks)

    return {
        "price": round(price, 2),
        "changePct": change_pct,
        "score": composite,
        "action": action,
        "confidence": confidence,
        "reason": narrative["headline"],
        "narrative": narrative,
        "indicators": {
            "rsi": round(rsi_val, 1) if rsi_val is not None else None,
            "sma20": round(sma20, 2),
            "sma50": round(sma50, 2),
            "sma200": round(sma200, 2) if sma200 else None,
            "momentum20d": round(mom_pct, 2),
            "volumeRatio": vol_ratio,
            "macdHist": round(macd_hist, 4),
            "bollingerPctB": pct_b,
            "stochastic": round(stoch_k, 1),
            "adxProxy": round(adx_strength, 1),
            "rangePosition": round(range_pos, 3),
            "support": round(sup, 2),
            "resistance": round(res, 2),
        },
        "ensemble": {
            "bullishFactors": sum(1 for _, v, _ in votes if v > 0),
            "bearishFactors": sum(1 for _, v, _ in votes if v < 0),
            "totalFactors": len(votes),
            "version": 3,
        },
    }
