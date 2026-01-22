## Honest, GDPR-compliant consent manager for privacy-friendly analytics.

I care deeply about my privacy online. I want to live in a world where my data is collected and processed honestly, transparently, and respectfully. I built this project for my own websites to ensure I treat visitors the same way I want to be treated: with clarity and consent first.  
If it helps you too, then maybe this project can be a small brick in building a better, more trustworthy internet.

**Universal GDPR/ePrivacy/CNIL-friendly analytics loader** with consent banner, i18n, modern async loading, and privacy-first defaults.  

---

### ✨ Features

- **Asynchronous & non-blocking** — GA/Matomo/Umami/Hotjar load via `async` / `defer`.
- **Consent-first** — full tracking only after explicit consent; Google uses Consent Mode v2 (`consent-only` or `preload`).
- **GPC / DNT respected** — Global Privacy Control and Do-Not-Track signals automatically deny analytics.
- **Privacy-by-design** — no cookies until consent, secure defaults (`SameSite=Lax`, HTTPS only).
- **Granularity (optional)** — parametric per-category consent (analytics / marketing / personalization).  
  → Disabled by default (`granular: false`).
- **Matomo native consent API** — uses `requireConsent`, `rememberConsentGiven`, `forgetConsentGiven`.
- **Umami no-preload mode** — avoids anonymous-then-full reload mismatch.
- **Hotjar conditional loading** — only enabled when `marketing` or `personalization` consent is granted.
- **GPC/DNT auto-deny** — if user enables either, banner hides and all optional tools stay off.
- **CSP-safe** — supports `nonce` and `integrity` attributes for strict CSP setups.
- **CDN ready** — can be served directly via jsDelivr or GitHub Pages.
- **i18n built-in** — English and Polish translations included (extensible).
- **MIT licensed** — fully open-source, privacy-first.

---

## 🚀 Quick start (CDN)

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/rafalmasiarek/js-fair-consent@v1.4.3/dist/js-fair-consent.css">
<script defer src="https://cdn.jsdelivr.net/gh/rafalmasiarek/js-fair-consent@v1.4.3/dist/js-fair-consent.js"></script>

<div class="consent-banner">
  <div class="container">
    <div>
      <h4 class="consent-title" data-i18n-key="title">Cookies & Analytics</h4>
      <p class="consent-text" data-i18n-key="body">We use essential cookies and privacy-friendly analytics. With consent, we enable additional tools.</p>
    </div>
    <div class="consent-actions">
      <button class="consent-btn" id="btnDeny"><span data-i18n-key="deny">Deny</span></button>
      <button class="consent-btn primary" id="btnAccept"><span data-i18n-key="accept">Accept</span></button>
    </div>
  </div>
</div>

<script>
  ConsentAnalytics.init({
    locale: 'en',
    services: {
      google: { enabled: true, gtagId: 'G-XXXXXXX', mode: 'consent-only' },
      umami:  { enabled: true, websiteId: 'YOUR-UMAMI-ID', src: 'https://umami.is/a/script.js' },
      matomo: { enabled: false },
      hotjar: { enabled: false }
    }
  });
</script>
```

---

## ⚙️ Configuration

```js
ConsentAnalytics.init({
  debug: false,        // enable console logging
  locale: 'en',        // force language
  granular: false,     // toggle granular consent
  categories: {        // used only if granular === true
    analytics: 1,
    marketing: 0,
    personalization: 0
  },
  services: {
    google: {
      enabled: true,
      gtagId: 'G-XXXXXXX',
      mode: 'consent-only' // or 'preload' or 'disabled'
    },
    matomo: {
      enabled: false,
      url: 'https://matomo.example.com/',
      siteId: '1'
    },
    umami: {
      enabled: true,
      websiteId: 'YOUR-UMAMI-ID',
      src: 'https://umami.is/a/script.js'
    },
    hotjar: {
      enabled: false,
      hjid: 0,
      hjsv: 7
    }
  }
});
```

---

### 🔧 Granular consent

By default, Consent Analytics uses a **single binary consent cookie** (`allowCookies=1/0`).

To enable **per-category preferences** (analytics / marketing / personalization):

```js
ConsentAnalytics.init({
  granular: true,
  categories: {
    analytics: 1,
    marketing: 0,
    personalization: 0
  }
});
```

When enabled:
- The cookie value becomes JSON (e.g. `{"analytics":1,"marketing":0,"personalization":0}`)
- Services are activated only when their related category is allowed:
  - Google: granted if any category is `1`
  - Matomo / Umami: only if `analytics` = `1`
  - Hotjar: if `marketing` or `personalization` = `1`

---

## 🧱 Public API

```js
ConsentAnalytics.hasConsent();      // → boolean
ConsentAnalytics.readPrefs();       // → { analytics, marketing, personalization }
ConsentAnalytics.writePrefs({...}); // save preferences
ConsentAnalytics.revokeConsent();   // forget consent and show banner again
ConsentAnalytics.trackPageView();   // manual SPA pageview tracking
```

---

## 🔒 Privacy & Legal References

- GDPR: https://gdpr-info.eu/
- ePrivacy Directive: https://eur-lex.europa.eu/eli/dir/2002/58/oj
- EDPB: https://www.edpb.europa.eu/
- CNIL Guidelines: https://www.cnil.fr/
- Google Consent Mode v2: https://support.google.com/analytics/answer/13802165
- Umami GDPR: https://umami.is/blog/gdpr-compliant-website-analytics
- Matomo + CNIL: https://matomo.org/blog/

---

## 🌐 GitHub & CDN

- GitHub: [https://github.com/rafalmasiarek/js-fair-consent//github.com/rafalmasiarek/consent-analytics)
- CDN:  
  `https://cdn.jsdelivr.net/gh/rafalmasiarek/js-fair-consent@v1.4.3/dist/js-fair-consent.js`

---

## 📄 License

MIT © [Rafał Masiarek](https://github.com/rafalmasiarek)
