const DEFAULT_SYMBOLS = [
  { key: 'GC=F', yahoo: 'GC=F', label: '' },
  { key: 'SI=F', yahoo: 'SI=F', label: '' },
  { key: 'HG=F', yahoo: 'HG=F', label: '' },
  { key: 'BTC-USD', yahoo: 'BTC-USD', label: '' },
  { key: 'ETH-USD', yahoo: 'ETH-USD', label: '' },
];

const DEFAULT_BADGE_SYMBOL = 'GC=F';

async function getSymbols() {
  const { symbols } = await chrome.storage.local.get('symbols');
  return Array.isArray(symbols) ? symbols : DEFAULT_SYMBOLS;
}

async function saveSymbols(symbols) {
  await chrome.storage.local.set({ symbols });
  try {
    await chrome.runtime.sendMessage({ action: 'refresh' });
  } catch (e) {
    // 后台可能未运行，忽略
  }
}

async function getBadgeSymbol(symbols) {
  const { badgeSymbol } = await chrome.storage.local.get('badgeSymbol');
  if (badgeSymbol === null || badgeSymbol === '') return null;
  if (badgeSymbol && symbols.some((s) => s.key === badgeSymbol)) {
    return badgeSymbol;
  }
  if (symbols.some((s) => s.key === DEFAULT_BADGE_SYMBOL)) {
    return DEFAULT_BADGE_SYMBOL;
  }
  return symbols[0]?.key || null;
}

async function setBadgeSymbol(key) {
  await chrome.storage.local.set({ badgeSymbol: key });
  try {
    await chrome.runtime.sendMessage({ action: 'refresh' });
  } catch (e) {
    // 后台可能未运行，忽略
  }
}

async function getBadgeFullNumber() {
  const { badgeFullNumber } = await chrome.storage.local.get('badgeFullNumber');
  return badgeFullNumber === true;
}

async function setBadgeFullNumber(value) {
  await chrome.storage.local.set({ badgeFullNumber: value === true });
  try {
    await chrome.runtime.sendMessage({ action: 'refresh' });
  } catch (e) {
    // 后台可能未运行，忽略
  }
}

async function getCompactMode() {
  const { compactMode } = await chrome.storage.local.get('compactMode');
  return compactMode === true;
}

async function setCompactMode(value) {
  await chrome.storage.local.set({ compactMode: value === true });
  try {
    await chrome.runtime.sendMessage({ action: 'refresh' });
  } catch (e) {
    // 后台可能未运行，忽略
  }
}

async function formatBadgePriceLocal(value) {
  if (value == null) return '';
  const full = await getBadgeFullNumber();
  if (full) {
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

async function applyBadgeSettings() {
  const symbols = await getSymbols();
  const currentBadge = await getBadgeSymbol(symbols);
  if (!currentBadge) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const { prices = {} } = await chrome.storage.local.get('prices');
  const item = prices[currentBadge];
  if (item?.price != null) {
    const badgeText = await formatBadgePriceLocal(item.price);
    chrome.action.setBadgeText({ text: badgeText });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function showMessage(text, isError = false) {
  const el = document.getElementById('message');
  el.textContent = text;
  el.className = 'message ' + (isError ? 'error' : 'success');
  setTimeout(() => { el.textContent = ''; el.className = 'message'; }, 3000);
}

function showBadgeMessage(text, isError = false) {
  const el = document.getElementById('badge-message');
  el.textContent = text;
  el.className = 'badge-message ' + (isError ? 'error' : '');
  setTimeout(() => { el.textContent = ''; el.className = 'badge-message'; }, 3000);
}

function normalizeCode(raw) {
  const code = raw.trim().toUpperCase();
  if (!code) return null;
  return { key: code, yahoo: code, label: '' };
}

async function moveSymbol(index, direction) {
  const symbols = await getSymbols();
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= symbols.length) return;
  [symbols[index], symbols[newIndex]] = [symbols[newIndex], symbols[index]];
  await saveSymbols(symbols);
  await renderList();
}

async function renderList() {
  const symbols = await getSymbols();
  const currentBadge = await getBadgeSymbol(symbols);
  const tbody = document.getElementById('symbol-list');
  tbody.innerHTML = '';

  symbols.forEach((symbol, index) => {
    const tr = document.createElement('tr');

    const tdKey = document.createElement('td');
    tdKey.textContent = symbol.key;

    const tdYahoo = document.createElement('td');
    tdYahoo.textContent = symbol.yahoo;

    const tdOrder = document.createElement('td');
    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.className = 'btn btn-icon';
    upBtn.disabled = index === 0;
    upBtn.addEventListener('click', () => moveSymbol(index, -1));

    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.className = 'btn btn-icon';
    downBtn.disabled = index === symbols.length - 1;
    downBtn.addEventListener('click', () => moveSymbol(index, 1));

    tdOrder.appendChild(upBtn);
    tdOrder.appendChild(downBtn);

    const tdAction = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.className = 'btn btn-danger';
    delBtn.addEventListener('click', async () => {
      if (symbol.key === currentBadge) {
        await setBadgeSymbol('');
      }
      const updated = symbols.filter((_, i) => i !== index);
      await saveSymbols(updated);
      await renderList();
      await applyBadgeSettings();
      showMessage('已删除');
    });
    tdAction.appendChild(delBtn);

    const tdBadge = document.createElement('td');
    const toggle = document.createElement('button');
    const isActive = symbol.key === currentBadge;
    toggle.className = 'toggle' + (isActive ? ' active' : '');
    toggle.setAttribute('aria-label', isActive ? '当前角标显示，点击关闭' : '设为角标显示');
    toggle.addEventListener('click', async () => {
      if (isActive) {
        await setBadgeSymbol('');
      } else {
        await setBadgeSymbol(symbol.key);
      }
      await renderList();
      await applyBadgeSettings();
      showBadgeMessage(isActive ? '角标已关闭' : '角标已更新');
    });
    tdBadge.appendChild(toggle);

    tr.appendChild(tdKey);
    tr.appendChild(tdYahoo);
    tr.appendChild(tdOrder);
    tr.appendChild(tdAction);
    tr.appendChild(tdBadge);
    tbody.appendChild(tr);
  });
}

async function renderBadgeFullToggle() {
  const full = await getBadgeFullNumber();
  const toggle = document.getElementById('badge-full-toggle');
  toggle.classList.toggle('active', full);
  toggle.setAttribute('aria-label', full ? '完整数字已开启' : '完整数字已关闭');
}

async function renderCompactToggle() {
  const compact = await getCompactMode();
  const toggle = document.getElementById('compact-toggle');
  toggle.classList.toggle('active', compact);
  toggle.setAttribute('aria-label', compact ? '紧凑模式已开启' : '紧凑模式已关闭');
}

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const codeInput = document.getElementById('code');
  const normalized = normalizeCode(codeInput.value);

  if (!normalized) {
    showMessage('请输入有效代码', true);
    return;
  }

  const symbols = await getSymbols();
  if (symbols.some((s) => s.key === normalized.key)) {
    showMessage('该代码已存在', true);
    return;
  }

  symbols.push(normalized);
  await saveSymbols(symbols);
  await renderList();
  showMessage('添加成功');
  codeInput.value = '';
});

document.getElementById('reset').addEventListener('click', async () => {
  if (confirm('确定恢复默认品种列表吗？')) {
    await saveSymbols(DEFAULT_SYMBOLS);
    await chrome.storage.local.set({ badgeSymbol: DEFAULT_BADGE_SYMBOL });
    await renderList();
    await applyBadgeSettings();
    showMessage('已恢复默认');
  }
});

async function applyTheme() {
  const { theme = 'system' } = await chrome.storage.local.get('theme');
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const effective = theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme;
  document.body.setAttribute('data-theme', effective);
}

function updateThemeButtons(theme) {
  document.querySelectorAll('.theme-icon-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

async function initTheme() {
  const { theme = 'system' } = await chrome.storage.local.get('theme');
  await applyTheme();
  updateThemeButtons(theme);

  document.querySelectorAll('.theme-icon-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const selected = btn.dataset.theme;
      await chrome.storage.local.set({ theme: selected });
      await applyTheme();
      updateThemeButtons(selected);
    });
  });

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', async () => {
    const { theme: current } = await chrome.storage.local.get('theme');
    if (current === 'system') {
      await applyTheme();
    }
  });
}

async function renderLogs() {
  const { fetchLogs = [] } = await chrome.storage.local.get('fetchLogs');
  const area = document.getElementById('logs-area');
  if (fetchLogs.length === 0) {
    area.value = '暂无日志';
    return;
  }
  area.value = JSON.stringify(fetchLogs, null, 2);
}

function toggleLogs() {
  const area = document.getElementById('logs-area');
  const hidden = area.style.display === 'none';
  area.style.display = hidden ? 'block' : 'none';
  document.getElementById('toggle-logs').textContent = hidden ? '收起日志' : '查看日志';
  if (hidden) renderLogs();
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  renderList();
  renderBadgeFullToggle();
  renderCompactToggle();
  applyBadgeSettings();

  document.getElementById('toggle-logs').addEventListener('click', toggleLogs);

  document.getElementById('copy-logs').addEventListener('click', async () => {
    const { fetchLogs = [] } = await chrome.storage.local.get('fetchLogs');
    await navigator.clipboard.writeText(JSON.stringify(fetchLogs, null, 2));
    showMessage('日志已复制');
  });

  document.getElementById('clear-logs').addEventListener('click', async () => {
    await chrome.storage.local.set({ fetchLogs: [] });
    await renderLogs();
    showMessage('日志已清空');
  });

  document.getElementById('badge-full-toggle').addEventListener('click', async () => {
    const next = !(await getBadgeFullNumber());
    await setBadgeFullNumber(next);
    await renderBadgeFullToggle();
    await applyBadgeSettings();
    showBadgeMessage(next ? '角标将显示完整数字' : '角标将缩略显示');
  });

  document.getElementById('compact-toggle').addEventListener('click', async () => {
    const next = !(await getCompactMode());
    await setCompactMode(next);
    await renderCompactToggle();
    showBadgeMessage(next ? '已开启紧凑模式' : '已关闭紧凑模式');
  });
});
