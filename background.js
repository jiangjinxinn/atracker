const DEFAULT_SYMBOLS = [
  { key: 'GC=F', yahoo: 'GC=F', label: '' },
  { key: 'SI=F', yahoo: 'SI=F', label: '' },
  { key: 'HG=F', yahoo: 'HG=F', label: '' },
  { key: 'BTC-USD', yahoo: 'BTC-USD', label: '' },
  { key: 'ETH-USD', yahoo: 'ETH-USD', label: '' },
];

const DEFAULT_BADGE_SYMBOL = 'GC=F';

const ALARM_NAME = 'refresh-prices';
const UPDATE_INTERVAL_MIN = 1;

async function getSymbols() {
  const { symbols } = await chrome.storage.local.get('symbols');
  return Array.isArray(symbols) && symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;
}

async function fetchSymbol(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.yahoo)}?interval=1d&range=1d`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('无数据');
    const meta = result.meta;
    const price = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const prev = meta.previousClose || meta.chartPreviousClose || price;
    const change = price != null && prev != null ? price - prev : null;
    const changePct = change != null && prev ? (change / prev) * 100 : null;
    return {
      key: symbol.key,
      label: symbol.label,
      price,
      change,
      changePct,
      currency: meta.currency || 'USD',
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
      currency: 'USD',
      timestamp: Date.now(),
      error: err.message,
    };
  }
}

function formatTooltipPrice(value) {
  if (value == null) return '—';
  return value.toFixed(2);
}

function formatTooltipChangePct(pct) {
  if (pct == null) return '';
  const sign = pct >= 0 ? '+' : '';
  return ` (${sign}${pct.toFixed(2)}%)`;
}

async function updateActionTitle(results) {
  const lines = [];
  for (const r of results) {
    const price = formatTooltipPrice(r.price);
    const change = formatTooltipChangePct(r.changePct);
    lines.push(`${r.key}: ${price}${change}`);
  }
  chrome.action.setTitle({ title: lines.join('\n') });
}

async function refreshPrices() {
  const symbols = await getSymbols();
  const results = await Promise.all(symbols.map(fetchSymbol));
  const prices = {};
  for (const r of results) prices[r.key] = r;
  await chrome.storage.local.set({ prices, lastUpdate: Date.now() });

  await updateBadge(results, prices);
  await updateActionTitle(results);

  chrome.runtime.sendMessage({ action: 'prices-updated' }).catch(() => {});
}

async function formatBadgePrice(value) {
  if (value == null) return '';
  const { badgeFullNumber } = await chrome.storage.local.get('badgeFullNumber');
  if (badgeFullNumber) {
    const two = value.toFixed(2);
    if (two.length <= 4) return two;
    const one = value.toFixed(1);
    if (one.length <= 4) return one;
    return value.toFixed(0);
  }
  let text = value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  if (text.length > 4) {
    text = value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 0 });
  }
  return text;
}

async function updateBadge(results, prices) {
  const { badgeSymbol } = await chrome.storage.local.get('badgeSymbol');

  if (badgeSymbol === null || badgeSymbol === '') {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  let target = null;

  if (badgeSymbol && prices[badgeSymbol]?.price != null) {
    target = prices[badgeSymbol];
  } else if (prices[DEFAULT_BADGE_SYMBOL]?.price != null) {
    target = prices[DEFAULT_BADGE_SYMBOL];
  } else {
    target = results.find((r) => r.price != null) || null;
  }

  if (target?.price != null) {
    const badgeText = await formatBadgePrice(target.price);
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshPrices();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: UPDATE_INTERVAL_MIN });
  refreshPrices();
});

chrome.runtime.onStartup.addListener(() => {
  refreshPrices();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refresh') {
    refreshPrices().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-badge') return;
  const { badgeSymbol } = await chrome.storage.local.get('badgeSymbol');
  if (badgeSymbol === null || badgeSymbol === '') {
    await chrome.storage.local.set({ badgeSymbol: DEFAULT_BADGE_SYMBOL });
  } else {
    await chrome.storage.local.set({ badgeSymbol: '' });
    chrome.action.setBadgeText({ text: '' });
  }
  refreshPrices();
});
