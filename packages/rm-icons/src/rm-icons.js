/*!
 * rm-icons - lightweight, framework-free SVG icon loader.
 * Lazily fetches and inlines a named SVG icon from a configurable URL.
 * Pair with rm-icons.css for sizing/canvas/list/rotate/animate utilities.
 */
(function () {
  'use strict';

  var currentScript = document.currentScript;

  var MODIFIER_SUFFIXES = [
    '2xs', 'xs', 'sm', 'lg', 'xl', '2xl',
    '1x', '2x', '3x', '4x', '5x', '6x', '7x', '8x', '9x', '10x',
    'fw', 'ul', 'li',
    'rotate-90', 'rotate-180', 'rotate-270',
    'flip-horizontal', 'flip-vertical', 'flip-both',
    'spin', 'spin-reverse', 'pulse', 'beat', 'fade', 'beat-fade', 'bounce', 'shake'
  ];

  var config = {
    prefix: (currentScript && currentScript.dataset.prefix) || 'rm-icon',
    baseUrl: (currentScript && currentScript.dataset.baseUrl) || 'https://masiarek.pl/assets/img/icons'
  };

  var cache = new Map();
  var pending = new Map();
  var observer = null;

  function isModifier(token, prefix) {
    for (var i = 0; i < MODIFIER_SUFFIXES.length; i++) {
      if (token === prefix + '-' + MODIFIER_SUFFIXES[i]) return true;
    }
    return false;
  }

  function iconNameFromElement(el) {
    var marker = config.prefix + '-';
    var classes = el.className.split(/\s+/);
    for (var i = 0; i < classes.length; i++) {
      var cls = classes[i];
      if (cls.indexOf(marker) !== 0) continue;
      if (isModifier(cls, config.prefix)) continue;
      return cls.slice(marker.length);
    }
    return null;
  }

  function fetchIcon(name) {
    if (cache.has(name)) return Promise.resolve(cache.get(name));
    if (pending.has(name)) return pending.get(name);

    var url = config.baseUrl.replace(/\/$/, '') + '/' + name + '.svg';
    var promise = fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('rm-icons: HTTP ' + res.status + ' for ' + url);
        return res.text();
      })
      .then(function (svg) {
        cache.set(name, svg);
        pending.delete(name);
        return svg;
      })
      .catch(function (err) {
        console.error('[rm-icons]', err);
        cache.set(name, '');
        pending.delete(name);
        return '';
      });

    pending.set(name, promise);
    return promise;
  }

  function renderIcon(el) {
    var name = iconNameFromElement(el);
    if (!name || el.dataset.rmIconLoaded === '1') return;
    el.dataset.rmIconLoaded = '1';
    el.classList.add('rm-icon-loading');

    fetchIcon(name).then(function (svg) {
      el.classList.remove('rm-icon-loading');
      if (svg) el.innerHTML = svg;
    });
  }

  function getObserver() {
    if (observer) return observer;
    if (typeof IntersectionObserver === 'undefined') return null;

    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        renderIcon(entry.target);
        observer.unobserve(entry.target);
      });
    });
    return observer;
  }

  function scan(root) {
    var scope = root || document;
    var marker = config.prefix + '-';
    var selector = '[class*="' + marker + '"]';
    var elements = scope.querySelectorAll ? scope.querySelectorAll(selector) : [];

    var obs = getObserver();
    elements.forEach(function (el) {
      if (el.dataset.rmIconLoaded === '1') return;
      if (!iconNameFromElement(el)) return;
      if (obs) {
        obs.observe(el);
      } else {
        renderIcon(el);
      }
    });
  }

  function configure(opts) {
    if (!opts) return;
    if (typeof opts.prefix === 'string' && opts.prefix) config.prefix = opts.prefix;
    if (typeof opts.baseUrl === 'string' && opts.baseUrl) config.baseUrl = opts.baseUrl;
  }

  window.RMIcons = {
    configure: configure,
    scan: scan
  };

  function init() {
    scan(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
