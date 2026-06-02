"""
SignalFlow API — live Yahoo Finance data + ensemble analysis.
Educational only — not financial advice.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from analysis_engine import analyze_dataframe
from report_builder import generate_daily_report

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
CORS(app)

MARKETS: dict[str, dict[str, Any]] = {
    "us": {
        "currency": "USD",
        "stocks": [
            {"symbol": "AAPL", "name": "Apple Inc.", "yahoo": "AAPL"},
            {"symbol": "MSFT", "name": "Microsoft", "yahoo": "MSFT"},
            {"symbol": "GOOGL", "name": "Alphabet", "yahoo": "GOOGL"},
            {"symbol": "NVDA", "name": "NVIDIA", "yahoo": "NVDA"},
            {"symbol": "AMZN", "name": "Amazon", "yahoo": "AMZN"},
            {"symbol": "META", "name": "Meta Platforms", "yahoo": "META"},
            {"symbol": "TSLA", "name": "Tesla", "yahoo": "TSLA"},
            {"symbol": "JPM", "name": "JPMorgan Chase", "yahoo": "JPM"},
            {"symbol": "V", "name": "Visa", "yahoo": "V"},
            {"symbol": "XOM", "name": "Exxon Mobil", "yahoo": "XOM"},
        ],
    },
    "ca": {
        "currency": "CAD",
        "stocks": [
            {"symbol": "SHOP", "name": "Shopify", "yahoo": "SHOP.TO"},
            {"symbol": "TD", "name": "TD Bank", "yahoo": "TD.TO"},
            {"symbol": "RY", "name": "Royal Bank", "yahoo": "RY.TO"},
            {"symbol": "ENB", "name": "Enbridge", "yahoo": "ENB.TO"},
            {"symbol": "CNQ", "name": "Canadian Natural", "yahoo": "CNQ.TO"},
            {"symbol": "BMO", "name": "Bank of Montreal", "yahoo": "BMO.TO"},
            {"symbol": "CP", "name": "Canadian Pacific", "yahoo": "CP.TO"},
            {"symbol": "BCE", "name": "BCE Inc.", "yahoo": "BCE.TO"},
            {"symbol": "TRI", "name": "Thomson Reuters", "yahoo": "TRI.TO"},
            {"symbol": "ATD", "name": "Alimentation Couche-Tard", "yahoo": "ATD.TO"},
        ],
    },
}


def yahoo_symbol(display_symbol: str, market: str) -> str:
    sym = display_symbol.upper().strip()
    if market == "ca":
        return sym if sym.endswith(".TO") else f"{sym}.TO"
    return sym.replace(".TO", "")


def fetch_candles(yahoo_ticker: str, period: str = "6mo") -> list[dict[str, Any]]:
    df = yf.Ticker(yahoo_ticker).history(period=period, interval="1d", auto_adjust=True)
    if df.empty:
        raise ValueError(f"No candle data for {yahoo_ticker}")
    candles = []
    for idx, row in df.iterrows():
        ts = int(idx.timestamp()) if hasattr(idx, "timestamp") else int(pd.Timestamp(idx).timestamp())
        candles.append(
            {
                "time": ts,
                "open": round(float(row["Open"]), 4),
                "high": round(float(row["High"]), 4),
                "low": round(float(row["Low"]), 4),
                "close": round(float(row["Close"]), 4),
                "volume": int(row["Volume"]) if not math.isnan(row["Volume"]) else 0,
            }
        )
    return candles


def fetch_and_analyze(yahoo_ticker: str, display: dict[str, str]) -> dict[str, Any]:
    df = yf.Ticker(yahoo_ticker).history(period="1y", interval="1d", auto_adjust=True)
    if df.empty:
        raise ValueError(f"No data for {yahoo_ticker}")
    analysis = analyze_dataframe(df, display["symbol"], display["name"])
    return {
        "symbol": display["symbol"],
        "name": display["name"],
        "yahoo": yahoo_ticker,
        "live": True,
        **analysis,
    }


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:filename>")
def static_files(filename: str):
    if filename.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    allowed = {"styles.css", "app.js", "charts.js", "favicon.ico"}
    if filename not in allowed:
        return jsonify({"error": "not found"}), 404
    return send_from_directory(ROOT, filename)


@app.get("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "source": "yahoo-finance",
            "model": "ensemble-v3",
            "features": ["daily-report", "paper-trading", "ensemble-detail", "candles"],
        }
    )


@app.get("/api/analyze")
def analyze_market():
    market = request.args.get("market", "us")
    if market not in MARKETS:
        return jsonify({"error": "market must be us or ca"}), 400

    cfg = MARKETS[market]
    signals: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    for stock in cfg["stocks"]:
        try:
            signals.append(fetch_and_analyze(stock["yahoo"], stock))
        except Exception as e:
            errors.append({"symbol": stock["symbol"], "message": str(e)})

    return jsonify(
        {
            "market": market,
            "currency": cfg["currency"],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "signals": signals,
            "errors": errors,
        }
    )


@app.get("/api/candles")
def candles():
    market = request.args.get("market", "us")
    symbol = request.args.get("symbol", "").strip()
    period = request.args.get("period", "6mo")
    if not symbol or market not in MARKETS:
        return jsonify({"error": "symbol and market required"}), 400
    yahoo = yahoo_symbol(symbol, market)
    try:
        data = fetch_candles(yahoo, period)
        return jsonify({"symbol": symbol.upper().replace(".TO", ""), "yahoo": yahoo, "candles": data})
    except Exception as e:
        return jsonify({"error": str(e)}), 404


@app.get("/api/analyze/detail")
def analyze_detail():
    market = request.args.get("market", "us")
    symbol = request.args.get("symbol", "").strip()
    if not symbol or market not in MARKETS:
        return jsonify({"error": "symbol and valid market required"}), 400

    yahoo = yahoo_symbol(symbol, market)
    name = symbol.upper()
    for s in MARKETS[market]["stocks"]:
        if s["symbol"] == symbol.upper().replace(".TO", ""):
            name = s["name"]
            break

    try:
        return jsonify(fetch_and_analyze(yahoo, {"symbol": symbol.upper().replace(".TO", ""), "name": name}))
    except Exception as e:
        return jsonify({"error": str(e)}), 404


@app.get("/api/quote")
def quote_one():
    market = request.args.get("market", "us")
    symbol = request.args.get("symbol", "").strip()
    if not symbol or market not in MARKETS:
        return jsonify({"error": "symbol required"}), 400
    yahoo = yahoo_symbol(symbol, market)
    display = {"symbol": symbol.upper().replace(".TO", ""), "name": symbol.upper()}
    try:
        return jsonify(fetch_and_analyze(yahoo, display))
    except Exception as e:
        return jsonify({"error": str(e)}), 404


@app.post("/api/quotes")
def quotes_batch():
    body = request.get_json(silent=True) or {}
    market = body.get("market", "us")
    symbols = body.get("symbols", [])
    if market not in MARKETS:
        return jsonify({"error": "market must be us or ca"}), 400

    results = []
    for sym in symbols:
        yahoo = yahoo_symbol(str(sym), market)
        display = {"symbol": str(sym).upper().replace(".TO", ""), "name": str(sym).upper()}
        try:
            results.append(fetch_and_analyze(yahoo, display))
        except Exception as e:
            results.append({"symbol": display["symbol"], "error": str(e)})

    return jsonify({"market": market, "quotes": results})


def _build_daily_report_payload(body: dict[str, Any]) -> dict[str, Any]:
    market = body.get("market", "us")
    if market not in MARKETS:
        raise ValueError("market must be us or ca")

    paper = body.get("paper") or {}
    cfg = MARKETS[market]
    client_signals = body.get("signals") or []

    if client_signals:
        signals = [s for s in client_signals if s.get("symbol") and not s.get("error")]
    else:
        signals = []
        for stock in cfg["stocks"]:
            try:
                signals.append(fetch_and_analyze(stock["yahoo"], stock))
            except Exception:
                pass

    report = generate_daily_report(market, cfg["currency"], paper, signals)
    report["source"] = "server"
    return report


@app.post("/api/daily-report")
def daily_report_post():
    try:
        body = request.get_json(silent=True) or {}
        return jsonify(_build_daily_report_payload(body))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Report generation failed: {e}"}), 500


@app.get("/api/daily-report")
def daily_report_get():
    """GET fallback for older clients; paper/signals passed as JSON query ?payload=..."""
    try:
        import json

        raw = request.args.get("payload", "{}")
        body = json.loads(raw) if raw else {"market": request.args.get("market", "us")}
        if "market" not in body:
            body["market"] = request.args.get("market", "us")
        return jsonify(_build_daily_report_payload(body))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Report generation failed: {e}"}), 500


if __name__ == "__main__":
    print("SignalFlow API: http://127.0.0.1:5000")
    print("Open the app at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False)
