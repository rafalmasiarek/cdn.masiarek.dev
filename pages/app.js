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

function buildScriptLine(base, pkg, ver, file, integrity) {
  const src = `${base}/${pkg}/${ver}/${file}`;
  const sri = integrity ? ` integrity="${integrity}" crossorigin="anonymous"` : "";
  return `<script src="${src}"${sri} defer></script>`;
}

async function renderDetails(base, pkg) {
  const root = document.getElementById("details");
  root.innerHTML = "";

  const versions = await fetchJson(`${base}/${pkg}/versions.json`);
  const list = versions.versions || [];

  const card = document.createElement("div");
  card.className = "card shadow-sm";
  card.innerHTML = `
    <div class="card-header d-flex align-items-center justify-content-between">
      <div>
        <strong>${pkg}</strong>
        <span class="text-muted ms-2">all versions</span>
      </div>
      <a class="btn btn-sm btn-outline-secondary" href="#top" onclick="window.scrollTo({top:0,behavior:'smooth'});return false;">Back to top</a>
    </div>
    <div class="card-body">
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
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  const tbody = card.querySelector("tbody");

  for (const v of list) {
    const ver = v.version; // includes leading "v"
    const manifest = await fetchJson(`${base}/${pkg}/${ver}/manifest.json`).catch(() => null);
    const files = manifest?.files || {};
    const mainJs = Object.keys(files).find(n => n.endsWith(".min.js")) || Object.keys(files).find(n => n.endsWith(".js"));
    const integrity = mainJs ? files[mainJs]?.integrity : null;

    const filesHtml = manifest
      ? `<div class="small">
          ${Object.entries(files).map(([name, meta]) => `
            <div class="mb-2">
              <div><code>${name}</code> <span class="text-muted ms-2">${meta.bytes ?? ""} bytes</span></div>
              <div class="text-muted text-break"><small>${meta.integrity ?? ""}</small></div>
            </div>
          `).join("")}
        </div>`
      : `<span class="text-muted">manifest missing</span>`;

    const pinnedSnippet = mainJs
      ? buildScriptLine(base, pkg, ver, mainJs, integrity)
      : "";

    const stableSnippet = mainJs ? buildScriptLine(base, pkg, "@stable", mainJs, "") : "";
    const betaSnippet = mainJs ? buildScriptLine(base, pkg, "@beta", mainJs, "") : "";
    const latestSnippet = mainJs ? buildScriptLine(base, pkg, "@latest", mainJs, "") : "";

    const badge = v.channel === "stable" ? "text-bg-success" : "text-bg-warning";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${ver}</code></td>
      <td><span class="badge ${badge}">${v.channel}</span></td>
      <td>${fmtDate(v.built_at)}</td>
      <td style="min-width:320px">${filesHtml}</td>
      <td style="min-width:320px">
        <div class="mb-2"><strong>Pinned (with SRI)</strong><pre class="mb-0"><code>${escapeHtml(pinnedSnippet)}</code></pre></div>
        <div><strong>@stable</strong><pre class="mb-0"><code>${escapeHtml(stableSnippet)}</code></pre></div>
        <div><strong>@beta</strong><pre class="mb-0"><code>${escapeHtml(betaSnippet)}</code></pre></div>
        <div><strong>@latest</strong><pre class="mb-0"><code>${escapeHtml(latestSnippet)}</code></pre></div>
        <div class="text-muted small mt-1">SRI is stable only for pinned versions (channels move).</div>
      </td>
    `;
    tbody.appendChild(row);
  }

  root.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

(async () => {
  const base = ".";

  const idx = await fetchJson(`${base}/_index/index.json`);
  document.getElementById("generatedAt").textContent = `Generated: ${fmtDate(idx.generated_at)}`;

  const tbody = document.querySelector("#pkgTable tbody");
  tbody.innerHTML = "";

  const pkgs = Object.entries(idx.packages || {}).sort(([a], [b]) => a.localeCompare(b));

  for (const [pkg, meta] of pkgs) {
    const stable = meta.last_stable;
    const beta = meta.last_beta;
    const latest = meta.last_latest;

    const updated = latest?.built_at || stable?.built_at || beta?.built_at;

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.innerHTML = `
      <td><strong>${pkg}</strong><div class="text-muted small">${base}/${pkg}/</div></td>
      <td>${versionCell(stable)}</td>
      <td>${versionCell(beta)}</td>
      <td>${versionCell(latest)}</td>
      <td>${fmtDate(updated)}</td>
    `;
    tr.addEventListener("click", () => renderDetails(base, pkg));
    tbody.appendChild(tr);
  }
})().catch(err => {
  const details = document.getElementById("details");
  details.innerHTML = `<div class="alert alert-danger">Failed to load index: ${escapeHtml(err.message)}</div>`;
});
