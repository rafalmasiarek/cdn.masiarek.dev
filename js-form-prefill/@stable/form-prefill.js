/*!
 * form-prefill.js
 *
 * Universal form prefill from:
 *   - flat GET params (highest priority)
 *   - optional base64url(JSON) payload via ?<queryPrefix>payload=...
 * plus minimal mustache-like variables in payload fields: {{var}}
 *
 * Security model:
 *   - Only fills inputs/textarea/select that declare data-prefill-key
 *   - Only fills forms that opt-in via form[data-prefill="1"]
 *   - Does NOT use innerHTML (value assignment only)
 *   - Applies per-field max lengths and global payload size limits
 *   - Default behavior is "fill only if empty" unless form enables overwrite
 *
 * Copyright (c) 2025 Rafal Masiarek
 *
 * MIT License
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.FormPrefill = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /** Default configuration */
  const DEFAULTS = {
    // Forms opt-in using: <form data-prefill="1" data-prefill-overwrite="0|1">
    formSelector: 'form[data-prefill="1"]',
    overwriteAttr: 'data-prefill-overwrite',

    // Fields opt-in using: data-prefill-key="name"
    fieldSelector: '[data-prefill-key]',
    fieldKeyAttr: 'data-prefill-key',

    // - flat params become: af_subject, af_message, ...
    // - payload becomes: af_payload
    queryPrefix: 'af_',

    // Limits
    maxPayloadParamLength: 12000, // length of base64url string (pre-decode)
    maxDecodedPayloadBytes: 16000, // decoded JSON bytes cap
    maxKeysInPayload: 50,          // avoid silly payloads
    maxVarsCount: 50,

    // Per-field length limits (adjust in init({ fieldLimits: {...} }))
    fieldLimits: {
      name: 80,
      email: 120,
      subject: 160,
      message: 8000,
    },

    // Newline handling
    normalizeNewlines: true,      // convert CRLF -> LF
    allowLiteralBackslashN: true, // treat "\n" sequences as newline

    // Behavior
    fillOnlyIfEmpty: true, // unless overwrite enabled on form
    debug: false,
  };

  /**
   * Initialize prefill for all matching forms.
   * @param {Partial<typeof DEFAULTS>} userCfg
   */
  function init(userCfg) {
    const cfg = Object.assign({}, DEFAULTS, userCfg || {});
    if (userCfg && userCfg.fieldLimits) {
      cfg.fieldLimits = Object.assign({}, DEFAULTS.fieldLimits, userCfg.fieldLimits);
    }

    // Normalize queryPrefix (allow "af" or "af_" or "")
    cfg.queryPrefix = String(cfg.queryPrefix || '');
    if (cfg.queryPrefix && !cfg.queryPrefix.endsWith('_')) cfg.queryPrefix += '_';

    const params = new URLSearchParams(window.location.search);
    const payload = readPayload(params, cfg);

    const forms = document.querySelectorAll(cfg.formSelector);
    for (const form of forms) {
      applyToForm(form, params, payload, cfg);
    }
  }

  // -------------------------
  // Core logic
  // -------------------------

  function applyToForm(form, params, payload, cfg) {
    const overwriteEnabled = (form.getAttribute(cfg.overwriteAttr) === '1');
    const fillOnlyIfEmpty = cfg.fillOnlyIfEmpty && !overwriteEnabled;

    const fields = Array.from(form.querySelectorAll(cfg.fieldSelector));
    const allowedKeys = fields
      .map((n) => n.getAttribute(cfg.fieldKeyAttr))
      .filter((v) => typeof v === 'string' && v.length > 0);

    const vars = buildVars(params, payload ? payload.vars : null, allowedKeys, cfg);

    for (const el of fields) {
      const key = el.getAttribute(cfg.fieldKeyAttr);
      if (!key) continue;

      if (fillOnlyIfEmpty) {
        const cur = String(el.value ?? '');
        if (cur.trim() !== '') continue;
      }

      let value = null;
      const qpKey = cfg.queryPrefix + key;

      // Highest priority: flat param for the field name (prefixed)
      if (params.has(qpKey)) {
        value = params.get(qpKey);
      } else if (payload && payload.fields && Object.prototype.hasOwnProperty.call(payload.fields, key)) {
        // Secondary: payload.fields[key], after applying vars
        value = applyVars(payload.fields[key], vars);
      }

      if (value === null || value === undefined) continue;

      value = normalizeText(value, cfg);

      // Optional: treat literal "\n" as newline
      if (cfg.allowLiteralBackslashN) {
        value = value.replace(/\\n/g, '\n');
      }

      // Clamp per-field
      const max = cfg.fieldLimits[key] ?? 500;
      value = clamp(value, max);

      // Assign safely
      safeAssignValue(el, value, cfg);
    }
  }

  function safeAssignValue(el, value, cfg) {
    const tag = (el.tagName || '').toLowerCase();
    const type = (el.getAttribute && el.getAttribute('type')) ? String(el.getAttribute('type')).toLowerCase() : '';

    // Do-not-touch defaults:
    if (type === 'password' || type === 'file') return;

    // Inputs, textareas, selects supported
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      el.value = value;
      return;
    }

    // Fallback: do nothing (never innerHTML)
    if (cfg.debug) console.warn('[FormPrefill] Unsupported element:', el);
  }

  // -------------------------
  // Payload reading
  // -------------------------

  function readPayload(params, cfg) {
    const payloadParam = cfg.queryPrefix + 'payload';
    if (!params.has(payloadParam)) return null;

    const raw = params.get(payloadParam) || '';
    if (raw.length === 0) return null;

    // Cap length pre-decode
    if (raw.length > cfg.maxPayloadParamLength) {
      if (cfg.debug) console.warn('[FormPrefill] payload param too long');
      return null;
    }

    const bytes = base64UrlDecodeToBytes(raw);
    if (!bytes) {
      if (cfg.debug) console.warn('[FormPrefill] invalid base64url payload');
      return null;
    }

    if (bytes.length > cfg.maxDecodedPayloadBytes) {
      if (cfg.debug) console.warn('[FormPrefill] decoded payload too large');
      return null;
    }

    const jsonText = utf8BytesToString(bytes);
    if (jsonText === null) {
      if (cfg.debug) console.warn('[FormPrefill] failed to decode UTF-8');
      return null;
    }

    let obj;
    try {
      obj = JSON.parse(jsonText);
    } catch {
      if (cfg.debug) console.warn('[FormPrefill] payload is not valid JSON');
      return null;
    }

    if (!obj || typeof obj !== 'object') return null;

    const vars = (obj.vars && typeof obj.vars === 'object' && !Array.isArray(obj.vars)) ? obj.vars : {};
    const fields = (obj.fields && typeof obj.fields === 'object' && !Array.isArray(obj.fields)) ? obj.fields : {};

    // Cap key counts
    if (Object.keys(vars).length > cfg.maxVarsCount) {
      if (cfg.debug) console.warn('[FormPrefill] too many vars in payload');
      return null;
    }
    if (Object.keys(fields).length > cfg.maxKeysInPayload) {
      if (cfg.debug) console.warn('[FormPrefill] too many fields in payload');
      return null;
    }

    return { vars, fields };
  }

  function base64UrlDecodeToBytes(b64url) {
    try {
      // Convert base64url -> base64 and add padding
      const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
      const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');

      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      return null;
    }
  }

  function utf8BytesToString(bytes) {
    try {
      if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      }
      // Fallback: best-effort (may break for non-ASCII)
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    } catch {
      return null;
    }
  }

  // -------------------------
  // Variables (mustache-like)
  // -------------------------

  /**
   * Build vars with precedence:
   * 1) payload.vars (base)
   * 2) flat field values (e.g. af_name=...) become vars too (only for allowed keys)
   */
  function buildVars(params, payloadVars, allowedKeys, cfg) {
    const out = {};

    // 1) payload.vars
    if (payloadVars && typeof payloadVars === 'object') {
      for (const [k, v] of Object.entries(payloadVars)) {
        out[String(k)] = normalizeText(v, cfg);
      }
    }

    // 2) flat field values as vars (only for allowed keys)
    for (const k of allowedKeys) {
      if (!k) continue;
      const qpKey = cfg.queryPrefix + k;
      if (params.has(qpKey)) out[k] = normalizeText(params.get(qpKey), cfg);
    }

    return out;
  }

  /**
   * Minimal mustache: replaces {{ key }} with vars[key]
   * Unknown vars become empty string.
   */
  function applyVars(template, vars) {
    return String(template ?? '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
      const val = vars[key];
      return val === null || val === undefined ? '' : String(val);
    });
  }

  // -------------------------
  // Text helpers
  // -------------------------

  function normalizeText(v, cfg) {
    let s = String(v ?? '');
    if (cfg.normalizeNewlines) s = s.replace(/\r\n/g, '\n');
    return s.trim();
  }

  function clamp(v, max) {
    v = String(v ?? '');
    return v.length > max ? v.slice(0, max) : v;
  }

  // -------------------------
  // Public API
  // -------------------------

  return {
    init,
    version: '0.1.0',
  };
});