// Sync externals into gh-pages working tree
//
// Supported source types:
//  - github-release-asset: uses /releases/latest only
//  - github-raw-file: uses raw file pinned by commit SHA
//  - github-release-assets-semver:
//      * If releases exist: uses /releases/latest as @latest (GitHub "latest" semantics)
//      * Additionally, can publish stable/beta channels based on semver + prerelease
//      * If no releases: falls back to highest semver tag (from /tags)
//
// Output:
//  public/<pkg>/v<version>/... + manifest.json
//  public/<pkg>/@latest/...
//  public/<pkg>/@stable/...
//  public/<pkg>/@beta/...
//
// Also updates:
//  public/<pkg>/versions.json
//  public/_index/index.json
//  public/_index/external-state.json
//  public/_index/bundle-manifest.json
//
// NOTE: All comments/log messages are in English per preference.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import semver from "semver";
import { updateIndexes } from "./update-index.mjs";
import { buildBundleManifest } from "./build-bundle-manifest.mjs";

function readJson(fp, def) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return def; }
}
function writeJson(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + "\n", "utf8");
}
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function sriSha384(buf) {
  const hash = crypto.createHash("sha384").update(buf).digest("base64");
  return `sha384-${hash}`;
}

function httpGetJson(url, headers = {}) {
  const hdrArgs = Object.entries(headers).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
  const cmd = ["curl", "-fsSL", ...hdrArgs, url].map((x) => JSON.stringify(x)).join(" ");
  const out = execSync(cmd, { encoding: "utf8" });
  return JSON.parse(out);
}

function httpDownload(url, outPath, headers = {}) {
  mkdirp(path.dirname(outPath));
  const hdrArgs = Object.entries(headers).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
  const cmd = ["curl", "-fsSL", ...hdrArgs, url, "-o", outPath].map((x) => JSON.stringify(x)).join(" ");
  execSync(cmd, { stdio: "inherit" });
}

function detectChannelFromVersion(v) {
  return v.includes("-") ? "beta" : "stable";
}

function stripV(tag) {
  return String(tag || "").replace(/^v/i, "");
}

function ghAuthHeaders() {
  // Optional: improves rate limits when running from Actions
  const tok = process.env.GITHUB_TOKEN || "";
  if (!tok) return { "Accept": "application/vnd.github+json" };
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${tok}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Publish one external version into gh-pages working tree.
 *
 * @param {object} opts
 * @param {string} opts.publicDir
 * @param {string} opts.pkg
 * @param {string} opts.version version without leading "v" (e.g. "1.2.3" or "1.2.3-beta.1")
 * @param {"stable"|"beta"} opts.channel
 * @param {string} opts.builtAt ISO
 * @param {object|null} opts.upstream upstream metadata
 * @param {Array<{localPath:string, outName?:string}>} opts.files
 * @param {object|null} opts.meta optional package metadata to embed in manifest
 * @param {("latest"|"stable"|"beta"|"none")} opts.updatePointer which pointer to update
 */
function publishExternal({ publicDir, pkg, version, channel, builtAt, upstream, files, meta, updatePointer }) {
  const pkgDir = path.join(publicDir, pkg);
  const versionDir = path.join(pkgDir, `v${version}`);
  const latestDir = path.join(pkgDir, "@latest");
  const stableDir = path.join(pkgDir, "@stable");
  const betaDir = path.join(pkgDir, "@beta");

  mkdirp(versionDir);
  mkdirp(latestDir);
  mkdirp(stableDir);
  mkdirp(betaDir);

  // Write immutable version
  rmrf(versionDir);
  mkdirp(versionDir);

  const manifestFiles = {};
  for (const f of files) {
    const name = f.outName || path.basename(f.localPath);
    const buf = fs.readFileSync(f.localPath);
    fs.writeFileSync(path.join(versionDir, name), buf);
    manifestFiles[name] = { integrity: sriSha384(buf), bytes: buf.length };
  }

  const manifest = {
    package: pkg,
    version: `v${version}`,
    channel,
    built_at: builtAt,
    commit: null,
    upstream: upstream || null,
    meta: meta || null, // { name, description, homepage, license, author, source_url, readme_url }
    files: manifestFiles,
  };

  writeJson(path.join(versionDir, "manifest.json"), manifest);

  // Update pointers based on updatePointer
  function syncPointer(dir) {
    rmrf(dir); mkdirp(dir);
    for (const name of Object.keys(manifestFiles)) {
      fs.copyFileSync(path.join(versionDir, name), path.join(dir, name));
    }
    writeJson(path.join(dir, "manifest.json"), manifest);
  }

  if (updatePointer === "latest") syncPointer(latestDir);
  if (updatePointer === "stable") syncPointer(stableDir);
  if (updatePointer === "beta") syncPointer(betaDir);
}

/**
 * Download GitHub release assets matching regex.
 * Optionally unpack zip assets and pick files from inside zip via "extract".
 *
 * @param {object} opts
 * @param {string} opts.repo "owner/name"
 * @param {object} opts.release GitHub release JSON
 * @param {string} opts.assetRegex regex string
 * @param {Array<{zip_asset_regex?:string, file_regex:string, out_name?:string}>} [opts.extract]
 * @param {string} opts.tmpDir
 * @returns {Array<{localPath:string, outName?:string}>}
 */
function downloadReleaseAssets({ repo, release, assetRegex, extract, tmpDir }) {
  const re = new RegExp(assetRegex);
  const assets = (release.assets || []).filter((a) => re.test(a.name));
  if (!assets.length) return [];

  rmrf(tmpDir); mkdirp(tmpDir);

  const out = [];
  const headers = ghAuthHeaders();

  for (const a of assets) {
    const assetPath = path.join(tmpDir, a.name);
    httpDownload(a.browser_download_url, assetPath, headers);

    // If extract is configured and asset is a zip (or matches zip_asset_regex), extract selected files
    const isZip = a.name.toLowerCase().endsWith(".zip");
    if (extract && extract.length && isZip) {
      for (const rule of extract) {
        if (rule.zip_asset_regex) {
          const zre = new RegExp(rule.zip_asset_regex);
          if (!zre.test(a.name)) continue;
        }
        const fre = new RegExp(rule.file_regex);

        // List zip contents and extract matching entries
        const list = execSync(`unzip -Z1 ${JSON.stringify(assetPath)}`, { encoding: "utf8" })
          .split("\n").map((s) => s.trim()).filter(Boolean);

        const matches = list.filter((p) => fre.test(p));
        for (const inside of matches) {
          const outName = rule.out_name || path.basename(inside);
          const extractedPath = path.join(tmpDir, `extracted__${outName}`);
          execSync(`unzip -p ${JSON.stringify(assetPath)} ${JSON.stringify(inside)} > ${JSON.stringify(extractedPath)}`);
          out.push({ localPath: extractedPath, outName });
        }
      }
    } else {
      out.push({ localPath: assetPath });
    }
  }

  // If extract produced outputs, prefer them (ignore raw zip blobs)
  const extracted = out.filter((x) => (x.outName || "").startsWith("") && path.basename(x.localPath).startsWith("extracted__"));
  if (extract && extract.length && extracted.length) return extracted;

  // Otherwise return downloaded assets as-is
  return out;
}

/**
 * Choose @latest release via GitHub /releases/latest.
 * If it doesn't exist, return null.
 */
function getLatestRelease(repo) {
  try {
    return httpGetJson(`https://api.github.com/repos/${repo}/releases/latest`, ghAuthHeaders());
  } catch {
    return null;
  }
}

/**
 * Get a list of recent releases (non-draft). Used to find stable/beta latest.
 */
function getReleases(repo, perPage = 30) {
  const rels = httpGetJson(`https://api.github.com/repos/${repo}/releases?per_page=${perPage}`, ghAuthHeaders());
  return (rels || []).filter((r) => r && !r.draft);
}

/**
 * If there are no releases, use tags and pick highest semver.
 */
function getHighestSemverTag(repo, perPage = 100) {
  const tags = httpGetJson(`https://api.github.com/repos/${repo}/tags?per_page=${perPage}`, ghAuthHeaders());
  const names = (tags || []).map((t) => t.name).filter(Boolean);

  const versions = names
    .map((t) => ({ tag: t, v: semver.coerce(stripV(t))?.version || null }))
    .filter((x) => x.v && semver.valid(x.v));

  if (!versions.length) return null;

  versions.sort((a, b) => semver.rcompare(a.v, b.v));
  return versions[0].tag;
}

function normalizeUpstreamTagToVersion(tag) {
  // turn "v1.2.3" -> "1.2.3"
  return stripV(tag);
}

const ROOT = process.cwd();
const publicDir = path.join(ROOT, "public");
const cfg = readJson(path.join(ROOT, "external-sources.json"), { sources: [] });
const stateFp = path.join(publicDir, "_index", "external-state.json");
const state = readJson(stateFp, {});

const builtAt = new Date().toISOString().replace(".000Z", "Z");
let changed = false;

for (const src of cfg.sources || []) {
  const pkg = src.package;
  if (!pkg) continue;

  // -----------------------------
  // github-release-assets-semver
  // -----------------------------
  if (src.type === "github-release-assets-semver") {
    const repo = src.repo;
    if (!repo) continue;

    // 1) Determine @latest
    let latest = getLatestRelease(repo);
    let latestTag = latest?.tag_name || latest?.name || null;

    // 2) If no releases/latest, fallback to highest semver tag
    if (!latestTag) {
      const topTag = getHighestSemverTag(repo);
      if (!topTag) continue;
      latestTag = topTag;

      // Fake a "release-like" object so downstream can download raw tag assets (not possible).
      // Therefore, if no releases exist, you MUST use github-raw-file sources instead.
      // We keep this fallback only to compute channel pointers/versions.json, but assets must be raw.
      // If you want "no releases" support, define src.fallback_raw_files.
    }

    const latestVersion = normalizeUpstreamTagToVersion(latestTag);
    const latestKey = `${repo}@latest:${latestTag}`;

    const prevLatestKey = state[pkg]?.latest_key;
    const needLatest = prevLatestKey !== latestKey;

    // Determine stable/beta "latest"
    const releases = getReleases(repo, src.releases_per_page || 30);
    const parsed = releases
      .map((r) => {
        const t = r.tag_name || r.name || "";
        const v = semver.coerce(stripV(t))?.version || null;
        return { r, tag: t, v, prerelease: !!(r.prerelease || (v && semver.prerelease(v))) };
      })
      .filter((x) => x.v && semver.valid(x.v));

    const stable = parsed.filter((x) => !x.prerelease).sort((a, b) => semver.rcompare(a.v, b.v))[0] || null;
    const beta = parsed.filter((x) => x.prerelease).sort((a, b) => semver.rcompare(a.v, b.v))[0] || null;

    const stableTag = stable?.tag || null;
    const betaTag = beta?.tag || null;

    const stableKey = stableTag ? `${repo}@stable:${stableTag}` : null;
    const betaKey = betaTag ? `${repo}@beta:${betaTag}` : null;

    const needStable = stableKey && state[pkg]?.stable_key !== stableKey;
    const needBeta = betaKey && state[pkg]?.beta_key !== betaKey;

    // If nothing changed, skip.
    if (!needLatest && !needStable && !needBeta) continue;

    // Download/publish helper
    function publishFromRelease(releaseObj, pointerName) {
      const tag = releaseObj.tag_name || releaseObj.name;
      const version = normalizeUpstreamTagToVersion(tag);
      const channel = detectChannelFromVersion(version);

      const tmpDir = path.join(ROOT, ".tmp", "external", pkg, `${pointerName}__${stripV(tag)}`);
      const files = downloadReleaseAssets({
        repo,
        release: releaseObj,
        assetRegex: src.asset_regex,
        extract: src.extract || [],
        tmpDir,
      });
      if (!files.length) return false;

      publishExternal({
        publicDir,
        pkg,
        version,
        channel,
        builtAt,
        upstream: {
          type: "github-release",
          repo,
          tag,
          release_html_url: releaseObj.html_url || null,
        },
        meta: src.meta || null,
        files,
        updatePointer: pointerName, // "latest" | "stable" | "beta"
      });

      updateIndexes({
        publicDir,
        pkg,
        version: `v${version}`,
        channel,
        builtAt,
        meta: src.meta || null,
      });

      return { tag, version, channel };
    }

    // Publish @latest (must be a real release object)
    if (needLatest) {
      if (!latest || !latest.tag_name) {
        // No releases/latest => cannot fetch assets from "tags" with this mode.
        // Use github-raw-file for such repos.
        console.log(`[external:${pkg}] No GitHub releases available for ${repo}. Use github-raw-file instead.`);
      } else {
        const ok = publishFromRelease(latest, "latest");
        if (ok) {
          state[pkg] = state[pkg] || {};
          state[pkg].latest_key = latestKey;
          state[pkg].last_upstream_tag = latest.tag_name;
          changed = true;
        }
      }
    }

    // Publish @stable
    if (needStable && stable?.r) {
      const ok = publishFromRelease(stable.r, "stable");
      if (ok) {
        state[pkg] = state[pkg] || {};
        state[pkg].stable_key = stableKey;
        state[pkg].last_upstream_stable_tag = stableTag;
        changed = true;
      }
    }

    // Publish @beta
    if (needBeta && beta?.r) {
      const ok = publishFromRelease(beta.r, "beta");
      if (ok) {
        state[pkg] = state[pkg] || {};
        state[pkg].beta_key = betaKey;
        state[pkg].last_upstream_beta_tag = betaTag;
        changed = true;
      }
    }
  }

  // -----------------------------
  // github-release-asset
  // -----------------------------
  if (src.type === "github-release-asset") {
    const rel = httpGetJson(`https://api.github.com/repos/${src.repo}/releases/latest`, ghAuthHeaders());
    const tag = rel.tag_name || rel.name;
    if (!tag) continue;

    const prev = state[pkg]?.last_upstream_tag;
    if (prev === tag) continue;

    const tmpDir = path.join(ROOT, ".tmp", "external", pkg, tag);
    const files = downloadReleaseAssets({
      repo: src.repo,
      release: rel,
      assetRegex: src.asset_regex,
      extract: src.extract || [],
      tmpDir,
    });
    if (!files.length) continue;

    const version = String(tag).replace(/^v/i, "");
    const channel = src.channel || detectChannelFromVersion(version);

    publishExternal({
      publicDir,
      pkg,
      version,
      channel,
      builtAt,
      upstream: {
        type: "github-release",
        repo: src.repo,
        tag,
        release_html_url: rel.html_url,
      },
      meta: src.meta || null,
      files,
      updatePointer: "latest", // legacy mode: update @latest only
    });

    updateIndexes({
      publicDir,
      pkg,
      version: `v${version}`,
      channel,
      builtAt,
      meta: src.meta || null,
    });

    state[pkg] = { ...(state[pkg] || {}), last_upstream_tag: tag };
    changed = true;
  }

  // -----------------------------
  // github-raw-file
  // -----------------------------
  if (src.type === "github-raw-file") {
    const ref = src.ref || "main";
    const refInfo = httpGetJson(`https://api.github.com/repos/${src.repo}/commits/${encodeURIComponent(ref)}`);
    const sha = refInfo.sha;
    if (!sha) continue;

    const prev = state[pkg]?.last_commit;
    if (prev === sha) continue;

    // Accept:
    // - src.path: "dist/file.js"
    // - src.paths: ["dist/a.js", "dist/b.js"]
    // - src.files: [{ path: "dist/a.js", out_name: "a.js" }, ...]
    let toFetch = [];

    if (Array.isArray(src.files) && src.files.length) {
      toFetch = src.files
        .filter(x => x && typeof x.path === "string" && x.path.length)
        .map(x => ({ path: x.path, outName: x.out_name || null }));
    } else if (Array.isArray(src.paths) && src.paths.length) {
      toFetch = src.paths
        .filter(p => typeof p === "string" && p.length)
        .map(p => ({ path: p, outName: null }));
    } else if (typeof src.path === "string" && src.path.length) {
      toFetch = [{ path: src.path, outName: null }];
    }

    if (!toFetch.length) continue;

    const tmpDir = path.join(ROOT, ".tmp", "external", pkg, sha.slice(0, 12));
    rmrf(tmpDir); mkdirp(tmpDir);

    const downloaded = [];
    for (const f of toFetch) {
      const rawUrl = `https://raw.githubusercontent.com/${src.repo}/${sha}/${f.path}`;
      const outName = f.outName || path.basename(f.path);
      const outPath = path.join(tmpDir, outName);

      httpDownload(rawUrl, outPath);
      downloaded.push({ localPath: outPath, outName });
    }

    // Commit-based versioning is immutable and safe.
    const version = `0.0.0-${sha.slice(0, 12)}`;
    const channel = src.channel || "beta";

    publishExternal({
      publicDir,
      pkg,
      version,
      channel,
      builtAt,
      upstream: {
        type: "github-raw",
        repo: src.repo,
        ref,
        commit: sha,
        paths: toFetch.map(x => x.path),
      },
      files: downloaded
    });

    updateIndexes({
      publicDir,
      pkg,
      version: `v${version}`,
      channel,
      builtAt
    });

    state[pkg] = { last_commit: sha, last_upstream_ref: ref };
    changed = true;
  }
}

if (changed) {
  // Keep UI files updated on scheduled sync as well.
  for (const f of ["index.html", "app.js", "styles.css"]) {
    const srcFp = path.join(ROOT, "pages", f);
    const dstFp = path.join(publicDir, f);
    if (fs.existsSync(srcFp)) fs.copyFileSync(srcFp, dstFp);
  }

  writeJson(stateFp, state);

  buildBundleManifest({
    publicDir,
    baseUrl: process.env.CDN_BASE_URL || "",
    builtAt,
  });
}