async function applyTheme() {
  const { theme = 'system' } = await chrome.storage.local.get('theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const effective = theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme;
  document.body.setAttribute('data-theme', effective);
}

applyTheme();

function formatPrice(value) {
  if (value == null) return '--';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChange(value) {
  if (value == null) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function formatChangePct(value) {
  if (value == null) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(timestamp) {
  if (!timestamp) return '--';
  const d = new Date(timestamp);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatSession(session) {
  if (session === 'pre') return '盘前';
  if (session === 'regular') return '盘中';
  if (session === 'post') return '盘后';
  return '';
}

const DEFAULT_SYMBOLS = [
  { key: 'GC=F', yahoo: 'GC=F', label: '' },
  { key: 'SI=F', yahoo: 'SI=F', label: '' },
  { key: 'HG=F', yahoo: 'HG=F', label: '' },
  { key: 'BTC-USD', yahoo: 'BTC-USD', label: '' },
  { key: 'ETH-USD', yahoo: 'ETH-USD', label: '' },
];

async function getSymbols() {
  const { symbols } = await chrome.storage.local.get('symbols');
  return Array.isArray(symbols) && symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;
}

async function renderPrices() {
  const { prices = {}, lastUpdate, compactMode } = await chrome.storage.local.get(['prices', 'lastUpdate', 'compactMode']);
  const symbols = await getSymbols();
  const container = document.getElementById('prices');
  const status = document.getElementById('status');
  container.innerHTML = '';

  if (symbols.length === 0) {
    container.innerHTML = '<div class="loading">暂无追踪品种，请前往设置添加</div>';
    status.textContent = '--';
    return;
  }

  for (const symbol of symbols) {
    const item = prices[symbol.key];
    const card = document.createElement('div');
    card.className = 'card';
    if (compactMode) card.classList.add('compact');
    if (item?.error) card.classList.add('error');

    const titleRow = document.createElement('div');
    titleRow.className = 'symbol-row';

    const title = document.createElement('div');
    title.className = 'symbol';
    title.textContent = symbol.label ? `${symbol.key} · ${symbol.label}` : symbol.key;

    const session = document.createElement('span');
    session.className = 'session-tag';
    const sessionText = formatSession(item?.session);
    if (sessionText) {
      session.classList.add(item.session);
      session.textContent = sessionText;
    }

    titleRow.appendChild(title);
    if (sessionText) titleRow.appendChild(session);

    const priceRow = document.createElement('div');
    priceRow.className = 'price-row';

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = formatPrice(item?.price);

    const changeWrap = document.createElement('div');
    changeWrap.className = 'change-wrap';

    const change = document.createElement('span');
    change.className = 'change';
    if (item?.change != null) {
      change.classList.add(item.change >= 0 ? 'up' : 'down');
    }
    change.textContent = formatChange(item?.change);

    const changePct = document.createElement('span');
    changePct.className = 'change-pct';
    if (item?.changePct != null) {
      changePct.classList.add(item.changePct >= 0 ? 'up' : 'down');
    }
    changePct.textContent = formatChangePct(item?.changePct);

    changeWrap.appendChild(change);
    changeWrap.appendChild(changePct);
    priceRow.appendChild(price);
    priceRow.appendChild(changeWrap);

    card.appendChild(titleRow);
    card.appendChild(priceRow);

    if (item?.error) {
      const error = document.createElement('div');
      error.className = 'error-msg';
      error.textContent = item.error;
      card.appendChild(error);
    }

    container.appendChild(card);
  }

  status.textContent = `更新于 ${formatTime(lastUpdate)}`;
}

async function fetchPricesInPopup() {
  const symbols = await getSymbols();
  if (symbols.length === 0) return;

  const results = await Promise.all(symbols.map(async (symbol) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.yahoo)}?interval=5m&range=1d&includePrePost=true`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const result = data.chart?.result?.[0];
      if (!result) throw new Error('无数据');
      const parsed = parseChartResult(result);
      return {
        key: symbol.key,
        label: symbol.label,
        ...parsed,
        timestamp: Date.now(),
        error: null,
      };
    } catch (err) {
      return {
        key: symbol.key,
        label: symbol.label,
        price: null,
        change: null,
        changePct: null,
        session: null,
        currency: 'USD',
        timestamp: Date.now(),
        error: err.message,
      };
    }
  }));
  const prices = {};
  for (const r of results) prices[r.key] = r;
  await chrome.storage.local.set({ prices, lastUpdate: Date.now() });
}

function parseChartResult(result) {
  const meta = result.meta;
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];

  let price = null;
  let priceTime = null;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] != null) {
      price = closes[i];
      priceTime = timestamps[i] != null ? timestamps[i] * 1000 : null;
      break;
    }
  }

  if (price == null) {
    price = meta.regularMarketPrice ?? meta.previousClose ?? null;
    priceTime = meta.regularMarketTime ? meta.regularMarketTime * 1000 : null;
  }

  const prev = meta.previousClose || meta.chartPreviousClose || price;
  const change = price != null && prev != null ? price - prev : null;
  const changePct = change != null && prev ? (change / prev) * 100 : null;
  const session = resolveSession(meta, priceTime);

  return {
    price,
    change,
    changePct,
    session,
    currency: meta.currency || 'USD',
  };
}

function resolveSession(meta, priceTime) {
  const period = meta.currentTradingPeriod;
  if (!period || !priceTime) return null;
  const t = Math.floor(priceTime / 1000);
  if (period.pre && t >= period.pre.start && t < period.pre.end) return 'pre';
  if (period.regular && t >= period.regular.start && t < period.regular.end) return 'regular';
  if (period.post && t >= period.post.start && t < period.post.end) return 'post';
  return null;
}

async function refreshFromPopup() {
  const status = document.getElementById('status');
  status.textContent = '刷新中...';
  try {
    await chrome.runtime.sendMessage({ action: 'refresh' });
  } catch (e) {
    await fetchPricesInPopup();
  }
  await renderPrices();
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'prices-updated') {
    renderPrices();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  await renderPrices();
  document.getElementById('refresh').addEventListener('click', refreshFromPopup);
  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  await refreshFromPopup();
});
