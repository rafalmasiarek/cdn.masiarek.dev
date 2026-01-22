// tools/fetch-analytics.mjs
// Fetches Cloudflare GraphQL analytics and writes per-package JSON files into gh-pages "public" dir.
//
// Output layout (in gh-pages):
//   /_index/analytics/global.json
//   /_index/analytics/<pkg>.json
//
// Retention:
//   - hourly: last 72 hours
//   - daily:  last 90 days
//
// Notes:
//   - Uses httpRequestsAdaptiveGroups and "count" as request count.
//   - Uses clientRequestHTTPHost filter for the CDN hostname.
//   - Per-package uses clientRequestPath_like: "/<pkg>/%" (includes all versions/files).

import fs from "node:fs";
import path from "node:path";

const PUBLIC_DIR = "public";
const OUT_DIR = path.join(PUBLIC_DIR, "_index", "analytics");

const HOURLY_HOURS = 72;
const DAILY_DAYS = 90;

function mustEnv(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing required env: ${name}`);
    return v;
}

const CF_API_TOKEN = mustEnv("CF_API_TOKEN");
const CF_ZONE_TAG = mustEnv("CF_ZONE_TAG");
const CDN_CUSTOM_DOMAIN = mustEnv("CDN_CUSTOM_DOMAIN");

function isoHoursAgo(n) {
    const d = new Date(Date.now() - n * 60 * 60 * 1000);
    return d.toISOString();
}

function isoDaysAgo(n) {
    const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    return d.toISOString();
}

function isoAtHoursAgo(n) {
    return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

function mergeSeriesByT(seriesList) {
    // Deduplicate by timestamp (t) and sum counts if duplicates appear
    const map = new Map();
    for (const series of seriesList) {
        for (const p of series || []) {
            if (!p?.t) continue;
            const prev = map.get(p.t) || 0;
            map.set(p.t, prev + Number(p.count || 0));
        }
    }
    return Array.from(map.entries())
        .map(([t, count]) => ({ t, count }))
        .sort((a, b) => new Date(a.t) - new Date(b.t));
}

async function cfGraphql(query, variables) {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${CF_API_TOKEN}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Cloudflare GraphQL HTTP ${res.status}: ${txt.slice(0, 500)}`);
    }

    const json = await res.json();
    if (json?.errors?.length) {
        throw new Error(`Cloudflare GraphQL errors: ${JSON.stringify(json.errors).slice(0, 800)}`);
    }
    return json?.data;
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function readJsonIfExists(p, fallback) {
    try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
        return fallback;
    }
}

function writeJson(p, obj) {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function clipSeries(series, minIso) {
    const minT = new Date(minIso).getTime();
    return (series || []).filter(x => new Date(x.t).getTime() >= minT);
}

function normalizeHourly(rows) {
    // rows: [{ dimensions: { datetimeHour }, count }]
    return rows
        .map(r => ({ t: r.dimensions?.datetimeHour, count: Number(r.count || 0) }))
        .filter(x => x.t)
        .sort((a, b) => new Date(a.t) - new Date(b.t));
}

function normalizeDaily(rows) {
    // Some zones return datetimeDay, some may return datetimeDate.
    return rows
        .map(r => ({
            t: r.dimensions?.datetimeDay || r.dimensions?.datetimeDate,
            count: Number(r.count || 0),
        }))
        .filter(x => x.t)
        .sort((a, b) => new Date(a.t) - new Date(b.t));
}

async function queryHourly({ pathLike }) {
    const query = `
    query Hourly($zoneTag: string, $filter: filter) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 5000
            filter: $filter
            orderBy: [datetimeHour_ASC]
          ) {
            count
            dimensions { datetimeHour }
          }
        }
      }
    }
  `;

    // Cloudflare limit: hourly time range cannot exceed 86400s (24h) for some plans.
    // We chunk the 72h window into 3x 24h queries and merge.
    const nowIso = new Date().toISOString();

    const ranges = [];
    for (let fromH = HOURLY_HOURS; fromH > 0; fromH -= 24) {
        const toH = Math.max(0, fromH - 24);
        ranges.push({
            from: isoAtHoursAgo(fromH),
            to: toH === 0 ? nowIso : isoAtHoursAgo(toH),
        });
    }

    const all = [];

    for (const r of ranges) {
        const filter = {
            datetime_geq: r.from,
            datetime_lt: r.to,
            clientRequestHTTPHost: CDN_CUSTOM_DOMAIN,
        };

        if (pathLike) filter.clientRequestPath_like = pathLike;

        const data = await cfGraphql(query, { zoneTag: CF_ZONE_TAG, filter });
        const rows = data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];
        all.push(normalizeHourly(rows));
    }

    return mergeSeriesByT(all);
}

async function queryDaily({ pathLike }) {
    const query = `
    query Daily($zoneTag: string, $filter: filter) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          httpRequestsAdaptiveGroups(
            limit: 5000
            filter: $filter
            orderBy: [datetimeDay_ASC]
          ) {
            count
            dimensions { datetimeDay }
          }
        }
      }
    }
  `;

    const filter = {
        datetime_geq: isoDaysAgo(DAILY_DAYS),
        datetime_lt: new Date().toISOString(),
        clientRequestHTTPHost: CDN_CUSTOM_DOMAIN,
    };

    if (pathLike) filter.clientRequestPath_like = pathLike;

    const data = await cfGraphql(query, { zoneTag: CF_ZONE_TAG, filter });
    const rows = data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || [];
    return normalizeDaily(rows);
}

function loadPackagesFromGhPagesIndex() {
    const idxPath = path.join(PUBLIC_DIR, "_index", "index.json");
    const idx = readJsonIfExists(idxPath, null);
    const pkgs = idx?.packages ? Object.keys(idx.packages) : [];
    return pkgs.sort();
}

function loadPackagesFromSourceRepo() {
    const p = "packages";
    if (!fs.existsSync(p)) return [];
    return fs.readdirSync(p, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort();
}

async function main() {
    ensureDir(OUT_DIR);

    const pkgs = loadPackagesFromGhPagesIndex();
    const packages = pkgs.length ? pkgs : loadPackagesFromSourceRepo();

    if (!packages.length) {
        throw new Error("No packages found (neither in public/_index/index.json nor in ./packages/*).");
    }

    // Global
    const globalHourly = await queryHourly({ pathLike: null });
    const globalDaily = await queryDaily({ pathLike: null });

    const globalPath = path.join(OUT_DIR, "global.json");
    const oldGlobal = readJsonIfExists(globalPath, {});

    const globalObj = {
        generated_at: new Date().toISOString(),
        hostname: CDN_CUSTOM_DOMAIN,
        retention: { hourly_hours: HOURLY_HOURS, daily_days: DAILY_DAYS },
        hourly: clipSeries(globalHourly, isoHoursAgo(HOURLY_HOURS)),
        daily: clipSeries(globalDaily, isoDaysAgo(DAILY_DAYS)),
        // Keep a tiny metadata section for future extensions
        meta: { source: "cloudflare_graphql", previous_generated_at: oldGlobal?.generated_at || null },
    };

    writeJson(globalPath, globalObj);

    // Per package
    for (const pkg of packages) {
        const hourly = await queryHourly({ pathLike: `/${pkg}/%` });
        const daily = await queryDaily({ pathLike: `/${pkg}/%` });

        const outPath = path.join(OUT_DIR, `${pkg}.json`);
        const old = readJsonIfExists(outPath, {});

        const obj = {
            generated_at: new Date().toISOString(),
            hostname: CDN_CUSTOM_DOMAIN,
            package: pkg,
            retention: { hourly_hours: HOURLY_HOURS, daily_days: DAILY_DAYS },
            hourly: clipSeries(hourly, isoHoursAgo(HOURLY_HOURS)),
            daily: clipSeries(daily, isoDaysAgo(DAILY_DAYS)),
            meta: { source: "cloudflare_graphql", previous_generated_at: old?.generated_at || null },
        };

        writeJson(outPath, obj);
    }

    console.log(`Wrote analytics: ${path.join("_index", "analytics")} (global + ${packages.length} packages)`);
}

main().catch((e) => {
    console.error(e?.stack || String(e));
    process.exit(1);
});