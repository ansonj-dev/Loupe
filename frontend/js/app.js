// js/app.js — shared across all pages (app shell concerns only)

(function () {
  // ── highlight current nav link ─────────────────────────────
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach((a) => {
    const target = a.getAttribute('href').split('/').pop();
    if (target === here || (here === '' && target === 'index.html')) {
      a.classList.add('is-active');
    }
  });

  // ── register service worker ────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {
        /* offline support is a bonus, not a blocker */
      });
    });
  }

  // ── PWA install prompt ─────────────────────────────────────
  let deferredInstall = null;
  const banner     = document.getElementById('install-banner');
  const installBtn = document.getElementById('install-btn');
  const dismissBtn = document.getElementById('install-dismiss');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (banner && !sessionStorage.getItem('loupe-install-dismissed')) {
      banner.classList.add('is-visible');
    }
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      deferredInstall = null;
      banner.classList.remove('is-visible');

      if (typeof pendo !== 'undefined') {
        pendo.track('pwa_install_accepted', {
          installOutcome: outcome,
          page: window.location.pathname
        });
      }
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      banner.classList.remove('is-visible');
      sessionStorage.setItem('loupe-install-dismissed', '1');
    });
  }
})();
