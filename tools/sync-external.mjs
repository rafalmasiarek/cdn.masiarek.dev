import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
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

function httpGetJson(url) {
  const out = execSync(`curl -fsSL ${JSON.stringify(url)}`, { encoding: "utf8" });
  return JSON.parse(out);
}

function httpDownload(url, outPath) {
  mkdirp(path.dirname(outPath));
  execSync(`curl -fsSL ${JSON.stringify(url)} -o ${JSON.stringify(outPath)}`, { stdio: "inherit" });
}

function detectChannelFromVersion(v) {
  return v.includes("-") ? "beta" : "stable";
}

/**
 * Publish one external version into gh-pages working tree.
 */
function publishExternal({ publicDir, pkg, version, channel, builtAt, upstream, files }) {
  const pkgDir = path.join(publicDir, pkg);
  const versionDir = path.join(pkgDir, `v${version}`);
  const latestDir = path.join(pkgDir, "@latest");
  const stableDir = path.join(pkgDir, "@stable");
  const betaDir = path.join(pkgDir, "@beta");

  mkdirp(versionDir);
  mkdirp(latestDir);
  mkdirp(stableDir);
  mkdirp(betaDir);

  // Copy files into versionDir (immutable).
  rmrf(versionDir);
  mkdirp(versionDir);

  const manifestFiles = {};
  for (const f of files) {
    const name = path.basename(f.localPath);
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
    upstream,
    files: manifestFiles
  };

  writeJson(path.join(versionDir, "manifest.json"), manifest);

  // Update pointers.
  rmrf(latestDir); mkdirp(latestDir);
  for (const name of Object.keys(manifestFiles)) {
    fs.copyFileSync(path.join(versionDir, name), path.join(latestDir, name));
  }
  writeJson(path.join(latestDir, "manifest.json"), manifest);

  if (channel === "stable") {
    rmrf(stableDir); mkdirp(stableDir);
    for (const name of Object.keys(manifestFiles)) {
      fs.copyFileSync(path.join(versionDir, name), path.join(stableDir, name));
    }
    writeJson(path.join(stableDir, "manifest.json"), manifest);
  } else {
    rmrf(betaDir); mkdirp(betaDir);
    for (const name of Object.keys(manifestFiles)) {
      fs.copyFileSync(path.join(versionDir, name), path.join(betaDir, name));
    }
    writeJson(path.join(betaDir, "manifest.json"), manifest);
  }
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

  if (src.type === "github-release-asset") {
    const rel = httpGetJson(`https://api.github.com/repos/${src.repo}/releases/latest`);
    const tag = rel.tag_name || rel.name;
    if (!tag) continue;

    const prev = state[pkg]?.last_upstream_tag;
    if (prev === tag) continue;

    const re = new RegExp(src.asset_regex);
    const assets = (rel.assets || []).filter(a => re.test(a.name));
    if (!assets.length) continue;

    const tmpDir = path.join(ROOT, ".tmp", "external", pkg, tag);
    rmrf(tmpDir); mkdirp(tmpDir);

    const downloaded = [];
    for (const a of assets) {
      const outPath = path.join(tmpDir, a.name);
      httpDownload(a.browser_download_url, outPath);
      downloaded.push({ localPath: outPath });
    }

    const version = String(tag).replace(/^v/, "");
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
        release_html_url: rel.html_url
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

    state[pkg] = { last_upstream_tag: tag };
    changed = true;
  }

  if (src.type === "github-raw-file") {
    const ref = src.ref || "main";
    const refInfo = httpGetJson(`https://api.github.com/repos/${src.repo}/commits/${encodeURIComponent(ref)}`);
    const sha = refInfo.sha;
    if (!sha) continue;

    const prev = state[pkg]?.last_commit;
    if (prev === sha) continue;

    const rawUrl = `https://raw.githubusercontent.com/${src.repo}/${sha}/${src.path}`;
    const tmpDir = path.join(ROOT, ".tmp", "external", pkg, sha.slice(0, 12));
    rmrf(tmpDir); mkdirp(tmpDir);

    const filename = path.basename(src.path);
    const outPath = path.join(tmpDir, filename);
    httpDownload(rawUrl, outPath);

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
        path: src.path
      },
      files: [{ localPath: outPath }]
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
    builtAt
  });
}
