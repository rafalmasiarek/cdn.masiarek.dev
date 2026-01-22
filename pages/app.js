async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toISOString().replace("T", " ").replace("Z", " UTC");
}

function versionCell(v) {
  if (!v) return `<span class="text-muted">-</span>`;
  return `<code>${v.version}</code>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCdnBaseUrl() {
  return window.location.origin;
}

function buildScriptLine(baseAbs, pkg, ver, file, integrity) {
  const src = `${baseAbs}/${pkg}/${ver}/${file}`;
  const sri = integrity ? ` integrity="${integrity}" crossorigin="anonymous"` : "";
  return `<script src="${src}"${sri} defer></script>`;
}

/**
 * Clipboard helper
 */
async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const old = btn.textContent;
      btn.textContent = "Copied!";
      btn.disabled = true;
      setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 900);
    }
  } catch (e) {
    alert("Copy failed (browser permissions).");
  }
}

/**
 * Chart helpers
 */
const _charts = new Map();

function destroyChart(key) {
  const ch = _charts.get(key);
  if (ch) {
    try { ch.destroy(); } catch { }
    _charts.delete(key);
  }
}

function makeLineChart(canvas, labels, data, title) {
  if (!window.Chart) return null;
  return new Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ label: title, data, tension: 0.25, pointRadius: 0 }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true }, tooltip: { mode: "index", intersect: false } },
      scales: { x: { ticks: { maxTicksLimit: 10 } }, y: { beginAtZero: true } }
    }
  });
}

function makeBarChart(canvas, labels, data, title) {
  if (!window.Chart) return null;
  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: [{ label: title, data }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true }, tooltip: { mode: "index", intersect: false } },
      scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { beginAtZero: true } }
    }
  });
}

function seriesToChart(series, mode) {
  const labels = (series || []).map(p => {
    const d = new Date(p.t);
    if (mode === "hourly") {
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      return `${mm}-${dd} ${hh}:00`;
    }
    return d.toISOString().slice(0, 10);
  });
  const data = (series || []).map(p => Number(p.count || 0));
  return { labels, data };
}

async function tryRenderGlobalAnalytics() {
  const card = document.getElementById("globalAnalyticsCard");
  const meta = document.getElementById("globalAnalyticsMeta");
  const canvas = document.getElementById("globalHourlyChart");
  if (!card || !canvas) return;

  const json = await fetchJson(`./_index/analytics/global.json`).catch(() => null);
  if (!json?.hourly?.length) {
    card.style.display = "none";
    return;
  }

  card.style.display = "";
  meta.textContent = `Updated: ${fmtDate(json.generated_at)} · Host: ${json.hostname || "-"}`;

  destroyChart("globalHourly");
  const { labels, data } = seriesToChart(json.hourly, "hourly");
  const ch = makeLineChart(canvas, labels, data, "Requests (hourly)");
  if (ch) _charts.set("globalHourly", ch);
}

/**
 * Modal helpers
 */
function modalEls() {
  return {
    modal: document.getElementById("pkgModal"),
    title: document.getElementById("pkgModalTitle"),
    subtitle: document.getElementById("pkgModalSubtitle"),
    body: document.getElementById("pkgModalBody"),
  };
}

function showModal() {
  const { modal } = modalEls();
  const inst = bootstrap.Modal.getOrCreateInstance(modal);
  inst.show();
}

function buildSnippetBlock(title, codeText, copyKey) {
  const safe = escapeHtml(codeText);
  return `
    <div class="mb-3">
      <div class="d-flex align-items-center justify-content-between">
        <strong>${escapeHtml(title)}</strong>
        <button class="btn btn-sm btn-outline-primary copy-btn" data-copy-key="${escapeHtml(copyKey)}">Copy</button>
      </div>
      <pre class="mb-0 mt-2"><code>${safe}</code></pre>
    </div>
  `;
}

function wireCopyButtons(container, map) {
  container.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const key = btn.getAttribute("data-copy-key");
      const text = map.get(key) || "";
      await copyToClipboard(text, btn);
    });
  });
}

/**
 * Render package details INTO modal (popup).
 */
async function renderDetailsInModal(pkg) {
  const baseAbs = getCdnBaseUrl();
  const { title, subtitle, body } = modalEls();

  title.textContent = pkg;
  subtitle.textContent = "Loading…";
  body.innerHTML = `<div class="alert alert-secondary mb-0">Loading package details…</div>`;
  showModal();

  const versions = await fetchJson(`./${pkg}/versions.json`);
  const list = versions.versions || [];

  // Modal shell with analytics charts + versions table
  body.innerHTML = `
    <div class="mb-4" id="pkgAnalyticsWrap">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <div>
          <strong>Downloads</strong>
          <span class="text-muted ms-2">hourly (72h) + daily (90d)</span>
        </div>
        <span class="text-muted small" id="pkgAnalyticsMeta"></span>
      </div>

      <div class="row g-3">
        <div class="col-12 col-lg-6">
          <div class="card border-0 bg-light">
            <div class="card-body">
              <canvas id="pkgHourlyChart" height="130"></canvas>
            </div>
          </div>
        </div>
        <div class="col-12 col-lg-6">
          <div class="card border-0 bg-light">
            <div class="card-body">
              <canvas id="pkgDailyChart" height="130"></canvas>
            </div>
          </div>
        </div>
      </div>
      <div class="text-muted small mt-2">
        Requests are sourced from Cloudflare analytics. Pinned versions + SRI remain the recommended security mode.
      </div>
    </div>

    <hr class="my-4"/>

    <div class="table-responsive">
      <table class="table table-sm align-middle">
        <thead>
          <tr>
            <th>Version</th>
            <th>Channel</th>
            <th>Built</th>
            <th>Files + SRI</th>
            <th>Copy-paste</th>
          </tr>
        </thead>
        <tbody id="versionsTbody"></tbody>
      </table>
    </div>
  `;

  subtitle.textContent = `${list.length} version(s)`;

  // Render analytics (best-effort)
  (async () => {
    const wrap = body.querySelector("#pkgAnalyticsWrap");
    const meta = body.querySelector("#pkgAnalyticsMeta");
    const hourlyCanvas = body.querySelector("#pkgHourlyChart");
    const dailyCanvas = body.querySelector("#pkgDailyChart");

    const a = await fetchJson(`./_index/analytics/${pkg}.json`).catch(() => null);
    if (!a) {
      if (wrap) wrap.style.display = "none";
      return;
    }

    if (meta) meta.textContent = `Updated: ${fmtDate(a.generated_at)} · Host: ${a.hostname || "-"}`;

    destroyChart(`pkgHourly:${pkg}`);
    destroyChart(`pkgDaily:${pkg}`);

    if (hourlyCanvas && a.hourly?.length) {
      const { labels, data } = seriesToChart(a.hourly, "hourly");
      const ch = makeLineChart(hourlyCanvas, labels, data, "Requests (hourly)");
      if (ch) _charts.set(`pkgHourly:${pkg}`, ch);
    }

    if (dailyCanvas && a.daily?.length) {
      const { labels, data } = seriesToChart(a.daily, "daily");
      const ch = makeBarChart(dailyCanvas, labels, data, "Requests (daily)");
      if (ch) _charts.set(`pkgDaily:${pkg}`, ch);
    }
  })();

  // Render versions rows
  const tbody = body.querySelector("#versionsTbody");

  for (const v of list) {
    const ver = v.version; // includes leading "v"
    const manifest = await fetchJson(`./${pkg}/${ver}/manifest.json`).catch(() => null);
    const files = manifest?.files || {};
    const mainJs =
      Object.keys(files).find(n => n.endsWith(".min.js")) ||
      Object.keys(files).find(n => n.endsWith(".js"));

    const integrity = mainJs ? files[mainJs]?.integrity : null;

    const filesHtml = manifest
      ? `<div class="small">
          ${Object.entries(files).map(([name, meta]) => `
            <div class="mb-2">
              <div><code>${escapeHtml(name)}</code> <span class="text-muted ms-2">${meta.bytes ?? ""} bytes</span></div>
              <div class="text-muted text-break"><small>${escapeHtml(meta.integrity ?? "")}</small></div>
            </div>
          `).join("")}
        </div>`
      : `<span class="text-muted">manifest missing</span>`;

    const pinnedSnippet = mainJs ? buildScriptLine(baseAbs, pkg, ver, mainJs, integrity) : "";
    const stableSnippet = mainJs ? buildScriptLine(baseAbs, pkg, "@stable", mainJs, "") : "";
    const betaSnippet = mainJs ? buildScriptLine(baseAbs, pkg, "@beta", mainJs, "") : "";
    const latestSnippet = mainJs ? buildScriptLine(baseAbs, pkg, "@latest", mainJs, "") : "";

    const badge = v.channel === "stable" ? "text-bg-success" : "text-bg-warning";

    // Copy-map (unique per row)
    const copyMap = new Map();
    const keyPinned = `${pkg}:${ver}:pinned`;
    const keyStable = `${pkg}:${ver}:stable`;
    const keyBeta = `${pkg}:${ver}:beta`;
    const keyLatest = `${pkg}:${ver}:latest`;

    copyMap.set(keyPinned, pinnedSnippet);
    copyMap.set(keyStable, stableSnippet);
    copyMap.set(keyBeta, betaSnippet);
    copyMap.set(keyLatest, latestSnippet);

    const snippetsHtml = `
      ${buildSnippetBlock("Pinned (with SRI)", pinnedSnippet, keyPinned)}
      ${buildSnippetBlock("@stable", stableSnippet, keyStable)}
      ${buildSnippetBlock("@beta", betaSnippet, keyBeta)}
      ${buildSnippetBlock("@latest", latestSnippet, keyLatest)}
      <div class="text-muted small mt-1">SRI is stable only for pinned versions (channels move).</div>
    `;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${escapeHtml(ver)}</code></td>
      <td><span class="badge ${badge}">${escapeHtml(v.channel)}</span></td>
      <td>${fmtDate(v.built_at)}</td>
      <td style="min-width:320px">${filesHtml}</td>
      <td style="min-width:360px">${snippetsHtml}</td>
    `;
    tbody.appendChild(row);

    wireCopyButtons(row, copyMap);
  }
}

let _allPackages = [];
let _filtered = [];
let _page = 1;

function applyFilterAndRender() {
  const search = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  const size = Number(document.getElementById("pageSize").value || 20);

  _filtered = _allPackages.filter(({ pkg }) => pkg.toLowerCase().includes(search));

  const total = _filtered.length;
  const pages = Math.max(1, Math.ceil(total / size));
  _page = Math.min(_page, pages);
  _page = Math.max(_page, 1);

  const start = (_page - 1) * size;
  const slice = _filtered.slice(start, start + size);

  const tbody = document.querySelector("#pkgTable tbody");
  tbody.innerHTML = "";

  const baseAbs = getCdnBaseUrl();

  for (const item of slice) {
    const { pkg, meta } = item;

    const stable = meta.last_stable;
    const beta = meta.last_beta;
    const latest = meta.last_latest;

    const updated = latest?.built_at || stable?.built_at || beta?.built_at;

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(pkg)}</strong>
      </td>
      <td>${versionCell(stable)}</td>
      <td>${versionCell(beta)}</td>
      <td>${versionCell(latest)}</td>
      <td>${fmtDate(updated)}</td>
    `;
    tr.addEventListener("click", () => renderDetailsInModal(pkg));
    tbody.appendChild(tr);
  }

  // UI meta
  document.getElementById("resultsMeta").textContent = `${total} result(s)`;
  document.getElementById("pageInfo").textContent = `Page ${_page} / ${pages}`;

  document.getElementById("prevPage").disabled = _page <= 1;
  document.getElementById("nextPage").disabled = _page >= pages;
}

(async () => {
  // Global analytics chart (best-effort)
  try { await tryRenderGlobalAnalytics(); } catch { }

  const idx = await fetchJson(`./_index/index.json`);
  document.getElementById("generatedAt").textContent = `Generated: ${fmtDate(idx.generated_at)}`;

  // Prepare data model for search + pagination
  _allPackages = Object.entries(idx.packages || {})
    .map(([pkg, meta]) => ({ pkg, meta }))
    .sort((a, b) => a.pkg.localeCompare(b.pkg));

  // Wire controls
  document.getElementById("searchInput").addEventListener("input", () => {
    _page = 1;
    applyFilterAndRender();
  });

  document.getElementById("pageSize").addEventListener("change", () => {
    _page = 1;
    applyFilterAndRender();
  });

  document.getElementById("prevPage").addEventListener("click", () => {
    _page -= 1;
    applyFilterAndRender();
  });

  document.getElementById("nextPage").addEventListener("click", () => {
    _page += 1;
    applyFilterAndRender();
  });

  applyFilterAndRender();
})().catch(err => {
  const details = document.getElementById("details");
  details.style.display = "";
  details.innerHTML = `<div class="alert alert-danger">Failed to load index: ${escapeHtml(err.message)}</div>`;
});