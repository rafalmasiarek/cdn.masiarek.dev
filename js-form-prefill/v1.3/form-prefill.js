var FormPrefill = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/form-prefill.js
  var require_form_prefill = __commonJS({
    "src/form-prefill.js"(exports, module) {
      (function(root, factory) {
        if (typeof module === "object" && typeof module.exports === "object") {
          module.exports = factory();
        } else {
          root.FormPrefill = factory();
        }
      })(typeof window !== "undefined" ? window : globalThis, function() {
        "use strict";
        const DEFAULTS = {
          // Forms opt-in using: <form data-prefill="1" data-prefill-overwrite="0|1">
          formSelector: 'form[data-prefill="1"]',
          overwriteAttr: "data-prefill-overwrite",
          // Fields opt-in using: data-prefill-key="name"
          fieldSelector: "[data-prefill-key]",
          fieldKeyAttr: "data-prefill-key",
          // - flat params become: af_subject, af_message, ...
          // - payload becomes: af_payload
          queryPrefix: "af_",
          // Limits
          maxPayloadParamLength: 12e3,
          // length of base64url string (pre-decode)
          maxDecodedPayloadBytes: 16e3,
          // decoded JSON bytes cap
          maxKeysInPayload: 50,
          // avoid silly payloads
          maxVarsCount: 50,
          // Per-field length limits (adjust in init({ fieldLimits: {...} }))
          fieldLimits: {
            name: 80,
            email: 120,
            subject: 160,
            message: 8e3
          },
          // Newline handling
          normalizeNewlines: true,
          // convert CRLF -> LF
          allowLiteralBackslashN: true,
          // treat "\n" sequences as newline
          // Behavior
          fillOnlyIfEmpty: true,
          // unless overwrite enabled on form
          debug: false
        };
        function init(userCfg) {
          const cfg = Object.assign({}, DEFAULTS, userCfg || {});
          if (userCfg && userCfg.fieldLimits) {
            cfg.fieldLimits = Object.assign({}, DEFAULTS.fieldLimits, userCfg.fieldLimits);
          }
          cfg.queryPrefix = String(cfg.queryPrefix || "");
          if (cfg.queryPrefix && !cfg.queryPrefix.endsWith("_")) cfg.queryPrefix += "_";
          const params = new URLSearchParams(window.location.search);
          const payload = readPayload(params, cfg);
          const forms = document.querySelectorAll(cfg.formSelector);
          for (const form of forms) {
            applyToForm(form, params, payload, cfg);
          }
        }
        function applyToForm(form, params, payload, cfg) {
          const overwriteEnabled = form.getAttribute(cfg.overwriteAttr) === "1";
          const fillOnlyIfEmpty = cfg.fillOnlyIfEmpty && !overwriteEnabled;
          const fields = Array.from(form.querySelectorAll(cfg.fieldSelector));
          const allowedKeys = fields.map((n) => n.getAttribute(cfg.fieldKeyAttr)).filter((v) => typeof v === "string" && v.length > 0);
          const vars = buildVars(params, payload ? payload.vars : null, allowedKeys, cfg);
          for (const el of fields) {
            const key = el.getAttribute(cfg.fieldKeyAttr);
            if (!key) continue;
            if (fillOnlyIfEmpty) {
              const cur = String(el.value ?? "");
              if (cur.trim() !== "") continue;
            }
            let value = null;
            const qpKey = cfg.queryPrefix + key;
            if (params.has(qpKey)) {
              value = params.get(qpKey);
            } else if (payload && payload.fields && Object.prototype.hasOwnProperty.call(payload.fields, key)) {
              value = applyVars(payload.fields[key], vars);
            }
            if (value === null || value === void 0) continue;
            value = normalizeText(value, cfg);
            if (cfg.allowLiteralBackslashN) {
              value = value.replace(/\\n/g, "\n");
            }
            const max = cfg.fieldLimits[key] ?? 500;
            value = clamp(value, max);
            safeAssignValue(el, value, cfg);
          }
        }
        function safeAssignValue(el, value, cfg) {
          const tag = (el.tagName || "").toLowerCase();
          const type = el.getAttribute && el.getAttribute("type") ? String(el.getAttribute("type")).toLowerCase() : "";
          if (type === "password" || type === "file") return;
          if (tag === "input" || tag === "textarea" || tag === "select") {
            el.value = value;
            return;
          }
          if (cfg.debug) console.warn("[FormPrefill] Unsupported element:", el);
        }
        function readPayload(params, cfg) {
          const payloadParam = cfg.queryPrefix + "payload";
          if (!params.has(payloadParam)) return null;
          const raw = params.get(payloadParam) || "";
          if (raw.length === 0) return null;
          if (raw.length > cfg.maxPayloadParamLength) {
            if (cfg.debug) console.warn("[FormPrefill] payload param too long");
            return null;
          }
          const bytes = base64UrlDecodeToBytes(raw);
          if (!bytes) {
            if (cfg.debug) console.warn("[FormPrefill] invalid base64url payload");
            return null;
          }
          if (bytes.length > cfg.maxDecodedPayloadBytes) {
            if (cfg.debug) console.warn("[FormPrefill] decoded payload too large");
            return null;
          }
          const jsonText = utf8BytesToString(bytes);
          if (jsonText === null) {
            if (cfg.debug) console.warn("[FormPrefill] failed to decode UTF-8");
            return null;
          }
          let obj;
          try {
            obj = JSON.parse(jsonText);
          } catch {
            if (cfg.debug) console.warn("[FormPrefill] payload is not valid JSON");
            return null;
          }
          if (!obj || typeof obj !== "object") return null;
          const vars = obj.vars && typeof obj.vars === "object" && !Array.isArray(obj.vars) ? obj.vars : {};
          const fields = obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields) ? obj.fields : {};
          if (Object.keys(vars).length > cfg.maxVarsCount) {
            if (cfg.debug) console.warn("[FormPrefill] too many vars in payload");
            return null;
          }
          if (Object.keys(fields).length > cfg.maxKeysInPayload) {
            if (cfg.debug) console.warn("[FormPrefill] too many fields in payload");
            return null;
          }
          return { vars, fields };
        }
        function base64UrlDecodeToBytes(b64url) {
          try {
            const pad = "=".repeat((4 - b64url.length % 4) % 4);
            const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
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
            if (typeof TextDecoder !== "undefined") {
              return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
            }
            let s = "";
            for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
            return s;
          } catch {
            return null;
          }
        }
        function buildVars(params, payloadVars, allowedKeys, cfg) {
          const out = {};
          if (payloadVars && typeof payloadVars === "object") {
            for (const [k, v] of Object.entries(payloadVars)) {
              out[String(k)] = normalizeText(v, cfg);
            }
          }
          for (const k of allowedKeys) {
            if (!k) continue;
            const qpKey = cfg.queryPrefix + k;
            if (params.has(qpKey)) out[k] = normalizeText(params.get(qpKey), cfg);
          }
          return out;
        }
        function applyVars(template, vars) {
          return String(template ?? "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
            const val = vars[key];
            return val === null || val === void 0 ? "" : String(val);
          });
        }
        function normalizeText(v, cfg) {
          let s = String(v ?? "");
          if (cfg.normalizeNewlines) s = s.replace(/\r\n/g, "\n");
          return s.trim();
        }
        function clamp(v, max) {
          v = String(v ?? "");
          return v.length > max ? v.slice(0, max) : v;
        }
        return {
          init,
          version: "0.1.0"
        };
      });
    }
  });
  return require_form_prefill();
})();
