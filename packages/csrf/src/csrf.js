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

  /**
   * @param {object} [options]
   * @param {string} [options.apiBase='https://masiarek.pl/api'] Prefix before "/v1/csrf/...".
   * @param {string} [options.container='default'] Sent as the X-CSRF-Container header.
   * @param {(err: Error, info: {operation: string}) => void} [options.onError] Called for
   *        a genuine failure (bad JSON, a thrown error while handling it, or the module
   *        reporting a non-success status). A fetch() that never got a response at all
   *        (offline, a dropped connection) throws a plain TypeError before any response
   *        exists to read — that case is never reported here: the next poll/attempt
   *        recovers on its own, and at any real traffic volume it's non-actionable noise.
   * @param {number} [options.ttlThresholdSeconds=30] startAutoRefresh() regenerates once
   *        the token's remaining TTL drops below this.
   * @param {number} [options.pollIntervalMs=10000] How often startAutoRefresh() checks
   *        the TTL.
   */
  function Csrf(options) {
    options = options || {};
    this.endpoints = endpoints(options.apiBase || 'https://masiarek.pl/api');
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
    // 'include' (not 'same-origin'): the default apiBase is cross-origin for
    // most consumers, and the session cookie carrying the CSRF state must
    // travel with it either way. Behaves exactly like 'same-origin' for the
    // same-origin case.
    return fetch(url, {
      method: 'GET',
      headers: { 'X-CSRF-Container': this.container },
      credentials: 'include'
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

  /** Begins polling checkExpiry(); auto-calls regenerate() once the TTL drops below the configured threshold. */
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
   * Convenience: keep a token input (and optional proof input) in sync with every
   * subsequent generate()/regenerate() call. Applies immediately if a token is
   * already held.
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
