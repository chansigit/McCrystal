'use strict';

// =====================================================================
// Crystal GM admin console.
// Plain JS, no build step, no framework. Talks to the /api/* endpoints
// documented in Server.Admin. Organised into sections, one per tab.
// =====================================================================

// ---------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------

var state = {
  tab: 'overview',
  overviewTimer: null,
  players: [],
  selectedPlayer: null,
  accounts: [],
  selectedAccountId: null,
  maps: [],
  logSource: null,
  logBuffer: []
};

// ---------------------------------------------------------------------
// Small utilities: HTML escaping, date/duration formatting, toasts
// ---------------------------------------------------------------------

// Escapes a value for safe interpolation into innerHTML. Every value that
// ultimately comes from the game database or a player (item names,
// account ids, chat text, ...) must go through this before it is placed
// in markup.
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, function (ch) {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

// Renders a JSON date. default(DateTime) round-trips as a string starting
// with "0001" - show that as "-" instead of a nonsense date.
function fmtDate(iso) {
  if (!iso || typeof iso !== 'string' || iso.slice(0, 4) === '0001') return '-';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fmtTime(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// h/m/s duration, e.g. "1时23分45秒". Used for both server uptime and a
// player's session length.
function fmtDuration(totalSeconds) {
  totalSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  var h = Math.floor(totalSeconds / 3600);
  var m = Math.floor((totalSeconds % 3600) / 60);
  var s = totalSeconds % 60;
  if (h > 0) return h + '时' + m + '分' + s + '秒';
  if (m > 0) return m + '分' + s + '秒';
  return s + '秒';
}

// "current/max", or "-" when the item has no durability at all.
function fmtDura(row) {
  if (!row || !row.maxDura) return '-';
  return row.currentDura + '/' + row.maxDura;
}

var toastTimer = null;
function toast(message, isError) {
  var el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 4000);
}

function debounce(fn, ms) {
  var timer = null;
  return function () {
    var args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(null, args); }, ms);
  };
}

// ---------------------------------------------------------------------
// HTTP: fetch wrappers that recognise 401 and drop back to the login card
// ---------------------------------------------------------------------

async function handleResponse(res) {
  var data = null;
  try { data = await res.json(); } catch (e) { /* no/invalid body */ }
  if (res.status === 401) {
    onUnauthorized();
    var authErr = new Error('login required');
    authErr.unauthorized = true;
    throw authErr;
  }
  if (!res.ok) {
    var message = (data && (data.error || data.message)) || ('HTTP ' + res.status);
    throw new Error(message);
  }
  return data;
}

function apiGet(path) {
  return fetch(path, { credentials: 'same-origin' }).then(handleResponse);
}

function apiPost(path, body) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Console': '1' },
    body: JSON.stringify(body || {})
  }).then(handleResponse);
}

// Reports a caught error, unless it is the (already handled) 401 case.
function reportError(err) {
  if (err && err.unauthorized) return;
  toast((err && err.message) || '请求失败', true);
}

// ---------------------------------------------------------------------
// Login / logout / app shell
// ---------------------------------------------------------------------

function onUnauthorized() {
  stopOverviewTimer();
  stopLogStream();
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').classList.add('visible');
  state.selectedPlayer = null;
  state.selectedAccountId = null;
}

async function enterApp() {
  document.getElementById('login-screen').classList.remove('visible');
  document.getElementById('app').classList.add('visible');
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-password').value = '';
  switchTab('overview');
  loadItemNamesOnce();
  loadMapsOnce();
  startLogStream();
}

document.getElementById('login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var password = document.getElementById('login-password').value;
  var errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    var res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Console': '1' },
      body: JSON.stringify({ password: password })
    });
    if (res.status === 401) {
      errorEl.textContent = '密码错误';
      return;
    }
    if (!res.ok) {
      errorEl.textContent = '登录失败';
      return;
    }
    await enterApp();
  } catch (err) {
    errorEl.textContent = '网络错误';
  }
});

document.getElementById('logout-btn').addEventListener('click', async function () {
  try { await apiPost('/api/logout', {}); } catch (e) { /* ignore */ }
  onUnauthorized();
});

// ---------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#side .tab').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.page').forEach(function (p) {
    p.classList.toggle('active', p.id === 'page-' + tab);
  });

  stopOverviewTimer();
  if (tab === 'overview') {
    refreshOverview();
    startOverviewTimer();
  } else if (tab === 'players') {
    refreshPlayers();
  } else if (tab === 'accounts') {
    searchAccounts();
  } else if (tab === 'database') {
    refreshDatabase();
  } else if (tab === 'stats') {
    refreshStats();
  }
}

document.querySelectorAll('#side .tab').forEach(function (btn) {
  btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
});

// =====================================================================
// 总览 (overview)
// =====================================================================

function startOverviewTimer() {
  stopOverviewTimer();
  state.overviewTimer = setInterval(refreshOverview, 2000);
}
function stopOverviewTimer() {
  if (state.overviewTimer) { clearInterval(state.overviewTimer); state.overviewTimer = null; }
}

async function refreshOverview() {
  var o;
  try { o = await apiGet('/api/overview'); } catch (err) { reportError(err); return; }
  renderOverview(o);
}

function renderOverview(o) {
  var cards = [
    { label: '状态', value: o.running ? '运行中' : '已停止', cls: o.running ? 'ok' : 'bad' },
    { label: '运行时长', value: fmtDuration(o.uptimeSeconds) },
    { label: '玩法包', value: o.packId + ' v' + o.packVersion },
    { label: '数据库版本', value: o.databaseVersion },
    { label: '在线玩家', value: o.onlinePlayers },
    { label: '连接数', value: o.connections },
    { label: '怪物总数', value: o.monsters },
    { label: '主循环耗时', value: o.loopMilliseconds + ' ms' },
    { label: '内存', value: (o.memoryBytes / 1024 / 1024).toFixed(1) + ' MB' }
  ];
  renderCards('overview-cards', cards);
}

function renderCards(elementId, cards) {
  document.getElementById(elementId).innerHTML = cards.map(function (c) {
    return '<div class="card"><div class="label">' + esc(c.label) + '</div>' +
      '<div class="value ' + (c.cls || '') + '">' + esc(c.value) + '</div></div>';
  }).join('');
}

// =====================================================================
// 在线玩家 (online players)
// =====================================================================

document.getElementById('players-refresh').addEventListener('click', refreshPlayers);

async function refreshPlayers() {
  var players;
  try { players = await apiGet('/api/players'); } catch (err) { reportError(err); return; }
  state.players = players;
  if (state.selectedPlayer && !players.some(function (p) { return p.name === state.selectedPlayer; })) {
    state.selectedPlayer = null;
    document.getElementById('player-actions').style.display = 'none';
  }
  renderPlayers();
}

function renderPlayers() {
  document.getElementById('players-count').textContent = '共 ' + state.players.length + ' 人';
  var body = document.getElementById('players-body');
  if (state.players.length === 0) {
    body.innerHTML = '<tr class="empty-row"><td colspan="8">暂无在线玩家</td></tr>';
    return;
  }
  body.innerHTML = state.players.map(function (p) {
    var selected = state.selectedPlayer === p.name ? ' selected' : '';
    return '<tr data-name="' + esc(p.name) + '" class="' + selected + '">' +
      '<td>' + esc(p.name) + '</td>' +
      '<td>' + esc(p.accountId) + '</td>' +
      '<td>' + esc(p.class) + '</td>' +
      '<td>' + esc(p.level) + '</td>' +
      '<td>' + esc(p.map) + '</td>' +
      '<td>' + esc(p.x) + ',' + esc(p.y) + '</td>' +
      '<td>' + esc(p.ip) + '</td>' +
      '<td>' + esc(fmtDuration(p.sessionSeconds)) + '</td>' +
      '</tr>';
  }).join('');
  body.querySelectorAll('tr[data-name]').forEach(function (tr) {
    tr.addEventListener('click', function () { selectPlayer(tr.dataset.name); });
  });
}

function selectPlayer(name) {
  state.selectedPlayer = name;
  renderPlayers();
  document.getElementById('player-actions').style.display = '';
  document.getElementById('player-actions-name').textContent = name;
}

async function doPlayerAction(action, body) {
  if (!state.selectedPlayer) return;
  try {
    var data = await apiPost('/api/players/' + encodeURIComponent(state.selectedPlayer) + '/' + action, body);
    toast(data.message || '操作成功', false);
    refreshPlayers();
  } catch (err) {
    reportError(err);
  }
}

document.getElementById('give-item-btn').addEventListener('click', function () {
  var item = document.getElementById('give-item-name').value.trim();
  var count = parseInt(document.getElementById('give-item-count').value, 10);
  if (!item) { toast('请输入物品名称', true); return; }
  doPlayerAction('give-item', { item: item, count: isNaN(count) ? 1 : count });
});

document.getElementById('give-gold-btn').addEventListener('click', function () {
  var amount = parseInt(document.getElementById('give-gold-amount').value, 10);
  if (!amount || amount <= 0) { toast('请输入正确的金币数量', true); return; }
  doPlayerAction('give-gold', { amount: amount });
});

document.getElementById('teleport-btn').addEventListener('click', function () {
  var mapIndex = parseInt(document.getElementById('teleport-map').value, 10);
  if (isNaN(mapIndex)) { toast('请选择地图', true); return; }
  var xRaw = document.getElementById('teleport-x').value.trim();
  var yRaw = document.getElementById('teleport-y').value.trim();
  var x = xRaw === '' ? null : parseInt(xRaw, 10);
  var y = yRaw === '' ? null : parseInt(yRaw, 10);
  doPlayerAction('teleport', { mapIndex: mapIndex, x: x, y: y });
});

document.getElementById('set-level-btn').addEventListener('click', function () {
  var level = parseInt(document.getElementById('set-level-value').value, 10);
  if (isNaN(level) || level < 1) { toast('请输入正确的等级', true); return; }
  doPlayerAction('level', { level: level });
});

document.getElementById('whisper-btn').addEventListener('click', function () {
  var message = document.getElementById('whisper-message').value.trim();
  if (!message) { toast('请输入消息内容', true); return; }
  doPlayerAction('whisper', { message: message });
  document.getElementById('whisper-message').value = '';
});

document.getElementById('kick-btn').addEventListener('click', function () {
  doPlayerAction('kick', {});
});

// Item name datalist and map select are loaded once after login; both
// endpoints support an empty query (returns the whole, capped, list).
async function loadItemNamesOnce() {
  try {
    var items = await apiGet('/api/db/items?q=');
    document.getElementById('item-name-list').innerHTML = items.map(function (i) {
      return '<option value="' + esc(i.name) + '"></option>';
    }).join('');
  } catch (err) { reportError(err); }
}

async function loadMapsOnce() {
  try {
    var maps = await apiGet('/api/db/maps?q=');
    state.maps = maps;
    document.getElementById('teleport-map').innerHTML = maps.map(function (m) {
      return '<option value="' + m.index + '">' + esc(m.title || m.fileName) + ' (#' + m.index + ')</option>';
    }).join('');
  } catch (err) { reportError(err); }
}

// =====================================================================
// 账号与角色 (accounts & characters)
// =====================================================================

document.getElementById('accounts-search-btn').addEventListener('click', searchAccounts);
document.getElementById('accounts-search').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') searchAccounts();
});

async function searchAccounts() {
  var q = document.getElementById('accounts-search').value.trim();
  var accounts;
  try { accounts = await apiGet('/api/accounts?q=' + encodeURIComponent(q)); } catch (err) { reportError(err); return; }
  state.accounts = accounts;
  renderAccounts();
}

function renderAccounts() {
  var body = document.getElementById('accounts-body');
  if (state.accounts.length === 0) {
    body.innerHTML = '<tr class="empty-row"><td colspan="7">未找到账号</td></tr>';
    return;
  }
  body.innerHTML = state.accounts.map(function (a) {
    var selected = state.selectedAccountId === a.accountId ? ' selected' : '';
    return '<tr data-id="' + esc(a.accountId) + '" class="' + selected + '">' +
      '<td>' + esc(a.accountId) + '</td>' +
      '<td>' + esc(a.characterCount) + '</td>' +
      '<td>' + esc(fmtDate(a.creationDate)) + '</td>' +
      '<td>' + esc(fmtDate(a.lastDate)) + '</td>' +
      '<td>' + (a.admin ? '<span class="badge gm">GM</span>' : '') + '</td>' +
      '<td>' + (a.banned ? '<span class="badge warn">封禁</span>' : '') + '</td>' +
      '<td>' + (a.online ? '<span class="badge on">在线</span>' : '<span class="badge off">离线</span>') + '</td>' +
      '</tr>';
  }).join('');
  body.querySelectorAll('tr[data-id]').forEach(function (tr) {
    tr.addEventListener('click', function () { selectAccount(tr.dataset.id); });
  });
}

async function selectAccount(id) {
  state.selectedAccountId = id;
  renderAccounts();
  var detail;
  try { detail = await apiGet('/api/accounts/' + encodeURIComponent(id)); } catch (err) { reportError(err); return; }
  renderAccountDetail(detail);
}

function renderAccountDetail(d) {
  document.getElementById('account-detail').style.display = '';
  document.getElementById('account-detail-id').textContent = d.accountId;

  var lines = [];
  lines.push('<div class="line">金币: <strong>' + esc(d.gold) + '</strong> &nbsp; ' +
    (d.admin ? '<span class="badge gm">GM</span>' : '<span class="badge off">普通</span>') + '</div>');
  if (d.banned) {
    lines.push('<div class="line"><span class="badge warn">已封禁</span> ' + esc(d.banReason || '未说明原因') + '</div>');
  }
  lines.push('<div class="line">最后登录 IP: ' + esc(d.lastIp) + ' &nbsp; 最后登录: ' + esc(fmtDate(d.lastDate)) + '</div>');
  document.getElementById('account-detail-head').innerHTML = lines.join('');

  var toggleBtn = document.getElementById('toggle-admin-btn');
  toggleBtn.textContent = d.admin ? '取消GM' : '设为GM';
  toggleBtn.dataset.admin = d.admin ? '1' : '0';

  document.getElementById('account-storage-body').innerHTML = renderItemRows(d.storage);

  var charsEl = document.getElementById('account-characters');
  if (!d.characters || d.characters.length === 0) {
    charsEl.innerHTML = '<p class="hint">无角色</p>';
  } else {
    charsEl.innerHTML = d.characters.map(function (c) {
      return '<div class="char-block">' +
        '<div class="char-title">' + esc(c.name) + ' - ' + esc(c.class) + '/' + esc(c.gender) + ' Lv.' + esc(c.level) + ' ' +
        (c.online ? '<span class="badge on">在线</span>' : '<span class="badge off">离线</span>') +
        (c.deleted ? ' <span class="badge warn">已删除</span>' : '') +
        ' <span class="hint">最后登录: ' + esc(fmtDate(c.lastLoginDate)) + '</span></div>' +
        '<h4>装备</h4><div class="table-wrap"><table><thead><tr><th>槽</th><th>物品</th><th>数量</th><th>耐久</th></tr></thead>' +
        '<tbody>' + renderItemRows(c.equipment) + '</tbody></table></div>' +
        '<h4>背包</h4><div class="table-wrap"><table><thead><tr><th>槽</th><th>物品</th><th>数量</th><th>耐久</th></tr></thead>' +
        '<tbody>' + renderItemRows(c.inventory) + '</tbody></table></div>' +
        '</div>';
    }).join('');
  }
}

function renderItemRows(rows) {
  if (!rows || rows.length === 0) return '<tr class="empty-row"><td colspan="4">空</td></tr>';
  return rows.map(function (r) {
    return '<tr><td>' + esc(r.slot) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.count) + '</td><td>' + esc(fmtDura(r)) + '</td></tr>';
  }).join('');
}

document.getElementById('reset-password-btn').addEventListener('click', async function () {
  if (!state.selectedAccountId) return;
  var pw = document.getElementById('reset-password-value').value;
  if (!pw) { toast('请输入新密码', true); return; }
  try {
    var data = await apiPost('/api/accounts/' + encodeURIComponent(state.selectedAccountId) + '/password', { password: pw });
    toast(data.message || '已重置密码', false);
    document.getElementById('reset-password-value').value = '';
  } catch (err) { reportError(err); }
});

document.getElementById('toggle-admin-btn').addEventListener('click', async function () {
  if (!state.selectedAccountId) return;
  var makeAdmin = this.dataset.admin !== '1';
  try {
    var data = await apiPost('/api/accounts/' + encodeURIComponent(state.selectedAccountId) + '/admin', { admin: makeAdmin });
    toast(data.message || '操作成功', false);
    var id = state.selectedAccountId;
    await selectAccount(id);
    searchAccounts();
  } catch (err) { reportError(err); }
});

// =====================================================================
// 服务器与日志 (server actions & live log)
// =====================================================================

document.getElementById('broadcast-btn').addEventListener('click', async function () {
  var message = document.getElementById('broadcast-message').value.trim();
  if (!message) { toast('请输入公告内容', true); return; }
  try {
    var data = await apiPost('/api/server/broadcast', { message: message });
    toast(data.message || '已广播', false);
    document.getElementById('broadcast-message').value = '';
  } catch (err) { reportError(err); }
});

document.getElementById('save-btn').addEventListener('click', async function () {
  if (!confirm('确定要立即存档吗?')) return;
  try {
    var data = await apiPost('/api/server/save', {});
    toast(data.message || '已开始存档', false);
  } catch (err) { reportError(err); }
});

document.getElementById('reload-drops-btn').addEventListener('click', async function () {
  try {
    var data = await apiPost('/api/server/reload-drops', {});
    toast(data.message || '已重载掉落表', false);
  } catch (err) { reportError(err); }
});

document.getElementById('reload-npcs-btn').addEventListener('click', async function () {
  if (!confirm('重载 NPC 脚本可能打断正在对话中的玩家，确定继续吗?')) return;
  try {
    var data = await apiPost('/api/server/reload-npcs', {});
    toast(data.message || '已重载 NPC 脚本', false);
  } catch (err) { reportError(err); }
});

// ---- live log stream (SSE) ----

function startLogStream() {
  stopLogStream();
  if (typeof EventSource === 'undefined') return;
  var source = new EventSource('/api/logs/stream');
  source.onmessage = function (evt) {
    var entry;
    try { entry = JSON.parse(evt.data); } catch (e) { return; }
    appendLogEntry(entry);
  };
  state.logSource = source;
}

function stopLogStream() {
  if (state.logSource) { state.logSource.close(); state.logSource = null; }
}

function appendLogEntry(entry) {
  state.logBuffer.push(entry);
  if (state.logBuffer.length > 2000) state.logBuffer.shift();
  if (matchesLogFilter(entry)) {
    var view = document.getElementById('log-view');
    var atBottom = isLogViewAtBottom(view);
    view.appendChild(buildLogLine(entry));
    while (view.children.length > 500) view.removeChild(view.firstChild);
    if (atBottom) view.scrollTop = view.scrollHeight;
  }
}

function isLogViewAtBottom(view) {
  return view.scrollTop + view.clientHeight >= view.scrollHeight - 4;
}

function buildLogLine(entry) {
  var div = document.createElement('div');
  // entry.kind is one of a fixed server-side set ("server"/"debug"/"chat"),
  // safe to use directly as a class name.
  div.className = 'line ' + (entry.kind || 'server');
  div.innerHTML = '<span class="time">[' + esc(fmtTime(entry.time)) + ']</span>' + esc(entry.text);
  return div;
}

function matchesLogFilter(entry) {
  var includeChat = document.getElementById('log-include-chat').checked;
  var includeDebug = document.getElementById('log-include-debug').checked;
  if (entry.kind === 'chat' && !includeChat) return false;
  if (entry.kind === 'debug' && !includeDebug) return false;
  var keyword = document.getElementById('log-filter').value.trim().toLowerCase();
  if (keyword && (entry.text || '').toLowerCase().indexOf(keyword) === -1) return false;
  return true;
}

function rerenderLogs() {
  var view = document.getElementById('log-view');
  var atBottom = isLogViewAtBottom(view);
  view.innerHTML = '';
  state.logBuffer.filter(matchesLogFilter).forEach(function (entry) {
    view.appendChild(buildLogLine(entry));
  });
  if (atBottom) view.scrollTop = view.scrollHeight;
}

document.getElementById('log-filter').addEventListener('input', debounce(rerenderLogs, 150));
document.getElementById('log-include-chat').addEventListener('change', rerenderLogs);
document.getElementById('log-include-debug').addEventListener('change', rerenderLogs);

// =====================================================================
// 数据库 (game database browser)
// =====================================================================

var DB_COLUMNS = {
  items: [
    { label: '编号', get: function (r) { return r.index; } },
    { label: '名称', get: function (r) { return r.name; } },
    { label: '类型', get: function (r) { return r.type; } },
    { label: '品级', get: function (r) { return r.grade; } },
    { label: '需求类型', get: function (r) { return r.requiredType; } },
    { label: '需求量', get: function (r) { return r.requiredAmount; } },
    { label: '职业需求', get: function (r) { return r.requiredClass; } },
    { label: '价格', get: function (r) { return r.price; } },
    { label: '叠加上限', get: function (r) { return r.stackSize; } },
    { label: '耐久', get: function (r) { return r.durability; } }
  ],
  monsters: [
    { label: '编号', get: function (r) { return r.index; } },
    { label: '名称', get: function (r) { return r.name; } },
    { label: '等级', get: function (r) { return r.level; } },
    { label: '经验', get: function (r) { return r.experience; } },
    { label: 'AI', get: function (r) { return r.ai; } },
    { label: '掉落表', get: function (r) { return r.dropPath; } },
    { label: '掉落条数', get: function (r) { return r.dropCount; } }
  ],
  maps: [
    { label: '编号', get: function (r) { return r.index; } },
    { label: '文件名', get: function (r) { return r.fileName; } },
    { label: '标题', get: function (r) { return r.title; } },
    { label: '玩家数', get: function (r) { return r.players; } },
    { label: '怪物数', get: function (r) { return r.monsters; } }
  ],
  npcs: [
    { label: '编号', get: function (r) { return r.index; } },
    { label: '名称', get: function (r) { return r.name; } },
    { label: '文件', get: function (r) { return r.fileName; } },
    { label: '地图', get: function (r) { return r.mapTitle; } },
    { label: '坐标', get: function (r) { return r.x + ',' + r.y; } }
  ]
};

document.getElementById('db-kind').addEventListener('change', refreshDatabase);
document.getElementById('db-search').addEventListener('input', debounce(refreshDatabase, 300));

async function refreshDatabase() {
  var kind = document.getElementById('db-kind').value;
  var q = document.getElementById('db-search').value.trim();
  var rows;
  try { rows = await apiGet('/api/db/' + kind + '?q=' + encodeURIComponent(q)); } catch (err) { reportError(err); return; }
  renderDatabase(kind, rows);
}

function renderDatabase(kind, rows) {
  document.getElementById('db-count').textContent = '共 ' + rows.length + ' 条';
  var columns = DB_COLUMNS[kind];
  document.getElementById('db-head').innerHTML = '<tr>' + columns.map(function (c) {
    return '<th>' + esc(c.label) + '</th>';
  }).join('') + '</tr>';

  var body = document.getElementById('db-body');
  if (rows.length === 0) {
    body.innerHTML = '<tr class="empty-row"><td colspan="' + columns.length + '">无结果</td></tr>';
    return;
  }
  body.innerHTML = rows.map(function (r) {
    return '<tr>' + columns.map(function (c) { return '<td>' + esc(c.get(r)) + '</td>'; }).join('') + '</tr>';
  }).join('');
}

// =====================================================================
// 统计 (statistics)
// =====================================================================

document.getElementById('stats-refresh').addEventListener('click', refreshStats);

async function refreshStats() {
  var s;
  try { s = await apiGet('/api/stats'); } catch (err) { reportError(err); return; }
  renderStats(s);
}

function renderStats(s) {
  var cards = [
    { label: '账号', value: s.accounts },
    { label: '角色', value: s.characters },
    { label: '在线', value: s.online },
    { label: '金币总量', value: s.totalGold },
    { label: '物品总数', value: s.totalItems },
    { label: '主循环耗时', value: s.runtime.loopMilliseconds + ' ms' },
    { label: '内存', value: (s.runtime.memoryBytes / 1024 / 1024).toFixed(1) + ' MB' },
    { label: '连接数', value: s.runtime.connections }
  ];
  renderCards('stats-cards', cards);

  document.getElementById('stats-class-body').innerHTML = renderKeyCountRows(s.classCounts);
  document.getElementById('stats-level-body').innerHTML = renderKeyCountRows(s.levelBands);
  document.getElementById('stats-map-monsters-body').innerHTML = renderMapCountRows(s.topMapsByMonsters);
  document.getElementById('stats-map-players-body').innerHTML = renderMapCountRows(s.topMapsByPlayers);

  var goldBody = document.getElementById('stats-gold-body');
  goldBody.innerHTML = (s.topGold && s.topGold.length > 0)
    ? s.topGold.map(function (g) {
        return '<tr><td>' + esc(g.accountId) + '</td><td>' + esc(g.characters) + '</td><td>' + esc(g.gold) + '</td></tr>';
      }).join('')
    : '<tr class="empty-row"><td colspan="3">无数据</td></tr>';
}

function renderKeyCountRows(dict) {
  var keys = dict ? Object.keys(dict) : [];
  if (keys.length === 0) return '<tr class="empty-row"><td colspan="2">无数据</td></tr>';
  return keys.map(function (k) {
    return '<tr><td>' + esc(k) + '</td><td>' + esc(dict[k]) + '</td></tr>';
  }).join('');
}

function renderMapCountRows(rows) {
  if (!rows || rows.length === 0) return '<tr class="empty-row"><td colspan="2">无数据</td></tr>';
  return rows.map(function (r) {
    return '<tr><td>' + esc(r.map) + '</td><td>' + esc(r.count) + '</td></tr>';
  }).join('');
}

// =====================================================================
// Boot: check whether we already have a valid session cookie
// =====================================================================

(async function init() {
  try {
    await apiGet('/api/overview');
    await enterApp();
  } catch (err) {
    // Not logged in (or a network error) - the login card is already the
    // default visible state, nothing else to do here.
  }
})();
