// Apply the saved choice before first paint. The approved Wayline design defaults to light.
(function () {
  var theme = 'light';
  try {
    var stored = localStorage.getItem('wayline-theme');
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch { /* The default remains usable when storage is unavailable. */ }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#122e37' : '#e8f2f5');
})();
