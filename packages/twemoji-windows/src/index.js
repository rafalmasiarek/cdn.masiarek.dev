// twemoji-windows.js
/*!
 * twemoji-windows.js
 *
 * Windows-only emoji rendering fix using Twemoji.
 *
 * Replaces native emoji rendering with SVG-based Twemoji
 * for elements marked with `.d-emoji`.
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
(function () {
    'use strict';

    // Run ONLY on Windows (fix broken emoji rendering)
    if (!/Windows/i.test(navigator.userAgent)) return;

    // Twemoji JS from your CDN
    var TWEMOJI_CDN = 'https://cdn.masiarek.pl/twemoji/@latest/twemoji.min.js';

    // Base URL for Twemoji assets (SVG/PNG). Must end with "/".
    // With folder="svg" and ext=".svg", Twemoji will fetch:
    //   <base>svg/<codepoint>.svg
    var TWEMOJI_BASE = 'https://cdn.masiarek.pl/twemoji/@latest/assets/';

    function loadScriptOnce(src, cb) {
        // If already present (by src), don't load again
        var existing = document.querySelector('script[src="' + src + '"]');
        if (existing) {
            if (typeof cb === 'function') {
                if (existing.dataset.loaded === '1') cb();
                else existing.addEventListener('load', cb, { once: true });
            }
            return;
        }

        var s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.onload = function () {
            s.dataset.loaded = '1';
            if (typeof cb === 'function') cb();
        };
        s.onerror = function () {
            // Fail silently: no emoji replacement is better than breaking the page
            // console.warn('[twemoji-windows] Failed to load twemoji:', src);
        };
        document.head.appendChild(s);
    }

    function parseEmojis() {
        if (!window.twemoji || typeof window.twemoji.parse !== 'function') return;

        var nodes = document.querySelectorAll('.d-emoji');
        if (!nodes || nodes.length === 0) return;

        // Add marker class for styling / debugging
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].classList.add('win-twemoji');
        }

        // Parse only within each .d-emoji node (keeps scope tight)
        for (var j = 0; j < nodes.length; j++) {
            window.twemoji.parse(nodes[j], {
                base: TWEMOJI_BASE,
                folder: 'svg',
                ext: '.svg'
            });
        }
    }

    // Run when DOM is ready
    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    onReady(function () {
        // Load twemoji if missing, then parse
        if (!window.twemoji || typeof window.twemoji.parse !== 'function') {
            loadScriptOnce(TWEMOJI_CDN, parseEmojis);
        } else {
            parseEmojis();
        }

        // Optional: if your site injects content dynamically, this keeps it working.
        // Very light observer: only reacts to added nodes.
        try {
            var obs = new MutationObserver(function (mutations) {
                for (var i = 0; i < mutations.length; i++) {
                    if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
                        parseEmojis();
                        break;
                    }
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {
            // ignore
        }
    });
})();
