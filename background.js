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

const DEFAULT_BADGE_SYMBOL = 'hf_XAU';

const ALARM_NAME = 'refresh-prices';
const UPDATE_INTERVAL_MIN = 1;

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

async function fetchSymbol(symbol) {
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

function formatSession(session) {
  if (session === 'pre') return '盘前';
  if (session === 'regular') return '盘中';
  if (session === 'post') return '盘后';
  return '';
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

async function updateActionTitle(results, symbols) {
  const visibleKeys = new Set(symbols.filter((s) => s.visible !== false).map((s) => s.key));
  const lines = [];
  for (const r of results) {
    if (!visibleKeys.has(r.key)) continue;
    const name = r.label ? `${r.key} · ${r.label}` : r.key;
    const price = formatTooltipPrice(r.price);
    const change = formatTooltipChangePct(r.changePct);
    const session = formatSession(r.session);
    lines.push(`${name}: ${price}${change}${session ? ` · ${session}` : ''}`);
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
  await updateActionTitle(results, symbols);

  chrome.runtime.sendMessage({ action: 'prices-updated' }).catch(() => {});
}

async function formatBadgeValue(item) {
  const { badgeFullNumber, badgeChangePct } = await chrome.storage.local.get(['badgeFullNumber', 'badgeChangePct']);

  if (badgeChangePct) {
    const value = item?.changePct;
    if (value == null) return '';
    const sign = value < 0 ? '-' : '';
    return `${sign}${Math.abs(value).toFixed(2)}`;
  }

  const value = item?.price;
  if (value == null) return '';

  if (badgeFullNumber) {
    const two = value.toFixed(2);
    if (two.length <= 4) return two;
    const one = value.toFixed(1);
    if (one.length <= 4) return one;
    return value.toFixed(0);
  }

  const intDigits = Math.floor(Math.abs(value)).toString().length;
  let decimals = intDigits >= 4 ? 0 : Math.min(4 - intDigits, 2);
  while (decimals >= 0) {
    const text = value.toFixed(decimals);
    if (text.length <= 4) return text;
    decimals--;
  }
  let text = value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  if (text.length > 4) {
    text = value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 0 });
  }
  return text;
}

async function updateBadge(results, prices) {
  const { badgeSymbol, badgeChangePct } = await chrome.storage.local.get(['badgeSymbol', 'badgeChangePct']);

  if (badgeSymbol === null || badgeSymbol === '') {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const hasValue = (r) => (badgeChangePct ? r?.changePct != null : r?.price != null);
  let target = null;

  if (badgeSymbol && hasValue(prices[badgeSymbol])) {
    target = prices[badgeSymbol];
  } else if (hasValue(prices[DEFAULT_BADGE_SYMBOL])) {
    target = prices[DEFAULT_BADGE_SYMBOL];
  } else {
    target = results.find(hasValue) || null;
  }

  if (target && hasValue(target)) {
    const badgeText = await formatBadgeValue(target);
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function ensureSinaRefererRule() {
  const ruleId = 1;
  const rule = {
    id: ruleId,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        {
          header: 'Referer',
          operation: 'set',
          value: 'https://finance.sina.com.cn/',
        },
      ],
    },
    condition: {
      initiatorDomains: [chrome.runtime.id],
      urlFilter: '|https://hq.sinajs.cn/',
      resourceTypes: ['xmlhttprequest'],
    },
  };
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
      addRules: [rule],
    });
  } catch (e) {
    console.error('Failed to update Sina referer rule', e);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshPrices();
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: UPDATE_INTERVAL_MIN });
  await ensureSinaRefererRule();
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
