const {
  app, BrowserWindow, ipcMain, session, shell, safeStorage,
  Tray, Menu, Notification, nativeImage, dialog, clipboard
} = require('electron');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { startRelay, stopRelay } = require('./relay');
const catalog = require('./catalog.json');

// Google refuses to sign in inside anything that looks like an embedded Chromium app. Its sign-in pages are
// therefore opened with a Firefox identity (the same trick other multi-service messengers use); every other site
// keeps the normal Chrome identity.
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';
const isGoogleAuth = u => { try { const h = new URL(u).hostname; return h === 'accounts.google.com' || h.endsWith('.accounts.google.com'); } catch { return false; } };
// Per-service browser identity: '' (Chrome, default), 'firefox' or 'edge'. Some sites treat identities differently.
const UA_BY_SESSION = new WeakMap();
const identityUA = id => id === 'firefox' ? FIREFOX_UA
  : id === 'edge' ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36 Edg/${process.versions.chrome}`
  : CHROME_UA;
const CHROME_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${process.versions.chrome} Safari/537.36`;

const ICON_PNG = path.join(__dirname, 'assets', 'icon.png');
const ICON_WIN = path.join(__dirname, 'assets', 'icon.ico');
const TRAY_PNG = path.join(__dirname, 'assets', 'tray.png');
const TRAY_PNG2 = path.join(__dirname, 'assets', 'tray@2x.png');
const WINDOW_ICON = process.platform === 'win32' ? ICON_WIN : ICON_PNG;

// Needed on Windows so toast notifications and the taskbar group use this app's identity.
app.setAppUserModelId(app.isPackaged ? 'local.multimessenger' : process.execPath);

let win = null;
let tray = null;
let quitting = false;
const launchedHidden = process.argv.includes('--hidden');

const storeFile = () => path.join(app.getPath('userData'), 'services.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const partitionOf = id => `persist:svc-${id}`;

// ---------- app settings ----------
const DEFAULT_SETTINGS = {
  closeToTray: true,     // X button hides to tray instead of quitting
  autoStart: false,      // start with Windows
  startHidden: true,     // when started by Windows, start minimized to tray
  notifications: true,   // show desktop notifications
  flash: true,           // flash taskbar button on new message
  pinTray: true,         // keep the tray icon visible instead of in Windows' hidden "^" area
  downloadDir: '',       // empty = <Downloads>/MultiMessenger
  askDownload: false,    // ask where to save every file
  spellcheck: false,     // spell checking inside services (off = smoother typing)
  ytdlpPath: '',         // optional: your own yt-dlp / ffmpeg
  ffmpegPath: '',
  hwAccel: true,         // GPU acceleration (needs a restart to change)
  lite: false            // no scripts inside service pages (troubleshooting typing speed; needs a restart)
};
let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch { settings = { ...DEFAULT_SETTINGS }; }
}
function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}
function applyLoginItem() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const args = [];
  if (!app.isPackaged) args.push(app.getAppPath()); // dev run: electron.exe <project folder>
  if (settings.startHidden) args.push('--hidden');
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.autoStart, path: process.execPath, args });
  } catch (e) { console.error('login item failed', e); }
}

// ---------- performance switches (must be set before the app is ready) ----------
// Windows can wrongly decide that a partly covered window is hidden and throttle it, which makes typing stutter.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
loadSettings();
if (settings.hwAccel === false) app.disableHardwareAcceleration();

// ---------- keep the service you are typing in fast ----------
// Services in the background keep running (so messages still arrive) but with lower CPU priority,
// so the open service always gets the processor first.
let activeSvc = null;
function applyPriorities() {
  try {
    const ses = activeSvc ? session.fromPartition(partitionOf(activeSvc)) : null;
    const focused = !!(win && win.isVisible() && !win.isMinimized());
    for (const wc of require('electron').webContents.getAllWebContents()) {
      if (wc.getType() !== 'webview' || wc.isDestroyed()) continue;
      const pid = wc.getOSProcessId();
      if (!pid) continue;
      const isActive = focused && ses && wc.session === ses;
      try { os.setPriority(pid, isActive ? os.constants.priority.PRIORITY_ABOVE_NORMAL : os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {}
    }
  } catch (e) {}
}
ipcMain.on('view:active', (_e, id) => { activeSvc = id || null; applyPriorities(); setTimeout(applyPriorities, 1500); });
setInterval(applyPriorities, 6000).unref();

// Shortcuts as menu accelerators: handled by the app, so ordinary typing never passes through any extra code.
function buildAppMenu() {
  const send = (ch, a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, a); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: () => send('zoom:key', 'in') },
      { label: 'Zoom in (alt)', accelerator: 'CmdOrCtrl+=', visible: false, click: () => send('zoom:key', 'in') },
      { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => send('zoom:key', 'out') },
      { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => send('zoom:key', 'reset') },
      { type: 'separator' },
      { label: 'Reload', accelerator: 'F5', click: () => send('reload:key', false) },
      { label: 'Reload (Ctrl+R)', accelerator: 'CmdOrCtrl+R', visible: false, click: () => send('reload:key', false) },
      { label: 'Hard reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => send('reload:key', true) }
    ] }
  ]));
}

// ---------- storage (proxy passwords encrypted when the OS allows it) ----------
function enc(plain) {
  if (!plain) return '';
  if (safeStorage.isEncryptionAvailable()) return 'e:' + safeStorage.encryptString(plain).toString('base64');
  return 'p:' + Buffer.from(plain, 'utf8').toString('base64');
}
function dec(s) {
  if (!s) return '';
  try {
    const b = Buffer.from(s.slice(2), 'base64');
    return s.startsWith('e:') ? safeStorage.decryptString(b) : b.toString('utf8');
  } catch { return ''; }
}
function loadServices() {
  try {
    const known = new Set(catalog.map(c => c.type));
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8')).map(s => ({
      ...s,
      type: known.has(s.type) ? s.type : 'custom', // e.g. the removed Web.bale entry becomes a custom web app
      proxy: { ...s.proxy, password: dec(s.proxy && s.proxy.passwordEnc) }
    }));
  } catch { return []; }
}
function saveServices(list) {
  const out = list.map(s => {
    const { password, ...p } = s.proxy || {};
    return { ...s, proxy: { ...p, passwordEnc: enc(password) } };
  });
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(out, null, 2));
}

// ---------- proxy ----------
const proxyCreds = new WeakMap(); // session -> {username,password} for HTTP(S) proxy auth

app.on('login', (event, wc, details, authInfo, callback) => {
  if (!authInfo.isProxy) return;
  const c = proxyCreds.get(wc.session);
  if (c) {
    event.preventDefault();
    callback(c.username, c.password);
  }
});

const ALLOWED_PERMS = ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write',
  'fullscreen', 'display-capture', 'mediaKeySystem'];

async function applyProxy(svc) {
  const ses = session.fromPartition(partitionOf(svc.id));
  hookDownloads(ses, svc.id);
  const myUA = identityUA(svc.ua);
  ses.setUserAgent(myUA);
  UA_BY_SESSION.set(ses, { ua: myUA, ff: svc.ua === 'firefox' });
  try { ses.setPreloads([path.join(__dirname, 'stealth.js')]); } catch (e) {}   // look like normal Chrome to Google's sign-in
  // The Sec-CH-UA headers must say "Google Chrome" too, like the User-Agent does
  const major = String(process.versions.chrome).split('.')[0];
  const CH = `"Not_A Brand";v="24", "Chromium";v="${major}", "Google Chrome";v="${major}"`;
  const CHFULL = `"Not_A Brand";v="24.0.0.0", "Chromium";v="${process.versions.chrome}", "Google Chrome";v="${process.versions.chrome}"`;
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    if (isGoogleAuth(details.url)) {                       // Firefox sends no client hints and no "Chrome" text
      for (const k of Object.keys(h)) {
        const l = k.toLowerCase();
        if (l === 'user-agent') h[k] = FIREFOX_UA;
        else if (l.startsWith('sec-ch-ua')) delete h[k];
      }
      return cb({ requestHeaders: h });
    }
    const google = /(^|\.)(google\.com|youtube\.com|gstatic\.com)$/i;
    let host = ''; try { host = new URL(details.url).hostname; } catch {}
    const idn = UA_BY_SESSION.get(ses) || { ua: CHROME_UA, ff: false };
    if (idn.ff) {                                           // Firefox identity: no client hints at all
      for (const k of Object.keys(h)) {
        const l = k.toLowerCase();
        if (l === 'user-agent') h[k] = idn.ua; else if (l.startsWith('sec-ch-ua')) delete h[k];
      }
      return cb({ requestHeaders: h });
    }
    for (const k of Object.keys(h)) {
      const l = k.toLowerCase();
      if (l === 'user-agent') h[k] = idn.ua;
      else if (l === 'sec-ch-ua' && google.test(host)) h[k] = CH;          // only Google's sites get the "Google Chrome" brand
      else if (l === 'sec-ch-ua-full-version-list' && google.test(host)) h[k] = CHFULL;
    }
    cb({ requestHeaders: h });
  });
  try { ses.setSpellCheckerEnabled(!!settings.spellcheck); } catch (e) {}
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOWED_PERMS.includes(perm)));
  ses.setPermissionCheckHandler((wc, perm) => ALLOWED_PERMS.includes(perm));

  stopRelay(svc.id);
  proxyCreds.delete(ses);

  const p = svc.proxy;
  if (!p || !p.enabled || !p.host || !p.port) {
    await ses.setProxy({ mode: 'direct' });
  } else if ((p.type === 'socks4' || p.type === 'socks5') && p.username) {
    // SOCKS with login -> bridge through local relay
    const port = await startRelay(svc.id, p);
    await ses.setProxy({ proxyRules: `http://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
  } else {
    const scheme = { http: 'http', https: 'https', socks4: 'socks4', socks5: 'socks5' }[p.type] || 'http';
    await ses.setProxy({ proxyRules: `${scheme}://${p.host}:${p.port}`, proxyBypassRules: '<local>' });
    if (p.username && (p.type === 'http' || p.type === 'https')) {
      proxyCreds.set(ses, { username: p.username, password: p.password || '' });
    }
  }
  await ses.closeAllConnections();
}

// A normal top-level window (not an embedded page) for signing in, sharing the service's session. When it is closed
// the service reloads and picks up the new login.
ipcMain.handle('services:loginWindow', (_e, id, url) => {
  const ses = session.fromPartition(partitionOf(id));
  const lw = new BrowserWindow({
    width: 560, height: 800, parent: win && !win.isDestroyed() ? win : undefined, autoHideMenuBar: true,
    title: 'Sign in', icon: WINDOW_ICON, backgroundColor: '#ffffff',
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: false, spellcheck: false }
  });
  const idn = UA_BY_SESSION.get(ses);
  if (idn) lw.webContents.setUserAgent(idn.ua);
  lw.webContents.setWindowOpenHandler(() => ({ action: 'allow' }));   // Google / Apple sign-in popups
  lw.on('closed', () => { if (win && !win.isDestroyed()) win.webContents.send('login:closed', id); });
  lw.loadURL(/^https?:/i.test(url || '') ? url : 'about:blank').catch(() => {});
  return true;
});

// ---------- IPC: services ----------
ipcMain.handle('catalog:get', () => catalog);
ipcMain.handle('services:list', () => loadServices());

ipcMain.handle('services:save', async (_e, svc) => {
  const list = loadServices();
  const i = list.findIndex(s => s.id === svc.id);
  if (i >= 0) list[i] = svc; else list.push(svc);
  saveServices(list);
  await applyProxy(svc);
  return list;
});

ipcMain.handle('services:delete', async (_e, id) => {
  const list = loadServices().filter(s => s.id !== id);
  saveServices(list);
  stopRelay(id);
  try { await session.fromPartition(partitionOf(id)).clearStorageData(); } catch {}
  return list;
});

// Fetch a site's favicon through the service's own session (so it uses that service's proxy)
// and remember it as the sidebar icon.
ipcMain.handle('services:favicon', async (_e, id, url) => {
  try {
    if (!/^https?:/.test(url)) return null;
    const ses = session.fromPartition(partitionOf(id));
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await ses.fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 300 * 1024) return null;
    const type = (r.headers.get('content-type') || 'image/png').split(';')[0];
    if (!type.startsWith('image/')) return null;
    const dataUrl = `data:${type};base64,${buf.toString('base64')}`;
    const list = loadServices();
    const s = list.find(x => x.id === id);
    if (s) { s.icon = dataUrl; saveServices(list); }
    return dataUrl;
  } catch { return null; }
});

ipcMain.handle('services:clearCache', async (_e, id) => {
  const ses = session.fromPartition(partitionOf(id));
  await ses.clearCache();
  await ses.clearCodeCaches({});
  return true;
});

// Wipes cookies, local storage, IndexedDB, service workers and cache for this service only,
// so a different account can be signed in. Proxy settings are kept.
ipcMain.handle('services:clearData', async (_e, id) => {
  const ses = session.fromPartition(partitionOf(id));
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  return true;
});

ipcMain.handle('services:reset', async () => {
  for (const s of loadServices()) {
    stopRelay(s.id);
    try { await session.fromPartition(partitionOf(s.id)).clearStorageData(); } catch {}
  }
  saveServices([]);
  return [];
});

// Connection test: exit IP plus how long the first request (new connection) and a repeat request take,
// so a slow proxy can be told apart from a slow app.
ipcMain.handle('services:test', async (_e, id) => {
  const ses = session.fromPartition(partitionOf(id));
  const url = process.env.MM_TEST_URL || 'https://api.ipify.org?format=json';
  const once = async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const t0 = Date.now();
    try {
      const r = await ses.fetch(url, { signal: ctl.signal });
      const j = await r.json();
      return { ip: j.ip, ms: Date.now() - t0 };
    } finally { clearTimeout(t); }
  };
  try {
    const a = await once();
    let b = null;
    try { b = await once(); } catch {}
    return { ok: true, ip: a.ip, firstMs: a.ms, repeatMs: b ? b.ms : null };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// patch stored fields of services (zoom, workspace...) without touching proxies or reloading anything
ipcMain.handle('services:patch', (_e, updates) => {
  const list = loadServices();
  for (const u of updates || []) {
    const s = list.find(x => x.id === u.id);
    if (!s) continue;
    for (const [k, v] of Object.entries(u)) { if (k !== 'id' && k !== 'proxy') s[k] = v; }
  }
  saveServices(list);
  return list;
});

// ---------- workspaces ----------
const wsFile = () => path.join(app.getPath('userData'), 'workspaces.json');
function loadWs() { try { return JSON.parse(fs.readFileSync(wsFile(), 'utf8')); } catch { return []; } }
function saveWs(list) {
  fs.mkdirSync(path.dirname(wsFile()), { recursive: true });
  fs.writeFileSync(wsFile(), JSON.stringify(list, null, 2));
}
ipcMain.handle('workspaces:list', () => loadWs());
ipcMain.handle('workspaces:save', (_e, ws) => {
  const list = loadWs();
  const i = list.findIndex(w => w.id === ws.id);
  const clean = { id: ws.id, name: String(ws.name || 'Workspace').slice(0, 40), emoji: String(ws.emoji || '').slice(0, 8), color: ws.color || '#7c3aed' };
  if (i >= 0) list[i] = clean; else list.push(clean);
  saveWs(list);
  return list;
});
// deleting a workspace never deletes its services: they just become "ungrouped"
ipcMain.handle('workspaces:delete', (_e, id) => {
  const list = loadWs().filter(w => w.id !== id);
  saveWs(list);
  const svcs = loadServices();
  for (const s of svcs) if (s.workspace === id) s.workspace = '';
  saveServices(svcs);
  return { workspaces: list, services: svcs };
});

// ---------- downloads ----------
const dlFile = () => path.join(app.getPath('userData'), 'downloads.json');
let downloads = [];               // newest first
const dlItems = new Map();        // id -> active DownloadItem
const reservedPaths = new Set();  // paths promised to running downloads
const lastPush = new Map();
const hookedSessions = new WeakSet();

const defaultDownloadDir = () => settings.downloadDir || path.join(app.getPath('downloads'), 'MultiMessenger');
function loadDownloads() {
  try { downloads = JSON.parse(fs.readFileSync(dlFile(), 'utf8')).filter(d => !['progressing', 'paused'].includes(d.state)); }
  catch { downloads = []; }
}
function saveDownloads() {
  try {
    fs.mkdirSync(path.dirname(dlFile()), { recursive: true });
    const keep = downloads.filter(d => !dlItems.has(d.id)).slice(0, 300);
    fs.writeFileSync(dlFile(), JSON.stringify(keep, null, 2));
  } catch {}
}
function sendToWin(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function pushDl(rec, force) {
  const now = Date.now();
  if (!force && now - (lastPush.get(rec.id) || 0) < 250) return; // throttle progress updates
  lastPush.set(rec.id, now);
  sendToWin('downloads:update', rec);
}
function safeName(n) {
  return (String(n || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 180)) || 'download';
}
function uniquePath(dir, name) {
  name = safeName(name);
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), i = 1;
  while (fs.existsSync(p) || reservedPaths.has(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

function hookDownloads(ses, svcId) {
  if (hookedSessions.has(ses)) return;
  hookedSessions.add(ses);
  ses.on('will-download', (_e, item) => trackDownload(svcId, item));
}

function trackDownload(svcId, item) {
  const id = crypto.randomUUID();
  const filename = item.getFilename() || 'download';
  if (!settings.askDownload) {
    const dir = defaultDownloadDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const p = uniquePath(dir, filename);
    reservedPaths.add(p);
    item.setSavePath(p);
  }
  const svc = loadServices().find(s => s.id === svcId);
  const rec = {
    id, serviceId: svcId, service: svc ? svc.name : '', name: filename,
    url: String(item.getURL() || '').slice(0, 600), path: item.getSavePath() || '',
    total: item.getTotalBytes(), received: 0, state: 'progressing',
    startedAt: Date.now(), mime: item.getMimeType() || ''
  };
  downloads.unshift(rec);
  dlItems.set(id, item);
  pushDl(rec, true);

  item.on('updated', (_e, state) => {
    rec.received = item.getReceivedBytes();
    rec.total = item.getTotalBytes();
    const sp = item.getSavePath();
    if (sp) { rec.path = sp; rec.name = path.basename(sp); }
    rec.state = state === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing');
    pushDl(rec);
  });
  item.once('done', (_e, state) => {
    const sp = item.getSavePath();
    if (sp) { rec.path = sp; rec.name = path.basename(sp); }
    reservedPaths.delete(rec.path);
    rec.received = item.getReceivedBytes();
    rec.total = item.getTotalBytes() || rec.received;
    rec.state = state; // completed | cancelled | interrupted
    rec.finishedAt = Date.now();
    dlItems.delete(id);
    lastPush.delete(id);
    if (!downloads.includes(rec)) return; // removed from the list while running
    saveDownloads();
    pushDl(rec, true);
    if (state === 'completed') notifyDownloadDone(rec);
  });
}

function notifyDownloadDone(rec) {
  if (!settings.notifications || !Notification.isSupported()) return;
  const n = new Notification({ title: 'Download complete', body: rec.name, icon: nativeImage.createFromPath(ICON_PNG) });
  liveNotes.add(n);
  n.on('click', () => { liveNotes.delete(n); showWindow(); sendToWin('downloads:open'); });
  n.on('close', () => liveNotes.delete(n));
  n.show();
}

// ---------- video downloader (yt-dlp) ----------
const videoDl = require('./videodl')({
  app, ipcMain, session, dialog, shell, partitionOf, loadServices,
  getWin: () => win, send: sendToWin,
  getSettings: () => settings,
  saveSettings: patch => { settings = { ...settings, ...patch }; saveSettings(); },
  defaultDownloadDir,
  addDl: rec => { downloads.unshift(rec); pushDl(rec, true); },
  hasDl: rec => downloads.includes(rec),
  findDl: id => downloads.find(d => d.id === id),
  pushDl, saveDownloads,
  notifyDone: rec => notifyDownloadDone(rec)
});
app.on('before-quit', () => videoDl.killAll());

ipcMain.handle('downloads:list', () => downloads);
ipcMain.handle('downloads:dir', () => defaultDownloadDir());
ipcMain.handle('downloads:openDir', () => {
  const d = defaultDownloadDir();
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return shell.openPath(d);
});
ipcMain.handle('downloads:chooseDir', async () => {
  const r = await dialog.showOpenDialog(win, { defaultPath: defaultDownloadDir(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  settings.downloadDir = r.filePaths[0];
  saveSettings();
  return settings.downloadDir;
});
ipcMain.handle('downloads:clear', () => {
  downloads = downloads.filter(d => dlItems.has(d.id)); // keep only running ones
  saveDownloads();
  return downloads;
});
ipcMain.handle('downloads:action', async (_e, id, action) => {
  const rec = downloads.find(d => d.id === id);
  if (!rec) return false;
  const item = dlItems.get(id);
  if (videoDl.isTool(rec)) {            // downloads made by the video downloader
    if (action === 'cancel') { videoDl.cancel(id); return true; }
    if (action === 'retry') { downloads = downloads.filter(d => d.id !== id); saveDownloads(); await videoDl.retry(rec); return true; }
    if (action === 'remove') { videoDl.cancel(id); downloads = downloads.filter(d => d.id !== id); saveDownloads(); return true; }
  }
  switch (action) {
    case 'open': return rec.path ? (await shell.openPath(rec.path)) === '' : false;
    case 'show': if (rec.path) shell.showItemInFolder(rec.path); return true;
    case 'pause':
      if (item) { item.pause(); rec.state = 'paused'; pushDl(rec, true); } // no 'updated' event arrives while paused
      return true;
    case 'resume':
      if (item && item.canResume()) { item.resume(); rec.state = 'progressing'; pushDl(rec, true); }
      return true;
    case 'cancel': if (item) item.cancel(); return true;
    case 'retry':
      if (/^https?:/i.test(rec.url)) {
        downloads = downloads.filter(d => d.id !== id);
        saveDownloads();
        session.fromPartition(partitionOf(rec.serviceId)).downloadURL(rec.url);
      }
      return true;
    case 'remove':
      downloads = downloads.filter(d => d.id !== id);
      if (item) item.cancel();
      saveDownloads();
      return true;
  }
  return false;
});

// ---------- IPC: app info, settings, notifications, unread ----------
ipcMain.handle('app:info', () => ({
  preloadUrl: pathToFileURL(path.join(__dirname, 'webview-preload.js')).href,
  platform: process.platform,
  packaged: app.isPackaged,
  version: app.getVersion()
}));

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('app:taskbarSettings', () => shell.openExternal('ms-settings:taskbar'));
ipcMain.handle('app:relaunch', () => { quitting = true; app.relaunch(); app.exit(0); });
ipcMain.handle('settings:set', (_e, patch) => {
  const pinChanged = 'pinTray' in patch && !!patch.pinTray !== (settings.pinTray !== false);
  settings = { ...settings, ...patch };
  saveSettings();
  applyLoginItem();
  if (pinChanged) pinTrayIcon(0, settings.pinTray !== false);
  for (const s of loadServices()) {
    try { session.fromPartition(partitionOf(s.id)).setSpellCheckerEnabled(!!settings.spellcheck); } catch (e) {}
  }
  return settings;
});

const liveNotes = new Set(); // keep references so toasts are not garbage-collected before the click
ipcMain.handle('app:notify', (_e, p) => {
  if (!settings.notifications || !Notification.isSupported()) return false;
  const n = new Notification({
    title: String(p.title || 'MultiMessenger').slice(0, 120),
    body: String(p.body || '').slice(0, 300),
    silent: !!p.silent,
    icon: nativeImage.createFromPath(ICON_PNG)
  });
  liveNotes.add(n);
  if (liveNotes.size > 60) liveNotes.delete(liveNotes.values().next().value);
  const drop = () => liveNotes.delete(n);
  n.on('click', () => {
    drop();
    showWindow();
    if (win && !win.isDestroyed()) win.webContents.send('notification:click', { serviceId: p.serviceId, nid: p.nid });
  });
  n.on('close', drop);
  n.show();
  if (settings.flash && win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
  return true;
});

ipcMain.handle('app:unread', (_e, total, overlayDataUrl) => {
  const n = Number(total) || 0;
  if (tray) tray.setToolTip(n ? `MultiMessenger — ${n} unread` : 'MultiMessenger');
  try { app.setBadgeCount(n); } catch {}
  if (win && !win.isDestroyed() && process.platform === 'win32') {
    if (n && overlayDataUrl) win.setOverlayIcon(nativeImage.createFromDataURL(overlayDataUrl), `${n} unread`);
    else win.setOverlayIcon(null, '');
  }
  return true;
});

// ---------- window + tray ----------
function showWindow() {
  if (!win || win.isDestroyed()) createWindow(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  try { win.webContents.focus(); } catch {}   // keyboard focus back into the page after hiding to the tray
}

// ---------- keep the tray icon out of Windows' hidden "^" area ----------
// Windows 11 keeps one entry per tray icon in HKCU\Control Panel\NotifyIconSettings; IsPromoted=1 means
// "show in the taskbar". Only this app's own entry (matched by its program path) is changed, and only for the
// current user. Windows decides where new icons go and gives apps no official way to ask, so this is a best effort.
const NOTIFY_KEY = 'HKCU\\Control Panel\\NotifyIconSettings';
function findNotifyKeys(regOutput, exePath) {
  const norm = p => String(p).replace(/\//g, '\\').toLowerCase();
  const want = norm(exePath);
  const keys = [];
  let cur = '';
  for (const line of String(regOutput).split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) { cur = line.trim(); continue; }
    const m = line.match(/^\s+ExecutablePath\s+REG_\w+\s+(.+?)\s*$/i);
    if (!m || !cur) continue;
    const val = norm(m[1]);
    const tail = val.replace(/^\{[0-9a-f-]+\}\\/, '');         // some entries start with a known-folder id
    if (val === want || (tail !== val && want.endsWith('\\' + tail))) keys.push(cur);
  }
  return keys;
}
// The entry appears a moment after the icon is created, so look again a few times.
function pinTrayIcon(attempt = 0, on = true) {
  if (process.platform !== 'win32' || (on && settings.pinTray === false)) return;
  execFile('reg', ['query', NOTIFY_KEY, '/s', '/v', 'ExecutablePath'], { windowsHide: true, timeout: 10000 }, (err, out) => {
    const keys = err ? [] : findNotifyKeys(out, process.execPath);
    if (!keys.length) {
      if (attempt < 3) setTimeout(() => pinTrayIcon(attempt + 1, on), [2000, 6000, 20000][attempt]);
      return;
    }
    for (const k of keys) {
      execFile('reg', ['add', k, '/v', 'IsPromoted', '/t', 'REG_DWORD', '/d', on ? '1' : '0', '/f'], { windowsHide: true }, () => {});
    }
  });
}

function createTray() {
  let img = nativeImage.createFromPath(TRAY_PNG);
  if (img.isEmpty()) img = nativeImage.createFromPath(ICON_PNG).resize({ width: 32, height: 32 }); // never create a blank tray icon
  if (img.isEmpty()) img = nativeImage.createFromPath(ICON_WIN);
  const hi = nativeImage.createFromPath(TRAY_PNG2);
  if (!hi.isEmpty()) img.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() });
  tray = new Tray(img);
  tray.setToolTip('MultiMessenger');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show MultiMessenger', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    backgroundColor: '#0d0d0d',
    title: 'MultiMessenger',
    icon: WINDOW_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false // keep services alive while minimized / in the tray
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!hidden) win.show(); });

  // minimize -> normal taskbar minimize (default). Close (X) -> hide to tray.
  win.on('close', e => {
    if (!quitting && settings.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('focus', () => win.flashFrame(false));
  win.on('closed', () => { win = null; });
}

const VIDEO_HOST = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)$/i;
const videoHost = u => { try { return VIDEO_HOST.test(new URL(u).hostname); } catch { return false; } };
function guestContextMenu(wc, params) {
  const t = [];
  const http = u => /^https?:/i.test(u || '');
  const askVideo = u => { const h = wc.hostWebContents; if (h && !h.isDestroyed()) h.send('video:request', { url: u }); };
  if (params.linkURL && http(params.linkURL) && videoHost(params.linkURL)) {
    t.push({ label: 'Download video from this link…', click: () => askVideo(params.linkURL) });
    t.push({ type: 'separator' });
  } else if (!params.linkURL && videoHost(wc.getURL())) {
    t.push({ label: 'Download this video…', click: () => askVideo(wc.getURL()) });
    t.push({ type: 'separator' });
  }
  if (params.linkURL) {
    if (http(params.linkURL)) t.push({ label: 'Open link in browser', click: () => shell.openExternal(params.linkURL) });
    t.push({ label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) });
    if (http(params.linkURL)) t.push({ label: 'Download link', click: () => wc.downloadURL(params.linkURL) });
    t.push({ type: 'separator' });
  }
  if (params.mediaType === 'image' && params.srcURL) {
    t.push({ label: 'Download image', click: () => wc.downloadURL(params.srcURL) });
    t.push({ label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) });
    if (http(params.srcURL)) t.push({ label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) });
    t.push({ type: 'separator' });
  }
  if ((params.mediaType === 'video' || params.mediaType === 'audio') && params.srcURL) {
    const kind = params.mediaType === 'video' ? 'video' : 'audio';
    if (/^blob:/i.test(params.srcURL)) {
      t.push({ label: `This ${kind} is streamed and cannot be downloaded directly`, enabled: false });
    } else {
      t.push({ label: `Download ${kind}`, click: () => wc.downloadURL(params.srcURL) });
    }
    t.push({ type: 'separator' });
  }
  if (params.isEditable) {
    t.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
  } else if (params.selectionText) {
    t.push({ role: 'copy' });
  }
  if (t.length && t[t.length - 1].type !== 'separator') t.push({ type: 'separator' });
  const nh = wc.navigationHistory;
  t.push(
    { label: 'Back', enabled: nh ? nh.canGoBack() : wc.canGoBack(), click: () => (nh ? nh.goBack() : wc.goBack()) },
    { label: 'Forward', enabled: nh ? nh.canGoForward() : wc.canGoForward(), click: () => (nh ? nh.goForward() : wc.goForward()) },
    { label: 'Reload', click: () => wc.reload() }
  );
  const host = wc.hostWebContents;
  Menu.buildFromTemplate(t).popup({ window: host ? BrowserWindow.fromWebContents(host) : win });
}

// Google sign-in runs in its own small window (a normal top-level window, not a <webview>) that shares the
// service's session. When it lands back on the service, the window closes and the service continues signed in.
const googleLogins = new Map(); // service webContents id -> login window
function openGoogleLogin(wc, url) {
  const old = googleLogins.get(wc.id);
  if (old && !old.isDestroyed()) { old.focus(); return; }
  const parent = win && !win.isDestroyed() ? win : undefined;
  const lw = new BrowserWindow({
    width: 520, height: 760, parent, modal: false, autoHideMenuBar: true, title: 'Sign in with Google',
    icon: WINDOW_ICON, backgroundColor: '#ffffff',
    webPreferences: { session: wc.session, nodeIntegration: false, contextIsolation: true, sandbox: false, spellcheck: false }
  });
  googleLogins.set(wc.id, lw);
  lw.webContents.setUserAgent(FIREFOX_UA);
  const done = next => {
    if (lw.isDestroyed()) return;
    lw.destroy();
    if (!wc.isDestroyed()) { try { wc.loadURL(next); } catch {} }
  };
  const check = (_e, u, _ip, isMain) => {
    const nu = (_e && _e.url) || u;
    const main = _e && _e.isMainFrame !== undefined ? _e.isMainFrame : (typeof isMain === 'boolean' ? isMain : true);
    if (main && /^https?:/i.test(nu || '') && !isGoogleAuth(nu) && !/(^|\.)google\.com$/i.test(new URL(nu).hostname)) done(nu);
    else if (main && /^https?:\/\/(www\.)?google\.com\/?(\?|$)/i.test(nu || '')) done(nu);
  };
  lw.webContents.on('did-navigate', check);
  lw.webContents.on('did-redirect-navigation', check);
  lw.webContents.setWindowOpenHandler(({ url: u }) => { lw.webContents.loadURL(u); return { action: 'deny' }; });
  lw.on('closed', () => googleLogins.delete(wc.id));
  // the service page behind the window would only show Google's "not secure" message, so say what is happening instead
  wc.once('did-stop-loading', () => {
    if (wc.isDestroyed()) return;
    wc.executeJavaScript(`document.body.innerHTML='<div style="font:16px Segoe UI,sans-serif;padding:48px;text-align:center;color:#555">Sign in using the Google window. This page continues when you are done.<br><br>Closed it by mistake? Press the reload button.</div>'`).catch(() => {});
  });
  lw.loadURL(url).catch(e => console.error('google login load failed', e && e.message));
}

app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() === 'webview') {
    wc.on('did-start-navigation', (e, u, _inPlace, isMain) => {
      const url = (e && e.url) || u, main = e && e.isMainFrame !== undefined ? e.isMainFrame : isMain;
      if (main && /^https?:/i.test(url || '') && isGoogleAuth(url)) { setTimeout(() => { try { openGoogleLogin(wc, url); } catch (err) { console.error('google login failed', err); } }, 50); }
    });
  }
  // keep what the page itself can read (navigator.userAgent) in line with the headers above
  if (wc.getType() === 'webview' || wc.getType() === 'window') {
    wc.on('did-start-navigation', (e, u, _inPlace, isMain) => {
      const url = (e && e.url) || u, main = e && e.isMainFrame !== undefined ? e.isMainFrame : isMain;
      if (!main || !/^https?:/i.test(url || '')) return;
      const want = isGoogleAuth(url) ? FIREFOX_UA : ((UA_BY_SESSION.get(wc.session) || {}).ua || CHROME_UA);
      try { if (wc.getUserAgent() !== want) wc.setUserAgent(want); } catch {}
    });
  }
  if (wc.getType() !== 'webview') return;

  wc.on('context-menu', (_ev, params) => guestContextMenu(wc, params));

  // (Keyboard shortcuts are caught inside the page by webview-preload.js, so typing never waits for this process.)
  // Electron reports one Ctrl+wheel tick twice in a row, so ignore the immediate duplicate
  let lastZoomEvent = 0;
  wc.on('zoom-changed', (_ev, dir) => {
    const now = Date.now();
    if (now - lastZoomEvent < 80) return;
    lastZoomEvent = now;
    const host = wc.hostWebContents;
    if (host && !host.isDestroyed()) host.send('zoom:key', dir === 'in' ? 'in' : 'out');
  });

  wc.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    // allow login popups (OAuth etc.) inside the same session; send normal links to the system browser
    if (url === 'about:blank' || /(^|\.)accounts\.google\.com$|(^|\.)facebook\.com$|(^|\.)appleid\.apple\.com$/.test(host)) {
      return { action: 'allow' };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('before-quit', () => { quitting = true; });

// Only one copy at a time: starting it again just brings the running one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(async () => {
    try { app.setAccessibilitySupportEnabled(false); } catch (e) {} // keep Windows from switching on slow accessibility mode
    loadSettings();
    buildAppMenu();
    loadDownloads();
    // the app window itself only needs access to the installed-font list and the clipboard
    const hostPerms = ['local-fonts', 'clipboard-sanitized-write', 'clipboard-read'];
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(hostPerms.includes(perm)));
    session.defaultSession.setPermissionCheckHandler((wc, perm) => hostPerms.includes(perm));
    if (settings.autoStart) applyLoginItem(); // refresh path/args in case the app moved or was updated
    await Promise.all(loadServices().map(s => applyProxy(s).catch(() => {}))); // in parallel: the window opens sooner
    try { createTray(); pinTrayIcon(); } catch (e) { console.error('tray failed', e); } // never block the window if the tray is unavailable
    createWindow(launchedHidden && settings.autoStart);
  });
  // no 'window-all-closed' handler on purpose: default = quit when the (non-tray) window is really closed
}
