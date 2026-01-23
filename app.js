// app.js
async function fetchJson(url) {
  async function fetchJson(url) {
    const u = new URL(url, window.location.href);

    if (u.pathname.endsWith(".json")) {
      u.searchParams.set("ts", Date.now().toString());
    }

    const res = await fetch(u.toString(), {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${u.toString()}`);
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

  function buildIncludeLine(kind, baseAbs, pkg, ver, file, integrity) {
    if (!kind || !file) return "";
    if (kind === "js") return buildScriptLine(baseAbs, pkg, ver, file, integrity);
    if (kind === "css") return buildCssLine(baseAbs, pkg, ver, file, integrity);
    return "";
  }

  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);

      if (!btn) return;

      const oldTitle = btn.getAttribute("title");
      const oldAria = btn.getAttribute("aria-label");

      btn.disabled = true;
      btn.classList.add("copied");
      btn.setAttribute("title", "Copied!");
      btn.setAttribute("aria-label", "Copied!");

      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove("copied");

        if (oldTitle !== null) btn.setAttribute("title", oldTitle);
        else btn.removeAttribute("title");

        if (oldAria !== null) btn.setAttribute("aria-label", oldAria);
        else btn.removeAttribute("aria-label");
      }, 900);
    } catch {
      alert("Copy failed (browser permissions).");
    }
  }

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
    if (meta) meta.textContent = "";

    destroyChart("globalHourly");
    const { labels, data } = seriesToChart(json.hourly, "hourly");
    const ch = makeLineChart(canvas, labels, data, "Requests (hourly)");
    if (ch) _charts.set("globalHourly", ch);
  }

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

  function buildSnippetBlock(title, codeText, copyKey) {
    const safe = escapeHtml(codeText);
    return `
    <div class="snippet-block-center">
      <h3 class="snippet-title">${escapeHtml(title)}</h3>
        <button class="btn btn-sm btn-outline-primary copy-btn code-copy"
                data-copy-key="${escapeHtml(copyKey)}" aria-label="Copy">
          <i class="fa-solid fa-clipboard"></i>
        </button>
        <code>${safe}</code>
    </div>
  `;
  }

  function buildFilesMiniTableHtml(baseAbs, pkg, ver, entries, copyMap, copyKeyPrefix) {
    if (!entries.length) return `<span class="text-muted">-</span>`;

    const filtered = entries
      .filter(([name]) => name.endsWith(".css") || name.endsWith(".js"))
      .sort((a, b) => a[0].localeCompare(b[0]));

    const blocks = filtered.map(([name, meta2], idx) => {
      const bytes = Number(meta2?.bytes ?? 0);
      const integrity = meta2?.integrity ?? "";

      let snippet = "";
      if (name.endsWith(".css")) snippet = buildCssLine(baseAbs, pkg, ver, name, integrity);
      else if (name.endsWith(".js")) snippet = buildScriptLine(baseAbs, pkg, ver, name, integrity);

      const k = `${copyKeyPrefix}:${idx}`;
      if (snippet) copyMap.set(k, snippet);

      const sizeBadge = bytes
        ? `<span class="badge text-bg-light ms-2">${escapeHtml(String(bytes))} B</span>`
        : "";

      const sriHtml = integrity
        ? `<div class="file-meta file-sri">${escapeHtml(String(integrity))}</div>`
        : "";

      const codeHtml = snippet
        ? `
        <div class="code-box mt-2">
          <button class="btn btn-sm btn-outline-primary copy-btn code-copy"
                  data-copy-key="${escapeHtml(k)}" aria-label="Copy">
            <i class="fa-solid fa-clipboard"></i>
          </button>
          <code>${escapeHtml(snippet)}</code>
        </div>
      `
        : `<div class="text-muted small mt-2">—</div>`;

      return `
      <div class="file-block">
        <div class="file-head">
          <a class="file-link" href="${escapeHtml(`${baseAbs}/${pkg}/${ver}/${name}`)}"
             target="_blank" rel="noopener">${escapeHtml(name)}</a>
          ${sizeBadge}
        </div>
        ${sriHtml}
        ${codeHtml}
      </div>
    `;
    }).join("");

    return `<div class="files-stack">${blocks}</div>`;
  }

  let _indexJson = null;

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

    const pinnedCandidate = pkgIndex?.last_latest?.version || list[0]?.version || null;

    let quick = { jsFile: null, cssFile: null, pinnedVer: null, meta: null };
    if (pinnedCandidate) {
      const m = await fetchJson(`./${pkg}/${pinnedCandidate}/manifest.json`).catch(() => null);
      const files = m?.files || {};
      const keys = Object.keys(files);

      quick.jsFile = keys.find(n => n.endsWith(".min.js")) || keys.find(n => n.endsWith(".js")) || null;
      quick.cssFile = keys.find(n => n.endsWith(".min.css")) || keys.find(n => n.endsWith(".css")) || null;
      quick.pinnedVer = pinnedCandidate;
      quick.meta = m?.meta || null;
    }

    const meta = quick.meta || pkgMetaFromIndex || null;

    body.innerHTML = `
    <div class="mb-4" id="pkgAnalyticsWrap" style="display:none;">
      <ul class="nav nav-pills mb-2" id="pkgAnalyticsTabs"></ul>
      <div class="card border-0 bg-light">
        <div class="card-body">
          <div class="tab-content">
            <div class="tab-pane fade show active" id="pkgTabHourly" role="tabpanel">
              <canvas id="pkgHourlyChart" height="130"></canvas>
            </div>
            <div class="tab-pane fade" id="pkgTabDaily" role="tabpanel">
              <canvas id="pkgDailyChart" height="130"></canvas>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="d-flex flex-wrap align-items-center mt-2" id="pkgMetaRow"></div>
    <div class="mb-4" id="pkgQuickInclude"></div>

    <div class="table-responsive">
      <table class="table table-sm align-middle pkg-versions-table">
        <colgroup>
          <col style="width:15%">
          <col style="width:10%">
          <col style="width:20%">
          <col style="width:55%">
        </colgroup>
        <thead>
          <tr>
            <th>Version</th>
            <th>Channel</th>
            <th>Built</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody id="versionsTbody"></tbody>
      </table>
    </div>
  `;

    subtitle.textContent = `${list.length} version(s)`;

    // Analytics
    (async () => {
      const wrap = body.querySelector("#pkgAnalyticsWrap");
      const tabs = body.querySelector("#pkgAnalyticsTabs");
      const hourlyPane = body.querySelector("#pkgTabHourly");
      const dailyPane = body.querySelector("#pkgTabDaily");
      const hourlyCanvas = body.querySelector("#pkgHourlyChart");
      const dailyCanvas = body.querySelector("#pkgDailyChart");

      const a = await fetchJson(`./_index/analytics/${pkg}.json`).catch(() => null);
      const hasHourly = !!a?.hourly?.length;
      const hasDaily = !!a?.daily?.length;

      if (!wrap || !hourlyPane || !dailyPane) return;

      if (!hasHourly && !hasDaily) {
        wrap.style.display = "none";
        return;
      }

      wrap.style.display = "";

      const showTabs = hasHourly && hasDaily;
      if (tabs) {
        tabs.style.display = showTabs ? "" : "none";
        tabs.innerHTML = showTabs ? `
        <li class="nav-item">
          <button class="nav-link active" data-bs-toggle="pill" data-bs-target="#pkgTabHourly" type="button">Hourly</button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-bs-toggle="pill" data-bs-target="#pkgTabDaily" type="button">Daily</button>
        </li>
      ` : "";
      }

      if (!showTabs) {
        hourlyPane.style.display = hasHourly ? "" : "none";
        dailyPane.style.display = hasDaily ? "" : "none";
        hourlyPane.classList.toggle("show", hasHourly);
        hourlyPane.classList.toggle("active", hasHourly);
        dailyPane.classList.toggle("show", hasDaily);
        dailyPane.classList.toggle("active", hasDaily);
      } else {
        hourlyPane.style.display = "";
        dailyPane.style.display = "";
        hourlyPane.classList.add("show", "active");
        dailyPane.classList.remove("show", "active");
      }

      destroyChart(`pkgHourly:${pkg}`);
      destroyChart(`pkgDaily:${pkg}`);

      if (hasHourly && hourlyCanvas) {
        const { labels, data } = seriesToChart(a.hourly, "hourly");
        const ch = makeLineChart(hourlyCanvas, labels, data, "Requests (hourly)");
        if (ch) _charts.set(`pkgHourly:${pkg}`, ch);
      }

      if (hasDaily && dailyCanvas) {
        const { labels, data } = seriesToChart(a.daily, "daily");
        const ch = makeBarChart(dailyCanvas, labels, data, "Requests (daily)");
        if (ch) _charts.set(`pkgDaily:${pkg}`, ch);
      }
    })();

    // Meta row
    const metaRow = body.querySelector("#pkgMetaRow");
    if (metaRow) {
      const blocks = [];
      blocks.push(metaIconRow("fa-id-card", "Name", meta?.name || null, null));
      blocks.push(metaIconRow("fa-scale-balanced", "License", meta?.license || null, null));
      blocks.push(metaIconRow("fa-user", "Author", meta?.author || null, null));
      blocks.push(metaIconRow("fa-globe", "Homepage", meta?.homepage || null, meta?.homepage || null));
      blocks.push(metaIconRow("fa-code-branch", "Source", meta?.source_url || null, meta?.source_url || null));
      blocks.push(metaIconRow("fa-book", "README", meta?.readme_url || null, meta?.readme_url || null));
      metaRow.innerHTML = blocks.filter(Boolean).join("") || "";
    }

    // Quick include accordion
    const quickBox = body.querySelector("#pkgQuickInclude");
    if (quickBox) {
      const hasLatest = !!pkgIndex.last_latest;
      const hasStable = !!pkgIndex.last_stable;
      const hasBeta = !!pkgIndex.last_beta;

      const copyMap = new Map();
      const items = [];

      const addItem = (fileLabel, kind, file) => {
        if (!file) return;

        const accId = `acc_${pkg}_${fileLabel}`.replaceAll(".", "_").replaceAll("/", "_");
        const collapseId = `col_${accId}`;

        const rows = [];

        const pushRow = (verTag) => {
          const line = buildIncludeLine(kind, baseAbs, pkg, verTag, file, "");
          if (!line) return;
          const k = `${pkg}:quick:${fileLabel}:${verTag}`;
          copyMap.set(k, line);
          rows.push(buildSnippetBlock(verTag, line, k));
        };

        if (hasLatest) pushRow("@latest");
        if (hasStable) pushRow("@stable");
        if (hasBeta) pushRow("@beta");
        if (!rows.length) return;

        items.push(`
        <div class="accordion-item">
          <h2 class="accordion-header" id="h_${accId}">
            <button class="accordion-button collapsed" type="button"
                    data-bs-toggle="collapse" data-bs-target="#${collapseId}">
              ${escapeHtml(file)}
            </button>
          </h2>
          <div id="${collapseId}" class="accordion-collapse collapse" data-bs-parent="#pkgQuickAccordion">
            <div class="accordion-body">
              ${rows.join("")}
            </div>
          </div>
        </div>
      `);
      };

      addItem("CSS", "css", quick.cssFile);
      addItem("JS", "js", quick.jsFile);

      if (!items.length) {
        quickBox.innerHTML = "";
      } else {
        quickBox.innerHTML = `<div class="accordion" id="pkgQuickAccordion">${items.join("")}</div>`;
        wireCopyButtons(quickBox, copyMap);
      }
    }

    // Versions rows (THIS WAS MISSING)
    const tbody = body.querySelector("#versionsTbody");
    if (tbody) {
      for (const v of list) {
        const ver = v.version;

        const manifest = await fetchJson(`./${pkg}/${ver}/manifest.json`).catch(() => null);
        const files = manifest?.files || {};
        const entries = Object.entries(files);

        const cssEntries = entries.filter(([n]) => n.endsWith(".css")).sort((a, b) => a[0].localeCompare(b[0]));
        const jsEntries = entries.filter(([n]) => n.endsWith(".js")).sort((a, b) => a[0].localeCompare(b[0]));
        const otherEntries = entries
          .filter(([n]) => !n.endsWith(".css") && !n.endsWith(".js"))
          .sort((a, b) => a[0].localeCompare(b[0]));
        const ordered = [...cssEntries, ...jsEntries, ...otherEntries];

        const copyMap = new Map();
        const filesHtml = manifest
          ? buildFilesMiniTableHtml(baseAbs, pkg, ver, ordered, copyMap, `${pkg}:${ver}:file`)
          : `<span class="text-muted">manifest missing</span>`;

        const badge =
          v.channel === "stable" ? "text-bg-success" :
            v.channel === "beta" ? "text-bg-warning" :
              "text-bg-secondary";

        const row = document.createElement("tr");
        row.classList.add("align-middle");
        row.innerHTML = `
        <td class="align-middle"><code>${escapeHtml(ver)}</code></td>
        <td class="align-middle">${v.channel ? `<span class="badge ${badge}">${escapeHtml(v.channel)}</span>` : ""}</td>
        <td class="align-middle">${fmtDate(v.built_at)}</td>
        <td class="align-middle">${filesHtml}</td>
      `;
        tbody.appendChild(row);

        wireCopyButtons(row, copyMap);
      }
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
      tr.classList.add("align-middle");
      tr.innerHTML = `
      <td class="align-middle"><strong>${escapeHtml(pkg)}</strong></td>
      <td class="align-middle">${versionCell(stable)}</td>
      <td class="align-middle">${versionCell(beta)}</td>
      <td class="align-middle">${versionCell(latest)}</td>
      <td class="align-middle">${fmtDate(updated)}</td>
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