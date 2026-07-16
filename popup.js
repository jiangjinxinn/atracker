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
  { key: 'hf_GC', sina: 'hf_GC', label: '纽约金', visible: false },
  { key: 'hf_SI', sina: 'hf_SI', label: '纽约银', visible: false },
  { key: 'hf_HG', sina: 'hf_HG', label: '纽约铜', visible: false },
  { key: 'hf_CL', sina: 'hf_CL', label: '纽约原油', visible: false },
  { key: 'hf_XAU', sina: 'hf_XAU', label: '伦敦金', visible: true },
  { key: 'hf_XAG', sina: 'hf_XAG', label: '伦敦银', visible: true },
  { key: 'hf_CAD', sina: 'hf_CAD', label: '伦敦铜', visible: true },
  { key: 'sh603993', sina: 'sh603993', label: '', visible: true },
];

async function getSymbols() {
  const { symbols } = await chrome.storage.local.get('symbols');
  return Array.isArray(symbols) && symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;
}

async function addFetchLog(entry) {
  const { fetchLogs = [] } = await chrome.storage.local.get('fetchLogs');
  fetchLogs.unshift({ time: Date.now(), ...entry });
  if (fetchLogs.length > 50) fetchLogs.pop();
  await chrome.storage.local.set({ fetchLogs });
}

async function renderPrices() {
  const { prices = {}, lastUpdate, compactMode } = await chrome.storage.local.get(['prices', 'lastUpdate', 'compactMode']);
  const symbols = await getSymbols();
  const visibleSymbols = symbols.filter((s) => s.visible !== false);
  const container = document.getElementById('prices');
  const status = document.getElementById('status');
  container.innerHTML = '';

  if (visibleSymbols.length === 0) {
    container.innerHTML = '<div class="loading">当前没有启用的品种，请前往设置开启</div>';
    status.textContent = '--';
    return;
  }

  for (const symbol of visibleSymbols) {
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

    titleRow.appendChild(title);

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

async function fetchFromSina(symbol) {
  const url = `https://hq.sinajs.cn/list=${encodeURIComponent(symbol.sina)}`;
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);
    if (!res.ok) {
      await addFetchLog({ code: symbol.sina, url, status: res.status, ok: false, preview: text.slice(0, 300) });
      throw new Error(`新浪 HTTP ${res.status}`);
    }
    const match = text.match(new RegExp(`var hq_str_${symbol.sina}="([^"]*)";`));
    if (!match) {
      await addFetchLog({ code: symbol.sina, url, status: res.status, ok: false, preview: text.slice(0, 300), error: '未匹配到数据' });
      throw new Error('新浪无数据');
    }
    const raw = match[1];
    if (!raw) {
      await addFetchLog({ code: symbol.sina, url, status: res.status, ok: false, preview: text.slice(0, 300), error: '返回数据为空' });
      throw new Error('新浪数据为空');
    }
    await addFetchLog({ code: symbol.sina, url, status: res.status, ok: true, preview: text.slice(0, 200) });
    return parseSinaRaw(symbol.sina, raw);
  } catch (err) {
    if (!err.message?.startsWith('新浪')) {
      await addFetchLog({ code: symbol.sina, url, status: null, ok: false, error: err.message });
    }
    throw err;
  }
}

function parseSinaRaw(sinaCode, raw) {
  const parts = raw.split(',');

  if (sinaCode.startsWith('hf_')) {
    if (parts.length < 14) throw new Error('新浪数据不完整');
    const price = parseFloat(parts[0]);
    const prevClose = parseFloat(parts[7]);
    if (Number.isNaN(price) || Number.isNaN(prevClose)) {
      throw new Error('新浪价格无效');
    }
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : null;
    return {
      price,
      change,
      changePct,
      session: null,
      currency: 'USD',
      name: parts[13] || '',
    };
  }

  if (/^(sh|sz|bj)\d{6}$/.test(sinaCode)) {
    if (parts.length < 4) throw new Error('新浪数据不完整');
    const name = parts[0] || '';
    const price = parseFloat(parts[3]);
    const prevClose = parseFloat(parts[2]);
    if (Number.isNaN(price) || Number.isNaN(prevClose)) {
      throw new Error('新浪价格无效');
    }
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : null;
    return {
      price,
      change,
      changePct,
      session: null,
      currency: 'CNY',
      name,
    };
  }

  throw new Error('不支持的新浪代码类型');
}

async function fetchSymbolForPopup(symbol) {
  if (!symbol.sina) {
    return {
      key: symbol.key,
      label: symbol.label,
      price: null,
      change: null,
      changePct: null,
      session: null,
      currency: 'USD',
      timestamp: Date.now(),
      error: '无新浪代码',
    };
  }

  try {
    const parsed = await fetchFromSina(symbol);
    return {
      key: symbol.key,
      label: symbol.label || parsed.name || symbol.key,
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
}

async function fetchPricesInPopup() {
  const symbols = await getSymbols();
  if (symbols.length === 0) return;

  const results = await Promise.all(symbols.map(fetchSymbolForPopup));
  const prices = {};
  for (const r of results) prices[r.key] = r;
  await chrome.storage.local.set({ prices, lastUpdate: Date.now() });
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
