// Video downloader: runs yt-dlp (and ffmpeg for merging / MP3) for Instagram, Facebook, YouTube and X.
// yt-dlp and ffmpeg are downloaded once into the app's data folder the first time they are needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');

const IS_WIN = process.platform === 'win32';
const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' +
  (IS_WIN ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux');
const DENO_ZIP_URL = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip';
const FFMPEG_ZIP_URL = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

module.exports = function init(ctx) {
  const { app, ipcMain, session, dialog, shell, getWin, send, partitionOf, loadServices, getSettings, saveSettings,
    defaultDownloadDir, addDl, hasDl, findDl, pushDl, saveDownloads, notifyDone } = ctx;

  // a small log so problems can be diagnosed (Settings -> Video downloader -> Open log)
  const logFile = () => path.join(app.getPath('userData'), 'video.log');
  const mask = t => String(t).replace(/(:\/\/)[^@\/\s]*@/g, '$1***@');
  function log(msg) {
    try {
      const f = logFile();
      try { if (fs.statSync(f).size > 400000) fs.writeFileSync(f, ''); } catch {}
      fs.appendFileSync(f, new Date().toISOString() + ' ' + mask(msg) + '\n');
    } catch {}
  }
  ipcMain.handle('video:openLog', () => { try { if (!fs.existsSync(logFile())) fs.writeFileSync(logFile(), 'No entries yet.\n'); } catch {} return shell.openPath(logFile()); });

  const toolsDir = () => path.join(app.getPath('userData'), 'tools');
  const ownYtdlp = () => path.join(toolsDir(), IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');
  const ownFfmpeg = () => path.join(toolsDir(), IS_WIN ? 'ffmpeg.exe' : 'ffmpeg');
  const exists = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
  const onPath = name => {
    for (const d of (process.env.PATH || '').split(path.delimiter)) {
      const p = path.join(d, IS_WIN ? name + '.exe' : name);
      if (exists(p)) return p;
    }
    return null;
  };
  // a "tools" folder next to the program (or in its resources) also works, so the programs can simply be copied there
  const sideTool = name => [path.join(path.dirname(process.execPath), 'tools'), path.join(process.resourcesPath || '', 'tools'), path.join(__dirname, 'tools')]
    .map(d => path.join(d, IS_WIN ? name + '.exe' : name)).find(exists) || null;
  const findYtdlp = () => [getSettings().ytdlpPath, ownYtdlp(), sideTool('yt-dlp'), onPath('yt-dlp')].find(exists) || null;
  const ownDeno = () => path.join(toolsDir(), IS_WIN ? 'deno.exe' : 'deno');
  const findDeno = () => [ownDeno(), sideTool('deno'), onPath('deno')].find(exists) || null;
  const findFfmpeg = () => [getSettings().ffmpegPath, ownFfmpeg(), sideTool('ffmpeg'), onPath('ffmpeg')].find(exists) || null;

  // ---------- installing the helper programs ----------
  async function fetchTo(url, dest, svcId, kind) {
    const tries = [];
    if (svcId) tries.push(session.fromPartition(partitionOf(svcId)));      // through that service's proxy
    tries.push(session.defaultSession);                                    // direct
    let lastErr = null;
    for (const ses of tries) {
      try {
        const res = await ses.fetch(url, { redirect: 'follow' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const total = Number(res.headers.get('content-length')) || 0;
        let got = 0, lastSend = 0;
        const tmp = dest + '.part';
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const out = fs.createWriteStream(tmp);
        const src = Readable.fromWeb(res.body);
        src.on('data', c => {
          got += c.length;
          const now = Date.now();
          if (now - lastSend > 200) { lastSend = now; send('tools:progress', { kind, received: got, total }); }
        });
        await new Promise((resolve, reject) => { src.on('error', reject); out.on('error', reject); out.on('finish', resolve); src.pipe(out); });
        fs.renameSync(tmp, dest);
        send('tools:progress', { kind, received: got, total: total || got, done: true });
        return;
      } catch (e) { lastErr = e; try { fs.unlinkSync(dest + '.part'); } catch {} }
    }
    throw lastErr || new Error('download failed');
  }

  function extractZip(zip, dir) {
    return new Promise((resolve, reject) => {
      // Windows 10 and newer ship tar.exe, which can unpack zip files
      execFile('tar', ['-xf', zip, '-C', dir], { windowsHide: true, timeout: 300000 }, err => (err ? reject(err) : resolve()));
    });
  }
  function findFile(dir, name) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { const r = findFile(p, name); if (r) return r; }
      else if (e.name.toLowerCase() === name) return p;
    }
    return null;
  }

  async function installZipTool(url, exeName, dest, svcId, kind) {
    const zip = path.join(toolsDir(), kind + '.zip');
    await fetchTo(url, zip, svcId, kind);
    send('tools:progress', { kind, unpacking: true });
    const tmp = path.join(toolsDir(), kind + '-unpack');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    await extractZip(zip, tmp);
    const exe = findFile(tmp, exeName);
    if (!exe) throw new Error(exeName + ' was not found in the download');
    fs.copyFileSync(exe, dest);
    fs.rmSync(tmp, { recursive: true, force: true });
    try { fs.unlinkSync(zip); } catch {}
  }

  async function install(kind, svcId) {
    try {
      fs.mkdirSync(toolsDir(), { recursive: true });
      if (kind === 'ytdlp') {
        await fetchTo(YTDLP_URL, ownYtdlp(), svcId, 'ytdlp');
        if (!IS_WIN) fs.chmodSync(ownYtdlp(), 0o755);
        if (IS_WIN && !findDeno()) await installZipTool(DENO_ZIP_URL, 'deno.exe', ownDeno(), svcId, 'deno'); // YouTube needs a JavaScript engine
      } else if (kind === 'deno') {
        if (!IS_WIN) return { ok: false, error: 'Install Deno (deno.com) and make sure it is on your PATH.' };
        await installZipTool(DENO_ZIP_URL, 'deno.exe', ownDeno(), svcId, 'deno');
      } else if (kind === 'ffmpeg') {
        if (!IS_WIN) return { ok: false, error: 'Install ffmpeg with your system package manager, or use "Locate ffmpeg…".' };
        const zip = path.join(toolsDir(), 'ffmpeg.zip');
        await fetchTo(FFMPEG_ZIP_URL, zip, svcId, 'ffmpeg');
        send('tools:progress', { kind: 'ffmpeg', unpacking: true });
        const tmp = path.join(toolsDir(), 'ffmpeg-unpack');
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        await extractZip(zip, tmp);
        const exe = findFile(tmp, 'ffmpeg.exe');
        if (!exe) throw new Error('ffmpeg.exe was not found in the download');
        fs.copyFileSync(exe, ownFfmpeg());
        fs.rmSync(tmp, { recursive: true, force: true });
        try { fs.unlinkSync(zip); } catch {}
      } else return { ok: false, error: 'Unknown tool' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  ipcMain.handle('tools:status', () => ({ ytdlp: findYtdlp(), ffmpeg: findFfmpeg(), js: findDeno(), canInstallFfmpeg: IS_WIN, canInstallJs: IS_WIN }));
  ipcMain.handle('tools:install', (_e, kind, svcId) => install(kind, svcId));
  ipcMain.handle('tools:locate', async (_e, kind) => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], title: kind === 'ytdlp' ? 'Select yt-dlp' : 'Select ffmpeg' });
    if (r.canceled || !r.filePaths[0]) return null;
    saveSettings({ [kind === 'ytdlp' ? 'ytdlpPath' : 'ffmpegPath']: r.filePaths[0] });
    return r.filePaths[0];
  });

  // ---------- running yt-dlp ----------
  const proxyUrl = svc => {
    const p = svc && svc.proxy;
    if (!p || !p.enabled || !p.host || !p.port) return '';
    const scheme = { http: 'http', https: 'https', socks4: 'socks4a', socks5: 'socks5h' }[p.type] || 'http';
    const cred = p.username ? `${encodeURIComponent(p.username)}${p.password ? ':' + encodeURIComponent(p.password) : ''}@` : '';
    return `${scheme}://${cred}${p.host}:${p.port}`;
  };

  async function writeCookies(svcId) {
    const file = path.join(os.tmpdir(), 'mm-cookies-' + crypto.randomBytes(6).toString('hex') + '.txt');
    try {
      const cookies = await session.fromPartition(partitionOf(svcId)).cookies.get({});
      const lines = ['# Netscape HTTP Cookie File'];
      for (const c of cookies) {
        if (!c.name) continue;
        const dom = c.domain || '';
        lines.push([(c.httpOnly ? '#HttpOnly_' : '') + dom, dom.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/',
          c.secure ? 'TRUE' : 'FALSE', c.expirationDate ? Math.floor(c.expirationDate) : 0, c.name, c.value].join('\t'));
      }
      fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
      return file;
    } catch { return null; }
  }

  let insecureTls = false; // set when a proxy / antivirus re-signs HTTPS traffic with its own certificate
  const isCertError = t => /CERTIFICATE_VERIFY_FAILED|self[- ]signed certificate|certificate verify failed/i.test(t || '');

  function baseArgs(svc, ffmpeg, cookieFile) {
    const a = ['--ignore-config', '--no-warnings', '--no-color', '--encoding', 'utf-8', '--no-update', '--socket-timeout', '15'];
    const px = proxyUrl(svc);
    if (px) a.push('--proxy', px);
    if (cookieFile) a.push('--cookies', cookieFile);
    if (insecureTls) a.push('--no-check-certificates');
    if (ffmpeg) a.push('--ffmpeg-location', ffmpeg);
    // YouTube needs a JavaScript engine (Deno). Electron's own Node is too old for yt-dlp, so Deno is installed with it.
    const deno = findDeno();
    if (deno) a.push('--js-runtimes', 'deno:' + deno);
    return a;
  }
  const childEnv = () => ({ ...process.env, PYTHONIOENCODING: 'utf-8' });

  // (tests only) lets the automated tests point a page's video at a local file
  const testMap = u => { try { const m = JSON.parse(process.env.MM_VIDEO_MAP || 'null'); if (m) { const h = hostOf(u); for (const k of Object.keys(m)) if (h.includes(k)) return m[k]; } } catch {} return u; };
  const isYoutube = u => /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(hostOf(u));
  function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }
  const needsLogin = msg => /sign in|log ?in|\bage[- ]restrict|confirm you.?re not a bot|use --cookies|private video|members[- ]only/i.test(msg || '');
const isNetwork = msg => /unable to connect|timed? ?out|connection|getaddrinfo|tunnel|proxy|name or service|resolve|unreachable|ssl/i.test(msg || '');

  function lastError(text) {
    const m = String(text || '').split(/\r?\n/).filter(l => /ERROR/i.test(l)).pop();
    return (m || String(text || '').trim().split(/\r?\n/).pop() || 'Download failed').replace(/^ERROR:\s*/i, '').slice(0, 300);
  }

  const infoJobs = new Set(); // quality lookups in progress; an older one is dropped when you ask again
  function runInfo(exe, args, onLine) {
    return new Promise(resolve => {
      log('INFO start: ' + path.basename(exe) + ' ' + args.join(' '));
      const t0 = Date.now(); let lastLine = Date.now();
      const child = spawn(exe, args, { env: childEnv(), windowsHide: true, detached: !IS_WIN });
      log('INFO pid ' + child.pid); infoJobs.add(child); child.on('close', () => infoJobs.delete(child));
      let out = '', err = '', done = false, gotAny = false;
      const stall = setTimeout(() => { if (!gotAny) { killTree(child); finish({ ok: false, stalled: true, error: 'The downloader did not start (no output for 40 seconds)', details: '', network: false }); } }, 40000);
      const tick = setInterval(() => { if (onLine && Date.now() - lastLine > 1800) onLine('[wait] Waiting for the website… ' + Math.round((Date.now() - t0) / 1000) + ' s'); }, 1000);
      const finish = r => { if (done) return; done = true; clearTimeout(timer); clearTimeout(stall); clearInterval(tick); log('INFO end ok=' + r.ok + ' after ' + Math.round((Date.now() - t0) / 1000) + 's ' + (r.error || '')); resolve(r); };
      const timer = setTimeout(() => {
        killTree(child);
        finish({ ok: false, error: 'No answer from the website after 2 minutes', details: err.slice(-1500), network: true });
      }, 120000);
      child.stdout.on('data', d => { gotAny = true; if (out.length < 80e6) out += d.toString('utf8'); });
      child.stderr.on('data', d => {
        const t = d.toString('utf8'); err += t; lastLine = Date.now(); gotAny = true; log('INFO stderr: ' + t.trim().slice(0, 300));
        if (onLine) for (const l of t.split(/\r?\n/)) if (l.trim()) onLine(l.trim());
      });
      child.on('error', e => { log('INFO spawn error: ' + e.message); finish({ ok: false, error: String(e.message), details: String(e.message), network: false }); });
      child.on('close', () => {
        const details = err.slice(-1500);
        if (!out.trim()) return finish({ ok: false, error: lastError(err), details, network: isNetwork(err) });
        let j = null;
        try { j = JSON.parse(out); } catch {}
        // yt-dlp prints "null" when it could not read the video: the real reason is in its error messages
        if (!j || typeof j !== 'object') return finish({ ok: false, error: lastError(err), details, network: isNetwork(err) });
        finish({ ok: true, json: j });
      });
    });
  }

  function summarize(j, hasFfmpeg) {
    const entry = j._type === 'playlist' && j.entries && j.entries[0] ? j.entries[0] : j;
    const fmts = (entry.formats || []).filter(f => f && f.format_id);
    const size = f => f.filesize || f.filesize_approx || 0;
    const audioOnly = fmts.filter(f => f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
    const bestAudioSize = audioOnly.reduce((m, f) => Math.max(m, size(f)), 0);
    // the size shown is for the file that will be downloaded: H.264 if it exists, else VP9, else the rest ("super resolution" streams only when nothing else has that height)
    const isSr = f => /(^|-)sr$/.test(String(f.format_id));
    const rank = f => (isSr(f) ? 0.5 : /^avc1/.test(f.vcodec) ? 3 : /^vp0?9/.test(f.vcodec) ? 2 : 1);
    const m4a = audioOnly.filter(f => f.ext === 'm4a').reduce((m, f) => Math.max(m, size(f)), 0);
    const audioSize = m4a || bestAudioSize;
    const byHeight = new Map();
    for (const f of fmts) {
      if (!f.height || !f.vcodec || f.vcodec === 'none') continue;
      const prog = f.acodec && f.acodec !== 'none';
      const cur = byHeight.get(f.height) || { height: f.height, size: 0, progressive: false, fps: 0, rank: 0 };
      cur.progressive = cur.progressive || prog;
      cur.fps = Math.max(cur.fps, f.fps || 0);
      if (rank(f) > cur.rank || (rank(f) === cur.rank && size(f) > cur.vsize)) { cur.rank = rank(f); cur.vsize = size(f); cur.size = size(f) + (prog ? 0 : audioSize); }
      byHeight.set(f.height, cur);
    }
    let videos = [...byHeight.values()].sort((a, b) => b.height - a.height);
    if (!hasFfmpeg) videos = videos.filter(v => v.progressive);
    const seen = new Set();
    const audios = audioOnly.map(f => ({ id: f.format_id, ext: f.ext, abr: Math.round(f.abr || 0), size: size(f) }))
      .sort((a, b) => b.abr - a.abr)
      .filter(a => { const k = a.ext + a.abr; if (seen.has(k)) return false; seen.add(k); return true; });
    return {
      title: entry.title || j.title || '', uploader: entry.uploader || entry.channel || '', duration: entry.duration || 0,
      thumbnail: entry.thumbnail || '', playlist: j._type === 'playlist', count: j.entries ? j.entries.length : 1,
      videos: videos.map(v => ({ height: v.height, fps: v.fps, size: v.size, progressive: v.progressive })),
      audios, hasFfmpeg
    };
  }

  ipcMain.handle('video:info', async (_e, svcId, url) => {
    try { return await videoInfo(svcId, url); }
    catch (e) { log('INFO crashed: ' + (e && e.stack || e)); return { ok: false, error: 'Internal error: ' + String((e && e.message) || e), details: String((e && e.stack) || e).slice(0, 800) }; }
  });
  async function videoInfo(svcId, url) {
    const origUrl = url;
    url = testMap(url);
    const exe = findYtdlp();
    if (!exe) return { ok: false, needTools: true };
    const svc = loadServices().find(s => s.id === svcId);
    const ffmpeg = findFfmpeg();
    const yt = isYoutube(url);
    const shown = origUrl;
    for (const c of infoJobs) killTree(c);          // a stuck earlier lookup must not block or slow this one
    send('video:status', { url: origUrl, text: 'Starting the downloader…' });
    const status = line => {                       // tell the page what yt-dlp is doing, e.g. "Downloading player"
      if (!/^\[/.test(line) || /deprecat/i.test(line)) return;
      if (line.startsWith('[wait]')) return send('video:status', { url: shown, text: line.slice(7) });      // only real progress lines
      const t = line.replace(/^\[[^\]]+\]\s*/, '').replace(/^[\w-]{6,}:\s*/, '').replace(/^ERROR:\s*/i, '').slice(0, 80);
      if (t) send('video:status', { url: shown, text: t });
    };
    const attempt = async cookies => {
      const cf = cookies ? await writeCookies(svcId) : null;
      try { return await runInfo(exe, [...baseArgs(svc, ffmpeg, cf), '-J', ...(yt ? ['--no-playlist'] : ['--playlist-items', '1']), url], status); }
      finally { if (cf) try { fs.unlinkSync(cf); } catch {} }
    };
    let r = await attempt(!yt);
    if (!r.ok && r.stalled) { send('video:status', { url: shown, text: 'Restarting the downloader…' }); r = await attempt(!yt); } // a stuck start usually works the second time
    if (!r.ok && !insecureTls && isCertError(r.details || r.error)) { insecureTls = true; r = await attempt(!yt); }
    if (!r.ok && yt && needsLogin(r.error)) r = await attempt(true);
    if (!r.ok) return { ok: false, error: r.error, details: r.details, network: r.network, proxy: !!proxyUrl(svc) };
    return { ok: true, info: summarize(r.json, !!ffmpeg) };
  }

  // ---------- downloads ----------
  const jobs = new Map(); // id -> child process

  // mode: undefined = the exact quality asked for; 'sort' = let yt-dlp choose, preferring that height; 'any' = plain defaults
  function formatArgs(job, ffmpeg0, progressive, mode) {
    const ffmpeg = ffmpeg0 && !progressive; // progressive = one ready-made file, nothing to merge
    const a = [];
    if (job.kind === 'audio') {
      if (job.mp3) { if (mode !== 'any') a.push('-f', 'bestaudio/best'); }   // the MP3 conversion is done by the app itself (see convertMp3)
      else if (mode === 'any') a.push('-x');
      else a.push('-f', mode === 'sort' ? 'ba/b' : (job.formatId || 'bestaudio/best'));
    } else if (job.kind === 'video') {
      // The exact height you picked, never a lower one. Different codec families are tried in turn (see startJob).
      const h = Number(job.height) || 4320;
      const nosr = '[format_id!*=sr]';                 // skip YouTube's "super resolution" AV1 streams (they often cannot be merged)
      if (!ffmpeg) a.push('-f', `b[height=${h}]`);
      else {
        const f = mode === 'sr' ? `bv*[height=${h}][vcodec^=vp9]+ba[acodec=opus]/bv*[height=${h}][vcodec^=vp9]+ba/bv*[height=${h}]+ba`
          : mode === 'any' ? `bv*[height=${h}]${nosr}+ba/b[height=${h}]`
          : mode === 'vp9' ? `bv*[height=${h}][vcodec^=vp9]${nosr}+ba[acodec=opus]/bv*[height=${h}][vcodec^=vp9]${nosr}+ba`
          : `bv*[height=${h}][vcodec^=avc1]${nosr}+ba[ext=m4a]`;
        // every quality is merged into an .mkv first (always works) and then converted to .mp4; both files are kept
        a.push('-f', f, '--merge-output-format', 'mkv');
      }
    } else { // auto: best quality
      // Instagram: its ready-made file first (its separate video/audio streams often fail to merge)
      if (mode === 'any') { if (ffmpeg) a.push('--merge-output-format', 'mp4'); }
      else if (job.ig) a.push('-f', 'b/bv*+ba', '--merge-output-format', 'mp4');
      else if (ffmpeg) a.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4'); else a.push('-f', 'b');
    }
    return a;
  }

  function killTree(child) {
    if (!child || !child.pid) return;
    try {
      if (IS_WIN) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      else process.kill(-child.pid, 'SIGKILL');
    } catch { try { child.kill('SIGKILL'); } catch {} }
  }

  async function startJob(svcId, url, job) {
    url = testMap(url);
    const exe = findYtdlp();
    if (!exe) return { ok: false, needTools: true };
    if (!/^https?:\/\//i.test(url || '')) return { ok: false, error: 'This page has no video link.' };
    const svc = loadServices().find(s => s.id === svcId);
    const ffmpeg = findFfmpeg();
    const yt = isYoutube(url);
    const dir = defaultDownloadDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}

    const rec = {
      id: crypto.randomUUID(), serviceId: svcId, service: svc ? svc.name : '', kind: 'tool', job,
      name: job.title ? job.title : url.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 90), url, path: '', total: 0, received: 0, state: 'progressing',
      phase: 'Starting…', startedAt: Date.now(), mime: ''
    };
    addDl(rec);

    // each quality gets its own file name, so choosing another quality never reuses an earlier file
    const suffix = job.kind === 'video' && job.height ? ` ${Number(job.height)}p` : job.kind === 'audio' ? (job.mp3 ? ` ${Number(job.mp3)}kbps` : ' audio') : '';
    let lastFfmpegError = '';
    const ffmpegRun = args => new Promise(res => {
      const c = spawn(ffmpeg, args, { windowsHide: true, detached: !IS_WIN });
      jobs.set(rec.id, c);
      let e = ''; c.stderr.on('data', d => { e += d.toString('utf8'); if (e.length > 6000) e = e.slice(-3000); });
      c.on('error', er => { lastFfmpegError = String(er.message); res(false); });
      c.on('close', code => { jobs.delete(rec.id); lastFfmpegError = e.trim().slice(-500); log('FFMPEG end code ' + code + ' ' + lastFfmpegError); res(code === 0); });
    });
    async function convertMp3(file, kbps) {
      const out = file.replace(/\.[^.]+$/, '.mp3');
      rec.phase = 'Converting to MP3…'; rec.received = 0; rec.total = 0; pushDl(rec, true);
      log('MP3 ' + file + ' -> ' + out);
      const ok = await ffmpegRun(['-y', '-v', 'error', '-i', file, '-vn', '-map_metadata', '0', '-c:a', 'libmp3lame', '-b:a', kbps + 'k', out]);
      if (rec.state === 'cancelled') return null;
      if (ok && exists(out)) { try { fs.unlinkSync(file); } catch {} return out; }
      try { fs.unlinkSync(out); } catch {}
      return null;
    }
    // one .mp4 in the end: copy the picture and re-encode only the sound (fast); if that fails, re-encode everything
    async function toMp4(file) {
      const out = file.replace(/\.[^.]+$/, '.mp4');
      const tries = [['-c:v', 'copy', '-c:a', 'aac', '-strict', '-2', '-b:a', '192k'],
        ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-strict', '-2', '-b:a', '192k']];
      for (const t of tries) {
        rec.phase = t[1] === 'copy' ? 'Converting to MP4…' : 'Converting to MP4 (this can take a few minutes)…';
        rec.received = 0; rec.total = 0; pushDl(rec, true);
        log('CONVERT ' + t.join(' '));
        const ok = await ffmpegRun(['-y', '-v', 'error', '-i', file, ...t, '-movflags', '+faststart', out]);
        if (rec.state === 'cancelled') { try { fs.unlinkSync(out); } catch {} return null; }   // no half-written .mp4 left behind
        if (ok && exists(out)) return out;               // the .mkv is kept next to the .mp4 on purpose
        try { fs.unlinkSync(out); } catch {}
      }
      return null;                                       // keep the .mkv rather than lose the download
    }
    const tmpDir = path.join(dir, '.mm-tmp-' + rec.id.slice(0, 8)); // pieces (video stream, audio stream) live here and are deleted at the end
    const run = async (useCookies, progressive, mode) => {
      const cf = useCookies ? await writeCookies(svcId) : null;
      const args = [...baseArgs(svc, ffmpeg, cf).filter(x => x !== '--no-warnings'), '-P', 'home:' + dir, '-P', 'temp:' + tmpDir, '-o', '%(title).120B [%(id)s]' + suffix + '.%(ext)s',
        '--windows-filenames', '--trim-filenames', '150', '--newline', '--progress', '-q', '--no-simulate',
        '--progress-template', 'download:MMP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.status)s',
        '--print', 'before_dl:MMT|%(title)s', '--print', 'after_move:MMF|%(filepath)s',
        ...formatArgs({ ...job, ig: /(^|\.)instagram\.com$/i.test(hostOf(url)) }, ffmpeg, progressive, mode), ...(yt ? ['--no-playlist'] : []), url];
      return new Promise(resolve => {
        log('DL start: ' + args.join(' '));
        const child = spawn(exe, args, { env: childEnv(), windowsHide: true, detached: !IS_WIN });
        jobs.set(rec.id, child);
        let err = '', buf = '', file = '';
        const line = l => {
          if (l.startsWith('MMP|')) {
            const [, got, tot, est, st] = l.split('|');
            rec.received = Number(got) || 0;
            rec.total = Number(tot) || Number(est) || 0;
            rec.phase = st === 'finished' ? 'Processing…' : '';
            pushDl(rec);
          } else if (l.startsWith('MMT|')) { rec.name = l.slice(4).slice(0, 150); pushDl(rec, true); }
          else if (l.startsWith('MMF|')) { file = l.slice(4).trim(); }
          else if (l.trim()) err += l + '\n';
        };
        child.stdout.on('data', d => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } });
        child.stderr.on('data', d => { const t = d.toString('utf8'); err += t; log('DL stderr: ' + t.trim().slice(0, 400)); if (err.length > 20000) err = err.slice(-10000); });
        child.on('error', e => { err += String(e.message); });
        child.on('close', code => {
          jobs.delete(rec.id); log('DL end code ' + code);
          if (cf) try { fs.unlinkSync(cf); } catch {}
          if (buf.trim()) line(buf.trim());
          resolve({ code, err, file });
        });
      });
    };

    (async () => { try {
      let r = await run(!yt);
      if (rec.state === 'cancelled') return;
      if (r.code !== 0 && !insecureTls && isCertError(r.err)) { insecureTls = true; rec.phase = 'Retrying…'; pushDl(rec, true); r = await run(!yt); if (rec.state === 'cancelled') return; }
      if (r.code !== 0 && yt && needsLogin(r.err)) { rec.phase = 'Retrying with your sign-in…'; pushDl(rec, true); r = await run(true); }
      const retriable = e => /requested format is not available|postprocess|codec parameters|ffmpeg|merg|invalid data/i.test(e || '');
      if (job.kind === 'video') {                      // exact height, other codec families
        for (const mode of ['vp9', 'any', 'sr']) {
          if (r.code === 0 || rec.state === 'cancelled' || !retriable(r.err)) break;
          rec.phase = 'Trying another format of the same quality…'; rec.received = 0; rec.total = 0; pushDl(rec, true);
          r = await run(!yt, false, mode);
        }
      } else {
        if (r.code !== 0 && ffmpeg && job.kind !== 'audio' && /postprocess|codec parameters|ffmpeg|merg/i.test(r.err)) { // merging failed: take the ready-made single file instead
          rec.phase = 'Retrying with a single file…'; rec.received = 0; rec.total = 0; pushDl(rec, true);
          r = await run(!yt, true);
        }
        for (const mode of ['sort', 'any']) {
          if (r.code === 0 || !/requested format is not available/i.test(r.err) || rec.state === 'cancelled') break;
          rec.phase = 'Choosing the closest quality…'; rec.received = 0; rec.total = 0; pushDl(rec, true);
          r = await run(!yt, false, mode);
        }
      }
      if (r.code === 0 && job.kind === 'video' && ffmpeg && r.file && /\.(mkv|webm)$/i.test(r.file)) {
        const srcFile = r.file;
        const mp4 = await toMp4(srcFile);
        if (rec.state === 'cancelled') return;
        if (mp4) { r = { ...r, file: mp4 }; rec.note = 'Original ' + path.extname(srcFile).toUpperCase().slice(1) + ' also kept'; }
        else { rec.note = 'Could not convert to MP4, kept as MKV. ffmpeg said: ' + String(lastFfmpegError || 'no message').replace(/\s+/g, ' ').slice(-170); rec.details = lastFfmpegError; }
      }
      if (r.code === 0 && job.kind === 'video' && ffmpeg && r.file && /\.mp4$/i.test(r.file) && !rec.note) { // a ready-made single .mp4: add the matching .mkv copy too
        const mkv = r.file.replace(/\.[^.]+$/, '.mkv');
        if (!exists(mkv)) {
          const ok = await ffmpegRun(['-y', '-v', 'error', '-i', r.file, '-c', 'copy', mkv]);
          if (ok && exists(mkv) && rec.state !== 'cancelled') rec.note = 'MKV copy also saved';
          else { try { fs.unlinkSync(mkv); } catch {} }
        }
      }
      if (r.code === 0 && job.kind === 'audio' && job.mp3 && r.file && !/\.mp3$/i.test(r.file)) {
        if (!ffmpeg) { r = { ...r, code: 1, err: 'ERROR: ffmpeg is needed to make MP3 files (Settings → Video downloader → Install ffmpeg)' }; }
        else {
          const mp3 = await convertMp3(r.file, job.mp3);
          if (rec.state === 'cancelled') return;
          if (mp3) r = { ...r, file: mp3 };
          else r = { ...r, code: 1, err: 'ERROR: MP3 conversion failed: ' + (lastFfmpegError || 'unknown error') };
        }
      }
      if (rec.state === 'cancelled') return;
      rec.finishedAt = Date.now();
      rec.phase = '';
      if (r.code === 0 && r.file && exists(r.file)) {
        rec.path = r.file; rec.name = path.basename(r.file);
        try { rec.total = rec.received = fs.statSync(r.file).size; } catch {}
        rec.state = 'completed';
      } else {
        rec.state = 'interrupted';
        rec.error = lastError(r.err);
        rec.details = String(r.err || '').slice(-900);
        if (/challenge|js runtime|javascript runtime|only images/i.test(r.err) || /requested format is not available/i.test(rec.error))
          rec.error += ' (YouTube may need the Deno helper or an update: Settings → Video downloader → Install / update yt-dlp)';
      }
      if (!hasDl(rec)) return;
      saveDownloads();
      pushDl(rec, true);
      if (rec.state === 'completed') notifyDone(rec);
    } finally { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} } })();
    return { ok: true, id: rec.id };
  }

  ipcMain.handle('video:start', (_e, svcId, url, job) => startJob(svcId, String(url || ''), job || { kind: 'auto' }));

  return {
    isTool: rec => rec && rec.kind === 'tool',
    cancel(id) { const c = jobs.get(id); const rec = findDl(id); if (rec) { rec.state = 'cancelled'; rec.phase = ''; rec.finishedAt = Date.now(); saveDownloads(); pushDl(rec, true); } if (c) killTree(c); },
    retry(rec) { return startJob(rec.serviceId, rec.url, rec.job || { kind: 'auto' }); },
    running: id => jobs.has(id),
    killAll() { for (const c of jobs.values()) killTree(c); }
  };
};
