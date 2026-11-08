// Runs before every page in every service. Google refuses to sign in inside "embedded browsers" and looks at
// more than the User-Agent text: it also reads navigator.userAgentData and window.chrome. Electron reports no
// "Google Chrome" brand there, so the page looks like a custom app. This makes those values match a normal Chrome.
const { webFrame } = require('electron');
const major = String(process.versions.chrome).split('.')[0];
const full = process.versions.chrome;
webFrame.executeJavaScript(`(() => {
  try {
    if (/Firefox\\//.test(navigator.userAgent)) {   // Google sign-in: look like Firefox, which has neither of these
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
      try { delete window.chrome; } catch (e) {}
      return;
    }
    const major = ${JSON.stringify(major)}, full = ${JSON.stringify(full)};
    const brands = [{ brand: 'Not_A Brand', version: '24' }, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }];
    const fullList = [{ brand: 'Not_A Brand', version: '24.0.0.0' }, { brand: 'Chromium', version: full }, { brand: 'Google Chrome', version: full }];
    const uad = {
      brands, mobile: false, platform: 'Windows',
      getHighEntropyValues(hints) {
        const all = { architecture: 'x86', bitness: '64', brands, fullVersionList: fullList, mobile: false, model: '',
          platform: 'Windows', platformVersion: '10.0.0', uaFullVersion: full, wow64: false };
        const out = { brands, mobile: false, platform: 'Windows' };
        (hints || []).forEach(h => { if (h in all) out[h] = all[h]; });
        return Promise.resolve(out);
      },
      toJSON() { return { brands, mobile: false, platform: 'Windows' }; }
    };
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => uad, configurable: true });
    if (!window.chrome) window.chrome = {};
    const c = window.chrome;
    if (!c.runtime) c.runtime = {};
    if (!c.app) c.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
    if (!c.loadTimes) c.loadTimes = () => ({});
    if (!c.csi) c.csi = () => ({});
    if (navigator.webdriver) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
  } catch (e) {}
})();`).catch(() => {});
