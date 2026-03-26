/**
 * CX Dashboard — Central Config
 * Loads from localStorage, falls back to defaults.
 * Injects CSS variable overrides so all pages respond to theme changes.
 */
(function () {
  const DEFAULTS = {
    brand: 'Redpill Linpro CX',
    primary: '#f64d50',
    secondary: '#006a62',
    tertiary: '#8e4a0c',
    error: '#ba1a1a',
    thresholds: {
      openRate:       { good: 25,  warn: 15 },
      clickRate:      { good: 5,   warn: 2  },
      ctor:           { good: 15,  warn: 8  },
      completionRate: { good: 80,  warn: 50 }
    }
  };

  // Deep merge stored config over defaults
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('cx_config') || '{}'); } catch (e) {}

  const cfg = {
    ...DEFAULTS,
    ...stored,
    thresholds: {
      ...DEFAULTS.thresholds,
      ...(stored.thresholds || {})
    }
  };

  // Expose globally
  window.CX_CONFIG = cfg;

  // ── Apply CSS variable overrides ──────────────────────────────────────────
  const root = document.documentElement;
  root.style.setProperty('--cx-primary',   cfg.primary);
  root.style.setProperty('--cx-secondary', cfg.secondary);
  root.style.setProperty('--cx-tertiary',  cfg.tertiary);

  const p  = cfg.primary;
  const s  = cfg.secondary;
  const t  = cfg.tertiary;

  // Generate alpha hex from a hex color and 0-1 alpha
  function withAlpha(hex, a) {
    return `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`;
  }

  const style = document.createElement('style');
  style.id = 'cx-theme-overrides';
  style.textContent = `
    /* ── Primary ───────────────────────────────── */
    .text-primary                     { color: ${p} !important; }
    .bg-primary                       { background-color: ${p} !important; }
    .border-primary                   { border-color: ${p} !important; }
    .ring-primary                     { --tw-ring-color: ${p} !important; }
    .bg-primary\\/10                  { background-color: ${withAlpha(p, 0.10)} !important; }
    .bg-primary\\/20                  { background-color: ${withAlpha(p, 0.20)} !important; }
    .text-primary\\/70                { color: ${withAlpha(p, 0.70)} !important; }
    .shadow-primary\\/5               { --tw-shadow-color: ${withAlpha(p, 0.05)} !important; }
    .shadow-primary\\/20              { --tw-shadow-color: ${withAlpha(p, 0.20)} !important; }
    .shadow-primary\\/30              { --tw-shadow-color: ${withAlpha(p, 0.30)} !important; }
    .hover\\:bg-primary:hover         { background-color: ${p} !important; }
    .hover\\:text-primary:hover       { color: ${p} !important; }
    .hover\\:border-primary\\/20:hover { border-color: ${withAlpha(p, 0.20)} !important; }
    .focus\\:ring-primary\\/40:focus  { --tw-ring-color: ${withAlpha(p, 0.40)} !important; }
    .focus-within\\:ring-primary:focus-within { --tw-ring-color: ${p} !important; }
    .group:hover .group-hover\\:bg-primary    { background-color: ${p} !important; }
    .group:hover .group-hover\\:text-primary  { color: ${p} !important; }
    .group:hover .group-hover\\:text-on-primary { color: #ffffff !important; }

    /* ── Secondary ─────────────────────────────── */
    .text-secondary                   { color: ${s} !important; }
    .bg-secondary                     { background-color: ${s} !important; }
    .border-secondary                 { border-color: ${s} !important; }
    .bg-secondary\\/10                { background-color: ${withAlpha(s, 0.10)} !important; }
    .bg-secondary\\/20                { background-color: ${withAlpha(s, 0.20)} !important; }
    .hover\\:bg-secondary\\/20:hover  { background-color: ${withAlpha(s, 0.20)} !important; }
    .on-secondary-container           { color: ${s} !important; }

    /* ── Tertiary ──────────────────────────────── */
    .text-tertiary                    { color: ${t} !important; }
    .bg-tertiary                      { background-color: ${t} !important; }

    /* ── Chart.js tooltip borders pick up primary ── */
    :root { --cx-primary: ${p}; --cx-secondary: ${s}; --cx-tertiary: ${t}; }
  `;
  document.head.appendChild(style);

  // ── Apply brand name after DOM is ready ──────────────────────────────────
  function applyBrand() {
    document.querySelectorAll('[data-brand]').forEach(el => {
      el.textContent = cfg.brand;
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBrand);
  } else {
    applyBrand();
  }

  // ── Helper: save config and reload ───────────────────────────────────────
  window.CX_SAVE_CONFIG = function (updates) {
    const current = { ...window.CX_CONFIG, ...updates };
    if (updates.thresholds) {
      current.thresholds = { ...window.CX_CONFIG.thresholds, ...updates.thresholds };
    }
    localStorage.setItem('cx_config', JSON.stringify(current));
    window.location.reload();
  };

  window.CX_RESET_CONFIG = function () {
    localStorage.removeItem('cx_config');
    window.location.reload();
  };
})();
