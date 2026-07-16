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

async function getBadgeChangePct() {
  const { badgeChangePct } = await chrome.storage.local.get('badgeChangePct');
  return badgeChangePct === true;
}

async function setBadgeChangePct(value) {
  await chrome.storage.local.set({ badgeChangePct: value === true });
  try {
    await chrome.runtime.sendMessage({ action: 'refresh' });
  } catch (e) {
    // 后台可能未运行，忽略
  }
}

async function formatBadgeValueLocal(item) {
  const full = await getBadgeFullNumber();
  const changePctMode = await getBadgeChangePct();

  if (changePctMode) {
    const value = item?.changePct;
    if (value == null) return '';
    const sign = value < 0 ? '-' : '';
    return `${sign}${Math.abs(value).toFixed(2)}`;
  }

  const value = item?.price;
  if (value == null) return '';

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
  const badgeText = await formatBadgeValueLocal(item);
  if (badgeText) {
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
  const input = raw.trim();
  if (!input) return null;

  const lower = input.toLowerCase();

  if (lower.startsWith('hf_')) {
    return { key: lower, sina: lower, label: '', visible: true };
  }

  if (/^(sh|sz|bj)\d{6}$/.test(lower)) {
    return { key: lower, sina: lower, label: '', visible: true };
  }

  return null;
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
    tdKey.textContent = symbol.label ? `${symbol.key} · ${symbol.label}` : symbol.key;

    const tdSina = document.createElement('td');
    tdSina.textContent = symbol.sina || '—';

    const tdVisible = document.createElement('td');
    const visibleToggle = document.createElement('button');
    const isVisible = symbol.visible !== false;
    visibleToggle.className = 'toggle' + (isVisible ? ' active' : '');
    visibleToggle.setAttribute('aria-label', isVisible ? '在列表中显示，点击隐藏' : '在列表中隐藏，点击显示');
    visibleToggle.addEventListener('click', async () => {
      symbols[index].visible = !isVisible;
      await saveSymbols(symbols);
      await renderList();
      await applyBadgeSettings();
      showMessage(isVisible ? '已隐藏' : '已显示');
    });
    tdVisible.appendChild(visibleToggle);

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
    tr.appendChild(tdSina);
    tr.appendChild(tdVisible);
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

async function renderBadgeChangePctToggle() {
  const show = await getBadgeChangePct();
  const toggle = document.getElementById('badge-change-pct-toggle');
  toggle.classList.toggle('active', show);
  toggle.setAttribute('aria-label', show ? '角标显示涨跌幅已开启' : '角标显示涨跌幅已关闭');
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

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const codeInput = document.getElementById('code');
  const normalized = normalizeCode(codeInput.value);

  if (!normalized) {
    showMessage('仅支持新浪代码：期货（hf_ 开头）或 A 股（sh/sz/bj+6 位数字）', true);
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

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  renderList();
  renderBadgeFullToggle();
  renderCompactToggle();
  renderBadgeChangePctToggle();
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

  document.getElementById('badge-change-pct-toggle').addEventListener('click', async () => {
    const next = !(await getBadgeChangePct());
    await setBadgeChangePct(next);
    await renderBadgeChangePctToggle();
    await applyBadgeSettings();
    showBadgeMessage(next ? '角标将显示涨跌幅' : '角标将显示价格');
  });
});
