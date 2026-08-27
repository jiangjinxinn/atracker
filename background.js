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
const BYPASS_SINA_PROXY_KEY = 'bypassSinaProxy';
const BADGE_ENABLED_KEY = 'badgeEnabled';
const BADGE_MENU_ID = 'toggle-badge-enabled';

let refreshQueue = Promise.resolve();

async function getSymbols() {
  const { symbols } = await chrome.storage.local.get('symbols');
  return Array.isArray(symbols) && symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;
}

async function getBadgeEnabled() {
  const { [BADGE_ENABLED_KEY]: badgeEnabled } = await chrome.storage.local.get(BADGE_ENABLED_KEY);
  return badgeEnabled !== false;
}

async function setBadgeEnabled(value) {
  await chrome.storage.local.set({ [BADGE_ENABLED_KEY]: value === true });
  if (value !== true) chrome.action.setBadgeText({ text: '' });
  scheduleRefresh();
}

async function addFetchLog(entry) {
  const { fetchLogs = [] } = await chrome.storage.local.get('fetchLogs');
  fetchLogs.unshift({ time: Date.now(), ...entry });
  if (fetchLogs.length > 50) fetchLogs.pop();
  await chrome.storage.local.set({ fetchLogs });
}

function getProxySetting() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.get({ incognito: false }, (details) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(details);
    });
  });
}

function setProxySetting(value) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value, scope: 'regular' }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function clearProxySetting() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: 'regular' }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

async function restoreProxySetting(previousSetting) {
  if (previousSetting?.levelOfControl === 'controlled_by_this_extension' && previousSetting.value) {
    await setProxySetting(previousSetting.value);
    return;
  }
  await clearProxySetting();
}

async function runWithSinaDirectProxy(task) {
  const { [BYPASS_SINA_PROXY_KEY]: bypassSinaProxy = false } = await chrome.storage.local.get(BYPASS_SINA_PROXY_KEY);
  if (!bypassSinaProxy || !chrome.proxy?.settings) {
    return task();
  }

  let previousSetting = null;
  try {
    previousSetting = await getProxySetting();
    await setProxySetting({ mode: 'direct' });
  } catch (err) {
    await addFetchLog({ code: 'proxy', url: 'chrome.proxy.settings', status: null, ok: false, error: `直连模式切换失败：${err.message}` });
    return task();
  }

  try {
    return await task();
  } finally {
    try {
      await restoreProxySetting(previousSetting);
    } catch (err) {
      await addFetchLog({ code: 'proxy', url: 'chrome.proxy.settings', status: null, ok: false, error: `代理设置恢复失败：${err.message}` });
    }
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

function formatSession(session) {
  if (session === 'pre') return '盘前';
  if (session === 'regular') return '盘中';
  if (session === 'post') return '盘后';
  return '';
}

function formatTooltipPrice(item) {
  if (item?.price == null) return '—';
  return item.price.toFixed(item.priceDigits ?? 2);
}

function formatTooltipChangePct(item) {
  if (item?.changePct == null) return '';
  const sign = item.changePct >= 0 ? '+' : '';
  return ` (${sign}${item.changePct.toFixed(item.changePctDigits ?? 2)}%)`;
}

async function updateActionTitle(results, symbols) {
  const visibleKeys = new Set(symbols.filter((s) => s.visible !== false).map((s) => s.key));
  const lines = [];
  for (const r of results) {
    if (!visibleKeys.has(r.key)) continue;
    const name = r.label ? `${r.key} · ${r.label}` : r.key;
    const price = formatTooltipPrice(r);
    const change = formatTooltipChangePct(r);
    const session = formatSession(r.session);
    lines.push(`${name}: ${price}${change}${session ? ` · ${session}` : ''}`);
  }
  chrome.action.setTitle({ title: lines.join('\n') });
}

async function refreshPrices() {
  await ensureSinaRefererRule();
  return runWithSinaDirectProxy(async () => {
    const symbols = await getSymbols();
    const results = await Promise.all(symbols.map(fetchSymbol));
    const prices = {};
    for (const r of results) prices[r.key] = r;
    const symbolsWithLabels = syncSymbolLabels(symbols, results);
    const now = Date.now();
    await chrome.storage.local.set({ prices, symbols: symbolsWithLabels, lastUpdate: now });

    await updateBadge(results, prices);
    await updateActionTitle(results, symbolsWithLabels);

    chrome.runtime.sendMessage({ action: 'prices-updated' }).catch(() => {});
  });
}

function scheduleRefresh() {
  refreshQueue = refreshQueue.catch(() => {}).then(refreshPrices);
  return refreshQueue;
}

async function formatBadgeValue(item) {
  const { badgeChangePct } = await chrome.storage.local.get('badgeChangePct');

  if (badgeChangePct) {
    const value = item?.changePct;
    if (value == null) return '';
    return Math.abs(value).toFixed(2);
  }

  const value = item?.price;
  if (value == null) return '';

  const abs = Math.abs(value);
  if (abs === 0) return '0000';

  const magnitude = Math.floor(Math.log10(abs));
  const scaled = abs / Math.pow(10, magnitude - 3);
  let rounded = Math.round(scaled);
  if (rounded >= 10000) {
    rounded = Math.round(scaled / 10);
  }
  return rounded.toString().padStart(4, '0');
}

function getBadgeColorByDailyChangePct(item) {
  return item?.changePct < 0 ? '#f87171' : '#10b981';
}

async function updateBadge(results, prices) {
  const { badgeSymbol, badgeChangePct, [BADGE_ENABLED_KEY]: badgeEnabled } =
    await chrome.storage.local.get(['badgeSymbol', 'badgeChangePct', BADGE_ENABLED_KEY]);

  if (badgeEnabled === false) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

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
    const badgeColor = getBadgeColorByDailyChangePct(target);
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor });
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
      requestDomains: ['hq.sinajs.cn'],
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

// 右键扩展图标即可切换角标，无需进入设置页
async function setupBadgeContextMenu() {
  const enabled = await getBadgeEnabled();
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: BADGE_MENU_ID,
      title: '显示角标',
      type: 'checkbox',
      checked: enabled,
      contexts: ['action'],
    });
  } catch (e) {
    console.error('Failed to setup badge context menu', e);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) scheduleRefresh();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: UPDATE_INTERVAL_MIN });
  setupBadgeContextMenu();
  scheduleRefresh();
});

chrome.runtime.onStartup.addListener(() => {
  setupBadgeContextMenu();
  scheduleRefresh();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== BADGE_MENU_ID) return;
  setBadgeEnabled(info.checked === true);
});

// 设置页改动后同步右键菜单的勾选状态
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[BADGE_ENABLED_KEY]) return;
  const checked = changes[BADGE_ENABLED_KEY].newValue !== false;
  chrome.contextMenus.update(BADGE_MENU_ID, { checked }).catch(() => {});
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refresh') {
    scheduleRefresh()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-badge') return;
  const enabled = await getBadgeEnabled();
  await setBadgeEnabled(!enabled);
});
