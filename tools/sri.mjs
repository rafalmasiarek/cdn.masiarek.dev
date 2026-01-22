import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Compute SRI sha384 for file content.
 * @param {Buffer} buf
 * @returns {string} e.g. "sha384-BASE64..."
 */
function sriSha384(buf) {
  const hash = crypto.createHash("sha384").update(buf).digest("base64");
  return `sha384-${hash}`;
}

/**
 * Produce integrity map for files in a directory.
 * @param {string} dir
 * @returns {Record<string, { integrity: string, bytes: number }>}
 */
export function computeSriMap(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const stat = fs.statSync(fp);
    if (!stat.isFile()) continue;
    const buf = fs.readFileSync(fp);
    out[name] = { integrity: sriSha384(buf), bytes: buf.length };
  }
  return out;
}
