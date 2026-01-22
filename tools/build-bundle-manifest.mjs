import fs from "node:fs";
import path from "node:path";

function readJson(fp, def) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return def; }
}
function writeJson(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Build a single bundle manifest for the entire CDN.
 *
 * @param {object} opts
 * @param {string} opts.publicDir gh-pages working tree
 * @param {string} opts.baseUrl optional absolute base URL (e.g. https://cdn.example.com)
 * @param {string} opts.builtAt ISO date
 */
export function buildBundleManifest({ publicDir, baseUrl, builtAt }) {
  const globalIndexFp = path.join(publicDir, "_index", "index.json");
  const globalIndex = readJson(globalIndexFp, { packages: {} });

  const out = {
    generated_at: builtAt,
    base_url: baseUrl || "",
    packages: {}
  };

  for (const pkg of Object.keys(globalIndex.packages || {})) {
    const pkgDir = path.join(publicDir, pkg);
    const versionsFp = path.join(pkgDir, "versions.json");
    const versions = readJson(versionsFp, { versions: [] }).versions || [];

    const channels = globalIndex.packages[pkg] || {};
    const pkgOut = { channels, versions: {} };

    for (const v of versions) {
      const ver = v.version; // "v1.2.3"
      const manifestFp = path.join(pkgDir, ver, "manifest.json");
      const manifest = readJson(manifestFp, null);
      if (!manifest) continue;

      const files = {};
      for (const [name, meta] of Object.entries(manifest.files || {})) {
        files[name] = {
          url: `/${pkg}/${ver}/${name}`,
          integrity: meta.integrity || null,
          bytes: meta.bytes ?? null
        };
      }

      pkgOut.versions[ver] = {
        channel: manifest.channel || v.channel || null,
        built_at: manifest.built_at || v.built_at || null,
        commit: manifest.commit || null,
        upstream: manifest.upstream || null,
        files
      };
    }

    out.packages[pkg] = pkgOut;
  }

  writeJson(path.join(publicDir, "_index", "bundle-manifest.json"), out);
}
