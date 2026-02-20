// sync-external.mjs
// Sync externals into gh-pages working tree
//
// Supported source types:
//  - github-release-asset: uses /releases/latest only
//  - github-raw-file: uses raw file pinned by commit SHA (published as v<sha12>, pointer @latest only)
//  - github-release-assets-semver:
//      * If releases exist: uses /releases/latest as @latest (GitHub "latest" semantics)
//      * Additionally, can publish stable/beta channels based on semver + prerelease
//      * If a release has NO assets and src.zipball_fallback=true: downloads zipball_url and extracts configured files
//      * If no releases: falls back to highest semver tag (from /tags) BUT cannot publish unless zipball_fallback=true
//
// Output:
//  public/<pkg>/v<version>/... + manifest.json
//  public/<pkg>/@latest/...
//  public/<pkg>/@stable/...
//  public/<pkg>/@beta/...
//
// Stable aliases:
//  For stable channel only (non-prerelease semver), also creates:
//    public/<pkg>/v<major>/...
//    public/<pkg>/v<major>.<minor>/...
//  pointing to the same files as v<full>.
//
// Also updates:
//  public/<pkg>/versions.json
//  public/_index/index.json
//  public/_index/external-state.json
//  public/_index/bundle-manifest.json
//  public/_index/sync-report.json
//
// Exit behavior:
//  - By default: exits 0 even if some sources failed (but prints FAIL rows)
//  - If FAIL_ON_EXTERNAL_ERROR=1: exits 1 when at least one source failed

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import semver from "semver";
import { updateIndexes } from "./update-index.mjs";
import { buildBundleManifest } from "./build-bundle-manifest.mjs";

function readJson(fp, def) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return def;
  }
}
function writeJson(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + "\n", "utf8");
}
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

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
  if (!tok) return { Accept: "application/vnd.github+json" };
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${tok}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function getDefaultBranch(repo) {
  const info = httpGetJson(`https://api.github.com/repos/${repo}`, ghAuthHeaders());
  return info?.default_branch || "main";
}

function sha12(sha) {
  return String(sha || "").slice(0, 12);
}

function safeOneLine(s, max = 220) {
  const str = String(s ?? "");
  const one = str.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 3) + "..." : one;
}

function padRight(s, n) {
  const str = String(s ?? "");
  return str + " ".repeat(Math.max(0, n - str.length));
}

function toMarkdownTable(rows) {
  // rows: Array<{package,type,upstream,action,status,details}>
  const headers = ["package", "type", "upstream", "action", "status", "details"];
  const out = [];
  out.push(`| ${headers.join(" | ")} |`);
  out.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    out.push(
      `| ${safeOneLine(r.package)} | ${safeOneLine(r.type)} | ${safeOneLine(r.upstream)} | ${safeOneLine(
        r.action
      )} | ${safeOneLine(r.status)} | ${safeOneLine(r.details)} |`
    );
  }
  return out.join("\n");
}

function toAsciiTable(rows) {
  const cols = ["package", "type", "upstream", "action", "status", "details"];
  const widths = Object.fromEntries(cols.map((c) => [c, c.length]));
  for (const r of rows) {
    for (const c of cols) widths[c] = Math.max(widths[c], safeOneLine(r[c]).length);
  }
  const line = cols.map((c) => padRight(c, widths[c])).join("  ");
  const sep = cols.map((c) => "-".repeat(widths[c])).join("  ");
  const body = rows
    .map((r) => cols.map((c) => padRight(safeOneLine(r[c]), widths[c])).join("  "))
    .join("\n");
  return [line, sep, body].join("\n");
}

function listZipEntries(zipPath) {
  return execSync(`unzip -Z1 ${JSON.stringify(zipPath)}`, { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract matching files from a zip into tmpDir using extract rules.
 *
 * @param {object} opts
 * @param {string} opts.zipPath
 * @param {Array<{file_regex:string,out_name?:string,preserve_path?:boolean,minify?:string}>} opts.extractRules
 * @param {string} opts.tmpDir
 * @returns {Array<{localPath:string,outName?:string,minify?:string}>}
 */
function extractFromZip({ zipPath, extractRules, tmpDir }) {
  if (!extractRules || !extractRules.length) return [];

  const entries = listZipEntries(zipPath);
  const out = [];

  for (const rule of extractRules) {
    const fre = new RegExp(rule.file_regex);
    const matches = entries.filter((p) => fre.test(p));

    for (const inside of matches) {
      const outName = rule.preserve_path ? inside : (rule.out_name || path.basename(inside));
      const extractedPath = path.join(tmpDir, "extracted__", inside);

      mkdirp(path.dirname(extractedPath));
      execSync(`unzip -p ${JSON.stringify(zipPath)} ${JSON.stringify(inside)} > ${JSON.stringify(extractedPath)}`);

      out.push({ localPath: extractedPath, outName, minify: rule.minify || "" });
    }
  }

  return out;
}

/**
 * Recursively list files in a directory as POSIX-like relative paths.
 *
 * @param {string} rootDir
 * @returns {string[]} relative paths with "/" separators
 */
function listFilesRecursive(rootDir) {
  const out = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(abs);
    }
  }
  walk(rootDir);

  return out
    .map((abs) => path.relative(rootDir, abs).split(path.sep).join("/"))
    .filter(Boolean);
}

/**
 * Extract matching files from a directory using extract rules (file_regex matches relative path).
 *
 * @param {object} opts
 * @param {string} opts.rootDir
 * @param {Array<{file_regex:string,out_name?:string,preserve_path?:boolean,minify?:string}>} opts.extractRules
 * @returns {Array<{localPath:string,outName?:string,minify?:string}>}
 */
function extractFromDir({ rootDir, extractRules }) {
  if (!extractRules || !extractRules.length) return [];

  const rels = listFilesRecursive(rootDir);
  const out = [];

  for (const rule of extractRules) {
    const fre = new RegExp(rule.file_regex);
    const matches = rels.filter((p) => fre.test(p));

    for (const rel of matches) {
      const outName = rule.preserve_path ? rel : (rule.out_name || path.basename(rel));
      const abs = path.join(rootDir, rel.split("/").join(path.sep));
      out.push({ localPath: abs, outName, minify: rule.minify || "" });
    }
  }

  return out;
}

/**
 * Run a shell command with a timeout (ms).
 */
function sh(cmd, { cwd, timeoutMs, env } = {}) {
  execSync(cmd, {
    cwd: cwd || process.cwd(),
    stdio: "inherit",
    timeout: timeoutMs || 0,
    env: { ...process.env, ...(env || {}) },
  });
}

/**
 * NEW: Minify selected extracted files using terser.
 * We minify the *content* but keep the configured outName (e.g. build/pdf.min.js).
 *
 * @param {Array<{localPath:string,outName?:string,minify?:string}>} files
 * @param {string} tmpDir
 */
function applyMinify(files, tmpDir) {
  if (!files || !files.length) return files;
  const out = [];

  for (const f of files) {
    const mode = String(f.minify || "").trim();
    if (mode !== "terser") {
      out.push(f);
      continue;
    }

    const srcPath = f.localPath;
    const ext = path.extname(srcPath).toLowerCase();
    if (ext !== ".js") {
      out.push(f);
      continue;
    }

    const base = path.basename(srcPath, ".js");
    const minDir = path.join(tmpDir, "minified__");
    mkdirp(minDir);

    const dstPath = path.join(minDir, `${base}.min.js`);

    // Keep output deterministic and non-interactive
    // --yes avoids prompt, pin terser major for stability
    console.log(`[external] minify(terser): ${path.basename(srcPath)} -> ${path.basename(dstPath)}`);
    sh(
      `npx --yes terser@5 ${JSON.stringify(srcPath)} -c -m --ecma 2018 -o ${JSON.stringify(dstPath)}`,
      { cwd: tmpDir }
    );

    out.push({ ...f, localPath: dstPath });
  }

  return out;
}

/**
 * Minimal build config normalization.
 *
 * Supported:
 *  - build: true                   -> enabled with defaults
 *  - build: { enable: true, ... }   -> enabled with defaults overridden
 *  - otherwise                      -> disabled
 */
function normalizeBuildCfg(buildCfg) {
  const enabled =
    buildCfg === true || (buildCfg && typeof buildCfg === "object" && buildCfg.enable === true);

  if (!enabled) {
    return { enabled: false, workdir: ".", timeoutMs: 600_000, install: "", preInstall: "", run: "", env: {} };
  }

  const workdir =
    buildCfg && typeof buildCfg === "object" && typeof buildCfg.workdir === "string" && buildCfg.workdir.trim()
      ? buildCfg.workdir.trim()
      : ".";

  const timeoutMsRaw =
    buildCfg && typeof buildCfg === "object" && buildCfg.timeout_ms !== undefined ? Number(buildCfg.timeout_ms) : 600_000;
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 600_000;

  const install =
    buildCfg && typeof buildCfg === "object" && typeof buildCfg.install === "string" ? buildCfg.install.trim() : "";

  const preInstall =
    buildCfg && typeof buildCfg === "object" && typeof buildCfg.pre_install === "string"
      ? buildCfg.pre_install.trim()
      : "";

  const run =
    buildCfg && typeof buildCfg === "object" && typeof buildCfg.run === "string" ? buildCfg.run.trim() : "";

  const env =
    buildCfg && typeof buildCfg === "object" && buildCfg.env && typeof buildCfg.env === "object"
      ? buildCfg.env
      : {};

  return { enabled: true, workdir, timeoutMs, install, preInstall, run, env };
}

/**
 * Download a GitHub zipball, extract it, optionally run npm install + npm run build,
 * then collect artifacts using extract rules (matching by relative path).
 */
function downloadZipballBuildAndCollect({ repo, release, extractRules, buildCfg, tmpDir }) {
  if (!release?.zipball_url) return [];

  const cfg = normalizeBuildCfg(buildCfg);
  if (!cfg.enabled) return [];

  rmrf(tmpDir);
  mkdirp(tmpDir);

  const zipPath = path.join(tmpDir, `${repo.replace("/", "__")}__zipball.zip`);
  httpDownload(release.zipball_url, zipPath, ghAuthHeaders());

  const srcDir = path.join(tmpDir, "src");
  rmrf(srcDir);
  mkdirp(srcDir);

  sh(`unzip -q ${JSON.stringify(zipPath)} -d ${JSON.stringify(srcDir)}`);

  const top = fs
    .readdirSync(srcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(srcDir, d.name))[0];

  if (!top) return [];

  const workdir = path.join(top, cfg.workdir || ".");
  if (!fs.existsSync(workdir)) return [];

  const hasLock =
    fs.existsSync(path.join(workdir, "package-lock.json")) ||
    fs.existsSync(path.join(workdir, "npm-shrinkwrap.json"));

  let installCmd =
    String(cfg.install || "").trim() ||
    (hasLock ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund");

  if (/\bnpm\s+ci\b/.test(installCmd) && !hasLock) {
    installCmd = "npm install --no-audit --no-fund";
  }

  const buildCmd = String(cfg.run || "").trim();

  if (cfg.preInstall) {
    console.log(`[external] pre_install: ${cfg.preInstall}`);
    sh(cfg.preInstall, { cwd: workdir, timeoutMs: cfg.timeoutMs, env: cfg.env || {} });
  }

  console.log(`[external] install: ${installCmd}`);
  sh(installCmd, { cwd: workdir, timeoutMs: cfg.timeoutMs, env: cfg.env || {} });

  if (buildCmd) {
    console.log(`[external] build: ${buildCmd}`);
    sh(buildCmd, { cwd: workdir, timeoutMs: cfg.timeoutMs, env: cfg.env || {} });
  }

  let files = extractFromDir({ rootDir: workdir, extractRules });
  files = applyMinify(files, tmpDir);

  return files;
}

/**
 * Publish one external version into gh-pages working tree.
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

  rmrf(versionDir);
  mkdirp(versionDir);

  const manifestFiles = {};
  for (const f of files) {
    const name = f.outName || path.basename(f.localPath);
    const buf = fs.readFileSync(f.localPath);

    const dst = path.join(versionDir, name);
    mkdirp(path.dirname(dst));
    fs.writeFileSync(dst, buf);

    manifestFiles[name] = { integrity: sriSha384(buf), bytes: buf.length };
  }

  const manifest = {
    package: pkg,
    version: `v${version}`,
    channel: channel ?? null,
    built_at: builtAt,
    commit: null,
    upstream: upstream || null,
    meta: meta || null,
    files: manifestFiles,
  };

  writeJson(path.join(versionDir, "manifest.json"), manifest);

  function syncPointer(dir) {
    rmrf(dir);
    mkdirp(dir);
    for (const name of Object.keys(manifestFiles)) {
      const src = path.join(versionDir, name);
      const dst = path.join(dir, name);
      mkdirp(path.dirname(dst));
      fs.copyFileSync(src, dst);
    }
    writeJson(path.join(dir, "manifest.json"), manifest);
  }

  if (updatePointer === "latest") syncPointer(latestDir);
  if (updatePointer === "stable") syncPointer(stableDir);
  if (updatePointer === "beta") syncPointer(betaDir);

  if (channel === "stable") {
    const coerced = semver.coerce(version)?.version || null;
    if (coerced && semver.valid(coerced) && !semver.prerelease(coerced)) {
      const maj = String(semver.major(coerced));
      const min = `${semver.major(coerced)}.${semver.minor(coerced)}`;

      const aliasMajorDir = path.join(pkgDir, `v${maj}`);
      const aliasMinorDir = path.join(pkgDir, `v${min}`);

      syncPointer(aliasMajorDir);
      syncPointer(aliasMinorDir);
    }
  }
}

/**
 * Download GitHub release assets matching regex.
 * Optionally unpack zip assets and pick files from inside zip via "extract".
 */
function downloadReleaseAssets({ repo, release, assetRegex, extract, tmpDir }) {
  const re = new RegExp(assetRegex);
  const assets = (release.assets || []).filter((a) => re.test(a.name));
  if (!assets.length) return [];

  rmrf(tmpDir);
  mkdirp(tmpDir);

  const out = [];
  const headers = ghAuthHeaders();

  for (const a of assets) {
    const assetPath = path.join(tmpDir, a.name);
    httpDownload(a.browser_download_url, assetPath, headers);

    const isZip = a.name.toLowerCase().endsWith(".zip");
    if (extract && extract.length && isZip) {
      for (const rule of extract) {
        if (rule.zip_asset_regex) {
          const zre = new RegExp(rule.zip_asset_regex);
          if (!zre.test(a.name)) continue;
        }
        const fre = new RegExp(rule.file_regex);

        const list = listZipEntries(assetPath);
        const matches = list.filter((p) => fre.test(p));
        for (const inside of matches) {
          const outName = rule.preserve_path ? inside : (rule.out_name || path.basename(inside));
          const extractedPath = path.join(tmpDir, "extracted__", inside);
          mkdirp(path.dirname(extractedPath));
          execSync(
            `unzip -p ${JSON.stringify(assetPath)} ${JSON.stringify(inside)} > ${JSON.stringify(extractedPath)}`
          );
          out.push({ localPath: extractedPath, outName, minify: rule.minify || "" });
        }
      }
    } else {
      out.push({ localPath: assetPath });
    }
  }

  const extracted = out.filter((x) => x.localPath.includes(`${path.sep}extracted__${path.sep}`));
  const files = (extract && extract.length && extracted.length) ? extracted : out;

  return applyMinify(files, tmpDir);
}

function getLatestRelease(repo) {
  try {
    return httpGetJson(`https://api.github.com/repos/${repo}/releases/latest`, ghAuthHeaders());
  } catch {
    return null;
  }
}

function getReleases(repo, perPage = 30) {
  const rels = httpGetJson(`https://api.github.com/repos/${repo}/releases?per_page=${perPage}`, ghAuthHeaders());
  return (rels || []).filter((r) => r && !r.draft);
}

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
  return stripV(tag);
}

function downloadZipballAndExtract({ repo, release, extract, tmpDir }) {
  if (!release?.zipball_url) return [];
  if (!extract || !extract.length) return [];

  rmrf(tmpDir);
  mkdirp(tmpDir);

  const zipPath = path.join(tmpDir, `${repo.replace("/", "__")}__zipball.zip`);
  httpDownload(release.zipball_url, zipPath, ghAuthHeaders());

  return extractFromZip({ zipPath, extractRules: extract, tmpDir });
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

const ROOT = process.cwd();
const publicDir = path.join(ROOT, "public");
const cfg = readJson(path.join(ROOT, "external-sources.json"), { sources: [] });
const stateFp = path.join(publicDir, "_index", "external-state.json");
const state = readJson(stateFp, {});
const reportFp = path.join(publicDir, "_index", "sync-report.json");

const builtAt = new Date().toISOString().replace(".000Z", "Z");
let changed = false;

const results = [];
let hadFailure = false;

function logGroupStart(pkg, type) {
  console.log(`\n=== [external:${pkg}] type=${type} ===`);
}

function pushResult(r) {
  results.push({
    package: r.package,
    type: r.type,
    upstream: r.upstream || "",
    action: r.action || "",
    status: r.status || "",
    details: r.details || "",
  });
}

function record(row) {
  pushResult(row);
  if (row.log !== false) {
    const prefix = `[external:${row.package}]`;
    const msg = `${prefix} ${row.status} action=${row.action} upstream=${safeOneLine(row.upstream)} details=${safeOneLine(
      row.details
    )}`;
    console.log(msg);
  }
}

for (const src of cfg.sources || []) {
  const pkg = src.package;
  if (!pkg) continue;

  const type = src.type || "unknown";
  logGroupStart(pkg, type);

  try {
    if (src.type === "github-release-assets-semver") {
      const repo = src.repo;
      if (!repo) {
        record({ package: pkg, type, upstream: "", action: "skip", status: "FAIL", details: "Missing src.repo" });
        hadFailure = true;
        continue;
      }

      console.log(`[external:${pkg}] repo=${repo}`);
      console.log(`[external:${pkg}] fetching releases/latest...`);

      let latest = getLatestRelease(repo);
      let latestTag = latest?.tag_name || latest?.name || null;

      if (!latestTag) {
        console.log(`[external:${pkg}] no /releases/latest, trying /tags highest semver...`);
        const topTag = getHighestSemverTag(repo);
        if (!topTag) {
          record({
            package: pkg,
            type,
            upstream: "",
            action: "skip",
            status: "FAIL",
            details: "No releases and no semver tags found",
          });
          hadFailure = true;
          continue;
        }
        latestTag = topTag;
      }

      console.log(`[external:${pkg}] latestTag=${latestTag}`);

      console.log(`[external:${pkg}] listing recent releases to detect stable/beta...`);
      const releases = getReleases(repo, src.releases_per_page || 30);

      // pin_major support (minimal)
      const pinMajorRaw = src.pin_major;
      const pinMajor = pinMajorRaw === undefined || pinMajorRaw === null || pinMajorRaw === ""
        ? null
        : Number(pinMajorRaw);

      if (pinMajor !== null && !Number.isFinite(pinMajor)) {
        record({
          package: pkg,
          type,
          upstream: latestTag || "",
          action: "skip",
          status: "FAIL",
          details: `Invalid pin_major=${safeOneLine(pinMajorRaw)}`,
        });
        hadFailure = true;
        continue;
      }

      const parsed = releases
        .map((r) => {
          const t = r.tag_name || r.name || "";
          const v = semver.coerce(stripV(t))?.version || null;
          const prerelease = !!(r.prerelease || (v && semver.prerelease(v)));
          return { r, tag: t, v, prerelease };
        })
        .filter((x) => x.v && semver.valid(x.v))
        .filter((x) => (pinMajor === null ? true : semver.major(x.v) === pinMajor));

      const stable =
        parsed.filter((x) => !x.prerelease).sort((a, b) => semver.rcompare(a.v, b.v))[0] || null;
      const beta =
        parsed.filter((x) => x.prerelease).sort((a, b) => semver.rcompare(a.v, b.v))[0] || null;

      if (pinMajor !== null) {
        latest = stable?.r || beta?.r || null;
        latestTag = latest ? (latest.tag_name || latest.name || null) : null;
        console.log(`[external:${pkg}] pin_major=${pinMajor} -> pinned latestTag=${latestTag}`);
      }

      const latestKey = `${repo}@latest:${latestTag}`;
      const needLatest = state[pkg]?.latest_key !== latestKey;
      console.log(`[external:${pkg}] needLatest=${needLatest}`);

      const stableTag = stable?.tag || null;
      const betaTag = beta?.tag || null;

      const stableKey = stableTag ? `${repo}@stable:${stableTag}` : null;
      const betaKey = betaTag ? `${repo}@beta:${betaTag}` : null;

      const needStable = stableKey && state[pkg]?.stable_key !== stableKey;
      const needBeta = betaKey && state[pkg]?.beta_key !== betaKey;

      if (!needLatest && !needStable && !needBeta) {
        record({
          package: pkg,
          type,
          upstream: latestTag,
          action: "skip",
          status: "SKIP",
          details: "No changes (keys match external-state.json)",
        });
        continue;
      }

      function publishFromRelease(releaseObj, pointerName) {
        const tag = releaseObj.tag_name || releaseObj.name;
        const version = normalizeUpstreamTagToVersion(tag);
        const channel = detectChannelFromVersion(version);

        const tmpDir = path.join(ROOT, ".tmp", "external", pkg, `${pointerName}__${stripV(tag)}`);

        let files = [];
        const buildEnabled = normalizeBuildCfg(src.build).enabled;

        if (buildEnabled) {
          console.log(`[external:${pkg}] build enabled -> zipball + npm build for ${pointerName} tag=${tag}...`);
          files = downloadZipballBuildAndCollect({
            repo,
            release: releaseObj,
            extractRules: src.extract || [],
            buildCfg: src.build,
            tmpDir,
          });
        } else {
          console.log(`[external:${pkg}] downloading assets for ${pointerName} tag=${tag}...`);
          files = downloadReleaseAssets({
            repo,
            release: releaseObj,
            assetRegex: src.asset_regex,
            extract: src.extract || [],
            tmpDir,
          });

          if ((!files || !files.length) && src.zipball_fallback) {
            console.log(`[external:${pkg}] no assets matched; zipball_fallback=true -> downloading zipball...`);
            const zipTmpDir = path.join(tmpDir, "zipball");
            files = downloadZipballAndExtract({
              repo,
              release: releaseObj,
              extract: src.extract || [],
              tmpDir: zipTmpDir,
            });
            files = applyMinify(files, tmpDir);
          }
        }

        if (!files.length) {
          return {
            ok: false,
            reason:
              "No matching outputs. For build: ensure src.extract points at built files and set build.run if required. For non-build: ensure assets/extract or zipball_fallback are correct.",
          };
        }

        publishExternal({
          publicDir,
          pkg,
          version,
          channel,
          builtAt,
          upstream: {
            type: buildEnabled ? "github-zipball-build" : "github-release",
            repo,
            tag,
            release_html_url: releaseObj.html_url || null,
          },
          meta: src.meta || null,
          files,
          updatePointer: pointerName,
        });

        updateIndexes({
          publicDir,
          pkg,
          version: `v${version}`,
          channel,
          builtAt,
          meta: src.meta || null,
        });

        return { ok: true, tag, version, channel, files };
      }

      if (needLatest) {
        if (!latest || !latest.tag_name) {
          record({
            package: pkg,
            type,
            upstream: latestTag,
            action: "publish",
            status: "FAIL",
            details: "No GitHub release object for @latest (use github-raw-file or create a release)",
          });
          hadFailure = true;
        } else {
          const r = publishFromRelease(latest, "latest");
          if (!r.ok) {
            record({
              package: pkg,
              type,
              upstream: latest.tag_name,
              action: "publish",
              status: "FAIL",
              details: r.reason,
            });
            hadFailure = true;
          } else {
            state[pkg] = state[pkg] || {};
            state[pkg].latest_key = latestKey;
            state[pkg].last_upstream_tag = latest.tag_name;
            changed = true;

            record({
              package: pkg,
              type,
              upstream: latest.tag_name,
              action: "publish",
              status: "OK",
              details: `@latest v${r.version} files=${r.files.length}`,
            });
          }
        }
      }

      if (needStable && stable?.r) {
        const r = publishFromRelease(stable.r, "stable");
        if (!r.ok) {
          record({ package: pkg, type, upstream: stableTag || "", action: "publish", status: "FAIL", details: r.reason });
          hadFailure = true;
        } else {
          state[pkg] = state[pkg] || {};
          state[pkg].stable_key = stableKey;
          state[pkg].last_upstream_stable_tag = stableTag;
          changed = true;

          record({
            package: pkg,
            type,
            upstream: stableTag || "",
            action: "publish",
            status: "OK",
            details: `@stable v${r.version} files=${r.files.length} (+stable aliases)`,
          });
        }
      }

      if (needBeta && beta?.r) {
        const r = publishFromRelease(beta.r, "beta");
        if (!r.ok) {
          record({ package: pkg, type, upstream: betaTag || "", action: "publish", status: "FAIL", details: r.reason });
          hadFailure = true;
        } else {
          state[pkg] = state[pkg] || {};
          state[pkg].beta_key = betaKey;
          state[pkg].last_upstream_beta_tag = betaTag;
          changed = true;

          record({
            package: pkg,
            type,
            upstream: betaTag || "",
            action: "publish",
            status: "OK",
            details: `@beta v${r.version} files=${r.files.length}`,
          });
        }
      }

      continue;
    }

    if (src.type === "github-release-asset") {
      const repo = src.repo;
      if (!repo) {
        record({ package: pkg, type, upstream: "", action: "skip", status: "FAIL", details: "Missing src.repo" });
        hadFailure = true;
        continue;
      }

      console.log(`[external:${pkg}] repo=${repo}`);
      const rel = httpGetJson(`https://api.github.com/repos/${repo}/releases/latest`, ghAuthHeaders());
      const tag = rel.tag_name || rel.name;
      if (!tag) {
        record({
          package: pkg,
          type,
          upstream: "",
          action: "skip",
          status: "FAIL",
          details: "GitHub /releases/latest returned no tag_name/name",
        });
        hadFailure = true;
        continue;
      }

      const prev = state[pkg]?.last_upstream_tag;
      if (prev === tag) {
        record({ package: pkg, type, upstream: tag, action: "skip", status: "SKIP", details: "No changes (same upstream tag)" });
        continue;
      }

      const tmpDir = path.join(ROOT, ".tmp", "external", pkg, tag);
      let files = downloadReleaseAssets({
        repo,
        release: rel,
        assetRegex: src.asset_regex,
        extract: src.extract || [],
        tmpDir,
      });

      if (!files.length) {
        record({
          package: pkg,
          type,
          upstream: tag,
          action: "publish",
          status: "FAIL",
          details: "No matching assets (assets empty or regex mismatch)",
        });
        hadFailure = true;
        continue;
      }

      const version = stripV(tag);
      const channel = src.channel || detectChannelFromVersion(version);

      publishExternal({
        publicDir,
        pkg,
        version,
        channel,
        builtAt,
        upstream: { type: "github-release", repo, tag, release_html_url: rel.html_url },
        meta: src.meta || null,
        files,
        updatePointer: "latest",
      });

      updateIndexes({ publicDir, pkg, version: `v${version}`, channel, builtAt, meta: src.meta || null });

      state[pkg] = { ...(state[pkg] || {}), last_upstream_tag: tag };
      changed = true;

      record({ package: pkg, type, upstream: tag, action: "publish", status: "OK", details: `@latest v${version} files=${files.length}` });
      continue;
    }

    if (src.type === "github-raw-file") {
      const repo = src.repo;
      if (!repo) {
        record({ package: pkg, type, upstream: "", action: "skip", status: "FAIL", details: "Missing src.repo" });
        hadFailure = true;
        continue;
      }

      const ref = src.ref || getDefaultBranch(repo);
      console.log(`[external:${pkg}] repo=${repo} ref=${ref}`);

      const refInfo = httpGetJson(
        `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`,
        ghAuthHeaders()
      );
      const sha = refInfo.sha;
      if (!sha) {
        record({
          package: pkg,
          type,
          upstream: `${ref}@?`,
          action: "skip",
          status: "FAIL",
          details: "Could not resolve commit SHA for ref",
        });
        hadFailure = true;
        continue;
      }

      const upstreamStr = `${ref}@${sha12(sha)}`;

      const prev = state[pkg]?.last_commit;
      if (prev === sha) {
        record({ package: pkg, type, upstream: upstreamStr, action: "skip", status: "SKIP", details: "No changes (same commit SHA)" });
        continue;
      }

      let toFetch = [];

      if (Array.isArray(src.files) && src.files.length) {
        toFetch = src.files
          .filter((x) => x && typeof x.path === "string" && x.path.length)
          .map((x) => ({ path: x.path, outName: x.out_name || null }));
      } else if (Array.isArray(src.paths) && src.paths.length) {
        toFetch = src.paths.filter((p) => typeof p === "string" && p.length).map((p) => ({ path: p, outName: null }));
      } else if (typeof src.path === "string" && src.path.length) {
        toFetch = [{ path: src.path, outName: null }];
      }

      if (!toFetch.length) {
        record({ package: pkg, type, upstream: upstreamStr, action: "skip", status: "FAIL", details: "No files configured (use path/paths/files[])" });
        hadFailure = true;
        continue;
      }

      const tmpDir = path.join(ROOT, ".tmp", "external", pkg, sha12(sha));
      rmrf(tmpDir);
      mkdirp(tmpDir);

      const downloaded = [];
      for (const f of toFetch) {
        const rawUrl = `https://raw.githubusercontent.com/${repo}/${sha}/${f.path}`;
        const outName = f.outName || path.basename(f.path);
        const outPath = path.join(tmpDir, outName);

        console.log(`[external:${pkg}] download ${f.path} -> ${outName}`);
        httpDownload(rawUrl, outPath, ghAuthHeaders());
        downloaded.push({ localPath: outPath, outName });
      }

      const version = sha12(sha);
      const channel = null;

      publishExternal({
        publicDir,
        pkg,
        version,
        channel,
        builtAt,
        upstream: { type: "github-raw", repo, ref, commit: sha, paths: toFetch.map((x) => x.path) },
        meta: src.meta || null,
        files: downloaded,
        updatePointer: "latest",
      });

      updateIndexes({ publicDir, pkg, version: `v${version}`, channel, builtAt, meta: src.meta || null });

      state[pkg] = { ...(state[pkg] || {}), last_commit: sha, last_upstream_ref: ref };
      changed = true;

      record({ package: pkg, type, upstream: upstreamStr, action: "publish", status: "OK", details: `@latest v${version} files=${downloaded.length}` });
      continue;
    }

    record({ package: pkg, type, upstream: "", action: "skip", status: "FAIL", details: `Unknown source type: ${type}` });
    hadFailure = true;
  } catch (e) {
    hadFailure = true;
    const msg = e?.stack || String(e);

    console.log(`[external:${pkg}] ERROR: ${safeOneLine(msg, 500)}`);
    record({ package: pkg, type, upstream: "", action: "publish", status: "FAIL", details: safeOneLine(msg, 240) });
  }
}

if (changed) {
  console.log("\n[external] changes detected: updating UI + state + bundle-manifest...");

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
} else {
  console.log("\n[external] no changes detected: bundle-manifest not rebuilt.");
}

try {
  writeJson(reportFp, {
    generated_at: builtAt,
    changed,
    failures: results.filter((r) => r.status === "FAIL").length,
    results,
  });
} catch (e) {
  console.log(`[external] WARN: failed to write sync report: ${safeOneLine(e?.stack || String(e))}`);
}

console.log("\n=== External sync summary (markdown) ===");
console.log(toMarkdownTable(results));

console.log("\n=== External sync summary (ascii) ===");
console.log(toAsciiTable(results));

if (hadFailure && process.env.FAIL_ON_EXTERNAL_ERROR === "1") {
  console.error("\n[external] FAIL_ON_EXTERNAL_ERROR=1 and at least one source failed -> exit 1");
  process.exit(1);
}

console.log("\n[external] done.");