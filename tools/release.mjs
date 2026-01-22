import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import semver from "semver";

function sh(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function shOut(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const pkg = process.env.PKG;
const channel = process.env.CHANNEL; // stable|beta
const bump = process.env.BUMP; // patch|minor|major|prerelease
const preid = process.env.PREID || "beta";

if (!pkg) throw new Error("Missing PKG env");

const pkgDir = path.join("packages", pkg);
const pkgJsonFp = path.join(pkgDir, "package.json");

if (!fs.existsSync(pkgJsonFp)) {
  throw new Error(`Package not found: ${pkgJsonFp}`);
}

const pkgJson = JSON.parse(fs.readFileSync(pkgJsonFp, "utf8"));
const current = pkgJson.version;

let next;

if (channel === "stable") {
  // Stable should never be prerelease.
  if (bump === "prerelease") {
    throw new Error("Stable channel cannot use prerelease bump.");
  }
  next = semver.inc(current, bump);
  if (!next) throw new Error(`Failed to bump version from ${current}`);
} else {
  // Beta channel: always prerelease flavor.
  if (bump === "prerelease") {
    next = semver.inc(current, "prerelease", preid);
  } else {
    // If you bump minor/patch/major for beta, we produce X.Y.Z-beta.0
    const base = semver.inc(current, bump);
    if (!base) throw new Error(`Failed to bump version from ${current}`);
    next = semver.inc(base, "prerelease", preid); // -> base-beta.0
  }
  if (!next) throw new Error(`Failed to compute beta version from ${current}`);
}

pkgJson.version = next;
fs.writeFileSync(pkgJsonFp, JSON.stringify(pkgJson, null, 2) + "\n", "utf8");

const tag = `${pkg}@${next}`;

sh(`git config user.name "github-actions[bot]"`);
sh(`git config user.email "github-actions[bot]@users.noreply.github.com"`);

sh(`git add ${pkgJsonFp}`);
sh(`git commit -m "release(${pkg}): ${next}"`);

const existingTags = shOut(`git tag -l "${tag}"`);
if (existingTags) {
  throw new Error(`Tag already exists: ${tag}`);
}

sh(`git tag "${tag}"`);
sh(`git push origin HEAD:main --tags`);

console.log(`Created tag: ${tag}`);
