import fs from "node:fs";
import path from "node:path";

/**
 * Read JSON file or return default.
 * @template T
 * @param {string} fp
 * @param {T} def
 * @returns {T}
 */
function readJson(fp, def) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return def;
  }
}

/**
 * Write JSON pretty.
 * @param {string} fp
 * @param {any} data
 */
function writeJson(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Update per-package versions.json and global index.json.
 *
 * @param {object} opts
 * @param {string} opts.publicDir path to gh-pages working tree
 * @param {string} opts.pkg package name (folder)
 * @param {string} opts.version version with leading "v" (e.g. "v1.2.3" or "v1.2.3-beta.1" or "v<sha12>")
 * @param {"stable"|"beta"|null} opts.channel channel for this release (null for raw sources)
 * @param {string} opts.builtAt ISO
 * @param {object|null} [opts.meta] optional package metadata
 */
export function updateIndexes({ publicDir, pkg, version, channel, builtAt, meta = null }) {
  const pkgDir = path.join(publicDir, pkg);
  const versionsFp = path.join(pkgDir, "versions.json");
  const globalFp = path.join(publicDir, "_index", "index.json");

  const versions = readJson(versionsFp, { package: pkg, versions: [] });
  const entry = { version, channel: channel ?? null, built_at: builtAt };

  // Upsert version entry
  versions.versions = versions.versions.filter((v) => v.version !== version);
  versions.versions.push(entry);

  // Sort newest first by built_at
  versions.versions.sort((a, b) => (b.built_at || "").localeCompare(a.built_at || ""));

  writeJson(versionsFp, versions);

  // Update global index
  const global = readJson(globalFp, { generated_at: builtAt, packages: {} });
  global.generated_at = builtAt;
  global.packages[pkg] = global.packages[pkg] || {};

  const lastStable = versions.versions.find((v) => v.channel === "stable") || null;
  const lastBeta = versions.versions.find((v) => v.channel === "beta") || null;
  const lastLatest = versions.versions[0] || null;

  global.packages[pkg] = {
    last_stable: lastStable,
    last_beta: lastBeta,
    last_latest: lastLatest,
    meta: meta || global.packages[pkg]?.meta || null,
  };

  writeJson(globalFp, global);
}