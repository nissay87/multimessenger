const $ = id => document.getElementById(id);
let catalog = [];
let services = [];
let activeId = null;
let editing = null; // service being edited (null = new)
const views = new Map(); // id -> <webview>

const catOf = type => catalog.find(c => c.type === type) || catalog.find(c => c.type === 'custom');
const faviconDone = new Set(); // id|url already fetched this run
const unread = new Map();      // serviceId -> unread count (parsed from the page title)
const lastActive = new Map();  // serviceId -> timestamp, used by "sleep after inactivity"
const notes = new Map();       // `${serviceId}:${nid}` -> true (notifications we forwarded)
let appInfo = { preloadUrl: '' };
let appSettings = {};
const modeOf = s => s.mode || 'always';
const wsOf = s => s.workspace || '';
const svcById = id => services.find(x => x.id === id);
let workspaces = [];
let currentWs = 'all';          // 'all' or a workspace id
const lastSel = {};             // workspace id -> last selected service id
let dlList = [];                // downloads, newest first
const visibleServices = () => services.filter(s => currentWs === 'all' || wsOf(s) === currentWs);

// ---------- sidebar ----------
function renderList() {
  const list = $('list');
  list.innerHTML = '';
  const vis = visibleServices();
  for (const s of vis) {
    const c = catOf(s.type);
    const b = document.createElement('button');
    b.className = 'item' + (s.id === activeId ? ' active' : '') + (views.has(s.id) ? '' : ' asleep') + (s.muted ? ' muted' : '');
    b.title = s.name;

    const badge = document.createElement('span');
    badge.className = 'badge';
    if (c.icon) {
      badge.style.background = c.color;
      const img = document.createElement('img');
      img.src = 'icons/' + c.icon;
      badge.append(img);
    } else if (s.icon) {
      badge.classList.add('fav');
      const img = document.createElement('img');
      img.src = s.icon;
      badge.append(img);
    } else {
      badge.style.background = c.color;
      badge.textContent = c.letter;
    }

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = s.name;

    b.append(badge, label);

    const n = unread.get(s.id) || 0;
    if (n > 0) {
      const u = document.createElement('span');
      u.className = 'unread';
      u.textContent = n > 99 ? '99+' : String(n);
      b.append(u);
    }

    if (s.proxy && s.proxy.enabled) {
      const d = document.createElement('span');
      d.className = 'pdot';
      d.textContent = s.proxy.type.toUpperCase();
      b.append(d);
    }

    const reload = document.createElement('span');
    reload.className = 'gear';
    reload.textContent = '↻';
    reload.title = 'Reload (Shift+click: hard reload)';
    reload.onclick = e => { e.stopPropagation(); reloadService(s.id, e.shiftKey); };

    const gear = document.createElement('span');
    gear.className = 'gear';
    gear.textContent = '⚙';
    gear.title = 'Settings / proxy';
    gear.onclick = e => { e.stopPropagation(); openDialog(s); };
    const sleep = document.createElement('span');
    sleep.className = 'gear';
    sleep.textContent = '💤';
    sleep.title = 'Sleep now (unload this service to save memory)';
    sleep.onclick = e => { e.stopPropagation(); sleepNow(s.id); };

    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(sleep, reload, gear);
    b.append(actions);

    b.onclick = () => select(s.id);
    b.oncontextmenu = e => { e.preventDefault(); reloadService(s.id, e.shiftKey); };
    list.append(b);
  }
  $('empty').textContent = !services.length ? 'Add a service to get started'
    : !vis.length ? 'This workspace is empty. Right-click its icon on the left bar to add services.'
    : 'Select a service';
  $('empty').style.display = activeId ? 'none' : 'grid';
  $('resetBtn').style.display = services.length ? '' : 'none';
  renderRail();
  updateToolbar();
}

function ensureView(s) {
  if (views.has(s.id)) return views.get(s.id);
  const v = document.createElement('webview');
  v.setAttribute('partition', `persist:svc-${s.id}`);
  v.setAttribute('allowpopups', '');
  if (appInfo.preloadUrl && !appSettings.lite) v.setAttribute('preload', appInfo.preloadUrl);
  v.classList.add('hidden');
  v.addEventListener('dom-ready', () => { v.__ready = true; applyZoom(s.id); applyChatFont(v); });
  v.addEventListener('did-navigate', () => { applyZoom(s.id); applyChatFont(v); });
  v.addEventListener('page-title-updated', e => setUnread(s.id, parseUnread(e.title)));
  v.addEventListener('ipc-message', e => {
    if (e.channel === 'mm-notify') forwardNotification(s.id, e.args[0] || {});
    else if (e.channel === 'mm-video') videoFromPage(s, v, e.args[0] || {});
    else if (e.channel === 'mm-key' && s.id === activeId) {
      const a = e.args[0] || {};
      if (a.zoom) zoomStep(a.zoom); else if (a.reload) reloadService(s.id, !!a.hard);
    }
  });
  v.addEventListener('page-favicon-updated', async e => {
    const cat = catOf(s.type);
    const url = e.favicons && e.favicons[e.favicons.length - 1];
    const key = s.id + '|' + url;
    if (cat.icon || !url || faviconDone.has(key)) return;
    faviconDone.add(key);
    const data = await window.api.fetchFavicon(s.id, url);
    const cur = services.find(x => x.id === s.id);
    if (data && cur) { cur.icon = data; renderList(); }
  });
  v.setAttribute('src', s.url);
  $('views').append(v);
  views.set(s.id, v);
  return v;
}

function reloadService(id, hard) {
  const v = views.get(id);
  if (!v) return;
  if (hard) v.reloadIgnoringCache(); else v.reload();
}

function dropView(id) {
  const v = views.get(id);
  if (v) { v.remove(); views.delete(id); }
  if (unread.delete(id)) updateUnreadTotal();
}

function sleepNow(id) {
  dropView(id);
  if (activeId === id) activeId = null;
  renderList();
}

function select(id) {
  showPanel(false);
  const target = svcById(id);
  if (target && currentWs !== 'all' && wsOf(target) !== currentWs) {
    currentWs = wsOf(target) || 'all'; // e.g. clicking a notification for a service in another workspace
    try { localStorage.setItem('mm-ws', currentWs); } catch (e) {}
  }
  lastSel[currentWs] = id;
  if (activeId && activeId !== id) lastActive.set(activeId, Date.now());
  activeId = id;
  try { window.api.setActive(id); } catch (e) {}
  lastActive.set(id, Date.now());
  const cur = services.find(x => x.id === id);
  if (cur) ensureView(cur); // a sleeping service wakes up here
  for (const [vid, v] of views) v.classList.toggle('hidden', vid !== id);
  renderList();
}

// ---------- dialog ----------
const proxyFields = ['pType', 'pHost', 'pPort', 'pUser', 'pPass', 'testBtn'];

function syncProxyUi() {
  const on = $('pEnabled').checked;
  proxyFields.forEach(f => ($(f).disabled = !on));
  const t = $('pType').value;
  $('pHint').textContent =
    t === 'socks4' || t === 'socks5'
      ? 'SOCKS with a username/password is bridged through a built-in local relay (Chromium has no native SOCKS login).'
      : t === 'https'
        ? 'HTTPS = TLS-encrypted connection to the proxy itself.'
        : '';
}

function syncBgUi() {
  const sleep = $('bMode').value === 'sleep';
  $('bMin').disabled = !sleep;
  $('bHint').textContent = sleep
    ? 'A sleeping service is unloaded and cannot show notifications until you open it again. It will not sleep while it is playing audio.'
    : 'Stays loaded in the background after the app starts, so messages and notifications keep arriving (uses more memory).';
}

function fillCatalogSelect() {
  const sel = $('fType');
  sel.innerHTML = '';
  const groups = new Map();
  for (const c of catalog) {
    if (!groups.has(c.group)) {
      const g = document.createElement('optgroup');
      g.label = c.group;
      groups.set(c.group, g);
      sel.append(g);
    }
    const o = document.createElement('option');
    o.value = c.type;
    o.textContent = c.name;
    groups.get(c.group).append(o);
  }
}

function openDialog(svc) {
  editing = svc || null;
  $('dlgTitle').textContent = svc ? `Edit ${svc.name}` : 'Add service';
  $('delBtn').style.display = svc ? '' : 'none';
  $('dataBox').style.display = svc ? '' : 'none';
  $('testOut').textContent = '';

  const p = (svc && svc.proxy) || {};
  $('fType').value = svc ? svc.type : catalog[0].type;
  $('fType').disabled = !!svc;
  $('fName').value = svc ? svc.name : catalog[0].name;
  $('fUrl').value = svc ? svc.url : catalog[0].url;
  if (!svc) $('fType').onchange();
  $('pEnabled').checked = !!p.enabled;
  $('pType').value = p.type || 'http';
  $('pHost').value = p.host || '';
  $('pPort').value = p.port || '';
  $('pUser').value = p.username || '';
  $('pPass').value = p.password || '';
  syncProxyUi();
  fillWsSelect();
  $('fWs').value = svc ? wsOf(svc) : (currentWs !== 'all' ? currentWs : '');
  $('bMode').value = svc ? modeOf(svc) : 'always';
  $('bMin').value = (svc && svc.sleepMin) || 10;
  $('bMute').checked = !!(svc && svc.muted);
  $('fIdent').value = (svc && svc.ua) || '';
  $('loginWinRow').hidden = !svc;
  syncBgUi();
  $('dlg').showModal();
}

function readForm() {
  return {
    id: editing ? editing.id : crypto.randomUUID(),
    type: $('fType').value,
    name: $('fName').value.trim() || catOf($('fType').value).name,
    url: normalizeUrl($('fUrl').value.trim()),
    icon: editing ? editing.icon : undefined,
    zoom: editing ? editing.zoom : undefined,
    workspace: $('fWs').value,
    mode: $('bMode').value,
    sleepMin: Math.max(1, Math.min(1440, Number($('bMin').value) || 10)),
    muted: $('bMute').checked,
    ua: $('fIdent').value,
    proxy: {
      enabled: $('pEnabled').checked,
      type: $('pType').value,
      host: $('pHost').value.trim().replace(/^[a-z0-9+]+:\/\//i, ''),
      port: Number($('pPort').value) || '',
      username: $('pUser').value,
      password: $('pPass').value
    }
  };
}

function normalizeUrl(u) {
  if (!u) return 'about:blank';
  return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
}

async function persist(svc) {
  services = await window.api.saveService(svc);
  dropView(svc.id); // recreate so the new proxy settings are used
  editing = svc;
  select(svc.id);
}

$('cookieBtn').onclick = async () => {
  if (!editing) return;
  const r = await window.api.importCookies(editing.id);
  if (r.canceled) return;
  if (r.error) return tell('Could not read that file: ' + r.error);
  await tell(`Imported ${r.ok} of ${r.total} cookies${r.bad ? ` (${r.bad} were refused)` : ''}.` + (r.ok ? '\nThe service will reload now.' : '\nNo cookies were found. Export the cookies of the site itself (for example x.com) and try again.'));
  if (r.ok && views.has(editing.id)) reloadService(editing.id);
};
$('loginWinBtn').onclick = async () => {
  if (!editing) return;
  const svc = { ...readForm(), icon: editing.icon, zoom: editing.zoom };
  services = await window.api.saveService(svc);            // make sure the identity and proxy chosen here are in use
  const v = views.get(editing.id);
  let url = svc.url; try { if (v && v.getURL && /^https?:/.test(v.getURL())) url = v.getURL(); } catch {}
  await window.api.openLoginWindow(editing.id, url);
};
window.api.onLoginClosed(id => { if (views.has(id)) reloadService(id); });

$('fType').onchange = () => {
  const c = catOf($('fType').value);
  $('fName').value = c.name === 'Web app (custom URL)' ? '' : c.name;
  $('fName').placeholder = c.name;
  $('fUrl').value = c.url;
  $('fUrl').placeholder = c.needsUrl ? 'Enter your server URL, e.g. https://chat.company.com' : 'https://example.com';
};
// Persian / Arabic-Indic digits (۰-۹ ٠-٩) are turned into normal digits as you type, so numbers
// work with any keyboard layout. (The old number fields silently rejected them.)
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹', ARABIC = '٠١٢٣٤٥٦٧٨٩';
const normDigits = str => String(str)
  .replace(/[۰-۹]/g, d => PERSIAN.indexOf(d))
  .replace(/[٠-٩]/g, d => ARABIC.indexOf(d))
  .replace(/[٫。．]/g, '.');
function numericField(id, { digitsOnly }) {
  const el = $(id);
  el.addEventListener('input', () => {
    let v = normDigits(el.value);
    if (digitsOnly) v = v.replace(/\D+/g, '');
    if (v !== el.value) {
      const pos = el.selectionStart - (el.value.length - v.length);
      el.value = v;
      try { el.setSelectionRange(Math.max(0, pos), Math.max(0, pos)); } catch (e) {}
    }
  });
}
numericField('pPort', { digitsOnly: true });
numericField('bMin', { digitsOnly: true });
numericField('pHost', { digitsOnly: false });
$('pEnabled').onchange = syncProxyUi;
$('bMode').onchange = syncBgUi;
$('pType').onchange = syncProxyUi;
$('addBtn').onclick = () => openDialog(null);
$('cancelBtn').onclick = () => $('dlg').close();
$('collapse').onclick = () => document.body.classList.toggle('collapsed');

$('form').onsubmit = async e => {
  e.preventDefault();
  const svc = readForm();
  if (/^(https?:\/\/)?$/i.test($('fUrl').value.trim()) || svc.url === 'about:blank') {
    $('testOut').style.color = '#f87171';
    $('testOut').textContent = 'Please enter the URL of this service.';
    return;
  }
  if (svc.proxy.enabled && (!svc.proxy.host || !svc.proxy.port)) {
    $('testOut').style.color = '#f87171';
    $('testOut').textContent = 'Proxy host and port are required.';
    return;
  }
  await persist(svc);
  $('dlg').close();
};

$('testBtn').onclick = async () => {
  const svc = readForm();
  $('testOut').style.color = '#a3a3b3';
  $('testOut').textContent = 'Testing…';
  await persist(svc);
  const r = await window.api.testService(svc.id);
  $('testOut').style.color = r.ok ? '#34d399' : '#f87171';
  $('testOut').textContent = r.ok
    ? `OK – exit IP ${r.ip} · first request ${r.firstMs} ms` + (r.repeatMs != null ? `, repeat ${r.repeatMs} ms` : '') + (r.firstMs > 1500 ? ' (slow connection)' : '')
    : `Failed: ${r.error}`;
};

$('cacheBtn').onclick = async () => {
  if (!editing) return;
  await window.api.clearCache(editing.id);
  reloadService(editing.id, true);
  $('testOut').style.color = '#34d399';
  $('testOut').textContent = 'Cache cleared.';
};

$('wipeBtn').onclick = async () => {
  if (!editing) return;
  if (!await askConfirm(`Sign out of "${editing.name}" and delete all its saved data?\nYou can then log in with a different account.`)) return;
  const id = editing.id;
  await window.api.clearData(id);
  dropView(id);   // recreate the page from scratch
  $('dlg').close();
  select(id);
};

$('resetBtn').onclick = async () => {
  if (!await askConfirm('Remove ALL services and delete their logins and data?', { yes: 'Remove all' })) return;
  services = await window.api.resetAll();
  for (const id of [...views.keys()]) dropView(id);
  activeId = null;
  renderList();
};

$('delBtn').onclick = async () => {
  if (!editing || !await askConfirm(`Delete "${editing.name}" and its stored login data?`)) return;
  services = await window.api.deleteService(editing.id);
  dropView(editing.id);
  if (activeId === editing.id) activeId = services[0] ? services[0].id : null;
  $('dlg').close();
  activeId ? select(activeId) : renderList();
};

document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (activeId && (e.key === 'F5' || (mod && e.key.toLowerCase() === 'r'))) {
    e.preventDefault();
    reloadService(activeId, e.shiftKey);
  } else if (mod && !e.altKey) {
    const dir = (e.key === '=' || e.key === '+') ? 'in' : (e.key === '-' || e.key === '_') ? 'out' : e.key === '0' ? 'reset' : null;
    if (dir) { e.preventDefault(); zoomStep(dir); }
  }
});
// the same shortcuts when a service page has the keyboard focus (forwarded by the main process)
window.api.onZoomKey(zoomStep);
window.api.onReloadKey(hard => { if (activeId) reloadService(activeId, hard); });

// ---------- zoom (per service) + toolbar ----------
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const zoomOf = s => s.zoom || 1;

function applyZoom(id) {
  const v = views.get(id), s = svcById(id);
  if (!v || !s || !v.__ready) return;
  try { v.setZoomFactor(zoomOf(s)); } catch (e) {}
}
function setZoom(id, z) {
  const s = svcById(id);
  if (!s) return;
  s.zoom = Math.round(Math.max(0.25, Math.min(5, z)) * 100) / 100;
  applyZoom(id);
  window.api.patchServices([{ id, zoom: s.zoom }]);
  updateToolbar();
}
function zoomStep(dir) {
  const s = activeId && svcById(activeId);
  if (!s) return;
  const z = zoomOf(s);
  if (dir === 'reset') return setZoom(s.id, 1);
  if (dir === 'in') return setZoom(s.id, ZOOM_STEPS.find(x => x > z + 0.001) || 5);
  setZoom(s.id, [...ZOOM_STEPS].reverse().find(x => x < z - 0.001) || 0.25);
}
function updateToolbar() {
  const s = activeId ? svcById(activeId) : null;
  const z = s ? zoomOf(s) : 1;
  $('tbTitle').textContent = s ? s.name : 'MultiMessenger';
  $('zVal').textContent = Math.round(z * 100) + '%';
  ['zOut', 'zIn', 'zVal', 'tbReload'].forEach(i => ($(i).disabled = !s));
  $('zReset').disabled = !s || Math.abs(z - 1) < 0.001;
  $('tbVideo').hidden = !(s && VIDEO_MODE[s.type]);
}
$('zOut').onclick = () => zoomStep('out');
$('zIn').onclick = () => zoomStep('in');
$('zVal').onclick = () => zoomStep('reset');
$('zReset').onclick = () => zoomStep('reset');
$('tbReload').onclick = e => { if (activeId) reloadService(activeId, e.shiftKey); };

// ---------- video downloader ----------
const VIDEO_MODE = { instagram: 'quick', facebook: 'quick', twitter: 'quick', youtube: 'choose' };
const VIDEO_URL = {
  instagram: /instagram\.com\/(?:[^/?#]+\/)?(p|reel|reels|tv|stories)\//i,
  facebook: /(facebook\.com\/(?:.*\/videos\/|watch|reel|share\/[vr]\/|.*\/posts\/|.*story)|fb\.watch|[?&]v=\d+)/i,
  twitter: /(x|twitter)\.com\/.+\/status\//i,
  youtube: /(youtube\.com\/(watch|shorts|live|embed)|youtu\.be\/)/i
};
let toastTimer = null;

// In-app replacements for confirm() / alert(). The system boxes block the whole window and, on Windows, can leave
// text fields (and the service pages) unable to take keyboard input afterwards.
function askConfirm(msg, { yes = 'OK', no = 'Cancel', onlyOk = false } = {}) {
  return new Promise(resolve => {
    const d = $('askDlg');
    $('askMsg').textContent = msg;
    $('askYes').textContent = yes; $('askNo').textContent = no; $('askNo').hidden = onlyOk;
    const done = r => { $('askYes').onclick = $('askNo').onclick = null; d.onclose = null; d.close(); restoreFocus(); resolve(r); };
    $('askYes').onclick = () => done(true);
    $('askNo').onclick = () => done(false);
    d.onclose = () => done(false);
    d.oncancel = () => done(false);
    d.showModal();
    $('askYes').focus();
  });
}
const tell = msg => askConfirm(msg, { onlyOk: true });

// Give keyboard focus back to the page you were using (the active service) if nothing in the app has it.
function restoreFocus() {
  setTimeout(() => {
    try {
      if (document.querySelector('dialog[open]')) return;
      const a = document.activeElement;
      if (a && a !== document.body && a.tagName !== 'WEBVIEW' && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      const v = views.get(activeId);
      if (v && v.__ready && !v.classList.contains('hidden')) v.focus();
    } catch {}
  }, 30);
}
window.addEventListener('focus', restoreFocus);

function toast(msg, onClick) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  t.onclick = () => { t.hidden = true; if (onClick) onClick(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}
const showDownloads = () => showPanel(true);

// helper programs (yt-dlp / ffmpeg): installed once, on demand
let toolResolve = null;
function toolDialog(kind, svc) {
  return new Promise(resolve => {
    const name = kind === 'ytdlp' ? 'yt-dlp' : kind === 'deno' ? 'Deno' : 'ffmpeg';
    $('toolTitle').textContent = kind === 'ytdlp' ? 'Video downloader needs a helper' : kind === 'deno' ? 'YouTube needs one more helper' : 'Install ffmpeg';
    $('toolText').textContent = kind === 'deno'
      ? 'YouTube downloads need the free JavaScript engine Deno (about 43 MB, downloaded once from GitHub' + (svc && svc.proxy && svc.proxy.enabled ? ' through this service\'s proxy' : '') + ').'
      : kind === 'ytdlp'
      ? 'Downloading videos uses the free open-source program yt-dlp (about 40 MB, plus Deno, about 43 MB, which YouTube needs). They are downloaded once from GitHub' + (svc && svc.proxy && svc.proxy.enabled ? ' through this service\'s proxy.' : '.')
      : 'ffmpeg (about 200 MB, downloaded once from GitHub) merges video and audio for high qualities and converts music to MP3.';
    $('toolMsg').textContent = ''; $('toolBar').hidden = true; $('toolFill').style.width = '0';
    $('toolGo').disabled = false; $('toolGo').textContent = 'Install';
    toolResolve = resolve;
    $('toolGo').onclick = async () => {
      $('toolGo').disabled = true; $('toolMsg').textContent = 'Downloading ' + name + '…'; $('toolBar').hidden = false;
      const r = await window.api.installTool(kind, svc && svc.id);
      if (r.ok) { $('toolDlg').close(); toolResolve = null; resolve(true); }
      else {
        $('toolGo').disabled = false; $('toolGo').textContent = 'Try again';
        $('toolMsg').textContent = 'Could not download: ' + r.error + '. If GitHub is blocked, turn on a proxy for this service (it is used for this download), or download ' + name + ' yourself and press "Choose file…".';
      }
    };
    $('toolLocate').onclick = async () => { if (await window.api.locateTool(kind)) { $('toolDlg').close(); toolResolve = null; resolve(true); } };
    $('toolCancel').onclick = () => { $('toolDlg').close(); toolResolve = null; resolve(false); };
    $('toolDlg').oncancel = () => { toolResolve = null; resolve(false); };
    $('toolDlg').showModal();
  });
}
window.api.onToolProgress(p => {
  const t = $('toolBar');
  if (p.unpacking) { $('toolMsg').textContent = 'Unpacking…'; return; }
  if (!t.hidden && p.total) {
    $('toolFill').style.width = Math.min(100, Math.round(p.received / p.total * 100)) + '%';
    $('toolMsg').textContent = `Downloading ${p.kind === 'ytdlp' ? 'yt-dlp' : p.kind === 'deno' ? 'Deno' : 'ffmpeg'}… ${fmtBytes(p.received)} of ${fmtBytes(p.total)}`;
  }
});
async function ensureYtdlp(svc, needJs) {
  const st = await window.api.toolsStatus();
  if (!st.ytdlp) return toolDialog('ytdlp', svc);
  if (needJs && st.canInstallJs && !st.js) return toolDialog('deno', svc);
  return true;
}

// buttons injected into the YouTube / Instagram pages talk to us here
const infoCache = new Map();
const infoViews = new Map(); // page address -> the page waiting for its quality list
window.api.onVideoStatus(d => {
  const v = infoViews.get(d.url);
  if (v) { try { v.send('mm-video-status', d); } catch (e) {} }
  if (vid && vid.url === d.url && !vid.info && $('vidDlg').open) $('vidStatus').textContent = 'Loading available qualities… ' + d.text;
});
async function videoFromPage(s, v, m) {
  try { await videoFromPage2(s, v, m); }
  catch (e) {
    console.error(e);
    if (m.act === 'info') { try { v.send('mm-video-info', { url: m.url, ok: false, error: 'Internal error: ' + (e && e.message || e) }); } catch (x) {} }
    else toast('Video downloader error: ' + (e && e.message || e));
  }
}
async function videoFromPage2(s, v, m) {
  if (m.act === 'hint') return toast(m.text);
  if (m.act === 'ffmpeg') { await toolDialog('ffmpeg', s); infoCache.clear(); return; }
  if (!(await ensureYtdlp(s, s.type === 'youtube'))) {
    if (m.act === 'info') v.send('mm-video-info', { url: m.url, ok: false, error: 'The downloader is not installed.' });
    return;
  }
  if (m.act === 'info') {
    let c = infoCache.get(m.url);
    if (!c || Date.now() - c.t > 300000) {
      infoViews.set(m.url, v);
      const x = await Promise.race([window.api.videoInfo(s.id, m.url), new Promise(r => setTimeout(() => r({ ok: false, network: true, error: 'No answer from the downloader after 2.5 minutes. Open the log in Settings → Video downloader.' }), 150000))]);
      infoViews.delete(m.url);
      c = { t: Date.now(), x };
      if (x.ok) infoCache.set(m.url, c);
    }
    try { v.send('mm-video-info', { url: m.url, ...c.x }); } catch (e) {}
  } else if (m.act === 'start') {
    const r = await window.api.videoStart(s.id, m.url, m.job || { kind: 'auto' });
    if (r.ok) toast('Download started. Click here to see it in Downloads.', showDownloads);
    else toast(r.error || 'Could not start the download.');
  } else if (m.act === 'batch') {
    const urls = (m.urls || []).slice(0, 300);
    if (!urls.length) return toast('No posts found on this page yet. Scroll down so the posts load, then try again.');
    if (!await askConfirm(`Download ${urls.length} posts from this page?\n\nOnly the posts already loaded are included. Scroll down first to load more. Posts without a video will show as failed.`)) return;
    toast(`Downloading ${urls.length} posts. Click here to see them in Downloads.`, showDownloads);
    for (const u of urls) {
      while (dlList.filter(d => d.kind === 'tool' && dlActive(d)).length >= 3) await new Promise(r => setTimeout(r, 700));
      await window.api.videoStart(s.id, u, { kind: 'auto' });
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

async function videoAction(s, url, fromLink) {
  const mode = VIDEO_MODE[s.type];
  if (!mode) return;
  if (!fromLink && !(VIDEO_URL[s.type] || /./).test(url || '')) {
    toast('Open the video itself first (its own page), then press Download. You can also right-click a video link and choose "Download video".');
    return;
  }
  if (!(await ensureYtdlp(s, s.type === 'youtube'))) return;
  if (mode === 'quick') {
    const r = await window.api.videoStart(s.id, url, { kind: 'auto' });
    if (r.ok) toast('Download started. Click here to see it in Downloads.', showDownloads);
    else toast(r.error || 'Could not start the download.');
  } else openVideoDialog(s, url);
}

let vid = null; // {svc, url, info, tab}
async function openVideoDialog(s, url) {
  vid = { svc: s, url, info: null, tab: 'video' };
  $('vidTitle').textContent = url; $('vidMeta').textContent = ''; $('vidThumb').hidden = true;
  $('vidStatus').textContent = 'Loading available qualities…'; $('vidStatus').hidden = false;
  $('vidTabs').hidden = true; $('vidList').innerHTML = ''; $('vidFfmpeg').hidden = true; $('vidGo').disabled = true;
  if (!$('vidDlg').open) $('vidDlg').showModal();
  const slow = setTimeout(() => { if (vid && vid.url === url && !vid.info) $('vidStatus').textContent = 'Still working… YouTube is slow to answer. This can take up to a minute, especially through a proxy.'; }, 8000);
  const r = await window.api.videoInfo(s.id, url);
  clearTimeout(slow);
  if (!$('vidDlg').open || !vid || vid.url !== url) return;
  if (r.needTools) { $('vidDlg').close(); if (await ensureYtdlp(s, true)) openVideoDialog(s, url); return; }
  if (!r.ok) {
    $('vidStatus').textContent = r.network
      ? 'Could not reach the website. ' + (r.proxy ? 'The proxy of this service did not get through.' : 'This service has no proxy turned on. If the site is blocked for you, turn on a working proxy in this service\'s settings (it is also used for downloads).')
      : 'Could not read this video: ' + (r.error || 'unknown error') + '. If this keeps happening, update yt-dlp in Settings → Video downloader.';
    if (r.details) { const d = document.createElement('details'); d.className = 'hint'; d.innerHTML = '<summary>Technical details</summary>'; const pre = document.createElement('pre'); pre.textContent = r.details; pre.style.cssText = 'white-space:pre-wrap;max-height:120px;overflow:auto;font-size:11px'; d.append(pre); $('vidStatus').append(d); }
    return;
  }
  vid.info = r.info; $('vidStatus').hidden = true;
  const i = r.info;
  $('vidTitle').textContent = i.title || url;
  $('vidMeta').textContent = [i.uploader, i.duration ? fmtDur(i.duration) : ''].filter(Boolean).join(' · ');
  $('vidThumb').hidden = !i.thumbnail; if (i.thumbnail) $('vidThumb').src = i.thumbnail;
  $('vidTabs').hidden = false;
  vidTab(vid.tab);
}
const fmtDur = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function vidTab(tab) {
  vid.tab = tab;
  document.querySelectorAll('#vidTabs .tabbtn').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const i = vid.info, list = $('vidList');
  list.innerHTML = '';
  const add = (value, text, extra, checked) => {
    const l = document.createElement('label'); l.className = 'vopt';
    const r = document.createElement('input'); r.type = 'radio'; r.name = 'vq'; r.value = value; r.checked = !!checked;
    const t = document.createElement('span'); t.className = 'grow'; t.textContent = text;
    l.append(r, t);
    if (extra) { const x = document.createElement('small'); x.textContent = extra; l.append(x); }
    list.append(l);
  };
  const sz = n => (n ? '~' + fmtBytes(n) : '');
  if (tab === 'video') {
    i.videos.forEach((v, n) => add('v:' + v.height, `${v.height}p${v.fps > 30 ? ' · ' + Math.round(v.fps) + ' fps' : ''}`, sz(v.size), n === 0));
    if (!i.videos.length) { const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'No video qualities were found.'; list.append(e); }
  } else {
    if (i.hasFfmpeg) [320, 192, 128].forEach((k, n) => add('m:' + k, `MP3 · ${k} kbps`, 'converted', n === 0));
    i.audios.forEach((a, n) => add('a:' + a.id, `${a.ext.toUpperCase()} · ${a.abr || '?'} kbps`, [sz(a.size), 'original'].filter(Boolean).join(' · '), !i.hasFfmpeg && n === 0));
    if (!list.children.length) { const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'No audio qualities were found.'; list.append(e); }
  }
  $('vidFfmpeg').hidden = i.hasFfmpeg;
  $('vidGo').disabled = !list.querySelector('input');
}
document.querySelectorAll('#vidTabs .tabbtn').forEach(b => (b.onclick = () => vid && vid.info && vidTab(b.dataset.tab)));
$('vidCancel').onclick = () => { vid = null; $('vidDlg').close(); };
$('vidGo').onclick = async () => {
  const sel = document.querySelector('#vidList input:checked');
  if (!sel || !vid) return;
  const [k, v] = [sel.value.slice(0, 1), sel.value.slice(2)];
  const job = k === 'v' ? { kind: 'video', height: Number(v) } : k === 'm' ? { kind: 'audio', mp3: Number(v) } : { kind: 'audio', formatId: v };
  job.title = vid.info.title;
  const { svc, url } = vid;
  vid = null; $('vidDlg').close();
  const r = await window.api.videoStart(svc.id, url, job);
  if (r.ok) toast('Download started. Click here to see it in Downloads.', showDownloads);
  else toast(r.error || 'Could not start the download.');
};
$('vidFfmpegBtn').onclick = async () => {
  if (!vid) return;
  const st = await window.api.toolsStatus(), { svc, url } = vid;
  if (!st.canInstallFfmpeg) { if (await window.api.locateTool('ffmpeg')) openVideoDialog(svc, url); return; }
  $('vidDlg').close();
  if (await toolDialog('ffmpeg', svc)) openVideoDialog(svc, url); else openVideoDialog(svc, url);
};
$('tbVideo').onclick = () => {
  const s = activeId && svcById(activeId), v = s && views.get(s.id);
  if (!s || !v) return;
  let url = ''; try { url = v.getURL(); } catch (e) {}
  videoAction(s, url, false);
};
window.api.onVideoRequest(d => { const s = activeId && svcById(activeId); if (s && VIDEO_MODE[s.type]) videoAction(s, d.url, true); });

async function refreshVideoSettings() {
  const st = await window.api.toolsStatus();
  $('vdStatus').textContent = `yt-dlp: ${st.ytdlp ? 'installed' : 'not installed'} · Deno (YouTube): ${st.js ? 'installed' : 'not installed'} · ffmpeg: ${st.ffmpeg ? 'installed' : 'not installed'}`;
  $('vdFfmpeg').hidden = !st.canInstallFfmpeg;
}
const activeSvcOrNull = () => (activeId && svcById(activeId)) || null;
$('vdUpdate').onclick = async () => { $('setDlg').close(); await toolDialog('ytdlp', activeSvcOrNull()); refreshVideoSettings(); };
$('vdFfmpeg').onclick = async () => { $('setDlg').close(); await toolDialog('ffmpeg', activeSvcOrNull()); refreshVideoSettings(); };
$('vdLog').onclick = () => window.api.openVideoLog();
$('vdLocY').onclick = async () => { await window.api.locateTool('ytdlp'); refreshVideoSettings(); };
$('vdLocF').onclick = async () => { await window.api.locateTool('ffmpeg'); refreshVideoSettings(); };

// ---------- workspaces ----------
function wsUnread(id) {
  let t = 0;
  for (const [sid, n] of unread) {
    const s = svcById(sid);
    if (!s || s.muted) continue;
    if (id === 'all' || wsOf(s) === id) t += n;
  }
  return t;
}

function renderRail() {
  const box = $('wsList');
  box.innerHTML = '';
  const mk = (id, label, title, color) => {
    const b = document.createElement('button');
    b.className = 'ws' + (id === 'all' ? ' all' : '') + (currentWs === id ? ' active' : '');
    b.title = title;
    b.textContent = label;
    if (color) { const c = document.createElement('i'); c.className = 'wscolor'; c.style.background = color; b.append(c); }
    const n = wsUnread(id);
    if (n > 0) { const d = document.createElement('span'); d.className = 'wsdot'; d.textContent = n > 99 ? '99+' : String(n); b.append(d); }
    return b;
  };
  const all = mk('all', 'All', 'All services');
  all.onclick = () => selectWorkspace('all');
  box.append(all);
  for (const w of workspaces) {
    const b = mk(w.id, w.emoji || w.name.slice(0, 1).toUpperCase(), `${w.name}\nRight-click to edit`, w.color);
    b.onclick = () => selectWorkspace(w.id);
    b.oncontextmenu = e => { e.preventDefault(); openWsDialog(w); };
    box.append(b);
  }
}

function selectWorkspace(id) {
  showPanel(false);
  currentWs = id;
  try { localStorage.setItem('mm-ws', id); } catch (e) {}
  const a = activeId && svcById(activeId);
  if (a && id !== 'all' && wsOf(a) !== id) activeId = null;       // active service is not in this workspace
  if (!activeId) {                                                 // go back to what was open here last time
    const last = lastSel[id] && svcById(lastSel[id]);
    if (last && (id === 'all' || wsOf(last) === id) && views.has(last.id)) { select(last.id); return; }
  }
  for (const [vid, v] of views) v.classList.toggle('hidden', vid !== activeId);
  renderList();
}

function fillWsSelect() {
  const sel = $('fWs');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = workspaces.length ? 'None' : 'None (create workspaces with + on the left bar)';
  sel.append(none);
  for (const w of workspaces) {
    const o = document.createElement('option');
    o.value = w.id; o.textContent = `${w.emoji ? w.emoji + ' ' : ''}${w.name}`;
    sel.append(o);
  }
}

const WS_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#64748b'];
const WS_SUGGEST = [['📱', 'Social media'], ['🤖', 'AI'], ['✉️', 'Mail'], ['💼', 'Work'], ['🎬', 'Media'], ['🎮', 'Gaming']];
const WS_STARTER = [
  { name: 'Social media', emoji: '📱', color: '#2563eb', types: ['whatsapp', 'telegram', 'instagram', 'twitter', 'facebook', 'messenger', 'discord', 'element', 'youtube'] },
  { name: 'AI', emoji: '🤖', color: '#7c3aed', types: ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek', 'glm', 'perplexity', 'copilot'] },
  { name: 'Mail', emoji: '✉️', color: '#dc2626', types: ['gmail'] },
  { name: 'Work', emoji: '💼', color: '#059669', types: ['googlechat', 'teams', 'skypeb', 'mattermost', 'linkedin'] }
];
let editingWs = null;
let wsColor = WS_COLORS[0];

function paintSwatches() {
  const box = $('wsColors');
  box.innerHTML = '';
  for (const col of WS_COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (col === wsColor ? ' on' : '');
    b.style.background = col;
    b.title = col;
    b.onclick = () => { wsColor = col; paintSwatches(); };
    box.append(b);
  }
}

function openWsDialog(ws) {
  editingWs = ws || null;
  $('wsTitle').textContent = ws ? `Edit workspace` : 'New workspace';
  $('wsName').value = ws ? ws.name : '';
  $('wsEmoji').value = ws ? ws.emoji : '';
  wsColor = ws ? ws.color : WS_COLORS[workspaces.length % WS_COLORS.length];
  paintSwatches();
  $('wsDelete').style.display = ws ? '' : 'none';
  $('wsStarter').style.display = ws ? 'none' : '';
  const chips = $('wsChips');
  chips.innerHTML = '';
  if (!ws) for (const [em, nm] of WS_SUGGEST) {
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'chip'; c.textContent = `${em} ${nm}`;
    c.onclick = () => { $('wsEmoji').value = em; $('wsName').value = nm; };
    chips.append(c);
  }
  const list = $('wsServices');
  list.innerHTML = '';
  if (!services.length) list.textContent = 'No services yet. Add some first, or assign them later from each service\'s settings.';
  for (const s of services) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.dataset.id = s.id;
    cb.checked = !!ws && wsOf(s) === ws.id;
    const t = document.createElement('span');
    t.textContent = s.name;
    l.append(cb, t);
    const other = workspaces.find(w => w.id === wsOf(s) && (!ws || w.id !== ws.id));
    if (other) { const sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = `(now in ${other.name} – checking moves it)`; l.append(sub); }
    list.append(l);
  }
  $('wsHint').textContent = '';
  $('wsDlg').showModal();
}

$('wsAdd').onclick = () => openWsDialog(null);
$('wsCancel').onclick = () => $('wsDlg').close();
$('wsSave').onclick = async () => {
  const name = $('wsName').value.trim();
  if (!name) { $('wsHint').style.color = 'var(--danger)'; $('wsHint').textContent = 'Please enter a name.'; return; }
  const id = editingWs ? editingWs.id : crypto.randomUUID();
  workspaces = await window.api.saveWorkspace({ id, name, emoji: $('wsEmoji').value.trim(), color: wsColor });
  const updates = [];
  for (const cb of $('wsServices').querySelectorAll('input[type=checkbox]')) {
    const sv = svcById(cb.dataset.id);
    if (!sv) continue;
    if (cb.checked && wsOf(sv) !== id) updates.push({ id: sv.id, workspace: id });
    else if (!cb.checked && wsOf(sv) === id) updates.push({ id: sv.id, workspace: '' });
  }
  if (updates.length) services = await window.api.patchServices(updates);
  $('wsDlg').close();
  selectWorkspace(id);
};
$('wsDelete').onclick = async () => {
  if (!editingWs || !await askConfirm(`Delete workspace "${editingWs.name}"?\nIts services are kept and move back to "All".`)) return;
  const r = await window.api.deleteWorkspace(editingWs.id);
  workspaces = r.workspaces; services = r.services;
  $('wsDlg').close();
  if (currentWs === editingWs.id) selectWorkspace('all'); else renderList();
};
$('wsStarter').onclick = async () => {
  let made = 0, sorted = 0;
  const updates = [];
  for (const st of WS_STARTER) {
    let w = workspaces.find(x => x.name.toLowerCase() === st.name.toLowerCase());
    if (!w) {
      w = { id: crypto.randomUUID(), name: st.name, emoji: st.emoji, color: st.color };
      workspaces = await window.api.saveWorkspace(w);
      made++;
    }
    for (const sv of services) {
      if (st.types.includes(sv.type) && !wsOf(sv) && !updates.some(u => u.id === sv.id)) { updates.push({ id: sv.id, workspace: w.id }); sorted++; }
    }
  }
  if (updates.length) services = await window.api.patchServices(updates);
  $('wsDlg').close();
  renderList();
  if (made || sorted) tell(`Created ${made} workspace${made === 1 ? '' : 's'} and sorted ${sorted} service${sorted === 1 ? '' : 's'}.`);
};

// ---------- downloads ----------
const DL_EXT = {
  '🖼️': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif'],
  '🎞️': ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v'],
  '🎵': ['mp3', 'm4a', 'wav', 'ogg', 'opus', 'flac', 'aac'],
  '📦': ['zip', 'rar', '7z', 'tar', 'gz'],
  '📝': ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']
};
const RISKY = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|jar|lnk|reg|hta|wsf|msix|appx|apk|dll)$/i;
const dlEmoji = name => {
  const e = (String(name).split('.').pop() || '').toLowerCase();
  for (const [em, list] of Object.entries(DL_EXT)) if (list.includes(e)) return em;
  return '📄';
};
function fmtBytes(n) {
  n = Number(n) || 0;
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 1 : 0) : String(Math.round(n))) + ' ' + u[i];
}
const dlActive = d => d.state === 'progressing' || d.state === 'paused';

function updateDlBadge() {
  const n = dlList.filter(dlActive).length;
  for (const id of ['dlCount', 'tbDlBadge']) {
    $(id).hidden = n === 0;
    $(id).textContent = String(n);
  }
}
function dlUpsert(rec) {
  const i = dlList.findIndex(d => d.id === rec.id);
  if (i < 0) dlList.unshift(rec); else dlList[i] = rec;
  updateDlBadge();
  if (!$('panel').hidden) renderDownloads();
}
async function dlDo(rec, act) {
  if (act === 'open') {
    if (RISKY.test(rec.name) && !await askConfirm(`"${rec.name}" is a program or script and can run code on your PC.\nOpen it anyway?`)) return;
    const ok = await window.api.downloadAction(rec.id, 'open');
    if (!ok) tell('Could not open the file. It may have been moved or deleted.');
    return;
  }
  await window.api.downloadAction(rec.id, act);
  if (act === 'remove' || act === 'retry') {
    dlList = dlList.filter(d => d.id !== rec.id);
    updateDlBadge();
    renderDownloads();
  }
}
function renderDownloads() {
  const box = $('dlList');
  box.innerHTML = '';
  if (!dlList.length) {
    const e = document.createElement('div');
    e.className = 'dlempty';
    e.textContent = 'No downloads yet. Right-click an image, video or link in any service and choose Download.';
    box.append(e);
    return;
  }
  for (const d of dlList) {
    const row = document.createElement('div');
    row.className = 'dl' + (d.state === 'interrupted' || d.state === 'cancelled' ? ' bad' : '');
    const ic = document.createElement('div'); ic.className = 'dlicon'; ic.textContent = dlEmoji(d.name);
    const mid = document.createElement('div'); mid.style.minWidth = '0';
    const nm = document.createElement('div'); nm.className = 'dlname'; nm.textContent = d.name; nm.title = d.path || d.url || d.name;
    const meta = document.createElement('div'); meta.className = 'dlmeta';
    const pct = d.total > 0 ? Math.min(100, Math.round(d.received / d.total * 100)) : 0;
    const size = d.total > 0 ? `${fmtBytes(d.received)} of ${fmtBytes(d.total)} (${pct}%)` : fmtBytes(d.received);
    const state = d.state === 'progressing' ? (d.phase || size)
      : d.state === 'paused' ? `Paused – ${size}`
      : d.state === 'completed' ? `Completed – ${fmtBytes(d.total || d.received)}${d.finishedAt ? ' – ' + new Date(d.finishedAt).toLocaleString() : ''}`
      : d.state === 'cancelled' ? 'Cancelled' : (d.error ? 'Failed – ' + d.error : 'Failed or interrupted');
    meta.textContent = `${d.service || 'Unknown service'} · ${state}${d.note && d.state === 'completed' ? ' · ' + d.note : ''}`;
    if (d.details) meta.title = d.details;
    mid.append(nm, meta);
    if (dlActive(d)) {
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = (d.total > 0 ? pct : 100) + '%';
      if (d.total <= 0) fill.style.opacity = '.45';
      bar.append(fill); mid.append(bar);
    }
    const acts = document.createElement('div'); acts.className = 'acts';
    const btn = (label, act, cls = 'ghost') => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls + ' sm'; b.textContent = label;
      b.onclick = () => dlDo(d, act);
      acts.append(b);
    };
    if (d.state === 'progressing') { if (d.kind !== 'tool') btn('Pause', 'pause'); btn('Cancel', 'cancel'); }
    else if (d.state === 'paused') { btn('Resume', 'resume', 'primary'); btn('Cancel', 'cancel'); }
    else if (d.state === 'completed') { btn('Open', 'open', 'primary'); btn('Show in folder', 'show'); btn('Remove', 'remove'); }
    else { if (/^https?:/i.test(d.url || '')) btn('Retry', 'retry', 'primary'); btn('Remove', 'remove'); }
    row.append(ic, mid, acts);
    box.append(row);
  }
}
async function refreshDlSettings() {
  $('dlDir').textContent = 'Saving to: ' + await window.api.downloadDir();
  $('dlAsk').checked = !!(await window.api.getSettings()).askDownload;
}
function showPanel(on) {
  $('panel').hidden = !on;
  $('content').classList.toggle('panel-open', on);
  if (on) { renderDownloads(); refreshDlSettings(); }
}
$('dlBtn').onclick = () => showPanel($('panel').hidden);
$('tbDl').onclick = () => showPanel($('panel').hidden);
$('dlClose').onclick = () => showPanel(false);
$('dlOpenDir').onclick = () => window.api.openDownloadDir();
$('dlChoose').onclick = async () => { if (await window.api.chooseDownloadDir()) refreshDlSettings(); };
$('dlClear').onclick = async () => { dlList = await window.api.clearDownloads(); updateDlBadge(); renderDownloads(); };
$('dlAsk').onchange = () => window.api.setSettings({ askDownload: $('dlAsk').checked });
window.api.onDownloadUpdate(dlUpsert);
window.api.onDownloadsOpen(() => showPanel(true));

// ---------- unread counts, notifications ----------
// Most web apps put the unread count in the page title: "(3) WhatsApp", "[2] Telegram", "Inbox (5) - mail".
function parseUnread(title) {
  const t = String(title || '');
  let m = t.match(/^[\(\[](\d{1,4})\+?[\)\]]/) || t.match(/Inbox \((\d{1,4})\)/i);
  if (m) return Number(m[1]);
  if (/^\u2022\s/.test(t)) return 1; // "• Discord": unread without a number
  return 0;
}

function badgeDataUrl(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#e5484d';
  g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  const txt = n > 99 ? '99+' : String(n);
  g.font = `bold ${txt.length > 2 ? 14 : txt.length > 1 ? 19 : 23}px Segoe UI, Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(txt, 16, 17);
  return c.toDataURL('image/png');
}

function updateUnreadTotal() {
  let total = 0;
  for (const [id, n] of unread) { const s = services.find(x => x.id === id); if (s && !s.muted) total += n; }
  window.api.setUnread(total, total ? badgeDataUrl(total) : '');
}

function setUnread(id, n) {
  if ((unread.get(id) || 0) === n) return;
  if (n > 0) unread.set(id, n); else unread.delete(id);
  renderList();
  updateUnreadTotal();
}

function forwardNotification(serviceId, n) {
  const s = services.find(x => x.id === serviceId);
  if (!s || s.muted) return;
  window.api.notify({
    serviceId,
    nid: n.id,
    title: n.title ? `${s.name} – ${n.title}` : s.name,
    body: n.body || '',
    silent: !!n.silent
  });
}

window.api.onNotificationClick(({ serviceId, nid }) => {
  if (!services.some(x => x.id === serviceId)) return;
  select(serviceId);
  const v = views.get(serviceId);
  if (v && nid != null) { try { v.send('mm-click', nid); } catch (e) {} }
});

// ---------- sleep after inactivity ----------
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const s of services) {
    if (s.id === activeId || !views.has(s.id) || modeOf(s) !== 'sleep') continue;
    if (now - (lastActive.get(s.id) || 0) < (s.sleepMin || 10) * 60000) continue;
    const v = views.get(s.id);
    try { if (v.isCurrentlyAudible && v.isCurrentlyAudible()) continue; } catch (e) {}
    dropView(s.id);
    changed = true;
  }
  if (changed) renderList();
}, 30000);

// ---------- app settings dialog ----------
function syncSettingsUi() {
  $('setHidden').disabled = !$('setAuto').checked;
  $('setHint').textContent = appInfo.platform === 'win32' ? '' : 'Starting with the system is only supported on Windows and macOS.';
  $('setAuto').disabled = appInfo.platform !== 'win32' && appInfo.platform !== 'darwin';
  if ($('setAuto').disabled) $('setHidden').disabled = true;
  $('setPin').disabled = appInfo.platform !== 'win32';
}
$('settingsBtn').onclick = async () => {
  appSettings = await window.api.getSettings();
  $('setTray').checked = !!appSettings.closeToTray;
  $('setAuto').checked = !!appSettings.autoStart;
  $('setHidden').checked = !!appSettings.startHidden;
  $('setNotif').checked = !!appSettings.notifications;
  $('setFlash').checked = !!appSettings.flash;
  $('setPin').checked = appSettings.pinTray !== false;
  $('setSpell').checked = !!appSettings.spellcheck;
  $('setHw').checked = appSettings.hwAccel !== false;
  $('setLite').checked = !!appSettings.lite;
  refreshVideoSettings();
  syncSettingsUi();
  $('setDlg').showModal();
};
const saveSetting = async () => {
  syncSettingsUi();
  appSettings = await window.api.setSettings({
    closeToTray: $('setTray').checked,
    autoStart: $('setAuto').checked,
    startHidden: $('setHidden').checked,
    notifications: $('setNotif').checked,
    flash: $('setFlash').checked,
    pinTray: $('setPin').checked,
    spellcheck: $('setSpell').checked,
    hwAccel: $('setHw').checked,
    lite: $('setLite').checked
  });
};
['setTray', 'setAuto', 'setHidden', 'setNotif', 'setFlash', 'setPin', 'setSpell', 'setHw', 'setLite'].forEach(id => ($(id).onchange = saveSetting));
$('setTaskbar').onclick = () => window.api.openTaskbarSettings();
$('setClose').onclick = () => $('setDlg').close();
$('setRestart').onclick = () => window.api.relaunch();
$('setSleepAll').onclick = () => {   // free CPU and memory right now: unload every service except the open one
  for (const id of [...views.keys()]) if (id !== activeId) dropView(id);
  renderList();
  $('setSleepAll').textContent = 'Done – background services are asleep';
  setTimeout(() => ($('setSleepAll').textContent = 'Sleep all background services now'), 2500);
};

// ---------- appearance ----------
const THEMES = [
  ['dark', 'Dark (default)'], ['mac', 'Classic Mac'], ['xp', 'Windows XP'], ['win11', 'Windows 11'],
  ['kde', 'KDE Plasma'], ['gnome', 'GNOME'], ['xfce', 'Xfce'], ['plan9', 'Plan 9'],
  ['dos', 'MS-DOS style'], ['bit2', '2-bit color'], ['bit8', '8-bit color'], ['bit16', '16-bit color'],
  ['bit32', '32-bit color'], ['hc', 'High contrast']
];
const DEFAULT_ICON = 28;
const curTheme = () => document.documentElement.dataset.theme || 'dark';
const curSize = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--icon-size')) || DEFAULT_ICON;

function applyTheme(t) {
  if (t === 'dark') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('mm-theme', t === 'dark' ? '' : t); } catch (e) {}
}
function applySize(px) {
  document.documentElement.style.setProperty('--icon-size', px + 'px');
  $('sizeVal').textContent = px + ' px';
  try { localStorage.setItem('mm-icon', String(px)); } catch (e) {}
}

THEMES.forEach(([v, n]) => {
  const o = document.createElement('option');
  o.value = v; o.textContent = n;
  $('themeSel').append(o);
});
// ---- application font (installed fonts only) ----
const COMMON_FONTS = ['Segoe UI', 'Segoe UI Variable', 'Tahoma', 'Verdana', 'Arial', 'Calibri', 'Cambria', 'Candara', 'Consolas',
  'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype',
  'Times New Roman', 'Trebuchet MS', 'Comic Sans MS', 'Franklin Gothic Medium', 'Gill Sans MT', 'Bahnschrift', 'Sylfaen', 'Ebrima',
  'Nirmala UI', 'Leelawadee UI', 'Yu Gothic UI', 'Malgun Gothic', 'Microsoft YaHei UI', 'SimSun', 'Vazirmatn', 'IRANSans', 'Noto Sans',
  'Open Sans', 'Roboto', 'Inter', 'Helvetica', 'Helvetica Neue', 'San Francisco', 'Ubuntu', 'Cantarell', 'DejaVu Sans', 'Fira Sans',
  'Source Sans Pro', 'Lato', 'Montserrat', 'JetBrains Mono', 'Cascadia Code', 'Cascadia Mono', 'Fira Code', 'Press Start 2P'];
let fontsCache = null;
function fontInstalled(name) {
  const c = document.createElement('canvas').getContext('2d');
  const txt = 'mmmmmmmmmmlli 0123 Ag';
  return ['monospace', 'serif', 'sans-serif'].some(base => {
    c.font = `72px ${base}`; const w0 = c.measureText(txt).width;
    c.font = `72px "${name}", ${base}`; return c.measureText(txt).width !== w0;
  });
}
async function loadFonts() {
  if (fontsCache) return fontsCache;
  let names = [], source = 'installed';
  try {
    if (window.queryLocalFonts) {
      const list = await window.queryLocalFonts();
      names = [...new Set(list.map(f => f.family))];
    }
  } catch (e) { names = []; }
  if (!names.length) { names = COMMON_FONTS.filter(fontInstalled); source = 'common'; }
  names.sort((a, b) => a.localeCompare(b));
  fontsCache = { names, source };
  return fontsCache;
}
function applyFont(name) {
  const root = document.documentElement;
  try {
    if (!name) { root.style.removeProperty('--font'); localStorage.removeItem('mm-font'); localStorage.removeItem('mm-font-name'); return; }
    const stack = `"${name.replace(/"/g, '')}", system-ui, sans-serif`;
    root.style.setProperty('--font', stack);
    localStorage.setItem('mm-font', stack);
    localStorage.setItem('mm-font-name', name);
  } catch (e) {}
}
const savedFont = () => { try { return localStorage.getItem('mm-font-name') || ''; } catch (e) { return ''; } };
async function fillFontSelect() {
  const sel = $('fontSel');
  $('fontHint').textContent = 'Reading installed fonts…';
  const { names, source } = await loadFonts();
  const cur = savedFont();
  sel.innerHTML = '';
  const def = document.createElement('option'); def.value = ''; def.textContent = 'Theme default'; sel.append(def);
  const list = cur && !names.includes(cur) ? [cur, ...names] : names;
  for (const n of list) { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.append(o); }
  sel.value = cur;
  const cs = $('chatFontSel'), cc = savedChatFont();
  cs.innerHTML = '<option value="">Website default</option>';
  for (const n of (cc && !names.includes(cc) ? [cc, ...names] : names)) { const o = document.createElement('option'); o.value = n; o.textContent = n; cs.append(o); }
  cs.value = cc;
  $('fontHint').textContent = source === 'installed'
    ? `${names.length} installed fonts found. The font applies to the app itself, not to the websites inside.`
    : 'Could not read the full font list, so only common fonts that are installed are shown.';
}
$('fontSel').onchange = () => applyFont($('fontSel').value);

// ---------- font inside the services (chats) ----------
const savedChatFont = () => { try { return localStorage.getItem('mm-chatfont') || ''; } catch (e) { return ''; } };
async function applyChatFont(v) {
  if (!v.__ready) return;
  try {
    if (v.__fontKey) { const k = v.__fontKey; v.__fontKey = null; await v.removeInsertedCSS(k); }
    const name = savedChatFont();
    if (!name) return;
    const f = `"${name.replace(/["\\]/g, '')}"`;
    v.__fontKey = await v.insertCSS(
      `html, body, body *:not([class*="icon" i]):not([class*="symbol" i]):not([class*="material" i]):not([class*="emoji" i]):not(code):not(pre):not(kbd):not(svg *) { font-family: ${f}, Arial, sans-serif !important; }`);
  } catch (e) {}
}
function applyChatFontAll() { for (const v of views.values()) applyChatFont(v); }
$('chatFontSel').onchange = () => {
  try { const n = $('chatFontSel').value; n ? localStorage.setItem('mm-chatfont', n) : localStorage.removeItem('mm-chatfont'); } catch (e) {}
  applyChatFontAll();
};

$('themeBtn').onclick = () => {
  $('themeSel').value = curTheme();
  $('sizeRange').value = curSize();
  $('sizeVal').textContent = curSize() + ' px';
  $('themeDlg').showModal();
  fillFontSelect(); // started right after the click so the browser allows reading the font list
};
$('themeSel').onchange = () => applyTheme($('themeSel').value);
$('sizeRange').oninput = () => applySize(Number($('sizeRange').value));
$('themeReset').onclick = () => {
  applyTheme('dark'); applySize(DEFAULT_ICON); applyFont(''); $('fontSel').value = '';
  try { localStorage.removeItem('mm-chatfont'); } catch (e) {} $('chatFontSel').value = ''; applyChatFontAll();
  $('themeSel').value = 'dark'; $('sizeRange').value = DEFAULT_ICON;
};
$('themeClose').onclick = () => $('themeDlg').close();

// ---------- boot ----------
(async () => {
  catalog = await window.api.getCatalog();
  appInfo = await window.api.getInfo();
  appSettings = await window.api.getSettings();
  fillCatalogSelect();
  services = await window.api.listServices();
  workspaces = await window.api.listWorkspaces();
  dlList = await window.api.listDownloads();
  try { currentWs = localStorage.getItem('mm-ws') || 'all'; } catch (e) {}
  if (currentWs !== 'all' && !workspaces.some(w => w.id === currentWs)) currentWs = 'all';
  updateDlBadge();
  renderList(); // nothing is selected at start
  // "Always on" services load quietly in the background so messages and notifications arrive;
  // "Sleep" services stay unloaded until you click them.
  for (const s of services) {
    if (modeOf(s) !== 'always') continue;
    ensureView(s);
    renderList();
    await new Promise(r => setTimeout(r, 400)); // stagger so many services do not start at once
  }
})();
