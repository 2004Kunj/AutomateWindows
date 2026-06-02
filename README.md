# SignalFlow — AI Stock Advisor (Live Data)

Browser app with **live buy / hold / sell signals** from real stock prices (US & Canada), plus an **organizer** for watchlists, portfolio, and notes.

> **Disclaimer:** Rule-based technical signals on delayed Yahoo Finance data. **Not financial advice.** Do not trade solely on this app.

## Features

- **Live AI Predictions** — RSI, moving averages, momentum, and volume from ~3 months of real daily prices
- **US & Canada** — Toggle markets; Canadian tickers use TSX (`.TO` on Yahoo)
- **Auto-refresh** — Updates every 90 seconds on the predictions tab
- **Organizer** — Watchlist, portfolio, notes, saved signals (`localStorage`)

## Quick start (live data)

```powershell
cd C:\Users\Kunj_\Projects\ai-stock-trader
.\start.ps1
```

Then open **http://127.0.0.1:5000** in your browser.

Manual setup:

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python server.py
```

Opening `index.html` directly will **not** load live data — the Python server must be running.

## How signals work

| Input | Role |
|--------|------|
| RSI (14) | Oversold / overbought bias |
| SMA 20 & 50 | Trend direction |
| 20-day momentum | Recent strength |
| Volume vs 20-day avg | Confirmation |

Composite score ≥ 62 → **Buy**, ≤ 38 → **Sell**, else **Hold**.

Data source: [Yahoo Finance](https://finance.yahoo.com/) via [yfinance](https://github.com/ranaroussi/yfinance) (typically 15–20 minute delay on free data).

## API (local)

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server status |
| `GET /api/analyze?market=us\|ca` | All universe signals |
| `GET /api/quote?market=us&symbol=AAPL` | Single symbol |
| `POST /api/quotes` | Batch: `{ "market": "us", "symbols": ["AAPL","MSFT"] }` |

## Project structure

| File | Purpose |
|------|---------|
| `server.py` | Flask API + static file host |
| `app.js` | Frontend UI |
| `index.html` / `styles.css` | Layout & theme |
| `start.ps1` | One-command launcher (Windows) |

## Optional: API keys

This project uses Yahoo Finance (no key). For exchange-grade real-time data, you could swap `yfinance` for [Polygon](https://polygon.io/), [Finnhub](https://finnhub.io/), or [Alpha Vantage](https://www.alphavantage.co/) in `server.py`.

## License

MIT — educational use only.
