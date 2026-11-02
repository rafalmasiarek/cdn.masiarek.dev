(function () {
  'use strict';

  function endpoints(apiBase) {
    return {
      generate: apiBase + '/v1/csrf/generate',
      regenerate: apiBase + '/v1/csrf/regenerate',
      expiry: apiBase + '/v1/csrf/token-expiry'
    };
  }

  function defaultOnError(err, info) {
    console.error('[csrf] ' + info.operation, err);
  }

  function resolveCredentials(apiBase) {
    try {
      return new URL(apiBase, window.location.href).origin === window.location.origin
        ? 'same-origin'
        : 'include';
    } catch (e) {
      return 'same-origin';
    }
  }

  /**
   * @param {object} [options]
   * @param {string} [options.apiBase='https://masiarek.pl/api'] Prefix before "/v1/csrf/...".
   * @param {string} [options.container='default'] Sent as the X-CSRF-Container header.
   * @param {(err: Error, info: {operation: string}) => void} [options.onError] Called on a
   *        genuine failure. A dropped-connection TypeError is never reported here.
   * @param {number} [options.ttlThresholdSeconds=30] startAutoRefresh() regenerates once
   *        the token's remaining TTL drops below this.
   * @param {number} [options.pollIntervalMs=10000] How often startAutoRefresh() checks
   *        the TTL.
   */
  function Csrf(options) {
    options = options || {};
    var apiBase = options.apiBase || 'https://masiarek.pl/api';
    this.endpoints = endpoints(apiBase);
    this.credentials = resolveCredentials(apiBase);
    this.container = options.container || 'default';
    this.onError = options.onError || defaultOnError;
    this.ttlThresholdSeconds = typeof options.ttlThresholdSeconds === 'number' ? options.ttlThresholdSeconds : 30;
    this.pollIntervalMs = typeof options.pollIntervalMs === 'number' ? options.pollIntervalMs : 10000;

    this._token = null;
    this._proof = null;
    this._onUpdate = null;
    this._pollTimer = null;
  }

  Csrf.prototype._get = function (url) {
    return fetch(url, {
      method: 'GET',
      headers: { 'X-CSRF-Container': this.container },
      credentials: this.credentials
    });
  };

  Csrf.prototype._report = function (err, operation) {
    if (err instanceof TypeError) {
      console.warn('[csrf] ' + operation + ' network error (likely transient):', err);
      return;
    }
    this.onError(err, { operation: operation });
  };

  Csrf.prototype._apply = function (json) {
    if (json && json.status === 'success' && json.data && json.data.csrf_token) {
      this._token = json.data.csrf_token;
      this._proof = json.data.proof || null;
      if (this._onUpdate) this._onUpdate(this._token, this._proof);
      return true;
    }
    return false;
  };

  /** @return {Promise<{token: string|null, proof: string|null}>} */
  Csrf.prototype.generate = function () {
    var self = this;
    return this._get(this.endpoints.generate)
      .then(function (res) { return res.json(); })
      .then(function (json) { self._apply(json); })
      .catch(function (err) { self._report(err, 'csrf-generate'); })
      .then(function () { return { token: self._token, proof: self._proof }; });
  };

  /** @return {Promise<{token: string|null, proof: string|null}>} */
  Csrf.prototype.regenerate = function () {
    var self = this;
    return this._get(this.endpoints.regenerate)
      .then(function (res) { return res.json(); })
      .then(function (json) { self._apply(json); })
      .catch(function (err) { self._report(err, 'csrf-regenerate'); })
      .then(function () { return { token: self._token, proof: self._proof }; });
  };

  /** @return {Promise<number|null>} Seconds remaining, or null on failure/no active token. */
  Csrf.prototype.checkExpiry = function () {
    var self = this;
    return this._get(this.endpoints.expiry)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        return (json && json.status === 'success' && typeof json.data?.ttl === 'number') ? json.data.ttl : null;
      })
      .catch(function (err) { self._report(err, 'csrf-expiry-check'); return null; });
  };

  /** Polls checkExpiry(); regenerates once the TTL drops below the configured threshold. */
  Csrf.prototype.startAutoRefresh = function () {
    if (this._pollTimer) return;
    var self = this;
    this._pollTimer = setInterval(function () {
      self.checkExpiry().then(function (ttl) {
        if (typeof ttl === 'number' && ttl < self.ttlThresholdSeconds) {
          return self.regenerate();
        }
      });
    }, this.pollIntervalMs);
  };

  Csrf.prototype.stopAutoRefresh = function () {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  };

  Csrf.prototype.getToken = function () { return this._token; };
  Csrf.prototype.getProof = function () { return this._proof; };

  /**
   * Keeps a token input (and optional proof input) in sync with generate()/regenerate().
   * @param {{value: string}} tokenEl
   * @param {{value: string}|null} [proofEl]
   */
  Csrf.prototype.bind = function (tokenEl, proofEl) {
    this._onUpdate = function (token, proof) {
      if (tokenEl) tokenEl.value = token || '';
      if (proofEl) proofEl.value = proof || '';
    };
    if (this._token !== null) this._onUpdate(this._token, this._proof);
  };

  window.Csrf = Csrf;
})();
