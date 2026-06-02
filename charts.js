/**
 * Candlestick chart (TradingView Lightweight Charts)
 */

const chartRegistry = new Map();

function chartContainerId(symbol) {
  return `chart-${symbol}`;
}

export function destroyCandleChart(symbol) {
  const entry = chartRegistry.get(symbol);
  if (entry) {
    entry.chart.remove();
    chartRegistry.delete(symbol);
  }
}

export async function mountCandleChart(symbol, market, apiBase) {
  const containerId = chartContainerId(symbol);
  const el = document.getElementById(containerId);
  if (!el) return;

  destroyCandleChart(symbol);
  el.innerHTML = '<p class="chart-loading">Loading candlesticks…</p>';

  let candles = [];
  try {
    const res = await fetch(
      `${apiBase}/api/candles?market=${market}&symbol=${encodeURIComponent(symbol)}&period=6mo`,
      { signal: AbortSignal.timeout(60000) }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    candles = data.candles || [];
  } catch (e) {
    el.innerHTML = `<p class="chart-error">Chart unavailable: ${e.message}</p>`;
    return;
  }

  if (!candles.length) {
    el.innerHTML = '<p class="chart-error">No candle data.</p>';
    return;
  }

  el.innerHTML = "";
  if (typeof LightweightCharts === "undefined") {
    el.innerHTML = '<p class="chart-error">Chart library failed to load.</p>';
    return;
  }

  const chart = LightweightCharts.createChart(el, {
    width: el.clientWidth || 600,
    height: 280,
    layout: {
      background: { color: "#0d1219" },
      textColor: "#8b9cb3",
    },
    grid: {
      vertLines: { color: "#243044" },
      horzLines: { color: "#243044" },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: "#243044" },
    timeScale: { borderColor: "#243044", timeVisible: true },
  });

  const series = chart.addCandlestickSeries({
    upColor: "#22c55e",
    downColor: "#ef4444",
    borderUpColor: "#22c55e",
    borderDownColor: "#ef4444",
    wickUpColor: "#22c55e",
    wickDownColor: "#ef4444",
  });

  series.setData(
    candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
  );

  const volSeries = chart.addHistogramSeries({
    color: "#3d8bfd",
    priceFormat: { type: "volume" },
    priceScaleId: "",
  });
  volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
  volSeries.setData(
    candles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
    }))
  );

  chart.timeScale().fitContent();

  const ro = new ResizeObserver(() => {
    chart.applyOptions({ width: el.clientWidth });
  });
  ro.observe(el);

  chartRegistry.set(symbol, { chart, ro });
}
