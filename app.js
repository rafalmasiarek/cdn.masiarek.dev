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

function buildCssLine(baseAbs, pkg, ver, file, integrity) {
  const href = `${baseAbs}/${pkg}/${ver}/${file}`;
  const sri = integrity ? ` integrity="${integrity}" crossorigin="anonymous"` : "";
  return `<link rel="stylesheet" href="${href}"${sri}>`;
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

function pickMainAsset(files) {
  const keys = Object.keys(files || {});
  const js =
    keys.find(n => n.endsWith(".min.js")) ||
    keys.find(n => n.endsWith(".js")) ||
    null;

  const css =
    keys.find(n => n.endsWith(".min.css")) ||
    keys.find(n => n.endsWith(".css")) ||
    null;

  if (js) return { kind: "js", file: js };
  if (css) return { kind: "css", file: css };
  return { kind: null, file: null };
}

function buildIncludeLine(kind, baseAbs, pkg, ver, file, integrity) {
  if (!kind || !file) return "";
  if (kind === "js") return buildScriptLine(baseAbs, pkg, ver, file, integrity);
  if (kind === "css") return buildCssLine(baseAbs, pkg, ver, file, integrity);
  return "";
}

function metaIconRow(icon, label, value, href) {
  if (!value) return "";
  const v = escapeHtml(value);
  const l = escapeHtml(label);
  if (href) {
    const h = escapeHtml(href);
    return `<div class="me-4 mb-2"><i class="fa-solid ${icon} me-2 text-muted"></i><span class="text-muted">${l}:</span> <a href="${h}" target="_blank" rel="noopener">${v}</a></div>`;
  }
  return `<div class="me-4 mb-2"><i class="fa-solid ${icon} me-2 text-muted"></i><span class="text-muted">${l}:</span> <span>${v}</span></div>`;
}

// Loaded once on page init
let _indexJson = null;

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

  const idx = _indexJson || (await fetchJson(`./_index/index.json`).catch(() => null));
  const pkgIndex = idx?.packages?.[pkg] || {};
  const pkgMetaFromIndex = pkgIndex?.meta || null;

  const versions = await fetchJson(`./${pkg}/versions.json`);
  const list = versions.versions || [];

  // Determine "best" pinned version to base quick-include on (prefer last_latest from index)
  const pinnedCandidate = pkgIndex?.last_latest?.version || list[0]?.version || null;

  // Quick include data (from pinnedCandidate manifest)
  let quick = { kind: null, file: null, integrityPinned: null, pinnedVer: null, meta: null };
  if (pinnedCandidate) {
    const m = await fetchJson(`./${pkg}/${pinnedCandidate}/manifest.json`).catch(() => null);
    const files = m?.files || {};
    const main = pickMainAsset(files);

    quick.kind = main.kind;
    quick.file = main.file;
    quick.integrityPinned = main.file ? files[main.file]?.integrity : null;
    quick.pinnedVer = pinnedCandidate;
    quick.meta = m?.meta || null;
  }

  const meta = quick.meta || pkgMetaFromIndex || null;

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

    <div class="d-flex flex-wrap align-items-center mt-2" id="pkgMetaRow"></div>

    <hr class="my-4"/>

    <div class="mb-4" id="pkgQuickInclude"></div>

    <div class="table-responsive">
      <table class="table table-sm align-middle">
        <thead>
          <tr>
            <th>Version</th>
            <th>Channel</th>
            <th>Built</th>
            <th>Files + SRI</th>
            <th>Pinned include</th>
          </tr>
        </thead>
        <tbody id="versionsTbody"></tbody>
      </table>
    </div>
  `;

  subtitle.textContent = `${list.length} version(s)`;

  // Analytics (best-effort)
  (async () => {
    const wrap = body.querySelector("#pkgAnalyticsWrap");
    const metaEl = body.querySelector("#pkgAnalyticsMeta");
    const hourlyCanvas = body.querySelector("#pkgHourlyChart");
    const dailyCanvas = body.querySelector("#pkgDailyChart");

    const a = await fetchJson(`./_index/analytics/${pkg}.json`).catch(() => null);
    if (!a) {
      if (wrap) wrap.style.display = "none";
      return;
    }

    if (metaEl) metaEl.textContent = `Updated: ${fmtDate(a.generated_at)} · Host: ${a.hostname || "-"}`;

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

  // Meta row (icons)
  const metaRow = body.querySelector("#pkgMetaRow");
  if (metaRow) {
    const blocks = [];
    blocks.push(metaIconRow("fa-id-card", "Name", meta?.name || null, null));
    blocks.push(metaIconRow("fa-scale-balanced", "License", meta?.license || null, null));
    blocks.push(metaIconRow("fa-user", "Author", meta?.author || null, null));
    blocks.push(metaIconRow("fa-globe", "Homepage", meta?.homepage || null, meta?.homepage || null));
    blocks.push(metaIconRow("fa-code-branch", "Source", meta?.source_url || null, meta?.source_url || null));
    blocks.push(metaIconRow("fa-book", "README", meta?.readme_url || null, meta?.readme_url || null));

    const html = blocks.filter(Boolean).join("");
    metaRow.innerHTML = html ? html : `<span class="text-muted small">No metadata available.</span>`;
  }

  // Quick include (channels) ABOVE versions list
  const quickBox = body.querySelector("#pkgQuickInclude");
  if (quickBox) {
    const kind = quick.kind;
    const file = quick.file;

    if (!kind || !file) {
      quickBox.innerHTML = `<div class="alert alert-secondary mb-0">No includable asset found (expected .js or .css in manifest files).</div>`;
    } else {
      const hasLatest = !!pkgIndex.last_latest;
      const hasStable = !!pkgIndex.last_stable;
      const hasBeta = !!pkgIndex.last_beta;

      const pinnedLine = quick.pinnedVer
        ? buildIncludeLine(kind, baseAbs, pkg, quick.pinnedVer, file, quick.integrityPinned || "")
        : "";

      const latestLine = buildIncludeLine(kind, baseAbs, pkg, "@latest", file, "");
      const stableLine = buildIncludeLine(kind, baseAbs, pkg, "@stable", file, "");
      const betaLine = buildIncludeLine(kind, baseAbs, pkg, "@beta", file, "");

      const copyMap = new Map();
      const keyPinned = `${pkg}:quick:pinned`;
      const keyLatest = `${pkg}:quick:latest`;
      const keyStable = `${pkg}:quick:stable`;
      const keyBeta = `${pkg}:quick:beta`;

      if (pinnedLine) copyMap.set(keyPinned, pinnedLine);
      if (hasLatest) copyMap.set(keyLatest, latestLine);
      if (hasStable) copyMap.set(keyStable, stableLine);
      if (hasBeta) copyMap.set(keyBeta, betaLine);

      const blocks = [];
      if (hasLatest) blocks.push(buildSnippetBlock("@latest", latestLine, keyLatest));
      if (hasStable) blocks.push(buildSnippetBlock("@stable", stableLine, keyStable));
      if (hasBeta) blocks.push(buildSnippetBlock("@beta", betaLine, keyBeta));

      quickBox.innerHTML = `
        <div class="d-flex align-items-center justify-content-between">
          <div>
            <span class="text-muted ms-2">${escapeHtml(kind.toUpperCase())}: <code>${escapeHtml(file)}</code></span>
          </div>
        </div>
      `;

      wireCopyButtons(quickBox, copyMap);
    }
  }

  // Versions rows (ONLY pinned per version; hide pinned block if empty)
  const tbody = body.querySelector("#versionsTbody");
  for (const v of list) {
    const ver = v.version; // includes leading "v"
    const manifest = await fetchJson(`./${pkg}/${ver}/manifest.json`).catch(() => null);
    const files = manifest?.files || {};
    const main = pickMainAsset(files);

    const integrity = main.file ? files[main.file]?.integrity : null;

    const filesHtml = manifest
      ? `<div class="small">
          ${Object.entries(files).map(([name, meta2]) => `
            <div class="mb-2">
              <div><code>${escapeHtml(name)}</code> <span class="text-muted ms-2">${meta2.bytes ?? ""} bytes</span></div>
              <div class="text-muted text-break"><small>${escapeHtml(meta2.integrity ?? "")}</small></div>
            </div>
          `).join("")}
        </div>`
      : `<span class="text-muted">manifest missing</span>`;

    const pinnedSnippet = (main.kind && main.file)
      ? buildIncludeLine(main.kind, baseAbs, pkg, ver, main.file, integrity || "")
      : "";

    const badge =
      v.channel === "stable" ? "text-bg-success" :
        v.channel === "beta" ? "text-bg-warning" :
          "text-bg-secondary";

    const copyMap = new Map();
    const keyPinned = `${pkg}:${ver}:pinned`;
    if (pinnedSnippet) copyMap.set(keyPinned, pinnedSnippet);

    const pinnedHtml = pinnedSnippet
      ? buildSnippetBlock("Pinned (with SRI)", pinnedSnippet, keyPinned)
      : `<span class="text-muted small">-</span>`;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${escapeHtml(ver)}</code></td>
      <td>${v.channel ? `<span class="badge ${badge}">${escapeHtml(v.channel)}</span>` : ""}</td>
      <td>${fmtDate(v.built_at)}</td>
      <td style="min-width:320px">${filesHtml}</td>
      <td style="min-width:360px">${pinnedHtml}</td>
    `;
    tbody.appendChild(row);

    if (pinnedSnippet) wireCopyButtons(row, copyMap);
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

  for (const item of slice) {
    const { pkg, meta } = item;

    const stable = meta.last_stable;
    const beta = meta.last_beta;
    const latest = meta.last_latest;

    const updated = latest?.built_at || stable?.built_at || beta?.built_at;

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td><strong>${escapeHtml(pkg)}</strong></td>
      <td>${versionCell(stable)}</td>
      <td>${versionCell(beta)}</td>
      <td>${versionCell(latest)}</td>
      <td>${fmtDate(updated)}</td>
    `;
    tr.addEventListener("click", () => renderDetailsInModal(pkg));
    tbody.appendChild(tr);
  }

  document.getElementById("resultsMeta").textContent = `${total} result(s)`;
  document.getElementById("pageInfo").textContent = `Page ${_page} / ${pages}`;

  document.getElementById("prevPage").disabled = _page <= 1;
  document.getElementById("nextPage").disabled = _page >= pages;
}

(async () => {
  try { await tryRenderGlobalAnalytics(); } catch { }

  _indexJson = await fetchJson(`./_index/index.json`);
  document.getElementById("generatedAt").textContent = `Generated: ${fmtDate(_indexJson.generated_at)}`;

  _allPackages = Object.entries(_indexJson.packages || {})
    .map(([pkg, meta]) => ({ pkg, meta }))
    .sort((a, b) => a.pkg.localeCompare(b.pkg));

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