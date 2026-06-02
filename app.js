/**
 * SignalFlow — ensemble AI signals, paper trading, daily reports
 */

import { mountCandleChart, destroyCandleChart } from "./charts.js";

const API_BASE =
  window.location.port === "5000" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost"
    ? ""
    : "http://127.0.0.1:5000";

const REFRESH_MS = 90_000;
const STORAGE_KEY = "signalflow-v2";
const PAPER_START = 100_000;

const MARKETS = {
  us: { hint: "NYSE & NASDAQ · USD · Live", currency: "USD" },
  ca: { hint: "TSX · CAD · Live", currency: "CAD" },
};

let state = loadState();
let currentQuotes = {};
let expandedSymbol = null;
let isLive = false;
let refreshTimer = null;
let loading = false;

function defaultPaper() {
  return { cash: PAPER_START, startEquity: PAPER_START, positions: [], trades: [] };
}

function loadState() {
  const base = {
    market: "us",
    watchlist: [],
    portfolio: [],
    notes: [],
    saved: [],
    paper: { us: defaultPaper(), ca: defaultPaper() },
    dailyReports: [],
    lastAutoReportKey: "",
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("signalflow-v1");
    if (!raw) return base;
    const p = JSON.parse(raw);
    return {
      ...base,
      market: p.market === "ca" ? "ca" : "us",
      watchlist: p.watchlist || [],
      portfolio: p.portfolio || [],
      notes: p.notes || [],
      saved: p.saved || [],
      paper: {
        us: { ...defaultPaper(), ...p.paper?.us },
        ca: { ...defaultPaper(), ...p.paper?.ca },
      },
      dailyReports: p.dailyReports || [],
      lastAutoReportKey: p.lastAutoReportKey || "",
    };
  } catch {
    return base;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getPaper() {
  return state.paper[state.market];
}

function formatMoney(n, currency) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(currency === "CAD" ? "en-CA" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatPct(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text ?? "";
  return d.innerHTML;
}

function indicatorLine(ind) {
  if (!ind) return "";
  const p = [];
  if (ind.rsi != null) p.push(`RSI ${ind.rsi}`);
  if (ind.stochastic != null) p.push(`Stoch ${ind.stochastic}`);
  if (ind.adxProxy != null) p.push(`ADX ${ind.adxProxy}`);
  if (ind.macdHist != null) p.push(`MACD ${ind.macdHist > 0 ? "+" : ""}${ind.macdHist}`);
  if (ind.momentum20d != null) p.push(`Mom ${ind.momentum20d > 0 ? "+" : ""}${ind.momentum20d}%`);
  if (ind.volumeRatio != null) p.push(`Vol ${ind.volumeRatio}×`);
  return p.join(" · ");
}

const els = {
  btnUs: document.getElementById("btn-us"),
  btnCa: document.getElementById("btn-ca"),
  marketHint: document.getElementById("market-hint"),
  navItems: document.querySelectorAll(".nav-item"),
  viewPredictions: document.getElementById("view-predictions"),
  viewPaper: document.getElementById("view-paper"),
  viewReport: document.getElementById("view-report"),
  viewOrganizer: document.getElementById("view-organizer"),
  viewTitle: document.getElementById("view-title"),
  viewSubtitle: document.getElementById("view-subtitle"),
  btnRefresh: document.getElementById("btn-refresh"),
  lastUpdated: document.getElementById("last-updated"),
  dataBadge: document.getElementById("data-badge"),
  loadingBanner: document.getElementById("loading-banner"),
  errorBanner: document.getElementById("error-banner"),
  statsRow: document.getElementById("stats-row"),
  buyList: document.getElementById("buy-list"),
  holdList: document.getElementById("hold-list"),
  sellList: document.getElementById("sell-list"),
  buyCount: document.getElementById("buy-count"),
  holdCount: document.getElementById("hold-count"),
  sellCount: document.getElementById("sell-count"),
  paperSummary: document.getElementById("paper-summary"),
  paperPositionsBody: document.getElementById("paper-positions-body"),
  tradeLog: document.getElementById("trade-log"),
  btnResetPaper: document.getElementById("btn-reset-paper"),
  btnGenReport: document.getElementById("btn-gen-report"),
  reportMeta: document.getElementById("report-meta"),
  dailyReport: document.getElementById("daily-report"),
  reportHistory: document.getElementById("report-history"),
  tradeModal: document.getElementById("trade-modal"),
  tradeForm: document.getElementById("trade-form"),
  tradeModalTitle: document.getElementById("trade-modal-title"),
  tradeModalHint: document.getElementById("trade-modal-hint"),
  tradeModalPrice: document.getElementById("trade-modal-price"),
  tradeCancel: document.getElementById("trade-cancel"),
  watchlistForm: document.getElementById("watchlist-form"),
  watchlistInput: document.getElementById("watchlist-input"),
  watchlist: document.getElementById("watchlist"),
  portfolioBody: document.getElementById("portfolio-body"),
  portfolioTotal: document.getElementById("portfolio-total"),
  btnAddPosition: document.getElementById("btn-add-position"),
  positionModal: document.getElementById("position-modal"),
  positionForm: document.getElementById("position-form"),
  positionCancel: document.getElementById("position-cancel"),
  modalCurrency: document.getElementById("modal-currency"),
  noteForm: document.getElementById("note-form"),
  noteInput: document.getElementById("note-input"),
  notesList: document.getElementById("notes-list"),
  savedList: document.getElementById("saved-list"),
  btnClearSaved: document.getElementById("btn-clear-saved"),
  paperHubMeta: document.getElementById("paper-hub-meta"),
  paperHubStats: document.getElementById("paper-hub-stats"),
  paperHubPositions: document.getElementById("paper-hub-positions"),
  paperHubTrades: document.getElementById("paper-hub-trades"),
};

function setDataBadge(mode, text) {
  els.dataBadge.textContent = text;
  els.dataBadge.className = "data-badge " + mode;
}

function setLoading(on) {
  loading = on;
  els.loadingBanner.hidden = !on;
  els.btnRefresh.disabled = on;
}

function showError(msg) {
  els.errorBanner.textContent = msg || "";
  els.errorBanner.hidden = !msg;
}

let serverFeatures = [];

async function checkApi() {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    serverFeatures = data.features || [];
    return true;
  } catch {
    serverFeatures = [];
    return false;
  }
}

function serverHasDailyReport() {
  return serverFeatures.includes("daily-report");
}

/** Build report in-browser when server is outdated or POST fails */
function buildLocalDailyReport() {
  const paper = getPaper();
  const currency = MARKETS[state.market].currency;
  const signals = Object.values(currentQuotes).filter((s) => s.price != null);
  const date = new Date().toISOString().slice(0, 10);

  const holdings = [];
  let positionsValue = 0;
  let totalUnrealized = 0;

  for (const pos of paper.positions) {
    const q = getQuoteForSymbol(pos.symbol);
    const price = q.price ?? pos.avgCost;
    const ch = q.changePct ?? 0;
    const mv = price * pos.shares;
    const cost = pos.avgCost * pos.shares;
    const pl = mv - cost;
    const plPct = cost ? (pl / cost) * 100 : 0;
    positionsValue += mv;
    totalUnrealized += pl;
    holdings.push({
      symbol: pos.symbol,
      shares: pos.shares,
      avgCost: pos.avgCost,
      currentPrice: price,
      marketValue: mv,
      unrealizedPL: pl,
      unrealizedPLPct: plPct,
      dayChangePct: ch,
    });
  }

  const equity = paper.cash + positionsValue;
  const totalReturnPct = paper.startEquity ? ((equity - paper.startEquity) / paper.startEquity) * 100 : 0;

  const buys = signals.filter((s) => s.action === "buy").sort((a, b) => b.confidence - a.confidence);
  const sells = signals.filter((s) => s.action === "sell").sort((a, b) => b.confidence - a.confidence);
  const held = new Set(holdings.map((h) => h.symbol));
  const newIdeas = buys.filter((b) => !held.has(b.symbol)).slice(0, 3);
  const trimIdeas = sells.filter((s) => held.has(s.symbol)).slice(0, 3);

  const executive =
    `Daily desk note — ${date} (${state.market.toUpperCase()} / ${currency}). ` +
    `Paper equity ${formatMoney(equity, currency)} (${formatPct(totalReturnPct)} vs start). ` +
    `Cash ${formatMoney(paper.cash, currency)}; invested ${formatMoney(positionsValue, currency)}. ` +
    `Unrealized P/L ${formatMoney(totalUnrealized, currency)}.`;

  const holdingsText = holdings.length
    ? holdings
        .map(
          (h) =>
            `${h.symbol}: ${h.shares} sh @ ${formatMoney(h.avgCost, currency)} avg → ` +
            `${formatMoney(h.currentPrice, currency)} (${formatPct(h.dayChangePct)} today). ` +
            `P/L ${formatMoney(h.unrealizedPL, currency)} (${formatPct(h.unrealizedPLPct)}).`
        )
        .join("\n")
    : "Flat — 100% cash.";

  const signalLine = (list) =>
    list.length
      ? list
          .map(
            (s) =>
              `${s.symbol} @ ${formatMoney(s.price, currency)} — ${s.action.toUpperCase()} (${s.confidence}%): ${(s.reason || "").slice(0, 100)}`
          )
          .join("\n")
      : "None flagged.";

  const playbook = [];
  if (newIdeas[0]) {
    playbook.push(
      `Primary add: ${newIdeas[0].symbol} (${newIdeas[0].confidence}% conviction, ${formatMoney(newIdeas[0].price, currency)}).`
    );
  }
  if (trimIdeas[0]) {
    playbook.push(`Trim watch: ${trimIdeas[0].symbol} — sell signal ${trimIdeas[0].confidence}%.`);
  }
  if (!playbook.length) playbook.push("No high-conviction adds; stay patient.");

  return {
    date,
    market: state.market,
    currency,
    generatedAt: new Date().toISOString(),
    equity,
    cash: paper.cash,
    positionsValue,
    unrealizedPL: totalUnrealized,
    totalReturnPct,
    holdings,
    source: "client",
    sections: [
      { title: "Executive summary", body: executive },
      { title: "Portfolio snapshot", body: holdingsText },
      { title: "Today's playbook", body: playbook.map((p) => `• ${p}`).join("\n") },
      { title: "Top buy scans", body: signalLine(buys.slice(0, 5)) },
      { title: "Sell / trim watch", body: signalLine(sells.slice(0, 5)) },
      {
        title: "Risk management",
        body: "Quotes from last refresh (Yahoo, delayed). Technical ensemble only — not investment advice.",
      },
    ],
  };
}

function saveAndShowReport(report) {
  state.dailyReports = [
    { market: state.market, ...report },
    ...state.dailyReports.filter((r) => !(r.date === report.date && r.market === state.market)),
  ].slice(0, 14);
  saveState();
  renderDailyReport(report);
  renderReportHistory();
  const src = report.source === "server" ? "Server" : "Browser";
  els.reportMeta.textContent = `${src} · ${new Date(report.generatedAt).toLocaleString()}`;
}

async function runAnalysis() {
  if (loading) return;
  setLoading(true);
  showError("");
  try {
    const res = await fetch(`${API_BASE}/api/analyze?market=${state.market}`, {
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    const data = await res.json();
    currentQuotes = {};
    for (const s of data.signals) currentQuotes[s.symbol] = s;
    isLive = true;
    setDataBadge("live", "● Live · Ensemble v3");
    els.lastUpdated.textContent = `Live · ${new Date(data.updatedAt || Date.now()).toLocaleTimeString()}`;
    if (data.errors?.length) {
      showError(`Partial load: ${data.errors.map((e) => e.symbol).join(", ")}`);
    }
    renderPredictions();
    renderPaper();
    renderOrganizer();
    await refreshWatchlistQuotes();
  } catch (e) {
    isLive = false;
    setDataBadge("offline", "○ Offline");
    showError(`Start server: python server.py → http://127.0.0.1:5000 (${e.message})`);
  } finally {
    setLoading(false);
  }
}

async function refreshWatchlistQuotes() {
  const extra = state.watchlist.filter((s) => !currentQuotes[s]);
  if (!extra.length || !isLive) return;
  try {
    const res = await fetch(`${API_BASE}/api/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: state.market, symbols: extra }),
    });
    if (!res.ok) return;
    const data = await res.json();
    for (const q of data.quotes) if (q.price != null) currentQuotes[q.symbol] = q;
    renderOrganizer();
    renderPaper();
  } catch (_) {}
}

function renderExpandedPanel(s) {
  const n = s.narrative || {};
  const factors = (n.factors || [])
    .map(
      (f) =>
        `<li class="factor-${f.bias}"><strong>${escapeHtml(f.name)}</strong> (${f.bias}) — ${escapeHtml(f.detail)}</li>`
    )
    .join("");
  const thesis = (n.thesis || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const risks = (n.risks || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const ens = s.ensemble || {};
  const ind = s.indicators || {};

  return `
    <div class="signal-expand">
      <div class="chart-wrap" id="chart-${s.symbol}" aria-label="Candlestick chart for ${s.symbol}"></div>
      <p class="expand-summary">${escapeHtml(n.summary || "")}</p>
      <div class="expand-grid">
        <div>
          <h4>Why ${escapeHtml((n.actionLabel || s.action).toUpperCase())}</h4>
          <ul class="expand-list thesis-list">${thesis || "<li>See factor breakdown.</li>"}</ul>
        </div>
        <div>
          <h4>Risks & counterpoints</h4>
          <ul class="expand-list risk-list">${risks}</ul>
        </div>
      </div>
      <h4>Factor ensemble (${ens.bullishFactors || 0} bull / ${ens.bearishFactors || 0} bear)</h4>
      <ul class="factor-list">${factors}</ul>
      <p class="expand-levels">
        Support <strong>${formatMoney(ind.support, MARKETS[state.market].currency)}</strong> ·
        Resistance <strong>${formatMoney(ind.resistance, MARKETS[state.market].currency)}</strong>
        · Score <strong>${s.score}/100</strong>
      </p>
      <div class="expand-actions">
        <button type="button" class="btn btn-primary btn-sm" data-paper-buy="${s.symbol}">Paper buy</button>
        <button type="button" class="btn btn-ghost btn-sm" data-paper-sell="${s.symbol}">Paper sell</button>
        <button type="button" class="btn btn-ghost btn-sm" data-save="${s.symbol}" data-action="${s.action}">Save signal</button>
      </div>
    </div>
  `;
}

function renderSignalCard(s, currency) {
  const chClass = (s.changePct ?? 0) >= 0 ? "up" : "down";
  const expanded = expandedSymbol === s.symbol;
  const confClass = s.confidence >= 88 ? "confidence-high" : s.confidence >= 80 ? "confidence-mid" : "";
  return `
    <li class="signal-card ${expanded ? "expanded" : ""}" data-symbol="${s.symbol}">
      <button type="button" class="signal-hit" data-toggle="${s.symbol}" aria-expanded="${expanded}">
        <div class="signal-top">
          <div>
            <div class="signal-symbol">${s.symbol} <span class="chevron">${expanded ? "▾" : "▸"}</span></div>
            <div class="signal-name">${escapeHtml(s.name || s.symbol)}</div>
          </div>
          <div>
            <div class="signal-price">${formatMoney(s.price, currency)}</div>
            <div class="signal-change ${chClass}">${formatPct(s.changePct)}</div>
          </div>
        </div>
        <div class="signal-meta">
          <span class="confidence ${confClass}">${s.confidence}% model</span>
          <span class="signal-reason">${escapeHtml(s.reason || "")}</span>
        </div>
        <div class="signal-indicators">${escapeHtml(indicatorLine(s.indicators))}</div>
      </button>
      ${expanded ? renderExpandedPanel(s) : ""}
    </li>
  `;
}

function bindSignalList(container) {
  container.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sym = btn.dataset.toggle;
      if (expandedSymbol && expandedSymbol !== sym) destroyCandleChart(expandedSymbol);
      expandedSymbol = expandedSymbol === sym ? null : sym;
      renderPredictions();
      if (expandedSymbol) {
        await mountCandleChart(expandedSymbol, state.market, API_BASE);
      }
    });
  });
  container.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      saveSignal(btn.dataset.save, btn.dataset.action);
    });
  });
  container.querySelectorAll("[data-paper-buy]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTradeModal(btn.dataset.paperBuy, "buy");
    });
  });
  container.querySelectorAll("[data-paper-sell]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openTradeModal(btn.dataset.paperSell, "sell");
    });
  });
}

function renderPredictions() {
  const currency = MARKETS[state.market].currency;
  const signals = Object.values(currentQuotes);
  const buys = signals.filter((s) => s.action === "buy").sort((a, b) => b.confidence - a.confidence);
  const sells = signals.filter((s) => s.action === "sell").sort((a, b) => b.confidence - a.confidence);
  const holds = signals.filter((s) => s.action === "hold").sort((a, b) => b.score - a.score);

  els.buyCount.textContent = String(buys.length);
  els.holdCount.textContent = String(holds.length);
  els.sellCount.textContent = String(sells.length);

  const highConv = signals.filter((s) => s.confidence >= 88).length;
  const avgConf = signals.length ? Math.round(signals.reduce((a, s) => a + s.confidence, 0) / signals.length) : 0;

  els.statsRow.innerHTML = `
    <div class="stat-card buy"><span class="label">Buy</span><span class="value">${buys.length}</span></div>
    <div class="stat-card sell"><span class="label">Sell</span><span class="value">${sells.length}</span></div>
    <div class="stat-card"><span class="label">88%+ conviction</span><span class="value">${highConv}</span></div>
    <div class="stat-card"><span class="label">Avg model</span><span class="value">${avgConf}%</span></div>
  `;

  const empty = '<p class="empty-msg">No signals — start server and refresh.</p>';
  els.buyList.innerHTML = buys.length ? buys.map((s) => renderSignalCard(s, currency)).join("") : empty;
  els.holdList.innerHTML = holds.length ? holds.map((s) => renderSignalCard(s, currency)).join("") : empty;
  els.sellList.innerHTML = sells.length ? sells.map((s) => renderSignalCard(s, currency)).join("") : empty;

  bindSignalList(els.buyList);
  bindSignalList(els.holdList);
  bindSignalList(els.sellList);
}

function saveSignal(symbol, action) {
  const q = currentQuotes[symbol];
  if (!q) return;
  state.saved = [
    {
      id: `${symbol}-${Date.now()}`,
      symbol,
      action,
      confidence: q.confidence,
      price: q.price,
      market: state.market,
      at: Date.now(),
    },
    ...state.saved.filter((s) => !(s.symbol === symbol && s.market === state.market)),
  ].slice(0, 30);
  saveState();
  renderOrganizer();
}

function openTradeModal(symbol, side) {
  const q = currentQuotes[symbol];
  const currency = MARKETS[state.market].currency;
  const paper = getPaper();
  const pos = paper.positions.find((p) => p.symbol === symbol);

  els.tradeForm.elements.symbol.value = symbol;
  els.tradeForm.elements.side.value = side;
  els.tradeModalTitle.textContent = side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`;
  els.tradeModalPrice.textContent = formatMoney(q?.price, currency);
  els.tradeModalHint.textContent =
    side === "buy"
      ? `Cash available: ${formatMoney(paper.cash, currency)}`
      : pos
        ? `You hold ${pos.shares} shares (avg ${formatMoney(pos.avgCost, currency)})`
        : "No position to sell";
  els.tradeForm.elements.shares.value = side === "sell" && pos ? pos.shares : 10;
  els.tradeModal.showModal();
}

function executePaperTrade(symbol, side, shares) {
  const q = currentQuotes[symbol];
  if (!q?.price) return alert("No live price — refresh analysis first.");
  const price = q.price;
  const paper = getPaper();
  const currency = MARKETS[state.market].currency;
  const cost = price * shares;
  const now = new Date().toISOString();

  if (side === "buy") {
    if (cost > paper.cash) return alert("Insufficient paper cash.");
    const existing = paper.positions.find((p) => p.symbol === symbol);
    if (existing) {
      const totalShares = existing.shares + shares;
      existing.avgCost = (existing.avgCost * existing.shares + cost) / totalShares;
      existing.shares = totalShares;
    } else {
      paper.positions.push({ symbol, shares, avgCost: price, openedAt: now });
    }
    paper.cash -= cost;
    paper.trades.unshift({
      id: `t-${Date.now()}`,
      side: "buy",
      symbol,
      shares,
      price,
      total: cost,
      at: now,
    });
  } else {
    const pos = paper.positions.find((p) => p.symbol === symbol);
    if (!pos || shares > pos.shares) return alert("Not enough shares.");
    const proceeds = price * shares;
    paper.cash += proceeds;
    pos.shares -= shares;
    if (pos.shares < 0.0001) paper.positions = paper.positions.filter((p) => p.symbol !== symbol);
    paper.trades.unshift({
      id: `t-${Date.now()}`,
      side: "sell",
      symbol,
      shares,
      price,
      total: proceeds,
      at: now,
    });
  }

  saveState();
  renderPaper();
  renderPaperHub();
  els.tradeModal.close();
}

function computePaperEquity() {
  const { equity, unrealized, paper } = computePaperEquityForMarket(state.market);
  const currency = MARKETS[state.market].currency;
  const posVal = equity - paper.cash;
  const ret = paper.startEquity ? ((equity - paper.startEquity) / paper.startEquity) * 100 : 0;
  return { paper, currency, posVal, equity, unrealized, ret };
}

function renderPaper() {
  const { paper, currency, posVal, equity, unrealized, ret } = computePaperEquity();
  els.paperSummary.innerHTML = `
    <div class="stat-card"><span class="label">Equity</span><span class="value">${formatMoney(equity, currency)}</span></div>
    <div class="stat-card"><span class="label">Cash</span><span class="value">${formatMoney(paper.cash, currency)}</span></div>
    <div class="stat-card"><span class="label">Invested</span><span class="value">${formatMoney(posVal, currency)}</span></div>
    <div class="stat-card ${ret >= 0 ? "buy" : "sell"}"><span class="label">Total return</span><span class="value">${formatPct(ret)}</span></div>
    <div class="stat-card"><span class="label">Unrealized P/L</span><span class="value">${formatMoney(unrealized, currency)}</span></div>
  `;

  if (!paper.positions.length) {
    els.paperPositionsBody.innerHTML =
      '<tr><td colspan="6"><p class="empty-msg">No open paper positions. Expand a stock and click Paper buy.</p></td></tr>';
  } else {
    els.paperPositionsBody.innerHTML = paper.positions
      .map((p) => {
        const q = getQuoteForSymbol(p.symbol);
        const px = q.price ?? p.avgCost;
        const pl = (px - p.avgCost) * p.shares;
        const plPct = p.avgCost ? ((px - p.avgCost) / p.avgCost) * 100 : 0;
        return `<tr>
          <td>${p.symbol}</td><td>${p.shares}</td>
          <td>${formatMoney(p.avgCost, currency)}</td>
          <td>${formatMoney(px, currency)}</td>
          <td class="${pl >= 0 ? "up" : "down"}">${formatMoney(pl, currency)} (${formatPct(plPct)})</td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-quick-sell="${p.symbol}">Sell</button></td>
        </tr>`;
      })
      .join("");
    els.paperPositionsBody.querySelectorAll("[data-quick-sell]").forEach((b) => {
      b.addEventListener("click", () => openTradeModal(b.dataset.quickSell, "sell"));
    });
  }

  if (!paper.trades.length) {
    els.tradeLog.innerHTML = '<li class="empty-msg">No trades yet.</li>';
  } else {
    els.tradeLog.innerHTML = paper.trades
      .slice(0, 25)
      .map(
        (t) => `<li>
        <span class="trade-side ${t.side}">${t.side.toUpperCase()}</span>
        <span>${t.shares} ${t.symbol} @ ${formatMoney(t.price, currency)}</span>
        <span class="note-date">${new Date(t.at).toLocaleString()}</span>
      </li>`
      )
      .join("");
  }
}

async function generateDailyReport(silent = false) {
  if (!Object.keys(currentQuotes).length) {
    if (!silent) alert("Load live prices first (AI Predictions tab → Refresh).");
    return;
  }

  const paper = getPaper();
  const payload = {
    market: state.market,
    paper: {
      cash: paper.cash,
      startEquity: paper.startEquity,
      positions: paper.positions,
    },
    signals: Object.values(currentQuotes),
  };

  els.btnGenReport.disabled = true;
  els.dailyReport.innerHTML = '<p class="loading-banner">Generating expert desk report from live prices…</p>';

  let report = null;
  let apiError = "";

  if (isLive && serverHasDailyReport()) {
    try {
      const res = await fetch(`${API_BASE}/api/daily-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        report = data;
      } else {
        apiError = data.error || `HTTP ${res.status}`;
      }
    } catch (e) {
      apiError = e.message || "Network error";
    }
  } else if (isLive && !serverHasDailyReport()) {
    apiError = "Server outdated (restart with .\\start.ps1)";
  }

  if (!report) {
    report = buildLocalDailyReport();
    if (!silent && apiError) {
      els.errorBanner.hidden = false;
      els.errorBanner.textContent = `Used browser report (${apiError}). Restart server for full server report.`;
    }
  }

  try {
    saveAndShowReport(report);
  } catch (e) {
    els.dailyReport.innerHTML = `<p class="error-banner">Report error: ${escapeHtml(e.message)}</p>`;
  } finally {
    els.btnGenReport.disabled = false;
  }
}

function renderDailyReport(report) {
  const currency = report.currency || MARKETS[state.market].currency;
  const sections = (report.sections || [])
    .map((s) => `<section class="report-section"><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.body).replace(/\n/g, "<br>")}</p></section>`)
    .join("");

  const holdings = (report.holdings || [])
    .map(
      (h) => `<tr>
      <td>${h.symbol}</td><td>${h.shares}</td>
      <td>${formatMoney(h.avgCost, currency)}</td>
      <td>${formatMoney(h.currentPrice, currency)}</td>
      <td class="${h.unrealizedPL >= 0 ? "up" : "down"}">${formatMoney(h.unrealizedPL, currency)} (${formatPct(h.unrealizedPLPct)})</td>
      <td>${formatPct(h.dayChangePct)}</td>
    </tr>`
    )
    .join("");

  els.dailyReport.innerHTML = `
    <header class="report-header">
      <h3>Desk report — ${escapeHtml(report.date)}</h3>
      <p>Equity <strong>${formatMoney(report.equity, currency)}</strong> ·
      Return <strong class="${report.totalReturnPct >= 0 ? "up" : "down"}">${formatPct(report.totalReturnPct)}</strong> ·
      Unrealized <strong>${formatMoney(report.unrealizedPL, currency)}</strong></p>
    </header>
    ${sections}
    <section class="report-section">
      <h3>Holdings (live marks)</h3>
      <div class="table-wrap"><table class="portfolio-table">
        <thead><tr><th>Symbol</th><th>Qty</th><th>Bought at</th><th>Last</th><th>P/L</th><th>Today</th></tr></thead>
        <tbody>${holdings || '<tr><td colspan="6">No positions</td></tr>'}</tbody>
      </table></div>
    </section>
  `;
}

function renderReportHistory() {
  const items = state.dailyReports.filter((r) => r.market === state.market);
  if (!items.length) {
    els.reportHistory.innerHTML = '<li class="empty-msg">No saved reports.</li>';
    return;
  }
  els.reportHistory.innerHTML = items
    .map(
      (r, i) => `<li><button type="button" class="link-btn" data-report-idx="${i}">
      ${r.date} — ${formatMoney(r.equity, r.currency)} (${formatPct(r.totalReturnPct)})
    </button></li>`
    )
    .join("");
  els.reportHistory.querySelectorAll("[data-report-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const r = items[Number(btn.dataset.reportIdx)];
      renderDailyReport(r);
      els.reportMeta.textContent = `Archived ${r.date}`;
    });
  });
}

function maybeAutoDailyReport() {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${state.market}-${today}`;
  if (state.lastAutoReportKey === key || !Object.keys(currentQuotes).length) return;
  state.lastAutoReportKey = key;
  saveState();
  generateDailyReport(true);
}

function setMarket(market) {
  if (state.market === market) return;
  if (expandedSymbol) destroyCandleChart(expandedSymbol);
  state.market = market;
  expandedSymbol = null;
  saveState();
  syncMarketUI();
  runAnalysis();
}

function syncMarketUI() {
  const m = MARKETS[state.market];
  els.btnUs.classList.toggle("active", state.market === "us");
  els.btnCa.classList.toggle("active", state.market === "ca");
  els.marketHint.textContent = m.hint;
  els.modalCurrency.textContent = m.currency;
}

const views = {
  predictions: {
    title: "AI Predictions",
    sub: "Click a stock for full buy/sell thesis · Ensemble model 72–92%",
    el: () => els.viewPredictions,
    onEnter: scheduleAutoRefresh,
    onLeave: clearAutoRefresh,
  },
  paper: {
    title: "Paper Trading",
    sub: "Simulated fills at latest live quote — $100k starting capital per market",
    el: () => els.viewPaper,
    onEnter: () => renderPaper(),
  },
  report: {
    title: "Daily Report",
    sub: "Automated desk note with gains, entries, and live marks",
    el: () => els.viewReport,
    onEnter: () => {
      const last = state.dailyReports.find((r) => r.market === state.market);
      if (last) renderDailyReport(last);
      renderReportHistory();
    },
  },
  organizer: {
    title: "Organizer",
    sub: "Paper trading hub, watchlist, manual portfolio, notes",
    el: () => els.viewOrganizer,
    onEnter: () => renderOrganizer(),
  },
};

let activeView = "predictions";

function setView(view) {
  if (!views[view]) return;
  views[activeView]?.onLeave?.();
  activeView = view;
  Object.keys(views).forEach((k) => {
    const v = views[k].el();
    const on = k === view;
    v.hidden = !on;
    v.classList.toggle("active", on);
  });
  els.navItems.forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  els.viewTitle.textContent = views[view].title;
  els.viewSubtitle.textContent = views[view].sub;
  views[view].onEnter?.();
}

function scheduleAutoRefresh() {
  clearAutoRefresh();
  refreshTimer = setInterval(() => {
    if (activeView === "predictions") runAnalysis();
  }, REFRESH_MS);
}

function clearAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function getQuoteForSymbol(symbol) {
  const sym = symbol.toUpperCase().replace(".TO", "");
  return currentQuotes[sym] || { symbol: sym, price: null, changePct: 0 };
}

function getAllPaperTrades() {
  const rows = [];
  for (const mkt of ["us", "ca"]) {
    for (const t of state.paper[mkt].trades || []) {
      rows.push({ ...t, market: mkt });
    }
  }
  rows.sort((a, b) => new Date(b.at) - new Date(a.at));
  return rows;
}

function renderPaperHub() {
  if (!els.paperHubPositions) return;

  let totalStart = 0;
  let usEquity = 0;
  let caEquity = 0;
  const positionRows = [];

  for (const mkt of ["us", "ca"]) {
    const paper = state.paper[mkt];
    const currency = MARKETS[mkt].currency;
    totalStart += paper.startEquity;
    const { equity } = computePaperEquityForMarket(mkt);
    if (mkt === "us") usEquity = equity;
    else caEquity = equity;

    for (const pos of paper.positions) {
      let px = pos.avgCost;
      let ch = 0;
      if (mkt === state.market) {
        const q = getQuoteForSymbol(pos.symbol);
        if (q.price != null) {
          px = q.price;
          ch = q.changePct ?? 0;
        }
      }
      const mv = px * pos.shares;
      const pl = (px - pos.avgCost) * pos.shares;
      const plPct = pos.avgCost ? ((px - pos.avgCost) / pos.avgCost) * 100 : 0;
      positionRows.push({ mkt, currency, pos, px, pl, plPct, ch });
    }
  }

  const totalEquity = usEquity + caEquity;
  const totalRet = totalStart ? ((totalEquity - totalStart) / totalStart) * 100 : 0;
  els.paperHubMeta.textContent = "Simulated accounts · separate $100k US & CA";
  els.paperHubStats.innerHTML = `
    <div class="stat-card"><span class="label">US paper equity</span><span class="value">${formatMoney(usEquity, "USD")}</span></div>
    <div class="stat-card"><span class="label">CA paper equity</span><span class="value">${formatMoney(caEquity, "CAD")}</span></div>
    <div class="stat-card ${totalRet >= 0 ? "buy" : "sell"}"><span class="label">Blended return</span><span class="value">${formatPct(totalRet)}</span></div>
    <div class="stat-card"><span class="label">Total trades</span><span class="value">${getAllPaperTrades().length}</span></div>
  `;

  if (!positionRows.length) {
    els.paperHubPositions.innerHTML =
      '<tr><td colspan="7"><p class="empty-msg">No paper positions — expand a stock and click Paper buy.</p></td></tr>';
  } else {
    els.paperHubPositions.innerHTML = positionRows
      .map(
        ({ mkt, currency, pos, px, pl, plPct, ch }) => `<tr>
        <td>${mkt.toUpperCase()}</td>
        <td>${pos.symbol}</td>
        <td>${pos.shares}</td>
        <td>${formatMoney(pos.avgCost, currency)}</td>
        <td>${formatMoney(px, currency)} <span class="muted">${formatPct(ch)}</span></td>
        <td class="${pl >= 0 ? "up" : "down"}">${formatMoney(pl, currency)} (${formatPct(plPct)})</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-hub-sell="${pos.symbol}" data-hub-market="${mkt}">Sell</button></td>
      </tr>`
      )
      .join("");
    els.paperHubPositions.querySelectorAll("[data-hub-sell]").forEach((b) => {
      b.addEventListener("click", () => {
        state.market = b.dataset.hubMarket;
        syncMarketUI();
        openTradeModal(b.dataset.hubSell, "sell");
      });
    });
  }

  const trades = getAllPaperTrades();
  if (!trades.length) {
    els.paperHubTrades.innerHTML = '<li class="empty-msg">No paper trades yet.</li>';
  } else {
    els.paperHubTrades.innerHTML = trades
      .map((t) => {
        const cur = MARKETS[t.market].currency;
        return `<li>
          <span class="trade-side ${t.side}">${t.side.toUpperCase()}</span>
          <span class="watch-symbol">${t.market.toUpperCase()}</span>
          <span>${t.shares} ${t.symbol} @ ${formatMoney(t.price, cur)}</span>
          <span class="note-date">${new Date(t.at).toLocaleString()}</span>
        </li>`;
      })
      .join("");
  }
}

function computePaperEquityForMarket(mkt) {
  const paper = state.paper[mkt];
  let posVal = 0;
  let unrealized = 0;
  for (const p of paper.positions) {
    let px = p.avgCost;
    if (mkt === state.market) {
      const q = getQuoteForSymbol(p.symbol);
      if (q.price != null) px = q.price;
    }
    posVal += px * p.shares;
    unrealized += (px - p.avgCost) * p.shares;
  }
  return { equity: paper.cash + posVal, unrealized, paper };
}

function renderOrganizer() {
  renderPaperHub();
  const currency = MARKETS[state.market].currency;
  if (!state.watchlist.length) {
    els.watchlist.innerHTML = '<p class="empty-msg">Add symbols to track.</p>';
  } else {
    els.watchlist.innerHTML = state.watchlist
      .map((sym) => {
        const q = getQuoteForSymbol(sym);
        return `<li><span class="watch-symbol">${sym}</span>
          <span class="watch-price">${formatMoney(q.price, currency)} ${formatPct(q.changePct)}</span>
          <button type="button" class="icon-btn" data-remove-watch="${sym}">×</button></li>`;
      })
      .join("");
    els.watchlist.querySelectorAll("[data-remove-watch]").forEach((b) => {
      b.addEventListener("click", () => {
        state.watchlist = state.watchlist.filter((s) => s !== b.dataset.removeWatch);
        saveState();
        renderOrganizer();
      });
    });
  }

  if (!state.portfolio.length) {
    els.portfolioBody.innerHTML = '<tr><td colspan="5"><p class="empty-msg">No positions.</p></td></tr>';
    els.portfolioTotal.textContent = formatMoney(0, currency);
  } else {
    let total = 0;
    els.portfolioBody.innerHTML = state.portfolio
      .map((p, idx) => {
        const q = getQuoteForSymbol(p.symbol);
        const px = q.price ?? p.cost;
        const val = px * p.shares;
        total += val;
        return `<tr><td>${p.symbol}</td><td>${p.shares}</td><td>${formatMoney(p.cost, currency)}</td>
          <td>${formatMoney(val, currency)}</td>
          <td><button type="button" class="icon-btn" data-remove-pos="${idx}">×</button></td></tr>`;
      })
      .join("");
    els.portfolioTotal.textContent = formatMoney(total, currency);
    els.portfolioBody.querySelectorAll("[data-remove-pos]").forEach((b) => {
      b.addEventListener("click", () => {
        state.portfolio.splice(Number(b.dataset.removePos), 1);
        saveState();
        renderOrganizer();
      });
    });
  }

  if (!state.notes.length) els.notesList.innerHTML = '<p class="empty-msg">No notes.</p>';
  else {
    els.notesList.innerHTML = state.notes
      .map(
        (n) => `<li><span class="note-text">${escapeHtml(n.text)}</span>
        <span class="note-date">${new Date(n.at).toLocaleDateString()}</span>
        <button type="button" class="icon-btn" data-remove-note="${n.id}">×</button></li>`
      )
      .join("");
    els.notesList.querySelectorAll("[data-remove-note]").forEach((b) => {
      b.addEventListener("click", () => {
        state.notes = state.notes.filter((n) => n.id !== b.dataset.removeNote);
        saveState();
        renderOrganizer();
      });
    });
  }

  const saved = state.saved.filter((s) => s.market === state.market);
  if (!saved.length) els.savedList.innerHTML = '<p class="empty-msg">No saved signals.</p>';
  else {
    els.savedList.innerHTML = saved
      .map(
        (s) => `<li><span><span class="saved-tag ${s.action}">${s.action.toUpperCase()}</span> ${s.symbol}</span>
        <span>${s.confidence}% · ${formatMoney(s.price, currency)}</span>
        <button type="button" class="icon-btn" data-remove-saved="${s.id}">×</button></li>`
      )
      .join("");
    els.savedList.querySelectorAll("[data-remove-saved]").forEach((b) => {
      b.addEventListener("click", () => {
        state.saved = state.saved.filter((s) => s.id !== b.dataset.removeSaved);
        saveState();
        renderOrganizer();
      });
    });
  }
}

els.btnUs.addEventListener("click", () => setMarket("us"));
els.btnCa.addEventListener("click", () => setMarket("ca"));
els.navItems.forEach((n) => n.addEventListener("click", () => setView(n.dataset.view)));
els.btnRefresh.addEventListener("click", () => runAnalysis());
els.btnGenReport.addEventListener("click", () => generateDailyReport(false));
els.btnResetPaper.addEventListener("click", () => {
  if (confirm("Reset paper account to $100,000?")) {
    state.paper[state.market] = defaultPaper();
    saveState();
    renderPaper();
    renderPaperHub();
  }
});
els.tradeCancel.addEventListener("click", () => els.tradeModal.close());
els.tradeForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(els.tradeForm);
  executePaperTrade(fd.get("symbol"), fd.get("side"), Number(fd.get("shares")));
});

els.watchlistForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const sym = els.watchlistInput.value.trim().toUpperCase().replace(".TO", "");
  if (sym && !state.watchlist.includes(sym)) {
    state.watchlist.push(sym);
    saveState();
  }
  els.watchlistInput.value = "";
  await refreshWatchlistQuotes();
  renderOrganizer();
});

els.btnAddPosition.addEventListener("click", () => els.positionModal.showModal());
els.positionCancel.addEventListener("click", () => els.positionModal.close());
els.positionForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const fd = new FormData(els.positionForm);
  state.portfolio.push({
    symbol: String(fd.get("symbol")).toUpperCase(),
    shares: Number(fd.get("shares")),
    cost: Number(fd.get("cost")),
  });
  saveState();
  els.positionForm.reset();
  els.positionModal.close();
  renderOrganizer();
});

els.noteForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.noteInput.value.trim();
  if (!text) return;
  state.notes.unshift({ id: `n-${Date.now()}`, text, at: Date.now() });
  saveState();
  els.noteInput.value = "";
  renderOrganizer();
});

els.btnClearSaved.addEventListener("click", () => {
  state.saved = state.saved.filter((s) => s.market !== state.market);
  saveState();
  renderOrganizer();
});

async function init() {
  syncMarketUI();
  setView("predictions");
  if (await checkApi()) {
    if (!serverHasDailyReport()) {
      showError("Server is outdated — close it and run .\\start.ps1 (daily report will still work in-browser).");
    }
    await runAnalysis();
    scheduleAutoRefresh();
    maybeAutoDailyReport();
  } else {
    setDataBadge("offline", "○ Start server");
    showError("Run: .\\start.ps1 or python server.py");
    els.btnRefresh.disabled = false;
  }
}

init();
