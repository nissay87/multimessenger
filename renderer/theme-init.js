// Runs before first paint so the saved theme / icon size / font are applied without a flash.
try {
  const t = localStorage.getItem('mm-theme');
  const s = localStorage.getItem('mm-icon');
  const f = localStorage.getItem('mm-font');
  if (t) document.documentElement.dataset.theme = t;
  if (s) document.documentElement.style.setProperty('--icon-size', s + 'px');
  if (f) document.documentElement.style.setProperty('--font', f);
} catch (e) {}
