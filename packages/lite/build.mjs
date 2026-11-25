import { build } from "esbuild";
import fs from "node:fs";

fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist", { recursive: true });

await build({
  entryPoints: { "lite.min": "src/lite.css" },
  outdir: "dist",
  bundle: true,
  minify: true,
  sourcemap: true
});
