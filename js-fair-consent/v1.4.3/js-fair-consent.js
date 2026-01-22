// consent-analytics.js (UMD) v1.4.3
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConsentAnalytics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.4.3';

  // i18n strings
  var LOCALES = {
    en: {
      title: "Cookies & Analytics",
      body: "We use essential cookies and privacy-friendly analytics. With consent, we enable additional tools.",
      accept: "Accept",
      deny: "Deny",
      settings: "Settings"
    },
    pl: {
      title: "Ciasteczka i analityka",
      body: "Używamy niezbędnych ciasteczek oraz analityki przyjaznej prywatności. Za Twoją zgodą włączymy dodatkowe narzędzia.",
      accept: "Akceptuję",
      deny: "Odrzuć",
      settings: "Ustawienia"
    }
  };

  function pickLocale(code) {
    if (!code) return 'en';
    var norm = String(code).toLowerCase();
    if (LOCALES[norm]) return norm;
    var short = norm.split('-')[0];
    return LOCALES[short] ? short : 'en';
  }

  // config (granular is off by default)
  var CONFIG = {
    debug: false,
    nonce: null,             // CSP nonce
    integrity: null,         // SRI string (optional)
    cookieName: 'allowCookies',
    cookieDays: 365,
    cookieDomain: null,      // e.g. ".example.com"; null = don't set Domain
    selectors: {
      banner: '.consent-banner',
      title: '[data-i18n-key="title"]',
      body: '[data-i18n-key="body"]',
      accept: '#btnAccept',
      deny: '#btnDeny',
      acceptLabel: '[data-i18n-key="accept"]',
      denyLabel: '[data-i18n-key="deny"]'
    },
    respectGPC: true,
    respectDNT: true,
    locale: null,
    locales: LOCALES,

    // granular preferences (used only if granular === true)
    granular: false,
    categories: { analytics: 0, marketing: 0, personalization: 0 },

    services: {
      google: { enabled: true, gtagId: 'G-XXXXXXX', mode: 'consent-only' }, // 'preload'|'consent-only'|'disabled'
      matomo: { enabled: false, url: 'https://matomo.example.com/', siteId: '1' },
      umami: { enabled: true, websiteId: 'UMAMI_WEBSITE_ID', src: 'https://umami.is/a/script.js' },
      hotjar: { enabled: false, hjid: 0, hjsv: 7 }
    }
  };

  var state = {
    loaded: { google: false, matomo: false, umami: false, hotjar: false },
    scripts: Object.create(null) // src -> Promise
  };

  // logging (debug-only)
  function log() { if (CONFIG.debug) try { console.log('[ConsentAnalytics]', ...arguments); } catch (_) { } }
  function warn() { if (CONFIG.debug) try { console.warn('[ConsentAnalytics]', ...arguments); } catch (_) { } }

  // cookie helpers
  function isLocalHost(h) { return /^(localhost|127\.0\.0\.1)$/.test(h || location.hostname); }

  function setCookie(name, value, days) {
    var parts = [name + '=' + encodeURIComponent(value)];
    if (days) {
      var maxAge = days * 86400;
      parts.push('Expires=' + new Date(Date.now() + maxAge * 1000).toUTCString());
      parts.push('Max-Age=' + maxAge);
    }
    parts.push('Path=/', 'SameSite=Lax');
    if (location.protocol === 'https:') parts.push('Secure');
    if (CONFIG.cookieDomain && !isLocalHost()) parts.push('Domain=' + CONFIG.cookieDomain);
    document.cookie = parts.join('; ');
  }

  function getCookie(name) {
    var nameEQ = name + '=';
    var parts = document.cookie.split(';');
    for (var i = 0; i < parts.length; i++) {
      var c = parts[i].trim();
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.slice(nameEQ.length));
    }
    return null;
  }

  function eraseCookie(name) {
    var parts = [name + '=; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0', 'Path=/', 'SameSite=Lax'];
    if (location.protocol === 'https:') parts.push('Secure');
    if (CONFIG.cookieDomain && !isLocalHost()) parts.push('Domain=' + CONFIG.cookieDomain);
    document.cookie = parts.join('; ');
  }

  // prefs (1/0 in non-granular, JSON when granular)
  function readPrefs() {
    if (!CONFIG.granular) {
      var v = getCookie(CONFIG.cookieName);
      if (v === '1') return { analytics: 1, marketing: 1, personalization: 1 };
      if (v === '0') return { analytics: 0, marketing: 0, personalization: 0 };
      return null;
    }
    var raw = getCookie(CONFIG.cookieName);
    if (!raw) return null;
    try {
      var obj = JSON.parse(raw);
      return {
        analytics: obj.analytics ? 1 : 0,
        marketing: obj.marketing ? 1 : 0,
        personalization: obj.personalization ? 1 : 0
      };
    } catch (_) { return null; }
  }

  function writePrefs(prefs) {
    if (!CONFIG.granular) {
      var any = !!(prefs.analytics || prefs.marketing || prefs.personalization);
      setCookie(CONFIG.cookieName, any ? '1' : '0', CONFIG.cookieDays);
      return;
    }
    setCookie(CONFIG.cookieName, JSON.stringify({
      analytics: !!prefs.analytics,
      marketing: !!prefs.marketing,
      personalization: !!prefs.personalization
    }), CONFIG.cookieDays);
  }

  function hasConsent() {
    if (!CONFIG.granular) return getCookie(CONFIG.cookieName) === '1';
    var p = readPrefs(); return !!(p && (p.analytics || p.marketing || p.personalization));
  }

  // privacy signals (GPC/DNT)
  function privacySignalsDeny() {
    try {
      if (CONFIG.respectGPC && typeof navigator !== 'undefined' && navigator.globalPrivacyControl) return true;
      if (CONFIG.respectDNT && typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || navigator.msDoNotTrack === '1')) return true;
    } catch (_) { }
    return false;
  }

  // banner helpers
  function showBanner() { var el = document.querySelector(CONFIG.selectors.banner); if (el) el.classList.add('show'); }
  function hideBanner() { var el = document.querySelector(CONFIG.selectors.banner); if (el) el.classList.remove('show'); }

  function applyI18n() {
    var lang = pickLocale(CONFIG.locale || (typeof navigator !== 'undefined' ? navigator.language : 'en'));
    var dict = CONFIG.locales[lang] || CONFIG.locales.en;
    var t = document.querySelector(CONFIG.selectors.title);
    var b = document.querySelector(CONFIG.selectors.body);
    var al = document.querySelector(CONFIG.selectors.acceptLabel);
    var dl = document.querySelector(CONFIG.selectors.denyLabel);
    if (t) t.textContent = dict.title;
    if (b) b.textContent = dict.body;
    if (al) al.textContent = dict.accept;
    if (dl) dl.textContent = dict.deny;
  }

  // robust script loader (idempotent, timeout, nonce, SRI)
  function loadScript(src, opts) {
    opts = opts || {};
    var async = ('async' in opts) ? !!opts.async : true;
    var defer = !!opts.defer;
    var attrs = opts.attrs || {};
    var timeout = ('timeout' in opts) ? opts.timeout : 10000;
    var nonce = ('nonce' in opts) ? opts.nonce : CONFIG.nonce;
    var integrity = ('integrity' in opts) ? opts.integrity : CONFIG.integrity;

    if (state.scripts[src]) return state.scripts[src];

    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = async; s.defer = defer;
      if (nonce) s.setAttribute('nonce', nonce);
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      Object.keys(attrs).forEach(function (k) { s.setAttribute(k, attrs[k]); });
      var t = setTimeout(function () { s.onerror = s.onload = null; reject(new Error('Timeout ' + src)); }, timeout);
      s.onload = function () { clearTimeout(t); resolve(); };
      s.onerror = function () { clearTimeout(t); reject(new Error('Failed ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });

    state.scripts[src] = p;
    return p;
  }

  // Google Consent Mode v2
  function initGoogleConsentDefaults() {
    if (!CONFIG.services.google.enabled || CONFIG.services.google.mode === 'disabled') return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    var denied = privacySignalsDeny() || !hasConsent();
    window.gtag('consent', 'default', {
      ad_storage: denied ? 'denied' : 'granted',
      analytics_storage: denied ? 'denied' : 'granted',
      ad_user_data: denied ? 'denied' : 'granted',
      ad_personalization: denied ? 'denied' : 'granted',
      functionality_storage: 'granted',
      security_storage: 'granted',
      wait_for_update: 800
    });
  }

  function updateGoogleConsentGranted() {
    if (privacySignalsDeny()) return;
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        ad_storage: 'granted', analytics_storage: 'granted',
        ad_user_data: 'granted', ad_personalization: 'granted'
      });
    }
  }

  function updateGoogleConsentDenied() {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        ad_storage: 'denied', analytics_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied'
      });
    }
  }

  function loadGoogle() {
    if (!CONFIG.services.google.enabled || state.loaded.google) return Promise.resolve();
    var id = CONFIG.services.google.gtagId;
    if (!id) { warn('Missing google.gtagId'); return Promise.resolve(); }
    return loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id))
      .then(function () {
        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', id, { allow_google_signals: hasConsent() && !privacySignalsDeny() });
        state.loaded.google = true;
        log('Google loaded');
      })
      .catch(function (err) { warn('Google load failed', err); });
  }

  // Matomo (native consent)
  function loadMatomo() {
    if (!CONFIG.services.matomo.enabled) return;
    window._paq = window._paq || [];
    window._paq.push(['requireConsent']);
    window._paq.push(['enableLinkTracking']);
    var u = CONFIG.services.matomo.url;
    window._paq.push(['setTrackerUrl', u + 'matomo.php']);
    window._paq.push(['setSiteId', CONFIG.services.matomo.siteId]);
    if (!state.loaded.matomo) {
      loadScript(u + 'matomo.js', { defer: true })
        .then(function () { state.loaded.matomo = true; log('Matomo loaded'); })
        .catch(function (err) { warn('Matomo load failed', err); });
    }
  }
  function matomoRememberConsent() { if (window._paq) window._paq.push(['rememberConsentGiven']); }
  function matomoForgetConsent() { if (window._paq) window._paq.push(['forgetConsentGiven']); }
  function matomoTrackPageView(path) {
    if (!window._paq) return;
    if (path) window._paq.push(['setCustomUrl', path]);
    window._paq.push(['trackPageView']);
  }

  // Umami (no pre-consent; supports reload)
  function unloadScriptBySrc(src) {
    var nodes = document.querySelectorAll('script[src]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].src === src) nodes[i].parentNode.removeChild(nodes[i]);
    }
    delete state.scripts[src];
  }

  function loadUmami(opts) {
    opts = opts || {};
    if (!CONFIG.services.umami.enabled) return;
    var src = CONFIG.services.umami.src || 'https://umami.is/a/script.js';
    if (state.loaded.umami && opts.reload) {
      unloadScriptBySrc(src);
      state.loaded.umami = false;
    }
    if (state.loaded.umami) return;
    var attrs = { 'data-website-id': CONFIG.services.umami.websiteId };
    if (opts.anonymous) attrs['data-anonymous'] = 'true';
    loadScript(src, { defer: true, attrs: attrs })
      .then(function () { state.loaded.umami = true; log('Umami loaded', opts); })
      .catch(function (err) { warn('Umami load failed', err); });
  }

  // Hotjar
  function loadHotjar() {
    if (!CONFIG.services.hotjar.enabled || state.loaded.hotjar) return;
    (function (h, o, t, j, a, r) {
      h.hj = h.hj || function () { (h.hj.q = h.hj.q || []).push(arguments); };
      h._hjSettings = { hjid: CONFIG.services.hotjar.hjid, hjsv: CONFIG.services.hotjar.hjsv };
      a = o.getElementsByTagName('head')[0];
      r = o.createElement('script'); r.async = 1; r.src = t + h._hjSettings.hjid + j + h._hjSettings.hjsv;
      if (CONFIG.nonce) r.setAttribute('nonce', CONFIG.nonce);
      a.appendChild(r);
    })(window, document, 'https://static.hotjar.com/c/hotjar-', '.js?sv=');
    state.loaded.hotjar = true;
    log('Hotjar loaded');
  }

  // SPA helper
  function trackPageView(path) {
    if (window.gtag) window.gtag('event', 'page_view', { page_location: location.origin + (path || location.pathname + location.search) });
    matomoTrackPageView(path);
  }

  // init & consent application
  function deepMerge(base, patch) {
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
        base[k] = base[k] && typeof base[k] === 'object' ? base[k] : {};
        deepMerge(base[k], patch[k]);
      } else {
        base[k] = patch[k];
      }
    });
    return base;
  }

  function applyConsentToServices(prefs) {
    // Google
    if (CONFIG.services.google.enabled && CONFIG.services.google.mode !== 'disabled') {
      if (prefs.analytics || prefs.marketing || prefs.personalization) {
        updateGoogleConsentGranted();
        if (CONFIG.services.google.mode === 'consent-only') loadGoogle();
      } else {
        updateGoogleConsentDenied();
      }
    }
    // Matomo
    if (CONFIG.services.matomo.enabled) {
      if (prefs.analytics) matomoRememberConsent(); else matomoForgetConsent();
    }
    // Umami
    if (CONFIG.services.umami.enabled) {
      if (prefs.analytics) {
        loadUmami({ anonymous: false, reload: true });
      } else {
        unloadScriptBySrc(CONFIG.services.umami.src || 'https://umami.is/a/script.js');
        state.loaded.umami = false;
      }
    }
    // Hotjar
    if (CONFIG.services.hotjar.enabled) {
      if (prefs.marketing || prefs.personalization) loadHotjar();
    }
  }

  function init(custom) {
    if (custom && typeof custom === 'object') deepMerge(CONFIG, custom);
    applyI18n();

    if (!document.querySelector(CONFIG.selectors.banner)) warn('Banner element not found:', CONFIG.selectors.banner);

    // Google consent defaults before any tags
    if (CONFIG.services.google.enabled && CONFIG.services.google.mode !== 'disabled') {
      initGoogleConsentDefaults();
      if (CONFIG.services.google.mode === 'preload') loadGoogle();
    }

    // Matomo loads early but requires consent to track
    loadMatomo();

    var denySignals = privacySignalsDeny();
    var prefs = readPrefs();

    // show banner only if no stored decision and no GPC/DNT
    if (!prefs && !denySignals) showBanner(); else hideBanner();

    if (prefs) {
      applyConsentToServices(prefs);
    } else if (denySignals) {
      updateGoogleConsentDenied();
      matomoForgetConsent();
    }

    var a = document.querySelector(CONFIG.selectors.accept);
    var d = document.querySelector(CONFIG.selectors.deny);

    if (a) {
      a.addEventListener('click', function () {
        // non-granular -> full allow; granular -> use provided categories
        var granted = CONFIG.granular
          ? Object.assign({}, CONFIG.categories)
          : { analytics: 1, marketing: 1, personalization: 1 };

        if (!CONFIG.granular) {
          granted.analytics = 1; granted.marketing = 1; granted.personalization = 1;
        }

        writePrefs(granted);
        hideBanner();

        if (!privacySignalsDeny()) {
          applyConsentToServices(granted);
        } else {
          updateGoogleConsentDenied();
          matomoForgetConsent();
        }
      });
    } else { warn('Accept button not found:', CONFIG.selectors.accept); }

    if (d) {
      d.addEventListener('click', function () {
        var denied = { analytics: 0, marketing: 0, personalization: 0 };
        writePrefs(denied);
        hideBanner();
        updateGoogleConsentDenied();
        matomoForgetConsent();
        unloadScriptBySrc(CONFIG.services.umami.src || 'https://umami.is/a/script.js');
        state.loaded.umami = false;
      });
    } else { warn('Deny button not found:', CONFIG.selectors.deny); }

    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') hideBanner(); });
  }

  // revoke
  function revokeConsent() {
    var denied = { analytics: 0, marketing: 0, personalization: 0 };
    writePrefs(denied);
    updateGoogleConsentDenied();
    matomoForgetConsent();
    unloadScriptBySrc(CONFIG.services.umami.src || 'https://umami.is/a/script.js');
    state.loaded.umami = false;
    showBanner();
  }

  // public API
  return {
    VERSION: VERSION,
    init: init,
    hasConsent: hasConsent,
    readPrefs: readPrefs,
    writePrefs: writePrefs,
    revokeConsent: revokeConsent,
    trackPageView: trackPageView,
    setCookie: setCookie,
    getCookie: getCookie,
    eraseCookie: eraseCookie,
    loadGoogle: loadGoogle,
    loadMatomo: loadMatomo,
    loadUmami: loadUmami,
    loadHotjar: loadHotjar,
    CONFIG: CONFIG
  };
});
