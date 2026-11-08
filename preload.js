const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  listServices: () => ipcRenderer.invoke('services:list'),
  saveService: svc => ipcRenderer.invoke('services:save', svc),
  deleteService: id => ipcRenderer.invoke('services:delete', id),
  testService: id => ipcRenderer.invoke('services:test', id),
  clearCache: id => ipcRenderer.invoke('services:clearCache', id),
  openLoginWindow: (id, url) => ipcRenderer.invoke('services:loginWindow', id, url),
  onLoginClosed: cb => ipcRenderer.on('login:closed', (_e, id) => cb(id)),
  clearData: id => ipcRenderer.invoke('services:clearData', id),
  resetAll: () => ipcRenderer.invoke('services:reset'),
  fetchFavicon: (id, url) => ipcRenderer.invoke('services:favicon', id, url),

  getInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setActive: id => ipcRenderer.send('view:active', id),
  openTaskbarSettings: () => ipcRenderer.invoke('app:taskbarSettings'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  notify: payload => ipcRenderer.invoke('app:notify', payload),
  setUnread: (total, overlayDataUrl) => ipcRenderer.invoke('app:unread', total, overlayDataUrl),
  onNotificationClick: cb => ipcRenderer.on('notification:click', (_e, d) => cb(d)),

  patchServices: updates => ipcRenderer.invoke('services:patch', updates),
  onZoomKey: cb => ipcRenderer.on('zoom:key', (_e, dir) => cb(dir)),
  onReloadKey: cb => ipcRenderer.on('reload:key', (_e, hard) => cb(hard)),

  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  saveWorkspace: ws => ipcRenderer.invoke('workspaces:save', ws),
  deleteWorkspace: id => ipcRenderer.invoke('workspaces:delete', id),

  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  downloadAction: (id, action) => ipcRenderer.invoke('downloads:action', id, action),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  downloadDir: () => ipcRenderer.invoke('downloads:dir'),
  chooseDownloadDir: () => ipcRenderer.invoke('downloads:chooseDir'),
  openDownloadDir: () => ipcRenderer.invoke('downloads:openDir'),
  onDownloadUpdate: cb => ipcRenderer.on('downloads:update', (_e, rec) => cb(rec)),
  onDownloadsOpen: cb => ipcRenderer.on('downloads:open', () => cb()),

  toolsStatus: () => ipcRenderer.invoke('tools:status'),
  installTool: (kind, svcId) => ipcRenderer.invoke('tools:install', kind, svcId),
  locateTool: kind => ipcRenderer.invoke('tools:locate', kind),
  onToolProgress: cb => ipcRenderer.on('tools:progress', (_e, p) => cb(p)),
  videoInfo: (svcId, url) => ipcRenderer.invoke('video:info', svcId, url),
  videoStart: (svcId, url, job) => ipcRenderer.invoke('video:start', svcId, url, job),
  openVideoLog: () => ipcRenderer.invoke('video:openLog'),
  onVideoStatus: cb => ipcRenderer.on('video:status', (_e, d) => cb(d)),
  onVideoRequest: cb => ipcRenderer.on('video:request', (_e, d) => cb(d))
});
