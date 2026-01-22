import { build } from "esbuild";
import fs from "node:fs";

fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist", { recursive: true });

await build({
  entryPoints: { "vinyl-loader.min": "src/index.js" },
  outdir: "dist",
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2020"],
  format: "iife"
});
