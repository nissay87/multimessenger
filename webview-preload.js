// Runs inside every service page (webview).
// Websites show notifications through the browser Notification API. We replace that API in the page
// with a version that reports each notification to the app, which then shows a real desktop
// notification and can jump back to the right service when it is clicked.
const { ipcRenderer, webFrame } = require('electron');

// Code that runs in the page's own JavaScript world (plain string, no backticks or dollar-braces inside).
const PATCH = `(() => {
  if (window.__mmPatched) return;
  window.__mmPatched = true;
  const live = new Map();
  let seq = 0;
  const post = (m) => window.postMessage(Object.assign({ __mm: 1 }, m), '*');

  class MMNotification extends EventTarget {
    constructor(title, opts) {
      super();
      opts = opts || {};
      this.title = String(title);
      this.body = opts.body ? String(opts.body) : '';
      this.icon = opts.icon || '';
      this.tag = opts.tag || '';
      this.data = opts.data;
      this.silent = !!opts.silent;
      this.onclick = null; this.onclose = null; this.onerror = null; this.onshow = null;
      this._id = ++seq;
      live.set(this._id, this);
      if (live.size > 100) live.delete(live.keys().next().value);
      post({ kind: 'notify', id: this._id, title: this.title, body: this.body, tag: this.tag, silent: this.silent });
      setTimeout(() => {
        const ev = new Event('show');
        this.dispatchEvent(ev);
        if (typeof this.onshow === 'function') this.onshow(ev);
      }, 0);
    }
    close() { live.delete(this._id); }
    static get permission() { return 'granted'; }
    static get maxActions() { return 0; }
    static requestPermission(cb) {
      if (typeof cb === 'function') cb('granted');
      return Promise.resolve('granted');
    }
  }
  try {
    Object.defineProperty(window, 'Notification', { value: MMNotification, configurable: true, writable: true });
  } catch (e) { window.Notification = MMNotification; }

  // Notifications created through a service worker (used by some web apps)
  if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype) {
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
      opts = opts || {};
      post({ kind: 'notify', id: ++seq, title: String(title), body: opts.body ? String(opts.body) : '', tag: opts.tag || '', silent: !!opts.silent });
      return Promise.resolve();
    };
  }

  // Pages that ask the Permissions API should also see "granted"
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const q = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (d) => (d && d.name === 'notifications')
        ? Promise.resolve({ state: 'granted', onchange: null, addEventListener() {}, removeEventListener() {} })
        : q(d);
    }
  } catch (e) {}

  // The app tells us a desktop notification was clicked -> fire the page's click handler
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__mm !== 1 || d.kind !== 'click') return;
    const n = live.get(d.id);
    if (!n) return;
    const ev = new Event('click');
    n.dispatchEvent(ev);
    if (typeof n.onclick === 'function') n.onclick(ev);
  });
})();`;

window.addEventListener('message', e => {
  const d = e.data;
  if (d && d.__mm === 1 && d.kind === 'notify') {
    ipcRenderer.sendToHost('mm-notify', { id: d.id, title: d.title, body: d.body, tag: d.tag, silent: d.silent });
  }
});

ipcRenderer.on('mm-click', (_e, id) => {
  window.postMessage({ __mm: 1, kind: 'click', id }, '*');
});

webFrame.executeJavaScript(PATCH).catch(() => {});

// (Zoom and reload shortcuts live in the app menu, so nothing runs inside the page while you type.)

// ---------- in-page download buttons (YouTube, Instagram) ----------
// Only runs on those two sites. Builds the elements with createElement (YouTube forbids innerHTML).
(() => {
  const host = location.hostname;
  const isYT = /(^|\.)youtube\.com$/.test(host), isIG = /(^|\.)instagram\.com$/.test(host);
  if (!isYT && !isIG) return;
  if (window.top !== window) return;

  const css = (el, o) => { Object.assign(el.style, o); return el; };
  const mk = (tag, o, text) => { const e = document.createElement(tag); if (o) css(e, o); if (text) e.textContent = text; return e; };
  const send = m => ipcRenderer.sendToHost('mm-video', m);
  const FONT = 'Roboto, Arial, sans-serif';

  // answer from the app: the list of qualities
  let onInfo = null;
  ipcRenderer.on('mm-video-info', (_e, d) => { if (onInfo) onInfo(d); });
  let onStatus = null;
  ipcRenderer.on('mm-video-status', (_e, d) => { if (onStatus) onStatus(d); });

  const dlIcon = (size, color) => {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', color); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', 'M12 3v12m0 0l-5-5m5 5l5-5M4 21h16');
    s.append(p); return s;
  };

  // ----- YouTube: green "DOWNLOAD AS" button with a quality list -----
  const ytUrl = () => { const id = new URLSearchParams(location.search).get('v'); return id ? 'https://www.youtube.com/watch?v=' + id : location.href; };
  const mb = n => (n > 0 ? ` (~${n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB'})` : '');

  function ytButton() {
    const wrap = mk('div', { position: 'relative', display: 'inline-block', marginLeft: '8px', flex: 'none', zIndex: 2000 });
    wrap.className = 'mm-ytdl';
    const btn = mk('button', { background: '#0a8a0a', color: '#fff', border: '0', borderRadius: '18px', height: '36px', padding: '0 16px', font: `500 13px ${FONT}`, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.02em' }, 'Download as: ▼');
    btn.type = 'button';
    const menu = mk('div', { position: 'absolute', top: '44px', left: '0', minWidth: '280px', maxHeight: '70vh', overflowY: 'auto', background: '#fff', color: '#0b57d0', borderRadius: '8px', boxShadow: '0 6px 24px rgba(0,0,0,.35)', display: 'none', padding: '6px 0', font: `500 15px ${FONT}`, textTransform: 'uppercase' });
    wrap.append(btn, menu);

    const item = (text, fn, muted) => {
      const d = mk('div', { padding: '11px 18px', cursor: muted ? 'default' : 'pointer', color: muted ? '#666' : '#0b57d0', whiteSpace: 'nowrap', fontSize: muted ? '12px' : '15px', textTransform: muted ? 'none' : 'uppercase' }, text);
      if (!muted) {
        d.onmouseenter = () => (d.style.background = '#eef3fd'); d.onmouseleave = () => (d.style.background = '');
        d.onclick = e => { e.stopPropagation(); fn(); };
      }
      menu.append(d); return d;
    };
    const say = t => { menu.textContent = ''; item(t, null, true); };
    const start = (job, title) => {
      menu.style.display = 'none';
      send({ act: 'start', url: ytUrl(), job: { ...job, title } });
      btn.textContent = 'Started ✓'; setTimeout(() => (btn.textContent = 'Download as: ▼'), 2500);
    };
    const show = d => {
      menu.textContent = '';
      if (!d.ok) {
        item(d.network ? 'Could not reach YouTube. Turn on a working proxy for this service.' : 'Could not read this video.', null, true);
        if (d.error && !d.network) item(String(d.error).slice(0, 140), null, true);
        item('Try again', () => open());
        return;
      }
      const i = d.info, t = i.title;
      [...i.videos].sort((a, b) => a.height - b.height).forEach(v =>
        item(`MP4 ${v.height}P${v.fps > 30 ? ' ' + Math.round(v.fps) + 'FPS' : ''}${mb(v.size)}`, () => start({ kind: 'video', height: v.height }, t)));
      if (i.hasFfmpeg) [128, 192, 256, 320].forEach(k =>
        item(`MP3 ${k}KBPS${i.duration ? mb(i.duration * k * 125) : ''}`, () => start({ kind: 'audio', mp3: k }, t)));
      i.audios.slice(0, 3).forEach(a =>
        item(`${String(a.ext).toUpperCase()} ${a.abr || ''}KBPS (original)${mb(a.size)}`, () => start({ kind: 'audio', formatId: a.id }, t)));
      if (!i.hasFfmpeg) item('Install ffmpeg for all video qualities and MP3', () => { menu.style.display = 'none'; send({ act: 'ffmpeg' }); }, false);
    };
    const open = () => {
      menu.style.display = 'block'; say('Loading qualities…');
      const url = ytUrl();
      onInfo = d => { onStatus = null; if (d.url === url) show(d); };
      onStatus = d => { if (d.url === url && menu.firstChild && menu.style.display === 'block') menu.firstChild.textContent = 'Loading qualities… ' + d.text; };
      send({ act: 'info', url });
    };
    btn.onclick = e => { e.stopPropagation(); if (menu.style.display === 'block') menu.style.display = 'none'; else open(); };
    document.addEventListener('click', () => (menu.style.display = 'none'));
    return wrap;
  }

  function ytTick() {
    const old = document.querySelector('.mm-ytdl');
    if (!/^\/watch/.test(location.pathname)) { if (old) old.remove(); return; }
    const owner = document.querySelector('ytd-watch-metadata #owner') || document.querySelector('#above-the-fold #top-row');
    if (!owner) return;
    if (owner.contains(old)) return;
    if (old) old.remove();
    owner.append(ytButton());
  }

  // ----- Instagram: download icon on posts and reels, "Download All" on profiles -----
  const igUrl = a => {
    const l = a && a.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
    return l ? l.href.split('?')[0] : (/\/(p|reel|reels|tv)\//.test(location.pathname) ? location.href.split('?')[0] : '');
  };
  function igIcon(getUrl, o) {
    const b = mk('button', { background: 'transparent', border: '0', cursor: 'pointer', padding: '8px', display: 'inline-flex', alignItems: 'center', color: '#f5f5f5', ...o });
    b.type = 'button'; b.className = 'mm-igdl'; b.title = 'Download video';
    b.append(dlIcon(24, 'currentColor'));
    b.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      const url = getUrl();
      if (!url) { send({ act: 'hint', text: 'Open the post or reel first, then press download.' }); return; }
      send({ act: 'start', url, job: { kind: 'auto' } });
      b.style.color = '#4ade80'; setTimeout(() => (b.style.color = '#f5f5f5'), 2000);
    };
    return b;
  }
  const SAVE = ['Save', 'Remove', 'ذخیره', 'حذف', 'Enregistrer', 'Guardar', 'Speichern'];
  function igPosts() {
    document.querySelectorAll('article').forEach(a => {
      if (a.querySelector('.mm-igdl')) return;
      const isPostPage = /^\/(p|reel|tv)\//.test(location.pathname);
      if (!a.querySelector('video') && !isPostPage) return;
      const svg = SAVE.map(l => a.querySelector(`svg[aria-label="${l}"]`)).find(Boolean);
      const getUrl = () => igUrl(a);
      const bar = svg && svg.closest('div[role="button"], button');
      if (bar && bar.parentElement) {
        bar.parentElement.insertBefore(igIcon(getUrl, { color: 'inherit' }), bar);
      } else {                                    // fallback: a round button over the media
        if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
        a.append(igIcon(getUrl, { position: 'absolute', top: '58px', right: '10px', zIndex: 5, background: 'rgba(0,0,0,.55)', borderRadius: '50%' }));
      }
    });
  }
  function igReels() {
    const old = document.querySelector('.mm-igfloat');
    if (!/^\/reels?\//.test(location.pathname)) { if (old) old.remove(); return; }
    if (old) return;
    const b = igIcon(() => location.href.split('?')[0], { position: 'fixed', right: '22px', bottom: '90px', zIndex: 2147483000, background: 'rgba(0,0,0,.65)', borderRadius: '50%', padding: '12px' });
    b.classList.add('mm-igfloat'); document.body.append(b);
  }
  const RESERVED = /^(explore|reels?|direct|accounts|stories|p|tv|about|legal|api|developer|challenge|web|emails)$/i;
  function igProfile() {
    const m = location.pathname.match(/^\/([A-Za-z0-9._]+)\/?(reels\/?)?$/);
    const old = document.querySelector('.mm-igall');
    if (!m || RESERVED.test(m[1])) { if (old) old.remove(); return; }
    const head = document.querySelector('header section');
    if (!head || (old && head.contains(old))) return;
    if (old) old.remove();
    const b = mk('button', { background: '#0095f6', color: '#fff', border: '0', borderRadius: '8px', padding: '7px 16px', margin: '8px 0 0 0', font: `600 14px ${FONT}`, cursor: 'pointer' }, 'Download All');
    b.type = 'button'; b.className = 'mm-igall';
    b.onclick = e => {
      e.preventDefault();
      const urls = [...new Set([...document.querySelectorAll('main a[href*="/p/"], main a[href*="/reel/"]')].map(a => a.href.split('?')[0]))];
      send({ act: 'batch', urls });
    };
    head.append(b);
  }

  const tick = () => { try { if (isYT) ytTick(); else { igPosts(); igReels(); igProfile(); } } catch (e) {} };
  const begin = () => setInterval(tick, 1500);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin();
})();
