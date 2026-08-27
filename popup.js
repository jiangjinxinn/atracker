async function applyTheme() {
  const { theme = 'system' } = await chrome.storage.local.get('theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const effective = theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme;
  document.body.setAttribute('data-theme', effective);
}

applyTheme();

function formatPrice(item) {
  if (item?.price == null) return '--';
  const digits = item.priceDigits ?? 2;
  return item.price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatChange(item) {
  if (item?.change == null) return '--';
  const sign = item.change > 0 ? '+' : '';
  return `${sign}${item.change.toFixed(item.changeDigits ?? 2)}`;
}

function formatChangePct(item) {
  if (item?.changePct == null) return '--';
  const sign = item.changePct > 0 ? '+' : '';
  return `${sign}${item.changePct.toFixed(item.changePctDigits ?? 2)}%`;
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
  const { prices = {}, compactMode } = await chrome.storage.local.get(['prices', 'compactMode']);
  const symbols = await getSymbols();
  const visibleSymbols = symbols.filter((s) => s.visible !== false);
  const container = document.getElementById('prices');
  container.innerHTML = '';

  if (visibleSymbols.length === 0) {
    container.innerHTML = '<div class="loading">当前没有启用的品种，请前往设置开启</div>';
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

    const sessionText = formatSession(item?.session);
    if (sessionText) {
      const sessionTag = document.createElement('span');
      sessionTag.className = `session-tag ${item.session}`;
      sessionTag.textContent = sessionText;
      titleRow.appendChild(sessionTag);
    }

    const priceRow = document.createElement('div');
    priceRow.className = 'price-row';

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = formatPrice(item);

    const changeWrap = document.createElement('div');
    changeWrap.className = 'change-wrap';

    const change = document.createElement('span');
    change.className = 'change';
    if (item?.change != null) {
      change.classList.add(item.change >= 0 ? 'up' : 'down');
    }
    change.textContent = formatChange(item);

    const changePct = document.createElement('span');
    changePct.className = 'change-pct';
    if (item?.changePct != null) {
      changePct.classList.add(item.changePct >= 0 ? 'up' : 'down');
    }
    changePct.textContent = formatChangePct(item);

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
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchFromSina(symbol) {
  const url = `https://hq.sinajs.cn/rn=${Date.now()}&list=${encodeURIComponent(symbol.sina)}`;
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);
    if (!res.ok) {
      await addFetchLog({ code: symbol.sina, url, status: res.status, ok: false, preview: text.slice(0, 300) });
      throw new Error(`新浪 HTTP ${res.status}`);
    }
    const match = text.match(new RegExp(`var hq_str_${escapeRegExp(symbol.sina)}="([^"]*)";`));
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

function parseSinaNumber(value) {
  const number = parseFloat(value);
  return Number.isNaN(number) ? null : number;
}

function requireSinaNumber(value) {
  const number = parseSinaNumber(value);
  if (number == null) throw new Error('新浪价格无效');
  return number;
}

function buildQuote({
  price,
  prevClose = null,
  change = null,
  changePct = null,
  session = null,
  currency = 'USD',
  name = '',
  priceDigits = 2,
  changeDigits = 2,
  changePctDigits = 2,
}) {
  const resolvedChange = change ?? (prevClose != null ? price - prevClose : null);
  const resolvedChangePct = changePct ?? (prevClose ? (resolvedChange / prevClose) * 100 : null);
  return {
    price,
    change: resolvedChange,
    changePct: resolvedChangePct,
    session,
    currency,
    name,
    priceDigits,
    changeDigits,
    changePctDigits,
  };
}

function parseGenericSinaRaw(parts) {
  const price = parts.map(parseSinaNumber).find((value) => value != null);
  if (price == null) throw new Error('新浪价格无效');
  const name = parts.find((part) => part && parseSinaNumber(part) == null && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(part)) || '';
  return buildQuote({ price, name });
}

function getUsMarketSession() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return null;
  const minutes = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
  if (minutes >= 240 && minutes < 570) return 'pre';
  if (minutes >= 570 && minutes < 960) return 'regular';
  if (minutes >= 960 && minutes < 1200) return 'post';
  return null;
}

// 从新浪扩展时段时间（如 "Jul 30 08:01PM EDT"）判断该笔数据属于盘前还是盘后
function getUsExtSession(extTime) {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(extTime || '');
  if (!match) return null;
  const hour = (parseInt(match[1], 10) % 12) + (/PM/i.test(match[3]) ? 12 : 0);
  const minutes = hour * 60 + parseInt(match[2], 10);
  return minutes < 570 ? 'pre' : 'post';
}

function parseSinaRaw(sinaCode, raw) {
  const parts = raw.split(',');

  if (sinaCode.startsWith('hf_')) {
    if (parts.length < 14) throw new Error('新浪数据不完整');
    const price = requireSinaNumber(parts[0]);
    const prevClose = requireSinaNumber(parts[7]);
    return buildQuote({
      price,
      prevClose,
      currency: 'USD',
      name: parts[13] || '',
    });
  }

  if (/^(sh|sz|bj)\d{6}$/.test(sinaCode)) {
    if (parts.length < 4) throw new Error('新浪数据不完整');
    const price = requireSinaNumber(parts[3]);
    const prevClose = requireSinaNumber(parts[2]);
    return buildQuote({
      price,
      prevClose,
      currency: 'CNY',
      name: parts[0] || '',
    });
  }

  if (/^hk\d{5}$/.test(sinaCode)) {
    if (parts.length < 9) throw new Error('新浪数据不完整');
    const price = requireSinaNumber(parts[6]);
    const prevClose = requireSinaNumber(parts[3]);
    return buildQuote({
      price,
      prevClose,
      change: parseSinaNumber(parts[7]),
      changePct: parseSinaNumber(parts[8]),
      currency: 'HKD',
      name: parts[1] || parts[0] || '',
    });
  }

  if (sinaCode.startsWith('globalbd_')) {
    if (parts.length < 9) throw new Error('新浪数据不完整');
    return buildQuote({
      price: requireSinaNumber(parts[1]),
      change: parseSinaNumber(parts[8]),
      changePct: parseSinaNumber(parts[7]),
      name: parts[0] || '',
      priceDigits: 3,
      changeDigits: 4,
      changePctDigits: 4,
    });
  }

  if (sinaCode.startsWith('gb_')) {
    if (parts.length < 5) throw new Error('新浪数据不完整');
    const price = requireSinaNumber(parts[1]);
    const name = parts[0] || '';
    const session = getUsMarketSession();
    // 非盘中时段优先展示扩展时段数据：21=价格，22=涨跌幅，23=涨跌额，24=时间
    // 时段标签取自字段24，因此收盘后（20:00 之后）与周末仍会保留最后一笔盘后价
    if (session !== 'regular' && parts.length >= 25) {
      const extPrice = parseSinaNumber(parts[21]);
      const extSession = getUsExtSession(parts[24]);
      if (extPrice != null && extPrice > 0 && extSession) {
        return buildQuote({
          price: extPrice,
          change: parseSinaNumber(parts[23]),
          changePct: parseSinaNumber(parts[22]),
          session: extSession,
          currency: 'USD',
          name,
        });
      }
    }
    return buildQuote({
      price,
      change: parseSinaNumber(parts[4]),
      changePct: parseSinaNumber(parts[2]),
      session: session === 'regular' ? 'regular' : null,
      currency: 'USD',
      name,
    });
  }

  return parseGenericSinaRaw(parts);
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

function syncSymbolLabels(symbols, results) {
  const resultByKey = new Map(results.map((result) => [result.key, result]));
  let changed = false;
  const nextSymbols = symbols.map((symbol) => {
    if (symbol.label) return symbol;
    const name = resultByKey.get(symbol.key)?.name;
    if (!name) return symbol;
    changed = true;
    return { ...symbol, label: name };
  });
  return changed ? nextSymbols : symbols;
}

async function fetchPricesInPopup() {
  const symbols = await getSymbols();
  if (symbols.length === 0) return;

  const results = await Promise.all(symbols.map(fetchSymbolForPopup));
  const prices = {};
  for (const r of results) prices[r.key] = r;
  const symbolsWithLabels = syncSymbolLabels(symbols, results);
  const now = Date.now();
  await chrome.storage.local.set({ prices, symbols: symbolsWithLabels, lastUpdate: now });
}

async function refreshFromPopup() {
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
  await refreshFromPopup();
});
